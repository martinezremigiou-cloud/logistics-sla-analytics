import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { RankingItem } from "@/types/api";
import {
  DashboardTopSobreReservadosCard,
  faltanteListado,
  subtituloDeTotales,
} from "./dashboard-top-sobre-reservados";

function item(overrides: Partial<RankingItem> = {}): RankingItem {
  return { sku: "A-1", descripcion: "Candado industrial", marca: "BRAND1", disponible: -12, reservado: 40, total: 28, ...overrides };
}

/**
 * Los diez de la tarjeta, con datos INVENTADOS. El universo son **27** SKU
 * sobre-reservados (`kpis.sobre_reservados.valor`), no diez — que es justo lo que
 * obliga a que el subtítulo nombre sus dos poblaciones.
 */
const DIEZ: RankingItem[] = [
  { sku: "AB100-X", descripcion: "ARTICULO DEMO B", marca: "NACIONAL", disponible: -1380, reservado: 5900, total: 4520 },
  { sku: "AC200-Q", descripcion: "ARTICULO DEMO C", marca: "NACIONAL", disponible: -565, reservado: 1630, total: 1065 },
  { sku: "AD300-R", descripcion: "ARTICULO DEMO D", marca: "BRAND1", disponible: -118, reservado: 420, total: 302 },
  { sku: "AE400-A", descripcion: "ARTICULO DEMO E", marca: "BRAND1", disponible: -93, reservado: 260, total: 167 },
  { sku: "AF500-GL", descripcion: "ARTICULO DEMO F", marca: "BRAND1", disponible: -61, reservado: 1850, total: 1789 },
  { sku: "AG600", descripcion: "ARTICULO DEMO G", marca: "BRAND1", disponible: -47, reservado: 175, total: 128 },
  { sku: "AH700", descripcion: "ARTICULO DEMO H", marca: "BRAND1", disponible: -42, reservado: 995, total: 953 },
  { sku: "AJ800-W", descripcion: "ARTICULO DEMO I", marca: "BRAND1", disponible: -42, reservado: 310, total: 268 },
  { sku: "AK900", descripcion: "ARTICULO DEMO J", marca: "BRAND1", disponible: -33, reservado: 72, total: 39 },
  { sku: "AL110", descripcion: "ARTICULO DEMO K", marca: "BRAND1", disponible: -29, reservado: 105, total: 76 },
];
const UNIVERSO = 27;

describe("faltanteListado (pura) — [DASH-F · D-4]", () => {
  it("suma el faltante de los ítems LISTADOS, no del universo", () => {
    // 2 410 piezas en los diez de la tarjeta (suma del faltante de cada ítem).
    expect(faltanteListado(DIEZ)).toBe(2410);
  });

  it("un ítem que NO esté sobre-reservado no resta del total", () => {
    // Si algún día entrara un `disponible >= 0`, restarlo diría que ese SKU APORTA
    // piezas al faltante, que es lo contrario de lo que pasa.
    expect(faltanteListado([item({ disponible: -10 }), item({ sku: "B", disponible: 5 })])).toBe(10);
  });

  it("lista vacía → 0", () => {
    expect(faltanteListado([])).toBe(0);
  });
});

describe("subtituloDeTotales (pura) — [DASH-F · D-4] las DOS poblaciones, nombradas", () => {
  it("con el dato real dice de cuántos son los diez Y sobre cuántos suma las piezas", () => {
    // El gate: nunca una cifra sin decir sobre qué población. Aquí
    // son dos poblaciones distintas —27 SKU en el universo, 10 en la lista— y las
    // piezas solo se pueden sumar sobre la segunda.
    expect(subtituloDeTotales(DIEZ, UNIVERSO)).toBe("10 de 27 SKU · faltan 2,410 piezas en estos 10");
  });

  it("cuando la lista ES el universo, la fracción sobra y no se escribe", () => {
    // «10 de 10» invita a buscar un recorte que no existe.
    expect(subtituloDeTotales(DIEZ, 10)).toBe("10 SKU · faltan 2,410 piezas");
    expect(subtituloDeTotales(DIEZ, 3)).toBe("10 SKU · faltan 2,410 piezas");
  });

  it("sin ítems no hay subtítulo: el estado vacío ya lo dice todo", () => {
    expect(subtituloDeTotales([], 27)).toBeNull();
  });
});

