// ============================================================
// Bloque 7-A · Contratos de entrada de GET /api/snapshots (lista) y
// GET /api/snapshots/[id]/cambios (detalle) — "Bitácora". Dos schemas
// en un solo archivo porque comparten dueño (ambas rutas viven bajo
// /api/snapshots) — mismo criterio de agrupación que
// `usuarios.schema.ts` (GET/POST/PATCH conviven ahí).
// ============================================================
import { z } from 'zod';

/** Únicas 2 fuentes canónicas de snapshot (ver `FuenteSnapshot`, vigente.service.ts). */
export const snapshotsQuerySchema = z.object({
  fuente: z.enum(['stock', 'aduana']).optional(),
  /** `'YYYY-MM'`, igualdad exacta. */
  periodo: z
    .string()
    .regex(/^\d{4}-\d{2}$/, { message: 'formato de periodo inválido (YYYY-MM)' })
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SnapshotsQuery = z.infer<typeof snapshotsQuerySchema>;

export const snapshotCambiosQuerySchema = z.object({
  entidad: z.enum(['producto', 'stock', 'reserva', 'embarque']).optional(),
  tipo: z.enum(['ALTA', 'BAJA', 'MODIFICACION']).optional(),
  /** igualdad exacta (case-sensitive: nombre de columna literal). */
  campo: z.string().trim().min(1).optional(),
  /** igualdad exacta — el SKU es llave inmutable, sin normalización de casing. */
  sku: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type SnapshotCambiosQuery = z.infer<typeof snapshotCambiosQuerySchema>;
