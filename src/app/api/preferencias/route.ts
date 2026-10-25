// ============================================================
// [INV-B9] /api/preferencias — los avisos por omisión y la marca de agua.
//
// `marcar_visto: true` mueve la MARCA DE AGUA, y **la hora la pone el
// servidor**. El cliente no propone el instante: si pudiera, podría silenciarse
// con una marca en el futuro. Es la misma regla que en el volcado de INV-B8.2
// hizo que la suma la hiciera el servidor y no el navegador — ningún dato que
// decida qué se muestra puede venir del lado que se beneficia de torcerlo.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { preferenciasSchema } from '@/schemas/avisos.schema';
import { guardarPreferencias, leerPreferencias } from '@/services/avisos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeAvisoError } from '@/lib/api/avisos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    // Devuelve los valores por omisión si el perfil aún no tiene fila: la fila
    // nace perezosa (ver la 0026) y la lectura tiene que tolerar su ausencia.
    return NextResponse.json(await leerPreferencias(db), { status: 200 });
  } catch (e) {
    return internalError('api/preferencias', e);
  }
}

export async function PATCH(req: Request) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
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

    const parsed = preferenciasSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const guardadas = await guardarPreferencias(db, gate.user.id, parsed.data, new Date());
    return NextResponse.json(guardadas, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeAvisoError(e);
    if (conocido) return conocido;
    return internalError('api/preferencias', e);
  }
}
