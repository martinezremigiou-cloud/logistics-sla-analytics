// ============================================================
// [CHAT-B3] lib/chat/sobre-mi.ts — las preguntas que son SOBRE EL ASISTENTE.
//
// ────────────────────────────────────────────────────────────
// EL HALLAZGO, medido en QA manual con llamadas directas a `/api/chat`:
//
//   «¿sabes de fichas técnicas?»       → `capacidades` → la tarjeta de 11 renglones
//   «¿de qué marcas sabes?»            → `capacidades` → LA MISMA, byte a byte
//   «¿tú qué eres?»                    → `no_se` → «No sé contestar eso.»
//   «¿cuántas fichas tienes?»          → `no_se` + una ficha al azar
//   «¿me puedes ayudar con un producto?» → `no_se` + tres fichas al azar
//
// ⇒ **El Asistente sabía contestar sobre productos y nada sobre sí mismo.** Y las cinco
// tenían respuesta exacta, a una consulta de distancia.
//
// ────────────────────────────────────────────────────────────
// `capacidades` FUNCIONABA COMO CAJÓN, y un cajón no es una intención.
//
// Todo lo que sonaba a meta —«¿sabes X?», «¿me ayudas?», «¿de qué marcas?»—
// caía ahí o en `no_se`. **Un cajón es la ausencia de varias intenciones**, y se
// nota porque dos preguntas distintas reciben el mismo cuerpo.
//
// ────────────────────────────────────────────────────────────
// ESTO NO AMPLÍA EL CATÁLOGO, Y ES DELIBERADO.
//
// Se reconoce en el SERVIDOR, sobre el texto que el usuario ya escribió, igual
// que lo social de B2. Meterlas como intenciones habría ampliado un catálogo que
// el bloque declara cerrado, habría metido cinco chips más en el zero-state, y
// —lo peor— habría gastado una llamada al modelo para reconocer «¿quién eres?».
//
// ────────────────────────────────────────────────────────────
// SE INTERCEPTA **ANTES** DEL DESPACHO, Y NO EN LA RAMA DE `no_se`.
//
// Porque tres de las cinco NO llegan a `no_se`: el clasificador las manda a
// `capacidades`, que es una intención válida. Mirar sólo el callejón habría
// dejado fuera justo las que se probaron primero.
// ============================================================
import { QUIEN_SOY, AYUDA_CLARO } from './voz';
import type { LoQueSe } from '@/services/sobre-mi.service';

export type TipoSobreMi =
  /** «¿de qué marcas sabes?» — tiene respuesta exacta y devolvía un menú. */
  | 'marcas'
  /** «¿cuántas fichas tienes?» — un número, no una ficha al azar. */
  | 'cuantas'
  /** «¿tú qué eres?» — §1 del SOUL, ya escrito. */
  | 'quien_eres'
  /** «¿sabes de fichas técnicas?» — un SÍ, y luego se abre. */
  | 'sabes'
  /** «¿me puedes ayudar con un producto?» — «Claro. ¿Cuál?» */
  | 'ayuda';

function normalizar(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:()«»"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Los patrones, en ORDEN. El primero que casa gana.
 *
 * Van de más específico a más general porque se solapan: «¿sabes cuántas fichas
 * tienes?» es las dos cosas, y la respuesta útil es el número, no el sí.
 *
 * Y son PATRONES y no listas de palabras —a diferencia de `social.ts`— porque
 * aquí no se trata de reconocer una fórmula corta: son preguntas de verdad, con
 * verbo y objeto, y lo que las identifica es la forma entera.
 */
const PATRONES: readonly { tipo: TipoSobreMi; re: RegExp }[] = Object.freeze([
  // El número primero: «¿sabes cuántas fichas tienes?» es `cuantas`, no `sabes`.
  { tipo: 'cuantas', re: /\bcuant[ao]s?\b.*\b(fichas?|documentos?|productos?|marcas?)\b/ },
  { tipo: 'marcas', re: /\b(que|cuales|de que)\b.*\b(marcas?|fabricantes?|tecnologias?)\b.*\b(sabes|conoces|manejas|tienes|hay)\b/ },
  { tipo: 'marcas', re: /\b(marcas?|fabricantes?)\b.*\b(manejas|conoces|sabes|tienes|trabajas)\b/ },
  { tipo: 'quien_eres', re: /\b(quien|que)\s+eres\b/ },
  { tipo: 'quien_eres', re: /\btu\s+que\s+eres\b/ },
  { tipo: 'quien_eres', re: /\bque\s+es\s+(el\s+asistente|esto|este\s+chat|este\s+asistente)\b/ },
  { tipo: 'ayuda', re: /\b(me\s+puedes\s+ayudar|puedes\s+ayudarme|me\s+ayudas|podrias\s+ayudarme)\b/ },
  { tipo: 'sabes', re: /\b(sabes|conoces|manejas|tienes)\b.*\b(fichas?\s+tecnicas?|fichas?|especificaciones|documentacion|catalogo)\b/ },
]);

/**
 * `null` si la pregunta NO es sobre el Asistente. **Es el caso normal**, y equivocarse
 * aquí cuesta caro: una pregunta de producto tragada como meta se contesta con
 * una presentación en vez de con su ficha.
 *
 * Por eso ninguna de las formas casa sin un verbo de conocimiento o un
 * interrogativo de cantidad: «¿qué es el CLIP 3.0?» **no** es «¿qué eres?».
 */
export function tipoSobreMiDe(pregunta: string | null | undefined): TipoSobreMi | null {
  if (!pregunta) return null;
  const t = normalizar(pregunta);
  if (t.length === 0 || t.length > 120) return null;
  for (const p of PATRONES) {
    if (p.re.test(t)) return p.tipo;
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// LAS RESPUESTAS
//
// Cada una combina copy FIJO de `voz.ts` con cifras CONSULTADAS. Ni una cifra
// escrita a mano: si el corpus crece mañana, la respuesta crece sola — que es
// justo lo que la tarjeta de `capacidades` no hacía.


/** «brand1, Series5 e Brand2» — con «y» al final, que es como se lee en voz alta. */
function enumerar(xs: readonly string[]): string {
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  return `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;
}

/**
 * La respuesta a una pregunta sobre el Asistente.
 *
 * `null` cuando no hay nada que decir con honestidad — hoy sólo si el corpus
 * está vacío. **No se inventa un «tengo muchas»**: cero es un valor y se dice.
 */
export function respuestaSobreMi(tipo: TipoSobreMi, se: LoQueSe): string {
  const marcas = enumerar(se.marcas.map((m) => m.nombre));

  switch (tipo) {
    case 'quien_eres':
      return QUIEN_SOY;

    case 'ayuda':
      return AYUDA_CLARO;

    case 'cuantas':
      return se.fichas === 0
        ? 'Ahora mismo no tengo ninguna ficha cargada.'
        : `Tengo ${se.fichas} fichas de producto, de ${se.marcas.length} marcas.`;

    case 'marcas':
      return se.marcas.length === 0
        ? 'Ahora mismo no tengo fichas de ninguna marca.'
        : `Sé de ${marcas}. Dime un producto de cualquiera de ellas y te digo qué trae su ficha.`;

    case 'sabes':
    default:
      // EL SÍ VA PRIMERO. Es una pregunta de sí o no, y el SOUL §3 prohíbe
      // contestarla con una lista de capacidades — que es lo que hacía.
      return se.fichas === 0
        ? 'Todavía no tengo fichas cargadas, así que de eso no puedo contestarte.'
        : `Sí. Tengo ${se.fichas} fichas de producto, de ${marcas}. Dime un producto y te digo qué trae.`;
  }
}
