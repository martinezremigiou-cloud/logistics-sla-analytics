import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RadarSerie } from "@/types/api";
import { contrasteEntreClases, hojasDeTexto, tintaHeredada, TEMAS } from "./contraste.testutil";
import {
  DashboardRadarCard,
  RADAR_COLORES,
  anguloEje,
  construirSeriesRadar,
  ejesRadar,
  puntoEnEje,
  rejillaRadar,
} from "./dashboard-radar";

function serie(marca: string, ejes: Partial<RadarSerie["ejes"]> = {}): RadarSerie {
  return { marca, ejes: { disponible: 0, reservado: 0, en_aduana: 0, en_riesgo: 0, ...ejes } };
}

describe("geometría del radar (pura)", () => {
  it("anguloEje: eje 0 apunta arriba (-90°), luego avanza en sentido horario", () => {
    expect(anguloEje(0, 4)).toBeCloseTo(-Math.PI / 2);
    expect(anguloEje(1, 4)).toBeCloseTo(0);
    expect(anguloEje(2, 4)).toBeCloseTo(Math.PI / 2);
    expect(anguloEje(3, 4)).toBeCloseTo(Math.PI);
  });

  it("puntoEnEje: t=1 en el eje 0 llega al radio completo hacia arriba del centro", () => {
    const [x, y] = puntoEnEje(0, 4, 1);
    expect(x).toBeCloseTo(150);
    expect(y).toBeCloseTo(36); // 114 - 78
  });

  it("rejillaRadar: 4 anillos concéntricos, cada uno con los 4 puntos de los ejes", () => {
    const anillos = rejillaRadar();
    expect(anillos).toHaveLength(4);
    for (const anillo of anillos) {
      expect(anillo.split(" ")).toHaveLength(4);
    }
    // El anillo t=1 coincide con el punto de radio completo del eje 0.
    expect(anillos[3]).toContain("150.0,36.0");
  });

  it("ejesRadar: 4 líneas, con las etiquetas fijas del contrato en orden", () => {
    const ejes = ejesRadar();
    expect(ejes.map((e) => e.label)).toEqual(["Disponible", "Reservado", "En camino", "En riesgo"]);
    expect(ejes[0]).toMatchObject({ x2: 150, y2: 36 });
  });

  it("construirSeriesRadar: normaliza CADA EJE contra el máximo de ESE eje entre series (no contra el total de cada serie)", () => {
    // A domina en 'disponible' pero es chica en 'en_riesgo'; B es lo inverso.
    // Si se normalizara por el TOTAL de cada serie (como el blueprint original),
    // ambas quedarían con perfiles parecidos; normalizando por eje, cada una
    // debe tocar el radio completo exactamente en SU eje fuerte.
    const a = serie("A", { disponible: 100, en_riesgo: 10 });
    const b = serie("B", { disponible: 10, en_riesgo: 100 });
    const [sa, sb] = construirSeriesRadar([a, b]);

    // Eje 'disponible' (i=0): A toca el radio completo (150,36); B queda cerca del centro.
    expect(sa.puntos.startsWith("150.0,36.0")).toBe(true);
    expect(sb.puntos.startsWith("150.0,106.2")).toBe(true);

    // Eje 'en_riesgo' (i=3, último punto): B toca el radio completo (72,114); A queda cerca del centro.
    expect(sa.puntos.endsWith("142.2,114.0")).toBe(true);
    expect(sb.puntos.endsWith("72.0,114.0")).toBe(true);
  });

  it("construirSeriesRadar: asigna los colores en orden fijo (brand, violeta nuevo, --mx-good)", () => {
    const series = construirSeriesRadar([serie("BRAND1"), serie("SERIES5"), serie("EAS")]);
    expect(series.map((s) => s.color)).toEqual(RADAR_COLORES);
  });

  it("construirSeriesRadar: un eje en 0 en TODAS las series no colapsa el punto exactamente sobre el centro", () => {
    const [sa] = construirSeriesRadar([serie("A")]);
    // Todos los ejes en 0 → t=0.04 en los 4 ejes, ningún punto es (150,114) (el centro exacto).
    expect(sa.puntos).not.toContain("150.0,114.0");
  });
});

