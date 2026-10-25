// ============================================================
// [INV-B8] /api/proyectos/[id]/partidas/[partidaId] — cambiar cantidad
// (PATCH) y quitar la partida (DELETE).
//
// LA RUTA SE DIRECCIONA POR EL ID DE LA FILA, NO POR EL SKU, y no es
// preferencia: los SKU reales traen `/` y espacios (`WN947-X-N/BPU51-H14`,
// `YBY016 W`). En un segmento de ruta, ese `/` se interpreta como separador
// y la petición no llega. Es el mismo motivo por el que `rutaImagen`
// (`src/lib/imagenes.ts`) hashea el SKU en vez de usarlo como nombre de
// archivo.
//
// EL DELETE ES EL PRIMERO DEL REPO CONTRA SUPABASE, y estrena un modo de
// falla ya medido en `scripts/rls-negativas.mjs`: **un DELETE denegado por
// RLS responde 200 con cero filas, exactamente igual que uno que sí borró**.
// Sin el `.select('id')` del servicio, borrar la partida de otro usuario
// respondería "listo" sin borrar nada. Por eso el servicio distingue los dos
// casos y esta ruta traduce el segundo a 404.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { cambiarCantidadSchema } from '@/schemas/proyectos.schema';
import { cambiarCantidad, quitarPartida } from '@/services/proyectos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSessionNoVisitante } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=30s: una escritura de una fila. Se iguala al resto del módulo.
export const maxDuration = 30;

const idSchema = z.string().uuid();

interface Ctx {
  params: { id: string; partidaId: string };
}

/** Los dos uuid de la ruta, validados juntos: cualquiera mal formado es 400. */
function idsDeLaRuta(params: Ctx['params']) {
  const proyecto = idSchema.safeParse(params.id);
  const partida = idSchema.safeParse(params.partidaId);
  if (!proyecto.success) return { ok: false as const, issues: proyecto.error.issues };
  if (!partida.success) return { ok: false as const, issues: partida.error.issues };
  return { ok: true as const, proyectoId: proyecto.data, partidaId: partida.data };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSessionNoVisitante(db);
    if (gate instanceof NextResponse) return gate;

    const ids = idsDeLaRuta(params);
    if (!ids.ok) return apiError('invalid_query', { issues: ids.issues });

    if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
      return apiError('payload_too_large');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = cambiarCantidadSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    await cambiarCantidad(db, ids.proyectoId, ids.partidaId, parsed.data.cantidad);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]/partidas/[partidaId]', e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSessionNoVisitante(db);
    if (gate instanceof NextResponse) return gate;

    const ids = idsDeLaRuta(params);
    if (!ids.ok) return apiError('invalid_query', { issues: ids.issues });

    await quitarPartida(db, ids.proyectoId, ids.partidaId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]/partidas/[partidaId]', e);
  }
}
