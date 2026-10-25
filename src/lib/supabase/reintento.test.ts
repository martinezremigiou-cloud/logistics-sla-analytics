// ============================================================
// [MVP-CIERRE] F1 · Capa A.
//
// El caso que NO se puede perder de vista: "por defecto no se reintenta".
// En el mismo deploy que lleva este código se rotan `INGEST_SECRET` y la
// llave de servicio. Si un 401 se reintentara por su STATUS, una llave mal
// pegada se reintentaría en silencio y la rotación quedaría enmascarada
// justo cuando hace falta verla fallar. Varias pruebas de aquí existen
// para que ese comportamiento no se pueda relajar sin ponerse rojo.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  crearFetchResiliente,
  esTransitorio,
  rastroDe,
  registrarRastro,
  RASTRO_VACIO,
  TRANSITORIOS_SERVICIO,
  TRANSITORIOS_SESION,
} from './reintento';

const URL_MARCA_ALIAS = 'https://proyecto.supabase.co/rest/v1/marca_alias?select=alias,marca_id';

/** Respuesta 401 con el cuerpo que devuelve PostgREST. */
function r401(mensaje: string) {
  return new Response(JSON.stringify({ message: mensaje }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
const r200 = (cuerpo = '[]') => new Response(cuerpo, { status: 200 });

describe('esTransitorio — la lista blanca', () => {
  it('reconoce el ÚNICO transitorio con evidencia', () => {
    expect(esTransitorio('{"message":"JWT issued at future"}')).toBe(true);
    // `JWT expired` SALIÓ de la lista (auditoría): la service_role es una
    // llave estática, no se re-acuña, así que "vencido" = llave muerta.
    expect(esTransitorio('{"message":"JWT expired"}')).toBe(false);
  });

  // El match es sobre `message`, no sobre el cuerpo entero: si un 401
  // llegara a hacer eco de la entrada del llamador, bastaría con que ese
  // texto dijera la frase mágica para inducir un reintento.
  it('NO reintenta si la frase viene fuera de `message`', () => {
    expect(esTransitorio('{"message":"Invalid API key","hint":"JWT issued at future"}')).toBe(false);
    expect(esTransitorio('{"details":"JWT issued at future"}')).toBe(false);
    expect(esTransitorio('JWT issued at future')).toBe(false);
  });

  // Estos son credencial inválida o permiso faltante: deben doler de
  // inmediato, sobre todo durante una rotación de llaves.
  it.each([
    ['Invalid API key', '{"message":"Invalid API key"}'],
    ['invalid claim', '{"message":"invalid claim: missing sub claim"}'],
    ['JWSError', '{"message":"JWSError JWSInvalidSignature"}'],
    ['permission denied', '{"message":"permission denied for table productos"}'],
    ['mensaje desconocido', '{"message":"algo que nadie ha visto"}'],
    ['cuerpo vacío', ''],
    ['JWT expired', '{"message":"JWT expired"}'],
    ['message que no es string', '{"message":{"a":1}}'],
  ])('NO reintenta: %s', (_etiqueta, cuerpo) => {
    expect(esTransitorio(cuerpo)).toBe(false);
  });
});

describe('crearFetchResiliente', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Corre la promesa dejando avanzar el reloj falso de los backoffs. */
  async function conRelojAdelantado<T>(p: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return p;
  }

  it('401 transitorio en una LECTURA → reintenta y entrega el 200', async () => {
    fetchSpy.mockResolvedValueOnce(r401('JWT issued at future')).mockResolvedValueOnce(r200('[{"alias":"x"}]'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    const res = await conRelojAdelantado(fetchResiliente(URL_MARCA_ALIAS));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"alias":"x"}]');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(rastro.reintentos).toBe(1);
    expect(rastro.presupuestoAgotado).toBe(false);
  });

  it('el rastro guarda el mensaje LITERAL y el recurso, sin query string', async () => {
    fetchSpy.mockResolvedValueOnce(r401('JWT issued at future')).mockResolvedValueOnce(r200());
    const { fetchResiliente, rastro } = crearFetchResiliente();
    await conRelojAdelantado(fetchResiliente(URL_MARCA_ALIAS));

    expect(rastro.eventos).toHaveLength(1);
    const ev = rastro.eventos[0];
    // Es la evidencia que hoy NO tenemos de las corridas que fallaron:
    // el mensaje tiene que sobrevivir, no un booleano "hubo reintento".
    expect(ev.mensaje).toContain('JWT issued at future');
    expect(ev.recurso).toBe('marca_alias');
    expect(ev.recurso).not.toContain('?');
    expect(ev.status).toBe(401);
    expect(ev.intento).toBe(1);
    expect(ev.esperaMs).toBeGreaterThan(0);
  });

  it('401 de CREDENCIAL → no reintenta, devuelve el 401 con su cuerpo intacto', async () => {
    fetchSpy.mockResolvedValueOnce(r401('Invalid API key'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    const res = await fetchResiliente(URL_MARCA_ALIAS);

    expect(res.status).toBe(401);
    // El `clone()` interno NO puede haber consumido el cuerpo del caller.
    expect(await res.json()).toEqual({ message: 'Invalid API key' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rastro.reintentos).toBe(0);
  });

  it('401 con mensaje DESCONOCIDO → no reintenta (el default es fallar)', async () => {
    fetchSpy.mockResolvedValueOnce(r401('algo nuevo que nadie ha visto'));
    const { fetchResiliente, rastro } = crearFetchResiliente();
    expect((await fetchResiliente(URL_MARCA_ALIAS)).status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rastro.reintentos).toBe(0);
  });

  // La escritura TAMBIÉN se cubre, y solo ante 401. PostgREST valida el JWT
  // al ADMITIR la petición, antes de ejecutar la función: un 401 significa
  // que `ingest_snapshot` nunca corrió, así que el reintento no puede
  // duplicar una escritura. Sin esto, F1 bajaba la superficie de ~13
  // llamadas por corrida a 1, no a 0.
  it('401 transitorio en la ESCRITURA del snapshot → SÍ reintenta', async () => {
    fetchSpy.mockResolvedValueOnce(r401('JWT issued at future')).mockResolvedValueOnce(r200('{"snapshotId":"s1"}'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    const res = await conRelojAdelantado(
      fetchResiliente('https://p.supabase.co/rest/v1/rpc/ingest_snapshot', {
        method: 'POST',
        body: JSON.stringify({ payload: 1 }),
      }),
    );

    expect(res.status).toBe(200);
    expect(rastro.reintentos).toBe(1);
    expect(rastro.eventos[0].metodo).toBe('POST');
    expect(rastro.eventos[0].recurso).toBe('rpc/ingest_snapshot');
  });

  it('una escritura con cuerpo NO re-enviable no se reintenta (saldría vacía)', async () => {
    // Un `Request` ya construido o un stream pueden tener el cuerpo
    // consumido: reintentar mandaría una petición vacía, que es PEOR que no
    // reintentar porque parecería legítima.
    fetchSpy.mockResolvedValue(r401('JWT issued at future'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    const req = new Request('https://p.supabase.co/rest/v1/rpc/ingest_snapshot', {
      method: 'POST',
      body: '{"payload":1}',
    });
    const res = await fetchResiliente(req);

    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rastro.reintentos).toBe(0);
  });

  it('un 5xx NO se reintenta ni en lectura ni en escritura', async () => {
    // El alcance es 401 y solo 401: un 5xx a mitad de una escritura sí pudo
    // dejar ejecución parcial.
    fetchSpy.mockResolvedValue(new Response('boom', { status: 503 }));
    const { fetchResiliente, rastro } = crearFetchResiliente();
    expect((await fetchResiliente(URL_MARCA_ALIAS)).status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rastro.reintentos).toBe(0);
  });

  describe('lista por carril', () => {
    it('SERVICIO ya NO reintenta JWT expired: la llave es estática, no se re-acuña', async () => {
      fetchSpy.mockResolvedValueOnce(r401('JWT expired'));
      const { fetchResiliente, rastro } = crearFetchResiliente(TRANSITORIOS_SERVICIO);
      const res = await fetchResiliente(URL_MARCA_ALIAS);
      expect(res.status).toBe(401);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(rastro.reintentos).toBe(0);
    });

    it('SESIÓN NO reintenta JWT expired — no se des-vence esperando', async () => {
      fetchSpy.mockResolvedValueOnce(r401('JWT expired'));
      const { fetchResiliente, rastro } = crearFetchResiliente(TRANSITORIOS_SESION);
      const res = await fetchResiliente(URL_MARCA_ALIAS);
      expect(res.status).toBe(401);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(rastro.reintentos).toBe(0); // el usuario va a /login sin pagar 2.5 s
    });

    it('SESIÓN sí reintenta el token adelantado, que es el transitorio real', async () => {
      fetchSpy.mockResolvedValueOnce(r401('JWT issued at future')).mockResolvedValueOnce(r200());
      const { fetchResiliente, rastro } = crearFetchResiliente(TRANSITORIOS_SESION);
      await conRelojAdelantado(fetchResiliente(URL_MARCA_ALIAS));
      expect(rastro.reintentos).toBe(1);
    });
  });

  it('el presupuesto se agota y queda DECLARADO, no en silencio', async () => {
    fetchSpy.mockResolvedValue(r401('JWT issued at future'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    const res = await conRelojAdelantado(fetchResiliente(URL_MARCA_ALIAS));

    expect(res.status).toBe(401);
    expect(rastro.reintentos).toBe(3);
    expect(rastro.presupuestoAgotado).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(4); // 1 original + 3 reintentos
  });

  // La corrección que se pidió: con ~12 lecturas de catálogo por
  // corrida, un presupuesto POR LECTURA sumaba ~12 s en el peor caso.
  it('el presupuesto es POR PETICIÓN: varias lecturas lo comparten', async () => {
    fetchSpy.mockResolvedValue(r401('JWT issued at future'));
    const { fetchResiliente, rastro } = crearFetchResiliente();

    await conRelojAdelantado(fetchResiliente(URL_MARCA_ALIAS));
    const llamadasTrasPrimera = fetchSpy.mock.calls.length;
    await conRelojAdelantado(fetchResiliente('https://p.supabase.co/rest/v1/kams?select=id'));

    expect(rastro.reintentos).toBe(3); // NO 6
    // La segunda lectura ya no reintentó: solo su intento original.
    expect(fetchSpy.mock.calls.length).toBe(llamadasTrasPrimera + 1);
  });

  it('conserva cache: no-store (el bug de caché de Next sigue cubierto)', async () => {
    fetchSpy.mockResolvedValueOnce(r200());
    const { fetchResiliente } = crearFetchResiliente();
    await fetchResiliente(URL_MARCA_ALIAS, { headers: { apikey: 'x' } });

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>).apikey).toBe('x');
  });

  it('una corrida sin incidentes deja el rastro en cero', async () => {
    fetchSpy.mockResolvedValue(r200());
    const { fetchResiliente, rastro } = crearFetchResiliente();
    await fetchResiliente(URL_MARCA_ALIAS);
    expect(rastro).toEqual({ reintentos: 0, presupuestoAgotado: false, eventos: [] });
  });
});

describe('rastroDe — el registro por cliente', () => {
  it('un cliente sin rastro registrado devuelve el vacío, nunca undefined', () => {
    expect(rastroDe({})).toEqual(RASTRO_VACIO);
    expect(rastroDe(null)).toEqual(RASTRO_VACIO);
    expect(rastroDe(undefined)).toEqual(RASTRO_VACIO);
  });

  it('cada cliente lleva su propio rastro', () => {
    const a = {};
    const b = {};
    registrarRastro(a, { reintentos: 2, presupuestoAgotado: false, eventos: [] });
    registrarRastro(b, { reintentos: 0, presupuestoAgotado: false, eventos: [] });
    expect(rastroDe(a).reintentos).toBe(2);
    expect(rastroDe(b).reintentos).toBe(0);
  });
});
