// ============================================================
// [INV-B9.1 · CORREO·C-5] LA PLANTILLA DEL BOLETÍN.
//
// POR QUÉ SE VE «ANTIGUA», y es a propósito: **Outlook de escritorio no
// renderiza con un motor web, renderiza con el de Word.** Sin flex, sin grid,
// sin `position`, sin `var(--)`, sin hojas de estilo. Tablas anidadas y estilo
// en línea. Lo vigila el gate de las 8 construcciones prohibidas en
// `correo-plantilla.test.ts`, y ese gate **no se toca, no se relaja y no se
// salta** — es la condición con la que este archivo pasó a ser territorio del
// frente de CORREO (G-1, 13-sep-2026).
//
// UN RENGLÓN POR SKU, no por aviso. Es la corrección que el gate del grano
// forzó en el panel de la campana (P23): un SKU con dos señales es UNA novedad
// para un humano, no dos. Aquí se ve en que los tipos se agrupan bajo su SKU.
//
// ────────────────────────────────────────────────────────────
// [C-5] LO QUE CAMBIÓ CON LA FIRMA, y por qué cada cosa
//
// · **«Retrocedió» NO existe.** Un SKU que vuelve a una etapa anterior se dice
//   «− En misma etapa · ahora en X». Se firmó con su razón: *«retroceso»
//   acusa al archivo plano de un error que no cometió*. Y NUNCA «sigue en X»:
//   el SKU no seguía ahí, volvió. «Sigue» afirmaría algo que no pasó.
//
// · **El bloque general deja de listar 8 SKU alfabéticos.** Medido en C-4: esos
//   8 eran los 8 de la transición MENOS frecuente y dejaban invisible
//   a la mayoría de los SKU. Un tope alfabético gasta su presupuesto en lo más raro.
//   Ahora se agrupa por TRANSICIÓN y se cuenta — el sesgo desaparece porque ya
//   no hay muestra que sesgar.
//
// · **Los dos conteos que coinciden se separan con marca temporal.** «esta semana» es un DELTA
//   de la ventana; «ahora mismo» es un ESTADO. Antes valían cifras distintas con
//   intersección CERO; que hoy coincidan es un accidente que enseña al lector
//   que son lo mismo. El rótulo temporal es lo que los vuelve distinguibles.
//
// · **El estado ahora-mismo NO vive en `Pulso`, y es deliberado.** `Pulso` es
//   el delta de la ventana. Meter ahí un conteo de catálogo habría puesto dos
//   universos bajo un tipo — justo lo que el rótulo temporal existe para
//   separar. Viaja en `OpcionesCorreo.catalogo`, y la separación es
//   estructural, no solo visual.
// ============================================================
import type { Aviso, Pulso, TipoAviso } from './avisos';
import { ETIQUETA_AVISO, TIPOS_AVISO } from './avisos';
import type { CorreoArmado } from './correo';
import { formatoFechaDeTimestamp, formatoNumero } from './formato';
import { NOMBRE_PRODUCTO } from '@/config/producto';

/** Ancho canónico de un correo. Más de 600 px se corta en el panel de lectura de Outlook. */
const ANCHO = 600;

const COLOR = {
  /** `--mx-accent` del portal, resuelto a literal: en un correo no existe `var()`. */
  marca: '#2E78C7',
  /** El navy de la cabecera. Sólido, para que el correo se distinga de un vistazo. */
  navy: '#1B365D',
  navySuave: '#A9C0DC',
  bueno: '#0F7B57',
  buenoFondo: '#EAF7F1',
  buenoTinta: '#146F52',
  ambar: '#8A5A12',
  ambarFondo: '#F6F1E8',
  tinta: '#1A1D21',
  tinta2: '#4A5158',
  suave: '#6B7280',
  /** El gris de «en misma etapa». No es una alarma: es una ausencia de avance. */
  quieto: '#8A9099',
  linea: '#DDE3E9',
  lineaSuave: '#EDF0F3',
  fondo: '#EDF0F3',
  papel: '#FFFFFF',
  /** El ambiente de «lo tuyo»: azul claro. El de «lo de todos»: gris. */
  tuyoFondo: '#EEF5FC',
  tuyoLinea: '#D6E4F3',
  tuyoTinta: '#4A6C92',
  todosFondo: '#F4F6F8',
  pieFondo: '#FAFBFC',
} as const;

