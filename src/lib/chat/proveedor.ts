// ============================================================
// [CHAT-B1] lib/chat/proveedor.ts — UNA copia del contrato HTTP, dos proveedores.
//
// Se decidió el 21-sep-2026 pasar el modelo principal a **DeepSeek V4.1
// Flash**, por costo. Lo que hace que el cambio sea barato es que la interfaz ya
// existía desde INV-B10: `enrutar()` valida la salida cruda contra el catálogo
// **sin saber quién la produjo**, así que cambiar de proveedor no lo toca. Eso
// es el gate 2.6, y era una decisión de hace un mes cobrando hoy.
//
// ────────────────────────────────────────────────────────────
// UN SOLO CLIENTE, Y NO UNO POR PROVEEDOR.
//
// DeepSeek habla el contrato de OpenAI —`/v1/chat/completions`, `messages`,
// `response_format`, `usage.prompt_tokens`—, así que dos clientes habrían sido
// **dos copias del mismo contrato**, que es el patrón que este repo ya pagó
// cuatro veces con `piezas_en_camino`. Aquí la diferencia entre proveedores es
// **datos**: una URL, un id de modelo y el nombre de una variable.
//
// Y el conteo importa: el corredor de evaluación YA horneaba su propia
// llamada, así que había dos. Este archivo impide que nazca una tercera y una
// cuarta cuando entre el redactor.
//
// ────────────────────────────────────────────────────────────
// ✅ LO QUE ESTÁ VERIFICADO DE DEEPSEEK, Y CÓMO. Se puso la llave el
// 21-sep-2026 y `scripts/chat-sonda-proveedor.mjs` lo midió contra la API real:
//
//   · el endpoint responde y `/v1/models` devuelve **DOS** ids:
//     `deepseek-flash` y `deepseek-v4-pro`.
//   · **`deepseek-v4.1-flash` NO EXISTE.** El bloque lo pedía con ese nombre y
//     habría dado HTTP 400 en cada pregunta. Se destapó preguntando, no leyendo.
//   · acepta `response_format: {type:'json_object'}` **con una condición que
//     OpenAI no tiene**: el prompt debe contener literalmente la palabra «json»,
//     o devuelve 400. Los dos prompts de este repo la llevan, y hay una prueba
//     que lo fija para que nadie la quite al reescribirlos.
//   · **es un modelo de RAZONAMIENTO**: devuelve `reasoning_content` aparte, y
//     esos tokens cuentan contra `max_tokens` y se cobran como salida.
//
// ⚠️ LO QUE SIGUE SIN MEDIRSE: **el precio por millón.** Sin él no se puede
// afirmar que el cambio abarate, y lo medido va EN CONTRA: para el mismo prompt
// de clasificación, DeepSeek gasta 1 435 tokens de entrada contra 728 de OpenAI
// (su tokenizador es menos eficiente en español) y 757 de salida contra 27
// (razona). O sea ~2× la entrada y ~28× la salida. **El ahorro depende
// enteramente del precio, y hasta tenerlo el criterio 6 queda abierto.**
//
// ────────────────────────────────────────────────────────────
// NI `temperature` NI `seed`, EN NINGUNO DE LOS DOS.
//
// En OpenAI está medido: `temperature: 0` devolvió
// «Only the default (1) value is supported». En DeepSeek no se probó, y la regla
// de la casa es que un parámetro que se pide sin comprobar que sirve es una
// garantía de mentira. Se mandan los dos sin él hasta que alguien lo mida.
// ============================================================
import 'server-only';
import type { Clasificacion, Clasificador, Uso } from './modelo';
import { promptDelSistema } from './modelo';
import type { Redactor, Redaccion, PeticionRedaccion } from './redactor';
import { promptDeRedaccion, MAX_TOKENS_REDACCION } from './redactor';
import { textoDelHilo } from './hilo';
import { MAX_PREGUNTA } from './topes';

