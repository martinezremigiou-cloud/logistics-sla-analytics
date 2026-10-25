// ============================================================
// Bloque 2 · ETL · normalize.ts  (PURO)
// Normalización de SKU y claves de alias.
// ============================================================
import type { Cell } from './types';

/**
 * SKU canónico: trim + UPPER. Vacío o no-texto útil → null.
 * SKU es INMUTABLE (Principio #2); nunca se reescribe tras la ingesta.
 */
export function normalizeSku(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  if (s === '') return null;
  return s.toUpperCase();
}

/**
 * Clave de alias: lowercase + NFD-strip de acentos + colapso de espacios.
 * Usada para resolver marca/kam/estatus contra los mapas de CatalogIndex.
 */
export function normalizeAliasKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto de celda a string recortado, o null si vacío. */
export function cellText(cell: Cell): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'boolean') return cell ? 'true' : null;
  const s = String(cell).trim();
  return s === '' ? null : s;
}

/** Marca canónica: trim + UPPER + colapso de espacios. Vacío → null. */
export function normalizeMarcaNombre(s: string): string | null {
  const t = s.replace(/\s+/g, ' ').trim().toUpperCase();
  return t === '' ? null : t;
}
