// ============================================================
// B-PARCHE · pg-errors.ts  (PURO — detección de SQLSTATE/PostgREST compartida)
// Antes duplicado localmente (4 copias idénticas: clasificacion/
// inventory/sku/cruce .service.ts) + un inline en override.service.ts.
// Único punto de verdad para los códigos que el dominio tolera/traduce
// explícitamente:
//
//   - `esNoDisponiblePorMigracion` — "el objeto de una migración aún sin
//     aplicar no existe" (tablas/RPCs de B-PARCHE `clasificacion_v2`/
//     `tecnologias`, 0008; y de B6 `pendientes_datos`/`contar_pendientes()`,
//     0009). Cubre 4 códigos:
//       - '42P01' "relation does not exist" / '42883' "function does not
//         exist": SQLSTATE de Postgres DIRECTOS — se conservan por
//         defensividad (p.ej. si algún día se corre contra Postgres sin
//         pasar por PostgREST), pero NUNCA se vieron en vivo (ver abajo).
//       - 'PGRST202' / 'PGRST205': los códigos REALES que devuelve
//         PostgREST cuando el objeto no está en su schema cache. Se
//         verificó EMPÍRICAMENTE (2026-07-23) contra el
//         PostgREST vivo, con la migración 0009 sin aplicar:
//           POST /rest/v1/rpc/contar_pendientes
//             → HTTP 404 {"code":"PGRST202","details":"Searched for the
//               function public.contar_pendientes ...schema cache"}
//           GET /rest/v1/pendientes_datos?select=id&limit=1
//             → HTTP 404 {"code":"PGRST205","message":"Could not find
//               the table 'public.pendientes_datos' in the schema cache"}
//         NINGUNA de las dos rutas devolvió 42P01: PostgREST jamás deja
//         pasar el SQLSTATE crudo de Postgres para "objeto ausente" —
//         siempre lo traduce a su propio código de schema-cache
//         (PGRST202 para funciones/RPCs, PGRST205 para tablas/vistas). El
//         precedente 42P01 (B-PARCHE, `clasificacion_v2`/`tecnologias`)
//         nunca se había ejercitado contra un PostgREST real hasta esta
//         verificación — se conserva por compatibilidad, pero PGRST202/
//         PGRST205 son los que de verdad importan en runtime.
//     `esRelacionInexistente` (solo 42P01) existía antes de esta
//     verificación; se consolidó aquí (fix C1, ronda post-revisión de
//     B6) y se eliminó — sus 6 call-sites (inventory/sku/cruce/
//     clasificacion/dashboard/pendientes.service.ts) migraron al nuevo
//     predicado, que cubre el mismo 42P01 más los 3 códigos de arriba.
//
//   - 42501 "insufficient privilege": TOCTOU de un RPC `SECURITY DEFINER`
//     que revalida `is_admin()` dentro de la misma transacción — se
//     traduce a `{ tipo: 'forbidden' }` en vez de un 500 genérico.
//   - P0002 "no_data_found" (B6): `RAISE EXCEPTION ... USING errcode='P0002'`
//     explícito del RPC `resolver_pendiente` (0009) cuando el `id` no
//     existe — se traduce a 404, no a un 500 genérico.
//   - 22023 "invalid_parameter_value" (B6): validaciones de negocio del
//     mismo RPC (acción inválida, pendiente ya resuelto, motivo ausente
//     al descartar) — se traduce a 400.
//   - MXEXL "excel_manda" (FIX-B1): `RAISE EXCEPTION ... USING
//     errcode='MXEXL'` explícito del RPC `aplicar_override` (T2a) cuando
//     `campo='tecnologia'` y `productos.tecnologia` ya trae un valor para
//     ese SKU — el Excel manda, el portal no puede sobrescribirlo.
//   - MXTEC "tecnologia_no_seleccionable" (FIX-B1): mismo RPC, mismo
//     `campo`, cuando el valor propuesto no está en
//     `tecnologias_seleccionables()`.
// ============================================================

/** Shape mínimo de un error de PostgREST/Supabase (o `null`) — sin depender de sus tipos concretos. */
interface PgErrorLike {
  code?: string;
}

/** Códigos que indican "el objeto de una migración aún sin aplicar no existe" — ver comentario de cabecera. */
const CODIGOS_NO_DISPONIBLE_POR_MIGRACION = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

/**
 * `true` si el error indica que una tabla/vista o una función/RPC aún no
 * existe porque su migración no se ha aplicado (PGRST202/PGRST205 reales
 * de PostgREST, o 42P01/42883 defensivos) — ver comentario de cabecera
 * para la evidencia empírica de cada código.
 */
export function esNoDisponiblePorMigracion(e: PgErrorLike | null): boolean {
  const code = e?.code;
  return code !== undefined && CODIGOS_NO_DISPONIBLE_POR_MIGRACION.has(code);
}

/** `true` si el error es SQLSTATE 42501 ("insufficient privilege"). */
export function esForbidden(e: PgErrorLike | null): boolean {
  return e?.code === '42501';
}

/** `true` si el error es SQLSTATE P0002 ("no_data_found" — RAISE explícito de un RPC ante una fila inexistente). */
export function esNoEncontrado(e: PgErrorLike | null): boolean {
  return e?.code === 'P0002';
}

/** `true` si el error es SQLSTATE 22023 ("invalid_parameter_value" — validación de negocio explícita de un RPC). */
export function esEntradaInvalida(e: PgErrorLike | null): boolean {
  return e?.code === '22023';
}

/** [FIX-B1] `true` si el error es SQLSTATE 'MXEXL' ("excel_manda" — el RPC `aplicar_override` rechazó un override de tecnología porque el Excel ya trae valor para ese SKU). */
export function esExcelManda(e: PgErrorLike | null): boolean {
  return e?.code === 'MXEXL';
}

/** [FIX-B1] `true` si el error es SQLSTATE 'MXTEC' ("tecnologia_no_seleccionable" — el valor propuesto no está en `tecnologias_seleccionables()`). */
export function esTecnologiaNoSeleccionable(e: PgErrorLike | null): boolean {
  return e?.code === 'MXTEC';
}
