// ============================================================
// Bloque 2 · ETL · grid.ts  (PURO)
// Localización de header y columnas por CONTENIDO (no por posición):
// tolera gutter (col A vacía), banners superiores y variantes de nombre.
// ============================================================
import type { Cell, Grid } from './types';
import { normalizeAliasKey } from './normalize';

/** alias (normalizados) por campo lógico. */
export interface ColumnSpec {
  [logicalField: string]: string[];
}

function normCell(cell: Cell): string {
  if (cell === null || cell === undefined) return '';
  return normalizeAliasKey(String(cell));
}

/**
 * Índice de la fila de encabezado: la PRIMERA fila que contiene TODOS
 * los tokens requeridos (normalizados, coincidencia por igualdad de celda).
 * Salta banners superiores (p.ej. 'HISTORIAL DEMO', 'INVENTARIO WEST').
 * -1 si no se encuentra.
 */
export function detectHeaderRow(grid: Grid, requiredTokens: string[]): number {
  const req = requiredTokens.map((t) => normalizeAliasKey(t));
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const cells = new Set(row.map(normCell).filter((c) => c !== ''));
    if (req.every((t) => cells.has(t))) return r;
  }
  return -1;
}

/**
 * Resuelve columnas lógicas → índice de columna en la fila de encabezado.
 * - Coincidencia exacta por celda normalizada contra la lista de alias.
 * - Gutter: columnas vacías simplemente no casan.
 * - Duplicados: se conserva la PRIMERA coincidencia (menor índice).
 * Campos sin coincidencia quedan ausentes del mapa resultante.
 */
export function resolveColumns(
  headerRow: Cell[],
  spec: ColumnSpec,
): Record<string, number> {
  const normHeader = headerRow.map(normCell);
  const out: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(spec)) {
    const wanted = aliases.map((a) => normalizeAliasKey(a));
    for (let c = 0; c < normHeader.length; c++) {
      if (normHeader[c] !== '' && wanted.includes(normHeader[c])) {
        out[field] = c;
        break;
      }
    }
  }
  return out;
}
