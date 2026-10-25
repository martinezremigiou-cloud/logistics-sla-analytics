// ============================================================
// [INV-B11] O7 · CONJUNTO_EVALUACION_RAG_v1, traído al repo.
//
// Los 26 casos se sembraron leyendo fichas del corpus
// (`Antena-EAS-Series12-UR63`, `Equipo-Seguro`, `Boton-Asistencia`, `Series2` y
// `Analytics-Series5`), con sus cinco categorías y las barras de su §6.
//
// ────────────────────────────────────────────────────────────
// LO PRIMERO QUE HAY QUE DECIR, PORQUE CAMBIA LO QUE ESTE CONJUNTO MIDE:
//
//     **El conjunto se escribió para un RAG que REDACTA. Éste no redacta.**
//
// En un RAG generativo, «¿a qué frecuencia opera el SERIES12 UR63?» se puntúa
// leyendo si la prosa dice «58 kHz». Aquí el modelo **solo enruta** y el
// servidor devuelve el TEXTO VERBATIM de la ficha con su cita. Así que la
// pregunta que este conjunto puede contestar no es *«¿lo dijo bien?»* sino
// *«¿entregó el documento donde eso está?»* — y para B, además, *«¿el valor
// aparece en el texto que entregó?»*.
//
// Eso NO es la misma medición, y fingir que sí sería producir un número con
// cara de evaluación de RAG sobre un sistema que no hace RAG generativo (P25).
//
// ────────────────────────────────────────────────────────────
// POR ESO CADA CASO DECLARA CÓMO SE PUNTÚA:
//
//   `automatico`  el corredor lo decide solo, con una regla escrita
//   `juicio`      NO se puede decidir sin leer. **Se lista para revisión manual y NO
//                 entra en ninguna tasa** — meterlo con una regla inventada
//                 sería exactamente el número que parece medición y no lo es
//
// Y el corredor reporta **las dos cosas por separado**: la tasa de lo
// automático, y la lista de lo que hace falta juzgar. Una tasa sin su lista
// obliga a adivinar qué quedó fuera.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-A] DOS CLASES DE CASO, Y SE TRATAN DISTINTO — el porqué está en el
// bloque E más abajo y en `construirCasosRag`:
//
//   CONTENIDO  «¿cuánto pesa el SERIES12 UR63?» — se ancla a una ficha concreta
//              porque el valor SOLO vive ahí. No se puede derivar.
//   ESTADO     «un SKU cuya familia no tiene puente cae a hallazgos» — el
//              sujeto se elige por CONDICIÓN MEDIDA, porque el negocio
//              re-ramifica y un SKU anclado a mano se pudre en verde.
// ============================================================
import type { FormaEntrada } from './evaluacion';

export type CategoriaRag = 'A_recuperacion' | 'B_extraccion' | 'C_negativa' | 'D_trampa' | 'E_puente';

/** Cómo se decide si un caso pasó. Ver la cabecera: la distinción es el punto. */
export type ComoSePuntua = 'automatico' | 'juicio';

export interface CasoRag {
  id: string;
  pregunta: string;
  categoria: CategoriaRag;
  /** La dimensión que B10 dejó establecida. Se pidió por nombre para este conjunto. */
  forma: FormaEntrada;
  puntuacion: ComoSePuntua;
  /**
   * Fragmento de la RUTA del documento esperado.
   *
   * Se ancla a la ruta y no al título porque **la ruta es lo que el sistema
   * devuelve**; el título es un campo del frontmatter que alguien puede
   * cambiar. El conjunto original ancla al PRODUCTO por la misma razón — que
   * el archivo se renombre no debe romper el caso—, y aquí se conserva usando
   * un fragmento y no la ruta completa.
   */
  fichaEsperada?: string;
  /** Texto que tiene que APARECER en lo que se entregó. Categoría B. */
  valorEsperado?: string;
  /** `true` cuando la respuesta correcta es NO entregar datos. Categoría C. */
  debeNegar?: boolean;
  /** La intención que debe elegir el enrutador, cuando eso es lo que se mide. */
  intencionEsperada?: string;
  /** Qué mide este caso, en palabras. Va al reporte: un id suelto no dice nada. */
  mide: string;
}

