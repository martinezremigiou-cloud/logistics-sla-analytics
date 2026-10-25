import { Skeleton } from "@/components/ui/skeleton";

/** Loading state de la carga INICIAL de `/proyectos/[id]`: hero + card de partidas, imitando el layout real. */
export function ProyectoDetalleSkeleton() {
  return (
    <div role="status" aria-label="Cargando proyecto…" className="flex flex-col gap-5">
      <div aria-hidden="true" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-4 w-52" />
      </div>

      <div aria-hidden="true" className="rounded-2xl border border-line bg-surface p-5">
        <Skeleton className="mb-3.5 h-5 w-48" />
        <div className="flex flex-col gap-2.5">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
