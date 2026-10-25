// ============================================================
// Bloque 6 · F3 Dashboard · dashboard-skeleton.tsx
// Skeleton del estado `loading` de `useApi<DashboardResponse>` dentro de
// `DashboardView` (mismo patrón que `cruce-skeleton.tsx`: el header de la
// página — que solo depende de la sesión, no del fetch — sigue montado y
// real; este skeleton imita únicamente la zona de datos: fila de 4 KPIs +
// 4 filas de 2 cards).
// ============================================================
import { Skeleton } from "@/components/ui/skeleton";

function FilaDeDosCards({ alto }: { alto: string }) {
  return (
    <div aria-hidden="true" className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <Skeleton className={`${alto} rounded-2xl`} />
      <Skeleton className={`${alto} rounded-2xl`} />
    </div>
  );
}

/** Loading de página completa de `/`: fila de 4 KPIs + 4 filas de 2 cards, mismas proporciones que el layout real. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Cargando panel…" className="flex flex-col gap-[22px]">
      <div aria-hidden="true" className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-2xl" />
        ))}
      </div>
      <FilaDeDosCards alto="h-[280px]" />
      <FilaDeDosCards alto="h-[220px]" />
      <FilaDeDosCards alto="h-[240px]" />
      <FilaDeDosCards alto="h-[200px]" />
    </div>
  );
}
