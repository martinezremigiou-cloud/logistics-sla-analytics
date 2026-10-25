// ============================================================
// Bloque 7-A · Contrato de entrada de GET /api/embarques (zod).
// "Libro Mayor": a diferencia de `inventoryQuerySchema`/`cruce` (sin
// query), aquí `desde`/`hasta` acotan un rango de fecha sobre el campo
// elegido en `fechaCampo` — `superRefine` rechaza un rango invertido
// con 400 (issue `rango_invertido`) en vez de dejar que el service
// silenciosamente regrese cero resultados.
// ============================================================
import { z } from 'zod';

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `true` si `'YYYY-MM-DD'` es una fecha real (rechaza p.ej. '2026-02-30',
 * que el regex solo sintáctico dejaría pasar). Comparación por
 * componentes UTC — sin `Date.parse`, que en algunos motores es laxo
 * con overflow de mes/día.
 */
function esFechaValida(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const fechaSchema = z
  .string()
  .regex(FECHA_REGEX, { message: 'formato de fecha inválido (YYYY-MM-DD)' })
  .refine(esFechaValida, { message: 'fecha inválida' });

export const embarquesQuerySchema = z
  .object({
    /** substring case-insensitive sobre sku/oc_po/referencia/factura/descripción (ver embarques.service.ts). */
    q: z.string().trim().min(1).optional(),
    ambito: z.enum(['todos', 'activos', 'historial']).default('todos'),
    /** orden de `estatus_catalogo` (1..11), igualdad exacta. */
    estatus: z.coerce.number().int().min(1).max(11).optional(),
    /** igualdad case-insensitive sobre `pais_origen`; NULL nunca matchea. */
    pais: z.string().trim().min(1).optional(),
    retrasado: z
      .enum(['1', 'true', '0', 'false'])
      .default('false')
      .transform((v) => v === '1' || v === 'true'),
    /** campo sobre el que aplican `desde`/`hasta`. */
    fechaCampo: z.enum(['etd', 'eta', 'llegada']).default('eta'),
    desde: fechaSchema.optional(),
    hasta: fechaSchema.optional(),
    orden: z.enum(['eta', 'etd', 'llegada', 'sku', 'estatus', 'piezas']).default('eta'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((val, ctx) => {
    // Nunca cero-resultados en silencio: un rango invertido es un error de
    // la petición (400), no un filtro válido que no matchea nada.
    if (val.desde !== undefined && val.hasta !== undefined && val.desde > val.hasta) {
      ctx.addIssue({ code: 'custom', message: 'rango_invertido', path: ['hasta'] });
    }
  });
export type EmbarquesQuery = z.infer<typeof embarquesQuerySchema>;
