// ============================================================
// src/services/ingesta/motor.ts  (PURO)
// Motor REUTILIZABLE de mapeo mensual: hojas de un libro de Excel
// → datasets del contrato B2 (`/api/refresh`, ver
// `src/schemas/refresh.schema.ts`), según `src/config/ingesta-mapeo.ts`.
// Arma los bodies EXACTOS que espera `RefreshBody` y produce un
// reporte de mapeo (hoja → asignada/excluida/pendiente/no_mapeable)
// para el `--dry` de `scripts/ingesta-mensual.mjs` y, más adelante,
// para la integración con Power Automate (B7).
//
// No conoce Excel/red/DB: recibe grids YA LEÍDOS (`WorkbookGrids`) y
// devuelve datos planos — 100% determinista, sin efectos. Reutiliza
// utilidades PURAS del ETL (`detectHeaderRow`, `normalizeAliasKey`);
// los parsers del ETL (`parse.*.ts`) NUNCA se importan ni se modifican
// aquí (eso es responsabilidad de `preflight.ts`).
//
// GATE BLOQUEANTE (INV-B8, carril B — O2): `construirDatasets` LANZA
// `DatasetsStockFaltantesError` si algún dataset OBLIGATORIO de STOCK
// (inventario/west/reserva) no encontró NINGUNA hoja asignada — el
// body de stock NUNCA se retorna con un dataset vacío por hoja no
// reconocida. Va AQUÍ (no en `/api/refresh`) porque este es el ÚNICO
// punto del pipeline que todavía sabe, hoja por hoja, cuál se
// reconoció y cuál no: una vez aplanado a `Grid` esa distinción se
// pierde (un dataset vacío por "0 filas legítimas este mes" y uno
// vacío por "la hoja jamás se encontró" se ven IGUAL más abajo — de
// hecho el `EtlContractError` de `runEtl.ts` para 'stock' solo dispara
// si el dataset llega `undefined`, nunca si llega `[]`, e
// `/api/refresh` + su schema SIEMPRE mandan las 3 llaves como array:
// esa guarda es inalcanzable por esta vía). Se deja de evaluar SOLO
// cuando el LLAMADOR lo declara de forma EXPLÍCITA vía
// `opts.stockOmitido === true` — NUNCA inferido de
// `archivos.stock.hojas.length` a secas. Un primer intento de este
// arreglo usó `archivos.aduana.hojas.length > 0` como proxy de "esto
// fue a propósito" — descartado en revisión: seguía siendo una
// INFERENCIA sobre la intención del caller a partir de los datos, el
// mismo patrón de falla que esta esquina vino a cerrar, con otra ropa.
// El único llamador real que hoy declara `stockOmitido: true` es
// `ingesta-mensual.mjs --solo aduana`, que arma un `WorkbookGrids`
// vacío como stub para stock Y LO DICE — ver el test "opt-out
// explícito del caller" en `__tests__/motor.test.ts`. Sin esa
// declaración, `archivos.stock.hojas.length === 0` SIEMPRE es fallo
// bloqueante.
//
// CORRECCIÓN A ESTA NOTA (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`): antes decía
// que "un .xlsx real siempre trae ≥1 hoja (Excel no permite libros sin
// hojas), así que este atajo nunca esconde un archivo real mal leído".
// Esa premisa es FALSA — demostrado: un ZIP fabricado a mano (firma
// `PK\x03\x04` real, 1167 bytes, `<sheets/>` vacío en `xl/workbook.xml`)
// SÍ es un .xlsx válido para `XLSX.read`, y `leerWorkbookDesdeBuffer`
// (io.ts) lo acepta sin lanzar, devolviendo `hojas: []` — fixture
// PERMANENTE en `__tests__/fixtures/cero-hojas.xlsx`
// (`__tests__/esquina-f.cero-hojas.test.ts`). Lo que hoy SÍ mantiene
// esta esquina inalcanzable en los dos caminos que persisten
// (`/api/refresh/archivo`, para `source=stock` y `source=aduana`) es
// OTRA guarda, ajena a este archivo: `desde-archivo.ts:174` corta ANTES
// de llegar aquí si el libro real leído trae 0 hojas. Este gate se
// conserva como defensa en profundidad (ver
// `docs/decisions/0003-empty-and-degraded-input-guards.md`): si algún día alguien toca esa guarda, la rendija no se abre
// sin que nada avise.
// ============================================================
import type { Grid, SheetGrid } from '../etl/types';
import { detectHeaderRow } from '../etl/grid';
import { normalizeAliasKey } from '../etl/normalize';
import type {
  IngestaMapeoConfig,
  HojaExcluida,
  HojaPendiente,
} from '../../config/ingesta-mapeo';

