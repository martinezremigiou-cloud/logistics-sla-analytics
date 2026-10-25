import type { SkuId, ClaveAlmacen } from './enums';

export interface Almacen {
  readonly id: string;
  clave: ClaveAlmacen;
  nombre: string;
  activo: boolean;
}

/** D1 — un renglón por (sku, almacén). WEST es un almacén más. */
export interface StockPorAlmacen {
  readonly sku: SkuId;
  readonly almacen_id: string;
  readonly snapshot_id: string;
  cantidad: number;
}

export interface Kam {
  readonly id: string;
  nombre: string;
}

/** D2 — des-pivoteo de la matriz. `kam_id` null ⇒ se atribuye al Cliente. */
export interface Reserva {
  readonly id: string;
  sku: SkuId;
  kam_id: string | null;
  cliente: string;
  cantidad: number;
  motivo: string | null;
  fecha: string;
  snapshot_id: string;
}
