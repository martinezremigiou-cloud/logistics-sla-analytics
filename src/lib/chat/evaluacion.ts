// ============================================================
// [INV-B10] lib/chat/evaluacion.ts — el conjunto de O5 y su puntuación. PURO.
//
// EL CONJUNTO Y LA PUNTUACIÓN VIVEN SEPARADOS DEL CORREDOR a propósito: así la
// puntuación se prueba sin gastar un token, y el corredor no puede tener una
// opinión sobre si algo acertó. Un evaluador que decide y mide a la vez acaba
// midiéndose a sí mismo.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ CADA PREGUNTA SE CORRE VARIAS VECES — sale de un
// hallazgo de este bloque.
//
// La API rechaza `temperature: 0` para `gpt-5.6-luna`: solo admite el valor por
// omisión. **Así que la clasificación NO es determinista.** Correr las preguntas
// una vez y reportar «28 de 30» no mide el sistema: lo muestrea una vez. No
// distingue «acierta el 93 %» de «tuve suerte en dos que fallan la mitad de las
// veces».
//
// Por eso se reporta una TASA, la barra se define como tasa, y **se lista aparte
// lo INESTABLE** — las preguntas que salen distinto entre corridas. Ésas son el
// producto más útil de la evaluación: dicen dónde el catálogo tiene fronteras
// borrosas, que es donde hay que trabajar.
//
// ────────────────────────────────────────────────────────────
// LAS CINCO PRIMERAS SON LA SEMILLA, y dos de ellas tienen que salir `ninguna`.
//
// 1.4 (especificaciones técnicas) y 1.5 (cómo funciona el software) son
// DOCUMENTALES y están fuera de alcance: el corpus todavía no existe. Que el
// sistema las mande a `ninguna` **no es un fallo, es el requisito** — y es la
// prueba del modo de falla que O4 pide vigilar: si una pregunta de documento se
// enrutara a una consulta, devolvería un número con cara de exacto sobre algo
// que nadie preguntó.
// ============================================================
import type { Intencion } from './intenciones';

export type Esperado = Intencion | 'ninguna';

/**
 * **La FORMA de la entrada — la segunda dimensión del conjunto.**
 *
 * Existe por un defecto que se encontró en la QA visual y que **la
 * evaluación no vio pese a dar un porcentaje altísimo**: escribir `KL2722` a secas contestaba
 * «no sé contestar eso».
 *
 * La causa del punto ciego es de conjunto, no de modelo: había una prueba de
 * que se cubren las seis INTENCIONES —buena prueba— pero **las 32 preguntas
 * eran frases bien formadas.** Ninguna era un SKU pelado. Ninguna era un
 * término suelto. Y ésa es la entrada más común de todas: es la que el
 * marcador de posición del campo pide.
 *
 * **Es P17 —el universo vacío— dentro del conjunto de evaluación**: una tasa
 * alta sobre un universo que excluye la forma de entrada más frecuente es una
 * tasa que no cubre producción.
 */
export type FormaEntrada =
  /** Solo el código: `KL2722`. */
  | 'sku_pelado'
  /** Solo un nombre: `Clips`. */
  | 'termino_suelto'
  /** Verbo y objeto: «¿cuándo llega el SUJ500-F?». */
  | 'frase_completa'
  /** Verbo sin objeto: «¿cuándo llega?». */
  | 'frase_sin_sku'
  /** No es de este dominio: «¿cuál es la capital de Francia?». */
  | 'fuera_de_dominio'
  /**
   * [INV-B11] O6 · Un sintagma SIN verbo que **no es el nombre de un producto**:
   * «mis proyectos», «resumen de hoy».
   *
   * LA FORMA LA TRAJERON LAS CONCEPTUALES, y hacía falta: la taxonomía anterior
   * se escribió para preguntas sobre un PRODUCTO, así que todo lo que llegaba
   * sin verbo se llamaba `termino_suelto` — y `termino_suelto` tiene un
   * invariante fuerte y correcto detrás: *nombrar algo es pedir que lo busques*,
   * o sea `buscar_por_nombre`.
   *
   * Meter «mis proyectos» ahí habría obligado a **debilitar ese invariante**,
   * que es justo el que arregló el defecto de `Clips`. La forma es distinta y por
   * eso se llama distinto.
   *
   * Y es la forma de MAYOR RIESGO que abrieron las cuatro conceptuales: la
   * regla 6 del prompt manda cualquier nombre suelto a `buscar_por_nombre`, así
   * que estos casos son los que más fácilmente se enrutan mal.
   */
  | 'frase_sin_verbo';

