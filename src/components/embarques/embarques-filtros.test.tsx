import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EmbarquesFiltros, type ConteosAmbito } from "./embarques-filtros";
import type { EmbarquesFacetaEstatus, EmbarquesFacetaValor } from "@/types/api";

const FACETAS_ESTATUS: EmbarquesFacetaEstatus[] = [
  { orden: 1, nombre: "Producto Solicitado", conteo: 0 },
  { orden: 7, nombre: "En Aduana", conteo: 8 },
  { orden: 11, nombre: "Producto Disponible", conteo: 112 },
];
const FACETAS_PAISES: EmbarquesFacetaValor[] = [
  { valor: "CN", conteo: 70 },
  { valor: "MX", conteo: 50 },
];
const CONTEOS_VACIOS: ConteosAmbito = { todos: null, activos: null, historial: null };

function baseProps(overrides: Partial<React.ComponentProps<typeof EmbarquesFiltros>> = {}) {
  return {
    ambito: "todos" as const,
    onChangeAmbito: vi.fn(),
    conteos: CONTEOS_VACIOS,
    q: "",
    onSubmitQ: vi.fn(),
    estatus: null,
    facetasEstatus: FACETAS_ESTATUS,
    onChangeEstatus: vi.fn(),
    retrasado: false,
    onToggleRetrasado: vi.fn(),
    pais: null,
    facetasPaises: FACETAS_PAISES,
    onChangePais: vi.fn(),
    fechaCampo: "eta" as const,
    onChangeFechaCampo: vi.fn(),
    desde: null,
    onChangeDesde: vi.fn(),
    hasta: null,
    onChangeHasta: vi.fn(),
    rangoFechaInvalido: false,
    ...overrides,
  };
}

