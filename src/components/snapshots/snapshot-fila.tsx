import Link from "next/link";
import { formatoFechaHora, formatoNumero, formatoPeriodoCorto } from "@/lib/formato";
import { SnapshotVigenteBadge } from "@/components/shared/snapshot-vigente-badge";
import { formatoAutor, formatoRegistrosIngeridos } from "./snapshots-formato";
import type { SnapshotBitacoraItem } from "@/types/api";

export interface SnapshotFilaProps {
  item: SnapshotBitacoraItem;
}

const PILL_CAMBIOS =
  "inline-flex w-fit items-center gap-1.5 rounded-full bg-info-bg px-2.5 py-1 text-[11.5px] font-semibold text-info outline-none transition-colors hover:bg-info/10 focus-visible:ring-2 focus-visible:ring-brand";

/**
 * Una fila de la Bitácora (dentro de una `SnapshotsColumna`). NO es una
 * fila de `<table>`: el contenido es multi-línea (periodo/archivo/
 * registros/fecha/autor/hash/cambios), así que se modela como un `<li>`
 * de registro compacto (mismo espíritu que `ficha-embarques.tsx`), no
 * como celdas — una tabla real forzaría scroll horizontal dentro de una
 * columna que ya ocupa medio ancho de página.
 *
 * "Sin cambios" (cambios.total === 0) es texto plano SIN enlace — no hay
 * a dónde navegar y un link roto/vacío sería peor que no tener link. Con
 * cambios > 0, el pill SÍ navega al detalle y nunca oculta el desglose
 * (ver doc-comment del contrato: mentir por omisión rompe el propósito
 * de esta pantalla).
 */
export function SnapshotFila({ item }: SnapshotFilaProps) {
  const { cambios } = item;

  return (
    <li className="flex flex-col gap-1.5 rounded-[10px] border border-line-soft p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-ink">{formatoPeriodoCorto(item.periodo)}</span>
          {item.vigente && <SnapshotVigenteBadge />}
        </div>
        <span className="font-mono text-[11px] text-ink-muted">{item.hash_corto}</span>
      </div>

      <p className="truncate text-[12px] text-ink-2">{item.archivo ?? "—"}</p>

      <p className="text-[11.5px] text-ink-muted">
        {formatoRegistrosIngeridos(item.filas)} · {formatoFechaHora(item.created_at)} · {formatoAutor(item.created_by)}
      </p>

      <div className="flex flex-col items-start gap-1 pt-0.5">
        {cambios.total === 0 ? (
          <span className="text-[12.5px] text-muted-foreground">Sin cambios</span>
        ) : (
          <>
            <Link href={`/snapshots/${item.id}`} className={PILL_CAMBIOS}>
              {formatoNumero(cambios.total)} cambios
            </Link>
            <p className="text-[11px] text-ink-muted">
              {formatoNumero(cambios.altas)} altas · {formatoNumero(cambios.bajas)} bajas · {formatoNumero(cambios.modificaciones)}{" "}
              modificaciones
            </p>
          </>
        )}
      </div>
    </li>
  );
}
