import Image from "next/image";
import { Package } from "lucide-react";
import { Card } from "@/components/ui/card";

export interface FichaImagenProps {
  sku: string;
  imagenUrl: string | null;
  /** Descripción efectiva del SKU (opcional) — enriquece el `alt` cuando está disponible. */
  descr?: string | null;
}

/**
 * Card "Imagen". Cierra B4-5 (P3): `next/image` sobre el bucket público
 * de Supabase Storage (`remotePatterns` ya configurado en `next.config.mjs`).
 * `fill` + contenedor `aspect-square` evita pedir `width`/`height` fijos
 * (las imágenes de producto no tienen una relación de aspecto garantizada).
 */
export function FichaImagen({ sku, imagenUrl, descr }: FichaImagenProps) {
  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[13.5px] font-semibold text-ink">Imagen</h2>
      {imagenUrl ? (
        <div className="relative aspect-square overflow-hidden rounded-lg bg-surface-3">
          <Image
            src={imagenUrl}
            alt={`Imagen de producto ${sku}${descr ? ` — ${descr}` : ""}`}
            fill
            sizes="(min-width: 1024px) 320px, 100vw"
            className="object-cover"
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[10px] bg-surface-3 py-10 text-ink-muted">
          <Package className="h-8 w-8" aria-hidden="true" strokeWidth={1.6} />
          <p className="text-[12.5px]">Sin imagen cargada</p>
        </div>
      )}
    </Card>
  );
}
