// ============================================================
// [INV-B8] documento/modelo.ts — UN modelo de contenido, dos renderizadores.
//
// LA RAZÓN DE QUE ESTE ARCHIVO EXISTA. El XLSX y el PDF tienen que decir lo
// mismo. La forma barata de conseguirlo sería "que los dos llamen al mismo
// servicio", y no basta: cada renderizador seguiría decidiendo qué campo
// pinta, cómo lo redondea y qué etiqueta le pone, y bastaría con que uno
// formateara `disponible` con separador de miles y el otro no para que dos
// documentos del mismo proyecto se leyeran distinto. Aquí el contenido queda
// RESUELTO —valores, etiquetas, columnas, orden— y los renderizadores solo
// lo acomodan. Que coincidan deja de ser una promesa y pasa a ser una
// propiedad estructural: no hay dónde divergir.
//
// 100% PURO. No lee BD, no toca red, no consulta el reloj: el instante de
// generación llega como argumento. Por eso se puede probar que los dos
// documentos coinciden sin levantar nada.
//
// CERO COLUMNAS MONETARIAS (D1). No es solo que no se pinten: no existen en
// el modelo, así que un renderizador no podría imprimirlas aunque quisiera.
// `modelo.test.ts` lo verifica barriendo los títulos contra una lista de
// tokens de dinero — una guarda que falla si alguien agrega "Precio" dentro
// de seis meses.
// ============================================================
import { resolverEstatus } from '@/lib/estatus';
// Los tres formateadores salen de `lib/formato.ts`, que es UNA de las dos
// casas autorizadas para construir un formateador de fecha en este repo
// (`src/lib/una-sola-verdad-temporal.test.ts` es el alambre-trampa que lo
// vigila). `formatoFecha` para el date-only del proyecto —pinea UTC para no
// correr el dia— y `formatoFechaHora` para los timestamps reales, que se
// rinden en zona Mexico.
import { formatoNumero, formatoFecha, formatoFechaHora } from '@/lib/formato';
import type { ProyectoDetalle, PartidaItem } from '@/types/proyectos';
import {
  resolverImagen,
  resolverFirmante,
  type FirmanteResuelto,
  type ImagenResuelta,
  type EjeAgrupacion,
} from './resoluciones';

/** Banner de último recurso de la cadena D2. Archivo del repo, siempre presente. */
export const BANNER_GENERICO = 'marca/logo-principal.png';

export type TipoColumna = 'texto' | 'numero' | 'enlace';

export interface ColumnaDocumento {
  clave: keyof FilaDocumento | 'foto';
  titulo: string;
  /** Ancho en caracteres. Lo usa el XLSX tal cual y el PDF como proporción. */
  ancho: number;
  tipo: TipoColumna;
}

export interface FilaDocumento {
  sku: string;
  descripcion: string;
  marca: string;
  /** Etiqueta de la banda de agrupación (cadena D5). */
  banda: string;
  cantidad: number;
  total: number;
  reservado: number;
  disponible: number;
  /** Etiqueta ya resuelta. Ver `estatusDeFila` para el único caso en que NO es la del catálogo. */
  estatus: string;
  /** Vacía salvo que haya algo que confesar sobre esta fila. */
  nota: string;
  enRiesgo: boolean;
  /** Imagen ya resuelta por la cadena D2, con el motivo de cada degradación. */
  imagen: ImagenResuelta;
}

export interface ModeloDocumento {
  folio: string;
  titulo: string;
  descripcion: string;
  notas: string;
  tipo: string;
  intencion: string;
  /** Fecha de negocio del proyecto, ya formateada en es-MX. */
  fecha: string;

