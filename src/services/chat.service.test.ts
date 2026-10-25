// ============================================================
// [INV-B10] chat.service — la rama que la QA manual destapó.
//
// POR QUÉ ESTE ARCHIVO EXISTE Y POR QUÉ ES ESTRECHO. `route.test.ts` prueba el
// ORDEN de la ruta y **dobla `responder`**, así que el servicio quedaba sin
// nadie que lo mirara. Esto no viene a cubrirlo entero: viene a cubrir el
// camino NUEVO, que es el único que no tenía prueba en ninguna capa.
//
// Y hay una razón concreta para que no sea solo la rama feliz. Al abrir
// `falta_verbo` se corre un riesgo real: **que el «no sé» que enumera se
// convierta en «elige una intención»**. Son cosas distintas —
//
//   «KL2722»                        →  nombró algo, no preguntó   →  ELEGIR
//   «¿cuánto cuesta el KL2722?»     →  preguntó algo que no sé    →  NO SÉ
//
// — y la segunda tiene que seguir ENUMERANDO, porque es donde el usuario
// aprende que el catálogo es cerrado. Si el arreglo se la comiera, el sistema
// dejaría de decir «de precios no sé» y respondería «¿qué quieres saber?»,
// que suena servicial y esconde el límite. Es la regla #5 por la puerta de
// atrás.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Decision } from '@/lib/chat/enrutador';
import { INTENCIONES } from '@/lib/chat/intenciones';
import { TOPE_EJEMPLOS } from '@/lib/chat/voz';
import type { ResultadoFicha } from './corpus-consulta.service';
// Estatico: `vi.mock` se iza, asi que no hace falta un import dinamico —y el
// top-level await es justo uno de los dos casos de este bloque donde `tsc`
// salio rojo con la suite verde.
import { responder, terminoDeLaPregunta, terminosDeLaPregunta, type ContextoRedaccion } from './chat.service';
import { redactorFalso, type ModoFalso, type RegistroFalso } from '@/lib/chat/redactor';
import { registroVacio } from '@/lib/chat/redaccion';

vi.mock('server-only', () => ({}));

/**
 * Un detalle COMPLETO, y no `{ sku }` a secas.
 *
 * La primera versión de este doble solo traía el SKU —bastaba para las pruebas
 * de `falta_verbo`, que no miran nada más—. Al escribir la cobertura de
 * despacho, la prueba se puso **roja por la razón equivocada**: reventaba en
 * `tarjetaLlegada` leyendo `embarques` de `undefined`, no en el `default` que
 * venía a cazar. Un doble demasiado delgado convierte una guarda en un
 * `TypeError` (P25 cara C).
 */
const DETALLE_BASE = {
  sku: 'KL2722',
  marca: 'BRAND1',
  familia_efectiva: 'CANDADOS',
  familias_efectivas: ['CANDADOS'],
  descr_efectiva: 'Series2 KEY 4000',
  original: { familia: 'CANDADOS', descr: 'Series2 KEY 4000' },
  stock: [],
  total: 0,
  reservado: 0,
  disponible: 0,
  sobre_reservado: false,
  reserva_descuadre: false,
  reservas: [],
  embarques: [],
  piezas_en_camino: 0,
  piezas_historial: 0,
  imagen_url: null,
  snapshot: { stock: null, aduana: null },
  decidido_en_bandeja: { marca: false },
};

/** El detalle que devuelve `getSkuDetalle`, o `null` si el SKU no existe. */
let detalle: { sku: string } | null = { ...DETALLE_BASE };
const getSkuDetalleMock = vi.fn(async () => detalle);

const PAGINA_VACIA = { items: [], total: 0, page: 1, pageSize: 50, totalPages: 0, facetas: {} };
const EMBARQUES_VACIOS = {
  snapshot: { id: 's', created_at: null, filas: null, archivo: null, vigente: true },
  items: [],
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0,
  resumen: { embarques: 0, piezas: 0, activos: 0, historial: 0, piezas_activas: 0, retrasados: 0 },
  facetas: {},
};

vi.mock('@/services/sku.service', () => ({
  getSkuDetalle: (...a: unknown[]) => getSkuDetalleMock(...(a as [])),
}));
// [CHAT-B1] Con nombre, porque la puerta 4 necesita configurarlo por prueba.
// Mismo molde que `getSkuDetalleMock`: el envoltorio evita el izado de `vi.mock`.
const listInventoryMock = vi.fn(async () => PAGINA_VACIA as unknown);
vi.mock('@/services/inventory.service', () => ({
  listInventory: (...a: unknown[]) => listInventoryMock(...(a as [])),
}));
vi.mock('@/services/embarques.service', () => ({ listEmbarques: vi.fn(async () => EMBARQUES_VACIOS) }));
vi.mock('@/services/vigente.service', () => ({ resolveVigentes: vi.fn(async () => ({ stock: null, aduana: null })) }));

// ============================================================
// [INV-B11] O6 · LOS DOBLES DE LAS CUATRO CONCEPTUALES.
//
// Con la misma lección que `DETALLE_BASE` de arriba, y no es teórica: un doble
// demasiado delgado hace que la guarda de despacho se ponga roja **en un
// `TypeError` dentro del constructor de tarjeta** en vez de en el `default`
// que viene a cazar. Rojo por la razón equivocada es P25 cara C.
//
// Por eso `construirCampana` devuelve la forma COMPLETA de `CampanaDTO` y no
// solo los dos campos que el despacho lee hoy: si mañana la tarjeta empezara a
// leer `pulso`, la prueba seguiría diciendo la verdad.
// ============================================================
const CAMPANA_VACIA = {
  pulso: { llegadas: [], movimientos: [], desde: null },
  avisos: [],
  nuevos: 0,
  seguidos: 0,
  preferencias: {
    av_estatus: false,
    av_disponible: false,
    av_reservado: false,
    av_llegada: true,
    preguntar_por_sku: false,
    boletin_correo: false,
    visto_hasta: null,
  },
  ultimas: [],
  calladas: [],
  correoCallado: null,
};
vi.mock('@/services/avisos.service', () => ({ construirCampana: vi.fn(async () => CAMPANA_VACIA) }));
vi.mock('@/services/proyectos.service', () => ({ listarProyectos: vi.fn(async () => []) }));
vi.mock('@/services/snapshots.service', () => ({
  listSnapshots: vi.fn(async () => ({
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
    vigentes: { stock: null, aduana: null },
  })),
}));

/**
 * Lo que devuelve `recuperarFicha`. Configurable por prueba.
 *
 * **`mensajeDe` y `causaNuestra` se dejan REALES a propósito.** Doblarlos
 * habría hecho que la prueba comprobara que mis dobles hacen lo que les dije,
 * en vez de que el servicio traduce bien los siete estados de O4. La
 * traducción es justo lo que este despacho aporta.
 */
const FICHA_BASE: Extract<ResultadoFicha, { tipo: 'ficha' }> = {
  tipo: 'ficha',
  sku: 'KYA2490',
  familia: 'VXQ',
  ruta: 'a/VXQ.md',
  titulo: 'VXQ',
  fuentePdf: 'Mkt/VXQ.pdf',
  commitSha: 'local-sin-git',
  revisada: false,
  trozos: [{ orden: 0, rutaSeccion: 'VXQ', texto: 'Contenido de la ficha.', tieneTabla: false }],
};
let fichaDe: ResultadoFicha = { ...FICHA_BASE };

/**
 * [INV-B11] O6 · lo que la PUERTA 2 recibió, y qué le devolvemos.
 *
 * `terminosVistos` es el corazón de la guarda de abajo: no basta con que el
 * despacho llame a la puerta 2, hay que ver **con qué la llama**. El defecto que
 * esto caza fue exactamente ése — llamaba, pero con «los CLIPS» sin pelar.
 */
const terminosVistos: (string | null)[] = [];
let porFamiliaDevuelve: ResultadoFicha | null = null;

/**
 * [INV-B11] O6 · lo que la PUERTA 3 recibió, y qué devuelve.
 *
 * El doble apareció porque **la puerta 3 ya se estaba ejerciendo**: al
 * enchufarla, dos pruebas de la puerta 2 reventaron con `db.rpc is not a
 * function`. Un doble que faltara habría sido la señal contraria —código
 * muerto—, así que el rojo fue información antes que estorbo.
 */
const busquedasVistas: string[] = [];
let busquedaDevuelve: { tipo: string; consulta?: string; docs?: unknown[]; detalle?: string } = {
  tipo: 'sin_hallazgos',
  consulta: '',
};
/** [CHAT-B4] Respuestas del corpus POR término. Lo que no esté aquí cae en `busquedaDevuelve`. */
const busquedaPorTermino = new Map<string, { tipo: string; consulta?: string; docs?: unknown[] }>();

vi.mock('./corpus-consulta.service', async () => {
  const real = await vi.importActual<typeof import('./corpus-consulta.service')>('./corpus-consulta.service');
  return {
    ...real,
    recuperarFicha: async () => fichaDe,
    recuperarFichaPorFamilia: async (_db: unknown, termino: string) => {
      terminosVistos.push(termino);
      return porFamiliaDevuelve;
    },
    buscarEnCorpus: async (_db: unknown, consulta: string) => {
      busquedasVistas.push(consulta);
      // [CHAT-B4] El relevo hace DOS intentos —el sujeto y, si queda vacío, la
      // familia—, así que el doble tiene que poder contestar distinto a cada
      // término. Con un único valor fijo los dos intentos serían
      // indistinguibles y el gate no podría ver cuál acertó: sería P19, una
      // guarda que no puede morder.
      return busquedaPorTermino.get(consulta) ?? busquedaDevuelve;
    },
  };
});

const db = {} as SupabaseClient;
const sabeHacer = INTENCIONES.map((i) => i.descripcion);

