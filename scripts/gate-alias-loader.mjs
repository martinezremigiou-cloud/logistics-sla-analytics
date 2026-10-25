// ============================================================
// scripts/gate-alias-loader.mjs
// Hook ADICIONAL de resolucion de modulos (Node `module.register`),
// COMPLEMENTARIO a `scripts/ts-loader.mjs` (que este archivo NO toca
// -- ver su propio header: "los UNICOS usos de '@/*' en el arbol del
// ETL son `import type`... por eso nunca hace falta resolver alias
// ahi"). Ese supuesto es cierto para el arbol que consume
// `ingesta-mensual.mjs`, pero otros scripts (p. ej. `corpus-sync.mjs`)
// TAMBIEN necesita importar `src/services/derivaciones.ts`
// (`resolverClasificacion`, la resolucion REAL de 3 capas
// manual/v2/fuente -- ver ALCANCE del bloque: "no reimplementes la
// logica") -- y ese archivo SI hace un import de VALOR (no `import
// type`) con alias: `import { sinFamilia } from '@/lib/familias';`.
// Sin este hook, Node revienta con ERR_MODULE_NOT_FOUND: "Cannot
// find package '@/lib'" -- el alias `@/*` -> `./src/*` solo existe
// en `tsconfig.json#paths` (TypeScript lo resuelve al compilar;
// Node no lo conoce en absoluto en runtime).
//
// Se registra como SEGUNDO hook, ademas de `ts-loader.mjs` (ver
// `corpus-sync.mjs`). Ambos son inocuos entre si: este hook
// SOLO actua sobre specifiers que empiezan con '@/' (nunca se cruza
// con la retry relativa de `ts-loader.mjs`, que solo actua sobre
// './' y '../'); cualquier otro specifier se delega intacto a
// `nextResolve`, sin importar el orden de registro de ambos hooks.
//
// GOTCHA DE DEPURACION (dejar este comentario -- costo una bateria
// de sondas por bisección encontrarlo): un hook de `module.register`
// corre en un hilo/realm separado del proceso principal. Si este
// archivo tiene un `import` de nivel superior (p.ej. `import {
// pathToFileURL } from 'node:url'`), Node 24.13.1 revienta el GRAFO
// COMPLETO con un `SyntaxError: Invalid or unexpected token` opaco
// en `compileSourceTextModule` -- sin stack util, sin pasar por
// ningun try/catch del proceso principal (revienta como excepcion no
// capturada aunque el import este envuelto en `try { await
// import(...) } catch`), y sin que ningun console.log/console.error
// de ESTE archivo llegue a imprimirse. Bisectado con multiples
// sondas: `pathToFileURL(...)` (import de 'node:url') revienta;
// el `URL` GLOBAL (sin ningun import) funciona. Por eso este archivo
// NO importa nada: usa el `URL` global (disponible sin import en
// cualquier runtime de Node) y construye la ruta absoluta con texto
// plano.
// ============================================================

// Repo root = un nivel arriba de `scripts/` (este archivo vive en
// `scripts/gate-alias-loader.mjs`).
const RAIZ = new URL('../', import.meta.url).href;
const SRC = new URL('src/', RAIZ).href;

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) {
    return nextResolve(specifier, context);
  }
  const relativo = specifier.slice(2); // '@/lib/familias' -> 'lib/familias'
  const destino = new URL(relativo, SRC).href;
  for (const sufijo of ['.ts', '/index.ts']) {
    try {
      return await nextResolve(destino + sufijo, context);
    } catch {
      // intenta el siguiente sufijo
    }
  }
  // Ningun sufijo resolvio: deja que este ultimo intento (sin
  // sufijo) produzca el error real de Node -- mas util para
  // depurar que relanzar el error del primer intento.
  return nextResolve(destino, context);
}