  /** De qué fecha son los números. La frase completa, lista para imprimir. */
  vigencia: string;
  /** Quién lo generó (cadena D3) y desde qué entorno. */
  firmante: FirmanteResuelto;
  /**
   * [B8.1 · O6] El DUEÑO del proyecto, que no es lo mismo que el firmante y
   * faltaba en el documento. El firmante contesta "quién generó este archivo";
   * el responsable, "de quién es este proyecto". En un documento SOBRE un
   * proyecto, la segunda es la que el lector necesita. `null` solo si el
   * proyecto quedó huérfano.
   */
  responsable: string | null;
  /** Cuándo se generó ESTE archivo. */
  generado: string;

  /** Con qué eje se agrupó, dicho en palabras. El documento declara su criterio. */
  agrupacion: string;
  ejeAgrupacion: EjeAgrupacion;

  columnas: ColumnaDocumento[];
  filas: FilaDocumento[];

  totalSkus: number;
  totalPiezas: number;

  /**
   * Como se reparten las partidas, en TRES cubos que suman `totalSkus`. Ver
   * `resumenDe`: el tercero existe porque «no-medida» no es «cubierta» ni «con
   * deficit», y absorberla en cualquiera de los dos seria mentir en el resumen
   * ejecutivo del papel.
   */
  resumen: { cubiertas: number; conDeficit: number; fueraDelVigente: number };

  /**
   * Lo que el documento tiene que confesar. Cada una trae SU predicado
   * resuelto: las de `alcance: 'filas'` saben CUÁLES filas las dispararon, y de
   * ahí salen el conteo, el superíndice del papel y el enlace del pre-vuelo —
   * una sola verdad, no tres. Ver `advertenciasDe`.
   */
  advertencias: Advertencia[];
}

export interface EntradaModelo {
  detalle: ProyectoDetalle;
  sesion: { nombre?: string | null; correo?: string | null; cuenta: string };
  entorno: string;
  /** Instante de generación. Se INYECTA: sin esto el modelo no sería puro ni comparable. */
  ahora: Date;
  /** Extensiones que el renderizador destino sabe empotrar. El XLSX no empota: enlaza. */
  formatosEmpotrables: readonly string[];
}

/**
 * El único caso en que la etiqueta del documento NO es la del catálogo.
 *
 * Para un SKU que ya no viene en el archivo vigente, `resolverEstatus`
 * devuelve "Sin stock" — correcto sobre su entrada (no hay filas de stock en
 * el snapshot pinneado) y **falso sobre la realidad**: no es que no haya
 * stock, es que el SKU no está en el archivo. Es el riesgo R-8 de la
 * investigación 2.0, escrito ahí como "el documento entregado al cliente
 * puede mentir".
 *
 * No se arregla cambiando `resolverEstatus` —la usa todo el catálogo y ahí
 * la respuesta es la correcta— sino diciendo la verdad de la procedencia en
 * el único lugar donde importa: el papel que sale hacia un cliente.
 */
function estatusDeFila(partida: PartidaItem): { estatus: string; nota: string } {
  if (partida.fuera_del_vigente) {
    return {
      estatus: ESTATUS_FUERA_DEL_VIGENTE,
      // [2.0.1-C · D-2, decisión de producto] Era «en el ARCHIVO de inventario
      // vigente». Se alinea con los otros tres sitios que ya dicen «FUERA
      // DEL INVENTARIO» / «Fuera del inventario vigente» / «en el
      // inventario vigente»: el cuarto sitio (esta nota, columna «Nota» del
      // XLSX) usa las mismas palabras. El quinto —`proyecto-partida-fila.tsx`,
      // en el portal— lo alinea otro carril.
      nota: 'Este SKU ya no aparece en el inventario vigente; sus cifras no son comparables con las del resto.',
    };
  }
  return { estatus: resolverEstatus(partida.badges, partida.disponible).label, nota: '' };
}

