import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotFila } from "./snapshot-fila";
import type { SnapshotBitacoraItem } from "@/types/api";

function item(overrides: Partial<SnapshotBitacoraItem> = {}): SnapshotBitacoraItem {
  return {
    id: "snap-1",
    fuente: "stock",
    periodo: "2026-07",
    archivo: "julio.xlsx",
    filas: 1846,
    created_at: "2026-07-20T08:00:00.000Z",
    created_by: null,
    hash_corto: "abcdef012345",
    cambios: { total: 0, altas: 0, bajas: 0, modificaciones: 0 },
    vigente: false,
    ...overrides,
  };
}

function renderFila(overrides: Partial<SnapshotBitacoraItem> = {}) {
  return render(
    <ul>
      <SnapshotFila item={item(overrides)} />
    </ul>,
  );
}

describe("SnapshotFila", () => {
  it("muestra el rótulo 'N registros ingeridos', nunca 'filas del archivo'", () => {
    renderFila({ filas: 1846 });
    expect(screen.getByText(/1,846 registros ingeridos/)).toBeInTheDocument();
    expect(screen.queryByText(/filas del archivo/i)).not.toBeInTheDocument();
  });

  it("created_by null → 'Ingesta automática' (nunca '—')", () => {
    renderFila({ created_by: null });
    expect(screen.getByText(/Ingesta automática/)).toBeInTheDocument();
  });

  it("created_by presente → se muestra el autor real", () => {
    renderFila({ created_by: "admin@example.com" });
    expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
  });

  it("archivo null → '—'", () => {
    renderFila({ archivo: null });
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("vigente:true → muestra el badge 'Snapshot vigente'", () => {
    renderFila({ vigente: true });
    expect(screen.getByText("Snapshot vigente")).toBeInTheDocument();
  });

  it("vigente:false → NO muestra el badge", () => {
    renderFila({ vigente: false });
    expect(screen.queryByText("Snapshot vigente")).not.toBeInTheDocument();
  });

  it("cambios.total === 0 → texto plano 'Sin cambios', SIN enlace", () => {
    renderFila({ cambios: { total: 0, altas: 0, bajas: 0, modificaciones: 0 } });
    expect(screen.getByText("Sin cambios")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("cambios.total > 0 → pill '{n} cambios' como link a /snapshots/{id}, con desglose visible", () => {
    renderFila({ id: "snap-42", cambios: { total: 173, altas: 94, bajas: 43, modificaciones: 36 } });
    const link = screen.getByRole("link", { name: "173 cambios" });
    expect(link).toHaveAttribute("href", "/snapshots/snap-42");
    expect(screen.getByText(/94 altas · 43 bajas · 36 modificaciones/)).toBeInTheDocument();
  });

  it("NUNCA oculta ceros en el desglose (mentir por omisión)", () => {
    renderFila({ cambios: { total: 2, altas: 0, bajas: 2, modificaciones: 0 } });
    expect(screen.getByText(/0 altas · 2 bajas · 0 modificaciones/)).toBeInTheDocument();
  });
});
