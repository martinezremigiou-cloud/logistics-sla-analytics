// ============================================================
// Bloque 5 · /api/health — estado del sistema.
// Lectura protegida por sesión (`requireSession`, cualquier rol
// autenticado). Expone si hay snapshot vigente por cada fuente
// canónica ('stock' y 'aduana'). Cero lógica de dominio aquí: delega
// a `getHealth`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { getHealth } from '@/services/health.service';
import { apiError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  try {
    const result = await getHealth(db);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    // BD no disponible (o snapshots inaccesible): se registra el detalle
    // server-side, pero NUNCA se filtran internals de PG al cliente.
    console.error('[api/health] no_disponible', e);
    return apiError('no_disponible', { message: 'Base de datos no disponible' });
  }
}
