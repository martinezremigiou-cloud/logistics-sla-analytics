"use client";

// ============================================================
// Bloque 7-A · Libro Mayor · embarques-filtros.tsx
// 100% presentacional (el estado real vive en `embarques-view.tsx`, en la
// URL) — mismo contrato de props que `catalogo-filtros.tsx`. Moldes citados:
//   - buscador con formulario local (`texto`/resincroniza con `q`): catalogo-filtros.tsx.
//   - Tabs controladas por URL (`value`/`onValueChange`): config-view.tsx.
//   - chip-toggle "Solo retrasados" con `aria-pressed`: viendo-chips.tsx / pipeline-aduana.tsx.
//   - panel colapsable con Button + aria-expanded/aria-controls (SIN Accordion): pedido explícito de xui-modeler.
// ============================================================
import { useEffect, useState, type FormEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { EmbarquesFacetaEstatus, EmbarquesFacetaValor } from "@/types/api";

export type Ambito = "todos" | "activos" | "historial";
export type FechaCampo = "etd" | "eta" | "llegada";

/** Copy es-MX del campo de fecha elegido — compartido con `embarques-view.tsx` (chip removible del rango). */
export const FECHA_CAMPO_LABEL: Record<FechaCampo, string> = { etd: "ETD", eta: "ETA", llegada: "Llegada" };

export interface ConteosAmbito {
  /** `null` mientras el conteo base (universo, ver `embarques-view.tsx`) no ha cargado todavía. */
  todos: number | null;
  activos: number | null;
  historial: number | null;
}

interface EmbarquesFiltrosProps {
  ambito: Ambito;
  onChangeAmbito: (ambito: Ambito) => void;
  conteos: ConteosAmbito;

  q: string;
  onSubmitQ: (q: string) => void;

  estatus: number | null;
  facetasEstatus: EmbarquesFacetaEstatus[];
  onChangeEstatus: (estatus: number | null) => void;

  retrasado: boolean;
  onToggleRetrasado: () => void;

  pais: string | null;
  facetasPaises: EmbarquesFacetaValor[];
  onChangePais: (pais: string | null) => void;

  fechaCampo: FechaCampo;
  onChangeFechaCampo: (campo: FechaCampo) => void;
  desde: string | null;
  onChangeDesde: (v: string | null) => void;
  hasta: string | null;
  onChangeHasta: (v: string | null) => void;
  /** `true` cuando `desde > hasta` (ambos presentes) — pinta la validación inline junto a los inputs de fecha, SIN bloquear su edición (M8: el fetch se congela en `EmbarquesView`, esta vista solo avisa). */
  rangoFechaInvalido: boolean;
}

/** Fila de filtros de `/embarques` (dos niveles: siempre visibles + panel "Más filtros" colapsable). */
export function EmbarquesFiltros(props: EmbarquesFiltrosProps) {
  const {
    ambito,
    onChangeAmbito,
    conteos,
    q,
    onSubmitQ,
    estatus,
    facetasEstatus,
    onChangeEstatus,
    retrasado,
    onToggleRetrasado,
    pais,
    facetasPaises,
    onChangePais,
    fechaCampo,
    onChangeFechaCampo,
    desde,
    onChangeDesde,
    hasta,
    onChangeHasta,
    rangoFechaInvalido,
  } = props;

  const [texto, setTexto] = useState(q);
  // Si `q` cambia desde afuera (deep-link, "Limpiar filtros"), el input local se resincroniza.
  useEffect(() => setTexto(q), [q]);

  // Panel "Más filtros": abierto por defecto SOLO si el mount inicial ya trae
  // país/rango activos por deep-link (así el usuario ve de entrada qué está
  // aplicado, no solo el chip de arriba) — estado local, nunca se recalcula
  // en renders posteriores (el componente vive montado todo el tiempo, C3).
  const [panelAbierto, setPanelAbierto] = useState(() => pais !== null || desde !== null || hasta !== null);

  // M8: si el rango se vuelve inválido (p.ej. el usuario edita "Hasta" con
  // el panel ya cerrado), se reabre para que la validación inline sea
  // visible SIEMPRE — nunca queda escondida detrás de un panel colapsado.
  useEffect(() => {
    if (rangoFechaInvalido) setPanelAbierto(true);
  }, [rangoFechaInvalido]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmitQ(texto.trim());
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs value={ambito} onValueChange={(v) => onChangeAmbito(v as Ambito)}>
        <TabsList>
          <TabsTrigger value="todos">Todos{conteos.todos !== null ? ` (${conteos.todos})` : ""}</TabsTrigger>
          <TabsTrigger value="activos">Activos{conteos.activos !== null ? ` (${conteos.activos})` : ""}</TabsTrigger>
          <TabsTrigger value="historial">Histórico{conteos.historial !== null ? ` (${conteos.historial})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-2.5">
        <form onSubmit={handleSubmit} className="relative w-full max-w-[280px]">
          <label htmlFor="embarques-filtro-q" className="sr-only">
            Buscar embarques
          </label>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <Input
            id="embarques-filtro-q"
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar OC, SKU, referencia o factura…"
            className="h-9 rounded-[9px] border-line bg-surface-input pl-8 text-[13px]"
          />
        </form>

        <label className="sr-only" htmlFor="embarques-filtro-estatus">
          Estatus
        </label>
        <select
          id="embarques-filtro-estatus"
          value={estatus === null ? "" : String(estatus)}
          onChange={(e) => onChangeEstatus(e.target.value === "" ? null : Number(e.target.value))}
          className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
        >
          <option value="">Estatus: todos</option>
          {facetasEstatus.map((f) => (
            // B13: conteo del universo visible en la opción (mismo criterio
            // que el select de País) + disabled cuando no hay ningún
            // embarque en esa etapa hoy (visible para no "esconder" una
            // etapa del pipeline, pero no elegible).
            <option key={f.orden} value={f.orden} disabled={f.conteo === 0}>
              {f.nombre} ({f.conteo})
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={retrasado}
          onClick={onToggleRetrasado}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[9px] border px-3 text-[12.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand",
            retrasado ? "border-warn/30 bg-warn-bg text-warn" : "border-line bg-surface text-ink-2 hover:bg-surface-3",
          )}
        >
          Solo retrasados
        </button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={panelAbierto}
          aria-controls="embarques-mas-filtros"
          onClick={() => setPanelAbierto((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Más filtros
        </Button>
      </div>

      {panelAbierto && (
        <div id="embarques-mas-filtros" className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line-soft bg-surface-3/40 p-3">
          {/* Filtros dirigidos por facetas: si el universo no trae países (faceta vacía), el control ni se pinta. */}
          {facetasPaises.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-ink-muted" htmlFor="embarques-filtro-pais">
                País
              </label>
              <select
                id="embarques-filtro-pais"
                value={pais ?? ""}
                onChange={(e) => onChangePais(e.target.value === "" ? null : e.target.value)}
                className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
              >
                <option value="">País: todos</option>
                {facetasPaises.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.valor} ({f.conteo})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted" htmlFor="embarques-filtro-campo-fecha">
              Filtrar por fecha de
            </label>
            <select
              id="embarques-filtro-campo-fecha"
              value={fechaCampo}
              onChange={(e) => onChangeFechaCampo(e.target.value as FechaCampo)}
              className="h-9 rounded-[9px] border border-line bg-surface px-2.5 text-[12.5px] text-ink-2"
            >
              <option value="eta">ETA</option>
              <option value="etd">ETD</option>
              <option value="llegada">Llegada</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted" htmlFor="embarques-filtro-desde">
              Desde
            </label>
            <input
              id="embarques-filtro-desde"
              type="date"
              value={desde ?? ""}
              onChange={(e) => onChangeDesde(e.target.value === "" ? null : e.target.value)}
              aria-invalid={rangoFechaInvalido}
              className={cn(
                "h-9 rounded-[9px] border bg-surface px-2.5 text-[12.5px] text-ink-2",
                rangoFechaInvalido ? "border-warn" : "border-line",
              )}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted" htmlFor="embarques-filtro-hasta">
              Hasta
            </label>
            <input
              id="embarques-filtro-hasta"
              type="date"
              value={hasta ?? ""}
              onChange={(e) => onChangeHasta(e.target.value === "" ? null : e.target.value)}
              aria-invalid={rangoFechaInvalido}
              className={cn(
                "h-9 rounded-[9px] border bg-surface px-2.5 text-[12.5px] text-ink-2",
                rangoFechaInvalido ? "border-warn" : "border-line",
              )}
            />
          </div>

          {rangoFechaInvalido && (
            // M8: validación inline junto a los inputs de fecha — la tabla
            // (montada aparte, en `EmbarquesView`) NO se reemplaza por esto;
            // el fetch simplemente se congela hasta que el rango sea válido.
            <p role="alert" className="w-full text-[11.5px] font-semibold text-warn">
              La fecha “Desde” debe ser anterior o igual a “Hasta”.
            </p>
          )}

          <p className="w-full text-[11.5px] text-ink-muted">
            Los embarques sin fecha de {FECHA_CAMPO_LABEL[fechaCampo]} quedan fuera de los resultados cuando usas este rango.
          </p>
        </div>
      )}
    </div>
  );
}