describe("DashboardTopSobreReservadosCard", () => {
  it("header: link 'Ver catálogo →' apunta a /catalogo?badge=sobre_reservado", () => {
    render(<DashboardTopSobreReservadosCard items={[]} universo={0} />);
    expect(screen.getByRole("link", { name: /Ver catálogo/ })).toHaveAttribute("href", "/catalogo?badge=sobre_reservado");
  });

  it("[] → 'Sin SKUs sobre-reservados — todo en orden.' y sin subtítulo", () => {
    render(<DashboardTopSobreReservadosCard items={[]} universo={27} />);
    expect(screen.getByText("Sin SKUs sobre-reservados — todo en orden.")).toBeInTheDocument();
    expect(screen.queryByText(/faltan/)).not.toBeInTheDocument();
    // Y sin ítems no hay tabla: no se pinta un encabezado sobre nada.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("cada fila: sku enlaza a /catalogo/{sku}, descripción, disponible en tono warn (nunca rojo), reservado y total", () => {
    const { container } = render(
      <DashboardTopSobreReservadosCard items={[item({ sku: "A-1/B", disponible: -12, reservado: 40, total: 28 })]} universo={27} />,
    );

    const link = screen.getByRole("link", { name: "A-1/B" });
    expect(link).toHaveAttribute("href", "/catalogo/A-1%2FB");
    expect(screen.getByText("Candado industrial")).toBeInTheDocument();
    expect(screen.getByText("-12")).toHaveClass("text-warn");
    // [DASH-F · D-4c] El par ya no es UN texto plano: son dos cifras distinguibles.
    expect(container.querySelector("[data-reservado]")).toHaveTextContent("40");
    expect(container.querySelector("[data-total]")).toHaveTextContent("28");
  });

  it("descripción null → '—'", () => {
    render(<DashboardTopSobreReservadosCard items={[item({ descripcion: null })]} universo={27} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

/**
 * [DASH-F · D-4] El defecto que se vio mirando:
 * `PAR-SIN-ETIQUETA-SE-LEE-COMO-PARTE-SOBRE-TODO`.
 *
 * `5,900 / 4,520` se lee por convención como *parte sobre todo*, y aquí el mayor va
 * primero. La forma contradice la lectura habitual, y las tres cifras del renglón no
 * decían ninguna qué eran.
 */
describe("DashboardTopSobreReservadosCard · los encabezados de columna", () => {
  it("las tres columnas están rotuladas, y son ENCABEZADOS de verdad", () => {
    render(<DashboardTopSobreReservadosCard items={DIEZ} universo={UNIVERSO} />);
    const cabeceras = screen.getAllByRole("columnheader");
    expect(cabeceras.map((c) => c.textContent)).toEqual(["Faltante", "SKU", "Reservado / Total"]);
  });

  it("cada encabezado declara `scope=col`: sin eso un lector de pantalla no ata la celda a su rótulo", () => {
    // Es la mitad del arreglo que no se ve. La pregunta acordada —«¿se
    // entiende qué es cada número sin preguntarlo?»— también se la hace quien no ve
    // la tabla, y para ése el encabezado visual no existe.
    render(<DashboardTopSobreReservadosCard items={DIEZ} universo={UNIVERSO} />);
    for (const c of screen.getAllByRole("columnheader")) {
      expect(c).toHaveAttribute("scope", "col");
    }
  });

  it("una fila de encabezado y DIEZ de datos: el encabezado no se cuenta como SKU", () => {
    render(<DashboardTopSobreReservadosCard items={DIEZ} universo={UNIVERSO} />);
    expect(screen.getAllByRole("row")).toHaveLength(DIEZ.length + 1);
    // Los diez SKU siguen ahí: el encabezado se paga con altura, no con filas.
    for (const i of DIEZ) expect(screen.getByRole("link", { name: i.sku })).toBeInTheDocument();
  });

  it("el orden de las columnas es el de las cifras del renglón, no otro", () => {
    // Un encabezado que rotula la columna equivocada es peor que no tener ninguno.
    render(<DashboardTopSobreReservadosCard items={[item({ disponible: -12, reservado: 40, total: 28 })]} universo={27} />);
    const filas = screen.getAllByRole("row");
    const celdas = within(filas[1]).getAllByRole("cell");
    expect(celdas[0]).toHaveTextContent("-12");
    expect(celdas[1]).toHaveTextContent("A-1");
    expect(celdas[2]).toHaveTextContent("40 / 28");
  });

  it("el ámbar del faltante conserva su ventaja de TAMAÑO y PESO sobre el par", () => {
    // Esto NO mide «lo que más salta» —eso se juzga mirando, y medirlo con la
    // razón de contraste sería usar el instrumento de al lado (P27)—. Mide lo
    // objetivo: que al darle peso al reservado no se le haya quitado la ventaja al
    // chip. El chip va a 12,5 px en negrita sobre un relleno; el reservado, a 11 px
    // semibold sin relleno.
    const { container } = render(<DashboardTopSobreReservadosCard items={[item()]} universo={27} />);
    const chip = screen.getByText("-12");
    const reservado = container.querySelector("[data-reservado]") as HTMLElement;

    expect(chip.className).toContain("text-[12.5px]");
    expect(chip.className).toContain("font-bold");
    expect(chip.className).toContain("bg-warn-bg");

    expect(reservado.className).toContain("font-semibold");
    expect(reservado.className).not.toContain("font-bold");
    // Y el par entero vive a 11 px, en la celda.
    expect((reservado.closest("td") as HTMLElement).className).toContain("text-[11px]");
    expect(reservado.className).not.toContain("bg-");
  });
});
