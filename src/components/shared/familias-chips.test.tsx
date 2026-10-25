import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FamiliaChip, ListaFamiliaChips } from "./familias-chips";

describe("FamiliaChip", () => {
  it("pinta el texto de la familia", () => {
    render(<FamiliaChip familia="CANDADOS" />);
    expect(screen.getByText("CANDADOS")).toBeInTheDocument();
  });

  it("className custom se funde con el default (rounded-full se conserva, bg se sobreescribe)", () => {
    render(<FamiliaChip familia="CANDADOS" className="bg-white/[0.12] text-white" />);
    const chip = screen.getByText("CANDADOS");
    expect(chip.className).toContain("rounded-full");
    expect(chip.className).toContain("bg-white/[0.12]");
    expect(chip.className).toContain("text-white");
    // El bg-surface-3 del default queda reemplazado (twMerge), no acumulado.
    expect(chip.className).not.toContain("bg-surface-3");
  });
});

describe("ListaFamiliaChips", () => {
  it("familias=[] pinta EXACTAMENTE el chip 'Sin familia' (caso vacío resuelto una sola vez)", () => {
    render(<ListaFamiliaChips familias={[]} />);
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
  });

  it("un chip por elemento, en el orden recibido", () => {
    render(<ListaFamiliaChips familias={["CLIP 3.0", "CLIP ROTATIVO"]} />);
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
    // NUNCA el crudo compuesto como un solo bloque (R3-1).
    expect(screen.queryByText("CLIP 3.0 / CLIP ROTATIVO")).not.toBeInTheDocument();
  });

  it("muchos átomos en un campo (caso real medido, ver src/lib/familias.ts) pintan un chip distinto por átomo", () => {
    const familias = Array.from({ length: 13 }, (_, i) => `FAMILIA ${i}`);
    render(<ListaFamiliaChips familias={familias} />);
    for (const f of familias) {
      expect(screen.getByText(f)).toBeInTheDocument();
    }
  });

  it("className se propaga a cada chip, incluido el de 'Sin familia'", () => {
    const { rerender } = render(<ListaFamiliaChips familias={[]} className="bg-white/[0.12] text-white" />);
    expect(screen.getByText("Sin familia").className).toContain("text-white");

    rerender(<ListaFamiliaChips familias={["CLIP 3.0", "CLIP ROTATIVO"]} className="bg-white/[0.12] text-white" />);
    expect(screen.getByText("CLIP 3.0").className).toContain("text-white");
    expect(screen.getByText("CLIP ROTATIVO").className).toContain("text-white");
  });
});
