// ============================================================
// [2.0.1-A] carril.ts — EL RÉGIMEN DE CONVIVENCIA DEL PIE (100% PURO).
//
// Es el hermano VERTICAL de la regla espacial de O6 (INV-B11), que resolvió el
// eje horizontal en escritorio —«izquierda es lo tuyo, derecha es el
// asistente»— volviendo la colisión irrepresentable en vez de arreglándola caso
// por caso. Bajo `md` no hay dos costados que repartir: hay un pie de pantalla
// donde tres superficies quieren estar a la vez.
//
// ────────────────────────────────────────────────────────────
// LA REGLA
//
//   > **El pie de la pantalla es un carril de PISOS. Cada superficie flotante
//   > ocupa un piso entero, y nadie se sienta en el pie de otro.**
//
//   1 · El suelo es de la navegación. `BottomNav` es lo único que toca
//       `bottom: 0`, y DECLARA su alto (antes lo suponían otros tres archivos).
//   2 · Se apila por ESTABILIDAD, no por importancia: lo que no cambia de alto
//       va abajo (nav, burbuja del asistente); lo que crece va arriba y crece
//       hacia el techo (la Selección: nada → píldora → panel). Con la Selección
//       abajo, la burbuja saltaría a media pantalla al desplegar el panel, y un
//       lanzador que se mueve es un lanzador que no se encuentra.
//   3 · Nadie escribe su propio número: `piso(n) = piso(n-1) + alto(n-1) +
//       hueco`, calculado en UN sitio — este archivo, espejado en tokens CSS.
//   4 · Un DESPLEGADO no se apila: ocupa el carril desde su piso hacia arriba.
//       Si llegara a cubrir a otro, es excepción MODAL declarada por nombre, y
//       jamás cierra el trabajo del usuario (decisión de producto en O6).
//   5 · La cortesía cede ante el trabajo: el saludo del asistente y la Selección
//       compiten por el mismo espacio, así que **con Selección no hay saludo**.
//   6 · Bajo `md` manda el carril (vertical); de `md` para arriba manda O6
//       (horizontal). Misma regla, dos ejes.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ NACE, con los números que lo obligaron (medidos a 390×844 el
// 2026-08-26 con el `layout-check` y con sondas de `elementFromPoint`):
//
//   · La burbuja del asistente se plantaba DENTRO de la banda de la navegación:
//     traslape real de 48×34 px sobre el ítem «Más» (H1). Cuatro archivos
//     escribían su propio offset —`bottom-5`, `bottom-20`,
//     `calc(3.5rem+env+0.75rem)`, `pb-14/pb-32`— y «el nav mide 3.5rem» estaba
//     escrito tres veces… en ninguno de ellos el nav lo declaraba. Medía 54.
//   · El saludo del asistente cubría el CENTRO de la píldora de Selección:
//     `elementFromPoint` sobre ese punto devolvía el saludo, no la píldora, así
//     que el tap no llegaba (H4) — con un comentario que afirmaba por escrito
//     que «no bloquea nada».
//
// Ninguno de los dos era un defecto de píxeles: los dos son el mismo defecto de
// ARQUITECTURA — que nadie fuera dueño del pie.
//
// ────────────────────────────────────────────────────────────
// CÓMO SE SOSTIENE. Este archivo es la fuente; `globals.css` lleva los tokens
// que el navegador entiende; `carril.test.ts` compara los dos (mismo molde que
// `documento/tokens.globals.test.ts`, que ya cerró esta misma clase de
// duplicación para los colores del documento) y además vigila que ningún
// ocupante vuelva a escribir su propio `bottom-*`. Y el `layout-check` mide el
// EFECTO en el navegador, que es lo único que ninguna de las dos puede ver.
// ============================================================

/** Separación entre pisos. Un solo valor, para que la escalera sea pareja. */
export const HUECO = '0.75rem';

/** Alto declarado de la barra de navegación móvil (`BottomNav`). */
export const ALTO_NAVEGACION = '3.5rem';

/** Alto del lanzador del asistente (la burbuja: `h-12`). */
export const ALTO_ASISTENTE = '3rem';

/**
 * Los pisos del carril, del suelo hacia arriba. El ORDEN es la escalera: cada
 * piso se para sobre el anterior. Agregar un ocupante es agregar una entrada
 * aquí — nunca un `bottom-` nuevo en un componente.
 */
export const PISOS = [
  {
    nombre: 'navegacion',
    token: '--mx-carril-suelo',
    /** Lo consume el `pb` del `<main>`; el nav se ancla a `bottom-0` y ES el suelo. */
    descripcion: 'BottomNav — el suelo, más el área segura del dispositivo',
  },
  {
    nombre: 'asistente',
    token: '--mx-carril-asistente',
    descripcion: 'La burbuja del chat y, apilado sobre ella en su mismo contenedor, el saludo',
  },
  {
    nombre: 'seleccion',
    token: '--mx-carril-seleccion',
    descripcion: 'La Selección: píldora contraída o panel, que crece hacia el techo',
  },
] as const;

export type NombrePiso = (typeof PISOS)[number]['nombre'];

/**
 * La expresión CSS EXACTA que debe llevar cada token en `globals.css`. Es la
 * escalera de la regla 3 escrita una sola vez: `piso(n) = piso(n-1) + alto(n-1)
 * + hueco`. `carril.test.ts` compara esto contra el CSS fuente, así que los dos
 * no pueden divergir en silencio.
 */
