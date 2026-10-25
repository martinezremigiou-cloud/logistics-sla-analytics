// ============================================================
// [INV-B8.1] documento/tokens.ts — LA ÚNICA casa de un color en los documentos.
//
// GATE DEL BLOQUE: cero literales hexadecimales fuera de este archivo. Se
// verifica con `grep` y el resultado va en la evidencia. Un `#1B365D` suelto en
// un renderizador reprueba el bloque.
//
// POR QUÉ, y no es estética. Los generadores no pueden leer CSS: corren en
// servidor, sin navegador y sin Tailwind, así que el valor TIENE que estar
// duplicado en algún lado. La pregunta no es si se duplica —eso es forzoso—
// sino en cuántos lados. Con un módulo, cambiar la marca es editar un archivo
// y correr un test. Con literales dispersos, es una cacería, y la cacería
// siempre deja uno vivo.
//
// PROCEDENCIA DE CADA VALOR, verificada contra la fuente el 2026-08-13 — no
// contra un resumen. (Corrección al propio bloque: `#64748B` se reportó como
// "inventado" comparándolo contra la lista ABREVIADA del brief; está en
// `globals.css:31` como `--mx-muted`. Medir contra el resumen y no contra el
// archivo es el mismo error que el bloque vino a evitar.)
//
//   NAVY    #1B365D  tailwind.config.ts navy.700 · globals.css --mx-navy-ink
//   TINTA   #0F172A  globals.css --mx-text
//   TINTA_2 #334155  globals.css --mx-text-2
//   MUTED   #64748B  globals.css --mx-muted
//   BORDE   #E2E8F0  globals.css --mx-border
//   BORDE_SUAVE #EEF2F6  globals.css --mx-border-soft
//   PAPEL   #FFFFFF  globals.css --mx-surface
//   BANDA   #F1F5F9  globals.css --mx-surface-3
//   WARN    #B45309  globals.css --mx-warn
//   WARN_BG #FBF1E3  globals.css --mx-tint-amber
//   ACENTO  #2E78C7  globals.css --mx-accent
//   SELLO_BG #E8F1FB globals.css --mx-tint-blue   [2.0.1-B · S-5]
//
// [INV-B8.2] B81-2 CERRADA. Antes, esa procedencia era un COMENTARIO: decía de
// dónde venía cada valor y nada comprobaba que siguiera siendo cierto. Si
// alguien cambiaba la marca en `globals.css`, el documento se quedaba atrás en
// silencio y este bloque de texto pasaba de documentación a mentira.
//
// Ahora la procedencia es DATO (`PROCEDENCIA`, abajo) y `tokens.globals.test.ts`
// lee `globals.css`, extrae el bloque `:root` y compara valor por valor. La
// deuda estimaba que cerrarlo exigía un paso de build; no hacía falta —una
// prueba que parsea el archivo alcanza, y corre en cada `npm test`.
// ============================================================

/** Paleta del documento. Los nombres son de ROL, no de color: quien los usa no decide el tono. */
export const TOKENS = {
  /** Azul institucional. Encabezados de tabla y acentos estructurales. */
  navy: '#1B365D',
  /** Texto principal. */
  tinta: '#0F172A',
  /** Texto secundario, aún legible como cuerpo. */
  tinta2: '#334155',
  /** Texto de apoyo: etiquetas, procedencia, pies. */
  muted: '#64748B',
  /** Líneas de tabla. */
  borde: '#E2E8F0',
  /** Líneas internas, más tenues que `borde`. */
  bordeSuave: '#EEF2F6',
  /** Fondo del papel y texto sobre fondo oscuro. */
  papel: '#FFFFFF',
  /** Fondo de las bandas de agrupación (zebra suave). */
  banda: '#F1F5F9',
  /** Advertencias: lo que el documento tiene que confesar. */
  warn: '#B45309',
  /** Fondo de una advertencia. */
  warnFondo: '#FBF1E3',
  /** Acento de marca para reglas y detalles. */
  acento: '#2E78C7',
  /**
   * Fondo del SELLO DE VIGENCIA. Tinte del acento, no un color nuevo: el sello
   * es una banda del mismo azul institucional, no una alerta.
   *
   * [2.0.1-B · S-5] Es el unico token que el formato 1b agrega, y NO es un color
   * inventado — ya existia en la aplicacion como `--mx-tint-blue`; lo que
   * faltaba era traerlo aqui. `tokens.globals.test.ts` verifica su procedencia
   * contra `globals.css` como con los otros once, sin escribir nada nuevo en el
   * CSS.
   */
  selloFondo: '#E8F1FB',
} as const;

export type RolDeColor = keyof typeof TOKENS;

/**
 * De dónde sale cada token: la custom property de `globals.css` (bloque
 * `:root`, es decir el tema CLARO — los documentos se imprimen en papel) que
 * este valor duplica.
 *
 * **Es dato y no comentario a propósito.** Un comentario que afirma una
 * procedencia envejece sin avisar; esto lo lee `tokens.globals.test.ts` y lo
 * compara contra el CSS real. La duplicación sigue siendo forzosa —el
 * generador corre en servidor, sin Tailwind— pero ya no puede desincronizarse
 * en silencio: si alguien cambia la paleta, la suite se pone roja y dice qué
 * token y qué valores.
 */
export const PROCEDENCIA: Record<RolDeColor, string> = {
  navy: '--mx-navy-ink',
  tinta: '--mx-text',
  tinta2: '--mx-text-2',
  muted: '--mx-muted',
  borde: '--mx-border',
  bordeSuave: '--mx-border-soft',
  papel: '--mx-surface',
  banda: '--mx-surface-3',
  warn: '--mx-warn',
  warnFondo: '--mx-tint-amber',
  acento: '--mx-accent',
  selloFondo: '--mx-tint-blue',
};

/**
 * Escala tipográfica del documento, en puntos. Vive aquí por el mismo motivo
 * que los colores: un `fontSize(7.6)` suelto es tan difícil de cazar como un
 * hex suelto, y los dos son decisiones de identidad.
 */
export const TIPOGRAFIA = {
  titulo: 17,
  subtitulo: 11,
  cuerpo: 9.5,
  tabla: 8,
  tablaEncabezado: 7.6,
  nota: 7.2,
  pie: 7,
  etiqueta: 8,
} as const;

/** Geometría de la tabla, en puntos. Misma razón: números de maquetación en un solo lugar. */
export const GEOMETRIA = {
  /** Relleno horizontal dentro de una celda. */
  celdaPadding: 4,
  /** Alto mínimo de una fila; el real se calcula del contenido. */
  filaAltoMinimo: 15,
  /** Alto de la barra de encabezado de la tabla. */
  encabezadoAlto: 17,
  /** Separación entre el borde inferior del área de contenido y el pie. */
  pieDesdeElBorde: 26,
  /**
   * [2.0.1-B · S-5] El SELLO DE VIGENCIA. Los tres van juntos porque describen
   * una sola caja: el borde izquierdo de acento y los rellenos de su interior.
   *
   * `selloBorde: 3` es el valor de la §3 de la especificación. Los rellenos
   * salen de que la banda tiene que respirar sin robarle alto al tercio
   * superior: con 6/8 el sello ocupa ~34 pt en dos renglones.
   */
  selloBorde: 3,
  selloPaddingX: 8,
  selloPaddingY: 6,
} as const;
