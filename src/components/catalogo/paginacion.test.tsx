import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Paginacion } from "./paginacion";

describe("Paginacion", () => {
  it("muestra 'Página X de Y · N resultados' formateado es-MX", () => {
    render(<Paginacion page={2} totalPages={5} total={1234} onPageChange={vi.fn()} />);
    expect(screen.getByText("Página 2 de 5 · 1,234 resultados")).toBeInTheDocument();
  });

  it("deshabilita 'Página anterior' en la primera página", () => {
    render(<Paginacion page={1} totalPages={5} total={200} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
  });

  it("deshabilita 'Página siguiente' en la última página", () => {
    render(<Paginacion page={5} totalPages={5} total={200} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeEnabled();
  });

  it("click en 'Página siguiente' llama onPageChange con page+1", () => {
    const onPageChange = vi.fn();
    render(<Paginacion page={2} totalPages={5} total={200} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("click en 'Página anterior' llama onPageChange con page-1", () => {
    const onPageChange = vi.fn();
    render(<Paginacion page={2} totalPages={5} total={200} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("con totalPages=0 trata como una sola página y deshabilita ambos extremos", () => {
    render(<Paginacion page={1} totalPages={0} total={0} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
    expect(screen.getByText("Página 1 de 1 · 0 resultados")).toBeInTheDocument();
  });
});
