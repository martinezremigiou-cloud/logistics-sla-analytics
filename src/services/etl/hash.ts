// ============================================================
// Bloque 2 · ETL · hash.ts  (PURO, determinista — node:crypto)
// Hashing canónico para idempotencia de snapshots y filas.
// ============================================================
import { createHash } from 'node:crypto';

/** SHA-256 hex de una cadena. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Serialización JSON canónica: claves de objeto ordenadas
 * recursivamente → misma representación ante distinto orden de claves.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}

/** Hash de una fila (objeto) — claves ordenadas. */
export function rowHash(row: unknown): string {
  return sha256Hex(canonicalJson(row));
}

/**
 * Hash de un conjunto de filas ESTABLE ante el orden de entrada:
 * se hashea cada fila, se ordenan los hashes y se hashea el conjunto.
 */
export function snapshotHash(rows: unknown[]): string {
  const hashes = rows.map(rowHash).sort();
  return sha256Hex(hashes.join('|'));
}
