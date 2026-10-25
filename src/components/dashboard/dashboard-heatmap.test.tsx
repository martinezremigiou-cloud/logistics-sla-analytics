import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DashboardHeatmap } from "@/types/api";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import {
  claseConPrefijo,
  contrasteEntreClases,
  hexDeClase,
  hexDeHeatRgb,
  hojasDeTexto,
  mezclarAlfa,
  razonDeContraste,
  tintaHeredada,
  TEMAS,
} from "./contraste.testutil";
import { alphaCelda, DashboardHeatmapCard } from "./dashboard-heatmap";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const COLUMNAS: DashboardHeatmap["columnas"] = ["NORTH", "SOUTH", "EAST", "TRAN", "BO", "WEST"];

function heatmap(overrides: Partial<DashboardHeatmap> = {}): DashboardHeatmap {
  return {
    eje_y: "marca",
    eje_x: "almacen",
    filas: ["EAS", "NACIONAL"],
    columnas: COLUMNAS,
    celdas: [
      { fila: "EAS", columna: "NORTH", valor: 100 },
      { fila: "EAS", columna: "SOUTH", valor: 50 },
    ],
    max: 100,
    tecnologia_activa: null,
    tecnologias: [],
    total_marcas: 2,
    ...overrides,
  };
}

function stubFetchJson(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("alphaCelda (pura)", () => {
  it("valor <= 0 → alpha 0 (nunca aplica el piso a una celda vacía)", () => {
    expect(alphaCelda(0, 100)).toBe(0);
    expect(alphaCelda(-1, 100)).toBe(0);
  });

  // [DASH-E · E-3] El techo baja de 0,80 a 0,60. NO es cosmética: con 0,80, entre
  // alfa 0,62 y 0,74 ninguna tinta llegaba a 4,5:1 en tema oscuro — las celdas al
  // 75-92 % del máximo eran ilegibles hicieras lo que hicieras con el color. Con
  // 0,60, `--mx-text` pasa en todo el rango y en los dos temas. Medido, no elegido.
  it("valor === max → alpha 0.6 (0.08 + 0.52): el techo que deja legible la celda más cargada", () => {
    expect(alphaCelda(100, 100)).toBeCloseTo(0.6);
  });

  it("valor === max/2 → alpha 0.34 (piso 0.08 + 0.52*0.5)", () => {
    expect(alphaCelda(50, 100)).toBeCloseTo(0.34);
  });

  it("max <= 0 → alpha 0 (defensivo, evita división por cero)", () => {
    expect(alphaCelda(5, 0)).toBe(0);
  });
});

describe("DashboardHeatmapCard", () => {
  afterEach(() => {
    pushMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("SIEMPRE dibuja las 6 columnas del contrato, incluyendo SOUTH (corrección sobre el blueprint)", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    for (const col of COLUMNAS) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it("celda con valor: aria-label '{marca} · {almacén}: {n} piezas' y el número visible", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    const celda = screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" });
    expect(celda).toHaveTextContent("100");
  });

  it("celda sin entrada en `celdas` (implícita en 0): muestra '–' y aria-label en 0", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    const celda = screen.getByRole("button", { name: "NACIONAL · NORTH: 0 piezas" });
    expect(celda).toHaveTextContent("–");
  });

  it("clic en una celda navega a /catalogo?marca=...&almacen=... (INV-TAXO F4: antes era ?familia=)", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    fireEvent.click(screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" }));
    expect(pushMock).toHaveBeenCalledWith("/catalogo?marca=EAS&almacen=NORTH");
  });

  it("hover/focus en una celda actualiza el caption; mouseLeave del grid lo limpia", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    expect(
      screen.getByText("Pasa el cursor o navega con teclado por una celda para ver el detalle."),
    ).toBeInTheDocument();

    const celda = screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" });
    fireEvent.mouseEnter(celda);
    expect(screen.getByText("EAS · NORTH: 100 pzas")).toBeInTheDocument();

    fireEvent.mouseLeave(celda.parentElement!);
    expect(
      screen.getByText("Pasa el cursor o navega con teclado por una celda para ver el detalle."),
    ).toBeInTheDocument();

    fireEvent.focus(celda);
    expect(screen.getByText("EAS · NORTH: 100 pzas")).toBeInTheDocument();
  });

  it("sin marcas (filas=[]): estado inline en vez de una rejilla vacía", () => {
    render(<DashboardHeatmapCard heatmap={heatmap({ filas: [], celdas: [], total_marcas: 0 })} />);
    expect(screen.getByText("Sin datos de marcas para mostrar.")).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // C1 · Leyenda honesta del corte top-10 (derivada de `total_marcas`, nunca hardcodeada).
  // ------------------------------------------------------------
  it("total_marcas > 10: muestra 'Top 10 de {total_marcas} marcas con stock'", () => {
    render(<DashboardHeatmapCard heatmap={heatmap({ total_marcas: 14 })} />);
    expect(screen.getByText("Top 10 de 14 marcas con stock")).toBeInTheDocument();
  });

  it("total_marcas <= 10 (incluye el límite exacto): NO muestra la leyenda (nada que confesar)", () => {
    render(<DashboardHeatmapCard heatmap={heatmap({ total_marcas: 10 })} />);
    expect(screen.queryByText(/Top 10 de/)).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // C1 · Filtro de tecnología LOCAL al heatmap (vive dentro de la card, no en la barra global).
  // ------------------------------------------------------------
  it("select de tecnología: 'Todas las tecnologías' + opciones data-driven de `tecnologias` + 'Sin tecnología' (sentinel)", () => {
    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    const select = screen.getByLabelText("Tecnología (solo este mapa)");
    expect(within(select).getByRole("option", { name: "Todas las tecnologías" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "AM" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "RFID" })).toBeInTheDocument();
    const sinTecnologia = within(select).getByRole("option", { name: "Sin tecnología" }) as HTMLOptionElement;
    expect(sinTecnologia.value).toBe(SIN_TECNOLOGIA);
  });

  it("la nota de alcance del filtro deja explícito que NO afecta al resto del tablero", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    expect(screen.getByText(/aplica solo a este mapa/)).toBeInTheDocument();
  });

  it("cambiar a una tecnología pide GET /api/dashboard?tecnologia=X y reemplaza el heatmap con la respuesta", async () => {
    const nuevo = heatmap({
      filas: ["BRAND5"],
      celdas: [{ fila: "BRAND5", columna: "BO", valor: 55 }],
      max: 55,
      tecnologia_activa: "RFID",
      tecnologias: ["AM", "RFID"],
      total_marcas: 1,
    });
    const fetchMock = stubFetchJson(200, { heatmap: nuevo });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: "RFID" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "BRAND5 · BO: 55 piezas" })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/dashboard?tecnologia=RFID", expect.anything());
    // Las marcas del heatmap ANTERIOR desaparecen: el reemplazo es completo, no una fusión.
    expect(screen.queryByText("EAS")).not.toBeInTheDocument();
  });

  it("elegir 'Sin tecnología' pide el sentinel SIN_TECNOLOGIA verbatim en la query", async () => {
    const fetchMock = stubFetchJson(200, { heatmap: heatmap({ tecnologia_activa: SIN_TECNOLOGIA, filas: [] }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: SIN_TECNOLOGIA } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/dashboard?tecnologia=${SIN_TECNOLOGIA}`, expect.anything()));
  });

  it("ANTI-REMOUNT: mientras el fetch del filtro está pendiente, el heatmap anterior sigue visible (nunca un skeleton/vacío)", async () => {
    let resolver!: (r: Response) => void;
    const pendiente = new Promise<Response>((resolve) => {
      resolver = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendiente));

    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    expect(screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: "RFID" } });

    // Sigue montada la celda anterior — NUNCA se desmonta a un esqueleto/estado vacío mientras carga.
    expect(screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" })).toBeInTheDocument();
    expect(screen.getByText("Actualizando…")).toBeInTheDocument();

    resolver(
      new Response(
        JSON.stringify({
          heatmap: heatmap({ filas: ["BRAND5"], celdas: [{ fila: "BRAND5", columna: "BO", valor: 55 }], max: 55, tecnologia_activa: "RFID" }),
        }),
        { status: 200 },
      ),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "BRAND5 · BO: 55 piezas" })).toBeInTheDocument());
    expect(screen.queryByText("Actualizando…")).not.toBeInTheDocument();
  });

  it("si el fetch del filtro falla: conserva el heatmap anterior + aviso con Reintentar (no rompe la vista)", async () => {
    const fetchMock = stubFetchJson(500, { error: "internal_error", message: "Fallo interno" });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: "RFID" } });

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" })).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ heatmap: heatmap({ tecnologia_activa: "RFID" }) }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("volver a 'Todas las tecnologías' restaura el heatmap original SIN una nueva petición", async () => {
    const fetchMock = stubFetchJson(200, {
      heatmap: heatmap({ filas: ["BRAND5"], celdas: [{ fila: "BRAND5", columna: "BO", valor: 55 }], max: 55, tecnologia_activa: "RFID" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<DashboardHeatmapCard heatmap={heatmap({ tecnologias: ["AM", "RFID"] })} />);
    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: "RFID" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "BRAND5 · BO: 55 piezas" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Tecnología (solo este mapa)"), { target: { value: "" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "EAS · NORTH: 100 piezas" })).toBeInTheDocument());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * La puerta de E-3.
 *
 * El mapa de calor es la única sección con DOS ejes categóricos y dos topes duros
 * (10 marcas · 6 almacenes), y por eso la forma en que miente es específica: **no
 * revienta, recorta**. Una columna que no cabe y se oculta, o un corte que deja de
 * anunciarse, dejan la sección con el mismo aspecto de siempre y afirmando algo
 * falso sobre el inventario.
 */
describe("DashboardHeatmapCard · E-3 · los topes se anuncian o la sección miente", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("las 6 columnas de ALMACENES se pintan SIEMPRE completas, incluida WEST", () => {
    render(<DashboardHeatmapCard heatmap={heatmap()} />);
    for (const columna of COLUMNAS) {
      expect(screen.getByText(columna), `falta la columna ${columna}`).toBeInTheDocument();
    }
  });

  it("una columna sin NINGUNA celda con dato se pinta igual: vacío y no-medido no se ven igual", () => {
    // Las celdas llegan sparse (`valor > 0`): que WEST no aparezca en `celdas` no
    // significa que WEST no exista. Si la columna desapareciera, la tarjeta diría
    // «hay 5 almacenes», que es falso.
    const solo = heatmap({ celdas: [{ fila: "EAS", columna: "NORTH", valor: 100 }] });
    render(<DashboardHeatmapCard heatmap={solo} />);
    expect(screen.getByText("WEST")).toBeInTheDocument();
  });

  // El corte se anuncia SI Y SOLO SI hay corte. Anunciarlo sin recortar seria tan
  // falso como recortar sin anunciarlo — por eso las dos mitades, con el umbral
  // exacto en las dos orillas (P17: medir las orillas, y también la banda).
  it("la leyenda del corte aparece si y solo si total_marcas > 10", () => {
    const { unmount } = render(<DashboardHeatmapCard heatmap={heatmap({ total_marcas: 10 })} />);
    expect(screen.queryByText(/Top 10 de .* marcas con stock/)).not.toBeInTheDocument();
    unmount();

    render(<DashboardHeatmapCard heatmap={heatmap({ total_marcas: 11 })} />);
    expect(screen.getByText("Top 10 de 11 marcas con stock")).toBeInTheDocument();
  });

  // MEDIDO en D-0: la barra de detalle mide ≈35,25 px por su propio contenido
  // (texto 11,5 px + `py-2` + borde), así que un piso de 20 px NO PUEDE activarse
  // nunca. Es P19 en su forma más silenciosa: una afirmación falsa en el código que
  // no cambia ningún render. Quitarla no mueve un pixel; dejarla dice que alguien
  // midió algo que nadie midió.
  it("el pie de detalle no declara un piso de alto que no puede activarse", () => {
    const { container } = render(<DashboardHeatmapCard heatmap={heatmap()} />);
    const pie = screen.getByText(/Pasa el cursor o navega con teclado/).closest("div") as HTMLElement;

    expect(pie).toBeInTheDocument();
    expect(claseConPrefijo(pie.className, "min-h-")).toBeUndefined();
    expect(container.innerHTML).not.toContain("min-h-[20px]");
  });

  // Los rótulos de columna SON los nombres de los almacenes: el eje entero de la
  // tarjeta. Que fueran el texto menos legible invertía la prioridad.
  it("todo texto de la tarjeta cumple 4,5:1 contra su superficie, en los dos temas", () => {
    const { container } = render(<DashboardHeatmapCard heatmap={heatmap({ total_marcas: 11 })} />);

    const tintas = new Set<string>();
    for (const el of hojasDeTexto(container)) {
      const tinta = tintaHeredada(el, container);
      expect(tinta, `un texto no toma su color de un token --mx-*: ${JSON.stringify(el.textContent)}`).toBeTruthy();
      tintas.add(tinta as string);
    }
    for (const tinta of Array.from(tintas)) {
      for (const tema of TEMAS) {
        const razon = contrasteEntreClases(tinta, "bg-surface", tema);
        expect(razon, `${tinta} sobre la tarjeta en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

/**
 * La rampa de intensidad y la tinta de la celda son UNA sola decisión, y hasta
 * ahora se habían tomado por separado.
 *
 * La celda pinta su número sobre `rgb(var(--mx-heat-rgb) / alpha)`, o sea sobre un
 * fondo que **se mueve con el dato**. Medir esa tinta contra el token «puro» sería
 * medir un color que en pantalla no existe (P27): hay que componer la alfa sobre la
 * superficie real y medir ESO, en cada punto de la rampa y en los dos temas.
 */
describe("DashboardHeatmapCard · E-3 · el número de la celda se lee en TODA la rampa", () => {
  /** La tinta que el componente le pone al número de la celda. */
  const TINTA_CELDA = "text-ink";

  it("la cifra cumple 4,5:1 sobre el fondo COMPUESTO, en todo el rango y en los dos temas", () => {
    for (const tema of TEMAS) {
      const heat = hexDeHeatRgb(tema);
      const superficie = hexDeClase("bg-surface", tema);
      const tinta = hexDeClase(TINTA_CELDA, tema);

      for (let v = 0; v <= 100; v++) {
        const alpha = alphaCelda(v, 100);
        if (alpha === 0) continue; // celda vacía: no pinta número, pinta «–»
        const fondo = mezclarAlfa(heat, superficie, alpha);
        const razon = razonDeContraste(tinta, fondo);
        expect(razon, `${tema}: valor ${v}/100 → alpha ${alpha.toFixed(3)} → ${fondo} → ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  // CONTROL POSITIVO · la rampa ANTERIOR (techo 0,80) y su regla de tinta
  // (`alpha > 0.5 ? blanco : --mx-text-2`) reprueban por esta misma medición. Sin
  // esta línea, la prueba de arriba podría estar pasando por complaciente.
  it("CONTROL POSITIVO · la rampa vieja con su tinta vieja reprueba — en los dos temas y por razones distintas", () => {
    const vieja = (v: number, max: number) => (v <= 0 || max <= 0 ? 0 : 0.08 + 0.72 * (v / max));

    // CLARO: el salto a blanco sobre alpha 0,5 daba 2,02:1 — PEOR que la tinta que
    // sustituía (5,24:1). El umbral estaba invertido para este tema.
    const fondoClaro = mezclarAlfa(hexDeHeatRgb("claro"), hexDeClase("bg-surface", "claro"), vieja(60, 100));
    expect(razonDeContraste("#FFFFFF", fondoClaro)).toBeLessThan(3);

    // OSCURO: entre alpha 0,62 y 0,74 NINGUNA tinta llegaba a 4,5 — ni la clara ni
    // la oscura. Ese hueco es lo que obligó a bajar el techo de la rampa, y no se
    // podía cerrar eligiendo mejor la tinta.
    const fondoOscuro = mezclarAlfa(hexDeHeatRgb("oscuro"), hexDeClase("bg-surface", "oscuro"), vieja(90, 100));
    expect(razonDeContraste(hexDeClase("text-ink", "oscuro"), fondoOscuro)).toBeLessThan(4.5);
    expect(razonDeContraste(hexDeClase("bg-surface", "oscuro"), fondoOscuro)).toBeLessThan(4.5);
  });

  it("la rampa sigue siendo monótona y distingue los extremos", () => {
    expect(alphaCelda(0, 100)).toBe(0);
    expect(alphaCelda(1, 100)).toBeGreaterThan(0);
    expect(alphaCelda(100, 100)).toBeGreaterThan(alphaCelda(50, 100));
    expect(alphaCelda(50, 100)).toBeGreaterThan(alphaCelda(1, 100));
  });
});
