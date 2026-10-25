import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { soloCodigo } from "@/lib/guardas/codigo-fuente";
import { SessionProvider } from "@/components/providers/session-provider";
import { ProyectoDetalleView } from "./proyecto-detalle-view";
import type { PartidaItem, ProyectoDetalle } from "@/types/proyectos";
import * as pdfjsDist from "pdfjs-dist";

// [2.0.1-C · F-6] Esta vista no prueba pdf.js — eso vive en
// `proyecto-documento-previa.test.tsx`, con control fino por prueba. Aquí
// solo hace falta que la pestaña «Documento» llegue a un estado ESTABLE (1
// página pintada) para poder barrer nombres accesibles sobre su árbol real.
//
// `getDocument` es un `vi.fn()` con una implementación DEFAULT que siempre
// pinta bien — la mayoría de las pruebas de este archivo ni se enteran de
// que existe. Un puñado (el barrido de los CUATRO estados del panel, más
// abajo) la sobreescribe UNA vez con `mockReturnValueOnce` para forzar el
// estado de fallo de render sin tocar las demás.
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: () =>
        Promise.resolve({
          getViewport: () => ({ width: 612, height: 792 }),
          render: () => ({ promise: Promise.resolve() }),
        }),
    }),
  })),
}));

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";

function renderConRol(rol: "kam" | "admin" | "visitante") {
  return render(
    <SessionProvider sesion={{ id: "u1", email: "kam@example.com", rol }}>
      <ProyectoDetalleView id={PROYECTO_ID} />
    </SessionProvider>,
  );
}

function detalle(overrides: Partial<ProyectoDetalle> = {}): ProyectoDetalle {
  return {
    id: PROYECTO_ID,
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: "Despliegue de Series2.",
    notas: null,
    fecha: "2026-04-30",
    tipo: "Rollout",
    intencion: "Cotización",
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: 0,
    piezas: 0,
    partidas: [],
    vigencia: { snapshot_id: null, tomado_en: null },
    agrupacion: { eje: "sin_banda", sinBanda: 0 },
    facetas: { marcas: [], tecnologias: [] },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProyectoDetalleView", () => {
  it("visitante: SinPermiso, sin pedir /api/proyectos/[id]", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderConRol("visitante");
    expect(screen.getByText("Sin permiso")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kam: pinta el hero y la card de partidas", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(detalle()), { status: 200 })));
    renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Rollout Retailer9 Series2 Q2" })).toBeInTheDocument());
    expect(screen.getByText("Partidas del proyecto")).toBeInTheDocument();
  });

  it("404 proyecto_no_encontrado: estado dedicado con CTA a Proyectos (no el error genérico)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "proyecto_no_encontrado", message: "El proyecto no existe o no es tuyo." }), { status: 404 })),
    );
    renderConRol("kam");
    await waitFor(() => expect(screen.getByText("El proyecto no existe o no es tuyo.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Volver a Proyectos" })).toHaveAttribute("href", "/proyectos");
  });

  it("error genérico (500): EstadoError con reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "internal_error", message: "Fallo interno" }), { status: 500 })));
    renderConRol("kam");
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());
  });
});

// ============================================================
// [2.0.1-B · S-4] Las tres pestañas.
// ============================================================

const RUTA_DETALLE = `/api/proyectos/${PROYECTO_ID}`;
const RUTA_DOCUMENTO = `/api/proyectos/${PROYECTO_ID}/documento?formato=pdf`;

/** Sirve el detalle por su ruta y bytes de PDF por la del documento — el mock ciego no distingue las dos y aquí la diferencia es el dato. */
function fetchPorRuta(detalleServido = detalle()) {
  return vi.fn(async (url: string) => {
    if (url.startsWith(`${RUTA_DETALLE}/documento`)) return new Response("%PDF-1.3", { status: 200 });
    return new Response(JSON.stringify(detalleServido), { status: 200 });
  });
}

/** Igual que `fetchPorRuta`, pero la ruta del documento responde 500 — para llegar al estado `EstadoError` de la pestaña. */
function fetchPorRutaConDocumentoRoto(detalleServido = detalle()) {
  return vi.fn(async (url: string) => {
    if (url.startsWith(`${RUTA_DETALLE}/documento`)) {
      return new Response(JSON.stringify({ message: "Fallo interno" }), { status: 500 });
    }
    return new Response(JSON.stringify(detalleServido), { status: 200 });
  });
}

