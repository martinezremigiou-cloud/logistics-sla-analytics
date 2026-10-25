import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChipTipo, ChipIntencion } from "./proyecto-chips";

describe("ChipTipo / ChipIntencion", () => {
  it("ChipTipo pinta el texto en tono neutro", () => {
    render(<ChipTipo>Rollout</ChipTipo>);
    const chip = screen.getByText("Rollout");
    expect(chip.className).toContain("bg-surface-3");
  });

  it("ChipIntencion pinta el texto en tono info (distinto de ChipTipo)", () => {
    render(<ChipIntencion>Cotización</ChipIntencion>);
    const chip = screen.getByText("Cotización");
    expect(chip.className).toContain("bg-info-bg");
    expect(chip.className).not.toContain("bg-surface-3");
  });
});