/**
 * [C-12] EL COPY FIRMADO, en un solo sitio.
 *
 * Vive aquí y no inline por la razón de siempre en este repo: un texto repetido
 * en dos plantillas son dos textos, y el día que alguien cambie uno solo nadie lo
 * nota. La prueba se ata a ESTA constante, así que un cambio de copy no puede
 * dejar el gate verde vigilando la frase vieja.
 */
export const COPY = {
  /**
   * `disponible` negativo = `sobre_reservado`: hay más apartado que existencias.
   * **Firmado el 15-sep-2026**, junto a la cifra en ámbar. El color
   * decía «esto es una excepción» sin decir CUÁL — un color no es un rótulo.
   */
  sobreReservado: 'Sobre reservado',
  /**
   * [C-17] EL RÓTULO DE LA CIFRA DE «LO TUYO».
   *
   * Decía **«N SKU que sigues»**, y era el número correcto del sustantivo
   * equivocado: la cifra es `filas.length` — **los SKU que van EN ESTE CORREO**,
   * no los que el destinatario sigue. Medido sobre el perfil de
   * prueba: sigue más SKU de los que van en el correo, y el correo dijo la
   * cifra de los que van.
   *
   * Y lo que empujaba a leerlo mal es el propio renglón: sus vecinos
   * —«1 proyecto», «4 partidas»— **sí** cuentan lo que el destinatario posee
   * (medido: salen de `proyectos.propietario`), así que el patrón del renglón
   * enseña a leer los tres como posesión.
   *
   * ✅ **FIRMADO el 16-sep-2026.** El texto no cambió; cambió su
   * estado. ~~PROPUESTA pendiente de firma~~ — y se conserva la razón por la que
   * se cambió ANTES de tener firma: la etiqueta anterior **afirmaba algo falso**,
   * y *un copy sin firmar pero verdadero es mejor que uno firmado y falso*.
   *
   * El asunto —«<producto> · N de tus SKU se movieron»— también quedó **firmado el
   * 16-sep, sin cambio**: la cifra es correcta y el verbo se ratificó.
   */
  skusConNovedad: 'de tus SKU con novedad',
} as const;

const FUENTE =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "Consolas,Monaco,'Courier New',monospace";

/**
 * Escapa lo que va dentro del HTML.
 *
 * NO es paranoia de manual: el SKU, las etapas y los valores salen de dos Excel
 * que captura gente. Un `&` en una descripción rompe el correo en algunos
 * clientes, y un `<` lo rompe en todos. Que hoy no haya ninguno no es una
 * defensa — es una medición de hoy sobre un dato que se recarga cada semana.
 */
export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Un SKU con todo lo que le pasó en la ventana. El renglón que ve el humano. */
interface FilaSku {
  sku: string;
  senales: { tipo: TipoAviso; de: string | null; a: string | null }[];
}

/**
 * Agrupa los avisos por SKU, respetando el orden de lectura de `TIPOS_AVISO`
 * —primero lo que se puede prometer— y dejando los SKU alfabéticos para que dos
 * corridas de la misma ventana produzcan EL MISMO HTML. Un correo que cambia de
 * orden entre reintentos haría imposible comparar si se mandó lo mismo.
 */
export function agruparPorSku(avisos: Aviso[]): FilaSku[] {
  const porSku = new Map<string, FilaSku>();
  for (const a of avisos) {
    let fila = porSku.get(a.sku);
    if (!fila) {
      fila = { sku: a.sku, senales: [] };
      porSku.set(a.sku, fila);
    }
    fila.senales.push({ tipo: a.tipo, de: a.de, a: a.a });
  }

  const filas = Array.from(porSku.values());
  for (const f of filas) {
    f.senales.sort((x, y) => TIPOS_AVISO.indexOf(x.tipo) - TIPOS_AVISO.indexOf(y.tipo));
  }
  return filas.sort((x, y) => x.sku.localeCompare(y.sku));
}

