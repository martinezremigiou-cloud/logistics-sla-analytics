import { ProyectosView } from "@/components/proyectos/proyectos-view";

// Server shell delgado, SIN header estático propio (a diferencia de
// /catalogo, /embarques, /snapshots): el encabezado de esta vista incluye
// el botón "+ Nuevo proyecto", que abre un diálogo con estado local y por
// tanto vive en la isla client (`ProyectosView`) junto con el resto del
// encabezado, en vez de partido entre server y client. Sin
// `useSearchParams` (sin filtros en la URL): no hace falta `<Suspense>`.
export default function ProyectosPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <ProyectosView />
    </div>
  );
}
