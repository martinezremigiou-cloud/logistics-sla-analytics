import { Skeleton } from "@/components/ui/skeleton";

/** Loading state del encabezado de identidad en `/snapshots/[id]`, mientras resuelve la primera carga (`loading && !data`). */
export function CambiosHeaderSkeleton() {
  return (
    <div role="status" aria-label="Cargando snapshot…" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
    </div>
  );
}

/** Loading state de la tabla de cambios en `/snapshots/[id]`, mientras resuelve la primera carga (`loading && !data`). */
export function CambiosTablaSkeleton() {
  return (
    <div role="status" aria-label="Cargando cambios…" className="overflow-hidden rounded-[10px] border border-line-soft">
      <div aria-hidden="true" className="flex flex-col gap-2.5 p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
