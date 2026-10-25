// ============================================================
// [INV-B10] lib/chat/enrutador.ts — el enrutador. 100% PURO.
//
// DOS SALIDAS HOY, UNA TERCERA ENCHUFABLE (O4):
//
//        pregunta del usuario
//                 │
//          ┌──────┴──────┐
//     ¿consulta?      ¿documento?
//          │               │
//     `intencion`      [futuro: `documental`]
//          └──────┬──────┘
//          `no_soportado`
//
// Cuando llegue el corpus se agrega un tercer miembro a `Decision` y una rama
// aquí. **No se reescribe nada**: los llamadores hacen `switch` sobre `tipo` y
// el compilador les señala la rama que les falta.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ESTA FUNCIÓN RECIBE `unknown` Y NO UN OBJETO YA VALIDADO.
//
// Porque quien la llama recibe **texto de un modelo**, y un modelo puede
// devolver cualquier cosa: JSON roto, una intención inventada, un campo de
// más. Si el parseo viviera fuera, cada llamador tendría su propia idea de qué
// hacer con la basura, y una de esas ideas acabaría siendo «asumir algo». Aquí
// hay una sola: **basura ⇒ `no_soportado`**, que es la respuesta honesta.
//
// Y por eso el schema es ESTRICTO y no tolerante. `zod` con `.catch()` habría
// convertido un campo malformado en un default silencioso — que es P12 (el
// lector tolerante) exactamente: el sistema sigue andando sobre un dato que no
// entendió y el error aparece tres capas más allá, disfrazado de otra cosa.
//
// ────────────────────────────────────────────────────────────
// NO HAY CAMPO DE CONFIANZA, Y ES UNA DECISIÓN.
//
// Lo natural sería que el modelo devolviera un `confianza: 0..1` y cortar bajo
// un umbral. No se hizo: **la confianza que un modelo declara sobre sí mismo
// no está calibrada**, así que ese umbral sería una perilla con aire de rigor
// que en realidad no separa nada — el mismo defecto que P20 (la métrica cuyo
// peor caso da la señal más débil).
//
// En su lugar, el catálogo incluye `'ninguna'` como valor legítimo: el modelo
// no tiene que estimar cuánto sabe, tiene que **elegir una opción de una lista
// cerrada, y una de las opciones es rendirse**. Cuánto acierta al elegirla se
// mide en la evaluación de O5, que es donde un número significa algo.
// ============================================================
import { z } from 'zod';
import { MAX_SKU } from '@/schemas/avisos.schema';
import { definicionDe, loQueSabeHacer, type Intencion } from './intenciones';
import { normalizarTermino } from './termino';

/** El valor con el que el modelo se rinde. Es una opción del catálogo, no una falla. */
export const NINGUNA = 'ninguna';

/**
 * Lo que el modelo tiene que devolver. La lista de intenciones válidas **no se
 * escribe aquí**: se comprueba contra el catálogo, para que agregar una
 * intención no exija acordarse de tocar este archivo.
 */
export const salidaModeloSchema = z.object({
  intencion: z
    .string()
    .refine((v) => v === NINGUNA || definicionDe(v) !== undefined, { message: 'intención fuera del catálogo' }),
  /** El SKU tal como el usuario lo escribió. **Sin resolver**: resolverlo necesita la base. */
  sku: z.string().trim().min(1).max(MAX_SKU).nullable(),
  /** Texto libre para buscar por nombre («CLIPS», «Series11»). */
  termino: z.string().trim().min(1).max(MAX_SKU).nullable(),
});

export type SalidaModelo = z.infer<typeof salidaModeloSchema>;

export type MotivoNoSoportado =
  /** El modelo eligió `ninguna`: la pregunta no cae en el catálogo. */
  | 'fuera_del_catalogo'
  /** El modelo devolvió algo que no se pudo leer. No se adivina qué quiso decir. */
  | 'respuesta_ilegible'
  /**
   * **Nombró algo sin preguntar nada.** `KL2722` a secas.
   *
   * NO es lo mismo que `fuera_del_catalogo`, y confundirlos fue un defecto real
   * que se encontró en la QA: escribir un SKU pelado contestaba «no sé
   * contestar eso» — **con el marcador de posición del campo diciendo
   * literalmente “Pregunta por un SKU…”**. La interfaz instruía a hacer justo
   * lo que fallaba: P7 en la caja de texto.
   *
   * Es el ESPEJO del defecto que la evaluación de O5 destapó en el avance 4:
   *
   *     «¿cuándo llega?»   verbo sin SKU   →  arreglado con la regla 4
   *     «KL2722»           SKU sin verbo   →  faltaba su gemela
   *
   * **Intención y parámetro son dos ejes.** Que falte el verbo no convierte el
   * SKU en «no sé», igual que que falte el SKU no convierte el verbo en «no sé».
   */
  | 'falta_verbo';