/**
 * Las barras del §6 del conjunto.
 *
 * **C va al 100 % y sin margen**, y la razón es ésta: *«una negativa que
 * falla es una mentira»*. E no tiene barra en v1 — se mide, no se aprueba.
 */
export const BARRAS: Record<CategoriaRag, number | null> = Object.freeze({
  C_negativa: 1.0,
  D_trampa: 0.9,
  A_recuperacion: 0.9,
  B_extraccion: 0.9,
  E_puente: null,
});

/**
 * [2.0.1-A] Los casos de CONTENIDO — anclados a una ficha concreta a propósito.
 *
 * «¿Cuánto pesa el SERIES12 UR63?» no se puede derivar: el valor `14` está
 * escrito en ESA ficha y en ninguna otra. Igual que `Equipo-Seguro`, `Boton-Asistencia`,
 * `Series2`, `Series5 Link` y `Analytics-Series5` — se ANCLAN por nombre y el
 * corredor comprueba, antes de gastar una llamada, que el documento sigue VIVO
 * en el corpus (`corpus_documentos` con al menos un trozo). Si dejó de estarlo,
 * el caso sale **SIN VEREDICTO** — nunca verde, nunca rojo — en vez de fallar
 * por una razón que no es la que el caso dice medir.
 *
 * `D5` es la excepción dentro de este grupo: no ancla una ficha, ancla una
 * TRAMPA («no existe ficha de SERIES 2 48»), y esa trampa tiene su propia
 * condición viva — ver `construirCasosRag`.
 *
 * Los que SÍ se derivan (E2, E3, E4) no están aquí: ver el bloque de arriba,
 * en la categoría E, y `construirCasosRag` más abajo.
 */