/**
 * Los cuatro modos de fallo, y se distinguen porque **no significan lo mismo**.
 *
 *   sin_conexion   la petición NUNCA llegó al proveedor. No costó dinero.
 *   tiempo_agotado salió y no volvió a tiempo. **Pudo costar.**
 *   rechazado      llegó y el proveedor dijo que no (llave, cuota, modelo).
 *   sin_contenido  llegó, contestó, y no trajo nada.
 */
export type CodigoDelModelo = 'sin_conexion' | 'tiempo_agotado' | 'rechazado' | 'sin_contenido';

export class ErrorDelModelo extends Error {
  readonly codigo: CodigoDelModelo;

  // Campo declarado y asignado a mano, sin propiedad de parámetro: el
  // type-stripping nativo de Node no soporta esa sintaxis y cualquier script que
  // importe esto moriría con ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Medido en INV-B8.
  constructor(codigo: CodigoDelModelo, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDelModelo';
    this.codigo = codigo;
  }
}

export type NombreProveedor = 'openai' | 'deepseek';

export interface ConfigProveedor {
  readonly proveedor: NombreProveedor;
  readonly endpoint: string;
  readonly modelo: string;
  readonly apiKey: string;
}

/**
 * El catálogo de proveedores. **Datos, no código.**
 *
 * `variable` es el NOMBRE de la variable de entorno, nunca su valor: los
 * secretos no viven en el repo (§7), y aquí solo se dice dónde buscarlos.
 */
export const PROVEEDORES: Record<NombreProveedor, { endpoint: string; modeloPorOmision: string; variable: string; variableModelo: string }> = {
  openai: {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    // Medido: es el único modelo que ha razonado en este portal — todas
    // las filas de `consumo_chat` hasta esa decisión.
    modeloPorOmision: 'gpt-5.6-luna',
    variable: 'OPENAI_API_KEY',
    variableModelo: 'OPENAI_MODELO',
  },
  deepseek: {
    // ✅ VERIFICADO contra la API real el 21-sep-2026. Ver la cabecera.
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    // 🔴 SE PIDIÓ «DeepSeek V4.1 Flash» Y ESE ID **NO EXISTE**. Medido: un
    // GET a `/v1/models` con la llave real devuelve exactamente DOS —
    // `deepseek-flash` y `deepseek-v4-pro`— y pedir el otro da HTTP 400 con
    // «The supported API model names are deepseek-flash, deepseek-v4-pro, but
    // you passed deepseek-v4.1-flash». Se preguntó al servicio en vez de
    // suponer, que es la única forma de saber algo remoto (P33).
    modeloPorOmision: 'deepseek-flash',
    variable: 'DEEPSEEK_API_KEY',
    variableModelo: 'DEEPSEEK_MODELO',
  },
};

/** Un chat que cuelga es peor que uno que falla: el usuario no sabe si esperar. */
export const TIEMPO_LIMITE_MS = 15_000;