beforeEach(() => {
  detalle = { ...DETALLE_BASE };
  fichaDe = { ...FICHA_BASE };
  terminosVistos.length = 0;
  porFamiliaDevuelve = null;
  busquedasVistas.length = 0;
  busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: '' };
  busquedaPorTermino.clear();
  getSkuDetalleMock.mockClear();
  listInventoryMock.mockClear();
  listInventoryMock.mockImplementation(async () => PAGINA_VACIA as unknown);
});

describe('[INV-B10] responder · un SKU nombrado sin preguntar nada', () => {
  it('devuelve `elegir_intencion` en vez de negarle', async () => {
    const d: Decision = { tipo: 'no_soportado', motivo: 'falta_verbo', sabeHacer, sku: 'KL2722' };
    const r = await responder(db, d);
    expect(r.tipo).toBe('elegir_intencion');
    expect(r).toMatchObject({ sku: 'KL2722' });
  });

  // El SKU que sale es el CANÓNICO de la base, no el que escribió el usuario:
  // los botones lo llevan dentro y de ahí sale la siguiente consulta.
  it('el SKU que devuelve es el que la base reconoce, no el que se tecleó', async () => {
    detalle = { ...DETALLE_BASE };
    const d: Decision = { tipo: 'no_soportado', motivo: 'falta_verbo', sabeHacer, sku: '  kl2722  ' };
    const r = await responder(db, d);
    expect(r).toMatchObject({ tipo: 'elegir_intencion', sku: 'KL2722' });
    expect(getSkuDetalleMock).toHaveBeenCalledWith(db, 'KL2722');
  });

  // Un SKU alucinado no puede convertirse en tres botones que consultan la nada.
  it('un SKU que no existe NO se convierte en botones: se dice que no existe', async () => {
    detalle = null;
    const d: Decision = { tipo: 'no_soportado', motivo: 'falta_verbo', sabeHacer, sku: 'ZZZ-NO-EXISTE-999' };
    const r = await responder(db, d);
    expect(r.tipo).toBe('aclarar');
    expect(r).toMatchObject({ motivo: 'sin_coincidencias' });
  });
});

describe('[INV-B11] responder · TODA intención del catálogo se despacha', () => {
  // ============================================================
  // EL HUECO QUE ESTA PRUEBA CIERRA, y se escribió ANTES de abrirlo.
  //
  // `responder` despacha en dos `switch` —los que necesitan SKU y los que no— y
  // **los dos terminan en `default: noSe('No sé contestar eso.')`**. Ese default
  // nació como red defensiva, y hace bien su trabajo. Pero también significa
  // que **agregar una intención al catálogo sin despacharla no rompe nada**:
  //
  //   · `tsc` no se queja — el `default` cubre el caso
  //   · el prompt ya la ofrece, porque se pinta desde el catálogo
  //   · el zero-state ya la sugiere, por lo mismo
  //   · y el servicio contesta «no sé»
  //
  // O sea: **la interfaz anuncia una capacidad que el servidor no tiene.** Es
  // P7 y P24 a la vez, y llega gratis con el diseño que hace todo lo demás
  // barato — el catálogo como fuente única.
  //
  // La prueba recorre el catálogo REAL, así que crece sola.
  // ============================================================
  it('ninguna intención cae en el «no sé» genérico del `default`', async () => {
    expect(INTENCIONES.length, 'el catálogo está vacío: la prueba sería vacua').toBeGreaterThan(0);

    for (const i of INTENCIONES) {
      const d: Decision = {
        tipo: 'intencion',
        intencion: i.id,
        sku: i.requiereSku ? 'KL2722' : null,
        termino: i.requiereSku ? null : 'CLIPS',
      };
      const r = await responder(db, d);
      const cayoEnDefault = r.tipo === 'no_se' && r.mensaje === 'No sé contestar eso.';
      expect(cayoEnDefault, `«${i.id}» está en el catálogo y el servicio no la despacha`).toBe(false);
    }
  });
});

describe('[INV-B11] responder · el despacho documental NO colapsa los estados de O4', () => {
  const pedir = (): Decision => ({ tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null });

  it('con ficha devuelve una TARJETA, con el texto verbatim y la cita', async () => {
    const r = await responder(db, pedir());
    expect(r.tipo).toBe('tarjeta');
    if (r.tipo !== 'tarjeta') throw new Error('inalcanzable');
    expect(r.tarjeta.intencion).toBe('documental');
    expect(r.tarjeta.texto).toContain('Contenido de la ficha.');
    expect(r.tarjeta.fuentes[0]).toMatchObject({ tag: 'Ficha técnica', code: 'Mkt/VXQ.pdf' });
    // Sin revisar: la nota lo dice. Hoy las del puente están así.
    expect(r.tarjeta.nota).toContain('no revisa un humano');
  });

  it('sin `fuente_pdf` la cita DICE «sin PDF de origen», no se omite', async () => {
    fichaDe = { ...(fichaDe as Extract<ResultadoFicha, { tipo: 'ficha' }>), fuentePdf: null };
    const r = await responder(db, pedir());
    if (r.tipo !== 'tarjeta') throw new Error('esperaba tarjeta');
    expect(r.tarjeta.fuentes[0]!.code).toBe('sin PDF de origen');
  });

  // ============================================================
  // LA PRUEBA QUE PROTEGE O4 ENTERO. Traducir los siete estados a un solo
  // «no sé» habría deshecho el bloque anterior en una línea: el usuario
  // recibiría lo mismo si no hay ficha, si el corpus no está cargado o si la
  // consulta se cayó. `causaNuestra` es lo que impide que eso se pueda hacer
  // sin darse cuenta.
  // ============================================================
  it('un fallo NUESTRO llega a la interfaz marcado como nuestro', async () => {
    fichaDe = { tipo: 'corpus_vacio' };
    const r = await responder(db, pedir());
    expect(r.tipo).toBe('sin_documentacion');
    if (r.tipo !== 'sin_documentacion') throw new Error('inalcanzable');
    expect(r.causaNuestra, 'un pendiente nuestro llegó sin marcar y se leerá como un hecho').toBe(true);
    expect(r.mensaje).toContain('pendiente nuestro');
  });

  it('un hecho del catálogo llega SIN marcar como nuestro', async () => {
    fichaDe = { tipo: 'sin_ficha_confirmado', sku: 'KYA2490', familia: 'VXQ', notas: null };
    const r = await responder(db, pedir());
    if (r.tipo !== 'sin_documentacion') throw new Error('esperaba sin_documentacion');
    expect(r.causaNuestra).toBe(false);
  });

  it('NO se degrada a `no_se`: el sistema entendió la pregunta perfectamente', async () => {
    for (const estado of [
      { tipo: 'corpus_vacio' },
      { tipo: 'fallo_consulta', detalle: 'x' },
      { tipo: 'puente_colgante', sku: 'A', familia: 'F', ruta: 'r.md' },
      { tipo: 'sin_puente', sku: 'A', familia: 'F' },
      { tipo: 'sin_familia', sku: 'A' },
    ] as ResultadoFicha[]) {
      fichaDe = estado;
      const r = await responder(db, pedir());
      expect(r.tipo, `«${estado.tipo}» se degradó a «no sé»`).not.toBe('no_se');
    }
  });
});

