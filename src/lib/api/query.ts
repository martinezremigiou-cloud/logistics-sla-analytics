// ============================================================
// Bloque 3 · API · query.ts  (PURO)
// Aplana los `URLSearchParams` de una `Request` a un objeto plano
// `Record<string, string>`, listo para `schema.safeParse(raw)`.
// Consumido por `/api/inventory` y `/api/familias` (GET).
// ============================================================

/**
 * Convierte `req.url` search params a un objeto plano. Si una clave se
 * repite (p.ej. `?marca=A&marca=B`), gana la ÚLTIMA ocurrencia: `forEach`
 * itera los pares en el orden en que llegaron en la URL y cada iteración
 * sobrescribe `raw[key]`, así que el último `marca=B` pisa al primero.
 */
export function searchParamsToObject(req: Request): Record<string, string> {
  const searchParams = new URL(req.url).searchParams;
  const raw: Record<string, string> = {};
  // `forEach` (no `for...of` sobre el iterador) — el target de tsconfig.json
  // no habilita downlevelIteration.
  searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  return raw;
}
