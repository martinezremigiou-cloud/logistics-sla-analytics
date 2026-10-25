// ============================================================
// [INV-B9.1] lib/correo.ts — a QUIÉN le toca correo y con qué. 100% PURO.
//
// EL INVARIANTE DEL BLOQUE: **n8n ENTREGA, n8n no DECIDE.** `derivarAvisos()`
// ya decidió qué avisos existen; este módulo decide, de esos, cuáles viajan por
// correo y quién recibe. n8n recibe la lista armada y la entrega.
//
// Este archivo NO deriva ni una cifra y NO vuelve a preguntar qué le importa a
// nadie: lo que se manda por correo es **lo que el usuario ya eligió para la
// campana**. El interruptor `av_correo` decide *si además te busca*, no *qué*.
// Preguntarlo dos veces mataría la función con 30 SKU — es la misma razón por
// la que la ventana de B9 trae «usar esto para los siguientes» marcado.
//
// ────────────────────────────────────────────────────────────
// LA REGLA DEL CORREO VACÍO, que es la única decisión de producto que vive aquí:
//
//   sale correo  ⇔  hay algo personal  ∨  (el boletín está encendido ∧ el pulso trae algo)
//
// Nunca se envía un correo cuyo contenido sea «no pasó nada». Y el bloque
// personal PUEDE venir vacío: entonces lo que va es el boletín.
//
// El boletín le llega a todos por diseño de producto, y quien lo sienta ruidoso lo
// apaga con `boletin_correo`. Medido sobre la historia: el bloque general trae
// algo en **5 de 6 semanas**; el personal, con la configuración por omisión y
// pocos SKU seguidos, casi nunca. Por eso el apagador es por-persona y no una
// regla global.
//
// **[C-18] RATIFICADO el 16-sep-2026, sin cambio de código:**
//
//   > El boletín le llega a todos por omisión, y quien no lo quiera lo apaga.
//
// Se registra aquí y no en un documento de bloque porque **es aquí donde alguien
// va a preguntarse si fue una decisión o un descuido.** Y con ella, LA CADENA
// COMPLETA DEL INTERRUPTOR — verificada línea por línea el 17-sep, porque la
// pregunta que había que cerrar era si el apagador **existía** o solo se había
// investigado:
//
//   UI .......... `components/config/config-avisos.tsx:127-132`
//                 <Switch checked={preferencias.boletin_correo}
//                         onCheckedChange={(v) => cambiar({ boletin_correo: v })} />
//   ESCRITURA ... `services/avisos.service.ts:537,543-545`
//                 upsert en `preferencias_notificacion`, onConflict 'perfil_id'
//   LECTURA ..... `services/correo.service.ts:207`
//                 boletinDe.get(p.id) ?? true   <- el `?? true` ES «por omisión lo recibes»
//   EL PIE ...... `lib/correo-plantilla.ts:558`
//                 «Ajustar mis avisos» y «Dejar de recibir» -> {url}/config
//
// **NO es P7.** El interruptor no es una interfaz fantasma: existe, escribe, y el
// correo apunta a él desde su pie. La fila de `preferencias_notificacion` **nace
// perezosa** (migración 0026), y por eso la ausencia de fila tiene que leerse como
// «encendido» — que es exactamente lo que hace ese `?? true`. Cambiarlo por
// `?? false` apagaría el boletín para todo el mundo sin tocar una sola fila.
//
// ────────────────────────────────────────────────────────────
// AGNÓSTICO A LA CADENCIA — condición acordada, y aquí se ve en qué se traduce:
// **este archivo no sabe qué es una semana.** No calcula ventanas, no lee el
// reloj y no interpreta la clave del intento. Recibe los avisos de una ventana
// que otro decidió. El correo por evento entre semana será otro llamador con
// otra ventana y otra clave — y cero cambios aquí.
// ============================================================
import type { Aviso } from './avisos';

/** Una fila de `seguimientos`, con el interruptor de correo. */
export interface SeguimientoCorreo {
  perfil_id: string;
  sku: string;
  av_correo: boolean;
}

/** Lo que hace falta saber de cada persona para decidir si le toca correo. */
export interface DestinatarioPosible {
  perfil_id: string;
  correo: string;
  /** `preferencias_notificacion.boletin_correo`. Por omisión `true`. */
  boletin_correo: boolean;
}

export interface CorreoArmado {
  perfil_id: string;
  correo: string;
  /** Solo los avisos de SKU con `av_correo`. Puede venir vacío. */
  avisos: Aviso[];
  /** Si este correo lleva además el bloque general. */
  incluyePulso: boolean;
}

/**
 * [C-11] ACOTA UNA LISTA DE PERFILES. Es el filtro de la **verificación** — la corrida
 * en la que n8n ejecuta el workflow real contra el portal local.
 *
 * Vive aqui, puro y aparte, por dos razones:
 *
 * 1. **Se puede probar.** `prepararEnvios` necesita un cliente de Supabase; una
 *    decision que decide a quien se le escribe no puede quedar sin gate por
 *    depender de un fake.
 * 2. **La rama permisiva tiene UNA sola entrada.** `undefined` —y solo
 *    `undefined`— significa «no acotes». Un arreglo VACIO acota a NADIE, no a
 *    todos: si `[]` fuera permisivo, un filtro mal construido rio arriba se
 *    convertiria en «mandaselo a los nueve» sin que nada se pusiera rojo.
 *    **El modo de fallo de este filtro tiene que ser no mandar, nunca mandar
 *    de mas.**
 */
export function acotarAPerfiles<T extends { id: string }>(
  perfiles: readonly T[],
  solo: readonly string[] | undefined,
): T[] {
  if (solo === undefined) return [...perfiles];
  const permitidos = new Set(solo);
  return perfiles.filter((p) => permitidos.has(p.id));
}

