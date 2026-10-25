// ============================================================
// [INV-B8] /api/proyectos/[id] — detalle (GET) y edición (PATCH).
//
// El GET es EL camino de lectura del detalle: lo consumen la vista y los dos
// documentos. Un `id` mal formado responde 400 y uno bien formado pero
// inexistente —o ajeno— responde 404, mismo criterio que
// `/api/snapshots/[id]/cambios`. "No es tuyo" y "no existe" dan la misma
// respuesta a propósito: distinguirlos confirmaría que el recurso existe.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { editarProyectoSchema } from '@/schemas/proyectos.schema';
import { obtenerProyecto, editarProyecto } from '@/services/proyectos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession, requireSessionNoVisitante } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=30s. Es la lectura más pesada del módulo: 6 consultas en
// paralelo acotadas a ≤200 SKUs, contra las 5 sin cota sobre el universo
// completo que hace `/api/inventory` (medida 0.57–1.76 s). Se iguala al
// resto de las lecturas en vez de inventar un número más ajustado.
export const maxDuration = 30;

const idSchema = z.string().uuid();

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    const idParsed = idSchema.safeParse(params.id);
    if (!idParsed.success) {
      return apiError('invalid_query', { issues: idParsed.error.issues });
    }

    const proyecto = await obtenerProyecto(db, idParsed.data);
    if (proyecto === null) {
      return apiError('proyecto_no_encontrado', { message: 'El proyecto no existe o no es tuyo.' });
    }
    return NextResponse.json(proyecto, { status: 200 });
  } catch (e) {
    return internalError('api/proyectos/[id]', e);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

    const parsed = editarProyectoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const proyecto = await editarProyecto(db, idParsed.data, parsed.data);
    return NextResponse.json(proyecto, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]', e);
  }
}
