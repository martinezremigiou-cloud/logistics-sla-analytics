// ============================================================
// [CHAT-B2] lib/chat/referente.ts — DE QUÉ VENIMOS HABLANDO.
//
// ────────────────────────────────────────────────────────────
// EL DIAGNÓSTICO, MEDIDO ANTES DE TOCAR NADA (§7.1 del bloque).
//
// En QA manual se encontró que la repregunta pierde el hilo en la interfaz.
// Medido el 22-sep-2026 contra el modelo real, la conversación exacta del QA:
//
//   T1 «¿qué es el desactivador RF?»  clasificador → termino="desactivador RF"
//                                     → ficha CON prosa                    ✅
//   T2 «¿a qué frecuencia trabaja?»   clasificador → sku=null termino=null
//                                     → aclarar(falta_sku)                 🔴
//   T3 «¿y cuánto cuesta?»            clasificador → "ninguna" → no_se     🔴
//
// **Y son DOS defectos, no uno.** El primero es obvio; el segundo es el que
// importa:
//
//   1. El cliente NUNCA manda el hilo. `chat-api.ts` envía `{pregunta,
//      ambiente}` y nada más — cero menciones de `hilo` en todo el cliente.
//   2. **Mandarlo NO habría arreglado nada.** La corrida de arriba llevaba el
//      hilo PUESTO y T2 murió igual, con `estado=sin_intento`: el redactor ni
//      se llamó. Porque el hilo sólo llega al REDACTOR, y `responder()`
//      resuelve el SKU **antes** de llegar ahí. Quien decide el SKU es el
//      CLASIFICADOR, y su firma es `clasificar(pregunta: string)`: no ve la
//      conversación, y no debe verla — eso lo abarataría y lo volvería no
//      determinista de otra forma.
//
// ⇒ Lo que falta no es «historial»: es **el SUJETO de la conversación**, que es
// otra cosa y se resuelve en otro sitio. El hilo sirve para que la PROSA tenga
// contexto; el referente sirve para que la RECUPERACIÓN sepa de qué producto.
//
// ────────────────────────────────────────────────────────────
// Y ESTO NO INVENTA UN MECANISMO: REUSA EL DEL AMBIENTE.
//
// `admiteAmbiente(decision)` ya dispara exactamente en la forma de una
// repregunta —`tipo === 'intencion' && !sku && !termino`— y `skuDelAmbiente()`
// rellena **el hueco y sólo el hueco**. El referente entra por ese mismo punto,
// con la misma disciplina: si el usuario dijo algo, eso manda; si no dijo nada,
// se completa y **se declara que se completó**.
//
// Escribir una segunda ruta de relleno habría creado dos sitios que deciden
// sobre qué SKU se contesta — y ante una divergencia nadie sabría cuál manda.
//
// ────────────────────────────────────────────────────────────
// LA PRECEDENCIA: LA CONVERSACIÓN GANA A LA PÁGINA.
//
// Si alguien está en la ficha de KYA2490, pregunta por el desactivador RF y
// luego dice «¿a qué frecuencia trabaja?», habla del desactivador. **Cambiar de
// tema en la conversación es más explícito y más reciente que la página que
// quedó abierta detrás**, así que el referente gana al ambiente. Y cuando el
// referente decide, la respuesta lo dice — igual que `notaDeAmbiente`.
// ============================================================

/**
 * El sujeto vivo de la conversación. **Lo produce el SERVIDOR** al resolver un
 * turno, y el cliente se lo devuelve en el siguiente.
 *
 * No lo compone el cliente a partir del texto: sería una segunda opinión sobre
 * qué se resolvió, capaz de divergir de la primera.
 */
export interface Referente {
  /** El SKU canónico, cuando el turno se resolvió a uno. */
  readonly sku: string | null;
  /** El nombre de familia o término, cuando se resolvió por ahí. */
  readonly termino: string | null;
}

/**
 * Lo que el servicio escribe para que el llamador lo devuelva al cliente.
 *
 * Mismo molde que `RegistroDeRedaccion`: un objeto que el llamador crea y lee,
 * y no un cambio en el tipo de retorno de `responder()` — que tiene **35
 * llamadores**, uno de ellos un `.mjs` que `tsc` no ve.
 */
export interface TrazaDeRespuesta {
  referente: Referente | null;
}

export function trazaVacia(): TrazaDeRespuesta {
  return { referente: null };
}

/** `true` si hay algo con lo que contestar. Un referente de dos nulos no es un referente. */
export function tieneSujeto(r: Referente | null | undefined): r is Referente {
  return !!r && (!!r.sku || !!r.termino);
}

/**
 * La nota que acompaña a una respuesta resuelta por el referente.
 *
 * **Va SIEMPRE que el referente decida**, por la misma razón que
 * `notaDeAmbiente`: sin ella, alguien recibe datos exactos de un producto que
 * no nombró **en ese turno** y no tiene cómo saber de cuál son. La diferencia
 * con el ambiente es que aquí sí lo nombró — hace dos frases— así que la nota
 * es más corta y no repite la pregunta.
 */
export function notaDeReferente(sujeto: string): string {
  return `Sigo sobre ${sujeto}.`;
}

/** Cómo se nombra el sujeto en la nota. El SKU manda sobre el término: es exacto. */
export function nombreDelSujeto(r: Referente): string {
  return r.sku ?? r.termino ?? '';
}
