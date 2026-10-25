// [INV-B7B] A1 (auditoría de seguridad) · aviso ruidoso de arranque si en
// producción de Vercel falta TODA fuente de dominio público para la
// allowlist de `Origin` (`src/lib/api/origin.ts`, O8).
//
// QUÉ pasa si nadie ve este aviso: la allowlist queda
// `{https://$VERCEL_URL}` nada más (URL del deployment, NUNCA el alias
// de producción ni un dominio propio) — las 8 rutas de escritura
// (POST/PUT/PATCH/DELETE) le devuelven 403 `forbidden_origin` a TODO el
// mundo el día del lanzamiento. Por eso el chequeo cubre AMBAS variables:
// `VERCEL_PROJECT_PRODUCTION_URL` (agregada en este mismo bloque a la
// allowlist) YA resuelve el problema sola en cualquier proyecto de
// Vercel normal — este aviso es la red de seguridad para el caso en que
// esa variable no esté disponible (p.ej. "Automatically expose System
// Environment Variables" desactivado en el proyecto) Y tampoco se haya
// configurado `NEXT_PUBLIC_SITE_URL` a mano.
//
// MECANISMO elegido — `console.error` en el nivel superior de este
// archivo, evaluado por `next build` (Vercel corre `next build` en su
// paso de Build, con las System Environment Variables YA disponibles
// ahí, no solo en runtime) — y por lo tanto visible en el Build Log del
// deployment. Por qué ESTE y no otro:
//   - Antes que un `throw` que reviente el build: la ausencia es grave
//     pero NO necesariamente fatal (p.ej. `VERCEL_PROJECT_PRODUCTION_URL`
//     puede llegar más tarde en el ciclo de vida del proyecto) — bloquear
//     el deploy por esto arriesga bloquear también un deploy de
//     emergencia. Un aviso ruidoso, no un gate duro.
//   - Antes que un chequeo dentro de `src/lib/api/origin.ts` (que solo
//     correría al procesar la PRIMERA petición mutante que llegue a una
//     instancia fría): el Build Log se ve ANTES de que el deployment
//     reciba tráfico real — el punto MÁS temprano posible para
//     detectarlo, más temprano que "arranque del servidor" en el sentido
//     literal. "Un fallo que solo se ve cuando el usuario ya perdió su
//     trabajo es el peor lugar para enterarse": esto se ve incluso antes
//     de que exista un usuario expuesto al deployment.
//   - Antes que loguearlo en cada petición: en un portal interno de bajo
//     tráfico no agrega señal después de la primera vez, solo ruido.
//
// LÍMITE conocido, no asumido como infalible: si el proyecto de Vercel
// tiene desactivado "Automatically expose System Environment Variables",
// NINGUNA de `VERCEL_ENV`/`VERCEL_PROJECT_PRODUCTION_URL` existiría —
// tampoco en el paso de Build — y este aviso NO dispararía. En ese caso
// `NEXT_PUBLIC_SITE_URL` pasa a ser la ÚNICA fuente posible del dominio
// público; ver `.env.example`.
if (
  process.env.VERCEL_ENV === 'production' &&
  !process.env.NEXT_PUBLIC_SITE_URL &&
  !process.env.VERCEL_PROJECT_PRODUCTION_URL
) {
  console.error(
    '[next.config.mjs] CONFIGURACIÓN INCOMPLETA: falta NEXT_PUBLIC_SITE_URL y ' +
      'VERCEL_PROJECT_PRODUCTION_URL en producción. La allowlist de Origin ' +
      '(src/lib/api/origin.ts) va a quedar SIN el dominio público del portal: ' +
      'las 8 rutas de escritura (POST/PUT/PATCH/DELETE) van a responder 403 ' +
      'forbidden_origin a TODOS los usuarios. Define NEXT_PUBLIC_SITE_URL en las ' +
      'variables de entorno del proyecto en Vercel (ver .env.example).',
  );
}

