/**
 * Pill "Snapshot vigente" — compartido por `DashboardHeader` (B4),
 * `SnapshotFila` y `SnapshotIdentidadHeader` (Bloque 7-A). Vivía
 * duplicado en 3 lugares (markup byte-a-byte idéntico); movido a
 * `shared/` (fix M6, ronda 2 de revisor-codigo) tras confirmarse la
 * tercera copia.
 *
 * Sin `role="status"` (fix B18): un badge ESTÁTICO no es una live region
 * — `/snapshots` puede pintar varios a la vez (uno por fila vigente +
 * uno en el encabezado del detalle), y varias live regions con el MISMO
 * texto estático no anuncian nada útil a un lector de pantalla (solo
 * ruido). El punto verde + el texto "Snapshot vigente" ya son visibles y
 * legibles sin necesidad de un rol ARIA especial.
 */
export function SnapshotVigenteBadge() {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-input px-3 py-1.5 text-[12.5px] text-ink-2">
      <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-success" />
      Snapshot vigente
    </span>
  );
}
