import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CatalogoGrid } from "./catalogo-grid";
import { separarFamilias } from "@/lib/familias";
import type { CatalogoItem } from "@/types/api";

const FIXTURES: CatalogoItem[] = [
  {
    sku: "A-1",
    marca: "BRAND1",
    familia: "CANDADOS",
    familias: separarFamilias("CANDADOS"),
    descripcion: "Candado industrial",
    total: 10,
    reservado: 2,
    disponible: 8,
    badges: [],
  },
  {
    sku: "B/2",
    marca: "EAS",
    familia: null,
    familias: separarFamilias(null),
    descripcion: null,
    total: 0,
    reservado: 0,
    disponible: 0,
    badges: ["stock_cero", "sin_familia"],
  },
];

describe("CatalogoGrid", () => {
  it("renderiza una card por item con SKU, descripción (o '—') y disponible formateado", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);

    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.getByText("Candado industrial")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("cada card es un link a /catalogo/{sku} con encodeURIComponent", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);
    const link = screen.getByRole("link", { name: /B\/2/ });
    expect(link).toHaveAttribute("href", "/catalogo/B%2F2");
  });

  it("no incluye la etiqueta 'propuesto' (ribbon retirado)", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);
    expect(screen.queryByText(/propuesto/i)).not.toBeInTheDocument();
  });

  it("muestra el estatus por card (EstatusPill)", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);
    expect(screen.getByText("Disponible")).toBeInTheDocument();
    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  it("sin imagen_url: muestra el placeholder Package (ningún <img>)", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("con imagen_url: renderiza <img> con alt 'Imagen de producto {sku}'", () => {
    render(
      <CatalogoGrid
        items={[{ ...FIXTURES[0], imagen_url: "http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes/a1.png" }]}
        ariaBusy={false}
      />,
    );
    expect(screen.getByRole("img", { name: "Imagen de producto A-1" })).toBeInTheDocument();
  });

  it("item con color: dot 8px con el token --mx-tag-{color} + sr-only 'Color: {label}.' antes del SKU", () => {
    render(<CatalogoGrid items={[{ ...FIXTURES[0], color: "rosa" }]} ariaBusy={false} />);
    const srOnly = screen.getByText("Color: Rosa.", { exact: false });
    expect(srOnly).toHaveClass("sr-only");
    const chip = srOnly.parentElement as HTMLElement;
    const dot = chip.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain("bg-[var(--mx-tag-rosa)]");
    expect(chip).toHaveTextContent("A-1");
  });

  it("item sin color: no renderiza dot ni sr-only", () => {
    render(<CatalogoGrid items={[{ ...FIXTURES[0], color: null }]} ariaBusy={false} />);
    expect(screen.queryByText(/^Color:/)).not.toBeInTheDocument();
    const sku = screen.getByText("A-1");
    expect(sku.querySelector('span[aria-hidden="true"]')).toBeNull();
  });
});

// ------------------------------------------------------------
// Cierre de R1-1: `ariaBusy` propaga `aria-busy` al contenedor del grid
// (UNA sola marca para todas las tarjetas, no una por tarjeta) — mismo
// criterio que `CatalogoTabla`/`EmbarquesTabla`. Antes de este fix,
// `CatalogoGridProps` no tenía `ariaBusy`: un refetch en vista Grid no
// anunciaba nada a un lector de pantalla, a diferencia de la vista Lista.
// ------------------------------------------------------------
describe("CatalogoGrid — ariaBusy (cierre de R1-1)", () => {
  it("ariaBusy propaga aria-busy al contenedor del grid (mismo nodo que envuelve todas las tarjetas)", () => {
    const { rerender } = render(<CatalogoGrid items={FIXTURES} ariaBusy={false} />);
    // [INV-B8.2] `closest` y no `parentElement`: la tarjeta ganó un envoltorio
    // (el `<Link>` ya no puede ser el nodo raíz — el botón de Selección va
    // FUERA del ancla, porque un `<button>` anidado en un `<a>` es HTML
    // inválido). Lo que esta prueba afirma —una sola marca, en el contenedor
    // que envuelve TODAS las tarjetas— no depende de cuántos niveles haya en
    // medio; anclarla al padre directo la ataba a un detalle de maquetación.
    const contenedor = screen.getByRole("link", { name: /A-1/ }).closest("[aria-busy]") as HTMLElement;
    expect(contenedor).toHaveAttribute("aria-busy", "false");

    rerender(<CatalogoGrid items={FIXTURES} ariaBusy={true} />);
    expect(contenedor).toHaveAttribute("aria-busy", "true");
  });

  it("aria-busy se marca UNA sola vez en el contenedor, no una por tarjeta", () => {
    render(<CatalogoGrid items={FIXTURES} ariaBusy={true} />);
    // Ambas tarjetas cuelgan del MISMO contenedor marcado — no hay un
    // `aria-busy` propio por `<Link>` de tarjeta.
    const contenedorA = screen.getByRole("link", { name: /A-1/ }).closest("[aria-busy]");
    const contenedorB = screen.getByRole("link", { name: /B\/2/ }).closest("[aria-busy]");
    expect(contenedorA).toBe(contenedorB);
    // Y sigue siendo UNA sola marca en todo el árbol, no una por tarjeta.
    expect(document.querySelectorAll("[aria-busy]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /A-1/ })).not.toHaveAttribute("aria-busy");
  });
});

// ------------------------------------------------------------
// INV-TAXO F2 · A3: celda de familia expandible "primera +N" en la card
// (antes la card no mostraba familia en absoluto). Primario SIEMPRE
// `item.familias` — `item.familia` (crudo) está prohibido para esto.
// ------------------------------------------------------------
describe("CatalogoGrid — familias multi-valor (A3)", () => {
  const MULTI: CatalogoItem = {
    sku: "CLP-9001",
    marca: "CLIP",
    familia: "SERIES 12 / CLIP 3.0 / CLIP ROTATIVO",
    familias: separarFamilias("SERIES 12 / CLIP 3.0 / CLIP ROTATIVO"),
    descripcion: "Series20 multi-familia",
    total: 20,
    reservado: 0,
    disponible: 20,
    badges: [],
  };

  it("una sola familia: se muestra tal cual (sin '+N')", () => {
    render(<CatalogoGrid items={[FIXTURES[0]]} ariaBusy={false} />);
    expect(screen.getByText("CANDADOS")).toBeInTheDocument();
  });

  it("sin familia (familias=[]): chip 'Sin familia'", () => {
    render(<CatalogoGrid items={[FIXTURES[1]]} ariaBusy={false} />);
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
  });

  it("N>1 familias: colapsado muestra 'primera +N' y expandir revela el resto", () => {
    render(<CatalogoGrid items={[MULTI]} ariaBusy={false} />);
    expect(screen.getByText("SERIES 12 +2")).toBeInTheDocument();
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SERIES 12 y 2 familias más" }));
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
  });

  it("el trigger de familias previene el default del click (no dispara la navegación del <a> que envuelve la card)", () => {
    render(<CatalogoGrid items={[MULTI]} ariaBusy={false} />);
    // `fireEvent.click` regresa el resultado de `dispatchEvent`: `false` si
    // algún handler llamó `preventDefault()` — así confirmamos que el click
    // en el trigger NUNCA activa la navegación del <a> ancestro de la card.
    const noCancelado = fireEvent.click(screen.getByRole("button", { name: "SERIES 12 y 2 familias más" }));
    expect(noCancelado).toBe(false);
  });
});