/** «de X a Y», o solo «Y» cuando no hay de dónde. `llegada` no tiene «de»: venía de nada. */
function transicion(de: string | null, a: string | null): string {
  if (a === null) return '';
  if (de === null) return escaparHtml(a);
  return `de <strong style="color:${COLOR.tinta};background-color:${COLOR.papel};font-weight:600;">${escaparHtml(de)}</strong> a <strong style="color:${COLOR.tinta};background-color:${COLOR.papel};font-weight:600;">${escaparHtml(a)}</strong>`;
}

// ============================================================
// [C-5] AVANCE vs MISMA ETAPA.
//
// `Aviso.de`/`.a` son NOMBRES de etapa, no números: comparar cuál va antes
// exige el orden del catálogo, y ese orden entra por `OpcionesCorreo` desde
// `correo.service.ts`. **Sin el mapa no se decide nada**: se pinta la etiqueta
// neutra de `ETIQUETA_AVISO`. Adivinar «avanzó» sin poder compararlo sería
// afirmar de más, que es el defecto que este bloque lleva persiguiendo.
// ============================================================
type Sentido = 'avanzo' | 'misma' | 'desconocido';

export function sentidoDeEtapa(
  de: string | null,
  a: string | null,
  orden: ReadonlyMap<string, number> | undefined,
): Sentido {
  if (!orden || a === null) return 'desconocido';
  const oa = orden.get(a);
  if (oa === undefined) return 'desconocido';
  if (de === null) return 'avanzo';
  const od = orden.get(de);
  if (od === undefined) return 'desconocido';
  return oa > od ? 'avanzo' : 'misma';
}

/** Glifo, etiqueta y color de una señal ya pintada. El copy está firmado. */
function pintarSenal(
  s: { tipo: TipoAviso; de: string | null; a: string | null },
  orden: ReadonlyMap<string, number> | undefined,
): { glifo: string; etiqueta: string; color: string; frase: string; apagado: boolean } {
  if (s.tipo === 'estatus') {
    const sentido = sentidoDeEtapa(s.de, s.a, orden);
    if (sentido === 'avanzo') {
      return { glifo: '&#9650;', etiqueta: 'Avanzó', color: COLOR.marca, frase: transicion(s.de, s.a), apagado: false };
    }
    if (sentido === 'misma') {
      // NUNCA «sigue en X»: el SKU no seguía ahí, volvió. «Ahora en X» dice
      // dónde está sin afirmar que nunca se movió.
      return {
        glifo: '&minus;',
        etiqueta: 'En misma etapa',
        color: COLOR.quieto,
        frase: s.a === null ? '' : `ahora en <strong style="color:${COLOR.quieto};background-color:${COLOR.papel};font-weight:600;">${escaparHtml(s.a)}</strong>`,
        apagado: true,
      };
    }
    return { glifo: '', etiqueta: ETIQUETA_AVISO.estatus, color: COLOR.marca, frase: transicion(s.de, s.a), apagado: false };
  }

  if (s.tipo === 'llegada') {
    return { glifo: '&#9679;', etiqueta: ETIQUETA_AVISO.llegada, color: COLOR.bueno, frase: transicion(s.de, s.a), apagado: false };
  }
  if (s.tipo === 'reservado') {
    return { glifo: '&#9654;', etiqueta: ETIQUETA_AVISO.reservado, color: COLOR.ambar, frase: transicion(s.de, s.a), apagado: false };
  }
  const subio = Number(s.a) > Number(s.de);
  return {
    glifo: subio ? '&#9650;' : '&minus;',
    etiqueta: ETIQUETA_AVISO.disponible,
    color: subio ? COLOR.bueno : COLOR.ambar,
    frase: transicion(s.de, s.a),
    apagado: false,
  };
}

/**
 * El asunto.
 *
 * DICE EL NÚMERO Y DICE DE QUÉ. Un asunto genérico —«Tienes novedades»— obliga a
 * abrir para saber si importa, y a las tres semanas se archiva sin abrir. El
 * número que va aquí es de **SKU**, no de avisos, por la misma razón que en el
 * cuerpo: es la unidad que un humano percibe.
 */
