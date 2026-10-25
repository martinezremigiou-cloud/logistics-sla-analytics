import { Radar as RadarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatoNumero } from "@/lib/formato";
import type { DashboardRadar, RadarEjes, RadarSerie } from "@/types/api";

export interface DashboardRadarProps {
  /**
   * El radar CON su denominador. [DASH-E · E-1]
   *
   * Recibe el objeto y no el arreglo a proposito: pegado al dato, `total_marcas` no
   * se puede perder en el camino. **E-1 entrega el campo; pintar «Top 3 de N marcas»
   * es trabajo de E-4** — este archivo solo se adapta al tipo para que el arbol
   * compile, sin hacer el trabajo visual de ese carril.
   */
  radar: DashboardRadar;
}

/**
 * Los 4 ejes fijos del contrato (`RadarEjes`), en el orden en que se dibujan
 * (arriba, sentido horario). `key: "en_aduana"` es el nombre del CAMPO del
 * contrato (`RadarEjes.en_aduana`, `types/api.ts`) y NO cambia — sólo su
 * `label` visible, «En camino» [FIX-B1 · T3], igual que el KPI homónimo del
 * tablero (`dashboard-kpis.tsx`).
 */
export const RADAR_EJES: ReadonlyArray<{ key: keyof RadarEjes; label: string }> = [
  { key: "disponible", label: "Disponible" },
  { key: "reservado", label: "Reservado" },
  { key: "en_aduana", label: "En camino" },
  { key: "en_riesgo", label: "En riesgo" },
];

export const RADAR_CX = 150;
export const RADAR_CY = 114;
export const RADAR_R = 78;

/** Ángulo (rad) del eje i-ésimo de n, empezando arriba (-90°) en sentido horario — misma fórmula que el blueprint (`rang`). */
export function anguloEje(i: number, n: number): number {
  return -Math.PI / 2 + i * ((2 * Math.PI) / n);
}

/** Punto sobre el eje i a una fracción `t` (0..1+) del radio — misma fórmula que `ptAt` del blueprint. */
export function puntoEnEje(i: number, n: number, t: number): [number, number] {
  const angulo = anguloEje(i, n);
  return [RADAR_CX + Math.cos(angulo) * RADAR_R * t, RADAR_CY + Math.sin(angulo) * RADAR_R * t];
}

