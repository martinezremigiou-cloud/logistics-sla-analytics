import { describe, it, expect, vi, afterEach } from "vitest";
import { toast } from "sonner";
import { agregarPartidaFetch, cambiarCantidadFetch, quitarPartidaFetch } from "./partidas-api";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";
const PARTIDA_ID = "partida-1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("agregarPartidaFetch", () => {
  it("POST con {sku,cantidad} — 201 regresa true", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await agregarPartidaFetch(PROYECTO_ID, "SUJ500-F", 120);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/proyectos/${PROYECTO_ID}/partidas`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ sku: "SUJ500-F", cantidad: 120 }) }),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("409 proyecto_lleno: toast.error con el mensaje del API, regresa false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "proyecto_lleno", message: "El proyecto alcanzó el máximo de partidas." }), { status: 409 })),
    );
    const ok = await agregarPartidaFetch(PROYECTO_ID, "SUJ500-F", 120);
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("El proyecto alcanzó el máximo de partidas.");
  });

  it("excepción de red: toast.error genérico, regresa false, nunca lanza", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const ok = await agregarPartidaFetch(PROYECTO_ID, "SUJ500-F", 120);
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar el proyecto.");
  });
});

describe("cambiarCantidadFetch", () => {
  it("PATCH con {cantidad} — 200 regresa true", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await cambiarCantidadFetch(PROYECTO_ID, PARTIDA_ID, 150);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/proyectos/${PROYECTO_ID}/partidas/${PARTIDA_ID}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ cantidad: 150 }) }),
    );
  });

  it("404 no_encontrado: toast.error, regresa false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "proyecto_no_encontrado", message: "El proyecto no existe o no es tuyo." }), { status: 404 })),
    );
    const ok = await cambiarCantidadFetch(PROYECTO_ID, PARTIDA_ID, 150);
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("El proyecto no existe o no es tuyo.");
  });
});

describe("quitarPartidaFetch", () => {
  it("DELETE — 200 regresa true", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const ok = await quitarPartidaFetch(PROYECTO_ID, PARTIDA_ID);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(`/api/proyectos/${PROYECTO_ID}/partidas/${PARTIDA_ID}`, expect.objectContaining({ method: "DELETE" }));
  });

  it("error sin JSON válido: mensaje genérico, nunca lanza", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 500 })));
    const ok = await quitarPartidaFetch(PROYECTO_ID, PARTIDA_ID);
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar el proyecto.");
  });
});
