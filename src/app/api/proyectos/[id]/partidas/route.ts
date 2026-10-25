// ============================================================
// [INV-B8] /api/proyectos/[id]/partidas — agregar una partida (POST).
//
// Los tres desenlaces que Postgres distingue y que aquí llegan con su
// status propio en vez de un 500 genérico:
//   · 23505 → 409 `partida_duplicada` ("sin duplicados", literal de la maqueta)
//   · 23503 → 404 `sku_no_encontrado` (la FK contra `productos`)
//   · 42501 → 404 `proyecto_no_encontrado` (la RLS: no es tuyo, o no existe)
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { agregarPartidaSchema, MAX_PARTIDAS } from '@/schemas/proyectos.schema';
import { agregarPartida } from '@/services/proyectos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSessionNoVisitante } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=30s: un conteo y un INSERT. Se iguala al resto del módulo.
export const maxDuration = 30;

const idSchema = z.string().uuid();

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSessionNoVisitante(db);
    if (gate instanceof NextResponse) return gate;

    const idParsed = idSchema.safeParse(params.id);
    if (!idParsed.success) {
      return apiError('invalid_query', { issues: idParsed.error.issues });
    }

    if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
      return apiError('payload_too_large');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = agregarPartidaSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    await agregarPartida(db, idParsed.data, parsed.data, MAX_PARTIDAS);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]/partidas', e);
  }
}
