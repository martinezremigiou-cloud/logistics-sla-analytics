// ============================================================
// [INV-B8.2] evidencia-visual.ts — la página de evidencia, sin navegador.
//
// POR QUÉ EXISTE. El DoD del bloque pide capturas en los dos layouts, y la
// extensión de Chrome no está conectada — verificado cuatro veces entre el
// bloque anterior y éste. A diferencia de INV-B8.1, donde la evidencia eran
// PDFs rasterizados aparte, aquí lo que hay que ver es la
// APLICACIÓN, y eso un PDF no lo puede suplir.
//
// ────────────────────────────────────────────────────────────
// CADA ANCHO ES UN VIEWPORT REAL (un `<iframe>`), NO UN `div` CON `width`.
//
// La primera versión de este arnés usaba un contenedor con `style="width:390px"`
// y estaba MAL, aunque se viera plausible: **las variantes responsivas de
// Tailwind (`sm:`, `md:`, `lg:`) resuelven contra el VIEWPORT, no contra el
// contenedor**. Un `div` angosto dentro de una ventana ancha renderiza con los
// estilos de ESCRITORIO — así que la columna rotulada "Móvil · 390 px" habría
// mostrado exactamente lo que no se quería revisar, y con una etiqueta
// afirmando lo contrario. Peor que no tener la evidencia.
//
// Un `<iframe>` sí establece su propio viewport, así que las media queries
// resuelven donde deben. Se detectó al auditar el archivo.
// ────────────────────────────────────────────────────────────
//
// Y CADA ESCENARIO SE MUESTRA EN LOS DOS TEMAS. La aplicación tiene
// interruptor y se usa en ambos; un elemento flotante encima de
// contenido es justo donde el contraste se rompe. El tema se aplica como
// `class="dark"` en el `<html>` del iframe, que es lo que hace `next-themes`.
//
// LO QUE SÍ ES: el marcado y los estilos reales, con sus clases resueltas y su
// viewport real. Sirve para juzgar espaciado, contraste, desbordes, jerarquía
// y —lo que más importa en este bloque— **si un elemento flotante tapa una
// acción existente**.
//
// LO QUE NO ES, y se dice en la propia página: no es la aplicación corriendo.
// Se renderiza estático, así que **no corre ningún `useEffect`** y lo que se ve
// es el estado inicial que cada escenario pasa por props. Interacción, foco,
// transiciones y datos por fetch quedan fuera. No sustituye a la extensión: es
// lo mejor disponible mientras no esté, y cuando esté no se tira — cubre casos
// que a nadie se le ocurriría mirar a mano.
// ============================================================
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface BloqueDeEvidencia {
  titulo: string;
  nota?: string;
  /** Marcado ya renderizado del escenario. */
  html: string;
  /** Alto del viewport, en px. Los iframes no se auto-dimensionan sin JS. */
  alto?: number;
}

/**
 * Los dos anchos. No son redondos por gusto: 1440 es el escritorio con el que
 * se diseñó la propuesta XUI, y 390 el de un teléfono corriente — el layout que
 * `bottom-nav.tsx` atiende y que se pidió explícitamente no romper.
 */
export const ANCHOS = [
  { etiqueta: 'Escritorio · 1440 px', px: 1440 },
  { etiqueta: 'Móvil · 390 px', px: 390 },
] as const;

export const TEMAS = [
  { etiqueta: 'claro', clase: '' },
  { etiqueta: 'oscuro', clase: 'dark' },
] as const;

/** El CSS del build. Sin él la evidencia sería HTML pelado y no diría nada de la identidad visual. */
export function cssCompilado(raiz = process.cwd()): string {
  const dir = join(raiz, '.next', 'static', 'css');
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.css'));
  if (archivos.length === 0) throw new Error('No hay CSS compilado en .next/static/css. Corre `npm run build`.');
  return archivos.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
}

