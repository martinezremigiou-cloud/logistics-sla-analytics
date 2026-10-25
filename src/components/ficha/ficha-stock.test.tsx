import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FichaStock } from "./ficha-stock";
import type { SkuStockItem } from "@/types/api";

describe("FichaStock", () => {
  it("barras proporcionales al máximo del sku (width style)", () => {
    const stock: SkuStockItem[] = [
      { almacen: "NORTH", cantidad: 10 },
      { almacen: "SOUTH", cantidad: 5 },
    ];
    render(<FichaStock stock={stock} total={15} reservado={3} piezasEnCamino={20} />);

    expect(screen.getByTestId("stock-barra-NORTH")).toHaveStyle({ width: "100%" });
    expect(screen.getByTestId("stock-barra-SOUTH")).toHaveStyle({ width: "50%" });
  });

  it("muestra la clave del almacén (mono) y la cantidad formateada por fila", () => {
    const stock: SkuStockItem[] = [{ almacen: "NORTH", cantidad: 1234 }];
    render(<FichaStock stock={stock} total={7000} reservado={0} piezasEnCamino={0} />);

    expect(screen.getByText("NORTH")).toBeInTheDocument();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("footer con las 3 métricas: total, reservado y piezas_en_camino del DTO (no suma embarques)", () => {
    const stock: SkuStockItem[] = [{ almacen: "NORTH", cantidad: 10 }];
    render(<FichaStock stock={stock} total={13} reservado={3} piezasEnCamino={999} />);

    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(screen.getByText("13")).toBeInTheDocument();
    expect(screen.getByText("Reservado")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("En camino")).toBeInTheDocument();
    expect(screen.getByText("999")).toBeInTheDocument();
  });

  it("vacío: mensaje 'Sin stock registrado en almacenes.' y footer sigue visible", () => {
    render(<FichaStock stock={[]} total={0} reservado={0} piezasEnCamino={0} />);
    expect(screen.getByText("Sin stock registrado en almacenes.")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});
