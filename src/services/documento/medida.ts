// ============================================================
// [INV-B8.1] documento/medida.ts — texto que cabe, medido y no adivinado.
//
// LA CAUSA RAÍZ QUE ESTE MÓDULO EXISTE PARA EVITAR. Pasar `width` a
// `doc.text()` engancha la maquinaria de envoltura de pdfkit, y esa maquinaria
// hace DOS cosas que nadie le pidió. Aislado por experimento el 2026-08-13,
// variando una sola opción:
//
//   { lineBreak:false }                        → "RESERVADO"       ·  2 páginas
//   { width, lineBreak:false }                 → "RESER" + "VADO"  ·  4 páginas
//   { width, lineBreak:false, ellipsis:true }  → "RESER" + "VADO"  ·  4 páginas
//   { align:'center', lineBreak:false }        → "RESERVADO"       ·  2 páginas
//
// Es decir: **`lineBreak: false` NO desactiva la envoltura cuando hay `width`,
// y `ellipsis: true` no hace nada.** Los encabezados partidos ("RESERVADO" en
// dos renglones), las filas encimadas y las páginas huérfanas que solo
// contienen el pie son el MISMO bug con tres máscaras — y tocar
// `margins.bottom` no arregla ninguna (medido: sigue dando 4 páginas).
//
// La salida no es pelear con la maquinaria: es no entrar en ella. Aquí se mide
// el texto con `widthOfString`, se recorta si no cabe, y se dibuja con `x`/`y`
// explícitas y SIN `width`. El resultado es determinista y el alto de cada fila
// se conoce ANTES de dibujarla, que es lo que permite que dos filas no se
// encimen.
// ============================================================

/** Lo mínimo que este módulo necesita de un documento pdfkit. Tipar solo esto lo vuelve probable sin pdfkit. */
export interface MedidorDeTexto {
  widthOfString(texto: string): number;
  currentLineHeight(includeGap?: boolean): number;
}

/** El carácter de elipsis, en una sola casa: se mide y se dibuja el mismo. */
export const ELIPSIS = '…';

