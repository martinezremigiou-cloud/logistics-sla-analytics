"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Grid3x3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import { useApi } from "@/lib/hooks/use-api";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { Button } from "@/components/ui/button";
import type { ClaveAlmacen } from "@/types/enums";
import type { DashboardHeatmap, DashboardResponse } from "@/types/api";

export interface DashboardHeatmapProps {
  heatmap: DashboardHeatmap;
}

interface CeldaActiva {
  fila: string;
  columna: string;
  valor: number;
}

/** Valor del `<select>` que representa "sin filtro" — mismo criterio que `tecnologia ?? ""` de `catalogo-filtros.tsx`. */
const TODAS_TECNOLOGIAS = "";

/**
 * Lo único que este bloque consume de `GET /api/dashboard?tecnologia=...`:
 * SOLO `heatmap` (ver la asimetría C1 — kpis/radar/pipeline/tendencia/
 * alertas de esa respuesta NUNCA se leen ni se pintan aquí, así que ni
 * siquiera se tipan completos).
 */
type DashboardHeatmapFetch = Pick<DashboardResponse, "heatmap">;

/**
 * Intensidad de una celda: `0.08 + 0.52*(valor/max)` para `valor > 0`; `0`
 * (transparente) para celdas sin stock. El piso 0.08 es el mínimo VISIBLE
 * para cualquier valor real (>0) — nunca se aplica a una celda vacía: las
 * `celdas` del contrato son sparse (`dashboard.service.ts` solo emite pares
 * fila/columna con `valor > 0`), así que "sin entrada" siempre es alpha 0,
 * no el piso.
 *
 * **[DASH-E · E-3] El techo baja de 0,80 a 0,60, y no es cosmética: era la única
 * salida.** La celda pinta su número SOBRE este fondo, así que la rampa y la tinta
 * son una sola decisión — y estaban tomadas por separado. Medido, componiendo la
 * alfa sobre la superficie real:
 *
 * - En tema CLARO la regla anterior saltaba a blanco sobre alfa 0,5 y daba
 *   **2,02 : 1** — *peor* que el `--mx-text-2` que sustituía (5,24 : 1). El umbral
 *   estaba invertido para ese tema, y afectaba justo a las celdas de mayor valor.
 * - En tema OSCURO, entre alfa **0,62 y 0,74 NINGUNA tinta llegaba a 4,5** — ni la
 *   clara ni la oscura. Ese hueco no se podía cerrar eligiendo mejor la tinta: son
 *   las celdas al 75-92 % del máximo, y el fondo compuesto ahí es un azul medio.
 *
 * Con el techo en 0,60, **una sola tinta (`--mx-text`) pasa en TODO el rango y en
 * los DOS temas**: 7,69 : 1 en claro y 4,65 : 1 en oscuro. Sin variante `dark:`,
 * sin umbral y sin regla que recordar.
 *
 * **El costo, dicho:** el gradiente de intensidad se comprime a 0,52 de recorrido
 * en vez de 0,72 — un 72 % del contraste visual de antes. La rampa sigue siendo
 * monótona y sigue distinguiendo los extremos; lo que se pierde es dramatismo, y
 * lo que se gana es que la cifra de las celdas más cargadas se pueda leer.
 */
export function alphaCelda(valor: number, max: number): number {
  if (valor <= 0 || max <= 0) return 0;
  return 0.08 + 0.52 * (valor / max);
}

function FilaHeatmap({
  fila,
  columnas,
  porFilaColumna,
  max,
  onHover,
  onClick,
}: {
  fila: string;
  columnas: ClaveAlmacen[];
  porFilaColumna: Map<string, number>;
  max: number;
  onHover: (celda: CeldaActiva | null) => void;
  onClick: (fila: string, columna: string) => void;
}) {
  return (
    <>
      <span title={fila} className="truncate text-[11px] font-semibold text-ink-2">
        {fila}
      </span>
      {columnas.map((columna) => {
        const valor = porFilaColumna.get(`${fila}__${columna}`) ?? 0;
        const alpha = alphaCelda(valor, max);
        return (
          <button
            key={columna}
            type="button"
            onClick={() => onClick(fila, columna)}
            onMouseEnter={() => onHover({ fila, columna, valor })}
            onFocus={() => onHover({ fila, columna, valor })}
            aria-label={`${fila} · ${columna}: ${formatoNumero(valor)} piezas`}
            style={{ background: `rgb(var(--mx-heat-rgb) / ${alpha})` }}
            className={cn(
              "flex h-8 items-center justify-center rounded-[7px] font-mono text-[10.5px] font-semibold outline-none transition-transform hover:scale-[1.05] focus-visible:ring-2 focus-visible:ring-brand",
              // UNA sola tinta, sin umbral: con el techo de la rampa en 0,60,
              // `--mx-text` pasa 4,5:1 en todo el rango y en los dos temas. El
              // `alpha > 0.5 ? blanco : …` de antes daba 2,02:1 en claro.
              "text-ink",
            )}
          >
            {valor > 0 ? formatoNumero(valor) : "–"}
          </button>
        );
      })}
    </>
  );
}

