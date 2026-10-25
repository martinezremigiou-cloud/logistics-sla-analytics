import { Suspense } from "react";
import { CruceView } from "@/components/cruce/cruce-view";
import { CruceSkeleton } from "@/components/cruce/cruce-skeleton";

// [2.0.1-B · R-1] Esta pantalla ERA `/cruce`. Se llama «Embarques» de cara al
// usuario y «Cruce» por dentro (servicio, API, componentes, tipos): la
// convención está en `src/lib/nav-nombres.ts`, no aquí — un contrato que se
// repite en comentarios se convierte en dos contratos.
//
// Server shell delgado: solo el header estático. Todo el estado (pipeline,
// foco/`?sku=`) vive en `CruceView` (isla client) — `useSearchParams` exige
// el `<Suspense>` de abajo (mismo patrón que `/catalogo`).
export default function EmbarquesPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Embarques</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Embarques</h1>
        <p className="text-[13.5px] text-muted-foreground">
          El SKU es la llave única. Inventario, embarques y historial —en paralelo— para un mismo ítem.
        </p>
      </header>

      <Suspense fallback={<CruceSkeleton />}>
        <CruceView />
      </Suspense>
    </div>
  );
}
