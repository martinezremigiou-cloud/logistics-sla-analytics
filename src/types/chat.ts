// ============================================================
// [INV-B10] types/chat.ts — el DTO que cruza la red.
//
// Vive aquí y no dentro del servicio por la lección que costó un bug en
// INV-B8.2: `ProyectosResponse` estaba declarada como interface LOCAL dentro de
// `proyectos-view.tsx`, así que el segundo consumidor de la misma ruta no tuvo
// nada que importar y **se inventó la forma** — un arreglo pelón sobre un
// endpoint que envuelve. `tsc` salió limpio (el genérico de `useApi<T>` es una
// AFIRMACIÓN, no una comprobación) y reventó en el navegador.
//
// Aquí hay una razón más, y es dura: `chat.service.ts` importa `SupabaseClient`
// y media docena de servicios. Si la burbuja importara el tipo de ahí,
// arrastraría código de servidor a un componente cliente. El tipo tiene que
// vivir en un sitio que las dos mitades puedan tocar sin traerse la otra.
// ============================================================
import type { Intencion } from '@/lib/chat/intenciones';
import type { Tarjeta } from '@/lib/chat/tarjeta';
import type { AreaEscalada } from '@/lib/contactos';

export type { Intencion, Tarjeta };

/** Un SKU que podría ser el que el usuario quería. Nunca se elige por él. */
export interface Candidato {
  sku: string;
  descripcion: string;
}

/**
 * Por qué hace falta aclarar. Los tres significan cosas distintas y la interfaz
 * los pinta distinto: pedir un dato que falta no es lo mismo que decir que no
 * existe, ni que ofrecer entre varios.
 */
export type MotivoAclarar = 'falta_sku' | 'sin_coincidencias' | 'ambiguo';

export type RespuestaChat =
  | { tipo: 'tarjeta'; tarjeta: Tarjeta }
  /**
   * **El usuario nombró un SKU sin preguntar nada.** `KL2722` a secas.
   *
   * Existe por un defecto que se encontró en la QA visual: escribir un SKU
   * pelado contestaba «no sé contestar eso», **con el marcador de posición del
   * campo diciendo “Pregunta por un SKU…”**. La interfaz instruía a hacer justo
   * lo que fallaba.
   *
   * No se adivina qué quería saber —eso sería exactamente lo que el bloque
   * prohíbe— sino que se le pregunta, con las intenciones como botones. Y esos
   * botones **no llaman al modelo**: van por el mismo atajo que las
   * sugerencias, así que la respuesta es instantánea.
   *
   * La lista de opciones NO viaja en el DTO: la interfaz la deriva del catálogo,
   * por el mismo motivo que las sugerencias viven dentro de la intención — una
   * opción huérfana sería irrepresentable.
   */
  | { tipo: 'elegir_intencion'; mensaje: string; sku: string }
  /**
   * [INV-B11] O4/O5 · **No hay ficha que enseñar, y se dice DE QUIÉN es el hueco.**
   *
   * No es un `no_se`: el sistema entendió perfectamente la pregunta. Y no es un
   * `aclarar`: no hay nada que aclarar. Lo que hay es una ausencia, y **las
   * ausencias tienen dueño**:
   *
   *   corpus no cargado · consulta caída · puente colgante   →  NUESTRO
   *   SKU sin familia · familia sin ficha confirmada         →  del catálogo
   *
   * `causaNuestra` viaja como DATO y no como matiz de redacción, y eso salió de
   * un sabotaje: la prueba que exigía «mensajes distintos» comparaba cadenas, y
   * cambiar el texto de un fallo nuestro por el de un hecho del catálogo la
   * pasaba sin ruido. Un texto se reescribe; un booleano no deriva.
   */
  | {
      tipo: 'sin_documentacion';
      mensaje: string;
      causaNuestra: boolean;
      /**
       * [INV-B11] O6-adenda · **A quién escribirle**, resuelto en el servidor
       * desde el estado exacto de O4.
       *
       * Viaja el ÁREA y no el contacto entero, por lo mismo que viaja
       * `causaNuestra` y no un adjetivo: si el correo de alguien cambiara,
       * habría que cambiarlo en `contactos.ts` **y** en cualquier respuesta que
       * ya llevara la copia. El área es una clave; el contacto lo resuelve
       * quien pinta.
       *
       * `null` no debería ocurrir aquí —todo estado que no es `ficha` tiene
       * destino— pero el tipo lo admite porque `DESTINO` sí admite `null`, y
       * mentir en el tipo para ahorrarse una rama es cómo se cuelan los
       * `undefined` a la pantalla.
       */
      escalada: AreaEscalada | null;
    }
  | { tipo: 'no_se'; mensaje: string; sabeHacer: string[] }
  /**
   * [CHAT-B2] **Una cortesía, no un fallo.**
   *
   * Tiene forma propia y no reusa `no_se` porque `no_se` pinta «Esto sí sé
   * hacerlo:» y la lista de once capacidades **sin condición**. Un saludo
   * contestado con esa lista es el defecto que el QA manual encontró: la ayuda
   * repetida en cada tropiezo deja de ser ayuda y pasa a ser ruido.
   *
   * Un `sabeHacer: []` habría dejado el rótulo colgando sobre una lista vacía —
   * verde en las pruebas, roto en pantalla.
   */
  | { tipo: 'social'; mensaje: string }
  /**
   * [CHAT-B3] **Lo que el Asistente sabe de sí mismo**, con cifras consultadas.
   *
   * Variante propia y no `social` porque no son lo mismo: una cortesía no lleva
   * datos y ésta sí —«N fichas de M marcas»— y el día que alguien quiera
   * pintarlas distinto (un contador, un enlace al catálogo) necesita poder
   * distinguirlas sin adivinar por el texto.
   *
   * Y no es `tarjeta` a propósito: el gate exige que «¿qué puedes hacer?» y
   * «¿sabes de fichas técnicas?» NO devuelvan el mismo cuerpo, y devolver una
   * tarjeta con lista sería volver al cajón por otra puerta.
   */
  | { tipo: 'sobre_mi'; mensaje: string }
  | {
      tipo: 'aclarar';
      motivo: MotivoAclarar;
      mensaje: string;
      candidatos: Candidato[];
      /**
       * La intención que quedó pendiente.
       *
       * **Es lo que permite que elegir un candidato NO vuelva a pasar por el
       * modelo:** la interfaz reenvía `{intencion, sku}` por el mismo atajo que
       * usan las sugerencias. Sin este campo, escoger de una lista de 14
       * costaría otra clasificación y otros 3,6 s por una decisión que el
       * usuario ya tomó.
       */
      intencion: Intencion;
    };
