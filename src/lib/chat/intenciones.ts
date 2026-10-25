// ============================================================
// [INV-B10] lib/chat/intenciones.ts — EL CATÁLOGO CERRADO. 100% PURO.
//
// LA PIEZA QUE HACE QUE EL «NO SÉ» SEA ESTRUCTURA Y NO UNA SÚPLICA AL MODELO.
//
// La regla #5 del ARRANQUE —«decir "no sé" localizado vale más que una
// respuesta plausible»— en casi todos los sistemas de este tipo se implementa
// pidiéndole al modelo que sea humilde en el prompt. Eso no es un mecanismo:
// es una esperanza. Aquí el «no sé» sale de que **este arreglo es finito**: si
// la intención no está, no hay función que llamar, y no hay nada que redactar.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SON SEIS Y NO TRES, que es lo que traía el brief.
//
// El brief listaba tres intenciones y **las tres exigen un SKU**. Pero la
// maqueta XUI (`Version 2.2`, línea 1766) propone este zero-state:
//
//   ['¿Qué hay en aduana?', '¿Qué SKUs están sobre-reservados?', 'Háblame del Series2…']
//
// **Ninguna de las tres lleva SKU.** Con un catálogo de tres, el zero-state
// habría anunciado tres preguntas que el sistema no sabe contestar — y habría
// disparado su propio «no sé» contra sus propias sugerencias. Eso es P7
// (interfaz fantasma) con la peor forma posible: la que se contradice sola.
//
// Y salieron baratas porque las tres YA son funciones probadas del repo:
// `listEmbarques`, `listInventory({badge})` y `listInventory({q})`. Pasar de 3
// a 6 no costó código de datos: costó tres entradas de este arreglo.
//
// ────────────────────────────────────────────────────────────
// LA SUGERENCIA VIVE DENTRO DE LA INTENCIÓN, y no en el componente.
//
// Condición acordada: «que esa correspondencia sea una prueba, no una
// convención — si alguien agrega una sugerencia sin intención detrás, que
// salga rojo». La forma más fuerte de cumplirlo no es probar que coinciden:
// es que **no puedan diferir**. El zero-state se PINTA desde este arreglo, así
// que una sugerencia huérfana es irrepresentable.
// ============================================================

/** Las seis. Cerrado a propósito: agregar una es agregar una entrada aquí. */
export type Intencion =
  | 'llegada'
  | 'disponibilidad'
  | 'clasificacion'
  | 'pipeline'
  | 'sobre_reservados'
  | 'buscar_por_nombre'
  /** [INV-B11] La séptima: la ficha técnica. Ver su entrada en el catálogo. */
  | 'documental'
  // ============================================================
  // [INV-B11] O6 · LAS CUATRO CONCEPTUALES.
  //
  // Las seis primeras contestan sobre UN PRODUCTO. Éstas cuatro contestan
  // **sobre el sistema y sobre ti** — y por eso faltaban: el enrutador se
  // construyó alrededor de «¿qué le pasa a este SKU?».
  //
  // `capacidades` es la más absurda de las que faltaban: hoy `¿qué puedes
  // hacer?` cae en `ninguna`, el sistema contesta «no sé» **y acto seguido
  // imprime la lista de lo que sabe hacer**. Tenía la respuesta en la mano y
  // decía que no la tenía.
  //
  // `mis_proyectos` es la PRIMERA que cruza la regla del individualismo: las
  // otras nueve leen inventario compartido, ésta lee dato filtrado por
  // `perfil_id`. Ver su nota en `chat.service.ts` y el arnés en vivo.
  // ============================================================
  | 'capacidades'
  | 'destacado_hoy'
  | 'mis_proyectos'
  | 'snapshots_recientes';

export interface DefinicionIntencion {
  id: Intencion;
  /**
   * Qué contesta, en palabras de vendedor. **Es el texto que enumera el «no
   * sé»**, así que no puede ser jerga: quien lee esto es alguien a quien el
   * sistema le acaba de decir que no supo.
   */
  descripcion: string;
  /**
   * Si hace falta un SKU RESUELTO para poder contestar. El enrutador no
   * resuelve nada —eso necesita la base—, solo declara la necesidad.
   */
  requiereSku: boolean;
  /**
   * Lo que se ofrece en el zero-state — **con sus parámetros ya resueltos**.
   *
   * No es solo el texto: un clic en el chip **no llama al modelo**. Enrutar por
   * modelo algo cuyo destino ya está escrito en el chip sería pagar 3,6 s y una
   * llamada por una respuesta que ya teníamos. Y el clic en un chip es la
   * primera interacción de casi todo el mundo: que esa primera vez sea
   * instantánea decide si la persona vuelve.
   *
   * Por eso `sku` y `termino` viven aquí: la sugerencia se describe entera a sí
   * misma, y el atajo no necesita adivinar nada.
   */
  sugerencia: { texto: string; sku: string | null; termino: string | null };
  /**
   * **Cómo se pregunta esto de un SKU YA NOMBRADO**, con `{sku}` de hueco.
   * `null` para las que no van sobre un SKU.
   *
   * Existe porque `descripcion` no sirve de botón cuando el SKU ya está a la
   * vista: dice «un SKU» —«Cuándo llega **un SKU**: su etapa, su ETA…»— justo
   * debajo de un renglón que acaba de nombrar KL2722. `descripcion` describe
   * una CAPACIDAD a quien acaba de oír «no sé»; aquí hace falta la PREGUNTA.
   *
   * Y así el botón muestra **literalmente lo que va a preguntar**: la etiqueta
   * y el mensaje que queda en la conversación son la misma cadena, no dos
   * versiones de la misma idea que puedan separarse.
   *
   * Va emparejado con `requiereSku` —no nulo exactamente cuando aquél es
   * `true`— y hay una prueba que lo vigila, porque son dos campos hablando
   * de lo mismo y nada más los ata.
   */
  preguntaSobreSku: string | null;
  /** De dónde sale el dato. Va en la tarjeta como procedencia (regla #1). */
  fuente: string;
}

