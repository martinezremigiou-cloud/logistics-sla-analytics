import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { soloCodigo, sinComentarios } from "@/lib/guardas/codigo-fuente";
import { ProyectoDocumentoPrevia } from "./proyecto-documento-previa";
import * as pdfjsDist from "pdfjs-dist";

// ============================================================
// [2.0.1-C · F-6] pdf.js se MOCKEA ENTERO: en jsdom `canvas` NO renderiza
// (`HTMLCanvasElement.prototype.getContext` no está implementado sin el
// paquete `canvas`), así que aquí no se prueba que el PDF se vea bien — eso
// lo midió el spike (ver la cabecera del componente) y se confirma en el
// QA manual de navegador (§6 del reporte). Lo que SÍ se prueba, y es todo lo que
// esta suite puede sostener honestamente, es el CABLEADO: que se le pasan a
// pdf.js los bytes correctos, que se piden TODAS las páginas, que un fallo
// de pdf.js cae en el estado correcto, y que «Descargar este PDF» reutiliza
// el mismo `Blob` sin un segundo `fetch`.
// ============================================================
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";
const RUTA_PDF = `/api/proyectos/${PROYECTO_ID}/documento?formato=pdf`;
const RUTA_XLSX = `/api/proyectos/${PROYECTO_ID}/documento?formato=xlsx`;

/** Los bytes que "sirve" la ruta. Las pruebas de cableado comparan esto contra lo que le llega a pdf.js. */
const BYTES_DEL_PDF = "%PDF-1.3 este es el documento real";

/**
 * El cuerpo se pasa como CADENA, no como `new Blob([...])`.
 *
 * Medido: el `Blob` de jsdom no es un `BodyInit` que el `Response` global
 * (undici) reconozca, y lo serializa a la cadena literal `"[object Blob]"`. Una
 * prueba de FIDELIDAD montada sobre ese fixture compara basura contra basura y
 * pasa igual con el código roto — P26, el fixture prueba tu comprensión.
 */
function respuestaPdfOk(bytes = BYTES_DEL_PDF) {
  return new Response(bytes, { status: 200, headers: { "Content-Disposition": 'attachment; filename="PRJ-001.pdf"' } });
}

function respuestaOk(bytes = BYTES_DEL_PDF) {
  return vi.fn(async () => respuestaPdfOk(bytes));
}

/**
 * Sirve PDF y XLSX por la misma ruta base, distinguidos por `formato=`. Lo
 * necesita la prueba movida del hero.
 *
 * CADENA, no `new Blob([...])` — el mismo P26 de `respuestaPdfOk`, arriba:
 * un `Blob` de jsdom no es un `BodyInit` que `Response` reconozca y se
 * serializa a `"[object Blob]"`.
 */
function fetchPdfYExcel() {
  return vi.fn(async (url: string) => {
    if (url.includes("formato=xlsx")) {
      return new Response("contenido-excel", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="PRJ-001.xlsx"' },
      });
    }
    return respuestaPdfOk();
  });
}

/**
 * Cuenta y NOMBRA cada object URL creado y revocado.
 *
 * El stub de `vitest.setup.ts` devuelve SIEMPRE la misma cadena
 * (`blob:mock-url`), y con un valor constante ninguna prueba puede distinguir
 * un blob de otro — pasaría igual con el código roto (P25). Aquí cada URL
 * lleva su número, y se registra también el `Blob` con el que se creó (para
 * la identidad de D-3).
 */
function espiarObjectUrl() {
  const creados: string[] = [];
  const revocados: string[] = [];
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((objeto: Blob | MediaSource) => {
    blobs.push(objeto as Blob);
    const url = `blob:previa-${creados.length + 1}`;
    creados.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    revocados.push(url);
  });
  return { creados, revocados, blobs };
}

function pintar() {
  return render(<ProyectoDocumentoPrevia proyectoId={PROYECTO_ID} folio="PRJ-001" titulo="Rollout Retailer9 Series2 Q2" />);
}

type GetDocumentReturn = ReturnType<typeof pdfjsDist.getDocument>;

function paginaMock(renderPromise: Promise<void> = Promise.resolve()) {
  return {
    getViewport: vi.fn(() => ({ width: 612, height: 792 })),
    render: vi.fn(() => ({ promise: renderPromise })),
  };
}

