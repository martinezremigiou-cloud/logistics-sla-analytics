// ============================================================
// [INV-B8.1] documento/huella.ts — la huella CANÓNICA de un par de documentos.
//
// PARA QUÉ EXISTE. El bloque A es exclusivamente presentación: arregla cómo se
// ve el documento sin tocar lo que dice. Eso hay que PROBARLO, y la única
// prueba que vale es comparar el contenido antes y después del cambio. Este
// módulo produce esa comparación en una forma que no se rompe por lo que sí
// tiene que cambiar.
//
// EL PROBLEMA DE COMPARAR DOCUMENTOS, Y CÓMO SE RESUELVE AQUÍ. Un diff ingenuo
// sobre los bytes, sobre el texto por página o sobre las direcciones de celda
// reprobaría el trabajo en vez de validarlo:
//
//   · El PDF actual parte "RESERVADO" en "RESER"+"VADO" (bug de `width`). Al
//     arreglarlo, el texto EXTRAÍDO cambia aunque el contenido sea idéntico.
//     Por eso la huella del PDF NORMALIZA: concatena todas las piezas en orden
//     de lectura y quita todo espacio en blanco. "RESER"+"VADO" y "RESERVADO"
//     producen la misma huella — que es exactamente lo que significa "los
//     mismos caracteres en el mismo orden".
//   · La hoja "Documento" gana un renglón y pierde otro (los deltas
//     mandatados). Comparar por dirección de celda (`A7` vs `A7`) daría
//     decenas de diferencias falsas por el corrimiento. Por eso se compara
//     como LISTA DE PARES etiqueta→valor: añadir o quitar un par mueve
//     exactamente un elemento, no todos.
//   · La hoja "Partidas" se compara por encabezado→valor, no por celda, para
//     que reordenar o ensanchar una columna no cuente como cambio de dato.
//
// LO QUE LA HUELLA SÍ CAZA, que es el punto: si una cifra cambia, si un texto
// de procedencia desaparece, si una advertencia se pierde o si una columna deja
// de emitirse, la huella cambia y el test lo dice con el valor viejo y el nuevo.
// ============================================================
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const XLSX: any = require('xlsx');

export interface HuellaDocumento {
  /** Texto del PDF, concatenado en orden de lectura y sin espacios. Inmune al reflow. */
  pdfNormalizado: string;
  /** Cuántas páginas tiene el PDF. Parte de la huella: el bug de páginas huérfanas se ve aquí. */
  pdfPaginas: number;
  /** Hojas del libro, en orden. */
  xlsxHojas: string[];
  /** Filas de "Partidas" como encabezado→valor. Inmune a mover columnas. */
  xlsxPartidas: Record<string, unknown>[];
  /** "Documento" como pares [etiqueta, valor], en orden. Un renglón añadido mueve UN elemento. */
  xlsxDocumento: [string, string][];
  /** Direcciones de celda con hipervínculo y su destino. Delta mandatado de O5. */
  xlsxEnlaces: [string, string][];
}

/**
 * Texto de un PDF, pieza por pieza y en orden de lectura.
 *
 * pdfkit comprime los flujos con FlateDecode y emite el texto como
 * `[<hex> kern <hex> …] TJ`, no como `(literal) Tj` — verificado sobre un PDF
 * real de esta misma librería. Buscar la forma equivocada devuelve cadena
 * vacía, y una huella vacía haría pasar cualquier comparación por vacuidad.
 */
export function piezasDeTextoDelPdf(bytes: Buffer): string[] {
  const crudo = bytes.toString('latin1');
  const partes: string[] = [];
  const inicioDeFlujo = /stream\r?\n/g;

  let marca: RegExpExecArray | null;
  while ((marca = inicioDeFlujo.exec(crudo)) !== null) {
    const desde = marca.index + marca[0].length;
    const hasta = crudo.indexOf('endstream', desde);
    if (hasta < 0) continue;

    let inflado: string;
    try {
      inflado = zlib.inflateSync(Buffer.from(crudo.slice(desde, hasta), 'latin1')).toString('latin1');
    } catch {
      // Las imágenes empotradas y los subconjuntos de fuente también viven en
      // flujos; no todos son texto comprimido.
      continue;
    }

    for (const bloque of Array.from(inflado.matchAll(/\[([^\]]*)\]\s*TJ/g))) {
      let linea = '';
      for (const hex of Array.from(bloque[1].matchAll(/<([0-9A-Fa-f]+)>/g))) {
        linea += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      partes.push(linea);
    }
    // pdfkit también emite `(literal) Tj` en algunos caminos; se recogen los dos.
    for (const literal of Array.from(inflado.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g))) {
      partes.push(literal[1].replace(/\\([()\\])/g, '$1'));
    }
  }

  return partes;
}

