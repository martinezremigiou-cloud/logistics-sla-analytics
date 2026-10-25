// ============================================================
// [RECEPCION] src/services/ingesta/desde-archivo.ts  (NO puro — usa xlsx)
// Composición del camino NUEVO: bytes de un .xlsx → body EXACTO del
// contrato B2 (el mismo que hoy arma `scripts/ingesta-mensual.mjs` y
// postea a `/api/refresh`).
//
// Es deliberadamente la MISMA secuencia que el CLI, con las mismas
// piezas y en el mismo orden:
//     leer libro → construirDatasets(config) → bodyStock | bodyAduana
// Ninguna rama propia, ningún parseo alternativo. Por eso el Gate 2 de
// este bloque puede exigir igualdad EXACTA entre los dos caminos: lo
// único que cambia es de dónde salen los bytes (disco vs HTTP).
//
// Vive aquí y no en el route handler por la convención del proyecto
// ("cero lógica de dominio en las rutas", ver `/api/refresh/route.ts`):
// así esto se prueba sin levantar HTTP ni fabricar un `Request`.
// ============================================================
import { leerWorkbookDesdeBuffer } from './io';
import { construirDatasets, type BodyStock, type BodyAduana } from './motor';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';
import type { ReporteMapeo, WorkbookGrids } from './motor';

/** Qué libro se está recibiendo. Lo declara el llamador (query `?source=`), no se adivina del contenido. */
export type FuenteArchivo = 'stock' | 'aduana';

/**
 * El cuerpo no era un .xlsx legible.
 *
 * Existe como tipo propio —y no como un `Error` suelto— para que la ruta
 * pueda distinguirlo del resto y responder 400 (“mandaste algo que no es
 * un Excel”) en vez de 500 (“me rompí”). Un archivo corrupto es un error
 * del CLIENTE; tratarlo como fallo del servidor haría que Power Automate
 * lo reintentara para siempre contra un archivo que nunca va a servir.
 *
 * `causa` guarda el error original de la librería para el log del
 * servidor. NUNCA debe viajar en la respuesta HTTP: los mensajes de `xlsx`
 * mencionan internals del formato y de la ruta de parseo.
 */
export class ArchivoIlegibleError extends Error {
  readonly causa: unknown;

  constructor(message: string, causa?: unknown) {
    super(message);
    this.name = 'ArchivoIlegibleError';
    this.causa = causa;
  }
}

/** Cómo venía envuelto el archivo en el cuerpo HTTP. Se reporta para diagnosticar el flujo de PA. */
export type FormaCuerpo = 'binario' | 'sobre_base64';

/** Firma de un ZIP (`PK\x03\x04`) — todo .xlsx es un ZIP por dentro. */
const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Bytes que Excel/PA podrían anteponer y que no son contenido: espacio, tab, CR, LF, BOM. */
const ESPACIOS = new Set([0x20, 0x09, 0x0d, 0x0a, 0xef, 0xbb, 0xbf]);

/**
 * [RECEPCION] §1 · Acepta las DOS formas en que Power Automate puede
 * entregar el archivo, porque cuál llega depende de cómo se conecte la
 * acción HTTP en el flujo — y eso no lo controla el portal:
 *
 *   1. BINARIO — el .xlsx tal cual (empieza con `PK\x03\x04`).
 *   2. SOBRE base64 — `{"$content-type": "...", "$content": "UEsDBBQ..."}`,
 *      que es lo que devuelve la acción de OneDrive, según se midió.
 *
 * Se decide SNIFFEANDO los bytes, no leyendo el `Content-Type` declarado.
 * Razón: el header lo fija el cliente y en los conectores de PA no siempre
 * corresponde al cuerpo real; los bytes sí son el cuerpo real. Un sniff
 * que se equivoque falla ruidoso (400) — un header en el que se confíe de
 * más falla silencioso, mandando base64 al parser de ZIP.
 *
 * Se rechaza explícitamente el sobre con `$content` ausente o vacío: es el
 * síntoma exacto de un paso de PA que devolvió 200 pero sin archivo, y
 * dejarlo pasar produciría un libro vacío — el éxito falso que P10
 * describe.
 */
