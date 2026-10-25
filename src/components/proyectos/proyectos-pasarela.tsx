"use client";

// ============================================================
// [2.0.1-B · S-1] proyectos-pasarela.tsx — el carril horizontal de `/proyectos`
// (≥ 768 px). Bajo `md` no se monta: ahí manda la lista vertical.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ EXISTE, con el número que lo obligó. Medido a 1704 px el 30-ago,
// la rejilla `auto-fill` ponía 5 columnas y dejaba **710 px verticales vacíos = el 57 % del alto útil**
// del `<main>`. Y el defecto EMPEORA hacia arriba, porque `auto-fill` añade
// columnas conforme hay sitio y por tanto consume menos alto cuanto mejor es la
// pantalla.
//
// ────────────────────────────────────────────────────────────
// SIGUE SIENDO UNA LISTA, y eso no es un detalle de implementación.
//
// `<ul>`/`<li>` con `aria-label` en la región. **NO lleva
// `aria-roledescription`** — decisión de producto, por razón y no por omisión: ese
// atributo sustituiría la semántica nativa por una cadena en español. La
// pasarela es un hecho VISUAL; para quien navega con lector de pantalla esto es
// una lista de proyectos, igual que antes, y así se anuncia.
//
// ────────────────────────────────────────────────────────────
// EL PASO SE MIDE, NO SE SUPONE. `avanzar()` lee el ancho REAL de la primera
// tarjeta y el `gap` computado del carril. Un paso escrito a mano (`320 + 14`)
// se desincroniza en cuanto alguien toque la geometría, y el síntoma sería un
// carril que casi encaja — el peor: no falla, solo queda mal.
//
// TECLADO: las tarjetas son `<Link>` reales dentro de `<li>`; el navegador ya
// las mete en el orden de tabulación y desplaza el carril al enfocarlas. No hace
// falta gestionar foco a mano, y hacerlo rompería más de lo que arregla.
//
// `prefers-reduced-motion`: el desplazamiento suave se apaga con
// `motion-reduce:scroll-auto` en la clase del carril (`geometria-lista.ts`), que
// es CSS y por tanto no depende de que un manejador se acuerde.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { ProyectoCard } from "./proyecto-card";
import { ANCLAJE_TARJETA, CARRIL_PASARELA, DIMENSIONES_TARJETA } from "./geometria-lista";
import { ATRIBUTO_AVANZAR } from "@/lib/layout-check/pasarela";
import type { ProyectoResumen } from "@/types/proyectos";

export interface ProyectosPasarelaProps {
  proyectos: ProyectoResumen[];
  /** Igual que en la rejilla: solo llega definido cuando quien mira PUEDE reasignar. */
  onReasignar?: (p: ProyectoResumen) => void;
  /** Índice de la tarjeta anclada al inicio del carril, para que la vista pueda ampliarla debajo. */
  onAnclaCambia?: (indice: number) => void;
  /** El ancla vigente, para pintarle el borde de 1.5 px del XUI. La vista es dueña del estado. */
  ancla?: number;
  /** `created_at` del snapshot pinneado. Global para toda la lista; la tarjeta lo pinta. */
  inventarioEn?: string | null;
}

/**
 * El paso de una pulsación: el ancho de una tarjeta más el hueco, **leídos del
 * DOM**. Exportada y pura para poder probarla: en jsdom toda geometría vale 0,
 * así que una prueba sobre el elemento real pasaría siempre (P25).
 */
export function pasoDe(anchoTarjeta: number, gap: number): number {
  return Math.round(anchoTarjeta + gap);
}

/**
 * [F-1] «Hay tarjeta antes» = el borde izquierdo de la PRIMERA tarjeta queda
 * antes del borde izquierdo del propio carril. Compara BORDES REALES, no
 * `scrollLeft` contra `scrollWidth`/`clientWidth`: el `<ul>` lleva `p-3`
 * (12 px de relleno) y ESE criterio lo contaba como «todavía hay a dónde ir»
 * aunque la tarjeta ya estuviera entera en pantalla. 1 px de holgura por los
 * decimales que devuelve el navegador. Pura y exportada para poder probarla
 * sin navegador: en jsdom `getBoundingClientRect()` da ceros.
 */
