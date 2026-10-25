// ============================================================
// [INV-B10] lib/chat/tarjeta.ts — la RESPUESTA, renderizada por el servidor.
// 100% PURA.
//
// ────────────────────────────────────────────────────────────
// AQUÍ ES DONDE «EL MODELO NO INVENTA NÚMEROS» DEJA DE SER UNA PRUEBA Y PASA A
// SER ESTRUCTURA.
//
// El brief proponía que el modelo redactara la respuesta a partir de los datos
// que el servidor le entregara, y que una prueba comprobara que no inventaba.
// Se aceptó cambiarlo por esto, que es más fuerte: **el modelo no recibe
// ningún dato de inventario.** Su único trabajo es decir qué se preguntó y
// sobre qué SKU; los números los pone este archivo.
//
// Una prueba puede fallar en un caso que nadie escribió. Una estructura donde
// el modelo no ve un número no puede fallar por ese camino.
//
// Y el efecto de segundo orden es el que más pesa: **lo único que sale del
// perímetro hacia un tercero es la frase que el KAM escribió.** No salen
// clientes, ni KAMs, ni proveedores, ni facturas, ni órdenes de compra — que es
// exactamente lo que `SkuReservaItem` y `SkuEmbarqueItem` llevan dentro.
//
// ────────────────────────────────────────────────────────────
// TODA TARJETA DICE DE DÓNDE SALIÓ. Es la regla #1 (medir antes de afirmar) y
// la #3 (nombrar el denominador) aplicadas a una conversación: `cortes` lleva
// la fecha del snapshot del que salió cada cifra. Una respuesta de inventario
// sin su corte es una cifra sin denominador.
//
// LAS LISTAS SE ACOTAN Y LO DICEN. Cortar en silencio haría que la tarjeta
// afirmara que eso fue todo — la misma regla que el correo de B9.1.
// ============================================================
import type { RespuestaRedactada } from './redaccion';
import { formatoNumero, formatoFecha, formatoFechaDeTimestamp } from '@/lib/formato';
import type { CatalogoPage, EmbarquesResponse, SkuDetalle } from '@/types/api';
import { INTENCIONES, type Intencion } from './intenciones';
import { notaDeRelevo, nombreLegible } from './voz';

/**
 * La forma `{tag, code}` es la que ya modelaba la maqueta XUI, y se adoptó
 * desde el principio **para que el día que existiera el corpus documental se
 * agregara su etiqueta sin tocar nada de esto**.
 *
 * [INV-B11] Ese día llegó, y la apuesta salió: la segunda etiqueta costó
 * exactamente una línea aquí.
 */
export type EtiquetaFuente =
  | 'Inventario en vivo'
  | 'Ficha técnica'
  // [INV-B11] O6 · las conceptuales traen dos procedencias más, y una es
  // DISTINTA de las anteriores en algo que importa: `Tus proyectos` es dato
  // ORIGINADO por el usuario y acotado por RLS a quien pregunta, no inventario
  // compartido. Pintarlo con la misma etiqueta que el stock diría que
  // cualquiera ve lo mismo, y no es verdad.
  | 'Tus proyectos'
  | 'Libro de cargas';

export interface Fuente {
  tag: EtiquetaFuente;
  /** Qué se consultó: un SKU, `embarques`, `catálogo`. */
  code: string;
}

/** De qué corte salió una cifra. Sin esto, un número no tiene denominador. */
export interface Corte {
  fuente: 'stock' | 'aduana';
  /** ISO del `created_at` del snapshot. Se formatea al pintar. */
  cuando: string;
}

export interface FilaDato {
  etiqueta: string;
  valor: string;
  /** Para el número que contesta la pregunta, que no puede perderse entre los otros. */
  enfasis?: boolean;
}

export interface RenglonLista {
  principal: string;
  secundario: string;
  /**
   * SKU al que enlaza este renglón, si lo hay.
   *
   * Va como campo y no se deduce de `principal` porque **no todos los renglones
   * son SKU**: los de `llegada` llevan la etapa del embarque y los de
   * `disponibilidad` llevan el cliente. Deducirlo por la forma del texto sería
   * adivinar, y un enlace a `/catalogo/RETAILER9` es peor que no tener enlace.
   *
   * Existe por un hallazgo de la QA manual: la tarjeta listaba varios SKU sin poder
   * hacer clic, **rompiendo una convención que el resto del portal ya respeta**
   * (el mapa de calor dice «clic en una celda abre esa marca en el catálogo»).
   */
  sku?: string;
}

