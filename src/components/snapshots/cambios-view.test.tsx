import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CambiosView, buildCambiosUrl } from "./cambios-view";
import type { CambioItem, CambiosPage } from "@/types/api";

const ID = "11111111-1111-1111-1111-111111111111";

function snapshot(overrides: Partial<CambiosPage["snapshot"]> = {}): CambiosPage["snapshot"] {
  return {
    id: ID,
    fuente: "stock",
    periodo: "2026-07",
    archivo: "julio.xlsx",
    filas: 1846,
    hash: "hash-completo-1234567890abcdef",
    created_at: "2026-07-20T08:00:00.000Z",
    created_by: null,
    vigente: true,
    detectado_en: "2026-07-20T08:00:05.000Z",
    ...overrides,
  };
}

function cambio(overrides: Partial<CambioItem> = {}): CambioItem {
  return {
    id: "c1",
    entidad: "producto",
    clave: "A-1",
    sku: "A-1",
    campo: "familia",
    valor_anterior: "CANDADOS",
    valor_nuevo: "SENSORES",
    tipo: "MODIFICACION",
    ...overrides,
  };
}

function cambiosPage(overrides: Partial<CambiosPage> = {}): CambiosPage {
  return {
    snapshot: snapshot(),
    resumen: { total: 173, altas: 94, bajas: 43, modificaciones: 36 },
    items: [cambio()],
    page: 1,
    pageSize: 50,
    total: 173,
    totalPages: 4,
    ...overrides,
  };
}

