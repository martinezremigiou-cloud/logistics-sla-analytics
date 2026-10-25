// ============================================================
// [INV-B8.2] /api/proyectos/[id]/partidas/volcado — volcar la Selección (POST).
//
// ES UN ENDPOINT APARTE DE `POST /partidas` y no un modo de aquél. Los dos
// escriben en la misma tabla, pero no son la misma operación:
//
//   POST /partidas          una partida, y si el SKU ya está es un ERROR
//                           (409 `partida_duplicada`, "sin duplicados" de la
//                           maqueta). El usuario la está agregando a mano.
//   POST /partidas/volcado  N partidas, y si el SKU ya está SE SUMA y se dice.
//                           El usuario vació una Selección que armó recorriendo
//                           el catálogo, sin ver el proyecto.
//
// Meter las dos en la misma ruta con una bandera habría hecho que el mismo
// verbo sobre la misma URL a veces rechace un duplicado y a veces lo sume,
// según un campo del cuerpo. Son dos contratos, y se escriben como dos.
//
// EL VOLCADO NO CREA PROYECTOS. El camino «proyecto nuevo» del panel es
// `POST /api/proyectos` (que ya existía) y DESPUÉS este endpoint contra el id
// devuelto. Así este endpoint tiene UNA semántica —volcar sobre un proyecto que
// existe— y el reintento es siempre idempotente: si la respuesta se pierde, el
// cliente ya tiene el id y repite el volcado, que se detecta como reintento.
// Un endpoint que creara el proyecto en el mismo golpe no podría: un reintento
// sin respuesta no sabe qué id se creó, y crearía un segundo proyecto.
//
// 200 Y NO 201. Un volcado puede aplicar unos renglones, detectar otros como
// reintento y chocar con un tercero; no hay «un recurso creado» que señalar.
// El cuerpo trae el desglose y el cliente lo cuenta.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { volcarSeleccionSchema, MAX_PARTIDAS } from '@/schemas/proyectos.schema';
import { volcarSeleccion } from '@/services/proyectos.service';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSessionNoVisitante } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Tres lecturas y una escritura, con hasta 200 SKUs. Se iguala al resto del módulo.
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

    // El cuerpo se valida ENTERO antes de tocar la base: un solo renglón con
    // cantidad 0, un SKU vacío o un `proyecto_id` colado dentro de un item
    // rechaza el volcado completo. No hay un camino donde una parte del envío
    // se aplique y otra se descarte por mal formada.
    const parsed = volcarSeleccionSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const resultado = await volcarSeleccion(db, idParsed.data, parsed.data.items, MAX_PARTIDAS);
    return NextResponse.json(resultado, { status: 200 });
  } catch (e) {
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos/[id]/partidas/volcado', e);
  }
}