// ------------------------------------------------------------
// Entrada: un libro de Excel ya leído a grids.
// ------------------------------------------------------------

/** Hoja nombrada cruda, tal como se lee de un libro de Excel. */
export interface HojaGrid {
  nombre: string;
  grid: Grid;
}

/** Libro de Excel ya leído a grids (una hoja = un `HojaGrid`). */
export interface WorkbookGrids {
  nombreArchivo: string;
  hojas: HojaGrid[];
}

// ------------------------------------------------------------
// Clasificación de hojas (salida del reporte de mapeo).
// ------------------------------------------------------------

export type DatasetStockKey = 'inventario' | 'west' | 'reserva';

export type ClasificacionStock =
  | { estado: 'asignada'; dataset: DatasetStockKey }
  | { estado: 'excluida'; motivo: string }
  | { estado: 'pendiente'; motivo: string }
  | { estado: 'no_mapeable' };

export type ClasificacionAduana =
  | { estado: 'asignada'; dataset: 'embarques' }
  | { estado: 'excluida'; motivo: string }
  | { estado: 'pendiente'; motivo: string };
// Nota: aduana no tiene 'no_mapeable' — el dataset 'embarques' es
// catch-all (cualquier hoja no excluida/pendiente cae ahí), el mismo
// criterio que usa parse.embarques.ts con su SKIP_SHEETS.

export interface ClasificacionHojaStock {
  hoja: string;
  filas: number;
  clasificacion: ClasificacionStock;
}

export interface ClasificacionHojaAduana {
  hoja: string;
  filas: number;
  clasificacion: ClasificacionAduana;
}

export interface ReporteMapeo {
  stock: ClasificacionHojaStock[];
  aduana: ClasificacionHojaAduana[];
}

// ------------------------------------------------------------
// Salida: bodies EXACTOS del contrato B2 (ver refresh.schema.ts).
// ------------------------------------------------------------

export interface BodyStock {
  source: 'stock';
  capturedAt: string;
  archivo: string | null;
  datasets: { inventario: Grid; west: Grid; reserva: Grid };
}

export interface BodyAduana {
  source: 'aduana';
  capturedAt: string;
  archivo: string | null;
  datasets: { embarques: SheetGrid[] };
}

// ------------------------------------------------------------
// Matching de nombre de hoja (normalizado: trim + minúsculas +
// colapso de espacios + sin acentos — cubre ' HISTORIAL DEMO' y,
// listando ambos nombres en el config, 'WEST' vs 'INV_WEST').
// ------------------------------------------------------------

function coincide(nombreHoja: string, nombresConfig: string[]): boolean {
  const n = normalizeAliasKey(nombreHoja);
  return nombresConfig.some((c) => normalizeAliasKey(c) === n);
}

function buscarMotivo(
  nombreHoja: string,
  lista: (HojaExcluida | HojaPendiente)[],
): string | undefined {
  return lista.find((item) => coincide(nombreHoja, item.nombres))?.motivo;
}

