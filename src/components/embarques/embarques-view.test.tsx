import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { EmbarqueItem, EmbarquesFacetas, EmbarquesResponse, EmbarquesResumen } from "@/types/api";

// ------------------------------------------------------------
// Fake router/URL compartido por next/navigation (useRouter/usePathname/
// useSearchParams), mismo patrón que catalogo-view.test.tsx / cruce-view.test.tsx:
// reactivo vía useSyncExternalStore para que `router.replace(...)` re-renderice
// el componente con la nueva URL.
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
  usePathname: () => "/embarques/historico",
  useSearchParams: () => {
    const snapshot = React.useSyncExternalStore(fakeNav.subscribe, fakeNav.getSearch, fakeNav.getSearch);
    return new URLSearchParams(snapshot);
  },
}));

import { EmbarquesView } from "./embarques-view";

// ------------------------------------------------------------
// Fixtures — EmbarquesResponse completo.
// ------------------------------------------------------------
const ESTATUS_NOMBRES = [
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

function facetasBase(overrides: Partial<EmbarquesFacetas> = {}): EmbarquesFacetas {
  return {
    estatus: ESTATUS_NOMBRES.map((nombre, i) => ({ orden: i + 1, nombre, conteo: 0 })),
    paises: [
      { valor: "CN", conteo: 70 },
      { valor: "MX", conteo: 50 },
    ],
    ambito: { todos: 0, activos: 0, historial: 0 },
    ...overrides,
  };
}

function resumenBase(overrides: Partial<EmbarquesResumen> = {}): EmbarquesResumen {
  return { embarques: 0, piezas: 0, activos: 0, historial: 0, piezas_activas: 0, retrasados: 0, ...overrides };
}

function embarqueItem(overrides: Partial<EmbarqueItem> = {}): EmbarqueItem {
  return {
    id: "e1",
    sku: "A-1",
    descripcion: "Candado industrial",
    oc_po: "OC-1",
    proveedor: null,
    referencia: "REF-1",
    factura: "FAC-1",
    pais_origen: "CN",
    piezas: 100,
    fw: "FW-1",
    tipo_importacion: "MAR",
    fecha_recoleccion: null,
    etd: null,
    eta: "2026-08-01",
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: "En Aduana",
    estatus_orden: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    retrasado: false,
    ...overrides,
  };
}

function respuesta(overrides: Partial<EmbarquesResponse> = {}): EmbarquesResponse {
  return {
    snapshot: { id: "snap-1", created_at: "2026-07-01T00:00:00.000Z", filas: 120, archivo: "aduana.xlsx", vigente: true },
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    resumen: resumenBase(),
    facetas: facetasBase(),
    ...overrides,
  };
}

// ------------------------------------------------------------
// fetch mock: UN solo endpoint (`/api/embarques`, URL variable según
// filtros/orden/página) — A3 (revisor-codigo, ronda 2) eliminó el segundo
// fetch auxiliar de "conteos" (`?pageSize=1`): las 3 tabs ahora leen
// `data.facetas.ambito` de la MISMA respuesta.
// ------------------------------------------------------------
type Responder = (url: string) => { status: number; body: unknown };

let mainResponder: Responder = () => ({ status: 200, body: respuesta() });

function stubFetch(waitForMain: () => Promise<void> = () => Promise.resolve()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/embarques")) {
        await waitForMain();
        const { status, body } = mainResponder(url);
        return new Response(JSON.stringify(body), { status });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

/** Llamadas de fetch al endpoint principal. */
function mainCalls(): string[] {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.startsWith("/api/embarques"));
}

/**
 * Deferred controlado por el test (mismo patrón que
 * `config-usuarios.test.tsx`: `crearDeferred`/`esperarSoloEnRefetch`): la
 * carga INICIAL del endpoint principal resuelve de inmediato; cualquier
 * llamada posterior (refetch por cambio de filtro) queda colgada hasta que
 * el test llama `resolver()` explícitamente.
 */
function crearDeferred(): { promise: Promise<void>; resolver: () => void } {
  let resolver!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}
function esperarSoloEnRefetch(deferred: { promise: Promise<void> }): () => Promise<void> {
  let llamadas = 0;
  return () => (llamadas++ === 0 ? Promise.resolve() : deferred.promise);
}

describe("EmbarquesView", () => {
  beforeEach(() => {
    fakeNav.reset();
    mainResponder = () => ({ status: 200, body: respuesta() });
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ----------------------------------------------------------------
  // Gate de DoD del bloque: sin querystring, ambito=todos por default → el total,
  // incluyendo filas históricas (si abre en 8, el bloque se rechaza).
  // ----------------------------------------------------------------
  it("[Gate DoD] abre sin querystring: pide /api/embarques (ambito=todos implícito), muestra el total del ámbito e incluye filas históricas", async () => {
    mainResponder = () => ({
      status: 200,
      body: respuesta({
        items: [embarqueItem({ id: "e1", sku: "A-1", is_historial: false }), embarqueItem({ id: "h1", sku: "H-1", is_historial: true })],
        total: 120,
        resumen: resumenBase({ embarques: 120, activos: 8, historial: 112 }),
        facetas: facetasBase({ ambito: { todos: 120, activos: 8, historial: 112 } }),
      }),
    });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("120 resultados")).toBeInTheDocument());
    expect(mainCalls()[0]).toBe("/api/embarques");
    expect(screen.getByRole("link", { name: "A-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "H-1" })).toBeInTheDocument();
    expect(screen.getByText("Histórico")).toBeInTheDocument();
  });

  it("las 3 tabs muestran los conteos de facetas.ambito (fix A3 — universo del snapshot, independiente de otros filtros, SIN un segundo fetch)", async () => {
    mainResponder = () => ({
      status: 200,
      body: respuesta({ facetas: facetasBase({ ambito: { todos: 120, activos: 8, historial: 112 } }) }),
    });
    render(<EmbarquesView />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Todos (120)" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Activos (8)" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico (112)" })).toBeInTheDocument();
    // A3: un solo fetch alimenta tabla + tabs — ya no hay un segundo round-trip auxiliar.
    expect(mainCalls().filter((u) => u === "/api/embarques")).toHaveLength(1);
  });

  it("cada tab cambia ?ambito= (server-driven)", async () => {
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));

    // Radix TabsTrigger activa por `onMouseDown` (roving focus group), no por "click" — ver config-view.test.tsx.
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Activos/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?ambito=activos"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Histórico/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?ambito=historial"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: /^Todos/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques"));
  });

  it("cambiar de tab con ?page=2 activo resetea la página (se borra el param)", async () => {
    fakeNav.reset("page=2");
    mainResponder = (url) => {
      const page = Number(new URLSearchParams(url.split("?")[1] ?? "").get("page") ?? "1");
      return { status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], page, total: 120, totalPages: 3 }) };
    };
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?page=2"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Activos/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?ambito=activos"));
  });

  it("el buscador hace skip-empty: escribir y luego borrar no manda q= vacío", async () => {
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));

    const input = screen.getByLabelText("Buscar embarques");
    fireEvent.change(input, { target: { value: "OC-100" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?q=OC-100"));

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques"));
    expect(mainCalls().at(-1)).not.toContain("q=");
  });

  it("select de Estatus se alimenta de facetas.estatus (con conteo, fix B13) y construye ?estatus=", async () => {
    mainResponder = () => ({
      status: 200,
      body: respuesta({
        items: [embarqueItem({ sku: "A-1" })],
        total: 1,
        facetas: facetasBase({ estatus: facetasBase().estatus.map((f) => (f.orden === 7 ? { ...f, conteo: 8 } : f)) }),
      }),
    });
    render(<EmbarquesView />);

    await waitFor(() => expect(within(screen.getByLabelText("Estatus")).getByRole("option", { name: "En Aduana (8)" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "7" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?estatus=7"));
  });

  it("facetas.paises vacía: el panel 'Más filtros' NO pinta el select de País", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ facetas: facetasBase({ paises: [] }) }) });
    render(<EmbarquesView />);

    fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
    await waitFor(() => expect(screen.getByLabelText("Filtrar por fecha de")).toBeInTheDocument());
    expect(screen.queryByLabelText("País")).not.toBeInTheDocument();
  });

  it("cambiar el select de País (panel 'Más filtros') construye ?pais=", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    render(<EmbarquesView />);

    fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
    await waitFor(() => expect(screen.getByLabelText("País")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("País"), { target: { value: "MX" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?pais=MX"));
  });

  it("cambiar 'Desde' construye ?desde= (fechaCampo default 'eta' se omite de la URL)", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    render(<EmbarquesView />);

    fireEvent.click(screen.getByRole("button", { name: "Más filtros" }));
    await waitFor(() => expect(screen.getByLabelText("Desde")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?desde=2026-01-01"));
  });

  it("chips activos: ?pais=CN pinta 'País: CN' arriba de la tabla; la X lo limpia", async () => {
    fakeNav.reset("pais=CN");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ pais_origen: "CN" })], total: 1 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?pais=CN"));
    expect(screen.getByRole("button", { name: /País: CN/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /País: CN/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques"));
    expect(screen.queryByText("País: CN")).not.toBeInTheDocument();
  });

  it("chips activos: ?desde=/&hasta= pintan el chip del rango de fecha; la X limpia AMBOS", async () => {
    fakeNav.reset("desde=2026-01-01&hasta=2026-01-31");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?desde=2026-01-01&hasta=2026-01-31"));
    expect(screen.getByText("ETA: 2026-01-01 – 2026-01-31")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ETA: 2026-01-01/ }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques"));
  });

  it("sin país/rango activos: no aparece ningún chip arriba de la tabla", async () => {
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
    expect(screen.queryByText(/^País:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^ETA:/)).not.toBeInTheDocument();
  });

  it("el link del SKU apunta a /catalogo/{sku} (encodeURIComponent)", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A/B 1" })], total: 1 }) });
    render(<EmbarquesView />);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "A/B 1" })).toHaveAttribute("href", `/catalogo/${encodeURIComponent("A/B 1")}`),
    );
  });

  it("chip de retraso en tono warn, NUNCA danger/rojo", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ retrasado: true })], total: 1 }) });
    render(<EmbarquesView />);
    await waitFor(() => expect(screen.getByText("Retraso")).toBeInTheDocument());
    const chip = screen.getByText("Retraso");
    expect(chip.className).toContain("text-warn");
    expect(chip.className).not.toMatch(/danger|destructive/);
  });

  it("cambiar 'Ordenar por' a 'ETA próxima' construye ?dir=asc (orden='eta' es default, se omite)", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    render(<EmbarquesView />);
    await waitFor(() => expect(screen.getByLabelText("Ordenar por")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "eta_asc" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?dir=asc"));
  });

  it("cambiar 'Ordenar por' a 'Piezas: mayor a menor' construye ?orden=piezas (dir='desc' es default, se omite)", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    render(<EmbarquesView />);
    await waitFor(() => expect(screen.getByLabelText("Ordenar por")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "piezas_desc" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?orden=piezas"));
  });

  it("fix B12: ?orden=piezas&dir=asc (deep-link no curado) NO se rotula 'Piezas: mayor a menor' — cae a 'Más recientes'", async () => {
    fakeNav.reset("orden=piezas&dir=asc");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1", piezas: 5 })], total: 1 }) });
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?orden=piezas&dir=asc"));
    expect(screen.getByLabelText("Ordenar por")).toHaveValue("recientes");
  });

  it("cambiar de página construye ?page=", async () => {
    mainResponder = (url) => {
      const page = Number(new URLSearchParams(url.split("?")[1] ?? "").get("page") ?? "1");
      return { status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], page, total: 120, totalPages: 3 }) };
    };
    render(<EmbarquesView />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?page=2"));
  });

  it("?retrasado=1 (deep-link) activa el toggle con aria-pressed=true", async () => {
    fakeNav.reset("retrasado=1");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ retrasado: true })], total: 1 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?retrasado=1"));
    expect(screen.getByRole("button", { name: "Solo retrasados" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clic en 'Solo retrasados' activa ?retrasado=1 y un 2º clic lo quita", async () => {
    render(<EmbarquesView />);
    await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole("button", { name: "Solo retrasados" }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?retrasado=1"));

    fireEvent.click(screen.getByRole("button", { name: "Solo retrasados" }));
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques"));
  });

  // ----------------------------------------------------------------
  // Chrome persistente (P3 de docs/engineering/failure-patterns.md): durante un
  // refetch la tabla NO se desmonta — mismo nodo, solo `aria-busy` cambia.
  // ----------------------------------------------------------------
  it("FIX C: durante un refetch (cambio de tab) la tabla sigue montada (mismo nodo) y aria-busy pasa a true, luego a false", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    const deferred = crearDeferred();
    stubFetch(esperarSoloEnRefetch(deferred));
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByRole("link", { name: "A-1" })).toBeInTheDocument());
    const tablaAntes = screen.getByRole("table");
    expect(tablaAntes).toHaveAttribute("aria-busy", "false");

    fireEvent.mouseDown(screen.getByRole("tab", { name: /Activos/ }));

    await waitFor(() => expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("table")).toBe(tablaAntes);
    // Chrome persistente: los filtros/tabs siguen montados y respondiendo, no solo la tabla.
    expect(screen.getByText("A-1")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Activos/ })).toBeInTheDocument();

    deferred.resolver();

    await waitFor(() => expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByRole("table")).toBe(tablaAntes);
  });

  // ----------------------------------------------------------------
  // Los 4 estados: skeleton, error, vacío (cold-start y filtrado), fuera de rango.
  // ----------------------------------------------------------------
  it("loading inicial: muestra el skeleton de resultados, con el chrome (tabs) ya montado", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<EmbarquesView />);
    expect(screen.getByRole("status", { name: "Cargando el histórico…" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Todos/ })).toBeInTheDocument();
  });

  it("error (sin data previa): EstadoError con el mensaje del contrato y reintenta al hacer click", async () => {
    mainResponder = () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();

    mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("A-1")).toBeInTheDocument());
  });

  it("cold-start (snapshot null, sin filtros): copy + CTA a /snapshots", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ snapshot: null, total: 0 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Aún no hay embarques cargados.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Ir a Snapshots" })).toHaveAttribute("href", "/snapshots");
  });

  it("vacío filtrado (con filtro activo, total=0, snapshot vigente): 'Sin resultados' + Limpiar filtros resetea la URL", async () => {
    fakeNav.reset("q=zzz");
    mainResponder = () => ({ status: 200, body: respuesta({ total: 0 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("Ningún embarque coincide con los filtros actuales.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/embarques/historico");
  });

  it("página fuera de rango (items=[] con total>0): mensaje + 'Ir a la página 1'", async () => {
    fakeNav.reset("page=9");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [], page: 9, total: 40, totalPages: 4 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Sin resultados en esta página")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ir a la página 1" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/embarques/historico");
  });

  // ----------------------------------------------------------------
  // Fix B11: "N resultados" + "Ordenar por" ya NO se desmontan en
  // cold-start/vacío/fuera-de-rango — condicionados SOLO a `data`.
  // ----------------------------------------------------------------
  it("fix B11: en 'página fuera de rango' la barra 'N resultados'/'Ordenar por' SIGUE visible (se puede reordenar sin volver primero a la página 1)", async () => {
    fakeNav.reset("page=9");
    mainResponder = () => ({ status: 200, body: respuesta({ items: [], page: 9, total: 40, totalPages: 4 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Sin resultados en esta página")).toBeInTheDocument());
    expect(screen.getByText("40 resultados")).toBeInTheDocument();
    expect(screen.getByLabelText("Ordenar por")).toBeInTheDocument();
  });

  it("fix B11: en 'vacío filtrado' la barra '0 resultados'/'Ordenar por' SIGUE visible", async () => {
    fakeNav.reset("q=zzz");
    mainResponder = () => ({ status: 200, body: respuesta({ total: 0 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("0 resultados")).toBeInTheDocument();
    expect(screen.getByLabelText("Ordenar por")).toBeInTheDocument();
  });

  it("fix B11: en cold-start la barra NO se pinta (no hay `data` que mostrar antes del primer fetch resuelto, pero sí después: '0 resultados')", async () => {
    mainResponder = () => ({ status: 200, body: respuesta({ snapshot: null, total: 0 }) });
    render(<EmbarquesView />);

    await waitFor(() => expect(screen.getByText("Aún no hay embarques cargados.")).toBeInTheDocument());
    // Con `data` ya en mano (aunque sea cold-start), la barra se pinta igual que cualquier otro estado con `data`.
    expect(screen.getByText("0 resultados")).toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // Fix M8: rango de fecha invertido (desde > hasta) — NO dispara fetch,
  // valida inline, conserva la tabla montada con sus datos previos.
  // ----------------------------------------------------------------
  describe("fix M8: guard de rango de fecha invertido", () => {
    it("deep-link ya invertido desde el arranque: NO dispara ningún fetch y muestra la validación inline", async () => {
      fakeNav.reset("desde=2026-02-01&hasta=2026-01-01");
      render(<EmbarquesView />);

      await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Desde”"));
      expect(screen.getByText("Corrige el rango de fechas")).toBeInTheDocument();
      expect(mainCalls()).toEqual([]);
    });

    it("editar 'Hasta' a una fecha anterior a 'Desde' congela la tabla (NO la reemplaza por error) y no dispara un fetch nuevo", async () => {
      fakeNav.reset("desde=2026-01-01");
      mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
      render(<EmbarquesView />);
      await waitFor(() => expect(screen.getByText("A-1")).toBeInTheDocument());
      const llamadasAntes = mainCalls().length;

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2025-01-01" } });

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      // La tabla con los datos previos sigue montada — no se reemplaza por EstadoError ni por el skeleton.
      expect(screen.getByText("A-1")).toBeInTheDocument();
      expect(mainCalls().length).toBe(llamadasAntes);
    });

    it("corregir el rango (Hasta >= Desde) vuelve a disparar el fetch con la URL corregida", async () => {
      fakeNav.reset("desde=2026-01-01&hasta=2025-01-01");
      mainResponder = () => ({ status: 200, body: respuesta({ items: [embarqueItem({ sku: "A-1" })], total: 1 }) });
      render(<EmbarquesView />);
      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(mainCalls()).toEqual([]);

      fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-06-01" } });

      await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/embarques?desde=2026-01-01&hasta=2026-06-01"));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    });
  });
});