/** La primera llamada al documento sale bien (previa buena); la SEGUNDA (un «Regenerar») falla — para llegar al aviso angosto. */
function fetchDetalleYDocumentoConSegundaFalla(detalleServido = detalle()) {
  let llamadasDocumento = 0;
  return vi.fn(async (url: string) => {
    if (url.startsWith(`${RUTA_DETALLE}/documento`)) {
      llamadasDocumento += 1;
      if (llamadasDocumento === 1) return new Response("%PDF-1.3", { status: 200 });
      return new Response(JSON.stringify({ message: "Fallo interno" }), { status: 500 });
    }
    return new Response(JSON.stringify(detalleServido), { status: 200 });
  });
}

/**
 * Nombres accesibles repetidos entre los CONTROLES del árbol.
 *
 * Dos botones con el mismo nombre en una pantalla no se pueden distinguir por
 * lector de pantalla ni nombrar por voz.
 *
 * NO ES UNA GUARDA ESPECULATIVA: mordió sobre este mismo árbol. La primera
 * versión de la pestaña «Documento» traía su propio «Exportar Excel», y el
 * barrido devolvió `["Exportar Rollout Retailer9 Series2 Q2 a Excel"]` — el
 * `aria-label` del hero, repetido. Se reprodujo devolviendo el botón al
 * componente y se quitó al retirarlo; el control positivo de abajo es el
 * testigo permanente de que el barrido sabe nombrar lo que encuentra.
 */
function nombresDeControlRepetidos(raiz: HTMLElement): string[] {
  const controles = Array.from(raiz.querySelectorAll('button, a[href], [role="button"]'));
  const cuenta = new Map<string, number>();
  for (const el of controles) {
    const nombre = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!nombre) continue;
    cuenta.set(nombre, (cuenta.get(nombre) ?? 0) + 1);
  }
  return Array.from(cuenta.entries())
    .filter(([, veces]) => veces > 1)
    .map(([nombre]) => nombre)
    .sort();
}

describe("ProyectoDetalleView — pestañas", () => {
  it("tres pestañas, y «Actividad» NO está: la maqueta la lista, pero no hay bitácora que enseñar (P7)", async () => {
    vi.stubGlobal("fetch", fetchPorRuta());
    renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Partidas" })).toBeInTheDocument());

    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Partidas", "Fotografías", "Documento"]);
    expect(screen.queryByRole("tab", { name: /Actividad/i })).not.toBeInTheDocument();
  });

  it("la previa se pide al abrir la PESTAÑA, no al abrir la pantalla", async () => {
    const fetchMock = fetchPorRuta();
    vi.stubGlobal("fetch", fetchMock);
    renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([RUTA_DETALLE]);

    // Radix TabsTrigger activa por `onMouseDown` — ver config-view.test.tsx.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));

    await waitFor(() => expect(fetchMock.mock.calls.map(([url]) => url)).toContain(RUTA_DOCUMENTO));
  });

  it("con la pestaña «Documento» abierta, ningún par de controles comparte nombre accesible", async () => {
    vi.stubGlobal("fetch", fetchPorRuta());
    const { container } = renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());

    expect(nombresDeControlRepetidos(container)).toEqual([]);
  });

  it("control positivo del barrido: sobre un árbol que SÍ repite, lo nombra", () => {
    const testigo = document.createElement("div");
    testigo.innerHTML =
      '<button aria-label="Exportar X a Excel">Exportar Excel</button>' +
      '<button aria-label="Exportar X a Excel">Exportar Excel</button>' +
      '<button aria-label="Regenerar">Regenerar</button>';
    expect(nombresDeControlRepetidos(testigo)).toEqual(["Exportar X a Excel"]);
  });
});

describe("ProyectoDetalleView — la pestaña «Fotografías» se abre de verdad", () => {
  const PARTIDA: PartidaItem = {
    partida_id: "p-A-1",
    sku: "A-1",
    descripcion: "Candado industrial",
    marca: "BRAND1",
    tecnologia: null,
    color: null,
    imagen_url: "http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes/a1.png",
    cantidad: 1,
    total: 10,
    reservado: 0,
    disponible: 10,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: null,
    eje_banda: "sin_banda",
  };

  it("monta su PANEL, no solo su rótulo: el `value` del disparador y el del contenido coinciden", async () => {
    // Radix desmonta el contenido inactivo, así que sin este `mouseDown`
    // `ProyectoFotografias` no se monta NUNCA dentro de la vista y un `value`
    // mal escrito entre disparador y contenido viajaría en verde. El fixture
    // trae una partida CON foto a propósito: sobre `partidas: []` la aserción
    // la satisfaría el estado vacío (P17).
    vi.stubGlobal("fetch", fetchPorRuta(detalle({ partidas: [{ ...PARTIDA }] })));
    renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Fotografías" })).toBeInTheDocument());

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Fotografías" }));

    const panel = await screen.findByRole("tabpanel");
    expect(within(panel).getByAltText("Fotografía de A-1")).toBeInTheDocument();
    expect(within(panel).getByText(/1 de 1 partida con fotografía cargada/)).toBeInTheDocument();
  });
});

