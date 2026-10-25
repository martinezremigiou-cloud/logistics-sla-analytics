// ============================================================
// [CHAT-B1] lib/chat/hilo.ts — la memoria corta, y sus dos techos.
//
// Para que se pueda repreguntar —«¿y la otra?», «¿cuánto pesa ésa?»— sin repetir
// el nombre. Nada más que eso: no es un historial de conversación, es el
// contexto mínimo para que un pronombre tenga referente.
//
// ────────────────────────────────────────────────────────────
// DOS TECHOS Y NO UNO, PORQUE MIDEN COSAS DISTINTAS.
//
//   TOPE_TURNOS  acota la DERIVA: a más turnos, más lejos queda el tema y más
//                probable es que el modelo ancle un pronombre en el SKU
//                equivocado. Un techo de bytes no lo ataja — seis turnos cortos
//                caben de sobra y ya desvarían.
//   TOPE_BYTES   acota la FACTURA: seis turnos largos son varios KB de entrada
//                pagada por pregunta, encima de los 16 KB de la ficha.
//
// 🔴 ESTA CABECERA DECÍA «un turno puede ser un pegado de 500 caracteres
// (`MAX_PREGUNTA`)», Y ERA FALSO DESDE CHAT-B2. Ese comentario **suponía que
// todo turno es del usuario**; B2 metió turnos del ASISTENTE, que no los teclea
// nadie y no los acota `MAX_PREGUNTA`. Es **P35 en el archivo que razona sobre
// topes** — el comentario declaraba el invariante y el código de al lado ya no
// lo cumplía.
//
// Lo que costó: medido contra el redactor real, sobre respuestas de
// fichas de los tres tercios de tamaño: una de cada cuatro
// se pasaba del tope de 500 —
// o sea que **una de cada cuatro respuestas documentales invalidaba el
// siguiente envío de su propia conversación**, con HTTP 400 y sin recuperación:
// hasta «gracias» fallaba. El sujeto no era la pregunta: era lo que el Asistente ya dijo.
//
// Un solo techo dejaría la otra mitad abierta. Y **un contexto que crece sin
// tope es una factura que crece sin tope**: `consumo_chat` ya registra tokens por
// pregunta, así que esto se ve en la factura antes que en la pantalla.
//
// ────────────────────────────────────────────────────────────
// ⚠️ DOS DE LOS TRES NÚMEROS **NO ESTÁN CALIBRADOS**, y se dice aquí en vez de
// fingir. `MAX_TURNO_HILO` SÍ lo está desde CHAT-B3 —sale de medir 21 respuestas
// reales del redactor— y por eso lleva su medición al lado. Los otros dos no.
//
// Calibrarlos exigiría saber cómo repregunta la gente de verdad, y eso no se
// puede medir: **`consumo_chat` no guarda el texto de la pregunta**, por decisión
// de producto (B10-5 — «puede llevar el nombre de un cliente»). Así que son
// un punto de partida declarado, no una medición.
//
// Deuda con nombre: `HILO-SIN-CALIBRAR`. Disparador: la primera queja de que el
// chat «se olvida» o la primera factura que no cuadre con las preguntas.
//
// ────────────────────────────────────────────────────────────
// EL SERVIDOR RECHAZA LA FORMA Y RECORTA EL LARGO. Son dos cosas distintas, y
// [CHAT-B3] separarlas es lo que cierra el defecto.
//
//   CUÁNTOS turnos manda el cliente  →  se RECHAZA con 400 si se pasa.
//   CUÁNTO mide un turno             →  se RECORTA, en los dos lados.
//
// La versión anterior de esta sección decía «el servidor NO recorta: rechaza», y
// la razón que daba era buena: recortar callado hace que el cliente crea que
// mandó seis turnos y el modelo haya visto tres. **Esa razón sigue valiendo para
// el NÚMERO de turnos**, que es una decisión del cliente.
//
// No vale para el LARGO de un turno que **el propio servidor escribió**. Ahí un
// 400 no informa a nadie: le dice al usuario que su conversación es inválida por
// culpa de una respuesta que él no redactó, y no hay nada que pueda hacer al
// respecto — ni siquiera «gracias» vuelve a funcionar. Medido en QA manual:
// fallaba al tercer intercambio y no se recuperaba.
//
// Y el recorte del largo **no es silencioso en el sentido que importaba**: el
// hilo es contexto para pronombres, no contenido; la respuesta completa sigue
// pintada en la conversación y el SUJETO viaja aparte en el `referente`.
// ============================================================

export interface Turno {
  readonly quien: 'usuario' | 'asistente';
  readonly texto: string;
}

/** Turnos que viajan, contando pregunta y respuesta por separado. */
export const TOPE_TURNOS_HILO = 6;