// ============================================================
// [2.0.1-B · S-5] PARTIR EN UN LÍMITE QUE EL TEXTO OFRECE.
//
// ────────────────────────────────────────────────────────────
// ⚠ ESTO NO ES EL BUG DE PARTIR PALABRAS VOLVIENDO. LÉELO ANTES DE DESHACERLO.
//
// La regla «ningún texto se parte a media palabra» costó tres defectos y sigue
// en pie. Pero hay que decir QUÉ prohibía exactamente, porque sin eso el
// siguiente lector ve esta función y la lee como una regresión:
//
//   · AQUEL bug partía una palabra QUE SÍ CABÍA, sin preguntar, dentro de la
//     maquinaria de envoltura de pdfkit: «RESERVADO» salía «RESER» + «VADO»
//     con `lineBreak:false` puesto. Nadie lo pidió y no se podía apagar.
//   · ESTO parte un token que NO CABE, en un límite que el propio texto ofrece,
//     midiendo con `widthOfString`, y solo después de haber intentado la línea
//     entera. **Y sustituye a algo peor:** hoy, cuando un token no cabe,
//     `envolverAlAncho` lo corta por CARÁCTER, en cualquier sitio.
//
// O sea que esto no relaja la regla: mete un paso mejor antes del peor.
//
// ────────────────────────────────────────────────────────────
// SE CORTA **DESPUÉS** DEL SEPARADOR, NUNCA ANTES.
//
// El fragmento tiene que TERMINAR en `/` o en `-` para que se lea como
// continuación. Partido antes, `DRX2263` y `/D-KZ58-28-CCZ` se leen como dos
// SKU distintos — un defecto peor que el que esto arregla, porque el primero
// parece un identificador completo y válido.
//
// ────────────────────────────────────────────────────────────
// EL JUEGO DE SEPARADORES LO ELIGIÓ LA MEDICIÓN, NO EL GUSTO.
//
// Medido sobre los tres detalles de `fixture-peor-caso`, con las 8 columnas del
// formato 1b en carta vertical (528 pt útiles). La columna que decide es el
// AHORRO sobre el detalle que no cabía (`DETALLE_TOKENS_LARGOS`, 594,4 pt):
//
//   separadores   suma de ese detalle   ahorro    ¿cierra el déficit de 66,4?
//   ninguno              594,4             0      no — es el punto de partida
//   `/-`                 512,6           81,8     sí, pero justo
//   `/-,`                432,1          162,3     sí, con margen
//   `/-,;.`              432,1          162,3     CERO ganancia sobre `/-,`
//
// Por eso son exactamente estos tres. Agregar `;` y `.` no ahorra un punto y en
// cambio parte `9.7(G6)` en `9.` + `7(G6),`, que se lee peor. **Un separador que
// no ahorra nada solo empeora la lectura**, así que el conjunto es el MÍNIMO
// SUFICIENTE y no el más generoso.
//
// ⚠ UNA CIFRA QUE SE REPORTÓ MAL, Y LA CORRECCIÓN IMPORTA MÁS QUE EL NÚMERO.
// Una versión anterior de esta tabla decía «`/-,` → cabe con 82,3 pt» y lo
// comparaba contra el déficit de 66,4. Eran DOS MAGNITUDES DISTINTAS tratadas
// como una: 66,4 es un DÉFICIT (lo que falta) y 82,3 era una HOLGURA (lo que
// sobra) — y además una holgura de un escenario que el código no ejecuta, el de
// fragmentar SIEMPRE. Bajo `pisosQueCaben`, que solo fragmenta si hace falta, la
// holgura operativa en vertical es la del peor detalle que NO fragmenta:
// **40,9 pt (7,7 %)**. Comparar magnitudes distintas es el mismo error de eje
// que ya costó una medición en este bloque, con otro traje.
// ============================================================

/** Los caracteres tras los cuales un token se puede partir. Ver la cabecera: los eligió la medición. */
export const SEPARADORES_DE_CORTE = '/-,';

/**
 * Un token partido en fragmentos, cortando DESPUÉS de cada separador.
 *
 * Todo fragmento salvo posiblemente el último TERMINA en un separador — es la
 * señal de continuación, y es lo que impide que `DRX2263` se lea como un SKU
 * completo. Un token sin separadores vuelve entero: esta función nunca inventa
 * un corte que el texto no ofrezca.
 */
export function fragmentosDe(token: string): string[] {
  const salida: string[] = [];
  let actual = '';
  for (const caracter of token) {
    actual += caracter;
    if (SEPARADORES_DE_CORTE.includes(caracter)) {
      salida.push(actual);
      actual = '';
    }
  }
  if (actual) salida.push(actual);
  return salida.length > 0 ? salida : [token];
}

/**
 * `texto` recortado para que quepa en `ancho`, con elipsis si hubo recorte.
 *
 * Recorta por CARACTERES y no por palabras a propósito: el peor caso del
 * catálogo es un SKU largo sin espacios útiles
 * (`EGZtB: DKmVtE FK1179-W FB4711-W`) y una descripción muy larga. Recortar por
 * palabra dejaría celdas casi vacías cuando la primera palabra ya no cabe.
 *
 * Devuelve cadena vacía si ni la elipsis cabe — nunca desborda.
 */
export function recortarAlAncho(doc: MedidorDeTexto, texto: string, ancho: number): string {
  if (ancho <= 0) return '';
  if (doc.widthOfString(texto) <= ancho) return texto;

  const anchoElipsis = doc.widthOfString(ELIPSIS);
  if (anchoElipsis > ancho) return '';

  // Búsqueda binaria sobre la longitud: `widthOfString` es lo caro de esta
  // función y una tabla de 200 filas × 9 columnas la llamaría miles de veces
  // con un recorrido lineal.
  let bajo = 0;
  let alto = texto.length;
  while (bajo < alto) {
    const medio = Math.ceil((bajo + alto) / 2);
    if (doc.widthOfString(texto.slice(0, medio)) + anchoElipsis <= ancho) bajo = medio;
    else alto = medio - 1;
  }

  return bajo === 0 ? ELIPSIS : texto.slice(0, bajo).trimEnd() + ELIPSIS;
}

