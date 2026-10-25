import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SkuDetalle } from "@/types/api";
import { separarFamilias } from "@/lib/familias";
import { FocoSku } from "./foco-sku";

function detalle(overrides: Partial<SkuDetalle> = {}): SkuDetalle {
  // `familias_efectivas` se deriva SIEMPRE con la función real `separarFamilias`
  // (invariante INV-TAXO F2) — mismo criterio que `ficha-view.test.tsx`. Desde
  // R3-1, `foco-sku.tsx` SÍ pinta `familias_efectivas` (un chip por átomo) en
  // vez del crudo `familia_efectiva` — este fixture solo necesita quedar
  // coherente con `separarFamilias` para que ambos queden sincronizados.
  const familia_efectiva = overrides.familia_efectiva === undefined ? "CANDADOS" : overrides.familia_efectiva;
  return {
    sku: "A-1",
    marca: "BRAND1",
    marca_excluida: false,
    familia_efectiva,
    familias_efectivas: separarFamilias(familia_efectiva),
    descr_efectiva: "Candado industrial",
    original: { familia: "CANDADOS", descr: "Candado industrial" },
    stock: [{ almacen: "NORTH", cantidad: 10 }],
    total: 10,
    reservado: 2,
    disponible: 8,
    sobre_reservado: false,
    reserva_descuadre: false,
    reservas: [],
    embarques: [
      {
        id: "e1",
        oc_po: "OC-1",
        proveedor: "PROV",
        referencia: null,
        factura: null,
        pais_origen: "CN",
        piezas: 50,
        fw: null,
        tipo_importacion: "MAR",
        fecha_recoleccion: null,
        etd: null,
        eta: null,
        fecha_llegada: null,
        fecha_disponibilidad: null,
        estatus: "En Aduana",
        estatus_orden: 7,
        proyecto: null,
        observaciones: null,
        is_historial: false,
        retrasado: false,
      },
    ],
    // Deliberadamente distinto de la Σ de `embarques` (50) para probar que el
    // hero pinta el campo del DTO tal cual, no una suma local.
    piezas_en_camino: 999,
    piezas_historial: 111,
    imagen_url: null,
    snapshot: { stock: null, aduana: null },
    // Requerido (no opcional) en `SkuDetalle` — hoy siempre `false` (la
    // migración 0011 que puebla esta señal aún no corre en runtime real).
    decidido_en_bandeja: { marca: false },
    ...overrides,
  };
}

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

/** Deferred controlado por el test (mismo patrón que `config-usuarios.test.tsx` / `ficha-view.test.tsx`). */
function crearDeferred<T>(): { promise: Promise<T>; resolver: (valor: T) => void } {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}

