// ============================================================
// Bloque 5 · /api/imagenes — sube la imagen de un SKU (multipart/form-data).
// Escritura protegida por `requireAdminSession`. La cota de tamaño REAL
// del archivo (2 MB, byte a byte) la sigue aplicando `validarImagen` —
// eso no cambia: `Content-Length` es un dato que declara el cliente, no
// una medición confiable del archivo en sí.
//
// [INV-B7B] A3 (auditoría de seguridad) · lo que SÍ cambia: antes de
// materializar el body completo en memoria (`req.formData()` +
// `archivo.arrayBuffer()`), se rechaza por `Content-Length` declarado
// (best-effort, mismo helper `bodyTooLarge` que ya usan
// /api/clasificacion y /api/refresh). Medido en la auditoría: sin este
// corte, un archivo grande hacía crecer el RSS del proceso varias veces
// su tamaño ANTES de que `validarImagen` pudiera
// devolver el 413 — el corte ahora pasa ANTES de `formData()`, no
// después. Decisión documentada sobre el caso "Content-Length ausente"
// (p.ej. `Transfer-Encoding: chunked`): igual que en /api/clasificacion,
// `bodyTooLarge` es BEST-EFFORT — si el header falta o no es numérico,
// esta pre-cota NO dispara y el flujo sigue a `formData()` (el 413 real
// llega más tarde, vía `validarImagen`, ya con el archivo en memoria).
// Evadible por un cliente que mienta o no mande el header a propósito —
// deuda declarada, NO resuelta aquí (aceptable detrás de
// `requireAdminSession`, portal interno de pocos usuarios, mismo supuesto que
// `body.ts`); una cota dura por streaming queda fuera de este bloque.
//
// Cero lógica de dominio aquí: valida y delega en `imagenes.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { skuParamSchema } from '@/schemas/sku.schema';
import { validarImagen, MAX_IMAGEN_BYTES } from '@/lib/imagenes';
import { subirImagen } from '@/services/imagenes.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A3/A4 · maxDuration=30s. Sin medición propia de ESTA ruta —
// por analogía: es un único upload acotado (≤2 MB, ahora rechazado ANTES
// de materializar, ver arriba) a Storage de Supabase (1 llamada de
// limpieza best-effort + 1 upload) más 2 consultas puntuales a BD (1 select
// por sku + 1 upsert de metadata) — mismo orden de magnitud que los tramos
// SÍ medidos en este bloque (`getDashboard` 1.03 s; los reads de
// STOCK/ADUANA en /api/refresh: 701 ms / 527 ms), ninguno de los cuales
// mueve varios MB a un storage externo. Se usa el mismo tramo de 30s que
// /api/dashboard (no el de 60s de /api/refresh: aquella ruta lo justifica
// por segmentos de escritura masiva SIN medir, que aquí no existen — es
// una escritura de UN solo archivo).
export const maxDuration = 30;

/**
 * Tope del `Content-Length` de la request COMPLETA (multipart), no solo
 * del archivo: se le da holgura de 64 KiB sobre `MAX_IMAGEN_BYTES` para
 * el overhead propio de multipart (boundary + headers de cada parte +
 * el campo `sku`) — así un archivo legítimo de ~2 MB justo en el límite
 * no cae en un 413 falso por el overhead del envoltorio. El tope REAL
 * del archivo (exacto, byte a byte) lo sigue aplicando `validarImagen`.
 */
const MAX_BODY_IMAGENES = MAX_IMAGEN_BYTES + 65_536;

export async function POST(req: Request) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  const db = createSupabaseSessionClient();
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  if (bodyTooLarge(req, MAX_BODY_IMAGENES)) {
    return apiError('payload_too_large');
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return apiError('invalid_body', { issues: [] });
  }

  const skuParsed = skuParamSchema.safeParse(form.get('sku'));
  if (!skuParsed.success) {
    return apiError('invalid_body', { issues: skuParsed.error.issues });
  }

  const archivo = form.get('archivo');
  if (!(archivo instanceof File)) {
    return apiError('invalid_body', { message: 'Falta el archivo de imagen ("archivo").' });
  }

  const buffer = await archivo.arrayBuffer();
  const validado = validarImagen(buffer, archivo.type);
  if (!validado.ok) {
    if (validado.motivo === 'tamano') {
      return apiError('payload_too_large');
    }
    return apiError('invalid_body', { message: 'Formato no válido. Usa PNG, JPG o WEBP (máx. 2 MB).' });
  }

  try {
    // [MVP-2] A · el actor lo resuelve la RPC `aplicar_metadata` (0017)
    // desde el JWT — mismo criterio que /api/color.
    const result = await subirImagen(db, { sku: skuParsed.data, buffer, contentType: archivo.type });

    if (result.tipo === 'sku_no_encontrado') {
      return apiError('sku_no_encontrado', { message: 'SKU no encontrado en el catálogo' });
    }
    return NextResponse.json(result.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/imagenes', e);
  }
}
