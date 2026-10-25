// ============================================================
// Bloque INV-TAXO · R2-3 · lib · orden.ts  (100% PURO)
// Comparadores de orden compartidos por los servicios de lectura B3+.
// Antes `cmpStr` vivía duplicada, idéntica, en 4 archivos de
// `src/services` (inventory/dashboard/embarques/snapshots.service.ts) —
// una sola fuente evita que diverjan en silencio.
// ============================================================

/**
 * Comparación de string simple ASC: determinismo, NUNCA `localeCompare`
 * (criterio compartido por todo el dominio de lectura B3+ — mismo orden
 * que usan las facetas del catálogo, las columnas del heatmap y el
 * desempate de marcas/etiquetas).
 */
export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
