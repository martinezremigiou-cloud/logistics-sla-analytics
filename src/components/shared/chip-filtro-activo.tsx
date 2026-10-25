"use client";

import { X } from "lucide-react";

export interface ChipFiltroActivoProps {
  label: string;
  onClear: () => void;
}

/**
 * Chip removible de un filtro activo llegado por URL ("Filtro local: sin
 * familia asignada", clicable). Compartido por `CatalogoView` y
 * `CruceView` (antes duplicado byte-a-byte en ambos — fix M3a, ronda
 * post-revisión de B6).
 */
export function ChipFiltroActivo({ label, onClear }: ChipFiltroActivoProps) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex w-fit items-center gap-1 rounded-full bg-info-bg px-2.5 py-1 text-[11.5px] font-semibold text-info outline-none transition-colors hover:bg-info/10 focus-visible:ring-2 focus-visible:ring-brand"
    >
      {label}
      <X className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}