export function asuntoDeCorreo(correo: CorreoArmado): string {
  const skus = new Set(correo.avisos.map((a) => a.sku)).size;
  if (skus === 0) return `${NOMBRE_PRODUCTO} · Lo que se movió esta semana`;
  if (skus === 1) {
    const unico = correo.avisos[0]!.sku;
    return `${NOMBRE_PRODUCTO} · Novedades de ${unico}`;
  }
  return `${NOMBRE_PRODUCTO} · ${formatoNumero(skus)} de tus SKU se movieron`;
}

// ------------------------------------------------------------
// Piezas del cuerpo. Cada una devuelve HTML o cadena vacía; el ensamblado
// decide qué entra. Separadas porque la regla del correo vacío puede dejar
// fuera cualquiera de los dos bloques, y un bloque que se pinta vacío con su
// título puesto es P17 con traje de correo.
// ------------------------------------------------------------

/**
 * [C-5] EL TOPE DE «LO TUYO», que antes NO EXISTÍA.
 *
 * `bloqueTuyo` no llevaba un solo `.slice(`, y `MAX_SEGUIMIENTOS` vale 200. C-4
 * midió que el cliente recorta el cuerpo bastante antes de esos 200 — y **al
 * recortar cae el pie, que es el único `<a>` del correo**: el lector se queda
 * sin la palanca para apagarlo. Un boletín que no se puede apagar es un boletín
 * que se marca como spam.
 *
 * 25 deja margen de sobra contra el umbral medido y mantiene el correo legible.
 * Y cuando corta LO DICE, con enlace al portal: cortar en silencio haría que el
 * correo afirmara que eso fue todo lo que pasó.
 */
const TOPE_TUYO = 25;

/** Cabecera de ambiente. Los dos bloques se distinguen SIN LEER: azul claro vs gris. */
function cabeceraAmbiente(rotulo: string, sub: string, fondo: string, linea: string, tinta: string, tintaSub: string): string {
  return `<tr><td style="background-color:${fondo};padding:14px 28px 13px 28px;border-bottom:1px solid ${linea};font-family:${FUENTE};">
<div style="font-size:13px;font-weight:700;color:${tinta};background-color:${fondo};letter-spacing:0.04em;">${escaparHtml(rotulo)}</div>
<div style="font-size:12px;color:${tintaSub};background-color:${fondo};padding-top:3px;">${sub}</div>
</td></tr>`;
}

/** Una tarjeta de conteo. Dos por renglón; el `width:10px` de en medio es el canal. */
function tarjeta(n: number, texto: string, fondo: string, cifra: string, tinta: string): string {
  return `<td width="50%" style="width:50%;padding:11px 13px;background-color:${fondo};border-radius:8px;">
<div style="font-size:21px;font-weight:700;color:${cifra};background-color:${fondo};line-height:1.1;">${formatoNumero(n)}</div>
<div style="font-size:11.5px;color:${tinta};background-color:${fondo};padding-top:3px;">${texto}</div></td>`;
}

export interface ResumenCatalogo {
  /** SKU del snapshot vigente. El denominador, y va dicho en el correo. */
  total: number;
  /** Con `disponible > 0`, derivado por `derivarSku`. NO es `total − conReserva`. */
  disponibles: number;
  /** Con `reservado > 0`. Se solapa con `disponibles`: un SKU puede tener los dos. */
  conReserva: number;
}

export interface ResumenProyectos {
  proyectos: number;
  partidas: number;
}

