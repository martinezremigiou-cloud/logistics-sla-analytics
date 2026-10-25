import Link from "next/link";
import { ChevronRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EstatusPill } from "@/components/catalogo/estatus-pill";
import { BotonSeleccion } from "@/components/catalogo/boton-seleccion";
import { BotonSeguir } from "@/components/seguimiento/boton-seguir";
import { formatoNumero } from "@/lib/formato";
import { colorSkuInfo } from "@/lib/colores-sku";
import { cn } from "@/lib/utils";
import type { BadgeCatalogo, SkuReservaItem, SkuSnapshotInfo, SkuStockItem } from "@/types/api";

export interface FichaHeaderProps {
  sku: string;
  marca: string;
  familiaEfectiva: string | null;
  descrEfectiva: string | null;
  total: number;
  disponible: number;
  sobreReservado: boolean;
  stock: SkuStockItem[];
  reservas: SkuReservaItem[];
  /** Fila `snapshot.stock` del DTO (no el global `vigente('stock')`). `null` = sin snapshot propio. */
  snapshotStock: SkuSnapshotInfo | null;
  /** `undefined` en fixtures viejos (mismo criterio que `SkuDetalle.color`) — se trata como `null` ("Sin color"). */
  color?: string | null;
  /** Tecnología (B-PARCHE F4): `undefined` en fixtures viejos — se trata como `null` ("Sin tecnología"), igual que `color`. Sin badge de origen (siempre visible). */
  tecnologia?: string | null;
  /**
   * [VERT-B2] La marca de este SKU no se lista en el catálogo
   * (`SkuDetalle.marca_excluida`). La Ficha SÍ se sirve — sólo lo declara.
   *
   * REQUERIDA, a diferencia de `color` y `tecnologia` de arriba, y la
   * diferencia no es de gusto: esas dos degradan a algo VISIBLE («Sin color»,
   * «Sin tecnología»), así que olvidarlas se nota en pantalla. Ésta degradaría
   * a SILENCIO — el aviso simplemente no saldría— que es exactamente el modo
   * de falla que este bloque existe para impedir. Obligatoria, `tsc` enumera a
   * quien la olvide.
   */
  marcaExcluida: boolean;
}

const CHIP_NEUTRO = "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted";

/**
 * Header de la Ficha SKU: breadcrumb, identidad (SKU/descripción), estatus,
 * disponibilidad y acceso a El Cruce. 100% presentacional — los badges que
 * alimentan `EstatusPill` se construyen aquí mismo (versión minimal/exclusiva,
 * distinta de `badgesDe` de servicios: esta vista no necesita 'sin_familia').
 */