export const CASOS_RAG_ANCLADOS: readonly CasoRag[] = Object.freeze([
  // ═══ A · RECUPERACIÓN — ¿encontró la ficha correcta? ═══════
  {
    id: 'A1',
    pregunta: '¿Qué es el SERIES12 UR63?',
    categoria: 'A_recuperacion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Series12-UR63',
    mide: 'la ficha correcta para un producto nombrado por su modelo',
  },
  {
    id: 'A2',
    pregunta: '¿Cómo funciona el Equipo Seguro?',
    categoria: 'A_recuperacion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Equipo-Seguro',
    mide: 'un nombre de dos palabras que además ES una familia',
  },
  {
    id: 'A3',
    pregunta: '¿Qué hace el botón de asistencia de Brand2?',
    categoria: 'A_recuperacion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Boton-Asistencia',
    mide: 'el producto nombrado con su nombre común y su marca, no con el nombre de archivo de la ficha',
  },
  {
    id: 'A4',
    pregunta: 'Háblame del Series2',
    categoria: 'A_recuperacion',
    forma: 'frase_sin_verbo',
    puntuacion: 'automatico',
    fichaEsperada: 'Series2',
    mide: 'la familia cuando hay CINCO documentos que empiezan igual',
  },
  {
    id: 'A5',
    pregunta: '¿Qué es Series5 Link?',
    categoria: 'A_recuperacion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Series5 Link',
    mide: 'un nombre de sistema, no de producto físico',
  },
  {
    id: 'A6',
    pregunta: '¿Qué niveles de servicio tiene Analytics de Series5?',
    categoria: 'A_recuperacion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Analytics-Series5',
    mide: 'distinguir dos documentos que comparten la palabra Series5',
  },

  // ═══ B · EXTRACCIÓN — ¿el valor está en lo que entregó? ════
  //
  // AQUÍ ES DONDE LA MEDICIÓN CAMBIA DE SIGNIFICADO. El conjunto pregunta «¿sacó
  // el dato correcto?»; este sistema no saca datos, entrega el texto. Así que lo
  // que se comprueba es que **el valor esté en lo entregado** — que es la
  // condición NECESARIA para que la respuesta sirva, y no la suficiente.
  //
  // Se dice en cada caso y se dice en el reporte. Un 100 % en B aquí significa
  // «el dato estaba en lo que te di», no «te lo dijo».
  {
    id: 'B1',
    pregunta: '¿A qué frecuencia opera el SERIES12 UR63?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Series12-UR63',
    valorEsperado: '58',
    mide: 'un valor de una tabla de especificaciones',
  },
  {
    id: 'B2',
    pregunta: '¿Cuánto pesa el SERIES12 UR63?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Series12-UR63',
    valorEsperado: '14',
    mide: 'un peso, que es el valor más fácil de confundir entre modelos',
  },
  {
    id: 'B4',
    pregunta: '¿En qué rango de temperatura opera el SERIES12 UR63?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Series12-UR63',
    valorEsperado: '45',
    mide: 'un rango, no un número suelto',
  },
  {
    id: 'B6',
    pregunta: '¿Qué llaves son compatibles con el Equipo Seguro?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Equipo-Seguro',
    valorEsperado: 'DL9',
    mide: 'una compatibilidad, que es lo que más se inventa',
  },
  {
    id: 'B10',
    pregunta: '¿Cuál es el alcance inalámbrico del Boton Asistencia?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Boton-Asistencia',
    valorEsperado: '75',
    mide: 'un alcance con unidad',
  },
  {
    id: 'B11',
    pregunta: '¿Cuánto dura la batería del Boton Asistencia?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Boton-Asistencia',
    valorEsperado: 'años',
    mide: 'una duración, en la ficha que tiene DOS tablas (ver D1)',
  },
  {
    id: 'B13',
    pregunta: '¿Qué modelos de Series2 tienen analítica?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series2',
    valorEsperado: 'Rxz57 · Cwr96 · Lhz72QR',
    mide: 'TRES modelos de una tabla — que estén los tres no se comprueba buscando uno',
  },
  {
    id: 'B3',
    pregunta: '¿Cuáles son las dimensiones del SERIES12 UR63?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series12-UR63',
    valorEsperado: '418 / 1 273 / 46 mm (A/Al/P)',
    mide: 'tres medidas Y su orden — un «418» suelto no prueba que se leyó bien',
  },
  {
    id: 'B5',
    pregunta: '¿Cuántas entradas y salidas de alarma programables tiene el SERIES12 UR63?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series12-UR63',
    valorEsperado: '3 entradas / 2 salidas',
    mide: 'dos cifras que se distinguen solo por su etiqueta',
  },
  {
    id: 'B7',
    pregunta: '¿Cuánta resistencia a torsión tiene el Equipo Seguro con adhesivo?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Equipo-Seguro',
    valorEsperado: '≥ 220 lb',
    mide: 'el valor de UNA de dos fijaciones (ver B8) — el par es la trampa',
  },
  {
    id: 'B8',
    pregunta: '¿Y con fijadores metálicos M5?',
    categoria: 'B_extraccion',
    forma: 'frase_sin_sku',
    puntuacion: 'juicio',
    valorEsperado: '≥ 495 lb',
    mide: 'una pregunta que DEPENDE de la anterior. Sin memoria de conversación, esto no puede salir bien — y saberlo es el resultado',
  },
  {
    id: 'B9',
    pregunta: '¿Qué largo tiene el riel YLF-80C?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Equipo-Seguro',
    valorEsperado: '60 cm / 23.5"',
    mide: 'una fila concreta de una tabla de modelos',
  },
  {
    id: 'B12',
    pregunta: '¿Cuánto pesa el Boton Asistencia?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    fichaEsperada: 'Boton-Asistencia',
    valorEsperado: '87',
    mide: 'un peso en gramos con su equivalente en onzas',
  },
  {
    id: 'B14',
    pregunta: '¿Qué largo de series20 trae el Veb08?',
    categoria: 'B_extraccion',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series2',
    valorEsperado: '28"',
    mide: 'una fila de la tabla de modelos de la familia',
  },

  // ═══ C · NEGATIVA — «no caducan nunca» ════════════════════
  {
    id: 'C1',
    pregunta: '¿Cuál es la capital de Francia?',
    categoria: 'C_negativa',
    forma: 'fuera_de_dominio',
    puntuacion: 'automatico',
    debeNegar: true,
    mide: 'fuera de dominio, del todo',
  },
  {
    id: 'C2',
    pregunta: '¿Cuánto cuesta el SERIES12 UR63?',
    categoria: 'C_negativa',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    debeNegar: true,
    mide: 'NO HAY PRECIOS en ninguna de las dos mitades. Es el caso que ya cazó la QA manual en B10',
  },
  {
    id: 'C4',
    pregunta: '¿Qué especificaciones tiene el ZKX-9900?',
    categoria: 'C_negativa',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    debeNegar: true,
    mide: 'producto INEXISTENTE: no debe ofrecer «el más parecido»',
  },
  {
    id: 'C6',
    pregunta: '¿Cuántas piezas de SERIES12 UR63 se vendieron el año pasado?',
    categoria: 'C_negativa',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    debeNegar: true,
    mide: 'ni el corpus ni el inventario tienen VENTAS',
  },
  {
    id: 'C3',
    pregunta: '¿Qué garantía tiene el Equipo Seguro?',
    categoria: 'C_negativa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Equipo-Seguro',
    mide: 'entregar la ficha es correcto SI la ficha no habla de garantía; decir que sí la tiene sería mentir. Hay que leer',
  },
  {
    id: 'C5',
    pregunta: '¿Cuál es la frecuencia del KRVN RF45 en México?',
    categoria: 'C_negativa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    mide: 'el corpus no acota por país: no debe inventar regulación local',
  },

  // ═══ D · TRAMPAS — «el fallo que no falla» ════════════════
  {
    id: 'D6',
    pregunta: '¿Cuántas piezas hay del KL2722?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    intencionEsperada: 'disponibilidad',
    mide: 'una pregunta de INVENTARIO no puede irse al RAG. Es la trampa más comprobable de las seis',
  },
  {
    id: 'D5',
    pregunta: '¿Qué specs tiene el SERIES 2 48?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'automatico',
    mide: 'NO existe ficha de «SERIES 2 48». Válido: la de la familia, diciéndolo. FALLO: entregar Series2-Pro o Series2-Plus como si fueran el 48',
  },
  {
    id: 'D1',
    pregunta: '¿Qué batería usa el Boton Asistencia?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Boton-Asistencia',
    mide: 'la ficha tiene DOS tablas con baterías distintas (litio CR123A 3V · alcalina AA 1.5V). Tomar la primera es fallo',
  },
  {
    id: 'D2',
    pregunta: '¿Cuál es la distancia de detección del SERIES12 UR63?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series12-UR63',
    mide: 'TRES columnas × TRES filas. Un solo número es fallo: hay que decir de qué configuración y qué etiqueta',
  },
  {
    id: 'D3',
    pregunta: '¿El SERIES12 UR63 detecta metales?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Series12-UR63',
    mide: 'No disponible / Opcional / No disponible según configuración. Un «sí» plano es fallo',
  },
  {
    id: 'D4',
    pregunta: '¿Tiene alarma sonora el Equipo Seguro?',
    categoria: 'D_trampa',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    fichaEsperada: 'Equipo-Seguro',
    mide: 'se parece al VXQ, que SÍ tiene. La respuesta es NO: seguridad puramente mecánica',
  },

  // ═══ E · PUENTE — sin barra en v1 ═════════════════════════
  //
  // [2.0.1-A] E2, E3 y E4 YA NO VIVEN AQUÍ COMO LITERALES.
  //
  // Fijaban su sujeto a `TKC-63W` (familia EQUIPO SEGURO), `0861-5844-9317`
  // (SERIES11 FLOOR) y `BXMA69Z` (SERIES 2 LITE) — nombres de familia escritos a
  // mano. Medido contra un snapshot vigente,
  // tras muchas reasignaciones de familia en un solo día: **EQUIPO SEGURO y SERIES 2
  // LITE quedaron en CERO SKU vigentes**, y `TKC-63W`/`BXMA69Z` migraron a
  // `SERIES 41`. SERIES11 FLOOR conservó sus SKU, pero **nunca tuvo
  // renglón de puente** — la comprobación seguía siendo válida por casualidad,
  // no por diseño.
  //
  // Un conjunto que ancla el ESTADO del puente a un nombre de familia se pudre
  // en verde el día que el negocio re-ramifica: el caso seguiría «pasando»
  // porque nadie preguntó si `TKC-63W` seguía siendo del mismo lugar.
  //
  // Ahora `construirCasosRag()`, más abajo, ELIGE el sujeto por CONDICIÓN
  // MEDIDA contra la base — el mismo criterio que usaban
  // los scripts de humo contra la base —
  // y la pregunta/esperada se arman CON ese sujeto, no al revés.
  {
    id: 'E1',
    pregunta: '¿Qué es el KL2722 y cuántos hay?',
    categoria: 'E_puente',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    mide: 'LAS DOS MITADES en una pregunta. Hoy el enrutador elige UNA intención, así que esto no puede salir entero — y saberlo es el resultado',
  },
  {
    id: 'E5',
    pregunta: '¿Qué llaves sirven con Equipo Seguro, y cuáles tenemos?',
    categoria: 'E_puente',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    mide: 'ficha + inventario, otra vez las dos mitades',
  },
  {
    id: 'E6',
    pregunta: '¿Qué antenas Series5 tenemos en existencia?',
    categoria: 'E_puente',
    forma: 'frase_completa',
    puntuacion: 'juicio',
    mide: 'familia → 77 SKU. Es inventario con nombre de documento',
  },
]);

