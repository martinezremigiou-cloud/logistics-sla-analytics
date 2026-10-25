"use client";

import { cn } from "@/lib/utils";

export interface ViendoChipsProps {
  /** `skus_activos` del pipeline (distinct, orden ASC). */
  skus: string[];
  foco: string | null;
  onSelect: (sku: string) => void;
}

/**
 * Fila de chips "Viendo:" — accesos rápidos a los SKUs con embarque activo.
 * Si `foco` (deep-link a un SKU sin embarques activos, p.ej. desde la Ficha)
 * no está en `skus`, se agrega como chip extra al final para que la
 * selección actual siempre quede visible.
 */
export function ViendoChips({ skus, foco, onSelect }: ViendoChipsProps) {
  if (skus.length === 0 && foco === null) return null;

  const lista = foco !== null && !skus.includes(foco) ? [...skus, foco] : skus;

  return (
    <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Viendo:</span>
      {lista.map((sku) => {
        const activo = sku === foco;
        return (
          <button
            key={sku}
            type="button"
            aria-pressed={activo}
            onClick={() => onSelect(sku)}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[11.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
              activo ? "border-sidebar bg-sidebar text-white" : "border-line bg-surface text-ink-2 hover:bg-surface-3",
            )}
          >
            {sku}
          </button>
        );
      })}
    </div>
  );
}