export const INTENCIONES: readonly DefinicionIntencion[] = Object.freeze([
  {
    id: 'llegada',
    descripcion: 'Cuándo llega un SKU: su etapa, su ETA y si viene retrasado.',
    requiereSku: true,
    sugerencia: { texto: '¿Cuándo llega el SUJ500-F?', sku: 'SUJ500-F', termino: null },
    preguntaSobreSku: '¿Cuándo llega el {sku}?',
    fuente: 'embarques del snapshot vigente de aduana',
  },
  {
    id: 'disponibilidad',
    descripcion: 'Cuánto hay de un SKU y quién lo tiene reservado.',
    requiereSku: true,
    sugerencia: { texto: '¿Cuánto hay disponible de SUJ500-F y quién lo reservó?', sku: 'SUJ500-F', termino: null },
    preguntaSobreSku: '¿Cuánto hay de {sku} y quién lo tiene reservado?',
    fuente: 'stock y reservas del snapshot vigente',
  },
  {
    id: 'clasificacion',
    descripcion: 'Qué familias, clase y tecnología tiene un SKU.',
    requiereSku: true,
    sugerencia: { texto: '¿Qué familias tiene el SUJ500-F?', sku: 'SUJ500-F', termino: null },
    preguntaSobreSku: '¿Qué familias y tecnología tiene el {sku}?',
    fuente: 'clasificación efectiva del catálogo',
  },
  {
    id: 'pipeline',
    descripcion: 'Qué hay en camino ahora mismo, por etapa, y qué viene retrasado.',
    requiereSku: false,
    sugerencia: { texto: '¿Qué hay en aduana?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'embarques activos del snapshot vigente de aduana',
  },
  {
    id: 'sobre_reservados',
    descripcion: 'Qué SKU tienen más comprometido que disponible.',
    requiereSku: false,
    sugerencia: { texto: '¿Qué SKUs están sobre-reservados?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'catálogo derivado del snapshot vigente',
  },
  {
    // ========================================================
    // [INV-B11] O5 · LA SÉPTIMA, y llegó SIN TOCAR EL ENRUTADOR.
    //
    // El brief pedía «una tercera salida del enrutador». No hizo falta ninguna:
    // el prompt, el `enum` de zod, el «no sé» que enumera, el zero-state y los
    // botones de `elegir_intencion` **se pintan todos desde este arreglo**. Una
    // entrada aquí los alcanza a los cinco.
    //
    // Es el rendimiento del diseño de B10 cobrado un bloque después: el catálogo
    // como fuente única convirtió «agregar una capacidad» en «agregar un dato».
    //
    // ────────────────────────────────────────────────────────
    // EL SKU DE LA SUGERENCIA NO ES CUALQUIERA, y esta vez está medido.
    //
    // Los otros chips hornean `SUJ500-F`. **Su familia no tiene ficha todavía**
    // —la cobertura del puente es parcial— así que ese chip habría anunciado
    // una capacidad y contestado «no tengo ficha de este producto»: P7 con la
    // peor forma, la que se contradice sola.
    //
    // `KYA2490` se eligió porque su familia (`VXQ`) SÍ tiene puente. Y como eso
    // depende de datos que cambian, **había una guarda que lo comprobaba contra la
    // base** (un script de humo que no forma parte de este repositorio). Sin ella esto sería B10-6 otra vez,
    // pero peor: allí el riesgo era que el SKU desapareciera; aquí basta con que
    // alguien borre un renglón del puente.
    // ========================================================
    id: 'documental',
    // [CHAT-B1] Deja de decir «qué DICE la ficha» y pasa a decir que CONTESTA.
    // Es lo que cambia en este bloque, y esta cadena se lee en tres sitios: el
    // chip del zero-state, la enumeración del «no sé» y la tarjeta de
    // capacidades. Si dijera lo de antes, el sistema anunciaría que entrega un
    // documento mientras entrega una respuesta — P7 al revés.
    descripcion: 'Contestar sobre un producto leyendo su ficha técnica: para qué sirve, cómo funciona y sus especificaciones, citando de dónde lo saqué.',
    requiereSku: true,
    sugerencia: { texto: '¿Qué dice la ficha del KYA2490?', sku: 'KYA2490', termino: null },
    preguntaSobreSku: '¿Qué dice la ficha del {sku}?',
    fuente: 'fichas de producto del corpus documental',
  },
  {
    id: 'buscar_por_nombre',
    descripcion: 'Encontrar un SKU a partir de su nombre o descripción.',
    requiereSku: false,
    sugerencia: { texto: 'Busca los CLIPS', sku: null, termino: 'CLIPS' },
    preguntaSobreSku: null,
    fuente: 'descripciones del catálogo',
  },
  {
    // ========================================================
    // La que ya tenía su propia respuesta y contestaba «no sé».
    //
    // `fuente` dice «el catálogo de este asistente» y no una tabla, porque es
    // la verdad: **esta intención no lee la base**. Escribir ahí un nombre de
    // tabla para que la tarjeta se vea igual que las otras sería inventarle una
    // procedencia — justo lo que la regla #1 prohíbe.
    // ========================================================
    id: 'capacidades',
    descripcion: 'Qué preguntas sé contestar.',
    requiereSku: false,
    sugerencia: { texto: '¿Qué puedes hacer?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'el catálogo de este asistente',
  },
  {
    id: 'destacado_hoy',
    descripcion: 'Qué se movió últimamente en los SKU que sigues.',
    requiereSku: false,
    sugerencia: { texto: '¿Qué se movió en lo que sigo?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'los avisos de los SKU que sigues',
  },
  {
    // ========================================================
    // LA PRIMERA QUE CRUZA LA REGLA DEL INDIVIDUALISMO. No hay `perfil_id` en
    // ningún parámetro y **es correcto**: el cliente de Supabase que llega a
    // `responder()` es el de la SESIÓN, así que la RLS de `proyectos` ya acota
    // a quien pregunta. Pasar un `perfil_id` a mano sería una segunda barrera
    // que puede divergir de la primera — y la primera es la que manda.
    // ========================================================
    id: 'mis_proyectos',
    descripcion: 'Qué proyectos tienes y qué llevan dentro.',
    requiereSku: false,
    sugerencia: { texto: '¿Qué proyectos tengo?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'tus proyectos',
  },
  {
    id: 'snapshots_recientes',
    descripcion: 'Cuándo se cargaron por última vez el inventario y la aduana.',
    requiereSku: false,
    sugerencia: { texto: '¿Cuándo se cargó el inventario?', sku: null, termino: null },
    preguntaSobreSku: null,
    fuente: 'el libro de cargas',
  },
]);

/** Los identificadores, para el `enum` de zod que valida lo que devuelve el modelo. */
export const IDS_INTENCION = INTENCIONES.map((i) => i.id) as [Intencion, ...Intencion[]];

const POR_ID = new Map<Intencion, DefinicionIntencion>(INTENCIONES.map((i) => [i.id, i]));

/**
 * La pregunta de `def` sobre `sku`, ya sustituida. `null` si no va sobre un SKU.
 *
 * Vive aquí y no en el componente para que la sustitución ocurra **en un solo
 * sitio**: el botón y el mensaje que quedan en la conversación tienen que ser
 * la misma cadena, y dos `.replace()` en dos archivos es como dejan de serlo.
 */
export function preguntaSobreSku(def: DefinicionIntencion, sku: string): string | null {
  return def.preguntaSobreSku === null ? null : def.preguntaSobreSku.replace('{sku}', sku);
}

/** `undefined` si el id no está en el catálogo — que es información, no un error. */
export function definicionDe(id: string): DefinicionIntencion | undefined {
  return POR_ID.get(id as Intencion);
}

/**
 * Lo que el sistema sabe hacer, en palabras. **Es lo que acompaña a todo «no
 * sé»**: decir «no sé» a secas deja al usuario adivinando, y adivinar contra un
 * catálogo cerrado es la peor manera de descubrirlo.
 */
export function loQueSabeHacer(): string[] {
  return INTENCIONES.map((i) => i.descripcion);
}

/**
 * El zero-state. Se pinta DESDE el catálogo, así que una sugerencia sin
 * intención detrás no se puede escribir — no hay dónde ponerla.
 *
 * **`capacidades` es la única que se queda fuera, y por una razón y no por
 * gusto: el zero-state ES su respuesta.** Un chip que dice «¿Qué puedes
 * hacer?» dentro de la lista de lo que puede hacer es circular — el usuario
 * gastaría una pregunta del techo para que le repitan lo que está leyendo.
 *
 * Se excluye aquí y no con un campo booleano en cada definición a propósito:
 * un `enZeroState` obligaría a que las diez restantes lo declaren bien, y **un
 * campo que casi siempre vale lo mismo es un campo que alguien pone mal**. Una
 * exclusión con nombre y motivo, vigilada por una prueba, no puede desviarse
 * en silencio.
 */
export function sugerencias(): { intencion: Intencion; texto: string; sku: string | null; termino: string | null }[] {
  return INTENCIONES.filter((i) => i.id !== 'capacidades').map((i) => ({ intencion: i.id, ...i.sugerencia }));
}
