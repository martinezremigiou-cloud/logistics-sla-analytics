/** Feed de trazabilidad append-only. El ETL de B2 puebla esta tabla. */
export interface Cambio {
  readonly id: string;
  snapshot_id: string;
  entidad: 'producto' | 'stock' | 'reserva' | 'embarque';
  clave: string;
  sku: string | null;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  tipo: 'ALTA' | 'BAJA' | 'MODIFICACION';
  detectado_en: string;
}
