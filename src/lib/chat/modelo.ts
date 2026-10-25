// ============================================================
// [INV-B10] lib/chat/modelo.ts — la frontera con el modelo. Y es DELGADA.
//
// Todo lo que el modelo hace en este bloque cabe en una frase: **leer la
// pregunta y decir qué se preguntó y sobre qué SKU.** No ve inventario, no
// redacta, no calcula y no elige entre SKU parecidos.
//
// De ahí sale la forma de esta interfaz: devuelve `crudo: unknown`. **A
// propósito.** Quien valida es `enrutar()`, y validar en un solo sitio es lo
// que impide que cada implementación tenga su propia idea de qué hacer con una
// respuesta rara. Un cliente que devolviera un objeto ya tipado estaría
// afirmando una garantía que no puede dar.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ HAY INTERFAZ Y NO UNA LLAMADA DIRECTA.
//
// No es por gusto de abstracción: es porque **el proveedor es decisión de producto y
// puede cambiar**, y porque la evaluación de O5 y todas las pruebas tienen que
// correr sin gastar dinero ni depender de la red. Con la interfaz, el falso y
// el real son intercambiables y la prueba mide el sistema, no el proveedor.
//
// ────────────────────────────────────────────────────────────
// EL PROMPT SE CONSTRUYE DESDE EL CATÁLOGO.
//
// Escribir la lista de intenciones a mano aquí habría creado la segunda verdad
// clásica: se agrega una intención, se olvida el prompt, y el modelo nunca la
// elige — un fallo que no rompe nada, no sale rojo, y solo se nota porque «el
// chat no entiende esa pregunta». Aquí el prompt se arma de `INTENCIONES`, así
// que agregar una entrada la enseña al modelo en la misma línea.
// ============================================================
import { INTENCIONES } from './intenciones';
import { PERSONALIDAD } from './voz';
import { NINGUNA } from './enrutador';

export interface Uso {
  entrada: number;
  salida: number;
}

export interface Clasificacion {
  /**
   * Lo que el modelo devolvió, SIN validar. Lo valida `enrutar()`, que es el
   * único sitio donde se decide qué hacer con la basura.
   */
  crudo: unknown;
  uso: Uso;
}

export interface Clasificador {
  /** Identificador que va al registro de consumo. El costo por pregunta depende de él. */
  readonly nombre: string;
  clasificar(pregunta: string): Promise<Clasificacion>;
}

/**
 * El sistema, armado desde el catálogo.
 *
 * DOS COSAS QUE NO SON ADORNO:
 *
 *  1. **`ninguna` se presenta como la opción por omisión, no como el fracaso.**
 *     Un modelo al que se le pide «elige la más parecida» elige la más
 *     parecida siempre, incluso cuando ninguna lo es — que es exactamente el
 *     «no se acerca» que el brief prohíbe. Aquí rendirse es una respuesta
 *     legítima del catálogo, y se le dice así.
 *  2. **Se le prohíbe explícitamente inventar un SKU.** Es el único sitio donde
 *     el modelo toca algo parecido a un dato, y un SKU alucinado se vería como
 *     una consulta legítima que simplemente no encuentra nada.
 */
