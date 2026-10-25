// ============================================================
// scripts/ts-loader.mjs
// Hook de resolución de módulos (Node `module.register`, ver su uso
// en `ingesta-mensual.mjs`) que permite a ese CLI —`node` plano, SIN
// paso de build de TS— importar el motor/preflight/config REALES bajo
// `src/` tal cual, reutilizando el MISMO código que corre bajo TDD
// (vitest) y `tsc --noEmit`, en vez de duplicar lógica de dominio en
// JS aparte (a diferencia de los scripts one-off de este repo, p.ej.
// `bootstrap-admin.mjs`, que sí duplican por ser utilidades
// desechables — este CLI es reutilizable mes a mes, ver su cabecera).
//
// Qué hace (y qué NO hace):
//  - Node ≥23.6 ya "borra" los tipos de un .ts en runtime SIN bandera
//    (type-stripping nativo, sin `--experimental-strip-types`; activo
//    por defecto desde Node 24) — ver la guarda de versión al inicio
//    de `ingesta-mensual.mjs` (exige exactamente este mínimo, con el
//    mismo mensaje de versión que esta nota — mantener ambas en
//    sync). Pero la resolución de módulos de Node EXIGE extensión
//    explícita en imports relativos, y este repo (TS con
//    `moduleResolution: bundler`) importa sin extensión (p.ej. `from
//    './grid'`). Este hook SOLO reintenta la resolución agregando
//    '.ts' o '/index.ts' cuando la resolución normal falla para un
//    specifier relativo — nada más.
//  - NO reescribe el alias '@/*' de tsconfig: los módulos que este
//    CLI toca (`src/services/ingesta/**`, `src/services/etl/**`)
//    importan siempre con rutas relativas a propósito. Los ÚNICOS
//    usos de '@/*' en el árbol del ETL son `import type` (se borran
//    enteros al stripear tipos, nunca se resuelven en runtime — ver
//    el comentario en `src/services/etl/types.ts` y en `motor.ts`) —
//    por eso nunca hace falta resolver alias aquí.
//  - Specifiers de paquete (p.ej. 'xlsx') y `node:*` se resuelven
//    normal (este hook ni los toca: `nextResolve` los resuelve solo).
// ============================================================
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const esRelativo = specifier.startsWith('./') || specifier.startsWith('../');
    const noEncontrado =
      err instanceof Error &&
      (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'ERR_UNSUPPORTED_DIR_IMPORT');
    if (esRelativo && noEncontrado) {
      for (const sufijo of ['.ts', '/index.ts']) {
        try {
          return await nextResolve(specifier + sufijo, context);
        } catch {
          // sigue intentando con el siguiente sufijo
        }
      }
    }
    throw err;
  }
}
