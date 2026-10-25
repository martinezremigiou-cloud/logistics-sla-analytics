// ============================================================
// [INV-B10] /api/chat — la primera ruta del portal que CUESTA DINERO.
//
// Eso cambia cómo se protege. Hasta hoy, un usuario dándole mil veces a un
// botón solo gastaba CPU; aquí gasta tokens de la cuenta de quien opera el portal. De ahí salen
// las cuatro decisiones de esta ruta:
//
//   1. **El techo se cobra ANTES de hablar con el modelo.** Si se comprobara
//      después, un usuario que ya topó seguiría gastando una llamada por cada
//      intento: **el bucle bloqueado seguiría pagando**, que es justo lo que el
//      techo existe para impedir. El orden no es un detalle, es el mecanismo.
//   2. **El techo vive en la base** (`chat_registrar_pregunta`, 0028/0029), que
//      cuenta e inserta bajo el mismo lock. Contar aquí y escribir después sería
//      la ventana lee-y-escribe de B82-1(a) y B91-2 por tercera vez.
//   3. **Un clic en una sugerencia NO llama al modelo.** Su destino ya está
//      escrito en el chip. Ver abajo.
//   4. **Cliente de SESIÓN**, como `/api/sku/[sku]`. La RLS aplica y el chat no
//      ve nada que su usuario no viera abriendo la ficha. Los call-sites de la
//      llave de servicio siguen en 8.
//
// ────────────────────────────────────────────────────────────
// EL REGISTRO SE ESCRIBE EN DOS FASES, y el motivo es de secuencia.
//
// El techo tiene que cobrarse antes de llamar al modelo (punto 1), pero en ese
// momento **no se sabe ni la intención ni los tokens**: los produce la llamada.
// Llamar dos veces a `chat_registrar_pregunta` habría insertado **dos filas por
// pregunta**, partiendo el techo efectivo a la mitad y contando el doble de
// preguntas de las que hubo. Un limitador que se cuenta mal a sí mismo es peor
// que no tenerlo, porque convence.
//
// Por eso la primera llamada devuelve el `id` de su fila y `chat_anotar_uso` la
// completa. **Una pregunta, una fila.**
//
// ────────────────────────────────────────────────────────────
// EL VISITANTE ENTRA, y es una decisión medida y no una concesión.
//
// `requireSession` y no `requireSessionNoVisitante`. Un visitante **ya lee la
// ficha completa** por `/api/sku/[sku]`, que acepta cualquier rol; negarle el
// chat no protegería ni un dato — solo costo, y el costo lo acota el techo, que
// se le aplica igual. Negarlo habría sido seguridad de teatro.
//
// ────────────────────────────────────────────────────────────
// EL ATAJO DE LAS SUGERENCIAS — adición tras medir la latencia.
//
//     con SKU:  1 609 ms · 1 814 ms        sin SKU:  3 604 ms · 3 673 ms
//
// Las seis sugerencias son intenciones que ya conocemos, con sus parámetros
// dentro. Enrutar por modelo algo cuyo destino ya está escrito en el chip sería
// pagar casi cuatro segundos y una llamada por una respuesta que ya teníamos. Y
// el clic en un chip es **la primera interacción de casi todo el mundo**: que
// esa primera vez sea instantánea decide si vuelve.
//
// ¿Es riesgo que el cliente proponga la intención? No: es un valor de un
// catálogo CERRADO, validado contra él, y lo peor que puede hacer alguien es
// pedir una intención que igualmente obtendría escribiendo la pregunta. El
// techo se le cobra idéntico. Lo que cambia es el REGISTRO: su fila queda con
// `modelo` nulo y sin tokens, que es la verdad — no gastó ninguno.
// ============================================================
import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseSessionClient } from '@/lib/supabase/session';
import { apiError, internalError } from '@/lib/api/errors';
import { requireSession } from '@/lib/api/auth';
import { requireSameOrigin } from '@/lib/api/origin';
import { bodyTooLarge, MAX_BODY_BYTES_ESCRITURA } from '@/lib/api/body';
import { getProveedorChat } from '@/lib/env';
import { enrutar, type Decision } from '@/lib/chat/enrutador';
import { definicionDe, IDS_INTENCION } from '@/lib/chat/intenciones';
import { clasificadorDe, redactorDe, ErrorDelModelo, PROVEEDORES, type ConfigProveedor } from '@/lib/chat/proveedor';
import { registroVacio } from '@/lib/chat/redaccion';
import { trazaVacia } from '@/lib/chat/referente';
import { recortarHilo, TOPE_TURNOS_HILO, type Turno } from '@/lib/chat/hilo';
import { preguntaSobreSku } from '@/lib/chat/intenciones';
import { responder } from '@/services/chat.service';
import { TOPE_HORA, TOPE_DIA, TOPE_GLOBAL_DIA, MAX_PREGUNTA, mensajeDeTope, type Veredicto } from '@/lib/chat/topes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// El modelo tarda 1,6-3,7 s medidos, más las lecturas. 30 s es el mismo techo
// que el resto del repo; afinarlo sin medirlo sería inventar un número.
export const maxDuration = 30;