/** Configura `getDocument` para que "abra" un documento de `numPaginas`, todas pintando bien. Devuelve los espías para aseverar sobre ellos. */
function pdfjsExito(numPaginas = 1) {
  const paginas = Array.from({ length: numPaginas }, () => paginaMock());
  const getPage = vi.fn((numero: number) => Promise.resolve(paginas[numero - 1]));
  const documentoFalso = { numPages: numPaginas, getPage };
  vi.mocked(pdfjsDist.getDocument).mockReturnValue({ promise: Promise.resolve(documentoFalso) } as unknown as GetDocumentReturn);
  return { paginas, getPage };
}

/**
 * `getDocument` "abre" el documento; las páginas 1..N-1 pintan bien y la
 * ÚLTIMA se queda esperando hasta que el test llame `rechazarUltimoRender()`.
 *
 * Expone `ultimaPaginaRender` para que el test pueda esperar (`waitFor`) a
 * que el componente ya esté DENTRO del `await pagina.render(...).promise` de
 * esa página antes de rechazar — rechazar antes de eso solo tumbaría una
 * promesa que todavía nadie está escuchando, y el fallo se leería en el
 * turno equivocado.
 */
function pdfjsFallaAMediaTanda(numPaginas: number) {
  let rechazar!: (error: Error) => void;
  const renderQueFalla = new Promise<void>((_resolver, rej) => {
    rechazar = rej;
  });
  const paginas = Array.from({ length: numPaginas - 1 }, () => paginaMock());
  const ultimaPagina = paginaMock(renderQueFalla);
  paginas.push(ultimaPagina);
  const getPage = vi.fn((numero: number) => Promise.resolve(paginas[numero - 1]));
  vi.mocked(pdfjsDist.getDocument).mockReturnValue({
    promise: Promise.resolve({ numPages: numPaginas, getPage }),
  } as unknown as GetDocumentReturn);
  return {
    ultimaPaginaRender: ultimaPagina.render,
    rechazarUltimoRender: () => rechazar(new Error("página rota")),
  };
}

/**
 * `getDocument` rechaza directamente: el archivo llegó, pdf.js no lo pudo
 * abrir.
 *
 * `mockImplementation`, no `mockReturnValue`: con `ReturnValue` la promesa
 * rechazada nace YA, al configurar el mock, mucho antes de que el
 * componente encadene su propio `await ....promise` — una ventana real
 * donde Vitest puede marcarla Unhandled Rejection (medido, reventó la
 * corrida completa de `proyecto-detalle-view.test.tsx` con el molde
 * `ReturnValueOnce`). Con `mockImplementation` la promesa se construye EN
 * el instante en que `getDocument()` se llama de verdad, ya con el `await`
 * a punto de encadenarse.
 */
function pdfjsFalla(mensaje = "PDF corrupto") {
  vi.mocked(pdfjsDist.getDocument).mockImplementation(() => ({ promise: Promise.reject(new Error(mensaje)) }) as unknown as GetDocumentReturn);
}

