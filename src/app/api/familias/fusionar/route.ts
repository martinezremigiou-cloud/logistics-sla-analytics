// ============================================================
// [MVP-2] C · /api/familias/fusionar — fusión declarativa de familias
// vía alias (RPC `fusionar_familia`, 0018_mvp2_familia_alias.sql).
// GET: alcance de la fusión ANTES de confirmar (lectura pura, admin —
// no toca la RPC, funciona aunque 0018 no esté aplicada). POST: alta
// admin del alias + desactivación de la absorbida, mismo molde EXACTO
// que POST /api/familias (requireSameOrigin + requireAdminSession +
// bodyTooLarge + zod). Cero lógica de dominio aquí: valida y delega en
// `familias.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { fusionarFamiliaPreviewQuerySchema, fusionarFamiliaBodySchema } from '@/schemas/familias.schema';
import { previsualizarFusion, fusionarFamilia } from '@/services/familias.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { searchParamsToObject } from '@/lib/api/query';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const db = createSupabaseSessionClient();
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  const raw = searchParamsToObject(req);

  const parsed = fusionarFamiliaPreviewQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_query', { issues: parsed.error.issues });
  }

  try {
    const result = await previsualizarFusion(db, parsed.data.alias);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/familias/fusionar', e);
  }
}

export async function POST(req: Request) {
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

  const parsed = fusionarFamiliaBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const outcome = await fusionarFamilia(
      db,
      parsed.data.alias,
      parsed.data.destino,
      parsed.data.skusEsperados,
    );

    if (outcome.tipo === 'forbidden') {
      return apiError('forbidden', { message: 'Tu rol no permite esta acción.' });
    }
    if (outcome.tipo === 'no_encontrada') {
      return apiError('familia_no_encontrada', { message: outcome.message });
    }
    if (outcome.tipo === 'invalido') {
      return apiError('fusion_invalida', { message: outcome.message });
    }
    if (outcome.tipo === 'no_disponible') {
      return apiError('no_disponible', { message: 'La fusión de familias aún no está disponible.' });
    }
    return NextResponse.json(outcome.resultado, { status: 200 });
  } catch (e) {
    return internalError('api/familias/fusionar', e);
  }
}
