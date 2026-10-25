// ============================================================
// [INV-B10] /api/chat — el gate, el techo y el atajo.
//
// LO QUE ESTE ARCHIVO PRUEBA Y LO QUE NO. Prueba el ORDEN de las decisiones de
// la ruta, que es donde vive casi todo su valor: que el techo se cobre antes de
// gastar, que el atajo no llame al modelo, que un fallo del modelo no se
// disfrace de respuesta. Lo que NO prueba es la RLS ni la función de la base:
// eso se mide contra Postgres en `scripts/chat-negativas.mjs`, porque un gate
// probado con dobles solo demuestra que los dobles hacen lo que se les dijo.
//
// CONTROLES POSITIVOS (§P19). Cada rechazo va acompañado de su caso que SÍ
// pasa. Sin eso, una ruta que devolviera 401 siempre —o que no existiera—
// pondría verdes todos los rechazos.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { TOPE_HORA, MAX_PREGUNTA } from '@/lib/chat/topes';
import { MAX_TURNO_HILO, TOPE_BYTES_HILO } from '@/lib/chat/hilo';
import { ErrorDelModelo } from '@/lib/chat/proveedor';
import { POST } from './route';

vi.mock('server-only', () => ({}));

const FAKE_USER = { id: 'user-1', email: 'kam@example.com' } as User;
let sessionUser: User | null = FAKE_USER;

/** Lo que devuelve `chat_registrar_pregunta`. Configurable por test. */
let veredicto: unknown = { permitido: true, id: 'fila-1' };
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const fakeDb = {
  auth: { getUser: () => Promise.resolve({ data: { user: sessionUser }, error: null }) },
  rpc: (fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    if (fn === 'chat_anotar_uso' || fn === 'chat_anotar_redaccion') {
      return Promise.resolve({ data: true, error: null });
    }
    return Promise.resolve({ data: veredicto, error: null });
  },
};

vi.mock('@/lib/supabase/session', () => ({ createSupabaseSessionClient: () => fakeDb }));

/** Cuántas veces se habló con el modelo. Es la aserción central del atajo. */
let llamadasAlModelo = 0;
let salidaDelModelo: unknown = { intencion: 'pipeline', sku: null, termino: null };
let lanzaElModelo: Error | null = null;

/**
 * [CHAT-B1] El doble se mudó de `modelo-openai` a `proveedor` porque la ruta
 * cambió de fábrica al entrar DeepSeek. **Este rojo fue deliberado y es la
 * prueba de que el doble seguía al código:** si el `vi.mock` hubiera apuntado a
 * un módulo que la ruta ya no importa, la suite habría llamado a la API REAL —
 * y sin llave eso sale 503, que es exactamente el rojo que se vio.
 *
 * `redactorDe` también se dobla, pero AQUÍ NO SE PUEDE CONTAR SUS LLAMADAS, y
 * conviene decir por qué en vez de dejar un contador muerto: este archivo dobla
 * `responder()` ENTERO, así que el redactor nunca llega a invocarse por este
 * camino. Que un clic en un chip no dispare una redacción sin registrar se
 * afirma donde sí se puede ver —`chat.service.test.ts`, sobre el registro del
 * falso— y aquí se afirma lo que SÍ es observable: que la ruta le pasa el
 * contexto al servicio y que anota lo que el servicio le devuelve.
 */
vi.mock('@/lib/chat/proveedor', async () => {
  const real = await vi.importActual<typeof import('@/lib/chat/proveedor')>('@/lib/chat/proveedor');
  return {
    ...real,
    clasificadorDe: () => ({
      nombre: 'proveedor-de-prueba/modelo-de-prueba',
      clasificar: async () => {
        llamadasAlModelo++;
        if (lanzaElModelo) throw lanzaElModelo;
        return { crudo: salidaDelModelo, uso: { entrada: 400, salida: 30 } };
      },
    }),
    redactorDe: () => ({
      nombre: 'proveedor-de-prueba/modelo-de-prueba',
      redactar: async () => ({ crudo: { tipo: 'no_esta' }, uso: { entrada: 3000, salida: 50 } }),
    }),
  };
});

const responderMock = vi.fn(async () => ({ tipo: 'no_se', mensaje: 'x', sabeHacer: ['a'] }));
vi.mock('@/services/chat.service', () => ({ responder: (...a: unknown[]) => responderMock(...(a as [])) }));



