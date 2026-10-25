import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotsVigentesBanner } from "./snapshots-vigentes-banner";
import type { SkuSnapshotInfo } from "@/types/api";

function snap(overrides: Partial<SkuSnapshotInfo> = {}): SkuSnapshotInfo {
  return { id: "s1", created_at: "2026-07-20T08:00:00.000Z", filas: 100, archivo: "a.xlsx", vigente: true, ...overrides };
}

describe("SnapshotsVigentesBanner", () => {
  it("muestra la fecha del vigente de cada fuente", () => {
    render(
      <SnapshotsVigentesBanner
        vigentes={{
          stock: snap({ id: "stock-1", created_at: "2026-07-20T08:00:00.000Z" }),
          aduana: snap({ id: "aduana-1", created_at: "2026-07-15T10:30:00.000Z" }),
        }}
      />,
    );
    expect(screen.getByText(/Inventario/)).toBeInTheDocument();
    expect(screen.getByText(/Embarques/)).toBeInTheDocument();
  });

  it("fuente sin snapshot aún (null) → no inventa una fecha", () => {
    render(<SnapshotsVigentesBanner vigentes={{ stock: null, aduana: null }} />);
    expect(screen.getAllByText(/sin ingesta aún/)).toHaveLength(2);
  });

  it("una fuente con dato y la otra sin dato conviven en el mismo banner", () => {
    render(<SnapshotsVigentesBanner vigentes={{ stock: snap(), aduana: null }} />);
    expect(screen.getByText(/sin ingesta aún/)).toBeInTheDocument();
  });
});
