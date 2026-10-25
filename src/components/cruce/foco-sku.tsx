"use client";

import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { Button } from "@/components/ui/button";
import { FichaStock, FichaEmbarques, FichaReservas } from "@/components/ficha/ficha-detalle";
import { ListaFamiliaChips } from "@/components/shared/familias-chips";
import { FocoSkuSkeleton } from "./cruce-skeleton";
import { formatoNumero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { SkuDetalle } from "@/types/api";

export interface FocoSkuProps {
  /** SKU actualmente enfocado (sincronizado con `?sku=` por `CruceView`), o `null` si ninguno. */
  foco: string | null;
  /** Limpia la selección (usado por el 404 y por quien orqueste el foco). */
  onClear: () => void;
}

const MENSAJE_404_FALLBACK = "SKU no encontrado en el catálogo";

/** Estilo del chip de identidad (marca + cada familia) — hero navy FIJO, nunca tokens de tema (ver docstring de `FocoSku`). */
const CHIP_IDENTIDAD_CLASSNAME =
  "inline-flex w-fit items-center rounded-full bg-white/[0.12] px-2.5 py-1 text-[11.5px] font-semibold";

interface MetricaHeroProps {
  label: string;
  valor: number;
  /** Tono de advertencia (ámbar claro, legible sobre el fondo navy) cuando el valor es negativo. */
  advertencia?: boolean;
}

function MetricaHero({ label, valor, advertencia }: MetricaHeroProps) {
  return (
    <div className="flex min-w-[130px] flex-1 flex-col gap-0.5 rounded-[12px] bg-white/[0.08] px-3.5 py-2.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-white/70">{label}</span>
      <span className={cn("font-mono text-xl font-bold", advertencia ? "text-amber-300" : "text-white")}>
        {formatoNumero(valor)}
      </span>
    </div>
  );
}

/**
 * Sección de foco de El Cruce: fetch independiente de `GET /api/sku/[sku]`,
 * ajeno al estado del pipeline (F5 — "si el pipeline falla, el foco sigue
 * funcionando y viceversa"). El hero es la ÚNICA pieza de esta vista que NO
 * usa tokens de tema: el blueprint la mantiene navy fija incluso en dark,
 * igual que el sidebar.
 *
 * Gate anti-remount (docs/engineering/failure-patterns.md (P3), mismo anti-patrón vivido
 * en FIX-RESET): cambiar el SKU enfocado (`foco`, sincronizado con `?sku=`)
 * dispara un nuevo GET con `loading=true` mientras `data` todavía tiene el
 * SKU anterior (ver `use-api.ts`). Un gate `if (loading) return
 * <Skeleton/>` desmontaría el foco ya cargado en cada clic de navegación.
 * El error solo reemplaza el contenido cuando no hay ningún `data` que
 * mostrar; el skeleton solo cuando todavía no llegó el primer `data`.
 */
export function FocoSku({ foco, onClear }: FocoSkuProps) {
  const { data, error, loading, refetch } = useApi<SkuDetalle>(foco !== null ? `/api/sku/${encodeURIComponent(foco)}` : null);

  if (foco === null) {
    return (
      <EstadoVacio
        titulo="Elige un SKU"
        descripcion="Selecciona un SKU del pipeline o de la fila Viendo para ver su cruce completo."
      />
    );
  }

  if (error && !data) {
    if (error.error === "sku_no_encontrado") {
      return (
        <EstadoVacio
          titulo={error.message ?? MENSAJE_404_FALLBACK}
          descripcion={`No encontramos "${foco}" en el catálogo.`}
          cta={
            <Button variant="outline" onClick={onClear}>
              Quitar selección
            </Button>
          }
        />
      );
    }
    return <EstadoError mensaje={error.message} onRetry={refetch} />;
  }

  if (loading && !data) {
    return <FocoSkuSkeleton />;
  }

  if (!data) {
    // Defensivo: sin loading/error y con `foco` no-null, `useApi` siempre trae `data`.
    return <FocoSkuSkeleton />;
  }

  const disponibleNegativo = data.disponible < 0;

  return (
    <div className="flex flex-col gap-5" aria-busy={loading}>
      <div className="flex flex-col gap-4 rounded-2xl bg-gradient-to-br from-sidebar-top to-sidebar p-5 text-white">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/70">Llave única · SKU</span>
        <div className="flex flex-col gap-1.5">
          <h2 className="break-all font-mono text-[26px] font-bold leading-tight">{data.sku}</h2>
          <p className="text-[13.5px] text-white/85">{data.descr_efectiva ?? "—"}</p>
          {/*
            R3-1 (bug real, ronda de revisión): antes esta pill pintaba
            `data.familia_efectiva ?? "Sin familia"` — el CRUDO compuesto,
            NUNCA separado — así que un sku con familia multi-valor (p.ej.
            `VJ9123-F`, `familias_efectivas: ["CLIP 3.0","CLIP ROTATIVO"]`) se
            veía como un solo bloque de texto "CLIP 3.0 / CLIP ROTATIVO",
            exactamente el síntoma que `separarFamilias` (`src/lib/
            familias.ts`) existe para matar en el resto de la app. Fix:
            marca y CADA familia son chips independientes vía
            `ListaFamiliaChips` (`components/shared/familias-chips.tsx`,
            R3-2), que también resuelve el caso vacío "Sin familia".
          */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={CHIP_IDENTIDAD_CLASSNAME}>{data.marca}</span>
            <ListaFamiliaChips familias={data.familias_efectivas} className={CHIP_IDENTIDAD_CLASSNAME} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <MetricaHero label="Disponible hoy" valor={data.disponible} advertencia={disponibleNegativo} />
          <MetricaHero label="En camino" valor={data.piezas_en_camino} />
          <MetricaHero label="Histórico recibido" valor={data.piezas_historial} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FichaStock stock={data.stock} total={data.total} reservado={data.reservado} piezasEnCamino={data.piezas_en_camino} />
        <FichaEmbarques embarques={data.embarques} piezasHistorial={data.piezas_historial} />
        <FichaReservas reservado={data.reservado} reservas={data.reservas} reservaDescuadre={data.reserva_descuadre} />
      </div>

      <Link
        href={`/catalogo/${encodeURIComponent(data.sku)}`}
        className="w-fit rounded-sm text-[12.5px] font-medium text-ink-muted outline-none transition-colors hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app"
      >
        Abrir ficha completa →
      </Link>
    </div>
  );
}
