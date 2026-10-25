import Link from "next/link";
import { ProyectoDetalleView } from "@/components/proyectos/proyecto-detalle-view";

// Server shell delgado: solo el breadcrumb-back estático (mismo molde que
// `catalogo/[sku]/page.tsx` y `snapshots/[id]/page.tsx`). Todo el estado
// (fetch/loading/error/filtros de partidas) vive en `ProyectoDetalleView`
// (isla client) — esta ruta tampoco depende de `useSearchParams`.
export default function ProyectoDetallePage({ params }: { params: { id: string } }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <Link
        href="/proyectos"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] font-medium text-ink-muted outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app"
      >
        ← Todos los proyectos
      </Link>

      <ProyectoDetalleView id={params.id} />
    </div>
  );
}
