// ============================================================
// Bloque 5 · /api/override — edición trazable de familia/descripcion
// por SKU (O5) y, desde FIX-B1, de tecnologia (capturarla sólo si el Excel
// no la trae; quitarla siempre). Escritura protegida por `requireAdminSession`
// (rol='admin' en `perfiles`). Cero lógica de dominio aquí: valida y
// delega en `override.service` (aplica el cambio de forma atómica vía
// RPC `aplicar_override`).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { overrideBodySchema } from '@/schemas/override.schema';
import { setOverride } from '@/services/override.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(req: Request) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  const db = createSupabaseSessionClient();
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
    return apiError('payload_too_large');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError('invalid_body', { issues: [] });
  }

  const parsed = overrideBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const result = await setOverride(db, parsed.data);

    if (result.tipo === 'sku_no_encontrado') {
      return apiError('sku_no_encontrado', { message: 'SKU no encontrado en el catálogo' });
    }
    if (result.tipo === 'familia_invalida') {
      return apiError('valor_familia_invalido', {
        message: `La familia "${result.nombre}" no existe o está inactiva; créala primero con POST /api/familias`,
      });
    }
    if (result.tipo === 'forbidden') {
      // C5/F4: el RPC rechazó por rol (SQLSTATE 42501) pese al gate previo
      // — defensa en profundidad con semántica correcta (403, no 500).
      return apiError('forbidden', { message: 'Tu rol no permite esta acción.' });
    }
    // [FIX-B1 · verificación] Estos dos `message` los lee el admin TAL CUAL
    // en un toast de la ficha (`CODIGOS_CON_MENSAJE_SEGURO_PARA_LA_FICHA`,
    // `components/ficha/ficha-atributos.tsx`): por eso hablan con el
    // vocabulario de la pantalla («archivo de inventario», como
    // `ficha-header.tsx`) y no con el de la base. Y NO piden recargar: ante
    // cada uno la pantalla se pone al día sola (`onRechazo` de
    // `TecnologiaEditable`: `excel_manda` vuelve a pedir la ficha,
    // `tecnologia_no_seleccionable` vuelve a pedir la lista, en el mismo
    // turno en que sale el toast). «Recarga» mandaba al admin a hacer algo
    // que la pantalla ya está haciendo.
    if (result.tipo === 'excel_manda') {
      return apiError('excel_manda', {
        message: 'Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.',
      });
    }
    if (result.tipo === 'tecnologia_no_seleccionable') {
      return apiError('tecnologia_no_seleccionable', {
        message: `"${result.valor}" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.`,
      });
    }
    return NextResponse.json(result.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/override', e);
  }
}
