import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotVigenteBadge } from "./snapshot-vigente-badge";

describe("SnapshotVigenteBadge", () => {
  it("muestra el copy exacto 'Snapshot vigente'", () => {
    render(<SnapshotVigenteBadge />);
    expect(screen.getByText("Snapshot vigente")).toBeInTheDocument();
  });

  // Fix B18 (revisor-codigo, ronda 2): un badge estático NO es una live
  // region — `/snapshots` puede pintar varios a la vez.
  it("NO expone role='status' (fix B18 — no es una live region)", () => {
    render(<SnapshotVigenteBadge />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