describe("DashboardRadarCard", () => {
  it("radar vacío ([]): texto muted, sin el SVG del chart (el ícono del header, aria-hidden, no cuenta)", () => {
    render(<DashboardRadarCard radar={{ series: [], total_marcas: 0 }} />);
    expect(screen.getByText("Sin datos de marcas.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Radar de disponible/ })).not.toBeInTheDocument();
  });

  it("3 series: leyenda con las 3 marcas y 3 polígonos de serie", () => {
    const radar: RadarSerie[] = [
      serie("BRAND1", { disponible: 100, reservado: 20, en_aduana: 10, en_riesgo: 0 }),
      serie("SERIES5", { disponible: 50, reservado: 10, en_aduana: 5, en_riesgo: 3 }),
      serie("EAS", { disponible: 30, reservado: 5, en_aduana: 2, en_riesgo: 1 }),
    ];
    // 3 de 7: hay corte. El denominador ya viaja; confesarlo es trabajo de E-4.
    const { container } = render(<DashboardRadarCard radar={{ series: radar, total_marcas: 7 }} />);
    // Acotado a la LEYENDA: desde E-4 la marca aparece tambien en la tabla de valores
    // crudos, asi que `screen.getByText` es ambiguo. La ambiguedad es informacion:
    // el nombre viaja por dos superficies distintas a proposito.
    const leyenda = container.querySelector("[data-leyenda-radar]") as HTMLElement;
    expect(within(leyenda).getByText("BRAND1")).toBeInTheDocument();
    expect(within(leyenda).getByText("SERIES5")).toBeInTheDocument();
    expect(within(leyenda).getByText("EAS")).toBeInTheDocument();
  });

  it("colores de serie SIEMPRE vía var(--mx-*) en `style` — jamás hex literal en los polígonos", () => {
    const radar: RadarSerie[] = [serie("BRAND1", { disponible: 10 }), serie("SERIES5", { disponible: 5 })];
    render(<DashboardRadarCard radar={{ series: radar, total_marcas: 2 }} />);
    const svg = screen.getByRole("img", { name: /Radar de disponible/ });
    expect(svg.innerHTML).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(svg.innerHTML).toContain("var(--mx-accent)");
    expect(svg.innerHTML).toContain("var(--mx-graf-violeta)");
  });
});

/**
 * La puerta de E-4.
 *
 * El radar recorta a 3 marcas. El heatmap de al lado confiesa su corte —«Top 10 de
 * N marcas con stock»— y el radar no decía nada: tres marcas dibujadas y ninguna
 * pista de si detrás había 3 o 300. El cambio previo entregó el denominador en el DTO;
 * **esto es la mitad que lo pinta**, y hasta que existiera, el dato viajaba sin que
 * nadie lo mirara — que es exactamente la forma de un campo que se ignora.
 */
describe("DashboardRadarCard · E-4 · el corte se confiesa, y los valores se pueden leer", () => {
  const conDenominador = (total: number) => ({
    series: [
      serie("BRAND1", { disponible: 100, reservado: 20, en_aduana: 10, en_riesgo: 0 }),
      serie("SERIES5", { disponible: 50, reservado: 10, en_aduana: 5, en_riesgo: 3 }),
      serie("EAS", { disponible: -8, reservado: 5, en_aduana: 2, en_riesgo: 8 }),
    ],
    total_marcas: total,
  });

  it("dice «Top 3 de N marcas» cuando hay corte, con el MISMO molde que el heatmap", () => {
    render(<DashboardRadarCard radar={conDenominador(17)} />);
    expect(screen.getByText("Top 3 de 17 marcas con stock")).toBeInTheDocument();
  });

  // Las dos orillas del umbral, no solo una (P17): anunciar un corte que no existe
  // es tan falso como callar uno que sí.
  it("NO dice nada cuando no hay corte — el umbral es «hay más de las que dibujo»", () => {
    render(<DashboardRadarCard radar={conDenominador(3)} />);
    expect(screen.queryByText(/Top 3 de .* marcas/)).not.toBeInTheDocument();
  });

  // CONTROL POSITIVO que se pidió, literal: un DTO sin `total_marcas` tiene que
  // enrojecer la prueba DEL COMPONENTE, no solo la del servicio. Sin esto, el campo
  // podría desaparecer del contrato y el componente callar sin que nadie lo note.
  it("CONTROL POSITIVO · sin `total_marcas` el componente no puede fingir que no hay corte", () => {
    const sinCampo = { series: conDenominador(17).series } as unknown as Parameters<typeof DashboardRadarCard>[0]["radar"];
    render(<DashboardRadarCard radar={sinCampo} />);
    expect(screen.getByText(/Top 3 de .* marcas con stock|no se puede confesar el corte/)).toBeInTheDocument();
  });

  // D-RAD-SIGNO: `disponible` puede ser NEGATIVO, y `Math.max(0.04, …)` hace que un
  // negativo y un casi-cero positivo caigan al MISMO piso visual — se dibujan igual.
  // El texto real con signo lo resuelve sin tocar la fórmula ni pedirle nada al
  // servicio: el dato crudo ya viaja en `RadarSerie.ejes`.
  it("los 4 valores crudos de cada marca son TEXTO REAL con signo, fuera del SVG", () => {
    const { container } = render(<DashboardRadarCard radar={conDenominador(17)} />);
    const fuera = container.querySelector('[data-valores-radar]') as HTMLElement;

    expect(fuera).toBeInTheDocument();
    expect(fuera.closest("svg")).toBeNull(); // fuera del dibujo: legible y seleccionable
    expect(within(fuera).getByText("−8")).toBeInTheDocument(); // el negativo, con su signo
    expect(within(fuera).getByText("+100")).toBeInTheDocument();
    expect(within(fuera).getByText("+3")).toBeInTheDocument();
  });

  // (a) del invariante: hoy el color se asigna con `idx % length` SIN recortar antes,
  // así que una 4.ª marca haría que dos marcas distintas se vean como la MISMA serie.
  it("CONTROL POSITIVO · una 4.ª marca no puede repetir color: se recorta antes de asignar", () => {
    const cuatro = [
      serie("A", { disponible: 10 }),
      serie("B", { disponible: 9 }),
      serie("C", { disponible: 8 }),
      serie("D", { disponible: 7 }),
    ];
    const puntos = construirSeriesRadar(cuatro);

    expect(puntos).toHaveLength(RADAR_COLORES.length);
    expect(new Set(puntos.map((p) => p.color)).size).toBe(puntos.length);
  });

  it("el gráfico usa el ancho que le dan: sin tope de 300 px", () => {
    const { container } = render(<DashboardRadarCard radar={conDenominador(17)} />);
    const caja = container.querySelector("svg[role='img']")?.parentElement as HTMLElement;
    expect(caja.className).not.toContain("max-w-[300px]");
    expect(caja.className).toContain("w-full");
  });

  it("todo texto de la tarjeta cumple 4,5:1 contra su superficie, en los dos temas", () => {
    const { container } = render(<DashboardRadarCard radar={conDenominador(17)} />);
    const tintas = new Set<string>();
    for (const el of hojasDeTexto(container)) {
      const tinta = tintaHeredada(el, container);
      if (!tinta) continue; // los rótulos de eje van sobre el dibujo y se miden aparte
      tintas.add(tinta);
    }
    expect(tintas.size).toBeGreaterThan(0);
    for (const tinta of Array.from(tintas)) {
      for (const tema of TEMAS) {
        const razon = contrasteEntreClases(tinta, "bg-surface", tema);
        expect(razon, `${tinta} en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
