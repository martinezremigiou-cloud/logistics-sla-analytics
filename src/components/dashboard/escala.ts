// ============================================================
// [DASH-D · D-1] escala.ts — una sola forma de normalizar, con el denominador
// en la firma.
//
// POR QUÉ EXISTE. Las dos gráficas a mano del dashboard normalizaban cada una
// por su cuenta y las dos usaban un MÁXIMO SUELTO en vez de un DOMINIO. Eso las
// dejaba sin poder expresar dos casos que sí ocurren:
//
//   · Una serie PLANA. `max - min` es 0, y el `|| 1` que lo tapaba metía un
//     rango falso: todos los puntos daban 0 y la línea se dibujaba contra el
//     PISO. Una serie que no varía quedaba afirmando «éste es el mínimo» —
//     una afirmación sobre el dato que el dato nunca hizo.
//   · Un valor NEGATIVO. `Math.max(piso, v / max)` subía el negativo al piso…
//     y el cero también. Los dos terminaban en el mismo punto del polígono, así
//     que el SIGNO dejaba de existir en la geometría.
//
// EL ANTÍDOTO ES ESTRUCTURAL, no una corrección puntual: **no se puede escalar
// sin pasar un `Dominio`**. Es la regla #3 de la casa —nombrar el denominador—
// movida a un sitio donde no se puede olvidar, que es el único antídoto contra
// P25 que este repo reconoce como bueno (volver el caso inexpresable en la
// firma, en vez de arreglar los dos sitios que hoy lo tienen mal).
//
// El candado está en `escala.test.ts`, con los dos mutantes escritos: si
// alguien reintroduce `max - min || 1` o `Math.max(piso, v / max)`, se pone rojo.
// ============================================================

/** El rango contra el que se normaliza. Se construye con `dominioDe`, que garantiza `max > min`. */
export interface Dominio {
  min: number;
  max: number;
}

/**
 * El dominio de una serie. **Con una serie plana NO devuelve un dominio
 * degenerado**: abre un rango de 1 CENTRADO en el valor.
 *
 * Es el mismo `1` que inventaba el viejo `max - min || 1`, con la diferencia
 * que importa: allá se sumaba solo por arriba —así que el valor quedaba en el
 * mínimo del rango, o sea en el piso del dibujo—; aquí se reparte a los dos
 * lados, y el valor cae al centro. Una serie sin variación se dibuja en medio,
 * que es lo que significa.
 *
 * `incluirCero` es explícito a propósito: quien no lo pide, no lo tiene. Un
 * cero metido de oficio cambia la escala de una serie que nunca se acerca a él.
 */
export function dominioDe(valores: number[], opts?: { incluirCero?: boolean }): Dominio {
  let min = Math.min(...valores);
  let max = Math.max(...valores);

  if (opts?.incluirCero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }

  if (min === max) return { min: min - 0.5, max: max + 0.5 };

  return { min, max };
}

/**
 * Mapea el dominio a un tramo de píxeles. `pxMin` y `pxMax` van en el orden que
 * el consumidor necesite: para el eje `y` de un SVG se pasa el piso primero y
 * el techo después, porque ahí la `y` crece hacia abajo.
 */
export function escalaLineal(d: Dominio, pxMin: number, pxMax: number): (v: number) => number {
  const rango = d.max - d.min;
  return (v) => pxMin + ((v - d.min) / rango) * (pxMax - pxMin);
}

/**
 * Mapea el dominio a la fracción del radio de un radar, entre `pisoVisible` y 1.
 *
 * El piso existe para que el mínimo no colapse sobre el centro (quedaría
 * invisible y rompería el polígono), pero **solo lo toca el mínimo del
 * dominio**: todo lo demás se reparte por encima. Por eso un negativo y un cero
 * dejan de caer en el mismo sitio — que es lo que pasaba cuando el piso se
 * aplicaba con un `Math.max` sobre una fracción ya calculada.
 */
export function escalaRadial(d: Dominio, pisoVisible: number): (v: number) => number {
  const rango = d.max - d.min;
  return (v) => pisoVisible + ((v - d.min) / rango) * (1 - pisoVisible);
}