export function promptDelSistema(): string {
  const catalogo = INTENCIONES.map((i) => `- ${i.id}: ${i.descripcion}`).join('\n');

  return [
    // [INV-B11] O6 · la personalidad va PRIMERO y la tarea inmediatamente
    // después, sin nada en medio: lo que gobierna la salida de este prompt es
    // el JSON, y la identidad no puede quedar entre la tarea y sus reglas.
    ...PERSONALIDAD,
    '',
    'En esta llamada NO contestas: eres el clasificador de preguntas del portal.',
    'Tu única salida es un JSON que dice qué se preguntó.',
    '',
    'Intenciones posibles:',
    catalogo,
    `- ${NINGUNA}: la pregunta no cae en ninguna de las anteriores.`,
    '',
    'Devuelve EXACTAMENTE este JSON, sin texto alrededor:',
    '{"intencion": "<una de la lista>", "sku": <string o null>, "termino": <string o null>}',
    '',
    'Reglas:',
    `1. Si la pregunta no encaja claramente en una intención, responde "${NINGUNA}".`,
    '   NO elijas la más parecida. Rendirse es una respuesta correcta y frecuente.',
    '2. "sku" es el código de producto SOLO si el usuario lo escribió literalmente',
    '   (por ejemplo SUJ500-F, RMB0206, 0861-5844-9317). Si no lo escribió, es null.',
    '   NUNCA inventes, completes ni corrijas un SKU.',
    '3. "termino" es el nombre o la descripción con la que el usuario se refirió al',
    '   producto cuando NO escribió un SKU literal (por ejemplo "los CLIPS", "el Series11").',
    '   Sirve para CUALQUIER intención, no solo para buscar: quien pregunta cuándo',
    '   llega algo casi nunca escribe el código. Si escribió el SKU, "termino" es null.',
    '4. Que FALTE el SKU no convierte la pregunta en "ninguna". Si la intención es',
    '   clara pero no se sabe de qué producto habla, devuelve la intención con',
    '   "sku": null y "termino": null — el portal se encargará de preguntarle cuál.',
    '   "ninguna" es para cuando no se entiende QUÉ se está preguntando, no PARA QUÉ.',
    '5. Si el usuario SOLO escribió un código de producto, sin preguntar nada',
    '   (por ejemplo "KL2722" a secas), responde "ninguna" con ese código en "sku".',
    '   No es una pregunta fuera de tema: es alguien nombrando algo. El portal le',
    '   preguntará qué quiere saber de él.',
    '6. Si el usuario SOLO escribió un nombre o palabra de producto que NO es un',
    '   código (por ejemplo "Clips", "Series11"), la intención es buscar_por_nombre',
    '   con ese texto en "termino". Nombrar algo es pedir que lo busques.',
    '7. "documental" es sobre un PRODUCTO del catálogo: QUÉ ES, QUÉ HACE, para',
    '   qué sirve, cómo funciona, sus especificaciones y sus medidas.',
    '   "¿qué es el SERIES12 UR63?", "¿qué hace el botón de asistencia de Brand2?",',
    '   "¿cuánto pesa el Boton Asistencia?" son documental — da igual que el',
    '   producto se nombre por su modelo, por su marca o en español.',
    '   NO lo confundas con "clasificacion", que es otra cosa: qué FAMILIA,',
    '   marca o tecnología tiene un SKU DENTRO de nuestro catálogo. Eso es una',
    '   etiqueta nuestra, no lo que el producto es ni lo que hace.',
    '   Es "ninguna" cuando la pregunta nombra EXPLÍCITAMENTE al portal, al',
    '   software o al sistema: "¿cómo funciona el software?", "¿cómo hago un',
    '   proyecto?", "¿dónde cambio mi contraseña?" — de sí mismo el sistema no',
    '   tiene ficha, y las instrucciones de uso no las contesta este asistente.',
    '   Si no nombra ningún objeto ("¿cómo funciona?", "¿para qué sirve?"), aplica',
    '   la regla 4: es documental con "sku": null, y el portal preguntará cuál.',
    '8. Las CUATRO que no van sobre un producto. Ninguna lleva "sku" ni "termino":',
    '   - "capacidades": pregunta QUÉ SABES HACER o EN QUÉ AYUDAS.',
    '     "¿qué puedes hacer?", "¿en qué me ayudas?", "¿qué sabes?", "ayuda".',
    '     Ojo: esto NO es "ninguna". Que te pregunten qué sabes hacer es una',
    '     pregunta que SÍ sabes contestar.',
    '   - "destacado_hoy": qué se movió o qué hay de nuevo EN LO QUE ÉL SIGUE.',
    '     "¿qué hay de nuevo?", "¿qué se movió?", "resumen de hoy", "mis avisos".',
    '   - "mis_proyectos": SUS proyectos. "¿qué proyectos tengo?", "mis proyectos".',
    '     Distíntala de "¿cómo hago un proyecto?", que es instrucción de uso.',
    '   - "snapshots_recientes": de cuándo son los datos, cuándo se cargaron.',
    '     "¿cuándo se actualizó el inventario?", "¿de cuándo son estos datos?".',
    '9. Responde solo el JSON.',
  ].join('\n');
}

/**
 * Clasificador FALSO, para las pruebas y para la evaluación en seco.
 *
 * No imita a un modelo: **devuelve lo que se le dijo**. Un falso que intentara
 * adivinar sería un segundo clasificador, con sus propios errores, y las
 * pruebas medirían ése en vez del sistema.
 */
export function clasificadorFalso(
  guion: (pregunta: string) => unknown,
  opciones: { nombre?: string; uso?: Uso } = {},
): Clasificador {
  return {
    nombre: opciones.nombre ?? 'falso',
    clasificar: async (pregunta: string) => ({
      crudo: guion(pregunta),
      uso: opciones.uso ?? { entrada: 0, salida: 0 },
    }),
  };
}
