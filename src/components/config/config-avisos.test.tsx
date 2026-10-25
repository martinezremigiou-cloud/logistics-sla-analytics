import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfigAvisos } from "./config-avisos";
import { SeguimientoProvider } from "@/components/providers/seguimiento-provider";
import type { PreferenciasAvisos } from "@/types/avisos";

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
 * SE MONTA CON EL PROVIDER REAL, no con `SeguimientoFijo`, y a propósito: lo que
 * hay que probar aquí no es que el interruptor se pinte sino **qué cuerpo sale
 * a la red**. Con el provider fijo, `guardarPreferencias` es un no-op y la
 * prueba pasaría aunque el PATCH no llevara el campo.
 *
 * Las formas son las REALES de cada ruta —`{ items }` para la lista, el objeto
 * pelado para preferencias— por la lección de INV-B8.2: un mock que se inventa
 * la forma no prueba al consumidor, confirma el error.
 */
function stub(prefs: PreferenciasAvisos = PREFS) {
  const llamadas: { url: string; metodo: string; cuerpo: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const metodo = init?.method ?? "GET";
      llamadas.push({ url, metodo, cuerpo: init?.body ? JSON.parse(String(init.body)) : null });

      if (url === "/api/seguimientos") return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url === "/api/preferencias" && metodo === "GET") {
        return new Response(JSON.stringify(prefs), { status: 200 });
      }
      if (url === "/api/preferencias") {
        // El PATCH devuelve las preferencias YA GUARDADAS, no un booleano: es el
        // servidor quien manda sobre el estado resultante.
        const parche = init?.body ? (JSON.parse(String(init.body)) as Partial<PreferenciasAvisos>) : {};
        return new Response(JSON.stringify({ ...prefs, ...parche }), { status: 200 });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
  return llamadas;
}

const montar = () =>
  render(
    <SeguimientoProvider>
      <ConfigAvisos />
    </SeguimientoProvider>,
  );

const patch = (llamadas: { url: string; metodo: string; cuerpo: unknown }[]) =>
  llamadas.find((l) => l.url === "/api/preferencias" && l.metodo === "PATCH");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("[INV-B9] ConfigAvisos", () => {
  it("sin provider no se pinta: degradar es «no está la tarjeta», no «la pantalla se cae»", () => {
    const { container } = render(<ConfigAvisos />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dice que cambiar el default NO toca lo ya seguido", async () => {
    stub();
    montar();
    expect(await screen.findByText(/no toca los que ya sigues/)).toBeInTheDocument();
  });

  // ============================================================
  // El último encendido no se puede apagar: dejarlos los cuatro en `false` haría
  // que seguir un SKU no significara nada, y el CHECK de la base lo rechazaría
  // con un 23514 que nadie quiere leer.
  // ============================================================
  it("el ÚLTIMO aviso encendido no se puede apagar", async () => {
    const llamadas = stub();
    montar();
    const solo = await screen.findByRole("switch", { name: "Ya llegó" });
    await waitFor(() => expect(solo).toBeChecked());

    expect(solo).toBeDisabled();
    fireEvent.click(solo);
    expect(patch(llamadas)).toBeUndefined();
  });

  it("apagar uno de varios sí manda el PATCH, y solo con el campo tocado", async () => {
    const llamadas = stub({ ...PREFS, av_estatus: true });
    montar();
    const etapa = await screen.findByRole("switch", { name: "Cambió de etapa" });
    await waitFor(() => expect(etapa).toBeChecked());

    fireEvent.click(etapa);
    await waitFor(() => expect(patch(llamadas)).toBeDefined());
    expect(patch(llamadas)!.cuerpo).toEqual({ av_estatus: false });
  });
});

// ============================================================
// [INV-B9.1] EL APAGADOR DEL BOLETÍN — la otra mitad de la «opción 3» acordada.
//
// La 0027 creó `boletin_correo` ENCENDIDO y `armarCorreos()` ya lo lee, pero
// hasta aquí no existía ningún camino en el portal para apagarlo: la columna
// habría quedado siendo una decisión que solo se podía cambiar por SQL. Media
// función implementada se ve idéntica a una función completa hasta que alguien
// la busca.
// ============================================================
describe("[INV-B9.1] ConfigAvisos · el boletín", () => {
  it("nace ENCENDIDO: el bloque general le llega a todos por diseño", async () => {
    stub();
    montar();
    const boletin = await screen.findByRole("switch", { name: "Resumen semanal de la operación" });
    await waitFor(() => expect(boletin).toBeChecked());
  });

  it("apagarlo manda `boletin_correo: false` y NADA más", async () => {
    const llamadas = stub();
    montar();
    const boletin = await screen.findByRole("switch", { name: "Resumen semanal de la operación" });
    await waitFor(() => expect(boletin).toBeChecked());

    fireEvent.click(boletin);
    await waitFor(() => expect(patch(llamadas)).toBeDefined());
    // Un PATCH que arrastrara los cuatro avisos podría pisar un cambio hecho en
    // otra pestaña. Se manda lo que se tocó.
    expect(patch(llamadas)!.cuerpo).toEqual({ boletin_correo: false });
  });

  it("apagado, se ve apagado: el estado sale del servidor y no del clic", async () => {
    stub({ ...PREFS, boletin_correo: false });
    montar();
    const boletin = await screen.findByRole("switch", { name: "Resumen semanal de la operación" });
    await waitFor(() => expect(boletin).not.toBeChecked());
  });

  // ============================================================
  // NO es el interruptor general del correo, y la interfaz tiene que decirlo:
  // los avisos de los SKU marcados con «también por correo» siguen llegando. Si
  // apagara todo, sería un segundo control que significa lo mismo que
  // `av_correo` y acabarían contradiciéndose.
  // ============================================================
  it("dice que apagarlo NO apaga los avisos de los SKU propios", async () => {
    stub();
    montar();
    expect(await screen.findByText(/no.*apaga los avisos de tus SKU/i)).toBeInTheDocument();
  });

  it("apagar el boletín NO toca «preguntar por cada SKU» ni los cuatro avisos", async () => {
    const llamadas = stub();
    montar();
    const boletin = await screen.findByRole("switch", { name: "Resumen semanal de la operación" });
    await waitFor(() => expect(boletin).toBeChecked());

    fireEvent.click(boletin);
    await waitFor(() => expect(patch(llamadas)).toBeDefined());

    const cuerpo = patch(llamadas)!.cuerpo as Record<string, unknown>;
    for (const campo of ["av_estatus", "av_disponible", "av_reservado", "av_llegada", "preguntar_por_sku"]) {
      expect(cuerpo).not.toHaveProperty(campo);
    }
    expect(await screen.findByRole("switch", { name: "Ya llegó" })).toBeChecked();
  });
});
