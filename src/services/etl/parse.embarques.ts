// ============================================================
// Bloque 2 · ETL · parse.embarques.ts  (PURO)
// Hojas del libro 'Seguimiento de Embarques' → { embarques, cuarentena }.
// - Hojas 'OC ABIERTAS' / 'GARANTIAS' → SALTADAS.
// - is_historial = el nombre de hoja contiene 'HISTORIAL'.
// - Header por contenido (banners como 'ALMACEN DE INGRESO' se saltan).
// - Encabezados heterogéneos entre hojas (OC vs N° PO, FACTURA vs
//   FACTURA COMERCIAL, PIEZAS vs TOTAL PIEZAS…) → alias por columna.
// - Filas basura: ITEM vacío (leyenda vertical de estatus) y 'TOTALES'
//   → saltadas (NO cuentan como cuarentena).
// - La columna ESTATUS se lee por posición de header; la leyenda
//   vertical de estatus (columna extra sin header) se ignora.
// ============================================================
import type {
  Cell,
  SheetGrid,
  EmbarqueCanon,
  QuarantineItem,
} from './types';
import { detectHeaderRow, resolveColumns, type ColumnSpec } from './grid';
import { normalizeSku, normalizeAliasKey, cellText } from './normalize';
import { parseEuroNumber } from './numbers';
import { parseFecha } from './dates';

const SKIP_SHEETS = new Set(['oc abiertas', 'garantias']);

const COLS: ColumnSpec = {
  referencia: ['referencia'],
  factura: ['factura comercial', 'factura'],
  pais_origen: ['pais de origen'],
  oc_po: ['oc', 'n° po', 'n po', 'no po', 'po', 'n°po'],
  sku: ['item'],
  descr: ['descripcion', 'descr'],
  piezas: ['total piezas', 'piezas'],
  proyecto: ['proyecto'],
  fw: ['fw'],
  tipo_importacion: ['tipo de importacion'],
  fecha_recoleccion: ['fecha de recoleccion'],
  etd: ['etd (fecha de salida de origen)', 'etd'],
  eta: ['eta (fecha de llegada a aduana)', 'eta'],
  fecha_llegada: ['fecha de llegada a almacen'],
  fecha_disponibilidad: [
    'fecha estimada de disponibilidad',
    'fecha de disponibilidad',
  ],
  observaciones: ['observaciones'],
  estatus: ['estatus'],
};

function piezasOf(cell: Cell): number | null {
  const n = parseEuroNumber(cell);
  if (n === null) return null;
  const i = Math.trunc(n);
  return i < 0 ? 0 : i;
}

export function parseEmbarques(hojas: SheetGrid[]): {
  embarques: EmbarqueCanon[];
  cuarentena: QuarantineItem[];
} {
  const embarques: EmbarqueCanon[] = [];
  const cuarentena: QuarantineItem[] = [];

  for (const { hoja, grid } of hojas) {
    const nombre = normalizeAliasKey(hoja);
    if (SKIP_SHEETS.has(nombre)) continue;

    const is_historial = nombre.includes('historial');

    const headerRow = detectHeaderRow(grid, ['item', 'estatus']);
    if (headerRow < 0) continue; // hoja sin estructura de embarque
    const col = resolveColumns(grid[headerRow], COLS);
    if (col.sku === undefined || col.estatus === undefined) continue;

    for (let r = headerRow + 1; r < grid.length; r++) {
      const row = grid[r] ?? [];
      const sku = normalizeSku(row[col.sku]);
      if (sku === null) continue; // leyenda vertical / fila vacía
      if (sku === 'TOTALES' || sku === 'TOTAL') continue;

      const g = (f: string): Cell => (col[f] !== undefined ? row[col[f]] ?? null : null);
      const t = (f: string): string | null => cellText(g(f));
      const d = (f: string): string | null => parseFecha(g(f));

      embarques.push({
        sku,
        oc_po: t('oc_po'),
        proveedor: null,
        referencia: t('referencia'),
        factura: t('factura'),
        pais_origen: t('pais_origen'),
        piezas: piezasOf(g('piezas')),
        fw: t('fw'),
        tipo_importacion: t('tipo_importacion'),
        fecha_recoleccion: d('fecha_recoleccion'),
        etd: d('etd'),
        eta: d('eta'),
        fecha_llegada: d('fecha_llegada'),
        fecha_disponibilidad: d('fecha_disponibilidad'),
        estatus: t('estatus') ?? '',
        proyecto: t('proyecto'),
        observaciones: t('observaciones'),
        is_historial,
      });
    }
  }

  return { embarques, cuarentena };
}
