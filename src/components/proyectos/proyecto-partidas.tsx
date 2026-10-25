"use client";

// ============================================================
// [INV-B8] proyecto-partidas.tsx — card "Partidas del proyecto" de
// `/proyectos/[id]`.
//
// Los DOS selectores (Marca/Tecnología) se pueblan SIEMPRE de
// `detalle.facetas` (valores REALES presentes en las partidas de ESTE
// proyecto) — jamás de una lista fija: si un proyecto no tiene ninguna
// partida BRAND1, "BRAND1" no aparece en el selector, aunque exista en el
// catálogo general. El filtro entero corre en memoria sobre
// `detalle.partidas` (ya completo, acotado por `MAX_PARTIDAS`): no hay
// paginación de servidor que reenviar aquí.
// ============================================================
import { useState } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { EstadoVacio } from "@/components/shared/estado-carga";
import { formatoFechaHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { AgregarSkuDialog } from "./agregar-sku-dialog";
import { ProyectoPartidaFila } from "./proyecto-partida-fila";
import { filtrarPartidas, hayFiltrosActivos, FILTROS_PARTIDAS_VACIOS, type FiltrosPartidas } from "./proyecto-partidas-filtro";
import type { ProyectoDetalle } from "@/types/proyectos";

export interface ProyectoPartidasProps {
  detalle: ProyectoDetalle;
  /** Refetch del detalle (`useApi` de `ProyectoDetalleView`) — se invoca tras agregar/editar/quitar una partida. */
  onChanged: () => void;
}

export function ProyectoPartidas({ detalle, onChanged }: ProyectoPartidasProps) {
  const [filtros, setFiltros] = useState<FiltrosPartidas>(FILTROS_PARTIDAS_VACIOS);

  const skusExistentes = new Set(detalle.partidas.map((p) => p.sku));
  const hayPartidas = detalle.partidas.length > 0;
  const filtrosActivos = hayFiltrosActivos(filtros);
  const filtradas = hayPartidas ? filtrarPartidas(detalle.partidas, filtros) : [];

  function limpiarFiltros() {
    setFiltros(FILTROS_PARTIDAS_VACIOS);
  }

  const vigenciaTexto = detalle.vigencia.tomado_en
    ? `Datos al ${formatoFechaHora(detalle.vigencia.tomado_en)}`
    : "Sin snapshot de stock vigente todavía";

  return (
    <Card className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-[14.5px] font-semibold text-ink">Partidas del proyecto</h2>
          <span className="text-[11.5px] text-ink-muted">piezas por SKU · sin duplicados</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-muted">{vigenciaTexto}</span>
          <AgregarSkuDialog proyectoId={detalle.id} skusExistentes={skusExistentes} onAgregado={onChanged} />
        </div>
      </div>

      <div className="flex flex-col gap-3.5 p-5">
        {hayPartidas && (
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full max-w-[260px]">
              <label htmlFor="proyecto-partidas-q" className="sr-only">
                Buscar SKU o descripción
              </label>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <Input
                id="proyecto-partidas-q"
                value={filtros.q}
                onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))}
                placeholder="Buscar SKU o descripción…"
                className="h-9 rounded-[9px] border-line bg-surface-input pl-8 text-[13px]"
              />
            </div>

            <label className="sr-only" htmlFor="proyecto-partidas-marca">
              Marca
            </label>
            <select
              id="proyecto-partidas-marca"
              value={filtros.marca ?? ""}
              onChange={(e) => setFiltros((f) => ({ ...f, marca: e.target.value === "" ? null : e.target.value }))}
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
            >
              <option value="">Marca: todas</option>
              {detalle.facetas.marcas.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <label className="sr-only" htmlFor="proyecto-partidas-tecnologia">
              Tecnología
            </label>
            <select
              id="proyecto-partidas-tecnologia"
              value={filtros.tecnologia ?? ""}
              onChange={(e) => setFiltros((f) => ({ ...f, tecnologia: e.target.value === "" ? null : e.target.value }))}
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
            >
              <option value="">Tecnología: todas</option>
              {detalle.facetas.tecnologias.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button
              type="button"
              aria-pressed={filtros.soloEnRiesgo}
              onClick={() => setFiltros((f) => ({ ...f, soloEnRiesgo: !f.soloEnRiesgo }))}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 text-[12.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
                filtros.soloEnRiesgo ? "border-warn/30 bg-warn-bg text-warn" : "border-line bg-surface text-ink-2 hover:bg-surface-3",
              )}
            >
              ⚠ En riesgo
            </button>

            {filtrosActivos && (
              <Button type="button" variant="ghost" size="sm" onClick={limpiarFiltros} className="text-brand hover:text-brand">
                Limpiar filtros
              </Button>
            )}
          </div>
        )}

        {!hayPartidas ? (
          <EstadoVacio
            titulo="Este proyecto aún no tiene partidas…"
            descripcion="Usa “+ Agregar SKU” para empezar a sumar piezas por SKU."
          />
        ) : filtradas.length === 0 ? (
          <EstadoVacio
            titulo="Sin resultados"
            descripcion="Ninguna partida coincide con los filtros actuales."
            cta={
              <Button variant="outline" onClick={limpiarFiltros}>
                Limpiar filtros
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-2">
            {filtradas.map((p) => (
              <ProyectoPartidaFila key={p.partida_id} proyectoId={detalle.id} partida={p} onChanged={onChanged} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
