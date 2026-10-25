// ============================================================
// [2.0.1-B] codigo-fuente.ts — LEER CÓDIGO, NO PROSA.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE: una clase con SEIS ejemplares, no un caso.
//
// Este repo vigila varias reglas leyendo el FUENTE: que nadie escriba su propio
// anclaje del carril, que ningún Server Component pase un manejador, que ninguna
// sesión escriba directo sobre una tabla de lista blanca… Todas comparten un
// defecto de nacimiento:
//
//   > **Una guarda que lee fuente empieza leyendo PROSA hasta que alguien se lo
//   > impide — y la prosa que la dispara es justamente la que explica el defecto
//   > que la guarda vigila.**
//
// Seis guardas aprendieron eso por su cuenta, cada una después de morder a su
// autor, y cada una escribió su propia copia de la misma función:
// `carril.test.ts`, `arnes-cuentas.test.ts`, `geometria-lista.test.ts`,
// `sin-handlers-en-server.test.ts`, `control-layout/gate.test.tsx` y
// `scripts/guarda-lista-blanca.mjs`. En el bloque 2.0.1-B mordió CUATRO veces.
// Con seis copias de la contramedida, la contramedida es lo que hay que
// compartir.
//
// ────────────────────────────────────────────────────────────
// LA SEXTA NO PUEDE IMPORTAR ESTO, y por eso se COMPARA.
//
// `scripts/guarda-lista-blanca.mjs` corre con `node` a secas: sin transpilar
// TypeScript y sin el alias `@/`. No puede importar este módulo. Así que su
// copia se queda donde está y `codigo-fuente.test.ts` la extrae y contrasta su
// RESULTADO contra el de aquí sobre una batería — el mismo molde que ya usan
// `carril.ts` vs `globals.css`: dos copias que no se pueden unir se COMPARAN.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SON DOS FUNCIONES Y NO UNA, que es donde la propuesta se afina.
//
// La idea de «quitar comentarios **y literales de cadena**» es correcta para las
// guardas que buscan una forma de CÓDIGO (`onX={() => …}`, `process.env.X`,
// `minmax(260px`). Pero **rompería a `nav-nombres.test.ts`**, cuyo trabajo es
// justamente extraer de cadenas: el texto de un `<h1>`, el `aria-label` de un
// esqueleto. Ahí la cadena no es ruido: es el dato.
//
// Así que se separan, y cada guarda toma lo que le toca:
//
//   · `sinComentarios`  — todas. La prosa nunca es el sujeto.
//   · `soloCodigo`      — las que buscan una forma de código, no un texto.
//
// Un solo `soloCodigo` obligatorio habría sido más simple de contar y habría
// dejado ciega a una de las seis. La simplicidad que rompe un caso no es
// simplicidad.
//
// ────────────────────────────────────────────────────────────
// EL CONTRATO QUE LAS TRES CUMPLEN: **no se mueve un solo carácter.**
//
// Todas neutralizan EN BLANCO en vez de borrar, y por una razón medida en este
// repo, no por elegancia: `guarda-lista-blanca.mjs` deriva el número de línea
// del CRUDO con el `m.index` del texto LIMPIO, y eso sólo vale si las dos
// cadenas tienen la misma longitud. La primera versión de aquella guarda sí
// borraba, y mandaba a `familias.service.ts:29` (un SELECT) en vez de `:69` (el
// INSERT). Una guarda que manda a alguien a la línea equivocada gasta la
// confianza que necesita para que le hagan caso.
// ============================================================

/** Sustituye cada carácter por un espacio, MENOS los saltos de línea. */
const enBlanco = (m: string) => m.replace(/[^\n]/g, ' ');

/**
 * Quita comentarios de bloque y de línea, en blanco: misma longitud, mismos
 * saltos de línea, misma numeración.
 *
 * El `(^|[^:])` del segundo evita comerse el `//` de una URL (`https://…`), y no
 * es un falso positivo teórico: sin él, **todo lo que comparta línea con una URL
 * desaparece**, y una guarda que busca escrituras dejaría de ver un
 * `db.from('perfiles').insert(…)` escrito después de un `fetch("https://…")`.
 */
