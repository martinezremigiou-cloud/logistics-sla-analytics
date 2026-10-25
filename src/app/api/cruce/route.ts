// ============================================================
// Bloque 5 · /api/cruce — El Cruce: pipeline de aduana por etapa (F1).
// Lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado). Sin query params. Cero lógica de dominio aquí: delega
// en `getCruce`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { getCruce } from '@/services/cruce.service';
import { internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A4 (auditoría de seguridad) · maxDuration=30s. Sin medición
// propia de ESTA ruta — por analogía a /api/inventory (medido por la
// auditoría: 0.57–1.76 s). `cruce.service.ts` hace UN solo
// `fetchAllRows` sin cota (embarques del snapshot 'aduana' vigente,
// típicamente muchas menos filas que el catálogo completo de productos)
// más un par de lookups acotados por `.in(skusActivos)` (subconjunto de
// SKUs con embarque activo, NO el catálogo entero) — estructuralmente
// más liviano que /api/inventory. Se usa el mismo tramo de 30s por
// prudencia (incluso sin medición propia, es del mismo orden de
// magnitud o menor).
export const maxDuration = 30;

export async function GET() {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await getCruce(db);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/cruce', e);
  }
}