export function extraerBytesDelCuerpo(crudo: Uint8Array): { bytes: Uint8Array; forma: FormaCuerpo } {
  if (crudo.length === 0) {
    throw new ArchivoIlegibleError('El cuerpo de la petición viene vacío: no hay archivo que leer.');
  }

  if (FIRMA_ZIP.every((b, i) => crudo[i] === b)) {
    return { bytes: crudo, forma: 'binario' };
  }

  let i = 0;
  while (i < crudo.length && ESPACIOS.has(crudo[i])) i++;
  if (crudo[i] === 0x7b /* { */) {
    let sobre: unknown;
    try {
      sobre = JSON.parse(new TextDecoder().decode(crudo));
    } catch (e) {
      throw new ArchivoIlegibleError(
        'El cuerpo parece JSON pero no se pudo interpretar. Se esperaba el .xlsx binario o el sobre {"$content": "<base64>"}.',
        e,
      );
    }
    const contenido = (sobre as Record<string, unknown> | null)?.['$content'];
    if (typeof contenido !== 'string' || contenido.trim() === '') {
      throw new ArchivoIlegibleError(
        'El sobre JSON no trae "$content" con el archivo en base64. Revisa el paso de Power Automate que obtiene el contenido del archivo: respondió sin contenido.',
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(Buffer.from(contenido, 'base64'));
    } catch (e) {
      throw new ArchivoIlegibleError('El "$content" del sobre no es base64 válido.', e);
    }
    if (!FIRMA_ZIP.every((b, i2) => bytes[i2] === b)) {
      throw new ArchivoIlegibleError(
        'El "$content" del sobre se decodificó pero no es un .xlsx (no empieza con la firma de un ZIP).',
      );
    }
    return { bytes, forma: 'sobre_base64' };
  }

  throw new ArchivoIlegibleError(
    'El cuerpo no es un .xlsx: no empieza con la firma de un ZIP ni con el sobre JSON de Power Automate.',
  );
}

export interface ResultadoDesdeArchivo {
  /** Body EXACTO del contrato B2, listo para `toIngestJob`. */
  body: BodyStock | BodyAduana;
  /** Clasificación hoja por hoja — se registra para diagnosticar drift de nombres de pestaña. */
  reporte: ReporteMapeo;
  /** Cómo venía envuelto el archivo. */
  forma: FormaCuerpo;
  /** O4 · milisegundos del tramo "abrir el .xlsx" (bytes → grids), medido, no estimado. */
  msLectura: number;
  /** O4 · milisegundos del tramo "clasificar hojas y armar datasets". */
  msMapeo: number;
  /** Hojas del libro, para el log de la ruta. */
  hojas: string[];
}

/**
 * bytes de un .xlsx → body del contrato B2.
 *
 * El gate bloqueante de datasets obligatorios (INV-B8, O2) NO se
 * reimplementa aquí: lo aplica `construirDatasets`, que lanza
 * `DatasetsStockFaltantesError`. Ese error SE DEJA PROPAGAR a propósito —
 * que la puerta nueva sea otra puerta no puede ser una forma de saltarse
 * la compuerta. Es exactamente el requisito O5 del bloque.
 */
export function construirBodyDesdeArchivo(
  crudo: Uint8Array,
  opts: { source: FuenteArchivo; nombreArchivo: string; capturedAt: string },
): ResultadoDesdeArchivo {
  const { bytes, forma } = extraerBytesDelCuerpo(crudo);

  const t0 = performance.now();
  let libro: WorkbookGrids;
  try {
    libro = leerWorkbookDesdeBuffer(bytes, opts.nombreArchivo);
  } catch (e) {
    throw new ArchivoIlegibleError(
      'El archivo no se pudo abrir como libro de Excel (¿está corrupto o truncado?).',
      e,
    );
  }
  const t1 = performance.now();

  // CORRECCIÓN (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`): esta nota decía "Un
  // .xlsx real SIEMPRE trae al menos una hoja (Excel no permite libros
  // sin hojas)" — premisa FALSA, misma corrección que en
  // `motor.ts:17-55`: un ZIP fabricado a mano (firma `PK\x03\x04` real,
  // `<sheets/>` vacío) SÍ es un .xlsx válido para `XLSX.read` y produce
  // `hojas: []` sin lanzar (fixture permanente
  // `__tests__/fixtures/cero-hojas.xlsx`). Cero hojas aquí puede venir
  // de un archivo degenerado O de uno legítimo corrupto en tránsito —
  // de cualquier forma hay que cortarlo ANTES de `construirDatasets`,
  // con un mensaje de dominio propio (`ArchivoIlegibleError`, 400 claro
  // para quien subió el archivo) en vez de dejar que ese gate lo
  // reporte como "faltan los datasets de STOCK" (confuso cuando el
  // archivo corrupto era el de ADUANA). Sin este corte, un libro sin
  // hojas produciría un body con los 3 datasets vacíos y ningún error:
  // el éxito falso de P10.
  //
  // RESUELTO (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`):
  // `construirDatasets` (motor.ts) ya NO desactiva su gate por
  // `hojas.length === 0` a secas — exige `opts.stockOmitido === true`
  // declarado EXPLÍCITO por el caller (la intención viaja desde quien la
  // tiene, nunca se infiere de `archivos`). Esta función SÍ lo declara,
  // más abajo (`stockOmitido: opts.source === 'aduana'`): con
  // `source=aduana` esta ruta recibe UN archivo —el de aduana— y no hay
  // libro de stock que evaluar, la MISMA intención que declara
  // `ingesta-mensual.mjs --solo aduana` con su propio `stockOmitido`.
  // Verificado: `construirBodyDesdeArchivo({ source: 'aduana', ... })`
  // vuelve a construir el body en vez de lanzar
  // `DatasetsStockFaltantesError` — `__tests__/desde-archivo.test.ts`
  // ("ADUANA vivo") y `route.test.ts` de `/api/refresh/archivo` vuelven
  // a 200/verde por este arreglo, no por ajuste de ninguna prueba.
  if (libro.hojas.length === 0) {
    throw new ArchivoIlegibleError('El libro no tiene ninguna hoja.');
  }

  const vacio: WorkbookGrids = { nombreArchivo: opts.nombreArchivo, hojas: [] };
  const { bodyStock, bodyAduana, reporte } = construirDatasets(
    opts.source === 'stock' ? { stock: libro, aduana: vacio } : { stock: vacio, aduana: libro },
    ingestaMapeoConfig,
    // stockOmitido: declaración EXPLÍCITA (Esquina F, G2/F1) — con
    // source=aduana esta ruta recibe UN archivo (el de aduana) y no hay
    // libro de stock que evaluar; con source=stock da `false` (el lado
    // seguro: 0 hojas de STOCK sigue bloqueando, ver
    // `__tests__/desde-archivo.stockOmitido.test.ts`).
    { capturedAt: opts.capturedAt, stockOmitido: opts.source === 'aduana' },
  );
  const t2 = performance.now();

  return {
    body: opts.source === 'stock' ? bodyStock : bodyAduana,
    reporte,
    forma,
    msLectura: t1 - t0,
    msMapeo: t2 - t1,
    hojas: libro.hojas.map((h) => h.nombre),
  };
}
