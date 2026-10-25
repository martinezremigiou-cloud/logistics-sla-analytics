"use client";

import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { ChipFiltroActivo } from "@/components/shared/chip-filtro-activo";
import { Button } from "@/components/ui/button";
import { Paginacion } from "@/components/catalogo/paginacion";
import { formatoNumero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { SnapshotIdentidadHeader } from "./snapshot-identidad-header";
import { CambiosFiltros } from "./cambios-filtros";
import { CambiosTabla } from "./cambios-tabla";
import { CambiosHeaderSkeleton, CambiosTablaSkeleton } from "./cambios-skeleton";
import { ENTIDAD_LABELS, TIPO_LABELS } from "./snapshots-formato";
import type { CambiosPage, CambioItem } from "@/types/api";

type Entidad = CambioItem["entidad"];
type Tipo = CambioItem["tipo"];

export interface CambiosViewProps {
  id: string;
}

const TITULO_404 = "No encontramos este snapshot.";

interface CambiosFiltrosState {
  entidad: Entidad | null;
  tipo: Tipo | null;
  sku: string | null;
  page: number;
}

/** Arma `/api/snapshots/{id}/cambios?...` reenviando solo los filtros activos. 100% PURA — exportada para tests. */
export function buildCambiosUrl(id: string, filtros: CambiosFiltrosState): string {
  const sp = new URLSearchParams();
  if (filtros.entidad) sp.set("entidad", filtros.entidad);
  if (filtros.tipo) sp.set("tipo", filtros.tipo);
  if (filtros.sku) sp.set("sku", filtros.sku);
  if (filtros.page > 1) sp.set("page", String(filtros.page));
  const qs = sp.toString();
  return `/api/snapshots/${encodeURIComponent(id)}/cambios${qs ? `?${qs}` : ""}`;
}

/**
 * Isla client de `/snapshots/[id]`: detalle de cambios de un snapshot,
 * con filtros LOCALES (no en la URL — a diferencia de `/catalogo`, esta
 * vista no necesita ser bookmarkeable con filtros; los pocos filtros que
 * tiene son de exploración puntual).
 *
 * 404 (`snapshot_no_encontrado`) es un `return` temprano, especial e
 * IRRECUPERABLE por filtrado (mismo criterio que `FichaView` con
 * `sku_no_encontrado`): no tiene sentido montar filtros para un snapshot
 * que no existe.
 *
 * Chrome persistente (C3/FIX-RESET) para cualquier otro estado:
 * `<CambiosFiltros>` es un hijo SIEMPRE montado (misma posición en cada
 * render, nunca condicionado), así que sobrevive cualquier
 * loading/error/refetch. El encabezado de identidad y la tabla sí están
 * gateados por `data` (no tienen estado propio que perder).
 */
export function CambiosView({ id }: CambiosViewProps) {
  const [entidad, setEntidad] = useState<Entidad | null>(null);
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [sku, setSku] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const url = buildCambiosUrl(id, { entidad, tipo, sku, page });
  const { data, error, loading, refetch } = useApi<CambiosPage>(url);

  if (error?.error === "snapshot_no_encontrado") {
    return (
      <EstadoVacio
        titulo={TITULO_404}
        descripcion="Puede que el enlace sea antiguo o el snapshot ya no exista."
        cta={
          <Button variant="outline" asChild>
            <Link href="/snapshots">Volver a Snapshots</Link>
          </Button>
        }
      />
    );
  }

  function handleSubmitSku(valor: string) {
    setSku(valor || null);
    setPage(1);
  }
  function handleChangeEntidad(valor: Entidad | null) {
    setEntidad(valor);
    setPage(1);
  }
  function handleChangeTipo(valor: Tipo | null) {
    setTipo(valor);
    setPage(1);
  }
  function handleLimpiar() {
    setSku(null);
    setEntidad(null);
    setTipo(null);
    setPage(1);
  }

  const hayFiltros = Boolean(sku || entidad || tipo);

  return (
    <div className="flex flex-col gap-5">
      {loading && !data && <CambiosHeaderSkeleton />}
      {data && <SnapshotIdentidadHeader snapshot={data.snapshot} />}

      <div className="flex flex-col gap-2.5">
        <CambiosFiltros
          sku={sku}
          entidad={entidad}
          tipo={tipo}
          onSubmitSku={handleSubmitSku}
          onChangeEntidad={handleChangeEntidad}
          onChangeTipo={handleChangeTipo}
          onLimpiar={handleLimpiar}
        />
        {hayFiltros && (
          <div className="flex flex-wrap items-center gap-2">
            {sku && <ChipFiltroActivo label={`SKU: ${sku}`} onClear={() => handleSubmitSku("")} />}
            {entidad && <ChipFiltroActivo label={`Entidad: ${ENTIDAD_LABELS[entidad]}`} onClear={() => handleChangeEntidad(null)} />}
            {tipo && <ChipFiltroActivo label={`Tipo: ${TIPO_LABELS[tipo]}`} onClear={() => handleChangeTipo(null)} />}
          </div>
        )}
      </div>

      {error && !data && <EstadoError mensaje={error.message} onRetry={refetch} />}
      {loading && !data && <CambiosTablaSkeleton />}
      {data && (
        <div className={cn("flex flex-col gap-3", loading && "opacity-60")}>
          {hayFiltros && (
            <p className="text-[12.5px] text-muted-foreground">
              mostrando {formatoNumero(data.total)} de {formatoNumero(data.resumen.total)}
            </p>
          )}
          {data.total === 0 ? (
            hayFiltros ? (
              <EstadoVacio
                titulo="Sin cambios que coincidan con estos filtros."
                cta={
                  <Button variant="outline" onClick={handleLimpiar}>
                    Limpiar filtros
                  </Button>
                }
              />
            ) : (
              <EstadoVacio titulo="Este snapshot no introdujo cambios." />
            )
          ) : data.items.length === 0 ? (
            // Fix B19 (revisor-codigo, ronda 2): por simetría con
            // `EmbarquesView`/`CatalogoView` — página fuera de rango
            // (total>0, items vacío para ESTA página).
            <EstadoVacio
              titulo="Sin resultados en esta página"
              cta={
                <Button variant="outline" onClick={() => setPage(1)}>
                  Ir a la página 1
                </Button>
              }
            />
          ) : (
            <>
              <CambiosTabla items={data.items} loading={loading} />
              {/* `page` (estado local, NO `data.page`): mismo motivo que `snapshots-columna.tsx` — `data` conserva la respuesta ANTERIOR mientras el refetch está en vuelo, así que `data.page` mostraría la página vieja durante ese instante. */}
              <Paginacion page={page} totalPages={data.totalPages} total={data.total} onPageChange={setPage} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
