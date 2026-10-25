"use client";

// ============================================================
// [INV-B8.2] panel-seleccion.tsx — el panel flotante, SIN contexto.
//
// POR QUÉ ESTÁ PARTIDO EN DOS. Este archivo no sabe qué es un `localStorage`
// ni qué es la sesión: recibe `items` y devuelve eventos. El cableado vive en
// `seleccion-flotante.tsx`. La razón no es purismo: **la evidencia visual se
// renderiza con `renderToStaticMarkup`, que no corre `useEffect`** — un panel
// que leyera el contexto se pintaría siempre vacío en la evidencia y se
// estaría mirando un componente que no es el que ve el usuario. Partirlo es lo
// que permite que la evidencia muestre el panel CON tres renglones dentro.
//
// EL BOTÓN «VOLCAR» ES OPCIONAL EN EL CONTRATO (`onVolcar?`), y no por
// flexibilidad: llegó DESPUÉS. Mientras el volcado no existía, el panel se
// entregó sin él —pintar un control que promete una acción que no ocurre es el
// patrón P7 del repo—. Que siga siendo opcional es lo que permite montar el
// panel en la evidencia visual y en los tests sin arrastrar el diálogo entero.
// ============================================================
import { useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus, Send, Trash2, X } from "lucide-react";
import { formatoNumero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ItemSeleccion } from "@/lib/seleccion";

export interface PanelSeleccionProps {
  items: ItemSeleccion[];
  abierto: boolean;
  onAlternarAbierto: () => void;
  onFijarCantidad: (sku: string, cantidad: number) => void;
  onQuitar: (sku: string) => void;
  onVaciar: () => void;
  /** Abre el diálogo de volcado. Ausente → no se pinta el botón (ver la cabecera). */
  onVolcar?: () => void;
  /** Dónde se para. Ver `ANCLAJES` y la regla espacial de O6. */
  anclaje?: AnclajeSeleccion;
}

/**
 * [2.0.1-A] UN ANCLAJE = UN PUNTO DE RENDER = UN id.
 *
 * Antes era una constante única, y como el panel se pinta en DOS sitios (el pie
 * del riel y el punto flotante, ver `ANCLAJES`), el DOM acababa con **dos nodos
 * con el mismo id** — HTML inválido, `getElementById` devolviendo el que le da
 * la gana, y el `aria-controls` de las dos píldoras apuntando al mismo sitio
 * ambiguo. Medido: `document.querySelectorAll('#panel-seleccion').length === 2`
 * con la Selección viva en escritorio.
 *
 * Es un `Record<AnclajeSeleccion, string>` con la misma forma que `ANCLAJES` a
 * propósito: un anclaje nuevo sin su id **no compila**, en vez de nacer
 * compartiendo el de otro.
 */
export const ID_PANEL: Record<AnclajeSeleccion, string> = {
  flotante: "panel-seleccion-flotante",
  sidebar: "panel-seleccion-riel",
};

/**
 * [INV-B11] O6 · DÓNDE SE PARA, y por qué a la IZQUIERDA.
 *
 * > **Izquierda es lo tuyo. Derecha es el asistente.**
 *
 * Se reportó que la burbuja del chat tapaba este panel. Los dos anclaban a
 * `bottom-6 right-6`; el chat va en `z-40` y esto en `z-30`, así que el chat
 * tapaba **justo la esquina donde este panel pone sus acciones**. Y en móvil
 * era peor: los dos eran `inset-x-3`, o sea que se tapaban ENTEROS.
 *
 * Con la regla espacial la colisión no se resuelve: **se vuelve
 * irrepresentable**, en todo ancho y en todo estado. Y por eso hay dos anclajes
 * y no una lista de casos — el pie del sidebar ES el borde izquierdo:
 *
 *   `sidebar`   ≥768 y expandido  → EN FLUJO, sin `fixed` y sin `z`
 *   `flotante`  ≥768 colapsado    → `left-6 bottom-6`
 *               <768             → `left-3`, encima de `BottomNav`
 *
 * **La excepción declarada:** a 390 px el chat abierto ocupa el ancho entero y
 * no hay reparto espacial posible. Ahí es una superficie MODAL —como el sidebar,
 * que en ese ancho ya es un `Sheet`— y este panel queda debajo **sin cerrarse**,
 * volviendo al cerrar el chat. Decisión de producto: cerrar el panel tocaría estado
 * que el usuario construyó a mano, y verlo desaparecer se lee como «se perdió».
 *
 * `z-30` sigue por debajo de `BottomNav` (`z-40`) y de los diálogos (`z-50`):
 * si esto creciera de más, **la barra de navegación gana**, que es el orden
 * correcto para equivocarse.
 */
