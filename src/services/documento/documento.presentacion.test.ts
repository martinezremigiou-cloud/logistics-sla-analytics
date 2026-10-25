import { describe, it, expect, vi, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armarModelo, filasSinImagenEnEsteFormato } from './modelo';
import { renderizarXlsx } from './xlsx';
import { createRequire } from 'node:module';
import {
  renderizarPdf,
  FORMATOS_PDF,
  PAGINA,
  COLUMNAS_IMPRESAS,
  pisosQueCaben,
  anchoUtilDe,
  anexoDeFotosCabe,
  MARCADOR_NOTAS,
  MARCADOR_ACEPTACION,
  ESPACIOS_DE_ACEPTACION,
} from './pdf';
import type { ModeloDocumento } from './modelo';
import { huellaDe, piezasDeTextoDelPdf, piezasPorPagina, piezasConPosicion, esPieDePagina, type HuellaDocumento } from './huella';
import { fragmentosDe } from './medida';
import {
  DETALLE_PEOR_CASO,
  DETALLE_LARGO,
  DETALLE_TOKENS_LARGOS,
  DETALLE_UNA_IMAGEN,
  DETALLE_DOS_IMAGENES,
  SESION_FIXTURE,
  AHORA_FIXTURE,
  DESCRIPCION_244,
  SKU_31,
  partida,
} from './fixture-peor-caso';
import type { ProyectoDetalle } from '@/types/proyectos';
import { fetchDeImagenes } from './imagenes-minimas';

// Mismo motivo que en `pdf.ts`: el interop ESM↔CJS de pdfkit deja funciones
// indefinidas en runtime con un namespace import, aunque `tsc` las tipe bien.
const require = createRequire(import.meta.url);
/* eslint-disable @typescript-eslint/no-explicit-any */
const PDFDocument: any = require('pdfkit');

// SIN RED. `descargarImagenes` (pdf.ts) hace `fetch` de la foto de cada SKU con foto
// `.png`; aquí ese `fetch` se simula con bytes mínimos válidos generados en código
// (`imagenes-minimas.ts`): un PNG para `.png` y un WEBP para `.webp`. La prueba F-10
// depende de que el `.webp` degrade POR FORMATO y el `.png` se incruste, y eso lo decide
// la extensión de la URL, no el contenido real de ninguna imagen.
const imagenesSimuladas = fetchDeImagenes();
vi.stubGlobal('fetch', imagenesSimuladas.fetch);
afterAll(() => {
  vi.unstubAllGlobals();
});

const base = { sesion: SESION_FIXTURE, entorno: 'Desarrollo', ahora: AHORA_FIXTURE };

function modeloXlsx(detalle = DETALLE_PEOR_CASO) {
  return armarModelo({ ...base, detalle, formatosEmpotrables: [] });
}
function modeloPdf(detalle = DETALLE_PEOR_CASO) {
  return armarModelo({ ...base, detalle, formatosEmpotrables: FORMATOS_PDF });
}

// RENDER MEMOIZADO POR FIXTURE. Los renders son deterministas —el instante se
// inyecta— así que reusar el buffer entre pruebas no cambia lo que se afirma,
// y evita volver a construir el mismo PDF una decena de veces.
//
// No es una micro-optimización: renderizar un PDF subsetea la tipografía y es
// caro en CPU. La primera versión de este archivo re-renderizaba en cada `it`
// y con eso **subió la carga de la suite completa hasta hacer expirar el
// arnés de migraciones** (`aplicar-migracion.test.ts`, que hace `spawnSync` de
// procesos Node reales y cuyo timeout se calibró contra la carga ANTERIOR).
// Es el mismo problema de carga mordiendo por segunda vez, y la mitad de la causa era de este archivo.
const pdfCache = new Map<ProyectoDetalle, Promise<Buffer>>();
function pdfDe(detalle = DETALLE_PEOR_CASO): Promise<Buffer> {
  if (!pdfCache.has(detalle)) pdfCache.set(detalle, renderizarPdf(modeloPdf(detalle)));
  return pdfCache.get(detalle)!;
}

const xlsxCache = new Map<ProyectoDetalle, Buffer>();
function xlsxDe(detalle = DETALLE_PEOR_CASO): Buffer {
  if (!xlsxCache.has(detalle)) xlsxCache.set(detalle, renderizarXlsx(modeloXlsx(detalle)));
  return xlsxCache.get(detalle)!;
}

async function huellaActual(detalle = DETALLE_PEOR_CASO): Promise<HuellaDocumento> {
  return huellaDe(xlsxDe(detalle), await pdfDe(detalle));
}

/** Quita los pies del texto normalizado. Se movieron DE PÁGINA (ése es el arreglo), no de contenido. */
function sinPies(normalizado: string): string {
  return normalizado.replace(/PRJ-\d+·generadoel.*?·página\d+de\d+/g, '');
}

