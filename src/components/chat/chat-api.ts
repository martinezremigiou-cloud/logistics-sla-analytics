// ============================================================
// [INV-B10] chat-api.ts — la única escritura del chat.
//
// Mismo criterio que `seguimiento-api.ts` y `partidas-api.ts`: **nunca lanza**.
// Devuelve la respuesta o `null`, y el llamador pinta. Un chat que tumba la
// página del catálogo sería peor que uno que no contesta.
//
// LOS ERRORES SE DISTINGUEN, y no es cosmético:
//
//   429 → topaste. El mensaje del servidor dice cuál techo y cuándo se libera.
//   503 → no se pudo consultar. **No es un «no sé»**: el sistema no dejó de
//         entender, no llegó al modelo. Confundirlos culpa a la comprensión de
//         un problema de infraestructura.
//   500 `config_error` → falta la llave en el servidor. Es del despliegue, no
//         de quien pregunta.
//
// Por eso esto NO usa `toast`: un chat tiene dónde poner su propio error —
// dentro de la conversación, donde la persona está mirando— y un toast que se
// desvanece a los tres segundos se lleva la única explicación que había.
// ============================================================
import type { RespuestaChat, Intencion } from '@/types/chat';
import type { AreaEscalada } from '@/lib/contactos';
import type { Referente } from '@/lib/chat/referente';
import { recortarHilo, type Turno } from '@/lib/chat/hilo';

export interface FalloDelChat {
  /** Lo que se le enseña a la persona. Ya viene curado por el servidor cuando lo trae. */
  mensaje: string;
  /** `true` cuando reintentar tiene sentido. Un techo alcanzado NO lo tiene. */
  reintentable: boolean;
  /**
   * Si este intento **consumió una pregunta del techo**.
   *
   * NO es lo mismo para todos los fallos, y decirlo mal sería mentir sobre la
   * contabilidad de la persona:
   *
   *   503  →  SÍ. El techo se cobra ANTES de llamar al modelo (decisión del
   *           avance 3), así que cuando la llamada se cae el cobro ya ocurrió.
   *   red del navegador → NO. La petición nunca llegó al servidor: no hay fila.
   *   429  →  NO. No se cobró nada nuevo; justamente por eso se rechazó.
   *   400/401/500 → NO. Todos salen ANTES del cobro.
   *
   * Se pidió que si cobra, se diga. Decirlo siempre habría sido más simple y
   * **falso en tres de los cuatro casos** — verificado saboteándolo: caen 6 de 11.
   */
  consumioCuota: boolean;
  /**
   * [INV-B11] O6-adenda · **A quién escribirle**, o `null` si escribirle a
   * alguien sería ruido.
   *
   * Cada caso lo declara por separado, y **NO se deriva de `reintentable`**. La
   * tentación era «si no se puede reintentar, que escriba»: eso mandaría a la
   * gente a escribirle al responsable del portal **por haber alcanzado su techo
   * de preguntas**, que no es problema de nadie. Es el mismo error que este
   * archivo ya documenta para `consumioCuota` — una regla cómoda que sale falsa
   * en varios de los cuatro casos.
   */
  escalada: AreaEscalada | null;
}

/**
 * [CHAT-B2] `referente` viaja como HERMANO de la respuesta, no dentro.
 *
 * Lo produjo el SERVIDOR al resolver este turno; el cliente sólo lo guarda y lo
 * devuelve en el siguiente. **No lo compone él a partir del texto**: sería una
 * segunda opinión sobre qué se resolvió, capaz de divergir de la primera — que
 * es como este repo se ganó cuatro implementaciones de `piezas_en_camino`.
 */
export type ResultadoChat =
  | { ok: true; respuesta: RespuestaChat; referente: Referente | null }
  | { ok: false; fallo: FalloDelChat };

const GENERICO = 'No se pudo consultar al asistente.';

async function mensajeDe(res: Response, porOmision: string): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return typeof body.message === 'string' && body.message ? body.message : porOmision;
  } catch {
    return porOmision;
  }
}

