// ============================================================
// [INV-B8.1] documento/pdf.ts — el renderizador de PDF.
//
// RUTA: `pdfkit` con la tipografía estándar del formato (Helvetica). Decisión
// de diseño: unos 15 MB en disco (pdfkit + fontkit), cero vulnerabilidades
// nuevas en `npm audit`, y ni un binario de fuente en el repositorio. Se pierde
// una tipografía de marca; ver `docs/known-limitations.md` (B8-2).
//
// ────────────────────────────────────────────────────────────
// LA REGLA QUE ORDENA ESTE ARCHIVO: **nunca se le pasa `width` a
// `doc.text()`.**
//
// No es una preferencia de estilo. Pasar `width` engancha la maquinaria de
// envoltura de pdfkit, y esa maquinaria produjo los tres defectos que el
// bloque B8.1 vino a arreglar — que resultaron ser UNO. Medido aislando una
// sola opción (`src/services/documento/medida.ts` lo documenta con la tabla):
//
//   · parte los encabezados: "RESERVADO" salía como "RESER" + "VADO",
//     "DISPONIBLE" como "DISPONIB" + "LE", pese a `lineBreak: false`;
//   · encima las filas, porque el alto real del texto no coincide con el alto
//     fijo que se le reservaba;
//   · **añade una página por cada pie**: el entregable de B8 tenía 4 páginas,
//     dos de ellas con nada más que el pie. `bufferPages` SÍ estaba puesto —de
//     ahí que el pie supiera decir "de 2"— y bajar `margins.bottom` a 0 no
//     cambiaba nada.
//
// En su lugar: se mide con `widthOfString`, se recorta en `medida.ts`, y se
// dibuja con `x`/`y` explícitas. El alto de cada fila se conoce ANTES de
// dibujarla, que es lo que permite garantizar que dos filas no se encimen.
// ────────────────────────────────────────────────────────────
//
// EL PRESUPUESTO DE IMÁGENES acota el costo transversal que el brief de B8
// pidió acotar (40 SKU con foto = hasta 80 MB en una invocación) por conteo Y
// por bytes; al agotarse, la imagen degrada por la misma cadena de D2 y el
// documento lo DICE. Un límite silencioso se lee como "no tenían foto".
// ============================================================
// Sin `import 'server-only'`: en este repo esa marca vive en los 22 route
// handlers, no en los servicios. El handler que importa este módulo ya la
// tiene, así que la frontera está puesta una vez y en la capa que corresponde.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { celdaComoTexto, filasSinImagenEnEsteFormato, type ModeloDocumento, type FilaDocumento, type Advertencia } from './modelo';
import { motivoLegible } from './resoluciones';
import { formatoNumero } from '@/lib/formato';
import { NOMBRE_PRODUCTO } from '@/config/producto';
import { TOKENS, TIPOGRAFIA, GEOMETRIA } from './tokens';
import { recortarAlAncho, envolverAlAncho, fragmentosDe } from './medida';

// Mismo motivo que en `xlsx.ts` y en `ingesta/io.ts`: el interop ESM↔CJS de
// estos paquetes deja funciones indefinidas en runtime con un namespace
// import, aunque `tsc` las tipe bien.
const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const PDFDocument: any = require('pdfkit');

/** Extensiones que ESTE renderizador sabe empotrar. `webp` NO está: es el motivo por el que una foto `.webp` degrada. */
export const FORMATOS_PDF = ['png', 'jpg', 'jpeg'] as const;

/**
 * Presupuesto de descarga de imágenes por documento. Los dos primeros topes
 * son necesarios: solo por conteo, 12 objetos de 2 MB siguen siendo 24 MB;
 * solo por bytes, un proyecto de 200 partidas haría 200 peticiones aunque
 * pesaran poco.
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-C] LA TERCERA DIMENSIÓN: TIEMPO.
 *
 * CANTIDAD y BYTES no acotan CUÁNTO TARDA. El `fetch` de Node no trae timeout
 * por omisión, así que un bucket lento o colgado dejaba el bucle de descarga
 * SIN COTA, dentro de una ruta HTTP que un usuario está esperando.
 *
 * ⚠ SIN ESTA COTA EL TECHO REAL NUNCA FUE "96 s" (12 × 8 000 ms): la ruta que
 * llama a este módulo (`src/app/api/proyectos/[id]/documento/route.ts`)
 * declara `maxDuration = 60`. Antes de este bloque, un bucket colgado le
 * costaba al usuario los 60 s completos Y CERO documento — Vercel mata la
 * petición y no llega nada, ni el PDF ni la confesión. El argumento real de
 * este cambio no es "menos que 96 s": es que convierte "60 s y nada" en
 * "acotado y el PDF completo con su confesión".
 *
 * Dos cotas porque protegen de dos cosas distintas — una no sustituye a la
 * otra:
 *
 *   · `maxMsPorImagen` — un `AbortSignal.timeout(...)` en CADA `fetch`.
 *     Protege de UN bucket que cuelga.
 *   · `maxMsTotal` — un presupuesto ACUMULADO a lo largo del bucle completo,
 *     con capacidad de INTERRUMPIR un `fetch` ya en vuelo cuando se agota
 *     (ver `descargarImagenes`: las dos señales se combinan con
 *     `AbortSignal.any`). Protege de N imágenes lentas que individualmente no
 *     agotan su propia cota: sin esto, 12 imágenes × la cota individual
 *     seguiría siendo un número grande.
 *
 * LOS NÚMEROS:
 *
 *   · `maxMsPorImagen = 8 000`. Una cota holgada para UNA descarga de una
 *     imagen pequeña desde un bucket público de almacenamiento: varias veces la
 *     latencia habitual de una petición HTTPS en frío (~3–4 viajes de ida y
 *     vuelta antes del primer byte), y muy por debajo del límite de la ruta. NO
 *     es la medición de ningún servicio concreto sino un tope de seguridad, y
 *     por eso es un número redondo y se declara como tal (la cifra «adornada»
 *     que parece medida y no lo es, es el patrón P29 de
 *     `docs/engineering/failure-patterns.md`).
 *
 *     LO QUE ESA COTA NO CUBRE, DECLARADO COMO HUECO, NO ESTIMADO: una descarga
 *     completa de una imagen grande bajo una red severamente degradada. No se
 *     midió y no se afirma que 8 000 ms la cubra con holgura — solo que acota
 *     un bucket que cuelga.
 *
 *
 *   · `maxMsTotal = 20 000`. Con `AbortSignal.any` (ver `descargarImagenes`)
 *     ESTE SÍ ES EL TECHO REAL del bucle completo — no
 *     `maxMsTotal + maxMsPorImagen`. Sin combinar las dos señales, el plazo
 *     total solo se comprobaba ANTES de arrancar cada `fetch` y no podía
 *     interrumpir uno ya en vuelo: con 10 imágenes a 1,99 s cada una
 *     (19,9 s), la 11.ª arrancaba en t=19,9 s < 20 s y colgaba hasta que SU
 *     propia cota la mataba a los 8 s más — 27,9 s reales contra un nombre
 *     que promete 20. Con las señales combinadas, esa 11.ª imagen se corta
 *     con lo que quede del plazo total, y el bucle completo nunca excede
 *     `maxMsTotal`.
 */
export const PRESUPUESTO_IMAGENES = {
  maxImagenes: 12,
  maxBytes: 12 * 1024 * 1024,
  maxMsPorImagen: 8_000,
  maxMsTotal: 20_000,
};

/**
 * Las OCHO columnas que imprime el papel. La `nota` va bajo su fila, no en
 * columna; la `foto` solo existe en el XLSX, que sabe enlazar.
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-B · S-5 · A1] `banda` SALIÓ, y no es una decisión de estilo.
 *
 * La agrupación ya se dice con la BARRA que encabeza cada grupo de filas, así
 * que la columna repetía en cada renglón lo que el renglón de arriba acababa de
 * decir. La §3 del formato 1b lista ocho columnas visibles y ésta no está.
 *
 * Y es lo que hace VIABLE la carta vertical, medido: con las nueve columnas los
 * pisos suman 547,8 pt contra 528 útiles —faltan 20— y con ocho suman 487,1.
 * Sacarla no es cosmética: es la diferencia entre que el formato exista o no.
 */
export const COLUMNAS_IMPRESAS = ['sku', 'descripcion', 'marca', 'cantidad', 'total', 'reservado', 'disponible', 'estatus'];

/**
 * LA PÁGINA, EN UN SOLO SITIO.
 *
 * Se exporta porque `documento.presentacion.test.ts` necesita construir un
 * documento con EXACTAMENTE esta geometría para aseverar que la tabla cabe. Si
 * el test escribiera su propia hoja, mediría una página distinta de la que se
 * imprime y el gate diría algo sobre un papel que no existe — que es el molde
 * de P27 (medir la representación en vez de la cosa).
 */
