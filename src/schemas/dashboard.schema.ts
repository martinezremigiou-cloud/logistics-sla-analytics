// ============================================================
// Bloque · INV-TAXO · F2 · Contrato de entrada de GET /api/dashboard
// (zod). Antes de este bloque, la ruta no aceptaba query params (ver
// `dashboard.service.ts`). `tecnologia` filtra SOLO el heatmap
// marca×almacén (KPIs/radar/rankings/pipeline/tendencia/alertas siguen
// globales, ver la asimetría documentada en la cabecera de
// `dashboard.service.ts`) — mismo shape/criterio que
// `inventoryQuerySchema.tecnologia`: acepta el sentinel `SIN_TECNOLOGIA`
// (`src/lib/clasificacion.ts`) para filtrar por tecnología efectiva nula.
// ============================================================
import { z } from 'zod';

// (INV-TAXO, cierre de auditoría) Mismo .max(500) y misma evidencia
// medida que `inventoryQuerySchema` (`src/schemas/inventory.schema.ts`):
// unos cientos de caracteres es la celda `familia` compuesta más larga del
// catálogo real, 500 la cubre con margen. `tecnologia` comparte forma/criterio
// con `inventoryQuerySchema.tecnologia` (ver cabecera del archivo).
const MAX_FILTRO_TEXTO = 500;

export const dashboardQuerySchema = z.object({
  /** Igualdad case-insensitive sobre la tecnología EFECTIVA del heatmap; `SIN_TECNOLOGIA` filtra marcas cuyos SKUs no tienen tecnología. */
  tecnologia: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