function bloqueTuyo(
  filas: FilaSku[],
  opciones: OpcionesCorreo,
): string {
  if (filas.length === 0) return '';

  const orden = opciones.ordenDeEtapa;
  const cifras = opciones.cifras;
  const url = opciones.urlPortal;

  const visibles = filas.slice(0, TOPE_TUYO);
  const resto = filas.length - visibles.length;

  const renglones = visibles
    .map((f) => {
      const senales = f.senales
        .map((s) => {
          const p = pintarSenal(s, orden);
          const etiqueta = `<strong style="color:${p.color};background-color:${COLOR.papel};">${p.glifo ? `${p.glifo} ` : ''}${escaparHtml(p.etiqueta)}</strong>`;
          return `<div style="font-size:12.5px;color:${p.apagado ? COLOR.suave : COLOR.tinta2};background-color:${COLOR.papel};padding-top:4px;line-height:1.45;">${etiqueta}${p.frase ? ` &middot; ${p.frase}` : ''}</div>`;
        })
        .join('');

      // La cifra de la derecha. Solo se pinta si HAY cifra: una celda vacía es
      // mejor que un cero que el lector leería como «no hay».
      // Un `disponible` NEGATIVO no es un error de cuenta: es `sobre_reservado`
      // —hay más apartado que existencias— y `derivarSku` lo marca como tal
      // (`derivaciones.ts`). Medido: **una fracción pequeña de los SKU del vigente**.
      //
      // Se pinta el número REAL, en ámbar. Redondearlo a 0 sería mentir sobre
      // el inventario, y esconderlo dejaría al KAM prometiendo piezas que están
      // comprometidas.
      //
      // [C-12] EL COPY DE ESE CASO YA ESTÁ FIRMADO: «Sobre reservado», junto a
      // la cifra en ámbar. Hasta hoy el ámbar decía «esto es una excepción» sin
      // decir CUÁL — un color no es un rótulo, y el KAM tenía que adivinar por
      // qué ese número estaba en otro tono. Cierra `SOBRE-RESERVADO-SIN-COPY`.
      const c = cifras?.get(f.sku);
      const sobreReservado = c !== undefined && c.disponible < 0;
      const colorCifra = c === undefined ? COLOR.suave : sobreReservado ? COLOR.ambar : c.disponible > 0 ? COLOR.tinta : COLOR.suave;
      const celdaCifra = c
        ? `<td align="right" width="110" style="width:110px;background-color:${COLOR.papel};vertical-align:top;">
<div style="font-size:11px;color:${COLOR.suave};background-color:${COLOR.papel};">disponible</div>
<div style="font-size:16px;font-weight:700;color:${colorCifra};background-color:${COLOR.papel};line-height:1.2;">${formatoNumero(c.disponible)}</div>${
            sobreReservado
              ? `
<div style="font-size:11px;font-weight:700;color:${COLOR.ambar};background-color:${COLOR.papel};line-height:1.3;padding-top:2px;">${COPY.sobreReservado}</div>`
              : ''
          }
</td>`
        : '';

      return `<tr><td style="padding:12px 28px;border-top:1px solid ${COLOR.lineaSuave};background-color:${COLOR.papel};font-family:${FUENTE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;"><tr>
<td style="background-color:${COLOR.papel};vertical-align:top;">
<div style="font-size:13.5px;font-weight:700;color:${COLOR.tinta};background-color:${COLOR.papel};font-family:${MONO};">${escaparHtml(f.sku)}</div>
${senales}
</td>${celdaCifra}
</tr></table>
</td></tr>`;
    })
    .join('');

  const corte =
    resto > 0
      ? `<tr><td style="padding:11px 28px 16px 28px;border-top:1px solid ${COLOR.lineaSuave};background-color:${COLOR.papel};font-family:${FUENTE};">
<div style="font-size:12px;color:${COLOR.suave};background-color:${COLOR.papel};">y ${formatoNumero(resto)} más${
          url
            ? ` &middot; <a href="${escaparHtml(url)}/catalogo" style="color:${COLOR.marca};background-color:${COLOR.papel};text-decoration:none;font-weight:600;">ver todos en el portal &rarr;</a>`
            : ''
        }</div>
</td></tr>`
      : '';

  // «1 proyectos» se lee como un descuido y le quita crédito al resto del
  // correo. Y `proyectos` NO dice «activos»: la tabla no tiene columna de
  // estado, así que «activo» no existe como concepto en la base (medido en C-5).
  const p = opciones.proyectos;
  const plural = (n: number, uno: string, varios: string) => `${formatoNumero(n)} ${n === 1 ? uno : varios}`;
  const sub = [
    // La cifra cuenta LAS FILAS DE ESTE CORREO. El rótulo tiene que decir eso —
    // y no puede decir «que sigues», porque **esta función no recibe cuántos
    // sigue nadie**: no hay forma de saberlo desde aquí, así que afirmarlo sería
    // inverificable por construcción. Ver `COPY.skusConNovedad`.
    `${formatoNumero(filas.length)} ${COPY.skusConNovedad}`,
    p && p.proyectos > 0 ? plural(p.proyectos, 'proyecto', 'proyectos') : '',
    p && p.partidas > 0 ? plural(p.partidas, 'partida', 'partidas') : '',
  ]
    .filter(Boolean)
    .join(' &middot; ');

  return (
    cabeceraAmbiente('LO TUYO', sub, COLOR.tuyoFondo, COLOR.tuyoLinea, COLOR.navy, COLOR.tuyoTinta) +
    renglones +
    corte
  );
}

