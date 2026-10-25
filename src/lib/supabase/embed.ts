// ============================================================
// Bloque 3 · API · embed.ts  (PURO)
// Unwrap de relaciones embebidas de PostgREST: la cardinalidad que
// infiere PostgREST decide si la relación llega como objeto o como
// array de un elemento. Mismo patrón/semántica que
// `src/services/etl/persist.ts:23-40` — NO se importa de `etl/*` (ese
// módulo está prohibido de tocar/depender en B3: efectos, service_role).
// 🔴 La línea anterior enumeraba TRES consumidores («inventory.service.ts,
// sku.service.ts y override.service.ts»). Medido el 21-sep-2026 son SIETE
// —se sumaron clasificacion, dashboard, drift-familias y proyectos—, así que
// la lista llevaba tiempo mintiendo. No se vuelve a escribir una lista aquí:
// una enumeración en un comentario es otra COPIA, y las copias envejecen sin
// que nada las coteje. Se mide cuando haga falta:
//   grep -rn "from '@/lib/supabase/embed'" src/ --include=*.ts
// ============================================================

/** Devuelve `rel.nombre` (objeto o array → primer elemento). `null` si no hay match. */
export function embedName(rel: unknown): string | null {
  if (rel == null) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'nombre' in obj) {
    const v = (obj as { nombre: unknown }).nombre;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/** Devuelve `rel.clave` (objeto o array → primer elemento). `null` si no hay match. */
export function embedClave(rel: unknown): string | null {
  if (rel == null) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'clave' in obj) {
    const v = (obj as { clave: unknown }).clave;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Devuelve `rel.email` (objeto o array → primer elemento). `null` si no hay
 * match. [INV-B8] Tercer campo de la misma familia: `proyectos` embebe
 * `perfiles(email)` para resolver el responsable, y un proyecto huérfano
 * (`propietario` NULL) llega aquí como `null` sin caso especial.
 */
export function embedEmail(rel: unknown): string | null {
  if (rel == null) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'email' in obj) {
    const v = (obj as { email: unknown }).email;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * [VERT-B2] Devuelve `rel.excluida_del_catalogo` (objeto o array -> primer
 * elemento). **`false` cuando no hay dato**, y esa eleccion importa:
 *
 * si devolviera `null`/`undefined` ante un embed ausente, un `select` al que se
 * le olvidara pedir la columna dejaria de excluir EN SILENCIO y el catalogo
 * volveria a mostrar el universo completo sin que nada se pusiera rojo. Con `false` el fallo es EL MISMO:
 * esta funcion NO lo denuncia y no puede hacerlo.
 *
 * 🔴 Y AQUI ESTA LINEA AFIRMABA UNA RED QUE NO EXISTIA. Decia que «el trinquete
 * de este bloque lo caza, porque compara el conteo del catalogo contra el del
 * dashboard Y EL DE LA BASE». Cuando se escribio (91p4y57) no habia tal
 * trinquete en el arbol, y la parte «y el de la base» sigue siendo imposible
 * por construccion: el cotejo corre en vitest, sin red y sin base.
 *
 * LO QUE DE VERDAD SOSTIENE ESTA ELECCION, hoy y medido:
 *   · la cadena de cada `select` pinneada por su texto exacto, una vez y en su
 *     propio archivo -- inventory.service.test.ts, dashboard.service.test.ts y
 *     sku.service.test.ts (este ultimo congela la AUSENCIA a proposito: la
 *     Ficha se sirve siempre);
 *   · `vert-b2-regla-exclusion.test.ts`, que corre LAS DOS mitades sobre el
 *     mismo fixture y se pone rojo NOMBRANDO cual dejo de aplicar la regla.
 * Ninguna de las dos mira la base. Que la 0039 este aplicada alla es otra
 * afirmacion, y se verifica contra la base, no aqui.
 *
 * La regla vive en la COLUMNA, no aqui: esto solo la desenvuelve.
 */
export function embedExcluida(rel: unknown): boolean {
  if (rel == null) return false;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'excluida_del_catalogo' in obj) {
    return (obj as { excluida_del_catalogo: unknown }).excluida_del_catalogo === true;
  }
  return false;
}