export function hayTarjetaAntes(bordeIzqPrimera: number, bordeIzqCarril: number): boolean {
  return bordeIzqPrimera < bordeIzqCarril - 1;
}

/** Simétrico a `hayTarjetaAntes`: la ÚLTIMA tarjeta contra el borde derecho del carril. */
export function hayTarjetaDespues(bordeDerUltima: number, bordeDerCarril: number): boolean {
  return bordeDerUltima > bordeDerCarril + 1;
}

/**
 * [F-1 · revisor-codigo ALTO] EL CABLEADO ENTERO, EN UNA FUNCIÓN PURA.
 *
 * Antes `recalcular()` leía los rects Y decidía con ellos en el mismo sitio:
 * `hayTarjetaAntes`/`hayTarjetaDespues` quedaban perfectamente probadas, pero
 * NINGUNA prueba pasaba por el punto donde `recalcular()` las usa. Revertir
 * `recalcular()` al criterio viejo (`scrollLeft + clientWidth < scrollWidth -
 * 1`) dejaba la suite entera en verde, porque esas dos funciones seguían
 * probándose sueltas, nunca en su sitio de uso — un falso verde de manual.
 *
 * Con `flechasDe` como el ÚNICO camino hacia `setPuedeIzq`/`setPuedeDer`,
 * `recalcular()` queda reducido a «leer cuatro números y llamarla»: revertir
 * al criterio viejo exige BORRAR esa llamada, no solo tocar dos líneas. Ese
 * es el antídoto estructural, no una prueba más sobre el DOM — en jsdom toda
 * geometría vale 0 y ninguna aserción de render podría distinguir un criterio
 * del otro (ver la cabecera del archivo de pruebas).
 */
export function flechasDe(
  bordeIzqPrimera: number,
  bordeDerUltima: number,
  bordeIzqCarril: number,
  bordeDerCarril: number,
): { puedeIzq: boolean; puedeDer: boolean } {
  return {
    puedeIzq: hayTarjetaAntes(bordeIzqPrimera, bordeIzqCarril),
    puedeDer: hayTarjetaDespues(bordeDerUltima, bordeDerCarril),
  };
}

