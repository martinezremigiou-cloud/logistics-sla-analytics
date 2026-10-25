// ============================================================
// [INV-B10] chat.service.ts — de una intención enrutada a una tarjeta.
//
// **NO GENERA SQL Y NO DERIVA NADA.** Llama a las funciones que ya existen y
// que ya están probadas —`getSkuDetalle`, `listInventory`, `listEmbarques`— y
// le pasa lo que devuelven a los constructores de tarjeta. Ésa es la decisión
// que hace este bloque pequeño y seguro: la clase de fallo más común de estos
// sistemas —el modelo escribiendo una consulta mala que devuelve un número
// plausible y falso— **no existe aquí porque el modelo nunca toca la base**.
//
// Y corre con el CLIENTE DE SESIÓN, igual que `/api/sku/[sku]`: la RLS aplica
// y el chat no ve nada que su usuario no viera abriendo la ficha. Los
// call-sites de la llave de servicio **siguen en 8**.
//
// ────────────────────────────────────────────────────────────
// LA RESOLUCIÓN DEL SKU ES TERNARIA, Y ESO SALIÓ DE MEDIR.
//
// El brief traía un invariante binario: «si no puede extraer el SKU, lo pide».
// Contra el catálogo real, resolver un nombre es casi siempre **1-a-N**.
//
// Y los números hay que medirlos POR EL CAMINO QUE CORRE EL CÓDIGO, no por uno
// parecido. En el checkpoint reporté un conteo pequeño para cada nombre, medido con un
// `ilike` sobre `descr_origen` y un `limit 6`. `listInventory` busca sobre más
// campos, así que lo que este servicio ve de verdad es:
//
//     CLIPS → muchos    Series11 → varios    LHZ 72 → ninguno    (vía listInventory)
//
// La ambigüedad es MAYOR de la que declaré, no menor — o sea que la rama de las
// N coincidencias pesa más, no menos.
//
// Y los códigos tampoco desambiguan solos: **muchos** grupos de 5
// caracteres tienen más de un SKU. Así que hay tres ramas y
// no dos:
//
//     0 coincidencias  →  dilo, y ofrece lo que sí sabes hacer
//     1 coincidencia   →  sigue
//     N coincidencias  →  enumera y pregunta cuál
//
// **Elegir por el usuario en el caso N sería adivinar**, que es exactamente lo
// que el bloque prohíbe. Y en inventario adivinar sale caro: la respuesta
// llevaría un número exacto del SKU equivocado.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSkuDetalle } from './sku.service';
import { listInventory } from './inventory.service';
import { listEmbarques } from './embarques.service';
import { resolveVigentes } from './vigente.service';
import { loQueSabeHacer, definicionDe } from '@/lib/chat/intenciones';
import {
  NO_SE,
  SALUDO_PANEL,
  ACUSE,
  DESPEDIDA,
  nadaDeNada,
  FUERA_DE_DOMINIO,
  TOPE_EJEMPLOS,
  nombreLegible,
} from '@/lib/chat/voz';
import { tipoSocialDe } from '@/lib/chat/social';
import { tipoSobreMiDe, respuestaSobreMi } from '@/lib/chat/sobre-mi';
import { loQueSe } from './sobre-mi.service';
import { skuDelAmbiente, admiteAmbiente, notaDeAmbiente, type Ambiente } from '@/lib/chat/ambiente';
import {
  tarjetaLlegada,
  tarjetaDisponibilidad,
  tarjetaClasificacion,
  tarjetaPipeline,
  tarjetaSobreReservados,
  tarjetaBusqueda,
  tarjetaDocumental,
  tarjetaCapacidades,
  tarjetaDestacado,
  tarjetaMisProyectos,
  tarjetaSnapshots,
  tarjetaHallazgos,
} from '@/lib/chat/tarjeta';
import { normalizarTermino } from '@/lib/chat/termino';
import {
  recuperarFicha,
  recuperarFichaPorFamilia,
  buscarEnCorpus,
  type DocHallado,
  mensajeDe,
  causaNuestra,
} from './corpus-consulta.service';
import { DESTINO } from '@/lib/contactos';
import { construirCampana } from './avisos.service';
import { listarProyectos } from './proyectos.service';
import { listSnapshots } from './snapshots.service';
import type { Decision } from '@/lib/chat/enrutador';
import type { RespuestaChat } from '@/types/chat';
import type { Intencion } from '@/lib/chat/intenciones';
import type { Tarjeta } from '@/lib/chat/tarjeta';
import {
  redactar,
  type RegistroDeRedaccion,
  type RespuestaRedactada,
  type EntradaRedaccion,
} from '@/lib/chat/redaccion';
import type { Redactor } from '@/lib/chat/redactor';
import { dentroDelPerimetro } from '@/lib/chat/entrega';
import type { Turno } from '@/lib/chat/hilo';
import {
  tieneSujeto,
  notaDeReferente,
  nombreDelSujeto,
  type Referente,
  type TrazaDeRespuesta,
} from '@/lib/chat/referente';

/** Cuántos candidatos se ofrecen al desambiguar. Más de esto no es una pregunta, es una lista. */
export const MAX_CANDIDATOS = 8;

// El DTO vive en `@/types/chat` y NO se declara aquí: este archivo importa
// `SupabaseClient` y media docena de servicios, así que un componente cliente
// que quisiera el tipo se traería el servidor entero. Es la lección de B8.2 con
// un motivo extra.
export type { Candidato, RespuestaChat } from '@/types/chat';

/**
 * [CHAT-B3] El «no sé», con TRES ejemplos y no con los once.
 *
 * Es el ⛔ literal del contrato del asistente (`docs/decisions/0009-grounded-assistant-persona-contract.md`) —*«la lista completa sale donde `ZERO_STATE`
 * manda, y NO en cada fallo»*— y el QA lo midió roto en las tres formas de fallo
 * que probó. Repetir la ayuda en cada tropiezo la convierte en ruido, y quien la
 * necesitaba de verdad ya la vio al abrir el panel.
 *
 * Tres y no cero: enseñar que el catálogo es CERRADO sigue siendo el trabajo de
 * esta respuesta, y eso era lo que INV-B10 quería. Lo que sobraba eran ocho.
 */
function noSe(mensaje: string): RespuestaChat {
  return { tipo: 'no_se', mensaje, sabeHacer: loQueSabeHacer().slice(0, TOPE_EJEMPLOS) };
}

/**
 * Resuelve a QUÉ SKU se refería la pregunta.
 *
 * Devuelve el SKU cuando no hay ambigüedad, o la aclaración que hay que pedir.
 * Nunca elige entre varios.
 */
async function resolverSku(
  db: SupabaseClient,
  intencion: Intencion,
  sku: string | null,
  termino: string | null,
): Promise<{ sku: string } | RespuestaChat> {
  // (a) El usuario escribió un código. Se comprueba que exista: un SKU
  //     inventado por el modelo llegaría hasta aquí con cara de consulta buena.
  if (sku) {
    const d = await getSkuDetalle(db, sku.trim().toUpperCase());
    if (d) return { sku: d.sku };
    // No existe. Puede ser un typo o un SKU alucinado; en los dos casos se
    // dice, y NO se busca «el más parecido».
    return {
      tipo: 'aclarar',
      motivo: 'sin_coincidencias',
      mensaje: `No encuentro ningún SKU que se llame «${sku}». Revisa el código, o dime el nombre del producto.`,
      candidatos: [],
      intencion,
    };
  }

  // (b) El usuario dijo un nombre. Se busca con la MISMA función que el
  //     catálogo, no con una consulta nueva — y con el término NORMALIZADO:
  //     el modelo devuelve «los CLIPS» con artículo, medido, y `ilike` no casa.
  const limpio = normalizarTermino(termino);
  if (limpio) {
    const page = await listInventory(db, { q: limpio, page: 1, pageSize: MAX_CANDIDATOS + 1 } as never);
    if (page.total === 0) {
      return {
        tipo: 'aclarar',
        motivo: 'sin_coincidencias',
        mensaje: `No hay ningún SKU cuyo nombre o descripción contenga «${limpio}».`,
        candidatos: [],
        intencion,
      };
    }
    if (page.total === 1 && page.items[0]) {
      return { sku: page.items[0].sku };
    }
    return {
      tipo: 'aclarar',
      motivo: 'ambiguo',
      mensaje: `Hay ${page.total} SKU que coinciden con «${limpio}». ¿Cuál de estos?`,
      candidatos: page.items.slice(0, MAX_CANDIDATOS).map((i) => ({
        sku: i.sku,
        descripcion: i.descripcion ?? i.marca ?? '',
      })),
      intencion,
    };
  }

  // (c) Ni código ni nombre. Se pide, sin adivinar entre cientos.
  return {
    tipo: 'aclarar',
    motivo: 'falta_sku',
    mensaje: 'Para eso necesito saber de qué SKU hablas. Dime su código o su nombre.',
    candidatos: [],
    intencion,
  };
}