const ORIGEN = 'http://localhost:3000';
function pedir(cuerpo: unknown, opciones: { origen?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const origen = opciones.origen === undefined ? ORIGEN : opciones.origen;
  if (origen) headers.Origin = origen;
  return new Request(`${ORIGEN}/api/chat`, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
}

beforeEach(() => {
  sessionUser = FAKE_USER;
  veredicto = { permitido: true, id: 'fila-1' };
  salidaDelModelo = { intencion: 'pipeline', sku: null, termino: null };
  lanzaElModelo = null;
  llamadasAlModelo = 0;
  rpcCalls.length = 0;
  responderMock.mockClear();
  process.env.OPENAI_API_KEY = 'x'.repeat(40);
  // [CHAT-B1] El entorno de la MÁQUINA no puede decidir el resultado de una
  // prueba: con `DEEPSEEK_API_KEY` puesta, `getProveedorChat()` elegiría otro
  // proveedor y estas aserciones medirían otra cosa. Una variable de entorno es
  // otra copia, y cotejarla no detecta que esté de más.
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.CHAT_PROVEEDOR;
});

// ============================================================
// EL CONTROL POSITIVO, primero. Sin él, todos los rechazos de abajo salen
// verdes aunque la ruta no exista o devuelva 401 siempre.
// ============================================================
describe('[INV-B10] /api/chat · control positivo', () => {
  it('una pregunta válida con sesión válida responde 200', async () => {
    const res = await POST(pedir({ pregunta: '¿qué hay en aduana?' }));
    expect(res.status).toBe(200);
    expect(responderMock).toHaveBeenCalledOnce();
  });
});

describe('[INV-B10] /api/chat · el gate', () => {
  it('sin sesión: 401 y NO se habla con el modelo', async () => {
    sessionUser = null;
    const res = await POST(pedir({ pregunta: 'hola' }));
    expect(res.status).toBe(401);
    expect(llamadasAlModelo).toBe(0);
  });

  it('sin sesión tampoco se cobra techo: no hay a quién cobrarle', async () => {
    sessionUser = null;
    await POST(pedir({ pregunta: 'hola' }));
    expect(rpcCalls).toHaveLength(0);
  });

  it('origen ajeno: 403, y antes de todo lo demás', async () => {
    const res = await POST(pedir({ pregunta: 'hola' }, { origen: 'https://otro.example' }));
    expect(res.status).toBe(403);
    expect(llamadasAlModelo).toBe(0);
  });

  const cuerposMalos: [string, unknown][] = [
    ['vacío', {}],
    ['pregunta vacía', { pregunta: '   ' }],
    ['pregunta larguísima', { pregunta: 'x'.repeat(5000) }],
    ['intención inventada', { intencion: 'precio' }],
    ['las dos a la vez', { pregunta: 'hola', intencion: 'pipeline' }],
  ];

  for (const [nombre, cuerpo] of cuerposMalos) {
    it(`cuerpo inválido (${nombre}): 400 sin gastar nada`, async () => {
      const res = await POST(pedir(cuerpo));
      expect(res.status).toBe(400);
      expect(llamadasAlModelo).toBe(0);
      expect(rpcCalls).toHaveLength(0);
    });
  }
});

// ============================================================
// EL ORDEN ES EL MECANISMO. Si el techo se cobrara DESPUÉS de llamar al
// modelo, un usuario que ya topó seguiría gastando una llamada por intento: el
// bucle bloqueado seguiría pagando, que es justo lo que el techo impide.
// ============================================================
describe('[INV-B10] /api/chat · el techo se cobra ANTES de gastar', () => {
  it('con el techo alcanzado: 429 y CERO llamadas al modelo', async () => {
    veredicto = { permitido: false, motivo: 'tope_hora', tope: TOPE_HORA };
    const res = await POST(pedir({ pregunta: '¿qué hay en aduana?' }));
    expect(res.status).toBe(429);
    expect(llamadasAlModelo).toBe(0);
    expect(responderMock).not.toHaveBeenCalled();
  });

  it('el mensaje dice CUÁL techo y cuándo se libera, no un «límite alcanzado» a secas', async () => {
    veredicto = { permitido: false, motivo: 'tope_dia', tope: 150 };
    const res = await POST(pedir({ pregunta: 'hola' }));
    const body = (await res.json()) as { message?: string };
    expect(body.message).toContain('150');
    expect(body.message).toMatch(/mañana/i);
  });

  it('el cobro ocurre antes: la primera llamada a la base es la del techo', async () => {
    await POST(pedir({ pregunta: '¿qué hay en aduana?' }));
    expect(rpcCalls[0]!.fn).toBe('chat_registrar_pregunta');
  });

  it('sin la llave del modelo: `config_error`, y SIN cobrarle la cuota a nadie', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(pedir({ pregunta: 'hola' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('config_error');
    // Un servidor mal configurado no puede gastarle el techo a quien pregunta.
    expect(rpcCalls).toHaveLength(0);
  });
});

// ============================================================
// UNA PREGUNTA, UNA FILA. Llamar dos veces a la función de registro habría
// partido el techo efectivo a la mitad y contado el doble de preguntas.
// ============================================================
describe('[INV-B10] /api/chat · el registro', () => {
  it('el camino largo escribe UNA fila y luego la COMPLETA, no inserta otra', async () => {
    await POST(pedir({ pregunta: '¿qué hay en aduana?' }));
    const inserciones = rpcCalls.filter((c) => c.fn === 'chat_registrar_pregunta');
    const anotaciones = rpcCalls.filter((c) => c.fn === 'chat_anotar_uso');
    expect(inserciones).toHaveLength(1);
    expect(anotaciones).toHaveLength(1);
    expect(anotaciones[0]!.args.p_id).toBe('fila-1');
  });

  it('la anotación lleva los tokens REALES que reportó el modelo', async () => {
    await POST(pedir({ pregunta: '¿qué hay en aduana?' }));
    const anot = rpcCalls.find((c) => c.fn === 'chat_anotar_uso')!;
    expect(anot.args.p_tok_in).toBe(400);
    expect(anot.args.p_tok_out).toBe(30);
    expect(anot.args.p_intencion).toBe('pipeline');
  });
});

// ============================================================
// EL ATAJO. Enrutar por modelo algo cuyo destino ya está en el chip sería
// pagar ~3,6 s y una llamada por una respuesta que ya teníamos.
// ============================================================
describe('[INV-B10] /api/chat · el atajo de las sugerencias', () => {
  it('un clic en una sugerencia NO llama al modelo', async () => {
    const res = await POST(pedir({ intencion: 'pipeline' }));
    expect(res.status).toBe(200);
    expect(llamadasAlModelo).toBe(0);
  });

  it('pero SÍ se le cobra el techo: un chip repetido no es gratis para la base', async () => {
    await POST(pedir({ intencion: 'pipeline' }));
    expect(rpcCalls.filter((c) => c.fn === 'chat_registrar_pregunta')).toHaveLength(1);
  });

  it('su fila queda SIN modelo: es la verdad, no gastó tokens', async () => {
    await POST(pedir({ intencion: 'pipeline' }));
    const cobro = rpcCalls.find((c) => c.fn === 'chat_registrar_pregunta')!;
    expect(cobro.args.p_modelo).toBeNull();
    expect(cobro.args.p_intencion).toBe('pipeline');
    // Y no se anota nada después: no hay consumo que completar.
    expect(rpcCalls.filter((c) => c.fn === 'chat_anotar_uso')).toHaveLength(0);
  });

  it('el atajo transporta los parámetros del chip hasta el servicio', async () => {
    await POST(pedir({ intencion: 'llegada', sku: 'SUJ500-F' }));
    // [INV-B11] O6 · el TERCER argumento es el ambiente. Se asevera por
    // nombre y no con un `expect.anything()` de relleno: lo que hay que fijar
    // es que la ruta **llegue al servicio**, porque es ahí donde se decide qué
    // significa — el brief dice «del lado del SERVIDOR».
    expect(responderMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tipo: 'intencion', intencion: 'llegada', sku: 'SUJ500-F' }),
      null,
      // [CHAT-B1] El CUARTO argumento es el contexto de redacción. Se asevera
      // por nombre y no con un `expect.anything()` de relleno: lo que hay que
      // fijar es que la ruta le pasa al servicio **la pregunta del usuario** y
      // un registro donde anotar la factura — sin eso, el segundo escalón
      // gastaría sin dejar rastro y ninguna prueba se pondría roja.
      expect.objectContaining({ pregunta: expect.any(String), registro: expect.any(Object) }),
    );
  });
});

// ============================================================
// LO QUE EL MODELO DEVUELVE PASA POR EL ENRUTADOR, SIEMPRE.
// ============================================================
describe('[INV-B10] /api/chat · la salida del modelo no se cree a ciegas', () => {
  it('basura del modelo se convierte en «no sé», no en un 500', async () => {
    salidaDelModelo = { intencion: 'precio', sku: 42 };
    const res = await POST(pedir({ pregunta: 'cuánto cuesta' }));
    expect(res.status).toBe(200);
    // [INV-B11] O6 · el TERCER argumento es el ambiente. Se asevera por
    // nombre y no con un `expect.anything()` de relleno: lo que hay que fijar
    // es que la ruta **llegue al servicio**, porque es ahí donde se decide qué
    // significa — el brief dice «del lado del SERVIDOR».
    expect(responderMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tipo: 'no_soportado' }),
      null,
      expect.objectContaining({ pregunta: expect.any(String) }),
    );
  });

  // ============================================================
  // UN FALLO DE TRANSPORTE NO ES UN «NO SÉ». Si un parpadeo de red devolviera
  // la tarjeta de «no sé contestar eso», el sistema estaría culpando a su
  // comprensión de un problema de infraestructura: no dejó de entender, **no
  // llegó al modelo**. Es la misma confusión que O5 destapó un nivel más
  // arriba —«falta el SKU» leído como «no entiendo»— una capa más abajo.
  //
  // La fiabilidad observada no es hipotética: la evaluación de O5 midió un
  // pequeño porcentaje de llamadas caídas sin proponérselo.
  // ============================================================
  const modosDeFallo = ['sin_conexion', 'tiempo_agotado', 'rechazado', 'sin_contenido'] as const;

  for (const codigo of modosDeFallo) {
    it(`un fallo de transporte (${codigo}) NO se disfraza de «no sé»`, async () => {
      lanzaElModelo = new ErrorDelModelo(codigo, 'x');
      const res = await POST(pedir({ pregunta: 'hola' }));

      // 503, no 200: el cliente tiene que poder distinguir «reintenta» de
      // «esto no lo sé hacer».
      expect(res.status).toBe(503);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('no_disponible');

      // Y NADA de la forma del «no sé»: ni el tipo ni la lista de capacidades.
      expect(body.tipo).toBeUndefined();
      expect(body.sabeHacer).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/no sé contestar/i);

      // Ni se llegó a consultar el dato: no hay respuesta que dar.
      expect(responderMock).not.toHaveBeenCalled();
    });
  }

  it('el mensaje dice qué hacer (reintentar), no que no se entendió', async () => {
    lanzaElModelo = new ErrorDelModelo('sin_conexion', 'x');
    const res = await POST(pedir({ pregunta: 'hola' }));
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/vuelve a intentarlo/i);
    expect(body.message).not.toMatch(/no s[ée]/i);
  });

  // ============================================================
  // EL TECHO SE COBRA IGUAL ANTE UN FALLO, y es decisión con su precio dicho:
  // devolver la cuota exigiría BORRAR filas de `consumo_chat`, que es el
  // sustrato del techo — o sea abrir el único camino que permite REDUCIR el
  // consumo contado. Cambiar una propiedad de seguridad real por una de
  // justicia cosmética es mal negocio.
  // ============================================================
  it('la fila del techo se QUEDA aunque el modelo falle, y NO se borra ninguna', async () => {
    lanzaElModelo = new ErrorDelModelo('sin_conexion', 'no');
    await POST(pedir({ pregunta: 'hola' }));
    expect(rpcCalls.filter((c) => c.fn === 'chat_registrar_pregunta')).toHaveLength(1);
    // No existe ningún camino de devolución: si apareciera uno, esto se rompe.
    expect(rpcCalls.map((c) => c.fn)).not.toContain('chat_devolver_pregunta');
  });
});

