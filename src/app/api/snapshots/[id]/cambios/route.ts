// ============================================================
// Bloque 7-A · /api/snapshots/[id]/cambios — Bitácora: detalle de
// cambios (diff) de UN snapshot. Lectura protegida por sesión
// (`requireSession`, NO admin — mismo criterio que /api/snapshots).
//
// `params.id` inválido como UUID → 400 `invalid_query` (a diferencia
// de `/api/pendientes/[id]`, que responde 404 ahí: aquí se ratificó
// distinguir "id malformado" de "id bien formado pero inexistente").
// Snapshot bien-formado pero inexistente → 404 `snapshot_no_encontrado`
// (`getSnapshotCambios` regresa `null`).
//
// Cliente + gate + validación + service, TODO dentro del mismo `try`
// (lección FIX-RESET: un throw fuera del try sale como 500 no-JSON).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { snapshotCambiosQuerySchema } from '@/schemas/snapshots.schema';
import { getSnapshotCambios } from '@/services/snapshots.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] O11 · maxDuration=30s. De dónde sale: esta ruta no se midió
// por separado (hueco honesto) — se usa como proxy el tramo medido más
// cercano en forma, una lectura paginada contra BD viva de la misma
// familia: `listInventory(p1,50)` = 570 ms (dato del bloque, 3 corridas).
// 30s deja amplio margen incluso si el diff de un snapshot real resulta
// más pesado que esa página de referencia.
export const maxDuration = 30;

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const idParsed = idSchema.safeParse(params.id);
    if (!idParsed.success) {
      return apiError('invalid_query', { issues: idParsed.error.issues });
    }

    const raw = searchParamsToObject(req);
    const parsed = snapshotCambiosQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_query', { issues: parsed.error.issues });
    }

    const result = await getSnapshotCambios(db, idParsed.data, parsed.data);
    if (result === null) {
      return apiError('snapshot_no_encontrado', { message: 'El snapshot no existe.' });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/snapshots/[id]/cambios', e);
  }
}
