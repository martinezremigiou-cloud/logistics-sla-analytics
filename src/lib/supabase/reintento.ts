// ============================================================
// [MVP-CIERRE] F1 · Capa A — resiliencia ante el 401 transitorio.
//
// EL PROBLEMA, MEDIDO. Power Automate corre la ingesta cada hora. Un
// día, casi todas las corridas fallaron en el PRIMER intento y el reintento
// del propio PA las salvó; algunas fallaron también en el reintento. El flujo se
// veía verde. La causa: una lectura cualquiera a PostgREST devuelve 401
// esporádicamente y la corrida entera muere — la ingesta hace ~12 lecturas
// de catálogo antes de escribir, así que son 12 oportunidades de fallar
// por corrida.
//
// POR QUÉ AQUÍ Y NO EN CADA SERVICIO. Los dos clientes de Supabase
// (`server.ts` con service_role y `session.ts` con la sesión del usuario)
// ya envuelven `global.fetch` por el bug de caché de Next. Esa envoltura
// es el ÚNICO punto por el que pasan las ~40 lecturas del proyecto:
// arreglarlo aquí las cubre todas y no cambia ni un call-site. Ponerlo en
// los servicios multiplicaría el cambio y garantizaría que alguien se
// olvide de uno.
//
// SE DISCRIMINA POR EL CUERPO, NUNCA POR EL STATUS. Esta es la decisión
// que sostiene todo lo demás, y no es elegancia: en el mismo deploy que
// lleva este código se ROTAN `INGEST_SECRET` y la llave de servicio. Si el
// reintento se disparara por status 401 a secas, una llave mal pegada se
// reintentaría en silencio y la rotación quedaría enmascarada justo cuando
// más falta hace verla fallar. Por eso:
//
//   · Se reintenta SOLO si el mensaje de PostgREST está en la lista blanca
//     de errores TEMPORALES (abajo).
//   · Cualquier otro mensaje —incluido uno desconocido— NO se reintenta.
//     El default es fallar rápido y ruidoso.
//
// PRESUPUESTO POR PETICIÓN, NO POR LECTURA. Con 12 lecturas y 2 reintentos
// cada una, el peor caso sumaba ~12 s de espera sobre una ruta cuyo
// `maxDuration` es 60 s. El presupuesto vive en el cliente —uno por
// petición— así que el peor caso es acotado y conocido: 3 reintentos,
// 2.5 s en total, pase lo que pase.
//
// EL RASTRO ES REQUISITO, NO ADORNO. Este bloque existe porque el sistema
// se auto-curaba casi siempre EN SILENCIO. Un reintento que no deja
// huella reproduce el mismo problema con otro disfraz. Además, en el plan
// Hobby de Vercel los logs de runtime se retienen ~1 hora: un
// `console.warn` se evapora antes de que nadie lo lea — de hecho por eso
// hoy no tenemos el mensaje literal de las corridas que fallaron. Por eso
// el rastro viaja en el RESULTADO del ETL, que Power Automate conserva 28
// días en su Run history, y no solo al log.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

/** Un reintento que ocurrió, con el mensaje LITERAL que lo justificó. */
export interface EventoReintento {
  /** Recurso pedido (tabla/rpc de PostgREST), sin query string. */
  recurso: string;
  /** GET/POST/… — distingue si tropezó una lectura o la escritura del snapshot. */
  metodo: string;
  /** 1 = primer reintento. */
  intento: number;
  status: number;
  /** Mensaje literal de PostgREST. Es la evidencia que hoy nos falta. */
  mensaje: string;
  esperaMs: number;
}

/** Qué pasó con la resiliencia durante UNA petición. */
export interface RastroResiliencia {
  /** Cuántas veces hubo que reintentar. 0 = corrida limpia. */
  reintentos: number;
  /** `true` si se acabó el presupuesto y una lectura murió con 401 igual. */
  presupuestoAgotado: boolean;
  eventos: EventoReintento[];
}

// `Object.freeze` también del arreglo: `rastroDe()` lo devuelve a cualquiera
// y es compartido a nivel de PROCESO. En un módulo cuya tesis es "nada de
// estado compartido entre peticiones", un congelado superficial deja
// justamente eso (auditoría adversarial).
export const RASTRO_VACIO: RastroResiliencia = Object.freeze({
  reintentos: 0,
  presupuestoAgotado: false,
  eventos: Object.freeze([]) as readonly EventoReintento[] as EventoReintento[],
});

/**
 * Errores TEMPORALES de PostgREST/GoTrue: el token es válido, lo que falla
 * es el momento. Lista blanca deliberadamente CORTA — todo lo que no esté
 * aquí se trata como credencial inválida y no se reintenta.
 *
 *  · `JWT issued at future` — el ÚNICO con evidencia. Confirmado en
 *    producción el 31-jul (`PGRST303`), y capturado otra vez por el arnés
 *    sin inyectarlo. El `iat` del token queda por delante del reloj del
 *    validador. Ya estaba documentado en este repo desde INGESTA2
 *    (`persist.ts`, "tras arranque frío") pero nunca se toleró.
 *
 * Lo que NO entra, a propósito: `Invalid API key`, `invalid claim`,
 * `JWSError`, `permission denied` — credencial mala o permiso faltante,
 * duelen de inmediato. Y tampoco `JWT expired`: ver `TRANSITORIOS_SERVICIO`.
 */