// ============================================================
// [2.0.1-A] LOS SUJETOS DERIVADOS, y por qué esto vive separado del arreglo
// de arriba.
//
// Este archivo es PURO — no toca la base — y la derivación SÍ necesita
// leerla. Así que la frontera queda igual que en el resto del repo
// (`derivarSku`, `puntuar`): aquí se declara QUÉ CONDICIÓN elige a cada
// sujeto y CÓMO se arma el caso con él; quien MIDE la condición es el
// corredor de evaluación, que sí tiene el cliente de
// Supabase — el mismo reparto que usaban los scripts de humo contra la base.
// ============================================================

/** Un SKU vigente cuya familia tiene puente con una ficha VIVA (llega a `ficha`). */
export interface SujetoConFicha {
  sku: string;
  familia: string;
  /** El título con el que el sistema la presenta — lo que de verdad compara `pasa()`. */
  titulo: string;
}

/** Un SKU vigente cuya familia NO tiene puente, y cuyo nombre SÍ encuentra hallazgos (puerta 3). */
export interface SujetoConHallazgo {
  sku: string;
  familia: string;
  tituloHallado: string;
}

/** Un SKU vigente cuya familia NO tiene puente y TAMPOCO encuentra hallazgos: un callejón real. */
export interface SujetoSinFicha {
  sku: string;
  familia: string;
}

