// ============================================================
// Bloque 6 · F2 · Contrato de entrada de POST /api/pendientes/[id] (zod).
// Unión discriminada por `accion` (mismo patrón que `patchUsuarioSchema`,
// usuarios.schema.ts): cada acción trae únicamente los campos que
// necesita. `motivo` es OBLIGATORIO en 'descartar' (mismo requisito que
// valida — de nuevo — el RPC `resolver_pendiente`, 22023 "motivo
// requerido para descartar"; validarlo aquí evita el viaje redondo)
// y OPCIONAL en 'confirmar' (el RPC no lo exige). `valor` es SIEMPRE
// opcional: solo lo usa el RPC cuando `tipo==='kam_desconocido'` y
// `accion==='confirmar'` (nombre real del KAM, si difiere del crudo
// detectado); para el resto de tipos/acciones el RPC lo ignora.
// ============================================================
import { z } from 'zod';

export const resolverPendienteBodySchema = z.discriminatedUnion('accion', [
  z.object({
    accion: z.literal('confirmar'),
    motivo: z.string().trim().min(1).max(2000).optional(),
    valor: z.string().trim().min(1).max(500).optional(),
  }),
  z.object({
    accion: z.literal('descartar'),
    motivo: z.string().trim().min(1).max(2000),
    valor: z.string().trim().min(1).max(500).optional(),
  }),
]);
export type ResolverPendienteBody = z.infer<typeof resolverPendienteBodySchema>;

// ============================================================
// (B, [MVP-2]) Contrato de entrada de POST /api/pendientes/[id]/fusionar
// — SOLO para `familia_nueva`, rama "es la misma que X" (RPC
// `resolver_familia_nueva`, 0019_mvp2_familia_nueva.sql). `motivo` es
// opcional (mismo criterio que 'confirmar' arriba: el RPC lo defaultea a
// NULL) — el cliente lo puebla con la traza "Fusionada con «X»" para que
// quede visible en `resolucion.motivo` (mismo render genérico que ya usa
// `pendiente-fila.tsx`), pero el contrato no lo exige.
// ============================================================
export const resolverFamiliaNuevaBodySchema = z.object({
  destino: z.string().trim().min(1).max(120),
  motivo: z.string().trim().min(1).max(2000).optional(),
  /** Confirmación de doble llave — ver `fusionarFamiliaBodySchema` (familias.schema.ts). */
  skusEsperados: z.number().int().min(0),
});
export type ResolverFamiliaNuevaBody = z.infer<typeof resolverFamiliaNuevaBodySchema>;