// ============================================================
// [2.0.1-B · S-5] LAS ADVERTENCIAS, CON UN SOLO PREDICADO CADA UNA.
//
// ────────────────────────────────────────────────────────────
// QUÉ ESTABA MAL, medido. Cada advertencia se construía con un
// `filas.filter(...).length` suelto: un CONTEO, no una referencia. El papel del
// formato 1b necesita además marcar con un superíndice **cuáles** filas afectó
// cada una, y el pre-vuelo de S-4 necesitará enlazar a esas mismas filas.
//
// Con conteos sueltos, eso obligaría a re-escribir el predicado en el
// renderizador y otra vez en el pre-vuelo: **tres verdades sobre el mismo
// hecho**, que es el patrón que este repo ya pagó cuatro veces con
// `piezas_en_camino`. Así que el predicado se escribe UNA vez y de él salen las
// tres cosas: el conteo, el superíndice y (después) el enlace.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ `alcance` Y NO UN `filas: []` VACÍO — decisión de producto, y es la regla
// de la casa: «ninguna fila coincidió» y «las filas no aplican» son VALORES
// DISTINTOS, y un arreglo vacío los confunde. La advertencia de geometría del
// PDF (la tabla no cabe) es sobre la HOJA por naturaleza, no por accidente.
// ============================================================

/**
 * El estatus que marca una fila cuyo SKU ya no viene en el archivo vigente.
 * Vive aquí porque se ESCRIBE y se LEE.
 *
 * [2.0.1-C · F-11] Era `'Fuera del archivo vigente'`. El rótulo se unifica
 * con los otros dos sitios donde el documento hablaba de esto con palabras
 * distintas —el cubo del resumen (`pdf.ts`, ahora «FUERA DEL INVENTARIO») y
 * la nota al pie (más abajo, ahora «en el inventario vigente»)—: se cambia
 * la CONSTANTE, nunca las comparaciones que la usan por valor.
 */
export const ESTATUS_FUERA_DEL_VIGENTE = 'Fuera del inventario vigente';

/**
 * Una advertencia del documento. `alcance` dice contra qué se puede resolver:
 * `'filas'` trae las filas que la dispararon —de ahí el conteo y el
 * superíndice—; `'documento'` es sobre la hoja entera y no tiene filas que
 * traer.
 */
export type Advertencia =
  | { texto: string; alcance: 'filas'; filas: FilaDocumento[] }
  | { texto: string; alcance: 'documento' };

/**
 * Las reglas, con su predicado ÚNICO. Cambiar un predicado aquí mueve el
 * conteo, el superíndice y el enlace a la vez — que es el requisito, y lo que
 * `documento.test.ts` comprueba.
 */
