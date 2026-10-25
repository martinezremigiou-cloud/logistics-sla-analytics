// ============================================================
// [CHAT-B2] lib/chat/social.ts — «Hola» deja de ser un fallo.
//
// ────────────────────────────────────────────────────────────
// EL DIAGNÓSTICO EXACTO, Y NO ES EL QUE PARECE.
//
// `SALUDO_PANEL` **ya existe** en `voz.ts` y dice lo que tiene que decir. Lo que
// `voz.ts` declara de él es la clave: *«el primer mensaje del zero-state, antes
// de los chips»*.
//
//   ⇒ **El saludo se PINTA al abrir; no CONTESTA al escribir.**
//
// Por eso teclear `Hola` caía al «no sé» con las once capacidades detrás. **No
// faltaba el saludo: faltaba que fuera una respuesta.** Y la respuesta es
// `SALUDO_PANEL` **importado** — `voz.test.ts` lee el fuente de
// `chat.service.ts` y enrojece si alguien lo teclea otra vez.
//
// ────────────────────────────────────────────────────────────
// ESTO NO ES UNA INTENCIÓN, Y ES DELIBERADO.
//
// Meterlo en `INTENCIONES` habría tenido tres costos: amplía un catálogo que el
// bloque declara cerrado, mete un chip de «Hola» en el zero-state, y —el peor—
// **gasta una llamada al modelo para reconocer «hola»**. Esto se resuelve en el
// servidor, sin red y sin dinero, sobre texto que el usuario ya escribió.
//
// ────────────────────────────────────────────────────────────
// LA REGLA ES «TODO EL TEXTO», NO «CONTIENE».
//
// «hola, ¿cuánto hay de KYA2490?» **NO es un saludo**: es una pregunta que
// empieza saludando, y contestarle con el saludo sería perder la pregunta. Por
// eso se exige que **todas** las palabras sean sociales. Un `includes('hola')`
// habría sido más corto y habría roto el caso normal.
// ============================================================

export type TipoSocial = 'saludo' | 'acuse' | 'despedida';

/** Sin acentos, sin signos, en minúsculas. Lo que compara es la forma, no la ortografía. */
function normalizar(t: string): string[] {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()«»"'\-–—]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Las tres familias. Cortas a propósito: **esto no adivina**, reconoce.
 *
 * Una lista larga empieza a capturar preguntas de verdad —«bueno» dentro de
 * «¿cuál es bueno para…?»— y el costo de un falso positivo aquí es alto: se
 * pierde una pregunta real y el usuario ve un saludo sin venir a cuento.
 */
const SALUDOS = new Set([
  'hola', 'holi', 'buenas', 'buenos', 'buen', 'dias', 'tardes', 'noches',
  'que', 'tal', 'saludos', 'hey', 'ey', 'hello', 'hi', 'asistente',
]);

const ACUSES = new Set([
  'gracias', 'graciass', 'ok', 'oka', 'okay', 'vale', 'perfecto', 'listo',
  'genial', 'excelente', 'entendido', 'va', 'sale', 'muchas', 'mil', 'thanks',
]);

const DESPEDIDAS = new Set([
  'adios', 'chao', 'chau', 'bye', 'hasta', 'luego', 'manana', 'nos', 'vemos', 'saludo',
]);

// Las uniones se precalculan: un spread de `Set` no compila con el `target` de
// este proyecto (TS2802), y además no hay razón para rehacerlas en cada llamada.
const union = (...ss: Set<string>[]) => {
  const u = new Set<string>();
  for (const s of ss) s.forEach((v) => u.add(v));
  return u;
};
const DESPEDIDA_O_SALUDO = union(DESPEDIDAS, SALUDOS);
const ACUSE_O_SALUDO = union(ACUSES, SALUDOS);

/**
 * Tope de palabras. Un saludo es corto **por definición**; cinco palabras de
 * puras partículas sociales ya es raro, y más allá casi siempre hay una
 * pregunta escondida que no conviene perder.
 */
const MAX_PALABRAS_SOCIAL = 5;

/**
 * `null` si no es social. **Es el caso normal y el que no debe equivocarse**:
 * confundir una pregunta con un saludo cuesta una pregunta perdida.
 */
export function tipoSocialDe(pregunta: string | null | undefined): TipoSocial | null {
  if (!pregunta) return null;
  const palabras = normalizar(pregunta);
  if (palabras.length === 0 || palabras.length > MAX_PALABRAS_SOCIAL) return null;

  // TODAS tienen que ser sociales. Ver la cabecera: «hola, ¿cuánto hay de
  // KYA2490?» no es un saludo.
  const todas = (s: Set<string>) => palabras.every((p) => s.has(p));

  // El orden importa cuando hay solape («que tal» vs «que»): la despedida y el
  // acuse se comprueban primero porque son más específicos.
  if (palabras.some((p) => DESPEDIDAS.has(p)) && todas(DESPEDIDA_O_SALUDO)) {
    return 'despedida';
  }
  if (palabras.some((p) => ACUSES.has(p)) && todas(ACUSE_O_SALUDO)) {
    return 'acuse';
  }
  if (todas(SALUDOS) && palabras.some((p) => p !== 'que' && p !== 'asistente')) return 'saludo';
  return null;
}
