import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { AgregarSkuDialog } from "./agregar-sku-dialog";
import type { CatalogoItem, CatalogoPage } from "@/types/api";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";

function catalogoItem(overrides: Partial<CatalogoItem> = {}): CatalogoItem {
  return {
    sku: "UDM839-K",
    marca: "BRAND1",
    familia: "SERIES 2",
    familias: ["SERIES 2"],
    descripcion: "Series 27, Plástico Blanco",
    total: 900,
    reservado: 91,
    disponible: 809,
    badges: [],
    ...overrides,
  };
}

function catalogoPage(items: CatalogoItem[]): CatalogoPage {
  return {
    items,
    page: 1,
    pageSize: 8,
    total: items.length,
    excluidos: { total: 0, marcas: [] },
    totalPages: 1,
    facetas: { marcas: [], familias: [], productos: [], almacenes: [], tecnologias: [], sin_familia: 0, sin_tecnologia: 0 },
  };
}

function stubFetchInventory(responder: () => CatalogoPage) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/inventory")) {
        return new Response(JSON.stringify(responder()), { status: 200 });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AgregarSkuDialog", () => {
  it("busca en /api/inventory (mismo contrato que el resto del portal, NO un segundo buscador) al escribir", async () => {
    stubFetchInventory(() => catalogoPage([catalogoItem()]));
    render(<AgregarSkuDialog proyectoId={PROYECTO_ID} skusExistentes={new Set()} onAgregado={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar SKU" }));
    fireEvent.change(screen.getByLabelText("Buscar SKU"), { target: { value: "QMR418" } });

    await waitFor(() => expect(screen.getByText("UDM839-K")).toBeInTheDocument(), { timeout: 2000 });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toBe("/api/inventory?q=QMR418&pageSize=8");
  });

  it("un SKU ya en el proyecto aparece deshabilitado con 'Ya en el proyecto'", async () => {
    stubFetchInventory(() => catalogoPage([catalogoItem({ sku: "SUJ500-F" })]));
    render(<AgregarSkuDialog proyectoId={PROYECTO_ID} skusExistentes={new Set(["SUJ500-F"])} onAgregado={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar SKU" }));
    fireEvent.change(screen.getByLabelText("Buscar SKU"), { target: { value: "QRK357" } });

    await waitFor(() => expect(screen.getByText("Ya en el proyecto")).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /SUJ500-F/ }));
    // Seleccionarlo no debe abrir el paso de cantidad (sigue deshabilitado).
    expect(screen.queryByLabelText("Cantidad")).not.toBeInTheDocument();
  });

  it("elegir un SKU disponible + cantidad + Agregar hace POST y llama onAgregado", async () => {
    stubFetchInventory(() => catalogoPage([catalogoItem()]));
    const fetchInventoryMock = fetch;
    const onAgregado = vi.fn();
    render(<AgregarSkuDialog proyectoId={PROYECTO_ID} skusExistentes={new Set()} onAgregado={onAgregado} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar SKU" }));
    fireEvent.change(screen.getByLabelText("Buscar SKU"), { target: { value: "QMR418" } });
    await waitFor(() => expect(screen.getByText("UDM839-K")).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /UDM839-K/ }));

    const cantidadInput = await screen.findByLabelText("Cantidad");
    fireEvent.change(cantidadInput, { target: { value: "25" } });

    // A partir de aquí el POST de alta responde distinto del buscador — se reemplaza el stub.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === `/api/proyectos/${PROYECTO_ID}/partidas` && init?.method === "POST") {
          expect(init.body).toBe(JSON.stringify({ sku: "UDM839-K", cantidad: 25 }));
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }
        return fetchInventoryMock(input);
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(onAgregado).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("UDM839-K agregado al proyecto.");
  });

  it("409 partida_duplicada: toast.error con el mensaje del API y NO cierra ni llama onAgregado", async () => {
    stubFetchInventory(() => catalogoPage([catalogoItem()]));
    const onAgregado = vi.fn();
    render(<AgregarSkuDialog proyectoId={PROYECTO_ID} skusExistentes={new Set()} onAgregado={onAgregado} />);

    fireEvent.click(screen.getByRole("button", { name: "Agregar SKU" }));
    fireEvent.change(screen.getByLabelText("Buscar SKU"), { target: { value: "QMR418" } });
    await waitFor(() => expect(screen.getByText("UDM839-K")).toBeInTheDocument(), { timeout: 2000 });
    fireEvent.click(screen.getByRole("button", { name: /UDM839-K/ }));

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "partida_duplicada", message: "Ese SKU ya está en el proyecto. Cambia su cantidad en vez de agregarlo otra vez." }),
            { status: 409 },
          ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ese SKU ya está en el proyecto. Cambia su cantidad en vez de agregarlo otra vez."));
    expect(onAgregado).not.toHaveBeenCalled();
  });
});