export function ProyectosPasarela({ proyectos, onReasignar, onAnclaCambia, ancla = 0, inventarioEn }: ProyectosPasarelaProps) {
  const carril = useRef<HTMLUListElement>(null);
  const [puedeIzq, setPuedeIzq] = useState(false);
  const [puedeDer, setPuedeDer] = useState(false);

  const recalcular = useCallback(() => {
    const el = carril.current;
    if (!el) return;
    // [F-1] Bordes reales, no `scrollLeft`/`scrollWidth`/`clientWidth`: el
    // `<ul>` lleva `p-3` (12 px de relleno) y ese criterio lo contaba como
    // «todavía hay a dónde ir» aunque la última tarjeta ya estuviera entera en
    // pantalla — la flecha derecha seguía viva con PRJ-013 completa. Aquí SOLO
    // se leen rects; la decisión entera vive en `flechasDe` (exportada,
    // probada aparte) para que no quepa cablear el resultado a mano al lado.
    //
    // `:scope > li` y no `li` a secas: si algún día una tarjeta contuviera su
    // propia lista anidada, `li` encontraría descendientes que no son
    // tarjetas del carril y «la última» dejaría de ser la última tarjeta.
    const items = el.querySelectorAll(":scope > li");
    // El tipo miente aquí: sin `noUncheckedIndexedAccess` en tsconfig, TS ve
    // `items[0]` como `Element` a secas, pero con la lista vacía es
    // `undefined` en runtime — de ahí la guarda `primera && ultima` de abajo.
    const primera = items[0];
    const ultima = items[items.length - 1];
    const carrilRect = el.getBoundingClientRect();
    const { puedeIzq, puedeDer } =
      primera && ultima
        ? flechasDe(primera.getBoundingClientRect().left, ultima.getBoundingClientRect().right, carrilRect.left, carrilRect.right)
        : { puedeIzq: false, puedeDer: false };
    setPuedeIzq(puedeIzq);
    setPuedeDer(puedeDer);
    // El ancla es la tarjeta pegada al inicio del carril. Se DERIVA del scroll,
    // no de un clic: un segundo objetivo pulsable dentro de la tarjeta chocaria
    // con que la tarjeta ya ES un <Link> — la misma trampa de HTML invalido que
    // el boton «Reasignar» esquiva viviendo fuera del ancla.
    const paso = pasoDe(primera?.getBoundingClientRect().width ?? 0, Number.parseFloat(getComputedStyle(el).columnGap || "0") || 0);
    if (onAnclaCambia && paso > 0) onAnclaCambia(Math.round(el.scrollLeft / paso));
  }, [onAnclaCambia]);

  useEffect(() => {
    recalcular();
    const el = carril.current;
    if (!el) return;
    el.addEventListener("scroll", recalcular, { passive: true });
    window.addEventListener("resize", recalcular);
    return () => {
      el.removeEventListener("scroll", recalcular);
      window.removeEventListener("resize", recalcular);
    };
  }, [recalcular, proyectos.length]);

  function mover(direccion: 1 | -1) {
    const el = carril.current;
    if (!el) return;
    const primera = el.querySelector("li");
    const gap = Number.parseFloat(getComputedStyle(el).columnGap || "0") || 0;
    const paso = pasoDe(primera?.getBoundingClientRect().width ?? 0, gap);
    el.scrollBy({ left: paso * direccion, behavior: "auto" });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => mover(-1)}
          disabled={!puedeIzq}
          aria-label="Ver proyectos anteriores"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-2"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        {/*
          El atributo por el que el `layout-check` encuentra este control
          (`ATRIBUTO_AVANZAR`, una sola fuente compartida con el arnés). No es
          decoración: el estado `pasarela-avanzada` solo puede medirse pulsando
          un control REAL, y si éste no aparece el caso sale SIN MEDIR — nunca
          verde. Ver `src/lib/layout-check/pasarela.ts`.

          44×44 (`h-11 w-11`) aunque el ícono mida 16: es el criterio de objetivo
          táctil del encargo, y aquí sí tiene sujeto.
        */}
        <button
          type="button"
          {...{ [ATRIBUTO_AVANZAR]: "" }}
          onClick={() => mover(1)}
          disabled={!puedeDer}
          aria-label="Ver más proyectos"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-2"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <ul ref={carril} aria-label="Proyectos" className={`${CARRIL_PASARELA} rounded-2xl bg-[var(--mx-track)] p-3`}>
        {proyectos.map((p, i) => (
          <li key={p.id} className={`${ANCLAJE_TARJETA} ${DIMENSIONES_TARJETA}`}>
            {/*
              LA CONDICIÓN DEL HUÉRFANO SE CONSERVA ENTERA, y va aquí y no en el
              padre a propósito: `onReasignar` llega definido cuando quien mira
              es admin, pero el botón solo existe si ADEMÁS el proyecto no tiene
              responsable. Al mover la lista a pasarela esa segunda mitad se me
              quedó en el camino un momento y el rescate habría aparecido en las
              nueve tarjetas — un botón que la mayoría no puede usar es ruido en
              la pantalla de todos (invariante de la 0025).
            */}
            <ProyectoCard
              proyecto={p}
              activa={i === ancla}
              inventarioEn={inventarioEn}
              onReasignar={onReasignar && p.responsable === null ? () => onReasignar(p) : undefined}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