const REGLAS_DE_ADVERTENCIA: Array<{
  clave: string;
  predicado: (f: FilaDocumento) => boolean;
  texto: (coincidencias: FilaDocumento[], todas: FilaDocumento[]) => string;
}> = [
  {
    clave: 'fuera_del_vigente',
    predicado: (f) => f.estatus === ESTATUS_FUERA_DEL_VIGENTE,
    // [2.0.1-C · F-11] Decía «en el ARCHIVO de inventario vigente». Se quita
    // «archivo de» para usar las mismas palabras que el cubo del resumen
    // («FUERA DEL INVENTARIO») y el estatus de la fila («Fuera del
    // inventario vigente») — los tres sitios decían esto distinto.
    texto: (c) =>
      `${c.length} ${c.length === 1 ? 'SKU ya no aparece' : 'SKU ya no aparecen'} en el inventario vigente. Sus cifras vienen de una carga anterior y están marcadas fila por fila.`,
  },
  {
    clave: 'en_riesgo',
    // ────────────────────────────────────────────────────────────
    // [2.0.1-B · S-5] EXCLUYE LAS FILAS FUERA DEL VIGENTE, y no es un matiz.
    //
    // `enRiesgo` es `disponible < cantidad`. Para una fila cuyo SKU ya no viene
    // en el archivo vigente, esas cifras son de una CARGA ANTERIOR: el
    // `disponible = 0` de `0692D-W` no es una medición, es un residuo. Decir
    // «tiene menos disponible que lo comprometido» sobre ese cero afirma algo
    // que nadie midió, y lo afirma en un papel que va a un cliente.
    //
    // Medido contra `fixture-peor-caso`: de las 3 filas que `enRiesgo` marcaba,
    // UNA es `0692D-W`, que además está fuera del vigente con
    // `total=0 reservado=0 disponible=0` contra `cantidad=80`. La advertencia
    // decía 3; la verdad son 2, y de la tercera lo único cierto es que no se
    // puede saber — que es justo lo que dice la OTRA advertencia.
    //
    // Es la regla de la casa: **cero y no-medido son valores distintos.** Y es
    // también lo que vuelve a los tres cubos del resumen una PARTICIÓN de
    // verdad: sin esta exclusión, `cubiertas + déficit + fuera` contaría dos
    // veces la misma fila.
    // ────────────────────────────────────────────────────────────
    predicado: (f) => f.enRiesgo && f.estatus !== ESTATUS_FUERA_DEL_VIGENTE,
    texto: (c) =>
      `${c.length} ${c.length === 1 ? 'partida tiene' : 'partidas tienen'} menos disponible que las piezas comprometidas.`,
  },
  {
    clave: 'sin_foto_propia',
    // ────────────────────────────────────────────────────────────
    // [2.0.1-B · S-5] ESTO PREGUNTABA `f.imagen.capa !== 'sku'`, Y ERA FALSO.
    //
    // `capa` contesta «¿qué imagen pinto?» y depende de qué formatos acepta
    // CADA renderizador. `fotoDelSku` contesta «¿este SKU tiene foto?», que es
    // el hecho. Preguntando por la capa, la advertencia decía cosas distintas
    // según el formato — y en el XLSX decía una falsa: como se le pasa una
    // lista VACÍA de formatos empotrables, toda foto degrada y el predicado se
    // cumplía para TODAS las filas. Medido: el XLSX afirmaba «6 de 6 partidas
    // no tienen fotografía propia» con dos SKU que sí la tienen.
    //
    // Y no es un descubrimiento: el JSDoc de `fotoDelSku` (`resoluciones.ts`)
    // documenta EXACTAMENTE esta confusión, porque el bloque B8 ya la cometió
    // una vez y costó 0 hipervínculos en el XLSX. El arreglo de entonces llegó
    // a la columna «Foto» y no llegó aquí. **El mismo defecto, dos veces, y la
    // segunda con el aviso escrito al lado.**
    //
    // Efecto colateral que es el punto: ahora el PDF y el XLSX dicen la MISMA
    // cifra, porque la advertencia dejó de depender de quién la imprime.
    // ────────────────────────────────────────────────────────────
    predicado: (f) => f.imagen.fotoDelSku === null,
    // [S-5 · §5.2] «…y se muestran con el banner institucional» SE RETIRA, y no
    // por estilo: EL BANNER NO EXISTE. `bannerMarca` llega siempre `null`
    // (`modelo.ts`, resolución de imagen) y el renderizador solo dibuja
    // `capa === 'sku'` — o sea que estas partidas no llevan NINGUNA imagen. El
    // documento afirmaba una cosa y enseñaba otra, en un papel que va a un
    // cliente. Implementar el banner es contenido nuevo y es de otro bloque;
    // dejar de afirmarlo cuesta una línea y es lo correcto hoy.
    texto: (c, todas) =>
      `${c.length} de ${todas.length} ${c.length === 1 ? 'partida no tiene' : 'partidas no tienen'} fotografía propia.`,
  },
];