export const PAGINA = {
  size: 'LETTER',
  // ────────────────────────────────────────────────────────────
  // [2.0.1-B · S-5 · A2] VERTICAL, y el cambio no es de gusto.
  //
  // El documento se IMPRIME y se FIRMA: la hoja de aceptación pide vertical, y
  // apaisada es un formato de pantalla. Es la §6 de la especificación.
  //
  // No cabía. Con las nueve columnas de antes los pisos suman 547,8 pt contra
  // 528 útiles —faltan 20— y con ocho, 487,1. Sacar `banda` (A1) y permitir el
  // corte por puntuación cuando hace falta (`pisosQueCaben`) son las dos cosas
  // que lo hicieron posible; ninguna de las dos era cosmética.
  //
  // La holgura operativa medida es de 40,9 pt (7,7 %) sobre el peor detalle del
  // fixture que NO fragmenta, y el gate «la tabla cabe» la asevera contra los
  // tres detalles en cada corrida.
  // ────────────────────────────────────────────────────────────
  layout: 'portrait',
  margins: { top: 42, bottom: 46, left: 42, right: 42 },
} as const;

/**
 * El rotulo que abre el bloque de notas al pie. EXPORTADO porque la prueba de
 * POSICION lo necesita: sin un ancla estable no se puede aseverar que el texto
 * de una nota aparece DESPUES del marcador, y sin eso mover una nota de bloque
 * seria invisible para las tres aserciones de la huella.
 */
export const MARCADOR_NOTAS = 'NOTAS DE ESTE INVENTARIO';

/** El rotulo que abre los espacios de aceptacion. Exportado por la misma razon que el de notas: la prueba necesita un ancla. */
export const MARCADOR_ACEPTACION = 'ACEPTACIÓN';

/**
 * Los DOS espacios de firma. Dos y no uno: quien entrega y quien recibe. Un solo
 * espacio convierte una aceptacion en un acuse unilateral.
 */
export const ESPACIOS_DE_ACEPTACION = ['ENTREGA', 'RECIBE'] as const;

/** El ancho de contenido de una hoja ya construida. Derivado, nunca escrito. */
export const anchoUtilDe = (doc: { page: { width: number; margins: { left: number; right: number } } }) =>
  doc.page.width - doc.page.margins.left - doc.page.margins.right;

/**
 * EL PISO DE CADA COLUMNA: su token indivisible más largo, más el padding.
 *
 * Se saca de `renderizarPdf` y se exporta para que el gate de «la tabla cabe»
 * pueda aseverar la CAUSA (`sumaPisos <= anchoUtil`) y no el síntoma (que los
 * encabezados salgan partidos). Hasta S-5 solo se comprobaba el síntoma, y un
 * síntoma se puede arreglar sin arreglar la causa.
 *
 * `doc` entra como parámetro porque `widthOfString` depende de la fuente
 * cargada: la medida es del MOTOR, no de una tabla de anchos que alguien copió.
 */
export function medirPisos(
  doc: { font: (f: string) => unknown; fontSize: (n: number) => unknown; widthOfString: (s: string) => number },
  columnas: ModeloDocumento['columnas'],
  filas: FilaDocumento[],
  { fragmentar = false }: { fragmentar?: boolean } = {},
): number[] {
  const tokensDe = (texto: string) => texto.split(/\s+/).filter(Boolean);
  return columnas.map((c) => {
    // EL ENCABEZADO NO SE FRAGMENTA: sus tokens son palabras del idioma
    // («DESCRIPCIÓN», «RESERVADO») y partirlas es exactamente el defecto que
    // el arreglo anterior evitó. Solo el DATO se puede partir por su puntuación.
    doc.font('Helvetica-Bold');
    doc.fontSize(TIPOGRAFIA.tablaEncabezado);
    let maximo = Math.max(...tokensDe(c.titulo.toUpperCase()).map((t) => doc.widthOfString(t)), 0);

    const esSku = c.clave === 'sku';
    doc.font(esSku ? 'Courier' : 'Helvetica');
    doc.fontSize(esSku ? TIPOGRAFIA.tablaEncabezado : TIPOGRAFIA.tabla);
    for (const fila of filas) {
      for (const token of tokensDe(celdaComoTexto(fila, c))) {
        // MISMA función que usa `envolverAlAncho` para partir. Si el piso se
        // calculara con otro criterio que el de la envoltura, el piso mentiría:
        // prometería que el contenido cabe con una definición de «indivisible»
        // que el renderizador no usa. Una sola verdad, o ninguna.
        for (const fragmento of fragmentar ? fragmentosDe(token) : [token]) {
          maximo = Math.max(maximo, doc.widthOfString(fragmento));
        }
      }
    }
    return maximo + GEOMETRIA.celdaPadding * 2 + 2;
  });
}

/**
 * LOS PISOS QUE DE VERDAD SE USAN, con la relajación **solo si hace falta**.
 *
 * ────────────────────────────────────────────────────────────
 * POR QUÉ EN DOS ETAPAS, y esto lo decidió una prueba en rojo.
 *
 * La primera versión bajaba el piso al FRAGMENTO siempre. Efecto medido, y no
 * era el buscado: en carta apaisada —donde sobran 113 pt— el SKU
 * `DRX2263/D-KZ58-28-CCZ` empezaba a salir partido igual. Bajar el piso encoge
 * la columna, la columna encogida ya no aloja el token entero, y el token se
 * parte. **Se degradaba la lectura de un formato al que no le faltaba sitio**,
 * y lo cazó la prueba que vigila justo eso (`SKU, Marca y Estatus salen
 * EXACTOS`).
 *
 * Así que la relajación es CONDICIONAL: primero se piden los pisos estrictos
 * —el token entero, como hasta hoy—, y solo si esa suma no cabe se recalculan
 * permitiendo el corte por puntuación. Donde hay sitio no cambia nada; donde no
 * lo hay, el documento parte en un límite que el texto ofrece en vez de no
 * caber.
 *
 * `fragmentado` sale en el resultado para que quien lo use pueda DECIRLO: una
 * relajación silenciosa es una decisión que nadie revisó.
 */
export function pisosQueCaben(
  doc: { font: (f: string) => unknown; fontSize: (n: number) => unknown; widthOfString: (s: string) => number },
  columnas: ModeloDocumento['columnas'],
  filas: FilaDocumento[],
  anchoUtil: number,
): { pisos: number[]; suma: number; fragmentado: boolean } {
  const estrictos = medirPisos(doc, columnas, filas);
  const sumaEstricta = estrictos.reduce((a, b) => a + b, 0);
  if (sumaEstricta <= anchoUtil) return { pisos: estrictos, suma: sumaEstricta, fragmentado: false };

  const relajados = medirPisos(doc, columnas, filas, { fragmentar: true });
  return { pisos: relajados, suma: relajados.reduce((a, b) => a + b, 0), fragmentado: true };
}

/**
 * Techo de líneas por celda. MEDIDO contra el fixture del peor caso, no estimado: la
 * descripción más larga del fixture (inventada, con la forma de la peor) ocupa
 * **13 renglones** en el ancho más estrecho que su columna puede recibir. Una
 * primera versión de este bloque puso 12 —calculado a ojo— y truncó
 * exactamente 3 caracteres: el invariante "ningún texto existente desaparece"
 * se rompía por uno.
 *
 * 20 deja margen sobre los 13 medidos y sigue siendo un tope: si algún día
 * llega un texto que ni así cabe, se recorta con elipsis en vez de desbordar,
 * y eso se ve. La fila crece; la página ya sabe paginar.
 */
const MAX_LINEAS_CELDA = 20;

/**
 * `true` si el error de un `fetch` es EL TIMEOUT que este mismo módulo le
 * puso vía `AbortSignal.timeout(...)`, y no un fallo de red, DNS o del
 * propio bucket.
 *
 * Node (undici) propaga `signal.reason` como razón del rechazo, y
 * `AbortSignal.timeout(ms)` lo fija a una `DOMException` con
 * `name === 'TimeoutError'` — comprobado contra un `fetch` real que expira
 * en Node v24.13.1, incluido el aborto durante `arrayBuffer()`.
 * `AbortSignal.any(...)` (más abajo) propaga el MISMO `reason` de la señal
 * que disparó, así que esta comprobación no cambia por combinar las dos
 * cotas.
 *
 * MIRA TAMBIÉN `error.cause`, recursivamente (con tope de profundidad, sin
 * confiar en que la cadena no tenga ciclos): la VERSIÓN DE NODE DE ESTE
 * REPO NO ESTÁ FIJADA (`NODE-SIN-FIJAR-Y-PDFJS-EXIGE-22`), y undici en otros
 * caminos envuelve un abort en `TypeError: fetch failed` con la causa real
 * en `.cause`. Si una versión futura empezara a envolver así el timeout de
 * ESTE `fetch`, sin mirar `.cause` la clasificación se voltearía en
 * silencio hacia `fallidas` — el papel le atribuiría al bucket una decisión
 * que tomó este módulo, la falsedad exacta que esta función existe para
 * evitar. Cualquier rechazo que no sea timeout en ningún nivel (`TypeError`
 * de red real, certificado, etc.) sigue contando como `fallidas`.
 */
