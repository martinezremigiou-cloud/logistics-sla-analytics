import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { CatalogoTabla } from "./catalogo-tabla";
import { separarFamilias } from "@/lib/familias";
import type { CatalogoItem } from "@/types/api";

const FIXTURES: CatalogoItem[] = [
  {
    sku: "DD8309-G",
    marca: "WEST",
    familia: null,
    familias: separarFamilias(null),
    descripcion: null,
    total: 0,
    reservado: 5,
    disponible: -5,
    badges: ["sobre_reservado", "sin_familia", "stock_cero"],
  },
  {
    sku: "INV-1001",
    marca: "BRAND1",
    familia: "CANDADOS",
    familias: separarFamilias("CANDADOS"),
    descripcion: "Candado industrial reforzado",
    total: 1234,
    reservado: 34,
    disponible: 1200,
    badges: [],
  },
  {
    sku: "EAS-2002",
    marca: "EAS",
    familia: null,
    familias: separarFamilias(null),
    descripcion: "Sensor EAS estándar",
    total: 10,
    reservado: 10,
    disponible: 0,
    badges: ["sin_familia"],
  },
  {
    sku: "A/B 001",
    marca: "EAST",
    familia: "ACCESORIOS",
    familias: separarFamilias("ACCESORIOS"),
    descripcion: "Accesorio genérico",
    total: 5,
    reservado: 2,
    disponible: 3,
    badges: [],
  },
];

function fila(sku: string) {
  const celda = screen.getByText(sku);
  const row = celda.closest("tr");
  if (!row) throw new Error(`No se encontró <tr> para SKU ${sku}`);
  return row as HTMLElement;
}

describe("CatalogoTabla", () => {
  beforeEach(() => {
    render(<CatalogoTabla items={FIXTURES} ariaBusy={false} />);
  });

  it("renderiza una fila por item con el SKU en mono y link correcto (encodeURIComponent)", () => {
    const link = screen.getByRole("link", { name: "A/B 001" });
    expect(link).toHaveAttribute("href", `/catalogo/${encodeURIComponent("A/B 001")}`);
    expect(link.getAttribute("href")).toBe("/catalogo/A%2FB%20001");

    const linkNormal = screen.getByRole("link", { name: "INV-1001" });
    expect(linkNormal).toHaveAttribute("href", "/catalogo/INV-1001");
  });

  it("descripción null muestra '—' y la marca como subtexto", () => {
    const row = fila("DD8309-G");
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("WEST")).toBeInTheDocument();
  });

  it("descripción presente se muestra junto con la marca como subtexto", () => {
    const row = fila("INV-1001");
    expect(within(row).getByText("Candado industrial reforzado")).toBeInTheDocument();
    expect(within(row).getByText("BRAND1")).toBeInTheDocument();
  });

  it("familia null muestra chip neutro 'Sin familia'; familia presente muestra su nombre", () => {
    expect(within(fila("DD8309-G")).getByText("Sin familia")).toBeInTheDocument();
    expect(within(fila("EAS-2002")).getByText("Sin familia")).toBeInTheDocument();
    expect(within(fila("INV-1001")).getByText("CANDADOS")).toBeInTheDocument();
  });

  it("números formateados es-MX (total, reservado, disponible)", () => {
    const row = fila("INV-1001");
    expect(within(row).getByText("1,234")).toBeInTheDocument();
    expect(within(row).getByText("34")).toBeInTheDocument();
    expect(within(row).getByText("1,200")).toBeInTheDocument();
  });

  it("disponible negativo usa tono warn", () => {
    const row = fila("DD8309-G");
    const celda = within(row).getByText("-5");
    expect(celda.className).toContain("text-warn");
  });

  it("disponible en cero usa tono muted", () => {
    const row = fila("EAS-2002");
    const celda = within(row).getByText("0");
    expect(celda.className).toContain("text-ink-muted");
  });

  it("muestra el estatus correcto por fila (EstatusPill)", () => {
    expect(within(fila("DD8309-G")).getByText("Sobre-reservado")).toBeInTheDocument();
    expect(within(fila("INV-1001")).getByText("Disponible")).toBeInTheDocument();
    expect(within(fila("EAS-2002")).getByText("Reservado completo")).toBeInTheDocument();
    expect(within(fila("A/B 001")).getByText("Disponible")).toBeInTheDocument();
  });

  it("sin color (fixtures base): no hay dot ni texto sr-only 'Color:' en ninguna fila", () => {
    expect(screen.queryByText(/^Color:/)).not.toBeInTheDocument();
  });
});