/**
 * EL RESUMEN DEL PAPEL: cómo se reparten las partidas. **Es una PARTICIÓN, y por
 * eso son TRES cubos y no dos.**
 *
 * ────────────────────────────────────────────────────────────
 * POR QUÉ TRES. Una fila cuyo SKU ya no viene en el archivo vigente **no es
 * «cubierta» ni «con déficit»: es NO-MEDIDA.** Sus tres cifras de almacén vienen
 * de una carga anterior, y con S-6 se imprimirán como «—» porque no se pueden
 * saber. Absorberla en cualquiera de los otros dos cubos sería violar «cero y
 * no-medido son valores distintos» **en el resumen ejecutivo de un papel que va
 * a un cliente** — el peor sitio posible.
 *
 * Es un cambio a la §1.3 del bloque, que pedía cuatro cifras: son cinco.
 * Esconder el tercer cubo era la violación.
 *
 * ────────────────────────────────────────────────────────────
 * Y EL ORDEN DE LAS PREGUNTAS IMPORTA. Primero «¿está fuera del vigente?» y
 * SOLO DESPUÉS «¿tiene déficit?». Al revés, `0692D-W` del peor caso —que está
 * en los dos conjuntos, con `disponible = 0` que es un residuo y no una
 * medición— se contaría dos veces y la suma no cuadraría. Sin que nadie lo
 * notara, que es lo que vuelve peligrosa a una partición mal hecha.
 */
export function resumenDe(filas: FilaDocumento[]): { cubiertas: number; conDeficit: number; fueraDelVigente: number } {
  const fueraDelVigente = filas.filter((f) => f.estatus === ESTATUS_FUERA_DEL_VIGENTE).length;
  const medibles = filas.filter((f) => f.estatus !== ESTATUS_FUERA_DEL_VIGENTE);
  const conDeficit = medibles.filter((f) => f.enRiesgo).length;
  return { cubiertas: medibles.length - conDeficit, conDeficit, fueraDelVigente };
}

/** Aplica las reglas y devuelve solo las que encontraron filas. El orden es el de `REGLAS_DE_ADVERTENCIA`. */
export function advertenciasDe(filas: FilaDocumento[]): Advertencia[] {
  const salida: Advertencia[] = [];
  for (const regla of REGLAS_DE_ADVERTENCIA) {
    const coincidencias = filas.filter(regla.predicado);
    // `filas.length > 0` era una guarda de la tercera regla y aplica a todas: sin
    // filas no hay nada que confesar sobre ellas.
    if (coincidencias.length === 0 || filas.length === 0) continue;
    salida.push({ texto: regla.texto(coincidencias, filas), alcance: 'filas', filas: coincidencias });
  }
  return salida;
}

/**
 * [2.0.1-C · F-10, corrección A1] Las filas cuya imagen NO se pinta en ESTE
 * renderizador — `capa !== 'sku'`.
 *
 * ────────────────────────────────────────────────────────────
 * NO ES LA MISMA POBLACIÓN QUE `sin_foto_propia` (arriba), Y ES DELIBERADO.
 * Hay que decirlo cada vez que las dos aparecen en el mismo papel, porque la
 * primera versión de F-10 NO lo dijo y produjo un documento que se contradice
 * a sí mismo: la nota numerada de `sin_foto_propia` decía «4 de 6» y la lista
 * compacta de abajo enumeraba 5 — el lector ve un renglón que dice cuatro y
 * cinco renglones debajo de él, en la MISMA página.
 *
 * `sin_foto_propia` pregunta un HECHO del catálogo (`fotoDelSku === null`),
 * agnóstico del renderizador: es la misma cifra en PDF y en XLSX, y por eso
 * vive en `REGLAS_DE_ADVERTENCIA` con su superíndice numerado compartido.
 *
 * Esta función pregunta algo distinto: si ESTE renderizador, con SU lista de
 * formatos empotrables, terminó pintando la foto o cayendo al genérico — que
 * es exactamente lo que decide `capa` (`resoluciones.ts`). Para el PDF esa
 * pregunta tiene una respuesta MÁS AMPLIA que «¿tiene foto?»: un SKU con
 * `.webp` SÍ tiene fotografía (`fotoDelSku` no es `null`) y aun así esta
 * función lo incluye, porque el PDF no la puede incrustar y en la página se
 * ve genérico igual que si no tuviera ninguna — sería una mentira por omisión
 * no explicar por qué esa foto tampoco aparece.
 *
 * LA RELACIÓN ENTRE LAS DOS, medida y no asumida
 * (`documento.presentacion.test.ts`, describe de F-10 · corrección A1):
 *
 *   filasSinImagenEnEsteFormato(filas) ⊇ { f : f.imagen.fotoDelSku === null }
 *
 * y la diferencia son EXACTAMENTE las filas con fotografía real que este
 * formato no puede incrustar (`imagen.motivos` incluye `formato_no_empotrable`
 * y `fotoDelSku` no es `null`).
 */
