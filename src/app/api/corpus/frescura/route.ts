// ============================================================
// [INV-B11] O7 · /api/corpus/frescura — el testigo, servido.
//
// Cuatro lecturas y ninguna derivación: la decisión de QUÉ SIGNIFICAN los dos
// instantes vive en `src/lib/corpus/frescura.ts`, pura y probada sin base.
// Aquí solo se traen.
//
// **Con el cliente de SESIÓN**, igual que todo lo demás. Las tres tablas del
// corpus están abiertas a `authenticated` desde la 0032 y la 0035, así que la
// RLS aplica y este endpoint no ve nada que su usuario no viera.
//
// Sin caché: el testigo dice CUÁNDO se miró por última vez, y una respuesta
// cacheada convertiría eso en una mentira que envejece sola.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { requireSession } from '@/lib/api/auth';
import { apiError } from '@/lib/api/errors';
import { leerFrescura } from '@/services/corpus-consulta.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const db = createSupabaseSessionClient();
  const gate = await requireSession(db);
  if (gate instanceof NextResponse) return gate;

  try {
    const datos = await leerFrescura(db);
    return NextResponse.json(datos, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[api/corpus/frescura] no_disponible', e);
    return apiError('no_disponible', { message: 'No se pudo leer el estado del corpus' });
  }
}