/**
 * Lo que el corredor mide contra la base ANTES de construir el conjunto.
 *
 * Cada campo es el resultado de una condición, no un dato suelto — por eso
 * es `| null` y no un valor por omisión: `null` dice **«no hay sujeto que
 * cumpla esto hoy»**, y eso es justo lo que dispara SIN VEREDICTO más abajo.
 */
export interface MedicionSujetosRag {
  /** Condición E2: SKU vigente → familia con puente → ficha con trozos. */
  familiaConFichaViva: SujetoConFicha | null;
  /** Condición E3: SKU vigente → familia SIN puente → la puerta 3 SÍ halla algo. */
  familiaSinPuenteConHallazgo: SujetoConHallazgo | null;
  /** Condición E4: SKU vigente → familia SIN puente → la puerta 3 NO halla nada. */
  familiaSinPuenteSinHallazgo: SujetoSinFicha | null;
  /**
   * La condición propia de D5: ¿la familia «SERIES 2 48» —la trampa textual—
   * SIGUE sin una ficha alcanzable? Si el negocio le da puente y ficha viva,
   * la trampa deja de probar lo que su `mide` dice que prueba.
   */
  trampaSigueSinFicha: boolean;
  /** Rutas de `corpus_documentos` con al menos un trozo — el «vivo» del corpus, para las guardas de contenido. */
  rutasConTrozos: readonly string[];
}