/**
 * Dos formas de preguntar, y solo dos.
 *
 * `pregunta` es texto libre y pasa por el modelo; `intencion` es un clic en una
 * sugerencia y no. Se validan como alternativas EXCLUSIVAS para que no exista
 * un tercer camino a medias donde alguien mande las dos y el servidor tenga que
 * decidir cuál gana — decidir ahí sería adivinar.
 */
/**
 * [INV-B11] O6 · el AMBIENTE: dónde está parado quien pregunta.
 *
 * Se acepta la RUTA y no un SKU ya resuelto — el cliente dice dónde está, el
 * servidor decide qué significa (`src/lib/chat/ambiente.ts`). Y va acotada:
 * una ruta es un `pathname`, no un texto libre, y 512 es holgado para la más
 * larga del portal.
 *
 * **Es opcional en las dos ramas.** Una petición sin ambiente tiene que seguir
 * funcionando igual: es lo que manda cualquier cliente que no lo mande, y es
 * lo que mandaba el portal hasta hoy.
 */
const ambienteSchema = z.object({ ruta: z.string().trim().max(512) }).nullable().optional();

/**
 * [CHAT-B1] EL HILO CORTO. Los turnos anteriores, para que un pronombre tenga
 * referente.
 *
 * `.max(TOPE_TURNOS_HILO)` hace que pasarse sea un **400**, no un recorte
 * callado. Recortar aquí habría sido más amable y falso: el cliente creería que
 * mandó seis turnos y el modelo habría visto tres, sin que nada lo dijera. Un
 * rechazo se ve; un recorte callado, no. El techo de BYTES se comprueba abajo,
 * porque zod no sabe contar UTF-8.
 */
/**
 * [CHAT-B2] DE QUÉ VENÍA HABLANDO LA CONVERSACIÓN.
 *
 * Lo produjo ESTE servidor en el turno anterior y el cliente lo devuelve tal
 * cual. **No lo compone el cliente a partir del texto**: sería una segunda
 * opinión sobre qué se resolvió, capaz de divergir de la primera.
 *
 * Va acotado con los mismos topes que un SKU y un término del cuerpo: viene del
 * navegador, así que se valida como todo lo que viene del navegador.
 */
const referenteSchema = z
  .object({
    sku: z.string().trim().min(1).max(120).nullable(),
    termino: z.string().trim().min(1).max(120).nullable(),
  })
  .nullable()
  .optional();