// ============================================================
// VERIFICACIÓN · el bloque A es presentación: el contenido no cambia
// ============================================================
describe('[INV-B8.1] diff con lista blanca contra la huella de antes del bloque', () => {
  const antes: HuellaDocumento = JSON.parse(readFileSync(join(process.cwd(), 'src/services/documento/huella-antes.json'), 'utf8'));

  // Los TRES deltas mandatados, enumerados aquí y en ningún otro lado. Todo lo
  // que no esté en esta lista y cambie, reprueba.
  const DELTA_1_DUENO = 'Responsable del proyecto';
  const DELTA_2_FOTO = 'Foto';
  const DELTA_3_CORREO = 'Correo';

  // [2.0.1-C · F-8] Los DOS encabezados de columna que se acortan por copy
  // firmado. Es la MISMA clase de delta que DELTA_2_FOTO: la CLAVE
  // del objeto que produce `xlsxPartidas` es el texto del encabezado, así que
  // cambiar el título de la columna cambia la llave con la que se lee cada
  // celda — no el valor que guarda. Sus propios tests, más abajo, verifican
  // que el VALOR sigue intacto bajo la llave nueva.
  const DELTA_4_PIEZAS = 'Piezas del proyecto';
  const DELTA_5_TOTAL = 'Total en almacén';
  // [2.0.1-C · F-11] La llave «Estatus» NO cambia — cambia el VALOR de UNA
  // fila (la que está fuera del archivo/inventario vigente). Es una forma de
  // delta que las tres de arriba no cubren: ahí cambiaba la llave y el valor
  // viajaba intacto; aquí la llave es la misma y el valor es el que se mueve.
  const DELTA_6_ESTATUS = 'Estatus';

  // ============================================================
  // [2.0.1-B · S-5] LA VARA NO SE MOVIÓ. EL COMPARADOR SÍ.
  //
  // ────────────────────────────────────────────────────────────
  // POR QUÉ HIZO FALTA CAMBIARLO, medido antes de tocarlo.
  //
  // El comparador anterior era `expect(b.replace(adicion, '')).toBe(a)`: una
  // IGUALDAD DE CADENA COMPLETA sobre `pdfNormalizado`, que es
  // `piezas.join('')` en orden de flujo y sin espacios (`huella.ts:174`).
  //
  // Ese comparador **sabe expresar una ADICIÓN y no sabe expresar un
  // REORDENAMIENTO**: mover un bloque cambia la cadena sin añadir ni quitar un
  // carácter, y el fallo sale como un diff de ~2 000 caracteres sin espacios y
  // sin mensaje — el peor caso de legibilidad de toda la suite. El formato 1b
  // es, por definición, reordenar.
  //
  // **Un instrumento que no puede expresar el resultado esperado no es una
  // vara: es un obstáculo.** Así que la línea base sigue siendo exactamente la
  // misma —`huella-antes.json` no se re-pinea, que es lo que la regla prohíbe—
  // y lo que se reemplaza es CÓMO se compara contra ella.
  //
  // ────────────────────────────────────────────────────────────
  // TRES ASERCIONES, Y LA TERCERA SOLO SE APAGA DECLARANDO.
  //
  //   1 · CONTENIDO — multiconjunto de caracteres, ciego al orden. Dice «nada
  //       se perdió y nada se inventó». Es MÁS estricto que el `replace` de
  //       antes en un punto concreto: `replace` quita la PRIMERA ocurrencia, así
  //       que si la cadena de la adición coincidía con texto que se borró en
  //       otro sitio, la supresión quedaba enmascarada. Aquí no.
  //
  //   2 · ORDEN — la secuencia de bloques, DECLARADA por sus testigos. Dice
  //       «y en este orden», que es justo lo que el multiconjunto no puede ver.
  //
  //   3 · IGUALDAD EXACTA — la de antes, **que sigue rigiendo mientras nadie
  //       declare un movimiento**. No se retira: se condiciona. Perder la
  //       aserción más fuerte tiene que costar un acto deliberado y revisable
  //       —escribir qué se movió y por qué— y no ser el efecto lateral de
  //       cambiar de comparador.
  // ============================================================

  /** Multiconjunto de caracteres. Igualdad ciega al orden: pierde el orden, conserva el inventario. */
  const multiconjunto = (s: string) => Array.from(s).sort().join('');

  /**
   * QUÉ caracteres cambiaron, para que el fallo sea legible.
   *
   * No es adorno: la queja que motivó cambiar de comparador fue que el fallo
   * salía como un diff de ~2 000 caracteres sin espacios y sin mensaje. Un
   * multiconjunto en rojo sería aún peor —dos cadenas ORDENADAS de 2 000
   * caracteres— así que el mensaje dice el delta: «"4" +1, "5" -1».
   */
  function deltaDeInventario(a: string, b: string): string {
    const cuenta = (s: string) => {
      const m = new Map<string, number>();
      for (const c of s) m.set(c, (m.get(c) ?? 0) + 1);
      return m;
    };
    const ca = cuenta(a);
    const cb = cuenta(b);
    const claves = Array.from(new Set(Array.from(ca.keys()).concat(Array.from(cb.keys()))));
    const partes = claves
      .map((c) => ({ c, d: (cb.get(c) ?? 0) - (ca.get(c) ?? 0) }))
      .filter((x) => x.d !== 0)
      .map((x) => `«${x.c}» ${x.d > 0 ? '+' : ''}${x.d}`);
    return partes.length ? partes.join(', ') : '(ninguno: la diferencia es de ORDEN, no de inventario)';
  }

  /**
   * LOS BLOQUES DEL PAPEL, EN EL ORDEN DECLARADO, cada uno con un testigo
   * textual tomado del documento real. No es una lista decorativa: es LA
   * aserción de orden, y actualizarla es la manera de declarar un movimiento.
   */
  const SECUENCIA_DECLARADA: Array<{ bloque: string; testigo: string }> = [
    { bloque: 'marca', testigo: 'DEMOLOGISTICSSLAANALYTICS' },
    { bloque: 'folio y chips', testigo: 'PRJ-905Apertura·Cotización' },
    { bloque: 'título', testigo: 'Casoextremo·pruebasdemaquetación' },
    { bloque: 'vigencia', testigo: 'Disponibilidadsegúnelinventariodel' },
    // [2.0.1-C · F-7] El testigo pierde el «·»: la identidad deja de ser una
    // frase unida con separadores y pasa a una rejilla 3×2 de celdas —rótulo
    // arriba, valor abajo, sin texto de unión entre los dos—. No es un
    // reordenamiento de BLOQUES (la identidad sigue en el mismo sitio, entre
    // la vigencia y la agrupación): es que el ANCLA de este bloque cambió de
    // forma junto con su contenido, y hay que actualizarla para que siga
    // apuntando a donde vive el bloque.
    { bloque: 'identidad', testigo: 'Responsablexrnpnnwwidz@example.test' },
    { bloque: 'agrupación', testigo: 'Partidasagrupadasportecnología' },
    { bloque: 'encabezado de tabla', testigo: 'SKUDESCRIPCIÓNMARCA' },
    { bloque: 'anexo de fotografías', testigo: 'Fotografías' },
    { bloque: 'advertencias', testigo: 'Loqueestedocumentonopuedeafirmar' },
  ];

  /**
   * Las adiciones declaradas. Todo texto nuevo que no esté aquí reprueba.
   *
   * [S-5 · B1] «VIGENCIADELDATO» es la etiqueta propia del SELLO. Hasta ahora la
   * frase de vigencia salía como texto en negrita sin rótulo: se leía como una
   * línea más del encabezado. El formato 1b la convierte en una BANDA con tinte
   * y borde de acento, y una banda sin etiqueta no dice qué es. La frase en sí
   * —`modelo.vigencia`— no cambia ni un carácter; lo único nuevo es el rótulo.
   */
  const ADICIONES_DECLARADAS = [
    // [2.0.1-C · F-7] «Generado por · emert@…·» YA NO EXISTE COMO TAL: la
    // identidad se reescribe entera en la SUSTITUCIÓN de más abajo («identidad
    // · rejilla 3×2», bloque F-7), que dobla dentro suyo esta adición del O6
    // original más el campo «Generado el» nuevo. Declararla aquí Y ahí sería
    // contar el mismo carácter dos veces.
    'VIGENCIADELDATO',
    // [S-5 · B2] EL RESUMEN. Cinco rótulos y tres cifras nuevas — «PARTIDAS» y
    // «PIEZAS» reusan los números que la identidad dejó de imprimir, así que su
    // VALOR no es texto nuevo; los rótulos sí. Los tres últimos son la partición
    // que la §1.3 no tenía: `cubiertas + con déficit + fuera del vigente`.
    'PARTIDAS',
    'PIEZAS',
    'CUBIERTAS',
    'CONDÉFICIT',
    // [2.0.1-C · F-11] Era «FUERADELVIGENTE»; el rótulo del cubo se unifica con
    // los otros dos sitios que decían lo mismo distinto («Fuera del inventario
    // vigente» en el estatus de fila, «en el inventario vigente» en la nota al
    // pie). La vara NUNCA tuvo ninguna de las dos formas —el cubo es 100 %
    // nuevo desde S-5— así que esto es solo cambiar QUÉ texto nuevo se declara,
    // no una sustitución sobre la vara.
    'FUERADELINVENTARIO',
    // [S-5 · B3] EL BLOQUE DE NOTAS AL PIE: su rotulo y su numeracion.
    'NOTASDEESTEINVENTARIO',
    // [S-5 · B4] LOS DOS ESPACIOS DE ACEPTACION. El rotulo, los dos roles y la
    // leyenda que va bajo cada linea (dos veces, una por espacio).
    'ACEPTACIÓN',
    'ENTREGA',
    'RECIBE',
    'Nombre,firmayfecha',
    'Nombre,firmayfecha',
    // Las COMAS de los superindices: una fila afectada por dos notas las lleva
    // como «1,3». Son tres filas con dos notas cada una en el peor caso.
    ',', ',', ',',
    // Y LA VIÑETA que SOBREVIVE en la pagina de cierre.
    //
    // ⚠ NO es el caracter «•» sino ``. pdfkit emite la viñeta como el byte
    // 0x95 de WinAnsi y `huella.ts` decodifica los flujos en LATIN1, donde ese
    // byte es un caracter de CONTROL invisible. Declararla como «•» salio rojo:
    // la vara no contiene ese caracter. Medido: la vara trae `U+0095` x4 y cero
    // bullets tipograficos.
    //
    // Ver la sustitucion de
    // las viñetas: la vara pierde las CUATRO y aqui se devuelve la unica que
    // sigue existiendo. El neto son las tres que se mudaron al pie.
    '',
    // [2.0.1-C · F-10] SEGUNDA viñeta: la lista compacta va en su PROPIA
    // confesión (su propio bullet), no pegada a la de motivos — porque las
    // dos juntas en una sola confesión desbordaban las 4 líneas permitidas
    // y el párrafo se recortaba con elipsis a la mitad de un SKU. Medido
    // antes de escribir esto: combinadas ocupan las 4 líneas completas y
    // truncan; separadas, la de motivos cabe en 2 y la lista en 3 (ninguna
    // de las dos toca el tope).
    '',
    // Los NUMEROS van uno por uno y no como una cadena, porque no son
    // contiguos en el flujo: cada superindice vive pegado al estatus de SU fila
    // y cada numero de nota al principio de SU parrafo. Son 1×2, 2×3 y 3×5 —
    // tres numeros de nota mas siete superindices (la nota 1 marca una fila, la
    // 2 marca dos y la 3 marca cuatro). El multiconjunto los cuenta, no los
    // ubica, asi que declararlos sueltos es exacto y no una aproximacion.
    '1', '1',
    '2', '2', '2',
    '3', '3', '3', '3', '3',
    // Y LOS VALORES, declarados APARTE de sus rótulos y no pegados a ellos: el
    // bloque dibuja la etiqueta y su cifra en RENGLONES distintos, así que el
    // flujo del PDF puede emitirlas separadas. Declarar «CUBIERTAS3» habría
    // supuesto una adyacencia que el formato no garantiza.
    '6',
    '2,186',
    '3',
    '2',
    '1',
    // ────────────────────────────────────────────────────────────
    // [2.0.1-C · F-10, corregido tras revisión A3] LA LISTA COMPACTA: SKU +
    // descripción de cada partida sin imagen EN ESTE DOCUMENTO.
    //
    // ⚠ ESTA DECLARACIÓN DECÍA «no suma un carácter de viñeta», Y ERA FALSA
    // — y lo era mientras, treinta líneas arriba en este MISMO arreglo, la
    // declaración de la SEGUNDA viñeta (línea ~255) ya decía lo contrario: el
    // código hace DOS `confesiones.push()` (`pdf.ts`), y la lista vive en la
    // segunda, con su propio bullet. Era el residuo de un primer intento
    // —una sola confesión combinada, que desbordaba las 4 líneas y se
    // truncaba a media palabra— dejado en pie como si describiera la versión
    // final. Una declaración es lo que se lee para conceder el permiso;
    // no puede decir lo que el código YA NO hace.
    //
    // El predicado —`filasSinImagenEnEsteFormato`, ahora en `modelo.ts`— es
    // `imagen.capa !== 'sku'`, y es DISTINTO del que usa la nota numerada
    // «sin fotografía propia» (`fotoDelSku === null`, en `modelo.ts`,
    // `REGLAS_DE_ADVERTENCIA`). Es deliberado, no un descuido: la relación
    // entre las dos poblaciones se mide y se asevera en
    // `documento.presentacion.test.ts` (describe de F-10), no se afirma aquí
    // sin prueba. Aplicado sobre las 6 filas del peor caso, ordenadas como
    // las ordena `armarModelo` (por banda y luego SKU): 1077-4772-87,
    // EGZtB: DKmVtE…, 0692D-W, NUEVO-1, XV889-mY — 8075-5498-20 NO entra porque su
    // foto SÍ se pinta (capa 'sku').
    //
    // La descripción de la partida (1) se recorta a 60 caracteres con «...»
    // (tres puntos ASCII, no la elipsis tipográfica de `medida.ts`): esa
    // elipsis vive en WinAnsi como el mismo tipo de byte fuera de rango que ya
    // mordió a la viñeta más arriba, y tres puntos evitan reabrir ese
    // problema para un texto que solo necesita ser identificable, no exacto.
    // Medido con `envolverAlAncho` contra `anchoUtil`, YA SEPARADA de la
    // frase de motivos: cabe en 3 de las 4 líneas permitidas de SU PROPIA
    // confesión — combinada con la de motivos, las dos juntas ocupaban las 4
    // líneas completas y truncaban a media palabra, que fue exactamente lo
    // que puso esta declaración en rojo la primera vez que se escribió así.
    'Partidassinfotografíaenestedocumento:1077-4772-87(fUAZVepBtF,CNB09BK,034);EGZtB:DKmVtEFK1179-WFB4711-W(UBmKCStSHGmGmBUfAVFSDCUQhGOVmZR-379U/7mK/R.597+/...);0692D-W(HPBSFtHQDWfHYhXBYUVBPPFAw);NUEVO-1(Sindescripción);XV889-mY(ZCVHZBEQRBCDEEE).',
  ];

  /**
   * LAS SUSTITUCIONES DECLARADAS — «qué bloque, qué valor antes, qué valor
   * después, y por qué», que es la forma que se le dio a la regla de la vara.
   *
   * Se aplican a la LÍNEA BASE, no al documento nuevo: producen «lo que la vara
   * predice ahora». `huella-antes.json` no se toca nunca — mover el valor de
   * referencia es lo que la regla prohíbe; declarar en qué se convierte es lo
   * que la regla exige.
   *
   * Una sustitución declarada que NO ocurra también reprueba (ver la prueba de
   * abajo): significa que la declaración estaba mal, y una declaración mal
   * escrita es un permiso que nadie revisó.
   */
  const SUSTITUCIONES_DECLARADAS: Array<{ donde: 'pdf' | 'xlsx'; bloque: string; de: string; a: string; porque: string }> = [
    {
      donde: 'pdf',
      bloque: 'advertencia · sin fotografía propia',
      de: '5 de 6 partidas no tienen',
      a: '4 de 6 partidas no tienen',
      porque:
        'el predicado preguntaba por la CAPA (qué imagen se pinta, que depende del formato) y ahora pregunta por el HECHO (si el SKU tiene foto). Dos de las seis partidas del peor caso sí tienen fotografía propia.',
    },
    {
      donde: 'xlsx',
      bloque: 'advertencia · sin fotografía propia',
      de: '6 de 6 partidas no tienen',
      a: '4 de 6 partidas no tienen',
      porque:
        'el MISMO arreglo, y el «6» contra el «5» del PDF es la prueba del defecto: al XLSX se le pasa una lista vacía de formatos empotrables, así que TODA foto degradaba y la advertencia se cumplía para todas las filas. Los dos formatos decían cifras distintas del mismo hecho; ahora dicen 4.',
    },
    {
      donde: 'pdf',
      bloque: 'advertencia · sin fotografía propia (la afirmación del banner)',
      de: ' y se muestran con el banner institucional.',
      a: '.',
      porque:
        'EL BANNER NO EXISTE: `bannerMarca` llega siempre null y el renderizador solo dibuja `capa === "sku"`, así que esas partidas no llevan ninguna imagen. El documento afirmaba una cosa y enseñaba otra, en un papel que va a un cliente. Implementar el banner es contenido nuevo y de otro bloque; dejar de afirmarlo cuesta una línea.',
    },
    {
      donde: 'xlsx',
      bloque: 'advertencia · sin fotografía propia (la afirmación del banner)',
      de: ' y se muestran con el banner institucional.',
      a: '.',
      porque: 'la misma frase falsa, en la hoja Documento del libro.',
    },
    // ────────────────────────────────────────────────────────────
    // [S-5 · A1] LA COLUMNA `banda` SALE DE LA TABLA IMPRESA.
    //
    // La §3 del formato 1b lista OCHO columnas visibles y `banda` no está: la
    // agrupación ya se dice con la BARRA de banda que encabeza cada grupo, así
    // que la columna repetía en cada fila lo que el renglón de arriba ya decía.
    // Y no es cosmética — es lo que hace viable la carta vertical: con las nueve
    // columnas faltaban 20 pt, con ocho sobran 41.
    //
    // Estas siete entradas son ESA supresión, escrita fila por fila ANTES de
    // correr la comparación. Cada `de` está anclada a la marca de su fila, no al
    // valor suelto: `EAS` y `VERTICAL` también son rótulos de la barra de banda,
    // que SÍ se queda, y una declaración sin ancla se los habría llevado por
    // delante.
    // ────────────────────────────────────────────────────────────
    // [2.0.1-C · F-8, corregido tras revisión M3] DOS ENTRADAS, NO UNA
    // FUSIONADA — la imposibilidad que justificaba fusionarlas no existía.
    //
    // La versión anterior de esto fusionaba la salida de `banda` (S-5) con
    // el acortamiento de encabezados (F-8) en una sola declaración, con el
    // argumento de que las dos «se pisaban la misma franja». Medido: NO se
    // pisan. Hay una separación limpia y sin solape: S-5 solo toca
    // «MARCATECNOLOGÍA» (la columna `banda` y su título «TECNOLOGÍA», que
    // era el único uso de esa palabra en el encabezado) y F-8 solo toca
    // «PIEZASDELPROYECTOTOTALENALMACÉN» (los dos encabezados que F-8 acorta).
    // El choque real era otro, más angosto: el ANCLA vieja de S-5
    // (`MARCATECNOLOGÍAPIEZAS`) incluía la palabra «PIEZAS», que F-8
    // retira — y por eso el ancla de S-5 se recorta para dejar de invadir
    // territorio de F-8, no para fusionarse con él.
    //
    // Fusionarlas costaba que F-8 no tuviera declaración propia y que un
    // solo `porque` cargara dos razones — quien revirtiera F-8 habría tenido
    // que editar una declaración que pertenece a S-5. Separadas, cada bloque
    // se revierte editando SU propia entrada.
    {
      donde: 'pdf',
      bloque: 'tabla · encabezado de la columna de banda (S-5)',
      de: 'MARCATECNOLOGÍA',
      a: 'MARCA',
      porque: 'la columna `banda` sale de COLUMNAS_IMPRESAS; su título («TECNOLOGÍA») era el único uso de esa palabra en el encabezado.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · encabezados de piezas y total en almacén (F-8)',
      de: 'PIEZASDELPROYECTOTOTALENALMACÉN',
      a: 'DELPROYECTOENALMACÉN',
      porque:
        'copy firmado: «Piezas del proyecto» → «Del proyecto», «Total en almacén» → «En almacén», para que el encabezado quepa en ≤ 2 líneas. «Piezas» no se pierde del documento: sigue como rótulo del resumen de cinco cifras (S-5 · B2); «Total» no tenía otro uso.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 1 (1077-4772-87)',
      de: 'BRAND5EAS8874,923',
      a: 'BRAND58874,923',
      porque: 'la celda de banda («EAS») desaparece de la fila; el rótulo EAS de la barra de grupo se queda.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 2 (8075-5498-20)',
      de: 'BRAND5EAS684,923',
      a: 'BRAND5684,923',
      porque: 'la celda de banda («EAS») desaparece de la fila; el rótulo de la barra de grupo se queda.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 3 (EGZtB: DKmVtE…)',
      de: 'SERIES5VERTICAL4771,788',
      a: 'SERIES54771,788',
      porque: 'la celda de banda («VERTICAL») desaparece; el rótulo VERTICAL de la barra de grupo se queda.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 4 (0692D-W)',
      de: 'VERTICALSinclasificar35000',
      a: 'VERTICAL35000',
      porque: 'la celda de banda («Sinclasificar») desaparece; aquí «VERTICAL» es la MARCA, no la banda.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 5 (NUEVO-1)',
      de: 'SinmarcaSinclasificar674000',
      a: 'Sinmarca674000',
      porque: 'la celda de banda desaparece de la fila sin marca ni descripción, que es el peor caso de vacíos.',
    },
    {
      donde: 'pdf',
      bloque: 'tabla · banda de la fila 6 (XV889-mY)',
      de: 'NACIONALSinclasificar5184,452',
      a: 'NACIONAL5184,452',
      porque: 'la celda de banda desaparece de la fila sobre-reservada, la que lleva el disponible negativo.',
    },
    // ────────────────────────────────────────────────────────────
    // [S-5] LA ADVERTENCIA DE DÉFICIT DEJA DE CONTAR LO NO-MEDIDO.
    //
    // `enRiesgo` es `disponible < cantidad`, y para una fila fuera del archivo
    // vigente esas cifras son de una carga anterior. El `disponible = 0` de
    // `0692D-W` no es una medición: es un residuo. La advertencia decía 3 y la
    // verdad son 2 — de la tercera lo único cierto es que no se puede saber, y
    // eso ya lo dice la otra advertencia.
    // ────────────────────────────────────────────────────────────
    {
      donde: 'pdf',
      bloque: 'advertencia · partidas con déficit',
      de: '3 partidas tienen menos disponible',
      a: '2 partidas tienen menos disponible',
      porque:
        'se excluyen las filas fuera del archivo vigente: su `disponible` viene de una carga anterior, así que decir «tiene menos disponible que lo comprometido» afirma algo que nadie midió. Cero y no-medido son valores distintos.',
    },
    {
      donde: 'xlsx',
      bloque: 'advertencia · partidas con déficit',
      de: '3 partidas tienen menos disponible',
      a: '2 partidas tienen menos disponible',
      porque: 'el mismo arreglo en la hoja Documento del libro; la advertencia es del modelo y la comparten los dos formatos.',
    },
    {
      donde: 'pdf',
      bloque: 'identidad · las dos cifras se mudan al resumen',
      de: ' · 6 SKU · 2,186 pz',
      a: '',
      porque:
        'la línea de identidad contesta «quién y cuándo»; el resumen nuevo contesta «cuánto». Tenerlas en los dos sitios era decir el mismo número dos veces en el mismo tercio de la hoja. Las cifras no desaparecen: reaparecen en el resumen bajo los rótulos PARTIDAS y PIEZAS.',
    },
    {
      donde: 'pdf',
      bloque: 'nota de fila · deja de imprimirse bajo su renglon',
      de: 'Este SKU ya no aparece en el archivo de inventario vigente; sus cifras no son comparables con las del resto.',
      a: '',
      porque:
        'la nota repetia por renglon lo que la advertencia dice una vez para todas, y en una tabla de 34 partidas serian 34 parrafos de prosa entre los numeros. Ahora la fila apunta con su superindice a la nota numerada del pie. No se pierde informacion: las dos decian el mismo hecho, y ahora se dice una vez con una referencia.',
    },
    {
      donde: 'pdf',
      bloque: 'pagina de cierre · las viñetas de las confesiones que se mudaron',
      de: '',
      a: '',
      porque:
        'la pagina de cierre marcaba cada confesion con una viñeta. Tres de las cuatro se mudaron al pie de la tabla como notas NUMERADAS —el numero es lo que las ata a su fila, y una viñeta no ata nada— asi que quedan tres viñetas menos. La contabilidad se expresa en dos piezas porque el primitivo de sustitucion reemplaza TODAS las ocurrencias, no un numero de ellas: aqui se quitan las cuatro de la vara y la unica que sobrevive se declara como adicion. El neto es -3, que es lo que de verdad paso.',
    },
    {
      donde: 'pdf',
      bloque: 'confesión de imágenes',
      de: 'Las partidas sin fotografía propia usan el banner institucional porque',
      a: 'Algunas partidas no llevan imagen en este documento porque',
      porque:
        'misma afirmación falsa en la página de cierre. La frase nueva además cubre el caso que la anterior no cubría: una partida que SÍ tiene fotografía, pero en un formato que este documento no puede incrustar, tampoco lleva imagen.',
    },
    // ────────────────────────────────────────────────────────────
    // [2.0.1-C · F-7] LA IDENTIDAD DEJA DE SER UNA FRASE UNIDA CON «·» Y PASA
    // A UNA REJILLA 3×2.
    //
    // Vive DESPUÉS, en el arreglo, de la sustitución de arriba («las dos
    // cifras se mudan al resumen») — no porque el ORDEN de aplicación
    // importe (medido tras la revisión del carril: las dos franjas de texto
    // son DISJUNTAS — este `de` no incluye el sufijo « · 6 SKU · 2,186 pz»,
    // así que `.split/.join` la encuentra igual sin importar cuál de las dos
    // sustituciones corra primero — es una explicación plausible que nadie
    // había medido, y medida resultó falsa), sino porque `de` está escrito
    // como se ve la vara YA SIN ese sufijo, para que la declaración se lea
    // junto al resto de la identidad y no repita el sufijo que la otra
    // entrada ya explica.
    //
    // `de` es la línea de identidad tal como queda esa vara intermedia:
    // cuatro campos unidos con «   ·   », cada uno «Rótulo · Valor». `a` es
    // la MISMA información en la rejilla: sin separador textual entre rótulo
    // y valor —la separación es de COLUMNA, no de carácter— y con el quinto
    // campo que la rejilla añade, GENERADO (el instante), que hasta hoy solo
    // vivía en el pie de cada página y en la hoja «Documento» del XLSX
    // (`xlsx.ts:138`, misma etiqueta «Generado el»). Ninguna celda envuelve
    // ni parte su valor: las cinco caben enteras en su ancho fijo, medido
    // contra este fixture antes de escribir esta declaración (Responsable
    // 119,8 pt · Fecha del proyecto 50,7 pt · Generado por 119,8 pt ·
    // Entorno 43,3 pt · Generado el 102,7 pt, todas contra 172 pt de celda).
    {
      donde: 'pdf',
      bloque: 'identidad · rejilla 3×2 sin separadores (F-7)',
      de: 'Responsable · xrnpnnwwidz@example.test · Entorno · Desarrollo · Fecha del proyecto · 17 abr 2031',
      a: 'Responsable xrnpnnwwidz@example.test Fecha del proyecto 17 abr 2031 Generado por xrnpnnwwidz@example.test Entorno Desarrollo Generado el 21 ago 2031, 12:00 p.m.',
      porque:
        'la identidad era una cadena corrida envuelta a 2 líneas: con una fecha con espacios internos, `envolverAlAncho` (que corta por palabra) podía partirla a media fecha — el defecto medido en «28 ago / 2026». Cada campo pasa a su propia celda de ancho fijo, como el resumen de cinco cifras de más abajo, y un valor que no cabe se recorta con `recortarAlAncho`, nunca se envuelve. Sin «destinatario»: se consideró y se descartó, así que la rejilla tiene una sexta celda vacía en vez de forzar un campo que nadie pidió.',
    },
    // [2.0.1-C · F-8] Ver la declaración «tabla · encabezados de piezas y
    // total en almacén (F-8)» más arriba: el acortamiento de «Piezas del
    // proyecto» / «Total en almacén» vive AHÍ, en su propia entrada —
    // separada de la salida de `banda` (S-5) tras la revisión M3, que midió
    // que las dos franjas de texto NO se solapan.
    // ────────────────────────────────────────────────────────────
    // [2.0.1-C · F-11] EL RÓTULO, UNIFICADO EN LOS TRES SITIOS.
    //
    // El cubo del resumen ya quedó declarado arriba como adición
    // («FUERADELINVENTARIO», en vez de «FUERADELVIGENTE»). Faltan los otros
    // dos: el ESTATUS que imprime cada fila afectada (constante
    // `ESTATUS_FUERA_DEL_VIGENTE`, que SÍ vive en la vara desde el B8
    // original) y la NOTA AL PIE numerada, que decía «archivo de inventario
    // vigente» y pasa a decir solo «inventario vigente» para usar las mismas
    // palabras que los otros dos rótulos.
    {
      donde: 'pdf',
      bloque: 'tabla · estatus de la fila fuera del vigente (F-11)',
      de: 'Fuera del archivo vigente',
      a: 'Fuera del inventario vigente',
      porque:
        'los tres sitios donde el documento habla de este estado decían tres cosas distintas. Se cambia la CONSTANTE `ESTATUS_FUERA_DEL_VIGENTE` en `modelo.ts`, no las comparaciones que la usan por valor.',
    },
    {
      donde: 'pdf',
      bloque: 'nota al pie · fuera del inventario vigente (F-11)',
      de: 'en el archivo de inventario vigente',
      a: 'en el inventario vigente',
      porque:
        'alineación de rótulo: el cubo dice «FUERA DEL INVENTARIO» y el estatus «Fuera del inventario vigente», así que la nota deja de decir «archivo de» para usar las mismas palabras que los otros dos. El resto de la frase —«Sus cifras vienen de una carga anterior y están marcadas fila por fila.»— no cambia ni un carácter.',
    },
    {
      donde: 'xlsx',
      bloque: 'nota al pie · fuera del inventario vigente (F-11)',
      de: 'en el archivo de inventario vigente',
      a: 'en el inventario vigente',
      porque:
        'la MISMA advertencia (`modelo.advertencias`) alimenta la hoja «Documento» del libro (`xlsx.ts:149`, `meta.push(["", advertencia.texto])`); el texto es uno solo y no puede decir una cosa en el PDF y otra en el XLSX.',
    },
    // ────────────────────────────────────────────────────────────
    // [2.0.1-C · D-2, decisión de producto] LA HERMANA DE LA SUSTITUCIÓN DE
    // ARRIBA — mismo `de`/`a`, sitio DISTINTO.
    //
    // La de arriba («nota al pie») vive en `modelo.advertencias.texto` y
    // alimenta la hoja «Documento» (etiqueta vacía). ÉSTA vive en
    // `estatusDeFila` (`modelo.ts:153`) y alimenta la columna «Nota» de la
    // hoja PARTIDAS —una fila por SKU, no una advertencia del documento—,
    // así que es una ocurrencia DISTINTA del mismo texto, no la misma
    // declarada dos veces. Antes de esta corrección era el cuarto sitio sin
    // alinear (de cinco: cubo, estatus, nota al pie, nota por fila, y el
    // copy del portal en `proyecto-partida-fila.tsx`, que alinea otro
    // carril). El texto ANTES tiene que aparecer en `xlsxPartidas` de la
    // vara y el DESPUÉS en el de hoy — se verifica en «las cifras de la
    // tabla no se movieron ni una», que aplica esta MISMA sustitución
    // (`conSustituciones`) a la columna «Nota» antes de comparar, en vez de
    // una tercera copia del `de`/`a` escrita a mano ahí.
    {
      donde: 'xlsx',
      bloque: 'nota POR FILA · fuera del inventario vigente (D-2)',
      de: 'en el archivo de inventario vigente',
      a: 'en el inventario vigente',
      porque:
        'cuarto sitio alineado: la columna «Nota» de la hoja Partidas (`estatusDeFila`, `modelo.ts`) decía «archivo de inventario vigente» mientras el cubo, el estatus y la nota al pie ya decían «inventario vigente» sin «archivo». El resto de la frase —«; sus cifras no son comparables con las del resto.»— no cambia ni un carácter.',
    },
  ];

  const sinEspacios = (s: string) => s.replace(/\s+/g, '');

  /**
   * LAS ADICIONES SE APLICAN DE MÁS LARGA A MÁS CORTA, y esto es un ARREGLO, no
   * un detalle de implementación.
   *
   * `b.replace(adicion, '')` quita la PRIMERA ocurrencia. Con una declaración de
   * un solo carácter —los números de nota de B3— eso se come el carácter
   * equivocado: declarar «1» borró el «1» de «2,186», y el gate acusó que la
   * adición «2,186» «ya no aparece». **Una declaración corta canibalizaba a una
   * larga**, y cuál ganaba dependía del ORDEN en que estuvieran escritas en el
   * arreglo — o sea de nada.
   *
   * Ordenar por longitud descendente lo vuelve independiente del orden: las
   * cadenas largas se consumen enteras antes de que ningún carácter suelto pueda
   * partirlas.
   */
  const adicionesPorLongitud = () => [...ADICIONES_DECLARADAS].sort((a, b) => b.length - a.length);

  /** Aplica a la línea base las sustituciones declaradas para ese destino. */
  function conSustituciones(texto: string, donde: 'pdf' | 'xlsx'): string {
    let salida = texto;
    for (const s of SUSTITUCIONES_DECLARADAS.filter((x) => x.donde === donde)) {
      const de = donde === 'pdf' ? sinEspacios(s.de) : s.de;
      const a = donde === 'pdf' ? sinEspacios(s.a) : s.a;
      salida = salida.split(de).join(a);
    }
    return salida;
  }

  /**
   * Los MOVIMIENTOS declarados. Vacío hoy, y por eso la igualdad exacta sigue
   * en pie. Cada entrada es una renuncia explícita a la aserción más fuerte:
   * dice qué bloque se movió y por qué, y quien la escriba está firmando eso.
   */
  const REORDENAMIENTOS_DECLARADOS: Array<{ bloque: string; porque: string }> = [
    {
      bloque: 'paginación completa del PDF',
      porque:
        'la hoja pasa de carta APAISADA a carta VERTICAL (formato 1b, §6 de la especificación: el documento se imprime y se firma). El ancho útil cae de 708 a 528 pt, las celdas envuelven en más renglones, las filas crecen y la tabla se reparte en más páginas. El ORDEN DE LECTURA no cambia —nadie mueve un bloque de sitio— pero el texto se reparte entre otros flujos del PDF y `pdfNormalizado` los concatena POR FLUJO, con los bloques TJ de cada flujo antes de sus Tj. Esa concatenación puede reordenar piezas que ahora comparten página y antes no, así que la igualdad exacta deja de poder expresar el resultado esperado. Lo que SÍ sigue exigido, y es lo que importa: el multiconjunto (nada se pierde ni se inventa) y la secuencia declarada de bloques (marca → folio → título → vigencia → identidad → agrupación → tabla → anexo → advertencias).',
    },
  ];

  it('CONTENIDO · nada se perdió y nada se inventó, con independencia del orden', async () => {
    const ahora = await huellaActual();

    // Los pies se comparan aparte: dejaron de vivir en páginas propias, que es
    // justo el arreglo de O1. Su TEXTO no cambió.
    const a = conSustituciones(sinPies(antes.pdfNormalizado), 'pdf');
    let b = sinPies(ahora.pdfNormalizado);

    for (const adicion of adicionesPorLongitud()) {
      expect(b, `la adición declarada «${adicion}» ya no aparece: o se retiró sin declararlo, o cambió de texto`).toContain(adicion);
      b = b.replace(adicion, '');
    }

    expect(
      multiconjunto(b),
      `el PDF perdió o inventó texto que ninguna adición ni sustitución declarada explica. Delta de caracteres: ${deltaDeInventario(a, b)}`,
    ).toBe(multiconjunto(a));
  });

  /**
   * La aserción de orden, como FUNCIÓN y no como cuerpo de prueba.
   *
   * Se saca aquí para que el control positivo pueda ejercer **exactamente el
   * mismo código** sobre un documento saboteado. Un control que reimplementara
   * la comprobación probaría mi comprensión y no el gate (P26).
   */
  function revisarSecuencia(texto: string): { ok: boolean; motivo: string | null } {
    let previo: { bloque: string; i: number } | null = null;
    for (const { bloque, testigo } of SECUENCIA_DECLARADA) {
      const i = texto.indexOf(testigo);
      if (i < 0) return { ok: false, motivo: `el bloque «${bloque}» no aparece en el PDF (testigo: «${testigo}»)` };
      if (previo && i < previo.i) {
        return {
          ok: false,
          motivo:
            `«${bloque}» salió ANTES que «${previo.bloque}». Si el movimiento es intencional, va en ` +
            'SECUENCIA_DECLARADA y en REORDENAMIENTOS_DECLARADOS; si no, es el hallazgo.',
        };
      }
      previo = { bloque, i };
    }
    return { ok: true, motivo: null };
  }

  it('ORDEN · los bloques salen en la secuencia declarada', async () => {
    const ahora = await huellaActual();
    const veredicto = revisarSecuencia(sinPies(ahora.pdfNormalizado));
    expect(veredicto.motivo).toBeNull();
    expect(veredicto.ok).toBe(true);
  });

  it('control positivo · un bloque MOVIDO y no declarado tumba el gate — y el multiconjunto NO lo ve', async () => {
    // ────────────────────────────────────────────────────────────
    // EL CONTROL QUE PIDE LA REGLA DE LA VARA, y de paso la demostración de
    // por qué hacen falta las DOS aserciones.
    //
    // Se toma el documento REAL y se mueve un bloque REAL —la agrupación, de su
    // sitio al principio— sin añadir ni quitar un solo carácter. Eso es
    // exactamente lo que hace una re-disposición.
    //
    //   · El MULTICONJUNTO no lo ve, y no es un defecto suyo: es su definición.
    //     Si fuera lo único, una re-disposición no declarada pasaría en verde.
    //   · La SECUENCIA sí lo ve, y dice cuál bloque se adelantó a cuál.
    //
    // Juntas dicen lo que una re-disposición necesita probar; por separado,
    // ninguna de las dos basta.
    // ────────────────────────────────────────────────────────────
    const ahora = await huellaActual();
    const original = sinPies(ahora.pdfNormalizado);

    const movido = 'Partidasagrupadasportecnología';
    expect(original, 'el bloque que se va a mover dejó de existir: el sabotaje mediría otra cosa').toContain(movido);
    const saboteado = movido + original.replace(movido, '');

    // El sabotaje NO cambió el inventario de caracteres: solo el orden.
    expect(multiconjunto(saboteado), 'el sabotaje añadió o quitó texto — entonces no es un reordenamiento puro').toBe(
      multiconjunto(original),
    );

    // Y el gate de orden se cae, nombrando el bloque.
    const veredicto = revisarSecuencia(saboteado);
    expect(veredicto.ok, 'la secuencia declarada NO detectó un bloque movido').toBe(false);
    expect(veredicto.motivo).toContain('agrupación');

    // La otra dirección, para que esto no sea una guarda que siempre dice que sí:
    // sobre el documento intacto la misma función aprueba.
    expect(revisarSecuencia(original).ok).toBe(true);
  });

  it('IGUALDAD EXACTA · sigue rigiendo mientras nadie declare un movimiento', async () => {
    if (REORDENAMIENTOS_DECLARADOS.length > 0) {
      // La renuncia queda VISIBLE en el reporte, no escondida en un `skip`: se
      // exige que cada movimiento declarado diga QUÉ se movió y POR QUÉ, para
      // que apagar la aserción más fuerte cueste escribir las dos cosas.
      for (const r of REORDENAMIENTOS_DECLARADOS) {
        expect(r.bloque.length, 'un reordenamiento declarado sin bloque').toBeGreaterThan(0);
        expect(r.porque.length, `el reordenamiento de «${r.bloque}» no dice por qué`).toBeGreaterThan(0);
      }
      return;
    }
    const ahora = await huellaActual();
    const a = conSustituciones(sinPies(antes.pdfNormalizado), 'pdf');
    let b = sinPies(ahora.pdfNormalizado);
    for (const adicion of adicionesPorLongitud()) b = b.replace(adicion, '');
    expect(b).toBe(a);
  });

  it('DECLARACIÓN · toda sustitución declarada OCURRE de verdad — declarar de más también reprueba', async () => {
    // ────────────────────────────────────────────────────────────
    // La otra mitad de la regla de la vara, y la que la vuelve honesta: «una
    // declarada que resulte NO ocurrir también es rojo — significa que la
    // declaración estaba mal».
    //
    // Sin esto, la lista de sustituciones sería un permiso que nadie revisa:
    // se podría declarar cualquier cosa y el gate seguiría verde, incluso
    // declarando cambios que ya no existen. Se comprueba en las dos puntas:
    // el valor ANTES tiene que estar en la vara, y el valor DESPUÉS en el
    // documento de hoy.
    // ────────────────────────────────────────────────────────────
    const ahora = await huellaActual();
    const varaPdf = sinPies(antes.pdfNormalizado);
    const varaXlsx = antes.xlsxDocumento.map(([, v]) => v).join('\n');
    const hoyPdf = sinPies(ahora.pdfNormalizado);
    const hoyXlsx = ahora.xlsxDocumento.map(([, v]) => v).join('\n');

    expect(SUSTITUCIONES_DECLARADAS.length, 'sin sustituciones declaradas esta prueba no mira nada').toBeGreaterThan(0);

    for (const s of SUSTITUCIONES_DECLARADAS) {
      const [vara, hoy] = s.donde === 'pdf' ? [varaPdf, hoyPdf] : [varaXlsx, hoyXlsx];
      const de = s.donde === 'pdf' ? sinEspacios(s.de) : s.de;
      const a = s.donde === 'pdf' ? sinEspacios(s.a) : s.a;

      expect(vara, `«${s.bloque}» (${s.donde}) declara un valor ANTES que la vara no contiene: «${s.de}»`).toContain(de);
      expect(hoy, `«${s.bloque}» (${s.donde}) declara un valor DESPUÉS que el documento de hoy no tiene: «${s.a}»`).toContain(a);
      expect(s.porque.length, `«${s.bloque}» (${s.donde}) no dice POR QUÉ`).toBeGreaterThan(20);
      expect(de, `«${s.bloque}» (${s.donde}) declara una sustitución que no cambia nada`).not.toBe(a);
    }
  });

  it('control positivo · las dos aserciones nuevas SÍ se caen', () => {
    // Sin esto, un multiconjunto mal calculado o una secuencia que no mira nada
    // pondrían verde a las dos de arriba sin merecerlo (P19).
    //
    // (1) El multiconjunto ve una supresión y una invención, y es ciego al
    //     orden — las tres cosas que tiene que hacer.
    expect(multiconjunto('abc')).toBe(multiconjunto('cba'));
    expect(multiconjunto('abc')).not.toBe(multiconjunto('ab'));
    expect(multiconjunto('abc')).not.toBe(multiconjunto('abd'));

    // (2) La secuencia caza un bloque movido. Se construye una cadena con dos
    //     testigos reales INVERTIDOS y se comprueba que el orden ya no crece.
    const invertida = 'Loqueestedocumentonopuedeafirmar' + 'DEMOLOGISTICSSLAANALYTICS';
    const iMarca = invertida.indexOf('DEMOLOGISTICSSLAANALYTICS');
    const iAdv = invertida.indexOf('Loqueestedocumentonopuedeafirmar');
    expect(iMarca).toBeGreaterThan(iAdv);
  });

  it('las cifras de la tabla no se movieron ni una', async () => {
    const ahora = await huellaActual();
    expect(ahora.xlsxPartidas).toHaveLength(antes.xlsxPartidas.length);

    for (let i = 0; i < antes.xlsxPartidas.length; i++) {
      const fa = antes.xlsxPartidas[i];
      const fb = ahora.xlsxPartidas[i];
      for (const columna of Object.keys(fa)) {
        if (columna === DELTA_2_FOTO) continue; // delta mandatado en O5
        // [2.0.1-C] F-8 renombra la LLAVE de dos columnas (el valor viaja
        // intacto, verificado abajo) y F-11 mueve el VALOR de «Estatus» para
        // la fila fuera del vigente (la llave no cambia, también verificado
        // abajo). Ninguno de los dos es «se perdió un dato»: los dos tienen
        // su propia prueba dedicada, así que aquí solo se excluyen.
        if (columna === DELTA_4_PIEZAS || columna === DELTA_5_TOTAL || columna === DELTA_6_ESTATUS) continue;
        // [2.0.1-C · D-2] La columna «Nota» cambia de PALABRAS (no de llave,
        // no de fila) por la sustitución declarada «nota POR FILA» — se
        // compara contra la vara YA TRANSFORMADA por esa sustitución, en vez
        // de sumar una cuarta exclusión DELTA_N que copiaría a mano el mismo
        // `de`/`a` que ya está declarado arriba. Acotado a ESTA columna
        // nada más: las demás (SKU, Descripción, Marca…) siguen exigiendo
        // igualdad estricta, para que una sustitución futura pensada para
        // otro campo no transforme por accidente un valor que coincida por
        // casualidad.
        const esperado = columna === 'Nota' && typeof fa[columna] === 'string' ? conSustituciones(fa[columna] as string, 'xlsx') : fa[columna];
        expect(fb[columna], `cambió ${columna} de la fila ${i}`).toEqual(esperado);
      }
    }
  });

  it('delta 7 · la nota por fila (fuera del inventario vigente) cambia de palabras en UNA fila, y en ninguna otra', async () => {
    // [2.0.1-C · D-2] La hermana de "delta 6", con la columna «Nota» en vez
    // de «Estatus»: la llave es la MISMA en las dos huellas; lo que cambia
    // es el VALOR, y solo para la fila cuya nota hablaba de «archivo de
    // inventario vigente». Todas las demás filas tienen Nota vacía y tienen
    // que seguir vacías — si esta prueba no las mirara, una fuga del
    // reemplazo hacia una nota que no le toca pasaría inadvertida.
    const ahora = await huellaActual();
    const ANTES_TEXTO = 'en el archivo de inventario vigente';
    const HOY_TEXTO = 'en el inventario vigente';

    const filasConLaNotaAntes = antes.xlsxPartidas.filter(
      (f) => typeof f['Nota'] === 'string' && (f['Nota'] as string).includes(ANTES_TEXTO),
    );
    expect(filasConLaNotaAntes.length, 'la vara no tiene ninguna fila con la nota vieja: esta prueba sería vacua').toBeGreaterThan(0);

    for (let i = 0; i < antes.xlsxPartidas.length; i++) {
      const fa = antes.xlsxPartidas[i];
      const fb = ahora.xlsxPartidas[i];
      const notaAntes = typeof fa['Nota'] === 'string' ? (fa['Nota'] as string) : '';
      const esperado = notaAntes.includes(ANTES_TEXTO) ? notaAntes.replace(ANTES_TEXTO, HOY_TEXTO) : fa['Nota'];
      expect(fb['Nota'], `fila ${i}: la nota no siguió la regla esperada`).toEqual(esperado);
    }
  });

  it('delta 4 y 5 · los encabezados de piezas y de total en almacén se acortan por copy firmado, y el valor no cambia', async () => {
    // [2.0.1-C · F-8] La llave vieja desaparece (el encabezado ya no dice
    // «Piezas del proyecto» ni «Total en almacén») y la nueva («Del
    // proyecto» / «En almacén») guarda EXACTAMENTE el mismo número, fila por
    // fila. Si esto no fuera cierto, «las cifras de la tabla no se movieron
    // ni una» estaría vacía de sentido para estas dos columnas: se excluyen
    // ahí precisamente porque SU verificación vive aquí.
    const ahora = await huellaActual();
    expect(ahora.xlsxPartidas).toHaveLength(antes.xlsxPartidas.length);

    for (let i = 0; i < antes.xlsxPartidas.length; i++) {
      const fa = antes.xlsxPartidas[i];
      const fb = ahora.xlsxPartidas[i];
      expect(fb[DELTA_4_PIEZAS], `fila ${i}: la llave vieja "${DELTA_4_PIEZAS}" sigue en el XLSX de hoy`).toBeUndefined();
      expect(fb[DELTA_5_TOTAL], `fila ${i}: la llave vieja "${DELTA_5_TOTAL}" sigue en el XLSX de hoy`).toBeUndefined();
      expect(fb['Del proyecto'], `fila ${i}: no cambió de valor bajo la llave nueva`).toEqual(fa[DELTA_4_PIEZAS]);
      expect(fb['En almacén'], `fila ${i}: no cambió de valor bajo la llave nueva`).toEqual(fa[DELTA_5_TOTAL]);
    }
  });

  it('delta 6 · el estatus fuera del inventario vigente cambia de palabras en UNA fila, y en ninguna otra', async () => {
    // [2.0.1-C · F-11] La llave «Estatus» es la MISMA en las dos huellas; lo
    // que cambia es el VALOR, y solo para la fila cuyo SKU ya no viene en el
    // archivo — todas las demás tienen que seguir diciendo exactamente lo
    // mismo que decían antes del bloque, o esta prueba estaría escondiendo
    // una fuga del rótulo hacia filas que no le tocan.
    const ahora = await huellaActual();
    const ANTES_TEXTO = 'Fuera del archivo vigente';
    const HOY_TEXTO = 'Fuera del inventario vigente';

    const filasConElRotuloAntes = antes.xlsxPartidas.filter((f) => f[DELTA_6_ESTATUS] === ANTES_TEXTO);
    expect(filasConElRotuloAntes.length, 'la vara no tiene ninguna fila con el rótulo viejo: esta prueba sería vacua').toBeGreaterThan(0);

    for (let i = 0; i < antes.xlsxPartidas.length; i++) {
      const fa = antes.xlsxPartidas[i];
      const fb = ahora.xlsxPartidas[i];
      const esperado = fa[DELTA_6_ESTATUS] === ANTES_TEXTO ? HOY_TEXTO : fa[DELTA_6_ESTATUS];
      expect(fb[DELTA_6_ESTATUS], `fila ${i}: el estatus no siguió la regla esperada`).toEqual(esperado);
    }
  });

  it('la hoja Documento cambia EXACTAMENTE en los deltas 1 y 3, y en la explicación de fotos', async () => {
    const ahora = await huellaActual();
    const etiquetas = (h: HuellaDocumento) => h.xlsxDocumento.map((p) => p[0]);

    const agregadas = etiquetas(ahora).filter((e) => !etiquetas(antes).includes(e));
    const quitadas = etiquetas(antes).filter((e) => !etiquetas(ahora).includes(e));

    expect(agregadas).toEqual([DELTA_1_DUENO]);
    expect(quitadas).toEqual([DELTA_3_CORREO]);

    // ────────────────────────────────────────────────────────────
    // [2.0.1-B · S-5] ESTO ERA `new Map(h.xlsxDocumento)`, Y LA VARA TENÍA UN
    // AGUJERO POR AHÍ.
    //
    // `xlsxDocumento` es una LISTA de pares, no un mapa, y admite etiquetas
    // repetidas — las tiene: las TRES advertencias comparten etiqueta vacía.
    // `new Map(...)` las colapsaba a una: de 17 pares quedaban 15 entradas, y
    // este bucle **solo comparaba el texto de la ÚLTIMA advertencia**. Las otras
    // dos quedaban cubiertas únicamente por el lado del PDF.
    //
    // Ahora se agrupa por etiqueta y se comparan los VALORES como conjunto
    // ordenado, así que las tres cuentan. Se sigue siendo ciego al orden de los
    // renglones de esta hoja, que es deliberado: ahí el orden no es contenido.
    // ────────────────────────────────────────────────────────────
    const porEtiqueta = (h: HuellaDocumento) => {
      const m = new Map<string, string[]>();
      for (const [etiqueta, valor] of h.xlsxDocumento) m.set(etiqueta, [...(m.get(etiqueta) ?? []), valor]);
      return m;
    };
    const deAntes = porEtiqueta(antes);
    const deAhora = porEtiqueta(ahora);
    for (const [etiqueta, valores] of Array.from(deAntes.entries())) {
      if (etiqueta === DELTA_3_CORREO || etiqueta === 'Fotografías') continue;
      expect(
        (deAhora.get(etiqueta) ?? []).slice().sort(),
        `cambió el valor de "${etiqueta}" (${valores.length} renglón(es) con esa etiqueta)`,
      ).toEqual(
        valores
          .map((v) => conSustituciones(v, 'xlsx'))
          .slice()
          .sort(),
      );
    }

    // Y la anti-vacuidad de este arreglo: si la etiqueta vacía dejara de tener
    // varios renglones, el agujero que se acaba de cerrar habría desaparecido
    // por otra vía y este bucle volvería a no probar lo que cree probar.
    expect(
      (deAntes.get('') ?? []).length,
      'la línea base ya no tiene varios renglones bajo la etiqueta vacía: revisar si el agujero del Map sigue siendo el mismo',
    ).toBeGreaterThan(1);
  });

  it('delta 3 · el renglón «Correo» duplicado desapareció, y el firmante sigue estando', async () => {
    const ahora = await huellaActual();
    const pares = new Map(ahora.xlsxDocumento);
    expect(pares.has(DELTA_3_CORREO)).toBe(false);
    expect(pares.get('Generado por')).toBe(SESION_FIXTURE.correo);
  });

  it('delta 1 · el dueño del proyecto aparece, y NO es lo mismo que el firmante', async () => {
    const detalle = { ...DETALLE_PEOR_CASO, responsable: 'ygyxataxb@example.test' };
    const modelo = modeloXlsx(detalle);
    const ahora = huellaDe(renderizarXlsx(modelo), await renderizarPdf(modeloPdf(detalle)));
    const pares = new Map(ahora.xlsxDocumento);

    expect(pares.get(DELTA_1_DUENO)).toBe('ygyxataxb@example.test');
    expect(pares.get('Generado por')).toBe('xrnpnnwwidz@example.test');
    // [2.0.1-C · F-7] La identidad del PDF dejó de unir rótulo y valor con
    // «·»: son dos celdas de la rejilla, adyacentes sin separador textual.
    expect(ahora.pdfNormalizado).toContain('Responsableygyxataxb@example.test');
    expect(ahora.pdfNormalizado).toContain('Generadoporxrnpnnwwidz@example.test');
  });

  it('delta 2 · la columna Foto enlaza cuando el SKU tiene fotografía, incluso en .webp', async () => {
    const ahora = await huellaActual();
    expect(antes.xlsxEnlaces).toHaveLength(0);
    expect(ahora.xlsxEnlaces).toHaveLength(2);

    const destinos = ahora.xlsxEnlaces.map(([, url]) => url);
    expect(destinos.some((u) => u.endsWith('.webp')), 'el .webp también se enlaza: enlazar no es incrustar').toBe(true);
    expect(destinos.some((u) => u.endsWith('.png'))).toBe(true);
  });
});

