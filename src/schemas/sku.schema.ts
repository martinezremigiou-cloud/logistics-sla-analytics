// ============================================================
// Bloque 3 · Contrato de entrada de GET /api/sku/[sku] (zod).
//
// Normalización del SKU: `src/services/etl/normalize.ts` define
// `normalizeSku` como la ÚNICA fuente de la regla — trim + UPPER
// (vacío → null; ver normalize.ts:11-16). El ETL persiste
// `productos.sku` ya normalizado así (ingestado vía ese mismo
// helper en `parse.inventario.ts` y demás parsers). Para que el
// lookup contra `productos.sku` pegue sin importar cómo llegue
// capitalizado el segmento de ruta (`/api/sku/dd8309-g` vs
// `/api/sku/DD8309-G`), el param se normaliza IGUAL aquí: trim +
// UPPER. No se reutiliza `normalizeSku` directamente (retorna
// `string | null` sobre `Cell`; aquí el param YA es `string` y un
// vacío debe ser 400 `invalid_query`, no un lookup silencioso).
// ============================================================
import { z } from 'zod';

export const skuParamSchema = z.string().trim().min(1).transform((s) => s.toUpperCase());
export type SkuParam = z.infer<typeof skuParamSchema>;