// ============================================================
// [CHAT-B1] LA SEGUNDA LLAMADA, EL CHIP Y LOS DOS TECHOS DEL HILO.
//
// Lo que estas pruebas cuidan es la parte que NINGUNA otra capa puede ver:
// `route.test.ts` dobla `responder()` entero, así que el servicio no cuenta
// aquí. Lo que sí cuenta es lo que la ruta hace con lo que el servicio le
// devuelve — y el defecto más caro del bloque vivía justo ahí.
//
// EL DEFECTO, dicho para que no vuelva: `anotarUso` cuelga de `nombreModelo`,
// que **solo se llena en el camino largo**. Y `documental` ES uno de los diez
// chips (`sugerencias()` devuelve todas menos `capacidades`), medido el más
// clicado. Una redacción disparada desde un chip habría costado dinero
// y dejado la fila con `modelo` NULL y sin tokens — que es lo que la cabecera de
// `route.ts` declara como «la verdad: no gastó ninguno». Habría sido falso, y
// ninguna prueba se habría puesto roja.
// ============================================================

/** El doble del servicio, cuando hace falta que escriba en el registro que recibió. */
function responderQueRedacta(estado: string, uso: { entrada: number; salida: number } | null) {
  return async (...a: unknown[]) => {
    const ctx = a[3] as { registro: { estado: string; modelo: string | null; uso: unknown } } | undefined;
    if (ctx?.registro) {
      ctx.registro.estado = estado;
      ctx.registro.modelo = 'proveedor-de-prueba/modelo-de-prueba';
      ctx.registro.uso = uso;
    }
    return { tipo: 'no_se', mensaje: 'x', sabeHacer: ['a'] };
  };
}

