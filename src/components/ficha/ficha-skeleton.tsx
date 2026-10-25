import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading state de la Ficha SKU: estado `loading` de `FichaView` mientras
 * resuelve `GET /api/sku/[sku]`. Header + 4 bloques tipo card, imitando el
 * layout real (ver `ficha-detalle.tsx`).
 */
export function FichaSkeleton() {
  return (
    <div role="status" aria-label="Cargando ficha…" className="flex flex-col gap-5">
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <Skeleton className="h-3 w-40" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-16 w-32" />
        </div>
      </div>

      <div aria-hidden="true" className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
