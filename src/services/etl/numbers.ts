// ============================================================
// Bloque 2 · ETL · numbers.ts  (PURO)
// Parseo de números en locale europeo/es-MX tolerante a formato.
// ============================================================
import type { Cell } from './types';

/**
 * Interpreta una celda como número respetando el locale europeo.
 * Reglas (spec §3):
 *  - number → number tal cual.
 *  - '' | null | boolean → null.
 *  - Con ',' y '.'  → '.' = miles, ',' = decimal   ('13.472,00' → 13472).
 *  - Solo ','       → decimal                       ('3,00' → 3).
 *  - Solo '.'       → miles SI casa /^\d{1,3}(\.\d{3})+$/ ('4.285' → 4285);
 *                     en caso contrario, decimal     ('3.07' → 3.07).
 *  - '-1' → -1.  Texto no numérico → null.
 */
export function parseEuroNumber(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'boolean') return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;

  let s = cell.trim();
  if (s === '') return null;
  // Símbolos de moneda / espacios internos (incl. NBSP) fuera.
  s = s.replace(/[$\s ]/g, '');
  if (s === '') return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  let normalized: string;
  if (hasComma && hasDot) {
    // '.' miles, ',' decimal
    normalized = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    // solo ',' → decimal
    normalized = s.replace(',', '.');
  } else if (hasDot) {
    // solo '.' → miles si patrón de miles, si no decimal
    normalized = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  } else {
    normalized = s;
  }

  // Rechaza cualquier residuo no numérico ('19 mar 264', 'ABC', '1,2,3').
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/**
 * Coerciona a entero >= 0 (cantidades de stock/piezas/reserva).
 * null / negativo / no-número → fallback (default 0).
 */
export function toIntNonNeg(cell: Cell, fallback = 0): number {
  const n = parseEuroNumber(cell);
  if (n === null) return fallback;
  const i = Math.trunc(n);
  return i < 0 ? fallback : i;
}

/**
 * Coerciona a entero (permite negativos p.ej. QTY disponible).
 * null / no-número → fallback (default 0).
 */
export function toInt(cell: Cell, fallback = 0): number {
  const n = parseEuroNumber(cell);
  if (n === null) return fallback;
  return Math.trunc(n);
}
