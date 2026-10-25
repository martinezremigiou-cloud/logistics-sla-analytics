import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state de la PRIMERA pintura del catálogo: fallback de
 * `<Suspense>` en `page.tsx`, antes de que `CatalogoView` exista siquiera
 * (`useSearchParams` lo exige). Árbol de 5 filas + tabla de 8 filas,
 * imitando el layout completo (todavía no hay filtros/árbol reales que
 * preservar porque el componente ni montó).
 *
 * NO se usa para el estado `loading` interno de `CatalogoView` (ese usa
 * `CatalogoResultadosSkeleton`, más abajo) — ver C3 en `catalogo-view.tsx`.
 */
export function CatalogoSkeleton() {
  return (
    <div role="status" aria-label="Cargando catálogo…" className="flex flex-col gap-4">
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2.5">
        <Skeleton className="h-9 w-full max-w-[280px]" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-32" />
      </div>

      <div aria-hidden="true" className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="hidden w-full max-w-[270px] shrink-0 rounded-2xl border border-line bg-surface p-2.5 md:block">
          <Skeleton className="mb-2.5 ml-2 h-3 w-24" />
          <div className="flex flex-col gap-2 px-1 py-1">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-hidden rounded-2xl border border-line bg-surface p-3">
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Loading state SOLO de la columna de resultados de `CatalogoView` (C3):
 * `<CatalogoFiltros>`/`<CatalogoArbol>` quedan montados con sus props
 * reales al lado (no se skeletonizan de nuevo) — esto reemplaza al
 * `loading`/`!data` (defensivo) de `CatalogoView`, que antes desmontaba
 * TODA la vista con `CatalogoSkeleton`.
 */
export function CatalogoResultadosSkeleton() {
  return (
    <div role="status" aria-label="Cargando catálogo…" className="overflow-hidden rounded-2xl border border-line bg-surface p-3">
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
