import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CruceEmbarqueItem, CruceEtapa, CruceResponse, SkuDetalle } from "@/types/api";
import { separarFamilias } from "@/lib/familias";

// ------------------------------------------------------------
// Fake router/URL compartido por next/navigation (mismo patrón que
// `catalogo-view.test.tsx`): reactivo vía useSyncExternalStore para que
// `router.replace(...)` re-renderice el componente con la nueva URL.
// ------------------------------------------------------------
const fakeNav = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const replaceCalls: string[] = [];

  return {
    getSearch: () => search,
    setSearch: (s: string) => {
      search = s;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    replaceCalls,
    reset: (initial = "") => {
      search = initial;
      replaceCalls.length = 0;
      listeners.clear();
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (url: string) => {
      fakeNav.replaceCalls.push(url);
      const qIndex = url.indexOf("?");
      fakeNav.setSearch(qIndex === -1 ? "" : url.slice(qIndex + 1));
    },
  }),
  useSearchParams: () => {
    const snapshot = React.useSyncExternalStore(fakeNav.subscribe, fakeNav.getSearch, fakeNav.getSearch);
    return new URLSearchParams(snapshot);
  },
}));

import { CruceView } from "./cruce-view";

const NOMBRES = [
  "Producto Solicitado",
  "En Preparación",
  "En Recolección",
  "En Almacén FW",
  "En Tránsito Aéreo",
  "En Tránsito Marítimo",
  "En Aduana",
  "En Tránsito Terrestre",
  "En Almacén Fiscal",
  "En Almacén North",
  "Producto Disponible",
];

function etapaBase(orden: number, nombre: string): CruceEtapa {
  return { orden, nombre, activos: { embarques: 0, piezas: 0 }, historial: { embarques: 0, piezas: 0 }, items: [] };
}

function embarqueItem(overrides: Partial<CruceEmbarqueItem> = {}): CruceEmbarqueItem {
  return {
    id: "e1",
    sku: "A-1",
    descripcion: "Candado industrial",
    oc_po: "OC-1",
    proveedor: "PROV",
    piezas: 100,
    tipo_importacion: "MAR",
    pais_origen: "CN",
    etd: null,
    eta: "2026-08-01T12:00:00.000Z",
    fecha_llegada: null,
    fecha_disponibilidad: null,
    proyecto: null,
    retrasado: false,
    ...overrides,
  };
}

function cruce(overrides: Partial<CruceResponse> = {}): CruceResponse {
  return {
    snapshot: null,
    resumen: { embarques_activos: 0, piezas_activas: 0, embarques_historial: 0, piezas_historial: 0 },
    etapas: NOMBRES.map((n, i) => etapaBase(i + 1, n)),
    skus_activos: [],
    ...overrides,
  };
}

function detalle(overrides: Partial<SkuDetalle> = {}): SkuDetalle {
  // `familias_efectivas` se deriva SIEMPRE con la función real `separarFamilias`
  // (invariante INV-TAXO F2) — mismo criterio que `ficha-view.test.tsx`.
  const familia_efectiva = overrides.familia_efectiva === undefined ? "CANDADOS" : overrides.familia_efectiva;
  return {
    sku: "A-1",
    marca: "BRAND1",
    marca_excluida: false,
    familia_efectiva,
    familias_efectivas: separarFamilias(familia_efectiva),
    descr_efectiva: "Descripción A",
    original: { familia: "CANDADOS", descr: "Descripción A" },
    stock: [],
    total: 0,
    reservado: 0,
    disponible: 0,
    sobre_reservado: false,
    reserva_descuadre: false,
    reservas: [],
    embarques: [],
    piezas_en_camino: 0,
    piezas_historial: 0,
    imagen_url: null,
    snapshot: { stock: null, aduana: null },
    // Requerido (no opcional) en `SkuDetalle` — hoy siempre `false` (la
    // migración 0011 que puebla esta señal aún no corre en runtime real).
    decidido_en_bandeja: { marca: false },
    ...overrides,
  };
}