/** Deferred controlado por el test (mismo patrón que config-usuarios.test.tsx). */
function crearDeferred<T>(): { promise: Promise<T>; resolver: (v: T) => void } {
  let resolver!: (v: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

type Handler = (url: string) => Promise<{ status: number; body: unknown }>;

let handler: Handler = async () => ({ status: 200, body: cambiosPage() });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.startsWith(`/api/snapshots/${ID}/cambios`)) throw new Error("URL no manejada: " + url);
      const { status, body } = await handler(url);
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

function calls(): string[] {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map((c: unknown[]) => String(c[0]));
}

describe("buildCambiosUrl (puro)", () => {
  it("sin filtros → sin querystring", () => {
    expect(buildCambiosUrl(ID, { entidad: null, tipo: null, sku: null, page: 1 })).toBe(`/api/snapshots/${ID}/cambios`);
  });

  it("con filtros → reenvía solo los presentes", () => {
    const url = buildCambiosUrl(ID, { entidad: "producto", tipo: "ALTA", sku: "A-1", page: 3 });
    expect(url).toContain("entidad=producto");
    expect(url).toContain("tipo=ALTA");
    expect(url).toContain("sku=A-1");
    expect(url).toContain("page=3");
  });

  it("page=1 se omite del querystring (URL limpia)", () => {
    expect(buildCambiosUrl(ID, { entidad: null, tipo: null, sku: null, page: 1 })).not.toContain("page=");
  });
});

describe("CambiosView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    handler = async () => ({ status: 200, body: cambiosPage() });
  });

  it("loading: muestra los skeletons del encabezado y de la tabla", () => {
    const deferred = crearDeferred<{ status: number; body: unknown }>();
    handler = () => deferred.promise;
    stubFetch();

    render(<CambiosView id={ID} />);
    expect(screen.getByRole("status", { name: "Cargando snapshot…" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Cargando cambios…" })).toBeInTheDocument();
  });

  it("404 snapshot_no_encontrado: mensaje especial con enlace de vuelta, sin filtros ni tabla", async () => {
    handler = async () => ({ status: 404, body: { error: "snapshot_no_encontrado", message: "El snapshot no existe." } });
    stubFetch();

    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("No encontramos este snapshot.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Volver a Snapshots" })).toHaveAttribute("href", "/snapshots");
    expect(screen.queryByLabelText("Buscar por SKU")).not.toBeInTheDocument();
  });

  it("error genérico: EstadoError con reintento, PERO los filtros siguen montados", async () => {
    handler = async () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    stubFetch();

    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());
    expect(screen.getByLabelText("Buscar por SKU")).toBeInTheDocument();
  });

  it("con datos y VARIAS filas: detectado_en aparece UNA sola vez en el encabezado, nunca por fila de la tabla", async () => {
    handler = async () => ({
      status: 200,
      body: cambiosPage({
        items: [cambio({ id: "c1" }), cambio({ id: "c2" }), cambio({ id: "c3" })],
        total: 3,
        totalPages: 1,
      }),
    });
    stubFetch();
    render(<CambiosView id={ID} />);

    await waitFor(() => expect(screen.getByText("julio.xlsx")).toBeInTheDocument());
    // 3 filas en la tabla, pero "Detectado en" solo vive en el encabezado —
    // nunca se repite por fila (CambioItem ni siquiera trae ese campo).
    expect(screen.getAllByRole("row")).toHaveLength(4); // 1 header + 3 filas
    expect(screen.getAllByText(/Detectado en/)).toHaveLength(1);
  });

  it("sin filtros y total 0: mensaje neutro 'Este snapshot no introdujo cambios.'", async () => {
    handler = async () => ({ status: 200, body: cambiosPage({ items: [], total: 0, totalPages: 0, resumen: { total: 0, altas: 0, bajas: 0, modificaciones: 0 } }) });
    stubFetch();

    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("Este snapshot no introdujo cambios.")).toBeInTheDocument());
    expect(screen.queryByText(/mostrando/)).not.toBeInTheDocument();
  });

  it("con filtros y total 0: 'Sin cambios que coincidan con estos filtros.' + Limpiar filtros", async () => {
    handler = async (url) => {
      if (url.includes("sku=")) {
        return { status: 200, body: cambiosPage({ items: [], total: 0, totalPages: 0 }) };
      }
      return { status: 200, body: cambiosPage() };
    };
    stubFetch();

    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("julio.xlsx")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Buscar por SKU"), { target: { value: "Z-999" } });
    fireEvent.submit(screen.getByLabelText("Buscar por SKU").closest("form")!);

    await waitFor(() => expect(screen.getByText("Sin cambios que coincidan con estos filtros.")).toBeInTheDocument());

    // Chrome persistente (C3, mismo criterio que catalogo-view.test.tsx): con
    // un filtro activo hay DOS botones "Limpiar filtros" en pantalla — el de
    // `CambiosFiltros` (siempre montado) y el del estado vacío. Ambos llaman
    // al mismo `handleLimpiar`; cualquiera de los dos limpia todos los filtros.
    const botones = screen.getAllByRole("button", { name: "Limpiar filtros" });
    fireEvent.click(botones[0]);
    await waitFor(() => expect(calls().at(-1)).toBe(`/api/snapshots/${ID}/cambios`));
  });

  it("'mostrando X de Y' usa `resumen` SIN filtrar, no el total ya filtrado dos veces", async () => {
    handler = async (url) => {
      if (url.includes("tipo=ALTA")) {
        return { status: 200, body: cambiosPage({ items: [cambio({ tipo: "ALTA" })], total: 37, totalPages: 1, resumen: { total: 173, altas: 94, bajas: 43, modificaciones: 36 } }) };
      }
      return { status: 200, body: cambiosPage() };
    };
    stubFetch();

    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("julio.xlsx")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "ALTA" } });
    await waitFor(() => expect(screen.getByText(/mostrando 37 de 173/)).toBeInTheDocument());
  });

  it("chips removibles: quitar el chip de Entidad limpia SOLO ese filtro y refetchea", async () => {
    stubFetch();
    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText("julio.xlsx")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Entidad"), { target: { value: "reserva" } });
    await waitFor(() => expect(calls().at(-1)).toContain("entidad=reserva"));

    fireEvent.click(screen.getByRole("button", { name: /Entidad: Reserva/ }));
    await waitFor(() => expect(calls().at(-1)).not.toContain("entidad="));
  });

  it("chrome persistente: durante un refetch por filtro, la tabla sigue montada (mismo nodo) con aria-busy, sin volver al skeleton", async () => {
    stubFetch();
    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());

    const tablaAntes = screen.getByRole("table");
    expect(tablaAntes).toHaveAttribute("aria-busy", "false");

    const deferred = crearDeferred<{ status: number; body: unknown }>();
    handler = () => deferred.promise;

    fireEvent.change(screen.getByLabelText("Entidad"), { target: { value: "stock" } });

    await waitFor(() => expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true"));
    expect(screen.getByRole("table")).toBe(tablaAntes);
    // Los filtros (con su valor ya cambiado) siguen montados y usables.
    expect(screen.getByLabelText("Entidad")).toHaveValue("stock");
    expect(screen.queryByRole("status", { name: "Cargando cambios…" })).not.toBeInTheDocument();

    deferred.resolver({ status: 200, body: cambiosPage({ items: [cambio({ entidad: "stock" })] }) });
    await waitFor(() => expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false"));
  });

  it("Paginacion muestra la página EN VIVO (estado local), no la `data.page` stale, mientras el cambio de página está en vuelo", async () => {
    stubFetch();
    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByText(/Página 1 de 4/)).toBeInTheDocument());

    const deferred = crearDeferred<{ status: number; body: unknown }>();
    handler = () => deferred.promise;

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    // La respuesta de la página 2 todavía no llegó (`data` sigue siendo la
    // de la página 1, chrome persistente), pero la paginación debe
    // reflejar la página YA PEDIDA, no la que quedó vieja en `data.page`.
    await waitFor(() => expect(screen.getByText(/Página 2 de 4/)).toBeInTheDocument());
    expect(screen.queryByText(/Página 1 de 4/)).not.toBeInTheDocument();

    deferred.resolver({ status: 200, body: cambiosPage({ page: 2 }) });
    await waitFor(() => expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false"));
  });

  // Fix B19 (revisor-codigo, ronda 2): por simetría con
  // `EmbarquesView`/`CatalogoView` — faltaba la rama "página fuera de
  // rango" (total>0 && items vacío).
  it("fix B19: página fuera de rango (items=[] con total>0): mensaje + 'Ir a la página 1' vuelve a pedir la página 1", async () => {
    handler = async (url) => {
      if (url.includes("page=2")) return { status: 200, body: cambiosPage({ items: [], page: 2 }) };
      return { status: 200, body: cambiosPage() };
    };
    stubFetch();
    render(<CambiosView id={ID} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    await waitFor(() => expect(screen.getByText("Sin resultados en esta página")).toBeInTheDocument());
    expect(screen.queryByText("Este snapshot no introdujo cambios.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ir a la página 1" }));
    await waitFor(() => expect(calls().at(-1)).toBe(`/api/snapshots/${ID}/cambios`));
  });
});
