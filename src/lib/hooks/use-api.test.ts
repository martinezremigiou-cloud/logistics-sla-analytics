import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useApi, type ApiErrorBody } from "./use-api";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function stubFetch(impl: FetchFn) {
  const fetchSpy = vi.fn<FetchFn>(impl);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("useApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("pasa de loading a data cuando el fetch resuelve ok", async () => {
    stubFetch(async () => new Response(JSON.stringify({ hola: "mundo" }), { status: 200 }));

    const { result } = renderHook(() => useApi<{ hola: string }>("/api/x"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ hola: "mundo" });
    expect(result.current.error).toBeNull();
  });

  it("expone el body {error, message} cuando la respuesta no es ok", async () => {
    const body: ApiErrorBody = { error: "validacion", message: "Parámetro inválido" };
    stubFetch(async () => new Response(JSON.stringify(body), { status: 422 }));

    const { result } = renderHook(() => useApi("/api/x"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual(body);
    expect(result.current.data).toBeNull();
  });

  it("usa el fallback internal_error si el body de error no es JSON válido", async () => {
    stubFetch(async () => new Response("no-json", { status: 500 }));

    const { result } = renderHook(() => useApi("/api/x"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toEqual({ error: "internal_error" });
  });

  it("ignora silenciosamente un AbortError", async () => {
    stubFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );

    const { result, rerender } = renderHook(({ url }: { url: string | null }) => useApi(url), {
      initialProps: { url: "/api/a" as string | null },
    });

    expect(result.current.loading).toBe(true);

    rerender({ url: null });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
  });

  it("cambia de url: aborta la petición anterior (el primer signal queda aborted)", () => {
    const signals: AbortSignal[] = [];
    stubFetch((_input, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise<Response>(() => {});
    });

    const { rerender } = renderHook(({ url }: { url: string | null }) => useApi(url), {
      initialProps: { url: "/api/a" },
    });

    rerender({ url: "/api/b" });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("refetch dispara una nueva petición", async () => {
    let n = 0;
    const fetchSpy = stubFetch(async () => {
      n += 1;
      return new Response(JSON.stringify({ n }), { status: 200 });
    });

    const { result } = renderHook(() => useApi<{ n: number }>("/api/x"));

    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.data).toEqual({ n: 2 }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("url null no dispara fetch y queda idle", () => {
    const fetchSpy = stubFetch(async () => new Response(null));

    const { result } = renderHook(() => useApi(null));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
