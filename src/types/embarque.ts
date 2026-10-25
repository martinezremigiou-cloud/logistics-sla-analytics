import type { SkuId, OrdenEstatus } from './enums';

export interface EstatusCatalogo {
  orden: OrdenEstatus;
  nombre: string;
}

export interface Embarque {
  readonly id: string;
  sku: SkuId;
  oc_po: string | null;
  proveedor: string | null;
  referencia: string | null;
  factura: string | null;
  pais_origen: string | null;
  piezas: number | null;
  fw: string | null;
  tipo_importacion: string | null;
  fecha_recoleccion: string | null;
  etd: string | null;
  eta: string | null;
  fecha_llegada: string | null;
  fecha_disponibilidad: string | null;
  estatus_id: OrdenEstatus;
  proyecto: string | null;
  observaciones: string | null;
  is_historial: boolean;
  snapshot_id: string;
}
