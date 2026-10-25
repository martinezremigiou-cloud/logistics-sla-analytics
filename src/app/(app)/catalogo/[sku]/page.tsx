import Link from "next/link";
import { FichaView } from "@/components/ficha/ficha-view";
import { paramDePagina } from "@/lib/url/param-de-pagina";

// Server shell delgado: solo el breadcrumb-back estático. Todo el estado
// (fetch/loading/error) vive en `FichaView` (isla client) — a diferencia de
// `/catalogo`, esta ruta no depende de `useSearchParams`, así que no
// necesita su propio `<Suspense>`.
//
// `params.sku` llega RE-CODIFICADO por Next (ver el contrato en
// `paramDePagina`, con la cita exacta del framework): un SKU con '/' u
// otro carácter reservado, sin este paso, llega doble-codificado al fetch
// de `FichaView` y la API responde 404 aunque el SKU exista.
export default function FichaSkuPage({ params }: { params: { sku: string } }) {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5">
      <Link
        href="/catalogo"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-[13px] font-medium text-ink-muted outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app"
      >
        ← Catálogo
      </Link>

      <FichaView sku={paramDePagina(params.sku)} />
    </div>
  );
}
