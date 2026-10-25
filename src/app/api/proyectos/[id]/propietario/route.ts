// ============================================================
// [INV-B8 · 0025] /api/proyectos/[id]/propietario — la VÍA DE RESCATE.
//
// Existe para sostener un invariante, no para dar una funcionalidad: **ningún
// proyecto puede quedar en un estado del que nadie pueda sacarlo desde la
// aplicación.** La 0024 producía uno: al borrar una cuenta, `ON DELETE SET
// NULL` dejaba sus proyectos con `propietario` en NULL, y como
// `NULL = auth.uid()` no es TRUE, las policies de UPDATE y DELETE excluían a
// todo el mundo — incluido el admin. Quedaban visibles y congelados, y solo se
// rescataban con SQL directo contra la base.
//
// POR QUÉ ES UNA RUTA APARTE Y NO UN CAMPO MÁS DEL `PATCH` DEL PROYECTO. Tres
// razones, y la tercera es la que decide:
//   · El gate es distinto: `requireAdminSession`, no `requireSessionNoVisitante`.
//   · El schema del PATCH normal NO acepta `propietario` A PROPÓSITO — así no
//     existe un camino de código donde un KAM proponga de quién es un proyecto.
//     Añadirlo ahí abriría exactamente esa puerta para atender un caso raro.
//   · Un `PATCH` que a veces edita el título y a veces cambia al dueño mezcla
//     una operación cotidiana con una de recuperación. Separadas, cada una se
//     lee, se audita y se prueba por su lado.
//
// EL PERMISO REAL NO ESTÁ AQUÍ: está en la policy
// `proyectos_update_huerfano_admin`, que solo alcanza filas ya huérfanas y
// solo las deja con dueño no-visitante. Este gate le da el status correcto a
// un rechazo (403 en vez del 500 que daría un 42501 crudo); si alguien lo
// borrara, la base seguiría negando la operación.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { reasignarProyectoSchema } from '@/schemas/proyectos.schema';
import { reasignarProyecto } from '@/services/proyectos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=30s: un UPDATE de una fila. Igualado al resto del módulo.
export const maxDuration = 30;

const idSchema = z.string().uuid();

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireAdminSession(db);
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

    const parsed = reasignarProyectoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const proyecto = await reasignarProyecto(db, idParsed.data, parsed.data.propietario);
    return NextResponse.json(proyecto, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]/propietario', e);
  }
}
