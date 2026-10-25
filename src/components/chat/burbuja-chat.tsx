"use client";

// ============================================================
// [INV-B10] burbuja-chat.tsx — el asistente, flotando abajo a la derecha.
//
// VIVE EN EL LAYOUT DE `(app)`, que es el único nivel que NO se remonta al
// navegar. Por eso la conversación sobrevive a moverse entre el catálogo y una
// ficha sin necesitar un provider: el estado vive aquí y el componente no se
// desmonta. Es el mismo asiento que usan la Selección y el seguimiento, por el
// mismo motivo.
//
// ────────────────────────────────────────────────────────────
// LA CONVERSACIÓN **NO** SE PERSISTE. Decisión de producto, con dos razones:
//
//   · Guardarla en la base la convertiría en **dato originado por el usuario**:
//     tabla, RLS, y empeora B8-10 (sin respaldo) con texto libre que va a
//     contener nombres de clientes.
//   · Y `localStorage` no sirve como atajo, aunque lo parezca: es **por
//     navegador, no por cuenta**. En una máquina compartida un KAM vería la
//     conversación de otro. La Selección tolera eso porque solo lleva SKUs;
//     una conversación lleva lo que la persona escribió.
//
// Memoria de pestaña. Se pierde al recargar y está bien que se pierda.
//
// ────────────────────────────────────────────────────────────
// SIN STREAMING, y es coherente y no una omisión.
//
// El brief lo pedía suponiendo prosa generada. Con la tarjeta renderizada por
// el servidor, **transmitirla sería teatro**: animar la aparición de algo que
// ya está listo. Lo que sí hace falta es el «pensando…», porque el modelo tarda
// 1,6-3,7 s medidos. Y en el camino corto —un clic en una sugerencia o en un
// candidato— no hay modelo, así que la tarjeta aparece de inmediato.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import type { Referente } from "@/lib/chat/referente";
import type { Turno } from "@/lib/chat/hilo";
import { MessageSquare, X, RotateCcw, Send, AlertTriangle, HelpCircle } from "lucide-react";
import { sugerencias, INTENCIONES, preguntaSobreSku } from "@/lib/chat/intenciones";
import { MAX_PREGUNTA } from "@/lib/chat/topes";
import { preguntar, pedirIntencion, type FalloDelChat } from "./chat-api";
import { EscaladaChat } from "./escalada-chat";
import { SaludoContextual } from "./saludo-contextual";
import { NOMBRE, SALUDO_PANEL, ZERO_STATE, MARCADOR_ENTRADA } from "@/lib/chat/voz";
import { TarjetaChat } from "./tarjeta-chat";
import { cn } from "@/lib/utils";
import type { Intencion, RespuestaChat } from "@/types/chat";

export type Mensaje =
  | { rol: "usuario"; texto: string }
  | { rol: "asistente"; respuesta: RespuestaChat }
  | { rol: "fallo"; fallo: FalloDelChat };

const SUGERENCIAS = sugerencias();

/**
 * Estado SEMBRADO, solo para la EVIDENCIA VISUAL y las pruebas.
 *
 * La página de evidencia se renderiza con `renderToStaticMarkup`, que **no
 * corre ningún `useEffect` ni ningún manejador**: sin esto, la burbuja saldría
 * siempre cerrada y la evidencia mostraría un botón seis veces en vez de las
 * seis pantallas que hay que juzgar.
 *
 * Es el mismo asiento que `SeguimientoFijo` en INV-B9.1, y con la misma regla:
 * **no es superficie de producción.** El layout de `(app)` monta
 * `<BurbujaChat />` sin props, y la prueba de alcanzabilidad lo asevera leyendo
 * el árbol — así que si alguien empezara a pasar `inicial` en producción, esa
 * prueba se rompe.
 */
export interface EstadoSembrado {
  abierta?: boolean;
  mensajes?: Mensaje[];
  pensando?: boolean;
  /**
   * [INV-B11] O6-adenda · el saludo, sembrado.
   *
   * `true` lo pinta y `false` lo apaga. **`undefined` deja decidir al efecto**,
   * que es lo que pasa en produccion — y por eso son tres valores y no un
   * booleano: sembrar `false` y "no sembrar" tienen que poder distinguirse, o
   * la evidencia del estado descartado seria indistinguible del estado normal.
   */
  saludo?: boolean;
}

