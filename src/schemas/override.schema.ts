// ============================================================
// Bloque 3 · Contrato de entrada de PUT /api/override (zod).
// `sku` reutiliza `skuParamSchema` (trim + UPPER) — misma normalización
// que GET /api/sku/[sku], así el lookup contra `productos.sku` pega
// sin importar el casing con el que llegue del cliente.
// `campo` enumera LITERALMENTE los tres valores de `CampoOverride`
// (`@/types/enums`) — zod no puede derivar su enum de un type alias de
// TS, así que esta lista se mantiene a mano en sincronía con esa unión.
// `valor: null` (Bloque 5 · C2) es una entrada válida: significa "quitar
// el override" (reversión REAL a la fuente, D3) — ver `override.service.ts`
// y el RPC `aplicar_override` (0006_b5_dominio.sql, ampliado por FIX-B1/T2a
// con `campo='tecnologia'`).
// ============================================================
import { z } from 'zod';
import { skuParamSchema } from './sku.schema';

export const overrideBodySchema = z.object({
  sku: skuParamSchema,
  campo: z.enum(['familia', 'descripcion', 'tecnologia']),
  valor: z.string().trim().min(1).max(2000).nullable(),
});
export type OverrideBody = z.infer<typeof overrideBodySchema>;