/**
 * Los correos que hay que enviar en esta ventana.
 *
 * Devuelve **solo** a quien de verdad le toca algo: quien no tenga ni avisos
 * personales ni boletín encendido no aparece en la lista. El llamador no tiene
 * que volver a filtrar — si aparece, se envía.
 *
 * `pulsoTieneAlgo` lo decide quien arma el pulso, no este módulo: aquí no se
 * mira dentro del pulso para no tener dos opiniones sobre qué es «algo».
 */
export function armarCorreos(
  destinatarios: DestinatarioPosible[],
  seguimientos: SeguimientoCorreo[],
  avisos: Aviso[],
  pulsoTieneAlgo: boolean,
): CorreoArmado[] {
  // Índice de los pares (perfil, sku) que pidieron correo. Un `Set` de cadenas
  // y no un `Map` anidado: el par es la llave completa, igual que la PK de
  // `seguimientos`.
  const conCorreo = new Set<string>();
  for (const s of seguimientos) {
    if (s.av_correo) conCorreo.add(`${s.perfil_id}\0${s.sku}`);
  }

  const salida: CorreoArmado[] = [];

  for (const d of destinatarios) {
    const mios = avisos.filter((a) => a.perfil_id === d.perfil_id && conCorreo.has(`${a.perfil_id}\0${a.sku}`));
    const incluyePulso = d.boletin_correo && pulsoTieneAlgo;

    // LA REGLA DEL CORREO VACÍO. Si no hay nada personal y el boletín no
    // aplica, no hay correo — ni uno que diga «no pasó nada».
    if (mios.length === 0 && !incluyePulso) continue;

    salida.push({ perfil_id: d.perfil_id, correo: d.correo, avisos: mios, incluyePulso });
  }

  return salida;
}

// ============================================================
// EL CANAL CALLADO — la misma falla de la ingesta, en el canal que se está
// construyendo ahora.
//
// n8n llama cada semana. Si `AVISOS_SECRET` no está puesto, recibe
// `config_error`. Si el workflow queda desactivado, no llama. Si el transporte
// rechaza, no entrega. **En los tres casos no pasa nada visible y nadie se
// entera** — que es exactamente lo que ocurrió dos veces con la ingesta de
// stock: 182 horas de silencio con la píldora en verde.
//
// Aquí sale más barato que allá, porque el dato ya existe: `envios_aviso`
// registra cada intento confirmado. «No ha habido un envío confirmado en N
// días» es una consulta, no una instrumentación nueva.
//
// ────────────────────────────────────────────────────────────
// LA TRAMPA DEL DISEÑO OBVIO, y por eso «nunca» NO dispara.
//
// La regla natural —«si no hay envío confirmado reciente, avisa»— **empezaría a
// gritar el día que esto se despliegue**, antes de que n8n exista, y seguiría
// gritando hasta el primer envío. Una alarma que nace encendida se aprende a
// ignorar antes de significar nada.
//
// Por eso: **solo avisa si ALGUNA VEZ hubo un envío confirmado** y el más
// reciente ya está viejo. «Nunca se ha enviado» es indistinguible de «todavía
// no está configurado», y ante esa ambigüedad se calla. Es la misma decisión
// que en `fuentesCalladas`, donde el silencio COMPARTIDO no dispara: un paro no
// es una falla.
//
// DOS CICLOS, no uno. Con cadencia semanal, un ciclo perdido puede ser un
// festivo o un reintento tardío; dos ya no. El ciclo es un PARÁMETRO porque el
// bloque entero es agnóstico a la cadencia — el correo por evento tendrá otro.
// ============================================================

/** Ciclo del boletín, en días. Es un parámetro, no una constante horneada. */
export const CICLO_BOLETIN_DIAS = 7;
/** Cuántos ciclos sin envío confirmado antes de avisar. Uno puede ser un festivo; dos ya no. */
export const CICLOS_ANTES_DE_AVISAR = 2;

const MS_DIA = 86_400_000;

export interface CanalCallado {
  dias: number;
  /** El último envío confirmado, para que el aviso diga desde cuándo y no solo que sí. */
  ultimo: string;
}

/**
 * `null` si el canal está sano, si nunca se ha enviado nada, o si no hay con
 * qué comparar. Un objeto si hubo envíos y llevan demasiado tiempo parados.
 *
 * `ahora` se inyecta para que la prueba no dependa del día en que se corra.
 */
export function canalDeCorreoCallado(
  ultimoConfirmado: string | null,
  ahora: Date,
  cicloDias: number = CICLO_BOLETIN_DIAS,
): CanalCallado | null {
  // «Nunca» se calla: es indistinguible de «todavía no está configurado».
  if (!ultimoConfirmado) return null;

  const dias = (ahora.getTime() - new Date(ultimoConfirmado).getTime()) / MS_DIA;
  if (!Number.isFinite(dias)) return null;
  if (dias < cicloDias * CICLOS_ANTES_DE_AVISAR) return null;

  return { dias: Math.floor(dias), ultimo: ultimoConfirmado };
}

/**
 * Resumen de un correo armado, para el asunto y para el registro.
 *
 * `skus` y no `avisos.length` es lo que se cuenta: un SKU con dos avisos es UNA
 * novedad, no dos. Es la misma corrección que el gate del grano forzó en el
 * panel de la campana (P23) — la unidad que percibe un humano es el SKU.
 */
export function resumenDeCorreo(correo: CorreoArmado): { skus: number; avisos: number; soloPulso: boolean } {
  return {
    skus: new Set(correo.avisos.map((a) => a.sku)).size,
    avisos: correo.avisos.length,
    soloPulso: correo.avisos.length === 0,
  };
}