export const EXPRESION_DE_TOKEN: Record<string, string> = {
  '--mx-carril-alto-nav': ALTO_NAVEGACION,
  '--mx-carril-alto-asistente': ALTO_ASISTENTE,
  '--mx-carril-hueco': HUECO,
  '--mx-carril-suelo': 'calc(var(--mx-carril-alto-nav) + env(safe-area-inset-bottom))',
  '--mx-carril-asistente': 'calc(var(--mx-carril-suelo) + var(--mx-carril-hueco))',
  '--mx-carril-seleccion': 'calc(var(--mx-carril-asistente) + var(--mx-carril-alto-asistente) + var(--mx-carril-hueco))',
};

/** La clase de anclaje vertical que le toca a un ocupante. Nadie escribe el número; se pide el piso. */
export function anclaDePiso(nombre: NombrePiso): string {
  const piso = PISOS.find((p) => p.nombre === nombre);
  if (!piso) throw new Error(`carril: piso desconocido «${nombre}»`);
  return `bottom-[var(${piso.token})]`;
}

/** Alto de la píldora contraída de la Selección. */
export const ALTO_PILDORA = '2.75rem';

/** La reserva sin píldora: sólo el suelo. En `md` el suelo vale ~0 (el nav no existe), así que se degrada solo. */
export const RESERVA_SUELO = 'pb-[var(--mx-carril-suelo)]';

/**
 * La misma reserva, prefijada para `md`. Escrita ENTERA y no compuesta con una
 * plantilla por el mismo motivo que el `2.75rem` de abajo: **el extractor de
 * Tailwind lee el texto del fuente**, y `` `md:${RESERVA_SUELO}` `` no deja en
 * ningún archivo la cadena `md:pb-[var(--mx-carril-suelo)]` que hay que
 * escanear — la clase no se generaría y el `pb` de `md` sería silenciosamente
 * cero, que es justo el defecto que esta corrección viene a cerrar. La guarda
 * de `carril.test.ts` comprueba que las dos copias digan lo mismo.
 */
export const RESERVA_SUELO_ESCRITORIO = 'md:pb-[var(--mx-carril-suelo)]';

/**
 * La reserva con píldora flotando: el carril hasta el techo de la píldora, más
 * un hueco. El `2.75rem` está escrito a mano **a propósito y no por descuido**:
 * Tailwind genera clases escaneando el TEXTO del fuente, así que una plantilla
 * `` `pb-[calc(...${ALTO_PILDORA}...)]` `` no produciría ninguna regla CSS y el
 * `pb` sería silenciosamente cero. `carril.test.ts` compara esta cadena contra
 * `ALTO_PILDORA` para que la copia no pueda divergir.
 */
export const RESERVA_CON_PILDORA = 'pb-[calc(var(--mx-carril-seleccion)+2.75rem+var(--mx-carril-hueco))]';

/** Quién flota sobre el contenido, en cada uno de los dos regímenes de la regla 6. */
export interface OcupantesDelPie {
  /** ¿Flota la píldora bajo `md`? Ahí nunca hay sidebar: flota siempre que la Selección no esté vacía. */
  pildora: boolean;
  /** ¿Y de `md` para arriba? SÓLO con el sidebar colapsado — expandido, la Selección vive en su pie y no flota. */
  pildoraEnEscritorio: boolean;
}

/**
 * El hueco que el contenido debe reservarse abajo para no quedar tapado.
 * `position: fixed` no ocupa flujo: si el `<main>` no reserva esto, los
 * controles del final de una página (la paginación del catálogo, los botones de
 * un proyecto) quedan debajo de un flotante y nadie puede tocarlos.
 *
 * SE PIDE POR OCUPANTES, NO POR BREAKPOINT, y esa firma es la corrección de un
 * defecto que este bloque introdujo: `app-shell.tsx` llamaba a la versión de un
 * solo booleano y luego le pegaba un `"md:pb-0"` **fuera del ternario**, así que
 * de `md` para arriba la reserva era cero *hubiera o no* píldora. Con el sidebar
 * colapsado la Selección SÍ flota en escritorio (`app-shell.tsx` lo decide con
 * `colapsado`), y la paginación del catálogo quedaba debajo de ella sin que
 * nadie pudiera tocarla — exactamente el defecto que la reserva existe para
 * evitar, reintroducido por el arreglo. Pasarle los dos hechos hace que el caso
 * ni siquiera sea expresable: no hay dónde escribir un `md:` suelto.
 */
export function reservaDeContenido({ pildora, pildoraEnEscritorio }: OcupantesDelPie): string {
  if (!pildora) return RESERVA_SUELO;
  // Con píldora bajo `md` pero no en escritorio, la reserva vuelve al suelo en
  // `md` — y al suelo, no a `pb-0`: el `env(safe-area-inset-bottom)` sigue
  // siendo real en una tableta grande.
  return pildoraEnEscritorio ? RESERVA_CON_PILDORA : `${RESERVA_CON_PILDORA} ${RESERVA_SUELO_ESCRITORIO}`;
}

/**
 * El atributo que publica el shell en `<html>` para que el CSS sepa si hay
 * Selección viva. Es lo que hace cumplir la regla 5 SIN acoplar componentes: el
 * saludo no importa nada de la Selección (y `flotantes.test.ts` prohíbe que el
 * asistente la conozca, con razón) — se aparta por una regla del carril.
 */
export const ATRIBUTO_SELECCION = 'data-carril-seleccion';