describe('[INV-B10] responder · el «no sé» que enumera NO se perdió', () => {
  // ============================================================
  // ÉSTA ES LA GUARDA QUE JUSTIFICA EL ARCHIVO. Sin ella, ampliar `falta_verbo`
  // a cualquier `no_soportado` con SKU pasaría los tres tests de arriba y
  // rompería la regla #5 sin poner nada rojo.
  // ============================================================
  it('una pregunta fuera del catálogo sigue ENUMERANDO, no ofreciendo botones', async () => {
    // 🔴 CAMBIO DE CONTRATO EN B3-2 · el SUJETO de esta prueba no cambió —sigue
    // guardando que un `fuera_del_catalogo` ENUMERA en vez de ofrecer botones,
    // que es la regla #5 por la puerta de atrás— pero el NÚMERO sí.
    //
    // El contrato del asistente (docs/decisions/0009-grounded-assistant-persona-contract.md) lo prohíbe con esas palabras: «la lista completa sale donde
    // ZERO_STATE manda, y NO en cada fallo». El QA manual midió las once
    // viñetas en las TRES formas de fallo que probó. Ahora son TRES: bastan para
    // enseñar que el catálogo es cerrado, que era el trabajo de esta respuesta.
    const d: Decision = { tipo: 'no_soportado', motivo: 'fuera_del_catalogo', sabeHacer };
    const r = await responder(db, d);
    expect(r.tipo).toBe('no_se');
    if (r.tipo !== 'no_se') throw new Error('inalcanzable');

    // ENUMERA: no está vacío, y lo que trae son descripciones del catálogo.
    expect(r.sabeHacer.length).toBeGreaterThan(0);
    expect(r.sabeHacer.length).toBeLessThanOrEqual(TOPE_EJEMPLOS);
    const delCatalogo = INTENCIONES.map((i) => i.descripcion);
    for (const s of r.sabeHacer) expect(delCatalogo).toContain(s);

    // Y NO OFRECE BOTONES, que es lo que esta guarda vino a impedir.
    expect(r.tipo).not.toBe('elegir_intencion');
  });

  // «¿cuánto cuesta el KL2722?» lleva SKU y lleva verbo, y el verbo no está en
  // el catálogo. El modelo manda `sku: null` por la regla 5 del prompt; si un
  // día lo mandara, `falta_verbo` no debe dispararse por el mero hecho de que
  // venga un SKU.
  it('`respuesta_ilegible` no se convierte en botones aunque traiga SKU', async () => {
    const d: Decision = { tipo: 'no_soportado', motivo: 'respuesta_ilegible', sabeHacer, sku: 'KL2722' };
    const r = await responder(db, d);
    expect(r.tipo).toBe('no_se');
    expect(getSkuDetalleMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// [INV-B11] O6 · PUERTA 2 — lo que se le pasa, no solo que se la llame.
//
// ESTA GUARDA NACE DE UN DEFECTO QUE SOLO VIO LA QA EN VIVO. La puerta 2
// funcionaba contra la base —su arnés daba todo verde— y en el navegador
// «¿qué dice la ficha técnica de los CLIPS?» seguía cayendo en la
// desambiguación de decenas de SKU.
//
// La causa: **el modelo devuelve el término CON ARTÍCULO** («los CLIPS»), y eso
// ya estaba medido y escrito veinte líneas más abajo en `chat.service.ts` para
// la búsqueda por nombre. El arnés no lo vio porque le pasaba nombres de
// familia ya limpios: probaba la función, no el camino.
//
// Por eso lo que se comprueba aquí es **el argumento**, no el efecto. «Se llamó
// a la puerta 2» habría estado verde con el defecto puesto.
// ============================================================
describe('[INV-B11] responder · la puerta 2 recibe el término PELADO', () => {
  it('«los CLIPS» llega a la puerta 2 como «CLIPS», sin el artículo', async () => {
    porFamiliaDevuelve = null; // no es familia → sigue por el SKU, da igual aquí
    await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'los CLIPS' });
    expect(terminosVistos, 'la puerta 2 no se llamó').toHaveLength(1);
    expect(terminosVistos[0], 'el término llegó con artículo y `ilike` no casaría').toBe('CLIPS');
  });

  it('varias formas de nombrar la misma familia llegan igual', async () => {
    for (const crudo of ['los CLIPS', 'el CLIPS', '«CLIPS»', 'CLIPS?', '  CLIPS  ']) {
      terminosVistos.length = 0;
      await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: crudo });
      expect(terminosVistos[0], `«${crudo}» no se peló a CLIPS`).toBe('CLIPS');
    }
  });

  it('con SKU escrito la puerta 2 NO se consulta: el código manda', async () => {
    // El control del lado contrario. Si la puerta 2 corriera también con un SKU
    // presente, una familia que se llamara igual que un código secuestraría la
    // pregunta.
    await responder(db, { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null });
    expect(terminosVistos, 'la puerta 2 se metió en una pregunta que traía SKU').toHaveLength(0);
  });

  it('las OTRAS intenciones no pasan por la puerta 2: sus cifras sí cambian por SKU', async () => {
    for (const intencion of ['llegada', 'disponibilidad', 'clasificacion'] as const) {
      terminosVistos.length = 0;
      await responder(db, { tipo: 'intencion', intencion, sku: null, termino: 'los CLIPS' });
      expect(terminosVistos, `«${intencion}» se coló por la puerta 2`).toHaveLength(0);
    }
  });

  it('si la familia SÍ tiene ficha, contesta con ella y NO desambigua SKU', async () => {
    // El control positivo del conjunto: sin esto, un `recuperarFichaPorFamilia`
    // que devolviera siempre `null` dejaría todo lo de arriba en verde y la
    // puerta 2 no serviría para nada.
    porFamiliaDevuelve = { ...FICHA_BASE, sku: null, familia: 'CLIPS' };
    const r = await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'los CLIPS' });
    expect(r.tipo, 'la puerta 2 no entregó la ficha').toBe('tarjeta');
    expect(r.tipo === 'tarjeta' && r.tarjeta.datos.some((d) => d.valor === 'CLIPS')).toBe(true);
  });
});

// ============================================================
// [INV-B11] O6 · PUERTA 3 — el último intento, y solo donde no había nada.
//
// LO QUE HAY QUE PROTEGER AQUÍ NO ES QUE FUNCIONE: es **dónde entra**. La
// puerta 3 se suma a las otras dos, no las sustituye, y el orden es lo único
// que lo garantiza:
//
//   sku resoluble        →  ficha del SKU        (no llega a la puerta 3)
//   término = familia    →  ficha de la familia  (no llega)
//   ni uno ni otro       →  PUERTA 3
//   y sin hallazgos      →  la respuesta original, que sigue siendo la verdad
//
// Puesta antes, una pregunta con SKU resoluble se contestaría con fragmentos
// sueltos en vez de con su ficha — estrictamente peor, y en verde.
// ============================================================
describe('[INV-B11] responder · la puerta 3 entra al final, no al principio', () => {
  it('con SKU resoluble NO se busca en el corpus: la ficha gana', async () => {
    await responder(db, { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null });
    expect(busquedasVistas, 'la puerta 3 se metió delante de una ficha resoluble').toHaveLength(0);
  });

  it('si la FAMILIA resuelve, tampoco: la ficha de la familia gana', async () => {
    porFamiliaDevuelve = { ...FICHA_BASE, sku: null, familia: 'CLIPS' };
    await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'los CLIPS' });
    expect(busquedasVistas, 'la puerta 3 se metió delante de una ficha de familia').toHaveLength(0);
  });

  it('sin SKU y sin familia SÍ busca, y con el término PELADO', async () => {
    // El control positivo del conjunto: sin esto, las dos de arriba estarían
    // verdes con la puerta 3 desconectada del todo.
    detalle = null; // el SKU no existe → `resolverSku` devuelve una respuesta
    await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'los clips' });
    expect(busquedasVistas, 'la puerta 3 no se consultó donde no había nada más').toHaveLength(1);
    expect(busquedasVistas[0], 'la consulta llegó con artículo').toBe('clips');
  });

  it('con hallazgos contesta con ellos y NO con la desambiguación', async () => {
    detalle = null;
    busquedaDevuelve = {
      tipo: 'hallazgos',
      consulta: 'clip',
      // [CHAT-B2] La ruta se mudó DENTRO del perímetro. El sujeto de esta
      // prueba —«la puerta 3 contesta con hallazgos»— no cambió; lo que cambió
      // es una precondición nueva y ortogonal: desde B2, un documento fuera del
      // perímetro no se nombra. Con la ruta vieja esto medía el filtro nuevo en
      // vez de la puerta 3.
      docs: [{ ruta: '20_Seguridad/Glosario.md', titulo: 'Glosario', fuentePdf: null, fragmentos: [{ seccion: 'C', texto: 'Un clip es…' }] }],
    };
    const r = await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'clip' });
    expect(r.tipo).toBe('tarjeta');
    expect(r.tipo === 'tarjeta' && r.tarjeta.titulo).toContain('Lo que encontré sobre');
  });

  it('🔴 CAMBIO DE CONTRATO EN B3 · SIN hallazgos Y SIN candidatos ya NO es «aclarar»', async () => {
    // La intención original sigue valiendo: si la respuesta previa era una
    // DESAMBIGUACIÓN, la puerta 3 no debe empeorarla — y no lo hace, hay una
    // prueba de eso en B3-5.
    //
    // Lo que cambió es el caso de CERO candidatos. Ahí «no encuentro ningún SKU
    // que se llame X» era cierto y era la MITAD: también se había mirado el
    // corpus y tampoco había nada, y el usuario no tenía forma de saberlo.
    // Medido con «¿qué es un SIP?», que acertaba sin saber por qué.
    detalle = null;
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'clip' };
    const r = await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'clip' });
    expect(r.tipo).toBe('no_se');
    expect(r.tipo === 'no_se' && r.mensaje).toContain('ni ficha ni SKU');
  });

  it('un corpus VACÍO no se disfraza de «no encontré nada sobre tu producto»', async () => {
    // La regla de O4 aplicada a la búsqueda: un pendiente NUESTRO no se lee
    // como un hecho sobre lo que preguntó.
    detalle = null;
    busquedaDevuelve = { tipo: 'corpus_vacio' };
    const r = await responder(db, { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'clip' });
    expect(r.tipo).toBe('sin_documentacion');
    expect(r.tipo === 'sin_documentacion' && r.causaNuestra, 'un corpus vacío se cargó a la cuenta del usuario').toBe(
      true,
    );
  });

  it('las OTRAS intenciones no llegan a la puerta 3: no son preguntas de documento', async () => {
    detalle = null;
    for (const intencion of ['llegada', 'disponibilidad', 'clasificacion'] as const) {
      busquedasVistas.length = 0;
      await responder(db, { tipo: 'intencion', intencion, sku: null, termino: 'clip' });
      expect(busquedasVistas, `«${intencion}» se coló por la puerta 3`).toHaveLength(0);
    }
  });
});