export function filasSinImagenEnEsteFormato(filas: FilaDocumento[]): FilaDocumento[] {
  return filas.filter((f) => f.imagen.capa !== 'sku');
}

/** Título de la columna de banda, DERIVADO del eje que de verdad ganó. Así el encabezado no puede mentir sobre el criterio. */
function tituloDeBanda(eje: EjeAgrupacion): string {
  if (eje === 'categoria') return 'Categoría';
  if (eje === 'tecnologia') return 'Tecnología';
  return 'Agrupación';
}

function columnasDe(eje: EjeAgrupacion): ColumnaDocumento[] {
  return [
    { clave: 'sku', titulo: 'SKU', ancho: 22, tipo: 'texto' },
    { clave: 'descripcion', titulo: 'Descripción', ancho: 46, tipo: 'texto' },
    { clave: 'marca', titulo: 'Marca', ancho: 16, tipo: 'texto' },
    { clave: 'banda', titulo: tituloDeBanda(eje), ancho: 15, tipo: 'texto' },
    // [2.0.1-C · F-8] «Piezas del proyecto» / «Total en almacén» → «Del
    // proyecto» / «En almacén», copy firmado para que el encabezado
    // quepa en ≤ 2 líneas. Ninguna de las dos palabras retiradas desaparece
    // del documento: «Piezas» sigue en el resumen de cinco cifras
    // (`pdf.ts`, rótulo `PIEZAS`) y «Total» no tenía otro uso.
    { clave: 'cantidad', titulo: 'Del proyecto', ancho: 14, tipo: 'numero' },
    { clave: 'total', titulo: 'En almacén', ancho: 14, tipo: 'numero' },
    { clave: 'reservado', titulo: 'Reservado', ancho: 12, tipo: 'numero' },
    { clave: 'disponible', titulo: 'Disponible', ancho: 12, tipo: 'numero' },
    { clave: 'estatus', titulo: 'Estatus', ancho: 24, tipo: 'texto' },
    { clave: 'nota', titulo: 'Nota', ancho: 42, tipo: 'texto' },
    { clave: 'foto', titulo: 'Foto', ancho: 10, tipo: 'enlace' },
  ];
}

/** La frase de vigencia. Es la respuesta a "¿de qué fecha son estos números?", y se imprime siempre. */
function fraseDeVigencia(tomadoEn: string | null): string {
  if (!tomadoEn) {
    return 'Sin inventario cargado: no hay cifras de disponibilidad que fechar.';
  }
  return `Disponibilidad según el inventario del ${formatoFechaHora(tomadoEn)} (hora del centro de México).`;
}

/** La frase de agrupación. El documento declara POR QUÉ eje agrupó, no solo cómo quedó. */
function fraseDeAgrupacion(eje: EjeAgrupacion, sinBanda: number): string {
  const base =
    eje === 'categoria'
      ? 'Partidas agrupadas por categoría.'
      : eje === 'tecnologia'
        ? 'Partidas agrupadas por tecnología (no existe una categoría funcional en el catálogo).'
        : 'Partidas sin agrupar: ninguna tiene categoría ni tecnología registrada.';

  if (sinBanda === 0) return base;
  return `${base} ${sinBanda} ${sinBanda === 1 ? 'partida no tiene' : 'partidas no tienen'} valor en ese eje y ${sinBanda === 1 ? 'aparece' : 'aparecen'} al final.`;
}

