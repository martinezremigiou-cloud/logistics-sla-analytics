import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AvisoVersionNueva } from "./aviso-version-nueva";
import { NOMBRE_PRODUCTO } from "@/config/producto";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchFn) {
  const fetchSpy = vi.fn<FetchFn>(impl);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Contrato real de `/api/version` (ronda 2, punto D: sin `builtId` — ver route.ts). */
function respuestaDev(): { deploymentId: string; skewProtection: boolean } {
  return { deploymentId: "dev", skewProtection: false };
}

function respuestaVersion(deploymentId: string): { deploymentId: string; skewProtection: boolean } {
  return { deploymentId, skewProtection: false };
}

/** Simula la pestaña pasando a `estado` y dispara el listener del componente. */
function marcarVisibilidad(estado: DocumentVisibilityState) {
  const spy = vi.spyOn(document, "visibilityState", "get");
  spy.mockReturnValue(estado);
  document.dispatchEvent(new Event("visibilitychange"));
  return spy;
}

const ENV_KEY = "NEXT_PUBLIC_DEPLOY_ID";
let respaldoEnv: string | undefined;

describe("AvisoVersionNueva", () => {
  beforeEach(() => {
    respaldoEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (respaldoEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = respaldoEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("al montar NO consulta /api/version (nada de fetch al cargar, solo por visibilitychange)", () => {
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaDev()));

    render(<AvisoVersionNueva />);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("no hace polling: aunque pase tiempo sin que la pestaña cambie de visibilidad, nunca llama a fetch", async () => {
    vi.useFakeTimers();
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaDev()));

    render(<AvisoVersionNueva />);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("visibilitychange → hidden: NO consulta (solo dispara al pasar a visible)", () => {
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaDev()));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("hidden");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("visibilitychange → visible con deploymentId igual al horneado: no muestra el banner", async () => {
    process.env[ENV_KEY] = "dpl_build_111";
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaVersion("dpl_build_111")));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("visibilitychange → visible con deploymentId distinto al horneado: muestra el banner persistente con botón Recargar", async () => {
    process.env[ENV_KEY] = "dpl_build_111";
    stubFetch(async () => jsonResponse(respuestaVersion("dpl_live_222")));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    expect(await screen.findByRole("status")).toHaveTextContent(`Hay una versión nueva de ${NOMBRE_PRODUCTO}.`);
    expect(screen.getByRole("button", { name: "Recargar" })).toBeInTheDocument();
  });

  it("sin NEXT_PUBLIC_DEPLOY_ID (dev local): el lado horneado cae a 'dev', igual que /api/version en dev ⇒ nunca dispara", async () => {
    delete process.env[ENV_KEY];
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaDev()));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("guardarraíl (ronda 2, punto D): idHorneado='dev' pero el servidor YA trae un deploymentId real (VERCEL_DEPLOYMENT_ID faltó solo en build) — NUNCA muestra el banner, aunque los valores difieran", async () => {
    // Sin esta prueba, exactamente este escenario (asimétrico: el lado
    // horneado se quedó en 'dev' pero el runtime del servidor SÍ tiene un
    // deploymentId real) es el que dejaría el banner pegado en pantalla
    // para siempre — ver el comentario del componente. Es DISTINTO del
    // caso "ambos lados valen 'dev'" (la prueba de arriba): ahí nunca se
    // habría disparado el banner de todas formas, con o sin guardarraíl.
    delete process.env[ENV_KEY];
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaVersion("dpl_live_real_999")));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("detectar la versión nueva NUNCA recarga por sí solo — recargar exige un clic explícito del usuario", async () => {
    process.env[ENV_KEY] = "dpl_build_111";
    stubFetch(async () => jsonResponse(respuestaVersion("dpl_live_222")));

    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, reload: reloadSpy },
    });

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");
    await screen.findByRole("button", { name: "Recargar" });

    expect(reloadSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("una vez detectada la versión nueva, un siguiente visibilitychange → visible NO vuelve a hacer fetch", async () => {
    process.env[ENV_KEY] = "dpl_build_111";
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaVersion("dpl_live_222")));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");
    await screen.findByRole("status");

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    marcarVisibilidad("hidden");
    marcarVisibilidad("visible");

    // Deja correr los microtasks pendientes; el candado evita el 2º fetch.
    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("/api/version responde no-ok (5xx): silencio, sin banner", async () => {
    process.env[ENV_KEY] = "dpl_build_111";
    const fetchSpy = stubFetch(async () => jsonResponse({ error: "internal_error" }, 500));

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fetch lanza (red caída): silencio + console.warn, sin banner (P4: nunca rompe la navegación)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubFetch(async () => {
      throw new Error("network down");
    });

    render(<AvisoVersionNueva />);
    marcarVisibilidad("visible");

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("desmontar el componente quita el listener: un visibilitychange posterior no lanza ni actualiza estado", () => {
    const fetchSpy = stubFetch(async () => jsonResponse(respuestaDev()));

    const { unmount } = render(<AvisoVersionNueva />);
    unmount();

    expect(() => marcarVisibilidad("visible")).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