// ============================================================
// [INV-B11] O6 · EL AMBIENTE, en el despacho.
//
// La regla pura vive en `ambiente.test.ts` y se prueba sin base. Lo que se
// prueba AQUI es el cableado, que es lo que la regla sola no garantiza: que el
// SKU del ambiente llegue a `getSkuDetalle` -o sea, que se COMPRUEBE contra el
// catalogo como cualquier otro-- y que la respuesta DIGA que fue el ambiente
// quien decidio.
//
// Lo segundo no estaba en el brief y es lo que impide el dano: cifras exactas
// de un SKU que nadie nombro, sin avisar, es la misma clase de dano que
// adivinar entre decenas de candidatos -- solo que mas convincente, porque acerto.
// ============================================================
describe('[INV-B11] responder · el ambiente rellena, y lo dice', () => {
  const AMBIENTE = { ruta: '/catalogo/KL2722' };

  it('«¿cuanto hay?» en una ficha se contesta sobre ESA ficha', async () => {
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: null },
      AMBIENTE,
    );
    expect(r.tipo, 'sin ambiente esto contestaba «necesito saber de que SKU hablas»').toBe('tarjeta');
    expect(getSkuDetalleMock, 'el SKU del ambiente no paso por el catalogo').toHaveBeenCalled();
  });

  it('y la respuesta AVISA de que decidio el ambiente', async () => {
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: null },
      AMBIENTE,
    );
    // [CHAT-B4] CAMBIO DE CONTRATO: el aviso pasó de `nota` a `aviso`, y no es
    // cosmético. `nota` vive dentro del `<details>` que B2 pliega en cuanto hay
    // prosa: para esta tarjeta de inventario daba igual —no lleva prosa, el
    // detalle va abierto—, pero la MISMA llamada envuelve también la documental,
    // que sí la lleva. Ahí «contesté sobre el SKU que venías viendo»
    // desaparecía de la pantalla justo donde más falta hace saberlo.
    expect(r.tipo === 'tarjeta' && r.tarjeta.aviso, 'la tarjeta no dice sobre que SKU contesto').toContain('KL2722');
  });

  it('sin ambiente, la conducta de antes NO cambia', async () => {
    // El control del lado contrario. Si el ambiente se inventara un SKU cuando
    // no lo hay, esto contestaria una tarjeta en vez de pedir aclaracion.
    const r = await responder(db, { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: null });
    expect(r.tipo).toBe('aclarar');
    expect(r.tipo === 'aclarar' && r.motivo).toBe('falta_sku');
  });

  it('una pantalla SIN SKU no aporta contexto: una lista no es un contexto', async () => {
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: null },
      { ruta: '/catalogo' },
    );
    expect(r.tipo, 'el catalogo entero aporto un SKU, y ahi hay cientos').toBe('aclarar');
  });

  it('si el usuario DIJO algo, el ambiente no lo corrige', async () => {
    // La linea entre «ayudar» y «cambiarle la pregunta a la gente»: alguien en
    // la ficha de KL2722 que pregunta por los CLIPS pregunta por los CLIPS.
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: 'CLIPS' },
      AMBIENTE,
    );
    // [CHAT-B4] Se mira `aviso`, que es donde vive ahora. Dejarlo en `nota`
    // habría convertido esta guarda en una que NO PUEDE MORDER —P19, y van
    // ocho—: verde para siempre porque el campo que vigila ya no recibe nada.
    expect(
      r.tipo === 'tarjeta' && r.tarjeta.aviso,
      'el ambiente se metio donde el usuario ya habia dicho',
    ).not.toContain('KL2722');
  });

  it('con SKU escrito, el ambiente tampoco manda', async () => {
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: 'SUJ500-F', termino: null },
      AMBIENTE,
    );
    expect(r.tipo === 'tarjeta' && r.tarjeta.aviso ? r.tarjeta.aviso : '').not.toContain('KL2722');
  });

  it('un SKU de una ruta INVENTADA no se cuela: pasa por el catalogo', async () => {
    // La ruta la escribe el navegador, pero un navegador es de quien pregunta.
    // `/catalogo/LO-QUE-SEA` tiene que morir en la comprobacion como cualquier
    // SKU tecleado.
    detalle = null;
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'disponibilidad', sku: null, termino: null },
      { ruta: '/catalogo/NO-EXISTE-999' },
    );
    expect(r.tipo).toBe('aclarar');
    expect(r.tipo === 'aclarar' && r.motivo).toBe('sin_coincidencias');
  });
});

// ============================================================
// [CHAT-B1] EL CAMINO NUEVO — y lo que estas pruebas cuidan no es la prosa: es
// el PERÍMETRO y el ALCANCE.
//
// Sin `ctx` nada de esto ocurre y `responder()` se comporta exactamente como
// antes del bloque: por eso las 30 pruebas de arriba siguieron verdes sin tocar
// ni una. Eso es bueno y es insuficiente — un camino que ninguna prueba recorre
// es P24, la media función que se ve igual que la completa. Aquí se recorre.
// ============================================================

const ctxCon = (modo: ModoFalso, registro: RegistroFalso, pregunta = '¿cuánto pesa?'): ContextoRedaccion => ({
  redactor: redactorFalso(modo, { registro, uso: { entrada: 3_111, salida: 77 } }),
  pregunta,
  hilo: [],
  limite: null,
  registro: registroVacio(),
});

const DENTRO = '20_Seguridad/VXQ.md';

describe('[CHAT-B1] la ficha por SKU se lee y se contesta', () => {
  it('con un redactor fiel, la tarjeta trae PROSA y su cita', async () => {
    fichaDe = {
      ...FICHA_BASE,
      ruta: DENTRO,
      trozos: [{ orden: 0, rutaSeccion: 'Peso', texto: 'Peso del equipo: 3.2 kg.', tieneTabla: false }],
    };
    const reg: RegistroFalso = { peticiones: [] };

    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', reg),
    );

    expect(r.tipo).toBe('tarjeta');
    if (r.tipo !== 'tarjeta') return;
    expect(r.tarjeta.respuesta).not.toBeNull();
    expect(r.tarjeta.respuesta!.ruta).toBe(DENTRO);
    expect(r.tarjeta.respuesta!.frases.length).toBeGreaterThan(0);
  });

  it('EL VERBATIM SIGUE AHÍ: la prosa no lo sustituye', async () => {
    fichaDe = { ...FICHA_BASE, ruta: DENTRO };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.texto).toContain('Contenido de la ficha.');
  });

  it('con la guarda MORDIDA se cae al verbatim y la tarjeta NO trae prosa', async () => {
    fichaDe = { ...FICHA_BASE, ruta: DENTRO };
    const ctx = ctxCon('dato_inventado', { peticiones: [] });
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctx,
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.respuesta).toBeNull();
    expect(r.tarjeta.texto).toContain('Contenido de la ficha.');
    expect(ctx.registro.estado).toBe('sucia');
  });

  it('un «no esta» honesto se DICE en la nota, con el verbatim debajo', async () => {
    fichaDe = { ...FICHA_BASE, ruta: DENTRO };
    const ctx = ctxCon('no_esta', { peticiones: [] });
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctx,
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.nota).toContain('no está en la ficha');
    expect(r.tarjeta.texto).toContain('Contenido de la ficha.');
    expect(ctx.registro.estado).toBe('no_esta');
  });
});

describe('[CHAT-B1] EL PERIMETRO, contra el camino servido', () => {
  it('una ficha de `10_Cuentas` NO cruza — y el estado lo dice', async () => {
    fichaDe = { ...FICHA_BASE, ruta: '10_Cuentas/ACME.md' };
    const reg: RegistroFalso = { peticiones: [] };
    const ctx = ctxCon('fiel', reg);
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctx,
    );

    expect(reg.peticiones).toHaveLength(0);
    expect(ctx.registro.estado).toBe('fuera_del_perimetro');
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.respuesta).toBeNull();
    // Y AUN ASI CONTESTA: el verbatim de siempre. El perimetro no rompe nada.
    expect(r.tarjeta.texto).toContain('Contenido de la ficha.');
  });

  it('la ruta por omision de los fixtures viejos («a/VXQ.md») tampoco cruza', async () => {
    const reg: RegistroFalso = { peticiones: [] };
    await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', reg),
    );
    expect(reg.peticiones).toHaveLength(0);
  });
});

describe('[CHAT-B1] GATE 2.3 · las intenciones NO documentales no llegan al redactor', () => {
  const NO_DOCUMENTALES = [
    'mis_proyectos',
    'pipeline',
    'disponibilidad',
    'buscar_por_nombre',
    'sobre_reservados',
    'llegada',
    'clasificacion',
    'capacidades',
    'destacado_hoy',
    'snapshots_recientes',
  ] as const;

  it('ENUMERADAS A MAQUINA desde el catalogo: son todas menos `documental`', () => {
    const delCatalogo = INTENCIONES.map((i) => i.id)
      .filter((id) => id !== 'documental')
      .sort();
    expect([...NO_DOCUMENTALES].sort()).toEqual(delCatalogo);
  });

  for (const intencion of NO_DOCUMENTALES) {
    it(`«${intencion}» deja el registro del redactor VACIO`, async () => {
      fichaDe = { ...FICHA_BASE, ruta: DENTRO };
      const reg: RegistroFalso = { peticiones: [] };
      const ctx = ctxCon('fiel', reg);
      await responder(db, { tipo: 'intencion', intencion, sku: 'KYA2490', termino: 'clip' }, null, ctx);

      expect(reg.peticiones).toHaveLength(0);
      expect(ctx.registro.estado).toBe('sin_intento');
      expect(ctx.registro.uso).toBeNull();
    });
  }
});

describe('[CHAT-B1] los hallazgos tambien contestan, citando UN documento', () => {
  it('la prosa cita el MEJOR documento, no los cuatro de la lista', async () => {
    fichaDe = { tipo: 'sin_puente', sku: 'X', familia: 'SERIES11 FLOOR' };
    busquedaDevuelve = {
      tipo: 'hallazgos',
      consulta: 'SERIES11 FLOOR',
      docs: [
        {
          ruta: '20_Seguridad/Series11.md',
          titulo: 'Series11',
          fuentePdf: 'series11.pdf',
          rango: 0.9,
          trozosTotales: 25,
          fragmentos: [{ seccion: 'Peso', texto: 'Peso: 3.2 kg.' }],
        },
        {
          ruta: '20_Seguridad/Otro.md',
          titulo: 'Otro',
          fuentePdf: null,
          rango: 0.1,
          trozosTotales: 3,
          fragmentos: [{ seccion: 'X', texto: 'otra cosa' }],
        },
      ],
    };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'X', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.respuesta!.ruta).toBe('20_Seguridad/Series11.md');
    // Y EL CAMINO ES PARCIAL, que es la verdad: vimos 1 fragmento de 25 trozos.
    expect(r.tarjeta.respuesta!.camino).toBe('parcial');
    expect(r.tarjeta.respuesta!.seccionesTotales).toBe(25);
  });

  it('🔴 CAMBIO DE CONTRATO EN B2 · un hallazgo fuera del perímetro NI SE NOMBRA', async () => {
    fichaDe = { tipo: 'sin_puente', sku: 'X', familia: 'F' };
    busquedaDevuelve = {
      tipo: 'hallazgos',
      consulta: 'F',
      docs: [
        {
          ruta: '10_Cuentas/ACME.md',
          titulo: 'ACME',
          fuentePdf: null,
          rango: 0.9,
          trozosTotales: 5,
          fragmentos: [{ seccion: 'S', texto: 'datos del cliente' }],
        },
      ],
    };
    const reg: RegistroFalso = { peticiones: [] };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'X', termino: null },
      null,
      ctxCon('fiel', reg),
    );

    // EN CHAT-B1 esta prueba afirmaba «y la lista se enseña igual»: el contenido
    // no cruzaba al modelo, pero el TÍTULO del documento sí se pintaba. El QA
    // manual lo encontró en la interfaz real — preguntando por una antena, la
    // respuesta listó «Índice de Cuentas por Sector».
    //
    // Nombrar un documento ya filtra que EXISTE, aunque su contenido no salga.
    // Desde B2 se trata como «no hay», y no como «hay pero no te lo doy»: lo
    // segundo confirma su existencia y además abre el bucle que el QA midió
    // —ofrece, pides, no entrega, vuelve a ofrecer.
    expect(reg.peticiones).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('ACME');
    expect(JSON.stringify(r)).not.toContain('10_Cuentas');

    // ────────────────────────────────────────────────────────
    // [CHAT-B4] 🔴 CAMBIO DE CONTRATO, Y LA PRUEBA SE ENDURECE EN VEZ DE
    // AFLOJARSE. Esta prueba exigía `no_se`, y ahora sale `sin_documentacion`.
    //
    // No es que el arreglo la rompiera: es que el `no_se` de antes DELATABA.
    // En este mismo camino, un corpus que no devolvía NADA caía en
    // `sin_documentacion`, y uno que devolvía algo y el perímetro se lo comía
    // caía en `no_se`. O sea que **el TIPO de la respuesta distinguía «no hay»
    // de «hay y no te lo doy»** — justo lo que el párrafo de arriba dice que no
    // puede pasar, filtrado por una puerta que nadie miró: la del tipo.
    //
    // Ahora las dos rutas terminan igual, y eso es lo que se afirma: la
    // respuesta con un documento vedado tiene que ser INDISTINGUIBLE de la
    // respuesta sin ningún documento.
    // ────────────────────────────────────────────────────────
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'F' };
    const sinNada = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'X', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );
    expect(r.tipo).toBe(sinNada.tipo);
    expect(JSON.stringify(r)).toBe(JSON.stringify(sinNada));
  });
});

