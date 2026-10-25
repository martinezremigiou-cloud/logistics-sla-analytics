// ============================================================
// Bloque 5 · API · imagenes.service.ts  (WRITE admin)
// POST /api/imagenes: sube la imagen de un SKU al bucket
// `producto-imagenes` y actualiza `productos_metadata.imagen_url`.
// `db` DEBE ser el cliente de SESIÓN del admin autenticado (NO
// service_role): las policies de `storage.objects`
// (0007_b5_storage.sql) exigen `bucket_id='producto-imagenes' AND
// public.is_admin()`, evaluado contra el JWT de la sesión — ese
// chequeo (no este servicio) es el enforcement real de la escritura
// en Storage.
//
// [MVP-2] A · La escritura de `productos_metadata` va por la RPC
// `aplicar_metadata` (0017), no por un upsert directo — mismo motivo y
// misma medición que `color.service.ts`, ver su cabecera. `updated_by`
// lo fija la RPC desde el JWT, ya no viaja desde JS.
//
// NO ATÓMICO, y ahora medido: el objeto se sube a Storage ANTES de tocar
// la BD, así que un fallo del upsert deja el archivo subido sin nadie que
// lo referencie. Se observó en vivo durante una corrida ROJA de
// una prueba de humo contra la ruta (500 en la ruta, objeto presente en el
// bucket). El arreglo de este bloque elimina la causa conocida de ese
// fallo, pero no la no-atomicidad: queda como deuda declarada, porque
// cerrarla exige o subir después de escribir (y entonces la fila apunta a
// una URL que aún no existe) o una compensación explícita.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { TIPOS_IMAGEN, rutaImagen, variantesImagen } from '@/lib/imagenes';

const BUCKET = 'producto-imagenes';

export interface SubirImagenInput {
  sku: string;
  buffer: ArrayBuffer;
  contentType: string;
}

export type SubirImagenResult =
  | { tipo: 'ok'; resultado: { sku: string; imagen_url: string } }
  | { tipo: 'sku_no_encontrado' };

/**
 * Sube la imagen y deja `productos_metadata` apuntando a la nueva URL
 * pública. `contentType` YA fue validado por `validarImagen` (route) —
 * `TIPOS_IMAGEN[contentType]` solo puede faltar si el caller se saltó
 * esa validación, caso defensivo que se trata como error interno.
 */
export async function subirImagen(
  db: SupabaseClient,
  input: SubirImagenInput,
): Promise<SubirImagenResult> {
  const { sku, buffer, contentType } = input;

  const { data: productoRow, error: productoError } = await db
    .from('productos')
    .select('sku')
    .eq('sku', sku)
    .maybeSingle();
  if (productoError) throw new Error('productos: ' + productoError.message);
  if (!productoRow) return { tipo: 'sku_no_encontrado' };

  const ext = TIPOS_IMAGEN[contentType];
  if (!ext) throw new Error('subirImagen: contentType no soportado: ' + contentType);

  const path = rutaImagen(sku, ext);
  const { error: uploadError } = await db.storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true });
  if (uploadError) throw new Error('storage.upload: ' + uploadError.message);

  // Limpia variantes previas de OTRA extensión (p.ej. una subida anterior en
  // .jpg cuando ahora se sube en .png). Idempotente por diseño — el resultado
  // (incluido "no existía nada que borrar") se ignora a propósito.
  //
  // [MVP-2, hallazgo A6 de la auditoría] Va DESPUÉS del upload y EXCLUYE la
  // extensión que se acaba de escribir. Antes iba ANTES y borraba las TRES
  // variantes, incluida la que se estaba por subir: si el upload fallaba, la
  // imagen anterior ya no existía y `productos_metadata.imagen_url` seguía
  // apuntando a la ruta borrada. Eso no era un huérfano, era PÉRDIDA DE DATO.
  // Este orden la elimina; la no-atomicidad del par Storage↔BD sigue viva y
  // declarada (MVP2-1).
  const otras = variantesImagen(sku).filter((v) => v !== path);
  if (otras.length > 0) await db.storage.from(BUCKET).remove(otras);

  const {
    data: { publicUrl },
  } = db.storage.from(BUCKET).getPublicUrl(path);

  const { error: rpcError } = await db.rpc('aplicar_metadata', {
    p_sku: sku,
    p_campo: 'imagen_url',
    p_valor: publicUrl,
  });
  if (rpcError) throw new Error('aplicar_metadata: ' + rpcError.message);

  return { tipo: 'ok', resultado: { sku, imagen_url: publicUrl } };
}