function clasificarHojaStock(
  nombreHoja: string,
  cfg: IngestaMapeoConfig['stock'],
): ClasificacionStock {
  if (coincide(nombreHoja, cfg.inventario.nombres)) {
    return { estado: 'asignada', dataset: 'inventario' };
  }
  if (coincide(nombreHoja, cfg.west.nombres)) {
    return { estado: 'asignada', dataset: 'west' };
  }
  if (coincide(nombreHoja, cfg.reserva.nombres)) {
    return { estado: 'asignada', dataset: 'reserva' };
  }
  const motivoExcluida = buscarMotivo(nombreHoja, cfg.excluidas);
  if (motivoExcluida !== undefined) return { estado: 'excluida', motivo: motivoExcluida };
  const motivoPendiente = buscarMotivo(nombreHoja, cfg.pendientes);
  if (motivoPendiente !== undefined) return { estado: 'pendiente', motivo: motivoPendiente };
  return { estado: 'no_mapeable' };
}

function clasificarHojaAduana(
  nombreHoja: string,
  cfg: IngestaMapeoConfig['aduana'],
): ClasificacionAduana {
  const motivoExcluida = buscarMotivo(nombreHoja, cfg.excluidas);
  if (motivoExcluida !== undefined) return { estado: 'excluida', motivo: motivoExcluida };
  const motivoPendiente = buscarMotivo(nombreHoja, cfg.pendientes);
  if (motivoPendiente !== undefined) return { estado: 'pendiente', motivo: motivoPendiente };
  // Catch-all: cualquier otra hoja es un embarque.
  return { estado: 'asignada', dataset: 'embarques' };
}

// ------------------------------------------------------------
// Pre-normalización de headers (config, NO el parser).
// ------------------------------------------------------------

/**
 * Renombra SOLO celdas de la fila de encabezado (localizada IGUAL que
 * el parser real la localiza: primera fila que contiene TODOS los
 * `tokensHeader`, ver `detectHeaderRow`) de acuerdo a `aliases` (clave
 * = header real normalizado, valor = header canónico a escribir tal
 * cual). NO muta `grid` (PURO). Sin aliases configurados para el
 * dataset, o sin fila de encabezado localizable, regresa el grid
 * intacto (el parser real reportará su propio fallo de cabecera
 * después, si aplica).
 *
 * `tokensHeader` DEBE ser el mismo set que el parser real exige (ver
 * `ingesta-mapeo.ts#aliasesHeader`) — anclar solo con `['item']` es
 * más débil que el parser real: una celda 'item' suelta ANTES del
 * header verdadero (p.ej. un banner o leyenda) haría que el alias se
 * aplicara a la fila EQUIVOCADA (bug B-3, fijo).
 */
export function aplicarAliasesHeader(
  grid: Grid,
  aliases: Record<string, string>,
  tokensHeader: string[],
): Grid {
  const entradas = Object.entries(aliases);
  if (entradas.length === 0) return grid;

  const headerRow = detectHeaderRow(grid, tokensHeader);
  if (headerRow < 0) return grid;

  const canonicoPorAlias = new Map(entradas.map(([alias, canon]) => [normalizeAliasKey(alias), canon]));
  const filaOriginal = grid[headerRow] ?? [];
  const filaNueva = filaOriginal.map((celda) => {
    if (typeof celda !== 'string') return celda;
    const canon = canonicoPorAlias.get(normalizeAliasKey(celda));
    return canon ?? celda;
  });

  const gridNuevo = grid.slice();
  gridNuevo[headerRow] = filaNueva;
  return gridNuevo;
}

// ------------------------------------------------------------
// Gate bloqueante — ver nota "GATE BLOQUEANTE" al inicio del archivo.
// `datasetsStockFaltantes` (más abajo) decide QUÉ cuenta como
// "faltante"; esto solo formatea y lanza.
// ------------------------------------------------------------

