// ============================================================
// [INV-B10] lib/chat/termino.ts — limpiar el término antes de buscarlo.
// 100% PURO.
//
// EXISTE POR UNA MEDICIÓN CONTRA EL MODELO REAL, no por precaución. Sondeando
// `gpt-5.6-luna` con la pregunta «Busca los CLIPS», devolvió:
//
//     {"intencion":"buscar_por_nombre","sku":null,"termino":"los CLIPS"}
//
// Con el artículo. Y `listInventory` busca con `ilike '%los CLIPS%'`, que **no
// casa** con «CLIPS 2.0 Pad»: el chat habría contestado «no hay ningún SKU
// que contenga *los CLIPS*» — una respuesta falsa con toda la cara de verdad,
// sobre un catálogo donde CLIPS tiene varias coincidencias.
//
// El prompt también lo pide, pero **pedirlo no basta**: un modelo cumple casi
// siempre, y «casi siempre» sobre la única entrada de texto libre del sistema
// es un fallo silencioso esperando su turno. Se normaliza aquí, donde no
// depende de que el modelo colabore.
//
// NO ES UN LECTOR TOLERANTE (P12). Aquí no se está rellenando un campo
// malformado con un default: se está normalizando lenguaje natural, que es
// justo lo que un buscador de texto tiene que hacer. La diferencia está en que
// esto NO cambia el significado — «los CLIPS» y «CLIPS» son la misma búsqueda.
// ============================================================

/**
 * Artículos y muletillas que la gente pone delante de un nombre de producto.
 * Se quitan solo del PRINCIPIO: uno en medio puede ser parte del nombre.
 */
const ARRANQUES = [
  'los', 'las', 'el', 'la', 'un', 'una', 'unos', 'unas',
  'del', 'de la', 'de los', 'de las', 'de',
];

/**
 * Deja el término listo para `listInventory({ q })`.
 *
 * Devuelve `null` cuando no queda nada que buscar — y eso es información, no
 * un error: el llamador tiene que pedir una aclaración en vez de lanzar una
 * consulta vacía que devolvería el catálogo entero.
 */
export function normalizarTermino(crudo: string | null): string | null {
  if (!crudo) return null;

  // Comillas y signos de interrogación sobran: el usuario escribió «busca "los
  // CLIPS"?» y las comillas no están en ninguna descripción.
  let t = crudo.trim().replace(/^[«"'¿¡]+|[»"'?!.,;:]+$/g, '').trim();

  // Se pela un arranque a la vez y solo mientras quede algo detrás: «la` no
  // puede vaciar el término y dejar una búsqueda de todo el catálogo.
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const a of ARRANQUES) {
      const prefijo = a + ' ';
      if (t.toLowerCase().startsWith(prefijo) && t.length > prefijo.length) {
        t = t.slice(prefijo.length).trim();
        cambio = true;
        break;
      }
    }
  }

  return t.length > 0 ? t : null;
}
