import { SnapshotsView } from "@/components/snapshots/snapshots-view";

// Server shell delgado: solo el header estático (mismo molde que
// `catalogo/page.tsx`). Todo el estado (dos fetches por fuente,
// paginación por columna) vive en `SnapshotsView` (isla client) — a
// diferencia de `/catalogo`, esta vista no usa `useSearchParams` (no
// hay más filtro que la fuente/página, ambos con estado LOCAL), así que
// no necesita su propio `<Suspense>`.
export default function SnapshotsPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <header className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Datos</span>
        <h1 className="text-2xl font-bold tracking-tight text-ink">Snapshots</h1>
        <p className="text-[13.5px] text-muted-foreground">Bitácora de cada ingesta: qué entró, cuándo y qué cambió.</p>
      </header>

      <SnapshotsView />
    </div>
  );
}
