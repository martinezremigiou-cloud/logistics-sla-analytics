// ============================================================
// Bloque 5 · P3 · colores-sku.ts  (100% PURO)
// Paleta curada de 8 colores para SKUs (`color?: string|null` en
// `CatalogoItem`/`SkuDetalle`). Espejo del CHECK de
// `productos_metadata.color` (0006_b5_dominio.sql) y de `colorSchema`
// (zod, `src/schemas/color.schema.ts`) — los 8 slugs deben coincidir
// exactamente con ambos.
//
// `light`/`dark` son los mismos hex que los tokens CSS `--mx-tag-{slug}`
// de `globals.css` (:root / .dark) — si cambian aquí, cambian allá.
//
// `bgClass` es la clase Tailwind YA RESUELTA (literal, no interpolada)
// que consume ese token: `bg-[var(--mx-tag-{slug})]`. Tailwind (JIT)
// solo genera CSS para clases que aparecen COMPLETAS y como texto
// literal en el código fuente — construirla con un template string en
// el punto de uso (p.ej. `` `bg-[var(--mx-tag-${color})]` ``) no genera
// ninguna regla real, porque el escáner de Tailwind nunca ve la cadena
// final (solo el código fuente, no el resultado en tiempo de
// ejecución). Por eso las 8 clases viven escritas literalmente aquí
// abajo, y el resto de la UI las consume por lookup (`COLORES_SKU[slug].bgClass`)
// en vez de interpolarlas.
// ============================================================

export type ColorSku = 'azul' | 'verde' | 'naranja' | 'morado' | 'rojo' | 'turquesa' | 'rosa' | 'grafito';

export interface ColorSkuInfo {
  /** Nombre es-MX para UI (swatches, chips, texto sr-only). */
  label: string;
  /** Hex en tema claro — debe coincidir con `--mx-tag-{slug}` en `:root` (globals.css). */
  light: string;
  /** Hex en tema oscuro — debe coincidir con `--mx-tag-{slug}` en `.dark` (globals.css). */
  dark: string;
  /** Clase Tailwind literal `bg-[var(--mx-tag-{slug})]` (ver docstring de arriba). */
  bgClass: string;
}

export const COLORES_SKU: Record<ColorSku, ColorSkuInfo> = {
  azul: { label: 'Azul', light: '#3B6FD9', dark: '#7CA6F5', bgClass: 'bg-[var(--mx-tag-azul)]' },
  verde: { label: 'Verde', light: '#16803D', dark: '#46CC7E', bgClass: 'bg-[var(--mx-tag-verde)]' },
  naranja: { label: 'Naranja', light: '#C2670E', dark: '#E89A4D', bgClass: 'bg-[var(--mx-tag-naranja)]' },
  morado: { label: 'Morado', light: '#7C3AED', dark: '#B29BF7', bgClass: 'bg-[var(--mx-tag-morado)]' },
  rojo: { label: 'Rojo', light: '#DC2626', dark: '#F17A73', bgClass: 'bg-[var(--mx-tag-rojo)]' },
  turquesa: { label: 'Turquesa', light: '#0E7C86', dark: '#58D0DA', bgClass: 'bg-[var(--mx-tag-turquesa)]' },
  rosa: { label: 'Rosa', light: '#BE1C6B', dark: '#F17FB2', bgClass: 'bg-[var(--mx-tag-rosa)]' },
  grafito: { label: 'Grafito', light: '#475569', dark: '#9FB0C6', bgClass: 'bg-[var(--mx-tag-grafito)]' },
};

/** Orden fijo de swatches en UI (ficha editable, catálogo). */
export const ORDEN_COLORES_SKU: readonly ColorSku[] = [
  'azul',
  'verde',
  'naranja',
  'morado',
  'rojo',
  'turquesa',
  'rosa',
  'grafito',
];

/** `true` si `color` es uno de los 8 slugs curados (type guard). */
export function esColorSku(color: string): color is ColorSku {
  return Object.prototype.hasOwnProperty.call(COLORES_SKU, color);
}

/**
 * Lookup defensivo de metadata por slug: `null`/`undefined`/slug
 * desconocido → `null` (nunca lanza). Pensado para `item.color` de
 * `CatalogoItem`/`SkuDetalle`, que llega como `string | null` (o
 * `undefined` en fixtures viejos) desde el contrato, no como `ColorSku`.
 */
export function colorSkuInfo(color: string | null | undefined): ColorSkuInfo | null {
  if (!color) return null;
  return esColorSku(color) ? COLORES_SKU[color] : null;
}