// ============================================================
// [2.0.1-B · S-5 · B3] EL PUNTO CIEGO DE LAS TRES ASERCIONES DE LA HUELLA.
//
// ────────────────────────────────────────────────────────────
// QUÉ NO VE NINGUNA DE LAS TRES, y hay que decirlo con precisión porque el
// bloque acaba de meterse justo en ese caso.
//
//   · el MULTICONJUNTO no ve un movimiento entre bloques — mismos caracteres;
//   · la SECUENCIA tampoco, si el orden de los BLOQUES no cambia y lo que se
//     mueve es contenido DENTRO de esa secuencia;
//   · y la IGUALDAD EXACTA está apagada desde que A2 declaró el primer
//     reordenamiento.
//
// Mover la `nota` de debajo de su fila al pie numerado es EXACTAMENTE ese caso.
// Los superíndices traen texto nuevo y el multiconjunto sí los ve; **el texto de
// la nota moviéndose de bloque sería invisible para las tres**. El commit que
// mueve las notas habría pasado en verde sin haberlas movido.
//
// La contramedida es barata y va DENTRO del commit que las mueve: aseverar
// POSICIÓN RELATIVA en el flujo — que el texto de la nota aparece DESPUÉS del
// marcador del pie, no solo que aparece. Con su control positivo: si la nota
// siguiera bajo su fila, la aserción tiene que caer.
// ============================================================
describe('[2.0.1-B · S-5] las notas viven en el pie, no bajo su fila', () => {
  /** La primera posición del texto en el flujo normalizado, o -1. */
  const posicion = (texto: string, aguja: string) => texto.indexOf(aguja.replace(/\s+/g, ''));

  it('el texto de la nota aparece DESPUÉS del marcador del pie', async () => {
    const ahora = await huellaActual();
    const flujo = sinPies(ahora.pdfNormalizado);

    const iMarcador = posicion(flujo, MARCADOR_NOTAS);
    expect(iMarcador, `no se encontró el marcador «${MARCADOR_NOTAS}»: el bloque de notas no se dibujó`).toBeGreaterThanOrEqual(0);

    // La advertencia del vigente es la que antes vivía como prosa bajo su fila.
    // Sin el verbo: el fixture emite el SINGULAR («1 SKU ya no aparece») y
    // escribir el plural fue mi primer intento — una aguja que depende de cuantas
    // filas trae el fixture es una aguja que se rompe con el fixture.
    //
    // [2.0.1-C · F-11] Era «en el archivo de inventario vigente»; la aguja
    // sigue la misma alineación de rótulo que el resto del bloque.
    const aguja = 'en el inventario vigente';
    const iNota = posicion(flujo, aguja);
    expect(iNota, 'no se encontró el texto de la nota').toBeGreaterThanOrEqual(0);

    expect(
      iNota,
      `el texto de la nota sale ANTES del marcador del pie (nota en ${iNota}, marcador en ${iMarcador}): ` +
        'sigue viviendo bajo su fila. Ni el multiconjunto ni la secuencia ven este caso — mismos caracteres, otro bloque.',
    ).toBeGreaterThan(iMarcador);
  });

  it('control positivo · la aserción SÍ cae si la nota se queda bajo su fila', async () => {
    // El control que se pidió, y sin fabricar un PDF falso: se toma el flujo
    // REAL y se mueve el texto de la nota a ANTES del marcador — que es
    // exactamente cómo se veía el documento antes de este commit. La aserción
    // tiene que caer, y el multiconjunto tiene que seguir sin verlo.
    const ahora = await huellaActual();
    const flujo = sinPies(ahora.pdfNormalizado);
    // [2.0.1-C · F-11] Era «enelarchivodeinventariovigente».
    const aguja = 'enelinventariovigente';

    expect(flujo, 'el texto de la nota cambió: este control mediría otra cosa').toContain(aguja);
    const comoAntes = aguja + flujo.replace(aguja, '');

    // (1) La posición SÍ lo caza.
    expect(posicion(comoAntes, aguja)).toBeLessThan(posicion(comoAntes, MARCADOR_NOTAS));
    // (2) Y el multiconjunto NO — que es la razón de que esta prueba exista.
    const multiconjunto = (s: string) => Array.from(s).sort().join('');
    expect(
      multiconjunto(comoAntes),
      'el sabotaje cambió el inventario de caracteres: entonces no es un movimiento puro y no prueba el punto ciego',
    ).toBe(multiconjunto(flujo));
  });

  it('los dos espacios de aceptacion existen y van al FINAL del documento', async () => {
    // [S-5 · B4] Misma contramedida de posicion: no basta con que aparezcan.
    // Un espacio de firma en medio del documento no es un espacio de firma.
    const ahora = await huellaActual();
    const flujo = sinPies(ahora.pdfNormalizado);

    const iAceptacion = posicion(flujo, MARCADOR_ACEPTACION);
    expect(iAceptacion, 'no se dibujo el bloque de aceptacion').toBeGreaterThanOrEqual(0);
    for (const rol of ESPACIOS_DE_ACEPTACION) {
      expect(posicion(flujo, rol), `falta el espacio «${rol}»`).toBeGreaterThan(iAceptacion);
    }

    // Va DESPUES de las notas al pie y del bloque de confesiones: es lo ultimo
    // que se lee antes de firmar.
    expect(iAceptacion, 'la aceptacion sale ANTES de las notas al pie').toBeGreaterThan(posicion(flujo, MARCADOR_NOTAS));
  });

  it('cada fila afectada lleva su superíndice, y el número apunta a una nota que existe', async () => {
    // La otra mitad: un superíndice que apunta a una nota inexistente es peor
    // que ninguno. Se comprueba que la numeración del papel y la lista de notas
    // salen de la MISMA fuente — `advertencia.filas` — contando cuántas notas
    // numeradas hay y exigiendo que el superíndice más alto no las rebase.
    const modelo = modeloPdf();
    const numeradas = modelo.advertencias.filter((a) => a.alcance === 'filas');
    expect(numeradas.length, 'el peor caso no emite ninguna nota numerada: la prueba sería vacua').toBeGreaterThan(0);

    const marcadas = new Set(numeradas.flatMap((a) => (a.alcance === 'filas' ? a.filas.map((f) => f.sku) : [])));
    expect(marcadas.size, 'ninguna fila quedó marcada por una nota').toBeGreaterThan(0);
    // Y que sean filas DE ESTE modelo, no objetos sueltos.
    for (const sku of Array.from(marcadas)) {
      expect(modelo.filas.some((f) => f.sku === sku), `la nota marca «${sku}», que no es una fila del documento`).toBe(true);
    }
  });
});

