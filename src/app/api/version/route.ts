// ============================================================
// [INV-B7B] O12 · Skew protection — /api/version
//
// Expone, EN RUNTIME (sin caché — `dynamic='force-dynamic'` +
// `Cache-Control: no-store`), qué deployment está sirviendo ESTE
// request ahora mismo. El cliente (`aviso-version-nueva.tsx`) compara
// `deploymentId` contra `NEXT_PUBLIC_DEPLOY_ID` — un valor HORNEADO en
// build (ver `next.config.mjs`), congelado en el bundle del navegador
// desde que cargó la página. Esa asimetría (uno se lee ahora, el otro
// quedó fijo desde el build) es justo lo que permite detectar cuándo
// el servidor ya avanzó a un deployment más nuevo que el que el
// usuario tiene abierto en la pestaña.
//
// Sin gate de sesión, a propósito: es metadata de build sin datos de
// negocio, y debe responder incluso con la sesión ya expirada (para
// poder avisar "hay una versión nueva, recarga" antes de que el
// usuario intente cualquier otra cosa). También queda exenta del
// rewrite de mantenimiento (`src/middleware.ts`,
// `esRutaExentaDeMantenimiento`) por la misma razón, y del `matcher`
// del middleware por completo (ronda 2, punto B).
//
// Fuente de cada campo:
//  - `deploymentId`: lectura RUNTIME de `VERCEL_DEPLOYMENT_ID` — el id
//    que Vercel asigna a la instancia que atiende ESTE request. Cambia
//    en cuanto un nuevo deployment queda promovido a producción, sin
//    esperar a que el navegador recargue. Es el campo que compara el
//    aviso del cliente.
//  - `skewProtection`: si Vercel tiene la protección nativa activa
//    para este proyecto (flag propio de la plataforma).
//
// Ronda 2 (punto D) — se ELIMINÓ el campo `builtId` que existía antes:
// leía la MISMA variable `NEXT_PUBLIC_DEPLOY_ID` que `next.config.mjs`
// hornea para el navegador, pero del lado del servidor. La intención
// original era diagnóstica ("¿de qué build es el código que corre
// ahora?", distinto de "¿cuál deployment está live?"), pero en Vercel
// esa distinción es FALSA: `NEXT_PUBLIC_DEPLOY_ID` se hornea, durante
// `next build`, leyendo `VERCEL_DEPLOYMENT_ID` del MISMO deployment que
// luego atiende esta ruta — así que `builtId` y `deploymentId` son,
// siempre, el mismo valor. Un campo que nunca puede diferir de otro ya
// presente no es diagnóstico, es ruido que promete una distinción que
// no existe (su propio comentario anterior lo afirmaba, y no era
// cierto). Si algún día hace falta un dato de "qué build es este"
// genuinamente distinto de `deploymentId` (p.ej. para detectar un
// redeploy del mismo commit), la fuente correcta sería
// `VERCEL_GIT_COMMIT_SHA` leído en runtime (NO horneado vía
// `NEXT_PUBLIC_*`, para no repetir el mismo error) — se decidió no
// agregarlo ahora porque nada en este bloque lo necesita: el único
// consumidor real del contrato (`aviso-version-nueva.tsx`) SOLO compara
// `deploymentId`, nunca leyó `builtId`.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface VersionResponse {
  deploymentId: string;
  skewProtection: boolean;
}

export function GET() {
  const body: VersionResponse = {
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? 'dev',
    skewProtection: process.env.VERCEL_SKEW_PROTECTION_ENABLED === '1',
  };
  return NextResponse.json(body, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}