type CruceResponder = () => { status: number; body: unknown };
let cruceResponder: CruceResponder = () => ({ status: 200, body: cruce() });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/cruce")) {
        const { status, body } = cruceResponder();
        return new Response(JSON.stringify(body), { status });
      }
      if (url.startsWith("/api/sku/")) {
        const sku = decodeURIComponent(url.replace("/api/sku/", ""));
        return new Response(JSON.stringify(detalle({ sku })), { status: 200 });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

describe("CruceView", () => {
  beforeEach(() => {
    fakeNav.reset();
    cruceResponder = () => ({ status: 200, body: cruce() });
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pipeline en loading: muestra el skeleton del pipeline", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<CruceView />);
    expect(screen.getByRole("status", { name: "Cargando pipeline de aduana…" })).toBeInTheDocument();
  });

  it("pipeline en error: EstadoError, pero la sección de foco sigue renderizando su propio estado", async () => {
    cruceResponder = () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    render(<CruceView />);

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();
    // La sección de foco, independiente del pipeline, sigue funcionando.
    expect(screen.getByText("Elige un SKU")).toBeInTheDocument();
  });

  it("?sku=X inicial dispara el fetch de /api/sku/X", async () => {
    fakeNav.reset("sku=A-1");
    render(<CruceView />);

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls.some((c: unknown[]) => String(c[0]) === "/api/sku/A-1")).toBe(true);
    });
  });

  it("clic en un chip de 'Viendo' actualiza el foco y llama router.replace con ?sku=", async () => {
    cruceResponder = () => ({ status: 200, body: cruce({ skus_activos: ["A-1", "B-2"] }) });
    render(<CruceView />);

    await waitFor(() => expect(screen.getByRole("button", { name: "B-2" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "B-2" }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/embarques?sku=B-2");
    await waitFor(() => expect(screen.getByRole("heading", { name: "B-2" })).toBeInTheDocument());
  });

  // ------------------------------------------------------------
  // Bloque 6 · F4: drill-down `?retrasado=1` (enlace del dashboard).
  // ------------------------------------------------------------
  it("?retrasado=1: filtra client-side las filas visibles de la etapa seleccionada, sin tocar los agregados reales del rail", async () => {
    fakeNav.reset("retrasado=1");
    const etapas = NOMBRES.map((n, i) => etapaBase(i + 1, n));
    etapas[6] = {
      ...etapas[6],
      activos: { embarques: 2, piezas: 150 },
      items: [embarqueItem({ id: "e1", sku: "A-1", retrasado: false }), embarqueItem({ id: "e2", sku: "B-2", retrasado: true })],
    };
    cruceResponder = () => ({ status: 200, body: cruce({ etapas }) });
    render(<CruceView />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Solo retrasados/ })).toBeInTheDocument());
    // El rail sigue mostrando el agregado REAL (2 activos), no recalculado sobre el subconjunto filtrado.
    expect(screen.getByLabelText("2 embarques activos")).toBeInTheDocument();

    fireEvent.click(screen.getByText("En Aduana"));
    await waitFor(() => expect(screen.getByText("B-2")).toBeInTheDocument());
    expect(screen.queryByText("A-1")).not.toBeInTheDocument();
  });

  it("la × del chip 'Solo retrasados' limpia SOLO ese param, preservando ?sku=", async () => {
    fakeNav.reset("retrasado=1&sku=A-1");
    render(<CruceView />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Solo retrasados/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Solo retrasados/ }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/embarques?sku=A-1");
    expect(screen.queryByRole("button", { name: /Solo retrasados/ })).not.toBeInTheDocument();
  });

  it("sin ?retrasado=1: no aparece el chip y la etapa muestra TODOS los items (retrasados o no)", async () => {
    const etapas = NOMBRES.map((n, i) => etapaBase(i + 1, n));
    etapas[6] = {
      ...etapas[6],
      items: [embarqueItem({ id: "e1", sku: "A-1", retrasado: false }), embarqueItem({ id: "e2", sku: "B-2", retrasado: true })],
    };
    cruceResponder = () => ({ status: 200, body: cruce({ etapas }) });
    render(<CruceView />);

    expect(screen.queryByRole("button", { name: /Solo retrasados/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByText("En Aduana"));
    expect(await screen.findByText("A-1")).toBeInTheDocument();
    expect(screen.getByText("B-2")).toBeInTheDocument();
  });
});
