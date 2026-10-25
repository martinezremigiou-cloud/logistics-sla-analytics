// ============================================================
// B-PARCHE · F2 · Contrato de entrada de POST /api/clasificacion (zod).
// `gridSchema` es una copia LOCAL (misma forma que
// `src/schemas/refresh.schema.ts`) a propósito: esta ruta es una
// frontera de validación independiente del pipeline de ingesta de
// Bloque 2 — no importa de `refresh.schema.ts` para no acoplar
// contratos de features distintas.
// ============================================================
import { z } from 'zod';

/** Celda cruda tal como llega del bridge/script (Excel). */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Matriz de celdas: el builder localiza header/columnas por contenido. */
const gridSchema = z.array(z.array(cellSchema));

export const clasificacionBodySchema = z.object({
  /** Identifica la corrida de origen (trazabilidad en `clasificacion_v2.fuente_version`). */
  fuente_version: z.string().trim().min(1).max(40),
  /** `true`: solo calcula y regresa el reporte, sin invocar la RPC de escritura. */
  dryRun: z.boolean().default(false),
  hojas: z.object({
    inventario: gridSchema,
    west: gridSchema,
  }),
});
export type ClasificacionBody = z.infer<typeof clasificacionBodySchema>;