/**
 * El bloque general.
 *
 * [C-5] YA NO LISTA SKU. Antes mostraba 8 alfabéticos, y C-4 midió que esos 8
 * eran los de la transición menos frecuente mientras la mayoría de los SKU quedaba fuera.
 * Ahora se agrupa por TRANSICIÓN y se cuenta: el sesgo desaparece porque ya no
 * hay muestra que sesgar, y el lector ve la forma de la semana en vez de ocho
 * ejemplos elegidos por el abecedario.
 */
function bloquePulso(pulso: Pulso, opciones: OpcionesCorreo): string {
  const orden = opciones.ordenDeEtapa;
  const cat = opciones.catalogo;
  const hayAlgo = pulso.movimientos.length > 0 || pulso.llegadas.length > 0 || cat !== undefined;
  if (!hayAlgo) return '';

  let avanzaron = 0;
  let misma = 0;
  let sinClasificar = 0;
  for (const m of pulso.movimientos) {
    const s = sentidoDeEtapa(m.de, m.a, orden);
    if (s === 'avanzo') avanzaron++;
    else if (s === 'misma') misma++;
    else sinClasificar++;
  }

  const partes: string[] = [];

  if (pulso.movimientos.length > 0) {
    // Sin el mapa de orden no se puede partir en dos. Se dice el total y se
    // declara, en vez de repartirlo a ojo.
    const tarjetas =
      sinClasificar === pulso.movimientos.length
        ? `<tr>${tarjeta(pulso.movimientos.length, 'cambiaron de etapa', COLOR.tuyoFondo, COLOR.marca, '#2A5F97')}<td width="10" style="width:10px;background-color:${COLOR.papel};">&nbsp;</td><td width="50%" style="width:50%;background-color:${COLOR.papel};">&nbsp;</td></tr>`
        : `<tr>${tarjeta(avanzaron, '&#9650; avanzaron de etapa', COLOR.tuyoFondo, COLOR.marca, '#2A5F97')}<td width="10" style="width:10px;background-color:${COLOR.papel};">&nbsp;</td>${tarjeta(misma, '&minus; en misma etapa', COLOR.todosFondo, COLOR.suave, COLOR.quieto)}</tr>`;

    partes.push(`<tr><td style="padding:16px 28px 6px 28px;background-color:${COLOR.papel};font-family:${FUENTE};">
<div style="font-size:12.5px;font-weight:700;color:${COLOR.tinta};background-color:${COLOR.papel};">Movimiento de etapa <span style="font-weight:400;color:${COLOR.suave};background-color:${COLOR.papel};">&mdash; esta semana</span></div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:10px;">${tarjetas}</table></td></tr>`);
  }

  // `llegadas` es un DELTA de la ventana y no cabe en el bloque de estado. Se
  // pinta solo cuando hay: hoy vale 0, y un renglón en cero con su rótulo
  // puesto es P17 con traje de correo.
  if (pulso.llegadas.length > 0) {
    partes.push(`<tr><td style="padding:12px 28px 6px 28px;background-color:${COLOR.papel};font-family:${FUENTE};">
<div style="font-size:12.5px;font-weight:700;color:${COLOR.bueno};background-color:${COLOR.papel};">&#9679; Ya llegaron <span style="font-weight:400;color:${COLOR.suave};background-color:${COLOR.papel};">&mdash; esta semana</span></div>
<div style="font-size:13px;color:${COLOR.tinta2};background-color:${COLOR.papel};padding-top:6px;line-height:1.55;font-family:${MONO};">${pulso.llegadas
      .slice(0, 8)
      .map((s) => escaparHtml(s))
      .join(' &middot; ')}${
      pulso.llegadas.length > 8
        ? `<span style="font-family:${FUENTE};color:${COLOR.suave};background-color:${COLOR.papel};"> y ${formatoNumero(pulso.llegadas.length - 8)} más</span>`
        : ''
    }</div></td></tr>`);
  }

  if (cat) {
    partes.push(`<tr><td style="padding:14px 28px 6px 28px;background-color:${COLOR.papel};font-family:${FUENTE};">
<div style="font-size:12.5px;font-weight:700;color:${COLOR.tinta};background-color:${COLOR.papel};">Están disponibles <span style="font-weight:400;color:${COLOR.suave};background-color:${COLOR.papel};">&mdash; ahora mismo</span></div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin-top:10px;"><tr>${tarjeta(
      cat.disponibles,
      '&#9679; SKU con piezas disponibles',
      COLOR.buenoFondo,
      COLOR.bueno,
      COLOR.buenoTinta,
    )}<td width="10" style="width:10px;background-color:${COLOR.papel};">&nbsp;</td>${tarjeta(
      cat.conReserva,
      '&#9654; SKU con reserva activa',
      COLOR.ambarFondo,
      COLOR.ambar,
      COLOR.ambar,
    )}</tr></table>
<div style="font-size:11.5px;color:${COLOR.suave};background-color:${COLOR.papel};padding-top:8px;">De ${formatoNumero(cat.total)} SKU en catálogo. Un SKU puede estar en los dos.</div>
</td></tr>`);
  }

  const c = pulso.enCamino;
  partes.push(`<tr><td style="padding:14px 28px 18px 28px;background-color:${COLOR.papel};font-family:${FUENTE};">
<div style="font-size:12.5px;font-weight:700;color:${COLOR.tinta};background-color:${COLOR.papel};">En camino <span style="font-weight:400;color:${COLOR.suave};background-color:${COLOR.papel};">&mdash; ahora mismo</span></div>
<div style="font-size:13px;color:${COLOR.tinta2};background-color:${COLOR.papel};padding-top:6px;line-height:1.55;">
<strong style="color:${COLOR.tinta};background-color:${COLOR.papel};">${formatoNumero(c.skus)} SKU</strong> &middot; ${formatoNumero(c.piezas)} piezas &middot; en ${formatoNumero(c.etapasOcupadas)} de las 11 etapas</div>
</td></tr>`);

  const franja = `<tr><td style="background-color:${COLOR.fondo};height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>`;
  return (
    franja +
    cabeceraAmbiente('LO DE TODOS', 'El panorama de la operación', COLOR.todosFondo, COLOR.linea, COLOR.tinta, COLOR.suave) +
    partes.join('')
  );
}

