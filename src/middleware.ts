import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { apiError } from '@/lib/api/errors';
import { leerRolPerfil } from '@/lib/api/perfil-rol';

/**
 * Middleware de sesión (patrón oficial @supabase/ssr): revalida el JWT en
 * cada request y reescribe las cookies de auth refrescadas. NO decide
 * autorización por rol (eso vive en RLS + los layouts/handlers) — solo
 * decide si hay o no un usuario autenticado, MÁS la excepción puntual de
 * mantenimiento de abajo (que sí necesita saber el rol; ver [INV-B7B] O12).
 *
 * `/api/**` nunca se REDIRIGE aquí: las cookies se siguen refrescando, y el
 * 401 lo emite el propio route handler (excepto /api/refresh, que está
 * excluido del matcher y usa su propio gate INGEST_SECRET). Bajo
 * MANTENIMIENTO=1 sí puede REESCRIBIRSE (rewrite, no redirect: la URL que
 * ve el cliente no cambia) a /mantenimiento — salvo las rutas exentas — con
 * UNA distinción por tipo de ruta: las páginas se REESCRIBEN a
 * /mantenimiento (HTML), pero `/api/**` responde el contrato JSON de error
 * del proyecto con status 503 (`no_disponible`) — un cliente que hace
 * `res.json()` sobre una página HTML revienta con un error genérico e
 * ilegible en vez de algo que `use-api.ts` sepa mostrar. Ver el bloque
 * marcado abajo.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // No ejecutar código entre createServerClient y auth.getUser(): getUser
  // revalida el JWT contra el Auth server (a diferencia de getSession, que
  // confía ciegamente en la cookie sin validarla).
  let user: User | null = null;
  try {
    const {
      data: { user: fetchedUser },
    } = await supabase.auth.getUser();
    user = fetchedUser;
  } catch {
    // Auth server caído/timeout, etc. (C4): se trata igual que "sin sesión"
    // — páginas redirigen a /login, /api/** sigue de largo y deja que el
    // propio handler responda 401 (fail-closed, nunca se abre paso solo).
    user = null;
  }

  // ===== [INV-B7B] O12 · Modo mantenimiento (diseñado, apagado por default) =====
  // Se evalúa ANTES del gate de sesión y ANTES del paso-directo de `/api`
  // de abajo: con la variable activa, hasta las rutas /api/* (salvo las
  // exentas) se REESCRIBEN a /mantenimiento, no solo las páginas.
  //
  // Mecanismo, completo:
  //  1. `MANTENIMIENTO` es server-only — SIN prefijo `NEXT_PUBLIC_`, así
  //     que Next jamás la incluye en el bundle del navegador. Solo puede
  //     encenderla quien tiene acceso a las variables de entorno del
  //     hosting (Vercel/host): no hay ningún switch dentro de la app.
  //  2. Sin la variable (el estado de HOY y de todo ambiente que no la
  //     declare), `mantenimientoActivo` es `false` y el `&&` de la línea
  //     de abajo corta en corto: NINGÚN código de este bloque corre — ni
  //     el chequeo de ruta exenta, ni la consulta de rol. Comportamiento
  //     IDÉNTICO, byte a byte, al de antes de este bloque. Cubierto por
  //     `middleware.test.ts` (`describe('modo mantenimiento')`).
  //  3. Con la variable activa: toda ruta cubierta por el `matcher` de
  //     abajo se reescribe a /mantenimiento, EXCEPTO las de
  //     `esRutaExentaDeMantenimiento` (ver su comentario) — con UNA
  //     excepción de usuario: quien tiene sesión Y `perfiles.rol='admin'`
  //     (mismo gate exacto que `requireAdminSession`, `lib/api/auth.ts` —
  //     ambos comparten la misma consulta vía `leerRolPerfil`,
  //     `lib/api/perfil-rol.ts` — no se inventa un segundo camino para la
  //     misma pregunta) atraviesa con normalidad. Decisión ya tomada, no
  //     propuesta aquí: si el admin también quedara fuera, nadie con
  //     acceso a la app podría revertir el mantenimiento sin ir directo a
  //     las variables de entorno del hosting.
  //  4. Fail-closed: sin sesión, con sesión pero sin rol admin, o si la
  //     LECTURA de `perfiles` falla (red/RLS/PostgREST caído) → a
  //     /mantenimiento igual. Un fallo de lectura nunca abre la puerta —
  //     pero SÍ se registra (`console.error` dentro de `esAdmin`, abajo)
  //     antes de caer a fail-closed: silencioso Y fail-closed a la vez
  //     dejaría a un admin encerrado fuera del sistema, sin rastro, justo
  //     durante un incidente de base — exactamente cuando alguien necesita
  //     entrar a arreglarlo. El fail-closed se queda; el silencio no.
  //  5. `/api/**` (no exenta) bajo mantenimiento NO se reescribe a HTML:
  //     responde el contrato JSON de error (`apiError('no_disponible')`,
  //     status 503) — mismo shape que cualquier otro error de la API. Una
  //     pestaña que hace `res.json()` sobre la página de /mantenimiento
  //     (HTML) revienta con el error genérico de `use-api.ts`; con JSON,
  //     al menos es un 503 reconocible por el propio contrato del proyecto.
  const mantenimientoActivo = process.env.MANTENIMIENTO === '1';
  if (mantenimientoActivo && !esRutaExentaDeMantenimiento(request.nextUrl.pathname)) {
    const tieneAccesoAdmin = user !== null && (await esAdmin(supabase, user.id));
    if (!tieneAccesoAdmin) {
      if (request.nextUrl.pathname.startsWith('/api')) {
        return apiError('no_disponible', { message: 'El portal está en mantenimiento. Vuelve a intentarlo en unos minutos.' });
      }
      // rewrite, no redirect: la URL en la barra del navegador NO cambia,
      // solo el contenido servido. `{ request }` propaga las cookies YA
      // reescritas arriba en `request.cookies` (mismo patrón que
      // `NextResponse.next({ request })` unas líneas arriba) — aunque
      // /mantenimiento no lee sesión hoy, es gratis y consistente.
      // El Set-Cookie de la respuesta refrescada (`response`, arriba) SÍ
      // se descarta aquí — mismo trade-off ya aceptado por el redirect de
      // "sin sesión" más abajo en este mismo archivo.
      return NextResponse.rewrite(new URL('/mantenimiento', request.url), { request });
    }
  }

  if (request.nextUrl.pathname.startsWith('/api')) {
    return response;
  }

  if (!user) {
    const url = new URL('/login?next=' + encodeURIComponent(request.nextUrl.pathname), request.url);
    return NextResponse.redirect(url);
  }

  return response;
}

/**
 * ¿Es admin el usuario ya autenticado? MISMA consulta que
 * `requireAdminSession` (`lib/api/auth.ts`) — ambas pasan por
 * `leerRolPerfil` (`lib/api/perfil-rol.ts`, Edge-safe): no se inventa un
 * segundo mecanismo para la misma pregunta. La diferencia es SOLO la
 * reacción ante un error de lectura: aquí no hay forma de emitir un 500
 * propio de la API (esto corre en middleware, no en un route handler), así
 * que se trata como "no admin" (fail-closed) — pero, a diferencia de antes,
 * NUNCA en silencio: se registra con `console.error` primero. Un fallo de
 * lectura fail-closed-pero-mudo deja a un admin fuera del sistema, sin
 * rastro, justo cuando es quien tiene que entrar a arreglar el incidente.
 */
