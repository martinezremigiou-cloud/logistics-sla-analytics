// ============================================================
// [INV-B11] O6 · LA VOZ DEL ASISTENTE, EN UN SOLO SITIO.
//
// Se pidió con su prueba dentro: *«una prueba de que el copy sale de UNA
// fuente, no repetido en tres componentes»*. Este archivo es esa fuente, y
// `voz.test.ts` es esa prueba — comprueba que ningún componente hornee estos
// textos por su cuenta.
//
// ────────────────────────────────────────────────────────────
// LO QUE EL ASISTENTE ES HOY, Y POR QUÉ ESO ES SEGURO.
//
// **El Asistente no redacta.** El modelo clasifica —devuelve un JSON con la intención— y
// el servidor renderiza la tarjeta desde `derivarSku`. Todo lo que el Asistente «dice»
// está escrito aquí abajo o sale de una cifra de la base.
//
// De ahí que la personalidad no pueda producir una falsedad: **sus frases están
// escritas y sus números vienen de la base**. Es la misma razón por la que este
// bloque pudo darle nombre a un asistente sin abrir la clase de fallo que hace
// peligrosos a estos sistemas.
//
// ────────────────────────────────────────────────────────────
// EL LÍMITE, DICHO ANTES Y NO DESPUÉS — literal:
//
//     «Mientras el modelo solo enrute y el servidor renderice, el system prompt
//      gobierna el JSON, no la prosa. La personalidad del Asistente vive hoy en copy
//      fijo. El system prompt empieza a gobernar de verdad cuando entre la
//      prosa generada.»
//
// Por eso `PERSONALIDAD` existe y está **medida**: se compuso en el prompt del
// clasificador y se corrió el conjunto de evaluación para saber si costaba algo.
// Ver su propio comentario, abajo.
// ============================================================

import { NOMBRE_PRODUCTO } from '@/config/producto';

/** El nombre. Se escribe una vez y se compone; no se teclea en cada pantalla. */
export const NOMBRE = 'Asistente';

/**
 * El saludo al abrir el panel. **Copy fijo, no generado**, y se escribió
 * así. Se pinta como primer mensaje del zero-state, antes de los chips.
 */
export const SALUDO_PANEL = `Hola, soy el ${NOMBRE}. ¿En qué te ayudo?`;

/**
 * El saludo contextual del catálogo — una vez por sesión, descartable, nunca
 * bloqueante. La REGLA vive en `saludo-contextual.tsx`; el TEXTO vive aquí.
 */
export const SALUDO_CONTEXTUAL =
  '¿Buscas algo de un SKU? Pregúntame — tengo el inventario en vivo y las fichas técnicas.';

/** Lo que introduce la lista de capacidades en el zero-state. */
export const ZERO_STATE = 'Esto es lo que sé hacer:';

/**
 * La negativa genérica.
 *
 * **Nunca va sola:** quien la emite adjunta `loQueSabeHacer()`, porque un «no
 * sé» a secas deja al usuario adivinando contra un catálogo cerrado. Esa regla
 * la impone `noSe()` en `chat.service.ts`, no este texto.
 */
export const NO_SE = 'No sé contestar eso.';

/**
 * [CHAT-B2] Las dos respuestas sociales que faltaban.
 *
 * Viven AQUÍ y no en el servicio por la misma razón que las demás: **esta es la
 * casa del copy fijo**, y `voz.test.ts` lee el fuente de cada superficie para
 * que nadie las teclee por su cuenta. El SOUL releva a este archivo en la prosa
 * GENERADA; en lo fijo sigue mandando él.
 *
 * `SALUDO_PANEL` no se duplica: un saludo tecleado se contesta **con él mismo**,
 * que es justo lo que el diagnóstico dijo que faltaba —que fuera una respuesta
 * y no sólo un cartel.
 */
export const ACUSE = 'Cuando quieras.';

/** Una línea y nada más. ⛔ Sin repetir capacidades: el SOUL §3 lo prohíbe. */
export const DESPEDIDA = 'Hasta luego.';

/**
 * [CHAT-B2] El marcador de la caja de texto.
 *
 * Decía **«Pregunta por un SKU…»**, y la QA manual lo señaló con la frase
 * exacta: *«el bloque entero existe para que NO haya que preguntar por SKU»*.
 * La interfaz estaba instruyendo a hacer lo único que ya no hace falta — la
 * misma forma del defecto que creó `elegir_intencion` en INV-B10, donde el
 * marcador decía «Pregunta por un SKU…» justo sobre lo que fallaba.
 *
 * Vive aquí y no en el componente porque `voz.test.ts` lee el fuente de la
 * burbuja: si alguien lo teclea otra vez, enrojece.
 */
export const MARCADOR_ENTRADA = 'Pregúntame del inventario o de un producto…';

/**
 * [CHAT-B3] Quién es el Asistente, en dos frases. **§1 del SOUL, ya escrito.**
 *
 * No se inventa aquí: se transcribe del contrato. Y vive
 * en `voz.ts` porque es copy FIJO —lo único que el Asistente puede decir de sí mismo sin
 * consultar nada— y así `voz.test.ts` impide que alguien lo teclee otra vez en
 * un componente.
 *
 * Dos frases y no más: el SOUL §2 pide 2-4 para una respuesta normal, y ésta es
 * la más simple de todas. Una presentación larga es exactamente lo que el
 * usuario no preguntó.
 */
