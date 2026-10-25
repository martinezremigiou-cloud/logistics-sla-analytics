import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProyectoPartidas } from "./proyecto-partidas";
import type { ProyectoDetalle, PartidaItem } from "@/types/proyectos";

function partida(overrides: Partial<PartidaItem> = {}): PartidaItem {
  return {
    partida_id: "p1",
    sku: "SUJ500-F",
    descripcion: "Security Stand Alpha",
    marca: "BRAND1",
    tecnologia: "SERIES 2",
    color: "azul",
    imagen_url: null,
    cantidad: 120,
    total: 2000,
    reservado: 463,
    disponible: 1537,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: null,
    eje_banda: "sin_banda",
    ...overrides,
  };
}

function detalle(partidas: PartidaItem[], overrides: Partial<ProyectoDetalle> = {}): ProyectoDetalle {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: null,
    notas: null,
    fecha: "2026-04-30",
    tipo: null,
    intencion: null,
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: partidas.length,
    piezas: partidas.reduce((s, p) => s + p.cantidad, 0),
    partidas,
    vigencia: { snapshot_id: "snap-1", tomado_en: "2026-08-10T14:00:00.000Z" },
    agrupacion: { eje: "sin_banda", sinBanda: 0 },
    facetas: {
      marcas: Array.from(new Set(partidas.map((p) => p.marca).filter((v): v is string => Boolean(v)))),
      tecnologias: Array.from(new Set(partidas.map((p) => p.tecnologia).filter((v): v is string => Boolean(v)))),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProyectoPartidas", () => {
  it("zero-state: proyecto sin partidas — no pinta filtros ni filas", () => {
    render(<ProyectoPartidas detalle={detalle([])} onChanged={vi.fn()} />);
    expect(screen.getByText("Este proyecto aún no tiene partidas…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar SKU o descripción")).not.toBeInTheDocument();
  });

  it("con partidas: pinta la subtítulo, la vigencia y las filas", () => {
    render(<ProyectoPartidas detalle={detalle([partida(), partida({ partida_id: "p2", sku: "LKF534-P" })])} onChanged={vi.fn()} />);
    expect(screen.getByText("piezas por SKU · sin duplicados")).toBeInTheDocument();
    expect(screen.getByText(/Datos al/)).toBeInTheDocument();
    expect(screen.getByText("SUJ500-F")).toBeInTheDocument();
    expect(screen.getByText("LKF534-P")).toBeInTheDocument();
  });

  it("sin snapshot vigente (tomado_en null): lo dice en vez de fingir una fecha", () => {
    render(<ProyectoPartidas detalle={detalle([partida()], { vigencia: { snapshot_id: null, tomado_en: null } })} onChanged={vi.fn()} />);
    expect(screen.getByText("Sin snapshot de stock vigente todavía")).toBeInTheDocument();
  });

  it("los selectores de Marca/Tecnología se pueblan de detalle.facetas (dato real), no de una lista fija", () => {
    render(
      <ProyectoPartidas
        detalle={detalle([partida({ marca: "BRAND1", tecnologia: "SERIES 2" }), partida({ partida_id: "p2", sku: "GRG2499", marca: "NACIONAL", tecnologia: "ADHESIVOS" })])}
        onChanged={vi.fn()}
      />,
    );
    const marcaSelect = screen.getByLabelText("Marca") as HTMLSelectElement;
    expect(Array.from(marcaSelect.options).map((o) => o.value)).toEqual(["", "BRAND1", "NACIONAL"]);
    const tecSelect = screen.getByLabelText("Tecnología") as HTMLSelectElement;
    expect(Array.from(tecSelect.options).map((o) => o.value)).toEqual(["", "SERIES 2", "ADHESIVOS"]);
  });

  it("buscador de texto filtra las filas visibles", () => {
    render(
      <ProyectoPartidas
        detalle={detalle([partida({ sku: "SUJ500-F" }), partida({ partida_id: "p2", sku: "GRG2499", descripcion: "Series 28" })])}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Buscar SKU o descripción"), { target: { value: "grg" } });
    expect(screen.queryByText("SUJ500-F")).not.toBeInTheDocument();
    expect(screen.getByText("GRG2499")).toBeInTheDocument();
  });

  it("chip '⚠ En riesgo' filtra solo partida.en_riesgo, con aria-pressed reflejando el estado", () => {
    render(
      <ProyectoPartidas
        detalle={detalle([partida({ sku: "SUJ500-F", en_riesgo: false }), partida({ partida_id: "p2", sku: "LKF534-P", en_riesgo: true })])}
        onChanged={vi.fn()}
      />,
    );
    const chip = screen.getByRole("button", { name: "⚠ En riesgo" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("SUJ500-F")).not.toBeInTheDocument();
    expect(screen.getByText("LKF534-P")).toBeInTheDocument();
  });

  it("zero-state filtrado: sin resultados + 'Limpiar filtros' restaura la lista completa", () => {
    render(<ProyectoPartidas detalle={detalle([partida({ sku: "SUJ500-F" })])} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Buscar SKU o descripción"), { target: { value: "zzz-no-existe" } });
    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
    expect(screen.getByText("Ninguna partida coincide con los filtros actuales.")).toBeInTheDocument();

    // Dos botones "Limpiar filtros" a la vez (fila de filtros + CTA del
    // zero-state) — mismo patrón ya establecido en catalogo-view.test.tsx;
    // ambos llaman al mismo limpiar, cualquiera de los dos sirve.
    const botones = screen.getAllByRole("button", { name: "Limpiar filtros" });
    fireEvent.click(botones[0]);
    expect(screen.getByText("SUJ500-F")).toBeInTheDocument();
  });

  it("botón '+ Agregar SKU' está presente en el header de la card", () => {
    render(<ProyectoPartidas detalle={detalle([partida()])} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Agregar SKU" })).toBeInTheDocument();
  });
});
