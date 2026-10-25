// ============================================================
// [2.0.1-B · S] geometria-lista.ts — LA REJILLA DE `/proyectos`, EN UN SOLO SITIO.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE. El literal `grid-cols-[repeat(auto-fill,minmax(260px,1fr))]
// gap-3.5` vivía copiado en TRES archivos —la vista, el esqueleto y la página de
// evidencia— y **nada los comparaba**.
//
// El fallo que eso permite no es cosmético y no lo caza ninguna prueba: si
// alguien rehace la vista y olvida el esqueleto, la pantalla **carga con una
// geometría y resuelve con otra**. El salto solo existe durante la transición,
// así que un DOM ya asentado —que es lo que miden vitest y el `layout-check`—
// lo ve perfecto en los dos extremos y ciego en el medio. Es peor que el defecto
// original, porque además es invisible.
//
// Deuda con nombre: ESQUELETO-Y-VISTA-NO-SE-COMPARAN.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SON CADENAS LITERALES Y NO SE COMPONEN.
//
// **Tailwind genera clases escaneando el TEXTO del fuente.** Una plantilla como
// `` `grid-cols-[repeat(auto-fill,minmax(${ANCHO},1fr))]` `` no deja en ningún
// archivo la cadena que hay que escanear: la clase no se generaría y la rejilla
// caería a `display:grid` con una sola columna, sin error. Ya se pagó esa
// lección en `carril.ts` con el `md:pb-[var(--mx-carril-suelo)]`.
//
// Por eso el valor va escrito entero aquí y las piezas sueltas de abajo existen
// solo para que `geometria-lista.test.ts` compruebe que no divergen.
// ============================================================

/** Ancho mínimo de una tarjeta antes de que la rejilla añada columna. */
export const ANCHO_MINIMO_TARJETA = '260px';

/** Separación entre tarjetas. `gap-3.5` de Tailwind = 0.875rem = 14px. */
export const HUECO_TARJETAS = 'gap-3.5';

/**
 * La rejilla de la lista. **La consumen la vista Y el esqueleto**, que es todo
 * el punto: mientras compartan esta constante no pueden desalinearse.
 */
export const REJILLA_LISTA = 'grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5';

/**
 * LA MEDIDA DE UNA TARJETA EN LA PASARELA — **una sola, para los dos**.
 *
 * ────────────────────────────────────────────────────────────
 * ESTE TOKEN ES EL QUE MATA EL SALTO DE 46 PX, y lo mata por CONSTRUCCIÓN.
 *
 * Antes de S-1 el esqueleto pintaba `h-[150px]` y la tarjeta real medía **196**:
 * 46 px de brinco al resolver la carga, invisible para cualquier prueba porque solo existe en la
 * transición. La respuesta no es «acordarse de igualarlos»: es que **no haya dos
 * números que igualar**. El contenedor de la tarjeta y el bloque del esqueleto
 * consumen esta misma cadena, y `geometria-lista.test.ts` exige que ninguno de
 * los dos escriba la suya.
 *
 * Alto FIJO y no `min-h`: en una pasarela todas las tarjetas comparten renglón,
 * así que una que crezca —la banda de huérfano— estiraría a las demás y el
 * esqueleto volvería a no coincidir. Lo que sobra se recorta con `line-clamp`,
 * que es una decisión de contenido y no de layout.
 *
 * 320 de ancho sale de la maqueta viva, no
 * de la llamada «definitiva»: la especificación clasifica a la
 * viva como referencia principal y las dos difieren en seis medidas.
 *
 * ────────────────────────────────────────────────────────────
 * [S-1] EL ALTO SUBIÓ DE 236 A 288, y de dónde sale el número.
 *
 * 236 era el alto de la tarjeta SIN portada. La del XUI la lleva, y a 320 px de
 * ancho la portada mide `140 × 320/380 ≈ 118 px` — no es una elección, es
 * aritmética del `viewBox`. Los otros 170 son el cuerpo recompuesto: chip de
 * intención, título a dos renglones como máximo, responsable, la línea de
 * métricas y «inventario del …».
 *
 * **288 es una suma, no una medición.** El `overflow-hidden` de la tarjeta lo
 * vuelve seguro —lo que sobre se recorta, nada desborda— pero que el número sea
 * el BUENO lo dice el navegador, y eso se confirma con `npm run layout-check`
 * (paso 4 del orden acordado). Si hay que ajustarlo, se ajusta AQUÍ: es el único
 * sitio donde vive, y por eso el esqueleto no puede quedarse atrás.
 */
export const DIMENSIONES_TARJETA = 'w-[320px] h-[288px]';

/** El carril: desplazamiento horizontal con anclaje obligatorio. Lo consumen la pasarela y su esqueleto. */
export const CARRIL_PASARELA = 'flex snap-x snap-mandatory gap-3.5 overflow-x-auto scroll-smooth motion-reduce:scroll-auto';

/** El anclaje de cada tarjeta dentro del carril. `snap-always` impide saltarse una al arrastrar rápido. */
export const ANCLAJE_TARJETA = 'shrink-0 snap-start snap-always';

/**
 * La medida en la LISTA VERTICAL (< 768). Mismo principio que la de la
 * pasarela: un solo número para la tarjeta y su esqueleto, porque el criterio
 * de aceptación es que la diferencia al resolver sea CERO, y eso no se cumple
 * igualando dos números sino no teniendo dos que igualar.
 *
 * A ancho completo la tarjeta necesita menos alto que en el carril: el título
 * cabe en menos renglones y la portada va RECORTADA a 72 px
 * (`PortadaTarjeta compacta`) en vez de crecer con la pantalla.
 *
 * Ese recorte no es estético: aquí el ancho es `w-full`, así que una portada de
 * alto automático haría que el alto de la tarjeta dependiera del ancho del
 * teléfono — y entonces **no habría número que el esqueleto pudiera igualar**,
 * que es exactamente el defecto que S-1 vino a matar. Con la banda fija el alto
 * vuelve a ser una constante.
 *
 * El valor se AJUSTA MIDIENDO en el navegador, y se ajusta AQUÍ — que es el
 * único sitio donde vive.
 */
export const DIMENSIONES_TARJETA_LISTA = 'w-full h-[240px]';
