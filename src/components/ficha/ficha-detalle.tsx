import { FichaHeader } from "./ficha-header";
import { FichaAtributos } from "./ficha-atributos";
import { FichaStock } from "./ficha-stock";
import { FichaReservas } from "./ficha-reservas";
import { FichaEmbarques } from "./ficha-embarques";
import { FichaImagen } from "./ficha-imagen";
import { formatoFechaHora } from "@/lib/formato";
import type { SkuDetalle } from "@/types/api";

// Barrel de subcomponentes: El Cruce (F5) reutiliza estas piezas presentacionales
// directamente (no este contenedor) — se re-exportan todas desde aquí además de
// sus propios archivos.
export { FichaHeader } from "./ficha-header";
export { FichaAtributos } from "./ficha-atributos";
export { FichaStock } from "./ficha-stock";
export { FichaReservas } from "./ficha-reservas";
export { FichaEmbarques } from "./ficha-embarques";
export { FichaImagen } from "./ficha-imagen";

interface FichaDetalleProps {
  detalle: SkuDetalle;
  /** Refetch de la ficha (`useApi` de `FichaView`) — se pasa hasta `FichaAtributos` para refrescar tras cada guardado (familia, descripción, tecnología, color) y también ante un 409 `excel_manda` de tecnología: el Excel ya trae el dato y la ficha en pantalla envejeció. */
  onSaved?: () => void;
  /** `true` mientras un refetch (tras un guardado o un 409 `excel_manda`) está en vuelo mostrando datos previos — ver gate anti-remount en `FichaView`. `undefined`/`false` en fixtures/usos que no lo necesitan (p.ej. `FocoSku`, que reusa las cards pero no esta raíz). */
  busy?: boolean;
}

/**
 * Contenedor presentacional PURO de la Ficha SKU: compone header + grid de
 * cards a partir del DTO ya resuelto (`SkuDetalle`). NO hace fetch — eso
 * vive en `FichaView`.
 */
export function FichaDetalle({ detalle, onSaved, busy }: FichaDetalleProps) {
  return (
    <div className="flex flex-col gap-5" aria-busy={busy}>
      <FichaHeader
        sku={detalle.sku}
        marca={detalle.marca}
        familiaEfectiva={detalle.familia_efectiva}
        descrEfectiva={detalle.descr_efectiva}
        total={detalle.total}
        disponible={detalle.disponible}
        sobreReservado={detalle.sobre_reservado}
        stock={detalle.stock}
        reservas={detalle.reservas}
        snapshotStock={detalle.snapshot.stock}
        color={detalle.color ?? null}
        tecnologia={detalle.tecnologia ?? null}
        marcaExcluida={detalle.marca_excluida}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <FichaAtributos
            sku={detalle.sku}
            marca={detalle.marca}
            familiaEfectiva={detalle.familia_efectiva}
            familiasEfectivas={detalle.familias_efectivas}
            divergenciaFamilia={detalle.divergencia_familia ?? null}
            descrEfectiva={detalle.descr_efectiva}
            original={detalle.original}
            color={detalle.color ?? null}
            clase={detalle.clase ?? null}
            tecnologia={detalle.tecnologia ?? null}
            tecnologiaPortal={detalle.tecnologia_portal ?? null}
            origenes={detalle.origenes}
            v2={detalle.v2}
            decididoEnBandeja={detalle.decidido_en_bandeja}
            onSaved={onSaved}
          />
          <FichaStock
            stock={detalle.stock}
            total={detalle.total}
            reservado={detalle.reservado}
            piezasEnCamino={detalle.piezas_en_camino}
          />
          <FichaReservas reservado={detalle.reservado} reservas={detalle.reservas} reservaDescuadre={detalle.reserva_descuadre} />
          <FichaEmbarques embarques={detalle.embarques} piezasHistorial={detalle.piezas_historial} />
        </div>
        <div className="flex flex-col gap-5">
          <FichaImagen sku={detalle.sku} imagenUrl={detalle.imagen_url} descr={detalle.descr_efectiva} />
        </div>
      </div>

      <p className="text-[11.5px] text-ink-muted">
        Snapshot stock: {formatoFechaHora(detalle.snapshot.stock?.created_at ?? null)} · aduana:{" "}
        {formatoFechaHora(detalle.snapshot.aduana?.created_at ?? null)}
      </p>
    </div>
  );
}