/** Un caso que NO se corrió porque su sujeto no se pudo confirmar hoy. Ni verde ni rojo. */
export interface CasoSinVeredicto {
  id: string;
  /** La condición que no se pudo satisfacer, en palabras — va al reporte. */
  condicion: string;
}

export interface CasosConstruidos {
  casos: readonly CasoRag[];
  sinVeredicto: readonly CasoSinVeredicto[];
  /**
   * `true` cuando alguna de las TRES condiciones derivadas (E2/E3/E4) no
   * encontró sujeto en TODA la base — no que el sujeto elegido fallara, sino
   * que la condición misma resultó insatisfacible. Es P17 aplicado al propio
   * conjunto de evaluación: un universo vacío no se disfraza de conjunto más
   * chico y verde, obliga a declarar que no se pudo medir.
   */
  derivacionRota: boolean;
}

/**
 * ¿Sigue vivo, en el corpus de HOY, el documento al que un caso de CONTENIDO
 * se ancla?
 *
 * Usa la misma comparación que `pasa()` (pelada, por ruta) porque es la MISMA
 * pregunta: si el fragmento ya no aparece en ninguna ruta con trozos, el caso
 * no puede pasar NI fallar por la razón que dice medir — solo puede confundir.
 */
function sujetoContenidoVive(fichaEsperada: string, rutasConTrozos: readonly string[]): boolean {
  return contiene(rutasConTrozos as string[], fichaEsperada);
}

/**
 * Arma el conjunto que de verdad se corre, a partir de lo medido.
 *
 * **Pura**: no toca la base, solo combina `CASOS_RAG_ANCLADOS` con lo que el
 * corredor ya midió. Eso es lo que la hace probable sin gastar un token — ver
 * `evaluacion-rag.test.ts`.
 */
