import { Skeleton } from "@/components/ui/skeleton";

/**
 * Filas fantasma reutilizadas tanto por el skeleton compuesto de primera
 * pintura (`SnapshotsSkeleton`, dos tarjetas) como por una columna
 * individual que aún no resolvió su propia primera carga
 * (`SnapshotsColumna`, cuando la columna hermana ya respondió primero).
 */
export function SnapshotsFilasSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2.5">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-[10px]" />
      ))}
    </div>
  );
}

/**
 * Loading state de la PRIMERA pintura de `/snapshots`: dos tarjetas (una
 * por fuente), mostradas SOLO antes de que CUALQUIERA de las dos
 * columnas haya resuelto (éxito o error). En cuanto una columna
 * resuelve, `SnapshotsView` deja de montar este componente y
 * `SnapshotsColumna` toma el control de su propio estado — sin remount
 * de la columna hermana (chrome persistente).
 */
export function SnapshotsSkeleton() {
  return (
    <div role="status" aria-label="Cargando snapshots…" className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {["Inventario", "Embarques"].map((titulo) => (
        <div key={titulo} aria-hidden="true" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
          <Skeleton className="h-4 w-24" />
          <SnapshotsFilasSkeleton />
        </div>
      ))}
    </div>
  );
}