const JWT_ADELANTADO = /jwt issued at future/i;

/**
 * Carril de SERVICIO (`server.ts`, service_role).
 *
 * SOLO `JWT issued at future`, que es el único transitorio con EVIDENCIA:
 * capturado en vivo el 31-jul contra Supabase (`PGRST303`), sin inyectar.
 *
 * `JWT expired` SALIÓ de esta lista (auditoría adversarial de MVP-CIERRE).
 * La justificación que tenía —"un reintento re-emite la petición y el
 * gateway acuña un token fresco"— NO aplica aquí: la `service_role` es una
 * llave ESTÁTICA en `SUPABASE_SERVICE_ROLE_KEY`, no se acuña por petición.
 * Un `JWT expired` en este carril significa llave muerta, no desfase de
 * reloj — y en el deploy que ROTA esa llave, reintentarlo 3 veces solo
 * demora 2.5 s el diagnóstico que más falta hace ver.
 *
 * La lista se mantiene tan corta como la evidencia. Si un día aparece un
 * `JWT expired` transitorio de verdad, se agrega CON su captura.
 */
export const TRANSITORIOS_SERVICIO: readonly RegExp[] = [JWT_ADELANTADO];

/**
 * Carril de SESIÓN (`session.ts`): SOLO el token adelantado.
 *
 * `JWT expired` se excluye a propósito. Un token de usuario que venció de
 * verdad no se va a des-vencer esperando: el reintento está condenado a
 * fallar y, mientras tanto, le cobra al usuario los 2.5 s completos del
 * presupuesto antes de mandarlo a /login — latencia nueva en un camino que
 * hoy es instantáneo. El desfase hacia adelante sí es transitorio y sí se
 * cura solo; el vencimiento no.
 */
export const TRANSITORIOS_SESION: readonly RegExp[] = [JWT_ADELANTADO];

/** Esperas del backoff. El desfase observado es sub-segundo; esto sobra. */
const ESPERAS_MS: readonly number[] = [250, 750, 1500];

/** Tope de reintentos por PETICIÓN completa (no por lectura). Peor caso: 2.5 s. */
const PRESUPUESTO_POR_PETICION = ESPERAS_MS.length;

/**
 * `true` si el 401 corresponde a un error temporal de la lista dada.
 *
 * Se evalúa SOLO el campo `message` del JSON, no el cuerpo entero
 * (auditoría adversarial). Hoy PostgREST emite el 401 en su middleware de
 * JWT —antes de parsear el query—, así que ningún 401 hace eco de la
 * entrada del llamador y probar contra el cuerpo completo no es explotable.
 * Pero si algún día un 401 llegara a incluir texto que venga de fuera,
 * bastaría con que ese texto dijera "JWT issued at future" para inducir un
 * reintento. Parsear cuesta cinco líneas y cierra la clase entera.
 *
 * Si el cuerpo no es JSON o no trae `message`, NO se reintenta: el default
 * sigue siendo fallar.
 */
export function esTransitorio(cuerpo: string, lista: readonly RegExp[] = TRANSITORIOS_SERVICIO): boolean {
  let mensaje: unknown;
  try {
    mensaje = (JSON.parse(cuerpo) as { message?: unknown } | null)?.message;
  } catch {
    return false;
  }
  if (typeof mensaje !== 'string') return false;
  return lista.some((re) => re.test(mensaje as string));
}

/**
 * ¿Se puede volver a emitir esta petición tal cual?
 *
 * Solo si el cuerpo es re-enviable. Un `string` (lo que manda supabase-js:
 * `JSON.stringify`) o la ausencia de cuerpo lo son. Un `Request` ya
 * construido, un `ReadableStream`, un `FormData` o un `Blob` NO: su cuerpo
 * puede haberse consumido en el primer intento y el reintento saldría
 * vacío — peor que no reintentar, porque parecería una petición legítima.
 */
function esCuerpoReenviable(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof Request !== 'undefined' && input instanceof Request) return false;
  const body = init?.body;
  return body === undefined || body === null || typeof body === 'string';
}