export interface Tarjeta {
  intencion: Intencion;
  titulo: string;
  datos: FilaDato[];
  lista: RenglonLista[];
  /** Lo que hay que decir y no cabe en un par etiqueta/valor. */
  nota: string | null;
  /**
   * [CHAT-B4] LO QUE EL LECTOR TIENE QUE LEER **ANTES** DE LA RESPUESTA.
   *
   * ────────────────────────────────────────────────────────────
   * EXISTE PORQUE `nota` SE PLIEGA, Y ESO SE MIDIÓ.
   *
   * Desde B2 el andamiaje vive dentro de un `<details>` cerrado cuando hay
   * prosa — decisión correcta y firmada: «Documentos 4», el verbatim y la ruta
   * del vault son estado interno del recuperador, no la respuesta. Pero `nota`
   * se fue plegada con ellos, y `nota` llevaba dentro **dos declaraciones que no
   * son andamiaje**:
   *
   *   · el SALTO del relevo — «no tengo la ficha de X, ésta es la de al lado»
   *   · el AVISO de ambiente/referente — «contesté sobre el SKU que venías viendo»
   *
   * Medido en QA manual sobre `:3002`: con «¿qué es el CLIP 3.0?» la
   * frase del salto sale **TRUE en `innerHTML` y FALSE en `innerText`**. El KAM
   * lee un título con CLIP 3.0 y debajo las specs del 2.0, y puede ponerlas
   * delante de un cliente creyendo que son del producto que preguntó.
   *
   * ⇒ `LA-GARANTIA-CORRECTA-EN-LA-SUPERFICIE-EQUIVOCADA`. **Una afirmación sólo
   * cuenta donde el cliente la lee.** El reporte anterior comprobó el OBJETO de
   * respuesta, que sí la traía; el objeto no es la pantalla.
   *
   * ────────────────────────────────────────────────────────────
   * POR QUÉ UN CAMPO NUEVO Y NO «SACAR `nota` DEL DETALLE»:
   *
   * Sacar `nota` entera devolvería a la vista **«la asociación entre la familia
   * y el documento es una propuesta automática que todavía no revisa un
   * humano»** — que B2 plegó a propósito y está firmado, y que hoy sale en
   * todas las fichas con prosa porque ningún renglón del puente está
   * revisado. Lo que cambia de sitio no es la nota: es **la clase de cosa que
   * cambia lo que la respuesta significa**. Separarlas en dos campos vuelve la
   * distinción estructural en vez de dejarla al criterio de quien escriba la
   * siguiente cadena de texto.
   *
   * 🔴 Esta línea citaba TAMBIÉN «Se muestran N de M SKU», y era falso —lo
   * midió la revisión adversaria de este mismo bloque—. `notaDeResto` sólo la
   * produce desde ocho constructoras que fijan `respuesta: null`, y con
   * `open={!tarjeta.respuesta}` eso significa que esa frase **nunca está
   * plegada**: ya se ve siempre. La decisión no cambia; la justificación tenía
   * una mitad sin medir, que es P28 dentro del bloque que existe justamente
   * porque una garantía vivía donde nadie la lee.
   *
   * **Requerido y no opcional, por el mismo motivo que `respuesta`** (P24): un
   * campo opcional lo ignoran doce constructoras en silencio y nadie lo echa de
   * menos. Así, una tarjeta nueva no puede nacer sin decidir si avisa de algo.
   */
  aviso: string | null;
  fuentes: Fuente[];
  cortes: Corte[];
  /**
   * [INV-B11] Contenido textual **VERBATIM**, tal cual está en el documento.
   *
   * No es prosa generada y por eso no espera al interruptor de O5: es el texto
   * de la ficha, copiado. La distinción importa —**una cita es verificable y un
   * resumen no**— y por eso el campo se llama así y no `resumen`.
   *
   * `undefined` en las seis tarjetas de inventario: ahí no hay documento que
   * citar, hay cifras derivadas.
   */
  texto?: string;
  /**
   * [CHAT-B1] La PROSA que el modelo redactó desde lo entregado, ya verificada.
   *
   * **Requerido y no opcional, a propósito.** Un campo opcional lo ignoran once
   * constructoras en silencio y nadie lo echa de menos: es P24 exacto —la media
   * función que se ve igual que la completa—. Así, cada tarjeta tiene que DECIR
   * que no redacta, y una tarjeta nueva no puede nacer sin decidirlo.
   *
   * `null` en las once que no son documentales, y también en las documentales
   * cuando la guarda mordió: ahí se enseña el verbatim, que sigue siendo verdad.
   *
   * Y NO sustituye a `texto`: los dos viajan. La prosa es contrastable contra el
   * verbatim que tiene al lado, y ésa es la única contramedida real contra la
   * paráfrasis, que la contención por anclaje no cubre.
   */
  respuesta: RespuestaRedactada | null;
}

/** Tope de renglones de lista. Se declara cuando corta; no se corta callado. */
export const TOPE_LISTA = 10;

const VIVO: EtiquetaFuente = 'Inventario en vivo';

