// ============================================================
// Bloque · INV-TAXO · F1 · lib · familias.ts  (100% PURO)
// `familia` es un campo MULTI-VALOR mal modelado como texto: muchas
// familias distintas conviven en una sola celda separadas por '/' (una
// parte notable de los SKUs). Sin este módulo, filtrar 'SERIES 12' encuentra
// menos SKUs de los que en realidad la contienen, y buscar 'SERIES20' da 0
// resultados porque vive dentro de 'CLIP 3.0 / CLIP ROTATIVO'.
//
// PRINCIPIO RECTOR (regla dura, ver cabecera del bloque): las familias
// sirven para ENCONTRAR (filtrar/buscar/navegar), NUNCA para SUMAR
// piezas. Toda agregación de CANTIDAD usa SIEMPRE dimensiones de valor
// único (marca, almacén) — explotar familias dentro de una suma infla
// el total: los SKUs multi-familia contarían su stock varias veces
// (medido contra el vigente: el total se inflaba de forma material).
// `separarFamilias` JAMÁS
// debe usarse dentro de una agregación de cantidad — ver el test del
// GATE en `dashboard.service.test.ts` (heatmap marca × almacén).
// ============================================================

/** Único separador reconocido por este módulo — ver regla 1 de `separarFamilias`. */
export const SEPARADOR_FAMILIA = '/';

/**
 * `true` si el átomo es sospechoso de ser un sufijo/variante de MODELO,
 * no una familia real — heurística DATA-DRIVEN: `length <= 2` o
 * puramente numérico (`^\d+$`). Evidencia medida (regla 7, compuerta
 * anti-átomo-fantasma de `separarFamilias`): `ZV680G/K` produciría la
 * familia fantasma "K" y `Z1900 / 6693` produciría "6693" — ambos son sufijos de modelo, no familias (evidencia: `ZV680M`
 * ya existe como fila propia del catálogo de familias). Estos 2 casos
 * quedan encolados en la bandeja de pendientes (migración 0011, tipo
 * `familia_atomo_dudoso`) para veredicto humano.
 */
function esAtomoSospechoso(atomo: string): boolean {
  return atomo.length <= 2 || /^\d+$/.test(atomo);
}

/**
 * `trim` + colapsar espacios internos a uno solo (regla 3). NUNCA
 * uppercasea — fidelidad de display: el átomo se muestra tal cual lo
 * capturó el Excel. Las comparaciones (`contieneFamilia`) son
 * case-insensitive; el DATO mostrado no se toca.
 */
function normalizarAtomo(atomo: string): string {
  return atomo.trim().replace(/\s+/g, ' ');
}

/**
 * Separa el campo crudo `familia` en sus átomos EFECTIVOS. Reglas,
 * cada una con la evidencia medida que la respalda:
 *
 * 1. Separa SOLO por '/'. JAMÁS por '&' (hay nombres propios que lo
 *    contienen: 'CLIPS 5 & 9', 'CLIPS 5 & 9 PORT') ni por '-' (varios
 *    nombres propios lo llevan: 'P-LOCK', 'R-LOCK', 'CLIP NON-MODULAR',
 *    'CLIP MINI-B'…) — separar por ellos inventaría familias fantasma
 *    que no existen en el catálogo.
 * 2. Tolera '/' con o sin espacios alrededor: 'QZ8/H5980' (visto en
 *    julio) y 'QZ8 / H5980' (visto en abril) son el MISMO concepto.
 * 3. Por átomo: trim + colapsar espacios internos (`normalizarAtomo`).
 *    NUNCA uppercasea (fidelidad de display); las comparaciones son
 *    case-insensitive, no el dato mostrado.
 * 4. Los átomos vacíos se descartan: `'A / / B'` → `['A', 'B']`.
 * 5. Dedupe case-insensitive PRESERVANDO el orden de aparición del
 *    crudo — el orden del crudo es legible tal cual viene capturado
 *    ('CLIP 3.0 / CLIP ROTATIVO' se lee en ese orden).
 * 6. `null`/`''`/solo-espacios → `[]` — EXACTAMENTE equivalente al
 *    `familia === null` de hoy, que alimenta el badge `sin_familia`.
 * 7. COMPUERTA ANTI-ÁTOMO-FANTASMA (crítica): si CUALQUIER átomo
 *    resultante es sospechoso (`esAtomoSospechoso`), este valor NO se
 *    atomiza: se devuelve el string completo (normalizado, SIN
 *    partirlo por '/') como único elemento — ver casos reales
 *    documentados en `esAtomoSospechoso`.
 *
 * `contieneFamilia` (abajo) es la única forma soportada de comparar
 * pertenencia contra el resultado de esta función — ver regla 8 ahí.
 */
