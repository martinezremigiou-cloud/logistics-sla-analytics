"use client";

import {
  Clock,
  FileText,
  PackagePlus,
  PackageCheck,
  Warehouse,
  Plane,
  Ship,
  ShieldCheck,
  Truck,
  Building2,
  Boxes,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import type { CruceEtapa, CruceResumen } from "@/types/api";

/** Mapa fijo orden → ícono (1..11), ver spec F5 de El Cruce. Exportado (fix M3b, ronda post-revisión de B6): `dashboard-pipeline.tsx` lo reusa en vez de replicarlo. */
export const ICONO_POR_ORDEN: Record<number, LucideIcon> = {
  1: FileText,
  2: PackagePlus,
  3: PackageCheck,
  4: Warehouse,
  5: Plane,
  6: Ship,
  7: ShieldCheck,
  8: Truck,
  9: Building2,
  10: Boxes,
  11: CheckCircle2,
};

export interface PipelineAduanaProps {
  /** SIEMPRE 11, orden ASC — se renderizan tal cual llegan, sin reordenar. */
  etapas: CruceEtapa[];
  resumen: CruceResumen;
  /** `orden` de la etapa seleccionada, o `null` si ninguna. */
  seleccion: number | null;
  onSelect: (orden: number) => void;
}

/**
 * Riel horizontal de las 11 etapas de aduana. Presentacional puro: la
 * lógica de toggle (deseleccionar al re-clicar la misma etapa) vive en
 * `CruceView`, dueño del estado `seleccion` — este componente solo reporta
 * el `orden` clicado.
 */
export function PipelineAduana({ etapas, resumen, seleccion, onSelect }: PipelineAduanaProps) {
  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-info-bg text-info">
            <Clock className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </span>
          <h2 className="text-[14.5px] font-semibold text-ink">Pipeline de aduana · las 11 etapas</h2>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center rounded-full bg-info-bg px-2.5 py-1 font-mono text-[12px] font-semibold text-info">
          {resumen.embarques_activos} emb · {formatoNumero(resumen.piezas_activas)} pz en tránsito
        </span>
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        Cada embarque cruza estas etapas. Clic en una etapa para ver los SKUs que están ahí.
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-start">
          {etapas.map((etapa, i) => {
            const Icon = ICONO_POR_ORDEN[etapa.orden] ?? FileText;
            const seleccionada = seleccion === etapa.orden;
            return (
              <div key={etapa.orden} className="flex items-start">
                {i > 0 && <div aria-hidden="true" className="mt-7 h-px w-4 shrink-0 bg-line" />}
                <button
                  type="button"
                  aria-pressed={seleccionada}
                  onClick={() => onSelect(etapa.orden)}
                  className={cn(
                    "flex w-[90px] shrink-0 flex-col items-center gap-1.5 rounded-[12px] border border-transparent px-1.5 py-2.5 text-center outline-none transition-colors hover:bg-surface-3",
                    "focus-visible:ring-2 focus-visible:ring-brand",
                    seleccionada && "border-brand/30 bg-info-bg ring-2 ring-brand",
                  )}
                >
                  <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-surface-3 text-ink-2">
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.8} />
                    <span
                      aria-label={`${etapa.activos.embarques} embarques activos`}
                      className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 font-mono text-[10px] font-bold leading-none text-white"
                    >
                      {etapa.activos.embarques}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[11px] font-semibold leading-tight text-ink">{etapa.nombre}</span>
                  <span className="font-mono text-[10.5px] text-ink-muted">{formatoNumero(etapa.activos.piezas)} pz</span>
                  {etapa.historial.embarques > 0 && (
                    <span className="text-[10px] text-ink-muted">{etapa.historial.embarques} hist.</span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
