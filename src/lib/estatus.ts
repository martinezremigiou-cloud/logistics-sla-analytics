// ============================================================
// lib · estatus.ts  (100% PURO)
//
// La taxonomía de estatus del catálogo. Vivía dentro de
// `src/components/catalogo/estatus-pill.tsx` y se mudó aquí en [INV-B8],
// sin cambiarle una coma a la regla.
//
// POR QUÉ SE MUDÓ. El documento de Proyectos tiene que imprimir el MISMO
// estatus que pinta la pantalla, y lo genera un servicio en el servidor.
// Dejar la función en un componente obligaba a una de dos cosas, y las dos
// son peores: que `src/services/**` importara de `src/components/**`
// —invirtiendo la única frontera de capas que este repo respeta hoy: 27
// aristas app→services y CERO components→services— o duplicar la
// precedencia. Duplicarla es exactamente el modo de falla que ya ocurrió
// con `sobre_reservado`, que quedó re-derivado en 4 sitios y con semántica
// DISTINTA en `ficha-header.tsx`, así que un SKU sobre-reservado y sin
// familia sale con 1 badge en la Ficha y 2 en el Catálogo.
//
// [2.0.1-A] POR QUÉ AHORA ES DATA Y NO SOLO UNA FUNCIÓN. El filtro por
// estatus del catálogo necesita OFRECER las opciones, y una lista escrita a
// mano en el componente sería una segunda verdad que diverge el día que
// nazca un estatus. La taxonomía es el arreglo `TAXONOMIA_ESTATUS` (el
// ORDEN del arreglo ES la precedencia) y `resolverEstatus` lo recorre: una
// entrada nueva aparece sola en el filtro, en la pastilla y en el schema
// (`CLAVES_ESTATUS`), sin que nadie tenga que acordarse de tres sitios.
//
// `estatus-pill.tsx` y `documento/modelo.ts` la siguen consumiendo; la
// regla es la misma y sigue teniendo una sola casa.
// ============================================================
import type { BadgeCatalogo } from '@/types/api';

export type Tono = 'warn' | 'neutral' | 'info' | 'success';

interface EntradaTaxonomia {
  /**
   * Identidad estable para URL/query (`?estatus=`). El `label` es lo que se
   * MUESTRA — pero no es cosmético: sale impreso en el documento de
   * Proyectos que va HACIA UN CLIENTE (`documento/modelo.ts` ·
   * `estatusDeFila` usa `.label` literal, y `documento.test.ts` lo afirma).
   * Re-redactar un label re-redacta ese papel; la clave es la que nunca
   * cambia.
   */
  clave: string;
  label: string;
  tono: Tono;
  /** Predicado de la entrada. La ÚLTIMA entrada del arreglo debe ser TOTAL (siempre true) — lo vigila `estatus.test.ts`. */
  aplica: (badges: readonly BadgeCatalogo[], disponible: number) => boolean;
}

/**
 * Taxonomía de estatus del catálogo. **El orden del arreglo es la
 * precedencia** (se resuelve la primera entrada que aplica):
 *   1. 'sobre_reservado' (badge) → "Sobre-reservado", tono warn (NUNCA rojo/danger).
 *   2. 'stock_cero' (badge)      → "Sin stock", tono neutro.
 *   3. disponible === 0          → "Reservado completo", tono info.
 *   4. cualquier otro caso       → "Disponible", tono success.
 * Reutilizable por la Ficha SKU, por el documento de Proyectos y por el
 * filtro del catálogo (mismos `badges`/`disponible` del contrato).
 *
 * OJO: `clave` NO es `BadgeCatalogo` aunque `sobre_reservado` coincida en
 * el literal. `?badge=stock_cero` (presencia del badge, ignora precedencia)
 * y `?estatus=sin_stock` (estatus resuelto, aplica precedencia) son
 * conjuntos DISTINTOS: un SKU con `total=0` y `resv>0` trae los dos badges
 * y su estatus es "Sobre-reservado" — el filtro por estatus "Sin stock" NO
 * lo incluye; el drill-down `?badge=stock_cero` del dashboard sí.
 * `inventory.service.test.ts` fija esa diferencia sobre un fixture.
 */
export const TAXONOMIA_ESTATUS = [
  {
    clave: 'sobre_reservado',
    label: 'Sobre-reservado',
    tono: 'warn',
    aplica: (badges) => badges.includes('sobre_reservado'),
  },
  {
    clave: 'sin_stock',
    label: 'Sin stock',
    tono: 'neutral',
    aplica: (badges) => badges.includes('stock_cero'),
  },
  {
    clave: 'reservado_completo',
    label: 'Reservado completo',
    tono: 'info',
    aplica: (_badges, disponible) => disponible === 0,
  },
  {
    clave: 'disponible',
    label: 'Disponible',
    tono: 'success',
    aplica: () => true,
  },
] as const satisfies readonly EntradaTaxonomia[];

export type ClaveEstatus = (typeof TAXONOMIA_ESTATUS)[number]['clave'];

/** Las claves en orden de precedencia, como tupla no vacía (forma que exige `z.enum` en `inventory.schema.ts`). */
export const CLAVES_ESTATUS = TAXONOMIA_ESTATUS.map((e) => e.clave) as [ClaveEstatus, ...ClaveEstatus[]];

export interface Estatus {
  clave: ClaveEstatus;
  label: string;
  tono: Tono;
}

/**
 * Resuelve el estatus de un SKU: la PRIMERA entrada de la taxonomía que
 * aplica. Nunca devuelve `undefined` porque la última entrada es total —
 * el `??` de abajo existe para el type-checker, y `estatus.test.ts` vigila
 * que la totalidad de la última entrada siga siendo cierta.
 *
 * [INV-B8] OJO con el límite de esta función, que NO es un defecto suyo:
 * decide sobre las cifras del snapshot pinneado, así que para un SKU que
 * ya no viene en el Excel devuelve "Sin stock" — correcto sobre su
 * entrada, falso sobre la realidad. Esa distinción no se resuelve
 * cambiando esta regla (la usa todo el catálogo), sino declarando aparte
 * la procedencia de la fila: ver `fueraDelVigente` en
 * `src/services/derivaciones.ts`.
 */
export function resolverEstatus(badges: BadgeCatalogo[], disponible: number): Estatus {
  const entrada =
    TAXONOMIA_ESTATUS.find((e) => e.aplica(badges, disponible)) ?? TAXONOMIA_ESTATUS[TAXONOMIA_ESTATUS.length - 1];
  return { clave: entrada.clave, label: entrada.label, tono: entrada.tono };
}
