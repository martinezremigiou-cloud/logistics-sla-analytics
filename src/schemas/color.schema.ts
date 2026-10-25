// ============================================================
// Bloque 5 · Contrato de entrada de PUT /api/color (zod).
// `sku` reutiliza `skuParamSchema` (trim + UPPER) — mismo criterio de
// normalización que override/sku. `color` es la paleta curada de 8
// slugs, derivada de la fuente única `ORDEN_COLORES_SKU` (M4) — CHECK
// espejo en `productos_metadata.color` (0006_b5_dominio.sql); `null`
// es una entrada válida (quitar el color asignado).
// ============================================================
import { z } from 'zod';
import { skuParamSchema } from './sku.schema';
import { ORDEN_COLORES_SKU, type ColorSku } from '@/lib/colores-sku';

export const colorSchema = z.object({
  sku: skuParamSchema,
  color: z.enum(ORDEN_COLORES_SKU as [ColorSku, ...ColorSku[]]).nullable(),
});
export type ColorBody = z.infer<typeof colorSchema>;
