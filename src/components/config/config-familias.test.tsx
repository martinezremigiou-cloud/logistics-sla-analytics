import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { ConfigFamilias } from "./config-familias";

// Mock de sonner (mismo patrón que config-usuarios.test.tsx): sin
// <Toaster/> montado, los toasts no dejan rastro en el DOM — se espía
// toast.success para distinguir el aviso de alta del de reactivación
// (D, [MVP-2]).
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function stubFetch(handlers: { get?: unknown; postStatus?: number; postBody?: unknown }) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(JSON.stringify(handlers.get ?? { items: [] }), { status: 200 });
    return new Response(JSON.stringify(handlers.postBody ?? {}), { status: handlers.postStatus ?? 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Deferred controlado por el test (mismo mecanismo que
 * `config-usuarios.test.tsx`, `crearDeferred`): en vez de un `setTimeout`
 * atado al reloj, el test decide EXPLÍCITAMENTE cuándo "termina" el GET de
 * refetch, para observar de forma determinista el estado intermedio
 * `loading:true` con `data` ya poblada.
 */
function crearDeferred(): { promise: Promise<void>; resolver: () => void } {
  let resolver!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

/** GET inicial resuelve de inmediato; el 2do GET (el refetch que dispara el alta) queda colgado hasta `deferred.resolver()`. */
function stubFetchConRefetchDiferido(deferred: { promise: Promise<void> }) {
  let llamadasGet = 0;
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") {
      llamadasGet += 1;
      if (llamadasGet > 1) await deferred.promise;
      return new Response(JSON.stringify({ items: [{ id: "f1", nombre: "CANDADOS", activo: true }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "f2", nombre: "CINTAS", activo: true }), { status: 201 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ConfigFamilias", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pinta los chips de familias existentes", async () => {
    stubFetch({ get: { items: [{ id: "f1", nombre: "CANDADOS", activo: true }] } });
    render(<ConfigFamilias />);
    expect(await screen.findByText("CANDADOS")).toBeInTheDocument();
  });

  it("lista vacía muestra el mensaje neutro", async () => {
    stubFetch({ get: { items: [] } });
    render(<ConfigFamilias />);
    expect(await screen.findByText("Aún no hay familias en el catálogo.")).toBeInTheDocument();
  });

  it("alta exitosa: POST con el nombre recortado, limpia el input, refresca la lista y avisa 'Familia agregada.'", async () => {
    const fetchMock = stubFetch({ get: { items: [] }, postStatus: 201, postBody: { id: "f2", nombre: "CINTAS", activo: true, reactivada: false } });
    render(<ConfigFamilias />);
    await screen.findByText("Aún no hay familias en el catálogo.");

    fireEvent.change(screen.getByLabelText("Nueva familia"), { target: { value: "  CINTAS  " } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/familias",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ nombre: "CINTAS" }) }),
      ),
    );
    await waitFor(() => expect((screen.getByLabelText("Nueva familia") as HTMLInputElement).value).toBe(""));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Familia agregada."));
  });

  it("reactivación (D, MVP-2): respuesta con reactivada:true avisa 'Familia reactivada.' en vez de 'Familia agregada.'", async () => {
    stubFetch({ get: { items: [] }, postStatus: 201, postBody: { id: "f3", nombre: "BLISTER", activo: true, reactivada: true } });
    render(<ConfigFamilias />);
    await screen.findByText("Aún no hay familias en el catálogo.");

    fireEvent.change(screen.getByLabelText("Nueva familia"), { target: { value: "BLISTER" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Familia reactivada."));
  });

  it("409 duplicada: muestra error inline 'Ya existe una familia con ese nombre.'", async () => {
    stubFetch({ get: { items: [] }, postStatus: 409, postBody: { error: "familia_duplicada", message: "La familia ya existe en el catálogo" } });
    render(<ConfigFamilias />);
    await screen.findByText("Aún no hay familias en el catálogo.");

    fireEvent.change(screen.getByLabelText("Nueva familia"), { target: { value: "CANDADOS" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una familia con ese nombre.");
  });

  it("botón Agregar deshabilitado si el input está vacío", async () => {
    stubFetch({ get: { items: [] } });
    render(<ConfigFamilias />);
    await screen.findByText("Aún no hay familias en el catálogo.");
    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });

  // ----------------------------------------------------------------
  // GATE ANTI-REMOUNT (docs/engineering/failure-patterns.md (P3)) — candado de
  // regresión. Disparador real (a diferencia de `DashboardView`, que no
  // tiene ninguno hoy): un alta exitosa llama `refetch()` con los chips ya
  // cargados en pantalla — el 2do GET (el refetch) se deja colgado para
  // observar, de forma determinista, el estado intermedio `loading:true`
  // con `data` ya poblada.
  // ----------------------------------------------------------------
  it("MUTANTE: durante el refetch que dispara un alta exitosa, los chips ya cargados siguen en el DOM —mismo nodo, aria-busy— en vez de caer al skeleton", async () => {
    const deferred = crearDeferred();
    stubFetchConRefetchDiferido(deferred);
    render(<ConfigFamilias />);

    const chipAntes = await screen.findByText("CANDADOS");
    const contenedorAntes = chipAntes.closest("[aria-busy]") as HTMLElement;
    expect(contenedorAntes).toHaveAttribute("aria-busy", "false");

    fireEvent.change(screen.getByLabelText("Nueva familia"), { target: { value: "CINTAS" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    // El POST exitoso dispara `refetch()` — el 2do GET queda EN VUELO (colgado en `deferred`).
    await waitFor(() => expect(contenedorAntes).toHaveAttribute("aria-busy", "true"));

    // Con el código viejo (`{!loading && !error && data && (...)}`),
    // "CANDADOS" desaparece del DOM aquí —reemplazado por el
    // `<Skeleton/>` del gate `{loading && <Skeleton/>}`— y esta línea
    // lanza. Con el código nuevo, el mismo nodo sigue montado.
    expect(screen.getByText("CANDADOS")).toBe(chipAntes);

    deferred.resolver();

    await waitFor(() => expect(contenedorAntes).toHaveAttribute("aria-busy", "false"));
    expect(screen.getByText("CANDADOS")).toBe(chipAntes);
  });
});

// ------------------------------------------------------------
// (C, [MVP-2]) Fusionar familias — la pantalla DECLARA su alcance ANTES
// de confirmar. Mock dedicado por URL (a diferencia de `stubFetch`,
// arriba, que no distingue endpoints): esta vista pega a 2 rutas GET
// distintas (`/api/familias` para los chips, `/api/familias/fusionar`
// para el alcance) y 2 POST distintos (alta vs. fusión).
// ------------------------------------------------------------
interface StubFusionOpts {
  items?: { id: string; nombre: string; activo: boolean }[];
  previewStatus?: number;
  preview?: unknown;
  fusionStatus?: number;
  fusionBody?: unknown;
}

function stubFetchFusion(opts: StubFusionOpts = {}) {
  const items = opts.items ?? [{ id: "f1", nombre: "SERIES 2", activo: true }];
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    if (url === "/api/familias" && method === "GET") {
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (url.startsWith("/api/familias/fusionar?") && method === "GET") {
      return new Response(JSON.stringify(opts.preview ?? { alias: "", cubre: 0, skus_directos: 0, no_cubre: [] }), {
        status: opts.previewStatus ?? 200,
      });
    }
    if (url === "/api/familias/fusionar" && method === "POST") {
      return new Response(JSON.stringify(opts.fusionBody ?? {}), { status: opts.fusionStatus ?? 200 });
    }
    throw new Error("URL no manejada en el mock de fetch: " + url + " " + method);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("ConfigFamilias — Fusionar familias (C, [MVP-2])", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("'Fusionar…' arranca deshabilitado y solo se habilita con alias y destino distintos", async () => {
    stubFetchFusion();
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    const boton = screen.getByRole("button", { name: "Fusionar…" });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "SERIES2" } });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES2" } });
    expect(boton).toBeDisabled(); // mismo nombre (case-insensitive) → no habilita

    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    expect(boton).toBeEnabled();
  });

  it("al abrir pide el alcance con el alias en la query, y muestra el ejemplo REAL del frente: cubre 1 + N SKU, y el compuesto que NO cubre", async () => {
    const { calls } = stubFetchFusion({
      items: [
        { id: "f1", nombre: "SERIES 2", activo: true },
        { id: "f2", nombre: "SERIES2 48 / SERIES2 72", activo: true },
      ],
      preview: { alias: "SERIES2", cubre: 1, skus_directos: 8, no_cubre: [{ nombre: "SERIES2 48 / SERIES2 72", skus: 1 }] },
    });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "SERIES2" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));

    expect(await screen.findByRole("dialog", { name: "Confirmar fusión" })).toBeInTheDocument();
    expect(screen.getByText("Cubre 1 valor del catálogo · 8 SKU migrarán en la próxima ingesta.")).toBeInTheDocument();
    expect(screen.getByText("NO cubre 1 valor compuesto que contiene «SERIES2»:")).toBeInTheDocument();
    expect(screen.getByText("SERIES2 48 / SERIES2 72 — 1 SKU")).toBeInTheDocument();
    expect(screen.getByText("Si también es errata, fusiónalo aparte.")).toBeInTheDocument();

    expect(calls.some((c) => c.method === "GET" && c.url === "/api/familias/fusionar?alias=SERIES2")).toBe(true);
  });

  it("sin compuestos afectados: lo dice explícitamente — el silencio no vale", async () => {
    stubFetchFusion({ preview: { alias: "PIVOTLOCK", cubre: 1, skus_directos: 4, no_cubre: [] } });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "PIVOTLOCK" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "PIVOT LOCK" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));

    expect(await screen.findByText("No hay valores compuestos afectados.")).toBeInTheDocument();
    expect(screen.queryByText(/NO cubre/)).not.toBeInTheDocument();
  });

  it("alias que todavía no existe como fila (solo vive en el Excel): cubre:0 y N SKU en 0, mensaje distinto", async () => {
    stubFetchFusion({ preview: { alias: "NUEVA ERRATA", cubre: 0, skus_directos: 0, no_cubre: [] } });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "NUEVA ERRATA" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));

    expect(
      await screen.findByText("«NUEVA ERRATA» todavía no existe como fila del catálogo — la regla aplicará en cuanto aparezca en el Excel."),
    ).toBeInTheDocument();
  });

  it("2+ compuestos: pluraliza 'valores compuestos que contienen'", async () => {
    stubFetchFusion({
      preview: {
        alias: "CLIP",
        cubre: 1,
        skus_directos: 2,
        no_cubre: [
          { nombre: "CLIP 3.0 / CLIP FLEX", skus: 2 },
          { nombre: "CLIP 3.0 / CLIP SLIM", skus: 4 },
        ],
      },
    });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "CLIP" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "CLIPS" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));

    expect(await screen.findByText("NO cubre 2 valores compuestos que contienen «CLIP»:")).toBeInTheDocument();
  });

  it("confirmar: POST a /api/familias/fusionar con {alias, destino}, toast con el resultado, cierra el diálogo, limpia los campos y refresca la lista", async () => {
    const { calls } = stubFetchFusion({
      preview: { alias: "SERIES2", cubre: 1, skus_directos: 8, no_cubre: [] },
      fusionBody: { alias: "SERIES2", destino: "SERIES 2", absorbida_existia: true, skus_que_migraran: 8 },
    });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "SERIES2" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));
    await screen.findByRole("dialog", { name: "Confirmar fusión" });

    fireEvent.click(screen.getByRole("button", { name: "Fusionar" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("SERIES2 se fusionó con SERIES 2 — 8 SKU migrarán en la próxima ingesta."),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((screen.getByLabelText("Familia con errata") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Fusionar hacia") as HTMLInputElement).value).toBe("");

    const postFusion = calls.find((c) => c.method === "POST" && c.url === "/api/familias/fusionar");
    expect(postFusion?.body).toEqual({ alias: "SERIES2", destino: "SERIES 2", skusEsperados: 8 });
    // Refresca el catálogo tras fusionar (mismo `refetch` que usa el alta).
    expect(calls.filter((c) => c.method === "GET" && c.url === "/api/familias").length).toBeGreaterThanOrEqual(2);
  });

  it("error al confirmar (p.ej. 400 destino inactivo): toast con el mensaje curado del API, el diálogo NO se cierra solo", async () => {
    stubFetchFusion({
      preview: { alias: "SERIES2", cubre: 1, skus_directos: 8, no_cubre: [] },
      fusionStatus: 400,
      fusionBody: { error: "fusion_invalida", message: 'la familia destino "SERIES 2" esta inactiva' },
    });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "SERIES2" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));
    await screen.findByRole("dialog", { name: "Confirmar fusión" });

    fireEvent.click(screen.getByRole("button", { name: "Fusionar" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('la familia destino "SERIES 2" esta inactiva'));
    expect(screen.getByRole("dialog", { name: "Confirmar fusión" })).toBeInTheDocument();
  });

  it("si el GET del alcance falla, avisa y cierra el diálogo en vez de dejarlo colgado sin datos", async () => {
    stubFetchFusion({ previewStatus: 500 });
    render(<ConfigFamilias />);
    await screen.findByText("SERIES 2");

    fireEvent.change(screen.getByLabelText("Familia con errata"), { target: { value: "SERIES2" } });
    fireEvent.change(screen.getByLabelText("Fusionar hacia"), { target: { value: "SERIES 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar…" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo calcular el alcance de la fusión."));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
