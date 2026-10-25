// ============================================================
// Bloque 5 · /api/color — asigna/quita el color curado de un SKU.
// Escritura protegida por `requireAdminSession` (rol='admin' en
// `perfiles`) — las policies admin de `productos_metadata`
// (0002_rls.sql) aplican igual con el cliente de sesión: defensa en
// profundidad. Cero lógica de dominio aquí: valida y delega en
// `color.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { colorSchema } from '@/schemas/color.schema';
import { setColor } from '@/services/color.service';
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

  const parsed = colorSchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    // [MVP-2] A · el actor ya NO se calcula aquí: lo resuelve la RPC
    // `aplicar_metadata` (0017) desde el JWT, mismo criterio que
    // `aplicar_override`. Calcularlo en JS y mandarlo era darle al cliente
    // un campo de identidad que nunca debió viajar.
    const result = await setColor(db, parsed.data);

    if (result.tipo === 'sku_no_encontrado') {
      return apiError('sku_no_encontrado', { message: 'SKU no encontrado en el catálogo' });
    }
    return NextResponse.json(result.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/color', e);
  }
}
