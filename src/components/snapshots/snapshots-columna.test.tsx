import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SnapshotsColumna } from "./snapshots-columna";
import type { SnapshotBitacoraItem, SnapshotsPage } from "@/types/api";

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

function page(overrides: Partial<SnapshotsPage> = {}): SnapshotsPage {
  return {
    items: [item()],
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
    vigentes: { stock: null, aduana: null },
    ...overrides,
  };
}

describe("SnapshotsColumna", () => {
  it("loading sin data → skeleton de filas", () => {
    render(<SnapshotsColumna titulo="Inventario" data={null} error={null} loading={true} onRetry={vi.fn()} page={1} onPageChange={vi.fn()} />);
    expect(screen.getByText("Inventario")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("error sin data → EstadoError con reintento", () => {
    const onRetry = vi.fn();
    render(
      <SnapshotsColumna
        titulo="Embarques"
        data={null}
        error={{ error: "internal_error", message: "Fallo interno" }}
        loading={false}
        onRetry={onRetry}
        page={1}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();
    screen.getByRole("button", { name: "Reintentar" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("total 0 → vacío específico de la fuente", () => {
    render(
      <SnapshotsColumna
        titulo="Embarques"
        data={page({ items: [], total: 0, totalPages: 0 })}
        error={null}
        loading={false}
        onRetry={vi.fn()}
        page={1}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Aún no hay snapshots registrados para esta fuente.")).toBeInTheDocument();
  });

  it("con datos → renderiza la lista y la paginación", () => {
    render(
      <SnapshotsColumna
        titulo="Inventario"
        data={page({ items: [item({ id: "a" }), item({ id: "b" })], total: 2 })}
        error={null}
        loading={false}
        onRetry={vi.fn()}
        page={1}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText(/resultados/)).toBeInTheDocument();
  });

  it("chrome persistente: durante un refetch (loading=true con data previa) la lista sigue montada, marcada aria-busy", () => {
    const { rerender } = render(
      <SnapshotsColumna titulo="Inventario" data={page()} error={null} loading={false} onRetry={vi.fn()} page={1} onPageChange={vi.fn()} />,
    );
    const listaAntes = screen.getByRole("list");
    expect(listaAntes).toHaveAttribute("aria-busy", "false");

    rerender(<SnapshotsColumna titulo="Inventario" data={page()} error={null} loading={true} onRetry={vi.fn()} page={2} onPageChange={vi.fn()} />);

    const listaDespues = screen.getByRole("list");
    expect(listaDespues).toBe(listaAntes);
    expect(listaDespues).toHaveAttribute("aria-busy", "true");
  });

  it("Paginacion muestra la página EN VIVO (prop `page`), no la `data.page` stale de la respuesta anterior durante un refetch", () => {
    const { rerender } = render(
      <SnapshotsColumna
        titulo="Inventario"
        data={page({ page: 1, totalPages: 5, total: 90 })}
        error={null}
        loading={false}
        onRetry={vi.fn()}
        page={1}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Página 1 de 5/)).toBeInTheDocument();

    // El usuario ya pidió la página 3 (prop `page` cambia), pero la
    // respuesta previa (`data`, con page:1) SIGUE montada porque el
    // refetch está en vuelo (chrome persistente) — la paginación debe
    // reflejar la página que se está pidiendo, no la que ya quedó vieja.
    rerender(
      <SnapshotsColumna
        titulo="Inventario"
        data={page({ page: 1, totalPages: 5, total: 90 })}
        error={null}
        loading={true}
        onRetry={vi.fn()}
        page={3}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Página 3 de 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Página 1 de 5/)).not.toBeInTheDocument();
  });

  it("página fuera de rango (items vacíos con total>0) ofrece volver a la página 1", () => {
    const onPageChange = vi.fn();
    render(
      <SnapshotsColumna
        titulo="Inventario"
        data={page({ items: [], total: 5, page: 3, totalPages: 1 })}
        error={null}
        loading={false}
        onRetry={vi.fn()}
        page={3}
        onPageChange={onPageChange}
      />,
    );
    screen.getByRole("button", { name: "Ir a la página 1" }).click();
    expect(onPageChange).toHaveBeenCalledWith(1);
  });
});