describe('[CHAT-B1] la factura sube por el canal explicito', () => {
  it('el uso del redactor llega al registro que el llamador lee', async () => {
    fichaDe = { ...FICHA_BASE, ruta: DENTRO };
    const ctx = ctxCon('fiel', { peticiones: [] });
    await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctx,
    );
    expect(ctx.registro.uso).toEqual({ entrada: 3_111, salida: 77 });
    expect(ctx.registro.modelo).toBe('falso');
  });

  it('y tambien cuando la redaccion se DESCARTA: se pago igual', async () => {
    fichaDe = { ...FICHA_BASE, ruta: DENTRO };
    const ctx = ctxCon('dato_inventado', { peticiones: [] });
    await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctx,
    );
    expect(ctx.registro.estado).toBe('sucia');
    expect(ctx.registro.uso).toEqual({ entrada: 3_111, salida: 77 });
  });
});
describe('[CHAT-B1] terminoDeLaPregunta', () => {
  it('se queda con lo que nombra algo y tira las palabras vacías', () => {
    expect(terminoDeLaPregunta('¿qué onda con los candados conectados?')).toContain('candados');
  });

  it('una pregunta que es sólo palabras vacías no da término', () => {
    expect(terminoDeLaPregunta('¿y eso qué es?')).toBeNull();
  });

  it('sin pregunta no hay término — es el caso del atajo de chip', () => {
    expect(terminoDeLaPregunta(null)).toBeNull();
  });

  it('devuelve VARIOS candidatos, del más preciso al más amplio', () => {
    // MEDIDO: `plainto_tsquery` es un AND. Tres palabras juntas no dan
    // ningún trozo contra un corpus real; «cerraduras» sola da varios. Una sola consulta
    // era la razón por la que la puerta 4 no ofrecía nada en vivo, con el gate
    // en verde — porque el fixture le daba el término ya limpio (P26).
    const c = terminosDeLaPregunta('¿qué onda con las cerraduras inteligentes?');
    expect(c.length).toBeGreaterThan(1);
    expect(c[0].split(' ').length).toBeGreaterThan(c[c.length - 1].split(' ').length);
    expect(c.some((x) => x === 'cerraduras')).toBe(true);
  });

  it('nunca más de tres consultas: la puerta 4 no puede volverse cara', () => {
    expect(terminosDeLaPregunta('alfa bravo charlie delta echo foxtrot golf').length).toBeLessThanOrEqual(3);
  });
});

describe('[CHAT-B1] PUERTA 4 · se OFRECE antes de rendirse', () => {
  const fuera: Decision = { tipo: 'no_soportado', motivo: 'fuera_del_catalogo', sabeHacer };

  it('sin `ctx` se comporta como ANTES del bloque: «no sé» que enumera', async () => {
    const r = await responder(db, fuera);
    expect(r.tipo).toBe('no_se');
  });

  it('con candidatos del catálogo, los OFRECE en vez de enumerar el catálogo', async () => {
    listInventoryMock.mockResolvedValue({
      ...PAGINA_VACIA,
      items: [
        { sku: 'M803', descr_efectiva: 'Electronic Lock Plunger' },
        { sku: 'C449', descr_efectiva: 'Electronic Lock Cam' },
      ],
    });
    const r = await responder(db, fuera, null, ctxCon('fiel', { peticiones: [] }, '¿tienen cerraduras inteligentes?'));

    expect(r.tipo).toBe('aclarar');
    if (r.tipo !== 'aclarar') return;
    expect(r.candidatos.map((c) => c.sku)).toEqual(['M803', 'C449']);
  });

  it('con UN solo candidato lo nombra, en vez de dar una lista de uno', async () => {
    listInventoryMock.mockResolvedValue({
      ...PAGINA_VACIA,
      items: [{ sku: 'M803', descr_efectiva: 'Electronic Lock Plunger' }],
    });
    const r = await responder(db, fuera, null, ctxCon('fiel', { peticiones: [] }, '¿qué onda con el M803?'));
    if (r.tipo !== 'aclarar') throw new Error('debia aclarar');
    expect(r.mensaje).toContain('M803');
  });

  it('sin candidatos en el catálogo, NOMBRA la documentación pero SIGUE diciendo «no sé»', async () => {
    busquedaDevuelve = {
      tipo: 'hallazgos',
      consulta: 'cerraduras',
      docs: [
        {
          ruta: '20_Seguridad/Candados-Conectados.md',
          titulo: 'Candados Conectados',
          fuentePdf: null,
          rango: 0.9,
          trozosTotales: 1,
          fragmentos: [{ seccion: 'S', texto: 'cerraduras inteligentes' }],
        },
      ],
    };
    const r = await responder(db, fuera, null, ctxCon('fiel', { peticiones: [] }, 'cuéntame de cerraduras'));

    // 🔴 CORREGIDO CON LA CORRIDA EN VIVO DELANTE. Antes devolvía una tarjeta, y
    // «¿quién ganó el mundial de 2022?» produjo «Lo que encontré sobre mundial»
    // porque algún documento dice «mundial». Una tarjeta SE LEE COMO UNA
    // RESPUESTA. Ahora sigue siendo «no sé» —con su enumeración intacta— más el
    // nombre de lo que hay, por si el usuario se refería a eso.
    expect(r.tipo).toBe('no_se');
    if (r.tipo !== 'no_se') return;
    expect(r.mensaje).toContain('No sé contestar eso');
    expect(r.mensaje).toContain('Candados Conectados');
    expect(r.sabeHacer.length).toBeGreaterThan(0);
  });

  it('SIN NADA que ofrecer sigue siendo «no sé» que ENUMERA — no se inventa una respuesta', async () => {
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'x' };
    const r = await responder(db, fuera, null, ctxCon('fiel', { peticiones: [] }, '¿quién ganó el mundial?'));
    expect(r.tipo).toBe('no_se');
    if (r.tipo !== 'no_se') return;
    expect(r.sabeHacer.length).toBeGreaterThan(0);
  });

  it('LA PUERTA 4 NO LLAMA AL MODELO: enrutar ya costó una llamada', async () => {
    const reg: RegistroFalso = { peticiones: [] };
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'x' };
    const ctx = ctxCon('fiel', reg, '¿quién ganó el mundial?');
    await responder(db, fuera, null, ctx);

    expect(reg.peticiones).toHaveLength(0);
    expect(ctx.registro.estado).toBe('sin_intento');
  });
});