describe('[CHAT-B1] el contexto de redacción llega al servicio', () => {
  it('el CHIP también lo lleva, con la pregunta del propio chip dentro', async () => {
    await POST(pedir({ intencion: 'documental', sku: 'KYA2490' }));

    const ctx = (responderMock.mock.calls[0] as unknown[])[3] as { pregunta: string; redactor: unknown };
    expect(ctx.pregunta).toContain('KYA2490');
    expect(ctx.redactor).not.toBeNull();
  });

  it('el camino largo lleva la pregunta que escribió el usuario', async () => {
    salidaDelModelo = { intencion: 'documental', sku: 'KYA2490', termino: null };
    await POST(pedir({ pregunta: '¿cuánto pesa el KYA2490?' }));

    const ctx = (responderMock.mock.calls[0] as unknown[])[3] as { pregunta: string };
    expect(ctx.pregunta).toBe('¿cuánto pesa el KYA2490?');
  });

  it('SIN llave no hay redactor, y el CHIP sigue contestando en 200', async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await POST(pedir({ intencion: 'pipeline' }));

    // Lo que esto fija: el `config_error` NO subió por encima de la bifurcación.
    // Hoy un servidor sin llave sirve los chips, y tiene que seguir sirviéndolos.
    expect(res.status).toBe(200);
    const ctx = (responderMock.mock.calls[0] as unknown[])[3] as { redactor: unknown };
    expect(ctx.redactor).toBeNull();
  });
});

