import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SeguimientoProvider, useSeguimiento } from "./seguimiento-provider";
import type { PreferenciasAvisos, SeguimientosResponse } from "@/types/avisos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PREFS: PreferenciasAvisos = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
  preguntar_por_sku: false,
  visto_hasta: null,
  boletin_correo: true,
};

/**
 * LAS FORMAS SON LAS REALES DE CADA RUTA, no unas inventadas por el test:
 *
 *   GET /api/seguimientos  → `{ items }`   (endpoint de LISTA, envuelto)
 *   GET /api/preferencias  → el objeto pelado
 *
 * Es la prueba de contrato ruta↔consumidor que pide el DoD, y existe porque en
 * INV-B8.2 un mock que devolvía un arreglo pelón sobre un endpoint que
 * envuelve dejó pasar un `t.find is not a function` hasta el navegador. El
 * tipo `SeguimientosResponse` es el MISMO que declara la ruta.
 */
function stub(items: SeguimientosResponse["items"], sobre: { fallaPost?: boolean } = {}) {
  const llamadas: { url: string; metodo: string; cuerpo: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      llamadas.push({ url, metodo: init?.method ?? "GET", cuerpo: init?.body ? JSON.parse(String(init.body)) : null });

      if (url === "/api/seguimientos" && (init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      if (url === "/api/seguimientos") {
        return sobre.fallaPost
          ? new Response(JSON.stringify({ error: "demasiados_seguimientos", message: "Alcanzaste el máximo." }), { status: 409 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url.startsWith("/api/seguimientos/")) {
        return new Response(JSON.stringify({ ok: true, borrado: true }), { status: 200 });
      }
      if (url === "/api/preferencias") {
        return new Response(JSON.stringify(PREFS), { status: 200 });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
  return llamadas;
}

function Sonda({ sku = "SUJ500-F" }: { sku?: string }) {
  const s = useSeguimiento();
  return (
    <div>
      <span data-testid="cargado">{String(s.cargado)}</span>
      <span data-testid="sigue">{String(s.sigue(sku))}</span>
      <span data-testid="total">{s.total}</span>
      <button onClick={() => void s.seguir(sku)}>seguir</button>
      <button onClick={() => void s.dejarDeSeguir(sku)}>dejar</button>
    </div>
  );
}

const montar = (sku?: string) =>
  render(
    <SeguimientoProvider>
      <Sonda sku={sku} />
    </SeguimientoProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("[INV-B9] SeguimientoProvider", () => {
  it("lee la lista con la forma REAL de la ruta (`{ items }`) y la expone por SKU", async () => {
    stub([
      { perfil_id: "p", sku: "SUJ500-F", av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true, av_correo: false },
    ]);
    montar();
    await waitFor(() => expect(screen.getByTestId("cargado")).toHaveTextContent("true"));
    expect(screen.getByTestId("sigue")).toHaveTextContent("true");
    expect(screen.getByTestId("total")).toHaveTextContent("1");
  });

  it("normaliza al leer: un SKU guardado en minúsculas se reconoce", async () => {
    stub([
      { perfil_id: "p", sku: "suj500-f", av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true, av_correo: false },
    ]);
    montar("SUJ500-F");
    await waitFor(() => expect(screen.getByTestId("sigue")).toHaveTextContent("true"));
  });

  it("seguir es OPTIMISTA: el botón cambia antes de que el servidor conteste", async () => {
    const llamadas = stub([]);
    montar();
    await waitFor(() => expect(screen.getByTestId("cargado")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("seguir"));
    expect(screen.getByTestId("sigue")).toHaveTextContent("true");
    await waitFor(() => expect(llamadas.some((l) => l.metodo === "POST")).toBe(true));
  });

  // ============================================================
  // Sin la reversión, la interfaz afirmaría un seguimiento que no existe. Es la
  // misma clase de mentira que este proyecto viene persiguiendo desde B8.1.
  // ============================================================
  it("si el servidor rechaza, el estado VUELVE ATRÁS", async () => {
    stub([], { fallaPost: true });
    montar();
    await waitFor(() => expect(screen.getByTestId("cargado")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("seguir"));
    await waitFor(() => expect(screen.getByTestId("sigue")).toHaveTextContent("false"));
    expect(screen.getByTestId("total")).toHaveTextContent("0");
  });

  it("dejar de seguir también es optimista", async () => {
    const llamadas = stub([
      { perfil_id: "p", sku: "SUJ500-F", av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true, av_correo: false },
    ]);
    montar();
    await waitFor(() => expect(screen.getByTestId("sigue")).toHaveTextContent("true"));

    fireEvent.click(screen.getByText("dejar"));
    expect(screen.getByTestId("sigue")).toHaveTextContent("false");
    await waitFor(() => expect(llamadas.some((l) => l.metodo === "DELETE")).toBe(true));
  });

  it("sin `avisos` explícitos el cuerpo solo lleva el SKU: el servidor aplica las preferencias", async () => {
    const llamadas = stub([]);
    montar();
    await waitFor(() => expect(screen.getByTestId("cargado")).toHaveTextContent("true"));
    fireEvent.click(screen.getByText("seguir"));

    await waitFor(() => expect(llamadas.some((l) => l.metodo === "POST")).toBe(true));
    const post = llamadas.find((l) => l.metodo === "POST")!;
    expect(post.cuerpo).toEqual({ sku: "SUJ500-F" });
  });

  // ============================================================
  // Un error de lectura también «carga»: si no, el botón se quedaría en su
  // estado indeterminado para siempre y el usuario no sabría que puede pulsar.
  // ============================================================
  it("si la lista no se puede leer, el provider igual queda utilizable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "/api/preferencias") return new Response(JSON.stringify(PREFS), { status: 200 });
        return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
      }),
    );
    montar();
    await waitFor(() => expect(screen.getByTestId("cargado")).toHaveTextContent("true"));
    expect(screen.getByTestId("sigue")).toHaveTextContent("false");
  });
});