// ============================================================
// [CHAT-B3] B3-5 · EL RELEVO · la primera ruta deja de quedarse la pregunta.
//
// Medido con hilo fresco en cada caso:
//   «¿qué es un CLIP?»     → documental → ✅ contestaba desde `Clips.md`
//   «¿qué es el CLIP 3.0?» → familia    → 🔴 «no tengo ficha» + escalada
//   «¿qué es un SIP?»      → SKU        → 🔴 «no hay ningún SKU con ese nombre»
//
// La misma ficha que la primera encuentra en un salto, la segunda nunca la
// miraba. Y la tercera contestaba por el INVENTARIO una pregunta conceptual:
// acertaba, y el sistema no sabía por qué — nunca había mirado.
// ============================================================
describe('[CHAT-B3] B3-5 · el relevo documental', () => {
  const HALLAZGO = {
    tipo: 'hallazgos',
    consulta: 'CLIP 3.0',
    docs: [
      {
        ruta: '20_Seguridad/20.01_brand1/06_Fichas/Clips.md',
        titulo: 'Clips 2.0',
        fuentePdf: null,
        rango: 0.9,
        trozosTotales: 1,
        fragmentos: [{ seccion: 'Clips', texto: 'Clips 2.0 es una plataforma modular de Brand1.' }],
      },
    ],
  };

  it('familia SIN puente ⇒ relevo, con prosa Y con la cita del vecino', async () => {
    porFamiliaDevuelve = { tipo: 'sin_puente', sku: null, familia: 'CLIP 3.0' };
    busquedaDevuelve = HALLAZGO;
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'CLIP 3.0' },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );

    expect(r.tipo).toBe('tarjeta');
    if (r.tipo !== 'tarjeta') return;
    expect(r.tarjeta.respuesta).not.toBeNull();
    expect(r.tarjeta.respuesta!.ruta).toContain('Clips.md');
  });

  it('⭐ y DICE EL SALTO: nombra lo que no tiene y lo que puso en su lugar', async () => {
    // Contestar con la ficha del vecino sin avisar sería responder otra
    // pregunta — más convincente por casi acertar.
    porFamiliaDevuelve = { tipo: 'sin_puente', sku: null, familia: 'CLIP 3.0' };
    busquedaDevuelve = HALLAZGO;
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'CLIP 3.0' },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    // [CHAT-B4] CAMBIO DE CONTRATO, y el motivo es el hallazgo B4-1: esta
    // afirmación vivía en `nota`, y `nota` se pliega dentro del `<details>` en
    // cuanto hay prosa. La prueba pasaba en verde mientras la frase NO SE VEÍA
    // en pantalla — el objeto de respuesta no es la pantalla. Ahora se exige en
    // `aviso`, que es el campo que el componente pinta fuera del detalle.
    expect(r.tarjeta.aviso).toContain('CLIP 3.0');
    expect(r.tarjeta.aviso).toContain('Clips 2.0');
    expect(r.tarjeta.aviso).toContain('No tengo una ficha específica');
    // Y no se queda además en la nota: dos copias de la misma frase divergen.
    expect(String(r.tarjeta.nota ?? '')).not.toContain('No tengo una ficha específica');
    // [CHAT-B4] B4-1 · el TÍTULO deja de ser el de una búsqueda normal.
    expect(r.tarjeta.titulo).toContain('Lo más cercano que tengo');
    expect(r.tarjeta.titulo).toContain('CLIP 3.0');
  });

  it('⭐ CONTROL POSITIVO · la familia que SÍ tiene puente usa SU ficha, no el relevo', async () => {
    // Si el relevo se tragara también el camino bueno, ROJO. Aquí la puerta 2
    // resuelve y el relevo no llega a correr.
    porFamiliaDevuelve = { ...FICHA_BASE, ruta: '20_Seguridad/CLIPS.md', familia: 'CLIPS' };
    busquedaDevuelve = HALLAZGO;
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'CLIPS' },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.respuesta!.ruta).toBe('20_Seguridad/CLIPS.md');
    // [CHAT-B4] Se mira en los DOS campos: el salto ya no puede esconderse en
    // ninguno. Antes bastaba con mirar `nota` porque era el único sitio.
    expect(String(r.tarjeta.nota ?? '')).not.toContain('No tengo una ficha específica');
    expect(String(r.tarjeta.aviso ?? '')).not.toContain('No tengo una ficha específica');
  });

  it('⭐ CONTROL POSITIVO · un vecino FUERA del perímetro NO se usa de relevo', async () => {
    // El perímetro gana al relevo, siempre. Un documento que no se puede leer
    // tampoco se puede ofrecer: sería el bucle de B2 por una puerta nueva.
    porFamiliaDevuelve = { tipo: 'sin_puente', sku: null, familia: 'ACME' };
    busquedaDevuelve = {
      tipo: 'hallazgos',
      consulta: 'ACME',
      docs: [
        {
          ruta: '10_Cuentas/ACME.md',
          titulo: 'Índice de Clientes',
          fuentePdf: null,
          rango: 0.9,
          trozosTotales: 2,
          fragmentos: [{ seccion: 'S', texto: 'datos del cliente' }],
        },
      ],
    };
    const reg: RegistroFalso = { peticiones: [] };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'ACME' },
      null,
      ctxCon('fiel', reg),
    );

    expect(reg.peticiones).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('Índice de Clientes');
    expect(JSON.stringify(r)).not.toContain('10_Cuentas');
  });

  it('cero SKU y cero corpus ⇒ «ni ficha ni SKU», no media verdad', async () => {
    // «No hay ningún SKU con ese nombre» era cierto y era la mitad: también se
    // había mirado el corpus y el usuario no tenía forma de saberlo.
    detalle = null;
    fichaDe = { tipo: 'sku_desconocido', sku: 'SIP' };
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'SIP' };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'SIP' },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );

    expect(r.tipo).toBe('no_se');
    if (r.tipo !== 'no_se') return;
    expect(r.mensaje).toContain('ni ficha ni SKU');
  });

  it('pero una DESAMBIGUACIÓN con candidatos NO se convierte en «no hay nada»', async () => {
    // Ahí la lista de candidatos sigue siendo mejor que un «no encontré»: el
    // usuario perdería información que sí teníamos.
    detalle = null;
    // `resolverSku` decide por `page.total`, NO por `items.length` (:148,:158).
    // Mi primera versión ponía `total: 0` heredado de PAGINA_VACIA y la prueba
    // medía el caso contrario al que dice medir — P26, el fixture probando mi
    // comprensión en vez del código.
    listInventoryMock.mockResolvedValue({
      ...PAGINA_VACIA,
      total: 2,
      items: [{ sku: 'CLP-1', descr_efectiva: 'uno' }, { sku: 'CLP-2', descr_efectiva: 'dos' }],
    });
    busquedaDevuelve = { tipo: 'sin_hallazgos', consulta: 'clip' };
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'clip' },
      null,
      ctxCon('fiel', { peticiones: [] }),
    );
    expect(r.tipo).toBe('aclarar');
  });
});