/**
 * Selector de tecnología LOCAL al heatmap (C1): vive dentro de esta card, no
 * en una barra global, precisamente para que sea evidente que SOLO afecta
 * este bloque — el resto del dashboard (KPIs, radar, pipeline, tendencia,
 * alertas) nunca se refiltra (ver docstring de `DashboardHeatmapCard`).
 * Opciones: "Todas las tecnologías" (`TODAS_TECNOLOGIAS`) + `tecnologias`
 * (data-driven, NUNCA hardcodeadas) + `SIN_TECNOLOGIA` (sentinel fijo,
 * mismo criterio que el select de tecnología de `catalogo-filtros.tsx`).
 */
function SelectorTecnologia({
  valor,
  opciones,
  onChange,
}: {
  valor: string;
  opciones: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor="dashboard-heatmap-tecnologia" className="text-[11px] font-medium text-ink-muted">
        Tecnología (solo este mapa)
      </label>
      <select
        id="dashboard-heatmap-tecnologia"
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-[8px] border border-line bg-surface px-2 text-[11.5px] text-ink-2"
      >
        <option value={TODAS_TECNOLOGIAS}>Todas las tecnologías</option>
        {opciones.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
        <option value={SIN_TECNOLOGIA}>Sin tecnología</option>
      </select>
    </div>
  );
}

/**
 * Heatmap marca × almacén (INV-TAXO F4 — antes familia × almacén: la
 * familia es multi-valor y agregarla infla el total de piezas, ver
 * `DashboardHeatmap` en `types/api.ts`). SIEMPRE las 6 columnas del
 * contrato (incluye SOUTH: corrección obligatoria sobre el blueprint, que
 * solo tenía 5). Móvil: `overflow-x-auto` con `min-w` fijo en el grid
 * interno (patrón `pipeline-aduana.tsx`) — las columnas nunca se comprimen.
 *
 * **Leyenda honesta del corte top-10** (C1): `total_marcas` (universo ANTES
 * del recorte) decide si se muestra "Top 10 de N marcas con stock" —
 * SIEMPRE derivada del DTO, nunca hardcodeada; si `total_marcas <= 10` no
 * hay nada que confesar y la leyenda no se pinta.
 *
 * **Filtro de tecnología LOCAL** (C1): el control vive dentro de esta card
 * (nunca en una barra global) y dispara su PROPIO fetch a
 * `GET /api/dashboard?tecnologia=...`, aislado del fetch de
 * `DashboardView` — así el resto del dashboard (KPIs, radar, pipeline,
 * tendencia, alertas) JAMÁS se refiltra ni se vuelve a pedir cuando cambia
 * este selector (asimetría deliberada y ratificada, ver `DashboardHeatmap`
 * en `types/api.ts`). Trade-off aceptado: como el contrato no expone un
 * endpoint solo-heatmap, cada cambio de tecnología pide el
 * `DashboardResponse` completo y descarta todo excepto `.heatmap`
 * (`DashboardHeatmapFetch`).
 *
 * **Patrón anti-remount** (bug real ya vivido, FIX-RESET): el heatmap
 * PREVIO (prop o última respuesta filtrada válida) se conserva SIEMPRE
 * visible mientras el nuevo fetch está en vuelo (`Actualizando…`) o si
 * falla (aviso + Reintentar) — nunca se reemplaza por un esqueleto ni por
 * un estado vacío solo porque el filtro local está cargando/falló. Volver
 * a "Todas las tecnologías" no dispara una nueva petición: reutiliza la
 * prop original (misma data que ya tenía `DashboardView`).
 */
export function DashboardHeatmapCard({ heatmap: heatmapInicial }: DashboardHeatmapProps) {
  const router = useRouter();
  const [activa, setActiva] = useState<CeldaActiva | null>(null);
  const [seleccion, setSeleccion] = useState<string>(heatmapInicial.tecnologia_activa ?? TODAS_TECNOLOGIAS);

  const url = seleccion === TODAS_TECNOLOGIAS ? null : `/api/dashboard?tecnologia=${encodeURIComponent(seleccion)}`;
  const { data, error, loading, refetch } = useApi<DashboardHeatmapFetch>(url);

  /**
   * (R3-5) Heatmap efectivo calculado EN RENDER — antes era estado espejo
   * (`useState` + `useEffect` que copiaba `data`/`heatmapInicial` a
   * `heatmap`), lo que forzaba un render EXTRA por cada fetch (el efecto
   * corre DESPUÉS del commit). `heatmapValidoRef` guarda el ÚLTIMO heatmap
   * FILTRADO válido para el hueco entre "cambié de tecnología" y "la
   * respuesta llegó" (o si la respuesta falla) — MISMO comportamiento
   * anti-remount que antes (ver docstring de la card): "Todas las
   * tecnologías" siempre usa la prop directa; un filtro con `data` fresco
   * SE USA directo en este render y además queda guardado en el ref para
   * el próximo render que lo necesite de respaldo. Mutar el ref aquí es
   * seguro: no alimenta el cálculo de ESTE render (la rama `data` ya
   * devuelve `data.heatmap` directo) y es idempotente si React repite el
   * render (no produce un `setState`, así que no dispara renders nuevos).
   */
  const heatmapValidoRef = useRef<DashboardHeatmap>(heatmapInicial);
  const heatmap: DashboardHeatmap =
    seleccion === TODAS_TECNOLOGIAS ? heatmapInicial : data ? data.heatmap : heatmapValidoRef.current;
  if (seleccion !== TODAS_TECNOLOGIAS && data) {
    heatmapValidoRef.current = data.heatmap;
  }

  const actualizando = seleccion !== TODAS_TECNOLOGIAS && loading;
  const mostrarLeyenda = heatmap.total_marcas > 10;

  const porFilaColumna = new Map<string, number>();
  for (const c of heatmap.celdas) {
    porFilaColumna.set(`${c.fila}__${c.columna}`, c.valor);
  }

  function irACatalogo(fila: string, columna: string) {
    router.push("/catalogo?marca=" + encodeURIComponent(fila) + "&almacen=" + columna);
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <Grid3x3 className="h-[18px] w-[18px] text-brand" strokeWidth={1.8} aria-hidden="true" />
          <h2 className="text-[14.5px] font-semibold text-ink">Mapa de calor · marca × almacén</h2>
        </div>
        <div className="flex items-center gap-2">
          {actualizando && (
            <span aria-live="polite" className="text-[11px] text-ink-muted">
              Actualizando…
            </span>
          )}
          <SelectorTecnologia valor={seleccion} opciones={heatmap.tecnologias} onChange={setSeleccion} />
        </div>
      </div>
      <p className="mb-1 text-[11.5px] text-ink-muted">
        Piezas por ubicación; clic en una celda abre esa marca en el catálogo. El filtro de tecnología de arriba
        aplica solo a este mapa — el resto del tablero no cambia.
      </p>
      {mostrarLeyenda && (
        <p className="mb-2 text-[11px] text-ink-muted">Top 10 de {formatoNumero(heatmap.total_marcas)} marcas con stock</p>
      )}

      {error && (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-[8px] bg-warn-bg px-2.5 py-1.5 text-[11.5px] text-warn">
          <span>No se pudo aplicar el filtro de tecnología. Se sigue mostrando el resultado anterior.</span>
          <Button type="button" variant="outline" size="sm" onClick={refetch}>
            Reintentar
          </Button>
        </div>
      )}

      {heatmap.filas.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-ink-muted">Sin datos de marcas para mostrar.</p>
      ) : (
        <>
          <div className="overflow-x-auto pb-1">
            <div
              onMouseLeave={() => setActiva(null)}
              aria-busy={actualizando}
              className="grid min-w-[560px] items-center gap-[5px]"
              style={{ gridTemplateColumns: `120px repeat(${heatmap.columnas.length}, 1fr)` }}
            >
              <span aria-hidden="true" />
              {heatmap.columnas.map((columna) => (
                <span
                  key={columna}
                  // `--mx-muted` y no `--mx-muted-2`: estos rótulos SON los nombres de
                  // los almacenes, o sea el eje entero de la tarjeta, y a 2,56:1 eran
                  // el texto menos legible de la sección. Medido, no estimado.
                  className="text-center font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {columna}
                </span>
              ))}
              {heatmap.filas.map((fila) => (
                <FilaHeatmap
                  key={fila}
                  fila={fila}
                  columnas={heatmap.columnas}
                  porFilaColumna={porFilaColumna}
                  max={heatmap.max}
                  onHover={setActiva}
                  onClick={irACatalogo}
                />
              ))}
            </div>
          </div>
          {/* Sin `min-h-[20px]`: MEDIDO (D-0), la barra mide ≈35,25 px por su propio
              contenido —texto de 11,5 px + `py-2` + borde—, así que ese piso NO PODIA
              activarse nunca. Es P19 en su forma más callada: una afirmación falsa en
              el código que no cambia ningún render. Quitarla no mueve un pixel; dejarla
              decía que alguien había medido algo que nadie midió. */}
          <div className="mt-3 flex items-center gap-2 rounded-[9px] border border-line-soft bg-surface-input px-3 py-2 text-[11.5px] text-ink-2">
            <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-sm bg-brand" />
            {activa
              ? `${activa.fila} · ${activa.columna}: ${formatoNumero(activa.valor)} pzas`
              : "Pasa el cursor o navega con teclado por una celda para ver el detalle."}
          </div>
        </>
      )}
    </div>
  );
}
