// ============================================================
// Bloque 7-A · /api/snapshots — Bitácora: historial de ingestas
// (lista). Lectura protegida por sesión (`requireSession`, NO admin:
// la RLS de `snapshots` es `USING(true)` para autenticados y el nav
// no marca esta pantalla `adminOnly`). Cero lógica de dominio aquí:
// valida query string y delega en `listSnapshots`.
//
// Cliente + gate + validación + service, TODO dentro del mismo `try`
// (lección FIX-RESET: un throw fuera del try sale como 500 no-JSON).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { snapshotsQuerySchema } from '@/schemas/snapshots.schema';
import { listSnapshots } from '@/services/snapshots.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const raw = searchParamsToObject(req);
    const parsed = snapshotsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_query', { issues: parsed.error.issues });
    }

    const result = await listSnapshots(db, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/snapshots', e);
  }
}
