// ============================================================
// Bloque 3 · API · fetch-all.ts  (PURO — helper de paginación)
// Supabase/PostgREST capa las filas por respuesta (max-rows, 1000 por
// default). Este helper acumula TODAS las filas de una consulta vía
// `.range(from, to)` en páginas de `pageSize`, deteniéndose en la
// primera página "corta" (menos filas que `pageSize`, incluida una
// página vacía) — señal de que no hay más datos.
// El caller arma la query completa (tabla, select, filtros) y aplica
// `.range(from, to)` dentro de `build`; este helper es agnóstico del
// shape de la fila.
// ============================================================

interface FetchAllResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * [FIX-B2 · cierre] Tope de filas por respuesta de PostgREST en este proyecto
 * (max-rows). Medido por la casa: `.range(0, 4999)` sobre una tabla grande devuelve
 * 1 000, sin error.
 */
export const TOPE_FILAS_POSTGREST = 1000;

export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<FetchAllResult<T>>,
  pageSize = TOPE_FILAS_POSTGREST,
): Promise<T[]> {
  // Una página más ancha que el tope cortaría en SILENCIO: el servidor devuelve
  // 1 000, `rows.length < pageSize` y el bucle se detiene creyendo que no hay
  // más — el mismo defecto que este helper existe para evitar. Se vuelve
  // inexpresable aquí en vez de confiar en que nadie pase un `pageSize` grande
  // (medido por el verificador W2 el 29-sep: `pageSize` 5 000 sobre una tabla de miles de filas
  // traía 1 000).
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > TOPE_FILAS_POSTGREST) {
    throw new Error(
      `fetchAllRows: pageSize ${pageSize} fuera de [1, ${TOPE_FILAS_POSTGREST}]; ` +
        'una página más ancha que el tope de PostgREST se corta en silencio',
    );
  }
  const out: T[] = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await build(from, to);
    if (error) {
      throw new Error(error.message);
    }
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

/**
 * [FIX-B2] Devuelve una lectura paginada con la forma de UNA respuesta de
 * PostgREST —`{ data, error }`— en vez de rechazar.
 *
 * Existe para los sitios que pasaron de una lectura suelta a `fetchAllRows` sin
 * cambiar su manejo de errores: los que leen varias tablas en un `Promise.all`
 * y revisan `.error` DESPUÉS, en un orden fijo (`proyectos.service.ts`,
 * `avisos.service.ts`). Con un `fetchAllRows` desnudo, el primero en rechazar
 * ganaría la carrera y el orden en que se reporta un fallo cambiaría; con
 * esto, el sitio sigue leyendo `.error` exactamente donde lo leía y con el
 * mismo mensaje — `fetchAllRows` lanza `Error(error.message)`, y aquí vuelve a
 * ser ese `message`.
 *
 * Una diferencia con la lectura suelta, dicha: esto convierte CUALQUIER
 * rechazo, no sólo el `.error` de PostgREST. Un fallo de programación dentro
 * del closure (medido al escribirlo: un fake de prueba sin `.order`) sale como
 * `<tabla>: <mensaje>` en vez de propagarse crudo. El sitio lo lanza igual;
 * sólo gana el nombre de la tabla.
 *
 * No cambia el contrato de `fetchAllRows`: lo envuelve.
 */
export async function comoRespuesta<T>(
  lectura: Promise<T[]>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  try {
    return { data: await lectura, error: null };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}
