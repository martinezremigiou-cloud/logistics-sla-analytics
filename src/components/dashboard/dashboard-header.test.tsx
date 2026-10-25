import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SkuSnapshotInfo } from "@/types/api";
import { DashboardHeader } from "./dashboard-header";

function snapshot(overrides: Partial<SkuSnapshotInfo> = {}): SkuSnapshotInfo {
  // (MVP-CIERRE F6) `2026-07-10T00:00:00Z` es **09-jul 18:00 en México**.
  // El fixture cae a propósito en la ventana 18:00–23:59 local, que es donde
  // UTC y México discrepan de día — es el caso que producía "corte 10-jul"
  // en el Dashboard mientras el badge decía "09-jul". Si alguien lo cambia
  // a mediodía, este archivo deja de proteger nada.
  return { id: "snap-1", created_at: "2026-07-10T00:00:00.000Z", filas: 900, archivo: "stock.xlsx", vigente: true, ...overrides };
}

// [FIX-B1 · T3] Un día antes que `snapshot()`, misma ventana 18:00-23:59 en
// México, para que la fecha de aduana en pantalla sea DISTINGUIBLE de la de
// stock — si una prueba mezclara las dos, esto lo delata.
function snapshotAduana(overrides: Partial<SkuSnapshotInfo> = {}): SkuSnapshotInfo {
  return { id: "snap-aduana-1", created_at: "2026-07-09T00:00:00.000Z", filas: 40, archivo: "aduana.xlsx", vigente: true, ...overrides };
}

describe("DashboardHeader", () => {
  it("saludo SIEMPRE visible (independiente del snapshot)", () => {
    render(<DashboardHeader nombre="usuariodemo" snapshotStock={null} snapshotAduana={null} />);
    expect(screen.getByRole("heading", { name: "Hola, usuariodemo" })).toBeInTheDocument();
    expect(screen.getByText("Resumen operativo")).toBeInTheDocument();
  });

  it("snapshotStock null: sin línea de corte ni pill de frescura (aunque haya snapshotAduana)", () => {
    render(<DashboardHeader nombre="ana" snapshotStock={null} snapshotAduana={snapshotAduana()} />);
    expect(screen.queryByText(/Inventario al/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Embarques al/)).not.toBeInTheDocument();
    expect(screen.queryByText("Snapshot vigente")).not.toBeInTheDocument();
  });

  it("snapshotStock y snapshotAduana presentes: 'Inventario al … · Embarques al …' + pill de frescura", () => {
    render(<DashboardHeader nombre="ana" snapshotStock={snapshot()} snapshotAduana={snapshotAduana()} />);
    // 09/08, no 10/09: la zona la fija el DATO (México), no el runtime.
    expect(screen.getByText("Inventario al 09 jul 2026, 06:00 p.m. · Embarques al 08 jul 2026, 06:00 p.m.")).toBeInTheDocument();
    expect(screen.getByText("Snapshot vigente")).toBeInTheDocument();
  });

  it("snapshotAduana null (aún no hay ingesta de aduana): sólo la cláusula de inventario, sin inventar una fecha de embarques", () => {
    render(<DashboardHeader nombre="ana" snapshotStock={snapshot()} snapshotAduana={null} />);
    expect(screen.getByText("Inventario al 09 jul 2026, 06:00 p.m.")).toBeInTheDocument();
    expect(screen.queryByText(/Embarques al/)).not.toBeInTheDocument();
  });
});
