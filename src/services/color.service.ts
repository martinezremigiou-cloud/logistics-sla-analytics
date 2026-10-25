// ============================================================
// Bloque 5 · API · color.service.ts  (WRITE admin)
// PUT /api/color: asigna (o quita, con `color:null`) el color curado
// de un SKU en `productos_metadata`.
//
// [MVP-2] A · La escritura va por la RPC `aplicar_metadata` (0017), NO
// por un upsert directo. No es preferencia de estilo: el upsert directo
// FALLABA. `productos_metadata` es tabla de LISTA BLANCA desde
// `0012_b7b_hardening` (a `authenticated` se le quitó el SELECT de TABLA
// y se le devolvió por columna, menos `updated_by`), y PostgREST arma el
// upsert con `RETURNING *` se encadene `.select()` o no — ese `*` se
// expande y el chequeo cae en TABLA: 42501, 500 en la ruta. Medido con
// una prueba de humo contra la ruta, que salió ROJA contra el estado previo.
//
// La RPC es `SECURITY DEFINER`: corre como el dueño y no ve ese REVOKE,
// igual que `aplicar_override` / `aplicar_clasificacion_v2` /
// `resolver_pendiente`. Con esto se restaura el invariante "ninguna
// sesión de usuario escribe directo sobre una tabla de lista blanca" —
// que `scripts/guarda-lista-blanca.mjs` verifica, no declara.
//
// `updated_by` ya NO viaja desde JS: lo fija la RPC desde el JWT, mismo
// criterio que `aplicar_override`. La RPC toca SOLO la columna `color`,
// así que `imagen_url` (si ya existía) queda intacta.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ColorBody } from '@/schemas/color.schema';

export type SetColorResult =
  | { tipo: 'ok'; resultado: { sku: string; color: ColorBody['color'] } }
  | { tipo: 'sku_no_encontrado' };

/**
 * Asigna el color de un SKU. `sku_no_encontrado` si el SKU no existe
 * en `productos`. La trazabilidad (`updated_by`) la escribe la RPC desde
 * el JWT de la sesión — ver cabecera.
 */
export async function setColor(db: SupabaseClient, input: ColorBody): Promise<SetColorResult> {
  const { sku, color } = input;

  // El pre-chequeo se queda: `productos` NO es tabla de lista blanca, así
  // que esta lectura siempre funcionó, y es la que distingue "SKU que no
  // existe" (404 accionable) de la violación de FK que daría la RPC.
  const { data: productoRow, error: productoError } = await db
    .from('productos')
    .select('sku')
    .eq('sku', sku)
    .maybeSingle();
  if (productoError) throw new Error('productos: ' + productoError.message);
  if (!productoRow) return { tipo: 'sku_no_encontrado' };

  const { error: rpcError } = await db.rpc('aplicar_metadata', {
    p_sku: sku,
    p_campo: 'color',
    p_valor: color,
  });
  if (rpcError) throw new Error('aplicar_metadata: ' + rpcError.message);

  return { tipo: 'ok', resultado: { sku, color } };
}
