import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotsSkeleton } from "./snapshots-skeleton";

describe("SnapshotsSkeleton", () => {
  it("expone role='status' para el lector de pantalla", () => {
    render(<SnapshotsSkeleton />);
    expect(screen.getByRole("status", { name: "Cargando snapshots…" })).toBeInTheDocument();
  });
});
