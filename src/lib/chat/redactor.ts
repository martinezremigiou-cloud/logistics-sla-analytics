// ============================================================
// [CHAT-B1] lib/chat/redactor.ts — la SEGUNDA frontera con el modelo.
//
// Y es segunda, no la misma: `Clasificador` y `Redactor` son dos capacidades
// distintas y meterlas en una interfaz habría tenido un costo concreto, no
// estético. `clasificar()` no ve nada del dominio —ésa es toda su gracia, y es
// lo que INV-B10 firmó—; `redactar()` recibe una `Entrega`. Un solo tipo con los
// dos métodos habría hecho que **el clasificador tuviera en su firma un método
// capaz de recibir texto del corpus**, y el día que alguien lo llamara por
// descuido no habría nada que lo impidiera. Separadas, `enrutar()` sigue sin
// poder ver un documento **por tipo**, no por disciplina.
//
// ────────────────────────────────────────────────────────────
// DEVUELVE `crudo: unknown`, IGUAL QUE EL CLASIFICADOR, Y POR LA MISMA RAZÓN.
//
// Quien valida es `interpretarSalida()`, en un solo sitio. Un cliente que
// devolviera un objeto ya tipado estaría afirmando una garantía que no puede
// dar: lo que viene del otro lado del cable es texto, y el día que un proveedor
// cambie la forma de su JSON, un tipo mentiroso lo esconde.
//
// ────────────────────────────────────────────────────────────
// FRASES ANCLADAS, NO PROSA. Y no es un capricho del formato.
//
// Si el modelo devolviera un párrafo, lo único comprobable sería «este número
// aparece en algún sitio del documento» — que deja pasar el error más probable:
// el dato correcto de la sección equivocada. Pidiéndole el rango del que sacó
// cada frase, la comprobación pasa a ser **por frase y contra su propio tramo**.
// El costo es un prompt más exigente; la ganancia es que la guarda comprueba lo
// que dice comprobar. Ver `verificar-redaccion.ts`.
// ============================================================
import { z } from 'zod';
import { NOMBRE_PRODUCTO } from '@/config/producto';
import type { Uso } from './modelo';
import type { Entrega } from './entrega';
import { textoDeTrozo, seccionesOmitidas } from './entrega';
import type { SalidaRedactor } from './verificar-redaccion';
import type { Turno } from './hilo';

export interface PeticionRedaccion {
  /** Lo que preguntó el KAM. En el atajo de chip, el texto de la sugerencia. */
  readonly pregunta: string;
  readonly entrega: Entrega;
  /** Los turnos anteriores, ya recortados por `hilo.ts`. Puede ir vacío. */
  readonly hilo: readonly Turno[];
}

export interface Redaccion {
  /** SIN validar. Lo valida `interpretarSalida()`, y sólo él. */
  readonly crudo: unknown;
  readonly uso: Uso;
}

export interface Redactor {
  /** Va al registro de consumo, en su propia columna. La factura depende de él. */
  readonly nombre: string;
  redactar(p: PeticionRedaccion): Promise<Redaccion>;
}

// ────────────────────────────────────────────────────────────
// LA FORMA DE LA SALIDA

const salidaSchema = z.union([
  z.object({
    tipo: z.literal('respuesta'),
    frases: z.array(
      z.object({
        texto: z.string().trim().min(1),
        // Pista, no ancla: el modelo se equivoca de número y la cita sigue
        // siendo exacta. Medido contra la API real.
        orden: z.number().int().optional(),
        cita: z.string().min(1),
      }),
    ),
  }),
  z.object({ tipo: z.literal('no_esta') }),
]);

/**
 * Valida la FORMA de lo que devolvió el modelo. **No juzga su contenido**: de
 * eso se encarga `verificarRedaccion()`, y separarlos es lo que impide que un
 * JSON bien formado con datos inventados pase por «válido».
 *
 * `null` = ilegible. Se trata como una redacción que no se puede enseñar, no
 * como un error del sistema: el usuario recibe el verbatim, que es la verdad.
 */
export function interpretarSalida(crudo: unknown): SalidaRedactor | null {
  const r = salidaSchema.safeParse(crudo);
  return r.success ? (r.data as SalidaRedactor) : null;
}

// ────────────────────────────────────────────────────────────
// EL PROMPT

