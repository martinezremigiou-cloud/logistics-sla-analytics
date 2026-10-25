// ============================================================
// [FIX-B1] /api/tecnologias — vocabulario SELECCIONABLE de tecnología
// (O8). GET: lectura protegida por sesión (`requireSession`, cualquier
// rol autenticado — mismo molde que `GET /api/familias`). Cero lógica de
// dominio aquí: valida la sesión y delega en `tecnologias.service`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { listTecnologiasSeleccionables } from '@/services/tecnologias.service';
import { internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  try {
    const items = await listTecnologiasSeleccionables(db);
    return NextResponse.json({ items }, { status: 200 });
  } catch (e) {
    return internalError('api/tecnologias', e);
  }
}