/** Bytes UTF-8 del hilo entero. ~3 KB serían el 25 % del presupuesto de la ficha. */
export const TOPE_BYTES_HILO = 2_000;

/**
 * [CHAT-B3] Tope de UN turno, en caracteres. **Y es distinto de `MAX_PREGUNTA`
 * a propósito: acotan cosas distintas.**
 *
 *   `MAX_PREGUNTA` (500)   lo que TECLEA el usuario. Su razón es que un pegado
 *                          de 100 KB no se convierta en tokens pagados.
 *   `MAX_TURNO_HILO`       lo que ESCRIBE el sistema. Nadie lo teclea, y acotarlo
 *                          con el tope del usuario producía un 400 sobre una
 *                          respuesta que el propio portal había generado.
 *
 * **1 200 sale de medir, no de elegir.** Contra el redactor real, el máximo de
 * las respuestas medidas queda holgadamente por debajo de 1 200 — y se cubre con holgura
 * el «máximo medido + 20 %» que el gate exige que pase.
 *
 * El techo de fondo no es éste: es `MAX_TOKENS_REDACCION`, que acota lo que el
 * modelo puede emitir. Éste sólo impide que un turno solo se coma el presupuesto
 * del hilo entero.
 */
export const MAX_TURNO_HILO = 1_200;

export function bytesDelHilo(turnos: readonly Turno[]): number {
  return turnos.reduce((n, t) => n + Buffer.byteLength(t.texto, 'utf8'), 0);
}

/**
 * ¿Este hilo se pasa de alguno de los dos techos?
 *
 * Lo usa el servidor para rechazar. Devuelve **cuál** se pasó, no un booleano:
 * «llegaste al tope» sin decir de qué manda a la persona a adivinar, y es el
 * mismo defecto que `mensajeDeTope()` ya arregló un nivel más arriba.
 */
export function hiloExcede(turnos: readonly Turno[]): 'turnos' | 'bytes' | 'turno_largo' | null {
  if (turnos.length > TOPE_TURNOS_HILO) return 'turnos';
  // [CHAT-B3] El tercer techo, que faltaba: un turno que por sí solo se pasa.
  // Sin él, `hiloExcede` decía «no excede» sobre un hilo que la ruta iba a
  // rechazar — dos topes del mismo hecho sin nada que los comparara.
  if (turnos.some((t) => t.texto.length > MAX_TURNO_HILO)) return 'turno_largo';
  if (bytesDelHilo(turnos) > TOPE_BYTES_HILO) return 'bytes';
  return null;
}

/**
 * Recorta a los techos conservando **los últimos** turnos.
 *
 * Los últimos y no los primeros: el referente de «ésa» está en lo más reciente,
 * y un hilo que conservara el principio contestaría con precisión sobre el tema
 * equivocado — que es peor que no acordarse.
 */
export function recortarHilo(turnos: readonly Turno[]): Turno[] {
  // [CHAT-B3] PRIMERO SE ACOTA CADA TURNO, y esto es lo que arregla el defecto.
  //
  // Antes esta función sólo DESCARTABA turnos enteros por el techo total, así que
  // una respuesta de 900 caracteres cabía de sobra en los 2 000 B… y luego zod la
  // rechazaba a los 500. **El guardia bueno corría después del que no lo era.**
  //
  // Recortar a media frase es correcto aquí: el hilo existe para que un pronombre
  // tenga referente, no para releer la respuesta. Y el SUJETO viaja aparte, en el
  // `referente` de B2 — que es quien de verdad sostiene la repregunta.
  const acotados = turnos.map((t) =>
    t.texto.length > MAX_TURNO_HILO ? { ...t, texto: t.texto.slice(0, MAX_TURNO_HILO) } : t,
  );
  const ultimos = acotados.slice(-TOPE_TURNOS_HILO);

  // De atrás hacia adelante, para que el recorte por bytes también conserve lo
  // reciente. Un turno que por sí solo se pasa del techo se omite entero.
  const cabidos: Turno[] = [];
  let bytes = 0;
  for (let i = ultimos.length - 1; i >= 0; i--) {
    const b = Buffer.byteLength(ultimos[i].texto, 'utf8');
    if (bytes + b > TOPE_BYTES_HILO) break;
    cabidos.unshift(ultimos[i]);
    bytes += b;
  }
  return cabidos;
}

/** El hilo, para meterlo en el prompt. Vacío devuelve cadena vacía, no un rótulo huérfano. */
export function textoDelHilo(turnos: readonly Turno[]): string {
  if (turnos.length === 0) return '';
  return [
    'Turnos anteriores de esta conversación, para que los pronombres tengan referente:',
    ...turnos.map((t) => `${t.quien === 'usuario' ? 'Preguntó' : 'Contestaste'}: ${t.texto}`),
  ].join('\n');
}
