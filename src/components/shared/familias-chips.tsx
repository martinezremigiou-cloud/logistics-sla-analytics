import { cn } from "@/lib/utils";

/** Estilo por defecto del chip — idéntico byte-a-byte al `CHIP_FAMILIA_CLASSNAME` que vivía en `ficha-atributos.tsx` antes de este componente. */
const FAMILIA_CHIP_CLASSNAME_DEFAULT =
  "inline-flex w-fit items-center rounded-full bg-surface-3 px-2.5 py-1 text-[12.5px] font-semibold text-ink-2";

export interface FamiliaChipProps {
  familia: string;
  /** Clases adicionales/override (p.ej. el hero navy fijo de `FocoSku`, que NO usa tokens de tema) — se funden con `cn` sobre el default. */
  className?: string;
}

/**
 * Chip individual de familia (INV-TAXO R3-2). Componente de presentación
 * puro — sin `"use client"` porque no usa hooks (mismo criterio que
 * `SnapshotVigenteBadge`/`PagePlaceholder`).
 */
export function FamiliaChip({ familia, className }: FamiliaChipProps) {
  return <span className={cn(FAMILIA_CHIP_CLASSNAME_DEFAULT, className)}>{familia}</span>;
}

export interface ListaFamiliaChipsProps {
  /** Familias EFECTIVAS ya separadas en átomos (`separarFamilias`, `src/lib/familias.ts`) — NUNCA el crudo compuesto (`familia_efectiva`/`familia`). */
  familias: string[];
  /** Se aplica a CADA chip que se pinte, incluido el de "Sin familia". */
  className?: string;
}

/**
 * N chips (uno por elemento de `familias`) + el caso vacío "Sin familia"
 * resuelto UNA sola vez aquí — antes cada consumidor lo reinventaba por su
 * cuenta: `ficha-atributos.tsx` tenía su propio `ChipsFamilia` (eliminado
 * en este cambio, ver R3-2) y `cruce/foco-sku.tsx` ni siquiera separaba
 * los átomos: pintaba el crudo compuesto completo como un solo bloque de
 * texto (bug real R3-1, caso verificado `VJ9123-F` →
 * `familias_efectivas: ["CLIP 3.0", "CLIP ROTATIVO"]`).
 *
 * `catalogo/familias-celda.tsx` pinta el MISMO concepto con una UX distinta
 * (colapsa a "primera +N" con expansión por hover/tap) — deliberadamente
 * NO migrado a este componente; su consolidación queda para otro bloque.
 */
export function ListaFamiliaChips({ familias, className }: ListaFamiliaChipsProps) {
  if (familias.length === 0) {
    return <FamiliaChip familia="Sin familia" className={className} />;
  }
  return (
    <>
      {familias.map((familia) => (
        <FamiliaChip key={familia} familia={familia} className={className} />
      ))}
    </>
  );
}