describe('[CHAT-B1] G-9 · el techo sigue explicando la factura', () => {
  it('desde un CHIP, la redacción se anota aunque `modelo` del clasificador sea NULL', async () => {
    responderMock.mockImplementationOnce(responderQueRedacta('limpia', { entrada: 3111, salida: 77 }));
    await POST(pedir({ intencion: 'documental', sku: 'KYA2490' }));

    // El clasificador NO corrió: es un chip.
    expect(llamadasAlModelo).toBe(0);
    expect(rpcCalls.filter((c) => c.fn === 'chat_anotar_uso')).toHaveLength(0);

    // Pero la redacción SÍ se registró. Éste es el renglón que faltaba.
    const anot = rpcCalls.filter((c) => c.fn === 'chat_anotar_redaccion');
    expect(anot).toHaveLength(1);
    expect(anot[0].args).toMatchObject({
      p_id: 'fila-1',
      p_modelo: 'proveedor-de-prueba/modelo-de-prueba',
      p_estado: 'limpia',
      p_tok_in: 3111,
      p_tok_out: 77,
    });
  });

  it('las DOS llamadas van en columnas DISTINTAS, no sumadas', async () => {
    salidaDelModelo = { intencion: 'documental', sku: 'KYA2490', termino: null };
    responderMock.mockImplementationOnce(responderQueRedacta('limpia', { entrada: 3111, salida: 77 }));
    await POST(pedir({ pregunta: '¿cuánto pesa el KYA2490?' }));

    const uso = rpcCalls.find((c) => c.fn === 'chat_anotar_uso');
    const red = rpcCalls.find((c) => c.fn === 'chat_anotar_redaccion');

    // El clasificador: 400/30. El redactor: 3111/77. Sumarlas haría
    // incalculable cuál subió, y son dos precios distintos.
    expect(uso?.args).toMatchObject({ p_tok_in: 400, p_tok_out: 30 });
    expect(red?.args).toMatchObject({ p_tok_in: 3111, p_tok_out: 77 });
  });

  it('una redacción que se DESCARTÓ se registra igual: se pagó', async () => {
    responderMock.mockImplementationOnce(responderQueRedacta('sucia', { entrada: 3111, salida: 77 }));
    await POST(pedir({ intencion: 'documental', sku: 'KYA2490' }));

    const red = rpcCalls.find((c) => c.fn === 'chat_anotar_redaccion');
    expect(red?.args).toMatchObject({ p_estado: 'sucia', p_tok_in: 3111 });
  });

  it('si NO hubo intento, no se escribe un renglón de redacción', async () => {
    await POST(pedir({ intencion: 'pipeline' }));
    expect(rpcCalls.filter((c) => c.fn === 'chat_anotar_redaccion')).toHaveLength(0);
  });
});

