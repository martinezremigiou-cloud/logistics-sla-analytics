import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { CruceEtapa, CruceResumen } from "@/types/api";
import { PipelineAduana } from "./pipeline-aduana";

const NOMBRES = [
  "Producto Solicitado",
  "En Preparación",
  "En Recolección",
  "En Almacén FW",
  "En Tránsito Aéreo",
  "En Tránsito Marítimo",
  "En Aduana",
  "En Tránsito Terrestre",
  "En Almacén Fiscal",
  "En Almacén North",
  "Producto Disponible",
];

function etapasVacias(): CruceEtapa[] {
  return NOMBRES.map((nombre, i) => ({
    orden: i + 1,
    nombre,
    activos: { embarques: 0, piezas: 0 },
    historial: { embarques: 0, piezas: 0 },
    items: [],
  }));
}

const RESUMEN_VACIO: CruceResumen = { embarques_activos: 0, piezas_activas: 0, embarques_historial: 0, piezas_historial: 0 };

describe("PipelineAduana", () => {
  it("SIEMPRE renderiza 11 nodos, incluso con todas las etapas en ceros", () => {
    render(<PipelineAduana etapas={etapasVacias()} resumen={RESUMEN_VACIO} seleccion={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(11);
    for (const nombre of NOMBRES) {
      expect(screen.getByText(nombre)).toBeInTheDocument();
    }
  });

  it("chip global formateado: '{embarques_activos} emb · {piezas_activas} pz en tránsito'", () => {
    const resumen: CruceResumen = { embarques_activos: 7, piezas_activas: 1234, embarques_historial: 0, piezas_historial: 0 };
    render(<PipelineAduana etapas={etapasVacias()} resumen={resumen} seleccion={null} onSelect={vi.fn()} />);
    expect(screen.getByText("7 emb · 1,234 pz en tránsito")).toBeInTheDocument();
  });

  it("badge numérico de cada etapa expone aria-label '{n} embarques activos'", () => {
    const etapas = etapasVacias();
    etapas[6] = { ...etapas[6], activos: { embarques: 3, piezas: 90 } };
    render(<PipelineAduana etapas={etapas} resumen={RESUMEN_VACIO} seleccion={null} onSelect={vi.fn()} />);
    expect(screen.getByLabelText("3 embarques activos")).toBeInTheDocument();
  });

  it('"{n} hist." solo se muestra en la etapa con historial.embarques > 0', () => {
    const etapas = etapasVacias();
    etapas[10] = { ...etapas[10], historial: { embarques: 73, piezas: 5000 } }; // etapa 11: Producto Disponible
    render(<PipelineAduana etapas={etapas} resumen={RESUMEN_VACIO} seleccion={null} onSelect={vi.fn()} />);

    const botones = screen.getAllByRole("button");
    expect(within(botones[10]).getByText("73 hist.")).toBeInTheDocument();
    for (const boton of botones.slice(0, 10)) {
      expect(within(boton).queryByText(/hist\./)).not.toBeInTheDocument();
    }
  });

  it("clic en una etapa dispara onSelect con su orden", () => {
    const onSelect = vi.fn();
    render(<PipelineAduana etapas={etapasVacias()} resumen={RESUMEN_VACIO} seleccion={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("En Aduana"));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("aria-pressed=true solo en la etapa seleccionada", () => {
    render(<PipelineAduana etapas={etapasVacias()} resumen={RESUMEN_VACIO} seleccion={7} onSelect={vi.fn()} />);
    const botones = screen.getAllByRole("button");
    const presionados = botones.filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(presionados).toHaveLength(1);
    expect(presionados[0]).toHaveTextContent("En Aduana");
  });
});