describe("EmbarquesFiltros", () => {
  it("tabs con conteos formateados '(N)'; conteo null omite el paréntesis", () => {
    render(<EmbarquesFiltros {...baseProps({ conteos: { todos: 120, activos: 8, historial: 112 } })} />);
    expect(screen.getByRole("tab", { name: "Todos (120)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activos (8)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico (112)" })).toBeInTheDocument();
  });

  it("conteos aún no cargados (null): las tabs se muestran SIN paréntesis", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    expect(screen.getByRole("tab", { name: "Todos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Activos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
  });

  it("la tab 'Todos' está seleccionada por defecto (ambito='todos')", () => {
    render(<EmbarquesFiltros {...baseProps({ ambito: "todos" })} />);
    expect(screen.getByRole("tab", { name: "Todos" })).toHaveAttribute("aria-selected", "true");
  });

  it("cambiar de tab dispara onChangeAmbito con el ambito clicado (Radix activa por mousedown, no click)", () => {
    const onChangeAmbito = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onChangeAmbito })} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Activos" }));
    expect(onChangeAmbito).toHaveBeenCalledWith("activos");
  });

  it("select de estatus se alimenta de facetasEstatus (incluye 'Estatus: todos' + las 3 del fixture, con su conteo '(n)' — fix B13)", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    const select = screen.getByLabelText("Estatus");
    expect(within(select).getByRole("option", { name: "Estatus: todos" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "En Aduana (8)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Producto Disponible (112)" })).toBeInTheDocument();
  });

  it("opción de estatus con conteo 0 aparece disabled (visible, no seleccionable) — fix B13", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    const opcion = within(screen.getByLabelText("Estatus")).getByRole("option", { name: "Producto Solicitado (0)" });
    expect(opcion).toBeDisabled();
  });

  it("cambiar el select de estatus dispara onChangeEstatus con el orden numérico (o null en 'todos')", () => {
    const onChangeEstatus = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onChangeEstatus, estatus: 7 })} />);
    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "11" } });
    expect(onChangeEstatus).toHaveBeenCalledWith(11);
    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "" } });
    expect(onChangeEstatus).toHaveBeenCalledWith(null);
  });

  it("toggle 'Solo retrasados': aria-pressed refleja la prop y el click dispara onToggleRetrasado", () => {
    const onToggleRetrasado = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ retrasado: true, onToggleRetrasado })} />);
    const boton = screen.getByRole("button", { name: "Solo retrasados" });
    expect(boton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boton);
    expect(onToggleRetrasado).toHaveBeenCalledTimes(1);
  });

  it("toggle 'Solo retrasados' inactivo: aria-pressed=false", () => {
    render(<EmbarquesFiltros {...baseProps({ retrasado: false })} />);
    expect(screen.getByRole("button", { name: "Solo retrasados" })).toHaveAttribute("aria-pressed", "false");
  });

  it("panel 'Más filtros' cerrado por defecto (sin país/rango activos): el select de País no está en el DOM", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("País")).not.toBeInTheDocument();
  });

  it("clic en 'Más filtros' abre el panel (aria-expanded + controles visibles)", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
    expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("País")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtrar por fecha de")).toBeInTheDocument();
    expect(screen.getByLabelText("Desde")).toBeInTheDocument();
    expect(screen.getByLabelText("Hasta")).toBeInTheDocument();
  });

  it("panel abierto por defecto si llega un deep-link con país ya activo", () => {
    render(<EmbarquesFiltros {...baseProps({ pais: "CN" })} />);
    expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("País")).toHaveValue("CN");
  });

  it("panel abierto por defecto si llega un deep-link con desde/hasta ya activos", () => {
    render(<EmbarquesFiltros {...baseProps({ desde: "2026-01-01" })} />);
    expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "true");
  });

  it("facetasPaises vacía: el select de País NO se pinta aunque el panel esté abierto (filtro dirigido por facetas)", () => {
    render(<EmbarquesFiltros {...baseProps({ facetasPaises: [] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
    expect(screen.queryByLabelText("País")).not.toBeInTheDocument();
    // El resto del panel (fecha) sigue disponible: no depende de facetas.
    expect(screen.getByLabelText("Filtrar por fecha de")).toBeInTheDocument();
  });

  it("cambiar el select de País dispara onChangePais (o null en 'todos')", () => {
    const onChangePais = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onChangePais, pais: "CN" })} />);
    fireEvent.change(screen.getByLabelText("País"), { target: { value: "MX" } });
    expect(onChangePais).toHaveBeenCalledWith("MX");
    fireEvent.change(screen.getByLabelText("País"), { target: { value: "" } });
    expect(onChangePais).toHaveBeenCalledWith(null);
  });

  it("cambiar el campo de fecha dispara onChangeFechaCampo", () => {
    const onChangeFechaCampo = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onChangeFechaCampo, desde: "2026-01-01" })} />);
    fireEvent.change(screen.getByLabelText("Filtrar por fecha de"), { target: { value: "etd" } });
    expect(onChangeFechaCampo).toHaveBeenCalledWith("etd");
  });

  it("cambiar desde/hasta dispara onChangeDesde/onChangeHasta con el valor (o null si se vacía)", () => {
    const onChangeDesde = vi.fn();
    const onChangeHasta = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onChangeDesde, onChangeHasta, desde: "2026-01-01" })} />);
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-02-01" } });
    expect(onChangeDesde).toHaveBeenCalledWith("2026-02-01");
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-03-01" } });
    expect(onChangeHasta).toHaveBeenCalledWith("2026-03-01");
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "" } });
    expect(onChangeDesde).toHaveBeenCalledWith(null);
  });

  it("copy obligatorio del rango de fecha menciona el campo elegido (ETA por defecto)", () => {
    render(<EmbarquesFiltros {...baseProps({ desde: "2026-01-01" })} />);
    expect(screen.getByText(/sin fecha de ETA quedan fuera/)).toBeInTheDocument();
  });

  it("buscador: enviar el formulario dispara onSubmitQ con el texto recortado", () => {
    const onSubmitQ = vi.fn();
    render(<EmbarquesFiltros {...baseProps({ onSubmitQ })} />);
    const input = screen.getByLabelText("Buscar embarques");
    fireEvent.change(input, { target: { value: "  OC-100  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(onSubmitQ).toHaveBeenCalledWith("OC-100");
  });

  it("el input de búsqueda se resincroniza cuando cambia el prop q", () => {
    const { rerender } = render(<EmbarquesFiltros {...baseProps({ q: "" })} />);
    expect(screen.getByLabelText("Buscar embarques")).toHaveValue("");
    rerender(<EmbarquesFiltros {...baseProps({ q: "OC-100" })} />);
    expect(screen.getByLabelText("Buscar embarques")).toHaveValue("OC-100");
  });

  it("placeholder del buscador es el copy exacto pedido", () => {
    render(<EmbarquesFiltros {...baseProps()} />);
    expect(screen.getByPlaceholderText("Buscar OC, SKU, referencia o factura…")).toBeInTheDocument();
  });

  describe("M8: validación inline de rango de fecha invertido", () => {
    it("rangoFechaInvalido=false: no pinta ninguna validación", () => {
      render(<EmbarquesFiltros {...baseProps({ desde: "2026-02-01", hasta: "2026-01-01", rangoFechaInvalido: false })} />);
      fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("rangoFechaInvalido=true: pinta la validación inline junto a los inputs de fecha", () => {
      render(<EmbarquesFiltros {...baseProps({ desde: "2026-02-01", hasta: "2026-01-01", rangoFechaInvalido: true })} />);
      expect(screen.getByRole("alert")).toHaveTextContent("Desde”");
      expect(screen.getByRole("alert")).toHaveTextContent("Hasta”");
    });

    it("rangoFechaInvalido=true marca aria-invalid en Desde/Hasta", () => {
      render(<EmbarquesFiltros {...baseProps({ desde: "2026-02-01", hasta: "2026-01-01", rangoFechaInvalido: true })} />);
      expect(screen.getByLabelText("Desde")).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Hasta")).toHaveAttribute("aria-invalid", "true");
    });

    it("rangoFechaInvalido=true reabre el panel 'Más filtros' aunque haya arrancado cerrado", () => {
      const { rerender } = render(<EmbarquesFiltros {...baseProps({ rangoFechaInvalido: false })} />);
      expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "false");

      rerender(<EmbarquesFiltros {...baseProps({ desde: "2026-02-01", hasta: "2026-01-01", rangoFechaInvalido: true })} />);
      expect(screen.getByRole("button", { name: "Más filtros" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });
});
