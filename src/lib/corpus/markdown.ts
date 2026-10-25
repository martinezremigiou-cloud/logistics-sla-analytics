// ============================================================
// [INV-B11] lib/corpus/markdown.ts — el subconjunto de markdown que el corpus
// USA de verdad, convertido en estructura. 100% PURO, y no produce HTML.
//
// POR QUÉ ESCRITO Y NO UNA LIBRERÍA, con la medición delante.
//
// Medido sobre los **documentos embebibles** —el denominador correcto: lo
// que un usuario puede llegar a ver, no todos los que están en alcance—,
// los constructos más usados son listas, citas, negritas, encabezados, tablas y
// código; en cambio itálicas, listas numeradas y bloques ``` son raros, y
// ENLACES, IMÁGENES y HTML crudo son nulos o casi.
//
// Ocho constructos y nada exótico. Y las tres últimas líneas son las que
// deciden:
//
//   · **CERO enlaces y CERO imágenes en el corpus medido.** Así que este archivo **no los soporta**,
//     y con eso el vector de inyección más común desaparece **por construcción**
//     en vez de por configuración. Con una librería habría que apagarlos, y
//     apagar es algo que alguien puede volver a encender.
//
//   · **El HTML no se descarta: nunca se interpreta.** Este módulo produce
//     ESTRUCTURA, y el componente que la pinta crea elementos de React. No hay
//     `dangerouslySetInnerHTML` en ningún punto del camino, así que `<script>`
//     en una ficha sale como el texto `<script>`. No es una decisión de
//     seguridad que haya que recordar: es que no existe el mecanismo.
//
// Y el modo de fallo elegido: **lo que no se reconoce se muestra como texto
// plano**, que es exactamente lo que hace el portal hoy. Un constructo raro
// degrada a la conducta actual; nunca revienta y nunca desaparece.
//
// ────────────────────────────────────────────────────────────
// LOS WIKILINKS, QUE NO SON MARKDOWN Y NINGUNA LIBRERÍA CONOCE.
//
// El corpus vive en Obsidian y **una parte notable de los documentos trae
// `[[wikilinks]]`**. Hoy salen crudos en la respuesta: `[[Antena-EAS-Series12-UR63]]`
// en medio de un párrafo, señalando a un archivo que el usuario no puede abrir.
// Se encontró en QA manual, y pasa **renderice o no** — es independiente de esta
// decisión.
//
// La regla, y por qué NO se convierten en enlace: de los **destinos
// distintos, una parte apunta a algo indexado y otra no**. Enlazar solo los resolubles
// daría dos tratamientos visuales al mismo constructo —unos azules, otros no—
// sin que el usuario pueda saber por qué. Y el corpus cambia todo el tiempo:
// un enlace que hoy funciona mañana no, y **un enlace muerto dentro de una cita
// es peor que texto**.
//
// Así que se muestra el NOMBRE, sin corchetes. `[[X|alias]]` muestra el alias,
// que es lo que el autor quiso que se leyera.
// ============================================================

export type Inline =
  | { t: 'texto'; v: string }
  | { t: 'negrita'; v: string }
  | { t: 'italica'; v: string }
  | { t: 'codigo'; v: string };

export type Bloque =
  | { tipo: 'encabezado'; nivel: number; contenido: Inline[] }
  | { tipo: 'parrafo'; contenido: Inline[] }
  | { tipo: 'cita'; contenido: Inline[] }
  | { tipo: 'lista'; ordenada: boolean; items: Inline[][] }
  | { tipo: 'tabla'; encabezados: Inline[][]; filas: Inline[][][] }
  | { tipo: 'codigo'; texto: string };

/** `[[X]]` → `X` · `[[X|alias]]` → `alias`. Ver la cabecera. */
function quitarWikilinks(s: string): string {
  return s.replace(/\[\[([^\]\n]+)\]\]/g, (_m, dentro: string) => {
    const partes = dentro.split('|');
    const visible = (partes.length > 1 ? partes[partes.length - 1] : partes[0]) ?? '';
    // Una ruta se muestra por su hoja: `20_Sistemas/.../Series2` → `Series2`.
    return visible.trim().split('/').pop()?.replace(/\.md$/, '') ?? '';
  });
}

/**
 * Parte una línea en tramos con énfasis.
 *
 * El orden importa: **primero código**, porque `` `**x**` `` es código y no
 * negrita — dentro de un backtick el markdown no interpreta nada. Invertirlo
 * haría que un fragmento de código con asteriscos se pintara en negritas y
 * perdiera los asteriscos, o sea que la CITA dejaría de decir lo que dice.
 */
