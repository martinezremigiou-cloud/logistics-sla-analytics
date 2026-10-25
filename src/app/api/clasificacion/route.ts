// ============================================================
// B-PARCHE · F2 · /api/clasificacion — aplica la capa `clasificacion_v2`
// (D-driven: marca/familia/clase/descr/tecnologia) a partir de las 2
// hojas del archivo de origen. POST únicamente, escritura admin
// (`requireAdminSession`, igual que POST /api/familias y PUT
// /api/override). Cero lógica de dominio aquí: valida y delega en
// `clasificacion.service.ts`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { requireAdminSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { apiError, internalError } from '@/lib/api/errors';
import { bodyTooLarge } from '@/lib/api/body';
import { clasificacionBodySchema } from '@/schemas/clasificacion.schema';
import { aplicarClasificacion } from '@/services/clasificacion.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] A4 (auditoría de seguridad) · maxDuration=60s (NO el tramo de
// 30s del resto de este punto — es la ÚNICA de las 5 rutas de A4 que
// ESCRIBE). Lado de LECTURA por analogía a /api/inventory (medido por la
// auditoría: 0.57–1.76 s): `cargarContexto` en
// clasificacion.service.ts hace un `fetchAllRows` sobre `productos` de
// la misma escala (mismo catálogo completo) más otros 3 `fetchAllRows`
// chicos (familias/marcas/marca_alias), los 4 en paralelo. Lado de
// ESCRITURA SIN medir: fuera de `dryRun`, esta ruta invoca la RPC
// `aplicar_clasificacion_v2`, una escritura masiva atómica (upsert de
// clasificación de TODOS los productos + catálogos nuevos) — mismo hueco
// honesto que ya se documentó para /api/refresh (60s), que también
// combina reads medidos con un tramo de escritura sin medir. Se iguala a
// ese tramo por la misma razón, no por analogía de lectura sino por
// tener la misma FORMA de incertidumbre (reads acotados + escritura
// masiva no cronometrada).
export const maxDuration = 60;

/** Los grids de Inventario/WEST pesan ~1MB cada uno; 8MB deja holgura amplia (vs 64KB de escrituras admin "chicas"). */
const MAX_BODY_CLASIFICACION = 8_000_000;

/**
 * Cliente Supabase de esta ruta: DOS callers legítimos, DOS transportes
 * de sesión distintos.
 *   - un script de un solo uso (sin navegador): autentica
 *     con `signInWithPassword` y manda el JWT resultante como
 *     `Authorization: Bearer` — no tiene cookies que mandar. Se le arma
 *     un cliente anon + ese header explícito (`persistSession:false`:
 *     nada que persistir en un proceso de un solo shot).
 *   - El browser (futura UI admin, F4+): autentica vía cookies de sesión,
 *     mismo patrón que el resto de `/api/*` (`createSupabaseSessionClient`).
 * Sin header `Authorization`, se asume el camino de cookies.
 */
function clienteDeLaRequest(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== null && authHeader.toLowerCase().startsWith('bearer ')) {
    return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
  }
  return createSupabaseSessionClient();
}

export async function POST(req: Request) {
  const originGate = requireSameOrigin(req);
  if (originGate) return originGate;

  const db = clienteDeLaRequest(req);
  const gate = await requireAdminSession(db);
  if (gate instanceof NextResponse) return gate;

  if (bodyTooLarge(req, MAX_BODY_CLASIFICACION)) {
    return apiError('payload_too_large');
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError('invalid_body', { issues: [] });
  }

  const parsed = clasificacionBodySchema.safeParse(raw);
  if (!parsed.success) {
    return apiError('invalid_body', { issues: parsed.error.issues });
  }

  try {
    const result = await aplicarClasificacion(db, parsed.data);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return internalError('api/clasificacion', e);
  }
}
