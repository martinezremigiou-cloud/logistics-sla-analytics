"use client";

import { X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EstadoVacio } from "@/components/shared/estado-carga";
import { formatoFecha, formatoNumero } from "@/lib/formato";
import type { CruceEmbarqueItem, CruceEtapa } from "@/types/api";

export interface EtapaDetalleProps {
  etapa: CruceEtapa;
  onFoco: (sku: string) => void;
  onClose: () => void;
}

/** Línea muted `tipo_importacion · pais_origen`: nulls se OMITEN (no "—"); si ambos son null, no hay línea. */
function lineaOrigen(item: CruceEmbarqueItem): string | null {
  const partes = [item.tipo_importacion, item.pais_origen].filter((p): p is string => p !== null);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/**
 * Grid de embarques activos (`items`) de la etapa seleccionada del pipeline.
 * Presentacional puro: el `onFoco(sku)` de cada tarjeta sube el SKU a
 * `CruceView`, que decide cómo sincronizarlo con `foco`/la URL.
 */
export function EtapaDetalle({ etapa, onFoco, onClose }: EtapaDetalleProps) {
  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink">{etapa.nombre}</h3>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none transition-colors hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {etapa.items.length === 0 ? (
        <EstadoVacio titulo="No hay embarques en esta etapa ahora mismo." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {etapa.items.map((item) => {
            const origen = lineaOrigen(item);
            return (
              <li key={item.id} className="flex flex-col gap-1.5 rounded-[12px] border border-line-soft p-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onFoco(item.sku)}
                    className="rounded-sm font-mono text-[13px] font-bold text-ink outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {item.sku}
                  </button>
                  <span className="shrink-0 font-mono text-[12.5px] font-semibold text-ink-2">
                    {item.piezas === null ? "—" : formatoNumero(item.piezas)}
                  </span>
                </div>
                <p className="line-clamp-1 text-[12px] text-ink-2">{item.descripcion ?? "—"}</p>
                {origen && <p className="text-[11.5px] text-ink-muted">{origen}</p>}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="text-[11.5px] text-ink-muted">ETA {formatoFecha(item.eta)}</span>
                  {item.retrasado && (
                    <span className="inline-flex w-fit items-center rounded-full bg-warn-bg px-2 py-0.5 text-[10.5px] font-semibold text-warn">
                      Retraso
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