function acotar<T>(xs: T[]): { visibles: T[]; resto: number } {
  return { visibles: xs.slice(0, TOPE_LISTA), resto: Math.max(0, xs.length - TOPE_LISTA) };
}

function notaDeResto(resto: number, unidad: string): string | null {
  return resto > 0 ? `Se muestran ${TOPE_LISTA} de ${formatoNumero(resto + TOPE_LISTA)} ${unidad}.` : null;
}

function corteStock(iso: string | null): Corte[] {
  return iso ? [{ fuente: 'stock', cuando: iso }] : [];
}
function corteAduana(iso: string | null): Corte[] {
  return iso ? [{ fuente: 'aduana', cuando: iso }] : [];
}

// ------------------------------------------------------------
// LAS TRES QUE NECESITAN UN SKU
// ------------------------------------------------------------

/**
 * «¿Cuándo llega X?»
 *
 * Se miran SOLO los embarques activos: uno histórico ya cerró su ciclo y
 * responder con él sería decir que algo viene en camino cuando ya llegó.
 */
export function tarjetaLlegada(d: SkuDetalle, cuandoAduana: string | null): Tarjeta {
  const activos = d.embarques.filter((e) => !e.is_historial);
  const { visibles, resto } = acotar(activos);

  const datos: FilaDato[] = [
    { etiqueta: 'En camino', valor: `${formatoNumero(d.piezas_en_camino)} pz`, enfasis: true },
    { etiqueta: 'Embarques activos', valor: formatoNumero(activos.length) },
  ];

  const retrasados = activos.filter((e) => e.retrasado).length;
  if (retrasados > 0) {
    datos.push({ etiqueta: 'Retrasados', valor: `${formatoNumero(retrasados)} contra su ETA`, enfasis: true });
  }

  // Un SKU sin nada en camino es una respuesta legítima y frecuente, no un
  // hueco: la mayoría de las 11 etapas del pipeline están vacías en cualquier momento.
  const nota =
    activos.length === 0
      ? 'No hay nada en camino para este SKU en el corte vigente de aduana.'
      : notaDeResto(resto, 'embarques activos');

  return {
    intencion: 'llegada',
    respuesta: null,
    aviso: null,
    titulo: `Cuándo llega ${d.sku}`,
    datos,
    lista: visibles.map((e) => ({
      principal: e.estatus,
      secundario: [
        e.piezas === null ? null : `${formatoNumero(e.piezas)} pz`,
        e.eta ? `ETA ${formatoFecha(e.eta)}` : 'sin ETA',
        e.fecha_llegada ? `llegó ${formatoFecha(e.fecha_llegada)}` : null,
        e.retrasado ? 'retrasado' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    nota,
    fuentes: [{ tag: VIVO, code: d.sku }],
    cortes: corteAduana(cuandoAduana),
  };
}

/**
 * «¿Cuánto hay y quién lo tiene reservado?»
 *
 * `disponible`, `total` y `reservado` salen de `derivarSku` y de ningún otro
 * lado: aquí no se resta nada. Es el invariante de siempre — `reservado` es
 * `productos.resv`, NUNCA la suma de la tabla `reservas`, así que la lista de
 * abajo puede no sumar exactamente el número de arriba y eso NO es un error.
 */
export function tarjetaDisponibilidad(d: SkuDetalle, cuandoStock: string | null): Tarjeta {
  const { visibles, resto } = acotar(d.reservas);

  const datos: FilaDato[] = [
    { etiqueta: 'Disponible', valor: `${formatoNumero(d.disponible)} pz`, enfasis: true },
    { etiqueta: 'Total', valor: `${formatoNumero(d.total)} pz` },
    { etiqueta: 'Reservado', valor: `${formatoNumero(d.reservado)} pz` },
  ];

  const notas: string[] = [];
  if (d.sobre_reservado) {
    notas.push('Está sobre-reservado: hay más comprometido que existencia.');
  }
  if (d.reserva_descuadre) {
    notas.push('El reservado del producto no cuadra con la suma de sus reservas; manda el del producto.');
  }
  if (d.reservas.length === 0) {
    notas.push('Nadie tiene reservas registradas sobre este SKU en el corte vigente.');
  }
  const resumenResto = notaDeResto(resto, 'reservas');
  if (resumenResto) notas.push(resumenResto);

  return {
    intencion: 'disponibilidad',
    respuesta: null,
    aviso: null,
    titulo: `Disponibilidad de ${d.sku}`,
    datos,
    lista: visibles.map((r) => ({
      principal: r.cliente,
      secundario: [`${formatoNumero(r.cantidad)} pz`, r.kam ?? 'sin KAM', r.motivo].filter(Boolean).join(' · '),
    })),
    nota: notas.length ? notas.join(' ') : null,
    fuentes: [{ tag: VIVO, code: d.sku }],
    cortes: corteStock(cuandoStock),
  };
}

/** «¿Qué familias tiene?» — la clasificación EFECTIVA (override > v2 > fuente). */
export function tarjetaClasificacion(d: SkuDetalle, cuandoStock: string | null): Tarjeta {
  const datos: FilaDato[] = [
    { etiqueta: 'Marca', valor: d.marca || '—' },
    {
      etiqueta: d.familias_efectivas.length === 1 ? 'Familia' : 'Familias',
      valor: d.familias_efectivas.length ? d.familias_efectivas.join(' · ') : 'sin familia',
      enfasis: true,
    },
    { etiqueta: 'Clase', valor: d.clase ?? '—' },
    { etiqueta: 'Tecnología', valor: d.tecnologia ?? '—' },
  ];

  return {
    intencion: 'clasificacion',
    respuesta: null,
    aviso: null,
    titulo: `Clasificación de ${d.sku}`,
    datos,
    lista: [],
    nota: d.descr_efectiva ? d.descr_efectiva : null,
    fuentes: [{ tag: VIVO, code: d.sku }],
    cortes: corteStock(cuandoStock),
  };
}

// ------------------------------------------------------------
// LAS TRES QUE NO NECESITAN SKU — las que la maqueta pedía y el brief no traía
// ------------------------------------------------------------

/** «¿Qué hay en aduana?» / «¿qué viene en camino?» */
export function tarjetaPipeline(r: EmbarquesResponse): Tarjeta {
  const { visibles, resto } = acotar(r.items);

  const datos: FilaDato[] = [
    { etiqueta: 'Embarques activos', valor: formatoNumero(r.resumen.activos), enfasis: true },
    { etiqueta: 'Piezas en camino', valor: `${formatoNumero(r.resumen.piezas_activas)} pz` },
    { etiqueta: 'Retrasados', valor: formatoNumero(r.resumen.retrasados) },
  ];

  const notas: string[] = [];
  if (r.resumen.activos === 0) notas.push('No hay nada activo en el corte vigente de aduana.');
  const rr = notaDeResto(resto, 'renglones');
  if (rr) notas.push(rr);

  return {
    intencion: 'pipeline',
    respuesta: null,
    aviso: null,
    titulo: 'Lo que viene en camino',
    datos,
    lista: visibles.map((e) => ({
      principal: e.sku ?? '—',
      ...(e.sku ? { sku: e.sku } : {}),
      secundario: [
        e.estatus,
        e.piezas === null ? null : `${formatoNumero(e.piezas)} pz`,
        e.eta ? `ETA ${formatoFecha(e.eta)}` : null,
        e.retrasado ? 'retrasado' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    nota: notas.length ? notas.join(' ') : null,
    fuentes: [{ tag: VIVO, code: 'embarques' }],
    cortes: r.snapshot ? corteAduana(r.snapshot.created_at) : [],
  };
}

/** «¿Qué SKUs están sobre-reservados?» */
export function tarjetaSobreReservados(p: CatalogoPage, cuandoStock: string | null): Tarjeta {
  const { visibles, resto } = acotar(p.items);

  return {
    intencion: 'sobre_reservados',
    respuesta: null,
    aviso: null,
    titulo: 'SKU sobre-reservados',
    datos: [{ etiqueta: 'Cuántos', valor: formatoNumero(p.total), enfasis: true }],
    lista: visibles.map((i) => ({
      principal: i.sku,
      sku: i.sku,
      secundario: [
        `disponible ${formatoNumero(i.disponible)}`,
        `reservado ${formatoNumero(i.reservado)}`,
        i.descripcion,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    nota:
      p.total === 0
        ? 'Ninguno está sobre-reservado en el corte vigente.'
        : notaDeResto(resto, 'SKU'),
    fuentes: [{ tag: VIVO, code: 'catálogo' }],
    cortes: corteStock(cuandoStock),
  };
}

/**
 * «Busca los CLIPS» — resolver un nombre a SKU.
 *
 * Medido sobre el catálogo real **por `listInventory`, que es la función que
 * corre aquí**: esto es casi siempre 1-a-N, no 1-a-1 (un término puede dar muchos SKU,
 * unos pocos o ninguno). Por eso la tarjeta enumera y no
 * elige: elegir por el usuario sería adivinar, que es justo lo que el bloque
 * prohíbe.
 */
export function tarjetaBusqueda(p: CatalogoPage, termino: string, cuandoStock: string | null): Tarjeta {
  const { visibles, resto } = acotar(p.items);

  return {
    intencion: 'buscar_por_nombre',
    respuesta: null,
    aviso: null,
    titulo: `Lo que encontré para «${termino}»`,
    datos: [{ etiqueta: 'Coincidencias', valor: formatoNumero(p.total), enfasis: true }],
    lista: visibles.map((i) => ({
      principal: i.sku,
      sku: i.sku,
      secundario: [i.descripcion, i.marca, `disponible ${formatoNumero(i.disponible)}`].filter(Boolean).join(' · '),
    })),
    nota:
      p.total === 0
        ? `No hay ningún SKU cuyo nombre o descripción contenga «${termino}».`
        : notaDeResto(resto, 'SKU'),
    fuentes: [{ tag: VIVO, code: 'catálogo' }],
    cortes: corteStock(cuandoStock),
  };
}

// ============================================================
// [INV-B11] O5 · LA TARJETA DOCUMENTAL.
//
// Es la única que trae `texto`, y la única cuya `fuente` no es inventario. Lo
// que la separa de las seis no es el formato: es **de dónde sale lo que dice**.
//
// LAS CIFRAS DE LAS OTRAS SEIS SE DERIVAN; ESTO SE CITA. Y por eso el texto va
// VERBATIM: un resumen se puede contrastar con la ficha y no coincidir, y
// entonces el usuario no sabría a cuál creerle. Copiado, la ficha y la
// respuesta son la misma cosa.
//
// LO QUE VA EN LA NOTA NO ES ADORNO. Dos cosas que el usuario no puede deducir
// mirando el texto:
//
//   · si la asociación familia→ficha **la revisó un humano** o es una propuesta
//     automática. Hoy están sin revisar, así que la nota aparece siempre
//     — y desaparecerá sola conforme se revise.
//   · de qué VERSIÓN del corpus salió. `local-sin-git` significa que la
//     procedencia no se puede verificar, y eso también se dice.
// ============================================================

export interface FichaParaTarjeta {
  /** `null` cuando se llegó por el NOMBRE de la familia (puerta 2), no por un SKU. */
  sku: string | null;
  familia: string;
  titulo: string | null;
  /** `null` = **sin PDF de origen**. Se DICE; omitirlo se lee como «no hay nada que citar». */
  fuentePdf: string | null;
  commitSha: string;
  revisada: boolean;
  trozos: { orden: number; rutaSeccion: string; texto: string }[];
}

export function tarjetaDocumental(f: FichaParaTarjeta, respuesta: RespuestaRedactada | null = null): Tarjeta {
  const notas: string[] = [];
  if (!f.revisada) {
    // [CHAT-B1] Con PROSA encima, esta nota pesa más que antes y por eso se
    // redacta distinta. Medido: **ningún renglón del puente
    // está revisado por un humano**, así que no es un caso de borde — es el
    // caso. Y una prosa redactada desde una ficha mal puenteada suena MÁS
    // autoritativa que el verbatim, que al menos se ve ajeno.
    notas.push(
      respuesta
        ? 'Contesté desde esta ficha, pero la asociación entre la familia y el documento es una propuesta automática que todavía no revisa un humano.'
        : 'La asociación entre la familia y esta ficha es una propuesta automática que todavía no revisa un humano.',
    );
  }
  if (f.commitSha === 'local-sin-git') {
    notas.push('El corpus se indexó desde una copia local, así que la versión del documento no se puede verificar.');
  }

  return {
    intencion: 'documental',
    respuesta,
    aviso: null,
    titulo: `Ficha de ${f.titulo ?? f.familia}`,
    datos: [
      { etiqueta: 'Familia', valor: f.familia },
      { etiqueta: 'Secciones', valor: formatoNumero(f.trozos.length) },
    ],
    // La lista son las SECCIONES, no el contenido: sirve para saber qué trae la
    // ficha sin leerla entera. Ninguna enlaza a `/catalogo` — no son SKU.
    lista: f.trozos.map((t) => ({ principal: t.rutaSeccion, secundario: '' })),
    nota: notas.length > 0 ? notas.join(' ') : null,
    // El `code` es la CITA. Sin PDF se dice con esas palabras en vez de omitirla.
    fuentes: [{ tag: 'Ficha técnica', code: f.fuentePdf ?? 'sin PDF de origen' }],
    // Una ficha no sale de un snapshot: no tiene corte de stock ni de aduana, y
    // poner uno sería atribuirle una fecha que no le corresponde.
    cortes: [],
    texto: f.trozos.map((t) => t.texto).join('\n\n'),
  };
}

/**
 * [INV-B11] O6 · PUERTA 3 — lo que el corpus dice sobre un tema.
 *
 * NO ES UNA FICHA Y NO SE DISFRAZA DE UNA. Una ficha es *la* documentación de
 * una familia; esto son **fragmentos de varios documentos que mencionan algo**.
 * El título lo dice («Lo que encontré sobre…») y la nota lo repite, porque la
 * diferencia importa: de una ficha uno se fía entera, de un hallazgo uno lee la
 * cita.
 *
 * CADA DOCUMENTO TRAE SU CITA, y por eso `fuentes` lleva una entrada por
 * documento en vez de una sola. Juntar tres documentos bajo una cita sería
 * atribuirle a uno lo que dijo otro.
 */
export function tarjetaHallazgos(
  consulta: string,
  docs: {
    ruta: string;
    titulo: string | null;
    fuentePdf: string | null;
    fragmentos: { seccion: string; texto: string }[];
  }[],
  /**
   * [CHAT-B1] La prosa cita UN documento —el mejor— aunque la lista traiga
   * varios. No es una omisión: una `RespuestaRedactada` sólo se puede construir
   * desde una `Entrega`, y una `Entrega` es de un documento. Atribuirle a la
   * prosa las tres citas de la lista sería decir que salió de las tres.
   */
  respuesta: RespuestaRedactada | null = null,
  /**
   * [CHAT-B4] QUÉ SE PIDIÓ, cuando esto es un RELEVO y no una búsqueda.
   *
   * `null` = búsqueda normal: el usuario preguntó por un tema y esto es lo que
   * el corpus dice de ese tema. Con valor = **el usuario pidió otra cosa** y
   * esto es lo más cercano que había.
   *
   * ────────────────────────────────────────────────────────────
   * EL TÍTULO Y EL AVISO SE DERIVAN AQUÍ, JUNTOS, Y ESO ES EL ARREGLO.
   *
   * El defecto de B4-1 no fue que faltara la frase: la frase existía y la
   * ponía el servicio por fuera. **Un título que no distingue «ésta es tu
   * ficha» de «ésta es la más parecida» más una declaración que el llamador
   * puede olvidar es dos hechos sin nada que los ate.** Derivados los dos del
   * mismo argumento, un relevo sin su aviso es inexpresable — que es el
   * antídoto estructural de P25 que la casa ya usó en `entrega.ts` con
   * `camino`.
   */
  relevoDe: string | null = null,
): Tarjeta {
  return {
    intencion: 'documental',
    respuesta,
    // [CHAT-B4] B4-1 · LA DECLARACIÓN DEL SALTO, en el campo que NO se pliega.
    aviso: relevoDe ? notaDeRelevo(relevoDe, docs[0]?.titulo ?? nombreLegible(docs[0]?.ruta ?? relevoDe)) : null,
    // [CHAT-B4] B4-1 · UN TÍTULO POR SITUACIÓN. «Lo que encontré sobre «X»» era
    // el mismo para una búsqueda normal y para un relevo, y con el nombre de la
    // FAMILIA dentro se leía como si esa familia fuera lo preguntado.
    titulo: relevoDe ? `Lo más cercano que tengo a «${relevoDe}»` : `Lo que encontré sobre «${consulta}»`,
    // [CHAT-B4] B4-2 · «Documentos N» FUERA. Es el ⛔ literal del SOUL §7, y el
    // `<details>` no lo tapaba en el caso que importa: se pliega **sólo cuando
    // hay prosa**, así que el camino que peor contesta era justo el que más
    // enseñaba sus tripas. Y no se pierde nada: cuántos documentos hay se ve
    // contando la lista que está debajo.
    datos: [],
    // La lista son los DOCUMENTOS con su sección: sirve para saber de dónde
    // salió cada cosa antes de leerla. Ninguno enlaza a `/catalogo` — no son SKU.
    lista: docs.map((d) => {
      const principal = d.titulo ?? d.ruta;
      const secciones = d.fragmentos.map((f) => f.seccion).join(' · ');
      // [CHAT-B4] B4-2 · EL RENGLÓN QUE SE LEÍA COMO UN DOCUMENTO REPETIDO.
      //
      // 🔴 Y aquí el hallazgo decía otra cosa de la que se midió.
      // Se reportó «un documento repetido en la lista» sobre `Series1 UL4 · Series1
      // UL4`. Medido contra la base: **NO hay ningún título compartido por dos
      // rutas**, y `buscarEnCorpus` ya agrupa por `ruta` con un `Map`.
      // Lo repetido no eran dos documentos: era UN renglón cuyo título y cuya
      // única sección son la misma cadena, que es lo normal en un documento de
      // un solo trozo — casi todos lo son.
      //
      // ⇒ Deduplicar documentos habría sido el resultado correcto por la razón
      // equivocada, y habría borrado un documento real el día que dos compartan
      // título. Lo que sobra es la repetición en pantalla, y es lo que se quita.
      return { principal, secundario: secciones === principal ? '' : secciones };
    }),
    nota:
      'Son fragmentos de la documentación que mencionan eso, no la ficha de un producto. ' +
      'Si buscas la ficha completa, dime el SKU o el nombre de la familia.',
    // UNA CITA POR DOCUMENTO. `sin PDF de origen` se dice con esas palabras en
    // vez de omitirse: una cita ausente en silencio se lee como que no hay nada
    // que citar.
    fuentes: docs.map((d) => ({ tag: 'Ficha técnica' as const, code: d.fuentePdf ?? 'sin PDF de origen' })),
    // Un documento no sale de un snapshot. Ponerle corte de stock sería
    // atribuirle una fecha que no le corresponde.
    cortes: [],
    texto: docs
      .map((d) => d.fragmentos.map((f) => f.texto).join('\n\n'))
      .join('\n\n---\n\n'),
  };
}

/** Texto del corte, para pintarlo bajo la tarjeta. Timestamps ⇒ zona México. */
// ============================================================
// [INV-B11] O6 · LAS CUATRO CONCEPTUALES.
//
// Contestan sobre el SISTEMA y sobre TI, no sobre un producto. Y por eso
// ninguna lleva corte de stock salvo la que de verdad depende de él: un corte
// pegado a «qué puedo hacer» sería decoración con forma de rigor.
// ============================================================

/**
 * «¿Qué puedes hacer?» — **la que ya tenía su respuesta y contestaba «no sé».**
 *
 * Sale del MISMO catálogo del que sale el zero-state y del que sale la
 * enumeración del «no sé». Tres superficies, una fuente: si mañana entra una
 * intención nueva, las tres la anuncian sin que nadie las toque.
 *
 * `fuentes` y `cortes` van VACÍOS a propósito. Esta tarjeta no leyó la base, y
 * ponerle una procedencia para que se vea igual que las otras sería inventarle
 * un respaldo que no tiene — la regla #1 al revés.
 */
export function tarjetaCapacidades(): Tarjeta {
  return {
    intencion: 'capacidades',
    // Ni aquí ni en ninguna otra: `capacidades` es la ÚNICA que no lee nada, así
    // que tampoco hay nada que redactar. Es la respuesta más honesta que puede
    // dar el sistema sobre sí mismo.
    respuesta: null,
    aviso: null,
    titulo: 'Esto es lo que sé contestar',
    datos: [],
    lista: INTENCIONES.map((i) => ({
      principal: i.sugerencia.texto,
      secundario: i.descripcion,
    })),
    // ────────────────────────────────────────────────────────
    // [CHAT-B1] DECLARA DE DÓNDE SALE CADA COSA Y QUÉ NO SABE.
    //
    // Antes decía sólo «cualquier otra cosa te la voy a decir en vez de
    // inventarla», que es verdad y es insuficiente: no decía de dónde salen las
    // respuestas, y con dos fuentes distintas —la base y el corpus— eso pasó a
    // importar. Un usuario que no sabe que lo documental sale de un corpus no
    // entiende por qué el sistema sabe de un producto y no del de al lado.
    //
    // Y dice que el corpus CRECE, que es lo que evita la conclusión equivocada:
    // «no tiene ficha» no es «nunca la tendrá». Hoy hay un buen número de documentos de
    // producto; entran solos por el sincronizador, sin tocar código.
    nota:
      'Las preguntas de inventario —cuánto hay, qué viene en camino, qué está sobre-reservado— ' +
      'salen de la base y son cifras exactas. Las de producto las contesto leyendo su ficha técnica, ' +
      'y siempre te digo de qué documento la saqué. Si un producto todavía no tiene ficha, te lo digo: ' +
      'la documentación crece, así que lo que hoy no está puede estar mañana. ' +
      'Cualquier otra cosa te la voy a decir en vez de inventarla.',
    fuentes: [],
    cortes: [],
  };
}

/**
 * «¿Qué se movió en lo que sigo?» — el resumen de lo destacado.
 *
 * **No re-deriva nada:** consume los avisos que ya produce `derivarAvisos()`,
 * que es la misma función de la que come la campana. Si esto los recalculara,
 * existirían dos verdades sobre lo mismo y divergirían — que es exactamente lo
 * que le pasó a `piezas_en_camino` en este repo, cuatro veces.
 */
export function tarjetaDestacado(
  avisos: { tipo: string; sku: string; de: string | null; a: string | null }[],
  seguidos: number,
  cuandoStock: string | null,
): Tarjeta {
  const { visibles, resto } = acotar(avisos);
  const texto: Record<string, string> = {
    estatus: 'cambió de etapa',
    disponible: 'cambió el disponible',
    reservado: 'cambió el reservado',
    llegada: 'llegó',
  };

  return {
    intencion: 'destacado_hoy',
    respuesta: null,
    aviso: null,
    titulo: 'Lo que se movió en tus SKU',
    datos: [
      { etiqueta: 'Avisos', valor: formatoNumero(avisos.length), enfasis: true },
      { etiqueta: 'SKU que sigues', valor: formatoNumero(seguidos) },
    ],
    lista: visibles.map((a) => ({
      principal: a.sku,
      sku: a.sku,
      secundario: [texto[a.tipo] ?? a.tipo, a.de !== null && a.a !== null ? a.de + ' → ' + a.a : null]
        .filter(Boolean)
        .join(' · '),
    })),
    // LOS DOS CEROS NO SIGNIFICAN LO MISMO, y colapsarlos sería el defecto que
    // este bloque lleva cazando desde O1: «no sigues nada» es una cuenta vacía
    // y «no se movió nada» es una respuesta. Se dicen distinto.
    nota:
      seguidos === 0
        ? 'Todavía no sigues ningún SKU. Marca los que te importen con «Avisarme», en su ficha.'
        : avisos.length === 0
          ? 'Nada se movió en los SKU que sigues.'
          : notaDeResto(resto, 'avisos'),
    fuentes: [{ tag: VIVO, code: 'seguimientos' }],
    cortes: corteStock(cuandoStock),
  };
}

/**
 * «¿Qué proyectos tengo?» — **la primera que lee dato tuyo y no compartido.**
 *
 * El acotado NO se hace aquí ni con un `perfil_id` en la consulta: lo hace la
 * RLS de `proyectos` sobre el cliente de la sesión. Una segunda barrera en este
 * archivo podría divergir de la primera, y la primera es la que manda.
 */
export function tarjetaMisProyectos(
  proyectos: { folio: string; titulo: string; fecha: string; skus: number; piezas: number }[],
): Tarjeta {
  const { visibles, resto } = acotar(proyectos);
  const piezas = proyectos.reduce((suma, p) => suma + p.piezas, 0);

  return {
    intencion: 'mis_proyectos',
    respuesta: null,
    aviso: null,
    titulo: 'Tus proyectos',
    datos: [
      { etiqueta: 'Cuántos', valor: formatoNumero(proyectos.length), enfasis: true },
      { etiqueta: 'Piezas en total', valor: formatoNumero(piezas) },
    ],
    lista: visibles.map((p) => ({
      principal: p.folio + ' · ' + p.titulo,
      secundario: [formatoFecha(p.fecha), formatoNumero(p.skus) + ' SKU', formatoNumero(p.piezas) + ' pz'].join(' · '),
    })),
    nota:
      proyectos.length === 0
        ? 'No tienes ningún proyecto todavía. Se crean desde Proyectos, o volcando una Selección.'
        : notaDeResto(resto, 'proyectos'),
    // SIN corte de stock: un proyecto no es una cifra del snapshot. Las piezas
    // que lleva dentro las fijó quien lo armó, y no se mueven cuando entra un
    // Excel nuevo.
    fuentes: [{ tag: 'Tus proyectos', code: 'proyectos' }],
    cortes: [],
  };
}

/**
 * «¿Cuándo se cargó el inventario?» — el libro de cargas.
 *
 * **Y aquí la respuesta tiene que llevar su propia advertencia**, porque el
 * dato no dice lo que parece: `snapshots` registra RESULTADOS, no INTENTOS. Un
 * hueco entre cargas puede ser «no corrió» o «corrió y el archivo no había
 * cambiado», y **dejan la misma evidencia: ninguna** (deuda B10-3). Contestar
 * «se cargó el 12 de agosto» sin eso invita a leer un hueco como una parada.
 */
export function tarjetaSnapshots(
  items: { fuente: string; periodo: string; created_at: string; filas: number | null; vigente: boolean }[],
  vigentes: { stock: string | null; aduana: string | null },
): Tarjeta {
  const { visibles, resto } = acotar(items);

  return {
    intencion: 'snapshots_recientes',
    respuesta: null,
    aviso: null,
    titulo: 'Últimas cargas',
    datos: [
      { etiqueta: 'Inventario', valor: formatoFechaDeTimestamp(vigentes.stock), enfasis: true },
      { etiqueta: 'Aduana', valor: formatoFechaDeTimestamp(vigentes.aduana), enfasis: true },
    ],
    lista: visibles.map((s) => ({
      principal: s.fuente + ' · ' + s.periodo,
      secundario: [
        formatoFechaDeTimestamp(s.created_at),
        s.filas !== null ? formatoNumero(s.filas) + ' filas' : null,
        s.vigente ? 'vigente' : null,
      ]
        .filter(Boolean)
        .join(' · '),
    })),
    nota:
      items.length === 0
        ? 'Todavía no hay ninguna carga registrada.'
        : [
            'Se registra la carga que TRAJO algo nuevo: si el archivo no cambió, no queda renglón.',
            notaDeResto(resto, 'cargas'),
          ]
            .filter(Boolean)
            .join(' '),
    fuentes: [{ tag: 'Libro de cargas', code: 'snapshots' }],
    cortes: [],
  };
}

export function textoDeCorte(c: Corte): string {
  return `${c.fuente === 'stock' ? 'Stock' : 'Aduana'} · corte ${formatoFechaDeTimestamp(c.cuando)}`;
}
