import Link from "next/link";
import { CambiosView } from "@/components/snapshots/cambios-view";

// Server shell delgado: solo el breadcrumb-back estático (mismo molde
// que `catalogo/[sku]/page.tsx`). Todo el estado (fetch/loading/error/
// filtros) vive en `CambiosView` (isla client) — esta ruta tampoco
// depende de `useSearchParams` (filtros con estado LOCAL, ver
// `cambios-view.tsx`), así que no necesita su propio `<Suspense>`.
export default function SnapshotDetallePage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <Link
        href="/snapshots"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] font-medium text-ink-muted outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app"
      >
        ← Snapshots
      </Link>

      <CambiosView id={params.id} />
    </div>
  );
}
