// ============================================================
// Bloque 7-A · url-query.ts  (100% PURO)
// Extraído (fix M5, ronda 2 de revisor-codigo) de `catalogo-view.tsx` y
// `embarques-view.tsx`: ambas vistas server-driven-por-URL tenían la
// MISMA pareja de helpers duplicada carácter por carácter — el patrón
// "TODO el estado vive en la URL" (`useSearchParams` como fuente de
// verdad, `router.replace` para escribir) que comparten. Vive aquí,
// co-localizado con `formato.ts`/`fechas.ts` (helpers puros compartidos
// entre features), para que la PRÓXIMA vista server-driven-por-URL (y
// no una tercera copia) importe esto.
// ============================================================

/**
 * Arma `${base}?...` reenviando SOLO los params de `campos` presentes en
 * `searchParams` (skip-empty: un valor `""` se omite — algunos contratos
 * de query, p.ej. `embarquesQuerySchema.q`, responden 400 ante un string
 * vacío en vez de tratarlo como "sin filtro"). Sin querystring resultante,
 * regresa `base` sin `?` final.
 */
export function construirUrlApi(base: string, campos: readonly string[], searchParams: URLSearchParams): string {
  const sp = new URLSearchParams();
  for (const campo of campos) {
    const valor = searchParams.get(campo);
    if (valor !== null && valor !== '') sp.set(campo, valor);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * [2.0.1-A · revisión M2] Los seis filtros que el USUARIO controla desde la
 * barra del catálogo. Antes este predicado vivía DOS veces — `hasFilters` en
 * `catalogo-filtros.tsx` y `sinFiltros` (negado) en `catalogo-view.tsx` — y
 * agregar `estatus` obligó a editar ambos: exactamente el modo en que dos
 * copias divergen el día que alguien edita una sola. `badge`/`sinV2` quedan
 * FUERA a propósito: son drill-downs sin control propio en la barra, y la
 * vista los trata aparte (chips sí, cold-start no — decisión de B6/MVP-2).
 */
export interface FiltrosDeUsuario {
  q: string;
  marca: string | null;
  familia: string | null;
  almacen: string | null;
  tecnologia: string | null;
  estatus: string | null;
  /**
   * [CAT-B1 · Tramo C] ÚLTIMO nivel del árbol — SOLO navegable desde
   * `CatalogoArbol` (`CatalogoFiltros` no tiene `<select>` propio para este
   * nivel). Opcional para no obligar a ese caller a declarar un campo que
   * no controla; `Boolean(undefined)` es `false`, igual que los demás.
   */
  producto?: string | null;
}

export function hayFiltrosDeUsuario(f: FiltrosDeUsuario): boolean {
  return Boolean(f.q || f.marca || f.familia || f.almacen || f.tecnologia || f.estatus || f.producto);
}

/**
 * Aplica `updates` (string → set, null/"" → delete) sobre una copia de
 * `current` y regresa el querystring resultante ("" si queda vacío). Los
 * valores por defecto (page=1, etc.) se omiten del lado del caller — la
 * URL nunca guarda params redundantes. 100% PURO.
 */
export function aplicarActualizacion(
  current: URLSearchParams,
  updates: Record<string, string | null>,
  opts: { resetPage?: boolean } = {},
): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  if (opts.resetPage) next.delete('page');
  const qs = next.toString();
  return qs ? `?${qs}` : '';
}
