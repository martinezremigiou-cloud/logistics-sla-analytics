import { formatoFechaHora } from "@/lib/formato";
import type { SkuSnapshotInfo } from "@/types/api";

export interface SnapshotsVigentesBannerProps {
  vigentes: { stock: SkuSnapshotInfo | null; aduana: SkuSnapshotInfo | null };
}

/**
 * Banner de cabecera de `/snapshots`: resume el vigente de CADA fuente en
 * una sola línea. Usa SIEMPRE `vigentes` de la respuesta de
 * `/api/snapshots` (viaja completo aunque el paginado deje al vigente
 * fuera de `items` de la página actual) — nunca se infiere el vigente a
 * partir de los items visibles.
 */
export function SnapshotsVigentesBanner({ vigentes }: SnapshotsVigentesBannerProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
      <span className="font-semibold text-ink">Vigente:</span>
      <span>Inventario {vigentes.stock ? formatoFechaHora(vigentes.stock.created_at) : "sin ingesta aún"}</span>
      <span aria-hidden="true" className="text-ink-muted">
        ·
      </span>
      <span>Embarques {vigentes.aduana ? formatoFechaHora(vigentes.aduana.created_at) : "sin ingesta aún"}</span>
    </div>
  );
}