// ============================================================
// [CHAT-B4] B4-2 · EL RELEVO BUSCA CON EL SUJETO, LA FAMILIA ES LA RED.
//
// EL HALLAZGO del QA manual, sobre un chip sugerido del propio panel:
//
//     «¿qué es el KYA2490?»  →  «Lo que encontré sobre «SERIES 41»»
//                               Documentos 4 · Series1 UL4 · Demo Int…
//
// El SKU cae en la familia `SERIES 41`, que no tiene puente, y el relevo
// del camino de SKU buscaba con el nombre de la familia. Medido sobre la base:
//
//     SKU cuya familia SÍ tiene puente :  una fracción mínima
//     SKU cuya familia NO lo tiene     :  la gran mayoría  ← todos pasan por aquí
//     SKU sin familia                  :  una fracción menor
//     denominador: `productos` unido a `familias`
//
// 🔴 Y LO QUE EL TITULAR DEL BLOQUE PEDÍA NO ERA LO QUE HABÍA QUE HACER, medido
// antes de obedecerlo sobre la POBLACIÓN ENTERA —los SKU de familias sin
// puente— contando sólo lo que cae DENTRO del perímetro:
//
//     el SUJETO halla algo : una minoría  ·  la FAMILIA : casi todos
//     sólo el sujeto       : ninguno (S ⊆ F)  ·  SÓLO LA FAMILIA : la mayoría
//
// Sustituir un término por el otro habría dejado a la mayoría sin nada. El
// sujeto es PRECISIÓN, no alcance: de ahí «primero el sujeto, la familia como
// red», que es lo que el bloque decía en su cuerpo aunque no en su título.
// ============================================================
describe('[CHAT-B4] B4-2 · el relevo pregunta por lo que le preguntaron', () => {
  const DOC_DEL_SUJETO = {
    ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/VXQ.md',
    titulo: 'Laptop VXQ (alarma adherible)',
    fuentePdf: null,
    rango: 0.24,
    trozosTotales: 1,
    // Medido: `VXQ.md` lista el SKU por su nombre en la tabla de accesorios.
    fragmentos: [
      { seccion: 'Laptop VXQ (alarma adherible)', texto: '| KYA2490 | Adhesivo de reemplazo, lado Ancla | 20 pack |' },
    ],
  };
  // ────────────────────────────────────────────────────────────
  // EL AMASIJO REAL, COPIADO DE LA BASE Y EN SU ORDEN REAL.
  //
  // 🔴 La primera versión de este fixture traía sólo dos documentos, los dos
  // ajenos, y fosilizaba una comprensión EQUIVOCADA del defecto: que la familia
  // devolvía «documentos sin relación». Medido —y lo levantó la revisión
  // adversaria de este bloque—, `buscar_corpus('SERIES 41', 12)` agrupado
  // por ruta devuelve, en este orden:
  //
  //     1  (rango alto)  …/Series1/UL4.md
  //     2  (rango medio) 20.00_Empresa.md
  //     3  (rango medio) …/Series-41/VXQ.md   ← LA FICHA DEL PRODUCTO DEL SKU
  //     4  (rango medio) …/Series-41/Clips.md
  //
  // `KYA2490` tiene `producto = 'VXQ'`. O sea que el documento bueno YA VENÍA;
  // llegaba tercero, y `prosaDeHallazgos` redacta desde `docs[0]`. El defecto es
  // de RANGO. Con el fixture pobre, el gate pasaba igual con la comprensión
  // buena y con la mala — que es P26 exacto: el fixture probaba mi comprensión.
  // ────────────────────────────────────────────────────────────
  const AMASIJO_DE_LA_FAMILIA = {
    tipo: 'hallazgos',
    consulta: 'SERIES 41',
    docs: [
      {
        ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series1/UL4.md',
        titulo: 'Series1 UL4',
        fuentePdf: null,
        rango: 0.397787,
        trozosTotales: 1,
        fragmentos: [{ seccion: 'Series1 UL4', texto: 'La llave UL4 abre los candados de la familia.' }],
      },
      {
        ruta: '20_Seguridad/20.00_Empresa.md',
        titulo: 'Demo Comercial — Perfil de Empresa',
        fuentePdf: null,
        rango: 0.396413,
        trozosTotales: 4,
        fragmentos: [{ seccion: 'Verticales de negocio', texto: 'Perfil de la empresa y sus verticales.' }],
      },
      DOC_DEL_SUJETO,
      {
        ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/Clips.md',
        titulo: 'Clips 2.0',
        fuentePdf: null,
        rango: 0.396413,
        trozosTotales: 1,
        fragmentos: [{ seccion: 'Clips 2.0', texto: 'Clips 2.0 es una plataforma modular de Brand1.' }],
      },
    ],
  };

  // P36 · sobre la RUTA que DERIVA la entrada, no sobre una fabricada: se entra
  // por `responder` con la decisión que produce el enrutador y el estado del
  // corpus se resuelve dentro. Hilo fresco: `beforeEach` limpia todo.
  const preguntarPorElSku = async () => {
    // P26 · el fixture prueba TU COMPRENSIÓN. Esto faltaba y el gate salió rojo
    // con el código bueno: `resolverSku` pasa por el catálogo, así que el SKU
    // que llega al relevo es el que devuelve `getSkuDetalle`, no el que se
    // teclea. Sin esta línea el sujeto habría sido `KL2722`, el del fixture base.
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    return await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }, '¿qué es el KYA2490?'),
    );
  };

  it('GATE 1 · «¿qué es el KYA2490?» trae UN documento y el título nombra el SKU', async () => {
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_DEL_SUJETO] });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta, fue ' + r.tipo);
    expect(r.tarjeta.lista).toHaveLength(1);
    expect(r.tarjeta.titulo).toContain('KYA2490');
    // Y lo que NO puede pasar: titular con una familia que el usuario jamás
    // escribió. Ésa era exactamente la pantalla que se vio en el QA manual.
    expect(r.tarjeta.titulo).not.toContain('SERIES 41');
  });

  it('⭐ el SUJETO se consulta PRIMERO, y la familia ni se llega a pedir si acierta', async () => {
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_DEL_SUJETO] });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    await preguntarPorElSku();

    expect(busquedasVistas[0]).toBe('KYA2490');
    expect(busquedasVistas).not.toContain('SERIES 41');
  });

  it('⭐ CONTROL POSITIVO · si el sujeto no halla nada, la familia SÍ entra — la mayoría de los casos dependen de eso', async () => {
    // Sin esta rama, «que busque con el sujeto» habría roto la mayor parte del camino
    // que el bloque venía a arreglar. Es la medición, vuelta guarda.
    busquedaPorTermino.set('KYA2490', { tipo: 'sin_hallazgos', consulta: 'KYA2490' });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();

    expect(busquedasVistas).toEqual(['KYA2490', 'SERIES 41']);
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta, fue ' + r.tipo);
    expect(r.tarjeta.lista.length).toBeGreaterThan(0);
    // Aun cayendo en la red, el título y el aviso nombran lo que se preguntó.
    expect(r.tarjeta.titulo).toContain('KYA2490');
    expect(r.tarjeta.aviso).toContain('KYA2490');
  });

  it('⭐ un sujeto que sólo halla FUERA del perímetro cuenta como vacío, no como acierto', async () => {
    // Si el filtro corriera DESPUÉS de elegir el intento, el sujeto «acertaría»
    // con un documento ilegible, la familia no llegaría a correr, y la respuesta
    // saldría vacía teniendo una ficha vecina a mano.
    busquedaPorTermino.set('KYA2490', {
      tipo: 'hallazgos',
      consulta: 'KYA2490',
      docs: [
        {
          ruta: '10_Cuentas/ACME.md',
          titulo: 'Índice de Clientes',
          fuentePdf: null,
          rango: 0.9,
          trozosTotales: 2,
          fragmentos: [{ seccion: 'S', texto: 'datos del cliente' }],
        },
      ],
    });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();

    expect(busquedasVistas).toEqual(['KYA2490', 'SERIES 41']);
    expect(JSON.stringify(r)).not.toContain('10_Cuentas');
    expect(JSON.stringify(r)).not.toContain('Clientes');
  });

  it('⭐ EL GATE DEL RANGO · se redacta desde la ficha del PRODUCTO, no desde la primera del cajón', async () => {
    // ÉSTE es el defecto real, y no lo medía ningún gate hasta que la revisión
    // adversaria corrigió el fixture. Con el término de la familia, `docs[0]`
    // era `Series1/UL4.md` —una llave— y de ahí salía la prosa; `VXQ.md`, la
    // ficha del producto de este SKU, llegaba TERCERA y nunca se redactaba
    // desde ella. Buscar con el sujeto la pone primera.
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_DEL_SUJETO] });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');

    expect(r.tarjeta.respuesta!.ruta).toContain('Series-41/VXQ.md');
    expect(r.tarjeta.respuesta!.ruta).not.toContain('Series1');
    // [CHAT-B4] Y aquí NO hay salto que declarar: el trozo que viaja nombra el
    // SKU con su descripción propia, así que decir «no tengo una ficha
    // específica de KYA2490» sería anunciar un salto que no hubo. Medido:
    // la gran mayoría de los aciertos del sujeto son de esta forma.
    expect(r.tarjeta.aviso).toBeNull();
    expect(r.tarjeta.titulo).toContain('KYA2490');
  });

  it('⭐ CONTROL POSITIVO · por la FAMILIA, ese mismo documento NO es el que se redacta', async () => {
    // Sin esto, el gate de arriba pasaría también si el orden diera igual — y
    // entonces no estaría midiendo nada. Aquí el sujeto se queda vacío, entra la
    // red, y la prosa sale de `docs[0]` del amasijo: la llave, no la ficha.
    busquedaPorTermino.set('KYA2490', { tipo: 'sin_hallazgos', consulta: 'KYA2490' });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');

    expect(r.tarjeta.respuesta!.ruta).toContain('Series1/UL4.md');
    // Y aun asi el usuario SE ENTERA del salto: es lo que B4-1 garantiza.
    expect(r.tarjeta.aviso).toContain('No tengo una ficha específica de KYA2490');
    expect(r.tarjeta.aviso).toContain('Series1 UL4');
  });

  it('GATE 2 · «Documentos N» NO viaja en la tarjeta — ⛔ literal del contrato del asistente (0009)', async () => {
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_DEL_SUJETO] });
    const r = await preguntarPorElSku();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');

    // El `<details>` no lo tapaba en el caso que importa: se pliega SÓLO cuando
    // hay prosa, así que el camino que peor contesta era el que más enseñaba.
    expect(r.tarjeta.datos.map((d) => d.etiqueta)).not.toContain('Documentos');
    expect(JSON.stringify(r.tarjeta)).not.toContain('Documentos');
  });

  it('GATE 3 · ningún renglón repite su propio título como sección', async () => {
    // 🔴 El QA manual lo reportó como «un documento repetido». Medido contra la
    // base: CERO títulos compartidos por dos rutas, y `buscarEnCorpus` ya
    // agrupa por `ruta` con un Map. Lo repetido era UN renglón cuyo título y
    // cuya única sección son la misma cadena — normal en un documento de un
    // solo trozo, que son la mayoría. Deduplicar documentos habría sido el
    // resultado correcto por la razón equivocada.
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_DEL_SUJETO] });
    const r = await preguntarPorElSku();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');

    for (const l of r.tarjeta.lista) expect(l.secundario).not.toBe(l.principal);
  });

  it('⭐ CONTROL POSITIVO · dos documentos DISTINTOS siguen saliendo los dos', async () => {
    // El arreglo de arriba no puede convertirse en un dedupe: el día que dos
    // rutas compartan título, borrar una sería esconder un documento real.
    busquedaPorTermino.set('KYA2490', { tipo: 'sin_hallazgos', consulta: 'KYA2490' });
    busquedaPorTermino.set('SERIES 41', AMASIJO_DE_LA_FAMILIA);
    const r = await preguntarPorElSku();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');

    expect(r.tarjeta.lista).toHaveLength(4);
    expect(new Set(r.tarjeta.lista.map((l) => l.principal)).size).toBe(4);
  });

  it('GATE 4 · CONTROL POSITIVO · «¿qué es el CLIP 3.0?» sigue llegando a Clips 2.0', async () => {
    // Si arreglar el cajón rompe el caso que ya servía, ROJO. Aquí el sujeto ES
    // el nombre de la familia, así que no hay refuerzo y el camino es el de B3.
    porFamiliaDevuelve = { tipo: 'sin_puente', sku: null, familia: 'CLIP 3.0' };
    busquedaPorTermino.set('CLIP 3.0', {
      tipo: 'hallazgos',
      consulta: 'CLIP 3.0',
      docs: [
        {
          ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/Clips.md',
          titulo: 'Clips 2.0',
          fuentePdf: null,
          rango: 0.9,
          trozosTotales: 1,
          fragmentos: [{ seccion: 'Clips', texto: 'Clips 2.0 es una plataforma modular de Brand1.' }],
        },
      ],
    });
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'CLIP 3.0' },
      null,
      ctxCon('fiel', { peticiones: [] }, '¿qué es el CLIP 3.0?'),
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta, fue ' + r.tipo);
    expect(r.tarjeta.respuesta!.ruta).toContain('Clips.md');
    expect(r.tarjeta.aviso).toContain('Clips 2.0');
    expect(busquedasVistas).toEqual(['CLIP 3.0']);
  });
});