/** Una línea de diagnóstico por hoja — mismo criterio que usa el `--dry` del CLI (`imprimirMapeo`). */
function formatearClasificacionHojaStock(h: ClasificacionHojaStock): string {
  const c = h.clasificacion;
  let detalle: string;
  if (c.estado === 'asignada') detalle = `asignada -> ${c.dataset}`;
  else if (c.estado === 'excluida') detalle = `excluida A PROPÓSITO (${c.motivo})`;
  else if (c.estado === 'pendiente') detalle = `pendiente de decisión (${c.motivo})`;
  else detalle = 'NO RECONOCIDA (no coincide con ningún nombre configurado en ingesta-mapeo.ts)';
  return `  - "${h.hoja}" (${h.filas} filas): ${detalle}`;
}

/**
 * `construirDatasets` lanza esto en vez de regresar un `bodyStock` con
 * un dataset obligatorio silenciosamente vacío (O2). Carga la
 * clasificación COMPLETA (`reporte`, una entrada por hoja del libro —
 * ver `ClasificacionHojaStock`) además de `faltantes`: así un `catch`
 * sigue pudiendo distinguir "excluida a propósito" de "no reconocida"
 * en vez de perder esa información junto con el throw (ver
 * `preflight.ts#evaluarGateStock`, que atrapa este error a propósito
 * para poder reportar SIN lanzar — "Gate 2": medir un archivo sin
 * construir su body).
 */
export class DatasetsStockFaltantesError extends Error {
  readonly faltantes: DatasetStockKey[];
  readonly reporte: ClasificacionHojaStock[];

  constructor(faltantes: DatasetStockKey[], reporte: ClasificacionHojaStock[]) {
    const encabezado =
      faltantes.length === 1
        ? `el dataset obligatorio "${faltantes[0]}" no encontró ninguna hoja asignada`
        : `${faltantes.length} datasets obligatorios sin ninguna hoja asignada: ${faltantes.join(', ')}`;
    super(
      `No se construyó el body de STOCK: ${encabezado}. Un dataset vacío por hoja no mapeada NUNCA debe ` +
        'reportarse como éxito. Revisa src/config/ingesta-mapeo.ts (¿se renombró la hoja? ¿falta agregar el ' +
        'nombre nuevo a "nombres"?).\n\nClasificación de las hojas recibidas:\n' +
        reporte.map(formatearClasificacionHojaStock).join('\n'),
    );
    this.name = 'DatasetsStockFaltantesError';
    this.faltantes = faltantes;
    this.reporte = reporte;
  }
}

// ------------------------------------------------------------
// construirDatasets: el motor propiamente dicho.
// ------------------------------------------------------------

