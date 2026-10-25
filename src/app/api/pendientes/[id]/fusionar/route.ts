// ============================================================
// (B, [MVP-2]) /api/pendientes/[id]/fusionar — resolución de un
// pendiente `familia_nueva` por la rama "es la misma que X" (RPC
// `resolver_familia_nueva`, 0019_mvp2_familia_nueva.sql). Ruta SEPARADA
// de POST /api/pendientes/[id] (que sigue resolviendo confirmar/
// descartar genérico, incluida la rama "es una familia legítima" de
// este mismo tipo): la RPC de aquí tiene una firma distinta
// (p_destino, no p_accion/p_valor) — mismo molde EXACTO que esa otra
// ruta (requireSameOrigin + requireAdminSession + id UUID + bodyTooLarge
// + zod). Cero lógica de dominio aquí: valida y delega en
// `pendientes.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { resolverFamiliaNuevaBodySchema } from '@/schemas/pendientes.schema';
import { resolverFamiliaNueva } from '@/services/pendientes.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  const db = createSupabaseSessionClient();
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  if (!idSchema.safeParse(params.id).success) {
    return apiError('pendiente_no_encontrado', { message: 'El pendiente no existe.' });
  }

  if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
    return apiError('payload_too_large');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError('invalid_body', { issues: [] });
  }

  const parsed = resolverFamiliaNuevaBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const result = await resolverFamiliaNueva(db, params.id, parsed.data);

    if (result.tipo === 'forbidden') {
      return apiError('forbidden', { message: 'Tu rol no permite esta acción.' });
    }
    if (result.tipo === 'no_encontrado') {
      return apiError('pendiente_no_encontrado', { message: 'El pendiente no existe.' });
    }
    if (result.tipo === 'invalido') {
      return apiError('pendiente_invalido', { message: result.message });
    }
    if (result.tipo === 'no_disponible') {
      return apiError('no_disponible', { message: 'Esta resolución aún no está disponible.' });
    }
    return NextResponse.json(result.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/pendientes/[id]/fusionar', e);
  }
}