const hiloSchema = z
  .array(
    z.object({
      quien: z.enum(['usuario', 'asistente']),
      // ────────────────────────────────────────────────────────────
      // [CHAT-B3] EL TURNO NO LLEVA TOPE DE LARGO EN EL ESQUEMA, Y ES LA
      // DECISIÓN QUE CIERRA EL DEFECTO.
      //
      // Aquí ponía `MAX_PREGUNTA` (500), que es el tope de lo que TECLEA el
      // usuario. B2 metió turnos del ASISTENTE, y medido contra el redactor real
      // **una parte notable de las respuestas pasa de 500**: cada una de ellas
      // invalidaba el siguiente envío de su propia conversación, con un 400 del
      // que no se salía ni escribiendo «gracias».
      //
      // Subirlo a `MAX_TURNO_HILO` habría movido el número sin cerrar la forma:
      // **mientras el largo se valide aquí, existe un largo que da 400** — y un
      // 400 por el tamaño de una respuesta que este mismo servidor escribió no
      // informa a nadie que pueda hacer algo al respecto.
      //
      // Así que el largo deja de ser una condición de ACEPTACIÓN y pasa a ser una
      // de PROCESAMIENTO: `recortarHilo` poda abajo. Lo que sigue acotando el
      // tamaño es `bodyTooLarge`, que corre antes de parsear y mira el cuerpo
      // entero — que es donde un tope de tamaño de verdad protege algo.
      //
      // Lo que SÍ se sigue rechazando es el NÚMERO de turnos: eso lo decide el
      // cliente, y recortarlo callado sería la divergencia silenciosa de siempre.
      // ────────────────────────────────────────────────────────────
      texto: z.string().trim().min(1),
    }),
  )
  .max(TOPE_TURNOS_HILO)
  .optional();

const cuerpoSchema = z.union([
  z.object({
    pregunta: z.string().trim().min(1).max(MAX_PREGUNTA),
    intencion: z.undefined().optional(),
    ambiente: ambienteSchema,
    hilo: hiloSchema,
    referente: referenteSchema,
  }),
  z.object({
    pregunta: z.undefined().optional(),
    intencion: z.enum(IDS_INTENCION),
    sku: z.string().trim().min(1).max(120).nullable().optional(),
    termino: z.string().trim().min(1).max(120).nullable().optional(),
    ambiente: ambienteSchema,
    hilo: hiloSchema,
    referente: referenteSchema,
  }),
]);

type ClienteSesion = ReturnType<typeof createSupabaseSessionClient>;

