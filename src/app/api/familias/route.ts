// ============================================================
// Bloque 5 · /api/familias — catálogo controlado de familias (O4).
// GET: lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado). POST: alta admin, protegida por `requireAdminSession`
// (rol='admin' en `perfiles`). Cero lógica de dominio aquí: valida y
// delega en `familias.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { familiasQuerySchema, familiaBodySchema } from '@/schemas/familias.schema';
import { listFamilias, createFamilia } from '@/services/familias.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession, requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { searchParamsToObject } from '@/lib/api/query';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  const raw = searchParamsToObject(req);

  const parsed = familiasQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_query', { issues: parsed.error.issues });
  }

  try {
    const result = await listFamilias(db, parsed.data.incluirInactivas);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/familias', e);
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

  const parsed = familiaBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const result = await createFamilia(db, parsed.data.nombre);
    if (!result.ok) {
      return apiError('familia_duplicada', { message: 'La familia ya existe en el catálogo' });
    }
    // `reactivada` (D, [MVP-2]): distingue para el cliente un alta real de
    // la reactivación de una familia inactiva homónima — ConfigFamilias lo
    // usa para elegir el texto del toast (ver familias.service.ts).
    return NextResponse.json(
      { ...result.familia, reactivada: result.origen === 'reactivada', aliasVivo: result.aliasVivo === true },
      { status: 201 },
    );
  } catch (e) {
    return internalError('api/familias', e);
  }
}