/**
 * `texto` partido en las líneas que caben en `ancho`, hasta `maxLineas`. La
 * última línea lleva elipsis si quedó texto fuera.
 *
 * Parte por PALABRAS y cae a carácter solo cuando una palabra sola no cabe —
 * al revés que `recortarAlAncho`, porque aquí sí hay varias líneas y romper
 * palabras que caben haría el texto ilegible.
 */
export function envolverAlAncho(
  doc: MedidorDeTexto,
  texto: string,
  ancho: number,
  maxLineas: number,
): string[] {
  if (ancho <= 0 || maxLineas <= 0) return [];

  const lineas: string[] = [];
  let actual = '';
  let pendientes = texto.split(/\s+/).filter(Boolean);

  const cerrarLinea = () => {
    if (actual) lineas.push(actual);
    actual = '';
  };

  while (pendientes.length > 0 && lineas.length < maxLineas) {
    const palabra = pendientes[0];
    const tentativa = actual ? `${actual} ${palabra}` : palabra;

    if (doc.widthOfString(tentativa) <= ancho) {
      actual = tentativa;
      pendientes = pendientes.slice(1);
      continue;
    }

    if (actual) {
      cerrarLinea();
      continue;
    }

    // [2.0.1-B · S-5] PRIMERO se intenta partir en un límite que el texto
    // OFRECE. `DK288-X-A/DKM37-B14` tiene cortes naturales tras `/` y `-`, y
    // usarlos deja fragmentos legibles que terminan en el separador —señal de
    // continuación— en vez de un tajo a media palabra. Ver `fragmentosDe`.
    const fragmentos = fragmentosDe(palabra);
    if (fragmentos.length > 1) {
      // Se toman todos los fragmentos que quepan juntos; al menos uno siempre
      // entra, porque si ni el primero cabe se cae al corte por carácter de
      // abajo en la siguiente vuelta.
      let tomados = 0;
      let acumulado = '';
      for (const f of fragmentos) {
        if (doc.widthOfString(acumulado + f) > ancho) break;
        acumulado += f;
        tomados++;
      }
      if (tomados > 0) {
        lineas.push(acumulado);
        pendientes = [fragmentos.slice(tomados).join(''), ...pendientes.slice(1)].filter(Boolean);
        continue;
      }
    }

    // Una palabra sola que no cabe NI POR FRAGMENTOS se PARTE por carácter y el
    // resto vuelve a la cola. NO se trunca: los SKU reales llegan sin espacios
    // (`DK288-X-A/DKM37-B14`) y truncar ahí borraría la identidad de la fila,
    // que es lo único que no se puede perder de una partida.
    let corte = palabra.length;
    while (corte > 1 && doc.widthOfString(palabra.slice(0, corte)) > ancho) corte--;
    lineas.push(palabra.slice(0, corte));
    pendientes = [palabra.slice(corte), ...pendientes.slice(1)];
  }

  if (actual && lineas.length < maxLineas) cerrarLinea();

  // Solo si se agotaron las líneas disponibles se confiesa el recorte con
  // elipsis. Con `maxLineas` dimensionado al peor caso real esto no ocurre —
  // es la red por si algún día llega un texto que ni así cabe.
  if (pendientes.length > 0 && lineas.length > 0) {
    const ultima = lineas[lineas.length - 1];
    if (!ultima.endsWith(ELIPSIS)) {
      lineas[lineas.length - 1] = recortarAlAncho(doc, `${ultima}${ELIPSIS}`, ancho) || ultima;
    }
  }

  return lineas;
}