export async function POST(req: Request) {
  const origen = requireSameOrigin(req);
  if (origen) return origen;

  try {
    const db = createSupabaseSessionClient();
    const gate = await requireSession(db);
    if (gate instanceof NextResponse) return gate;

    if (bodyTooLarge(req, MAX_BODY_BYTES_ESCRITURA)) {
      return apiError('payload_too_large');
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return apiError('invalid_body', { issues: [] });
    }

    const parsed = cuerpoSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError('invalid_body', { issues: parsed.error.issues });
    }

    // ────────────────────────────────────────────────────────────
    // [CHAT-B1] EL TECHO DE BYTES DEL HILO.
    //
    // zod ya rechazó por número de turnos; esto rechaza por peso, que es lo que
    // zod no sabe contar. Son DOS techos porque miden cosas distintas: los
    // turnos acotan la DERIVA y los bytes acotan la FACTURA.
    // ────────────────────────────────────────────────────────────
    // [CHAT-B3] EL NÚMERO SE RECHAZA **ANTES**; EL LARGO SE PODA DESPUÉS.
    //
    // El orden no es un detalle: `recortarHilo` también acota el NÚMERO de
    // turnos, así que ponerlo primero dejaba las dos guardas de abajo sin poder
    // morder nunca — una guarda que no puede incrementarse es P19, y esta casa
    // ya lleva seis ejemplares.
    //
    // Así que el conteo se mira sobre lo CRUDO. Es la parte que el cliente
    // decide, y recortarla callado le haría creer que mandó siete turnos cuando
    // el modelo vio seis: la divergencia silenciosa de siempre.
    //
    // El LARGO, en cambio, lo escribe este mismo servidor. Ahí un 400 no informa
    // a nadie que pueda hacer algo, así que se poda.
    const crudo = (parsed.data.hilo ?? []) as Turno[];
    if (crudo.length > TOPE_TURNOS_HILO) {
      return apiError('invalid_body', {
        message: `El historial de la conversación no puede pasar de ${TOPE_TURNOS_HILO} turnos.`,
        issues: [],
      });
    }
    const hilo: Turno[] = recortarHilo(crudo);

    // ────────────────────────────────────────────────────────────
    // [CHAT-B1] EL PROVEEDOR SE RESUELVE ARRIBA, PERO EL `config_error` NO SUBE.
    //
    // Hay que construir el redactor antes de la bifurcación, porque **las dos
    // ramas lo usan**: `documental` es uno de los diez chips (`sugerencias()`
    // devuelve todas menos `capacidades`) y su clic entra por el ATAJO.
    //
    // Lo que NO sube es el `return apiError('config_error')`: hoy un servidor
    // sin llave sirve los chips en 200 —la rama del atajo no toca la llave ni
    // una vez— y subir el error los habría convertido en 500. El chat dejaría
    // de funcionar entero en vez de solo su camino largo, que es exactamente lo
    // que `getModeloSecret` evitaba viviendo dentro del `else`.
    const prov = getProveedorChat();
    const cfg: ConfigProveedor | null = prov
      ? {
          proveedor: prov.proveedor,
          endpoint: PROVEEDORES[prov.proveedor].endpoint,
          modelo: prov.modelo ?? PROVEEDORES[prov.proveedor].modeloPorOmision,
          apiKey: prov.apiKey,
        }
      : null;

    // El presupuesto de tiempo de ESTA petición. `maxDuration = 30`; se dejan
    // 3 s de margen para las lecturas y la respuesta.
    const limite = Date.now() + 27_000;
    const registro = registroVacio();
    const traza = trazaVacia();
    const redactor = cfg ? redactorDe(cfg, 12_000) : null;

    let decision: Decision;
    let veredicto: Veredicto;
    let nombreModelo: string | null = null;
    let tokIn: number | null = null;
    let tokOut: number | null = null;
    /** La pregunta que ve el redactor. En el atajo, el texto del propio chip. */
    let preguntaParaRedactar = '';

    if (parsed.data.intencion) {
      // ---------- EL ATAJO ----------
      const definicion = definicionDe(parsed.data.intencion);
      // `z.enum` ya validó contra el catálogo; esto es el estrechamiento de tipo.
      if (!definicion) return apiError('invalid_body', { issues: [] });

      const cobro = await cobrarTecho(db, definicion.id, null);
      if (cobro instanceof NextResponse) return cobro;
      veredicto = cobro;

      decision = {
        tipo: 'intencion',
        intencion: definicion.id,
        sku: parsed.data.sku ?? null,
        termino: parsed.data.termino ?? null,
      };

      // [CHAT-B1] EL CHIP TAMBIÉN TIENE PREGUNTA, y hace falta que la tenga.
      //
      // `documental` ES uno de los chips —«¿Qué dice la ficha del KYA2490?»— y
      // medido es el más usado de los diez. Sin
      // esto, el camino documental MÁS recorrido sería el único sin prosa, y el
      // gate lo habría firmado en verde como «sin_intento» sin que nadie viera
      // que la mitad de los usuarios no recibe la mejora.
      preguntaParaRedactar = parsed.data.sku
        ? (preguntaSobreSku(definicion, parsed.data.sku) ?? definicion.sugerencia.texto)
        : definicion.sugerencia.texto;
    } else {
      // ---------- EL CAMINO LARGO ----------
      if (!cfg) {
        // `config_error` y no 401: el problema es del despliegue, no de quien
        // pregunta. Confundirlos manda al usuario a revisar su sesión cuando lo
        // que falta es una variable del servidor. **Y va ANTES del techo**: un
        // servidor mal configurado no puede gastarle la cuota a nadie.
        return apiError('config_error', { message: 'El asistente no está configurado en este servidor.' });
      }

      const clasificador = clasificadorDe(cfg);
      nombreModelo = clasificador.nombre;
      preguntaParaRedactar = parsed.data.pregunta!;

      // EL TECHO, ANTES DE GASTAR.
      const cobro = await cobrarTecho(db, null, nombreModelo);
      if (cobro instanceof NextResponse) return cobro;
      veredicto = cobro;

      try {
        const { crudo, uso } = await clasificador.clasificar(parsed.data.pregunta!);
        tokIn = uso.entrada;
        tokOut = uso.salida;
        // El enrutador es el ÚNICO que decide qué hacer con lo que devolvió el
        // modelo, incluida la basura.
        decision = enrutar(crudo, parsed.data.pregunta!);
      } catch (e) {
        if (e instanceof ErrorDelModelo) {
          // ⚠️ UN FALLO DE TRANSPORTE **NO** ES UN «NO SÉ», y por eso sale por
          // aquí y no por `responder()`.
          //
          // Si un parpadeo de red devolviera la tarjeta de «no sé contestar
          // eso», el sistema estaría **culpando a su comprensión de un problema
          // de infraestructura**: no dejó de entender, no llegó al modelo. Es
          // la misma confusión que la evaluación de O5 destapó un nivel más
          // arriba —«falta el SKU» leído como «no entiendo»— una capa más abajo.
          //
          // Se responde 503 con un mensaje que dice qué hacer (reintentar), no
          // 200 con una negativa.
          //
          // ────────────────────────────────────────────────
          // Y SÍ COBRA EL TECHO. Decisión, con su precio dicho:
          //
          // Devolver la cuota exigiría **borrar filas de `consumo_chat`**, que
          // es el sustrato del techo. Sería abrir el único camino que permite
          // REDUCIR el consumo contado — o sea, la única forma de saltarse el
          // límite si algún día tiene un error. Cambiar una propiedad de
          // seguridad real por una de justicia cosmética es mal negocio:
          // perder 1 de 30 por hora ante un fallo medido en un porcentaje
          // mínimo es inmaterial, y el techo acota bucles, no es un medidor de uso justo.
          return apiError('no_disponible', {
            message: 'No pude consultar al asistente en este momento. Vuelve a intentarlo.',
          });
        }
        throw e;
      }
    }

    const respuesta = await responder(db, decision, parsed.data.ambiente ?? null, {
      redactor,
      pregunta: preguntaParaRedactar,
      hilo,
      limite,
      registro,
      referente: parsed.data.referente ?? null,
      traza,
    });

    // ---------- SEGUNDA FASE del registro ----------
    // Solo el camino largo tiene algo que anotar. Se hace DESPUÉS de responder
    // para que la fila refleje una pregunta efectivamente servida, y su fallo NO
    // tumba la respuesta: el techo ya cumplió su trabajo, y perder la etiqueta
    // de una fila es peor contabilidad, no un error para el usuario.
    if (veredicto.id && nombreModelo) {
      await anotarUso(
        db,
        veredicto.id,
        decision.tipo === 'intencion' ? decision.intencion : null,
        nombreModelo,
        tokIn,
        tokOut,
      ).catch(() => {});
    }

    // ────────────────────────────────────────────────────────────
    // [CHAT-B1] LA SEGUNDA LLAMADA SE ANOTA APARTE, Y NO CUELGA DE `nombreModelo`.
    //
    // Ése era el defecto: la anotación de arriba cuelga de `nombreModelo`, que
    // **solo se llena en el camino largo**. Como `documental` es un chip y su
    // clic entra por el atajo, una redacción disparada desde ahí habría costado
    // dinero y dejado la fila con `modelo` NULL y sin tokens — que es justo lo
    // que la cabecera de este archivo declara como «la verdad: no gastó
    // ninguno». Habría sido falso, y ninguna prueba se habría puesto roja.
    //
    // Va en COLUMNAS DISTINTAS y no sumada a las del clasificador: son dos
    // llamadas con precios distintos, y sumarlas haría incalculable cuál subió.
    //
    // `catch` mudo a propósito, igual que arriba: si la `0040` todavía no está
    // aplicada, la RPC no existe y **la respuesta del usuario no se puede caer
    // por eso**. El costo de ese silencio, dicho: hasta que se aplique, el gasto
    // del redactor no queda registrado. Por eso la `0040` es la primera del
    // despliegue y no la última.
    if (veredicto.id && registro.modelo) {
      await anotarRedaccion(db, veredicto.id, registro.modelo, registro.estado, registro.uso).catch(() => {});
    }

    // [CHAT-B2] El referente viaja DE VUELTA, como un campo hermano de la
    // respuesta y no dentro de ella: `RespuestaChat` es una unión de cinco
    // variantes y meterlo en cada una habría sido cinco sitios que pueden
    // olvidarlo. Aquí es uno.
    return NextResponse.json({ ...respuesta, referente: traza.referente }, { status: 200 });
  } catch (e) {
    return internalError('api/chat', e);
  }
}

