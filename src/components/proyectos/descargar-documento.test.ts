import { describe, it, expect, vi, afterEach } from "vitest";
import { descargarDocumentoProyecto } from "./descargar-documento";

const PROYECTO_ID = "11111111-1111-1111-1111-111111111111";

/** Espía `document.createElement("a")` y regresa el último `<a>` creado — sin tocar el resto del DOM real. */
function espiarUltimoAncla(): { obtener: () => HTMLAnchorElement | null } {
  const original = document.createElement.bind(document);
  let ultimo: HTMLAnchorElement | null = null;
  vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const el = original(tag, options);
    if (tag === "a") ultimo = el as HTMLAnchorElement;
    return el;
  });
  return { obtener: () => ultimo };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("descargarDocumentoProyecto", () => {
  it("200: pide la ruta correcta, materializa la descarga (createObjectURL + click) y regresa ok:true", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Blob(["contenido"]), {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="PRJ-001-rollout.xlsx"' },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");
    const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const ancla = espiarUltimoAncla();

    const resultado = await descargarDocumentoProyecto(PROYECTO_ID, "xlsx", "fallback.xlsx");

    expect(resultado).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(`/api/proyectos/${PROYECTO_ID}/documento?formato=xlsx`);
    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(revokeObjectURLSpy).toHaveBeenCalled();
    // Content-Disposition manda sobre el fallback — el nombre real lo pone el servidor.
    expect(ancla.obtener()?.download).toBe("PRJ-001-rollout.xlsx");
  });

  it("sin Content-Disposition: usa el nombre de fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"]), { status: 200 })));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const ancla = espiarUltimoAncla();

    // [2.0.1-C · D-3] Solo "xlsx": esta función ya no admite "pdf" en su tipo
    // — ver la cabecera de `descargarDocumentoProyecto`. El PDF baja por
    // `materializarDescarga` sobre el Blob que la previa ya tiene, probado
    // en `proyecto-documento-previa.test.tsx`.
    await descargarDocumentoProyecto(PROYECTO_ID, "xlsx", "fallback.xlsx");

    expect(ancla.obtener()?.download).toBe("fallback.xlsx");
  });

  it("404 con JSON de error: NO descarga nada, regresa ok:false con el mensaje del API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "proyecto_no_encontrado", message: "El proyecto no existe o no es tuyo." }), { status: 404 })),
    );
    const createObjectURLSpy = vi.spyOn(URL, "createObjectURL");

    const resultado = await descargarDocumentoProyecto(PROYECTO_ID, "xlsx", "fallback.xlsx");

    expect(resultado).toEqual({ ok: false, mensaje: "El proyecto no existe o no es tuyo." });
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it("404 con cuerpo no-JSON: ok:false con mensaje genérico (nunca lanza)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>error</html>", { status: 404 })));
    const resultado = await descargarDocumentoProyecto(PROYECTO_ID, "xlsx", "fallback.xlsx");
    expect(resultado).toEqual({ ok: false, mensaje: "No se pudo generar el documento." });
  });

  it("error de red (fetch lanza): ok:false con mensaje genérico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const resultado = await descargarDocumentoProyecto(PROYECTO_ID, "xlsx", "fallback.xlsx");
    expect(resultado).toEqual({ ok: false, mensaje: "No se pudo generar el documento." });
  });
});