export function construirDatasets(
  archivos: { stock: WorkbookGrids; aduana: WorkbookGrids },
  config: IngestaMapeoConfig,
  opts: {
    capturedAt: string;
    /**
     * Declaración EXPLÍCITA del CALLER: "sé que STOCK viene sin hojas y
     * es a propósito" (p.ej. `ingesta-mensual.mjs --solo aduana`). El
     * gate bloqueante de abajo (Esquina F, ver
     * `docs/decisions/0003-empty-and-degraded-input-guards.md`) NUNCA la infiere de `archivos.stock.hojas.length` — la
     * intención viaja desde quien la tiene, no se deduce de los datos.
     * Default `false`/`undefined`: sin esta declaración, 0 hojas de
     * STOCK SIEMPRE es fallo bloqueante (el lado seguro).
     */
    stockOmitido?: boolean;
  },
): { bodyStock: BodyStock; bodyAduana: BodyAduana; reporte: ReporteMapeo } {
  const stockReporte: ClasificacionHojaStock[] = [];
  let inventarioGrid: Grid = [];
  let westGrid: Grid = [];
  let reservaGrid: Grid = [];

  for (const hoja of archivos.stock.hojas) {
    const clasificacion = clasificarHojaStock(hoja.nombre, config.stock);
    stockReporte.push({ hoja: hoja.nombre, filas: hoja.grid.length, clasificacion });
    if (clasificacion.estado !== 'asignada') continue;

    const cfgHeader = config.aliasesHeader[clasificacion.dataset];
    const gridNormalizado = aplicarAliasesHeader(hoja.grid, cfgHeader.aliases, cfgHeader.tokensHeader);
    if (clasificacion.dataset === 'inventario') inventarioGrid = gridNormalizado;
    else if (clasificacion.dataset === 'west') westGrid = gridNormalizado;
    else reservaGrid = gridNormalizado;
  }

  // Gate bloqueante (O2) — ver nota "GATE BLOQUEANTE" al inicio del
  // archivo y la docstring de `DatasetsStockFaltantesError`. Se evalúa
  // ANTES de tocar aduana a propósito: ni bodyStock ni bodyAduana deben
  // salir de esta llamada si STOCK quedó incompleto (mismo principio
  // que ya sigue `ingesta-mensual.mjs` al abortar ANTES de postear
  // aduana cuando el POST de stock falla).
  //
  // Esquina F (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`): antes esto
  // decía `if (archivos.stock.hojas.length > 0)` — con 0 hojas el gate
  // entero se saltaba SIEMPRE, sin importar si el caller quiso decir
  // eso o no. Ahora la condición mira `opts.stockOmitido`, declarado
  // EXPLÍCITO por quien tiene la intención — nunca deducido de
  // `archivos` (ver el comentario del parámetro `opts` y la nota al
  // inicio del archivo). Sin la declaración, 0 hojas de STOCK es
  // SIEMPRE fallo bloqueante.
  if (!opts.stockOmitido) {
    const faltantes = datasetsStockFaltantes(stockReporte);
    if (faltantes.length > 0) {
      throw new DatasetsStockFaltantesError(faltantes, stockReporte);
    }
  }

  const aduanaReporte: ClasificacionHojaAduana[] = [];
  const embarquesHojas: SheetGrid[] = [];

  for (const hoja of archivos.aduana.hojas) {
    const clasificacion = clasificarHojaAduana(hoja.nombre, config.aduana);
    aduanaReporte.push({ hoja: hoja.nombre, filas: hoja.grid.length, clasificacion });
    if (clasificacion.estado !== 'asignada') continue;

    const gridNormalizado = aplicarAliasesHeader(
      hoja.grid,
      config.aliasesHeader.embarques.aliases,
      config.aliasesHeader.embarques.tokensHeader,
    );
    embarquesHojas.push({ hoja: hoja.nombre, grid: gridNormalizado });
  }

  const bodyStock: BodyStock = {
    source: 'stock',
    capturedAt: opts.capturedAt,
    archivo: archivos.stock.nombreArchivo,
    datasets: { inventario: inventarioGrid, west: westGrid, reserva: reservaGrid },
  };
  const bodyAduana: BodyAduana = {
    source: 'aduana',
    capturedAt: opts.capturedAt,
    archivo: archivos.aduana.nombreArchivo,
    datasets: { embarques: embarquesHojas },
  };

  return { bodyStock, bodyAduana, reporte: { stock: stockReporte, aduana: aduanaReporte } };
}

/**
 * Datasets del contrato B2 (inventario/west/reserva) que NO
 * encontraron ninguna hoja asignada en `reporte.stock` — señal fuerte
 * de un archivo con estructura inesperada (hoja renombrada sin
 * actualizar el config, hoja faltante, etc.).
 *
 * Usada en dos niveles: (a) `construirDatasets` la consulta para
 * decidir si lanza `DatasetsStockFaltantesError` (gate bloqueante,
 * arriba) y (b) sigue exportada suelta para quien necesite el cálculo
 * puro sin pasar por ese throw (p.ej. `preflight.ts#evaluarGateStock`,
 * o un caller que ya está manejando el `catch`).
 */
export function datasetsStockFaltantes(reporte: ClasificacionHojaStock[]): DatasetStockKey[] {
  const presentes = new Set<DatasetStockKey>();
  for (const item of reporte) {
    if (item.clasificacion.estado === 'asignada') presentes.add(item.clasificacion.dataset);
  }
  return (['inventario', 'west', 'reserva'] as const).filter((k) => !presentes.has(k));
}
