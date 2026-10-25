// ============================================================
// [INV-B9] /api/seguimientos — la lista (GET) y seguir un SKU (POST).
//
// GET DEVUELVE `{ items }`, envuelto, porque es un endpoint de LISTA y ésa es
// la convención de la casa (`/api/proyectos`, `/api/usuarios`,
// `/api/familias`). No es un detalle de estilo: en INV-B8.2 un consumidor
// declaró un arreglo pelón sobre uno de esos endpoints, `tsc` salió limpio —el
// genérico de `useApi<T>` es una AFIRMACIÓN, no una comprobación— y reventó en
// el navegador. `contrato-de-lista.test.ts` ahora lo impide.
//
// EL POST ES IDEMPOTENTE y sirve para las dos cosas: seguir un SKU nuevo y
// cambiar qué se quiere saber de uno que ya se seguía. No hay PATCH aparte
// porque no hay dos operaciones: la PK compuesta `(perfil_id, sku)` hace que
// «seguir» no pueda duplicar.
//
// UN VISITANTE SÍ PUEDE SEGUIR — por eso el gate es `requireSession` y no
// `requireSessionNoVisitante`. Decisión de producto en el brief: el alcance del
// seguimiento es general. No hay nada que un visitante escriba de negocio;
// está configurando su propia campana.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { seguirSkuSchema } from '@/schemas/avisos.schema';
import { leerSeguimientos, seguirSku, MAX_SEGUIMIENTOS } from '@/services/avisos.service';
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

    // La RLS filtra por dueño. NO se filtra además aquí: duplicar la regla de
    // autorización en la capa equivocada crea dos verdades sobre quién ve qué.
    const items = await leerSeguimientos(db);
    return NextResponse.json({ items }, { status: 200 });
  } catch (e) {
    return internalError('api/seguimientos', e);
  }
}

export async function POST(req: Request) {
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

    const parsed = seguirSkuSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    await seguirSku(db, gate.user.id, parsed.data, MAX_SEGUIMIENTOS);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeAvisoError(e);
    if (conocido) return conocido;
    return internalError('api/seguimientos', e);
  }
}
