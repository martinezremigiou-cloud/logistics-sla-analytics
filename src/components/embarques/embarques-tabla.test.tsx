import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { EmbarquesTabla } from "./embarques-tabla";
import type { EmbarqueItem } from "@/types/api";

function item(overrides: Partial<EmbarqueItem> = {}): EmbarqueItem {
  return {
    id: "e1",
    sku: "A-1",
    descripcion: "Candado industrial",
    oc_po: "OC-100",
    proveedor: null,
    referencia: "REF-1",
    factura: "FAC-1",
    pais_origen: "CN",
    piezas: 1234,
    fw: "FW-1",
    tipo_importacion: "MARITIMO",
    fecha_recoleccion: null,
    etd: null,
    eta: "2026-08-15",
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: "En Aduana",
    estatus_orden: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    retrasado: false,
    ...overrides,
  };
}

function fila(sku: string) {
  const link = screen.getByRole("link", { name: new RegExp(`^${sku}$`) });
  const row = link.closest("tr");
  if (!row) throw new Error(`No se encontró <tr> para SKU ${sku}`);
  return row as HTMLElement;
}

describe("EmbarquesTabla", () => {
  it("el SKU es un link a /catalogo/{sku} (encodeURIComponent) y es el ÚNICO elemento enfocable de la fila", () => {
    render(<EmbarquesTabla items={[item({ sku: "A/B 001" })]} ariaBusy={false} />);
    const row = fila("A/B 001");
    const link = within(row).getByRole("link");
    expect(link).toHaveAttribute("href", `/catalogo/${encodeURIComponent("A/B 001")}`);
    // Único elemento enfocable/accionable de la fila: ni botones ni otros links.
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(within(row).getAllByRole("link")).toHaveLength(1);
  });

  it("muestra oc_po debajo del SKU ('—' si es null)", () => {
    render(<EmbarquesTabla items={[item({ sku: "A-1", oc_po: "OC-999" }), item({ id: "e2", sku: "B-2", oc_po: null })]} ariaBusy={false} />);
    expect(within(fila("A-1")).getByText("OC-999")).toBeInTheDocument();
    expect(within(fila("B-2")).getByText("—")).toBeInTheDocument();
  });

  it("activo (is_historial=false): la fecha muestra 'ETA {eta}', sin chip Histórico", () => {
    render(<EmbarquesTabla items={[item({ is_historial: false, eta: "2026-08-15" })]} ariaBusy={false} />);
    expect(screen.getByText(/^ETA /)).toBeInTheDocument();
    expect(screen.queryByText("Histórico")).not.toBeInTheDocument();
  });

  it("histórico (is_historial=true): la fecha muestra 'Recibido {fecha_disponibilidad}' + chip Histórico neutro", () => {
    render(<EmbarquesTabla items={[item({ is_historial: true, fecha_disponibilidad: "2026-06-01" })]} ariaBusy={false} />);
    expect(screen.getByText(/^Recibido /)).toBeInTheDocument();
    const chip = screen.getByText("Histórico");
    expect(chip.className).toContain("bg-surface-3");
    expect(chip.className).toContain("text-ink-muted");
  });

  it("retrasado=true: chip 'Retraso' en tono warn (NUNCA danger/rojo)", () => {
    render(<EmbarquesTabla items={[item({ retrasado: true })]} ariaBusy={false} />);
    const chip = screen.getByText("Retraso");
    expect(chip.className).toContain("bg-warn-bg");
    expect(chip.className).toContain("text-warn");
    expect(chip.className).not.toMatch(/danger|destructive|red/);
  });

  it("retrasado=false: no pinta el chip 'Retraso'", () => {
    render(<EmbarquesTabla items={[item({ retrasado: false })]} ariaBusy={false} />);
    expect(screen.queryByText("Retraso")).not.toBeInTheDocument();
  });

  it("piezas null muestra '—'; piezas numérico se formatea es-MX", () => {
    render(<EmbarquesTabla items={[item({ sku: "A-1", piezas: null }), item({ id: "e2", sku: "B-2", piezas: 12345 })]} ariaBusy={false} />);
    expect(within(fila("A-1")).getByText("—")).toBeInTheDocument();
    expect(within(fila("B-2")).getByText("12,345")).toBeInTheDocument();
  });

  it("columnas 4-6 (Referencia/Factura, País, Tipo) muestran '—' por campo null", () => {
    render(<EmbarquesTabla items={[item({ referencia: null, factura: null, pais_origen: null, tipo_importacion: null, fw: null })]} ariaBusy={false} />);
    expect(screen.getByText("Ref: —")).toBeInTheDocument();
    expect(screen.getByText("Fact: —")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("referencia/factura/país presentes se muestran tal cual", () => {
    render(<EmbarquesTabla items={[item({ referencia: "REF-9", factura: "FAC-9", pais_origen: "MX" })]} ariaBusy={false} />);
    expect(screen.getByText("Ref: REF-9")).toBeInTheDocument();
    expect(screen.getByText("Fact: FAC-9")).toBeInTheDocument();
    expect(screen.getByText("MX")).toBeInTheDocument();
  });

  it("columnas 4-6 tienen la clase 'hidden md:table-cell'", () => {
    render(<EmbarquesTabla items={[item()]} ariaBusy={false} />);
    const celdaPais = screen.getByText("CN");
    expect(celdaPais.className).toContain("hidden");
    expect(celdaPais.className).toContain("md:table-cell");
  });

  it("ariaBusy propaga aria-busy al <table>", () => {
    const { rerender } = render(<EmbarquesTabla items={[item()]} ariaBusy={false} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false");
    rerender(<EmbarquesTabla items={[item()]} ariaBusy={true} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("estatus_orden huérfano (fuera de 1..11) no rompe el render: cae al ícono de fallback", () => {
    render(<EmbarquesTabla items={[item({ estatus_orden: 999, estatus: "" })]} ariaBusy={false} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
