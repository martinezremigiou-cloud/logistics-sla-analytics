// ============================================================
// Bloque INV-B7B · Carril C · API · origin.ts  (PURO salvo lectura de
// `process.env` / `req.method` / `req.url` — sin I/O de red ni de BD)
// Verificación de `Origin` (O8, deuda B5) en las rutas que ESCRIBEN.
//
// Por qué: hoy la única defensa contra CSRF es `SameSite=Lax` en la
// cookie de sesión (no viaja en un POST cross-site disparado desde otro
// origen, en la mayoría de navegadores) + exigir `Content-Type:
// application/json` (un <form> HTML plano no puede fabricar ese
// header). Es una defensa razonable pero indirecta. Antes de exponer la
// app públicamente se agrega una capa explícita: los navegadores mandan
// `Origin` en toda petición mutante (same-site y cross-site, en los
// motores modernos) — si no coincide con un origen conocido de este
// portal, se rechaza.
//
// Contrato:
//   - Solo aplica a métodos MUTANTES (POST/PUT/PATCH/DELETE). GET/HEAD
//     pasan siempre (`null`) — no hay CSRF de lectura.
//   - `Origin` AUSENTE o fuera de la allowlist en un método mutante ⇒
//     403 `forbidden_origin`. FAIL-CLOSED a propósito: un proxy
//     corporativo raro que quite el header cae del lado seguro (403),
//     no del inseguro (dejarlo pasar).
//   - Se invoca como PRIMERA línea de cada handler de escritura, ANTES
//     de leer el body (rechazar barato antes de gastar en parseo/red).
//
// EXENCIÓN — `/api/refresh` (contractual, no un descuido):
//   Lo llama Power Automate con el secreto `x-ingest-secret`
//   (comparación timing-safe, ver `src/app/api/refresh/route.ts`) desde
//   un flujo sin navegador: JAMÁS manda `Origin`. Esa ruta ya está fuera
//   del matcher de `src/middleware.ts` (`api/refresh(?:$|/)`) y tiene su
//   propio gate independiente — `Origin` no protegería nada ahí: no hay
//   sesión de cookies que un CSRF pudiera abusar.
//   La exención está escrita AQUÍ (`esRutaExenta`, abajo), no solo en un
//   comentario suelto en otro archivo: así el comportamiento correcto
//   NO depende de que alguien recuerde "no llamar a `requireSameOrigin`
//   desde `refresh/route.ts`" — si en el futuro alguien SÍ la invoca ahí
//   (p.ej. al refactorizar ese handler para reusar este helper), sigue
//   pasando de largo sin romper la ingesta. (Ese archivo está fuera de
//   alcance de este bloque: no se toca aquí.)
// ============================================================
import { NextResponse } from 'next/server';
import { apiError } from './errors';

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Ver "EXENCIÓN" en la cabecera. Ancla por segmento — mismo criterio que el matcher de `middleware.ts` (evita matchear p.ej. `/api/refresh-token`). */
const RUTA_EXENTA = '/api/refresh';
function esRutaExenta(pathname: string): boolean {
  return pathname === RUTA_EXENTA || pathname.startsWith(`${RUTA_EXENTA}/`);
}

/** `pathname` de la request; `''` (nunca exenta, fail-closed) si `req.url` no es una URL absoluta parseable. */
function pathnameDe(req: Request): string {
  try {
    return new URL(req.url).pathname;
  } catch {
    return '';
  }
}