async function pedir(cuerpo: unknown): Promise<ResultadoChat> {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

    if (res.ok) {
      const body = (await res.json()) as RespuestaChat & { referente?: Referente | null };
      return { ok: true, respuesta: body, referente: body.referente ?? null };
    }

    if (res.status === 429) {
      // Reintentar no sirve: el techo no se libera por insistir. Decirlo evita
      // que la persona golpee el botón, que es justo lo que el techo frena.
      return {
        ok: false,
        // Sin escalada: el techo no es una falla, es el limite funcionando.
        fallo: {
          mensaje: await mensajeDe(res, 'Alcanzaste el máximo de preguntas.'),
          reintentable: false,
          consumioCuota: false,
          escalada: null,
        },
      };
    }

    if (res.status === 503) {
      // El único que sí gastó: el techo se cobró antes de intentar la llamada.
      // Sin escalada, **y no por descuido**: aquí la respuesta correcta es
      // «vuelve a intentarlo», que ya la da el mensaje. Poner un contacto
      // además sería dar dos instrucciones a la vez para un tropiezo que
      // probablemente se arregla solo.
      //
      // Se declara `null` en vez de dejar el campo puesto-y-sin-pintar: un
      // dato que nadie usa es un dato que nadie mantiene, y la interfaz obedece
      // al mapa en vez de tener su propia segunda regla.
      return {
        ok: false,
        fallo: { mensaje: await mensajeDe(res, GENERICO), reintentable: true, consumioCuota: true, escalada: null },
      };
    }

    // 400/401/500 y el `config_error` del servidor sin llave. Aqui insistir no
    // sirve y el problema tiene dueno: es del portal.
    return {
      ok: false,
      fallo: { mensaje: await mensajeDe(res, GENERICO), reintentable: false, consumioCuota: false, escalada: 'software' },
    };
  } catch {
    // Red del navegador. Reintentable, y con el mismo cuidado: no se disfraza
    // de «no sé».
    // Nunca llegó al servidor, así que no hay fila que cobrar. Afirmar lo
    // contrario sería inventarle a la persona un consumo que no hubo.
    return {
      ok: false,
      fallo: { mensaje: 'No hay conexión con el portal.', reintentable: true, consumioCuota: false, escalada: null },
    };
  }
}

/**
 * [INV-B11] O6 · DÓNDE ESTÁ PARADO QUIEN PREGUNTA.
 *
 * Se manda el `pathname` y **nada más**: ni el SKU resuelto, ni el título de
 * la pantalla, ni lo que haya en el DOM. El cliente dice DÓNDE está; qué
 * significa lo decide el servidor (`src/lib/chat/ambiente.ts`).
 *
 * Y no viaja la query: puede llevar filtros que no son contexto de nadie, y
 * cuanto menos se manda, menos hay que justificar.
 */
function ambienteActual(): { ruta: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const ruta = window.location?.pathname;
  return typeof ruta === 'string' && ruta.length > 0 ? { ruta } : undefined;
}

/**
 * [CHAT-B2] El contexto de la conversación, que hasta hoy NO viajaba.
 *
 * Medido: `chat-api.ts` mandaba `{pregunta, ambiente}` y nada más —
 * cero menciones de `hilo` en todo el cliente. Ésa era la mitad visible del
 * defecto que el QA manual encontró en la repregunta.
 *
 * **Y son DOS cosas distintas, no una:**
 *   · `hilo`      da contexto a la PROSA — lo lee el redactor.
 *   · `referente` da sujeto a la RECUPERACIÓN — lo lee el servicio ANTES de
 *     resolver el SKU, que es donde la repregunta moría.
 *
 * Mandar sólo el hilo no habría arreglado nada: medido, T2 murió igual con el
 * hilo puesto, porque el redactor ni se llegaba a llamar.
 */
export interface ContextoConversacion {
  hilo?: Turno[];
  referente?: Referente | null;
}

/** Texto libre. Pasa por el modelo. */
export function preguntar(pregunta: string, contexto: ContextoConversacion = {}): Promise<ResultadoChat> {
  const ambiente = ambienteActual();
  // El recorte lo hace el CLIENTE —ahorra red— y el servidor lo COMPRUEBA y
  // rechaza con 400 si llega de más. Recortar en el servidor habría sido más
  // amable y falso: el cliente creería que mandó seis turnos y el modelo habría
  // visto tres, sin que nada lo dijera.
  const hilo = recortarHilo(contexto.hilo ?? []);
  return pedir({
    pregunta,
    ...(ambiente ? { ambiente } : {}),
    ...(hilo.length > 0 ? { hilo } : {}),
    ...(contexto.referente ? { referente: contexto.referente } : {}),
  });
}

/**
 * Un clic: una sugerencia del zero-state o un candidato de una desambiguación.
 *
 * **No pasa por el modelo.** Su destino ya está decidido — lo eligió el usuario
 * de una lista que el servidor le dio— así que enrutarlo otra vez sería pagar
 * ~3,6 s y una llamada por una decisión ya tomada.
 */
export function pedirIntencion(
  intencion: Intencion,
  parametros: { sku?: string | null; termino?: string | null } = {},
  contexto: ContextoConversacion = {},
): Promise<ResultadoChat> {
  // El ambiente viaja TAMBIÉN por el atajo. Un chip de la ficha —«¿Cuándo
  // llega el {sku}?»— ya trae su SKU, así que el ambiente no cambia nada; pero
  // los que no lo traen (`¿Qué hay en aduana?`) siguen sin necesitarlo, y
  // mandarlo en un solo sitio evita que las dos rutas de entrada diverjan.
  const ambiente = ambienteActual();
  return pedir({
    intencion,
    ...(parametros.sku ? { sku: parametros.sku } : {}),
    ...(parametros.termino ? { termino: parametros.termino } : {}),
    ...(ambiente ? { ambiente } : {}),
    // [CHAT-B2] El referente viaja TAMBIÉN por el atajo: un chip de
    // desambiguación que no trae SKU ni término cae en el mismo hueco que una
    // repregunta tecleada, y tiene que rellenarse por el mismo sitio.
    ...(contexto.referente ? { referente: contexto.referente } : {}),
  });
}