describe("FocoSku", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin foco: estado inicial explicativo, sin disparar fetch", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<FocoSku foco={null} onClear={vi.fn()} />);

    expect(screen.getByText("Elige un SKU")).toBeInTheDocument();
    expect(
      screen.getByText("Selecciona un SKU del pipeline o de la fila Viendo para ver su cruce completo."),
    ).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loading: muestra el skeleton mientras la carga está en curso", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<FocoSku foco="A-1" onClear={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Cargando cruce del SKU…" })).toBeInTheDocument();
  });

  it("data: hero con los 3 números TAL CUAL del DTO (no derivados) + las 3 cards reusadas de la Ficha", async () => {
    stubFetch(200, detalle());
    render(<FocoSku foco="A-1" onClear={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "A-1" })).toBeInTheDocument());
    expect(screen.getAllByText("999").length).toBeGreaterThan(0); // piezas_en_camino del DTO (≠ Σ embarques = 50)
    expect(screen.getByText("111")).toBeInTheDocument(); // piezas_historial del DTO
    expect(screen.getByText("8")).toBeInTheDocument(); // disponible del DTO

    expect(screen.getByText("Stock por almacén")).toBeInTheDocument();
    expect(screen.getByText("Embarques entrantes")).toBeInTheDocument();
    expect(screen.getByText("Reservas")).toBeInTheDocument();
  });

  it("chip de identidad: marca y familia son chips separados (familia null → chip 'Sin familia')", async () => {
    stubFetch(200, detalle({ familia_efectiva: null }));
    render(<FocoSku foco="A-1" onClear={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("BRAND1")).toBeInTheDocument());
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
  });

  // R3-1 (bug real, ronda de revisión): antes se pintaba `familia_efectiva ??
  // "Sin familia"` — el CRUDO compuesto — así que un sku con familia
  // multi-valor se veía como un solo bloque de texto. Caso real verificado:
  // VJ9123-F tiene `familias_efectivas: ["CLIP 3.0", "CLIP ROTATIVO"]`.
  it("R3-1: familia compuesta real (SKU VJ9123-F) pinta un chip POR átomo, NUNCA el crudo compuesto como un solo bloque", async () => {
    stubFetch(200, detalle({ sku: "VJ9123-F", familia_efectiva: "CLIP 3.0 / CLIP ROTATIVO" }));
    render(<FocoSku foco="VJ9123-F" onClear={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("CLIP 3.0")).toBeInTheDocument());
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
    expect(screen.queryByText("CLIP 3.0 / CLIP ROTATIVO")).not.toBeInTheDocument();
    expect(screen.queryByText(/BRAND1 ·/)).not.toBeInTheDocument();
  });

  it("disponible negativo se muestra en tono ámbar (no el blanco por defecto)", async () => {
    stubFetch(200, detalle({ disponible: -5 }));
    render(<FocoSku foco="A-1" onClear={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("-5")).toBeInTheDocument());
    expect(screen.getByText("-5").className).toContain("text-amber-300");
  });

  it("link 'Abrir ficha completa' apunta a /catalogo/{sku}", async () => {
    stubFetch(200, detalle({ sku: "B-2" }));
    render(<FocoSku foco="B-2" onClear={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Abrir ficha completa →" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Abrir ficha completa →" })).toHaveAttribute("href", "/catalogo/B-2");
  });

  it("404 sku_no_encontrado: message del backend + botón 'Quitar selección' limpia el foco", async () => {
    stubFetch(404, { error: "sku_no_encontrado", message: "SKU no encontrado en el catálogo" });
    const onClear = vi.fn();
    render(<FocoSku foco="NOEXISTE" onClear={onClear} />);

    await waitFor(() => expect(screen.getByText("SKU no encontrado en el catálogo")).toBeInTheDocument());
    expect(screen.getByText(/NOEXISTE/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Quitar selección" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("error genérico: EstadoError con el message del contrato y reintenta al hacer click", async () => {
    stubFetch(500, { error: "internal_error", message: "Fallo interno" });
    render(<FocoSku foco="A-1" onClear={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();

    stubFetch(200, detalle());
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.getByText("Stock por almacén")).toBeInTheDocument());
  });
});

describe("FocoSku — anti-remount (docs/engineering/failure-patterns.md (P3), mismo anti-patrón de FIX-RESET)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cambiar de SKU enfocado (nuevo `foco`) mientras el nuevo GET está en vuelo NO desmonta el foco ya cargado", async () => {
    const deferred = crearDeferred<SkuDetalle>();
    let llamadas = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        llamadas += 1;
        if (llamadas === 1) {
          return new Response(JSON.stringify(detalle({ sku: "A-1" })), { status: 200 });
        }
        const body = await deferred.promise;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    const { rerender } = render(<FocoSku foco="A-1" onClear={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "A-1" })).toBeInTheDocument());

    // Cambia el SKU enfocado: dispara un GET nuevo que queda COLGADO
    // (deferred). Mientras no resuelve, el foco anterior (A-1) debe seguir
    // montado — nunca `{loading && ...}` a secas, que lo reemplazaría por el
    // skeleton de inmediato.
    rerender(<FocoSku foco="B-2" onClear={vi.fn()} />);
    await waitFor(() => expect(llamadas).toBe(2));
    expect(screen.getByRole("heading", { name: "A-1" })).toBeInTheDocument();

    deferred.resolver(detalle({ sku: "B-2" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "B-2" })).toBeInTheDocument());
  });
});