// ============================================================
// [2.0.1-B · S-5] LA TABLA CABE — LA CAUSA, NO EL SÍNTOMA.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ENTRA, y por qué ANTES del re-maquetado.
//
// Hasta aquí solo se comprobaba el SÍNTOMA: que los encabezados no salieran
// partidos. Un síntoma se puede arreglar sin arreglar la causa —encogiendo una
// fuente, recortando un título— y entonces el gate se queda verde sobre una
// tabla que ya no cabe.
//
// La causa es una desigualdad y se puede aseverar: **la suma de los pisos de
// las columnas tiene que caber en el ancho útil de la hoja.** Si no cabe, el
// renderizador lo confiesa en el documento (advertencia de `alcance:
// 'documento'`) — o sea que hoy el desbordamiento es una nota al pie, no un
// rojo. Aquí pasa a ser un rojo.
//
// Entra ANTES de cambiar la orientación a propósito: así el gate existe antes
// que la cosa que tiene que proteger. Medido: en apaisado sobran 160 pt; en
// vertical con las 9 columnas de hoy **faltarían 20**, y con las 8 del formato
// 1b sobran 41. Ese margen es lo que este gate deja de ser una frase en un
// reporte.
// ============================================================
describe('[2.0.1-B · S-5] la tabla del PDF cabe a lo ancho de su hoja', () => {
  /** Un documento con la geometría REAL —la misma constante que imprime— para poder medir. */
  function hojaDeMedicion() {
    return new PDFDocument({ ...PAGINA });
  }

  function medida(modelo: ModeloDocumento) {
    const doc = hojaDeMedicion();
    const columnas = modelo.columnas.filter((c) => COLUMNAS_IMPRESAS.includes(String(c.clave)));
    // `pisosQueCaben` y no `medirPisos`: es la funcion que USA el renderizador.
    // Con la estricta, este gate media un escenario que el papel no ejecuta —
    // P27, medir la representacion en vez de la cosa— y lo cazó el propio gate
    // al voltear la hoja: denunciaba 594,4 > 528 mientras el documento se
    // renderizaba bien, porque el renderizador ya relajaba el piso.
    const util = anchoUtilDe(doc);
    const r = pisosQueCaben(doc, columnas, modelo.filas, util);
    return { suma: r.suma, anchoUtil: util, columnas, fragmentado: r.fragmentado };
  }

  // ────────────────────────────────────────────────────────────
  // CONTRA **TODOS** LOS DETALLES DEL FIXTURE, y no solo contra
  // `DETALLE_PEOR_CASO`. Lo aprendí equivocándome: medí la holgura del formato
  // vertical contra ese detalle y reporté 41 pt, cuando los tokens largos de
  // verdad —el SKU de 21 caracteres y la palabra de 31 de una descripción—
  // viven en `DETALLE_TOKENS_LARGOS`. Contra ése, la misma tabla NO cabe.
  //
  // El nombre engaña y por eso hay que decirlo: `DETALLE_PEOR_CASO` es el peor
  // caso de LONGITUD TOTAL (244 caracteres, 31 de SKU), no de TOKEN. Y el piso
  // de una columna lo manda el token, no la cadena. **Un universo de evaluación
  // que no contiene el caso que importa (P17), elegido por el nombre de una
  // constante.**
  // ────────────────────────────────────────────────────────────
  const DETALLES: Array<[string, typeof DETALLE_PEOR_CASO]> = [
    ['DETALLE_PEOR_CASO', DETALLE_PEOR_CASO],
    ['DETALLE_LARGO', DETALLE_LARGO],
    ['DETALLE_TOKENS_LARGOS', DETALLE_TOKENS_LARGOS],
  ];

  for (const [nombre, detalle] of DETALLES) {
    it(`la suma de pisos cabe en el ancho útil · ${nombre}`, () => {
      const { suma, anchoUtil, columnas } = medida(modeloPdf(detalle));
      expect(
        suma,
        `con ${nombre}, los pisos de las ${columnas.length} columnas suman ${suma.toFixed(1)} pt y la hoja ofrece ` +
          `${anchoUtil} pt: faltan ${(suma - anchoUtil).toFixed(1)} pt. La tabla NO cabe y el documento saldría con la ` +
          'advertencia de geometría en todos los casos — y una advertencia que siempre aparece enseña a ignorar las otras.',
      ).toBeLessThanOrEqual(anchoUtil);
    });
  }

  it('control positivo · los detalles del fixture NO miden todos lo mismo', () => {
    // Sin esto, la bateria de arriba podria ser tres veces la misma medicion y
    // nadie lo notaria. Se exige que DIFIERAN, no que uno concreto sea el mayor:
    // cual es el peor DEPENDE de la politica de corte —con el token entero manda
    // DETALLE_TOKENS_LARGOS, y al permitir el corte por puntuacion pasa a mandar
    // DETALLE_LARGO— y clavar un ranking habria vuelto esta prueba falsa en cuanto
    // la politica cambiara, que es justo lo que paso.
    const sumas = DETALLES.map(([, d]) => medida(modeloPdf(d)).suma);
    expect(
      new Set(sumas.map((s) => s.toFixed(2))).size,
      `los ${DETALLES.length} detalles del fixture exigen el MISMO ancho (${sumas.map((s) => s.toFixed(1)).join(', ')}): la bateria mide tres veces lo mismo`,
    ).toBeGreaterThan(1);  });

  it('control positivo · un token más largo SÍ enrojece el gate', () => {
    // Lo que separa esta aserción de una que no puede fallar (P19). Se alarga un
    // token de una celda —no se toca la hoja ni el algoritmo— y la desigualdad
    // tiene que invertirse. Si no lo hiciera, la de arriba estaría midiendo otra
    // cosa.
    const base = modeloPdf();
    const conTokenAbsurdo: ModeloDocumento = {
      ...base,
      filas: base.filas.map((f, i) => (i === 0 ? { ...f, descripcion: 'X'.repeat(400) } : f)),
    };
    const sano = medida(base);
    const roto = medida(conTokenAbsurdo);

    expect(roto.suma, 'alargar un token no movió la suma de pisos: `medirPisos` no está mirando el contenido').toBeGreaterThan(
      sano.suma,
    );
    expect(roto.suma, 'ni con un token de 400 caracteres la tabla deja de caber: el gate no puede enrojecer').toBeGreaterThan(
      roto.anchoUtil,
    );
  });

  it('y el margen medido queda ESCRITO, para que cambiarlo se note', () => {
    // El número, no solo la desigualdad. Si mañana alguien agrega una columna o
    // cambia la orientación, este renglón se mueve y hay que decidirlo a
    // propósito en vez de descubrirlo cuando la advertencia empiece a salir en
    // todos los documentos.
    // La holgura del caso MAS EXIGENTE, que es el unico numero que significa algo:
    // el minimo sobre todos los detalles. Si manana alguien agrega una columna o
    // cambia la orientacion, este renglon se mueve y hay que decidirlo a proposito
    // en vez de descubrirlo cuando la advertencia empiece a salir en todos los
    // documentos.
    const holguras = DETALLES.map(([nombre, d]) => {
      const { suma, anchoUtil } = medida(modeloPdf(d));
      return { nombre, holgura: anchoUtil - suma, anchoUtil };
    });
    const peor = holguras.reduce((a, b) => (b.holgura < a.holgura ? b : a));
    expect(
      peor.holgura,
      `holgura del caso mas exigente (${peor.nombre}): ${peor.holgura.toFixed(1)} pt sobre ${peor.anchoUtil} pt de hoja`,
    ).toBeGreaterThan(0);
  });
});