/** `true` si lo devuelto por `resolverSku` es ya una respuesta y no un SKU. */
function esRespuesta(x: { sku: string } | RespuestaChat): x is RespuestaChat {
  return 'tipo' in x;
}

// ============================================================
// [CHAT-B1] EL ÚNICO SITIO DE ESTE ARCHIVO QUE LLAMA AL MODELO.
//
// Las cuatro puertas documentales pasan por aquí, y las otras diez intenciones
// no pueden llegar: no hay camino. Eso es el gate 2.3, y no es una promesa — es
// que `redactar()` se invoca en una sola función y esa función sólo la llaman
// las ramas de `documental`.
//
// `prosa` puede salir `null` por siete razones distintas (ver
// `lib/chat/redaccion.ts`) y en las siete se enseña **el verbatim**, que es lo
// que el usuario recibe hoy. La redacción MEJORA la respuesta; no la sustituye.
// ============================================================
async function conProsa(
  ctx: ContextoRedaccion | null | undefined,
  entrada: EntradaRedaccion,
  hacerTarjeta: (prosa: RespuestaRedactada | null) => Tarjeta,
): Promise<RespuestaChat> {
  if (!ctx || !ctx.redactor) return { tipo: 'tarjeta', tarjeta: hacerTarjeta(null) };

  const r = await redactar(entrada, {
    redactor: ctx.redactor,
    pregunta: ctx.pregunta,
    hilo: ctx.hilo,
    limite: ctx.limite,
    registro: ctx.registro,
  });

  if (r.tipo === 'respuesta') return { tipo: 'tarjeta', tarjeta: hacerTarjeta(r.respuesta) };

  if (r.tipo === 'no_esta') {
    // EL MODELO DIJO QUE NO ESTÁ, Y ESO ES UNA RESPUESTA. Se enseña su mensaje
    // en la nota **y el verbatim debajo**: quien quiera comprobarlo lo tiene
    // delante, que es justo lo que una negativa honesta necesita para ser
    // creíble sin pedir fe.
    const t = hacerTarjeta(null);
    return { tipo: 'tarjeta', tarjeta: { ...t, nota: [r.mensaje, t.nota].filter(Boolean).join(' ') } };
  }

  return { tipo: 'tarjeta', tarjeta: hacerTarjeta(null) };
}

/**
 * [CHAT-B2] EL PERÍMETRO, APLICADO **ANTES DE OFRECER** Y NO SÓLO ANTES DE LEER.
 *
 * El QA manual encontró dos defectos que son el mismo:
 *
 *   · preguntando por una ANTENA, la respuesta listó «Índice de Cuentas por
 *     Sector» y «RT2 — Retailer 2 (N filas)».
 *   · «¿quién es tu cliente más grande?» → no contesta, pero OFRECE ese mismo
 *     documento; se pide, no lo entrega, y vuelve a ofrecerlo. Un bucle.
 *
 * ✅ **El contenido nunca cruzó al modelo** — `armarEntrega()` lo paró, y está
 * verificado por aritmética en el QA. El perímetro cumplió donde está puesto.
 * **Lo que no gobernaba era lo que se PINTA.**
 *
 * Es P19/P21 de superficie: la guarda existe y funciona, pero la oferta se
 * construía **antes** que ella. Una guarda que corre después de que el usuario
 * ya leyó el nombre del documento no protegió el nombre del documento.
 *
 * Por eso el filtro se aplica aquí, sobre la LISTA, y no dentro de
 * `buscarEnCorpus`: la búsqueda sigue recorriendo el corpus entero —eso es
 * correcto, es cómo se decide relevancia— y lo que se acota es **lo que sale**.
 * Poner el `LIKE` en la consulta habría acoplado la recuperación al permiso, y
 * el día que el perímetro cambie habría dos sitios que lo saben.
 */
function soloDelPerimetro(docs: DocHallado[]): DocHallado[] {
  return docs.filter((d) => dentroDelPerimetro(d.ruta));
}

/**
 * [CHAT-B1] Hallazgos con prosa — **y la prosa cita UN documento, no los cuatro.**
 *
 * No es una simplificación: una `RespuestaRedactada` sólo se construye desde una
 * `Entrega`, y una `Entrega` es de UN documento. Atribuirle a la prosa las
 * cuatro citas de la lista sería decir que salió de las cuatro. Se redacta desde
 * el mejor —los documentos ya vienen ordenados por rango del motor— y la lista
 * sigue enseñando los demás.
 *
 * Y el camino sale **parcial** casi siempre, que es la verdad: de un documento
 * hallado vemos como mucho 2 fragmentos de los que tenga. Por eso `buscarEnCorpus`
 * aprendió a traer `trozosTotales` en este bloque.
 *
 * ESTA PUERTA ES LA QUE MÁS PESA, y conviene decirlo aquí: medido sobre el
 * snapshot vigente, el puente alcanza a muy pocas familias y el nombre del
 * documento a algunas más, pero la BÚSQUEDA alcanza a la gran mayoría. O sea que el camino normal de una
 * respuesta documental son fragmentos, no la ficha entera.
 */
async function prosaDeHallazgos(
  ctx: ContextoRedaccion | null | undefined,


  consulta: string,
  todos: DocHallado[],
  /**
   * [CHAT-B4] QUÉ PIDIÓ EL USUARIO, cuando esto es un relevo y no una búsqueda.
   *
   * Viaja hasta `tarjetaHallazgos` **sin tocarse** para que el título y el aviso
   * los derive el constructor de los dos a la vez. Componerlos aquí habría
   * dejado otra vez dos hechos sueltos que alguien tiene que acordarse de
   * mantener de acuerdo — que es como el salto acabó declarado en un sitio que
   * no se lee.
   */
  relevoDe: string | null = null,
): Promise<RespuestaChat> {
  // EL FILTRO VA PRIMERO: lo que no se puede leer tampoco se nombra.
  const docs = soloDelPerimetro(todos);
  const mejor = docs[0];
  // Todos fuera del perímetro ⇒ se trata como «no hay», no como «hay pero no
  // te lo doy». La diferencia importa: lo segundo confirma que existe.
  if (!mejor) return noSe(NO_SE);

  return await conProsa(
    ctx,
    {
      ruta: mejor.ruta,
      familia: mejor.titulo ?? mejor.ruta,
      titulo: mejor.titulo,
      fuentePdf: mejor.fuentePdf,
      // El `orden` es el ÍNDICE del fragmento, no el del trozo en el documento:
      // el motor no lo devuelve. Da igual para el anclaje —el prompt y el
      // verificador usan la misma numeración—, y se dice aquí para que nadie lo
      // lea como el orden real de la ficha.
      trozos: mejor.fragmentos.map((f, i) => ({ orden: i, rutaSeccion: f.seccion, texto: f.texto })),
      trozosTotales: mejor.trozosTotales,
    },
    (prosa) => tarjetaHallazgos(consulta, docs, prosa, relevoDe),
  );
}

