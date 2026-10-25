import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotIdentidadHeader } from "./snapshot-identidad-header";
import type { CambiosPage } from "@/types/api";

function snapshot(overrides: Partial<CambiosPage["snapshot"]> = {}): CambiosPage["snapshot"] {
  return {
    id: "snap-1",
    fuente: "aduana",
    periodo: "2026-07",
    archivo: "embarques.xlsx",
    filas: 214,
    hash: "abcdef0123456789fedcba9876543210",
    created_at: "2026-07-20T08:00:00.000Z",
    created_by: null,
    vigente: true,
    detectado_en: "2026-07-20T08:00:05.000Z",
    ...overrides,
  };
}

describe("SnapshotIdentidadHeader", () => {
  it("muestra la fuente traducida, el periodo, el archivo y los registros ingeridos", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot()} />);
    expect(screen.getByText("Embarques")).toBeInTheDocument();
    expect(screen.getByText("embarques.xlsx")).toBeInTheDocument();
    expect(screen.getByText("214")).toBeInTheDocument();
  });

  it("muestra el hash COMPLETO (no el hash_corto)", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ hash: "hash-completo-de-64-caracteres-simulado-aqui-1234567890" })} />);
    expect(screen.getByText(/hash-completo-de-64-caracteres-simulado-aqui-1234567890/)).toBeInTheDocument();
  });

  it("detectado_en aparece UNA sola vez en el encabezado", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ detectado_en: "2026-07-20T08:00:05.000Z" })} />);
    const matches = screen.getAllByText(/Detectado en/);
    expect(matches).toHaveLength(1);
  });

  it("vigente:true → muestra el badge 'Snapshot vigente'", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ vigente: true })} />);
    expect(screen.getByText("Snapshot vigente")).toBeInTheDocument();
  });

  it("vigente:false → NO muestra el badge", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ vigente: false })} />);
    expect(screen.queryByText("Snapshot vigente")).not.toBeInTheDocument();
  });

  it("created_by null → 'Ingesta automática'", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ created_by: null })} />);
    expect(screen.getByText(/Ingesta automática/)).toBeInTheDocument();
  });

  it("filas null → '—' (nunca un 0 inventado)", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ filas: null })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("archivo null → '—'", () => {
    render(<SnapshotIdentidadHeader snapshot={snapshot({ archivo: null })} />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
