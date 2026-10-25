// ============================================================
// src/services/ingesta/preflight.ts  (PURO)
// Análisis DRY (sin DB, sin red): corre los PARSERS REALES del ETL
// (`parse.*.ts`, `reconcile`, `gates`) sobre los datasets ya armados
// por `motor.ts` para anticipar conteos/gates/cuarentena SIN tocar la
// base de datos, y compara la ESTRUCTURA (hojas/headers) de un libro
// actual contra una referencia (normalmente abril 2026, vía
// `io.ts#cargarReferenciaAbril`) para detectar drift mes a mes.
//
// El parser del ETL queda intacto: solo se IMPORTA, nunca se modifica
// (mismo principio que `motor.ts`).
//
// `evaluarGateStock` (INV-B8, "Gate 2" del bloque) es la excepción a
// "solo analiza datasets ya armados": clasifica las hojas de STOCK de
// un libro SIN construir su body — a propósito, para poder medir
// (`--dry`, sin persistir) un archivo que todavía podría no estar
// listo (p.ej. un dataset obligatorio sin hoja reconocida), caso en el
// que `construirDatasets` (motor.ts) lanza en vez de regresar un body
// incompleto. Ver su docstring más abajo.
//
// Divergencias CONOCIDAS y documentadas vs el POST real (runEtl.ts) —
// todas por la misma razón raíz (no resolubles sin BD):
//  - reserva→producto (referencial, motivo 'reserva_sku_sin_producto'):
//    SÍ se puede validar aquí (con el propio archivo de stock, igual
//    que hace runEtl.ts) — no requiere BD, solo el archivo.
//  - embarque→producto (referencial, motivo 'embarque_sku_sin_producto',
//    ver runEtl.ts:264-265 `checkReferential(resolved, prev.existingSkus,
//    'embarque')`): NO se puede validar aquí — requiere el conjunto de
//    SKUs VIGENTES en BD (`prev.existingSkus`), no solo el archivo. Se
//    deja fuera a propósito; asimetría intencional con reserva (arriba),
//    no un descuido.
//  - embarque→estatus (resolución a `estatus_id`, motivo
//    'embarque_estatus_no_resuelto', ver runEtl.ts:249-260
//    `resolveEstatus(e.estatus, idx)`): tampoco calculable file-only —
//    `idx` es el catálogo de estatus vigente en BD.
//  Consecuencia de las 2 anteriores: `analizarAduana` (abajo) JAMÁS
//  emite cuarentena — AMBAS fuentes reales de cuarentena de aduana
//  requieren BD y solo se reportan en el POST real (F3). El CLI
//  (`ingesta-mensual.mjs`) rotula su sección "Cuarentena anticipada —
//  ADUANA" con esta salvedad explícita para no sugerir falsamente que
//  0 cuarentena en el `--dry` significa 0 en el POST real (fix M-2).
//  - reserva.fecha backfill (I-8, OUTPUT-NEUTRAL — no afecta cuentas/
//    gates/cuarentena de este preflight): fecha vacía queda como
//    sentinel `''` aquí tal cual la deja `parse.reserva.ts` (ver su
//    doc); `runEtl.ts` (computeSnapshot) la rellena con el PERIODO
//    (YYYY-MM-01) antes de persistir — ese relleno solo ocurre en el
//    POST real.
// ============================================================
import type { Grid, DiagItem, QuarantineItem } from '../etl/types';
import { detectHeaderRow } from '../etl/grid';
import { normalizeAliasKey } from '../etl/normalize';
import { parseInventario } from '../etl/parse.inventario';
import { parseWest } from '../etl/parse.west';
import { parseReserva } from '../etl/parse.reserva';
import { parseEmbarques } from '../etl/parse.embarques';
import { reconcile } from '../etl/reconcile';
import { runGates, checkReferential } from '../etl/gates';
import type {
  WorkbookGrids,
  BodyStock,
  BodyAduana,
  ClasificacionHojaStock,
  ClasificacionHojaAduana,
  DatasetStockKey,
} from './motor';
import { construirDatasets, DatasetsStockFaltantesError } from './motor';
import type { IngestaMapeoConfig } from '../../config/ingesta-mapeo';

// ------------------------------------------------------------
// Análisis de STOCK (inventario + west + reserva, reconciliados).
// ------------------------------------------------------------

export interface StockPreflight {
  conteos: {
    productosInventario: number;
    stockInventario: number;
    westRows: number;
    westMatched: number;
    westNuevos: number;
    productosReconciliados: number;
    stockReconciliado: number;
    reservas: number;
  };
  diag: DiagItem[];
  cuarentena: QuarantineItem[];
}