async function esAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { rol, error } = await leerRolPerfil(supabase, userId);
  if (error) {
    console.error('[middleware] fallo leyendo perfiles.rol — fail-closed a /mantenimiento:', error);
    return false;
  }
  return rol === 'admin';
}

/**
 * Exentas del rewrite de mantenimiento AUNQUE la variable esté activa:
 *  - `/api/refresh` — la ingesta de Power Automate no debe detenerse por
 *    mantenimiento del PORTAL. Ya está fuera del `matcher` de abajo (esta
 *    función nunca llega a evaluarse para esa ruta) — se repite la
 *    exclusión AQUÍ DENTRO también, mismo criterio que `esRutaExenta` en
 *    `src/lib/api/origin.ts`: el comportamiento correcto no debe depender
 *    de que alguien recuerde esta dependencia oculta si el `matcher`
 *    cambia en el futuro.
 *  - `/api/version` — metadata de build sin datos de negocio (O12); el
 *    aviso de versión nueva debe poder seguir consultándola durante el
 *    mantenimiento. Ronda 2 (punto B): también quedó fuera del `matcher`
 *    de abajo (igual que `/api/refresh`) — antes SÍ pasaba por el
 *    middleware completo en cada request, lo que disparaba una llamada a
 *    `supabase.auth.getUser()` (contra el servidor de Auth) por cada
 *    `visibilitychange` de `aviso-version-nueva.tsx`, para una ruta que ni
 *    siquiera exige sesión. Misma defensa redundante que `/api/refresh`:
 *    esta función nunca llega a evaluarse para esa ruta en producción,
 *    pero se repite aquí para no depender de que nadie recuerde la
 *    dependencia oculta si el `matcher` cambia.
 * Los assets (`_next/*`, imágenes, `favicon.ico`) y `/login` YA quedan
 * fuera por el `matcher` mismo — esa exclusión es estructural (una
 * familia entera de rutas), no se duplica aquí ruta por ruta.
 */
function esRutaExentaDeMantenimiento(pathname: string): boolean {
  return ['/api/refresh', '/api/version'].some((ruta) => pathname === ruta || pathname.startsWith(`${ruta}/`));
}

export const config = {
  // `login(?:$|/)` / `api/refresh(?:$|/)` / `api/version(?:$|/)` (C4): ancla
  // por segmento — sin el `(?:$|/)`, un prefijo desnudo ("login"/
  // "api/refresh"/"api/version") también matchea rutas NO relacionadas
  // como "/loginX", "/api/refreshX" o "/api/versionX", que quedaban fuera
  // del middleware (sin revalidar sesión) por accidente.
  //
  // `api/version` se agregó en la ronda 2 (punto B): antes SÍ pasaba por
  // el middleware, y cada `visibilitychange` de `aviso-version-nueva.tsx`
  // terminaba pagando una llamada a `supabase.auth.getUser()` (contra el
  // servidor de Auth) para una ruta que no exige sesión — ver
  // `esRutaExentaDeMantenimiento` arriba para la exención equivalente
  // dentro de la rama de mantenimiento (se conserva como red de
  // seguridad, aunque esta exclusión del `matcher` ya la vuelve
  // inalcanzable en producción).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login(?:$|/)|api/refresh(?:$|/)|api/version(?:$|/)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