export function FichaHeader({
  sku,
  marca,
  familiaEfectiva,
  descrEfectiva,
  total,
  disponible,
  sobreReservado,
  stock,
  reservas,
  snapshotStock,
  color,
  tecnologia,
  marcaExcluida,
}: FichaHeaderProps) {
  const badges: BadgeCatalogo[] = sobreReservado ? ["sobre_reservado"] : total === 0 ? ["stock_cero"] : [];

  const stockPositivo = stock.filter((s) => s.cantidad > 0);
  const soloWest = stockPositivo.length > 0 && stockPositivo.every((s) => s.almacen === "WEST");

  const clientesUnicos = new Set(reservas.map((r) => r.cliente)).size;

  const colorInfo = colorSkuInfo(color);

  // [VERT-B2] EL CINTILLO SABE ACUMULAR — y hasta aquí no sabía.
  //
  // Era un `{bannerBaja && …}` suelto: un solo bloque condicional, sin arreglo
  // y sin sitio donde poner un segundo aviso. Y hace falta de verdad, no en
  // teoría: medido contra un corte real, **casi todos los SKU remanentes
  // son marca VERTICAL** (ver `docs/known-limitations.md`), o sea que para
  // casi todas esas fichas los DOS avisos son ciertos a la vez. Con el `&&`
  // suelto, el segundo no tenía dónde ponerse.
  //
  // El orden es deliberado: primero la REGLA (por qué no lo encuentras en el
  // catálogo), después el DATO (además ya no viene en el archivo). El usuario
  // que llegó aquí buscando el SKU necesita antes la causa que el detalle.
  const avisos: string[] = [];
  if (marcaExcluida) {
    avisos.push(
      `La marca ${marca} no se lista en el catálogo por una regla. Este SKU y sus piezas siguen en la base: lo que se excluye es la vista.`,
    );
  }
  if (snapshotStock !== null && snapshotStock.vigente === false) {
    // [FIX-B1 · T3] Copy llano: "snapshot de stock más reciente" era jerga
    // técnica (nombraba la tabla, no lo que el usuario ve). Dice lo mismo
    // sin nombrar el mecanismo interno.
    avisos.push('Este producto ya no viene en el último archivo de inventario.');
  }

  const colorDisponible = disponible < 0 ? "text-warn" : disponible === 0 ? "text-ink-muted" : "text-success";

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      {avisos.map((aviso) => (
        <div
          key={aviso}
          className="flex items-center gap-2 rounded-[10px] bg-info-bg px-3 py-2 text-[12.5px] text-info"
        >
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{aviso}</span>
        </div>
      ))}

      <nav aria-label="Ruta" className="flex items-center gap-1.5 text-[12px] text-ink-muted">
        <span>{marca}</span>
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{familiaEfectiva ?? "Sin familia"}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="break-all font-mono text-2xl font-bold text-ink">{sku}</h1>
            <span className={CHIP_NEUTRO}>llave única · no editable</span>
          </div>
          <p className="text-[14px] text-ink-2">{descrEfectiva ?? "—"}</p>
          <div className="flex flex-wrap items-center gap-2">
            <EstatusPill badges={badges} disponible={disponible} />
            {soloWest && <span className={CHIP_NEUTRO}>Solo en WEST</span>}
            {reservas.length > 0 && (
              <span className={CHIP_NEUTRO}>
                {reservas.length} reservas · {clientesUnicos} clientes
              </span>
            )}
            <span className={CHIP_NEUTRO}>
              {colorInfo ? (
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 shrink-0 rounded-full", colorInfo.bgClass)} />
              ) : (
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full border border-dashed border-ink-muted3" />
              )}
              {colorInfo ? colorInfo.label : "Sin color"}
            </span>
            <span className={CHIP_NEUTRO}>{tecnologia ?? "Sin tecnología"}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2.5">
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Disponible</p>
            <p className={cn("font-mono text-3xl font-bold leading-tight", colorDisponible)}>{formatoNumero(disponible)}</p>
            <p className="text-[12px] text-ink-muted">de {formatoNumero(total)} total</p>
          </div>
          {/*
            [INV-B8.2] El SKU se marca DESDE LA FICHA, no solo desde el catálogo:
            es donde alguien decide de verdad si lo quiere, con las cifras y los
            almacenes enfrente. Es el MISMO `BotonSeleccion` de la tabla y del
            grid —un interruptor, no un contador— en su variante larga, para que
            el estado no pueda divergir entre las tres superficies.

            Va junto a "Ver en Embarques" y no en una barra nueva: el brief pedía
            el botón, no rediseñar la ficha.
          */}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* [INV-B9] Seguir se decide aquí más que en ninguna otra parte:
                es donde alguien mira las cifras y los almacenes y decide si le
                importa. Mismo componente que la tabla y el grid. */}
            <BotonSeguir sku={sku} variante="completo" className="px-3 py-2 text-[12.5px]" />
            <BotonSeleccion sku={sku} variante="completo" className="px-3 py-2 text-[12.5px]" />
            <Button asChild>
              <Link href={`/embarques?sku=${encodeURIComponent(sku)}`}>Ver en Embarques</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
