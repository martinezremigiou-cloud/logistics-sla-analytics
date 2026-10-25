import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EstatusPill } from "./estatus-pill";
import { BotonSeleccion } from "./boton-seleccion";
import { BotonSeguir } from "@/components/seguimiento/boton-seguir";
import { FamiliasCelda } from "./familias-celda";
import { formatoNumero } from "@/lib/formato";
import { colorSkuInfo } from "@/lib/colores-sku";
import { cn } from "@/lib/utils";
import type { CatalogoItem } from "@/types/api";

interface CatalogoTablaProps {
  items: CatalogoItem[];
  /**
   * (R1-1) Refleja el fetch en vuelo durante un refetch (chrome
   * persistente, `CatalogoView`): la tabla NO se desmonta en cada cambio
   * de filtro, solo se marca `aria-busy` en el `<table>` — mismo criterio
   * que `EmbarquesTabla`/`config-usuarios.tsx` (ver `docs/engineering/failure-patterns.md`, P3).
   */
  ariaBusy: boolean;
}

/** Tabla server-driven del catálogo: renderiza tal cual la página actual recibida (sin paginar/ordenar aquí). */
export function CatalogoTabla({ items, ariaBusy }: CatalogoTablaProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <Table aria-busy={ariaBusy}>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">SKU</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Descripción</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Familia</TableHead>
            <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</TableHead>
            <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Reservado</TableHead>
            <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Disponible</TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estatus</TableHead>
            {/*
              [INV-B8.2] La columna Proyecto. Va al FINAL y no junto al SKU
              porque es una accion, no un dato del catalogo: mezclarla entre las
              cifras haria que la vista se leyera como si el proyecto fuera un
              atributo del producto.
            */}
            <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Proyecto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const colorInfo = colorSkuInfo(item.color);
            return (
              <TableRow key={item.sku} className="border-line-soft">
                <TableCell className="font-mono text-[12.5px] font-semibold text-ink">
                  <Link
                    href={`/catalogo/${encodeURIComponent(item.sku)}`}
                    className="inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    {colorInfo && (
                      <>
                        <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", colorInfo.bgClass)} />
                        <span className="sr-only">{`Color: ${colorInfo.label}. `}</span>
                      </>
                    )}
                    {item.sku}
                  </Link>
                </TableCell>
                <TableCell className="max-w-[280px] text-[13px] text-ink-2">
                  <div>{item.descripcion ?? "—"}</div>
                  <div className="mt-0.5 text-[11px] text-ink-muted">
                    {item.marca}
                    {item.tecnologia ? ` · ${item.tecnologia}` : ""}
                  </div>
                </TableCell>
                <TableCell>
                  <FamiliasCelda familias={item.familias} divergente={item.divergencia_familia === "v2"} familiaFuente={item.familia_fuente} />
                </TableCell>
                <TableCell className="text-right font-mono text-[12.5px] text-ink-2">{formatoNumero(item.total)}</TableCell>
                <TableCell className="text-right font-mono text-[12.5px] text-ink-muted">{formatoNumero(item.reservado)}</TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-[13px] font-bold",
                    item.disponible < 0 ? "text-warn" : item.disponible === 0 ? "text-ink-muted" : "text-ink",
                  )}
                >
                  {formatoNumero(item.disponible)}
                </TableCell>
                <TableCell>
                  <EstatusPill badges={item.badges} disponible={item.disponible} />
                </TableCell>
                <TableCell className="text-right">
                  {/* [INV-B9] La campana junto al de Selección: mismo patrón,
                      significados distintos. Uno arma un borrador para volcar a
                      un proyecto; el otro pide que te avisen. */}
                  <div className="flex items-center justify-end gap-1.5">
                    <BotonSeleccion sku={item.sku} />
                    <BotonSeguir sku={item.sku} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
