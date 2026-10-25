// ============================================================
// Bloque 4 · F5 El Cruce · cruce-skeleton.tsx
// Piezas de skeleton reutilizadas en 3 puntos: fallback de `<Suspense>` en
// `(app)/embarques/page.tsx` (`CruceSkeleton`, compuesto), loading del riel de
// pipeline dentro de `CruceView` (`PipelineSkeleton`) y loading del bloque
// de foco dentro de `FocoSku` (`FocoSkuSkeleton`).
// ============================================================
import { Skeleton } from "@/components/ui/skeleton";

/** 11 tiles del riel de pipeline (sin wrapper de rol: se reutiliza con distinto rol según el contexto). */
function PipelineTiles() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-9 w-9 rounded-[10px]" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-7 w-44 rounded-full" />
      </div>
      <Skeleton className="h-3.5 w-96 max-w-full" />
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: 11 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-[92px] shrink-0 rounded-[12px]" />
        ))}
      </div>
    </div>
  );
}

/** Hero + grid de 3 cards del bloque de foco por SKU. */
function FocoBlocks() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

/** Loading del riel del pipeline: estado `loading` de `useApi<CruceResponse>` dentro de `CruceView`. */
export function PipelineSkeleton() {
  return (
    <div role="status" aria-label="Cargando pipeline de aduana…">
      <PipelineTiles />
    </div>
  );
}

/** Loading del bloque de foco: estado `loading` de `useApi<SkuDetalle>` dentro de `FocoSku`. */
export function FocoSkuSkeleton() {
  return (
    <div role="status" aria-label="Cargando cruce del SKU…">
      <FocoBlocks />
    </div>
  );
}

/**
 * Fallback de `<Suspense>` en `(app)/embarques/page.tsx` (obligatorio por
 * `useSearchParams` dentro de `CruceView`): preview estático de las 3
 * secciones de la página — riel de pipeline (11 tiles) + fila de chips +
 * bloque de foco.
 */
export function CruceSkeleton() {
  return (
    <div role="status" aria-label="Cargando embarques…" className="flex flex-col gap-5">
      <div aria-hidden="true">
        <PipelineTiles />
      </div>
      <div aria-hidden="true" className="flex items-center gap-2">
        <Skeleton className="h-3 w-14" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div aria-hidden="true">
        <FocoBlocks />
      </div>
    </div>
  );
}