export function partirInline(linea: string): Inline[] {
  const limpio = quitarWikilinks(linea);
  const out: Inline[] = [];
  // Un solo barrido con alternancia: código | negrita | itálica.
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) {
    if (m.index > ultimo) out.push({ t: 'texto', v: limpio.slice(ultimo, m.index) });
    if (m[1]) out.push({ t: 'codigo', v: m[1].slice(1, -1) });
    else if (m[2]) out.push({ t: 'negrita', v: m[2].slice(2, -2) });
    else if (m[3]) out.push({ t: 'italica', v: m[3].slice(1, -1) });
    else if (m[4]) out.push({ t: 'italica', v: m[4].slice(1, -1) });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < limpio.length) out.push({ t: 'texto', v: limpio.slice(ultimo) });
  return out.length > 0 ? out : [{ t: 'texto', v: limpio }];
}

const esRenglonTabla = (l: string) => l.trimStart().startsWith('|');
const esSeparadorTabla = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

/** Las celdas de un renglón, sin los `|` de los extremos. */
function celdas(linea: string): string[] {
  const t = linea.trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|').map((c) => c.trim());
}

/**
 * Convierte el texto de un trozo en bloques.
 *
 * **Una tabla sin su separador NO se trata como tabla**: se deja como párrafos.
 * Es la misma regla que en `trocear.ts` —un renglón de datos sin encabezado da
 * un número sin su condición— aplicada un nivel más arriba. Pintarla como tabla
 * le pondría una cabecera que el documento no tiene.
 */
export function parsear(texto: string): Bloque[] {
  // ----------------------------------------------------------
  // LOS WIKILINKS SE QUITAN AQUÍ, ANTES DE PARTIR NADA. Y no es una
  // optimización: es un defecto que se midió contra el corpus real.
  //
  // `[[X|alias]]` usa `|` — **el mismo carácter que separa las celdas de una
  // tabla**. Quitándolos dentro de `partirInline`, el troceo de celdas ya había
  // partido el wikilink en dos: `[[X` y `alias]]`, y ninguno casaba con el
  // patrón. **varios wikilinks llegaban crudos al usuario**, todos en tablas del
  // mismo archivo.
  //
  // Hecho sobre el texto entero, ningún paso posterior puede confundirse.
  // ----------------------------------------------------------
  const lineas = quitarWikilinks(texto.replace(/\r\n/g, '\n')).split('\n');
  const bloques: Bloque[] = [];

  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    bloques.push({ tipo: 'parrafo', contenido: partirInline(parrafo.join(' ')) });
    parrafo = [];
  };

  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i]!;

    if (l.trim() === '') {
      cerrarParrafo();
      i++;
      continue;
    }

    // --- bloque de código ---
    if (l.trimStart().startsWith('```')) {
      cerrarParrafo();
      const dentro: string[] = [];
      i++;
      while (i < lineas.length && !lineas[i]!.trimStart().startsWith('```')) {
        dentro.push(lineas[i]!);
        i++;
      }
      i++; // el cierre
      bloques.push({ tipo: 'codigo', texto: dentro.join('\n') });
      continue;
    }

    // --- tabla ---
    if (esRenglonTabla(l) && i + 1 < lineas.length && esSeparadorTabla(lineas[i + 1]!)) {
      cerrarParrafo();
      const encabezados = celdas(l).map(partirInline);
      i += 2;
      const filas: Inline[][][] = [];
      while (i < lineas.length && esRenglonTabla(lineas[i]!)) {
        filas.push(celdas(lineas[i]!).map(partirInline));
        i++;
      }
      bloques.push({ tipo: 'tabla', encabezados, filas });
      continue;
    }

    // --- encabezado ---
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      cerrarParrafo();
      bloques.push({ tipo: 'encabezado', nivel: h[1]!.length, contenido: partirInline(h[2]!) });
      i++;
      continue;
    }

    // --- cita ---
    if (/^\s*>/.test(l)) {
      cerrarParrafo();
      const dentro: string[] = [];
      while (i < lineas.length && /^\s*>/.test(lineas[i]!)) {
        dentro.push(lineas[i]!.replace(/^\s*>\s?/, ''));
        i++;
      }
      bloques.push({ tipo: 'cita', contenido: partirInline(dentro.join(' ')) });
      continue;
    }

    // --- listas ---
    const vinieta = /^\s*[-*+]\s+(.*)$/.exec(l);
    const numerada = /^\s*\d+\.\s+(.*)$/.exec(l);
    if (vinieta || numerada) {
      cerrarParrafo();
      const ordenada = Boolean(numerada);
      const items: Inline[][] = [];
      while (i < lineas.length) {
        const m2 = ordenada ? /^\s*\d+\.\s+(.*)$/.exec(lineas[i]!) : /^\s*[-*+]\s+(.*)$/.exec(lineas[i]!);
        if (!m2) break;
        items.push(partirInline(m2[1]!));
        i++;
      }
      bloques.push({ tipo: 'lista', ordenada, items });
      continue;
    }

    // --- cualquier otra cosa: texto. Lo desconocido degrada a la conducta de hoy.
    parrafo.push(l);
    i++;
  }
  cerrarParrafo();
  return bloques;
}