export function separarFamilias(valor: string | null | undefined): string[] {
  if (valor == null) return [];
  const crudo = valor.trim();
  if (crudo.length === 0) return [];

  const atomos = crudo
    .split(SEPARADOR_FAMILIA)
    .map(normalizarAtomo)
    .filter((atomo) => atomo.length > 0);

  if (atomos.length === 0) return [];

  if (atomos.some(esAtomoSospechoso)) {
    // Compuerta anti-átomo-fantasma (regla 7): el crudo COMPLETO
    // (normalizado, sin partirlo) es el único elemento. Nunca se pierde
    // el SKU: sigue teniendo "una familia", solo que con el nombre
    // completo en vez de sus fragmentos por '/'.
    return [normalizarAtomo(crudo)];
  }

  const vistos = new Set<string>();
  const resultado: string[] = [];
  for (const atomo of atomos) {
    const clave = atomo.toLowerCase();
    if (!vistos.has(clave)) {
      vistos.add(clave);
      resultado.push(atomo);
    }
  }
  return resultado;
}

/**
 * `true` si `buscada` pertenece a `familias` — PERTENENCIA TOKEN-EXACTA
 * case-insensitive, NUNCA substring (regla 8): con substring, 'SERIES12'
 * capturaría 'SERIES 12' (familia real distinta: hoy menos SKUs bajo
 * igualdad exacta que los que la contienen como multi-valor — ninguno de los
 * dos números viene de un substring), 'CLIP' capturaría decenas de familias que
 * solo comparten el prefijo, y 'LOCK' se llevaría 'P-LOCK' + 'R-LOCK'
 * (nombres propios con guion, regla 1). El substring de búsqueda libre
 * (`?q=`, que sí resuelve 'SERIES20') vive en otra capa
 * (`inventory.service.ts`), NUNCA aquí.
 *
 * Recibe `familias` YA separadas (p. ej. `CatalogoItem.familias`) — R2-2:
 * evita que cada caller vuelva a ejecutar `separarFamilias` sobre el
 * campo crudo cuando el arreglo ya está calculado. Para comparar contra
 * el campo crudo (`string | null`) usa `contieneFamilia`, abajo.
 */
export function perteneceAFamilia(familias: string[], buscada: string): boolean {
  const buscadaLower = buscada.trim().toLowerCase();
  return familias.some((f) => f.toLowerCase() === buscadaLower);
}

/**
 * Igual que `perteneceAFamilia`, pero a partir del campo CRUDO (separa
 * internamente vía `separarFamilias`) — conveniencia para callers que no
 * tienen ya el arreglo a la mano (p. ej. `familias.test.ts`). Cuando el
 * arreglo YA está calculado (como `CatalogoItem.familias`), usa
 * `perteneceAFamilia` directamente en vez de esta función, para no
 * recalcular `separarFamilias` por ítem.
 */
export function contieneFamilia(valor: string | null | undefined, buscada: string): boolean {
  return perteneceAFamilia(separarFamilias(valor), buscada);
}

/**
 * `true` si `valor` no tiene ninguna familia — EXACTAMENTE cuando no
 * quedan átomos tras separar (`separarFamilias(valor).length === 0`).
 * R2-1: único predicado soportado para "sin familia". Antes convivían
 * dos definiciones que debían ser la misma cosa y no lo eran por
 * construcción: la faceta del catálogo comparaba `familias.length===0`
 * y el badge/filtro `?badge=sin_familia` comparaba `familia_efectiva
 * === null` — con los datos de hoy coinciden (ningún SKU diverge), pero
 * `null` no es la única forma de "sin familia": `''`, `'   '` y `'/'`
 * también separan a `[]` y antes NO disparaban el badge. Úsala en vez
 * de repetir la comparación a mano en cualquier punto nuevo.
 */
export function sinFamilia(valor: string | null | undefined): boolean {
  return separarFamilias(valor).length === 0;
}
