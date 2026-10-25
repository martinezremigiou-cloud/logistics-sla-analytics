import Link from "next/link";
import Image from "next/image";
import { Package } from "lucide-react";
import { EstatusPill } from "./estatus-pill";
import { BotonSeleccion } from "./boton-seleccion";
import { BotonSeguir } from "@/components/seguimiento/boton-seguir";
import { FamiliasCelda } from "./familias-celda";
import { formatoNumero } from "@/lib/formato";
import { colorSkuInfo } from "@/lib/colores-sku";
import { cn } from "@/lib/utils";
import type { CatalogoItem } from "@/types/api";

interface CatalogoGridProps {
  items: CatalogoItem[];
  /**
   * (Cierre de R1-1) Refleja el fetch en vuelo durante un refetch (chrome
   * persistente, `CatalogoView`): el grid NO se desmonta en cada cambio de
   * filtro, solo se marca `aria-busy` en el contenedor — mismo criterio
   * que `CatalogoTabla`/`EmbarquesTabla` (`<Table aria-busy={ariaBusy}>`),
   * aplicado aquí al `<div>` que envuelve TODAS las tarjetas (no a cada
   * tarjeta individual: una sola marca por refetch, no N).
   */
  ariaBusy: boolean;
}

/** Vista Grid alternativa a la tabla: mismos datos de la página server-driven, sin fetch propio. */
export function CatalogoGrid({ items, ariaBusy }: CatalogoGridProps) {
  return (
    <div aria-busy={ariaBusy} className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3.5">
      {items.map((item) => {
        const colorInfo = colorSkuInfo(item.color);
        return (
          // [INV-B8.2] El boton de Seleccion va FUERA del <Link> y no dentro:
          // un <button> anidado en un ancla es HTML invalido y rompe la
          // navegacion por teclado. Mismo criterio que `ProyectoCard`.
          <div key={item.sku} className="flex flex-col">
          <Link
            className="flex flex-1 flex-col gap-2.5 rounded-[13px] border border-line bg-surface p-3.5 outline-none transition-colors hover:border-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            href={`/catalogo/${encodeURIComponent(item.sku)}`}
          >
            {/* Mismo contenedor de tamaño para imagen real o placeholder (sin salto de layout). */}
            <span className="relative flex h-24 items-center justify-center overflow-hidden rounded-[10px] bg-surface-3 text-ink-muted3">
              {item.imagen_url ? (
                <Image src={item.imagen_url} alt={`Imagen de producto ${item.sku}`} fill sizes="190px" className="object-cover" />
              ) : (
                <Package className="h-8 w-8" strokeWidth={1.6} aria-hidden="true" />
              )}
            </span>
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-ink">
                {colorInfo && (
                  <>
                    <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", colorInfo.bgClass)} />
                    <span className="sr-only">{`Color: ${colorInfo.label}. `}</span>
                  </>
                )}
                {item.sku}
              </p>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-2">{item.descripcion ?? "—"}</p>
            </div>
            <div className="flex">
              <FamiliasCelda familias={item.familias} divergente={item.divergencia_familia === "v2"} familiaFuente={item.familia_fuente} />
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <EstatusPill badges={item.badges} disponible={item.disponible} />
              <span
                className={cn(
                  "font-mono text-[14px] font-bold",
                  item.disponible < 0 ? "text-warn" : item.disponible === 0 ? "text-ink-muted" : "text-ink",
                )}
              >
                {formatoNumero(item.disponible)}
              </span>
            </div>
          </Link>
          <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
            <BotonSeleccion sku={item.sku} />
            <BotonSeguir sku={item.sku} />
          </div>
          </div>
        );
      })}
    </div>
  );
}