export const QUIEN_SOY =
  `Soy el ${NOMBRE} de inventario de ${NOMBRE_PRODUCTO}. ` +
  'Veo dos cosas: el inventario vivo —qué hay, dónde, cuánto, reservado— y las fichas técnicas de los productos que representamos.';

/**
 * [CHAT-B3] La respuesta a «¿me puedes ayudar con un producto?».
 *
 * **Un sí, y una pregunta.** El SOUL §3 y §6 lo piden así: una pregunta que es
 * un sí o un no se contesta con un sí o un no ANTES de cualquier lista. Antes
 * esto devolvía «No sé contestar eso» con tres fichas al azar detrás.
 */
export const AYUDA_CLARO = 'Claro. ¿Cuál?';

/**
 * [CHAT-B3] El relevo, DICHO. Cuando no hay ficha de lo que se pidió pero sí de
 * algo cercano, la respuesta **nombra el salto** en vez de esconderlo.
 *
 * Sin esto, contestar con la ficha del vecino sería responder otra pregunta sin
 * avisar — la misma clase de daño que adivinar entre muchos candidatos, sólo que más
 * convincente porque casi acierta. Es el mismo criterio que `notaDeAmbiente` y
 * `notaDeReferente`: cuando el sistema elige por ti, lo dice.
 */
export function notaDeRelevo(pedido: string, encontrado: string): string {
  return `No tengo una ficha específica de ${pedido}. Lo más cercano que tengo es ${encontrado}:`;
}

/**
 * [CHAT-B4] El nombre LEGIBLE de un documento, desde su ruta.
 *
 * Es el RESPALDO de `titulo`, no su sustituto: si el documento tiene título,
 * ese manda. Esto existe para los que no lo tienen, y se queda con el archivo
 * sin extensión — la ruta del vault
 * (`20_Seguridad/20.02_Series5/…`) es andamiaje interno y el SOUL
 * §5 la prohíbe en la respuesta visible.
 *
 * VIVE AQUÍ Y NO EN EL COMPONENTE desde este bloque: convertir un camino
 * interno en lo que el usuario lee **es voz**, y B4 necesitaba el mismo nombre
 * en la tarjeta y en la cita. Tenerlo dos veces habría sido el patrón de la
 * casa —dos copias del mismo hecho sin nada que las compare— justo en el
 * archivo cuya cabecera dice que la voz vive en un solo sitio.
 */
export function nombreLegible(ruta: string): string {
  return (ruta.split('/').pop() ?? ruta).replace(/\.md$/i, '');
}

/** Cuando NADA aparece: ni ficha ni SKU. Lo dice entero, no sólo la mitad que miró. */
export function nadaDeNada(termino: string): string {
  return `No tengo nada sobre ${termino} — ni ficha ni SKU.`;
}

/**
 * [CHAT-B3] Lo que se dice cuando la pregunta es de OTRO DOMINIO.
 *
 * SOUL §6: una frase y UNA salida. Antes esto era `NO_SE` con las once viñetas
 * detrás — y el QA midió que las tres formas de fallo las imprimían todas.
 * Repetir la ayuda en cada tropiezo la convierte en ruido.
 */
export const FUERA_DE_DOMINIO = 'Eso está fuera de lo que manejo. Yo veo inventario y fichas de producto.';

/**
 * [CHAT-B3] Cuántos ejemplos acompañan a un «no sé». **Tres, no once.**
 *
 * La lista COMPLETA sale donde `ZERO_STATE` manda —al abrir el panel y cuando se
 * pide— y no en cada fallo. Tres bastan para enseñar que el catálogo es cerrado,
 * que es lo que INV-B10 quería, sin convertir cada tropiezo en un menú.
 */
export const TOPE_EJEMPLOS = 3;

/** El renglón de escalada. Recibe el nombre para no hornear a nadie en el copy. */
export function escalada(nombre: string): string {
  return `Para esto, escríbele a ${nombre}:`;
}

/**
 * La personalidad, declarada — y **medida antes de dejarla puesta**.
 *
 * Se avisó de que hoy no cambia nada visible, y era cierto: el modelo solo
 * emite JSON. Lo que NO era obvio es si costaba algo. Un prompt de clasificación
 * afinado al 100 % puede degradarse cuando se le mete texto que no sirve a la
 * tarea — más contexto es más sitio donde perderse.
 *
 * Medido con el conjunto de evaluación completo, las mismas llamadas antes y
 * después: la exactitud (intención, SKU y «no sé») no cambió, no apareció
 * ninguna respuesta inestable ni siempre-mala, y el consumo de tokens subió
 * unos pocos puntos porcentuales.
 *
 * O sea: **no cuesta exactitud y sí cuesta tokens**, poco. Se queda por esa
 * medición y no porque suene bien — y el costo se dice, porque «gratis» habría
 * sido más cómodo y falso.
 *
 * Está redactada como una restricción y no como un carácter, a propósito: lo
 * que le hace falta al clasificador es saber qué NO hacer. El día que entre la
 * prosa —la puerta 3—, esta constante es donde se le añade el tono.
 */
export const PERSONALIDAD: readonly string[] = Object.freeze([
  `Te llamas ${NOMBRE} y ayudas al equipo comercial de ${NOMBRE_PRODUCTO} con su inventario.`,
  'Nunca inventas un dato. Si algo no lo sabes, lo dices; no lo aproximas.',
]);
