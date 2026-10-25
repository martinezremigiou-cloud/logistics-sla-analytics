import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CambiosHeaderSkeleton, CambiosTablaSkeleton } from "./cambios-skeleton";

describe("cambios-skeleton", () => {
  it("CambiosHeaderSkeleton expone role='status'", () => {
    render(<CambiosHeaderSkeleton />);
    expect(screen.getByRole("status", { name: "Cargando snapshot…" })).toBeInTheDocument();
  });

  it("CambiosTablaSkeleton expone role='status'", () => {
    render(<CambiosTablaSkeleton />);
    expect(screen.getByRole("status", { name: "Cargando cambios…" })).toBeInTheDocument();
  });
});
