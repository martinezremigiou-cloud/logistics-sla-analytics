// ============================================================
// Bloque 3 · API · ilike.ts  (PURO)
// Escapa los caracteres especiales de ILIKE (`%`, `_`, `\`) para que
// un valor de usuario se compare como texto literal, no como patrón —
// evita que un valor con esos caracteres actúe como wildcard.
// Consumido por `familias.service.ts` y `override.service.ts`.
// ============================================================

/** Escapa `\`, `%` y `_` anteponiendo `\` — comparación literal en un `.ilike()`. */
export function escaparLike(v: string): string {
  return v.replace(/[\\%_]/g, (c) => `\\${c}`);
}