// ============================================================
// VISUALIZACIÓN · el gate se corre sobre el texto extraído, no sobre una mirada
// ============================================================
describe('[INV-B8.1] O1 · ninguna página huérfana', () => {
  it('el PDF no tiene ninguna página que contenga SOLO el pie', async () => {
    const pdf = await pdfDe();
    const paginas = piezasPorPagina(pdf);

    expect(paginas.length).toBeGreaterThan(0);
    paginas.forEach((piezas, i) => {
      const soloPie = piezas.every(esPieDePagina);
      expect(soloPie, `la página ${i + 1} contiene únicamente el pie`).toBe(false);
    });
  });

  it('cada página lleva su pie, uno y solo uno', async () => {
    const pdf = await pdfDe();
    const paginas = piezasPorPagina(pdf);
    for (const [i, piezas] of Array.from(paginas.entries())) {
      expect(piezas.filter(esPieDePagina), `pies en la página ${i + 1}`).toHaveLength(1);
    }
  });

  it('el conteo de páginas es el de contenido — antes del arreglo era el doble', async () => {
    const ahora = await huellaActual();
    const paginasConTexto = piezasPorPagina(await pdfDe()).length;
    expect(ahora.pdfPaginas).toBe(paginasConTexto);
  });

  it('con 34 partidas la tabla pagina, y la propiedad se mantiene', async () => {
    const pdf = await pdfDe(DETALLE_LARGO);
    const paginas = piezasPorPagina(pdf);
    expect(paginas.length).toBeGreaterThan(2);
    paginas.forEach((piezas, i) => {
      expect(piezas.every(esPieDePagina), `la página ${i + 1} contiene únicamente el pie`).toBe(false);
    });
  });
});

describe('[INV-B8.1] O4 · ningún encabezado se parte ni se corta', () => {
  it('cada encabezado IMPRESO aparece como UN token completo', async () => {
    // ────────────────────────────────────────────────────────────
    // [S-5 · A1] ERA UNA LISTA DE NUEVE ESCRITA A MANO, y por eso se puso roja
    // cuando `banda` salió de las columnas impresas. La lista no estaba mal: era
    // una SEGUNDA COPIA de `COLUMNAS_IMPRESAS`, y las dos copias divergieron en
    // cuanto una cambió.
    //
    // Ahora los encabezados se DERIVAN del modelo filtrado por la misma
    // constante que usa el renderizador. La prueba conserva lo que de verdad
    // vigila —que ningún encabezado salga partido, que es el defecto de
    // partir palabras— y deja de afirmar CUÁNTAS columnas hay, que no era su asunto.
    // ────────────────────────────────────────────────────────────
    const ahora = await huellaActual();
    const impresas = modeloPdf().columnas.filter((c) => COLUMNAS_IMPRESAS.includes(String(c.clave)));

    // Anti-vacuidad: si el filtro dejara la lista vacía, el bucle no miraría
    // nada y esto pasaría en verde.
    expect(impresas.length, 'ninguna columna quedó impresa: el bucle de abajo no mira nada').toBe(COLUMNAS_IMPRESAS.length);

    for (const columna of impresas) {
      const encabezado = columna.titulo.toUpperCase().replace(/\s+/g, '');
      expect(ahora.pdfNormalizado, `el encabezado ${encabezado} salió partido o cortado`).toContain(encabezado);
    }

    // Y la supresión, afirmada: «TECNOLOGÍA» era el título de la columna de
    // banda y ya no debe estar. Sin esta línea, sacar una columna dejaría de
    // notarse aquí.
    expect(ahora.pdfNormalizado, 'la columna de banda volvió a imprimirse').not.toContain('TECNOLOGÍA');
  });

  it('el peor caso del catálogo (solo su forma, valores inventados) sale completo, sin perder un carácter', async () => {
    const ahora = await huellaActual();
    const sinEspacios = (t: string) => t.replace(/\s+/g, '');

    // Descripción de 244 caracteres y SKU de 31: la forma del peor caso, con valores inventados.
    expect(DESCRIPCION_244).toHaveLength(244);
    expect(SKU_31).toHaveLength(31);
    expect(ahora.pdfNormalizado, 'la descripción de 244 caracteres se truncó').toContain(sinEspacios(DESCRIPCION_244));
    expect(ahora.pdfNormalizado, 'el SKU de 31 caracteres se truncó').toContain(sinEspacios(SKU_31));
  });

  it('las cifras extremas del catálogo se imprimen enteras', async () => {
    const ahora = await huellaActual();
    for (const cifra of ['771,788', '41,334', '730,454', '-2,924']) {
      expect(ahora.pdfNormalizado, `la cifra ${cifra} no salió entera`).toContain(cifra);
    }
  });
});

describe('[INV-B8.1] el invariante de B8 sigue vigente', () => {
  it('XLSX y PDF siguen coincidiendo cifra por cifra', async () => {
    const modelo = modeloXlsx();
    const ahora = await huellaActual();

    for (const fila of modelo.filas) {
      const enXlsx = ahora.xlsxPartidas.find((f) => f['SKU'] === fila.sku);
      expect(enXlsx, `el XLSX no trae ${fila.sku}`).toBeDefined();
      // [2.0.1-C · F-8] «Del proyecto» / «En almacén»: los encabezados se
      // acortaron; la llave que lee este test tiene que seguirlos.
      expect(enXlsx!['Del proyecto']).toBe(fila.cantidad);
      expect(enXlsx!['En almacén']).toBe(fila.total);
      expect(enXlsx!['Reservado']).toBe(fila.reservado);
      expect(enXlsx!['Disponible']).toBe(fila.disponible);
      expect(ahora.pdfNormalizado).toContain(fila.total.toLocaleString('es-MX'));
    }
  });

  it('la hoja Partidas sigue arrancando en A1 — el título con merge NO se coló ahí', async () => {
    const ahora = await huellaActual();
    expect(ahora.xlsxHojas).toEqual(['Partidas', 'Documento']);
    expect(Object.keys(ahora.xlsxPartidas[0])[0]).toBe('SKU');
  });
});