export function construirCasosRag(m: MedicionSujetosRag): CasosConstruidos {
  const casos: CasoRag[] = [];
  const sinVeredicto: CasoSinVeredicto[] = [];

  // ---------- Los de CONTENIDO: se corren si su ficha sigue viva ----------
  //
  // La comprobación es la MISMA para `automatico` y para `juicio` — un caso de
  // JUICIO también afirma contenido de una ficha concreta (B3, B5, C3…), y
  // listarlo para que alguien lo lea sobre una ficha que ya no existe sería
  // exactamente el defecto que esta guarda existe para cerrar, solo que del
  // lado humano en vez del automático.
  for (const c of CASOS_RAG_ANCLADOS) {
    if (c.id === 'D5') continue; // D5 tiene su propia condición, aparte.
    if (c.fichaEsperada && !sujetoContenidoVive(c.fichaEsperada, m.rutasConTrozos)) {
      sinVeredicto.push({
        id: c.id,
        condicion: `caso de CONTENIDO anclado a «${c.fichaEsperada}», que ya no está viva en el corpus`,
      });
      continue;
    }
    casos.push(c);
  }

  // ---------- D5: condicionado a que su trampa textual siga siendo cierta ----------
  const d5 = CASOS_RAG_ANCLADOS.find((c) => c.id === 'D5');
  if (d5) {
    if (m.trampaSigueSinFicha) {
      casos.push(d5);
    } else {
      sinVeredicto.push({
        id: 'D5',
        condicion: 'la familia «SERIES 2 48» dejó de estar sin ficha alcanzable: la trampa textual ya no prueba lo que su `mide` dice',
      });
    }
  }

  // ---------- E2: DERIVADO — familia con puente y ficha viva ----------
  let derivacionRota = false;
  if (m.familiaConFichaViva) {
    const s = m.familiaConFichaViva;
    casos.push({
      id: 'E2',
      categoria: 'E_puente',
      forma: 'frase_completa',
      puntuacion: 'automatico',
      pregunta: `¿Qué es el ${s.sku}?`,
      fichaEsperada: s.titulo,
      mide: `SKU vigente cuya familia tiene puente con ficha viva (derivado: ${s.sku} → familia ${s.familia} → «${s.titulo}»)`,
    });
  } else {
    derivacionRota = true;
    sinVeredicto.push({ id: 'E2', condicion: 'ningún SKU vigente tiene una familia con puente a una ficha con trozos' });
  }

  // ---------- E3: DERIVADO — familia sin puente que SÍ cae a hallazgos (puerta 3) ----------
  if (m.familiaSinPuenteConHallazgo) {
    const s = m.familiaSinPuenteConHallazgo;
    casos.push({
      id: 'E3',
      categoria: 'E_puente',
      forma: 'frase_completa',
      puntuacion: 'automatico',
      pregunta: `¿Qué es el ${s.sku}?`,
      fichaEsperada: s.tituloHallado,
      mide: `SKU vigente cuya familia NO tiene puente, y la puerta 3 SÍ encuentra hallazgos (derivado: ${s.sku} → familia ${s.familia} → «${s.tituloHallado}»)`,
    });
  } else {
    derivacionRota = true;
    sinVeredicto.push({ id: 'E3', condicion: 'ninguna familia sin puente encontró hallazgos en el corpus por su nombre' });
  }

  // ---------- E4: DERIVADO, de JUICIO — familia sin puente y sin hallazgo ----------
  if (m.familiaSinPuenteSinHallazgo) {
    const s = m.familiaSinPuenteSinHallazgo;
    casos.push({
      id: 'E4',
      categoria: 'E_puente',
      forma: 'frase_completa',
      puntuacion: 'juicio',
      pregunta: `¿Qué es el ${s.sku}?`,
      mide: `familia «${s.familia}» sin puente y sin hallazgo — callejón real (derivado: ${s.sku}). Si no tiene ficha debe DECIRLO, no dar la del vecino`,
    });
  } else {
    derivacionRota = true;
    sinVeredicto.push({ id: 'E4', condicion: 'ninguna familia sin puente es también un callejón sin hallazgos en el corpus' });
  }

  return { casos: Object.freeze(casos), sinVeredicto: Object.freeze(sinVeredicto), derivacionRota };
}

/** Una corrida de un caso: lo que el sistema hizo esa vez. */
export interface CorridaRag {
  /** La intención que eligió el enrutador. */
  intencion: string;
  /** `true` si la respuesta NO entregó datos (negativa, aclaración o «no sé»). */
  nego: boolean;
  /**
   * De dónde dice venir lo que entregó: el título de la tarjeta y las citas.
   *
   * **Se llama `procedencia` y no `rutas` a propósito.** Lo que el usuario
   * recibe NO es la ruta del `.md` —eso es interno— sino el título de la ficha
   * y el PDF citado. Nombrar este campo `rutas` habría sido exactamente el
   * defecto que P27 describe: llamar a una cosa por el nombre de su
   * representación interna, y acabar comparando contra lo que no es.
   */
  procedencia: string[];
  /** El texto que se le enseñó al usuario, para buscar el valor esperado. */
  texto: string;
}

/**
 * Compara ignorando guiones, espacios y mayúsculas.
 *
 * Hace falta porque el conjunto ancla al ARCHIVO (`Antena-EAS-Series12-UR63`) y el
 * usuario ve el TÍTULO (`Series12 UR63`). Son la misma ficha escrita de dos
 * maneras, y exigir que coincidan carácter por carácter mediría la ortografía
 * del frontmatter, no la recuperación.
 */
function contiene(donde: string[], fragmento: string): boolean {
  const objetivo = pelar(fragmento);
  return donde.some((d) => pelar(d).includes(objetivo));
}

/**
 * Baja a minúsculas, quita acentos y deja solo letras y dígitos.
 *
 * **Lo de los acentos salió de medir, no de precaución.** El caso B11 falló
 * buscando `años` en una ficha que dice `anos`: la del Boton Asistencia es **uno de
 * los poquísimos trozos** que perdió los acentos en el origen («atencion»,
 * «periodicamente»). Un conjunto de evaluación que falle por eso estaría
 * midiendo la ortografía del corpus, no la recuperación.
 *
 * La condición del corpus queda como deuda B11-3: **no se tapa, se compara
 * aparte.**
 */