describe('[CHAT-B1] GATE 2.5 · el hilo no excede sus dos techos', () => {
  const turnos = (n: number, texto = 'hola') =>
    Array.from({ length: n }, () => ({ quien: 'usuario' as const, texto }));

  it('seis turnos pasan', async () => {
    const res = await POST(pedir({ pregunta: 'hola', hilo: turnos(6) }));
    expect(res.status).toBe(200);
  });

  it('SIETE turnos: 400, y no un recorte callado', async () => {
    const res = await POST(pedir({ pregunta: 'hola', hilo: turnos(7) }));
    expect(res.status).toBe(400);
    // Y no le cobró el techo a nadie: el rechazo es de forma.
    expect(rpcCalls).toHaveLength(0);
  });

  it('🔴 CAMBIO DE CONTRATO EN B3 · pasarse de BYTES ya NO es 400: se PODA', async () => {
    // En B1 el peso del hilo se rechazaba. Eso funcionaba mientras todo turno lo
    // tecleara un usuario; desde B2 los turnos del ASISTENTE los escribe el
    // propio servidor, y devolverle 400 a alguien por el tamaño de una respuesta
    // que él no redactó no le dice nada que pueda hacer.
    //
    // Lo que SÍ se sigue rechazando es el NÚMERO —está justo debajo— porque eso
    // lo decide el cliente.
    const res = await POST(pedir({ pregunta: 'hola', hilo: turnos(2, 'x'.repeat(490)) }));
    expect(res.status).toBe(200);

    const pesado = Array.from({ length: 5 }, (_, i) => ({
      quien: 'usuario' as const,
      texto: String.fromCharCode(97 + i).repeat(500),
    }));
    const res2 = await POST(pedir({ pregunta: 'hola', hilo: pesado }));
    expect(res2.status).toBe(200);

    // Y lo que llegó al servicio está PODADO, no entero: el recorte es real.
    const ctx = (responderMock.mock.calls[responderMock.mock.calls.length - 1] as unknown[])[3] as {
      hilo: { texto: string }[];
    };
    const bytes = ctx.hilo.reduce((n, t) => n + Buffer.byteLength(t.texto, 'utf8'), 0);
    expect(bytes).toBeLessThanOrEqual(TOPE_BYTES_HILO);
  });

  it('sin hilo, todo sigue igual que antes del bloque', async () => {
    const res = await POST(pedir({ pregunta: 'hola' }));
    expect(res.status).toBe(200);
    const ctx = (responderMock.mock.calls[0] as unknown[])[3] as { hilo: unknown[] };
    expect(ctx.hilo).toEqual([]);
  });
});

