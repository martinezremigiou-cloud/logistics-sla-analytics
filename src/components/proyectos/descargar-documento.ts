// ============================================================
// [INV-B8] descargar-documento.ts — descarga de
// `GET /api/proyectos/[id]/documento?formato=xlsx|pdf`.
//
// LA RUTA DEL SERVIDOR LO DEJA ESCRITO: "la UI por eso NO usa un ancla
// desnuda —pide la ruta, revisa el status y solo entonces materializa la
// descarga" (`src/app/api/proyectos/[id]/documento/route.ts`). Un `<a
// href>` a secas no puede distinguir un 200 binario de un 404/403 JSON: si
// el proyecto no es tuyo, el navegador guardaría igual un archivo
// "documento.pdf" con puro JSON adentro. Por eso esto es un `fetch` +
// `blob()` + enlace-objeto EFÍMERO, nunca un `<a>` apuntando directo a la
// ruta.
// ============================================================

const MENSAJE_ERROR_GENERICO = 'No se pudo generar el documento.';

/** Extrae el nombre de `Content-Disposition: attachment; filename="X"` — no se recalcula aquí, se LEE del servidor (única fuente del slug real). */
function nombreDesdeContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] ?? fallback;
}

export type ResultadoDescarga = { ok: true } | { ok: false; mensaje: string };

export type ResultadoDocumento = { ok: true; blob: Blob; nombre: string } | { ok: false; mensaje: string };

/**
 * PIDE el documento y devuelve sus BYTES. No los materializa: quién los usa
 * decide si dispara una descarga o los empotra en la pantalla.
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-B · S-4] POR QUÉ SE PARTIÓ EN DOS, y no es organización.
 *
 * La vista previa del documento tiene que enseñar **el PDF real**, no una
 * réplica en HTML — una segunda implementación del papel serían dos verdades
 * sobre lo mismo, que es lo que este repo pagó cuatro veces con
 * `piezas_en_camino`.
 *
 * Si la previa hiciera su propio `fetch`, habría **dos tratos del error**: uno
 * que sabe distinguir un 200 binario de un 404/403 JSON y otro que quizá no.
 * Compartir esta función deja **un solo trato del error y una sola ruta**.
 *
 * [2.0.1-C · D-3] LO DE ARRIBA YA NO ES CIERTO PARA TODOS LOS LLAMADORES, y
 * esta nota reemplaza DOS afirmaciones viejas de este mismo párrafo que había
 * que corregir juntas, no una sí y otra no otra vez.
 *
 * La primera («"es el mismo Blob" es FALSO») describía `descargarDocumentoProyecto`,
 * que SIGUE siendo cierta para él: esa función vuelve a llamar a esta de aquí
 * arriba, o sea un GET NUEVO, y el servidor rearma el documento desde cero con
 * `ahora: new Date()` —precisión de MINUTO (`modelo.ts:422`)— repinneando el
 * snapshot vigente de ESE instante. Por eso, desde D-3,
 * `descargarDocumentoProyecto` **solo admite `formato: 'xlsx'`**: es el único
 * camino que de verdad hace un segundo GET, y su firma ya no puede fingir que
 * sirve para un PDF que se supone que coincide con uno ya mostrado.
 *
 * El PDF NO pasa por `descargarDocumentoProyecto`. La previa
 * (`proyecto-documento-previa.tsx`) llama a `obtenerDocumentoProyecto` UNA vez,
 * conserva el `Blob`, y «Descargar este PDF» llama a `materializarDescarga`
 * (`:97`, más abajo) sobre ESE mismo `Blob` — cero GET nuevo. Para ese camino,
 * «es el mismo Blob» dejó de ser falso: es literalmente el contrato.
 *
 * La segunda afirmación vieja —que la divergencia entre dos GENERACIONES es
 * **forzosa**— también decía de más, y quedó **retractada por escrito** (P29 de
 * `docs/engineering/failure-patterns.md`, en la dirección contraria): dentro del mismo minuto y el mismo snapshot, dos
 * generaciones dicen exactamente lo mismo. Lo que se pierde es la GARANTÍA de
 * que coincidan, no la certeza de que difieran. Es **NO-GARANTIZABLE**, no
 * forzosa — y esa corrección nunca se había propagado hasta este archivo.
 * ────────────────────────────────────────────────────────────
 */
export async function obtenerDocumentoProyecto(
  proyectoId: string,
  formato: 'xlsx' | 'pdf',
  nombreFallback: string,
): Promise<ResultadoDocumento> {
  try {
    const res = await fetch(`/api/proyectos/${encodeURIComponent(proyectoId)}/documento?formato=${formato}`);
    if (!res.ok) {
      let mensaje = MENSAJE_ERROR_GENERICO;
      try {
        const body = (await res.json()) as { message?: string };
        if (typeof body.message === 'string' && body.message) mensaje = body.message;
      } catch {
        // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
      }
      return { ok: false, mensaje };
    }

    return {
      ok: true,
      blob: await res.blob(),
      nombre: nombreDesdeContentDisposition(res.headers.get('Content-Disposition'), nombreFallback),
    };
  } catch {
    return { ok: false, mensaje: MENSAJE_ERROR_GENERICO };
  }
}

/**
 * Materializa la descarga de un `Blob` YA EN MEMORIA vía un `<a>` efímero
 * sobre un object URL — nunca sobre la URL de la API. Sin `fetch`: quien
 * llama ya tiene los bytes.
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-C · D-3] Extraída de `descargarDocumentoProyecto` para que la previa
 * del documento (`proyecto-documento-previa.tsx`) pueda ofrecer «Descargar
 * este PDF» sobre el MISMO `Blob` que ya tiene en pantalla, sin un segundo
 * GET. Es el cierre de `PREVIA-Y-DESCARGA-NO-COMPARTEN-BYTES`: el botón vive
 * dentro del componente que sostiene el blob, así que compartirlo dejó de
 * ser estado entre componentes — es una función pura sobre un `Blob` que ya
 * se tiene.
 */
export function materializarDescarga(blob: Blob, nombre: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = objectUrl;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Pide el documento, y solo si la respuesta es 200 (binario) materializa la
 * descarga. En cualquier error (status !=200 o excepción de red) NO se
 * dispara ninguna descarga: se regresa el mensaje curado del API para que
 * el caller lo muestre (p.ej. `toast.error`).
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-C · D-3] `formato` SOLO ADMITE `'xlsx'`, y es un candado, no un
 * antojo de tipos. Esta función hace un GET NUEVO cada vez — es exactamente
 * lo que el PDF, desde D-3, no puede permitirse: «en el panel hay UN solo
 * camino al PDF, y es el mostrado» (`proyecto-documento-previa.tsx`). Antes
 * la firma admitía `'xlsx' | 'pdf'` con CERO llamadores de producción para
 * `'pdf'` — la doctrina vivía en un comentario y la firma seguía permitiendo
 * violarla. Volver el caso inexpresable en el TIPO (el
 * antídoto estructural es volver el caso inexpresable en la firma) es lo
 * que hace que un futuro «Exportar PDF fresco» en el hero o el panel no
 * compile, en vez de depender de que alguien recuerde la regla.
 */
export async function descargarDocumentoProyecto(
  proyectoId: string,
  formato: 'xlsx',
  nombreFallback: string,
): Promise<ResultadoDescarga> {
  const documento = await obtenerDocumentoProyecto(proyectoId, formato, nombreFallback);
  if (!documento.ok) return { ok: false, mensaje: documento.mensaje };

  materializarDescarga(documento.blob, documento.nombre);
  return { ok: true };
}
