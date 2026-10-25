import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { env, getServerEnv } from '@/lib/env';
import { crearFetchResiliente, registrarRastro } from './reintento';

/**
 * Cliente Supabase con service_role — SOLO servidor (bypass RLS para ETL/refresh, Bloque 2).
 * Bloque 2: la service_role es OBLIGATORIA (`env.ts` la valida con `.min(1)`,
 * sin `.optional()`). Fail-closed explícito: si falta, `getServerEnv()` ya
 * lanza antes de llegar aquí — NO hay fallback silencioso a la anon key.
 */
export function createSupabaseServerClient() {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  // [MVP-CIERRE] F1 · el wrapper de fetch conserva `cache: 'no-store'`
  // (bug de caché de Next, QA B3 — ver abajo) y AGREGA reintento acotado
  // ante 401 transitorios. El presupuesto vive en este objeto: un cliente
  // por petición ⇒ un presupuesto por petición, no por lectura.
  const { fetchResiliente, rastro } = crearFetchResiliente();
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next 14 parchea el fetch global y cachea por URL los GET salientes de los
    // route handlers (incluso con dynamic='force-dynamic', que NO aplica al data
    // cache de fetch en route handlers). Sin esto, las lecturas a PostgREST se
    // congelan en su primera ejecución (bug demostrado en QA B3; afectaba también
    // a /api/refresh en servers de vida larga). cache:'no-store' explícito SIEMPRE
    // gana al caché de Next.
    global: { fetch: fetchResiliente },
  });
  registrarRastro(db, rastro);
  return db;
}