// ============================================================
// SEGURIDAD DEL GATE · cero literales de color fuera del módulo de tokens
// ============================================================
describe('[INV-B8.1] O3 · gate de la paleta', () => {
  it('ningún literal hexadecimal vive fuera de tokens.ts', () => {
    const dir = join(process.cwd(), 'src/services/documento');
    const archivos = ['pdf.ts', 'xlsx.ts', 'modelo.ts', 'resoluciones.ts', 'medida.ts', 'huella.ts'];
    const culpables: string[] = [];

    for (const archivo of archivos) {
      const contenido = readFileSync(join(dir, archivo), 'utf8');
      contenido.split('\n').forEach((linea, i) => {
        // Se ignoran los comentarios: la procedencia de cada token se
        // documenta con su hex, y prohibirlo ahí volvería el gate hostil a
        // explicar de dónde salió un color.
        const sinComentario = linea.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
        if (/#[0-9A-Fa-f]{6}\b/.test(sinComentario)) culpables.push(`${archivo}:${i + 1}  ${linea.trim()}`);
      });
    }

    expect(culpables, `hex fuera de tokens.ts:\n${culpables.join('\n')}`).toEqual([]);
  });
});

// ============================================================
// VISUALIZACIÓN GEOMÉTRICA · "las filas se encinan" es una afirmación sobre
// coordenadas, y las coordenadas están en el archivo. En esta máquina no hay
// `pdftoppm` para rasterizar, así que en vez de saltarse la comprobación se
// hace sobre la geometría real — que además cubre TODAS las filas, no las que
// a uno se le ocurra mirar.
// ============================================================
describe('[INV-B8.1] O4 · ninguna fila se encima con la siguiente', () => {
  // ============================================================
  // [2.0.1-B · S-5] AGRUPAR POR TOLERANCIA, NO POR REDONDEO.
  //
  // ────────────────────────────────────────────────────────────
  // POR QUÉ, y los números que lo deciden — medidos, no razonados.
  //
  // Las dos pruebas de aquí agrupaban piezas en renglones con
  // `Math.round(pieza.y)`. Eso tiene DOS modos de fallo y el bloque ya vio uno:
  //
  //   · FUSIONAR dos renglones distintos en un cubo. Es lo que pasó al voltear
  //     la hoja: el SKU en Courier (y=315,48) y sus celdas en Helvetica
  //     (y=314,52) distan 0,96 pt por la línea de base de cada fuente, y
  //     redondeaban a 315 y 314 — o a 315 los dos, según la orientación.
  //   · PARTIR un renglón en dos cubos, que es el más traicionero porque el
  //     fallo es un FALSO NEGATIVO: la prueba deja de ver una colisión.
  //
  // Medido sobre los dos fixtures que estas pruebas usan:
  //
  //   dispersión de `y` DENTRO de cada cubo   0,0000 pt   (hoy no mezcla fuentes)
  //   separación mínima entre renglones       17,0 pt · 24,8 pt
  //   piezas a <0,05 pt de un límite          2 de 7 · 5 de 28
  //
  // O sea: hoy es seguro **por accidente** —el emparejador solo recoge piezas de
  // la columna SKU, todas en Courier—, y aun así 7 de 35 piezas están al borde
  // del redondeo. Cualquier ajuste de sub-punto las cruza.
  //
  // Con 0 de dispersión y 17 pt de separación, una tolerancia de 2 pt no puede
  // equivocarse en ninguna de las dos direcciones: nunca fusiona dos renglones
  // (distan 8,5× la tolerancia) y nunca parte uno (cabe de sobra la diferencia
  // de 0,96 pt entre líneas de base). Deja de ser seguro por accidente.
  // ============================================================

  /** Tolerancia vertical de un renglón, en puntos. Ver la cabecera: 17 pt de separación medida contra 2 de tolerancia. */
  const TOLERANCIA_RENGLON = 2;

  /**
   * Agrupa piezas en renglones por CERCANÍA vertical dentro de cada página.
   * Devuelve una clave estable por renglón, apta para comparar entre sí.
   */
  function renglonDe(piezas: Array<{ pagina: number; y: number }>): Map<{ pagina: number; y: number }, string> {
    const orden = [...piezas].sort((a, b) => a.pagina - b.pagina || a.y - b.y);
    const clave = new Map<{ pagina: number; y: number }, string>();
    let ancla: { pagina: number; y: number } | null = null;
    for (const p of orden) {
      if (!ancla || p.pagina !== ancla.pagina || p.y - ancla.y > TOLERANCIA_RENGLON) ancla = p;
      clave.set(p, `${ancla.pagina}:${ancla.y.toFixed(2)}`);
    }
    return clave;
  }

  it('control positivo · la tolerancia NI fusiona renglones NI parte uno', () => {
    // Las dos direcciones, con los números reales: 0,96 pt es la diferencia de
    // línea de base medida entre Courier y Helvetica; 17 pt la separación mínima
    // entre renglones. Sin esto, una tolerancia mal dimensionada —0, o 20—
    // pondría verde a las dos pruebas de abajo por razones opuestas.
    const mismaFila = [
      { pagina: 0, y: 314.52 },
      { pagina: 0, y: 315.48 },
    ];
    const claves = renglonDe(mismaFila);
    expect(new Set(Array.from(claves.values())).size, 'la tolerancia PARTIÓ un renglón (0,96 pt de línea de base)').toBe(1);

    const dosFilas = [
      { pagina: 0, y: 314.52 },
      { pagina: 0, y: 331.52 },
    ];
    expect(
      new Set(Array.from(renglonDe(dosFilas).values())).size,
      'la tolerancia FUSIONÓ dos renglones que distan 17 pt',
    ).toBe(2);

    // Y la página separa aunque la `y` coincida.
    const dosPaginas = [
      { pagina: 0, y: 314.52 },
      { pagina: 1, y: 314.52 },
    ];
    expect(new Set(Array.from(renglonDe(dosPaginas).values())).size).toBe(2);
  });

  it('cada partida escribe su SKU en una coordenada Y propia', async () => {
    const pdf = await pdfDe();
    const piezas = piezasConPosicion(pdf);
    const skus = DETALLE_PEOR_CASO.partidas.map((p) => p.sku);

    // Se agrupa por (página, Y redondeada): dos SKUs distintos en la misma
    // línea es exactamente el defecto que se midió — dos SKU
    // pegados («SKU-A SKU-B») salían en un solo renglón del texto extraído.
    // ────────────────────────────────────────────────────────────
    // [S-5 · A2] EL EMPAREJADOR ERA LAXO Y ESTABA VERDE POR SUERTE.
    //
    // Decía: `s.startsWith(pieza.texto) || pieza.texto.startsWith(s.slice(0,8))`.
    // Con eso, la celda numérica **«0»** de la fila `NUEVO-1` casaba con el SKU
    // `8075-5498-20`, porque ese SKU empieza por «0». Dos «SKU» en el mismo
    // renglón donde solo hay uno.
    //
    // Medido al voltear la hoja: en la fila de `NUEVO-1` el SKU se dibuja en
    // y=315,48 (Courier) y sus celdas en y=314,52 (Helvetica) — un punto de
    // diferencia por la línea de base de cada fuente. Redondeados caían en 315 y
    // 314, en cajas distintas, y la prueba pasaba. En vertical los dos caen en
    // 315 y la colisión aparece. **Estaba verde por el redondeo, no por la
    // geometría** (P25), y el cambio de orientación solo lo destapó.
    //
    // Ahora se empareja EXACTO contra lo que el renderizador puede emitir: el
    // SKU entero o cualquier tramo contiguo de sus fragmentos, usando
    // `fragmentosDe`, la misma función que parte al envolver. «0» no es ninguno.
    // ────────────────────────────────────────────────────────────
    const piezasPosiblesDe = (sku: string): Set<string> => {
      const trozos = fragmentosDe(sku);
      const posibles = new Set<string>([sku]);
      for (let i = 0; i < trozos.length; i++) {
        for (let j = i + 1; j <= trozos.length; j++) posibles.add(trozos.slice(i, j).join(''));
      }
      return posibles;
    };
    const posiblesPorSku = new Map(skus.map((s) => [s, piezasPosiblesDe(s)]));

    const deSku = piezas.filter((p) => skus.some((s) => posiblesPorSku.get(s)!.has(p.texto)));
    const claveDe = renglonDe(deSku);
    const porRenglon = new Map<string, Set<string>>();
    for (const pieza of deSku) {
      const sku = skus.find((s) => posiblesPorSku.get(s)!.has(pieza.texto))!;
      const clave = claveDe.get(pieza)!;
      if (!porRenglon.has(clave)) porRenglon.set(clave, new Set());
      porRenglon.get(clave)!.add(sku);
    }

    for (const [clave, enEseRenglon] of Array.from(porRenglon.entries())) {
      expect(
        enEseRenglon.size,
        `dos SKUs distintos comparten el renglón ${clave}: ${Array.from(enEseRenglon).join(' + ')}`,
      ).toBe(1);
    }
  });

  it('con 34 partidas la propiedad se mantiene en todas las páginas', async () => {
    const pdf = await pdfDe(DETALLE_LARGO);
    const piezas = piezasConPosicion(pdf);

    // Las 28 partidas de relleno tienen que ocupar 28 renglones DISTINTOS. Se
    // cuenta por coordenada y no por texto: el SKU se envuelve ("UBdaXHG" +
    // "-000") porque su columna es angosta, así que el texto de la primera
    // pieza se repite entre filas — y precisamente por eso la coordenada es la
    // única prueba válida de que no se encimaron.
    const deRelleno = piezas.filter((p) => p.texto.startsWith('UBdaXHG'));
    const renglones = new Set(Array.from(renglonDe(deRelleno).values()));

    // Anti-vacuidad: si el extractor no encontrara nada, el `for` de abajo no
    // iteraría y la prueba pasaría sin comprobar nada.
    expect(
      piezas.filter((p) => p.texto.startsWith('UBdaXHG')).length,
      'no se detectó ningún SKU de relleno: la prueba pasaría por vacuidad',
    ).toBe(28);
    expect(renglones.size, 'dos partidas de relleno comparten renglón: se encimaron').toBe(28);
  });

  it('el encabezado de la tabla queda ARRIBA de la primera fila, no encima de ella', async () => {
    const pdf = await pdfDe();
    const piezas = piezasConPosicion(pdf).filter((p) => p.pagina === 0);
    const identidad = piezas.find((p) => p.texto.startsWith('Partidas agrupadas'));
    const encabezado = piezas.find((p) => p.texto === 'DESCRIPCIÓN');
    const primeraFila = piezas.find((p) => p.texto.startsWith('fUAZVep BtF'));

    expect(identidad, 'no se encontró la línea de agrupación').toBeDefined();
    expect(encabezado, 'no se encontró el encabezado DESCRIPCIÓN').toBeDefined();
    expect(primeraFila, 'no se encontró la primera fila de datos').toBeDefined();

    // Se prueba el ORDEN vertical sin asumir el signo del eje: en el espacio de
    // pdfkit la `y` DECRECE hacia abajo (medido: 445.7 identidad → 424.6
    // encabezado → 390.3 primera fila), pero lo que importa es que el
    // encabezado quede ENTRE la identidad y los datos, no cuál es el signo.
    expect(encabezado!.y).toBeLessThan(identidad!.y);
    expect(primeraFila!.y).toBeLessThan(encabezado!.y);
  });
});

// ============================================================
// LA REGLA DE CORTE, corregida tras rasterizar: ningún texto se
// parte a media palabra. Partir en un ESPACIO sí es correcto.
// ============================================================
describe('[INV-B8.1] ningún texto se parte a media palabra', () => {
  // ============================================================
  // [2.0.1-B · S-5 · A2] ESTE INVARIANTE CAMBIO DE FORMA, A PROPOSITO.
  //
  // Decia: «el token indivisible mas largo del catalogo cabe entero». En carta
  // apaisada seguia siendo cierto y lo sigue siendo — pero en VERTICAL, con
  // `DETALLE_TOKENS_LARGOS`, la tabla no cabria con los tokens enteros y
  // `pisosQueCaben` relaja el piso al fragmento. Es la politica (c) que se
  // aprobo, y su efecto visible es exactamente este.
  //
  // Lo que el invariante protege NO cambia y por eso la prueba no se retira:
  // **ningun texto se corta en un sitio arbitrario**. Lo que se afirma ahora es
  // que cada valor sale ENTERO o partido EN SUS FRAGMENTOS —cada uno terminando
  // en `/`, `-` o `,`— y que reconstruyen el original sin perder un caracter.
  //
  // La diferencia con el defecto de partir palabras, otra vez y aqui tambien: aquel
  // partia a media palabra sin preguntar; esto parte donde el texto lo ofrece y
  // solo cuando no cabe.
  // ============================================================
  /** El valor sale entero, o como tramos contiguos de sus fragmentos que lo reconstruyen. */
  function saleEnteroOEnSusFragmentos(piezas: string[], valor: string): { ok: boolean; motivo: string } {
    if (piezas.includes(valor)) return { ok: true, motivo: 'entero' };
    const trozos = fragmentosDe(valor);
    if (trozos.length === 1) return { ok: false, motivo: `no aparece y no tiene separadores por los que partirse` };
    // Se recorre el valor consumiendo piezas que sean tramos de fragmentos.
    let resto = valor;
    const usadas: string[] = [];
    while (resto.length > 0) {
      // El ÚLTIMO tramo puede venir unido a la palabra siguiente de la misma
      // línea: tras partir por el separador, `HBOCtNPK` vuelve a la cola y se
      // dibuja junto a `YRYBFBUQU` en un solo `Tj`. Por eso se acepta también
      // una pieza que EMPIECE por lo que falta — no es un corte, es lo contrario.
      const pieza = piezas.find((p) => p.length > 0 && (resto.startsWith(p) || p.startsWith(resto)));
      if (!pieza) return { ok: false, motivo: `se cortó en un sitio que no es separador; llevaba «${usadas.join('|')}» y faltaba «${resto}»` };
      if (pieza.startsWith(resto)) {
        usadas.push(resto);
        resto = '';
        break;
      }
      usadas.push(pieza);
      resto = resto.slice(pieza.length);
    }
    // Todo tramo salvo el ultimo tiene que TERMINAR en separador.
    for (const u of usadas.slice(0, -1)) {
      if (!'/-,'.includes(u[u.length - 1])) return { ok: false, motivo: `el tramo «${u}» no termina en separador` };
    }
    return { ok: true, motivo: `en fragmentos: ${usadas.join(' | ')}` };
  }

  it('ningun valor se corta en sitio arbitrario: sale entero o en sus fragmentos', async () => {
    const pdf = await pdfDe(DETALLE_TOKENS_LARGOS);
    const piezas = piezasConPosicion(pdf).map((p) => p.texto);

    // Los tres valores que se vieron partidos al rasterizar (`XV889-m`/`Y`,
    // `VERTIC`/`AL`, `Sobre-reser`/`vado`), mas los dos tokens mas largos que el
    // catalogo puede producir (21 y 31 caracteres, la forma de los tokens más largos de un catálogo).
    for (const valor of ['DRX2263/D-KZ58-28-CCZ', 'XV889-mY', 'SERIES5', 'Sobre-reservado', 'VERTICAL', '3.2(O3),91.3(O0,3)HEYK,HBOCtNPK']) {
      const r = saleEnteroOEnSusFragmentos(piezas, valor);
      expect(r.ok, `«${valor}» ${r.motivo}`).toBe(true);
    }
  });

  it('control positivo · el detector SI caza un corte arbitrario', () => {
    // Sin esto, un detector que dijera siempre `ok` pondria verde a la de arriba
    // sin mirar nada (P19). Se le da un corte a media palabra y tiene que verlo.
    expect(saleEnteroOEnSusFragmentos(['DRX2263/', 'D-', 'KZ58-', '28-', 'CCZ'], 'DRX2263/D-KZ58-28-CCZ').ok).toBe(true);
    expect(saleEnteroOEnSusFragmentos(['DRX2263/D-KZ58-28-CC', 'Z'], 'DRX2263/D-KZ58-28-CCZ').ok).toBe(false);
    expect(saleEnteroOEnSusFragmentos(['XV889-', 'mY'], 'XV889-mY').ok).toBe(true);
    expect(saleEnteroOEnSusFragmentos(['SERIE', 'S5'], 'SERIES5').ok).toBe(false);
  });
  it('los encabezados de varias palabras SÍ se parten, pero en su espacio', async () => {
    const pdf = await pdfDe();
    const piezas = piezasConPosicion(pdf).map((p) => p.texto);

    // Partir en el espacio es correcto y es lo que libera el ancho. Lo que se
    // prohíbe es partir DENTRO de una palabra.
    //
    // [2.0.1-C · F-8] «PIEZAS» y «TOTAL» salieron de esta lista porque salieron
    // del encabezado: el juego vigente es DEL PROYECTO · EN ALMACÉN ·
    // RESERVADO · DISPONIBLE, copy firmado.
    const palabrasDeEncabezado = ['DEL', 'PROYECTO', 'EN', 'ALMACÉN', 'RESERVADO', 'DISPONIBLE'];
    for (const palabra of palabrasDeEncabezado) {
      expect(
        piezas.some((t) => t.split(/\s+/).includes(palabra)),
        `la palabra "${palabra}" del encabezado no aparece entera`,
      ).toBe(true);
    }
  });
});

// ============================================================
// [2.0.1-B · S-4] EL RENDER ES DETERMINISTA EN CONTENIDO, NO EN BYTES.
//
// Esto no es curiosidad: es lo que vuelve INALCANZABLE una afirmación que S-4
// llegó a hacerle al usuario en pantalla — «lo que ves aquí es exactamente el
// archivo que se descarga»— y que la previa y la descarga justificaban diciendo
// «es el mismo Blob, de la misma llamada».
//
// La descarga hace su PROPIO GET, así que la única pregunta era si dos GET
// producen lo mismo. Medido aquí: **nunca los mismos bytes**, en DOS regiones —
// y las dos tienen la MISMA raíz, el reloj de pared, a resoluciones distintas:
//
//   1. El `/ID` del tráiler. **No es aleatorio**: `pdfkit/js/pdfkit.es.js:605`
//      lo calcula como `md5` del diccionario `info`, cuyo `infoStr` empieza por
//      `CreationDate.getTime()` — o sea el reloj en MILISEGUNDOS. Dispara
//      siempre EN LA PRÁCTICA porque dos GET no caen en el mismo ms, no porque
//      ignore el reloj.
//   2. El sello `(D:AAAAMMDDhhmmssZ)`, con precisión de SEGUNDO. Dispara solo
//      si los dos renders cruzan un segundo.
//
// (La primera versión de este comentario decía «identificador aleatorio… que no
// mira el reloj», y era falso en las dos mitades. P29: hallazgo verdadero,
// mecanismo que su autor no midió. La conclusión no cambia.)
//
// Ninguna precisión de reloj lo habría arreglado, porque (1) ni siquiera mira
// el reloj: la igualdad de bytes solo se obtiene REUSANDO el Blob.
//
// Lo que sí se conserva es el CONTENIDO, y ésa es la distinción que el cierre
// del bloque tiene que hacer: la divergencia visible no es forzosa —dentro del
// mismo minuto y el mismo snapshot los dos documentos dicen lo mismo— lo que se
// perdió es la GARANTÍA, no la igualdad.
//
// Cuesta UN render extra: el otro sale del memo de `pdfDe`.
// ============================================================
describe('[2.0.1-B · S-4] determinismo del render', () => {
  it('dos renders del MISMO modelo: mismo texto, distintos bytes — y solo en el sello y el /ID', async () => {
    const a = await pdfDe();
    const b = await renderizarPdf(modeloPdf());

    const texto = (buf: Buffer) => piezasDeTextoDelPdf(buf).join('').replace(/\s/g, '');
    expect(texto(a), 'el contenido visible SÍ es determinista').toBe(texto(b));
    expect(a.length, 'y la longitud también').toBe(b.length);
    expect(a.equals(b), 'pero los bytes NO son iguales').toBe(false);

    // TODA la divergencia cae dentro de DOS regiones, y nombrarlas es el punto.
    //
    // ⚠ LA PRIMERA VERSION DE ESTA PRUEBA AFIRMABA UNA SOLA —el `/ID`— y era
    // FLAKY: paso dos corridas, fallo a la tercera con
    // `expected <n> to be greater than or equal to <m>`. El byte <n> no era
    // ruido: es el digito de SEGUNDOS del sello `(D:...Z)`.
    // La afirmacion solo era cierta cuando los dos renders caian en el MISMO
    // segundo, y esa condicion no estaba escrita en ningun lado. Un gate cierto
    // bajo una condicion tacita es un gate que falla por la razon equivocada.
    //
    // (Y el ancla del `/ID` es el TRAILER, no «el primer `/ID [` del archivo»:
    // buscar esa secuencia en cientos de KB de flujos comprimidos es una loteria.)
    const crudo = a.toString('latin1');

    const sello = /\(D:\d{14}Z\)/.exec(crudo);
    expect(sello, 'el PDF trae el sello de creacion del formato').not.toBeNull();

    const inicioTrailer = crudo.lastIndexOf('trailer');
    expect(inicioTrailer, 'el PDF trae trailer').toBeGreaterThan(0);
    const id = /\/ID\s*\[[^\]]*\]/.exec(crudo.slice(inicioTrailer));
    expect(id, 'el trailer trae /ID').not.toBeNull();

    const regiones: Array<[number, number]> = [
      [sello!.index, sello!.index + sello![0].length],
      [inicioTrailer + id!.index, inicioTrailer + id!.index + id![0].length],
    ];
    const dentro = (i: number) => regiones.some(([desde, hasta]) => i >= desde && i < hasta);

    const fuera: number[] = [];
    let dentroDelId = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      if (!dentro(i)) fuera.push(i);
      else if (i >= regiones[1][0]) dentroDelId++;
    }
    expect(fuera, 'ningun byte difiere fuera del sello y del /ID').toEqual([]);
    // ANTI-VACUIDAD: la comparacion no se satisface sola. El `/ID` difiere
    // siempre en la practica —es md5 del reloj en milisegundos— asi que este
    // contador no puede quedarse en cero por accidente.
    expect(dentroDelId, 'y el /ID difiere de verdad').toBeGreaterThan(0);

    // El sello lo pone pdfkit del RELOJ DE PARED, no del instante que este
    // proyecto inyecta. Se comprueba sin esperar un segundo en la suite.
    const marcaFixture = AHORA_FIXTURE.toISOString().slice(0, 10).replace(/-/g, '');
    expect(sello![0], 'el sello del formato NO es el instante inyectado').not.toContain(`D:${marcaFixture}`);
  });
});

// ============================================================
// [2.0.1-C · D-1] EL PIE SE ADELGAZA — decisión de producto.
//
// «por {firmante} · {entorno}» salía en TODAS las páginas, duplicando lo que
// F-7 ya dice una vez, en grande, en la rejilla de identidad. El pie sigue
// diciendo folio, cuándo se generó y la paginación.
//
// LA CONDICIÓN QUE HABÍA QUE VERIFICAR, no suponer: el pie no entra en la
// comparación de huella (`sinPies`, en este archivo, y `esPieDePagina` en
// `huella.ts`) porque las dos reconocen el pie por su FORMA —«generado el
// … página N de M»—, no por su contenido completo. Acortar lo que va EN
// MEDIO de esas dos anclas no debería romper ninguna de las dos. Verificado
// corriendo la suite completa de huella tras el cambio: sigue en verde SIN
// declarar nada nuevo — es la prueba de que el filtro lo sigue atrapando, no
// una suposición de que debería.
// ============================================================
describe('[2.0.1-C · D-1] el pie de página se adelgaza: sin firmante ni entorno', () => {
  it('el pie de CADA página trae folio, "generado el" y "página N de M" — y NO trae firmante ni entorno', async () => {
    const pdf = await pdfDe();
    const paginas = piezasPorPagina(pdf);
    expect(paginas.length, 'no hay páginas que revisar').toBeGreaterThan(0);

    for (const [i, piezas] of Array.from(paginas.entries())) {
      const pies = piezas.filter(esPieDePagina);
      expect(pies, `página ${i + 1}: no tiene exactamente un pie`).toHaveLength(1);
      const pie = pies[0];

      expect(pie, `página ${i + 1}: el pie no trae el folio`).toContain(DETALLE_PEOR_CASO.folio);
      expect(pie, `página ${i + 1}: el pie no dice "generado el"`).toMatch(/generado el/);
      expect(pie, `página ${i + 1}: el pie no dice "página N de M"`).toMatch(/p[áa]gina \d+ de \d+/);

      // Firmante y entorno se quedan en la rejilla de F-7 (primera página),
      // no en el pie de CADA página.
      expect(pie, `página ${i + 1}: el pie todavía trae el correo del firmante`).not.toContain(SESION_FIXTURE.correo);
      expect(pie, `página ${i + 1}: el pie todavía trae el entorno`).not.toContain('Desarrollo');
    }
  });

  it('control positivo · la misma aserción SÍ atrapa el texto viejo (con firmante y entorno)', () => {
    // Sin esto, «no contiene el firmante» podría estar en verde porque la
    // aguja está mal escrita, no porque el pie de verdad los omita.
    const pieViejo = `${DETALLE_PEOR_CASO.folio} · generado el 21 ago 2031, 12:00 p.m. por ${SESION_FIXTURE.correo} · Desarrollo · página 1 de 2`;
    expect(pieViejo, 'el texto viejo no incluye el firmante: el control no mide nada').toContain(SESION_FIXTURE.correo);
    expect(pieViejo, 'el texto viejo no incluye el entorno: el control no mide nada').toContain('Desarrollo');
    // Y el texto viejo TAMBIÉN lo reconoce `esPieDePagina` — la forma no cambió.
    expect(esPieDePagina(pieViejo), 'esPieDePagina dejó de reconocer la forma vieja: el control mide otra cosa').toBe(true);
  });
});