export type AnclajeSeleccion = "flotante" | "sidebar";

export const ANCLAJES: Record<AnclajeSeleccion, string> = {
  // [2.0.1-A] El anclaje vertical sale del CARRIL (`carril.ts`), no de una
  // resta escrita aquí. Antes decía `calc(3.5rem+env+0.75rem)`: los 3.5rem eran
  // una suposición sobre el alto de una barra que vive en otro archivo y que
  // **medía 54 px, no 56**. Ahora la barra declara su alto y este piso se
  // calcula solo; el horizontal (`md:left-6`) sigue siendo territorio de O6.
  flotante:
    "fixed inset-x-3 bottom-[var(--mx-carril-seleccion)] z-30 md:inset-x-auto md:bottom-6 md:left-6 md:w-[360px]",
  // Ni `fixed` ni `z`: aquí el panel es parte del sidebar, no algo que flota
  // encima de él. `mt-3` lo separa de la navegación; el separador de abajo lo
  // pone el bloque de usuario, que YA tiene `border-t` — dos seguidos serían
  // una raya de más.
  //
  // `max-h-[40vh]` dice la regla del riel: **la navegación es lo primero y la
  // Selección es un huésped**. Sin tope, medido con 15 SKU, el `<ul>` llegaba a
  // `46vh` y el `<nav>` —que es `min-h-0 flex-1`— cedía TODO su espacio: quedó
  // en **0 px** necesitando 327.
  //
  // Y EL TOPE VA EN `vh`, NO EN `%`, por algo medido y no supuesto. La primera
  // versión decía `max-h-[40%]` con el argumento de que «se resuelve contra el
  // `h-full` del riel». No: se resuelve contra el PADRE INMEDIATO, que es el
  // envoltorio que monta `SeleccionFlotante` — y ese envoltorio computaba
  // **1 160 px** en un riel de 550, porque un ítem de flex sin `min-h-0` no
  // baja de su contenido. El 40 % se aplicó… contra 1 160. El panel quedó en
  // 464 px y el `<nav>` en 0 otra vez, con el tope puesto y verde.
  //
  // `vh` no depende de la altura resuelta de nadie. El envoltorio además lleva
  // `min-h-0` (ver `seleccion-flotante.tsx`) para que no pueda volver a
  // inflarse. Con el tope puesto, en una ventana corta el `<nav>` se queda con
  // menos y **hace scroll** —ya es `overflow-y-auto`—; lo que no vuelve a pasar
  // es que se quede sin nada.
  sidebar: "mt-3 w-full max-h-[40vh]",
};