function formatoPuntos(puntos: Array<[number, number]>): string {
  return puntos.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** 4 anillos concéntricos de la rejilla (t=0.25/0.5/0.75/1), listos para `<polygon points>` — misma fórmula que `radarGrid` del blueprint. */
export function rejillaRadar(): string[] {
  const n = RADAR_EJES.length;
  return [0.25, 0.5, 0.75, 1].map((t) => formatoPuntos(RADAR_EJES.map((_, i) => puntoEnEje(i, n, t))));
}

export interface EjeLinea {
  label: string;
  x2: number;
  y2: number;
}

/** Las 4 líneas del centro a cada eje (t=1) — misma fórmula que `radarAxes` del blueprint. */
export function ejesRadar(): EjeLinea[] {
  const n = RADAR_EJES.length;
  return RADAR_EJES.map((eje, i) => {
    const [x2, y2] = puntoEnEje(i, n, 1);
    return { label: eje.label, x2, y2 };
  });
}

/** Colores de serie en orden fijo: brand azul, violeta nuevo, `--mx-good` — SIEMPRE vía `var(--mx-*)` (ver docstring de `DashboardRadarCard`). */
export const RADAR_COLORES = ["var(--mx-accent)", "var(--mx-graf-violeta)", "var(--mx-good)"];

export interface RadarSeriePuntos {
  marca: string;
  color: string;
  puntos: string;
}

/**
 * Normaliza CADA EJE contra el máximo de ESE eje entre todas las series —
 * no contra el total de la propia serie (a diferencia del blueprint
 * original, que dividía cada serie entre la suma de sus propios 4 ejes).
 * Con datos reales los 4 ejes de `RadarEjes`
 * viven en escalas distintas (p.ej. `disponible` en miles, `en_riesgo`
 * normalmente mucho más chico); normalizar por serie aplastaría los ejes
 * chicos de una marca contra los grandes de esa MISMA marca. Normalizar
 * por eje responde "¿qué tan grande es este número frente a esa misma
 * métrica en las otras marcas?", la lectura útil de un radar comparativo.
 * `Math.max(0.04, t)` (igual que el blueprint) evita que un eje en 0
 * colapse el punto sobre el centro (quedaría invisible / rompería el polígono).
 */
/**
 * El valor crudo con su signo EXPLICITO. Un `-8` y un `+3` no se pueden confundir, y
 * un `0` no lleva signo porque no lo tiene. Usa el menos tipografico (U+2212), que es
 * el que el resto del portal ya usa en `DeltaChip`.
 */
export function conSigno(valor: number): string {
  if (valor === 0) return "0";
  return `${valor > 0 ? "+" : "−"}${formatoNumero(Math.abs(valor))}`;
}

export function construirSeriesRadar(series: RadarSerie[]): RadarSeriePuntos[] {
  const n = RADAR_EJES.length;
  // Recorte DEFENSIVO antes de asignar color. El color se reparte con
  // `idx % RADAR_COLORES.length`, asi que una 4.a marca reusaria el color de la 1.a
  // y dos marcas DISTINTAS se verian como la MISMA serie — el grafico mentiria sin
  // que nada fallara. El servicio ya entrega top-3; esto cierra el otro extremo.
  const acotadas = series.slice(0, RADAR_COLORES.length);
  const maxPorEje = RADAR_EJES.map(({ key }) => Math.max(1, ...acotadas.map((s) => s.ejes[key])));

  return acotadas.map((serie, idx) => {
    const puntos = RADAR_EJES.map((eje, i) => {
      const valor = serie.ejes[eje.key];
      const t = Math.max(0.04, valor / maxPorEje[i]);
      return puntoEnEje(i, n, t);
    });
    return { marca: serie.marca, color: RADAR_COLORES[idx % RADAR_COLORES.length], puntos: formatoPuntos(puntos) };
  });
}

/** Posición absoluta de cada label de eje sobre el SVG (arriba/derecha/abajo/izquierda) — fijas porque `RADAR_EJES` siempre tiene 4 ejes en ese orden. */
const POSICION_LABEL = [
  "left-1/2 top-0 -translate-x-1/2",
  "right-0 top-1/2 -translate-y-1/2 text-right",
  "left-1/2 bottom-0 -translate-x-1/2",
  "left-0 top-1/2 -translate-y-1/2",
];

/**
 * Radar "Perfil por marca" (top-3 marcas dinámicas). SVG propio — porta la
 * trigonometría del polígono/rejilla del blueprint (ver funciones puras de
 * arriba); la normalización por eje es una decisión nueva (ver
 * `construirSeriesRadar`). Colores de serie SIEMPRE vía `style` con
 * `var(--mx-*)` (nunca hex/Tailwind en los atributos del SVG) para que
 * resuelvan correctamente en dark mode.
 */
export function DashboardRadarCard({ radar }: DashboardRadarProps) {
  const series = construirSeriesRadar(radar.series);

  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-1 flex items-center gap-2.5">
        <RadarIcon className="h-[18px] w-[18px]" style={{ color: "var(--mx-graf-violeta)" }} strokeWidth={1.8} aria-hidden="true" />
        <h2 className="text-[14.5px] font-semibold text-ink">Perfil por marca</h2>
      </div>
      <p className="mb-1 text-[11.5px] text-ink-muted">Disponible · reservado · en camino · en riesgo, por marca.</p>
      {/* El MISMO molde que el heatmap (`Top 10 de N marcas con stock`), no uno nuevo:
          dos secciones vecinas con el mismo tipo de corte tienen que confesarlo igual.
          El umbral es «hay mas de las que dibujo», no un numero duro. */}
      {!Number.isFinite(radar.total_marcas) ? (
        // Un denominador ausente NO es «no hay corte»: son dos diagnosticos opuestos
        // y con un solo camino se leen igual. `tsc` ya impide que el campo falte, pero
        // la superficie no puede depender SOLO de eso — si un dia el DTO llega mal
        // formado desde la red, callarse seria afirmar que se dibujan todas.
        <p className="mb-2 text-[11px] text-ink-muted">
          Top {radar.series.length} · no se puede confesar el corte: el total de marcas no viene en el dato
        </p>
      ) : radar.total_marcas > radar.series.length ? (
        <p className="mb-2 text-[11px] text-ink-muted">
          Top {radar.series.length} de {formatoNumero(radar.total_marcas)} marcas con stock
        </p>
      ) : null}

      {radar.series.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-ink-muted">Sin datos de marcas.</p>
      ) : (
        <>
          <div className="relative mx-auto mt-3 w-full">
            <svg viewBox="0 0 300 228" className="block h-auto w-full" role="img" aria-label="Radar de disponible, reservado, en camino y en riesgo por marca">
              {rejillaRadar().map((puntos, i) => (
                <polygon key={i} points={puntos} style={{ fill: "none", stroke: "var(--mx-border-soft)" }} strokeWidth={1} />
              ))}
              {ejesRadar().map((eje) => (
                <line
                  key={eje.label}
                  x1={RADAR_CX}
                  y1={RADAR_CY}
                  x2={eje.x2}
                  y2={eje.y2}
                  style={{ stroke: "var(--mx-border)" }}
                  strokeWidth={1}
                />
              ))}
              {series.map((s) => (
                <polygon
                  key={s.marca}
                  points={s.puntos}
                  style={{ fill: s.color, fillOpacity: 0.12, stroke: s.color, strokeWidth: 2 }}
                  strokeLinejoin="round"
                />
              ))}
            </svg>
            {RADAR_EJES.map((eje, i) => (
              <span
                key={eje.key}
                aria-hidden="true"
                className={cn("absolute whitespace-nowrap text-[10px] font-bold text-ink-muted", POSICION_LABEL[i])}
              >
                {eje.label}
              </span>
            ))}
          </div>
          <div data-leyenda-radar="" className="mt-2.5 flex flex-wrap justify-center gap-3.5">
            {series.map((s) => (
              <span key={s.marca} className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.marca}
              </span>
            ))}
          </div>

          {/* D-RAD-SIGNO. `disponible` puede ser NEGATIVO, y la normalizacion usa
              `Math.max(0.04, …)`: un negativo y un casi-cero positivo caen al MISMO
              piso visual y se DIBUJAN IGUAL. El dato crudo ya viaja en `RadarSerie.ejes`,
              asi que la salida es texto real fuera del SVG — sin tocar la formula y sin
              pedirle nada al servicio. Lo que el dibujo no puede decir, lo dice la tabla. */}
          <div data-valores-radar="" className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="pb-1 text-left font-semibold text-ink-muted">Marca</th>
                  {RADAR_EJES.map((eje) => (
                    <th key={eje.key} className="pb-1 pl-2 text-right font-semibold text-ink-muted">
                      {eje.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {radar.series.slice(0, RADAR_COLORES.length).map((s) => (
                  <tr key={s.marca}>
                    <td className="truncate py-0.5 pr-2 font-semibold text-ink-2">{s.marca}</td>
                    {RADAR_EJES.map((eje) => (
                      <td key={eje.key} className="py-0.5 pl-2 text-right font-mono tabular-nums text-ink-2">
                        {conSigno(s.ejes[eje.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
