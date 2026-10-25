/**
 * Los roles del portal. `admin` escribe; los otros tres LEEN.
 *
 * 🔴 EL PÁRRAFO QUE ESTABA AQUÍ AFIRMABA ALGO FALSO, y se salda por delante
 * porque su autoridad era justo el problema. Decía: «ningún permiso se concede
 * jamás comparando contra 'kam'/'visitante' directamente (las policies RLS de
 * escritura son SIEMPRE `is_admin()`)».
 *
 * Medido el 22-sep-2026: dejó de ser cierto en el Bloque 8, cuando los
 * proyectos estrenaron un SEGUNDO eje de permiso. Había **seis** sitios
 * concediendo permiso por comparación directa contra `'visitante'` —cuatro en
 * TypeScript y dos en policies— y todos como LISTA NEGRA, así que un rol nuevo
 * los pasaba y nacía con escritura.
 *
 * Cerrado en la `0042` y en `PUEDE_ESCRIBIR_PROYECTOS` (`lib/roles.ts`): hoy el
 * permiso se pregunta por su nombre, no por la identidad del rol. **La regla de
 * arriba vuelve a ser cierta porque se hizo cierta, no porque se afirmara.**
 *
 * `soporte` (22-sep-2026) es de SOLO LECTURA: lee lo mismo que `kam` y no
 * escribe nada, ni siquiera proyectos propios. No nace de un trigger —
 * `handle_new_user` clava `'kam'`— así que sólo un admin lo asigna.
 */
export type Rol = 'kam' | 'admin' | 'visitante' | 'soporte';
/**
 * Campos de `productos_override` (WRITE admin, D3). Hasta FIX-B1 el CHECK de
 * `productos_override.campo` (0001:284) solo admitía `'familia'|'descripcion'`
 * — la migración de FIX-B1/T2a lo amplía con `'tecnologia'`, gobernada por la
 * regla «el Excel gana» (inversa de familia/descripción, donde gana el
 * portal): ver `capaFuenteManual` en `services/derivaciones.ts`. Única fuente
 * de este union — los ~10 sitios que antes lo repetían como literal
 * `'familia' | 'descripcion'` ahora IMPORTAN este tipo, para que un campo
 * nuevo no se quede fuera de alguno por copiar-pegar.
 */
export type CampoOverride = 'familia' | 'descripcion' | 'tecnologia';
export type ClaveAlmacen = 'NORTH' | 'SOUTH' | 'EAST' | 'TRAN' | 'BO' | 'WEST';
/**
 * Las 6 claves de almacén, en el orden fijo canónico (facetas del
 * catálogo, columnas del heatmap del dashboard, etc.) — R2-3: antes
 * duplicada, idéntica, en `inventory.service.ts` y `dashboard.service.ts`.
 */
export const ALMACENES: ClaveAlmacen[] = ['NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'WEST'];
/** orden 1–11 del pipeline de aduana (estatus_catalogo, ampliado en B2/0004). */
export type OrdenEstatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** Fila de `estatus_alias` (B2/0004): variante cruda → orden canónico 1..11. */
export interface EstatusAlias {
  alias: string;
  orden: OrdenEstatus;
}
/** Identificador de producto. INMUTABLE: llave universal (Principio #2). */
export type SkuId = string;
/**
 * Capa que aportó el valor efectivo de un campo de clasificación. Hasta
 * B-PARCHE F1: manual (override) > v2 (`clasificacion_v2`) > fuente
 * (`productos`). Desde D-1(a) (CAT-B1 · Tramo B, 17-sep): `clasificacion_v2`
 * se CONGELA — pierde la precedencia, no se borra — y la precedencia que
 * `resolverClasificacion` (`derivaciones.ts`) puede producir es solo
 * `manual > fuente`. `'v2'` SIGUE en esta unión a propósito: no se borra
 * sin medir quién lo lee (hay consumidores de `origen`/`divergencia_familia`
 * fuera de `derivaciones.ts` — ver `ficha-atributos.tsx`), pero desde este
 * commit ningún código de este archivo lo EMITE.
 */
export type OrigenClasificacion = 'manual' | 'v2' | 'fuente';
