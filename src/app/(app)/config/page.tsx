import { Suspense } from "react";
import { ConfigView } from "@/components/config/config-view";
import { Skeleton } from "@/components/ui/skeleton";

// `ConfigView` lee `?tab=` vía `useSearchParams` (Bloque 6, F4) — exige el
// `<Suspense>` de abajo (mismo patrón que `/catalogo` y `/embarques`).
export default function ConfigPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Configuración</h1>
      </header>
      <Suspense
        fallback={
          <div role="status" aria-label="Cargando configuración…">
            <Skeleton className="h-72 w-full rounded-2xl" />
          </div>
        }
      >
        <ConfigView />
      </Suspense>
    </div>
  );
}
