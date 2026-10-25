// ============================================================
// Bloque 3 · API · body.ts  (PURO)
// Cota de tamaño de body para las rutas de ESCRITURA admin
// (POST /api/familias, PUT /api/override), mismo patrón que
// `src/app/api/refresh/route.ts` (`isTooLarge`, B2). Best-effort por
// `content-length` — igual que B2-5, se evade si el header falta o la
// request es chunked; aceptable detrás de `requireAdminSession` con
// pocos usuarios (portal interno; mismo supuesto que `usuarios.service.ts`).
// Cota dura por streaming es deuda diferida a Bloque 7.
// ============================================================

/** Payloads reales de familias/override son <3 KB; 64 KB deja holgura amplia. */
export const MAX_BODY_BYTES_ESCRITURA = 64_000;

/** `true` si `content-length` declara más de `maxBytes`. Header ausente/no numérico → `false` (best-effort). */
export function bodyTooLarge(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get('content-length'));
  return Number.isFinite(len) && len > maxBytes;
}
