import { Suspense } from "react";
import { EmbarquesView } from "@/components/embarques/embarques-view";
import { EmbarquesSkeleton } from "@/components/embarques/embarques-skeleton";

// Server shell delgado (molde: src/app/(app)/catalogo/page.tsx): solo el
// header estático. Todo el estado (filtros, orden, paginación) vive en
// `EmbarquesView` (isla client) vía la URL — `useSearchParams` exige el
// <Suspense> de abajo.
//
// Bloque 7-A: reemplaza al PagePlaceholder ("Pipeline de 9 estados por
// SKU.", copy caducado — el pipeline real tiene 11 etapas). Esta pantalla
// es el Libro Mayor: TODOS los embarques del snapshot vigente (activos +
// histórico), a diferencia de `/embarques` (solo los 11 activos por etapa).
export default function HistoricoEmbarquesPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Aduana</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Histórico de embarques</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Todos los embarques registrados —activos e históricos— por OC, SKU, referencia, factura o descripción.
        </p>
      </header>

      <Suspense fallback={<EmbarquesSkeleton />}>
        <EmbarquesView />
      </Suspense>
    </div>
  );
}
