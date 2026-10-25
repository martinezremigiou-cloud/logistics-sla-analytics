// ============================================================
// [INV-B8] /api/proyectos — lista (GET) y alta (POST).
//
// GET: cualquier sesión autenticada. Lo que ve cada quien lo decide la RLS,
// no esta ruta — un visitante recibe 200 con lista vacía, no 403, porque no
// tiene proyectos que ver (no puede crearlos). El 403 se reserva para el
// intento de ESCRIBIR, que es donde el permiso de verdad se niega.
//
// POST: `requireSessionNoVisitante`. El gate no sustituye a la policy
// `proyectos_insert_own_no_visitante` (0024) — la duplica en la capa que
// puede dar el status correcto. Sin él, el 42501 de la RLS saldría como 500.
//
// Cliente + gate + validación + service, TODO dentro del mismo `try`
// (lección FIX-RESET: un throw fuera del try sale como 500 no-JSON).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { crearProyectoSchema } from '@/schemas/proyectos.schema';
import { listarProyectos, crearProyecto } from '@/services/proyectos.service';
import { resolveVigente } from '@/services/vigente.service';
import type { VigenciaDelDato } from '@/types/proyectos';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession, requireSessionNoVisitante } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { respuestaDeProyectoError } from '@/lib/api/proyectos-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// maxDuration=30s, igual que el resto de las lecturas del dominio. Esta ruta
// es MÁS ligera que `/api/inventory` (medida en 0.57–1.76 s con el catálogo
// completo): trae los proyectos de UNA sesión con un embed de conteo, no el
// universo. Se iguala al resto en vez de afinar un número sin medirlo.
export const maxDuration = 30;

export async function GET() {
  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    // [2.0.1-B · S-1] La lista y la vigencia se piden EN PARALELO: son
    // independientes —una lee `proyectos`, la otra el último `snapshots` de
    // stock— y encadenarlas sumaría dos viajes donde basta el más lento.
    //
    // `resolveVigente` es la MISMA función que pinnea `conVigenteStock` para el
    // detalle (`proyectos.service.ts:190`), no una segunda forma de averiguar
    // cuál es el vigente. Ese es el punto: la fecha que la tarjeta enseña tiene
    // que ser la que el documento imprimiría, y dos maneras de resolverla
    // acabarían discrepando — es la lección de `piezas_en_camino`, con cuatro
    // implementaciones y nada que las comparara.
    const [items, vigente] = await Promise.all([listarProyectos(db), resolveVigente(db, 'stock')]);
    const vigencia: VigenciaDelDato = {
      snapshot_id: vigente?.id ?? null,
      tomado_en: vigente?.created_at ?? null,
    };
    return NextResponse.json({ items, vigencia }, { status: 200 });
  } catch (e) {
    return internalError('api/proyectos', e);
  }
}

export async function POST(req: Request) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSessionNoVisitante(db);
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

    const parsed = crearProyectoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    const proyecto = await crearProyecto(db, parsed.data);
    return NextResponse.json(proyecto, { status: 201 });
  } catch (e) {
    // Defensa en profundidad con la semántica correcta: si la RLS rechaza el
    // INSERT pese al gate (p.ej. la carrera con `handle_new_user`, donde el
    // perfil aún no existe y el `EXISTS` de la policy es falso), eso es un
    // permiso denegado — 403 —, no un fallo del servidor.
    const conocido = respuestaDeProyectoError(e);
    if (conocido) return conocido;
    return internalError('api/proyectos', e);
  }
}
