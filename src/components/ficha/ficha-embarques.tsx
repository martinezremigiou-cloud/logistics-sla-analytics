import { Card } from "@/components/ui/card";
import { formatoFecha, formatoNumero } from "@/lib/formato";
import type { SkuEmbarqueItem } from "@/types/api";

export interface FichaEmbarquesProps {
  /** Ya vienen ordenados por el backend (activos primero) — este componente solo separa, no reordena. */
  embarques: SkuEmbarqueItem[];
  piezasHistorial: number;
}

const CHIP_ESTATUS =
  "inline-flex w-fit items-center whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-semibold text-ink-2";
const CHIP_RETRASO =
  "inline-flex w-fit items-center whitespace-nowrap rounded-full bg-warn-bg px-2.5 py-0.5 text-[11px] font-semibold text-warn";

/** Línea muted: proveedor · tipo de importación · país de origen (null → "—" por campo). */
function lineaOrigen(e: SkuEmbarqueItem): string {
  return [e.proveedor ?? "—", e.tipo_importacion ?? "—", e.pais_origen ?? "—"].join(" · ");
}

/** DOS cards: "Embarques entrantes" (activos) e "Historial" — split por `is_historial`, sin resortear. */
export function FichaEmbarques({ embarques, piezasHistorial }: FichaEmbarquesProps) {
  const activos = embarques.filter((e) => !e.is_historial);
  const historial = embarques.filter((e) => e.is_historial);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card role="region" aria-label="Embarques entrantes" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Embarques entrantes</h2>
        {activos.length === 0 ? (
          <p className="py-3 text-center text-[12.5px] text-muted-foreground">Sin embarques en camino.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {activos.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[10px] border border-line-soft p-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[12.5px] font-semibold text-ink">{e.oc_po ?? "—"}</span>
                    <span className={CHIP_ESTATUS}>{e.estatus}</span>
                    {e.retrasado && <span className={CHIP_RETRASO}>Retraso</span>}
                  </div>
                  <p className="text-[11.5px] text-ink-muted">{lineaOrigen(e)}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p data-testid={`embarque-piezas-${e.id}`} className="font-mono text-[13px] font-semibold text-ink">
                    {e.piezas === null ? "—" : formatoNumero(e.piezas)}
                  </p>
                  <p className="text-[11.5px] text-ink-muted">ETA {formatoFecha(e.eta)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card role="region" aria-label="Historial" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Historial</h2>
        {historial.length === 0 ? (
          <p className="py-3 text-center text-[12.5px] text-muted-foreground">Sin historial registrado.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {historial.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 rounded-[10px] border border-line-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ink-2">{e.proveedor ?? "—"}</span>
                  <span data-testid={`embarque-piezas-${e.id}`} className="font-mono text-[13px] font-semibold text-ink">
                    {e.piezas === null ? "—" : formatoNumero(e.piezas)}
                  </span>
                </div>
                <p className="text-[11.5px] text-ink-muted">Recibido {formatoFecha(e.fecha_disponibilidad)}</p>
                {e.observaciones && (
                  <p className="rounded-[8px] bg-warn-bg px-2.5 py-1.5 text-[11.5px] text-warn">Nota: {e.observaciones}</p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-[11px] text-ink-muted">Histórico recibido: {formatoNumero(piezasHistorial)} pz</p>
      </Card>
    </div>
  );
}