export function BurbujaChat({ inicial }: { inicial?: EstadoSembrado } = {}) {
  const [abierta, setAbierta] = useState(inicial?.abierta ?? false);
  const [mensajes, setMensajes] = useState<Mensaje[]>(inicial?.mensajes ?? []);
  const [texto, setTexto] = useState("");
  /**
   * [CHAT-B2] EL SUJETO VIVO DE LA CONVERSACIÓN.
   *
   * Lo produce el SERVIDOR al resolver cada turno y aquí sólo se guarda. No se
   * deriva del texto pintado: sería una segunda opinión sobre qué se resolvió.
   * Se limpia con la conversación — «Limpiar» tiene que limpiar de verdad.
   */
  const [referente, setReferente] = useState<Referente | null>(null);
  const [pensando, setPensando] = useState(inicial?.pensando ?? false);
  const finRef = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  // El último mensaje siempre a la vista: una respuesta que aparece fuera del
  // scroll se lee como que no pasó nada.
  useEffect(() => {
    if (abierta) finRef.current?.scrollIntoView({ block: "end" });
  }, [mensajes, pensando, abierta]);

  useEffect(() => {
    if (abierta) entradaRef.current?.focus();
  }, [abierta]);

  const enviar = useCallback(
    async (etiqueta: string, ejecutar: () => Promise<Awaited<ReturnType<typeof preguntar>>>) => {
      if (pensando) return;
      setMensajes((m) => [...m, { rol: "usuario", texto: etiqueta }]);
      setTexto("");
      setPensando(true);
      try {
        const r = await ejecutar();
        setMensajes((m) => [
          ...m,
          r.ok ? { rol: "asistente", respuesta: r.respuesta } : { rol: "fallo", fallo: r.fallo },
        ]);
        // [CHAT-B2] Sólo se PISA cuando el turno resolvió un sujeto nuevo. Un
        // turno que no resuelve nada —un «no sé», un fallo— NO borra de qué
        // veníamos hablando: perder el hilo por una pregunta mal entendida es
        // exactamente el defecto que este bloque arregla.
        if (r.ok && r.referente) setReferente(r.referente);
      } finally {
        setPensando(false);
      }
    },
    [pensando],
  );

  /**
   * [CHAT-B2] El hilo que viaja, armado de lo que YA se pintó.
   *
   * Sólo texto: de una respuesta se manda su prosa o su mensaje, nunca la
   * tarjeta entera — el modelo no necesita las cifras de inventario y
   * mandárselas cruzaría el perímetro por la puerta de atrás.
   */
  const hiloDeLaConversacion = (): Turno[] =>
    mensajes.flatMap((m): Turno[] => {
      if (m.rol === "usuario") return [{ quien: "usuario", texto: m.texto }];
      if (m.rol === "asistente") {
        const r = m.respuesta;
        const t =
          r.tipo === "tarjeta"
            ? (r.tarjeta.respuesta?.frases.join(" ") ?? r.tarjeta.titulo)
            : "mensaje" in r
              ? String(r.mensaje)
              : "";
        return t ? [{ quien: "asistente", texto: t }] : [];
      }
      return [];
    });

  const enviarTexto = () => {
    const q = texto.trim();
    if (!q) return;
    void enviar(q, () => preguntar(q, { hilo: hiloDeLaConversacion(), referente }));
  };

  /** Un clic en una sugerencia o en un candidato: no pasa por el modelo. */
  const enviarIntencion = (intencion: Intencion, etiqueta: string, params: { sku?: string | null; termino?: string | null }) =>
    void enviar(etiqueta, () => pedirIntencion(intencion, params, { referente }));

  if (!abierta) {
    return (
      // ============================================================
      // [2.0.1-A] LA ZONA DEL ASISTENTE ES UN SOLO CONTENEDOR, y ocupa UN piso
      // del carril (`carril.ts`). Antes eran dos hermanos sueltos con anclajes
      // propios —el botón en `bottom-5`, el saludo en `bottom-20`— y ese 20
      // era la resta «h-12 + bottom-5» hecha a mano: en cuanto el botón subió
      // de piso, el saludo se quedó donde estaba. Apilados aquí, el piso del
      // saludo ES el techo del botón por construcción, no por aritmética que
      // alguien tenga que rehacer.
      //
      // `pointer-events-none` en el contenedor con `auto` en los hijos: si no,
      // la caja de este apilamiento —tan ancha como el saludo— interceptaría
      // taps sobre lo que hay debajo sin pintar nada. Es literalmente el
      // defecto H4 en su forma más tonta.
      //
      // El anclaje vertical sale del carril; el horizontal sigue siendo el de
      // O6 (`right-`), que `flotantes.test.ts` vigila.
      // ============================================================
      <div className="pointer-events-none fixed bottom-[var(--mx-carril-asistente)] right-5 z-40 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
        {/* [INV-B11] O6-adenda · EL SALUDO SOLO EXISTE CON EL CHAT CERRADO: si
            estás hablando con él, saludarte otra vez es ruido. */}
        <SaludoContextual inicialVisible={inicial?.saludo} onAbrirChat={() => setAbierta(true)} />
        <button
          type="button"
          onClick={() => setAbierta(true)}
          aria-label="Abrir el asistente"
          data-carril-piso="asistente"
          className="pointer-events-auto inline-flex h-12 w-12 items-center justify-center rounded-full border border-brand bg-brand text-white shadow-lg outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <MessageSquare className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Asistente"
      // `inset-x-3` en móvil y ancho fijo desde `sm`: en 390 px un panel de 380
      // se sale de la pantalla.
      //
      // [2.0.1-A] El desplegado tampoco escribe su propio número: se para en el
      // piso del asistente (antes `bottom-3`, que se metía en la banda de la
      // navegación). Regla 4 del carril: un desplegado no se apila, ocupa el
      // carril desde su piso hacia arriba — y si llega a cubrir la Selección,
      // es la excepción MODAL que O6 ya declaró (tapar es recuperable; cerrar
      // el trabajo del usuario, no).
      //
      // EL ANCLAJE VERTICAL SUELTA EL CARRIL EN `md`, NO EN `sm`, y la
      // diferencia no es de gusto: **el suelo del carril lo pone `BottomNav`, y
      // `BottomNav` se esconde en `md:hidden`.** Con `sm:bottom-6` este panel
      // bajaba a 24 px del borde en toda la banda [640, 768), donde el nav
      // sigue vivo y mide 56: 32 px de traslape sobre 3 de sus 5 ítems. Es el
      // MISMO defecto H1 —una superficie sentada en el pie de otra—, colado por
      // el único `sm:` vertical que quedaba en el archivo mientras el estado
      // cerrado ya usaba `md:`. El horizontal (`sm:inset-x-auto`, `sm:right-6`,
      // `sm:w-[380px]`) sí es de `sm`: a 640 px caben 380 de panel de sobra, y
      // ese eje no comparte piso con nadie.
      //
      // Y el instrumento no podía verlo: `ANCHOS` medía 390 y 768, nunca un
      // punto DENTRO de la banda. Por eso este bloque añade el 640 (ver
      // `escenarios.ts`) — un defecto que solo vive entre dos anchos medidos es
      // invisible para un gate que solo mide esos dos.
      className="fixed inset-x-3 bottom-[var(--mx-carril-asistente)] z-40 flex max-h-[78vh] flex-col overflow-hidden rounded-2xl border border-line bg-surface-input shadow-2xl sm:inset-x-auto sm:right-6 sm:w-[380px] md:bottom-6"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink">{NOMBRE}</div>
          <div className="truncate text-[11px] text-ink-muted">Inventario en vivo</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {mensajes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMensajes([]);
                setReferente(null);
              }}
              aria-label="Empezar de nuevo"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setAbierta(false)}
            aria-label="Cerrar el asistente"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-muted outline-none hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-3">
        {/* ZERO-STATE. Un chat vacío con un cursor no le dice a nadie qué hacer.
            Y las sugerencias salen DEL CATÁLOGO: una que el sistema no supiera
            contestar es irrepresentable, no hay dónde escribirla. */}
        {mensajes.length === 0 && (
          <div className="flex flex-col gap-2">
            {/* [INV-B11] O6 · EL SALUDO DE APERTURA, copy FIJO y no generado.
                Se pinta como una burbuja del asistente y no como un párrafo
                suelto: es lo primero que dice el Asistente, y tiene que verse como algo
                que dijo él. El texto sale de `voz.ts` — una sola fuente. */}
            <div className="max-w-[92%] self-start rounded-2xl rounded-bl-md border border-line bg-surface px-3 py-2 text-[12.5px] leading-snug text-ink">
              {SALUDO_PANEL}
            </div>
            <p className="text-[12.5px] leading-snug text-ink-2">{ZERO_STATE}</p>
            {SUGERENCIAS.map((s) => (
              <button
                key={s.intencion}
                type="button"
                onClick={() => enviarIntencion(s.intencion, s.texto, { sku: s.sku, termino: s.termino })}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-left text-[12.5px] text-ink-2 outline-none transition-colors hover:border-brand hover:bg-brand-50 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
              >
                {s.texto}
              </button>
            ))}
          </div>
        )}

        {mensajes.map((m, i) => (
          <div key={i} className={cn("flex", m.rol === "usuario" ? "justify-end" : "justify-start")}>
            {m.rol === "usuario" && (
              <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-[12.5px] leading-snug text-white">
                {m.texto}
              </div>
            )}

            {m.rol === "asistente" && <RespuestaPintada respuesta={m.respuesta} onElegir={enviarIntencion} />}

            {/* UN FALLO NO SE PINTA COMO UN «NO SÉ». Lleva su propio color y su
                propio icono: el sistema no dejó de entender, no pudo consultar. */}
            {m.rol === "fallo" && (
              <div className="max-w-[92%] rounded-xl border border-warn/40 bg-warn-bg px-3 py-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
                  <div>
                    <p className="text-[12.5px] leading-snug text-warn">{m.fallo.mensaje}</p>
                    {m.fallo.reintentable && (
                      <p className="mt-0.5 text-[11px] text-ink-muted">No es que no entendiera: no pude consultar.</p>
                    )}
                    {/* Si el intento gastó una pregunta del techo, se dice. El
                        techo se cobra ANTES de llamar al modelo, así que un
                        fallo del proveedor sí consume — y descubrirlo solo,
                        cuando topas antes de tiempo, sería peor. */}
                    {m.fallo.consumioCuota && (
                      <p className="mt-0.5 text-[11px] text-ink-muted">Contó para tu límite de preguntas.</p>
                    )}
                    {/* La interfaz OBEDECE al dato y no tiene su propia regla:
                        el caso que la produjo ya decidió si escalar. Un techo
                        alcanzado no manda a nadie a escribir un correo. */}
                    {m.fallo.escalada && <EscaladaChat area={m.fallo.escalada} tono="aviso" />}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {pensando && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-muted">
              Pensando…
            </div>
          </div>
        )}

        <div ref={finRef} />
      </div>

      <form
        className="flex shrink-0 items-center gap-2 border-t border-line bg-surface px-3 py-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          enviarTexto();
        }}
      >
        <label htmlFor="chat-entrada" className="sr-only">
          Escribe tu pregunta
        </label>
        <input
          id="chat-entrada"
          ref={entradaRef}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={MAX_PREGUNTA}
          placeholder={MARCADOR_ENTRADA}
          disabled={pensando}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-input px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pensando || texto.trim() === ""}
          aria-label="Enviar la pregunta"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

function RespuestaPintada({
  respuesta,
  onElegir,
}: {
  respuesta: RespuestaChat;
  onElegir: (i: Intencion, etiqueta: string, p: { sku?: string | null; termino?: string | null }) => void;
}) {
  if (respuesta.tipo === "tarjeta") {
    return (
      <div className="w-full max-w-[92%]">
        <TarjetaChat tarjeta={respuesta.tarjeta} />
      </div>
    );
  }

  // ============================================================
  // EL «NO SÉ» ENUMERA. Decir «no sé» a secas deja al usuario adivinando contra
  // un catálogo cerrado, que es la peor manera de descubrirlo. La lista sale de
  // la misma fuente que las sugerencias.
  // ============================================================
  // ============================================================
  // [CHAT-B2] UNA CORTESÍA. Una línea y nada más.
  //
  // Sin icono de ayuda, sin lista de capacidades y sin borde de alerta: no pasó
  // nada. La lista completa sale donde `ZERO_STATE` manda —al abrir el panel y
  // cuando se pide— y no en cada tropiezo, que es como una ayuda se convierte
  // en ruido.
  // ============================================================
  // [CHAT-B3] `sobre_mi` comparte la forma de `social` —una frase, sin lista—
  // aunque sean variantes distintas: lo que cambia es de qué habla, no cómo se ve.
  if (respuesta.tipo === "social" || respuesta.tipo === "sobre_mi") {
    return (
      <div className="max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-3">
        <p className="text-[12.5px] leading-snug text-ink">{respuesta.mensaje}</p>
      </div>
    );
  }

  if (respuesta.tipo === "no_se") {
    return (
      <div className="max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-3">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold leading-snug text-ink">{respuesta.mensaje}</p>
            <p className="mt-1.5 text-[11.5px] text-ink-muted">{ZERO_STATE}</p>
            <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
              {respuesta.sabeHacer.map((s) => (
                <li key={s} className="text-[11.5px] leading-snug text-ink-2">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // NOMBRÓ UN SKU SIN PREGUNTAR NADA. No se le niega: se le pregunta, con las
  // intenciones que aplican a un SKU como botones.
  //
  // La lista NO viene en la respuesta: se deriva del catálogo, por el mismo
  // motivo que las sugerencias viven dentro de la intención — una opción
  // huérfana es irrepresentable. Y el clic **no llama al modelo**.
  // ============================================================
  if (respuesta.tipo === "elegir_intencion") {
    return (
      <div className="max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-3">
        <p className="text-[12.5px] leading-snug text-ink">{respuesta.mensaje}</p>
        <div className="mt-2 flex flex-col gap-1">
          {INTENCIONES.filter((i) => i.requiereSku).map((i) => {
            // `descripcion` NO sirve de etiqueta aquí: dice «un SKU» justo debajo
            // de un renglón que acaba de nombrarlo. Y el botón muestra
            // **exactamente** el texto que va a quedar en la conversación,
            // porque es la misma cadena y no dos versiones de ella.
            const pregunta = preguntaSobreSku(i, respuesta.sku);
            if (pregunta === null) return null;
            return (
              <button
                key={i.id}
                type="button"
                onClick={() => onElegir(i.id, pregunta, { sku: respuesta.sku })}
                className="rounded-md border border-line px-2.5 py-1.5 text-left text-[12px] text-ink-2 outline-none transition-colors hover:border-brand hover:bg-brand-50 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
              >
                {pregunta}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ============================================================
  // [INV-B11] NO HAY FICHA — y la pinta DICE DE QUIÉN ES EL HUECO.
  //
  // Los dos casos usan el mismo componente y **distinta piel**, porque son
  // distintas cosas:
  //
  //   causaNuestra  →  color de aviso, como el fallo de transporte. Es un
  //                    pendiente NUESTRO y el usuario no tiene nada que hacer
  //                    salvo saberlo.
  //   del catálogo  →  neutro. El sistema funcionó y la respuesta es que no hay.
  //
  // Pintarlos igual habría desperdiciado O4 entero en la última capa: toda la
  // distinción se construyó para que **una falla nuestra no se lea como un
  // hecho sobre su producto**, y el color es donde eso se ve.
  //
  // Y no se enumera «esto sí sé hacerlo»: el sistema SÍ sabía hacerlo. Ofrecer
  // la lista aquí diría lo contrario.
  // ============================================================
  if (respuesta.tipo === "sin_documentacion") {
    // [INV-B11] O6-adenda · Y AQUÍ VA EL CONTACTO. Es el sitio donde el
    // invariante de producto se cobra: la persona está mirando la pregunta que se
    // quedó sin respuesta, y el destino ya lo resolvió el servidor desde el
    // estado exacto. `mensajeDe('puente_colgante')` decía «avisa» desde que se
    // escribió, sin decir a quién.
    return respuesta.causaNuestra ? (
      <div className="max-w-[92%] rounded-xl border border-warn/40 bg-warn-bg px-3 py-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[12.5px] leading-snug text-warn">{respuesta.mensaje}</p>
            {respuesta.escalada && <EscaladaChat area={respuesta.escalada} tono="aviso" />}
          </div>
        </div>
      </div>
    ) : (
      <div className="max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-3">
        <p className="text-[12.5px] leading-snug text-ink">{respuesta.mensaje}</p>
        {respuesta.escalada && <EscaladaChat area={respuesta.escalada} />}
      </div>
    );
  }

  // ============================================================
  // ACLARAR. Los candidatos son BOTONES, y elegir uno **no vuelve a pasar por
  // el modelo**: la respuesta trae la intención pendiente, así que el clic va
  // por el mismo atajo que las sugerencias. Sin eso, escoger de una lista de 14
  // costaría otra clasificación y otros 3,6 s por una decisión ya tomada.
  // ============================================================
  return (
    <div className="max-w-[92%] rounded-xl border border-line bg-surface px-3.5 py-3">
      <p className="text-[12.5px] leading-snug text-ink">{respuesta.mensaje}</p>
      {respuesta.candidatos.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {respuesta.candidatos.map((c) => (
            <button
              key={c.sku}
              type="button"
              onClick={() => onElegir(respuesta.intencion, c.sku, { sku: c.sku })}
              className="min-w-0 rounded-md border border-line px-2.5 py-1.5 text-left outline-none transition-colors hover:border-brand hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand"
            >
              <div className="truncate font-mono text-[12px] font-semibold text-ink">{c.sku}</div>
              {c.descripcion && <div className="truncate text-[11px] text-ink-muted">{c.descripcion}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
