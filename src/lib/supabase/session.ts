import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { crearFetchResiliente, registrarRastro, TRANSITORIOS_SESION } from './reintento';

/**
 * Cliente Supabase ligado a la sesión del usuario (cookies) — respeta RLS.
 * Distinto de server.ts (service_role, bypassa RLS). Se usa en Server
 * Components / Server Actions / Route Handlers que operan como el usuario
 * autenticado (layout del shell, /login, logout).
 *
 * setAll va en try/catch: cuando se invoca desde un Server Component las
 * cookies son de solo lectura y Next lanza — es inofensivo porque el
 * middleware ya se encarga de refrescar la sesión en cada request.
 */
export function createSupabaseSessionClient() {
  const cookieStore = cookies();
  // [MVP-CIERRE] F1 · mismo wrapper resiliente que `server.ts`. Este
  // carril es donde el 401 transitorio está CONFIRMADO en producción
  // (31-jul, `/api/snapshots` → `JWT issued at future` → 500 a un humano):
  // el middleware revalida la sesión en cada request y, cuando toca
  // refrescar, GoTrue acuña un token nuevo que el handler usa milisegundos
  // después. Si el reloj del emisor va un pelo adelante del validador, el
  // `iat` queda "en el futuro". Que solo falle en los REFRESCOS —y no en
  // cada petición— es justo lo que lo hace intermitente.
  //
  // Lista ACOTADA a propósito (`TRANSITORIOS_SESION`): aquí NO se reintenta
  // `JWT expired`. Un token de usuario que venció de verdad no se des-vence
  // esperando — el reintento está condenado a fallar y de paso le cobra al
  // usuario los 2.5 s del presupuesto antes de mandarlo a /login, que es
  // latencia nueva en un camino hoy instantáneo. En el carril de servicio
  // sí entra: ahí no hay nadie esperando y el reintento re-emite la
  // petición. Misma mecánica, distinta lista, por quién paga la espera.
  const { fetchResiliente, rastro } = crearFetchResiliente(TRANSITORIOS_SESION);

  const db = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Se llamó desde un Server Component (cookies de solo lectura).
        }
      },
    },
    // Mismo bug de caché que server.ts (QA-B3): Next 14 parchea el fetch
    // global y cachea por URL los GET salientes del servidor. Sin esto, las
    // lecturas con sesión (RLS) también se congelarían en su primera
    // ejecución. cache:'no-store' explícito SIEMPRE gana al caché de Next.
    global: { fetch: fetchResiliente },
  });

  registrarRastro(db, rastro);
  return db;
}