// ============================================================
// [CHAT-B4] EL HUECO QUE ENCONTRÓ LA REVISIÓN ADVERSARIA DE ESTE BLOQUE.
//
// `conAviso` se aplicaba a las tres tarjetas de inventario y a la ficha, y la
// rama del RELEVO devolvía desnuda. Medido por la revisión, eslabón por eslabón:
// `admiteAmbiente` es genérica, `documental` exige SKU, y la mayoría de los SKU caen en
// `sin_puente` — o sea que el `return` desnudo NO era el camino raro: era el
// dominante.
//
// Consecuencia: cuando el ambiente o el referente eligen el sujeto y ese sujeto
// no tiene puente, la PROCEDENCIA del sujeto se perdía entera. Ni plegada:
// ausente. Y el docstring de `notaDeAmbiente` dice «va SIEMPRE que el ambiente
// decida» — P35 en código escrito minutos antes.
//
// ⚠️ Por qué ninguna prueba lo vio, que es lo que hay que cerrar y no el caso:
// las SIETE pruebas del ambiente usan `disponibilidad`, y las treinta de
// `documental` no pasan ambiente. **Dos ejes probados por separado y su cruce
// sin tocar** — el mismo hueco de P17 que ya costó una vez en este arco.
// ============================================================
describe('[CHAT-B4] el aviso del ambiente sobrevive al camino del relevo', () => {
  const AMBIENTE_FICHA = { ruta: '/catalogo/KYA2490' };

  // [CHAT-B4] El vecino NO nombra el SKU — si lo nombrara no sería un relevo y no
  // habría salto que declarar, que es justo lo que este describe quiere probar.
  const VECINO_QUE_NO_LO_NOMBRA = {
    tipo: 'hallazgos',
    consulta: 'KYA2490',
    docs: [
      {
        ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/VXQ.md',
        titulo: 'Laptop VXQ (alarma adherible)',
        fuentePdf: null,
        rango: 0.24,
        trozosTotales: 1,
        fragmentos: [{ seccion: 'Laptop VXQ', texto: 'La alarma se adhiere a la laptop y suena al separarse.' }],
      },
    ],
  };

  const relevoConAmbiente = async () => {
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    busquedaPorTermino.set('KYA2490', VECINO_QUE_NO_LO_NOMBRA);
    // Sin `sku` ni `termino`: es la forma exacta que `admiteAmbiente` acepta, y
    // una salida legítima del enrutador. P36 — el sujeto lo DERIVA el servicio.
    return await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: null },
      AMBIENTE_FICHA,
      ctxCon('fiel', { peticiones: [] }, '¿qué es esto?'),
    );
  };

  it('⭐ el ambiente decide el sujeto y la tarjeta LO DICE, aunque acabe en relevo', async () => {
    const r = await relevoConAmbiente();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta, fue ' + r.tipo);
    // La procedencia del sujeto: de dónde salió, no sólo cuál es.
    expect(r.tarjeta.aviso).toContain('KYA2490');
    expect(r.tarjeta.aviso).toContain('la ficha que tienes abierta');
  });

  it('⭐ y el salto del relevo NO se come al aviso del ambiente: viajan los dos', async () => {
    // El riesgo del arreglo es el opuesto al defecto: que uno pise al otro. Son
    // dos hechos distintos —de dónde salió el sujeto, y que la ficha es la del
    // vecino— y el usuario necesita los dos para leer bien la respuesta.
    const r = await relevoConAmbiente();
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.aviso).toContain('No tengo una ficha específica');
    expect(r.tarjeta.aviso).toContain('Laptop VXQ');
  });

  it('⭐ CONTROL POSITIVO · SIN ambiente el aviso trae sólo el salto', async () => {
    // Sin esto, «el aviso contiene KYA2490» lo cumpliría también el relevo
    // solo, y el gate no probaría nada del ambiente.
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    busquedaPorTermino.set('KYA2490', VECINO_QUE_NO_LO_NOMBRA);
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }, '¿qué es el KYA2490?'),
    );
    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.aviso).toContain('No tengo una ficha específica');
    expect(r.tarjeta.aviso).not.toContain('la ficha que tienes abierta');
  });
});

// ============================================================
// [CHAT-B4] EL CUARTO HALLAZGO DE LA REVISIÓN ADVERSARIA, Y EL MÁS CARO:
// **QUÉ PREGUNTA CRUZA EL PERÍMETRO.**
//
// Los ocho gates de B4-2 miraban el título, el rango, «Documentos N» y el
// renglón repetido. **Ninguno miraba lo único que el modelo de verdad lee.**
//
// El defecto: `relevoDocumental` reencuadraba la pregunta SIEMPRE —«¿qué es
// <el vecino> y para qué sirve?»— sin ramificar por cuál intento había ganado.
// Con «¿qué es el KYA2490?» el intento del SUJETO acierta y entrega `VXQ.md`,
// cuyo trozo dice literalmente «| KYA2490 | Adhesivo de reemplazo, lado Ancla |
// 20 pack |» … y al redactor se le preguntaba por la alarma de laptop.
// **Teniendo la respuesta en la mano, la tiraba.**
//
// LA CONDICIÓN ES EXACTAMENTE LA QUE SEPARA LOS DOS CASOS, y por eso el arreglo
// no es una heurística: el intento del sujeto sólo gana cuando la búsqueda de
// texto casó el término del usuario, o sea **sólo cuando el documento contiene
// lo que preguntó**. La medición de B3 que justificaba el reencuadre se hizo
// sobre el caso CONTRARIO — `CLIP 3.0` contra `Clips 2.0`, donde el sujeto no
// aparece. Aplicarla aquí era extender una medición fuera de su universo (P17).
//
// El arnés YA grababa las peticiones (`RegistroFalso`) y otras pruebas del
// archivo lo usan. Lo que faltaba no era instrumento: era la pregunta.
// ============================================================
describe('[CHAT-B4] qué pregunta cruza el perímetro hacia el modelo', () => {
  const DOC_CON_EL_SKU = {
    ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/VXQ.md',
    titulo: 'Laptop VXQ (alarma adherible)',
    fuentePdf: null,
    rango: 0.24,
    trozosTotales: 1,
    fragmentos: [
      { seccion: 'Laptop VXQ (alarma adherible)', texto: '| KYA2490 | Adhesivo de reemplazo, lado Ancla | 20 pack |' },
    ],
  };
  const DOC_DEL_VECINO = {
    ruta: '20_Seguridad/20.01_brand1/06_Fichas/Series-41/Clips.md',
    titulo: 'Clips 2.0',
    fuentePdf: null,
    rango: 0.9,
    trozosTotales: 1,
    fragmentos: [{ seccion: 'Clips', texto: 'Clips 2.0 es una plataforma modular de Brand1.' }],
  };

  const preguntaEnviada = (reg: RegistroFalso): string => String(reg.peticiones[0]?.pregunta ?? '');

  it('⭐ GANA EL SUJETO ⇒ al modelo le llega LA PREGUNTA DEL USUARIO, intacta', async () => {
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_CON_EL_SKU] });
    const reg: RegistroFalso = { peticiones: [] };
    await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', reg, '¿qué es el KYA2490?'),
    );

    expect(preguntaEnviada(reg)).toBe('¿qué es el KYA2490?');
    // Lo que NO puede pasar: preguntarle por el documento en vez de por el SKU
    // cuando el documento trae el SKU con su descripción propia.
    expect(preguntaEnviada(reg)).not.toContain('Laptop VXQ');
    expect(preguntaEnviada(reg)).not.toContain('para qué sirve');
  });

  it('⭐ CONTROL POSITIVO · GANA EL REFUERZO ⇒ el reencuadre SÍ entra, como midió B3', async () => {
    // Sin esta rama el arreglo sería una regresión de B3: con la pregunta
    // original contra los fragmentos del vecino, el modelo contesta «eso no
    // está en la ficha». Honesto e inútil.
    // En el camino de FAMILIA el `pedido` ES lo que tecleó el usuario y no hay
    // refuerzo: lo que decide es que el trozo del vecino NO diga «CLIP 3.0».
    porFamiliaDevuelve = { tipo: 'sin_puente', sku: null, familia: 'CLIP 3.0' };
    busquedaPorTermino.set('CLIP 3.0', { tipo: 'hallazgos', consulta: 'CLIP 3.0', docs: [DOC_DEL_VECINO] });
    const reg: RegistroFalso = { peticiones: [] };
    await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: null, termino: 'CLIP 3.0' },
      null,
      ctxCon('fiel', reg, '¿qué es el CLIP 3.0?'),
    );

    expect(preguntaEnviada(reg)).toContain('Clips 2.0');
    expect(preguntaEnviada(reg)).toContain('para qué sirve');
    expect(preguntaEnviada(reg)).not.toBe('¿qué es el CLIP 3.0?');
  });

  it('⭐ y cuando gana el sujeto NO se declara un salto que no hubo', async () => {
    // Decir «no tengo una ficha específica de KYA2490» sobre un documento que lo
    // nombra con su descripción propia es declarar un salto inexistente — y una
    // advertencia que se da de más es una advertencia que se aprende a ignorar.
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    busquedaPorTermino.set('KYA2490', { tipo: 'hallazgos', consulta: 'KYA2490', docs: [DOC_CON_EL_SKU] });
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }, '¿qué es el KYA2490?'),
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta, fue ' + r.tipo);
    expect(String(r.tarjeta.aviso ?? '')).not.toContain('No tengo una ficha específica');
    // Sigue siendo una BÚSQUEDA, que es lo que de verdad pasó, y el título lo
    // dice nombrando lo que el usuario escribió.
    expect(r.tarjeta.titulo).toContain('KYA2490');
    expect(r.tarjeta.titulo).not.toContain('SERIES 41');
  });

  it('⭐ CONTROL POSITIVO · por el refuerzo, el salto SÍ se declara', async () => {
    // El par separa: si el aviso saliera en los dos casos o en ninguno, este
    // gate no estaría midiendo la ramificación, sólo su existencia.
    detalle = { ...DETALLE_BASE, sku: 'KYA2490' };
    fichaDe = { tipo: 'sin_puente', sku: 'KYA2490', familia: 'SERIES 41' };
    busquedaPorTermino.set('KYA2490', { tipo: 'sin_hallazgos', consulta: 'KYA2490' });
    busquedaPorTermino.set('SERIES 41', { tipo: 'hallazgos', consulta: 'SERIES 41', docs: [DOC_DEL_VECINO] });
    const r = await responder(
      db,
      { tipo: 'intencion', intencion: 'documental', sku: 'KYA2490', termino: null },
      null,
      ctxCon('fiel', { peticiones: [] }, '¿qué es el KYA2490?'),
    );

    if (r.tipo !== 'tarjeta') throw new Error('debia ser tarjeta');
    expect(r.tarjeta.aviso).toContain('No tengo una ficha específica de KYA2490');
    expect(r.tarjeta.aviso).toContain('Clips 2.0');
  });
});
