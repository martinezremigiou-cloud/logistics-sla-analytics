// ============================================================
// Bloque 3 · Contrato de entrada de /api/familias (zod).
// GET: query de listado. POST: alta de familia (escritura admin).
// ============================================================
import { z } from 'zod';

export const familiasQuerySchema = z.object({
  incluirInactivas: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type FamiliasQuery = z.infer<typeof familiasQuerySchema>;

export const familiaBodySchema = z.object({
  nombre: z.string().trim().min(1).max(120),
});
export type FamiliaBody = z.infer<typeof familiaBodySchema>;

// ============================================================
// [MVP-2] C · Contrato de /api/familias/fusionar (admin).
// GET: query del alcance ANTES de confirmar (solo lee `familias`/
// `productos`, no toca la RPC — funciona aunque 0018 no esté aplicada).
// POST: ejecuta la fusión vía RPC `fusionar_familia` (0018).
// ============================================================

export const fusionarFamiliaPreviewQuerySchema = z.object({
  alias: z.string().trim().min(1).max(120),
});
export type FusionarFamiliaPreviewQuery = z.infer<typeof fusionarFamiliaPreviewQuerySchema>;

export const fusionarFamiliaBodySchema = z.object({
  alias: z.string().trim().min(1).max(120),
  destino: z.string().trim().min(1).max(120),
  /**
   * CONFIRMACIÓN DE DOBLE LLAVE. Es el conteo de SKU que la previsualización
   * le MOSTRÓ al admin, devuelto tal cual. `fusionar_familia` (0018) lo
   * contrasta contra su propio conteo y aborta si no coincide.
   *
   * No es redundancia: la RPC es alcanzable por `/rest/v1/rpc/` sin pasar por
   * esta ruta, así que dejar el alcance solo en la pantalla era P13 — la
   * protección viviendo en el cliente. Exigirlo obliga a que quien fusiona
   * haya MIRADO el número, y a que ese número siga siendo cierto cuando
   * confirma (si una ingesta movió SKU entre la previsualización y el clic,
   * la fusión se detiene en vez de aplicarse a ciegas).
   */
  skusEsperados: z.number().int().min(0),
});
export type FusionarFamiliaBody = z.infer<typeof fusionarFamiliaBodySchema>;