// ============================================================
// [CHAT-B3] B3-1 · EL HILO NO PUEDE ENVENENARSE CON LO QUE EL ASISTENTE ESCRIBIÓ.
//
// EL DEFECTO, capturado crudo en QA manual:
//
//   HTTP 400 {"error":"invalid_body","issues":[{"code":"too_big",
//             "maximum":500,"path":["hilo",4,"texto"]}]}
//
// `route.ts` acotaba cada turno con `MAX_PREGUNTA` (500), que es el tope de lo
// que TECLEA el usuario. B2 metió turnos del ASISTENTE, y medido contra el
// redactor real **una parte notable de las respuestas pasa de 500**. O sea que
// esas respuestas documentales invalidaban el siguiente envío de su propia
// conversación — y no se recuperaba: hasta «gracias» daba 400.
//
// ⚠️ ESTE GATE CORRE SOBRE LA RUTA Y NO SOBRE `hilo.ts`, y ésa es toda su gracia.
// `hilo.ts` SÍ tenía topes y `recortarHilo` SÍ podaba; lo que fallaba era que
// **zod rechazaba el cuerpo antes de que el podador corriera**. El defecto vivía
// ENTRE los dos módulos, así que medir cualquiera de los dos por separado lo
// esconde — es P36 con otra ropa.
// ============================================================
describe('[CHAT-B3] B3-1 · el hilo no se envenena con lo que el Asistente escribió', () => {
  const turnoDe = (n: number): { quien: 'asistente'; texto: string } => ({
    quien: 'asistente',
    texto: 'x'.repeat(n),
  });

  it('CONTROL POSITIVO · el caso de prueba EJERCE el tope viejo, o no mide nada', () => {
    // 834 = un valor sobre el tope del usuario y bajo el del hilo, que es lo que el bloque exige que pase.
    // Si esto dejara de ser mayor que MAX_PREGUNTA, la prueba de abajo saldría
    // verde sin haber tocado el defecto — una guarda vacua.
    expect(834).toBeGreaterThan(MAX_PREGUNTA);
    expect(834).toBeLessThanOrEqual(MAX_TURNO_HILO);
  });

  it('un turno de asistente sobre el tope del usuario y bajo el del hilo (máx. medido + 20 %) ⇒ 200, no 400', async () => {
    const res = await POST(
      pedir({ pregunta: '¿y cuánto pesa?', hilo: [{ quien: 'usuario', texto: '¿qué es?' }, turnoDe(834)] }),
    );
    expect(res.status).toBe(200);
  });

  it('el MÁXIMO MEDIDO exacto también pasa — es una respuesta real', async () => {
    const res = await POST(pedir({ pregunta: 'sigue', hilo: [turnoDe(695)] }));
    expect(res.status).toBe(200);
  });

  it('⭐ y un turno ABSURDAMENTE largo tampoco da 400: el servidor PODA', async () => {
    // Ninguna de las dos rutas debe poder producir un 400 por el largo de una
    // respuesta que el propio sistema escribió. Por encima del tope se recorta,
    // no se rechaza — un 400 ahí no informa a nadie que pueda hacer algo.
    const res = await POST(pedir({ pregunta: 'sigue', hilo: [turnoDe(9_000)] }));
    expect(res.status).toBe(200);
  });

  it('pero el NÚMERO de turnos SIGUE rechazándose: esa regla no cambió', async () => {
    // El largo lo escribe el sistema; el número lo decide el cliente. Recortar el
    // número callado haría que el cliente creyera que mandó siete y el modelo
    // hubiera visto seis, que es la divergencia silenciosa que el rechazo evita.
    const siete = Array.from({ length: 7 }, () => ({ quien: 'usuario' as const, texto: 'hola' }));
    const res = await POST(pedir({ pregunta: 'hola', hilo: siete }));
    expect(res.status).toBe(400);
  });

  it('la conversación REAL del QA: tres intercambios con respuestas largas ⇒ los tres 200', async () => {
    // En QA manual falló el tercero (el hilo acumulado ya pasaba el tope). Aquí se
    // reproduce con turnos de asistente del tamaño medido.
    const hilo: { quien: 'usuario' | 'asistente'; texto: string }[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await POST(pedir({ pregunta: `pregunta ${i}`, hilo: [...hilo] }));
      expect(res.status, `el intercambio ${i + 1} devolvió ${res.status}`).toBe(200);
      hilo.push({ quien: 'usuario', texto: `pregunta ${i}` });
      hilo.push(turnoDe(631)); // largo típico alto (p90 medido)
    }
  });
});
