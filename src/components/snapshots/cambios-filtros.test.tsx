import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CambiosFiltros } from "./cambios-filtros";

describe("CambiosFiltros", () => {
  it("buscador de SKU: NO llama onSubmitSku en cada tecla, solo al enviar el form", () => {
    const onSubmitSku = vi.fn();
    render(
      <CambiosFiltros sku={null} entidad={null} tipo={null} onSubmitSku={onSubmitSku} onChangeEntidad={vi.fn()} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    const input = screen.getByLabelText("Buscar por SKU");
    fireEvent.change(input, { target: { value: "A-1" } });
    expect(onSubmitSku).not.toHaveBeenCalled();

    fireEvent.submit(input.closest("form")!);
    expect(onSubmitSku).toHaveBeenCalledWith("A-1");
  });

  it("select Entidad: dispara onChangeEntidad de inmediato, con las 4 opciones + 'todas'", () => {
    const onChangeEntidad = vi.fn();
    render(
      <CambiosFiltros sku={null} entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={onChangeEntidad} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    const select = screen.getByLabelText("Entidad");
    expect(screen.getByRole("option", { name: "Producto" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Stock" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Reserva" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Embarque" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "reserva" } });
    expect(onChangeEntidad).toHaveBeenCalledWith("reserva");
  });

  it("select Tipo: dispara onChangeTipo de inmediato, con las 3 opciones + 'todos'", () => {
    const onChangeTipo = vi.fn();
    render(
      <CambiosFiltros sku={null} entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={vi.fn()} onChangeTipo={onChangeTipo} onLimpiar={vi.fn()} />,
    );
    expect(screen.getByRole("option", { name: "Alta" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Baja" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Modificación" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "BAJA" } });
    expect(onChangeTipo).toHaveBeenCalledWith("BAJA");
  });

  it("'Limpiar filtros' solo aparece cuando hay al menos un filtro activo", () => {
    const { rerender } = render(
      <CambiosFiltros sku={null} entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={vi.fn()} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();

    rerender(
      <CambiosFiltros sku="A-1" entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={vi.fn()} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("si `sku` cambia desde afuera (chip removido), el input local se resincroniza", () => {
    const { rerender } = render(
      <CambiosFiltros sku="A-1" entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={vi.fn()} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    expect(screen.getByLabelText("Buscar por SKU")).toHaveValue("A-1");

    rerender(
      <CambiosFiltros sku={null} entidad={null} tipo={null} onSubmitSku={vi.fn()} onChangeEntidad={vi.fn()} onChangeTipo={vi.fn()} onLimpiar={vi.fn()} />,
    );
    expect(screen.getByLabelText("Buscar por SKU")).toHaveValue("");
  });
});