/**
 * Techo de la salida, en tokens.
 *
 * **No existía en todo el repo** —`grep -rn "max_tokens" src scripts` daba cero
 * el 21-sep-2026— y aquí hace falta por aritmética: la salida cuesta **$1,20 por
 * millón contra $0,20 de la entrada, seis veces más**, y esto ya no devuelve un
 * JSON de 30 tokens como el clasificador, sino prosa. Sin techo, el peor caso
 * del costo por pregunta no tiene cota superior.
 *
 * 🔴 **3 000 y no 600, y el número salió de medir contra `deepseek-flash`.**
 *
 * El modelo elegido es de RAZONAMIENTO: devuelve `reasoning_content`
 * aparte del contenido y **los tokens de razonamiento cuentan contra este mismo
 * techo** y se cobran como salida. Medido el 21-sep contra la API real, sobre
 * una ficha típica:
 *
 *     pregunta simple .......  25-102 tokens de razonamiento
 *     pregunta abierta ......  726 de razonamiento, 1 092 de salida total
 *
 * Con 600 el razonamiento se comía el presupuesto ENTERO y `content` volvía
 * **vacío con HTTP 200** — el modo de fallo más caro y más silencioso que hay:
 * se paga todo y no se recibe nada.
 *
 * Y por eso la cota real del costo NO es este número: es
 * `PRESUPUESTO_ENTREGA_BYTES` por el lado de la entrada y la contención por el
 * lado de la utilidad. Éste solo impide el caso sin fondo.
 */
export const MAX_TOKENS_REDACCION = 3_000;

/**
 * El sistema del redactor.
 *
 * **La personalidad NO se toca.** `PERSONALIDAD` gobierna al clasificador y
 * cambiarla habría movido la salida de los dos a la vez — dos frentes en una
 * constante. Esta voz es suya y vive aquí.
 */
export function promptDeRedaccion(e: Entrega): string {
  const omitidas = seccionesOmitidas(e);

  return [
    `Eres el asistente documental del portal de inventario de ${NOMBRE_PRODUCTO}.`,
    'Contestas EN ESPAÑOL DE MÉXICO, en prosa breve y directa, sin saludar.',
    '',
    'REGLA ÚNICA Y ABSOLUTA:',
    'Sólo puedes afirmar lo que esté literalmente en las SECCIONES de abajo.',
    'No completes con lo que sepas de este producto ni de ningún otro.',
    'Si la respuesta no está en las secciones, NO la inventes: dilo.',
    '',
    `Documento: ${e.titulo ?? e.familia}`,
    `Familia: ${e.familia}`,
    e.camino === 'parcial'
      ? `ATENCIÓN: te entrego ${e.trozos.length} de ${e.trozosTotales} secciones. Hay ${omitidas} que NO viste.`
      : `Te entrego las ${e.trozos.length} secciones del documento. No falta ninguna.`,
    '',
    'SECCIONES:',
    ...e.trozos.map((t) => textoDeTrozo(t)),
    '',
    'Devuelve json EXACTAMENTE con esta forma, sin texto alrededor:',
    '{"tipo":"respuesta","frases":[{"texto":"…","orden":N,"cita":"…"}]}',
    'o bien, si no está:',
    '{"tipo":"no_esta"}',
    '',
    'Cómo se ancla cada frase — esto es lo que hace verificable tu respuesta:',
    '1. "orden" es el número entre corchetes de la sección de la que sacaste la frase.',
    '2. "cita" es un fragmento COPIADO TAL CUAL de esa sección, palabra por palabra,',
    '   que CONTIENE las cifras, medidas y códigos que escribas en "texto".',
    '   No lo parafrasees ni lo acortes a la mitad de una palabra.',
    '3. Una frase por afirmación. Si dos datos salen de fragmentos distintos, son dos frases.',
    '4. Un dato que escribas y que no esté en su propia cita hace que la respuesta',
    '   entera se descarte. No es preferible arriesgarse: es preferible "no_esta".',
    '',
    'Reglas de redacción (docs/decisions/0009-grounded-assistant-persona-contract.md):',
    '· DOS A CUATRO frases. Si hace falta más, es una tabla, no un párrafo.',
    '· Contesta LO QUE SE PREGUNTÓ. No resumas el documento entero.',
    '· Nunca empieces con «Como asistente…», «Según la documentación proporcionada…»',
    '  ni cierres con «Espero haberte ayudado». Contesta como un compañero que se',
    '  sabe el catálogo: directo y sin ceremonia.',
    '· NUNCA saques a la respuesta el andamiaje del vault: números de versión',
    '  (v0.1), ADR-001, last_updated, «Historial de versiones», «Cómo contribuir»,',
    '  frontmatter ni rutas internas (50_Referencia/…). Si la sección que citas',
    '  lo trae, cita la parte que contesta y deja fuera el resto.',
    '  (Y no es sólo una regla: la guarda del portal descarta la respuesta entera',
    '   si aparece, así que arriesgarse cuesta la respuesta.)',
    '· Si la pregunta tiene DOS partes y sólo una está en las secciones, contesta ESA',
    '  parte y no devuelvas "no_esta". Medido el 21-sep contra la API real: sin esta',
    '  línea el modelo se niega entero ante «¿para qué sirve y qué medidas tiene?».',
    '· No enumeres con "1." ni con viñetas: escribe frases.',
    '· No escribas cifras en letra ("dos"): copia el número como está en la sección.',
    '· No repitas el nombre del archivo ni la ruta: la cita la pone el portal.',
    e.camino === 'parcial'
      ? '· Si lo que se pregunta no está en las secciones que viste, responde {"tipo":"no_esta"}: el portal dirá que hay secciones sin consultar.'
      : '· Si no está en el documento, responde {"tipo":"no_esta"}.',
  ].join('\n');
}

