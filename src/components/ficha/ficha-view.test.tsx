import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SkuDetalle } from "@/types/api";
import { separarFamilias } from "@/lib/familias";
import { SessionProvider, type SesionUsuario } from "@/components/providers/session-provider";
import { FichaView } from "./ficha-view";

// `FichaDetalle` → `FichaAtributos` usa `useSesion()` (P3) — por default se
// envuelve con rol 'kam' (comportamiento de solo lectura, el mismo que ya
// cubrían estos tests antes de P3). El test anti-remount (más abajo) sí pasa
// 'admin' para poder disparar un guardado real (`onSaved` → `refetch`).
function renderFichaView(sku: string, rol: SesionUsuario["rol"] = "kam") {
  return render(
    <SessionProvider sesion={{ id: "u1", email: rol === "admin" ? "admin@example.com" : "kam@example.com", rol }}>
      <FichaView sku={sku} />
    </SessionProvider>,
  );
}

/** Deferred controlado por el test (mismo patrón que `config-usuarios.test.tsx`, FIX D ronda 3): el test decide EXPLÍCITAMENTE cuándo "termina" el GET pendiente. */
function crearDeferred<T>(): { promise: Promise<T>; resolver: (valor: T) => void } {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

function detalle(overrides: Partial<SkuDetalle> = {}): SkuDetalle {
  // `familias_efectivas` se deriva SIEMPRE con la función real `separarFamilias`
  // (invariante INV-TAXO F2) para que un override futuro de `familia_efectiva`
  // no pueda dejar el fixture incoherente.
  const familia_efectiva = overrides.familia_efectiva === undefined ? "CANDADOS" : overrides.familia_efectiva;
  return {
    sku: "A-1",
    marca: "BRAND1",
    marca_excluida: false,
    familia_efectiva,
    familias_efectivas: separarFamilias(familia_efectiva),
    descr_efectiva: "Descripción A",
    original: { familia: "CANDADOS", descr: "Descripción A" },
    stock: [{ almacen: "NORTH", cantidad: 10 }],
    total: 10,
    reservado: 2,
    disponible: 8,
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

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("FichaView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading: muestra el skeleton mientras la carga está en curso", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderFichaView("A-1");
    expect(screen.getByRole("status", { name: "Cargando ficha…" })).toBeInTheDocument();
  });

  it("404 sku_no_encontrado: título = message del backend, descripción con el sku consultado, cta a /catalogo", async () => {
    stubFetch(404, { error: "sku_no_encontrado", message: "SKU no encontrado en el catálogo" });
    renderFichaView("NOEXISTE");

    await waitFor(() => expect(screen.getByText("SKU no encontrado en el catálogo")).toBeInTheDocument());
    expect(screen.getByText(/NOEXISTE/)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Volver al catálogo" });
    expect(link).toHaveAttribute("href", "/catalogo");
  });

  it("error genérico: EstadoError con el message del contrato y reintenta al hacer click", async () => {
    stubFetch(500, { error: "internal_error", message: "Fallo interno" });
    renderFichaView("A-1");

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();

    stubFetch(200, detalle());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getAllByText("Descripción A").length).toBeGreaterThan(0));
  });

  it("data: renderiza FichaDetalle", async () => {
    stubFetch(200, detalle({ sku: "A-1", descr_efectiva: "Descripción A" }));
    renderFichaView("A-1");

    await waitFor(() => expect(screen.getByText("A-1")).toBeInTheDocument());
    // "Descripción A" aparece tanto en el header como en "Datos del producto" (mismo dato, dos secciones).
    expect(screen.getAllByText("Descripción A").length).toBeGreaterThan(0);
    // [FIX-B1] Antes "Atributos editables" — decisión de producto: título único
    // "Datos del producto" para ambos roles (ver ficha-atributos.tsx).
    expect(screen.getByText("Datos del producto")).toBeInTheDocument();
  });
});

describe("FichaView — anti-remount (docs/engineering/failure-patterns.md (P3), mismo anti-patrón de FIX-RESET)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("un refetch en curso (tras guardar en Datos del producto) NO desmonta la ficha ya cargada", async () => {
    const deferred = crearDeferred<SkuDetalle>();
    let llamadasSku = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url.startsWith("/api/sku/")) {
          llamadasSku += 1;
          if (llamadasSku === 1) {
            return new Response(JSON.stringify(detalle()), { status: 200 });
          }
          const body = await deferred.promise;
          return new Response(JSON.stringify(body), { status: 200 });
        }
        if (url.startsWith("/api/familias") && method === "GET") {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        // [FIX-B1] `TecnologiaEditable` (rol admin) hace GET /api/tecnologias
        // cuando el Excel no trae el dato — el fixture `detalle()` no fija
        // `tecnologia`, así que este caso SIEMPRE se ejercita en modo admin.
        if (url.startsWith("/api/tecnologias") && method === "GET") {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        if (url === "/api/color" && method === "PUT") {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        throw new Error(`fetch no manejado en el test: ${method} ${url}`);
      }),
    );

    renderFichaView("A-1", "admin");
    await waitFor(() => expect(screen.getByText("A-1")).toBeInTheDocument());

    // Guardar un color dispara PUT /api/color → onSaved → refetch de la
    // ficha. Ese segundo GET queda COLGADO (deferred): mientras no resuelve,
    // la ficha ya cargada debe seguir montada (nunca `{loading && ...}` a
    // secas, que la reemplazaría por el skeleton perdiendo cualquier estado
    // local de los sub-componentes).
    fireEvent.click(screen.getByRole("radio", { name: "Azul" }));
    await waitFor(() => expect(llamadasSku).toBe(2));

    expect(screen.getByText("A-1")).toBeInTheDocument();
    // [FIX-B1] Antes "Atributos editables".
    expect(screen.getByText("Datos del producto")).toBeInTheDocument();

    deferred.resolver(detalle());
    await waitFor(() => expect(screen.getByText("A-1")).toBeInTheDocument());
  });
});
