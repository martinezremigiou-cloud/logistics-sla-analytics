// ============================================================
// Bloque 2 · /api/refresh — puerta de entrada HTTP del ETL.
// Cero lógica de dominio aquí: solo auth + validación + delegación
// a `toIngestJob` (adapter puro) y `runEtl` (orquestador con efectos).
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { getServerEnv } from '@/lib/env';
import { ingestaAutorizada } from '@/lib/api/ingest-auth';
import { apiError } from '@/lib/api/errors';
import { leerForzadoUniversoReducido } from '@/lib/api/forzar-universo';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RefreshBody } from '@/schemas/refresh.schema';
import { toIngestJob } from '@/services/etl/adapter';
import { runEtl } from '@/services/etl.service';
import { EtlContractError, UniversoReducidoError } from '@/services/etl/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// [INV-B7B] O11 · maxDuration=60s. De dónde sale: 3 corridas contra BD
// viva — STOCK reads 701 ms + compute 13 ms (body de menos de 1 MB) · ADUANA reads 527 ms + compute 8 ms. 60s da
// ~85× de holgura sobre el tramo MEDIDO. La holgura es deliberada, no
// capricho: cubre dos huecos que quedaron SIN medir en este bloque —
// `persistSnapshot` (con los libros de julio ambas fuentes dan
// `sinCambios:true` y `runEtl.ts:359-361` nunca llega a llamar al RPC;
// forzarlo habría sido una escritura de ingesta, fuera de alcance aquí) y
// el arranque frío de la función serverless. 60 cabe tanto en el plan
// Hobby como en Pro de Vercel.
export const maxDuration = 60;

/** Holgado para snapshots de pocos MB; corta abusos de payload antes de parsear. */
const MAX_BODY_BYTES = 15_000_000;

function isTooLarge(req: Request): boolean {
  const len = Number(req.headers.get('content-length'));
  return Number.isFinite(len) && len > MAX_BODY_BYTES;
}

export async function POST(req: Request) {
  // Resuelve la config UNA sola vez; si la config del servidor está mal
  // (env faltante/corta), falla aquí como 500 genérico en vez de colar un
  // error crudo más abajo (p.ej. mal categorizado como etl_failed).
  let serverEnv: ReturnType<typeof getServerEnv>;
  try {
    serverEnv = getServerEnv();
  } catch (e) {
    console.error('[api/refresh] configuración de servidor inválida', e);
    return NextResponse.json({ error: 'config_error' }, { status: 500 });
  }

  if (!ingestaAutorizada(req, serverEnv.INGEST_SECRET)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (isTooLarge(req)) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_body', issues: [] }, { status: 400 });
  }

  const parsed = RefreshBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // [REPRODUCIBILIDAD · S7-A] Escape hatch — misma lectura que
  // `/api/refresh/archivo` (`src/lib/api/forzar-universo.ts`, una sola
  // primitiva para las dos puertas). El forzado solo se APLICA si la
  // guarda de universo reducido llega a dispararse (ver runEtl.ts).
  const { forzado, intentoInvalido } = leerForzadoUniversoReducido(req);

  try {
    const job = toIngestJob(parsed.data);
    const result = await runEtl(job, { db: createSupabaseServerClient(), forzado: forzado ?? undefined });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    if (e instanceof EtlContractError) {
      // Mensaje propio y seguro (p.ej. stock con datasets vacíos): no filtra internals.
      return NextResponse.json({ error: 'contract_error', message: e.message }, { status: 400 });
    }
    if (e instanceof UniversoReducidoError) {
      const message = intentoInvalido
        ? `${e.message} Intento de forzado incompleto: ${intentoInvalido}.`
        : e.message;
      return apiError('universo_reducido', { message });
    }
    // Mensajes de Postgres/PostgREST pueden filtrar nombres de columna/constraint:
    // se registran server-side, pero NUNCA se devuelven al cliente.
    console.error('[api/refresh] etl_failed', e);
    return NextResponse.json({ error: 'etl_failed' }, { status: 500 });
  }
}
