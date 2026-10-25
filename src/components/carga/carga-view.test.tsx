import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionProvider } from "@/components/providers/session-provider";
import { CargaView } from "./carga-view";

function renderConRol(rol: "kam" | "admin") {
  return render(
    <SessionProvider sesion={{ id: "u1", email: "user@example.com", rol }}>
      <CargaView />
    </SessionProvider>,
  );
}

function stubFetchRouter() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/inventory")) {
      return new Response(
        JSON.stringify({
          items: [{ sku: "A-1", marca: "BRAND1", familia: "CANDADOS", descripcion: "Candado industrial", total: 10, reservado: 2, disponible: 8, badges: [] }],
          page: 1,
          pageSize: 8,
          total: 1,
          totalPages: 1,
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("/api/sku/")) {
      return new Response(
        JSON.stringify({
          sku: "A-1",
          marca: "BRAND1",
          familia_efectiva: "CANDADOS",
          descr_efectiva: "Candado industrial",
          original: { familia: "CANDADOS", descr: "Candado industrial" },
          stock: [],
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
        }),
        { status: 200 },
      );
    }
    throw new Error(`fetch no manejado: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CargaView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("kam: muestra SinPermiso y ningún buscador/dropzone", () => {
    renderConRol("kam");
    expect(screen.getByText("Sin permiso")).toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar SKU")).not.toBeInTheDocument();
    expect(screen.queryByText("Subir imagen")).not.toBeInTheDocument();
  });

  it("admin: ve el buscador de SKU", () => {
    stubFetchRouter();
    renderConRol("admin");
    expect(screen.getByLabelText("Buscar SKU")).toBeInTheDocument();
    expect(screen.queryByText("Sin permiso")).not.toBeInTheDocument();
  });

  it("admin: escribir en el buscador muestra resultados (debounced) y elegir un SKU muestra su preview + dropzone", async () => {
    stubFetchRouter();
    renderConRol("admin");

    fireEvent.change(screen.getByLabelText("Buscar SKU"), { target: { value: "A-1" } });

    const opcion = await screen.findByRole("button", { name: /A-1/ }, { timeout: 2000 });
    fireEvent.click(opcion);

    await waitFor(() => expect(screen.getByText("Subir imagen")).toBeInTheDocument());
    expect(screen.getByText("Sin imagen cargada")).toBeInTheDocument();
  });
});
