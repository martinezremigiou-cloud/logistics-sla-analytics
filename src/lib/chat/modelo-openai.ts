// ============================================================
// [INV-B10] lib/chat/modelo-openai.ts — el clasificador real.
//
// `server-only`: este archivo sostiene la llave. Si alguna vez lo importara un
// componente cliente, el build falla en vez de mandar la credencial al
// navegador.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTE ARCHIVO **NO** PUEDE AFIRMAR TODAVÍA, y va aquí para que nadie
// lo lea como verificado:
//
// Está escrito contra el contrato de **Chat Completions** (`/v1/chat/completions`
// con `response_format: {type:'json_object'}` y `usage.prompt_tokens` /
// `usage.completion_tokens`), que es el estable y el que usa el workflow de n8n
// del proyecto. **No he podido correrlo contra la API real**: la llave la pone quien despliega
// y no viaja por el chat.
//
// Por eso el identificador del modelo es una VARIABLE (`OPENAI_MODELO`) y no
// una constante horneada. Se decidió «GPT-5.6 Luna»; el id exacto que espera
// la API se confirma en la primera corrida de la evaluación de O5, y si no
// coincide se cambia una variable de entorno, no una línea de código.
//
// ────────────────────────────────────────────────────────────
// NO REINTENTA, Y ES DECISIÓN.
//
// El resto del repo reintenta ante transitorios (`reintento.ts`). Aquí no:
// **cada intento cuesta dinero y el techo cuenta PREGUNTAS, no llamadas.** Un
// reintento silencioso gastaría el doble sin aparecer en `consumo_chat`, y el
// registro dejaría de explicar la factura — que es justo para lo que existe.
// Si falla, falla, y el usuario vuelve a preguntar: eso sí se cuenta.
//
// SIN `temperature`, Y NO POR GUSTO — MEDIDO CONTRA LA API REAL.
//
// Escribí `temperature: 0` para que dos corridas de la misma pregunta
// clasificaran igual. La API lo rechazó:
//
//     HTTP 400 · "Unsupported value: 'temperature' does not support 0 with
//                 this model. Only the default (1) value is supported."
//
// De paso confirmó lo que yo había declarado como no verificable: **el id
// `gpt-5.6-luna` es correcto** — un id inexistente habría dado
// `model_not_found`, no un error de parámetro.
//
// CONSECUENCIA, y hay que decirla porque toca la evaluación: **la
// clasificación NO es determinista.** Dos corridas de la misma pregunta pueden
// enrutar distinto. Lo que sí es determinista es la RESPUESTA: la tarjeta la
// renderiza el servidor desde `derivarSku`, así que un mismo enrutado da
// siempre las mismas cifras. La variabilidad vive en un solo escalón —cuál de
// las seis intenciones— y es justo lo que O5 mide.
//
// Tampoco se manda `seed`: no está verificado para este modelo, y un parámetro
// que se pide sin comprobar que sirve es una garantía de mentira.
// ============================================================
import 'server-only';
import type { Clasificacion, Clasificador } from './modelo';
import { promptDelSistema } from './modelo';
import { MAX_PREGUNTA } from './topes';

/** El id que espera la API. Variable porque el modelo es decisión de producto y cambiará. */
const MODELO_POR_OMISION = 'gpt-5.6-luna';

/** Un chat que cuelga es peor que uno que falla: el usuario no sabe si esperar. */
export const TIEMPO_LIMITE_MS = 15_000;



interface RespuestaOpenAI {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Los cuatro modos de fallo, y se distinguen porque **no significan lo mismo**.
 *
 *   sin_conexion   la petición NUNCA llegó al proveedor. No costó dinero.
 *   tiempo_agotado salió y no volvió a tiempo. Pudo costar.
 *   rechazado      llegó y el proveedor dijo que no (llave, cuota, modelo).
 *   sin_contenido  llegó, contestó, y no trajo nada.
 *
 * Al usuario se le dice lo mismo en los cuatro —no puede hacer nada distinto—
 * pero al registro no: «no llegué» y «me rechazaron» mandan a revisar cosas
 * opuestas, y confundirlos es mandar a alguien a mirar la llave cuando lo que
 * se cayó fue la red.
 */
export type CodigoDelModelo = 'sin_conexion' | 'tiempo_agotado' | 'rechazado' | 'sin_contenido';

export class ErrorDelModelo extends Error {
  readonly codigo: CodigoDelModelo;

  // Campo declarado y asignado a mano, sin propiedad de parámetro: el
  // type-stripping nativo de Node no soporta esa sintaxis y cualquier script
  // que importe esto moriría con ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Medido en
  // INV-B8 con `ProyectoError`.
  constructor(codigo: CodigoDelModelo, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDelModelo';
    this.codigo = codigo;
  }
}

export function clasificadorOpenAI(apiKey: string, modelo: string = process.env.OPENAI_MODELO || MODELO_POR_OMISION): Clasificador {
  return {
    nombre: modelo,

    async clasificar(pregunta: string): Promise<Clasificacion> {
      const control = new AbortController();
      const reloj = setTimeout(() => control.abort(), TIEMPO_LIMITE_MS);

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelo,
            // Sin `temperature`: este modelo solo admite su valor por omisión.
            // Ver la cabecera — medido con un 400 de la API real.
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: promptDelSistema() },
              { role: 'user', content: pregunta.slice(0, MAX_PREGUNTA) },
            ],
          }),
          signal: control.signal,
          cache: 'no-store',
        });

        if (!res.ok) {
          // El cuerpo del error puede traer detalles de la cuenta; se corta y NO
          // se propaga entero para que no acabe en un log del navegador.
          const detalle = (await res.text().catch(() => '')).slice(0, 200);
          throw new ErrorDelModelo('rechazado', `El modelo respondió ${res.status}. ${detalle}`);
        }

        const cuerpo = (await res.json()) as RespuestaOpenAI;
        const contenido = cuerpo.choices?.[0]?.message?.content;

        if (typeof contenido !== 'string' || contenido.trim() === '') {
          throw new ErrorDelModelo('sin_contenido', 'El modelo respondió sin contenido.');
        }

        // JSON roto NO se trata como error: se devuelve tal cual y **el
        // enrutador lo rechaza como ilegible**. Decidir aquí sería tener dos
        // sitios que opinan sobre la basura, y uno de los dos acabaría
        // suponiendo algo.
        let crudo: unknown;
        try {
          crudo = JSON.parse(contenido);
        } catch {
          crudo = contenido;
        }

        return {
          crudo,
          uso: {
            entrada: cuerpo.usage?.prompt_tokens ?? 0,
            salida: cuerpo.usage?.completion_tokens ?? 0,
          },
        };
      } catch (e) {
        if (e instanceof ErrorDelModelo) throw e;
        if (e instanceof Error && e.name === 'AbortError') {
          throw new ErrorDelModelo('tiempo_agotado', `El modelo no respondió en ${TIEMPO_LIMITE_MS / 1000} s.`);
        }
        // Un `fetch` que LANZA no llegó al proveedor: DNS, TLS, red caída. Es
        // distinto de un `!res.ok`, que sí llegó. Medido de paso en la
        // evaluación de O5: una fracción mínima de las llamadas.
        throw new ErrorDelModelo('sin_conexion', 'No se pudo alcanzar al modelo.');
      } finally {
        clearTimeout(reloj);
      }
    },
  };
}