/** `marca_alias` a partir de la URL, sin query string (no arrastra filtros ni ids). */
function recursoDe(url: string): string {
  try {
    const { pathname } = new URL(url);
    return pathname.replace(/^\/rest\/v1\//, '').replace(/^\/+/, '') || pathname;
  } catch {
    return url.split('?')[0];
  }
}

function metodoDe(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Registro cliente→rastro. `WeakMap` a propósito: no cambia la firma de
 * `createSupabaseServerClient()` (sus call-sites quedan intactos), no ensucia el
 * objeto del cliente con propiedades ajenas a su API, y no retiene memoria
 * cuando la petición termina y el cliente se vuelve basura.
 */
const RASTROS = new WeakMap<object, RastroResiliencia>();

/** Rastro de resiliencia de un cliente. Vacío si nunca hubo un reintento. */
export function rastroDe(db: SupabaseClient | object | null | undefined): RastroResiliencia {
  if (!db) return RASTRO_VACIO;
  return RASTROS.get(db as object) ?? RASTRO_VACIO;
}

/** Asocia un rastro al cliente ya construido (lo llama cada factory). */
export function registrarRastro(db: object, rastro: RastroResiliencia): void {
  RASTROS.set(db, rastro);
}

/**
 * `fetch` con `cache: 'no-store'` (comportamiento previo, intacto) MÁS
 * reintento acotado ante 401 transitorios.
 *
 * Devuelve también el objeto de rastro, que el caller asocia al cliente.
 *
 * Se reintentan lecturas Y escrituras, siempre que el cuerpo sea
 * re-enviable — ver el bloque de `esCuerpoReenviable` más abajo, que explica
 * por qué un 401 sobre una escritura no puede duplicarla. Este párrafo decía
 * lo contrario ("solo lecturas") desde que se extendió el alcance: el JSDoc
 * quedó contradiciendo al código doce líneas más abajo, en el archivo que
 * decide qué se reintenta (auditoría adversarial).
 */
export function crearFetchResiliente(
  transitorios: readonly RegExp[] = TRANSITORIOS_SERVICIO,
): {
  fetchResiliente: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  rastro: RastroResiliencia;
} {
  const rastro: RastroResiliencia = { reintentos: 0, presupuestoAgotado: false, eventos: [] };

  const fetchResiliente = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const opciones: RequestInit = { ...init, cache: 'no-store' };
    // [MVP-CIERRE] F1 · también las ESCRITURAS, y solo ante 401.
    //
    // La primera versión dejaba fuera el POST por conservadurismo, pero eso
    // bajaba la superficie de ~13 llamadas por corrida a 1, no a 0 — la
    // escritura de `ingest_snapshot` seguía expuesta al mismo transitorio
    // que acabábamos de tolerar en las 12 lecturas.
    //
    // Por qué es seguro: PostgREST valida el JWT **al admitir la petición**,
    // antes de ejecutar la función. Un 401 significa que `ingest_snapshot`
    // NUNCA CORRIÓ, así que un reintento no puede duplicar una escritura —
    // no hubo escritura que duplicar. Verificado además contra la definición
    // desplegada: ni `ingest_snapshot` ni `sincronizar_pendientes_tecnologia`
    // levantan errores que PostgREST mapee a 401.
    //
    // CORRECCIÓN (auditoría adversarial): este comentario decía "y aun si esa
    // premisa fallara, la RPC es idempotente por hash". Es FALSO — la RPC no
    // compara ningún hash; esa idempotencia vive en JS (`runEtl`, vía
    // `sinCambios`). Lo que de verdad respalda el caso es la constraint
    // `snapshots_hash_unique`: un segundo intento moriría con 23505 y
    // ROLLBACK. O sea, no duplica — pero por FALLAR, no por ser inocuo.
    // Importa la diferencia: alguien podría tirar esa constraint creyendo
    // que la función se protege sola.
    //
    // Nótese el alcance: SOLO 401 con mensaje en la lista blanca.
    // Un 5xx a mitad de una escritura sigue SIN reintentarse, porque ahí sí
    // pudo haber ejecución parcial.
    const reenviable = esCuerpoReenviable(input, init);

    let res = await fetch(input, opciones);

    while (res.status === 401 && reenviable) {
      // Se lee sobre un CLON: el cuerpo del `res` original debe seguir
      // intacto para el caller si al final no reintentamos.
      let cuerpo = '';
      try {
        cuerpo = await res.clone().text();
      } catch {
        cuerpo = '';
      }

      if (!esTransitorio(cuerpo, transitorios)) return res; // credencial inválida → duele ya
      if (rastro.reintentos >= PRESUPUESTO_POR_PETICION) {
        rastro.presupuestoAgotado = true;
        return res;
      }

      const esperaMs = ESPERAS_MS[rastro.reintentos];
      rastro.reintentos += 1;
      rastro.eventos.push({
        recurso: recursoDe(urlDe(input)),
        metodo: metodoDe(input, init),
        intento: rastro.reintentos,
        status: res.status,
        mensaje: cuerpo.slice(0, 300),
        esperaMs,
      });
      // Log para la ventana corta de Vercel; el rastro durable va en el
      // resultado del ETL (ver cabecera).
      console.warn(
        `[supabase/reintento] 401 transitorio en ${metodoDe(input, init)} ${recursoDe(urlDe(input))} ` +
          `(intento ${rastro.reintentos}/${PRESUPUESTO_POR_PETICION}, espera ${esperaMs}ms): ${cuerpo.slice(0, 200)}`,
      );

      await dormir(esperaMs);
      res = await fetch(input, opciones);
    }

    return res;
  };

  return { fetchResiliente, rastro };
}