beforeEach(() => {
  vi.mocked(pdfjsDist.getDocument).mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProyectoDocumentoPrevia — el PDF real, pintado con pdf.js", () => {
  it("al montarse pide el PDF UNA vez, se lo pasa a pdf.js y pinta un <canvas> por página, pidiéndolas TODAS", async () => {
    const fetchMock = respuestaOk();
    vi.stubGlobal("fetch", fetchMock);
    const { paginas, getPage } = pdfjsExito(2);

    const { container } = pintar();

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(RUTA_PDF);

    // Se piden TODAS las páginas, en orden.
    expect(getPage.mock.calls.map(([n]) => n)).toEqual([1, 2]);
    expect(paginas[0].render).toHaveBeenCalledTimes(1);
    expect(paginas[1].render).toHaveBeenCalledTimes(1);
  });

  it('mientras genera, lo anuncia con `role="status"` — un aria-label sobre el Skeleton pelón no llega a nadie', async () => {
    let resolver!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { resolver = res; })));
    pdfjsExito(1);
    const { container } = pintar();

    // El rótulo tiene que estar en un elemento CON rol, no en un `generic`.
    expect(screen.getByRole("status", { name: "Generando la vista previa del documento…" })).toBeInTheDocument();

    resolver(respuestaPdfOk());
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un «Regenerar» que falla por RED no borra la previa que funcionaba", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaPdfOk())
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Fallo interno" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(1);
    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Regenerar la vista previa" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByRole("alert").textContent).toContain("sigues viendo el anterior");
    expect(screen.getByRole("alert").textContent).toContain("Fallo interno");
    // El lienzo anterior sigue exactamente igual: ni se vació ni se duplicó.
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    // Y NO el titular de `EstadoError`, que aquí sería falso: la información SÍ cargó (la vieja sigue en pantalla).
    expect(screen.queryByText("No se pudo cargar la información")).not.toBeInTheDocument();
  });

  it("un «Regenerar» cuyo FETCH sale bien pero pdf.js no puede DIBUJAR el documento nuevo tampoco borra la previa", async () => {
    vi.stubGlobal("fetch", respuestaOk());
    pdfjsExito(1);
    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));

    pdfjsFalla("estructura de PDF inválida");
    fireEvent.click(screen.getByRole("button", { name: "Regenerar la vista previa" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert").textContent).toContain("sigues viendo el anterior");
    expect(screen.getByRole("alert").textContent).toContain("El documento nuevo no se pudo dibujar.");
    // El lienzo viejo (1 canvas) sigue intacto: el intento fallido nunca llegó a tocar el DOM.
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("un fallo a MEDIA TANDA (página 2 de 2) no deja el lienzo a medio reemplazar: o entra COMPLETA, o no entra", async () => {
    vi.stubGlobal("fetch", respuestaOk());
    pdfjsExito(2);
    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));

    const { ultimaPaginaRender, rechazarUltimoRender } = pdfjsFallaAMediaTanda(2);
    fireEvent.click(screen.getByRole("button", { name: "Regenerar la vista previa" }));
    // Solo rechazar una vez que el componente YA está esperando esta página —
    // si no, se rechaza una promesa que todavía nadie escucha.
    await waitFor(() => expect(ultimaPaginaRender).toHaveBeenCalledTimes(1));
    rechazarUltimoRender();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    // Ni 0 (se vació) ni 1 (mitad vieja, mitad nueva): las 2 canvases del intento ANTERIOR, intactas.
    expect(container.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("primera carga: el fetch trae el archivo pero pdf.js no lo puede dibujar → tarjeta SIN botón propio, no el titular de EstadoError", async () => {
    vi.stubGlobal("fetch", respuestaOk());
    pdfjsFalla();

    const { container } = pintar();

    await waitFor(() => expect(screen.getByText("No se pudo mostrar la vista previa de este documento")).toBeInTheDocument());
    // Sería FALSO aquí: la información sí llegó, solo no se pudo dibujar.
    expect(screen.queryByText("No se pudo cargar la información")).not.toBeInTheDocument();
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    // Sin botón propio en la tarjeta: DOS AFORDANCIAS para la misma acción se
    // evitaron a propósito (ver la cabecera del componente). La única forma
    // de bajarlo es el botón del panel, y aquí SÍ está habilitado.
    expect(screen.queryByRole("button", { name: "Descargar PDF" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" })).toBeEnabled();
  });

  it("con un fallo de render sin previa buena, el botón del panel deja llevarse el archivo: baja el MISMO blob, sin un segundo fetch", async () => {
    const fetchMock = respuestaOk();
    vi.stubGlobal("fetch", fetchMock);
    pdfjsFalla();
    const espia = espiarObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    pintar();
    const botonDescargar = await screen.findByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" });
    await waitFor(() => expect(botonDescargar).toBeEnabled());

    fireEvent.click(botonDescargar);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(espia.creados).toHaveLength(1);
    expect(await espia.blobs[0].text()).toBe(BYTES_DEL_PDF);
  });

  it("404 en la primera carga: mensaje curado del API, NO llega a pdf.js", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "proyecto_no_encontrado", message: "El proyecto no existe o no es tuyo." }), { status: 404 })),
    );

    const { container } = pintar();

    await waitFor(() => expect(screen.getByText("El proyecto no existe o no es tuyo.")).toBeInTheDocument());
    expect(container.querySelectorAll("canvas")).toHaveLength(0);
    expect(pdfjsDist.getDocument).not.toHaveBeenCalled();
  });

  it("tras el error de red, «Reintentar» vuelve a pedir y pinta", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: "Fallo interno" }), { status: 500 }))
      .mockResolvedValueOnce(respuestaPdfOk());
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(1);

    const { container } = pintar();
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("desmontar con la petición (fetch) EN VUELO no llega a pdf.js — ni fuga ni estado sobre un árbol muerto", async () => {
    let resolver!: (r: Response) => void;
    const enVuelo = new Promise<Response>((res) => {
      resolver = res;
    });
    vi.stubGlobal("fetch", vi.fn(() => enVuelo));
    pdfjsExito(1);

    const { unmount } = pintar();
    unmount();
    resolver(respuestaPdfOk());
    await enVuelo;
    await new Promise((r) => setTimeout(r, 0));

    expect(pdfjsDist.getDocument).not.toHaveBeenCalled();
  });

  /**
   * [Revisión C, MEDIO] Esta prueba existía con una aserción vacua: comparaba
   * `container.querySelectorAll("canvas")` DESPUÉS de `unmount()`, y
   * `unmount()` ya vacía `container` por sí solo — sale en 0 con o sin
   * ninguna guarda en el componente. Corregido para decir lo que
   * HONESTAMENTE se puede probar aquí, no lo que sonaba bien:
   *
   * Medido con una sonda instrumentada (no supuesto): React pone
   * `lienzoRef.current = null` DURANTE el desmontaje, ANTES de correr la
   * limpieza de este `useEffect` — o sea antes de que el código de
   * `pedir()` pueda leer su testigo. Por eso `lienzoRef.current?.replaceChildren(...)`
   * ya sería un no-op CON o SIN el guardián `esMiTurno()`, y React 18 además
   * descarta en silencio (sin aviso en consola) un `setState` sobre un
   * componente desmontado. Esta prueba solo puede sostener «no truena, no
   * cuelga» — que sigue siendo valioso como regresión, pero no discrimina el
   * guardián.
   *
   * LA PRUEBA QUE SÍ DISCRIMINA el guardián por invocación vive dos pruebas
   * más abajo («cambiar `proyectoId` SIN desmontar»): ahí el árbol sigue
   * vivo, el ref sigue apuntando a un nodo real, y una invocación vieja SÍ
   * podría pisar la nueva si el guardián no funcionara — es la que de verdad
   * se pondría roja si alguien borra `esMiTurno()`.
   */
  it("desmontar con el RENDER de pdf.js en vuelo no truena ni cuelga (ver límite arriba: no discrimina el guardián por sí sola)", async () => {
    vi.stubGlobal("fetch", respuestaOk());
    let resolverRender!: () => void;
    const renderEnVuelo = new Promise<void>((res) => {
      resolverRender = res;
    });
    const pagina = paginaMock(renderEnVuelo);
    const getPage = vi.fn(() => Promise.resolve(pagina));
    vi.mocked(pdfjsDist.getDocument).mockReturnValue({
      promise: Promise.resolve({ numPages: 1, getPage }),
    } as unknown as GetDocumentReturn);

    const { unmount } = pintar();
    await waitFor(() => expect(pagina.render).toHaveBeenCalledTimes(1));
    unmount();
    resolverRender();

    // La única aserción honesta: la promesa se resuelve sin lanzar. Si algo
    // en `pedir()` truena al reanudar tras el desmontaje, este `await`
    // rechaza y el test falla solo.
    await expect(renderEnVuelo).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("cambiar `proyectoId` SIN desmontar: la respuesta TARDÍA del proyecto viejo no pisa el documento del nuevo (testigo por invocación, no por componente)", async () => {
    const PROYECTO_NUEVO = "22222222-2222-2222-2222-222222222222";
    let resolverViejo!: (r: Response) => void;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes(PROYECTO_ID)) {
        return new Promise<Response>((res) => {
          resolverViejo = res;
        });
      }
      return Promise.resolve(new Response("BYTES-DEL-NUEVO", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(1);
    const espia = espiarObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { rerender } = render(<ProyectoDocumentoPrevia proyectoId={PROYECTO_ID} folio="PRJ-001" titulo="Proyecto viejo" />);
    // El proyecto VIEJO se queda esperando su propio fetch — nunca resuelto todavía.

    // Mismo árbol de React, mismo componente: `proyectoId` cambia SIN desmontar.
    rerender(<ProyectoDocumentoPrevia proyectoId={PROYECTO_NUEVO} folio="PRJ-002" titulo="Proyecto nuevo" />);
    const botonNuevo = await screen.findByRole("button", { name: "Descargar este PDF de Proyecto nuevo" });
    await waitFor(() => expect(botonNuevo).toBeEnabled());

    // AHORA, tarde, resuelve el fetch del proyecto viejo — con testigo por
    // COMPONENTE (`vivo` booleano) esto habría escrito su Blob encima.
    resolverViejo(new Response("BYTES-DEL-VIEJO", { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));

    fireEvent.click(botonNuevo);
    expect(await espia.blobs[espia.blobs.length - 1].text()).toBe("BYTES-DEL-NUEVO");
  });
});

describe("ProyectoDocumentoPrevia — la carrera Descargar-mientras-Regenerar", () => {
  it("«Descargar este PDF» durante un «Regenerar» en vuelo baja el blob VIEJO (el que está en pantalla), sin esperar al nuevo ni disparar un fetch propio", async () => {
    let resolverSegundo!: (r: Response) => void;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaPdfOk("BYTES-VIEJOS"))
      .mockReturnValueOnce(new Promise<Response>((res) => { resolverSegundo = res; }));
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(1);
    const espia = espiarObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Regenerar la vista previa" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // El segundo `fetch` (el de "Regenerar") sigue SIN resolver. Descargar AHORA:
    fireEvent.click(screen.getByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" }));

    expect(fetchMock).toHaveBeenCalledTimes(2); // ningún fetch nuevo por el clic de descargar
    expect(espia.creados).toHaveLength(1);
    expect(await espia.blobs[0].text()).toBe("BYTES-VIEJOS"); // el que está EN PANTALLA, no el que todavía no llegó

    // Cierre limpio: se deja resolver el segundo fetch para no dejar la promesa colgada.
    resolverSegundo(respuestaPdfOk("BYTES-VIEJOS"));
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("ProyectoDocumentoPrevia — D-3: «Descargar este PDF» reutiliza el blob mostrado", () => {
  it("está deshabilitado hasta que hay un documento pintado, y se habilita cuando lo hay", async () => {
    let resolver!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((res) => { resolver = res; })));
    pdfjsExito(1);

    pintar();
    expect(screen.getByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" })).toBeDisabled();

    resolver(respuestaPdfOk());
    await waitFor(() => expect(screen.getByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" })).toBeEnabled());
  });

  it("baja el MISMO blob que pdf.js recibió, sin un segundo fetch. Versión rota que esto detecta: un botón que vuelva a llamar `descargarDocumentoProyecto(id,'pdf')`", async () => {
    const fetchMock = respuestaOk();
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(2);
    const espia = espiarObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Descargar este PDF de Rollout Retailer9 Series2 Q2" }));

    // Si la versión rota hiciera un GET nuevo, esto pasaría de 1 a 2.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(espia.creados).toHaveLength(1);
    expect(await espia.blobs[0].text()).toBe(BYTES_DEL_PDF);
  });

  it("botón «Exportar Excel» del panel dispara fetch a .../documento?formato=xlsx, sin tocar el PDF ya mostrado", async () => {
    const fetchMock = fetchPdfYExcel();
    vi.stubGlobal("fetch", fetchMock);
    pdfjsExito(1);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { container } = pintar();
    await waitFor(() => expect(container.querySelectorAll("canvas")).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Exportar Excel de Rollout Retailer9 Series2 Q2" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(RUTA_XLSX));

    // El PDF mostrado no se tocó: sigue siendo la misma única llamada de antes.
    expect(fetchMock.mock.calls.filter(([url]) => url === RUTA_PDF)).toHaveLength(1);
  });
});

describe("ProyectoDocumentoPrevia — fidelidad del CABLEADO (no del render)", () => {
  // [2.0.1-C] Esta prueba CAMBIÓ DE FORMA respecto a S-4, y hay que decirlo:
  // antes comparaba los bytes empotrados en el `<object>` contra los
  // servidos. Ahora jsdom no puede pintar un `<canvas>`, así que lo único
  // verificable aquí es que LOS BYTES QUE RECIBE `getDocument` son los que
  // sirvió la ruta — es una aserción MÁS DÉBIL que un render: prueba el
  // cableado, no que el documento se vea bien. La fidelidad VISUAL la midió
  // el spike contra documentos de muestra (ver la cabecera del componente), no
  // esta suite.
  it("los bytes que llegan a `getDocument` son los que sirvió la ruta", async () => {
    vi.stubGlobal("fetch", respuestaOk());
    pdfjsExito(1);

    pintar();
    await waitFor(() => expect(pdfjsDist.getDocument).toHaveBeenCalledTimes(1));

    const [argumentos] = vi.mocked(pdfjsDist.getDocument).mock.calls[0];
    const datos = (argumentos as { data: Uint8Array }).data;
    expect(new TextDecoder().decode(datos)).toBe(BYTES_DEL_PDF);
  });
});

describe("ProyectoDocumentoPrevia — la única verdad, aseverada sobre el FUENTE", () => {
  const FUENTE = readFileSync(join(process.cwd(), "src/components/proyectos/proyecto-documento-previa.tsx"), "utf8");

  it("no hace su propio `fetch`: pasa por `obtenerDocumentoProyecto`, que es donde vive el trato del error", () => {
    const codigo = soloCodigo(FUENTE);
    expect(codigo).not.toMatch(/\bfetch\s*\(/);
    expect(codigo).toMatch(/obtenerDocumentoProyecto\s*\(/);
  });

  it("control positivo del guardián, y su límite: muerde un `fetch(` de CÓDIGO y NO uno de PROSA", () => {
    expect(soloCodigo("const a = 1;\nawait fetch('/api/x');")).toMatch(/\bfetch\s*\(/);
    // La regla de la prosa: el comentario que EXPLICA por qué no se hace `fetch(`
    // no puede ser lo que dispare la guarda. Es la clase que cerró `codigo-fuente.ts`.
    expect(soloCodigo("// aquí NO se hace fetch(porque ya lo hace el helper\nconst b = 2;")).not.toMatch(/\bfetch\s*\(/);
  });

  // OJO: aquí NO sirve `soloCodigo` — lo que esta guarda busca VIVE dentro de
  // una cadena (`"pdfjs-dist"`), y `sinCadenas` la blanquearía junto con todo
  // lo demás, volviendo la guarda incapaz de fallar (P19) sin importar lo que
  // diga el archivo. Mismo criterio que ya deja escrito `codigo-fuente.ts`
  // para `nav-nombres.test.ts`: solo se quitan los COMENTARIOS.
  it("pdf.js se importa con `import()` dentro de una función, nunca en el nivel superior del módulo", () => {
    const marcado = sinComentarios(FUENTE);
    const lineasImportEstatico = marcado.split("\n").filter((l) => /^import\b/.test(l.trim()));
    expect(lineasImportEstatico.some((l) => l.includes("pdfjs-dist"))).toBe(false);
    expect(marcado).toMatch(/await import\(["']pdfjs-dist["']\)/);
  });

  it("control positivo: un `import` estático de pdfjs-dist en el nivel superior SÍ lo detectaría", () => {
    const conImportEstatico = 'import { getDocument } from "pdfjs-dist";\nexport function X() {}';
    const marcado = sinComentarios(conImportEstatico);
    const lineasImportEstatico = marcado.split("\n").filter((l) => /^import\b/.test(l.trim()));
    expect(lineasImportEstatico.some((l) => l.includes("pdfjs-dist"))).toBe(true);
  });
});

// ============================================================
// [Revisión C, ALTO 1] WORKER-DESINCRONIZADO — el archivo existe Y es de la
// MISMA versión.
//
// `public/pdf.worker.min.mjs` NO viaja en el clon (está en `.gitignore` a
// propósito) y lo produce un `postinstall` que falla SUAVE (avisa, sale 0):
// correcto para no tumbar `npm install` por un asset de una pestaña, pero
// deja un hueco real — un `npm ci --ignore-scripts`, o un `postinstall` que
// se saltó, o una versión vieja de `public/` que sobrevivió a un
// `npm update pdfjs-dist` sin que nadie vuelva a correr el script — y
// NINGUNO de los tres instrumentos de `verificar` lo detecta: la suite
// entera mockea `pdfjs-dist` (arriba) y `next build` no lee `public/`.
//
// Esto cierra ese hueco con un SEGUNDO momento que falla CERRADO: si el
// archivo no existe, o existe pero es BYTE-DISTINTO del que trae la versión
// instalada del paquete, `npm run verificar` se pone rojo aquí.
// ============================================================
describe("public/pdf.worker.min.mjs — no puede faltar ni estar desincronizado", () => {
  const RUTA_WORKER_PUBLICO = join(process.cwd(), "public", "pdf.worker.min.mjs");
  const RUTA_WORKER_PAQUETE = join(process.cwd(), "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");

  function sha256(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  it("existe y es BYTE-IDÉNTICO al worker que trae la versión instalada de pdfjs-dist", () => {
    expect(existsSync(RUTA_WORKER_PUBLICO)).toBe(true);
    expect(existsSync(RUTA_WORKER_PAQUETE)).toBe(true);

    const workerPublico = readFileSync(RUTA_WORKER_PUBLICO);
    const workerPaquete = readFileSync(RUTA_WORKER_PAQUETE);

    // ────────────────────────────────────────────────────────────
    // [2.0.1-C, 8-sep] NO VACÍOS — y esta línea tapa una grieta MEDIDA.
    //
    // Se señaló que esta guarda podía «comparar dos ausencias». Se midió
    // en vez de razonarlo, con los cinco casos de presencia: faltar uno,
    // faltar el otro, faltar los dos y diferir en contenido salen ROJOS —
    // los `existsSync` de arriba disparan antes de llegar al hash.
    //
    // Pero hay una sexta forma, que su instinto acertó un paso más allá:
    // **los dos presentes y de 0 bytes**. Dos archivos vacíos tienen el mismo
    // tamaño y el mismo sha256, así que las dos aserciones de abajo salían
    // VERDES sobre nada. Y es alcanzable: `copiar-pdf-worker.mjs`
    // interrumpido a media copia deja un archivo creado y vacío.
    //
    // El worker real mide más de un megabyte. No se fija un piso en ese número
    // —envejecería con cada versión de pdfjs-dist— sino la única propiedad
    // que la comparación no puede darse a sí misma: que haya algo que
    // comparar.
    // ────────────────────────────────────────────────────────────
    expect(workerPublico.length, "el worker de public/ está VACÍO: la comparación de hash sería vacua").toBeGreaterThan(0);
    expect(workerPaquete.length, "el worker de node_modules está VACÍO: la comparación de hash sería vacua").toBeGreaterThan(0);

    // El tamaño primero: si algún día esto falla, un mensaje
    // "262144 !== 200000" se lee en un segundo; un diff de hex de 1.2 MB no.
    expect(workerPublico.length).toBe(workerPaquete.length);
    expect(sha256(workerPublico)).toBe(sha256(workerPaquete));
  });

  it("control positivo de la grieta: con DOS archivos vacíos, tamaño y sha256 dicen «iguales» — solo el piso los separa", () => {
    // Reproduce el escenario exacto que salía verde antes de la línea de
    // arriba. Si alguien quita el `toBeGreaterThan(0)`, esta prueba explica
    // en su propio cuerpo qué se perdió.
    const vacioA = Buffer.alloc(0);
    const vacioB = Buffer.alloc(0);

    expect(vacioA.length).toBe(vacioB.length);
    expect(sha256(vacioA)).toBe(sha256(vacioB));
    // …y sin embargo no hay worker ninguno.
    expect(vacioA.length).toBe(0);
  });

  it("control positivo: la MISMA comparación (lectura real + sha256) SÍ distingue un archivo de otro — no es una guarda vacua", () => {
    const workerPaquete = readFileSync(RUTA_WORKER_PAQUETE);
    // Cualquier otro archivo del propio paquete, con certeza de contenido
    // (y casi seguro tamaño) distinto — se lee con el MISMO código, no con
    // un fixture de juguete que podría no ejercitar el camino real.
    const otroArchivoDelPaquete = readFileSync(join(process.cwd(), "node_modules", "pdfjs-dist", "package.json"));
    expect(sha256(workerPaquete)).not.toBe(sha256(otroArchivoDelPaquete));
  });
});
