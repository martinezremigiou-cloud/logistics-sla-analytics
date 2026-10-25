// ============================================================
// [FIX-B1] `/catalogo/[sku]` con un SKU que trae '/' (u otro carácter
// reservado): el fetch de la ficha tiene que pedir la MISMA codificación
// que produjo el enlace — una sola vuelta, no dos.
//
// El valor de entrada de este test ('01654365%2F3225') es el que Next
// realmente entrega a `params.sku` para el SKU real "01654365/3225": el
// framework decodifica el segmento de ruta y lo vuelve a codificar antes
// de pasarlo a la página (medido, ver `paramDePagina`). No se fabrica un
// `params.sku` ya decodificado — eso sería probar un camino que Next
// nunca produce (P36).
// ============================================================
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import FichaSkuPage from "./page";

describe("[FIX-B1] /catalogo/[sku] — SKU con '/' no queda doble-codificado", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Tipado explícito del parámetro para que `fetchMock.mock.calls[0]` infiera
  // `[string]` en vez de `[]` — si no, TS rechaza el cast de abajo (TS2352).
  // El `void url` sólo existe para que ESLint (no-unused-vars, que corre en
  // `next build`) no rechace el parámetro: la URL se lee desde `mock.calls`.
  function stubFetchColgado() {
    const fetchMock = vi.fn((url: string) => {
      void url;
      return new Promise<never>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("pide '/api/sku/01654365%2F3225', no '/api/sku/01654365%252F1000'", () => {
    const fetchMock = stubFetchColgado(); // deferred: solo importa la URL con la que se llamó

    render(<FichaSkuPage params={{ sku: "01654365%2F3225" }} />);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sku/01654365%2F3225");
  });

  it("un SKU sin caracteres reservados sigue pidiendo la misma URL de siempre", () => {
    const fetchMock = stubFetchColgado();

    render(<FichaSkuPage params={{ sku: "GFTDL7362" }} />);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/sku/GFTDL7362");
  });

  it("el breadcrumb-back a /catalogo sigue ahí (el server shell no cambió)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<FichaSkuPage params={{ sku: "GFTDL7362" }} />);
    expect(screen.getByRole("link", { name: /Catálogo/ })).toHaveAttribute("href", "/catalogo");
  });
});