function escaparParaAtributo(html: string): string {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * El documento que va DENTRO de un iframe: viewport propio, CSS del build y el
 * tema aplicado como lo aplica next-themes.
 *
 * EL CSS VA INCRUSTADO, NO ENLAZADO, y cuesta ~60 KB por marco. La versión
 * anterior escribía un `evidencia.css` hermano y lo enlazaba desde cada
 * `srcdoc` — más liviano, pero un `srcdoc` hereda la URL base del documento
 * padre y **no tengo forma de comprobar aquí que un `file://` resuelva ese
 * enlace**: la extensión del navegador no está conectada y no hay headless en
 * el repo. El modo de falla no es un error visible, es una evidencia que se
 * abre sin estilos y parece que el componente está roto. Se elimina la
 * dependencia externa en vez de apostar a ella; el archivo pesa ~1.5 MB y se
 * abre solo, sin nada al lado.
 */
function documentoDeContenedor(html: string, clase: string, css: string): string {
  return `<!doctype html><html lang="es-MX" class="${clase}"><head><meta charset="utf-8">
<style>${css}</style>
<style>body{margin:0;background:var(--mx-bg);}</style>
</head><body>${html}</body></html>`;
}

export function paginaDeEvidencia(titulo: string, bloques: BloqueDeEvidencia[], css: string): string {
  const secciones = bloques
    .map((b) => {
      const alto = b.alto ?? 520;
      const marcos = TEMAS.map((tema) =>
        ANCHOS.map(
          (ancho) => `
          <figure class="marco">
            <figcaption>${ancho.etiqueta} · tema ${tema.etiqueta}</figcaption>
            <iframe title="${ancho.etiqueta} ${tema.etiqueta}" width="${ancho.px}" height="${alto}"
                    srcdoc="${escaparParaAtributo(documentoDeContenedor(b.html, tema.clase, css))}"></iframe>
          </figure>`,
        ).join(''),
      ).join('');

      return `
    <section class="evidencia">
      <h2>${b.titulo}</h2>
      ${b.nota ? `<p class="nota">${b.nota}</p>` : ''}
      <div class="marcos">${marcos}</div>
    </section>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="es-MX"><head><meta charset="utf-8">
<title>${titulo} · evidencia visual INV-B8.2</title>
<style>
  body { margin:0; padding:24px; background:#1e293b; font-family: system-ui, sans-serif; }
  h1 { color:#fff; font-size:18px; margin:0 0 4px; }
  .aviso { color:#cbd5e1; font-size:12.5px; margin:0 0 24px; max-width:88ch; line-height:1.55; }
  .aviso strong { color:#fff; }
  .evidencia { margin-bottom:40px; }
  .evidencia h2 { color:#fff; font-size:15px; margin:0 0 2px; }
  .nota { color:#94a3b8; font-size:12px; margin:0 0 12px; max-width:88ch; line-height:1.5; }
  /*
    overflow-x:auto y NINGÚN max-width en los iframes, a propósito.
    Un max-width:100% habría encogido el marco de 1440 px en una pantalla
    más angosta — y como el viewport interior de un iframe ES su ancho de
    layout, el marco rotulado «1440 px» habría renderizado a 1300. El mismo
    defecto que este arnés vino a arreglar, un nivel más arriba: la etiqueta
    afirmando un ancho que el marco no tiene. Antes que mentir, se desplaza.
  */
  .marcos { display:flex; gap:20px; align-items:flex-start; overflow-x:auto; padding-bottom:8px; }
  .marco { margin:0; flex:none; }
  figcaption { color:#94a3b8; font-size:11px; margin-bottom:5px; font-family:ui-monospace,monospace; }
  iframe { border:1px solid #475569; border-radius:8px; background:transparent; display:block; }
</style>
</head><body>
<h1>${titulo}</h1>
<p class="aviso">
  Evidencia visual del bloque INV-B8.2: los componentes REALES con el CSS compilado del build.
  <strong>Cada marco es un viewport de verdad</strong> (un <code>iframe</code>), no un contenedor angosto — las
  variantes responsivas de Tailwind resuelven contra el viewport, así que un <code>div</code> con
  <code>width</code> habría mostrado estilos de escritorio bajo una etiqueta que dice «móvil».
  Los marcos están a su ancho REAL, sin encoger: si tu ventana es más angosta que 1&nbsp;850&nbsp;px, la fila
  <strong>se desplaza en horizontal</strong> — es preferible a un marco de 1440 rotulado que en realidad mide 1300.
  <br><br>
  <strong>El contenido de cada marco se desplaza por dentro.</strong> En los escenarios compuestos, el
  <code>&lt;main&gt;</code> tiene su propio scroll: baja con la rueda dentro del marco hasta el final de la tabla —
  ahí es donde el elemento flotante y la paginación compiten por el mismo rincón.
  <br><br>
  <strong>No es la aplicación corriendo.</strong> Se renderiza estático: no corre ningún <code>useEffect</code> y lo que
  se ve es el estado inicial que cada escenario pasa por props. Interacción, foco, transiciones y datos por fetch
  quedan fuera — para eso hace falta el navegador.
</p>
${secciones}
</body></html>`;
}