/** Cuenta objetos `/Type /Page` (no `/Pages`). Es la cifra que delata las páginas huérfanas. */
export function contarPaginas(bytes: Buffer): number {
  return (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * Las piezas de texto AGRUPADAS POR PÁGINA, en orden.
 *
 * pdfkit escribe un flujo de contenido por página y en orden de página, así
 * que agrupar por flujo equivale a agrupar por página. Los flujos que no son
 * texto —imágenes empotradas, subconjuntos de fuente— no producen ninguna
 * pieza y se descartan.
 *
 * Existe para poder afirmar la invariante que el bloque persigue: **ninguna
 * página puede contener solo el pie**. Con el texto aplanado esa pregunta no
 * se puede hacer; hay que saber qué pieza cayó en qué hoja.
 */
export function piezasPorPagina(bytes: Buffer): string[][] {
  const crudo = bytes.toString('latin1');
  const paginas: string[][] = [];
  const inicioDeFlujo = /stream\r?\n/g;

  let marca: RegExpExecArray | null;
  while ((marca = inicioDeFlujo.exec(crudo)) !== null) {
    const desde = marca.index + marca[0].length;
    const hasta = crudo.indexOf('endstream', desde);
    if (hasta < 0) continue;

    let inflado: string;
    try {
      inflado = zlib.inflateSync(Buffer.from(crudo.slice(desde, hasta), 'latin1')).toString('latin1');
    } catch {
      continue;
    }

    const piezas: string[] = [];
    for (const bloque of Array.from(inflado.matchAll(/\[([^\]]*)\]\s*TJ/g))) {
      let linea = '';
      for (const hex of Array.from(bloque[1].matchAll(/<([0-9A-Fa-f]+)>/g))) {
        linea += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      piezas.push(linea);
    }
    for (const literal of Array.from(inflado.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g))) {
      piezas.push(literal[1].replace(/\\([()\\])/g, '$1'));
    }

    if (piezas.length > 0) paginas.push(piezas);
  }

  return paginas;
}

/** `true` si la pieza es el pie de página. Se reconoce por su forma, no por su posición. */
export function esPieDePagina(pieza: string): boolean {
  return /generado el .* p[áa]gina \d+ de \d+/.test(pieza);
}

/** La huella completa del par. Determinista: con el mismo modelo produce lo mismo. */
export function huellaDe(xlsx: Buffer, pdf: Buffer): HuellaDocumento {
  const wb = XLSX.read(xlsx, { type: 'buffer' });
  const partidas = wb.Sheets['Partidas'];
  const documento = wb.Sheets['Documento'];

  const enlaces: [string, string][] = [];
  for (const hoja of wb.SheetNames) {
    const ws = wb.Sheets[hoja];
    for (const ref of Object.keys(ws)) {
      if (ref.startsWith('!')) continue;
      if (ws[ref].l?.Target) enlaces.push([`${hoja}!${ref}`, String(ws[ref].l.Target)]);
    }
  }

  const filasDocumento = (XLSX.utils.sheet_to_json(documento, { header: 1 }) as unknown[][]) ?? [];

  return {
    pdfNormalizado: piezasDeTextoDelPdf(pdf).join('').replace(/\s+/g, ''),
    pdfPaginas: contarPaginas(pdf),
    xlsxHojas: wb.SheetNames.slice(),
    xlsxPartidas: XLSX.utils.sheet_to_json(partidas) as Record<string, unknown>[],
    // Los renglones vacíos son separadores visuales, no contenido: se descartan
    // para que insertar o quitar uno no ensucie la comparación.
    xlsxDocumento: filasDocumento
      .filter((f) => (f ?? []).some((c) => String(c ?? '').trim() !== ''))
      .map((f) => [String(f[0] ?? '').trim(), String(f[1] ?? '').trim()] as [string, string]),
    xlsxEnlaces: enlaces.sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
}

/** Una pieza de texto con la posición en la que el PDF la coloca. */
export interface PiezaPosicionada {
  texto: string;
  x: number;
  y: number;
  pagina: number;
}

/**
 * El texto del PDF CON SU POSICIÓN, leída de los operadores `Tm` del flujo de
 * contenido.
 *
 * Existe porque en esta máquina no hay `pdftoppm` y no se puede rasterizar el
 * PDF para mirarlo. Pero "las filas se encinan" no necesita una imagen: es una
 * afirmación sobre COORDENADAS, y las coordenadas están en el archivo. Medirlas
 * prueba la ausencia de solape mejor que una inspección a ojo, que solo cubre
 * el caso que a uno se le ocurrió mirar.
 *
 * pdfkit emite `a b c d e f Tm` justo antes de cada `TJ`, con `e`/`f` como
 * origen del texto — verificado sobre un PDF real de esta librería.
 */
export function piezasConPosicion(bytes: Buffer): PiezaPosicionada[] {
  const crudo = bytes.toString('latin1');
  const piezas: PiezaPosicionada[] = [];
  const inicioDeFlujo = /stream\r?\n/g;
  let pagina = 0;

  let marca: RegExpExecArray | null;
  while ((marca = inicioDeFlujo.exec(crudo)) !== null) {
    const desde = marca.index + marca[0].length;
    const hasta = crudo.indexOf('endstream', desde);
    if (hasta < 0) continue;

    let inflado: string;
    try {
      inflado = zlib.inflateSync(Buffer.from(crudo.slice(desde, hasta), 'latin1')).toString('latin1');
    } catch {
      continue;
    }

    // `Tm` seguido, más adelante, de su `TJ`. Se recorre en orden.
    const patron = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+Tm[\s\S]*?\[([^\]]*)\]\s*TJ/g;
    const dePagina: PiezaPosicionada[] = [];
    let m: RegExpExecArray | null;
    while ((m = patron.exec(inflado)) !== null) {
      let texto = '';
      for (const hex of Array.from(m[7].matchAll(/<([0-9A-Fa-f]+)>/g))) {
        texto += Buffer.from(hex[1], 'hex').toString('latin1');
      }
      if (texto) dePagina.push({ texto, x: Number(m[5]), y: Number(m[6]), pagina });
    }

    if (dePagina.length > 0) {
      pagina++;
      piezas.push(...dePagina.map((p) => ({ ...p, pagina: pagina - 1 })));
    }
  }

  return piezas;
}
