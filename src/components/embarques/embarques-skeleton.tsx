// ============================================================
// Bloque 7-A · Libro Mayor · embarques-skeleton.tsx
// Molde: src/components/catalogo/catalogo-skeleton.tsx (mismo split en dos
// exports: fallback de <Suspense> completo vs. skeleton SOLO de la región
// de resultados, para el chrome persistente de `EmbarquesView`).
// ============================================================
import { Skeleton } from "@/components/ui/skeleton";

/** Filas de skeleton de la tabla (8), compartidas por ambos exports de abajo — sin rol propio: el rol vive en el contenedor que las use. */
function FilasTabla() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * Fallback de `<Suspense>` en `page.tsx` (obligatorio por `useSearchParams`
 * dentro de `EmbarquesView`, mismo motivo que `CatalogoSkeleton`):
 * `EmbarquesView` ni siquiera montó todavía, así que se imita el layout
 * COMPLETO (tabs + barra de filtros + tabla), todo bajo un único
 * `role="status"` con las piezas internas `aria-hidden`.
 */
export function EmbarquesSkeleton() {
  return (
    <div role="status" aria-label="Cargando el histórico…" className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-20 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2.5">
        <Skeleton className="h-9 w-full max-w-[280px]" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28" />
      </div>
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-line bg-surface p-3">
        <FilasTabla />
      </div>
    </div>
  );
}

/**
 * Loading SOLO de la región de resultados (chrome persistente — C3 de
 * `catalogo-view.tsx` / FIX C de `config-usuarios.tsx`): usado dentro de
 * `EmbarquesView` cuando `loading && !data` — tabs/filtros ya están
 * montados con props reales al lado, así que NO se repiten aquí.
 */
export function EmbarquesResultadosSkeleton() {
  return (
    <div role="status" aria-label="Cargando el histórico…" className="overflow-hidden rounded-2xl border border-line bg-surface p-3">
      <div aria-hidden="true">
        <FilasTabla />
      </div>
    </div>
  );
}