export function PanelSeleccion({
  items,
  abierto,
  onAlternarAbierto,
  onFijarCantidad,
  onQuitar,
  onVaciar,
  onVolcar,
  anclaje = "flotante",
}: PanelSeleccionProps) {
  // Sin nada seleccionado NO hay panel — ni vacío, ni en gris. El elemento
  // flotante solo se gana el espacio cuando tiene algo que decir.
  if (items.length === 0) return null;

  const ANCLAJE = ANCLAJES[anclaje];
  // El riel mide 230 px y el panel 190. Ver `EL RENGLÓN ESTRECHO`, abajo.
  const estrecho = anclaje === "sidebar";

  const piezas = items.reduce((suma, i) => suma + i.cantidad, 0);
  const resumen = `${formatoNumero(items.length)} SKU · ${formatoNumero(piezas)} pz`;

  if (!abierto) {
    // ============================================================
    // [INV-B11] O6-adenda · LA PÍLDORA DEL RIEL VA EN DOS LÍNEAS.
    //
    // Se reportó que «el conteo de SKU y el de piezas se encabalgan», y
    // medido en el navegador es literal: la píldora mide **190×61 px** y el
    // badge `15 SKU · 120 pz` **se parte en dos renglones** — necesita 73 px y
    // le quedan ~64 después de «Selección», el gap y la ✓.
    //
    // Y EL ARREGLO NO PODÍA SER SOLO EL TAMAÑO, aunque eso fue lo que se pidió:
    // un punto menos (11,5 → 10,5) deja el badge en ~67 px contra 64 de hueco.
    // **Seguiría sin caber**, por 3 px, y volvería a partirse el día que un
    // número crezca. Con `MAX_SELECCION = 200` el peor caso es
    // `200 SKU · 12,345 pz`, que a 11,5 px pide ~92.
    //
    // Así que van las dos cosas: **la línea propia** —que le da los 162 px del
    // ancho completo, como al SKU del renglón— y **el punto menos**, que es lo
    // que se pidió y lo que deja margen para el peor caso. `whitespace-nowrap`
    // cierra la puerta: si algún día no cupiera, se sabría por desbordamiento y
    // no por un salto de línea silencioso.
    //
    // No se toca el desplegar ni el panel abierto, tal como se pidió. El resumen
    // de la cabecera se midió aparte y **sí cabe en una línea**: ahí el badge
    // compite solo con la ✕, no con el rótulo entero.
    // ============================================================
    const CHIP = "rounded-full bg-white/20 px-2 py-0.5 font-mono";
    return (
      <div className={cn(ANCLAJE, "flex justify-start")}>
        <button
          type="button"
          onClick={onAlternarAbierto}
          aria-expanded={false}
          aria-controls={ID_PANEL[anclaje]}
          className={cn(
            "border border-brand bg-brand text-[13px] font-semibold text-white shadow-lg outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app",
            estrecho
              ? "flex w-full flex-col items-start gap-1 rounded-2xl px-3.5 py-2 text-left"
              : "inline-flex items-center gap-2 rounded-full px-4 py-2.5",
          )}
        >
          <span className={cn("flex items-center gap-2", estrecho && "w-full justify-between")}>
            Selección
            {!estrecho && <span className={cn(CHIP, "text-[11.5px]")}>{resumen}</span>}
            <ChevronUp className="h-4 w-4 shrink-0" aria-hidden="true" />
          </span>
          {estrecho && <span className={cn(CHIP, "whitespace-nowrap text-[10.5px]")}>{resumen}</span>}
        </button>
      </div>
    );
  }

  return (
    <section
      id={ID_PANEL[anclaje]}
      aria-label="Selección de SKUs"
      className={cn(ANCLAJE, "flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl")}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line-soft px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-ink">Selección</p>
          <p className="font-mono text-[11.5px] leading-tight text-ink-muted">{resumen}</p>
        </div>
        <button
          type="button"
          onClick={onAlternarAbierto}
          aria-expanded
          aria-controls={ID_PANEL[anclaje]}
          aria-label="Contraer la Selección"
          className="shrink-0 rounded-md p-1.5 text-ink-muted outline-none transition-colors hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      {/*
        El alto está topado y el scroll es INTERNO: con 200 SKUs (el tope de
        `MAX_SELECCION`) un panel sin tope cubriría la pantalla entera. En
        móvil el techo es más bajo porque abajo ya está la barra de navegación.

        En el riel el tope NO lo pone la lista: lo pone `max-h-[40vh]` en el
        anclaje y aquí la lista solo toma lo que sobre (`flex-1 min-h-0`). Dos
        topes compitiendo dejaban al `<nav>` sin espacio.
      */}
      <ul
        className={cn(
          "overflow-y-auto",
          estrecho ? "min-h-0 flex-1" : "max-h-[38vh] md:max-h-[46vh]",
        )}
      >
        {items.map((item) => (
          // ============================================================
          // EL RENGLÓN ESTRECHO. En el riel el renglón va en DOS LÍNEAS, y no
          // por estética: medido en el navegador con `KYA2490` —de los cortos—
          // el SKU recibía **27 px** y necesitaba **50**, porque el paso de
          // cantidad se lleva 95 de los 160 px útiles. Con 15 SKU dentro, la
          // barra de scroll robaba otros 13 y la lista entera se leía `A..`,
          // `0..`, `1..`: un panel de SKUs donde no se puede leer ni un SKU.
          //
          // Y no es el caso raro: medido sobre los SKU del snapshot vigente,
          // **más de la mitad** son MÁS largos que el que ya no cabía.
          //
          // Partido en dos líneas el SKU se queda con el ancho completo del
          // renglón (~147 px ≈ 20 caracteres), que cubre a casi todos. Los
          // más largos siguen truncando, y para eso está el `title`.
          // ============================================================
          <li
            key={item.sku}
            className={cn(
              "border-b border-line-soft px-3.5 py-2 last:border-b-0",
              estrecho ? "flex flex-col gap-1.5" : "flex items-center gap-2",
            )}
          >
            <span
              className={cn(
                "truncate font-mono text-[12px] font-semibold text-ink",
                estrecho ? "w-full" : "min-w-0 flex-1",
              )}
              title={item.sku}
            >
              {item.sku}
            </span>
            <div className={cn("flex items-center gap-2", estrecho ? "w-full justify-between" : "shrink-0")}>
              <PasoCantidad
                sku={item.sku}
                cantidad={item.cantidad}
                onFijarCantidad={onFijarCantidad}
              />
              <button
                type="button"
                onClick={() => onQuitar(item.sku)}
                aria-label={`Quitar ${item.sku} de la Selección`}
                className="shrink-0 rounded-md p-1 text-ink-muted outline-none transition-colors hover:bg-danger-bg hover:text-danger focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-between gap-2 border-t border-line-soft px-3.5 py-2.5">
        <button
          type="button"
          onClick={onVaciar}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-ink-muted outline-none transition-colors hover:bg-danger-bg hover:text-danger focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Vaciar
        </button>
        {onVolcar ? (
          <button
            type="button"
            onClick={onVolcar}
            className="inline-flex items-center gap-1.5 rounded-md border border-brand bg-brand px-3 py-1.5 text-[12px] font-semibold text-white outline-none transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Volcar a proyecto
          </button>
        ) : (
          <p className="text-[11.5px] text-ink-muted">Se conserva al navegar</p>
        )}
      </footer>
    </section>
  );
}

/**
 * El paso de cantidad. Tiene estado propio (`borrador`) por una razón concreta:
 * un `<input>` totalmente controlado que empujara cada tecla a la Selección
 * **borraría el renglón en cuanto el usuario limpiara el campo para escribir
 * otro número** — `fijarCantidad(…, 0)` quita, que es lo correcto como
 * semántica pero pésimo como cada-tecla. El borrador se confirma al salir del
 * campo o con Enter; un valor vacío o inválido revierte al que había.
 *
 * Y por eso `−` está deshabilitado en 1 en vez de llegar a 0: quitar un SKU es
 * una decisión, no el final de una cuesta abajo. Para eso está la ✕.
 */
function PasoCantidad({
  sku,
  cantidad,
  onFijarCantidad,
}: {
  sku: string;
  cantidad: number;
  onFijarCantidad: (sku: string, cantidad: number) => void;
}) {
  const [borrador, setBorrador] = useState<string | null>(null);

  function confirmar() {
    if (borrador === null) return;
    const valor = Number.parseInt(borrador, 10);
    if (Number.isFinite(valor) && valor >= 1) onFijarCantidad(sku, valor);
    setBorrador(null);
  }

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        disabled={cantidad <= 1}
        onClick={() => onFijarCantidad(sku, cantidad - 1)}
        aria-label={`Una pieza menos de ${sku}`}
        className="rounded-md border border-line p-1 text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-2"
      >
        <Minus className="h-3 w-3" aria-hidden="true" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={borrador ?? String(cantidad)}
        onChange={(e) => setBorrador(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        aria-label={`Cantidad de ${sku}`}
        className="w-12 rounded-md border border-line bg-surface-input px-1 py-1 text-center font-mono text-[12px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
      />
      <button
        type="button"
        onClick={() => onFijarCantidad(sku, cantidad + 1)}
        aria-label={`Una pieza más de ${sku}`}
        className="rounded-md border border-line p-1 text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  );
}