// ============================================================
// EL TRINQUETE DE VERDAD DE LAS PESTAÑAS NO DIRECCIONABLES.
//
// La cabecera de `proyecto-detalle-view.tsx` afirmaba que volver las pestañas
// direccionables pondría roja la prueba del Zoom. NO PUEDE: aquella prueba solo
// renderiza `<ProyectoZoom>` y el cambio se hace en OTRO árbol. Era una guarda
// declarada en prosa que no podía fallar (P19).
//
// Ésta sí lee el fuente que cambiaría.
// ============================================================
describe("las pestañas no son direccionables por URL — y hay algo que lo detecta", () => {
  const RUTA_VISTA = "src/components/proyectos/proyecto-detalle-view.tsx";

  it("si alguien mete `useSearchParams` aquí, esto se pone rojo y obliga a decidir sobre «Revisar y exportar» del Zoom", () => {
    const codigo = soloCodigo(readFileSync(join(process.cwd(), RUTA_VISTA), "utf8"));
    expect(codigo).not.toMatch(/\buseSearchParams\b/);
    // Anti-vacuidad: se está leyendo el archivo de verdad, no una cadena vacía.
    expect(codigo).toMatch(/\bTabsTrigger\b/);
  });

  it("control positivo, y su límite: muerde el `useSearchParams` de CÓDIGO y NO el de PROSA", () => {
    expect(soloCodigo("const s = useSearchParams();")).toMatch(/\buseSearchParams\b/);
    expect(soloCodigo("// haría falta useSearchParams y con él un Suspense\nconst a = 1;")).not.toMatch(/\buseSearchParams\b/);
  });
});

// ============================================================
// WCAG 2.5.3 · EL RÓTULO VISIBLE, CONTENIDO EN EL NOMBRE ACCESIBLE.
//
// Quien maneja el portal por voz lee lo que hay en pantalla y lo dice. Si el
// control se llama otra cosa, no pasa nada: el botón existe, se ve, y no
// responde a su propio nombre.
//
// MORDIÓ SOBRE ESTE ÁRBOL, no solo sobre el testigo de abajo. Con los
// `aria-label` que el hero tenía antes de este commit, devolvió los DOS:
//
//   «Exportar Excel» ⊄ «Exportar Rollout Retailer9 Series2 Q2 a Excel»
//   «Exportar PDF»   ⊄ «Exportar Rollout Retailer9 Series2 Q2 a PDF»
//
// ⚠ LO QUE ESTE BARRIDO **NO** CUBRE, dicho para que su verde no se lea de más
// (P17): mide el estado EN REPOSO. Varios botones cambian su texto visible a
// «Generando…» mientras trabajan y conservan su `aria-label`; en ese instante
// la regla se rompe y esto no lo ve. Es otro defecto, con otra forma —el texto
// visible es un ESTADO, no un nombre— y otra corrección: dejar el rótulo quieto
// y anunciar la ocupación aparte. Queda nombrado, no arreglado de pasada:
// ROTULO-OCUPADO-NO-CONCUERDA-CON-SU-NOMBRE.
//
// [Revisión C] ESTE límite (EN REPOSO vs OCUPADO) es un eje distinto del que
// también hacía falta cerrar: EN REPOSO, el barrido solo corría sobre UNO de
// los CUATRO estados posibles del panel de Documento (el que llega a
// `documento` puesto). Los otros tres —`EstadoError`, la tarjeta de fallo de
// render y el aviso angosto de «Regenerar» fallido— tienen su propia pasada
// en el describe «los barridos de a11y también sobre los otros TRES
// estados...», más abajo en este archivo.
// ============================================================
function rotulosQueNoEstanEnSuNombre(raiz: HTMLElement): string[] {
  return Array.from(raiz.querySelectorAll("button, a[href]")).flatMap((el) => {
    const nombre = el.getAttribute("aria-label");
    if (!nombre) return []; // Sin `aria-label` el nombre ES el texto: no hay nada que contradecir.
    const visible = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!visible) return []; // Botón solo-icono: su rótulo visible no es texto.
    return nombre.includes(visible) ? [] : [`«${visible}» ⊄ «${nombre}»`];
  });
}

