import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardSkeleton } from "./dashboard-skeleton";

describe("DashboardSkeleton", () => {
  it("expone role=status con el label de carga del panel", () => {
    render(<DashboardSkeleton />);
    expect(screen.getByRole("status", { name: "Cargando panel…" })).toBeInTheDocument();
  });

  it("imita las 5 filas del layout real (4 KPIs + 4 filas de 2 cards)", () => {
    const { container } = render(<DashboardSkeleton />);
    // 4 skeletons de KPI + 4 filas * 2 = 8 skeletons de card → 12 en total.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(12);
  });
});