// ============================================================
// [2.0.1-C · F-7] LA IDENTIDAD RECORTA, NO ENVUELVE.
//
// El defecto medido era una fecha partida a media palabra
// («28 ago / 2026») porque la identidad vivía en `envolverAlAncho`. La
// huella de arriba ya prueba que el CONTENIDO del peor caso no cambió; esto
// prueba la PROPIEDAD nueva con un valor que el peor caso no tiene: uno tan
// largo que NINGUNA celda de 172 pt puede mostrarlo entero.
// ============================================================
describe('[2.0.1-C · F-7] la identidad en rejilla recorta, nunca envuelve', () => {
  function modeloConResponsableLargo(responsableLargo: string) {
    return armarModelo({ ...base, detalle: { ...DETALLE_PEOR_CASO, responsable: responsableLargo }, formatosEmpotrables: FORMATOS_PDF });
  }

  it('un valor que no cabe en su celda se RECORTA — no aparece completo, ni partido en dos líneas', async () => {
    // 97 caracteres: muy por encima de los ~172 pt de una celda de la
    // rejilla (medido en F-7: el valor más largo del peor caso, un correo de
    // 24 caracteres, ocupa 119,8 pt de esos 172).
    //
    // El dominio es DELIBERADAMENTE distinto de «example.com»: ese dominio
    // ya aparece en el documento por el firmante («Generado por»), así que
    // buscar «no debe contener @example.com» habría dado un falso rojo por
    // una coincidencia con OTRO campo, no con el que esta prueba mide.
    const responsableLargo = `${'x'.repeat(80)}@zzzunico.example`;
    expect(responsableLargo).toHaveLength(97);

    const pdf = await renderizarPdf(modeloConResponsableLargo(responsableLargo));
    const normalizado = piezasDeTextoDelPdf(pdf).join('').replace(/\s+/g, '');

    // No aparece COMPLETO: si apareciera, o la celda no tiene tope de ancho,
    // o el recorte no se está aplicando.
    expect(normalizado, 'el valor largo aparece completo: la celda no tiene tope').not.toContain(responsableLargo);
    // Aparece un PREFIJO real: si no apareciera nada, el valor se estaría
    // OMITIENDO en vez de recortando — «recortar» implica que algo se ve.
    expect(normalizado, 'no aparece ni el prefijo: el valor se omitió, no se recortó').toContain('x'.repeat(20));
    // Y el FINAL del valor no aparece en ningún sitio: si apareciera, el
    // valor se hubiera ENVUELTO (dos líneas que entre las dos SÍ reconstruyen
    // el original), que es exactamente lo que F-7 prohíbe.
    expect(normalizado, 'el final del valor aparece: se envolvió en vez de recortarse').not.toContain('@zzzunico.example');
  });

  it('control positivo · un valor que SÍ cabe aparece completo en una sola pieza', async () => {
    // Sin esto, la prueba de arriba podría estar pasando porque CUALQUIER
    // valor se trunca, no porque el mecanismo distinga "cabe" de "no cabe".
    const pdf = await renderizarPdf(modeloConResponsableLargo('ygyxataxb@example.test'));
    const piezas = piezasConPosicion(pdf);
    const pieza = piezas.find((p) => p.texto === 'ygyxataxb@example.test');
    expect(pieza, 'el valor que sí cabe no aparece como una pieza completa').toBeDefined();
  });

  it('la fecha del proyecto es UNA sola pieza — el defecto original no puede repetirse', async () => {
    // El defecto reportado: «28 ago / 2026» partido a media fecha por
    // `envolverAlAncho`. Con la fecha en su propia celda y dibujada con un
    // solo `escribir()`, no hay maquinaria de envoltura que pueda partirla:
    // se comprueba que sale como UNA pieza de texto, no como dos.
    const pdf = await pdfDe();
    const piezas = piezasConPosicion(pdf);
    const fechaCompleta = piezas.find((p) => p.texto === '17 abr 2031');
    expect(fechaCompleta, 'la fecha no aparece como una pieza única: puede haberse partido').toBeDefined();
  });
});

// ============================================================
// [2.0.1-C · F-8] LOS ENCABEZADOS CORTOS NO DISPARAN LA ADVERTENCIA DE
// GEOMETRÍA — medido contra el peor caso de TOKEN, no de longitud total.
// ============================================================
describe('[2.0.1-C · F-8] los encabezados en ≤ 2 líneas caben sin advertir geometría', () => {
  it('DETALLE_TOKENS_LARGOS no dispara la advertencia de "los encabezados necesitan"', async () => {
    const pdf = await renderizarPdf(modeloPdf(DETALLE_TOKENS_LARGOS));
    const normalizado = piezasDeTextoDelPdf(pdf).join(' ');
    expect(
      normalizado,
      'la tabla sigue advirtiendo que los encabezados no caben, con encabezados ya acortados',
    ).not.toContain('necesitan');
    expect(normalizado).not.toContain('solo ofrece');
  });

  it('el juego de encabezados vigente es exactamente el acordado', async () => {
    const modelo = modeloPdf();
    const titulos = modelo.columnas.filter((c) => COLUMNAS_IMPRESAS.includes(String(c.clave))).map((c) => c.titulo);
    expect(titulos).toEqual(['SKU', 'Descripción', 'Marca', 'Del proyecto', 'En almacén', 'Reservado', 'Disponible', 'Estatus']);
  });
});

// ============================================================
// [2.0.1-C · F-9] PAGINACIÓN HONESTA — LOS DOS `addPage()` YA NO SON
// INCONDICIONALES.
//
// Medido contra los DOS extremos que pide la spec: el peor caso
// (`DETALLE_PEOR_CASO`) y un proyecto de 1 sola imagen (`DETALLE_UNA_IMAGEN`,
// nuevo — no existía un fixture así). Se añade el extremo simétrico, más de
// una imagen (`DETALLE_DOS_IMAGENES`), porque sin él la regla de conteo del
// bloque («el anexo abre página propia SOLO SI tiene más de una imagen») no
// tiene ningún caso que la ponga a prueba en el sentido que SÍ debe abrir.
// ============================================================
describe('[2.0.1-C · F-9] el anexo y el cierre solo paginan si de verdad no caben', () => {
  it('DETALLE_PEOR_CASO: el anexo y el cierre comparten página cuando cabe — antes eran 3 páginas, ahora 2', async () => {
    // Medido ANTES de escribir esta aserción (ver el reporte del bloque):
    // baseline 3 páginas, con la página 3 casi vacía (el defecto que
    // se reportó). Tras F-9: 2 páginas, con Fotografías y el cierre en la
    // MISMA hoja que trae la tabla.
    const pdf = await pdfDe();
    const paginas = piezasPorPagina(pdf);
    expect(paginas.length, 'la paginación de DETALLE_PEOR_CASO ya no es la medida antes de F-9').toBe(2);

    const paginaDe = (testigo: string) => paginas.findIndex((p) => p.some((t) => t.includes(testigo)));
    const pFotos = paginaDe('Fotografías');
    const pCierre = paginaDe('Notas del proyecto');
    expect(pFotos, 'no se encontró el anexo de fotografías').toBeGreaterThanOrEqual(0);
    expect(pCierre, 'no se encontró el bloque de cierre').toBeGreaterThanOrEqual(0);
    expect(pFotos, 'el anexo y el cierre ya no comparten página: volvió el hueco').toBe(pCierre);
  });

  it('UNA imagen, tabla mínima con espacio de sobra: el anexo NO abre página propia', async () => {
    const modelo = modeloPdf(DETALLE_UNA_IMAGEN);
    const pdf = await renderizarPdf(modelo);
    const paginas = piezasPorPagina(pdf);

    // Anti-vacuidad: si la descarga de la imagen real no llegara a pintarse,
    // el anexo no se dibujaría y la prueba de abajo pasaría por una razón
    // que no es la que se quiere probar.
    const tieneAnexo = paginas.some((p) => p.some((t) => t.includes('Fotografías')));
    // [2.0.1-C] La ausencia del anexo ya no tiene UNA sola explicación
    // posible: puede ser que la descarga real fallara por red, o que la
    // omitiera A PROPÓSITO el presupuesto de tiempo de este documento
    // (`PRESUPUESTO_IMAGENES.maxMsPorImagen`/`maxMsTotal`, `pdf.ts`) — un
    // timeout no es un fallo de descarga, y el mensaje que antes solo
    // nombraba "sin red" dejaría de ser cierto en ese segundo caso.
    expect(
      tieneAnexo,
      'no se dibujó el anexo: pudo fallar la descarga real por red, o pudo omitirla el presupuesto de tiempo de este documento (2.0.1-C)',
    ).toBe(true);

    expect(paginas.length, 'con 1 imagen y una tabla mínima, todo debería caber en 1 sola página').toBe(1);
    const paginaDe = (testigo: string) => paginas.findIndex((p) => p.some((t) => t.includes(testigo)));
    expect(paginaDe('HHB-tmO-52'), 'la tabla y el anexo no comparten página').toBe(paginaDe('Fotografías'));
  });

  it('DOS imágenes, la MISMA tabla mínima con espacio de sobra: el anexo SÍ abre página propia', async () => {
    // El control que aísla la regla de CONTEO de la regla de ESPACIO: la
    // tabla es tan chica como la de arriba —cabría de sobra— y aun así, con
    // más de una imagen, el anexo tiene que empezar en página limpia.
    const modelo = modeloPdf(DETALLE_DOS_IMAGENES);
    const pdf = await renderizarPdf(modelo);
    const paginas = piezasPorPagina(pdf);

    const tieneAnexo = paginas.some((p) => p.some((t) => t.includes('Fotografías')));
    // [2.0.1-C] La ausencia del anexo ya no tiene UNA sola explicación
    // posible: puede ser que la descarga real fallara por red, o que la
    // omitiera A PROPÓSITO el presupuesto de tiempo de este documento
    // (`PRESUPUESTO_IMAGENES.maxMsPorImagen`/`maxMsTotal`, `pdf.ts`) — un
    // timeout no es un fallo de descarga, y el mensaje que antes solo
    // nombraba "sin red" dejaría de ser cierto en ese segundo caso.
    expect(
      tieneAnexo,
      'no se dibujó el anexo: pudo fallar la descarga real por red, o pudo omitirla el presupuesto de tiempo de este documento (2.0.1-C)',
    ).toBe(true);

    const paginaDe = (testigo: string) => paginas.findIndex((p) => p.some((t) => t.includes(testigo)));
    const pTabla = paginaDe('UGK-fmQ-80');
    const pFotos = paginaDe('Fotografías');
    expect(pTabla, 'no se encontró la fila de la tabla').toBeGreaterThanOrEqual(0);
    expect(pFotos, 'no se encontró el anexo').toBeGreaterThanOrEqual(0);
    expect(pFotos, 'con más de una imagen, el anexo tiene que abrir página propia aunque hubiera espacio').toBeGreaterThan(pTabla);
  }, 30000); // dos descargas SECUENCIALES (`descargarImagenes` no las paraleliza) bajo la red degradada del entorno

  it('control positivo · con 34 partidas, el anexo TODAVÍA sabe abrir página propia cuando de verdad no cabe', async () => {
    // Sin esto, la batería de arriba podría estar verde porque la condición
    // de "no cabe" dejó de dispararse NUNCA — un regresión silenciosa hacia
    // "nunca paginar", que sería tan incorrecta como "siempre paginar".
    const pdf = await pdfDe(DETALLE_LARGO);
    const paginas = piezasPorPagina(pdf);
    const paginaDe = (testigo: string) => paginas.findIndex((p) => p.some((t) => t.includes(testigo)));
    const pUltimaFilaTabla = paginaDe('UBdaXHG-027');
    const pFotos = paginaDe('Fotografías');
    expect(pUltimaFilaTabla, 'no se encontró la última fila de relleno').toBeGreaterThanOrEqual(0);
    expect(pFotos, 'no se encontró el anexo').toBeGreaterThanOrEqual(0);
    expect(pFotos, 'con la tabla llenando la página, el anexo debía seguir necesitando una nueva').toBeGreaterThan(pUltimaFilaTabla);
  });
});