export interface OpcionesCorreo {
  /**
   * Base del portal, SIN diagonal final — «https://…». La pone quien entrega:
   * el portal no sabe bajo qué dominio lo publicaron, y hornearla aquí sería
   * una segunda verdad que se rompe el día que cambie.
   *
   * Ausente ⇒ el correo sale SIN enlaces. Degradar a texto es correcto; un
   * enlace a `undefined/catalogo` no lo es.
   */
  urlPortal?: string;
  /**
   * El texto que el cliente enseña junto al asunto en la lista. Sin él, Outlook
   * toma las primeras palabras del cuerpo — que eran «Logistics SLA Analytics
   * Novedades del…», o sea el remitente repetido.
   */
  preencabezado?: string;
  /**
   * `nombre de etapa → orden` del catálogo. Es lo único que permite distinguir
   * un avance de una vuelta atrás: `Aviso.de`/`.a` son nombres, no números.
   * **Ausente ⇒ no se clasifica nada** y se pinta la etiqueta neutra.
   */
  ordenDeEtapa?: ReadonlyMap<string, number>;
  /** `disponible`/`reservado` de hoy por SKU, para la cifra del renglón. */
  cifras?: ReadonlyMap<string, { disponible: number; reservado: number }>;
  /** El estado AHORA MISMO del catálogo. No es `Pulso`: ver la cabecera. */
  catalogo?: ResumenCatalogo;
  /** Proyectos y partidas del destinatario. Ausente ⇒ no se nombran. */
  proyectos?: ResumenProyectos;
}

