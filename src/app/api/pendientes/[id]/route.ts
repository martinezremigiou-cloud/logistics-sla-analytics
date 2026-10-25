// ============================================================
// Bloque 6 · F2 · /api/pendientes/[id] — resolución trazable
// (confirmar/descartar) de un pendiente de datos. Escritura ADMIN-only
// (`requireAdminSession`, vía el cliente de SESIÓN — el JWT del admin
// DEBE viajar al RPC `resolver_pendiente` para que `is_admin()`/
// `auth.jwt()` resuelvan dentro de la transacción; mismo patrón que
// PUT /api/override, B5). Cero lógica de dominio aquí: valida y
// delega en `pendientes.service`.
//
// `params.id` se valida como UUID ANTES de llamar al service (fix M1,
// ronda post-revisión de B6): un id malformado NUNCA es una fila real
// de `pendientes_datos` (columna `uuid`), así que se trata como
// "recurso inexistente" — 404 `pendiente_no_encontrado`, NO 400 (el
// malformado no es un problema del BODY, es del recurso de la URL).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { resolverPendienteBodySchema } from '@/schemas/pendientes.schema';
import { resolverPendiente } from '@/services/pendientes.service';
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

  const parsed = resolverPendienteBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const result = await resolverPendiente(db, params.id, parsed.data);

    if (result.tipo === 'forbidden') {
      // C5/F4: el RPC rechazó por rol (SQLSTATE 42501) pese al gate previo.
      return apiError('forbidden', { message: 'Tu rol no permite esta acción.' });
    }
    if (result.tipo === 'no_encontrado') {
      return apiError('pendiente_no_encontrado', { message: 'El pendiente no existe.' });
    }
    if (result.tipo === 'invalido') {
      return apiError('pendiente_invalido', { message: result.message });
    }
    return NextResponse.json(result.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/pendientes/[id]', e);
  }
}