/**
 * Cobra una pregunta contra el techo. Devuelve la respuesta HTTP si NO pasa.
 *
 * La cuenta y la inserción ocurren dentro de la función de la base, bajo un
 * `pg_advisory_xact_lock`: aquí no queda ninguna decisión que dos peticiones
 * simultáneas puedan tomar a la vez.
 */
async function cobrarTecho(
  db: ClienteSesion,
  intencion: string | null,
  modelo: string | null,
): Promise<NextResponse | Veredicto> {
  const { data, error } = await db.rpc('chat_registrar_pregunta', {
    p_por_hora: TOPE_HORA,
    p_por_dia: TOPE_DIA,
    p_global_dia: TOPE_GLOBAL_DIA,
    p_intencion: intencion,
    p_modelo: modelo,
    p_tok_in: null,
    p_tok_out: null,
  });

  if (error) throw new Error('chat_registrar_pregunta: ' + error.message);

  const v = (data ?? { permitido: false, motivo: 'sin_respuesta' }) as Veredicto;
  if (v.permitido) return v;

  return apiError('tope_alcanzado', { message: mensajeDeTope(v) });
}

/** Completa la fila que creó el cobro. Idempotente y acotada al propio perfil, en la base. */
async function anotarUso(
  db: ClienteSesion,
  id: string,
  intencion: string | null,
  modelo: string,
  tokIn: number | null,
  tokOut: number | null,
): Promise<void> {
  const { error } = await db.rpc('chat_anotar_uso', {
    p_id: id,
    p_intencion: intencion,
    p_modelo: modelo,
    p_tok_in: tokIn,
    p_tok_out: tokOut,
  });
  if (error) throw new Error('chat_anotar_uso: ' + error.message);
}

/**
 * [CHAT-B1] Completa la fila con lo que costó el SEGUNDO escalón.
 *
 * Idempotente y acotada al propio perfil, en la base — el mismo molde que
 * `chat_anotar_uso`. `estado` se guarda aunque no haya `uso`: «lo intenté y la
 * guarda mordió» y «no lo intenté» son cosas distintas, y sin la columna el
 * reporte no podría distinguirlas.
 */
async function anotarRedaccion(
  db: ClienteSesion,
  id: string,
  modelo: string,
  estado: string,
  uso: { entrada: number; salida: number } | null,
): Promise<void> {
  const { error } = await db.rpc('chat_anotar_redaccion', {
    p_id: id,
    p_modelo: modelo,
    p_estado: estado,
    p_tok_in: uso?.entrada ?? null,
    p_tok_out: uso?.salida ?? null,
  });
  if (error) throw new Error('chat_anotar_redaccion: ' + error.message);
}