// ────────────────────────────────────────────────────────────
// EL FALSO

/**
 * Los modos del falso. **Cada uno existe para poner un control en ROJO**, no
 * para simular a un modelo.
 *
 * Sin `dato_de_otra_seccion` el gate 2.1 sería una guarda que nadie ejerce — la
 * forma vacua de P19, y el defecto que esta casa ya contó seis veces.
 */
export type ModoFalso =
  | 'fiel'
  | 'no_esta'
  /** Inventa una cifra que no esta en ningun sitio. El caso obvio. */
  | 'dato_inventado'
  /** Cita un dato REAL del documento pero desde OTRA seccion. El caso caro. */
  | 'dato_de_otra_seccion'
  /** Ancla a un trozo que no viajo. */
  | 'ancla_ajena'
  /** Cita algo que NO esta literalmente en el trozo: una parafrasis disfrazada. */
  | 'cita_inventada'
  /** Devuelve algo que no es la forma esperada. */
  | 'ilegible';


export interface RegistroFalso {
  /** Lo que recibió, para que una prueba pueda AFIRMAR qué cruzó el perímetro. */
  peticiones: PeticionRedaccion[];
}

/**
 * Redactor falso. Devuelve lo que se le dijo; no adivina.
 *
 * Guarda cada petición porque el gate más importante del bloque no es sobre lo
 * que sale, es sobre **lo que entra**: una prueba tiene que poder afirmar que al
 * modelo no le llegó una cifra de inventario.
 */
export function redactorFalso(
  modo: ModoFalso = 'fiel',
  opciones: { nombre?: string; uso?: Uso; registro?: RegistroFalso } = {},
): Redactor {
  return {
    nombre: opciones.nombre ?? 'falso',
    async redactar(p: PeticionRedaccion): Promise<Redaccion> {
      opciones.registro?.peticiones.push(p);

      const primero = p.entrega.trozos[0];
      const uso = opciones.uso ?? { entrada: 0, salida: 0 };

      switch (modo) {
        case 'no_esta':
          return { crudo: { tipo: 'no_esta' }, uso };

        case 'ilegible':
          return { crudo: 'no soy json', uso };

        case 'ancla_ajena':
          return {
            crudo: { tipo: 'respuesta', frases: [{ texto: 'Algo.', orden: 99_999, cita: 'lo que sea' }] },
            uso,
          };

        case 'cita_inventada':
          return {
            crudo: {
              tipo: 'respuesta',
              frases: [{ texto: 'Algo.', orden: primero.orden, cita: 'ESTO NO ESTA EN NINGUN TROZO' }],
            },
            uso,
          };

        case 'dato_inventado':
          return {
            crudo: {
              tipo: 'respuesta',
              frases: [
                {
                  texto: 'Pesa 987654 kg.',
                  orden: primero.orden,
                  cita: primero.texto.slice(0, Math.min(40, primero.texto.length)),
                },
              ],
            },
            uso,
          };

        case 'dato_de_otra_seccion': {
          // EL CASO QUE JUSTIFICA EL ANCLAJE. Toma un dato duro que SI esta en
          // el documento —en el ULTIMO trozo— y lo cita desde el PRIMERO. Contra
          // «el documento entero» sale limpia; contra su cita, no.
          const ultimo = p.entrega.trozos[p.entrega.trozos.length - 1];
          const dato = (ultimo.texto.match(/\d[\d.,]*/) ?? ['42'])[0];
          return {
            crudo: {
              tipo: 'respuesta',
              frases: [
                {
                  texto: `El valor es ${dato}.`,
                  orden: primero.orden,
                  cita: primero.texto.slice(0, Math.min(30, primero.texto.length)),
                },
              ],
            },
            uso,
          };
        }

        case 'fiel':
        default: {
          // Copia un tramo literal del primer trozo: por construccion, todo dato
          // duro que contenga esta dentro de su propia cita.
          const tramo = primero.texto.slice(0, Math.min(120, primero.texto.length));
          return {
            crudo: { tipo: 'respuesta', frases: [{ texto: tramo, orden: primero.orden, cita: tramo }] },
            uso,
          };
        }
      }

    },
  };
}