/**
 * [CHAT-B3] EL RELEVO · la primera ruta deja de quedarse la pregunta.
 *
 * ────────────────────────────────────────────────────────────
 * EL HALLAZGO, con hilo fresco en cada medición:
 *
 *   «¿qué es un CLIP?»      → documental → ✅ contesta desde `Clips.md`, con cita
 *   «¿qué es el CLIP 3.0?»  → familia    → 🔴 «no tengo ficha» + escalada
 *   «¿qué es un SIP?»       → SKU        → 🔴 «no hay ningún SKU con ese nombre»
 *
 * **La misma ficha que la primera encuentra en un salto, la segunda nunca la
 * mira.** Y la tercera es peor: contestó por el INVENTARIO una pregunta
 * conceptual. Acertó —`SIP` sale 0 veces en el corpus, medido— pero **el sistema
 * no lo sabe: nunca miró**. Es P25 en su forma más pura, y el día que exista una
 * ficha de algo que no es SKU, esa misma frase seguirá diciendo que no hay nada.
 *
 * ────────────────────────────────────────────────────────────
 * LA CAUSA, MEDIDA — y no es falta de documentación:
 *
 *     muchas familias con «CLIP» en el nombre → solo una con puente → el resto sin
 *
 * `corpus_familia_ficha` se construye por COINCIDENCIA EXACTA NORMALIZADA.
 * `CLIPS` coincidió; `CLIP 3.0` no, y nada intentó otra cosa. Media docena de esas
 * familias son listas dentro de un campo (`CLIP 3.0 / CLIP FLEX / CLIP SLIM`), y
 * contra eso una coincidencia exacta **no puede acertar nunca**.
 *
 * ⇒ La baja cobertura del puente no es un problema de CONTENIDO: es la
 * estrategia de emparejamiento.
 *
 * ────────────────────────────────────────────────────────────
 * ES EL TERCER ESTADO, otra vez. La enumeración tenía dos ramas —«tengo la
 * ficha» / «no tengo la ficha»— y la realidad tiene tres:
 *
 *     tengo LA ficha · no tengo NINGUNA · no tengo ÉSA, pero tengo UNA CERCANA
 *                                          ↑ ésta se disfrazaba de la segunda
 *
 * El contrato ya lo tiene escrito para `getByHash`: *«no encontrado» y «no pude
 * buscar» son valores DISTINTOS*.
 *
 * ⛔ Y NO RELAJA LA CONTENCIÓN: la ficha se cita igual, el verbatim sigue
 * plegado y **el perímetro se aplica antes** (`soloDelPerimetro`). Lo único que
 * cambia es que deja de tirar a la basura un documento que ya tenía en la mano.
 */
async function relevoDocumental(
  db: SupabaseClient,
  ctx: ContextoRedaccion | null | undefined,
  pedido: string,
  /**
   * [CHAT-B4] B4-2 · EL REFUERZO — el nombre de la familia, cuando el sujeto no
   * alcanza. `null` cuando el sujeto YA ES el nombre de la familia.
   */
  refuerzo: string | null = null,
): Promise<RespuestaChat | null> {
  // ────────────────────────────────────────────────────────────
  // [CHAT-B4] B4-2 · EL SUJETO PRIMERO, LA FAMILIA COMO RED.
  //
  // EL HALLAZGO DEL QA MANUAL: «¿qué es el KYA2490?» contestaba «Lo que encontré
  // sobre «SERIES 41»», porque el relevo del camino de SKU buscaba con el
  // nombre de la familia. Para `CLIP 3.0` el nombre de la familia es un buen
  // término; para un cajón genérico es pésimo, y `SERIES 41` abarca
  // una parte enorme del catálogo.
  //
  // 🔴 Y EL DEFECTO NO ERA EL QUE ESTE COMENTARIO DECÍA. La primera versión de
  // estas líneas afirmaba «cuatro documentos SIN RELACIÓN». Lo tumbó la revisión
  // adversaria de este mismo bloque, midiendo contra la base:
  //
  //     buscar_corpus('SERIES 41', 12) agrupado por ruta, TOPE_DOCS = 4
  //       1  (rango alto) un documento de otra familia
  //       2  (rango medio) un documento general de la empresa
  //       3  (rango medio) la ficha del producto del SKU   ← el documento BUENO
  //       4  (rango medio) otro documento de la misma familia
  //
  // `KYA2490` tiene `producto = 'VXQ'`: **`VXQ.md` es la ficha de su propio
  // producto**, y es el ÚNICO trozo del corpus que contiene la cadena
  // `KYA2490`. O sea que el documento correcto SÍ estaba en la lista. Llegaba
  // TERCERO, y `prosaDeHallazgos` redacta desde `docs[0]` — que era la llave
  // UL4.
  //
  // ⇒ El defecto era de RANGO, no de relación. Decir «sin relación» era el
  // resultado correcto por la razón equivocada (P25) escrito en un comentario
  // que empezaba con la palabra «Medido». Regla #1, incumplida por mí, en el
  // bloque que existe porque una garantía vivía donde nadie la lee.
  //
  // 🔴 PERO «QUE BUSQUE CON EL SUJETO» A SECAS HABRÍA ROTO EL CAMINO QUE
  // ARREGLA, y eso se midió antes de escribirlo. **Población ENTERA** — los SKU
  // cuya familia no tiene puente, contando sólo lo que cae dentro del perímetro:
  //
  //     el SUJETO halla algo :  una minoría
  //     la FAMILIA halla algo:  casi todos
  //     SÓLO LA FAMILIA      :  la mayoría  ← se quedarían sin nada
  //     sólo el sujeto       :  ninguno     ← S ⊆ F: nunca alcanza nada nuevo
  //
  // ⇒ El sujeto es un instrumento de PRECISIÓN, no de alcance: cuando acierta,
  // acierta mejor que la familia; cuando no, no aporta. Sustituir habría dejado
  // a la mayoría con un «no tengo nada» donde hoy hay una ficha vecina.
  //
  // ⚠️ La primera versión de estas líneas se midió sobre una MUESTRA pequeña.
  // La dirección era la correcta y **las proporciones no**. Lo levantó la
  // revisión adversaria al no poder reconciliar dos cifras del mismo hecho.
  // Regla #3 — un número sin su denominador es dos números.
  //
  // Por eso el orden es el que es, y es exactamente lo que el bloque pedía por
  // escrito —«la familia **sólo como refuerzo**, nunca como término único»—,
  // que no es lo mismo que su titular.
  //
  // ⚠️ LÍMITE DECLARADO: los dos intentos son DOS consultas de texto completo.
  // No se lanzan en paralelo a propósito — la segunda sólo corre si la primera
  // se queda vacía, así que los casos que acierta el sujeto no pagan nada, y
  // el resto paga una consulta barata contra el índice de trozos.
  // ────────────────────────────────────────────────────────────
  const docsDe = async (termino: string): Promise<{ docs: DocHallado[]; consulta: string } | null> => {
    if (!termino.trim()) return null;
    const r = await buscarEnCorpus(db, termino).catch(() => null);
    if (!r || r.tipo !== 'hallazgos') return null;
    // EL PERÍMETRO GANA AL RELEVO, SIEMPRE. Un vecino que no se puede leer
    // tampoco se puede ofrecer: sería el bucle de B2 por una puerta nueva. Y va
    // DENTRO del intento, no después: si el sujeto sólo trajo documentos fuera
    // del perímetro, eso es un intento vacío y le toca a la red — no un acierto
    // que luego se queda en nada.
    const docs = soloDelPerimetro(r.docs);
    return docs.length > 0 ? { docs, consulta: r.consulta } : null;
  };

  const hallado = (await docsDe(pedido)) ?? (refuerzo ? await docsDe(refuerzo) : null);
  if (!hallado) return null;

  const docs = hallado.docs;
  const mejor = docs[0];
  if (!mejor) return null;

  // ────────────────────────────────────────────────────────────
  // ¿EL TROZO QUE VA A VIAJAR **NOMBRA** LO QUE SE PIDIÓ?
  //
  // 🔴 La primera versión de esta línea preguntaba otra cosa —«¿ganó el intento
  // del sujeto?»— y estaba mal. La tumbaron las pruebas de B3 en cuanto corrió:
  // en el camino de familia el `pedido` ES el nombre de la familia y no hay
  // refuerzo, así que el sujeto gana SIEMPRE. Con «CLIP 3.0» la búsqueda acierta
  // —el stemmer de la `0034` une `clip` con `clips`— y el documento que llega es
  // el del VECINO. Ese predicado habría apagado la declaración del salto en todo
  // el camino de familia: B4-1 entero, deshecho por su propio arreglo.
  //
  // ⇒ «la búsqueda con el término del usuario devolvió algo» **no es** «el
  // documento contesta lo que preguntó». Era P25 otra vez: correcto para
  // `KYA2490`, por una razón que no se sostiene.
  //
  // Lo que sí se sostiene es lo MEDIDO. Sobre los SKU de familias sin
  // puente, el sujeto halla algo dentro del perímetro en una minoría — y **en la
  // gran mayoría de ésos el trozo entregado contiene el SKU literal**, con su
  // descripción propia en una fila de tabla. Ésa es la propiedad que hace
  // contestable la pregunta original, y se puede mirar directamente en vez de
  // inferirla de qué intento ganó.
  //
  // (El título casi nunca lo nombra. Por eso la respuesta se mira en
  // el TEXTO que viaja, no en el nombre del documento.)
  // ────────────────────────────────────────────────────────────
  const elTrozoNombraLoPedido = ((): boolean => {
    const aguja = pedido.trim().toUpperCase();
    if (aguja.length < 3) return false;
    return mejor.fragmentos.some((f) => f.texto.toUpperCase().includes(aguja));
  })();

  // ────────────────────────────────────────────────────────────
  // SE LE PREGUNTA POR LO QUE **SÍ** TENEMOS — PERO SÓLO CUANDO NO TENEMOS LO
  // QUE PIDIÓ.
  //
  // La primera versión de B3 le pasaba la pregunta original al redactor.
  // Medido: con «¿qué es el CLIP 3.0?» contra los fragmentos de `Clips 2.0`, el
  // modelo contestó —correctamente— «eso no está en la ficha». Honesto e
  // inútil: el relevo disparaba, declaraba el salto, y la respuesta seguía
  // vacía. De ahí el reencuadre.
  //
  // 🔴 Y B4 LO APLICÓ TAMBIÉN DONDE SOBRABA. Lo levantó la revisión adversaria
  // de este bloque, y es el hallazgo más caro de los cuatro porque **tiraba una
  // respuesta que ya estaba en la mano**:
  //
  //     «¿qué es el KYA2490?» → el intento del SUJETO acierta → llega `VXQ.md`,
  //     cuyo trozo dice literalmente «| KYA2490 | Adhesivo de reemplazo, lado
  //     Ancla | 20 pack |» → y al redactor se le preguntaba «¿qué es Laptop VXQ
  //     y para qué sirve?». Contestaba sobre la alarma de laptop.
  //
  // **La condición que separa los dos casos es `elTrozoNombraLoPedido`**, y está
  // razonada donde se calcula. La medición de B3 se hizo sobre el caso CONTRARIO
  // —`CLIP 3.0` contra `Clips 2.0`, donde el sujeto NO aparece en el texto—, así
  // que aplicarla siempre era extender una medición fuera de su universo (P17):
  // la rama donde el reencuadre menos hacía falta era la única en la que no se
  // podía apagar.
  //
  // La contención no se mueve en ninguno de los dos casos: el modelo sigue
  // contestando sólo desde los trozos que se le entregaron, y la guarda de
  // anclaje sigue siendo la misma.
  // ────────────────────────────────────────────────────────────
  const nombreCercano = mejor.titulo ?? nombreLegible(mejor.ruta);
  const ctxRelevo =
    ctx && !elTrozoNombraLoPedido ? { ...ctx, pregunta: `¿qué es ${nombreCercano} y para qué sirve?` } : ctx;

  // [CHAT-B4] B4-1 · EL SALTO YA NO SE PEGA AQUÍ A `nota`: viaja como `relevoDe`
  // y lo derivan JUNTOS el título y el aviso, en `tarjetaHallazgos`. Componerlo
  // en este sitio era lo que permitía que el título dijera una cosa y la
  // declaración viviera en otra superficie — y que la segunda se plegara.
  //
  // Y por la misma razón que arriba, `relevoDe` va `null` cuando ganó el sujeto:
  // decir «no tengo una ficha específica de KYA2490» sobre un documento que lo
  // nombra con su descripción propia sería declarar un salto que no hubo. La
  // tarjeta vuelve a ser la de una BÚSQUEDA —«Lo que encontré sobre «KYA2490»»—
  // que es lo que de verdad pasó.
  return await prosaDeHallazgos(ctxRelevo, hallado.consulta, docs, elTrozoNombraLoPedido ? null : pedido);
}

