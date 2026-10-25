// ============================================================
// Bloque 6 · /api/dashboard — KPIs, heatmap, radar, rankings,
// pipeline, tendencia y alertas-enlace de la página `/` (F1).
// Lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado) — mismo gate que /api/inventory y /api/cruce; el
// conteo de pendientes viaja AQUÍ (vía RPC `contar_pendientes`,
// abierta a cualquier autenticado), la LISTA admin-only vive en
// /api/pendientes. Cero lógica de dominio aquí: delega en `getDashboard`.
//
// (INV-TAXO F4) `?tecnologia` opcional — filtra SOLO el heatmap del
// dashboard (ver la asimetría documentada en `dashboard.service.ts`).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { dashboardQuerySchema } from '@/schemas/dashboard.schema';
import { getDashboard } from '@/services/dashboard.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { searchParamsToObject } from '@/lib/api/query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] O11 · maxDuration=30s. De dónde sale: `getDashboard` midió
// 1.03 s contra BD viva (3 corridas) — es la pantalla de aterrizaje (F1),
// la que más volumen de queries agrega en una sola respuesta. 30s da
// ~29× de holgura sobre el tramo medido.
export const maxDuration = 30;

export async function GET(req: Request) {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  const raw = searchParamsToObject(req);
  const parsed = dashboardQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_query', { issues: parsed.error.issues });
  }

  try {
    const result = await getDashboard(db, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/dashboard', e);
  }
}
