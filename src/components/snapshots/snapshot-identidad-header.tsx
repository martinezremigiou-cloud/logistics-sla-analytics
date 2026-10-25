import { formatoFechaHora, formatoNumero, formatoPeriodoCorto } from "@/lib/formato";
import { SnapshotVigenteBadge } from "@/components/shared/snapshot-vigente-badge";
import { formatoAutor, formatoFuente } from "./snapshots-formato";
import type { CambiosPage } from "@/types/api";

export interface SnapshotIdentidadHeaderProps {
  snapshot: CambiosPage["snapshot"];
}

/**
 * Encabezado de identidad del snapshot en `/snapshots/[id]` — molde de
 * `ficha-header.tsx` (eyebrow + h1 + chips a la izquierda, cifra
 * destacada a la derecha). `detectado_en` aparece AQUÍ, una sola vez
 * (NUNCA por fila en la tabla de cambios — es el timestamp de LA
 * TRANSACCIÓN del ETL, no un dato por fila; ver doc-comment de
 * `CambiosPage` en `types/api.ts`).
 */
export function SnapshotIdentidadHeader({ snapshot }: SnapshotIdentidadHeaderProps) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">{formatoFuente(snapshot.fuente)}</span>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-ink">{formatoPeriodoCorto(snapshot.periodo)}</h1>
            {snapshot.vigente && <SnapshotVigenteBadge />}
          </div>
          <p className="text-[13px] text-ink-2">{snapshot.archivo ?? "—"}</p>
          <p className="break-all font-mono text-[11px] text-ink-muted">hash {snapshot.hash}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Registros ingeridos</p>
          <p className="font-mono text-3xl font-bold leading-tight text-ink">
            {snapshot.filas === null ? "—" : formatoNumero(snapshot.filas)}
          </p>
        </div>
      </div>

      <p className="text-[12px] text-ink-muted">
        Ingesta {formatoFechaHora(snapshot.created_at)} · {formatoAutor(snapshot.created_by)} · Detectado en{" "}
        {formatoFechaHora(snapshot.detectado_en)}
      </p>
    </div>
  );
}