function pelar(x: string): string {
  return x
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface ResultadoRag {
  caso: CasoRag;
  corridas: CorridaRag[];
}

/** ¿Esta corrida cumple lo que el caso pide? Solo se llama para `automatico`. */
export function pasa(caso: CasoRag, c: CorridaRag): boolean {
  if (caso.debeNegar) return c.nego;
  if (caso.intencionEsperada) return c.intencion === caso.intencionEsperada;

  // D5 no tiene ficha esperada: lo que se exige es que NO entregue una de las
  // variantes como si fuera el 48. Válido = la familia, o una negativa honesta.
  if (caso.id === 'D5') {
    const variantes = ['Series2 Pro', 'Plus Series2', 'Series2 Lite', 'Series2 Core'];
    return c.nego || !variantes.some((v) => contiene(c.procedencia, v));
  }

  const traeFicha = caso.fichaEsperada ? contiene(c.procedencia, caso.fichaEsperada) : false;
  if (!traeFicha) return false;
  if (!caso.valorEsperado) return true;

  // Categoría B: el valor tiene que ESTAR en lo entregado. Ver la cabecera —
  // es la condición necesaria, no la suficiente. Y se compara pelado, por lo
  // mismo que la ficha: el corpus tiene trozos sin acentos.
  return pelar(c.texto).includes(pelar(caso.valorEsperado));
}

export interface Puntuacion {
  porCategoria: Record<CategoriaRag, { total: number; pasaron: number; tasa: number; barra: number | null; pasa: boolean }>;
  porForma: Record<string, { total: number; pasaron: number; tasa: number }>;
  /** Los que salieron distinto entre corridas. El producto más útil, igual que en O5. */
  inestables: string[];
  /** Los que no se pueden puntuar solos. **No entran en ninguna tasa.** */
  deJuicio: CasoRag[];
}

export function puntuar(resultados: ResultadoRag[]): Puntuacion {
  const cats: CategoriaRag[] = ['A_recuperacion', 'B_extraccion', 'C_negativa', 'D_trampa', 'E_puente'];
  const porCategoria = {} as Puntuacion['porCategoria'];
  for (const cat of cats) porCategoria[cat] = { total: 0, pasaron: 0, tasa: 0, barra: BARRAS[cat], pasa: true };

  const porForma: Puntuacion['porForma'] = {};
  const inestables: string[] = [];
  const deJuicio: CasoRag[] = [];

  for (const r of resultados) {
    if (r.caso.puntuacion === 'juicio') {
      deJuicio.push(r.caso);
      continue;
    }
    const votos = r.corridas.map((c) => pasa(r.caso, c));
    if (votos.some((v) => v) && votos.some((v) => !v)) inestables.push(r.caso.id);

    // Un caso cuenta como pasado cuando TODAS sus corridas pasaron. Es más
    // estricto que promediar y es el criterio de O5: con `temperature` no
    // fijable, «casi siempre bien» sigue siendo un fallo que le toca a alguien.
    const ok = votos.length > 0 && votos.every((v) => v);

    const c = porCategoria[r.caso.categoria];
    c.total += 1;
    if (ok) c.pasaron += 1;

    const f = (porForma[r.caso.forma] ??= { total: 0, pasaron: 0, tasa: 0 });
    f.total += 1;
    if (ok) f.pasaron += 1;
  }

  for (const cat of cats) {
    const c = porCategoria[cat];
    c.tasa = c.total > 0 ? c.pasaron / c.total : 0;
    // Una categoría SIN casos automáticos no «pasa»: no se midió. Cero y
    // no-medido son valores distintos, y decir que pasó sería lo segundo
    // disfrazado de lo primero.
    c.pasa = c.barra === null ? true : c.total > 0 && c.tasa >= c.barra;
  }
  for (const f of Object.values(porForma)) f.tasa = f.total > 0 ? f.pasaron / f.total : 0;

  return { porCategoria, porForma, inestables, deJuicio };
}