/**
 * Arma el modelo. Es el ÚNICO sitio donde se decide qué dice un documento;
 * los renderizadores no toman una sola decisión de contenido.
 */
export function armarModelo(entrada: EntradaModelo): ModeloDocumento {
  const { detalle, sesion, entorno, ahora, formatosEmpotrables } = entrada;

  const filas: FilaDocumento[] = detalle.partidas.map((partida) => {
    const { estatus, nota } = estatusDeFila(partida);
    return {
      sku: partida.sku,
      // Un SKU sin descripción efectiva sale con una marca explícita en vez
      // de una celda en blanco: la celda vacía se lee como error del archivo.
      descripcion: partida.descripcion?.trim() || 'Sin descripción',
      marca: partida.marca?.trim() || 'Sin marca',
      banda: partida.banda ?? 'Sin clasificar',
      cantidad: partida.cantidad,
      total: partida.total,
      reservado: partida.reservado,
      disponible: partida.disponible,
      estatus,
      nota,
      enRiesgo: partida.en_riesgo,
      imagen: resolverImagen({
        imagenSku: partida.imagen_url,
        // La capa 2 se resuelve en el caller impuro (hay que mirar el disco).
        // Hoy no existe ni un banner de marca, así que llega null siempre.
        bannerMarca: null,
        bannerGenerico: BANNER_GENERICO,
        formatosEmpotrables,
      }),
    };
  });

  // Orden de impresión: por banda y, dentro de la banda, por SKU. Las
  // partidas sin banda van al final — no mezcladas, para que su ausencia de
  // clasificación se vea como lo que es.
  filas.sort((a, b) => {
    const aSin = a.banda === 'Sin clasificar';
    const bSin = b.banda === 'Sin clasificar';
    if (aSin !== bSin) return aSin ? 1 : -1;
    if (a.banda !== b.banda) return a.banda < b.banda ? -1 : 1;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });

  const advertencias = advertenciasDe(filas);
  const resumen = resumenDe(filas);

  return {
    folio: detalle.folio,
    titulo: detalle.titulo,
    descripcion: detalle.descripcion?.trim() ?? '',
    notas: detalle.notas?.trim() ?? '',
    tipo: detalle.tipo?.trim() ?? '',
    intencion: detalle.intencion?.trim() ?? '',
    fecha: formatoFecha(detalle.fecha),

    vigencia: fraseDeVigencia(detalle.vigencia.tomado_en),
    responsable: detalle.responsable,
    firmante: resolverFirmante({
      nombre: sesion.nombre,
      correo: sesion.correo,
      cuenta: sesion.cuenta,
      entorno,
    }),
    generado: formatoFechaHora(ahora.toISOString()),

    agrupacion: fraseDeAgrupacion(detalle.agrupacion.eje, detalle.agrupacion.sinBanda),
    ejeAgrupacion: detalle.agrupacion.eje,

    columnas: columnasDe(detalle.agrupacion.eje),
    filas,

    resumen,
    totalSkus: filas.length,
    totalPiezas: filas.reduce((suma, f) => suma + f.cantidad, 0),

    advertencias,
  };
}

/** El valor de una celda, YA FORMATEADO. Lo comparten los dos renderizadores para que no puedan diferir ni en un separador de miles. */
export function celdaComoTexto(fila: FilaDocumento, columna: ColumnaDocumento): string {
  // Pregunta por el HECHO ("¿tiene foto?"), no por la capa ("¿la puedo
  // pintar?"). Con la capa, el XLSX —que enlaza en vez de pintar— decía `—`
  // para todo SKU con fotografía, porque su lista de formatos empotrables
  // está vacía por definición. Ver `ImagenResuelta.fotoDelSku`.
  if (columna.clave === 'foto') return fila.imagen.fotoDelSku ? 'Ver foto' : '—';
  const valor = fila[columna.clave as keyof FilaDocumento];
  if (typeof valor === 'number') return formatoNumero(valor);
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  return String(valor ?? '');
}
