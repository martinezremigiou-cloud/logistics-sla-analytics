import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VolcarDialog } from "./volcar-dialog";
import type { ItemSeleccion } from "@/lib/seleccion";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";

const ITEMS: ItemSeleccion[] = [
  { sku: "SUJ500-F", cantidad: 40 },
  { sku: "JE016-YD", cantidad: 120 },
];

/** Lo que el proyecto YA tiene: `JE016-YD` está con 10, `SUJ500-F` no está. */
const PARTIDAS_ACTUALES = [{ sku: "JE016-YD", cantidad: 10 }];

interface Enviado {
  items: { sku: string; cantidad: number; cantidadVista: number }[];
}

/**
 * Stub de las tres llamadas del diálogo. Devuelve `enviados`, que es donde se
 * inspecciona el CUERPO real del volcado — la prueba que importa no es que se
 * haya llamado, sino QUÉ se mandó.
 */
function stubApi(respuestaVolcado: unknown) {
  const enviados: Enviado[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/proyectos") {
        // ============================================================
        // LA FORMA REAL DE LA RUTA, no una inventada por el test.
        //
        // `src/app/api/proyectos/route.ts` devuelve `{ items }` — la convención
        // de la casa para endpoints de lista, la misma de `/api/usuarios`. La
        // primera versión de este mock devolvía un ARREGLO PELÓN, y con eso el
        // test pasaba en verde sobre un componente que reventaba en el
        // navegador con `t.find is not a function`. Un mock que inventa la
        // forma no prueba el consumidor: prueba el mock.
        // ============================================================
        return new Response(
          JSON.stringify({ items: [{ id: PROYECTO_ID, folio: "PRJ-050", titulo: "Rollout Norte" }] }),
          { status: 200 },
        );
      }
      if (url.endsWith("/volcado")) {
        enviados.push(JSON.parse(String(init?.body)) as Enviado);
        return new Response(JSON.stringify(respuestaVolcado), { status: 200 });
      }
      if (url.startsWith(`/api/proyectos/${PROYECTO_ID}`)) {
        return new Response(JSON.stringify({ id: PROYECTO_ID, partidas: PARTIDAS_ACTUALES }), { status: 200 });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
  return enviados;
}

async function abrirYElegirProyecto(onVolcadoCompleto = vi.fn()) {
  render(
    <VolcarDialog open onOpenChange={vi.fn()} items={ITEMS} onVolcadoCompleto={onVolcadoCompleto} />,
  );
  await waitFor(() => expect(screen.getByRole("option", { name: /PRJ-050/ })).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Proyecto destino"), { target: { value: PROYECTO_ID } });
  await waitFor(() => expect(screen.getByRole("button", { name: /Volcar 2 SKU/ })).toBeEnabled());
  return onVolcadoCompleto;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("[INV-B8.2] VolcarDialog", () => {
  // ============================================================
  // EL «AND SAY». El usuario armó la Selección recorriendo el catálogo, sin ver
  // el proyecto: antes de confirmar tiene que saber cuál suma y cuál es nuevo.
  // ============================================================
  it("enseña qué SKU es nuevo y cuál SUMA, con las dos cifras y el resultado", async () => {
    stubApi({ aplicadas: [], sinCambio: [], conflictos: [], desconocidos: [] });
    await abrirYElegirProyecto();

    expect(screen.getByText(/1 SKU nuevo/)).toBeInTheDocument();
    expect(screen.getByText(/1 ya estaba/)).toBeInTheDocument();
    // JE016-YD: 10 que ya hay + 120 seleccionadas = 130.
    expect(screen.getByText(/10 \+ 120 =/)).toBeInTheDocument();
    expect(screen.getByText("130")).toBeInTheDocument();
  });

  // ============================================================
  // LO QUE VIAJA POR EL CABLE. El cliente manda lo que SELECCIONÓ y lo que VIO;
  // el total lo calcula el servidor. Si el total viajara, existiría un camino
  // donde un cliente manipulado escribe la cifra que quiera.
  // ============================================================
  it("manda `cantidadVista` y NO manda el total calculado en el cliente", async () => {
    const enviados = stubApi({ aplicadas: [], sinCambio: [], conflictos: [], desconocidos: [] });
    await abrirYElegirProyecto();
    fireEvent.click(screen.getByRole("button", { name: /Volcar 2 SKU/ }));

    await waitFor(() => expect(enviados).toHaveLength(1));
    expect(enviados[0].items).toEqual([
      { sku: "SUJ500-F", cantidad: 40, cantidadVista: 0 },
      { sku: "JE016-YD", cantidad: 120, cantidadVista: 10 },
    ]);
    for (const item of enviados[0].items) {
      expect(Object.keys(item).sort()).toEqual(["cantidad", "cantidadVista", "sku"]);
    }
  });

  it("volcado limpio: enseña el antes → después y vacía la Selección", async () => {
    stubApi({
      aplicadas: [
        { sku: "SUJ500-F", antes: 0, despues: 40 },
        { sku: "JE016-YD", antes: 10, despues: 130 },
      ],
      sinCambio: [],
      conflictos: [],
      desconocidos: [],
    });
    const onVolcadoCompleto = await abrirYElegirProyecto();
    fireEvent.click(screen.getByRole("button", { name: /Volcar 2 SKU/ }));

    await waitFor(() => expect(screen.getByText("Volcado completo.")).toBeInTheDocument());
    expect(screen.getByText(/10 →/)).toBeInTheDocument();
    expect(onVolcadoCompleto).toHaveBeenCalledOnce();
  });

  // ============================================================
  // EL REINTENTO, VISTO DESDE LA PANTALLA. Que el servidor no haya sumado dos
  // veces es información para el usuario, no un silencio: le dice que su
  // volcado anterior SÍ había entrado.
  // ============================================================
  it("un reintento se DICE, no se esconde", async () => {
    stubApi({
      aplicadas: [],
      sinCambio: [
        { sku: "SUJ500-F", cantidad: 40 },
        { sku: "JE016-YD", cantidad: 130 },
      ],
      conflictos: [],
      desconocidos: [],
    });
    const onVolcadoCompleto = await abrirYElegirProyecto();
    fireEvent.click(screen.getByRole("button", { name: /Volcar 2 SKU/ }));

    await waitFor(() => expect(screen.getByText("Ya estaban así")).toBeInTheDocument());
    expect(screen.getByText(/No se sumó dos veces/)).toBeInTheDocument();
    // Sin conflictos, el volcado está completo: la Selección ya no hace falta.
    expect(onVolcadoCompleto).toHaveBeenCalledOnce();
  });

  // ============================================================
  // CON CONFLICTOS, LA SELECCIÓN SE CONSERVA. Vaciarla «porque respondió 200»
  // habría perdido el trabajo justo cuando el usuario todavía tiene algo que
  // hacer con él — y reintentar es seguro, el servidor no vuelve a sumar.
  // ============================================================
  it("con conflictos NO vacía la Selección, y dice qué esperaba y qué hay", async () => {
    stubApi({
      aplicadas: [{ sku: "SUJ500-F", antes: 0, despues: 40 }],
      sinCambio: [],
      conflictos: [{ sku: "JE016-YD", cantidadVista: 10, cantidadActual: 25, motivo: "cambio_concurrente" }],
      desconocidos: [],
    });
    const onVolcadoCompleto = await abrirYElegirProyecto();
    fireEvent.click(screen.getByRole("button", { name: /Volcar 2 SKU/ }));

    await waitFor(() =>
      expect(screen.getByText(/Volcado parcial: quedaron renglones sin aplicar/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/esperaba 10, hay 25/)).toBeInTheDocument();
    expect(onVolcadoCompleto).not.toHaveBeenCalled();
  });

  it("un SKU fuera del catálogo se nombra, y tampoco vacía la Selección", async () => {
    stubApi({
      aplicadas: [],
      sinCambio: [],
      conflictos: [],
      desconocidos: ["NO-EXISTE"],
    });
    const onVolcadoCompleto = await abrirYElegirProyecto();
    fireEvent.click(screen.getByRole("button", { name: /Volcar 2 SKU/ }));

    await waitFor(() => expect(screen.getByText("Fuera del catálogo")).toBeInTheDocument());
    expect(screen.getByText("NO-EXISTE")).toBeInTheDocument();
    expect(onVolcadoCompleto).not.toHaveBeenCalled();
  });

  it("sin proyecto elegido no se puede volcar", () => {
    stubApi({ aplicadas: [], sinCambio: [], conflictos: [], desconocidos: [] });
    render(<VolcarDialog open onOpenChange={vi.fn()} items={ITEMS} onVolcadoCompleto={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Volcar/ })).toBeDisabled();
  });

  // ============================================================
  // Si el detalle no se pudo leer, `cantidadVista` sería una invención — y el
  // servidor la rechazaría como conflicto en el mejor caso. Se prefiere no
  // dejar volcar y decir por qué.
  // ============================================================
  it("si el proyecto no se pudo leer, el botón no se habilita", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === "/api/proyectos") {
          // La forma real: `{ items }`. Ver la nota de `stubApi`.
          return new Response(
            JSON.stringify({ items: [{ id: PROYECTO_ID, folio: "PRJ-050", titulo: "Rollout Norte" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
      }),
    );
    render(<VolcarDialog open onOpenChange={vi.fn()} items={ITEMS} onVolcadoCompleto={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("option", { name: /PRJ-050/ })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Proyecto destino"), { target: { value: PROYECTO_ID } });

    await waitFor(() => expect(screen.getByText(/No se pudo leer el proyecto/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Volcar/ })).toBeDisabled();
  });
});