describe("CatalogoTabla — color", () => {
  it("item con color: dot 8px con el token --mx-tag-{color} + texto sr-only 'Color: {label}.' antes del SKU", () => {
    render(<CatalogoTabla items={[{ ...FIXTURES[1], color: "verde" }]} ariaBusy={false} />);
    const link = screen.getByRole("link", { name: /INV-1001/ });
    const dot = link.querySelector('span[aria-hidden="true"]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot.className).toContain("bg-[var(--mx-tag-verde)]");
    expect(within(link).getByText("Color: Verde.", { exact: false })).toHaveClass("sr-only");
  });

  it("item sin color (color: null): no renderiza dot ni sr-only", () => {
    render(<CatalogoTabla items={[{ ...FIXTURES[1], color: null }]} ariaBusy={false} />);
    const link = screen.getByRole("link", { name: "INV-1001" });
    expect(link.querySelector('span[aria-hidden="true"]')).toBeNull();
    expect(screen.queryByText(/^Color:/)).not.toBeInTheDocument();
  });
});

describe("CatalogoTabla — tecnología (B-PARCHE F4)", () => {
  it("con tecnología: la sub-línea muestra 'marca · tecnología'", () => {
    render(<CatalogoTabla items={[{ ...FIXTURES[1], tecnologia: "RFID" }]} ariaBusy={false} />);
    const row = screen.getByRole("link", { name: /INV-1001/ }).closest("tr") as HTMLElement;
    expect(within(row).getByText("BRAND1 · RFID")).toBeInTheDocument();
  });

  it("sin tecnología (null): la sub-línea muestra solo la marca (se omite el separador)", () => {
    render(<CatalogoTabla items={[{ ...FIXTURES[1], tecnologia: null }]} ariaBusy={false} />);
    const row = screen.getByRole("link", { name: /INV-1001/ }).closest("tr") as HTMLElement;
    expect(within(row).getByText("BRAND1")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------
// INV-TAXO F2 · A3: celda de familia expandible "primera +N", primario
// SIEMPRE `item.familias` (multi-valor) — `item.familia` (crudo) está
// PROHIBIDO para esto (ver CatalogoItem.familia, types/api.ts).
// ------------------------------------------------------------
describe("CatalogoTabla — familias multi-valor (A3)", () => {
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

  it("celda colapsada muestra 'primera +N' y NO renderiza las demás familias", () => {
    render(<CatalogoTabla items={[MULTI]} ariaBusy={false} />);
    expect(screen.getByText("SERIES 12 +2")).toBeInTheDocument();
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();
    expect(screen.queryByText("CLIP ROTATIVO")).not.toBeInTheDocument();
  });

  it("expandir (click/tap) revela las 3 familias completas", () => {
    render(<CatalogoTabla items={[MULTI]} ariaBusy={false} />);
    fireEvent.click(screen.getByRole("button", { name: "SERIES 12 y 2 familias más" }));
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
  });

  it("expandir con foco de teclado (sin click) también revela las familias", () => {
    render(<CatalogoTabla items={[MULTI]} ariaBusy={false} />);
    fireEvent.focus(screen.getByRole("button", { name: "SERIES 12 y 2 familias más" }));
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
  });

  it("la celda usa SIEMPRE item.familias, nunca el string crudo item.familia", () => {
    render(<CatalogoTabla items={[{ ...MULTI, familia: "OTRA COSA / SIN RELACION", familias: ["SOLO-UNA"] }]} ariaBusy={false} />);
    expect(screen.getByText("SOLO-UNA")).toBeInTheDocument();
    expect(screen.queryByText(/OTRA COSA/)).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------
// R1-1: `ariaBusy` propaga `aria-busy` al `<table>` — mismo criterio que
// `EmbarquesTabla`/`config-usuarios.tsx` (chrome persistente: la tabla NO
// se desmonta durante un refetch, solo cambia este atributo).
// ------------------------------------------------------------
describe("CatalogoTabla — ariaBusy (R1-1)", () => {
  it("ariaBusy propaga aria-busy al <table>", () => {
    const { rerender } = render(<CatalogoTabla items={FIXTURES} ariaBusy={false} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false");

    rerender(<CatalogoTabla items={FIXTURES} ariaBusy={true} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });
});
