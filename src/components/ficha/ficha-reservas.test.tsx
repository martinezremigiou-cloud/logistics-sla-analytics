import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FichaReservas } from "./ficha-reservas";
import type { SkuReservaItem } from "@/types/api";

describe("FichaReservas", () => {
  it("DD8309-G: reservado 7,300 formateado, reservas [] con descuadre → nota 'Atención' + vacío 'Sin reservas registradas.'", () => {
    render(<FichaReservas reservado={7300} reservas={[]} reservaDescuadre={true} />);

    expect(screen.getByText("Reservado total: 7,300")).toBeInTheDocument();
    expect(screen.getByText("Atención")).toBeInTheDocument();
    expect(
      screen.getByText(
        "El reservado total viene del archivo de inventario y es el que cuenta para el disponible. El detalle por cliente suma distinto.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Sin reservas registradas.")).toBeInTheDocument();
  });

  it("la nota de descuadre usa tono warn (nunca danger/rojo)", () => {
    render(<FichaReservas reservado={7300} reservas={[]} reservaDescuadre={true} />);
    const nota = screen.getByText(
      "El reservado total viene del archivo de inventario y es el que cuenta para el disponible. El detalle por cliente suma distinto.",
    );
    const wrapper = nota.closest("div");
    expect(wrapper?.className).toContain("warn");
    expect(wrapper?.className).not.toContain("danger");
    expect(screen.getByText("Atención").className).not.toMatch(/danger/);
  });

  it("sin descuadre: no muestra la nota 'Atención'", () => {
    render(<FichaReservas reservado={5} reservas={[]} reservaDescuadre={false} />);
    expect(screen.queryByText("Atención")).not.toBeInTheDocument();
  });

  it("kam null muestra chip 'sin KAM'; kam presente muestra el nombre", () => {
    const reservas: SkuReservaItem[] = [
      { kam: null, cliente: "RETAILER64", cantidad: 5, motivo: null, fecha: "2026-07-01" },
      { kam: "LUCAS", cliente: "RETAILER80", cantidad: 3, motivo: "Proyecto X", fecha: "2026-07-02" },
    ];
    render(<FichaReservas reservado={8} reservas={reservas} reservaDescuadre={false} />);

    expect(screen.getByText("sin KAM")).toBeInTheDocument();
    expect(screen.getByText("LUCAS")).toBeInTheDocument();
    expect(screen.getByText("RETAILER64")).toBeInTheDocument();
    expect(screen.getByText("RETAILER80")).toBeInTheDocument();
    expect(screen.getByText("Proyecto X")).toBeInTheDocument();
  });

  it("motivo null muestra '—'", () => {
    const reservas: SkuReservaItem[] = [{ kam: "LUCAS", cliente: "RETAILER64", cantidad: 5, motivo: null, fecha: "2026-07-01" }];
    render(<FichaReservas reservado={5} reservas={reservas} reservaDescuadre={false} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("fecha formateada es-MX", () => {
    const reservas: SkuReservaItem[] = [{ kam: "LUCAS", cliente: "RETAILER64", cantidad: 5, motivo: null, fecha: "2026-07-01T15:30:00.000Z" }];
    render(<FichaReservas reservado={5} reservas={reservas} reservaDescuadre={false} />);
    expect(screen.getByText("01 jul 2026")).toBeInTheDocument();
  });

  it("footer 'Desglosado' suma las cantidades de las filas visibles", () => {
    const reservas: SkuReservaItem[] = [
      { kam: "LUCAS", cliente: "RETAILER64", cantidad: 5, motivo: null, fecha: "2026-07-01" },
      { kam: "LUCAS", cliente: "RETAILER80", cantidad: 3, motivo: null, fecha: "2026-07-02" },
    ];
    render(<FichaReservas reservado={999} reservas={reservas} reservaDescuadre={false} />);
    expect(screen.getByText("Desglosado: 8")).toBeInTheDocument();
  });
});
