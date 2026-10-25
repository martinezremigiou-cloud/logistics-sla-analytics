import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { SnapshotsView } from "./snapshots-view";
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

function pageResponse(overrides: Partial<SnapshotsPage> = {}): SnapshotsPage {
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

/** Deferred controlado por el test (mismo patrón que config-usuarios.test.tsx): el test decide explícitamente cuándo "termina" un GET pendiente. */
function crearDeferred<T>(): { promise: Promise<T>; resolver: (v: T) => void } {
  let resolver!: (v: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

type Handler = () => Promise<{ status: number; body: unknown }>;

let stockHandler: Handler = async () => ({ status: 200, body: pageResponse() });
let aduanaHandler: Handler = async () => ({ status: 200, body: pageResponse() });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith("/api/snapshots")) throw new Error("URL no manejada: " + url);
      const handler = url.includes("fuente=aduana") ? aduanaHandler : stockHandler;
      const { status, body } = await handler();
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

function callsFor(fuente: "stock" | "aduana"): string[] {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.includes(`fuente=${fuente}`));
}

describe("SnapshotsView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    stockHandler = async () => ({ status: 200, body: pageResponse() });
    aduanaHandler = async () => ({ status: 200, body: pageResponse() });
  });

  it("primera pintura: muestra el skeleton compuesto de 2 tarjetas mientras NINGUNA columna resolvió", () => {
    const stockDeferred = crearDeferred<{ status: number; body: unknown }>();
    const aduanaDeferred = crearDeferred<{ status: number; body: unknown }>();
    stockHandler = () => stockDeferred.promise;
    aduanaHandler = () => aduanaDeferred.promise;
    stubFetch();

    render(<SnapshotsView />);
    expect(screen.getByRole("status", { name: "Cargando snapshots…" })).toBeInTheDocument();
  });

  it("dos columnas por fuente: 'Inventario' (stock) y 'Embarques' (aduana)", async () => {
    stubFetch();
    render(<SnapshotsView />);

    await waitFor(() => expect(screen.getByText("Inventario")).toBeInTheDocument());
    expect(screen.getByText("Embarques")).toBeInTheDocument();
  });

  it("banner de vigentes: usa `vigentes` de la respuesta para ambas fuentes", async () => {
    const vigentes = {
      stock: { id: "s-vig", created_at: "2026-07-20T08:00:00.000Z", filas: 1846, archivo: "a.xlsx", vigente: true },
      aduana: { id: "a-vig", created_at: "2026-07-15T10:00:00.000Z", filas: 214, archivo: "b.xlsx", vigente: true },
    };
    stockHandler = async () => ({ status: 200, body: pageResponse({ vigentes }) });
    aduanaHandler = async () => ({ status: 200, body: pageResponse({ vigentes }) });
    stubFetch();

    render(<SnapshotsView />);
    await waitFor(() => expect(screen.getByText(/Vigente:/)).toBeInTheDocument());
  });

  it("marca el vigente SOLO en la fila correspondiente de su fuente", async () => {
    stockHandler = async () => ({
      status: 200,
      body: pageResponse({ items: [item({ id: "stock-vig", vigente: true })] }),
    });
    aduanaHandler = async () => ({
      status: 200,
      body: pageResponse({ items: [item({ id: "aduana-1", fuente: "aduana", vigente: false })] }),
    });
    stubFetch();

    render(<SnapshotsView />);
    await waitFor(() => expect(screen.getAllByText("Snapshot vigente")).toHaveLength(1));
  });

  it("paginar una columna NO reinicia ni refetchea la columna hermana", async () => {
    stockHandler = async () => ({ status: 200, body: pageResponse({ page: 1, totalPages: 2, total: 25 }) });
    aduanaHandler = async () => ({ status: 200, body: pageResponse({ page: 1, totalPages: 1, total: 1 }) });
    stubFetch();

    render(<SnapshotsView />);
    await waitFor(() => expect(screen.getByText("Inventario")).toBeInTheDocument());

    expect(callsFor("aduana")).toHaveLength(1);

    const inventarioCard = screen.getByText("Inventario").closest("div")!;
    const next = within(inventarioCard).getByRole("button", { name: "Página siguiente" });
    fireEvent.click(next);

    await waitFor(() => expect(callsFor("stock")).toHaveLength(2));
    expect(callsFor("stock").at(-1)).toContain("page=2");
    // La columna "Embarques" no debió disparar una segunda petición.
    expect(callsFor("aduana")).toHaveLength(1);
  });

  it("chrome persistente: durante el refetch de una columna (cambio de página), sus filas siguen montadas con aria-busy, sin remontar a skeleton", async () => {
    stockHandler = async () => ({ status: 200, body: pageResponse({ items: [item({ id: "s1" })], page: 1, totalPages: 2, total: 25 }) });
    aduanaHandler = async () => ({ status: 200, body: pageResponse({ page: 1, totalPages: 1, total: 1 }) });
    stubFetch();

    render(<SnapshotsView />);
    await waitFor(() => expect(screen.getAllByRole("list")).toHaveLength(2));

    const [listaInventarioAntes] = screen.getAllByRole("list");
    expect(listaInventarioAntes).toHaveAttribute("aria-busy", "false");

    const deferred = crearDeferred<{ status: number; body: unknown }>();
    stockHandler = () => deferred.promise;

    const inventarioCard = screen.getByText("Inventario").closest("div")!;
    const next = within(inventarioCard).getByRole("button", { name: "Página siguiente" });
    fireEvent.click(next);

    // Mientras el refetch está en vuelo, la MISMA lista (mismo nodo) sigue en el DOM, marcada aria-busy.
    await waitFor(() => expect(screen.getAllByRole("list")[0]).toHaveAttribute("aria-busy", "true"));
    expect(screen.getAllByRole("list")[0]).toBe(listaInventarioAntes);
    // No remonta al skeleton compuesto de 2 tarjetas.
    expect(screen.queryByRole("status", { name: "Cargando snapshots…" })).not.toBeInTheDocument();

    deferred.resolver({ status: 200, body: pageResponse({ items: [item({ id: "s1" })], page: 2, totalPages: 2, total: 25 }) });
    await waitFor(() => expect(screen.getAllByRole("list")[0]).toHaveAttribute("aria-busy", "false"));
  });

  it("error en una fuente no impide que la otra muestre sus datos", async () => {
    stockHandler = async () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    aduanaHandler = async () => ({ status: 200, body: pageResponse() });
    stubFetch();

    render(<SnapshotsView />);
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());
    expect(screen.getByRole("list")).toBeInTheDocument();
  });
});
