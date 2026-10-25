// ============================================================
// Bloque 5 · Contrato de entrada de /api/usuarios (zod).
// POST (alta): email + rol opcional (default 'kam'). PATCH
// (/api/usuarios/[id]): unión discriminada por `accion` — cada acción
// trae únicamente los campos que necesita.
// `rol` reutiliza la fuente única `ROLES` (Bloque 7-A, `@/lib/roles`)
// — mismo patrón que `color.schema.ts` con `ORDEN_COLORES_SKU`.
// ============================================================
import { z } from 'zod';
import { ROLES } from '@/lib/roles';
import type { Rol } from '@/types/enums';

const ROL_ENUM = ROLES as [Rol, ...Rol[]];

export const altaUsuarioSchema = z.object({
  email: z.string().trim().email().max(120),
  // Default se queda en 'kam' por ergonomía del alta (decisión de producto,
  // Bloque 7-A) aunque 'visitante' ya sea una opción válida aquí.
  rol: z.enum(ROL_ENUM).default('kam'),
});
export type AltaUsuarioBody = z.infer<typeof altaUsuarioSchema>;

export const patchUsuarioSchema = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('rol'), rol: z.enum(ROL_ENUM) }),
  z.object({ accion: z.literal('suspender') }),
  z.object({ accion: z.literal('reactivar') }),
  z.object({ accion: z.literal('reset_password') }),
]);
export type PatchUsuarioBody = z.infer<typeof patchUsuarioSchema>;
