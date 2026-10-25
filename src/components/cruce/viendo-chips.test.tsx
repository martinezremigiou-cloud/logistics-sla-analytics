import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ViendoChips } from "./viendo-chips";

describe("ViendoChips", () => {
  it("renderiza un chip por cada sku de skus_activos", () => {
    render(<ViendoChips skus={["A-1", "B-2"]} foco={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "A-1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "B-2" })).toBeInTheDocument();
    expect(screen.getByText("Viendo:")).toBeInTheDocument();
  });

  it("el chip del foco actual queda estilizado como activo (aria-pressed + filled navy)", () => {
    render(<ViendoChips skus={["A-1", "B-2"]} foco="B-2" onSelect={vi.fn()} />);
    const activo = screen.getByRole("button", { name: "B-2" });
    const inactivo = screen.getByRole("button", { name: "A-1" });

    expect(activo).toHaveAttribute("aria-pressed", "true");
    expect(activo.className).toContain("bg-sidebar");
    expect(inactivo).toHaveAttribute("aria-pressed", "false");
    expect(inactivo.className).not.toContain("bg-sidebar");
  });

  it("foco fuera de la lista (deep-link sin embarques activos) se agrega como chip extra", () => {
    render(<ViendoChips skus={["A-1"]} foco="Z-9" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "A-1" })).toBeInTheDocument();
    const extra = screen.getByRole("button", { name: "Z-9" });
    expect(extra).toHaveAttribute("aria-pressed", "true");
  });

  it("skus_activos vacío y sin foco: no pinta la fila", () => {
    const { container } = render(<ViendoChips skus={[]} foco={null} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("clic en un chip dispara onSelect con ese sku", () => {
    const onSelect = vi.fn();
    render(<ViendoChips skus={["A-1", "B-2"]} foco={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "A-1" }));
    expect(onSelect).toHaveBeenCalledWith("A-1");
  });
});
