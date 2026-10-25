// ============================================================
// Bloque 7-A · /api/embarques — Libro Mayor: TODOS los embarques del
// snapshot 'aduana' vigente (activos + histórico), a diferencia de
// `/api/cruce` (solo los 11 activos, agrupados por etapa). Lectura
// protegida por sesión (`requireSession`, cualquier rol autenticado).
// Cero lógica de dominio aquí: valida query string y delega en
// `listEmbarques`.
//
// Cliente + gate + validación + service, TODO dentro del mismo `try`
// (lección FIX-RESET: un throw fuera del try sale como 500 no-JSON).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { embarquesQuerySchema } from '@/schemas/embarques.schema';
import { listEmbarques } from '@/services/embarques.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A4 (auditoría de seguridad) · maxDuration=30s. Sin medición
// propia de ESTA ruta — por analogía DIRECTA a /api/inventory (medido
// por la auditoría: 0.57–1.76 s): `embarques.service.ts`
// declara en su propia cabecera usar "el mismo patrón que
// inventory.service.ts: 3 fetchAllRows SIN lista de skus", con MENOS
// filas hoy (muchos menos embarques que productos, cota de diseño ~5.000).
// Mismo tramo de 30s que su análogo medido.
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const raw = searchParamsToObject(req);
    const parsed = embarquesQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_query', { issues: parsed.error.issues });
    }

    const result = await listEmbarques(db, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/embarques', e);
  }
}