export function analizarStock(datasets: BodyStock['datasets']): StockPreflight {
  const inv = parseInventario(datasets.inventario);
  const west = parseWest(datasets.west);
  const resv = parseReserva(datasets.reserva);

  const rec = reconcile({ productos: inv.productos, stock: inv.stock }, west.rows);
  const validSkus = new Set(rec.productos.map((p) => p.sku));
  const resvRef = checkReferential(resv.reservas, validSkus, 'reserva');
  const gates = runGates(rec.productos, rec.stock, resvRef.ok);

  return {
    conteos: {
      productosInventario: inv.productos.length,
      stockInventario: inv.stock.length,
      westRows: west.rows.length,
      westMatched: rec.westMatched,
      westNuevos: rec.westNuevos,
      productosReconciliados: rec.productos.length,
      stockReconciliado: rec.stock.length,
      reservas: resvRef.ok.length,
    },
    diag: gates.diag,
    cuarentena: [
      ...inv.cuarentena,
      ...west.cuarentena,
      ...resv.cuarentena,
      ...rec.cuarentena,
      ...resvRef.cuarentena,
      ...gates.cuarentena,
    ],
  };
}

// ------------------------------------------------------------
// Gate 2 (INV-B8): clasificación de STOCK SIN construir el body ni
// lanzar — para "medir un archivo sin persistir" incluso cuando
// todavía no está listo para producir un body válido (a diferencia de
// `construirDatasets`, que SÍ lanza `DatasetsStockFaltantesError` si
// falta un dataset obligatorio — ver motor.ts).
// ------------------------------------------------------------

export interface GateStock {
  /** Una entrada por hoja del libro recibido, con su clasificación completa (asignada/excluida/pendiente/no_mapeable). */
  reporte: ClasificacionHojaStock[];
  /** Datasets obligatorios (inventario/west/reserva) SIN ninguna hoja asignada — `[]` cuando el libro está completo. */
  faltantes: DatasetStockKey[];
  /** `true` cuando los 3 datasets obligatorios tienen hoja asignada (equivale a `faltantes.length === 0`). */
  completo: boolean;
}

/**
 * Clasifica las hojas de STOCK de un libro reutilizando EXACTAMENTE la
 * misma lógica de mapeo que `construirDatasets` (mismo matcher, mismo
 * `config`) — pero sin lanzar si faltan datasets obligatorios: atrapa
 * `DatasetsStockFaltantesError` y regresa su clasificación igual, en
 * vez de reventar. Así se puede reportar de forma explícita CÓMO quedó
 * cada hoja (asignada a un dataset, excluida a propósito con motivo,
 * pendiente de decisión con motivo, o NO reconocida) incluso mientras
 * un dataset obligatorio sigue sin mapear en `ingesta-mapeo.ts` — el
 * mismo `reporte` que llevaría el throw de `construirDatasets`, aquí
 * disponible sin necesidad de un `try/catch` en el caller.
 */
export function evaluarGateStock(workbook: WorkbookGrids, config: IngestaMapeoConfig): GateStock {
  try {
    const { reporte } = construirDatasets(
      // aduana va vacía a propósito: esta función solo mira
      // `reporte.stock` — el libro de aduana real es irrelevante aquí.
      { stock: workbook, aduana: { nombreArchivo: '', hojas: [] } },
      config,
      // capturedAt es irrelevante aquí: esta función nunca mira los
      // bodies (solo `reporte.stock` / el `catch` de abajo).
      { capturedAt: '1970-01-01T00:00:00.000Z' },
    );
    return { reporte: reporte.stock, faltantes: [], completo: true };
  } catch (e) {
    if (e instanceof DatasetsStockFaltantesError) {
      return { reporte: e.reporte, faltantes: e.faltantes, completo: false };
    }
    throw e;
  }
}

// ------------------------------------------------------------
// Análisis de ADUANA (embarques, por hoja).
// ------------------------------------------------------------

export interface AduanaPreflightHoja {
  hoja: string;
  total: number;
  historial: boolean;
}

export interface AduanaPreflight {
  porHoja: AduanaPreflightHoja[];
  total: number;
  cuarentena: QuarantineItem[];
}

/** SKUs sin producto: NO calculable file-only (requiere `prev.existingSkus` de la BD, ver runEtl.ts). */
export function analizarAduana(datasets: BodyAduana['datasets']): AduanaPreflight {
  const porHoja: AduanaPreflightHoja[] = [];
  const cuarentena: QuarantineItem[] = [];
  let total = 0;

  for (const hojaGrid of datasets.embarques) {
    const { embarques, cuarentena: c } = parseEmbarques([hojaGrid]);
    porHoja.push({
      hoja: hojaGrid.hoja,
      total: embarques.length,
      historial: normalizeAliasKey(hojaGrid.hoja).includes('historial'),
    });
    cuarentena.push(...c);
    total += embarques.length;
  }

  return { porHoja, total, cuarentena };
}

// ------------------------------------------------------------
// Deltas estructurales vs una referencia (p.ej. abril 2026).
// ------------------------------------------------------------

export interface DeltaHeaders {
  hoja: string;
  agregados: string[];
  quitados: string[];
}

export interface DeltaRenombrada {
  dataset: string;
  de: string;
  a: string;
}

export interface DeltaEstructural {
  hojasNuevas: string[];
  hojasDesaparecidas: string[];
  renombradas: DeltaRenombrada[];
  headersCambiados: DeltaHeaders[];
}

