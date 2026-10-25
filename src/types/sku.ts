import type { SkuId } from './enums';

export interface Marca {
  readonly id: string;
  nombre: string;
  activo: boolean;
}

export interface Familia {
  readonly id: string;
  nombre: string;
  activo: boolean;
}

/**
 * Producto canónico (tabla `productos`).
 * INVARIANTE: `sku` es inmutable — nunca se reescribe tras la ingesta (D3).
 */
export interface Sku {
  readonly sku: SkuId;
  marca_id: string;
  familia_id: string | null;
  class: string | null;
  descr_origen: string | null;
  cliente: string | null;
  resv: number;
  snapshot_id: string;
}