describe("ningún control dice en pantalla algo que su nombre accesible no contenga", () => {
  it("en reposo, con la pestaña «Documento» abierta", async () => {
    vi.stubGlobal("fetch", fetchPorRuta());
    const { container } = renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());

    expect(rotulosQueNoEstanEnSuNombre(container)).toEqual([]);
  });

  it("control positivo: muerde el molde que tenían el hero y la previa antes de S-4", () => {
    const testigo = document.createElement("div");
    testigo.innerHTML =
      '<button aria-label="Exportar Rollout a PDF">Exportar PDF</button>' +
      '<button aria-label="Exportar PDF de Rollout">Exportar PDF</button>' +
      '<button aria-label="Cerrar"><svg></svg></button>';
    expect(rotulosQueNoEstanEnSuNombre(testigo)).toEqual(["«Exportar PDF» ⊄ «Exportar Rollout a PDF»"]);
  });
});

// ============================================================
// [Revisión C, MEDIO] Los dos barridos de arriba (`nombresDeControlRepetidos`
// y `rotulosQueNoEstanEnSuNombre`) solo se habían corrido sobre UNO de los
// CUATRO estados del panel de Documento — el que llega a `documento` puesto
// (P17 sobre el conjunto de estados, no sobre las intenciones). Tres
// controles nunca se habían barrido: «Reintentar» de `EstadoError` (fetch
// roto, primera carga), el botón de descarga del panel YA HABILITADO por un
// `renderError` (sin `documento`), y «Reintentar» del aviso angosto
// (`avisoRegenerar` con una previa buena detrás). Esta sección cierra los
// tres, en vez de solo ampliar la advertencia — que es lo que se prefirió.
// ============================================================
describe("los barridos de a11y también sobre los otros TRES estados del panel de Documento", () => {
  it("con `EstadoError` (el fetch del documento falló en la primera carga)", async () => {
    vi.stubGlobal("fetch", fetchPorRutaConDocumentoRoto());
    const { container } = renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());

    expect(nombresDeControlRepetidos(container)).toEqual([]);
    expect(rotulosQueNoEstanEnSuNombre(container)).toEqual([]);
  });

  it("con la tarjeta de fallo de render (pdf.js no pudo abrir el PDF, sin previa buena)", async () => {
    // `mockImplementationOnce`, no `mockReturnValueOnce`: con `ReturnValue` la
    // promesa rechazada se construye YA, al preparar el mock — mucho antes de
    // que el componente (fetch del detalle, click de pestaña, fetch del
    // documento) llegue a llamar `getDocument()` y recién ahí encadenarle un
    // `.promise` con `await`. Esa ventana es justo lo bastante larga para que
    // Vitest la marque como Unhandled Rejection (medido: reventó la corrida
    // completa la primera vez que se escribió así). Con `mockImplementation`,
    // la promesa nace en el mismo instante en que el código YA la va a
    // encadenar, sin ventana.
    vi.mocked(pdfjsDist.getDocument).mockImplementationOnce(
      () => ({ promise: Promise.reject(new Error("PDF corrupto")) }) as unknown as ReturnType<typeof pdfjsDist.getDocument>,
    );
    vi.stubGlobal("fetch", fetchPorRuta());
    const { container } = renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));
    await waitFor(() => expect(screen.getByText("No se pudo mostrar la vista previa de este documento")).toBeInTheDocument());

    expect(nombresDeControlRepetidos(container)).toEqual([]);
    expect(rotulosQueNoEstanEnSuNombre(container)).toEqual([]);
  });

  it("con el aviso angosto de «Regenerar» fallido (previa buena detrás)", async () => {
    vi.stubGlobal("fetch", fetchDetalleYDocumentoConSegundaFalla());
    const { container } = renderConRol("kam");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Documento" })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Documento" }));
    await waitFor(() => expect(container.querySelector("canvas")).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Regenerar la vista previa" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(nombresDeControlRepetidos(container)).toEqual([]);
    expect(rotulosQueNoEstanEnSuNombre(container)).toEqual([]);
  });
});