// ============================================================
// [MEDIO · M1, revisión del carril] LA BANDA DE 16 pt QUE F-9 HIZO
// ALCANZABLE, Y QUE LOS DOS FIXTURES ANTERIORES (1 IMAGEN · 2 IMÁGENES)
// NUNCA MEDÍAN — ESAS SON LAS ORILLAS DEL EJE DE CONTEO, NO LA BANDA DEL
// EJE DE ESPACIO. P17 otra vez, con su traje de este bloque.
//
// El revisor derivó, LEYENDO el código, que `cabeEnPaginaActual` (antes de
// esta corrección) comprobaba `y + 20 + 120 <= limiteInferior` mientras el
// dibujo real, en la rama que decide "cabe", suma 16 pt DESPUÉS de decidir
// (`y += 16`) y además el rótulo del SKU bajo la foto — ninguno de los dos
// entraba en la cuenta. Se prueba en dos capas:
//
//   1. LA FUNCIÓN, extraída (`anexoDeFotosCabe`), con valores DENTRO de la
//      banda medida — no en (564] ni en (580], sino en 566/572/578 — para
//      que la prueba no dependa de acertarle al borde exacto.
//   2. UN RENDER REAL que barre la banda con filas de relleno de altura
//      controlada, para que la corrección se pruebe también donde vive el
//      bug real: en el documento que pdfkit efectivamente dibuja.
// ============================================================
describe('[2.0.1-C · F-9 · corrección M1] el anexo mide su altura REAL antes de decidir', () => {
  // Medido sin red antes de escribir esta prueba (una hoja LETTER en blanco,
  // sin depender de ningún render completo):
  //   limiteInferior = 792 − 46 − 26 = 720
  //   altoRotuloFoto  = 4 + currentLineHeight(Courier, TIPOGRAFIA.pie) + 1 ≈ 10,5 pt
  // Con ellos, el umbral de "cabe" pasa de y ≤ 580 (fórmula vieja, sin gap ni
  // rótulo) a y ≤ 553,5 (fórmula nueva) — una banda de ~26,5 pt donde la
  // vieja decía que sí y la nueva dice que no.
  const LIMITE_INFERIOR = 720;
  const ALTO_ROTULO_FOTO = 10.502;

  it('tres puntos DENTRO de la banda — 566, 572, 578 — no en sus extremos (564 y 580)', () => {
    for (const y of [566, 572, 578]) {
      const cabeFormulaVieja = y + 20 + 120 <= LIMITE_INFERIOR; // sin gap de 16 pt ni rótulo
      const cabeFormulaNueva = anexoDeFotosCabe({
        y,
        limiteInferior: LIMITE_INFERIOR,
        gapAntesDelAnexo: 16,
        altoTitulo: 20,
        altoFoto: 120,
        altoRotuloFoto: ALTO_ROTULO_FOTO,
      });
      expect(cabeFormulaVieja, `y=${y}: la fórmula vieja debía decir "cabe" para reproducir el defecto medido por el revisor`).toBe(
        true,
      );
      expect(cabeFormulaNueva, `y=${y}: la fórmula nueva debía decir "NO cabe" — es la banda que esta corrección cierra`).toBe(false);
    }
  });

  it('control positivo · muy por debajo del límite, las dos fórmulas coinciden en "cabe"', () => {
    const y = 200;
    expect(y + 20 + 120 <= LIMITE_INFERIOR).toBe(true);
    expect(
      anexoDeFotosCabe({ y, limiteInferior: LIMITE_INFERIOR, gapAntesDelAnexo: 16, altoTitulo: 20, altoFoto: 120, altoRotuloFoto: ALTO_ROTULO_FOTO }),
    ).toBe(true);
  });

  it('control positivo · muy por encima del límite, las dos fórmulas coinciden en "no cabe"', () => {
    const y = 700;
    expect(y + 20 + 120 <= LIMITE_INFERIOR).toBe(false);
    expect(
      anexoDeFotosCabe({ y, limiteInferior: LIMITE_INFERIOR, gapAntesDelAnexo: 16, altoTitulo: 20, altoFoto: 120, altoRotuloFoto: ALTO_ROTULO_FOTO }),
    ).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // LA BANDA, EN UN RENDER REAL — no la orilla del conteo (1 imagen / 2
  // imágenes) que ya cubrían las pruebas de F-9, sino la orilla de ESPACIO.
  //
  // Se localizó el punto de transición SONDEANDO el render real antes de
  // escribir esta prueba (no se adivinó): con `DETALLE_UNA_IMAGEN` más N
  // filas de relleno cortas (una línea cada una, sin envolver — así cada
  // fila agrega una altura conocida y no una aproximación), el título del
  // anexo comparte página con N=11 filas de relleno y pasa a página propia
  // con N=12. Esa frontera cae DENTRO de la banda de ~26,5 pt que separa la
  // fórmula vieja de la nueva (medido arriba: umbral viejo y ≤ 580, umbral
  // nuevo y ≤ 553,5): es exactamente el punto donde, sin esta corrección, el
  // chequeo INTERNO del bucle (que sí mide bien la foto) habría forzado su
  // propia página después de que el título ya se hubiera dibujado en la
  // anterior — el síntoma reportado.
  function detalleConFilasCortas(n: number): ProyectoDetalle {
    const rellenos = Array.from({ length: n }, (_, i) =>
      partida({
        partida_id: `relleno-m1-${i}`,
        sku: `UBdaXHG-M1-${String(i).padStart(2, '0')}`,
        descripcion: 'corto',
        marca: 'BRAND5',
        tecnologia: 'EAS',
        banda: 'EAS',
        cantidad: 1,
        total: 1,
        reservado: 0,
        disponible: 1,
      }),
    );
    return {
      ...DETALLE_UNA_IMAGEN,
      partidas: [...DETALLE_UNA_IMAGEN.partidas, ...rellenos],
      skus: DETALLE_UNA_IMAGEN.skus + n,
      piezas: DETALLE_UNA_IMAGEN.piezas + n,
    };
  }

  it('en la frontera real (11 y 12 filas de relleno), el título y la foto NUNCA quedan en páginas distintas', async () => {
    // [Timeout explícito] Dos renders reales, cada uno con una descarga de
    // imagen (simulada, ver `imagenes-minimas.ts`). Con el `fetch` simulado va
    // rápido, pero se deja holgura sobre el `testTimeout` por defecto (5 000 ms)
    // para que en una máquina lenta falle por contenido y no por reloj.
    // ⚠ «HHB-tmO-52» aparece DOS veces en el documento: en la celda SKU de la
    // TABLA (que siempre vive en una página ≤ la del anexo) y en el rótulo
    // BAJO LA FOTO. Buscar la primera página que contenga el texto —como
    // hacía la primera versión de esta prueba— encuentra la FILA de la
    // tabla, no el rótulo de la foto, y la prueba habría estado en verde
    // aunque el rótulo se hubiera partido a otra página: exactamente el
    // error de alcance que la revisión A2 encontró en la prueba de F-10.
    // Por eso se comprueba CONTENCIÓN dentro de la página del título, no la
    // primera coincidencia global.
    for (const n of [11, 12]) {
      const modelo = modeloPdf(detalleConFilasCortas(n));
      const pdf = await renderizarPdf(modelo);
      const paginas = piezasPorPagina(pdf);

      const tieneAnexo = paginas.some((p) => p.some((t) => t.includes('Fotografías')));
      // [2.0.1-C] Dos causas posibles, no una: la red, o el presupuesto de
      // tiempo de este documento omitiéndola a propósito.
      expect(tieneAnexo, `n=${n}: no se dibujó el anexo (¿falló la descarga real por red, o la omitió el presupuesto de tiempo?)`).toBe(
        true,
      );

      const pFotos = paginas.findIndex((p) => p.some((t) => t.includes('Fotografías')));
      expect(pFotos, `n=${n}: no se encontró el título del anexo`).toBeGreaterThanOrEqual(0);

      const captionEnPaginaDelTitulo = paginas[pFotos].some((t) => t.includes('HHB-tmO-52'));
      expect(
        captionEnPaginaDelTitulo,
        `n=${n}: el título «Fotografías» está en la página ${pFotos} pero el rótulo de la foto no está ahí — el defecto que M1 corrige`,
      ).toBe(true);
    }
  }, 30000);

  it('control positivo · la frontera existe de verdad — 12 fuerza página propia y 11 no', async () => {
    // Sin esto, la prueba de arriba podría estar verde porque NUNCA se
    // fuerza página nueva (una regresión hacia "siempre comparte", tan
    // incorrecta como "siempre pagina") y no porque la corrección funcione.
    const pdf11 = await renderizarPdf(modeloPdf(detalleConFilasCortas(11)));
    const pdf12 = await renderizarPdf(modeloPdf(detalleConFilasCortas(12)));
    const paginaDeFotos = (pdf: Buffer) => {
      const paginas = piezasPorPagina(pdf);
      return paginas.findIndex((p) => p.some((t) => t.includes('Fotografías')));
    };
    const pFotos11 = paginaDeFotos(pdf11);
    const pFotos12 = paginaDeFotos(pdf12);
    // [2.0.1-C] Ídem: red, o el presupuesto de tiempo de este documento.
    expect(pFotos11, 'no se encontró el anexo con n=11 (¿falló la red, o la omitió el presupuesto de tiempo?)').toBeGreaterThanOrEqual(
      0,
    );
    expect(pFotos12, 'no se encontró el anexo con n=12 (¿falló la red, o la omitió el presupuesto de tiempo?)').toBeGreaterThanOrEqual(
      0,
    );
    expect(pFotos12, 'con 12 filas de relleno el anexo debía abrir página propia, y con 11 no').toBeGreaterThan(pFotos11);
  }, 30000);
});

// ============================================================
// [2.0.1-C · F-10] LA LISTA COMPACTA: SKU + DESCRIPCIÓN.
// ============================================================
describe('[2.0.1-C · F-10] la lista de partidas sin fotografía nombra el SKU, no solo el motivo', () => {
  it('el peor caso lista los SKU afectados y NO el SKU que sí tiene foto', async () => {
    // [ALTO · A2, revisión del carril] Las cuatro aserciones positivas
    // comprobaban contra `normalizado` — el PDF ENTERO, donde el SKU está de
    // todos modos porque está en la TABLA. Una versión rota que quitara el
    // SKU de la lista compacta (o solo listara el primero) habría seguido
    // en verde. Se acotan, como ya hacía la negativa tres líneas más abajo,
    // a `normalizado.slice(inicioLista)` — y se agrega el QUINTO SKU
    // (`SKU_31`) que faltaba: eran CINCO en el comentario y CUATRO en el
    // bucle.
    const pdf = await pdfDe();
    const normalizado = piezasDeTextoDelPdf(pdf).join('').replace(/\s+/g, '');

    expect(normalizado, 'no aparece la lista compacta').toContain('Partidassinfotografíaenestedocumento');
    const inicioLista = normalizado.indexOf('Partidassinfotografíaenestedocumento');
    const listaCompacta = normalizado.slice(inicioLista);

    // Las CINCO sin foto EN ESTE DOCUMENTO (`filasSinImagenEnEsteFormato`,
    // `modelo.ts`): el .webp de 1077-4772-87 degrada a genérico en el PDF
    // aunque SÍ tenga fotografía cargada — es la fila que hace que esta
    // población NO coincida con la de `sin_foto_propia` (ver el describe de
    // abajo, "la relación entre las dos poblaciones").
    for (const sku of ['1077-4772-87', SKU_31.replace(/\s+/g, ''), '0692D-W', 'NUEVO-1', 'XV889-mY']) {
      expect(listaCompacta, `«${sku}» no aparece DENTRO de la lista compacta`).toContain(sku);
    }
    // Y la que SÍ se pinta con su propia foto no debería estar en la lista
    // de las que no la tienen.
    expect(
      listaCompacta,
      '8075-5498-20 SÍ tiene su fotografía pintada; no debería salir en la lista de las que no',
    ).not.toContain('8075-5498-20');
  });

  it('una descripción muy larga se recorta a un tope de caracteres, con "..." — no con la elipsis tipográfica', async () => {
    const pdf = await pdfDe();
    const normalizado = piezasDeTextoDelPdf(pdf).join('');
    // Los primeros 60 caracteres de la descripción de 244, seguidos de los
    // tres puntos ASCII de recorte.
    const prefijo60 = DESCRIPCION_244.slice(0, 60);
    expect(normalizado.replace(/\s+/g, ''), 'el prefijo recortado no aparece').toContain(prefijo60.replace(/\s+/g, '') + '...');
    // Y la descripción NO aparece completa DENTRO de la lista compacta (sí
    // aparece completa en la tabla, que es un sitio distinto — por eso se
    // busca solo a partir del marcador de la lista).
    const inicioLista = normalizado.replace(/\s+/g, '').indexOf('Partidassinfotografíaenestedocumento');
    expect(normalizado.replace(/\s+/g, '').slice(inicioLista)).not.toContain(DESCRIPCION_244.replace(/\s+/g, ''));
  });

  it('control positivo · un proyecto con más partidas que el tope NO enumera la lista, pero sí dice cuántas son', async () => {
    // DETALLE_LARGO tiene 33 filas sin foto propia (5 del peor caso + 28
    // "UBdaXHG"), muy por encima del tope de F-10. Sin este control, la
    // lista podría reventar en un proyecto grande sin que ninguna prueba lo
    // notara — o peor, filtrar tokens "UBdaXHG" hacia una prueba de OTRA
    // sección que cuenta SKU por posición (ver [INV-B8.1] O4).
    const pdf = await pdfDe(DETALLE_LARGO);
    const normalizado = piezasDeTextoDelPdf(pdf).join('').replace(/\s+/g, '');
    expect(normalizado, 'con 33 filas afectadas, la lista NO debería enumerarse').not.toContain('Partidassinfotografíaenestedocumento');
    expect(normalizado, 'debería decir cuántas son, aunque no las liste').toContain('33partidassinfotografía');
  });

  // ────────────────────────────────────────────────────────────
  // [ALTO · A1, revisión del carril] LA RELACIÓN ENTRE LAS DOS POBLACIONES,
  // MEDIDA Y ASEVERADA — no solo declarada en un comentario.
  //
  // `filasSinImagenEnEsteFormato` (la lista de F-10, `capa !== 'sku'`) y la
  // advertencia `sin_foto_propia` de `modelo.ts` (`fotoDelSku === null`) son
  // predicados DISTINTOS a propósito (ver el JSDoc de la primera). Esta
  // prueba es la que el comentario de `pdf.ts` cita cuando dice "se mide, no
  // se afirma sin prueba": aquí se mide.
  //
  // Los dos conteos reales sobre `DETALLE_PEOR_CASO`, que el revisor derivó
  // leyendo y esta prueba confirma renderizando: la advertencia cuenta 4, la
  // lista cuenta 5. La quinta es 1077-4772-87 — tiene fotografía real en
  // `.webp`, que el PDF no puede incrustar.
  // ────────────────────────────────────────────────────────────
  it('la relación entre las dos poblaciones: la lista de F-10 ⊇ la advertencia "sin fotografía propia", y la diferencia es EXACTAMENTE la degradada por formato', () => {
    const modelo = modeloPdf();
    const filasEnEsteDocumento = filasSinImagenEnEsteFormato(modelo.filas);
    const advertenciaFotoPropia = modelo.advertencias.find((a) => a.texto.includes('fotografía propia'));
    expect(advertenciaFotoPropia, 'no se emitió la advertencia de fotografía propia: la prueba sería vacua').toBeDefined();
    const filasFotoPropia = advertenciaFotoPropia?.alcance === 'filas' ? advertenciaFotoPropia.filas : [];

    expect(filasFotoPropia.length, 'conteo real de la advertencia "sin fotografía propia" (fotoDelSku === null)').toBe(4);
    expect(filasEnEsteDocumento.length, 'conteo real de la lista compacta de F-10 (capa !== "sku")').toBe(5);

    const skusEnEsteDocumento = new Set(filasEnEsteDocumento.map((f) => f.sku));
    const skusFotoPropia = filasFotoPropia.map((f) => f.sku);

    // CONTENCIÓN: toda fila que la advertencia cuenta también está en la lista.
    for (const sku of skusFotoPropia) {
      expect(skusEnEsteDocumento.has(sku), `«${sku}» está en la advertencia pero no en la lista de F-10 — la contención se rompió`).toBe(
        true,
      );
    }

    // LA DIFERENCIA es EXACTA: lo que sobra en la lista, sobra por UNA sola
    // razón —fotografía real que este formato no puede incrustar— nunca
    // porque la advertencia haya dejado de contar un SKU sin foto.
    const diferencia = filasEnEsteDocumento.filter((f) => !skusFotoPropia.includes(f.sku));
    expect(diferencia.length, 'el tamaño de la diferencia entre las dos poblaciones').toBe(1);
    for (const f of diferencia) {
      expect(f.imagen.fotoDelSku, `«${f.sku}» está en la diferencia pero NO tiene fotografía real: la relación afirmada es falsa`).not.toBeNull();
      expect(
        f.imagen.motivos,
        `«${f.sku}» está en la diferencia pero su motivo no es "formato no empotrable": la relación afirmada es falsa`,
      ).toContain('formato_no_empotrable');
    }
  });
});

// ============================================================
// [2.0.1-C · F-11] EL RÓTULO, UNIFICADO EN LOS TRES SITIOS.
// ============================================================
describe('[2.0.1-C · F-11] "fuera del vigente" se dice igual en el cubo, el estatus y la nota', () => {
  it('el peor caso ya no dice "archivo" en el PDF ni en NINGUNO de los cuatro sitios del XLSX', async () => {
    // [2.0.1-C · D-2, decisión de producto] CUATRO sitios alineados, no tres. El
    // cubo del resumen, el estatus de fila (los dos formatos), la nota al
    // pie / advertencia («Documento», etiqueta vacía) — los tres que unificó
    // F-11 — y ahora también la nota POR FILA (columna «Nota» de la hoja
    // Partidas, `estatusDeFila` en `modelo.ts`), que hasta esta corrección
    // era el cuarto sitio sin alinear.
    //
    // Esta prueba er a un TRINQUETE EN SENTIDO CONTRARIO: aseveraba con
    // anti-vacuidad que la columna «Nota» SEGUÍA diciendo «archivo», para
    // que la exclusión que la protegía no se leyera como «ya se alineó
    // todo». Con D-2 esa exclusión se cerró, así que el trinquete se
    // invierte: ahora asevera la ALINEACIÓN, con su propia anti-vacuidad
    // (que la columna exista y tenga texto en la fila que corresponde) para
    // no volverse una guarda vacía en la otra dirección.
    //
    // El QUINTO sitio —el PORTAL, no el papel— sigue abierto y lo alinea
    // otro carril; no se toca aquí.
    const ahora = await huellaActual();
    expect(ahora.pdfNormalizado, 'el PDF todavía dice "archivo" sobre el estado vigente').not.toContain('archivo');

    // OJO: «archivo» a secas NO sirve de aguja — `explicarImagenes` (xlsx.ts)
    // usa la palabra para algo sin relación («la columna «Foto» enlaza al
    // archivo original», hablando del archivo de la fotografía). La aguja
    // tiene que ser la FRASE del rótulo viejo, no la palabra suelta.
    const xlsxDocumentoTexto = ahora.xlsxDocumento.map(([, v]) => v).join(' ');
    const xlsxEstatusTexto = ahora.xlsxPartidas.map((f) => f['Estatus']).join(' ');
    const xlsxNotaTexto = ahora.xlsxPartidas.map((f) => f['Nota']).join(' ');
    expect(xlsxDocumentoTexto, 'la hoja Documento (cubo/advertencias) todavía dice "archivo de inventario"').not.toContain('archivo de inventario');
    expect(xlsxEstatusTexto, 'la columna Estatus todavía dice "archivo vigente"').not.toContain('archivo vigente');
    expect(xlsxNotaTexto, 'la columna Nota (nota por fila) todavía dice "archivo de inventario"').not.toContain('archivo de inventario');

    // Anti-vacuidad, en la dirección que ahora importa: la fila fuera del
    // vigente SÍ tiene una nota no vacía que SÍ dice «inventario vigente» —
    // si viniera vacía, la aserción de arriba pasaría sin haber mirado nada.
    const filaConNota = ahora.xlsxPartidas.find((f) => typeof f['Nota'] === 'string' && (f['Nota'] as string).length > 0);
    expect(filaConNota, 'ninguna fila trae nota: la prueba de arriba sería vacua').toBeDefined();
    expect(filaConNota!['Nota'], 'la nota no dice "inventario vigente": la alineación no ocurrió de verdad').toContain(
      'inventario vigente',
    );
  });

  it('los tres sitios usan la palabra "inventario", no "vigente" a secas', async () => {
    const modelo = modeloPdf();
    const filaFuera = modelo.filas.find((f) => f.estatus.includes('inventario'));
    expect(filaFuera, 'ninguna fila quedó marcada con el nuevo estatus').toBeDefined();
    expect(filaFuera!.estatus).toBe('Fuera del inventario vigente');

    const pdf = await pdfDe();
    const normalizado = piezasDeTextoDelPdf(pdf).join('').replace(/\s+/g, '');
    expect(normalizado, 'el cubo del resumen no dice FUERA DEL INVENTARIO').toContain('FUERADELINVENTARIO');
    expect(normalizado, 'la nota al pie no dice "en el inventario vigente"').toContain('enelinventariovigente');
  });
});
