// ============================================================
// Bloque 2 · ETL · parse.reserva.ts  (PURO)
// Grid pivote de la hoja 'Reserva' → { reservas, cuarentena } (depivot).
// Geometría real (1-based): banner en f1, KAM en f5, fecha en f7,
// motivo en f8, cliente en f9 (col A de f9 = 'ITEM', header del SKU).
// Datos desde f10. col A = SKU · col B = total-fuente (IGNORADA) ·
// col >= C = celdas de reserva (KAM × cliente × fecha × motivo).
//
// fecha vacía → sentinel '' (computeSnapshot la rellena con el PERIODO,
// YYYY-MM-01 — NO con capturedAt exacto: rotaba en cada corrida de PA y
// rompía la idempotencia; fix O5, ver runEtl.ts y `docs/known-limitations.md` (BP-9)).
// fecha malformada ('19 mar 264') → cuarentena. cliente vacío con qty → cuarentena.
// ============================================================
import type { Grid, ReservaCanon, QuarantineItem } from './types';
import { normalizeSku, normalizeAliasKey, cellText } from './normalize';
import { parseEuroNumber } from './numbers';
import { parseFecha } from './dates';

const HOJA = 'Reserva';

/** Localiza la fila de encabezado (col A = 'ITEM'); -1 si no. */
function findItemRow(grid: Grid): number {
  for (let r = 0; r < grid.length; r++) {
    const c0 = grid[r]?.[0];
    if (c0 != null && normalizeAliasKey(String(c0)) === 'item') return r;
  }
  return -1;
}

const COL_SKU = 0;
// col B (índice 1) = total-fuente: se ignora arrancando el barrido en índice 2.
const FIRST_RESERVA_COL = 2;

export function parseReserva(grid: Grid): {
  reservas: ReservaCanon[];
  cuarentena: QuarantineItem[];
} {
  const reservas: ReservaCanon[] = [];
  const cuarentena: QuarantineItem[] = [];

  const itemRow = findItemRow(grid);
  // Sin encabezado 'ITEM' no hay geometría fiable → nada que depivotar.
  if (itemRow < 4) return { reservas, cuarentena };

  const kamRow = grid[itemRow - 4] ?? [];
  const fechaRow = grid[itemRow - 2] ?? [];
  const motivoRow = grid[itemRow - 1] ?? [];
  const clienteRow = grid[itemRow] ?? [];

  // Ancho = máxima longitud de fila (header + datos), vía reduce para no
  // toparse con el límite de argumentos de Math.max(...spread) a escala.
  let width = Math.max(kamRow.length, fechaRow.length, motivoRow.length, clienteRow.length);
  for (let r = itemRow + 1; r < grid.length; r++) {
    const len = (grid[r] ?? []).length;
    if (len > width) width = len;
  }

  for (let r = itemRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sku = normalizeSku(row[COL_SKU]);
    if (sku === null) continue; // leyenda vertical (ITEM vacío) / fila basura
    if (sku === 'TOTALES' || sku === 'TOTAL') continue;

    // Arranca en la col C (>= 2): col A = SKU, col B = total-fuente (ignorada).
    for (let c = FIRST_RESERVA_COL; c < width; c++) {
      const qty = parseEuroNumber(row[c]);
      if (qty === null || qty <= 0) continue; // sin reserva en esta celda

      const cantidad = Math.trunc(qty);
      const cliente = cellText(clienteRow[c]);
      // Columna-resumen del pivote (suma por fila), no un cliente real —
      // espejo del filtro de fila de arriba (fix A, hallazgo QA: se ingería como cliente 'TOTALES', reserva fantasma).
      if (cliente !== null && (cliente.toUpperCase() === 'TOTALES' || cliente.toUpperCase() === 'TOTAL')) continue;
      const kam = cellText(kamRow[c]);
      const motivo = cellText(motivoRow[c]);
      const fechaCell = fechaRow[c];

      if (cliente === null) {
        cuarentena.push({
          entidad: 'reserva',
          clave: `${sku}|c${c}`,
          sku,
          motivo: 'reserva_cliente_vacio',
          origen: { hoja: HOJA, fila: r + 1, col: c + 1 },
          detalle: { cantidad, kam, motivoCol: motivo },
        });
        continue;
      }

      let fecha: string | null;
      const rawFecha = cellText(fechaCell);
      if (rawFecha === null) {
        fecha = ''; // sin fecha → sentinel; runEtl.ts la rellena con periodo-01 (fix O5, no capturedAt exacto)
      } else {
        fecha = parseFecha(fechaCell);
        if (fecha === null) {
          cuarentena.push({
            entidad: 'reserva',
            clave: `${sku}|c${c}`,
            sku,
            motivo: 'reserva_fecha_malformada',
            origen: { hoja: HOJA, fila: r + 1, col: c + 1 },
            detalle: { cantidad, cliente, fechaRaw: rawFecha },
          });
          continue;
        }
      }

      reservas.push({ sku, kam, cliente, cantidad, motivo, fecha });
    }
  }

  return { reservas, cuarentena };
}