/**
 * Origen del Storage público, derivado de `NEXT_PUBLIC_SUPABASE_URL`.
 * Nunca lanza: `src/lib/env.ts` es quien valida la variable; aquí solo se
 * necesita un valor con forma de patrón válido para `images.remotePatterns`.
 */
function origenDeStorage() {
  const respaldo = { protocol: 'http', hostname: '127.0.0.1', port: '54321' };
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    const protocol = u.protocol.replace(':', '');
    if (protocol !== 'http' && protocol !== 'https') return respaldo;
    return { protocol, hostname: u.hostname, port: u.port };
  } catch {
    return respaldo;
  }
}
const SUPABASE_STORAGE = origenDeStorage();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // ============================================================
  // [2.0.1-B] `distDir` POR FRENTE — cuatro terminales, un solo árbol.
  //
  // ────────────────────────────────────────────────────────────
  // QUÉ DESTRUYE SIN ESTO. `npm run verificar` y `npm run layout-check`
  // CONSTRUYEN; `npm run dev`/`start` SIRVEN desde la misma carpeta. Dos
  // terminales construyendo a la vez no se ralentizan: **se corrompen**. Ya
  // mordió con una sola —el `layout-check` reescribió `.next/` bajo el server
  // vivo y dejó una pantalla pidiendo un chunk que ya no existía
  // (`LAYOUT-CHECK-PISA-EL-SERVER-VIVO`)—. Con cuatro frentes deja de ser
  // accidente y pasa a ser rutina.
  //
  // Cada frente exporta la suya (`NEXT_DIST_DIR=.next-proyectos`, `-dash`,
  // `-correo`, `-chat`) y las cuatro construcciones dejan de pisarse.
  //
  // ALCANZA AL `layout-check` SIN TOCAR EL SCRIPT, verificado: `layout-check.mjs`
  // lanza `next build` con `spawnSync(..., { shell: true })` y `next start` con
  // `env: { ...process.env, … }` — los dos HEREDAN `process.env`, así que la
  // variable viaja sola.
  //
  // Y EN PRODUCCIÓN NO CAMBIA NADA: Vercel no define la variable y el `??`
  // conserva `.next`.
  //
  // ⚠ LO QUE **NO** RESUELVE, y hay que decirlo porque se puede leer de más:
  // dentro de un mismo frente, construir mientras SU PROPIO servidor sirve esa
  // misma carpeta **sigue rompiendo la pestaña**. El problema deja de ser
  // ENTRE frentes; no desaparece.
  //
  // Ver `docs/ai-assisted-workflow.md`.
  // ============================================================
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // [2.0.1-B · R-1] La ruta `/cruce` se RETIRA: su pantalla ahora vive en
  // `/embarques`. La redirección es segura y unívoca —una ruta que desaparece
  // hacia su sucesora— así que va permanente.
  //
  // 301 EXPLÍCITO y no `permanent: true`: esa bandera emite **308**, que además
  // preserva el método. Aquí solo hay GET de página y se pidió 301 por su
  // nombre; se honra literalmente en vez de dar por bueno un equivalente.
  //
  // LO QUE ESTA REDIRECCIÓN NO ARREGLA, y por eso hay deuda escrita:
  // `/embarques` no se retira, **CAMBIA DE SIGNIFICADO**. Hoy servía el
  // histórico; ahora sirve el pipeline. Un marcador viejo aterriza en contenido
  // distinto, sin error y sin aviso — no hay redirección que lo evite, porque el
  // riesgo nace de reusar la cadena para otra cosa. Ver
  // RUTA-EMBARQUES-CAMBIA-DE-SIGNIFICADO en `docs/known-limitations.md`.
  async redirects() {
    return [{ source: '/cruce', destination: '/embarques', statusCode: 301 }];
  },
  // [INV-B7B] A5 (auditoría de seguridad) · apaga la cabecera
  // `X-Powered-By: Next.js` que Next agrega por default — no filtrar
  // framework/versión gratis. Flag NATIVA de Next para esto (no un
  // `headers()` manual: Next escribe esa cabecera él mismo al vuelo,
  // antes de que corran las cabeceras custom de abajo, así que pisarla
  // ahí no sería confiable).
  poweredByHeader: false,
  // [RECEPCION] O3 · `xlsx` debe VIAJAR con la función serverless de
  // `/api/refresh/archivo`. Sin esta línea NO viaja, y eso está MEDIDO, no
  // supuesto: tras mover el paquete a `dependencies` y compilar, el trace
  // de esa ruta (`.next/server/app/api/refresh/archivo/route.js.nft.json`)
  // listaba 25 archivos y CERO referencias a xlsx.
  //
  // La causa: `src/services/ingesta/io.ts` carga la librería con
  // `createRequire(import.meta.url)('xlsx')` — y eso está así por una
  // razón documentada y empírica (el interop ESM↔CJS deja
  // `XLSX.readFile` indefinido en runtime con un namespace import). Pero
  // `@vercel/nft`, que es quien decide qué archivos se empaquetan, hace
  // análisis ESTÁTICO: no puede seguir un `require` fabricado en tiempo de
  // ejecución, así que no ve la dependencia y no la incluye.
  //
  // Cómo se veía la falla si nadie la atrapa: build verde, tipos verdes,
  // lint verde, suite verde y `next start` local verde —en local existe
  // `node_modules/`— y en Vercel la PRIMERA carga de Power Automate
  // muriendo con `Cannot find module 'xlsx'`. Un fallo que solo aparece en
  // producción y solo en la ruta que este bloque existe para construir.
  //
  // Declarar el paquete como externo del servidor hace que Next lo deje
  // fuera del bundle y que el tracer lo resuelva desde `node_modules`,
  // incluyéndolo en la función. Verificado por CONTRASTE en el mismo
  // trace: 0 → 3 referencias (`xlsx/xlsx.js`, `xlsx/cpexcel.js` —tablas de
  // codepage, necesarias para acentos— y `xlsx/package.json`).
  // [INV-B8] `pdfkit` entra por la MISMA puerta y por la misma razón, con un
  // agravante propio: además de cargarse con `createRequire` (mismo interop
  // CJS que `xlsx`), lee sus MÉTRICAS DE TIPOGRAFÍA desde disco en tiempo de
  // ejecución — `node_modules/pdfkit/js/data/Helvetica.afm` y compañía. Son
  // datos, no módulos, así que ningún análisis estático de imports los ve.
  //
  // Es exactamente la falla que el bloque de RECEPCIÓN ya pagó una vez con
  // `xlsx`: verde en todo local, y 500 en la primera petición real de
  // producción. Que sea la segunda vez no la vuelve teórica — la vuelve
  // PREVISIBLE, y por eso el bloque la verifica por CONTRASTE sobre el
  // `.nft.json` de la ruta nueva (se inspecciona a mano tras `next build`),
  // no con un "salió el PDF en mi máquina".
  experimental: {
    serverComponentsExternalPackages: ['xlsx', 'pdfkit'],
  },
  images: {
    // Cierra B4-5: habilita next/image para las imágenes de producto servidas
    // desde el bucket público `producto-imagenes` (0007_b5_storage.sql). El
    // swap de <img> a next/image en las páginas es P3 — NO se hace aquí.
    //
    // Protocolo, host y puerto SALEN de `NEXT_PUBLIC_SUPABASE_URL`: ningún
    // proyecto concreto queda escrito en el repo. Sin variable (o con una que
    // no sea URL) se cae al Supabase local de `supabase start`.
    remotePatterns: [
      {
        protocol: SUPABASE_STORAGE.protocol,
        hostname: SUPABASE_STORAGE.hostname,
        ...(SUPABASE_STORAGE.port ? { port: SUPABASE_STORAGE.port } : {}),
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // [INV-B7B] O12 · Skew protection — id de deployment del CLIENTE,
  // HORNEADO en build (nunca leído en runtime).
  //
  // La trampa a evitar: si este valor se leyera en runtime (p.ej. dentro
  // de un route handler) siempre devolvería el deployment ACTUAL, y la
  // comparación contra `/api/version` (que sí lee en runtime, a propósito
  // — ver ese archivo) jamás detectaría un desfase: el aviso nunca
  // dispararía. La clave `env` de next.config es precisamente el mecanismo
  // que Next usa para INYECTAR un valor fijo, congelado en el momento de
  // `next build`, en TODO el código que compila (bundle del navegador
  // incluido) — no una lectura de `process.env` en caliente.
  //
  // `VERCEL_DEPLOYMENT_ID` solo existe en builds de Vercel; en local/dev
  // no existe ⇒ 'dev'. Como `/api/version` también cae a 'dev' cuando esa
  // misma variable falta en su propio runtime, ambos lados coinciden en
  // desarrollo y el aviso NUNCA dispara ahí (comportamiento correcto, no
  // un bug: no hay "deployment nuevo" que detectar fuera de Vercel).
  // Consumido por `src/components/shared/aviso-version-nueva.tsx`.
  env: {
    NEXT_PUBLIC_DEPLOY_ID: process.env.VERCEL_DEPLOYMENT_ID ?? 'dev',
  },
  // [INV-B7B] A5 (auditoría de seguridad) · cabeceras de seguridad
  // "seguras de aplicar a ciegas": ninguna de estas 3 depende de conocer
  // de antemano qué scripts/estilos/orígenes usa la app (a diferencia de
  // una CSP real) — cero riesgo de romper algo que ya funciona.
  //   - `X-Frame-Options: DENY` — el panel de admin deja de ser
  //     enmarcable (clickjacking). Se usa la cabecera clásica, NO
  //     `frame-ancestors` de una CSP: no hay CSP activa (ver deuda
  //     abajo) y `DENY` por sí solo ya cubre el caso completo ("nunca en
  //     un iframe/frame de nadie"), sin tener que levantar una CSP entera
  //     solo para esto.
  //   - `X-Content-Type-Options: nosniff` — el navegador deja de
  //     reinterpretar el `content-type` declarado por sniffing.
  //   - `Referrer-Policy: strict-origin-when-cross-origin` — mismo
  //     comportamiento por defecto de los navegadores modernos, pero
  //     declarado explícito en vez de depender de ese default implícito.
  //
  // CSP — DEUDA DECLARADA a propósito, NI SIQUIERA en modo Report-Only,
  // por dos razones combinadas (cualquiera de las dos ya bastaría sola):
  //   1. Construir una CSP real exige inventariar TODAS las fuentes
  //      legítimas de script/estilo/imagen/conexión de la app (Supabase
  //      JS —fetch + realtime/websocket—, el bucket de imágenes de
  //      producto vía `next/image`, fuentes, etc.) para no generar ruido
  //      o, peor, para no romper algo en modo enforce el día que se
  //      active. Ese inventario NO se hizo en este bloque.
  //   2. Este es el bloque previo a producción y `next.config.mjs`
  //      exige reiniciar el servidor para tomar efecto — este bloque NO
  //      puede reiniciar el server corriendo en :3100 (ver README del
  //      bloque) — así que NINGUNA cabecera nueva de este archivo se
  //      puede verificar en vivo aquí (ver nota en el reporte de
  //      entrega). Agregar una CSP a ciegas, sin poder observar su
  //      efecto real ni en modo Report-Only (que además necesitaría un
  //      `report-to`/`report-uri` que junte los reportes — sin eso,
  //      Report-Only solo se ve si alguien abre devtools a mano, vale
  //      poco), es exactamente el tipo de cambio que este bloque pide
  //      NO introducir de forma bloqueante.
  //   Queda para un bloque dedicado, con inventario de fuentes +
  //   verificación en vivo (arranque real del server + navegación real).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