/** Origen normalizado (protocolo+host+puerto, minúsculas, sin trailing slash) o `null` si no es una URL absoluta válida. */
function normalizarOrigin(valor: string | null): string | null {
  if (!valor) return null;
  try {
    return new URL(valor).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Host-only por convención de la plataforma Vercel — tanto `VERCEL_URL`
 * como `VERCEL_PROJECT_PRODUCTION_URL` documentan exponer SOLO el host,
 * NUNCA el protocolo (`app-xyz.example.com`, `portal.example.com`)
 * — Vercel sirve siempre por https, así que se antepone `https://` antes
 * de normalizar. Defensivo ante un valor que YA trae esquema (no
 * documentado por Vercel, pero "no asumas": si la convención cambiara o
 * alguien lo definiera a mano con protocolo, NO se duplica
 * `https://https://...` — se detecta el esquema existente y se respeta).
 */
function normalizarOrigenVercel(valor: string | undefined): string | null {
  if (!valor) return null;
  const tieneEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(valor);
  return normalizarOrigin(tieneEsquema ? valor : `https://${valor}`);
}

/**
 * Allowlist recalculada en cada llamada — barata (un puñado de lecturas
 * de `process.env` + parseo de URL) y así una prueba puede mutar
 * `process.env` entre casos sin `vi.resetModules()`.
 *
 *   - `http://localhost:3000` — SOLO fuera de un deployment real de
 *     Vercel (A2, auditoría de seguridad INV-B7B): dev local (`npm run
 *     dev`) Y la verificación local de un build de producción vía
 *     `next start` (que TAMBIÉN corre con `NODE_ENV=production` — por
 *     eso NO se usa `NODE_ENV` para acotar esto: rompería justo el smoke
 *     que este bloque pide no romper). La señal correcta es
 *     `process.env.VERCEL`: Vercel la fija SIEMPRE (build y runtime) en
 *     CUALQUIER deployment real —producción o preview— y NUNCA en local
 *     (ni `next dev` ni `next start`). En un deployment real nadie manda
 *     de forma legítima `Origin: http://localhost:3000`; dejarlo ahí
 *     regalaba una entrada gratis a cualquier atacante.
 *   - `http://localhost:<PORT>` — Next expone el puerto REAL en
 *     `process.env.PORT` (lo fija `start-server.js` incluso arrancando
 *     con `-p`, p.ej. `next start -p 3100` para verificar un build de
 *     producción) — así el puerto con el que en verdad se levantó el
 *     server pasa siempre, sin hardcodear cada puerto usado alguna vez
 *     para QA ni depender de que alguien agregue uno nuevo a mano. NO se
 *     acota a `!VERCEL` (a diferencia del punto anterior): la auditoría
 *     (A2) solo señaló el `http://localhost:3000` hardcodeado; en Vercel
 *     `PORT` no es parte documentada del contrato de invocación de una
 *     función serverless — acotarlo también habría sido alcance no
 *     pedido, sin un hallazgo que lo respalde.
 *   - `NEXT_PUBLIC_SITE_URL` — dominio público del portal; debe ser una
 *     URL absoluta CON protocolo (`https://inventory.example.com`), no
 *     un host suelto.
 *   - `VERCEL_URL` — deployment ACTUAL (uno DISTINTO por cada build o
 *     preview) — NUNCA el alias de producción.
 *   - `VERCEL_PROJECT_PRODUCTION_URL` (A1, auditoría de seguridad
 *     INV-B7B) — a diferencia de `VERCEL_URL`, esta SÍ es el alias de
 *     producción ESTABLE del proyecto: Vercel la expone en TODOS los
 *     entornos (build y runtime; producción y preview) en cuanto el
 *     proyecto tiene un dominio de producción asignado, sin depender de
 *     que alguien configure `NEXT_PUBLIC_SITE_URL` a mano. Sin esto, el
 *     día del lanzamiento la allowlist en Vercel quedaba
 *     `{localhost:3000, localhost:$PORT, https://$VERCEL_URL}` —
 *     `VERCEL_URL` es la URL POR DEPLOYMENT, nunca el alias de
 *     producción ni un dominio propio — y las 8 rutas de escritura le
 *     devolvían 403 a todo el mundo. Ver también el aviso de arranque en
 *     `next.config.mjs` (mismo hallazgo A1) y `.env.example`.
 */
function allowlist(): Set<string> {
  const origenes = new Set<string>();

  if (!process.env.VERCEL) {
    origenes.add('http://localhost:3000');
  }

  const puerto = process.env.PORT;
  if (puerto && /^\d+$/.test(puerto)) {
    origenes.add(`http://localhost:${puerto}`);
  }

  const siteUrl = normalizarOrigin(process.env.NEXT_PUBLIC_SITE_URL ?? null);
  if (siteUrl) origenes.add(siteUrl);

  const vercelUrl = normalizarOrigenVercel(process.env.VERCEL_URL);
  if (vercelUrl) origenes.add(vercelUrl);

  const vercelProdUrl = normalizarOrigenVercel(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelProdUrl) origenes.add(vercelProdUrl);

  return origenes;
}

/**
 * Gate de `Origin` para rutas de escritura (O8). `null` = pasa; si no,
 * la respuesta 403 `forbidden_origin` ya armada — el caller solo debe
 * propagarla, como PRIMERA línea del handler, antes de leer el body:
 * `const gate = requireSameOrigin(req); if (gate) return gate;`
 */
export function requireSameOrigin(req: Request): NextResponse | null {
  const metodo = req.method.toUpperCase();
  if (!METODOS_MUTANTES.has(metodo)) return null;

  if (esRutaExenta(pathnameDe(req))) return null;

  const origin = normalizarOrigin(req.headers.get('origin'));
  if (origin !== null && allowlist().has(origin)) return null;

  return apiError('forbidden_origin', { message: 'Origen no permitido para esta operación.' });
}
