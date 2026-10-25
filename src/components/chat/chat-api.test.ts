// ============================================================
// [INV-B10] chat-api.ts — qué se le dice a la persona ante cada fallo.
//
// LA PIEZA QUE ESTE ARCHIVO PROTEGE ES LA CONTABILIDAD. Se pidió que si un
// fallo consume una pregunta del techo, se le diga — «o descubrirá solo que
// perdió cuota». Decirlo SIEMPRE habría sido más simple y **falso en tres de
// los cuatro casos**: el techo se cobra antes de llamar al modelo, así que solo
// el 503 llegó a gastar. Un 429, un 400 y un fallo de red del navegador no
// cobraron nada — el último ni siquiera llegó al servidor.
//
// Afirmarle a alguien un consumo que no hubo es la misma clase de mentira que
// el resto del bloque persigue, solo que sobre su cuota en vez de sobre el
// inventario.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { preguntar, pedirIntencion } from './chat-api';

function servidor(status: number, cuerpo: unknown = {}) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(cuerpo), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('[INV-B10] chat-api · control positivo', () => {
  it('una respuesta buena llega entera', async () => {
    servidor(200, { tipo: 'no_se', mensaje: 'x', sabeHacer: ['a'] });
    const r = await preguntar('hola');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.respuesta.tipo).toBe('no_se');
  });

  it('NUNCA lanza: un chat que tumba la página sería peor que uno que no contesta', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('red caída'); }));
    await expect(preguntar('hola')).resolves.toMatchObject({ ok: false });
  });
});

// ============================================================
// LA CONTABILIDAD. Cada caso dice la verdad sobre si gastó.
// ============================================================
describe('[INV-B10] chat-api · quién consumió cuota y quién no', () => {
  it('503 SÍ consumió: el techo se cobró antes de llamar al modelo', async () => {
    servidor(503, { error: 'no_disponible', message: 'no pude consultar' });
    const r = await preguntar('hola');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fallo.consumioCuota).toBe(true);
    expect(r.fallo.reintentable).toBe(true);
  });

  it('la red del navegador NO consumió: la petición nunca llegó al servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const r = await preguntar('hola');
    if (r.ok) return;
    expect(r.fallo.consumioCuota).toBe(false);
    // Reintentable sí: el fallo puede ser pasajero.
    expect(r.fallo.reintentable).toBe(true);
  });

  it('429 NO consumió nada nuevo: justamente por eso se rechazó', async () => {
    servidor(429, { error: 'tope_alcanzado', message: 'Llegaste al máximo de 30 preguntas por hora.' });
    const r = await preguntar('hola');
    if (r.ok) return;
    expect(r.fallo.consumioCuota).toBe(false);
    // Y NO es reintentable: el techo no se libera por insistir, y decirlo evita
    // que la persona golpee el botón — que es justo lo que el techo frena.
    expect(r.fallo.reintentable).toBe(false);
    expect(r.fallo.mensaje).toContain('30');
  });

  const antesDelCobro: [string, number][] = [
    ['cuerpo inválido', 400],
    ['sin sesión', 401],
    ['origen ajeno', 403],
    ['sin llave en el servidor', 500],
  ];

  for (const [nombre, status] of antesDelCobro) {
    it(`${status} (${nombre}) NO consumió: sale antes del cobro`, async () => {
      servidor(status, { error: 'x', message: 'y' });
      const r = await preguntar('hola');
      if (r.ok) return;
      expect(r.fallo.consumioCuota).toBe(false);
    });
  }
});

describe('[INV-B10] chat-api · el atajo', () => {
  it('`pedirIntencion` manda la intención y NO una pregunta', async () => {
    const cuerpos: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        cuerpos.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ tipo: 'no_se', mensaje: 'x', sabeHacer: [] }), { status: 200 });
      }),
    );
    await pedirIntencion('llegada', { sku: 'SUJ500-F' });
    // [INV-B11] O6 · el `ambiente` viaja desde que existe el filtrado por
    // ambiente. Se compara el objeto ENTERO y no `toMatchObject` a propósito:
    // lo que esta prueba protege es que NO viaje nada más, y `toMatchObject`
    // dejaría pasar un campo nuevo sin decir nada.
    expect(cuerpos[0]).toEqual({ intencion: 'llegada', sku: 'SUJ500-F', ambiente: { ruta: '/' } });
  });

  it('los parámetros vacíos NO viajan: un `null` explícito es otra consulta', async () => {
    const cuerpos: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        cuerpos.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ tipo: 'no_se', mensaje: 'x', sabeHacer: [] }), { status: 200 });
      }),
    );
    await pedirIntencion('pipeline', { sku: null, termino: null });
    expect(cuerpos[0]).toEqual({ intencion: 'pipeline', ambiente: { ruta: '/' } });
  });
});

// ============================================================
// [INV-B11] O6 · EL AMBIENTE — lo que viaja, y sobre todo lo que NO.
//
// El brief lo puso así: **«Contexto de navegación del lado del SERVIDOR. No
// entra al prompt.»** Esta capa es la mitad del cliente, y su única
// responsabilidad es decir DÓNDE está el usuario. Todo lo demás —qué significa
// esa ruta, si ese SKU existe, si conviene usarlo— lo decide el servidor.
//
// Por eso lo que hay que vigilar aquí no es que mande algo, sino **que no
// mande de más**: ni el SKU ya resuelto, ni el título de la pantalla, ni la
// query, que puede llevar filtros que no son contexto de nadie.
// ============================================================
describe('[INV-B11] chat-api · el ambiente dice DÓNDE, no QUÉ', () => {
  function espiar() {
    const cuerpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        cuerpos.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ tipo: 'no_se', mensaje: 'x', sabeHacer: [] }), { status: 200 });
      }),
    );
    return cuerpos;
  }

  it('una pregunta de texto libre lleva la ruta', async () => {
    const cuerpos = espiar();
    await preguntar('¿cuánto hay?');
    expect(cuerpos[0]).toEqual({ pregunta: '¿cuánto hay?', ambiente: { ruta: '/' } });
  });

  it('el ambiente es SOLO el `pathname`: la query no viaja', async () => {
    // Una query puede llevar filtros, una página, un término de búsqueda. Nada
    // de eso es «dónde está parado quien pregunta», y mandarlo sería mandar
    // datos que después habría que justificar.
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/catalogo/KYA2490', search: '?marca=BRAND1&page=3', href: 'x' },
    });
    try {
      const cuerpos = espiar();
      await preguntar('¿cuánto hay?');
      const amb = cuerpos[0]!.ambiente as { ruta: string };
      expect(amb.ruta).toBe('/catalogo/KYA2490');
      expect(JSON.stringify(cuerpos[0]), 'se coló la query en el ambiente').not.toContain('marca=BRAND1');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('NO manda el SKU resuelto ni nada del DOM: el cliente no interpreta', async () => {
    // El control del invariante entero. Si algún día alguien «ayuda» mandando
    // el SKU ya resuelto, el cliente habría empezado a decidir — y la regla
    // del brief es que decide el servidor.
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/catalogo/KYA2490', search: '', href: 'x' },
    });
    try {
      const cuerpos = espiar();
      await preguntar('¿cuánto hay?');
      expect(Object.keys(cuerpos[0]!).sort()).toEqual(['ambiente', 'pregunta']);
      expect(Object.keys(cuerpos[0]!.ambiente as object)).toEqual(['ruta']);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
