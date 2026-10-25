/** Ingesta inmutable. Hash = idempotencia; el vigente = último. */
export interface Snapshot {
  readonly id: string;
  fuente: string;
  hash: string;
  periodo: string;
  archivo: string | null;
  filas: number | null;
  created_at: string;
  created_by: string | null;
}