/** Header set de una hoja: fila localizada como los parsers la localizan (contiene 'item'). */
function headerSetDe(grid: Grid): Set<string> {
  const headerRow = detectHeaderRow(grid, ['item']);
  if (headerRow < 0) return new Set();
  const fila = grid[headerRow] ?? [];
  const out = new Set<string>();
  for (const celda of fila) {
    if (celda === null || celda === undefined) continue;
    const texto = String(celda).trim();
    if (texto !== '') out.add(normalizeAliasKey(texto));
  }
  return out;
}

function gridDe(wb: WorkbookGrids, nombreHoja: string): Grid {
  return wb.hojas.find((h) => h.nombre === nombreHoja)?.grid ?? [];
}

/** dataset asignado → nombres de hoja asignados ahí (>1 solo para 'embarques', catch-all). */
function porDataset(reporte: (ClasificacionHojaStock | ClasificacionHojaAduana)[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const item of reporte) {
    const clasif = item.clasificacion;
    if (clasif.estado !== 'asignada') continue;
    const key: string = clasif.dataset;
    const arr = m.get(key) ?? [];
    arr.push(item.hoja);
    m.set(key, arr);
  }
  return m;
}

function agregarDeltaHeaders(
  out: DeltaHeaders[],
  wbAct: WorkbookGrids,
  nombreAct: string,
  wbRef: WorkbookGrids,
  nombreRef: string,
): void {
  const setA = headerSetDe(gridDe(wbAct, nombreAct));
  const setR = headerSetDe(gridDe(wbRef, nombreRef));
  const agregados = Array.from(setA).filter((c) => !setR.has(c));
  const quitados = Array.from(setR).filter((c) => !setA.has(c));
  if (agregados.length > 0 || quitados.length > 0) {
    out.push({ hoja: nombreAct, agregados, quitados });
  }
}

/**
 * Compara la clasificación (de `motor.ts#construirDatasets`) de un
 * libro ACTUAL contra una REFERENCIA (p.ej. abril 2026), alineando por
 * DATASET asignado (no por nombre de hoja crudo) — así un renombre de
 * hoja (p.ej. 'INV_WEST' → 'WEST') se reporta como RENOMBRADA, no
 * como "una desapareció y otra es nueva".
 */
export function compararEstructura(
  actual: { workbook: WorkbookGrids; reporte: (ClasificacionHojaStock | ClasificacionHojaAduana)[] },
  referencia: { workbook: WorkbookGrids; reporte: (ClasificacionHojaStock | ClasificacionHojaAduana)[] },
): DeltaEstructural {
  const actDs = porDataset(actual.reporte);
  const refDs = porDataset(referencia.reporte);

  const hojasNuevas: string[] = [];
  const hojasDesaparecidas: string[] = [];
  const renombradas: DeltaRenombrada[] = [];
  const headersCambiados: DeltaHeaders[] = [];

  const datasetsUnicos = Array.from(new Set(Array.from(actDs.keys()).concat(Array.from(refDs.keys()))));
  for (const dataset of datasetsUnicos) {
    const actNombres = actDs.get(dataset) ?? [];
    const refNombres = refDs.get(dataset) ?? [];

    if (dataset === 'embarques') {
      // catch-all: N hojas de cada lado, se alinean por nombre normalizado.
      const refByNorm = new Map(refNombres.map((n) => [normalizeAliasKey(n), n]));
      const actNorm = new Set(actNombres.map(normalizeAliasKey));
      for (const nombreAct of actNombres) {
        const nombreRef = refByNorm.get(normalizeAliasKey(nombreAct));
        if (!nombreRef) {
          hojasNuevas.push(nombreAct);
          continue;
        }
        agregarDeltaHeaders(headersCambiados, actual.workbook, nombreAct, referencia.workbook, nombreRef);
      }
      for (const nombreRef of refNombres) {
        if (!actNorm.has(normalizeAliasKey(nombreRef))) hojasDesaparecidas.push(nombreRef);
      }
      continue;
    }

    // dataset exacto (inventario/west/reserva): a lo más 1 hoja de cada lado.
    const a = actNombres[0];
    const r = refNombres[0];
    if (a && r) {
      if (normalizeAliasKey(a) !== normalizeAliasKey(r)) renombradas.push({ dataset, de: r, a });
      // 'reserva' es un pivote (parse.reserva.ts): la fila que contiene
      // 'item' trae NOMBRES DE CLIENTE, no un schema de columnas — su
      // "header" cambia de un mes a otro por rotación normal de clientes,
      // no por drift estructural. Compararla como header generaría puro
      // ruido (decenas de "agregados/quitados" = clientes distintos cada
      // mes) sin señal accionable, así que se excluye a propósito.
      if (dataset !== 'reserva') {
        agregarDeltaHeaders(headersCambiados, actual.workbook, a, referencia.workbook, r);
      }
    } else if (a && !r) {
      hojasNuevas.push(a);
    } else if (!a && r) {
      hojasDesaparecidas.push(r);
    }
  }

  return { hojasNuevas, hojasDesaparecidas, renombradas, headersCambiados };
}
