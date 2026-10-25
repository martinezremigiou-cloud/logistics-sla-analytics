"use client";

// ============================================================
// [2.0.1-C · F-5/F-6/D-3] proyecto-documento-previa.tsx — la pestaña
// Documento: el PDF real, pintado con pdf.js, con el panel de descarga al
// lado.
//
// Esta cabecera reemplaza la de [2.0.1-B · S-4]. Lo que sigue siendo cierto
// se repite; lo que cambió, se dice cómo y por qué.
//
// ────────────────────────────────────────────────────────────
// LA REGLA QUE SIGUE ORDENANDO ESTE ARCHIVO: se muestra el PDF real o no se
// hace. Los bytes que se pintan son los que devolvió
// `GET …/documento?formato=pdf`, generados por el MISMO generador que sirve
// la descarga. Replicar el papel en HTML sería una segunda implementación
// del documento — el patrón que este repo ya pagó cuatro veces con
// `piezas_en_camino`.
//
// ────────────────────────────────────────────────────────────
// F-6 · SE PINTA CON pdf.js, YA NO CON `<object data=… type="application/pdf">`.
//
// Un `<object>` delega en el visor NATIVO del navegador — funciona, pero es
// una caja negra: no hay forma de leer sus bytes de vuelta, así que D-3 (ver
// abajo) era estructuralmente imposible sobre él. `pdfjs-dist` sí entrega los
// bytes: `getDocument({ data })` parsea el `ArrayBuffer` que YA se tiene en
// memoria, sin depender de que el navegador sepa abrir PDFs.
//
// EL WORKER, que es donde esto siempre se rompe. El default de
// `GlobalWorkerOptions.workerSrc` es relativo a la PÁGINA, así que en
// `/proyectos/<uuid>` resolvería a `/proyectos/pdf.worker.min.mjs` → 404 →
// "Setting up fake worker failed". Se fija a `/pdf.worker.min.mjs` (raíz,
// mismo origen) y ese archivo se COPIA desde `node_modules/pdfjs-dist` en
// cada `npm install` (`scripts/copiar-pdf-worker.mjs`, hook `postinstall`) —
// nunca se comitea, para que nunca pueda quedarse atrás de la versión
// instalada (riesgo con nombre: WORKER-DESINCRONIZADO). NO se usa
// `disableWorker`: eso movería el parseo al hilo principal.
//
// pdf.js se importa con `import()` DENTRO del efecto que dispara la carga,
// nunca en el nivel superior del módulo: esta librería no corre en el
// servidor, y este archivo es "use client" pero eso no basta — Next igual
// evalúa el módulo al construir el árbol de client components. Este repo no
// tiene NINGÚN `dynamic(..., { ssr: false })` hoy; meter uno solo para esto
// habría sido más maquinaria que el `import()` que ya vive adentro del
// callback.
//
// FIDELIDAD TIPOGRÁFICA: MEDIDA, no asumida. pdf.js sustituye Helvetica→Arial
// y Courier→Courier New (pdfkit no las embebe), pero medido sobre
// documentos de muestra: 0 invasiones de celda en cientos de pares
// de glifos, desplazamiento máximo 0,94 pt (en el «·»), ±1 px contra el
// visor nativo. El mecanismo: pdf.js avanza cada glifo con el ancho que EL
// PROPIO PDF declara y aprieta el sustituto en esa ranura — el error no se
// acumula línea tras línea. Por eso `useSystemFonts` se deja en su default y
// NO se sirve `standard_fonts/`: medido, no acerca más al nativo y son 780 KB
// que nadie necesita.
//
// LO QUE SE PIERDE frente al visor nativo, y es una resta deliberada: zoom,
// paginación con contador, impresión, búsqueda, selección de texto. Se
// renderizan TODAS las páginas (2–3 en este documento) apiladas, al ancho del
// contenedor y con `devicePixelRatio` para que no salgan borrosas en
// pantallas retina. Nada más — ni barra propia ni zoom.
//
// EL PISO DE NAVEGADOR LO PONE pdfjs-dist 6.3.289, no solo `Promise.withResolvers`
// (Chrome 119+/Firefox 121+/Safari 17.4+): el mismo build usa también
// `Promise.try` (Chrome 128 / Firefox 134 / Safari 18.2 — el más nuevo de
// los cuatro, y el que de verdad fija el piso), `Object.hasOwn`,
// `structuredClone` y `OffscreenCanvas`. Portal interno; se declara el piso
// real y no se hace polyfill de nada de esto.
//
// ────────────────────────────────────────────────────────────
// D-3 · «DESCARGAR ESTE PDF» BAJA LOS BYTES QUE LA PANTALLA YA TIENE.
//
// Cierra `PREVIA-Y-DESCARGA-NO-COMPARTEN-BYTES` (deuda de 2.0.1-B). Antes el
// único botón de descarga de esta pestaña vivía DENTRO del respaldo del
// `<object>` — solo aparecía cuando el navegador NO podía enseñar el PDF, o
// sea la garantía «lo que ves es lo que bajas» era vacua justo donde hoy
// sería exigible. El respaldo desapareció con el `<object>`, y con él ese
// callejón sin salida.
//
// El mecanismo: `pedir()` recibe el `Blob` de `obtenerDocumentoProyecto`, le
// saca un `ArrayBuffer` para dárselo a pdf.js (que lo TRANSFIERE al worker y
// lo deja `detached` — no se reutiliza) y CONSERVA el `Blob` mismo en estado.
// «Descargar este PDF» llama a `materializarDescarga(blob, nombre)`
// (`descargar-documento.ts`) sobre ESE `Blob` — cero `fetch` nuevo, cero
// ventana en la que el snapshot pudo moverse entre ver y bajar.
//
// LA CONSECUENCIA QUE HABÍA QUE RESOLVER, no esquivar: si el botón de PDF del
// hero (`proyecto-exportar-botones.tsx`, que hace un `fetch` FRESCO) se
// hubiera movido tal cual a este panel, habría dos caminos al PDF en una
// sola pantalla — uno fresco y uno mostrado, que pueden diferir en el minuto
// de `ahora: new Date()` que estampa `route.ts`. Se retiró de ahí: en este
// panel hay UN solo camino al PDF, y es el que está en pantalla. Quien
// quiera uno fresco pulsa «Regenerar» (arriba) y de ahí lo baja.
// `descargarDocumentoProyecto` (`descargar-documento.ts`) ya no admite
// `formato: 'pdf'` en su TIPO — no es una regla que dependa de que alguien
// se acuerde, el caso quedó inexpresable en la firma.
//
// DOS AFORDANCIAS DE DESCARGA PARA EL MISMO HECHO, evitado por diseño: la
// tarjeta de fallo de render (más abajo) no trae su PROPIO botón, aunque
// tiene bytes que ofrecer (`renderError`). `paraDescargar` unifica las dos
// fuentes posibles —`documento` (pintado bien) o `renderError` (llegó, no se
// pudo pintar)— en UN solo botón, en UN solo sitio del panel, con UN nombre
// accesible. Antes había un «Descargar PDF» en la tarjeta Y un «Descargar
// este PDF de {título}» en el panel, coexistiendo siempre que `renderError`
// estuviera activo: misma acción, mismos bytes, dos nombres.
//
// ────────────────────────────────────────────────────────────
// SE GENERA BAJO DEMANDA, y eso sigue costando lo mismo que costaba: pdfkit
// subsetea tipografías y descarga hasta 12 imágenes del bucket en el
// SERVIDOR, y pdf.js parsea y rasteriza en el CLIENTE. Se pide al abrir la
// PESTAÑA (`proyecto-detalle-view.tsx` monta este componente solo entonces),
// una vez, y se conserva mientras la pestaña siga montada.
//
// EL OBJECT URL YA NO ES ESTADO DEL COMPONENTE, y es una simplificación
// real, no cosmética. Con el `<object>`, el object URL vivía todo el ciclo
// de vida de la previa y había que revocarlo al reemplazarlo y al
// desmontar — el efecto que más costó en S-4. pdf.js no necesita uno:
// consume el `Blob` directo como `ArrayBuffer`. Los ÚNICOS object URL de
// este archivo ahora son EFÍMEROS, dentro de `materializarDescarga`
// (crear → clic → revocar en el mismo tick) — no hay nada que un efecto de
// limpieza tenga que acordarse de revocar al desmontar.
//
// EL TESTIGO ES POR INVOCACIÓN, no por componente — y esto reemplaza un
// `vivo` booleano que esta misma pestaña tuvo hasta la revisión de este
// bloque, con un defecto real, no hipotético.
//
// Un booleano COMPARTIDO por el componente entero protege contra el
// desmontaje pero NO contra que una invocación VIEJA de `pedir()` siga
// corriendo cuando ya arrancó una NUEVA sin desmontar — que es exactamente
// lo que pasa si `proyectoId` cambiara sin remontar este componente (hoy no
// ocurre en `proyecto-detalle-view.tsx`, pero el invariante sobre el que
// descansa D-3 —«lo que bajas es lo que ves»— no puede depender de que nadie
// lo intente nunca). Con `vivo` como booleano, la `pedir()` del proyecto
// VIEJO, resolviendo tarde, encontraría `vivo.current === true` (puesto en
// `true` por el efecto NUEVO) y escribiría su `Blob` sobre `documento` —el
// usuario vería el PDF del proyecto anterior, y «Descargar este PDF»
// bajaría el archivo de OTRO proyecto.
//
// La corrección: `turnoRef` guarda un OBJETO por invocación (`miTurno`), no
// un booleano. Cada `pedir()` se compara contra SU PROPIO objeto por
// identidad (`turnoRef.current === miTurno`), y la limpieza del efecto —que
// corre tanto al desmontar COMO al re-ejecutarse por un cambio de
// dependencias— pone `turnoRef.current = null`, invalidando cualquier
// invocación vieja que siga en vuelo, sea cual sea la razón. Probado en
// `proyecto-documento-previa.test.tsx` cambiando `proyectoId` SIN
// desmontar, con la respuesta del proyecto viejo resolviendo después de que
// el nuevo ya pintó.
//
// LO QUE ESTE CAMBIO **NO** ARREGLA, medido y declarado para no leerlo de
// más: para el caso de DESMONTAR (a diferencia de cambiar `proyectoId`),
// React ya pone `lienzoRef.current = null` ANTES de correr la limpieza de
// este efecto —confirmado corriendo una sonda instrumentada, no supuesto—,
// así que `lienzoRef.current?.replaceChildren(...)` ya sería un no-op con o
// sin este testigo, y React 18 además descarta en silencio (sin aviso en
// consola) un `setState` disparado después del desmontaje. El testigo por
// invocación no depende de esa casualidad de timing: cierra el caso real
// —dos invocaciones vivas a la vez— que si dependía de él.
//
// ────────────────────────────────────────────────────────────
// UN «REGENERAR» QUE FALLA NO BORRA LA PREVIA QUE FUNCIONABA — y ahora cubre
// DOS maneras de fallar, no una. El `fetch` puede fallar (red, 404, 500) o
// pdf.js puede fallar DESPUÉS de un `fetch` exitoso (un PDF que no logra
// parsear/pintar). Las dos caen en el mismo aviso angosto ENCIMA del
// documento anterior si ya había uno bueno; ninguna de las dos toca el
// contenedor de canvases hasta que la tanda nueva termina de renderizar
// COMPLETA — un fallo a medio documento (página 2 de 3) no dispara un swap
// parcial que deje mitad vieja y mitad nueva.
//
// Y si NO había uno bueno todavía (primera carga), las dos formas de fallar
// tienen su propia pantalla completa: `EstadoError` para el `fetch` (su
// titular «no se pudo cargar la información» es cierto: no llegó nada), y
// una tarjeta NUEVA para el fallo de pdf.js —porque ahí «no se pudo cargar
// la información» sería FALSA: la información sí llegó, solo no se pudo
// dibujar— que remite al botón del PANEL para que el usuario se lleve el
// archivo aunque el lienzo no lo pueda pintar (ver «DOS AFORDANCIAS», abajo:
// ese botón no vive duplicado en la tarjeta).
//
// ────────────────────────────────────────────────────────────
// LA CARGA SE ANUNCIA CON `role="status"`, que es el molde del repo
// (`proyecto-detalle-skeleton.tsx:6`, `catalogo-skeleton.tsx:15`, …): un
// `aria-label` sobre el `<Skeleton>` pelón aterriza en un elemento de rol
// `generic`, donde ARIA lo prohíbe y los navegadores lo descartan.
//
// Y el rótulo empieza con «Generando», no con «Cargando», a propósito:
// `nav-nombres.test.ts` barre TODO `src/**/*.tsx` buscando
// `aria-label="Cargando…")` y lo contrasta contra un registro — esto no es
// la carga de una ruta, es la generación de un documento dentro de un
// panel, y queda fuera del registro por ser otra cosa, no por olvido.
//
// [Testigo del propio gate, heredado de S-4] Ese barrido EXTRAE del fuente
// crudo pero VERIFICA contra el fuente sin comentarios, así que este
// párrafo puede citar el patrón `aria-label="Cargando…")` completo, entre
// comillas, dentro de un comentario, sin ponerlo rojo — es la prueba viva
// de que `GATE-DE-CARGA-LEE-PROSA` sigue cerrado.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTA PANTALLA NO PUEDE DECIR, declarado: por qué una fotografía
// degradó (`capa`/`motivos` viven en `ImagenResuelta`, del GENERADOR, y no
// viajan al cliente) — mismo límite que ya declaraba la versión anterior — y
// por qué el mockup pide «4 comprobaciones» que no están: ver el comentario
// junto al panel, más abajo.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EstadoError } from "@/components/shared/estado-carga";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { materializarDescarga, obtenerDocumentoProyecto } from "./descargar-documento";
import { ProyectoExportarBotones } from "./proyecto-exportar-botones";