/**
 * El cuerpo, en HTML listo para entregar.
 *
 * DETERMINISTA: mismos datos ⇒ mismo HTML, byte por byte. No lee el reloj ni
 * usa nada aleatorio. Es lo que permite afirmar que un reintento entrega
 * exactamente el mismo correo — la garantía que `correo.service.ts` promete y
 * que sin esto no sería comprobable.
 *
 * MODO OSCURO: **cada elemento que declara `color:` declara también
 * `background-color:`**. Un cliente que invierte los colores invierte lo que
 * encuentra; si un `<td>` trae texto y no fondo, el fondo se invierte y el
 * texto no — negro sobre negro. Las dos defensas habituales están vetadas aquí:
 * `<meta color-scheme>` exige un `<head>` que este fragmento no tiene, y una
 * `@media` exige `<style>`, que el detector #6 prohíbe. Declarar el par en cada
 * elemento es la única que sobrevive al gate.
 *
 * EL PREENCABEZADO VA DENTRO de la primera celda, no antes de la tabla: el gate
 * afirma que el HTML **empieza** en `<table` y ese gate no se relaja. Dentro de
 * la celda cumple igual su función —es el primer texto del cuerpo— y la
 * aserción positiva sigue en pie.
 */
export function cuerpoDeCorreo(
  correo: CorreoArmado,
  pulso: Pulso,
  // La ventana viene del ENVOLTORIO, no del destinatario: es la misma para
  // todos los correos del intento y `prepararEnvios` ya la devuelve arriba.
  ventana: { desde: string; hasta: string },
  opciones: OpcionesCorreo = {},
): string {
  const filas = agruparPorSku(correo.avisos);
  const tuyo = bloqueTuyo(filas, opciones);
  const general = correo.incluyePulso ? bloquePulso(pulso, opciones) : '';

  const url = opciones.urlPortal;
  const pie = url
    ? `<a href="${escaparHtml(url)}/catalogo" style="color:${COLOR.marca};background-color:${COLOR.pieFondo};text-decoration:none;font-weight:600;">Abrir el portal</a> &nbsp;&middot;&nbsp; <a href="${escaparHtml(url)}/config" style="color:${COLOR.marca};background-color:${COLOR.pieFondo};text-decoration:none;font-weight:600;">Ajustar mis avisos</a> &nbsp;&middot;&nbsp; <a href="${escaparHtml(url)}/config" style="color:${COLOR.suave};background-color:${COLOR.pieFondo};text-decoration:underline;">Dejar de recibir</a>`
    : 'Ajusta qué te avisamos en Configuración, dentro del portal.';

  const preencabezado = opciones.preencabezado
    ? `<div style="display:none;font-size:0;line-height:0;max-height:0;mso-hide:all;color:${COLOR.fondo};background-color:${COLOR.fondo};">${escaparHtml(opciones.preencabezado)}</div>`
    : '';

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.fondo};margin:0;padding:0;">
<tr><td align="center" style="padding:18px 8px;background-color:${COLOR.fondo};">${preencabezado}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${ANCHO}" style="width:${ANCHO}px;max-width:100%;background-color:${COLOR.papel};border:1px solid ${COLOR.linea};border-radius:12px;">

<tr><td style="background-color:${COLOR.navy};padding:18px 28px;border-radius:12px 12px 0 0;font-family:${FUENTE};">
<div style="font-size:16px;font-weight:700;color:${COLOR.papel};background-color:${COLOR.navy};letter-spacing:-0.01em;">${NOMBRE_PRODUCTO}</div>
<div style="font-size:12px;color:${COLOR.navySuave};background-color:${COLOR.navy};padding-top:3px;">Novedades del ${escaparHtml(formatoFechaDeTimestamp(ventana.desde))} al ${escaparHtml(formatoFechaDeTimestamp(ventana.hasta))}</div>
</td></tr>

${tuyo}
${general}

<tr><td style="padding:15px 28px 20px 28px;border-top:1px solid ${COLOR.linea};background-color:${COLOR.pieFondo};border-radius:0 0 12px 12px;font-family:${FUENTE};">
<div style="font-size:11.5px;color:${COLOR.suave};background-color:${COLOR.pieFondo};line-height:1.8;">${pie}</div>
</td></tr>

</table>
</td></tr>
</table>`;
}