function esTimeout(error: unknown, profundidad = 0): boolean {
  if (profundidad > 3 || !(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  return esTimeout(error.cause, profundidad + 1);
}

/**
 * EXPORTADA porque `pdf.presupuesto-tiempo.test.ts` la necesita: probar la
 * cota TOTAL con precisión obligaría, si solo se pudiera invocar a través de
 * `renderizarPdf()`, a leer el conteo desde la prosa de una confesión ya
 * envuelta en líneas de PDF — frágil para un número. Aquí el resultado sale
 * estructurado (`omitidasPorTiempo` vs `fallidas` vs `omitidasPorPresupuesto`),
 * que es lo mismo que ya hacen `medirPisos`/`pisosQueCaben`/`anexoDeFotosCabe`
 * con la geometría: exportar el cálculo, no obligar al test a releerlo del
 * dibujo.
 *
 * `presupuesto` es OPCIONAL y por default es `PRESUPUESTO_IMAGENES` — el
 * objeto exportado y compartido —, así que `renderizarPdf()` no cambia ni un
 * carácter. Existe para que las pruebas puedan inyectar cotas de
 * milisegundos pequeñas SIN mutar ese objeto compartido: mutarlo y
 * restaurarlo en `afterEach` funcionaba solo porque vitest aísla módulos por
 * archivo y las pruebas de ese archivo corrían en serie — el día que alguien
 * agregara `it.concurrent` ahí, dos pruebas se pisarían las cotas entre sí y
 * se vería como flaky. Con el parámetro, el caso queda inexpresable en la
 * firma: no hay estado compartido que pisar.
 */
export async function descargarImagenes(
  filas: FilaDocumento[],
  presupuesto: typeof PRESUPUESTO_IMAGENES = PRESUPUESTO_IMAGENES,
): Promise<{ imagenes: Map<string, Buffer>; omitidasPorPresupuesto: number; fallidas: number; omitidasPorTiempo: number }> {
  const imagenes = new Map<string, Buffer>();
  const candidatas = filas.filter((f) => f.imagen.capa === 'sku');
  let bytes = 0;
  let omitidasPorPresupuesto = 0;
  let fallidas = 0;
  let omitidasPorTiempo = 0;

  // EL PRESUPUESTO TOTAL, COMO UN PLAZO — no como una cuenta de milisegundos
  // gastados: `Date.now()` una vez por vuelta es más simple que sumar
  // duraciones y no puede desincronizarse de la duración real del `await`.
  const finalDelPresupuesto = Date.now() + presupuesto.maxMsTotal;

  for (const fila of candidatas) {
    if (imagenes.size >= presupuesto.maxImagenes || bytes >= presupuesto.maxBytes) {
      omitidasPorPresupuesto++;
      continue;
    }
    // El presupuesto TOTAL se agotó ANTES de arrancar esta imagen: se cuenta
    // como omitida por tiempo SIN intentar el `fetch`.
    const msRestantes = finalDelPresupuesto - Date.now();
    if (msRestantes <= 0) {
      omitidasPorTiempo++;
      continue;
    }
    try {
      // El bucket `producto-imagenes` es público y sin firmar
      // (`0007_b5_storage.sql`): el servidor las lee sin credenciales.
      //
      // DOS SEÑALES, COMBINADAS CON `AbortSignal.any` — no una. La de
      // `maxMsPorImagen` protege de UN bucket que cuelga; sin ella, el
      // `fetch` de Node no expira nunca por sí solo. La de `msRestantes`
      // (lo que QUEDA del presupuesto total en este instante) es la que
      // permite que el plazo total interrumpa un `fetch` YA EN VUELO.
      //
      // Sin la segunda señal, el presupuesto total solo se comprobaba antes
      // de cada `fetch` y no podía frenar uno que ya estaba corriendo: el
      // techo real del bucle terminaba siendo `maxMsTotal + maxMsPorImagen`,
      // no lo que el nombre promete. Con las dos combinadas, ningún `fetch`
      // puede correr más allá de lo que quede del plazo total, así que el
      // bucle completo nunca excede `maxMsTotal`.
      const senal = AbortSignal.any([AbortSignal.timeout(presupuesto.maxMsPorImagen), AbortSignal.timeout(msRestantes)]);
      const res = await fetch(fila.imagen.fuente, { signal: senal });
      if (!res.ok) {
        fallidas++;
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (bytes + buffer.byteLength > presupuesto.maxBytes) {
        omitidasPorPresupuesto++;
        continue;
      }
      bytes += buffer.byteLength;
      imagenes.set(fila.sku, buffer);
    } catch (error) {
      // Un agotamiento de tiempo NO es un fallo de descarga: es una decisión
      // de ESTE generador, no del bucket ni de la red. Se cuenta aparte para
      // que la confesión pueda decir la causa correcta.
      if (esTimeout(error)) omitidasPorTiempo++;
      else fallidas++;
    }
  }

  return { imagenes, omitidasPorPresupuesto, fallidas, omitidasPorTiempo };
}

/** El isotipo opcional del repo (`public/marca/logo-principal.png`), o `null`. Un documento sin logo es un documento; uno que revienta por el logo, no. */
async function leerIsotipo(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-principal.png'));
  } catch {
    return null;
  }
}

/**
 * [MEDIO · M1, revisión del carril] Si el anexo de Fotografías cabe en lo
 * que resta de la página ACTUAL — la foto Y su rótulo, no solo la foto.
 *
 * Extraída de `renderizarPdf` para que el gate pueda aseverar el UMBRAL
 * exacto con valores DENTRO de la banda de riesgo, no solo en sus extremos
 * (P17, "medir las orillas no es medir la banda"): antes de esta corrección,
 * la comprobación in-line no incluía el espacio de separación que se aplica
 * DESPUÉS de decidir (`ALTO_GAP_ANTES_DEL_ANEXO`) ni el alto del rótulo del
 * SKU bajo la imagen, así que una tabla que terminara en esa ventana de
 * ~16 pt pasaba la comprobación y el dibujo real se salía por abajo — el
 * título quedaba en una página y la foto, forzada por el chequeo interno del
 * bucle, en la siguiente. Antes de F-9 esto no podía pasar porque el anexo
 * siempre abría hoja nueva.
 */
export function anexoDeFotosCabe(params: {
  y: number;
  limiteInferior: number;
  gapAntesDelAnexo: number;
  altoTitulo: number;
  altoFoto: number;
  altoRotuloFoto: number;
}): boolean {
  const { y, limiteInferior, gapAntesDelAnexo, altoTitulo, altoFoto, altoRotuloFoto } = params;
  return y + gapAntesDelAnexo + altoTitulo + altoFoto + altoRotuloFoto <= limiteInferior;
}

export async function renderizarPdf(modelo: ModeloDocumento): Promise<Buffer> {
  const [isotipo, descargas] = await Promise.all([leerIsotipo(), descargarImagenes(modelo.filas)]);

  // Lo que solo se sabe AL RENDERIZAR y por tanto no puede vivir en el modelo:
  // hoy, que la tabla no quepa a lo ancho. Se acumula aquí, LOCAL, y se une a
  // las confesiones al final. El modelo no se toca — ver el comentario del
  // `push` más abajo, donde esto era una mutación.
  const avisosDelRender: Advertencia[] = [];

  const doc = new PDFDocument({
    ...PAGINA,
    // Necesario para escribir el pie en páginas ya emitidas. NO era la causa
    // de las páginas huérfanas: estaba puesto y el bug ocurría igual.
    bufferPages: true,
    info: {
      Title: `${modelo.folio} · ${modelo.titulo}`,
      Author: modelo.firmante.etiqueta,
      Subject: 'Disponibilidad de inventario por proyecto',
      Creator: NOMBRE_PRODUCTO,
    },
  });

  const trozos: Buffer[] = [];
  doc.on('data', (t: Buffer) => trozos.push(t));
  const terminado = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(trozos))));

  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const izquierda = doc.page.margins.left;
  const limiteInferior = doc.page.height - doc.page.margins.bottom - GEOMETRIA.pieDesdeElBorde;

  /** Dibuja una línea sin entrar en la maquinaria de envoltura. Es el único camino de texto de este archivo. */
  const escribir = (texto: string, x: number, y: number, opciones?: { alDerecha?: number }) => {
    if (opciones?.alDerecha !== undefined) {
      doc.text(texto, opciones.alDerecha - doc.widthOfString(texto), y, { lineBreak: false });
    } else {
      doc.text(texto, x, y, { lineBreak: false });
    }
  };

  // ---------- Encabezado ----------
  //
  // `public/marca/logo-principal.png` es un ISOTIPO OPCIONAL (proporción apaisada):
  // no contiene el nombre del producto, y este repo de muestra no lo distribuye;
  // sin él, el encabezado es solo texto. Con él, la imagen se dibuja en
  // (izquierda, doc.y) y el texto en la MISMA x, y como `doc.image()` con
  // coordenadas explícitas no avanza `doc.y`, el isotipo caería encima de las
  // primeras letras. El nombre va a la derecha del isotipo, con su ancho
  // calculado de la proporción.
  const altoIsotipo = 30;
  const anchoIsotipo = Math.round((altoIsotipo * 393) / 256);
  const yEncabezado = doc.y;

  if (isotipo) {
    try {
      doc.image(isotipo, izquierda, yEncabezado, { height: altoIsotipo });
    } catch {
      /* un logo ilegible no tumba el documento */
    }
  }

  const xTexto = izquierda + (isotipo ? anchoIsotipo + 12 : 0);
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(TOKENS.navy);
  escribir('DEMO', xTexto, yEncabezado + 3);
  doc.font('Helvetica').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
  escribir(NOMBRE_PRODUCTO.toUpperCase(), xTexto, yEncabezado + 17);

  // Regla de acento bajo el encabezado: separa la marca del contenido sin
  // recuadros, que es lo que el resto del portal hace.
  doc
    .moveTo(izquierda, yEncabezado + altoIsotipo + 8)
    .lineTo(izquierda + anchoUtil, yEncabezado + altoIsotipo + 8)
    .strokeColor(TOKENS.acento)
    .lineWidth(1.2)
    .stroke();

  let y = yEncabezado + altoIsotipo + 20;

  // ---------- Identidad del proyecto ----------
  doc.font('Courier-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(TOKENS.navy);
  escribir(modelo.folio, izquierda, y);
  const chips = [modelo.tipo, modelo.intencion].filter(Boolean).join('   ·   ');
  if (chips) {
    doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla).fillColor(TOKENS.muted);
    escribir(chips, izquierda + doc.widthOfString(`${modelo.folio}    `) + 20, y + 2);
  }
  y += 16;

  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.titulo).fillColor(TOKENS.tinta);
  escribir(recortarAlAncho(doc, modelo.titulo, anchoUtil), izquierda, y);
  y += 22;

  if (modelo.descripcion) {
    doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo).fillColor(TOKENS.tinta2);
    for (const linea of envolverAlAncho(doc, modelo.descripcion, anchoUtil, 2)) {
      escribir(linea, izquierda, y);
      y += doc.currentLineHeight() + 1;
    }
  }

  // ---------- EL SELLO DE VIGENCIA ----------
  //
  // La procedencia, ANTES que los números. Va arriba de la tabla a propósito:
  // quien lee tiene que saber de qué fecha son las cifras antes de leerlas, no
  // en un pie.
  //
  // ────────────────────────────────────────────────────────────
  // [2.0.1-B · S-5 · B1] ERA TEXTO EN NEGRITA; AHORA ES UN SELLO.
  //
  // La frase no cambia ni un carácter: sigue siendo `modelo.vigencia`, la frase
  // completa que arma el modelo. Lo que cambia es que deja de leerse como una
  // línea más del encabezado. Con la banda de tinte y el borde de acento se ve
  // ANTES de leerse — y esa es la razón entera del bloque en la §3: **nadie
  // firma sin ver la fecha del inventario.**
  //
  // La etiqueta es lo único de texto nuevo, y hace falta: una banda sin rótulo
  // no dice qué es. Va declarada en `ADICIONES_DECLARADAS`.
  //
  // Se dibuja midiendo ANTES: se envuelve la frase, se cuenta cuánto alto pide,
  // y solo entonces se pinta el fondo. Al revés —fondo primero, texto después—
  // el fondo tendría que adivinar el alto, que es como se encimaron las filas la
  // primera vez.
  // ────────────────────────────────────────────────────────────
  y += 6;
  const ETIQUETA_SELLO = 'VIGENCIA DEL DATO';
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta);
  const lineasVigencia = envolverAlAncho(doc, modelo.vigencia, anchoUtil - GEOMETRIA.selloPaddingX * 2 - GEOMETRIA.selloBorde, 2);
  const altoLinea = doc.currentLineHeight() + 1;
  const altoSello = GEOMETRIA.selloPaddingY * 2 + altoLinea * (lineasVigencia.length + 1);

  doc.save();
  doc.rect(izquierda, y, anchoUtil, altoSello).fill(TOKENS.selloFondo);
  doc.rect(izquierda, y, GEOMETRIA.selloBorde, altoSello).fill(TOKENS.acento);
  doc.restore();

  const xSello = izquierda + GEOMETRIA.selloBorde + GEOMETRIA.selloPaddingX;
  let ySello = y + GEOMETRIA.selloPaddingY;
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.acento);
  escribir(ETIQUETA_SELLO, xSello, ySello);
  ySello += altoLinea;
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.navy);
  for (const linea of lineasVigencia) {
    escribir(linea, xSello, ySello);
    ySello += altoLinea;
  }
  y += altoSello + 6;

  // ---------- LA IDENTIDAD, EN REJILLA 3×2 ----------
  //
  // ────────────────────────────────────────────────────────────
  // [2.0.1-C · F-7] ERA UNA CADENA CORRIDA ENVUELTA A 2 LÍNEAS.
  //
  // [O6] El RESPONSABLE (dueño del proyecto) y el FIRMANTE (quien generó el
  // archivo) son dos personas distintas. Hasta hoy los dos vivían en una sola
  // línea unida con «·» y envuelta con `envolverAlAncho`, que corta por
  // PALABRA — y una fecha («28 ago 2026») es una secuencia de palabras como
  // cualquier otra para ese algoritmo: la partía a media fecha.
  //
  // Cada campo pasa a su propia CELDA DE ANCHO FIJO, el mismo molde que el
  // resumen de cinco cifras un poco más abajo: `recortarAlAncho` recorta el
  // valor si no cabe, nunca lo envuelve, así que ninguna celda puede partir
  // su contenido a media palabra ni a medio número.
  //
  // Rejilla 3×2 y CINCO campos, no seis: «destinatario» se consideró y se
  // descartó, así que la sexta celda queda vacía en vez de forzar un campo
  // que nadie pidió. GENERADO (el instante) es contenido nuevo en el CUERPO
  // del documento — antes solo vivía en el pie de cada página y en la hoja
  // «Documento» del XLSX (`xlsx.ts:138`, misma etiqueta «Generado el»).
  // ────────────────────────────────────────────────────────────
  const CELDAS_IDENTIDAD: Array<{ etiqueta: string; valor: string } | null> = [
    // [INFO · revisión del carril] Era `?? 'Sin asignar'` — nulidad, no
    // verdad-lógica. `modelo.responsable` es `string | null`: con
    // `responsable: ''` la celda salía «Responsable» con el valor VACÍO en
    // vez de decir «Sin asignar». Hoy no es alcanzable (`armarModelo` no
    // sanea la cadena vacía, pero tampoco la produce ningún camino real),
    // y aun así el tipo lo permite — el código original de B8 sí usaba la
    // forma truthy (`modelo.responsable ? ... : 'sin asignar'`).
    { etiqueta: 'Responsable', valor: modelo.responsable?.trim() || 'Sin asignar' },
    { etiqueta: 'Fecha del proyecto', valor: modelo.fecha },
    { etiqueta: 'Generado por', valor: modelo.firmante.etiqueta },
    { etiqueta: 'Entorno', valor: modelo.firmante.entorno },
    { etiqueta: 'Generado el', valor: modelo.generado },
    null,
  ];
  const COLUMNAS_IDENTIDAD = 3;
  const anchoCeldaIdentidad = anchoUtil / COLUMNAS_IDENTIDAD;

  doc.font('Helvetica').fontSize(TIPOGRAFIA.etiqueta);
  const altoEtiquetaIdentidad = doc.currentLineHeight() + 2;
  doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo);
  const altoValorIdentidad = doc.currentLineHeight();
  const altoFilaIdentidad = altoEtiquetaIdentidad + altoValorIdentidad + 4;

  CELDAS_IDENTIDAD.forEach((celda, i) => {
    if (!celda) return;
    const x = izquierda + anchoCeldaIdentidad * (i % COLUMNAS_IDENTIDAD);
    const yFila = y + Math.floor(i / COLUMNAS_IDENTIDAD) * altoFilaIdentidad;
    doc.font('Helvetica').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
    escribir(recortarAlAncho(doc, celda.etiqueta, anchoCeldaIdentidad - 4), x, yFila);
    doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo).fillColor(TOKENS.tinta);
    escribir(recortarAlAncho(doc, celda.valor, anchoCeldaIdentidad - 4), x, yFila + altoEtiquetaIdentidad);
  });
  y += altoFilaIdentidad * 2;

  doc.font('Helvetica').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
  for (const linea of envolverAlAncho(doc, modelo.agrupacion, anchoUtil, 2)) {
    escribir(linea, izquierda, y);
    y += doc.currentLineHeight() + 1;
  }

  // ---------- EL RESUMEN · CINCO CIFRAS ----------
  //
  // ────────────────────────────────────────────────────────────
  // [2.0.1-B · S-5 · B2] SON CINCO Y NO CUATRO, y es la corrección más
  // importante del bloque a la §1.3.
  //
  // Los tres últimos cubos son una PARTICIÓN de `totalSkus`, y el tercero
  // —«fuera del vigente»— existe porque una fila cuyo SKU ya no viene en el
  // archivo **no es «cubierta» ni «con déficit»: es NO-MEDIDA**. Con S-6 sus
  // tres cifras de almacén se imprimirán «—» porque no se pueden saber.
  // Absorberla en cualquiera de los otros dos cubos sería violar «cero y
  // no-medido son valores distintos» en el resumen ejecutivo de un papel que va
  // a un cliente.
  //
  // Las cifras vienen del MODELO (`resumenDe`), no se cuentan aquí: si el
  // renderizador las re-derivara habría dos verdades del mismo reparto, y ya
  // se sabe cómo termina eso.
  //
  // El ámbar es SOLO cuando la cifra es mayor que cero, para las dos que
  // señalan un problema. Un ámbar permanente deja de significar algo.
  // ────────────────────────────────────────────────────────────
  y += 6;
  const CIFRAS: Array<{ etiqueta: string; valor: string; alerta: boolean }> = [
    { etiqueta: 'PARTIDAS', valor: String(modelo.totalSkus), alerta: false },
    { etiqueta: 'PIEZAS', valor: formatoNumero(modelo.totalPiezas), alerta: false },
    { etiqueta: 'CUBIERTAS', valor: String(modelo.resumen.cubiertas), alerta: false },
    { etiqueta: 'CON DÉFICIT', valor: String(modelo.resumen.conDeficit), alerta: modelo.resumen.conDeficit > 0 },
    // [2.0.1-C · F-11] Era «FUERA DEL VIGENTE». Se unifica con los otros dos
    // sitios que hablan de esto mismo con palabras distintas: el estatus de
    // la fila (`ESTATUS_FUERA_DEL_VIGENTE`, en `modelo.ts`) y la nota al pie.
    { etiqueta: 'FUERA DEL INVENTARIO', valor: String(modelo.resumen.fueraDelVigente), alerta: modelo.resumen.fueraDelVigente > 0 },
  ];
  const anchoCifra = anchoUtil / CIFRAS.length;
  let yCifras = y;
  for (let i = 0; i < CIFRAS.length; i++) {
    const cifra = CIFRAS[i];
    const x = izquierda + anchoCifra * i;
    doc.font('Helvetica').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
    escribir(recortarAlAncho(doc, cifra.etiqueta, anchoCifra - 4), x, yCifras);
    doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(cifra.alerta ? TOKENS.warn : TOKENS.navy);
    escribir(cifra.valor, x, yCifras + doc.currentLineHeight());
  }
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo);
  yCifras += doc.currentLineHeight() * 2 + 2;
  doc.save();
  doc.moveTo(izquierda, yCifras).lineTo(izquierda + anchoUtil, yCifras).lineWidth(0.5).stroke(TOKENS.bordeSuave);
  doc.restore();
  y = yCifras + 6;

  // ---------- Tabla ----------
  const columnas = modelo.columnas.filter((c) => COLUMNAS_IMPRESAS.includes(String(c.clave)));

  // ANCHOS CON PISO MEDIDO, no proporcionales a secas.
  //
  // O4 exige que ningún encabezado se parta NI se corte, y las dos cosas son
  // consecuencia de lo mismo: repartir el ancho solo por proporción deja
  // columnas más angostas que su propio título. Con reparto puro,
  // "PIEZAS DEL PROYECTO" no cabía y salía cortado — cambiar una violación por
  // la otra no es arreglarlo.
  //
  // Aquí cada columna recibe primero SU PISO (lo que mide su encabezado, más
  // el relleno) y el sobrante se reparte por la proporción del modelo. Los
  // pisos suman ~486 pt de los 720 disponibles en carta apaisada, así que hay
  // holgura real; si algún día no la hubiera, la guarda de abajo lo grita en
  // vez de cortar en silencio.
  // EL PISO DE CADA COLUMNA ES SU TOKEN INDIVISIBLE MÁS LARGO.
  //
  // Regla del bloque, corregida tras rasterizar: **ningún texto se
  // parte a media palabra — ni encabezado ni celda.** Partir en un ESPACIO sí
  // es correcto (`PIEZAS DEL` / `PROYECTO`); lo que no puede pasar es
  // `TE152-M` / `X`, que en un documento que ve un cliente es el mismo defecto
  // de clase que `RESERVA` / `DO`.
  //
  // De ahí sale el piso: lo más ancho que la columna tiene que poder mostrar
  // SIN romperlo, mirando las dos fuentes —las palabras del encabezado y los
  // tokens sin espacio del contenido de ESTE documento—. Medido sobre un
  // catálogo: el token de SKU más largo sin espacios es
  // `DRX2263/D-KZ58-28-CCZ` (21 caracteres) y **ninguno lo supera**;
  // `SERIES5` (7) manda en marca; `Sobre-reservado` (15) en estatus; y la
  // palabra más larga de una descripción tiene **31** caracteres
  // (`3.2(O3),91.3(O0,3)HEYK,HBOCtNPK`) — que también manda un piso.
  //
  // Tomar el piso del ENCABEZADO ENTERO era lo que estrangulaba la tabla:
  // `PIEZAS DEL PROYECTO` exigía 113 pt para mostrar cifras de 7 caracteres.
  // Con la palabra más larga (`PROYECTO`) exige la mitad, y el encabezado se
  // parte en su espacio, que es donde se puede.
  // El cálculo vive en `pisosQueCaben` (exportada) desde S-5, para que el gate
  // pueda aseverar la CAUSA de que la tabla quepa y no solo el síntoma. Relaja
  // el piso al fragmento SOLO si con el token entero no cabría.
  const { pisos, suma: sumaPisos, fragmentado } = pisosQueCaben(doc, columnas, modelo.filas, anchoUtil);
  const sobrante = Math.max(0, anchoUtil - sumaPisos);

  // EL SOBRANTE SE REPARTE POR DÉFICIT MEDIDO, no por una proporción fija.
  //
  // Repartirlo por el `ancho` del modelo dejaba a "PIEZAS DEL PROYECTO" con
  // 113 pt —la columna más ancha de la tabla— para mostrar cifras de 7
  // caracteres, mientras "Descripción", que carga 244, se quedaba con 109 y
  // necesitaba 13 renglones. El reparto estaba literalmente al revés.
  //
  // Aquí cada columna declara cuánto le FALTA para que su contenido más largo
  // de ESTE documento quepa en una línea, y el sobrante se reparte en
  // proporción a esa falta. Una columna cuyo contenido ya cabe en el piso de
  // su encabezado no pide nada — que es el caso de las numéricas, porque su
  // título es más largo que cualquier cifra del catálogo ("771,788", 7
  // caracteres). Es data-driven en el sentido del repo: la maquetación la
  // decide el dato de este documento, no una constante escrita a ojo.
  const anchoDeContenido = columnas.map((c, i) => {
    if (c.tipo === 'numero') return 0;
    const esSku = c.clave === 'sku';
    doc.font(esSku ? 'Courier' : 'Helvetica').fontSize(esSku ? TIPOGRAFIA.tablaEncabezado : TIPOGRAFIA.tabla);
    let maximo = 0;
    for (const fila of modelo.filas) {
      maximo = Math.max(maximo, doc.widthOfString(celdaComoTexto(fila, c)));
    }
    void i;
    return maximo + GEOMETRIA.celdaPadding * 2;
  });

  const deficits = columnas.map((_, i) => Math.max(0, anchoDeContenido[i] - pisos[i]));
  const sumaDeficits = deficits.reduce((a, b) => a + b, 0);
  const anchos = columnas.map((_, i) =>
    sumaDeficits > 0 ? pisos[i] + (deficits[i] / sumaDeficits) * sobrante : pisos[i] + sobrante / columnas.length,
  );
  const anchoUtilDeCelda = (i: number) => anchos[i] - GEOMETRIA.celdaPadding * 2;

  if (sumaPisos > anchoUtil) {
    // No se corta en silencio: se deja dicho en el propio documento que la
    // tabla no cabe. Un encabezado recortado se lee como un nombre de columna,
    // y ése es el modo de falla que este bloque vino a matar.
    //
    // ────────────────────────────────────────────────────────────
    // [2.0.1-B · S-5] ANTES ESTO HACÍA `modelo.advertencias.push(...)`, y era
    // una MUTACIÓN DEL MODELO EN TIEMPO DE RENDER.
    //
    // Rompía el invariante que el propio `modelo.ts:191-193` declara —«los
    // renderizadores no toman una sola decisión de contenido»— y, peor, hacía
    // que el modelo que ve el XLSX y el que ve el PDF **fueran distintos**: el
    // del PDF ganaba una entrada. En producción no cruzaba formatos porque la
    // ruta arma un modelo por petición y renderiza uno solo, así que era una
    // bomba sin espoleta; en pruebas, que comparten fixtures, sí podía cruzar.
    //
    // Se cierra sin crecer el alcance porque la salida ya existía tres bloques
    // más abajo: `confesiones` es una lista LOCAL del render. Esta advertencia
    // se une ahí, con `alcance: 'documento'` — es sobre la HOJA, no sobre unas
    // filas, y por eso no lleva `filas` en vez de llevarlo vacío.
    avisosDelRender.push({
      texto: `Los encabezados de la tabla necesitan ${Math.ceil(sumaPisos)} pt y la hoja solo ofrece ${Math.floor(anchoUtil)} pt: algunas columnas pueden verse apretadas.`,
      alcance: 'documento',
    });
  } else if (fragmentado) {
    // La relajación no es silenciosa. Que un SKU salga en dos renglones es un
    // hecho que quien lee el papel tiene que poder explicarse — y sobre todo:
    // es la señal de que la tabla está al borde de no caber, que es cuándo hay
    // que decidir algo, no cuando ya no cupo.
    avisosDelRender.push({
      texto:
        'La tabla no cabía con las palabras enteras, así que algunos códigos y descripciones se parten en dos renglones. El corte va después de una diagonal, un guion o una coma; el fragmento que termina en uno de ellos continúa abajo.',
      alcance: 'documento',
    });
  }

  // ---------- LOS SUPERÍNDICES, DERIVADOS DE `advertencia.filas` ----------
  //
  // [2.0.1-B · S-5 · B3] El numero que lleva cada fila NO se recalcula aqui: sale
  // del MISMO objeto que produjo el conteo de la advertencia. Ese era el punto
  // entero del predicado unico — el conteo, el superindice y (en S-4) el enlace
  // del pre-vuelo salen de una sola verdad. Si este bloque volviera a preguntar
  // «¿esta fuera del vigente?» habria dos respuestas al mismo hecho.
  //
  // Solo numeran las de `alcance: 'filas'`: una advertencia sobre la HOJA no
  // tiene filas que marcar, y darle un numero que ninguna fila referencia seria
  // una nota al pie que no apunta a nada.
  const notasNumeradas = modelo.advertencias.filter((a) => a.alcance === 'filas');
  const numerosDeFila = new Map<FilaDocumento, number[]>();
  notasNumeradas.forEach((advertencia, indice) => {
    if (advertencia.alcance !== 'filas') return;
    for (const fila of advertencia.filas) {
      numerosDeFila.set(fila, [...(numerosDeFila.get(fila) ?? []), indice + 1]);
    }
  });

  // El encabezado se ENVUELVE en sus espacios (nunca a media palabra: el piso
  // de cada columna garantiza que su palabra más larga cabe) y la barra crece
  // con el número de renglones que de verdad ocupe.
  doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.tablaEncabezado);
  const lineasEncabezado = columnas.map((c, i) => envolverAlAncho(doc, c.titulo.toUpperCase(), anchoUtilDeCelda(i), 3));
  const altoEncabezado = Math.max(
    GEOMETRIA.encabezadoAlto,
    Math.max(...lineasEncabezado.map((l) => l.length)) * (doc.currentLineHeight() + 1) + 7,
  );

  const dibujarEncabezado = (yEnc: number): number => {
    doc.rect(izquierda, yEnc, anchoUtil, altoEncabezado).fill(TOKENS.navy);
    doc.fillColor(TOKENS.papel).font('Helvetica-Bold').fontSize(TIPOGRAFIA.tablaEncabezado);
    let x = izquierda;
    columnas.forEach((columna, i) => {
      let yLinea = yEnc + 5;
      for (const linea of lineasEncabezado[i]) {
        if (columna.tipo === 'numero') {
          escribir(linea, 0, yLinea, { alDerecha: x + anchos[i] - GEOMETRIA.celdaPadding });
        } else {
          escribir(linea, x + GEOMETRIA.celdaPadding, yLinea);
        }
        yLinea += doc.currentLineHeight() + 1;
      }
      x += anchos[i];
    });
    return yEnc + altoEncabezado + 3;
  };

  /** Alto que va a ocupar una fila, CALCULADO antes de dibujarla. Es lo que impide que dos se encimen. */
  const altoDeFila = (fila: FilaDocumento): { alto: number; lineasPorColumna: string[][] } => {
    doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
    const lineasPorColumna = columnas.map((columna, i) => {
      const texto = celdaComoTexto(fila, columna);
      // Los números son cortos por construcción (el mayor del catálogo es
      // "771,788", 7 caracteres) y una cifra partida en dos renglones sería
      // ilegible: esos sí van a una línea.
      if (columna.tipo === 'numero') {
        return [recortarAlAncho(doc, texto, anchoUtilDeCelda(i))];
      }
      // Todo lo demás —SKU incluido— se ENVUELVE. El SKU más largo del
      // catálogo tiene 31 caracteres y no cabe en su columna; truncarlo
      // borraría la identidad de la partida, que es lo único que un documento
      // de inventario no puede perder.
      if (columna.clave === 'sku') {
        doc.font('Courier').fontSize(TIPOGRAFIA.tablaEncabezado);
        const lineas = envolverAlAncho(doc, texto, anchoUtilDeCelda(i), MAX_LINEAS_CELDA);
        doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
        return lineas;
      }
      return envolverAlAncho(doc, texto, anchoUtilDeCelda(i), MAX_LINEAS_CELDA);
    });
    const maxLineas = Math.max(1, ...lineasPorColumna.map((l) => l.length));
    const alto = Math.max(GEOMETRIA.filaAltoMinimo, maxLineas * (doc.currentLineHeight() + 1) + 6);
    return { alto, lineasPorColumna };
  };

  y += 8;
  y = dibujarEncabezado(y);

  let bandaActual: string | null = null;
  for (const fila of modelo.filas) {
    doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
    const { alto, lineasPorColumna } = altoDeFila(fila);

    // La nota se mide TAMBIÉN antes de decidir el salto: una fila cuya nota no
    // cabe en la página no debe empezar en ella.
    doc.fontSize(TIPOGRAFIA.nota);
    const lineasNota = fila.nota ? envolverAlAncho(doc, fila.nota, anchoUtil - 16, 2) : [];
    const altoNota = lineasNota.length * (doc.currentLineHeight() + 1);
    doc.fontSize(TIPOGRAFIA.tabla);

    if (y + alto + altoNota > limiteInferior) {
      doc.addPage();
      y = doc.page.margins.top;
      y = dibujarEncabezado(y);
      bandaActual = null;
    }

    if (fila.banda !== bandaActual) {
      bandaActual = fila.banda;
      doc.rect(izquierda, y, anchoUtil, 13).fill(TOKENS.banda);
      doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.tablaEncabezado).fillColor(TOKENS.navy);
      escribir(recortarAlAncho(doc, bandaActual, anchoUtil - 8), izquierda + GEOMETRIA.celdaPadding, y + 3.5);
      y += 16;
    }

    doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
    let x = izquierda;
    columnas.forEach((columna, i) => {
      const esNumero = columna.tipo === 'numero';
      const esSku = columna.clave === 'sku';
      if (esSku) doc.font('Courier').fontSize(TIPOGRAFIA.tablaEncabezado);
      doc.fillColor(fila.enRiesgo && esNumero ? TOKENS.warn : TOKENS.tinta);

      let yLinea = y + 3;
      for (const linea of lineasPorColumna[i]) {
        if (esNumero) escribir(linea, 0, yLinea, { alDerecha: x + anchos[i] - GEOMETRIA.celdaPadding });
        else escribir(linea, x + GEOMETRIA.celdaPadding, yLinea);
        yLinea += doc.currentLineHeight() + 1;
      }

      // EL SUPERINDICE, pegado al estatus de la fila. Va en la ultima columna
      // porque es la que dice QUE le pasa a esta partida, que es justo lo que la
      // nota al pie amplia.
      const numeros = columna.clave === 'estatus' ? (numerosDeFila.get(fila) ?? []) : [];
      if (numeros.length > 0) {
        // EL ORDEN DE ESTAS TRES LÍNEAS ES EL ARREGLO. La primera versión medía
        // `widthOfString` DESPUÉS de cambiar a la fuente del superíndice, así que
        // medía la línea del estatus con la tipografía equivocada y el número
        // caía encima del texto. `widthOfString` depende de la fuente CARGADA:
        // se mide con la del contenido, y solo entonces se cambia.
        const ultima = lineasPorColumna[i][lineasPorColumna[i].length - 1] ?? '';
        const xSuperindice = x + GEOMETRIA.celdaPadding + doc.widthOfString(ultima) + 1;
        const ySuperindice = yLinea - (doc.currentLineHeight() + 1);

        doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.nota).fillColor(TOKENS.warn);
        escribir(numeros.join(','), xSuperindice, ySuperindice - 1);
        doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
      }

      if (esSku) doc.font('Helvetica').fontSize(TIPOGRAFIA.tabla);
      x += anchos[i];
    });

    y += alto;

    // [2.0.1-B · S-5 · B3] LA NOTA YA NO VA BAJO SU FILA.
    //
    // Bajo cada fila, la nota repetia por renglon lo que la advertencia dice una
    // vez para todas — y en una tabla de 34 partidas eso son 34 parrafos de
    // prosa intercalados entre los numeros. El formato 1b la baja al PIE como
    // nota numerada, y la fila apunta con su superindice.
    //
    // No se pierde informacion: la nota de una fila fuera del vigente y la
    // advertencia que la cuenta dicen el MISMO hecho, y ahora se dice una vez
    // con una referencia, en vez de dos veces sin relacion visible entre ellas.

    doc.moveTo(izquierda, y).lineTo(izquierda + anchoUtil, y).strokeColor(TOKENS.bordeSuave).lineWidth(0.5).stroke();
    y += 2;
  }

  if (modelo.filas.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(TIPOGRAFIA.cuerpo).fillColor(TOKENS.muted);
    escribir('Este proyecto todavía no tiene partidas.', izquierda, y + 8);
  }

  // ---------- LAS NOTAS AL PIE, NUMERADAS ----------
  //
  // [2.0.1-B · S-5 · B3] Van DESPUES de la tabla, no en el pie literal de la
  // hoja 1, y es una desviacion de la §3 que hay que decir: con una tabla que
  // desborda a tres paginas, «el pie de la hoja 1» cae A MITAD de la tabla. Una
  // nota al pie tiene que venir DESPUES de lo que anota, o deja de ser una nota
  // al pie y pasa a ser una interrupcion.
  //
  // El numero de cada una es su posicion en `notasNumeradas`, la MISMA lista de
  // la que salieron los superindices — no hay dos numeraciones que sincronizar.
  if (notasNumeradas.length > 0) {
    y += 8;
    if (y + 40 > limiteInferior) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
    escribir(MARCADOR_NOTAS, izquierda, y);
    y += doc.currentLineHeight() + 3;

    notasNumeradas.forEach((advertencia, indice) => {
      doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.nota).fillColor(TOKENS.warn);
      escribir(String(indice + 1), izquierda, y);
      const sangria = doc.widthOfString('88') + 4;
      doc.font('Helvetica').fontSize(TIPOGRAFIA.nota).fillColor(TOKENS.tinta2);
      for (const linea of envolverAlAncho(doc, advertencia.texto, anchoUtil - sangria, 3)) {
        escribir(linea, izquierda + sangria, y);
        y += doc.currentLineHeight() + 1;
      }
      y += 2;
    });
  }

  // ---------- Fotografías ----------
  //
  // ────────────────────────────────────────────────────────────
  // [2.0.1-C · F-9] EL addPage() DEJA DE SER INCONDICIONAL.
  //
  // Antes: `if (imagenes.size > 0) { doc.addPage(); ... }` — el anexo abría
  // página SIEMPRE que hubiera al menos 1 imagen, aunque la tabla recién
  // dibujada dejara media hoja libre.
  //
  // Regla del bloque: con UNA sola imagen el anexo no merece página propia
  // —continúa en la que ya hay contenido, si cabe— y con MÁS de una sí la
  // abre siempre, quepa o no: un mosaico de fotos se lee mejor empezando en
  // limpio que a media hoja. Es la misma idea que rige el bloque de cierre
  // más abajo (medir antes de decidir), con una regla extra encima para el
  // caso de más de una imagen.
  if (descargas.imagenes.size > 0) {
    const anchoFoto = 150;
    const altoFoto = 120;
    const ALTO_TITULO_FOTOS = 20;
    // [MEDIO · M1, revisión del carril] EL GAP DE 16 pt SE MEDÍA DESPUÉS DE
    // DECIDIR, NO ANTES. `cabeEnPaginaActual` comprobaba `y + 20 + alto`, y
    // solo si la rama decía "cabe" se sumaban los 16 pt de separación con la
    // rama `else { y += 16; }` — 16 pt que NUNCA entraban a la comprobación.
    // Con una tabla que terminara en `y` dentro de esa ventana de 16 pt, la
    // decisión decía "cabe" y el dibujo real se salía por abajo: el título
    // quedaba en una página y la imagen —forzada por el chequeo INTERNO del
    // bucle, que sí mide bien— en la siguiente. Antes de F-9 esto era
    // IMPOSIBLE porque el anexo siempre abría hoja nueva; F-9 lo hizo
    // alcanzable al introducir la rama que comparte página.
    //
    // Y falta el RÓTULO DEL SKU bajo la foto (`escribir(sku, x, yFoto + alto +
    // 4)`): sin su alto en la cuenta, el rótulo podía caer en la franja del
    // pie aunque la imagen "cupiera". Se mide con la MISMA fuente/tamaño con
    // que se dibuja, no con un número inventado.
    const ALTO_GAP_ANTES_DEL_ANEXO = 16;
    doc.font('Courier').fontSize(TIPOGRAFIA.pie);
    const altoRotuloFoto = 4 + doc.currentLineHeight() + 1;
    const cabeEnPaginaActual = anexoDeFotosCabe({
      y,
      limiteInferior,
      gapAntesDelAnexo: ALTO_GAP_ANTES_DEL_ANEXO,
      altoTitulo: ALTO_TITULO_FOTOS,
      altoFoto,
      altoRotuloFoto,
    });
    const necesitaPaginaPropia = descargas.imagenes.size > 1 || !cabeEnPaginaActual;

    if (necesitaPaginaPropia) {
      doc.addPage();
      y = doc.page.margins.top;
    } else {
      y += ALTO_GAP_ANTES_DEL_ANEXO;
    }

    doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(TOKENS.tinta);
    let yFoto = y;
    escribir('Fotografías', izquierda, yFoto);
    yFoto += ALTO_TITULO_FOTOS;

    let x = izquierda;

    for (const [sku, bytes] of Array.from(descargas.imagenes.entries())) {
      if (x + anchoFoto > izquierda + anchoUtil) {
        x = izquierda;
        yFoto += altoFoto + 30;
      }
      // La MISMA función que decide arriba, sin gap ni título —ya está
      // parado en el renglón, no entrando a la sección—: la foto Y su
      // rótulo, no solo la foto. Un solo sitio que sabe qué cabe.
      if (!anexoDeFotosCabe({ y: yFoto, limiteInferior, gapAntesDelAnexo: 0, altoTitulo: 0, altoFoto, altoRotuloFoto })) {
        doc.addPage();
        x = izquierda;
        yFoto = doc.page.margins.top;
      }
      try {
        doc.image(bytes, x, yFoto, { fit: [anchoFoto, altoFoto], align: 'center' });
      } catch {
        /* una imagen corrupta no tumba el documento */
      }
      doc.font('Courier').fontSize(TIPOGRAFIA.pie).fillColor(TOKENS.muted);
      escribir(recortarAlAncho(doc, sku, anchoFoto), x, yFoto + altoFoto + 4);
      x += anchoFoto + 18;
    }
    y = yFoto + altoFoto + 30;
  }

  // ---------- Lo que el documento confiesa ----------
  // Las del MODELO (que saben cuáles filas las dispararon) más las que solo
  // existen al renderizar: la geometría de la tabla y lo que pasó al descargar
  // imágenes. Ninguna de estas últimas vuelve al modelo.
  // [2.0.1-B · S-5 · B3] Ya NO incluye `modelo.advertencias`: esas bajaron al pie
  // de la tabla como notas numeradas, con su superindice en cada fila afectada.
  // Repetirlas aqui las diria dos veces en el mismo documento — y la segunda vez
  // sin el numero que las ata a sus filas, que es lo unico que las hace utiles.
  //
  // Lo que queda en esta pagina es lo que NO es del dato sino de ESTA GENERACION:
  // la geometria de la tabla y lo que paso al descargar imagenes. La distincion
  // no es cosmetica — una habla del inventario, la otra del archivo que tienes
  // en la mano.
  const confesiones = avisosDelRender.map((a) => a.texto);
  if (descargas.omitidasPorPresupuesto > 0) {
    confesiones.push(
      `${descargas.omitidasPorPresupuesto} ${descargas.omitidasPorPresupuesto === 1 ? 'fotografía se omitió' : 'fotografías se omitieron'} por el límite de descarga de este documento (${PRESUPUESTO_IMAGENES.maxImagenes} imágenes o ${Math.round(PRESUPUESTO_IMAGENES.maxBytes / 1024 / 1024)} MB).`,
    );
  }
  // [2.0.1-C] UN AGOTAMIENTO DE TIEMPO NO ES UN FALLO DE DESCARGA.
  //
  // La confesión de `fallidas`, justo abajo, habla del BUCKET o la RED: la
  // conexión respondió mal, o no respondió del todo. Esta habla de ESTE
  // GENERADOR: decidió dejar de esperar porque se agotó el tiempo que este
  // documento le puede dedicar a las fotografías — por el timeout de una
  // imagen o por el presupuesto acumulado del bucle. Colapsarla en
  // `fallidas` le atribuiría al bucket una decisión que tomó el propio PDF.
  if (descargas.omitidasPorTiempo > 0) {
    confesiones.push(
      `${descargas.omitidasPorTiempo} ${descargas.omitidasPorTiempo === 1 ? 'fotografía no se descargó' : 'fotografías no se descargaron'} por agotarse el tiempo que este documento le dedica a las imágenes.`,
    );
  }
  if (descargas.fallidas > 0) {
    confesiones.push(
      `${descargas.fallidas} ${descargas.fallidas === 1 ? 'fotografía no se pudo descargar' : 'fotografías no se pudieron descargar'} al generar este documento.`,
    );
  }
  // [2.0.1-C · F-10, corregido tras revisión A1] LA LISTA COMPACTA: SKU +
  // descripción, no solo el motivo.
  //
  // ────────────────────────────────────────────────────────────
  // ⚠ ESTA POBLACIÓN **NO ES** LA MISMA QUE `sin_foto_propia`
  // (`modelo.ts`, `REGLAS_DE_ADVERTENCIA`), Y LA PRIMERA VERSIÓN DE ESTE
  // COMENTARIO LO NEGABA. Decía «sale del MISMO filtro que ya alimentaba la
  // frase de motivos... un solo predicado, no dos que puedan divergir» — y
  // eran DOS, ya divergentes, en la MISMA página: la nota numerada de
  // `sin_foto_propia` cuenta con `fotoDelSku === null` (4 filas en el peor
  // caso) y esta lista, con `capa !== 'sku'` (5: el `.webp` de una fila
  // entra aquí porque el PDF no la puede incrustar, aunque SÍ tenga foto).
  // El cliente veía un renglón que dice «4» y cinco renglones debajo de él.
  //
  // La distinción es real y está documentada en `filasSinImagenEnEsteFormato`
  // (`modelo.ts`): una pregunta por el HECHO del catálogo, agnóstica del
  // renderizador; la otra por si ESTE renderizador terminó pintando algo. Se
  // conserva —no se colapsa a un solo predicado— porque colapsarla a
  // `fotoDelSku === null` dejaría sin explicar, en el papel, por qué esa fila
  // `.webp` también se ve genérica. La relación entre las dos poblaciones se
  // mide y se asevera en `documento.presentacion.test.ts` (describe de F-10),
  // no se afirma aquí sin prueba.
  // ────────────────────────────────────────────────────────────
  const filasSinImagenEnEsteDocumento = filasSinImagenEnEsteFormato(modelo.filas);
  if (filasSinImagenEnEsteDocumento.length > 0) {
    // [S-5 · §5.2] Decía «usan el banner institucional», y era falso: el banner
    // no existe —`bannerMarca` llega siempre `null` y aquí solo se dibuja
    // `capa === 'sku'`—, así que esas partidas no llevan imagen alguna. La frase
    // nueva dice lo que pasa, y además cubre el caso que la anterior no cubría:
    // una partida que SÍ tiene fotografía pero en un formato que este documento
    // no puede incrustar tampoco lleva imagen.
    const motivos = new Set(filasSinImagenEnEsteDocumento.flatMap((f) => f.imagen.motivos.map(motivoLegible)));
    confesiones.push(`Algunas partidas no llevan imagen en este documento porque ${Array.from(motivos).join('; ')}.`);

    // La lista va en su PROPIA confesión (su propio bullet), no pegada a la
    // de motivos: medido antes de escribir esto, combinadas ocupan las 4
    // líneas permitidas por confesión y el párrafo se recortaba con elipsis
    // a la mitad de un SKU — separadas, la de motivos cabe en 2 líneas y la
    // lista en 3, ninguna de las dos toca el tope.
    //
    // TOPE_FILAS_EN_LISTA acota el CONTEO, no solo el ancho de cada renglón:
    // sin él, un proyecto grande —o el fixture de 34 partidas de este mismo
    // archivo, con sus 28 SKU "UBdaXHG" sin foto— produciría una lista de
    // decenas de entradas, que ya no es «compacta» y que además reintroduce
    // en el flujo del PDF los mismos tokens que otra prueba usa para contar
    // filas de la TABLA por posición. Por encima del tope se dice cuántas
    // faltan y se calla el detalle, igual que ya hace la advertencia
    // numerada de `sin_foto_propia` en `modelo.ts`.
    const TOPE_FILAS_EN_LISTA = 12;
    if (filasSinImagenEnEsteDocumento.length <= TOPE_FILAS_EN_LISTA) {
      // La descripción se recorta a un tope de CARACTERES, no de puntos
      // —esto es una lista de identificadores, no una celda tipografiada— y
      // con tres puntos ASCII en vez de la elipsis de `medida.ts`: esa
      // elipsis vive en WinAnsi como un byte fuera del rango que `huella.ts`
      // decodifica limpio en LATIN1 (el mismo problema que ya mordió a la
      // viñeta de esta misma página), y tres puntos lo evitan para un texto
      // que solo necesita ser identificable, no exacto.
      const TOPE_DESCRIPCION_LISTA = 60;
      const descripcionCorta = (s: string) =>
        s.length > TOPE_DESCRIPCION_LISTA ? `${s.slice(0, TOPE_DESCRIPCION_LISTA).trimEnd()}...` : s;
      const listaCompacta = filasSinImagenEnEsteDocumento.map((f) => `${f.sku} (${descripcionCorta(f.descripcion)})`).join('; ');
      confesiones.push(`Partidas sin fotografía en este documento: ${listaCompacta}.`);
    } else {
      confesiones.push(
        `Son ${filasSinImagenEnEsteDocumento.length} partidas sin fotografía en este documento; la lista se omite por ser demasiado larga para citarla aquí.`,
      );
    }
  }

  // ────────────────────────────────────────────────────────────
  // [2.0.1-C · F-9] EL SEGUNDO addPage() INCONDICIONAL — la página con 80 %
  // de blanco que se reportó.
  //
  // Antes: `if (confesiones.length > 0 || modelo.notas) { doc.addPage(); ...
  // }`, sin mirar cuánto quedaba libre en la página que ya traía la tabla.
  //
  // Ahora se MIDE el bloque completo —notas del proyecto + confesiones—
  // ANTES de decidir, envolviendo el texto con las MISMAS líneas que luego
  // se dibujan: no se envuelve dos veces con criterios que puedan divergir,
  // que es justo la fuente del próximo desacuerdo entre «cuánto mide» y
  // «cuánto se dibuja».
  if (confesiones.length > 0 || modelo.notas) {
    // [MEDIO · M2, revisión del carril] EL MISMO HUECO DE 16 pt QUE M1: se
    // medía `y + altoCierre` y el desplazamiento de 16 pt que la rama "cabe"
    // aplica después (`else { y += 16 }`) no entraba en `altoCierre`. Se
    // declara aquí para que la cuenta lo incluya desde el principio, con el
    // mismo nombre que en el anexo de Fotografías — es el mismo defecto, no
    // uno nuevo por bloque.
    const ALTO_GAP_ANTES_DEL_CIERRE = 16;
    let altoCierre = ALTO_GAP_ANTES_DEL_CIERRE;
    let lineasNotas: string[] = [];
    if (modelo.notas) {
      doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo);
      lineasNotas = envolverAlAncho(doc, modelo.notas, anchoUtil, 6);
      altoCierre += 18 + lineasNotas.length * (doc.currentLineHeight() + 1) + 12;
    }
    const lineasPorConfesion: string[][] = [];
    if (confesiones.length > 0) {
      doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo);
      altoCierre += 18;
      for (const confesion of confesiones) {
        const lineas = envolverAlAncho(doc, `•  ${confesion}`, anchoUtil, 4);
        lineasPorConfesion.push(lineas);
        altoCierre += lineas.length * (doc.currentLineHeight() + 1) + 3;
      }
    }

    if (y + altoCierre > limiteInferior) {
      doc.addPage();
      y = doc.page.margins.top;
    } else {
      y += ALTO_GAP_ANTES_DEL_CIERRE;
    }
    let yCierre = y;

    if (modelo.notas) {
      doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(TOKENS.tinta);
      escribir('Notas del proyecto', izquierda, yCierre);
      yCierre += 18;
      doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo).fillColor(TOKENS.tinta2);
      for (const linea of lineasNotas) {
        escribir(linea, izquierda, yCierre);
        yCierre += doc.currentLineHeight() + 1;
      }
      yCierre += 12;
    }

    if (confesiones.length > 0) {
      doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.subtitulo).fillColor(TOKENS.warn);
      escribir('Lo que este documento no puede afirmar', izquierda, yCierre);
      yCierre += 18;
      doc.font('Helvetica').fontSize(TIPOGRAFIA.cuerpo).fillColor(TOKENS.tinta);
      confesiones.forEach((_confesion, i) => {
        for (const linea of lineasPorConfesion[i]) {
          escribir(linea, izquierda, yCierre);
          yCierre += doc.currentLineHeight() + 1;
        }
        yCierre += 3;
      });
    }
    y = yCierre;
  }

  // ---------- LOS DOS ESPACIOS DE ACEPTACIÓN ----------
  //
  // [2.0.1-B · S-5 · B4] SIEMPRE, no solo cuando hay anexo.
  //
  // La §6 los pone «al pie de la hoja 2», y la hoja 2 solo existe si alguna
  // partida tiene fotografia propia. **Un espacio de firma que aparece solo
  // cuando por casualidad hay fotos es un espacio de firma con el que nadie
  // puede contar** — y este documento se imprime PARA firmarse. Van al final
  // del documento, con salto de pagina si no caben.
  //
  // Dos y no uno: quien entrega y quien recibe. Un solo espacio convierte una
  // aceptacion en un acuse unilateral.
  {
    const ALTO_ACEPTACION = 78;
    if (y + ALTO_ACEPTACION > limiteInferior) {
      doc.addPage();
      y = doc.page.margins.top;
    } else {
      y += 24;
    }

    doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.muted);
    escribir(MARCADOR_ACEPTACION, izquierda, y);
    y += doc.currentLineHeight() + 14;

    const anchoFirma = (anchoUtil - 40) / 2;
    ESPACIOS_DE_ACEPTACION.forEach((rol, i) => {
      const x = izquierda + (anchoFirma + 40) * i;
      doc.save();
      doc.moveTo(x, y + 26).lineTo(x + anchoFirma, y + 26).lineWidth(0.75).stroke(TOKENS.borde);
      doc.restore();
      doc.font('Helvetica-Bold').fontSize(TIPOGRAFIA.etiqueta).fillColor(TOKENS.navy);
      escribir(rol, x, y + 31);
      doc.font('Helvetica').fontSize(TIPOGRAFIA.nota).fillColor(TOKENS.muted);
      escribir('Nombre, firma y fecha', x, y + 31 + doc.currentLineHeight() + 3);
    });
  }

  // ---------- Pie en todas las páginas ----------
  //
  // SIN `width`, que es lo que añadía una página por pie. El centrado se
  // calcula a mano con `widthOfString`: entrar a la maquinaria de envoltura
  // solo para centrar costaba duplicar el documento.
  doc.font('Helvetica').fontSize(TIPOGRAFIA.pie).fillColor(TOKENS.muted);
  const rango = doc.bufferedPageRange();
  for (let i = rango.start; i < rango.start + rango.count; i++) {
    doc.switchToPage(i);
    // [D-1 · decisión de producto] Adelgazado: «por {firmante} · {entorno}» salió
    // del pie porque F-7 ya los dice una vez, en grande, en la rejilla de
    // identidad — imprimirlos en TODAS las páginas los duplicaba. El pie
    // sigue diciendo folio, cuándo se generó y la paginación; quién lo firmó
    // y desde qué entorno se leen en la primera página, no en cada una.
    const texto = `${modelo.folio} · generado el ${modelo.generado} · página ${i - rango.start + 1} de ${rango.count}`;
    const recortado = recortarAlAncho(doc, texto, anchoUtil);
    doc.text(
      recortado,
      izquierda + (anchoUtil - doc.widthOfString(recortado)) / 2,
      doc.page.height - doc.page.margins.bottom + 12,
      { lineBreak: false },
    );
  }

  doc.end();
  return terminado;
}