export function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_m, antes: string, comentario: string) => antes + enBlanco(comentario));
}

/**
 * Vacía el CONTENIDO de los literales de cadena —comillas simples, dobles y
 * plantillas— dejando las comillas en su sitio y el mismo número de caracteres.
 *
 * **Lo que hay dentro de un `${…}` de plantilla NO se vacía, y es un arreglo, no
 * un detalle.** Ahí no hay texto: hay CÓDIGO. La primera versión lo blanqueaba
 * con todo lo demás, y una guarda que buscaba `ATRIBUTO_AVANZAR` en
 * `scripts/layout-check.mjs` no lo encontró — porque su único uso vive dentro de
 * un `` `[${ATRIBUTO_AVANZAR}]:visible` ``. Una contramedida contra falsos
 * positivos que produce falsos NEGATIVOS es peor que no tenerla: la primera
 * grita de más, la segunda calla.
 *
 * **El límite que queda, demostrado en la prueba y no sólo advertido:** la
 * interpolación se reconoce con `\$\{[^{}]*\}`, o sea un nivel. Un `${a ? {x:1} :
 * b}` —con llaves dentro— vuelve a blanquearse. No se hace un analizador: lo que
 * hay hoy en este repo son interpolaciones de un identificador, y un analizador
 * a medias sería otra cosa que puede mentir.
 *
 * **Cuándo NO usar esto:** cuando lo que la guarda busca VIVE en una cadena (un
 * `aria-label`, el texto de un `<h1>`, una clase de Tailwind que se compara como
 * valor). Ahí esta función borra justo el dato.
 */
export function sinCadenas(texto: string): string {
  return texto.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, (m: string, comilla: string) => {
    const dentro = m.slice(1, -1);
    const limpio =
      comilla === '`'
        ? dentro.replace(/\$\{[^{}]*\}|[^]/g, (t) => (t.startsWith('${') ? t : enBlanco(t)))
        : enBlanco(dentro);
    return `${comilla}${limpio}${comilla}`;
  });
}

/**
 * Lo que una guarda debe mirar cuando busca una FORMA DE CÓDIGO: sin prosa y sin
 * el contenido de las cadenas. Es lo que impide los dos falsos positivos que ya
 * ocurrieron —un comentario que cita el patrón prohibido, y una prueba que lo
 * escribe como cadena de ejemplo— sin tocar el código de verdad.
 */
export function soloCodigo(texto: string): string {
  return sinCadenas(sinComentarios(texto));
}

/**
 * El cuerpo de un bloque `marcador … { … }`, emparejando llaves desde la
 * primera que sigue al marcador hasta la que la cierra.
 *
 * **Pásale texto ya limpio de comentarios.** Localiza por `indexOf`, así que un
 * marcador citado en prosa le roba el bloque al de verdad — y una llave dentro
 * de un comentario le descuadra el conteo. Las dos cosas pasaron en 2.0.1-B.
 *
 * Emparejar y no contar caracteres es lo que lo distingue de un
 * `[\s\S]{0,400}?`: un presupuesto fijo convierte «escribí un comentario largo»
 * en «la guarda no encontró el tipo», que es lo que le pasó a
 * `contrato-de-lista.test.ts` en S-1.
 */
export function bloqueDe(fuente: string, marcador: string): string {
  const i = fuente.indexOf(marcador);
  if (i === -1) return '';
  const abre = fuente.indexOf('{', i);
  if (abre === -1) return '';
  let prof = 0;
  for (let k = abre; k < fuente.length; k++) {
    if (fuente[k] === '{') prof++;
    else if (fuente[k] === '}') {
      prof--;
      if (prof === 0) return fuente.slice(abre + 1, k);
    }
  }
  return '';
}