/**
 * [CHAT-B1] PUERTA 4 · la pregunta libre deja de ser un callejón.
 *
 * MEDIDO, y el denominador importa: **una parte de las preguntas de texto libre
 * no enrutó** y cayó a un «no sé» que enumera el catálogo. El
 * bloque la contaba sobre el total, pero muchas fueron clics de chip, y **un
 * chip no puede fallar en enrutar por construcción**: su destino va escrito
 * dentro. Contar el atajo en el denominador diluye el problema a la mitad.
 *
 * ────────────────────────────────────────────────────────────
 * LO QUE HACE, Y LO QUE **NO**.
 *
 * Busca lo que el usuario nombró en el catálogo y en el corpus. Si hay
 * candidatos, LOS OFRECE. Si no hay ninguno, pregunta qué quiso decir
 * **nombrando lo que sí sabe**. Lo que no hace, nunca, es inventar una
 * respuesta para no quedarse callado.
 *
 * **Y NO LLAMA AL MODELO.** Ni el clasificador ni el redactor entran aquí: son
 * dos lecturas de la base sobre un término que el usuario ya escribió. Enrutar
 * ya costó una llamada; adivinar a quién se parece no puede costar otra.
 *
 * ⚠️ EL RIESGO QUE TRAE, dicho: una pregunta de otro dominio puede casar por
 * CASUALIDAD LÉXICA con algún trozo —«capital de Francia» contra un documento
 * que diga «capital»— y volverse una tarjeta. Por eso la puerta 4 **ofrece**,
 * no contesta: lo que devuelve es una pregunta de vuelta con candidatos, y
 * elegir uno es un acto del usuario. El «no sé» que enumera sigue siendo el
 * destino cuando no hay nada.
 */
async function puertaCuatro(
  db: SupabaseClient,
  pregunta: string | null,
): Promise<RespuestaChat | null> {
  const candidatos = terminosDeLaPregunta(pregunta);
  if (candidatos.length === 0) return null;

  // (a) ¿Nombró un producto? El catálogo manda: es dato exacto.
  for (const termino of candidatos) {
    const p = await listInventory(db, { q: termino, page: 1, pageSize: 6 } as never).catch(() => null);
    const skus = (p?.items ?? []).slice(0, 5) as { sku: string; descr_efectiva?: string | null }[];
    if (skus.length === 0) continue;
    return {
      tipo: 'aclarar',
      motivo: 'sin_coincidencias',
      mensaje:
        skus.length === 1
          ? `No entendí qué querías saber, pero «${termino}» me suena a ${skus[0].sku}. ¿Qué quieres saber de él?`
          : 'No entendí qué querías saber. ¿Te refieres a alguno de estos?',
      candidatos: skus.map((x) => ({ sku: x.sku, descripcion: x.descr_efectiva ?? '' })),
      intencion: 'buscar_por_nombre',
    };
  }

  // ────────────────────────────────────────────────────────────
  // (b) ¿Lo menciona la documentación? Se OFRECE, y **sigue siendo un «no sé»**.
  //
  // 🔴 ESTO SE CORRIGIÓ CON LA CORRIDA EN VIVO DELANTE. La primera versión
  // devolvía `tarjetaHallazgos`, y «¿quién ganó el mundial de 2022?» produjo
  // una tarjeta titulada «Lo que encontré sobre mundial» — porque algún
  // documento dice «mundial» por casualidad léxica. Una tarjeta SE LEE COMO UNA
  // RESPUESTA, y ahí el sistema estaría contestando una pregunta de otro
  // dominio con aire de haberla entendido.
  //
  // Lo que devuelve ahora es el «no sé» de siempre —con su enumeración del
  // catálogo intacta— MÁS el nombre de lo que encontró. Así el usuario ve las
  // dos cosas: que no se entendió la pregunta, y qué hay por si se refería a eso.
  // Es literalmente lo que pide §1.2: *preguntar qué quiso decir NOMBRANDO lo
  // que sí se sabe*, sin inventar una respuesta para no quedarse callado.
  //
  // Y de paso desaparece la necesidad de un umbral de relevancia, que habría
  // sido una perilla sin calibrar con aire de rigor (P20): da igual que el
  // hallazgo sea flojo, porque ya no se presenta como un hallazgo.
  for (const termino of candidatos) {
    const hallado = await buscarEnCorpus(db, termino).catch(() => null);
    if (hallado && hallado.tipo === 'hallazgos') {
      // [CHAT-B2] SE FILTRA ANTES DE NOMBRAR. Ofrecer un documento que luego no
      // se puede entregar es el bucle que el QA encontró: ofrece → pides → no
      // entrega → vuelve a ofrecer. Y peor: nombrar «Índice de Cuentas por
      // Sector» ya filtró que existe, aunque su contenido no haya salido.
      const visibles = soloDelPerimetro(hallado.docs);
      if (visibles.length === 0) continue;
      const nombres = visibles.slice(0, 3).map((d) => d.titulo ?? d.ruta.split('/').pop() ?? d.ruta);
      return {
        tipo: 'no_se',
        mensaje:
          `${NO_SE} Si te referías a algo de la documentación, encontré ` +
          `${nombres.map((n) => `«${n}»`).join(', ')}. Dime el nombre o el SKU y te digo lo que trae.`,
        sabeHacer: loQueSabeHacer().slice(0, TOPE_EJEMPLOS),
      };
    }
  }

  return null;
}