export interface CasoEvaluacion {
  pregunta: string;
  esperado: Esperado;
  /**
   * El SKU que debe extraer, o `null` si no debe extraer ninguno.
   *
   * `null` NO significa «da igual»: significa que **inventarse uno es un
   * fallo**. Es la mitad del invariante «nunca completes ni corrijas un SKU».
   */
  sku: string | null;
  /** Para agrupar el reporte y ver qué familia de preguntas falla. */
  grupo: string;
  /** La forma de la entrada. Cubrir las seis intenciones NO cubre las cinco formas. */
  forma: FormaEntrada;
}

/**
 * SKU del catálogo usados como sujeto de los casos. Si alguno desapareciera,
 * su caso empezaría a fallar por el dato y no por el modelo — el corredor lo
 * comprueba antes de puntuar nada.
 */
const SKU_REAL = 'SUJ500-F';
const SKU_REAL_2 = 'KL2722';
const SKU_FALSO = 'ZZZ-NO-EXISTE-999';

export const CASOS: readonly CasoEvaluacion[] = Object.freeze([
  // ---------- Las cinco de la semilla ----------
  { pregunta: `¿Cuándo llega a aduana el ${SKU_REAL}?`, esperado: 'llegada', sku: SKU_REAL, grupo: 'PO', forma: 'frase_completa' },
  { pregunta: `¿Cuánto hay disponible de ${SKU_REAL} y quién lo tiene reservado?`, esperado: 'disponibilidad', sku: SKU_REAL, grupo: 'PO', forma: 'frase_completa' },
  { pregunta: `¿El ${SKU_REAL} tiene más familias ligadas?`, esperado: 'clasificacion', sku: SKU_REAL, grupo: 'PO', forma: 'frase_completa' },
  // ============================================================
  // [INV-B11] LA 1.4 CAMBIÓ DE LADO, y es el cambio de fondo del bloque.
  //
  // Nació esperando `ninguna` **con el comentario de que eso no era un fallo,
  // era el requisito**: el corpus no existía y una pregunta de documento
  // enrutada a una consulta habría devuelto un número con cara de exacto.
  //
  // Ahora el corpus existe y la 1.4 es contestable. Así que la misma pregunta
  // que probaba «esto está fuera de alcance» pasa a probar «esto se contesta»,
  // y el conjunto lo dice en vez de que alguien lo deduzca de que el número
  // subió.
  //
  // **La 1.5 NO cambia de lado, y la diferencia importa:** «¿cómo funciona el
  // software?» es sobre el PORTAL, no sobre un producto. El corpus tiene fichas
  // de producto; de sí mismo no sabe nada. Mover las dos juntas habría sido lo
  // cómodo y habría metido una pregunta sin respuesta al conjunto de las que sí.
  // ============================================================
  { pregunta: `¿Qué especificaciones técnicas tiene el ${SKU_REAL}? Lo necesito para una implementación`, esperado: 'documental', sku: SKU_REAL, grupo: 'PO · documental', forma: 'frase_completa' },
  { pregunta: '¿Cómo funciona el software?', esperado: 'ninguna', sku: null, grupo: 'PO · documental', forma: 'fuera_de_dominio' },

  // ---------- La misma pregunta, cinco formas ----------
  { pregunta: `¿cuándo llega el ${SKU_REAL}?`, esperado: 'llegada', sku: SKU_REAL, grupo: 'llegada · variantes', forma: 'frase_completa' },
  { pregunta: `${SKU_REAL} fecha de llegada`, esperado: 'llegada', sku: SKU_REAL, grupo: 'llegada · variantes', forma: 'frase_completa' },
  { pregunta: `oye, ya sabes si viene en camino el ${SKU_REAL}?`, esperado: 'llegada', sku: SKU_REAL, grupo: 'llegada · variantes', forma: 'frase_completa' },
  { pregunta: `necesito saber el ETA de ${SKU_REAL}`, esperado: 'llegada', sku: SKU_REAL, grupo: 'llegada · variantes', forma: 'frase_completa' },
  { pregunta: `para cuándo tengo el ${SKU_REAL}`, esperado: 'llegada', sku: SKU_REAL, grupo: 'llegada · variantes', forma: 'frase_completa' },

  // ---------- El SKU en medio, al principio y al final ----------
  { pregunta: `del ${SKU_REAL_2} cuánto me queda`, esperado: 'disponibilidad', sku: SKU_REAL_2, grupo: 'posición del SKU', forma: 'frase_completa' },
  { pregunta: `${SKU_REAL_2} disponible?`, esperado: 'disponibilidad', sku: SKU_REAL_2, grupo: 'posición del SKU', forma: 'frase_completa' },
  { pregunta: `cuánto hay libre de ${SKU_REAL_2}`, esperado: 'disponibilidad', sku: SKU_REAL_2, grupo: 'posición del SKU', forma: 'frase_completa' },

  // ---------- Sin SKU: la intención es clara, el objeto no ----------
  { pregunta: '¿cuánto hay disponible?', esperado: 'disponibilidad', sku: null, grupo: 'sin SKU', forma: 'frase_sin_sku' },
  { pregunta: '¿cuándo llega?', esperado: 'llegada', sku: null, grupo: 'sin SKU', forma: 'frase_sin_sku' },

  // ---------- Un SKU que NO existe: se transporta, no se corrige ----------
  { pregunta: `¿cuándo llega el ${SKU_FALSO}?`, esperado: 'llegada', sku: SKU_FALSO, grupo: 'SKU inexistente', forma: 'frase_completa' },

  // ---------- Las tres que no llevan SKU ----------
  { pregunta: '¿Qué hay en aduana?', esperado: 'pipeline', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: '¿qué viene en camino?', esperado: 'pipeline', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: '¿hay algo retrasado?', esperado: 'pipeline', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: '¿Qué SKUs están sobre-reservados?', esperado: 'sobre_reservados', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: '¿dónde tengo más comprometido que existencia?', esperado: 'sobre_reservados', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: 'Busca los CLIPS', esperado: 'buscar_por_nombre', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: 'encuéntrame los Series11', esperado: 'buscar_por_nombre', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },
  { pregunta: '¿cómo se llama el código del Series2?', esperado: 'buscar_por_nombre', sku: null, grupo: 'sin SKU por diseño', forma: 'frase_completa' },

  // ---------- [INV-B11] Documental — la séptima ----------
  // Las tres formas en que un KAM pregunta por una ficha, y la cuarta que NO
  // lo es: `clasificacion` y `documental` se rozan —las dos hablan «del
  // producto»— y **la frontera entre ellas es lo único que estos casos miden**.
  // Confundirlas da una tarjeta correcta de otra pregunta.
  { pregunta: `¿cómo funciona el ${SKU_REAL}?`, esperado: 'documental', sku: SKU_REAL, grupo: 'documental', forma: 'frase_completa' },
  { pregunta: `¿qué dice la ficha del ${SKU_REAL}?`, esperado: 'documental', sku: SKU_REAL, grupo: 'documental', forma: 'frase_completa' },
  { pregunta: `para qué sirve el ${SKU_REAL_2}`, esperado: 'documental', sku: SKU_REAL_2, grupo: 'documental', forma: 'frase_completa' },
  { pregunta: '¿cómo funciona?', esperado: 'documental', sku: null, grupo: 'documental', forma: 'frase_sin_sku' },

  // ---------- Clasificación ----------
  { pregunta: `¿de qué familia es el ${SKU_REAL}?`, esperado: 'clasificacion', sku: SKU_REAL, grupo: 'clasificacion', forma: 'frase_completa' },
  { pregunta: `qué tecnología usa ${SKU_REAL}`, esperado: 'clasificacion', sku: SKU_REAL, grupo: 'clasificacion', forma: 'frase_completa' },

  // ---------- Las que hay que rendirse. Aquí vive la regla #5 ----------
  { pregunta: '¿cuál es la capital de Francia?', esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  { pregunta: `¿cuánto cuesta el ${SKU_REAL}?`, esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  { pregunta: `dame de baja el ${SKU_REAL}`, esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  { pregunta: '¿cuántas piezas voy a vender el mes que viene?', esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  { pregunta: 'hola', esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  { pregunta: '¿quién es el KAM de Retailer9?', esperado: 'ninguna', sku: null, grupo: 'fuera del catálogo', forma: 'fuera_de_dominio' },
  // ---------- SKU PELADO — el defecto que se encontró en la QA ----------
  // «KL2722» a secas contestaba «no sé contestar eso», con el marcador de
  // posición del campo diciendo literalmente «Pregunta por un SKU…».
  { pregunta: SKU_REAL, esperado: 'ninguna', sku: SKU_REAL, grupo: 'SKU pelado', forma: 'sku_pelado' },
  { pregunta: SKU_REAL_2, esperado: 'ninguna', sku: SKU_REAL_2, grupo: 'SKU pelado', forma: 'sku_pelado' },
  { pregunta: `  ${SKU_REAL}  `, esperado: 'ninguna', sku: SKU_REAL, grupo: 'SKU pelado', forma: 'sku_pelado' },
  { pregunta: SKU_FALSO, esperado: 'ninguna', sku: SKU_FALSO, grupo: 'SKU pelado', forma: 'sku_pelado' },
  // LOS DOS DE ABAJO SON EL CONTROL DEL SESGO DE `esSoloElNombre` (B10-9) POR
  // SU LADO ESTRECHO. El predicado es deliberadamente exigente, y el riesgo de
  // esa elección es rechazar de más: si un día dejara de aceptar `¿KL2722?` o
  // `el SUJ500-F` —las dos formas realistas de nombrar algo—, **vuelve el
  // defecto exacto que se encontró en la QA**, y aquí sale como fallo de
  // `tasaSku`, no como una nota en un documento.
  { pregunta: `¿${SKU_REAL_2}?`, esperado: 'ninguna', sku: SKU_REAL_2, grupo: 'SKU pelado', forma: 'sku_pelado' },
  { pregunta: `el ${SKU_REAL}`, esperado: 'ninguna', sku: SKU_REAL, grupo: 'SKU pelado', forma: 'sku_pelado' },

  // ---------- TÉRMINO SUELTO — nombrar algo es pedir que lo busques ----------
  // `Clips` fallaba y `Series11` funcionaba: dos entradas de forma idéntica con
  // resultados opuestos, y el que falló tiene mucho más dato detrás.
  { pregunta: 'Clips', esperado: 'buscar_por_nombre', sku: null, grupo: 'término suelto', forma: 'termino_suelto' },
  { pregunta: 'Series11', esperado: 'buscar_por_nombre', sku: null, grupo: 'término suelto', forma: 'termino_suelto' },
  { pregunta: 'Series2', esperado: 'buscar_por_nombre', sku: null, grupo: 'término suelto', forma: 'termino_suelto' },
  { pregunta: 'candados', esperado: 'buscar_por_nombre', sku: null, grupo: 'término suelto', forma: 'termino_suelto' },

  // ============================================================
  // [INV-B11] O6 · LAS CUATRO CONCEPTUALES.
  //
  // Las once intenciones se parten en dos mundos y **el conjunto tiene que
  // medir el segundo**: hasta aquí todos los casos van sobre un PRODUCTO, y
  // éstos van sobre el sistema y sobre ti. Una tasa alta sacada solo del primer
  // mundo diría que el enrutador funciona cuando la mitad no estaba probada.
  //
  // `sku: null` en las nueve, y no es relleno: **inventarse un SKU aquí sería
  // un fallo**, y es justo la clase de fallo que estas preguntas invitan —
  // «¿qué proyectos tengo?» no nombra ningún producto y aun así el modelo
  // tiene el catálogo entero en el prompt.
  // ============================================================
  { pregunta: '¿Qué puedes hacer?', esperado: 'capacidades', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: '¿en qué me puedes ayudar?', esperado: 'capacidades', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: '¿qué sabes hacer?', esperado: 'capacidades', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: '¿qué hay de nuevo?', esperado: 'destacado_hoy', sku: null, grupo: 'conceptual', forma: 'frase_sin_sku' },
  { pregunta: '¿qué se movió en los SKU que sigo?', esperado: 'destacado_hoy', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: '¿qué proyectos tengo?', esperado: 'mis_proyectos', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: 'mis proyectos', esperado: 'mis_proyectos', sku: null, grupo: 'conceptual', forma: 'frase_sin_verbo' },
  { pregunta: 'resumen de hoy', esperado: 'destacado_hoy', sku: null, grupo: 'conceptual', forma: 'frase_sin_verbo' },
  { pregunta: '¿cuándo se actualizó el inventario?', esperado: 'snapshots_recientes', sku: null, grupo: 'conceptual', forma: 'frase_completa' },
  { pregunta: '¿de cuándo son estos datos?', esperado: 'snapshots_recientes', sku: null, grupo: 'conceptual', forma: 'frase_sin_sku' },

  // ---------- LAS TRAMPAS DE LAS CONCEPTUALES ----------
  // Se parecen a las de arriba y NO son lo mismo. Van aquí porque el riesgo de
  // abrir cuatro intenciones nuevas es exactamente éste: que se traguen las
  // preguntas vecinas y el «no sé» —que es donde el usuario aprende que el
  // catálogo es cerrado— desaparezca por la puerta de atrás.
  { pregunta: '¿cómo hago un proyecto?', esperado: 'ninguna', sku: null, grupo: 'trampa conceptual', forma: 'frase_completa' },
  { pregunta: '¿dónde cambio mi contraseña?', esperado: 'ninguna', sku: null, grupo: 'trampa conceptual', forma: 'frase_completa' },
]);

/** Una corrida de un caso: lo que el sistema decidió esa vez. */
export interface Corrida {
  intencion: Esperado;
  sku: string | null;
  /**
   * **¿La guarda `esSoloElNombre` tuvo que corregir al modelo en esta corrida?**
   *
   * Existe por la regla acordada sobre limitaciones declaradas: *una limitación
   * declarada es una hipótesis, y tiene exactamente una prueba — ¿el defecto
   * que motivó la guarda sigue pasando?*
   *
   * Sin este campo, la evaluación **no puede contestar esa pregunta**, y ahí
   * está lo importante: «¿cuánto cuesta el SUJ500-F?» sale correcto tanto si el
   * modelo manda `sku: null` (y la guarda no hace nada) como si manda el SKU y
   * la guarda lo degrada. **Un 100 % es compatible con las dos historias**, así
   * que el 100 % NO prueba que la guarda sirva: sería P19 —la guarda que no
   * puede fallar— trasladado al instrumento que la mide.
   *
   * Lo que este campo mide es si la guarda **se ejerció**. Si un día marca 0 en
   * todas las corridas, la guarda dejó de estar bajo prueba —el modelo cambió—
   * y eso es información, no tranquilidad.
   */
  guardaCorrigio?: boolean;
}

export interface ResultadoCaso {
  caso: CasoEvaluacion;
  corridas: Corrida[];
}

export interface Puntuacion {
  casos: number;
  corridasPorCaso: number;
  /** Fracción de corridas con la intención correcta, sobre TODAS las corridas. */
  tasaIntencion: number;
  /** Fracción de corridas que extrajeron el SKU esperado (o ninguno, cuando no debía). */
  tasaSku: number;
  /**
   * Solo sobre las preguntas **fuera de dominio**: cuántas veces se rindió bien.
   *
   * **No basta con filtrar por `esperado === 'ninguna'`**, y esa distinción
   * salió de la QA: un SKU pelado también espera `ninguna` —el modelo no puede
   * elegir intención— pero eso **no es rendirse**, es identificar de qué se
   * habla. Contarlo aquí mezclaría dos cosas y movería la métrica que vigila la
   * regla #5.
   */
  tasaNoSe: number;
  /** Casos cuya intención NO fue la misma en todas las corridas. El producto más útil. */
  inestables: { pregunta: string; grupo: string; salidas: Record<string, number> }[];
  /** Casos que fallaron SIEMPRE. Distintos de los inestables: éstos son un defecto, no ruido. */
  siempreMal: { pregunta: string; grupo: string; esperado: Esperado; obtenido: Esperado }[];
  /**
   * Los casos donde el SKU no salió el esperado, con lo que sí salió.
   *
   * Sin esto `tasaSku` es un número sin dónde: bajó por debajo de lo esperado y hubo que
   * DEDUCIR de qué casos venía. Una tasa que no se puede localizar obliga a
   * adivinar, y adivinar es exactamente lo que costó la primera vez —la
   * hipótesis natural («el modelo extrae mal») era falsa: el fallo estaba en el
   * corredor, que tiraba el SKU al proyectar la decisión.
   */
  skuMal: { pregunta: string; grupo: string; esperado: string | null; obtenido: string[] }[];
  porGrupo: { grupo: string; casos: number; tasaIntencion: number }[];
  /** La segunda dimensión. Un porcentaje global altísimo puede esconder una forma entera al 0 %. */
  porForma: { forma: FormaEntrada; casos: number; tasaIntencion: number }[];
  /**
   * **Cuántas veces la guarda `esSoloElNombre` tuvo que corregir al modelo**, y
   * en qué preguntas. Es el CONTROL del sesgo declarado en B10-9.
   *
   * `corridas: 0` no es una buena noticia: significa que la guarda **no estuvo
   * bajo prueba** en esta corrida, y una guarda que no se ejerce no está
   * medida — está supuesta.
   */
  guarda: { corridas: number; preguntas: string[] };
}

/** `trim + UPPER`, el mismo criterio con el que el servicio resuelve un SKU. */
function normSku(s: string | null): string | null {
  return s === null ? null : s.trim().toUpperCase();
}

/**
 * Puntúa una tanda.
 *
 * **Devuelve tasas, no aprobados.** La barra la pone quien lee: aquí no hay un
 * umbral horneado porque un umbral sin calibrar es una perilla con aire de
 * rigor — el mismo defecto que hizo que este bloque no llevara `confianza`.
 */
export function puntuar(resultados: ResultadoCaso[]): Puntuacion {
  const corridasPorCaso = resultados[0]?.corridas.length ?? 0;

  let aciertosIntencion = 0;
  let totalCorridas = 0;
  let aciertosSku = 0;
  let aciertosNoSe = 0;
  let corridasNoSe = 0;

  const inestables: Puntuacion['inestables'] = [];
  const siempreMal: Puntuacion['siempreMal'] = [];
  const skuMal: Puntuacion['skuMal'] = [];
  const grupos = new Map<string, { casos: number; aciertos: number; corridas: number }>();
  const formas = new Map<FormaEntrada, { casos: number; aciertos: number; corridas: number }>();
  let guardaCorridas = 0;
  const guardaPreguntas = new Set<string>();

  for (const r of resultados) {
    const salidas: Record<string, number> = {};
    const skusMalDelCaso = new Set<string>();
    let aciertosDelCaso = 0;

    for (const c of r.corridas) {
      totalCorridas++;
      salidas[c.intencion] = (salidas[c.intencion] ?? 0) + 1;

      if (c.intencion === r.caso.esperado) {
        aciertosIntencion++;
        aciertosDelCaso++;
      }
      if (normSku(c.sku) === normSku(r.caso.sku)) aciertosSku++;
      else skusMalDelCaso.add(c.sku ?? '(ninguno)');

      if (c.guardaCorrigio) {
        guardaCorridas++;
        guardaPreguntas.add(r.caso.pregunta);
      }

      if (r.caso.forma === 'fuera_de_dominio') {
        corridasNoSe++;
        if (c.intencion === 'ninguna') aciertosNoSe++;
      }
    }

    // INESTABLE: no todas las corridas dieron lo mismo. Puede acertar en
    // promedio y ser igual de preocupante.
    if (Object.keys(salidas).length > 1) {
      inestables.push({ pregunta: r.caso.pregunta, grupo: r.caso.grupo, salidas });
    } else if (aciertosDelCaso === 0 && r.corridas.length > 0) {
      // ESTABLE Y MAL: es un defecto reproducible, no ruido. Se separa porque
      // se arregla de otra manera.
      siempreMal.push({
        pregunta: r.caso.pregunta,
        grupo: r.caso.grupo,
        esperado: r.caso.esperado,
        obtenido: r.corridas[0]!.intencion,
      });
    }

    if (skusMalDelCaso.size > 0) {
      skuMal.push({
        pregunta: r.caso.pregunta,
        grupo: r.caso.grupo,
        esperado: r.caso.sku,
        obtenido: Array.from(skusMalDelCaso),
      });
    }

    const g = grupos.get(r.caso.grupo) ?? { casos: 0, aciertos: 0, corridas: 0 };
    g.casos++;
    g.aciertos += aciertosDelCaso;
    g.corridas += r.corridas.length;
    grupos.set(r.caso.grupo, g);

    const f = formas.get(r.caso.forma) ?? { casos: 0, aciertos: 0, corridas: 0 };
    f.casos++;
    f.aciertos += aciertosDelCaso;
    f.corridas += r.corridas.length;
    formas.set(r.caso.forma, f);
  }

  const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

  return {
    casos: resultados.length,
    corridasPorCaso,
    tasaIntencion: div(aciertosIntencion, totalCorridas),
    tasaSku: div(aciertosSku, totalCorridas),
    tasaNoSe: div(aciertosNoSe, corridasNoSe),
    inestables,
    siempreMal,
    skuMal,
    porGrupo: Array.from(grupos.entries()).map(([grupo, g]) => ({
      grupo,
      casos: g.casos,
      tasaIntencion: div(g.aciertos, g.corridas),
    })),
    porForma: Array.from(formas.entries()).map(([forma, f]) => ({
      forma,
      casos: f.casos,
      tasaIntencion: div(f.aciertos, f.corridas),
    })),
    guarda: { corridas: guardaCorridas, preguntas: Array.from(guardaPreguntas) },
  };
}