interface RespuestaChatHttp {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * LA ÚNICA llamada HTTP a un modelo de este repo (fuera de los arneses).
 *
 * NO REINTENTA, y es la decisión de INV-B10 sin cambios: cada intento cuesta
 * dinero y el techo cuenta PREGUNTAS, no llamadas. Un reintento silencioso
 * gastaría el doble sin aparecer en `consumo_chat`, y el registro dejaría de
 * explicar la factura — que es justo para lo que existe.
 */
async function llamar(
  cfg: ConfigProveedor,
  cuerpo: Record<string, unknown>,
  tiempoMs: number,
): Promise<{ contenido: string; uso: Uso }> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), tiempoMs);

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: cfg.modelo, ...cuerpo }),
      signal: control.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      // El cuerpo del error puede traer detalles de la cuenta; se corta y NO se
      // propaga entero para que no acabe en un log del navegador.
      const detalle = (await res.text().catch(() => '')).slice(0, 200);
      throw new ErrorDelModelo('rechazado', `El modelo respondió ${res.status}. ${detalle}`);
    }

    const b = (await res.json()) as RespuestaChatHttp;
    const contenido = b.choices?.[0]?.message?.content;

    if (typeof contenido !== 'string' || contenido.trim() === '') {
      throw new ErrorDelModelo('sin_contenido', 'El modelo respondió sin contenido.');
    }

    return {
      contenido,
      uso: {
        entrada: b.usage?.prompt_tokens ?? 0,
        salida: b.usage?.completion_tokens ?? 0,
      },
    };
  } catch (e) {
    if (e instanceof ErrorDelModelo) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new ErrorDelModelo('tiempo_agotado', `El modelo no respondió en ${Math.round(tiempoMs / 1000)} s.`);
    }
    // Un `fetch` que LANZA no llegó al proveedor: DNS, TLS, red caída. Es
    // distinto de un `!res.ok`, que sí llegó.
    throw new ErrorDelModelo('sin_conexion', 'No se pudo alcanzar al modelo.');
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * El nombre que va a `consumo_chat`. **Lleva el proveedor dentro.**
 *
 * Hasta hoy la columna decía `gpt-5.6-luna` a secas, que bastaba con un solo
 * proveedor. Con dos, «qué modelo razonó» deja de ser respondible sin saber de
 * quién era — y el reporte de este bloque tiene que decir contra qué proveedor
 * corrió tomándolo de AQUÍ y no de lo que uno creía tener exportado. Una
 * variable de entorno es otra copia.
 *
 * ⚠️ Rompe la forma de las filas anteriores, que dicen `gpt-5.6-luna` sin
 * prefijo. No se hace backfill: reescribir el registro para que parezca que
 * siempre fue así sería borrar la única evidencia de cuándo cambió.
 */
export function nombreDelModelo(cfg: ConfigProveedor): string {
  return `${cfg.proveedor}/${cfg.modelo}`;
}

/** El clasificador, contra cualquiera de los dos proveedores. */
export function clasificadorDe(cfg: ConfigProveedor): Clasificador {
  return {
    nombre: nombreDelModelo(cfg),

    async clasificar(pregunta: string): Promise<Clasificacion> {
      const { contenido, uso } = await llamar(
        cfg,
        {
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptDelSistema() },
            { role: 'user', content: pregunta.slice(0, MAX_PREGUNTA) },
          ],
        },
        TIEMPO_LIMITE_MS,
      );

      // JSON roto NO se trata como error: se devuelve tal cual y **el enrutador
      // lo rechaza como ilegible**. Decidir aquí sería tener dos sitios que
      // opinan sobre la basura, y uno de los dos acabaría suponiendo algo.
      let crudo: unknown;
      try {
        crudo = JSON.parse(contenido);
      } catch {
        crudo = contenido;
      }
      return { crudo, uso };
    },
  };
}

/**
 * El redactor real.
 *
 * `tiempoMs` viene de fuera porque el presupuesto lo reparte la petición, no
 * este archivo: `route.ts` declara `maxDuration = 30` y el clasificador ya se
 * lleva hasta 15 s. Ver `lib/chat/redaccion.ts`.
 */
export function redactorDe(cfg: ConfigProveedor, tiempoMs: number): Redactor {
  return {
    nombre: nombreDelModelo(cfg),

    async redactar(p: PeticionRedaccion): Promise<Redaccion> {
      const hilo = textoDelHilo(p.hilo);
      const { contenido, uso } = await llamar(
        cfg,
        {
          response_format: { type: 'json_object' },
          // EL ÚNICO `max_tokens` DEL REPO, y hace falta por aritmética: la
          // salida cuesta seis veces la entrada y esto devuelve prosa, no un
          // JSON de 30 tokens. Sin techo, el peor caso no tiene cota superior.
          max_tokens: MAX_TOKENS_REDACCION,
          messages: [
            { role: 'system', content: promptDeRedaccion(p.entrega) },
            ...(hilo ? [{ role: 'system' as const, content: hilo }] : []),
            { role: 'user', content: p.pregunta.slice(0, MAX_PREGUNTA) },
          ],
        },
        tiempoMs,
      );

      let crudo: unknown;
      try {
        crudo = JSON.parse(contenido);
      } catch {
        crudo = contenido;
      }
      return { crudo, uso };
    },
  };
}