export type Decision =
  | {
      tipo: 'intencion';
      intencion: Intencion;
      /** Puede venir `null`: la resolución (0/1/N) ocurre después, contra la base. */
      sku: string | null;
      termino: string | null;
    }
  | {
      tipo: 'no_soportado';
      motivo: MotivoNoSoportado;
      sabeHacer: string[];
      /**
       * Lo que el usuario nombró, cuando `motivo` es `falta_verbo`. Se
       * transporta porque el siguiente paso —preguntarle qué quiere saber de
       * ESE SKU— no tiene sentido sin él.
       */
      sku?: string | null;
      termino?: string | null;
    };

/**
 * Enruta la salida cruda del modelo.
 *
 * **No resuelve el SKU y no llama a nada.** Devuelve qué habría que hacer, y
 * por eso se puede probar entera sin modelo y sin base — que es lo que
 * convierte «probar un chat» de aspiración en tarea.
 *
 * `pregunta` es lo que el usuario escribió, y es OBLIGATORIO por diseño:
 * distinguir «nombró un SKU» de «preguntó algo que no sé sobre un SKU» necesita
 * el texto, y un parámetro opcional se olvida en silencio. Ver `esSoloElNombre`.
 */
/**
 * ¿La pregunta era **solo** el nombre, sin preguntar nada?
 *
 * Se normaliza con la misma función que limpia un término de búsqueda —quita
 * signos y artículos de arranque— así que «KL2722», «¿KL2722?» y «el KL2722»
 * cuentan, y «¿cuánto cuesta el KL2722?» no.
 *
 * **El sesgo es deliberado.** Si esto dice `false` de más, el usuario recibe el
 * «no sé» que enumera: la conducta de siempre, correcta aunque menos útil. Si
 * dijera `true` de más, una negativa se convierte en tres botones y el límite
 * del catálogo se vuelve invisible. Los dos errores no cuestan lo mismo.
 */
function esSoloElNombre(pregunta: string, sku: string): boolean {
  const limpia = normalizarTermino(pregunta);
  return limpia !== null && limpia.trim().toUpperCase() === sku.trim().toUpperCase();
}

export function enrutar(crudo: unknown, pregunta: string): Decision {
  const parsed = salidaModeloSchema.safeParse(crudo);

  if (!parsed.success) {
    return { tipo: 'no_soportado', motivo: 'respuesta_ilegible', sabeHacer: loQueSabeHacer() };
  }

  if (parsed.data.intencion === NINGUNA) {
    // «Ninguna» CON un SKU dentro no es una pregunta fuera de tema: es alguien
    // nombrando algo sin preguntar. Se distingue, y el servicio le pregunta qué
    // quiere saber en vez de negarle.
    //
    // **Y se comprueba contra el TEXTO, no contra la palabra del modelo.**
    // Medido en la 3ª corrida de O5: con la regla 5 en el prompt, el modelo
    // empezó a mandar el SKU en CUALQUIER `ninguna` que mencionara un código
    // —«¿cuánto cuesta el SUJ500-F?» y «dame de baja el SUJ500-F», 5/5 las
    // dos—. Sin esta comprobación, esas dos preguntas dejarían de recibir el
    // «no sé» que ENUMERA y recibirían «¿qué quieres saber de SUJ500-F?»:
    // **la negativa desaparece y el usuario nunca se entera de que de precios
    // no sé**. Es la regla #5 erosionada por la puerta de atrás, y el prompt no
    // puede ser la única defensa —«pedirlo no basta» es la lección de
    // `termino.ts`, medida en este mismo bloque.
    if (parsed.data.sku && esSoloElNombre(pregunta, parsed.data.sku)) {
      return {
        tipo: 'no_soportado',
        motivo: 'falta_verbo',
        sabeHacer: loQueSabeHacer(),
        sku: parsed.data.sku,
        termino: parsed.data.termino,
      };
    }
    return { tipo: 'no_soportado', motivo: 'fuera_del_catalogo', sabeHacer: loQueSabeHacer() };
  }

  // El refine ya garantizó que está en el catálogo; esto es el estrechamiento
  // de tipo, no una segunda comprobación.
  const definicion = definicionDe(parsed.data.intencion)!;

  return {
    tipo: 'intencion',
    intencion: definicion.id,
    sku: parsed.data.sku,
    termino: parsed.data.termino,
  };
}