export interface ProyectoDocumentoPreviaProps {
  proyectoId: string;
  folio: string;
  titulo: string;
}

/** Un documento del que YA se tienen los bytes: el que pdf.js pintó bien, o el que falló al pintar pero se puede bajar igual. */
type DocumentoConBytes = { blob: Blob; nombre: string };

const PDF_WORKER_SRC = "/pdf.worker.min.mjs";
const MENSAJE_REGENERAR_RENDER = "El documento nuevo no se pudo dibujar.";

export function ProyectoDocumentoPrevia({ proyectoId, folio, titulo }: ProyectoDocumentoPreviaProps) {
  const [documento, setDocumento] = useState<DocumentoConBytes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<DocumentoConBytes | null>(null);
  const [avisoRegenerar, setAvisoRegenerar] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Espejo síncrono de `documento`, para decidir dentro de `pedir()` sin
  // depender de un closure que puede quedarse con el valor viejo.
  const documentoRef = useRef<DocumentoConBytes | null>(null);
  // El `<div>` donde se apilan los `<canvas>` de pdf.js. Se llena de forma
  // IMPERATIVA (`replaceChildren`), nunca desde JSX: React nunca declara
  // hijos para este nodo, así que nunca los toca entre renders.
  const lienzoRef = useRef<HTMLDivElement | null>(null);
  // Testigo POR INVOCACIÓN de `pedir()`, no por componente — ver la cabecera,
  // sección «EL TESTIGO ES POR INVOCACIÓN».
  const turnoRef = useRef<object | null>(null);

  const pedir = useCallback(async () => {
    const miTurno = {};
    turnoRef.current = miTurno;
    const esMiTurno = () => turnoRef.current === miTurno;

    setCargando(true);
    setError(null);
    setRenderError(null);
    setAvisoRegenerar(null);

    const resultado = await obtenerDocumentoProyecto(proyectoId, "pdf", `${folio}.pdf`);
    if (!esMiTurno()) return;

    if (!resultado.ok) {
      if (documentoRef.current) setAvisoRegenerar(resultado.mensaje);
      else setError(resultado.mensaje);
      setCargando(false);
      return;
    }

    try {
      const lienzos = await renderizarPdf(resultado.blob, lienzoRef.current);
      if (!esMiTurno()) return;
      lienzoRef.current?.replaceChildren(...lienzos);
      const listo: DocumentoConBytes = { blob: resultado.blob, nombre: resultado.nombre };
      documentoRef.current = listo;
      setDocumento(listo);
    } catch (e) {
      // P4: la degradación deja rastro. El usuario ve un mensaje curado
      // es-MX; esto es la razón real, para quien mire la consola del server
      // de errores del navegador, no un log de depuración del feliz camino.
      console.error("[proyecto-documento-previa] pdf.js no pudo dibujar el documento:", e);
      if (!esMiTurno()) return;
      if (documentoRef.current) setAvisoRegenerar(MENSAJE_REGENERAR_RENDER);
      else setRenderError({ blob: resultado.blob, nombre: resultado.nombre });
    } finally {
      if (esMiTurno()) setCargando(false);
    }
  }, [proyectoId, folio]);

  useEffect(() => {
    void pedir();
    // Invalida el turno vigente al desmontar Y al re-ejecutarse (`proyectoId`
    // cambió sin desmontar): la próxima línea que compare `turnoRef.current`
    // contra SU `miTurno` va a fallar, sea cual sea la razón por la que este
    // efecto terminó. Un solo mecanismo para las dos causas.
    return () => {
      turnoRef.current = null;
    };
  }, [pedir]);

  // Lo que «Descargar este PDF» ofrece: el documento que pdf.js SÍ pudo
  // pintar, o —si nunca hubo uno— el que se fetcheó pero no se pudo pintar.
  // Ver «DOS AFORDANCIAS DE DESCARGA» en la cabecera: es querido que sea UNA
  // sola fuente para las dos ramas, no un botón por estado.
  const paraDescargar = documento ?? renderError;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/*
          Dice lo que se puede sostener. Cada exportación vuelve a generar el
          documento con la hora y el snapshot de ESE momento — lo cierto, y
          lo que le importa a quien lo va a firmar, es que esto NO es una
          maqueta: es el generador de verdad.
        */}
        <p className="text-[12.5px] text-ink-muted">
          Es el documento real, no una aproximación: lo genera el mismo sistema que la exportación, con las cifras del momento en que se
          generó.
        </p>
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={() => void pedir()}
          disabled={cargando}
          aria-label="Regenerar la vista previa"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {cargando ? "Generando…" : "Regenerar"}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-3.5">
        <div className="min-w-0 flex-[1_1_520px]">
          {/* Primera carga fallida (red): no hay nada que enseñar, y el titular de `EstadoError` es cierto. */}
          {error && !documento && <EstadoError mensaje={error} onRetry={() => void pedir()} />}

          {/* Primera carga: el fetch SÍ trajo el archivo, pero pdf.js no lo pudo dibujar. Aquí el titular de `EstadoError` sería falso. */}
          {renderError && !documento && (
            <Card className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface py-[54px] text-center">
              <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-warn-bg text-warn">
                <AlertTriangle className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <div className="flex flex-col gap-1">
                <p className="text-[15px] font-semibold text-ink">No se pudo mostrar la vista previa de este documento</p>
                <p className="text-[13px] text-muted-foreground">
                  El archivo se generó correctamente; este navegador no pudo dibujarlo aquí. Descárgalo desde el panel para abrirlo con tu
                  lector de PDF.
                </p>
              </div>
              {/*
                Sin botón propio aquí a propósito: «Descargar este PDF» del
                panel ya cubre este caso (`paraDescargar` cae a `renderError`
                cuando no hay `documento`). Dos botones para la MISMA acción y
                los MISMOS bytes —uno aquí, otro en el panel— eran dos
                afordancias para un solo hecho, con nombres accesibles
                distintos para la misma cosa. Se eligió UNA: la del panel,
                porque es la que ya existe en los otros tres estados.
              */}
            </Card>
          )}

          {cargando && !documento && (
            <div role="status" aria-label="Generando la vista previa del documento…">
              <Skeleton aria-hidden="true" className="h-[70vh] w-full rounded-[15px]" />
            </div>
          )}

          {/* Regeneración fallida (red o render) sobre una previa buena: aviso angosto, y lo que ya estaba SIGUE abajo, intacto. */}
          {avisoRegenerar && documento && (
            <div
              role="alert"
              className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5 rounded-[13px] border border-line-soft bg-warn-bg px-4 py-2.5"
            >
              <p className="text-[12.5px] text-ink-2">No se pudo regenerar el documento; sigues viendo el anterior. {avisoRegenerar}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void pedir()} disabled={cargando}>
                Reintentar
              </Button>
            </div>
          )}

          {/*
            Los `<canvas>` de pdf.js se insertan aquí de forma imperativa
            (`replaceChildren`). Vacío mientras no hay una tanda completa y
            buena.

            GAP DECLARADO: el `layout-check` de 268 casos NUNCA abre la
            pestaña Documento — sus escenarios no incluyen un `mouseDown`
            sobre este `TabsTrigger` (ver `proyecto-detalle-view.tsx`). El
            quiebre de `flex-wrap` entre el lienzo y el panel, en anchos
            intermedios, no lo mide ningún arnés en navegador hoy.
          */}
          <div
            ref={lienzoRef}
            aria-busy={cargando}
            className={cn("flex flex-col gap-3", documento && "rounded-[15px] border border-line bg-surface-3 p-2")}
          />
        </div>

        <aside className="min-w-[220px] flex-[1_1_260px] rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-col gap-3">
            <Button
              type="button"
              onClick={() => paraDescargar && materializarDescarga(paraDescargar.blob, paraDescargar.nombre)}
              disabled={!paraDescargar}
              aria-label={`Descargar este PDF de ${titulo}`}
              className="w-full justify-center"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Descargar este PDF
            </Button>

            <ProyectoExportarBotones proyectoId={proyectoId} folio={folio} titulo={titulo} />

            {/* Solo cuando SE VE algo: con `error` (nada llegó) o `renderError` (llegó pero no se pintó) esta frase sería falsa. */}
            {documento && (
              <p className="text-[12px] leading-relaxed text-ink-muted">
                El PDF se descarga tal como lo ves aquí; el Excel se genera de nuevo cada vez que lo pides.
              </p>
            )}

            {/*
              [2.0.1-C] Las «4 comprobaciones» de la maqueta NO están, mismo
              criterio que «Actividad» en `proyecto-detalle-view.tsx` (P7:
              declarar la ausencia en vez de dibujarla hueca). Por qué no
              hay territorio para hacerlas hoy:
                · `advertenciasDe` (`src/services/documento/modelo.ts`) corre
                  en el SERVIDOR sobre `FilaDocumento[]`, que nunca viaja al
                  cliente.
                · La ruta `GET …/documento` devuelve BYTES (el PDF), no ese
                  arreglo — no hay JSON que leer aquí.
                · `FilaDocumento` no trae `partida_id`: correlacionar una
                  advertencia con SU partida en este panel exigiría
                  agregarlo y tocar `types/**`, que es más que esta pestaña.
            */}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Parsea `blob` con pdf.js y devuelve un `<canvas>` por página, YA
 * renderizado — pero SIN tocar el DOM final: quien llama decide cuándo (y
 * si) los cambia por lo que hubiera antes. Así un fallo a media tanda (p.ej.
 * la página 2 de 3) no deja un contenedor a medio reemplazar.
 *
 * `import()` aquí adentro, no en el nivel superior del módulo: pdf.js no
 * corre en el servidor.
 */
async function renderizarPdf(blob: Blob, contenedor: HTMLDivElement | null): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  const datos = new Uint8Array(await blob.arrayBuffer());
  const documento = await pdfjs.getDocument({ data: datos }).promise;

  const dpr = typeof window !== "undefined" && window.devicePixelRatio ? window.devicePixelRatio : 1;
  // jsdom no mide geometría (`clientWidth` siempre 0): el fallback de 520
  // coincide con la base de `flex-[1_1_520px]` del lienzo.
  const ancho = contenedor?.clientWidth || 520;

  const lienzos: HTMLCanvasElement[] = [];
  for (let numero = 1; numero <= documento.numPages; numero++) {
    const pagina = await documento.getPage(numero);
    const base = pagina.getViewport({ scale: 1 });
    const viewport = pagina.getViewport({ scale: (ancho / base.width) * dpr });

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";

    // `canvas` (no `canvasContext`): pdf.js deriva el contexto 2D él mismo, y
    // es la forma que la propia librería recomienda en su tipo.
    await pagina.render({ canvas, viewport }).promise;
    lienzos.push(canvas);
  }
  return lienzos;
}