/**
 * El término con el que buscar, sacado de la pregunta.
 *
 * Quita las palabras vacías del español y se queda con lo que parece nombrar
 * algo. Es deliberadamente tonto: si fuera listo sería un segundo clasificador
 * con sus propios errores, y el sitio donde se decide qué se preguntó es
 * `enrutar()`, que ya dijo que no lo sabe.
 */
const VACIAS = new Set([
  'que','qué','cual','cuál','como','cómo','donde','dónde','cuando','cuándo','quien','quién',
  'cuanto','cuánto','cuanta','cuánta','cuantos','cuántos','por','para','del','las','los','una',
  'uno','unos','unas','con','sin','sobre','tiene','tienen','hay','esta','está','estan','están',
  'son','ser','the','and','dime','dame','busca','sabes','puedes','favor','info','informacion',
  'información','acerca','respecto','algo','todo','todos','mas','más','muy','pero','tambien',
  'también','porque','porqué','ahora','aqui','aquí','eso','esto','esa','ese','esas','esos',
]);

export function terminosDeLaPregunta(pregunta: string | null): string[] {
  if (!pregunta) return [];
  const palabras = pregunta
    .normalize('NFC')
    .replace(/[¿?¡!.,;:()«»"']/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !VACIAS.has(w.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .slice(0, 3);

  if (palabras.length === 0) return [];

  // ────────────────────────────────────────────────────────────
  // VARIOS CANDIDATOS EN ORDEN, Y NO UNA SOLA CONSULTA. Medido:
  // `plainto_tsquery` es un **AND**, así que juntar las tres palabras exige que
  // el documento las traiga TODAS. Contra el corpus real:
  //
  //     «inteligentes cerraduras onda» ..  ningún trozo
  //     «cerraduras inteligentes» ......   algunos trozos
  //     «cerraduras» ...................  más trozos
  //
  // La primera versión de esta función mandaba las tres juntas y por eso la
  // puerta 4 no ofrecía NADA en la corrida en vivo — con el gate en verde,
  // porque las pruebas le daban el término ya limpio. El fixture probaba mi
  // comprensión, no el código (P26).
  //
  // Del más preciso al más amplio: si el estrecho acierta, se prefiere; si no,
  // se ensancha. Tres consultas como mucho.
  const cand: string[] = [];
  if (palabras.length > 1) cand.push(palabras.slice(0, 2).join(' '));
  for (const w of palabras) cand.push(w);
  return Array.from(new Set(cand)).slice(0, 3).map((t) => t.slice(0, 80));
}

/** El primer candidato. Se conserva para quien sólo quiera uno. */
export function terminoDeLaPregunta(pregunta: string | null): string | null {
  return terminosDeLaPregunta(pregunta)[0] ?? null;
}

/**
 * [CHAT-B1] Lo que se necesita para que el modelo lea y conteste.
 *
 * `registro` lo crea el llamador y lo LEE después: es el canal por el que sube
 * la factura del segundo escalón. Ver `lib/chat/redaccion.ts`.
 */
export interface ContextoRedaccion {
  readonly redactor: Redactor | null;
  /** Lo que preguntó el KAM. En el atajo de chip, el texto de la sugerencia. */
  readonly pregunta: string;
  readonly hilo: readonly Turno[];
  /** Instante (ms epoch) en que se agota el presupuesto de la petición. */
  readonly limite: number | null;
  readonly registro: RegistroDeRedaccion;
  /**
   * [CHAT-B2] ENTRA: de qué venía hablando la conversación. Lo produjo el
   * servidor en el turno anterior y el cliente lo devuelve tal cual.
   */
  readonly referente?: Referente | null;
  /**
   * [CHAT-B2] SALE: el sujeto que ESTE turno resolvió, para el siguiente.
   * Mismo molde que `registro` — un objeto que el llamador crea y lee, y no un
   * cambio en el tipo de retorno de `responder()`, que tiene 35 llamadores.
   */
  readonly traza?: TrazaDeRespuesta;
}

/**
 * Ejecuta una decisión del enrutador contra el dato real.
 *
 * `db` es el cliente de SESIÓN. Con el de servicio, el chat vería el inventario
 * de todos saltándose la RLS — y aunque hoy la RLS del catálogo no distingue
 * por KAM, hacerlo dependería de que nunca lo haga.
 */
export async function responder(
  db: SupabaseClient,
  decision: Decision,
  /**
   * [INV-B11] O6 · DÓNDE ESTÁ PARADO QUIEN PREGUNTA.
   *
   * Llega desde la ruta, **nunca desde el prompt**: el modelo no sabe dónde
   * está nadie, y eso es deliberado (ver `src/lib/chat/ambiente.ts`). El
   * reparto queda comprobable — el modelo decide QUÉ se preguntó, el servidor
   * decide SOBRE QUÉ cuando falta.
   */
  ambiente?: Ambiente | null,
  /**
   * [CHAT-B1] Lo que hace falta para REDACTAR. Opcional, y el cuarto parámetro
   * en vez de un objeto de opciones — que habría sido más limpio de leer.
   *
   * La razón es medida, no estética: `responder()` tiene **muchos llamadores**, y
   * uno de ellos —un script de evaluación— es un `.mjs` que `tsc` no ve
   * y `vitest` no corre. Refactorizar la firma habría dejado ese llamador roto
   * **sin ningún rojo que lo dijera**: habría reventado en la primera pregunta
   * de una corrida de evaluación, a mitad de otra cosa. Un parámetro más feo y
   * cero roturas invisibles es el trato correcto.
   *
   * Sin `ctx`, o con `redactor: null`, esto se comporta EXACTAMENTE como antes
   * de CHAT-B1: se devuelve el verbatim. Eso es lo que hace que todos los
   * llamadores sigan valiendo.
   */
  ctx?: ContextoRedaccion | null,
): Promise<RespuestaChat> {
  // ════════════════════════════════════════════════════════════
  // [CHAT-B3] LAS PREGUNTAS SOBRE EL ASISTENTE SE INTERCEPTAN **ANTES DEL DESPACHO**.
  //
  // Y antes, no en la rama del «no sé», porque tres de las cinco que el QA midió
  // **no llegan ahí**: el clasificador manda «¿sabes de fichas técnicas?» y
  // «¿de qué marcas sabes?» a `capacidades`, que es una intención válida y
  // devolvía la misma tarjeta de once renglones para las dos. Mirar sólo el
  // callejón habría dejado fuera justo las que se probaron primero.
  //
  // La cifra sale de una CONSULTA. `capacidades` es una lista escrita a mano que
  // no consulta nada: el corpus creció y la tarjeta decía
  // exactamente lo mismo. Deuda con nombre:
  // `UNA-LISTA-FIJA-SOBRE-UN-CORPUS-QUE-CRECE-ENVEJECE-SOLA`.
  //
  // Si la consulta falla NO se tumba la respuesta: se sigue por el camino normal.
  // Saber de sí mismo es una mejora; una mejora que puede romper lo que mejora
  // no es una mejora.
  // ════════════════════════════════════════════════════════════
  const sobreMi = tipoSobreMiDe(ctx?.pregunta ?? null);
  if (sobreMi) {
    const se = await loQueSe(db).catch(() => null);
    if (se) return { tipo: 'sobre_mi', mensaje: respuestaSobreMi(sobreMi, se) };
  }

  if (decision.tipo === 'no_soportado') {
    // ─────────────────────────────────────────────────────────
    // NOMBRÓ ALGO SIN PREGUNTAR NADA. No se le niega: se le pregunta.
    //
    // Adivinar qué quería saber sería exactamente lo que el bloque prohíbe —y
    // sale caro: «disponibilidad» y «llegada» dan números distintos del mismo
    // SKU. Preguntar cuesta un clic y **ese clic no llama al modelo**.
    // ─────────────────────────────────────────────────────────
    if (decision.motivo === 'falta_verbo' && decision.sku) {
      const resuelto = await resolverSku(db, 'disponibilidad', decision.sku, decision.termino ?? null);
      if (esRespuesta(resuelto)) return resuelto;
      return {
        tipo: 'elegir_intencion',
        mensaje: `¿Qué quieres saber de ${resuelto.sku}?`,
        sku: resuelto.sku,
      };
    }
    // ────────────────────────────────────────────────────────────
    // [CHAT-B2] LO SOCIAL VA PRIMERO, Y NO CUESTA NADA.
    //
    // «Hola» caía al «no sé» con las once capacidades detrás — el defecto más
    // visible que encontró el QA manual. El diagnóstico exacto: `SALUDO_PANEL`
    // ya existía, pero `voz.ts` lo describe como *«el primer mensaje del
    // zero-state»*. **Se pintaba al abrir; no contestaba al escribir.**
    //
    // Va ANTES de la puerta 4 porque la puerta 4 consulta la base, y buscar
    // «hola» en el catálogo es gasto sin sentido. Y los tres textos se IMPORTAN
    // de `voz.ts`: `voz.test.ts` lee el fuente de este archivo y enrojece si
    // alguien los teclea.
    // ────────────────────────────────────────────────────────────
    const social = tipoSocialDe(ctx?.pregunta ?? null);
    if (social) {
      const mensaje = social === 'saludo' ? SALUDO_PANEL : social === 'acuse' ? ACUSE : DESPEDIDA;
      return { tipo: 'social', mensaje };
    }

    // [CHAT-B1] PUERTA 4 — antes de rendirse, se intenta OFRECER.
    const ofrecido = await puertaCuatro(db, ctx?.pregunta ?? null);
    if (ofrecido) return ofrecido;

    // [CHAT-B3] contrato del asistente (`docs/decisions/0009-grounded-assistant-persona-contract.md`) · fuera de dominio tiene SU frase, no el «no sé»
    // genérico. Decir QUÉ se maneja en la misma línea evita que el usuario
    // tenga que deducirlo de una lista.
    return noSe(decision.motivo === 'fuera_del_catalogo' ? FUERA_DE_DOMINIO : NO_SE);
  }

  const definicion = definicionDe(decision.intencion);
  if (!definicion) {
    // Irrepresentable: `enrutar` ya validó contra el catálogo. Está por si
    // alguien construye una `Decision` a mano — y entonces es «no sé», no un 500.
    return noSe(NO_SE);
  }

  const vigentes = await resolveVigentes(db);
  const cuandoStock = vigentes.stock?.created_at ?? null;
  const cuandoAduana = vigentes.aduana?.created_at ?? null;

  // ============================================================
  // [INV-B11] O6 · PUERTA 2 — la ficha por el NOMBRE DE LA FAMILIA.
  //
  // VA ANTES de resolver el SKU, y el orden es la decisión. Si fuera después,
  // «¿qué dice la ficha del SERIES 2 48?» habría pasado primero por
  // `listInventory`, encontrado N SKU de esa familia y **pedido al usuario que
  // eligiera uno** — para acabar dándole la ficha de la familia, que es la
  // misma para todos. Preguntar algo cuya respuesta no cambia el resultado es
  // peor que no preguntar.
  //
  // Solo aplica cuando NO hay SKU: si el usuario escribió un código, ése manda.
  // Y solo para `documental`: las demás intenciones sí necesitan un SKU
  // concreto, porque sus cifras cambian de un SKU a otro dentro de la familia.
  // ============================================================
  //
  // Y EL TÉRMINO SE NORMALIZA, que es un defecto que costó una QA en vivo. El
  // modelo devuelve **«los CLIPS» con artículo** —medido, y ya escrito veinte
  // líneas más abajo en este mismo archivo para la búsqueda por nombre—, así
  // que `ilike('nombre', 'los CLIPS')` no casa con la familia `CLIPS` y la
  // pregunta se caía al camino del SKU: muchos candidatos para una ficha que es la
  // misma para todos. La lección estaba escrita y no la apliqué; ahora las dos
  // entradas pelan el término con la MISMA función.
  // ============================================================
  // [CHAT-B2] EL REFERENTE RELLENA EL HUECO, Y SÓLO EL HUECO.
  //
  // Va ANTES de la puerta 2 porque un referente con TÉRMINO tiene que poder
  // entrar por ahí: «¿qué es el desactivador RF?» resuelve por nombre de
  // familia, no por SKU, y la repregunta tiene que seguir ese mismo camino.
  //
  // Dispara con la MISMA regla que el ambiente —`admiteAmbiente`: la pregunta
  // no trajo ni SKU ni término— porque es el mismo hueco. Y la conversación
  // gana a la página: cambiar de tema hablando es más explícito y más reciente
  // que la ficha que quedó abierta detrás.
  // ============================================================
  const referenteVivo = admiteAmbiente(decision) && tieneSujeto(ctx?.referente) ? ctx!.referente! : null;
  if (referenteVivo) {
    decision = { ...decision, sku: referenteVivo.sku, termino: referenteVivo.termino };
  }

  const terminoFamilia = normalizarTermino(decision.termino);
  if (decision.intencion === 'documental' && !decision.sku && terminoFamilia) {
    const porFamilia = await recuperarFichaPorFamilia(db, terminoFamilia);
    if (porFamilia) {
      if (porFamilia.tipo === 'ficha') {
        const f = porFamilia;
        // [CHAT-B2] El sujeto del turno, para la repregunta. Aquí se resolvió
        // por NOMBRE DE FAMILIA, así que eso es lo que sobrevive — no el SKU,
        // que en esta puerta puede ser null por diseño.
        if (ctx?.traza) ctx.traza.referente = { sku: f.sku, termino: terminoFamilia };
        return await conProsa(
          ctx,
          {
            ruta: f.ruta,
            familia: f.familia,
            titulo: f.titulo,
            fuentePdf: f.fuentePdf,
            trozos: f.trozos,
            trozosTotales: f.trozos.length,
          },
          (prosa) =>
            tarjetaDocumental(
              {
                sku: f.sku,
                familia: f.familia,
                titulo: f.titulo,
                fuentePdf: f.fuentePdf,
                commitSha: f.commitSha,
                revisada: f.revisada,
                trozos: f.trozos,
              },
              prosa,
            ),
        );
      }
      // [CHAT-B3] EL RELEVO, antes de escalar. La escalada deja de ser la
      // primera salida: un puente faltante escalaba a producto ANTES de mirar el
      // corpus. Ahora escala sólo cuando las DOS rutas quedaron vacías, que es lo
      // que `DESTINO` siempre quiso decir.
      const relevo = await relevoDocumental(db, ctx, terminoFamilia);
      if (relevo) return relevo;

      return {
        tipo: 'sin_documentacion',
        mensaje: mensajeDe(porFamilia),
        causaNuestra: causaNuestra(porFamilia),
        escalada: DESTINO[porFamilia.tipo],
      };
    }
    // `null` = el término no es una familia. Se sigue por el camino del SKU,
    // que es el que sabe decir «no encuentro ningún SKU con ese nombre».
  }

  // ============================================================
  // [INV-B11] O6 · EL AMBIENTE RELLENA EL HUECO, y solo el hueco.
  //
  // «¿cuánto hay?» en la ficha de KYA2490 contestaba *«necesito saber de qué
  // SKU hablas»* con la respuesta en la misma pantalla.
  //
  // Se completa **antes** de resolver, y solo cuando la pregunta no traía ni
  // SKU ni término: si el usuario dijo algo, eso manda. Y el SKU del ambiente
  // pasa por `resolverSku` como cualquier otro — no se cuela sin comprobar que
  // existe, porque la ruta la escribe el navegador y una ruta a mano puede
  // llevar cualquier cosa.
  // ============================================================
  // El ambiente sólo entra si el referente NO decidió: dos rellenos sobre el
  // mismo hueco serían dos opiniones sobre de qué producto se habla.
  const skuAmbiente = admiteAmbiente(decision) ? skuDelAmbiente(ambiente) : null;
  const decidido: Decision = skuAmbiente ? { ...decision, sku: skuAmbiente } : decision;
  decision = decidido;

  // ---------- las tres que necesitan un SKU ----------
  if (definicion.requiereSku) {
    const resuelto = await resolverSku(db, decision.intencion, decision.sku, decision.termino);
    if (esRespuesta(resuelto)) {
      // ========================================================
      // [INV-B11] O6 · PUERTA 3 — el ÚLTIMO intento, y solo para `documental`.
      //
      // POR QUÉ AQUÍ Y NO ANTES. Ésta es la rama en la que el SKU **no se
      // resolvió**: o no hay coincidencias, o hay decenas y habría que preguntar
      // cuál. O sea el punto exacto en que hoy el usuario recibe un callejón.
      // Ponerla antes habría hecho que una pregunta con SKU resoluble se
      // contestara con fragmentos sueltos en vez de con su ficha — un
      // resultado peor, y la puerta 3 se suma, no sustituye.
      //
      // Es lo que alcanza los documentos (más de la mitad del corpus) que no son ficha de
      // ninguna familia: el glosario, el mapa del vault, el índice de
      // clientes. Ningún puente los alcanza porque el puente va de familia a
      // ficha, y ellos no son fichas.
      //
      // Si tampoco hay hallazgos, se devuelve la respuesta original — la
      // desambiguación o el «no encuentro», que siguen siendo la verdad.
      // ========================================================
      if (decision.intencion === 'documental') {
        const consulta = normalizarTermino(decision.termino) ?? decision.sku;
        if (consulta) {
          const hallado = await buscarEnCorpus(db, consulta);
          if (hallado.tipo === 'hallazgos') {
            return await prosaDeHallazgos(ctx, hallado.consulta, hallado.docs);
          }
          if (hallado.tipo === 'corpus_vacio' || hallado.tipo === 'fallo_consulta') {
            // Un pendiente NUESTRO no se disfraza de «no encontré nada sobre
            // tu producto». Es la misma regla de O4, aplicada a la búsqueda.
            return {
              tipo: 'sin_documentacion',
              mensaje: mensajeDe(hallado),
              causaNuestra: true,
              escalada: DESTINO[hallado.tipo],
            };
          }
          // ────────────────────────────────────────────────
          // [CHAT-B3] `sin_hallazgos` · SE DICE QUE SE MIRARON LAS DOS.
          //
          // Caer a la respuesta original sigue siendo correcto cuando ésta es una
          // DESAMBIGUACIÓN: «¿cuál de estos SKU?» es mejor que «no encontré».
          //
          // Pero cuando la original es «no hay ningún SKU con ese nombre», esa
          // frase es MEDIA VERDAD: también se miró el corpus y tampoco había
          // nada, y el usuario no tiene forma de saberlo. Medido con «¿qué es un
          // SIP?» — acertaba, y el sistema no sabía por qué.
          if (hallado.tipo === 'sin_hallazgos' && esRespuesta(resuelto) && resuelto.tipo === 'aclarar' && resuelto.candidatos.length === 0) {
            return noSe(nadaDeNada(consulta));
          }
        }
      }
      return resuelto;
    }

    // [CHAT-B2] El SKU resolvió: ése es el sujeto vivo de la conversación.
    // Se escribe AQUÍ y no al final porque todas las intenciones que requieren
    // SKU pasan por este punto, y ninguna de ellas puede olvidarse de hacerlo.
    if (ctx?.traza) ctx.traza.referente = { sku: resuelto.sku, termino: null };

    const d = await getSkuDetalle(db, resuelto.sku);
    if (!d) {
      // Solo puede pasar si el SKU desapareció entre la resolución y esta
      // lectura. Se dice; no se rellena con ceros.
      return {
        tipo: 'aclarar',
        motivo: 'sin_coincidencias',
        mensaje: `No encuentro ningún SKU que se llame «${resuelto.sku}».`,
        candidatos: [],
        intencion: decision.intencion,
      };
    }

    // CUANDO EL AMBIENTE DECIDIÓ, LA RESPUESTA LO DICE. No estaba en el brief
    // y hace falta: cifras exactas de un SKU que nadie nombró, sin avisar, es
    // la misma clase de daño que adivinar entre decenas de candidatos — solo que más
    // convincente, porque acertó.
    const aviso = skuAmbiente
      ? notaDeAmbiente(skuAmbiente)
      : referenteVivo
        ? notaDeReferente(nombreDelSujeto(referenteVivo))
        : null;
    // [CHAT-B4] B4-1 · EL AVISO VA AL CAMPO QUE NO SE PLIEGA.
    //
    // Antes se anteponía a `nota`, y `nota` vive dentro del `<details>` que B2
    // cierra en cuanto hay prosa. Para las tres de inventario daba igual —sin
    // prosa el detalle va abierto—, pero `documental` SÍ lleva prosa: «contesté
    // sobre el SKU que venías viendo» desaparecía de la pantalla exactamente en
    // la respuesta donde más falta hace saberlo.
    //
    // No lo reportó el QA manual: salió de arreglar el salto del relevo y mirar
    // quién más escribía en `nota`. Es el mismo defecto, una puerta más allá.
    const conAviso = (t: Tarjeta): Tarjeta =>
      aviso ? { ...t, aviso: [aviso, t.aviso].filter(Boolean).join(' ') } : t;

    switch (decision.intencion) {
      case 'llegada':
        return { tipo: 'tarjeta', tarjeta: conAviso(tarjetaLlegada(d, cuandoAduana)) };
      case 'disponibilidad':
        return { tipo: 'tarjeta', tarjeta: conAviso(tarjetaDisponibilidad(d, cuandoStock)) };
      case 'clasificacion':
        return { tipo: 'tarjeta', tarjeta: conAviso(tarjetaClasificacion(d, cuandoStock)) };
      case 'documental': {
        // ────────────────────────────────────────────────────
        // [INV-B11] O5 · el enchufe del corpus.
        //
        // `recuperarFicha` ya distingue siete estados y **ninguno se colapsa
        // aquí**. Traducirlos todos a «no sé» habría deshecho O4 entero en una
        // línea: el usuario recibiría la misma respuesta si no hay ficha, si el
        // corpus no está cargado o si la consulta se cayó.
        //
        // `causaNuestra` viaja hasta la interfaz para que un pendiente nuestro
        // no se lea como un hecho sobre su producto.
        // ────────────────────────────────────────────────────
        const r = await recuperarFicha(db, resuelto.sku);
        if (r.tipo === 'ficha') {
          const f = r;
          return await conProsa(
            ctx,
            {
              ruta: f.ruta,
              familia: f.familia,
              titulo: f.titulo,
              fuentePdf: f.fuentePdf,
              trozos: f.trozos,
              // `recuperarFicha` trae TODOS los trozos del documento —su lectura
              // no lleva `.limit()` ni `.range()`—, así que aquí el total ES lo
              // que viaja y el camino sale `completo` salvo que el presupuesto
              // muerda. Medido: los documentos de un solo trozo caben todos.
              trozosTotales: f.trozos.length,
            },
            (prosa) =>
              conAviso(
                tarjetaDocumental(
                  {
                    sku: f.sku,
                    familia: f.familia,
                    titulo: f.titulo,
                    fuentePdf: f.fuentePdf,
                    commitSha: f.commitSha,
                    revisada: f.revisada,
                    trozos: f.trozos,
                  },
                  prosa,
                ),
              ),
          );
        }
        // ========================================================
        // [INV-B11] O7 · SIN PUENTE, LA PUERTA 3 LO INTENTA POR EL NOMBRE.
        //
        // Lo destapó el conjunto de evaluación, caso E3: «¿qué es el
        // 0861-5844-9317?». El SKU existe, su familia es `SERIES11 FLOOR`, y
        // **`SERIES11 FLOOR` no tiene renglón en el puente** — así que la
        // respuesta era un callejón. Pero su documento SÍ está indexado
        // (`Antena-EAS-Series11-AM-Floor.md`): lo único que faltaba era buscarlo
        // por el nombre de la familia en vez de rendirse.
        //
        // Y lo que se devuelve son HALLAZGOS, no una ficha — la tarjeta lo dice
        // con esas palabras. **Es correcto que se distingan:** una ficha es la
        // documentación de esa familia; esto son fragmentos que la mencionan, y
        // nadie los ha revisado.
        //
        // Solo para los dos estados donde falta el MAPEO, no donde falta el
        // dato: `sku_desconocido` y `sin_familia` no tienen nombre de familia
        // con el que buscar, y `puente_colgante` es un error de mapeo que hay
        // que ver, no tapar con una búsqueda.
        // ========================================================
        //
        // ════════════════════════════════════════════════════════
        // [CHAT-B4] B4-2 · Y AQUÍ ESTABA EL AMASIJO, EN ESTE CAMINO.
        //
        // Este bloque es de INV-B11 y se escribió antes que el relevo de B3, así
        // que hacía su propia búsqueda a mano. Tres cosas le faltaban, y las
        // tres se ven en «¿qué es el KYA2490?» —un chip sugerido del panel—:
        //
        //   · buscaba con `r.familia` = `SERIES 41`, que abarca muchísimos SKU
        //   · titulaba «Lo que encontré sobre «SERIES 41»», nombrando una
        //     familia que el usuario nunca escribió
        //   · **no declaraba el salto en absoluto**: ni siquiera la nota que B3
        //     le puso al otro camino. Ni reencuadraba la pregunta, así que el
        //     redactor recibía «¿qué es el KYA2490?» contra los fragmentos del
        //     documento que hubiera quedado PRIMERO —la llave `Series1 UL4`— y la
        //     guarda mordía. Sin prosa el `<details>` se abre, y salía
        //     «Documentos N» en pantalla: el ⛔ del contrato del asistente (docs/decisions/0009-grounded-assistant-persona-contract.md).
        //
        // Ahora pasa por el MISMO relevo que el camino de familia, con el SKU
        // como sujeto y la familia como refuerzo. Medido contra la base:
        // `buscar_corpus('KYA2490')` devuelve **un solo** documento,
        // `Series-41/VXQ.md` — que es la ficha de `VXQ`, el producto de ese
        // SKU, y el único trozo que contiene la cadena `KYA2490`.
        // Buscando por la familia ese mismo documento salía en un lugar posterior, y
        // `prosaDeHallazgos` redacta desde `docs[0]`. El arreglo no es traer un
        // documento que no venía: es que el que venía quede el primero.
        //
        // Las dos rutas documentales comparten relevo desde aquí. Eran dos
        // implementaciones del mismo tercer estado, y sólo una tenía los
        // arreglos de B3.
        // ════════════════════════════════════════════════════════
        if (r.tipo === 'sin_puente' || r.tipo === 'sin_ficha_confirmado') {
          const relevo = await relevoDocumental(db, ctx, resuelto.sku, r.familia);
          // ──────────────────────────────────────────────────
          // [CHAT-B4] `conAviso` TAMBIÉN AQUÍ — lo encontró la revisión
          // adversaria de este mismo bloque, y era la media función de P24 en
          // código que acababa de escribir.
          //
          // `conAviso` se aplicaba a las tres de inventario y a la ficha, y
          // esta rama devolvía desnudo. O sea: cuando el ambiente o el
          // referente eligen el SKU y ese SKU no tiene puente —la mayoría del catálogo— la
          // procedencia del sujeto se perdía ENTERA. No plegada: ausente.
          //
          // Y hay un invariante escrito que eso violaba: el docstring de
          // `notaDeAmbiente` dice «va SIEMPRE que el ambiente decida». P35, en
          // un bloque cuyo propio hallazgo fue que una garantía estaba en la
          // superficie equivocada.
          //
          // Lo que NO se perdía, dicho para no exagerar el tamaño: el relevo ya
          // nombra el SKU en su propio aviso y en el título. Lo que faltaba era
          // de dónde salió ese sujeto, no cuál era.
          // ──────────────────────────────────────────────────
          if (relevo) {
            return relevo.tipo === 'tarjeta' ? { tipo: 'tarjeta', tarjeta: conAviso(relevo.tarjeta) } : relevo;
          }
        }

        // [INV-B11] O6-adenda · el destino sale del ESTADO, aquí y no en la
        // interfaz: es el servidor quien sabe en cuál de los siete terminó.
        // `mensajeDe(r)` de `puente_colgante` lleva un «avisa» desde que se
        // escribió; esto es lo que por fin le pone a quién.
        return {
          tipo: 'sin_documentacion',
          mensaje: mensajeDe(r),
          causaNuestra: causaNuestra(r),
          escalada: DESTINO[r.tipo],
        };
      }
      default:
        return noSe(NO_SE);
    }
  }

  // ---------- las tres que no ----------
  switch (decision.intencion) {
    case 'pipeline': {
      // `ambito: 'activos'` — un embarque histórico ya cerró su ciclo y
      // contarlo diría que algo viene en camino cuando ya llegó.
      const r = await listEmbarques(db, { ambito: 'activos', orden: 'eta', dir: 'asc', page: 1, pageSize: 50 } as never);
      return { tipo: 'tarjeta', tarjeta: tarjetaPipeline(r) };
    }
    case 'sobre_reservados': {
      const p = await listInventory(db, { badge: 'sobre_reservado', page: 1, pageSize: 50 } as never);
      return { tipo: 'tarjeta', tarjeta: tarjetaSobreReservados(p, cuandoStock) };
    }
    case 'buscar_por_nombre': {
      const termino = normalizarTermino(decision.termino ?? decision.sku);
      if (!termino) {
        return {
          tipo: 'aclarar',
          motivo: 'falta_sku',
          mensaje: '¿Qué quieres que busque? Dime el nombre o parte de la descripción.',
          candidatos: [],
          intencion: 'buscar_por_nombre',
        };
      }
      const p = await listInventory(db, { q: termino, page: 1, pageSize: 50 } as never);
      if (p.items.length > 0) return { tipo: 'tarjeta', tarjeta: tarjetaBusqueda(p, termino, cuandoStock) };

      // ────────────────────────────────────────────────────────
      // [CHAT-B3] CERO SKU **NO** ES CERO INFORMACIÓN.
      //
      // «¿qué es un SIP?» contestaba «no hay ningún SKU cuyo nombre contenga
      // SIP» — por el INVENTARIO, a una pregunta conceptual. Acertaba, y no
      // sabía por qué: nunca había mirado el corpus. P25 en su forma más pura.
      //
      // Ahora se mira, y si tampoco hay nada se dice ENTERO —«ni ficha ni SKU»—
      // en vez de nombrar sólo la mitad que se consultó.
      // ────────────────────────────────────────────────────────
      const porTexto = await relevoDocumental(db, ctx, termino);
      if (porTexto) return porTexto;

      return noSe(nadaDeNada(termino));
    }
    // ========================================================
    // [INV-B11] O6 · LAS CUATRO CONCEPTUALES.
    //
    // Ninguna necesita SKU y ninguna re-deriva nada: todas consumen funciones
    // que ya existían. Ése era el punto de que faltaran — no faltaba capacidad,
    // faltaba la PUERTA.
    // ========================================================
    case 'capacidades':
      // La única que no toca la base. `tarjetaCapacidades()` lee el catálogo de
      // intenciones, que es el mismo del que salen el zero-state y la
      // enumeración del «no sé».
      return { tipo: 'tarjeta', tarjeta: tarjetaCapacidades() };

    case 'destacado_hoy': {
      // `construirCampana` es la MISMA función que alimenta la campana del
      // portal, con la misma `derivarAvisos()` detrás. Escribir aquí una
      // segunda derivación habría creado dos verdades sobre lo mismo — el
      // defecto que este repo ya tuvo cuatro veces con `piezas_en_camino`.
      //
      // `esAdmin: false` a propósito: la línea de fuentes calladas es de la
      // campana de admin y no tiene nada que hacer en una respuesta de chat.
      const c = await construirCampana(db, { esAdmin: false, ahora: new Date() });
      return { tipo: 'tarjeta', tarjeta: tarjetaDestacado(c.avisos, c.seguidos, cuandoStock) };
    }

    case 'mis_proyectos': {
      // ────────────────────────────────────────────────────
      // LA PRIMERA QUE CRUZA LA REGLA DEL INDIVIDUALISMO.
      //
      // Las otras diez leen inventario compartido. Ésta lee `proyectos`, que
      // está acotado por `perfil_id` — y **el acotado no se escribe aquí**: lo
      // hace la RLS sobre `db`, que es el cliente de la SESIÓN
      // (`createSupabaseSessionClient()` en el route handler del chat).
      //
      // Es deliberado no pasar un `perfil_id` por parámetro: sería una segunda
      // barrera capaz de divergir de la primera, y ante una divergencia la que
      // manda es la de la base. Lo que sí hace falta es DEMOSTRARLO contra dos
      // sesiones de verdad (prueba de integración contra una base local).
      // ────────────────────────────────────────────────────
      const proyectos = await listarProyectos(db);
      return { tipo: 'tarjeta', tarjeta: tarjetaMisProyectos(proyectos) };
    }

    case 'snapshots_recientes': {
      const r = await listSnapshots(db, { page: 1, pageSize: 10 } as never);
      return {
        tipo: 'tarjeta',
        tarjeta: tarjetaSnapshots(r.items, {
          stock: r.vigentes.stock?.created_at ?? null,
          aduana: r.vigentes.aduana?.created_at ?? null,
        }),
      };
    }

    default:
      return noSe(NO_SE);
  }
}
