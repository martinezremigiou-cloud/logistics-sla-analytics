// ============================================================
// [2.0.1-B · S-1] apariencia-proyecto.ts — LA IDENTIDAD VISUAL DE UN PROYECTO.
//
// ────────────────────────────────────────────────────────────
// QUÉ ENTRA EN S-1 Y QUÉ NO, dicho antes que nada porque el error que corrige
// este archivo fue no decirlo.
//
// La apariencia de un proyecto son dos cosas: un COLOR y un SÍMBOLO. La §7 de
// la especificación de Proyectos las pone como dos columnas
// nuevas de `proyectos`, y yo las mandé a S-2 por eso — defendible — **y nunca
// escribí la consecuencia: que hasta S-2 la tarjeta se vería idéntica a hoy.**
// El resultado fue el peor intermedio posible: el layout cambió y el contenido
// no.
//
// Así que aquí entra el DISEÑO con apariencia POR DEFECTO —un color y un símbolo
// iguales para todos— y S-2 agrega solamente la ELECCIÓN por proyecto. Cuando
// lleguen las columnas, lo único que cambia es de dónde sale el `id` del
// símbolo: la tarjeta ya sabe pintarlo.
//
// ────────────────────────────────────────────────────────────
// EL COLOR SALE DE UN TOKEN, NO DE UN HEX, y eso NO es intercambiable.
//
// La maqueta trae seis hex fijos (`#2E78C7`, `#1F8A5B`, …). Escribirlos aquí
// habría roto la propiedad que `globals-tema.test.ts` acaba de fijar: **todo
// color que pinta una superficie tiene que tener un valor para claro y otro para
// oscuro.** Un `#2E78C7` clavado es azul medio sobre fondo oscuro, y no hay
// guarda que lo salve porque el hex no estaría en `globals.css`.
//
// Por eso la apariencia por defecto sale de `--mx-proyecto-acento`, que es el
// `--mx-tag-azul` del vocabulario de la casa y por tanto ya gira con el tema.
//
// ⚠ **Y por eso la PALETA de seis NO entra aquí todavía.** Un color elegido por
// el KAM de una lista de seis hex fijos NO puede girar con el tema, y eso es una
// decisión de diseño que le toca a producto, no a este archivo. Queda como deuda con
// nombre —`PALETA-DE-PROYECTO-NO-GIRA-CON-EL-TEMA`— y se resuelve en S-2, que es
// donde nace la columna. Lo que sí entra completo es el vocabulario de SÍMBOLOS,
// porque un trazo no tiene tema: la migración de S-2 restringirá su columna
// contra estos siete identificadores y no tendrá que inventarlos.
// ============================================================

export interface SimboloProyecto {
  /** Lo que guardará la columna de S-2. Estable: renombrarlo invalida filas. */
  id: string;
  /** Para el selector de apariencia de S-2 y para el `aria-label` de hoy. */
  nombre: string;
  /** El trazo, sobre `viewBox 0 0 24 24`, `fill:none`. Copiado literal de la maqueta viva. */
  d: string;
}

/**
 * Los SIETE de la §4 de la especificación, con los trazos tal cual salieron de
 * la maqueta aprobada. No se redibujan aquí: son el activo entregado.
 */
export const SIMBOLOS: readonly SimboloProyecto[] = [
  { id: 'tienda', nombre: 'Tienda', d: 'M3 9l2-5h14l2 5M4 9v11h16V9M9 20v-6h6v6' },
  { id: 'etiqueta', nombre: 'Etiqueta', d: 'M20.6 12.6 12 21.2 2.8 12V2.8H12zM7.2 7.2h.01' },
  { id: 'caja', nombre: 'Bodega', d: 'M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8' },
  { id: 'documento', nombre: 'Documento', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 14h6M9 18h4' },
  { id: 'antena', nombre: 'Antena', d: 'M8 3v18M16 3v18M8 7h8M8 17h8M12 10v4' },
  { id: 'escudo', nombre: 'Seguridad', d: 'M12 2 4 5v6c0 6 4 9 8 11 4-2 8-5 8-11V5zM9 12l2 2 4-4' },
  { id: 'carpeta', nombre: 'Expediente', d: 'M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
] as const;

/**
 * El símbolo que llevan TODOS los proyectos hasta que exista la elección.
 *
 * Es `carpeta` (Expediente) y la razón se deja escrita porque es una decisión,
 * no un descarte: los otros seis **afirman algo del contenido** del proyecto
 * —que es una tienda, una bodega, una antena, un tema de seguridad—, y un valor
 * por omisión que afirma de más miente en la mayoría de las tarjetas. Un
 * expediente es lo único que un proyecto de este portal siempre es.
 */
export const SIMBOLO_POR_DEFECTO = 'carpeta';

/**
 * Resuelve un identificador a su símbolo. Cae al de por defecto ante un `id`
 * desconocido o ausente —que es lo que llegará de la columna de S-2 mientras
 * esté en `NULL`— en vez de reventar: una tarjeta sin portada es peor que una
 * tarjeta con la portada genérica.
 */
export function simboloDe(id: string | null | undefined): SimboloProyecto {
  const hallado = SIMBOLOS.find((s) => s.id === id);
  if (hallado) return hallado;
  const porDefecto = SIMBOLOS.find((s) => s.id === SIMBOLO_POR_DEFECTO);
  // Si esto se rompiera, la constante y la lista habrían divergido — y eso es un
  // error de programa, no un dato malo. Se grita en vez de pintar cualquier cosa.
  if (!porDefecto) throw new Error(`SIMBOLO_POR_DEFECTO «${SIMBOLO_POR_DEFECTO}» no está en SIMBOLOS`);
  return porDefecto;
}

/** El acento del proyecto. Token, no hex: gira con el tema. */
export const COLOR_PROYECTO = 'var(--mx-proyecto-acento)';

/** El mismo acento al 12 %, para tintes de fondo en HTML (en SVG se usa `fill-opacity`). */
export const TINTE_PROYECTO = 'var(--mx-proyecto-tinte)';
