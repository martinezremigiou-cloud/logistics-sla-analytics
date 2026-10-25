"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError } from "@/components/shared/estado-carga";
import { ChipFiltroActivo } from "@/components/shared/chip-filtro-activo";
import { PipelineAduana } from "./pipeline-aduana";
import { EtapaDetalle } from "./etapa-detalle";
import { ViendoChips } from "./viendo-chips";
import { FocoSku } from "./foco-sku";
import { PipelineSkeleton } from "./cruce-skeleton";
import type { CruceEtapa, CruceResponse } from "@/types/api";

/**
 * Isla client de `/embarques` (el pipeline; «Cruce» es su nombre interno): DOS fuentes de datos independientes con error
 * acotado por sección — el pipeline (`GET /api/cruce`) y el foco por SKU
 * (`GET /api/sku/[sku]`, delegado íntegramente a `FocoSku`). Si una falla,
 * la otra sigue funcionando: por eso viven en secciones separadas, nunca en
 * un único estado loading/error compartido.
 *
 * `foco` es estado local inicializado desde `?sku=` (no derivado en cada
 * render de `useSearchParams`, a diferencia de `CatalogoView`): cada cambio
 * se sincroniza a la URL vía `router.replace`, sin ensuciar el historial.
 */
export function CruceView() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [foco, setFoco] = useState<string | null>(() => searchParams.get("sku"));
  const [seleccion, setSeleccion] = useState<number | null>(null);

  const { data, error, loading, refetch } = useApi<CruceResponse>("/api/cruce");

  // Drill-down `?retrasado=1` (F4, enlace del dashboard): filtra client-side
  // SOLO las filas visibles de la etapa seleccionada (`EtapaDetalle.items`).
  // Los agregados `activos`/`historial` que pinta `PipelineAduana` (rail +
  // chip de resumen) siguen siendo los REALES del snapshot completo — NO se
  // recalculan sobre el subconjunto filtrado (se le pasan `data.etapas` tal
  // cual, sin filtrar).
  const soloRetrasados = searchParams.get("retrasado") === "1";

  function actualizarFoco(sku: string | null) {
    setFoco(sku);
    router.replace(sku === null ? "/embarques" : `/embarques?sku=${encodeURIComponent(sku)}`, { scroll: false });
  }

  function handleSelectEtapa(orden: number) {
    setSeleccion((prev) => (prev === orden ? null : orden));
  }

  function limpiarRetrasado() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("retrasado");
    const qs = next.toString();
    router.replace(qs ? `/embarques?${qs}` : "/embarques", { scroll: false });
  }

  const etapaCruda = data?.etapas.find((e) => e.orden === seleccion) ?? null;
  const etapaSeleccionada: CruceEtapa | null =
    etapaCruda && soloRetrasados ? { ...etapaCruda, items: etapaCruda.items.filter((it) => it.retrasado) } : etapaCruda;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Pipeline de aduana" className="flex flex-col gap-4">
        {soloRetrasados && (
          <div className="flex flex-wrap items-center gap-2">
            <ChipFiltroActivo label="Solo retrasados" onClear={limpiarRetrasado} />
          </div>
        )}
        {loading ? (
          <PipelineSkeleton />
        ) : error ? (
          <EstadoError mensaje={error.message} onRetry={refetch} />
        ) : data ? (
          <>
            <PipelineAduana etapas={data.etapas} resumen={data.resumen} seleccion={seleccion} onSelect={handleSelectEtapa} />
            {etapaSeleccionada && (
              <EtapaDetalle etapa={etapaSeleccionada} onFoco={actualizarFoco} onClose={() => setSeleccion(null)} />
            )}
          </>
        ) : (
          // Defensivo: sin loading/error, `useApi` siempre trae `data`.
          <PipelineSkeleton />
        )}
      </section>

      <section aria-label="Foco por SKU" className="flex flex-col gap-4">
        <ViendoChips skus={data?.skus_activos ?? []} foco={foco} onSelect={actualizarFoco} />
        <FocoSku foco={foco} onClear={() => actualizarFoco(null)} />
      </section>
    </div>
  );
}
