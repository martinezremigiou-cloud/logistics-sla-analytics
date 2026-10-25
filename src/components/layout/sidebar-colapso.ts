/**
 * Bloque 7-B · O16 — persistencia de "ocultar/mostrar" del sidebar de
 * escritorio, sin parpadeo.
 *
 * El patrón `mounted` + `useEffect` que usa theme-toggle.tsx (líneas 10-14)
 * evita el mismatch de hidratación, pero NO evita el parpadeo: el HTML del
 * SSR ya se pintó en pantalla antes de que corra el primer `useEffect` de
 * React. Se usa en cambio la MISMA técnica que ya trae `next-themes` en
 * este proyecto (ver node_modules/next-themes/dist/index.mjs): un <script>
 * inline y síncrono (sin defer/async, así que bloquea el parseo del resto
 * del <body>) que se imprime como uno de los primeros hijos de <body> en
 * layout.tsx y corre ANTES de que el navegador pinte nada más. Aplica el
 * ancho/opacidad finales directamente como custom properties de CSS sobre
 * <html> (`document.documentElement` — el mismo nodo que muta next-themes,
 * y que ya tiene `suppressHydrationWarning` en layout.tsx:17) — así el
 * <aside> nace YA con su tamaño final (ver el `style` inline de
 * app-shell.tsx, que lee estas mismas variables con
 * `var(--mx-sidebar-w, 230px)`), sin depender de que React hidrate primero.
 *
 * El toggle en runtime (botón en topbar.tsx, estado en app-shell.tsx) hace
 * la MISMA operación de forma imperativa vía `aplicarColapsoSidebar`. Por
 * eso el <aside> nunca decide su ancho a partir de un className condicionado
 * por estado de React (eso sí causaría flicker/mismatch, porque el server
 * no conoce localStorage): el ancho siempre es CSS puro reaccionando a
 * estas variables, y React solo se usa para aria-expanded/aria-hidden.
 */

export const SIDEBAR_COLAPSADO_STORAGE_KEY = "mx-sidebar-colapsado";

/**
 * Custom properties de CSS que lee `var(..., <default expandido>)` en el
 * `style` inline del `<aside>` de app-shell.tsx. Se setean sobre
 * `document.documentElement`, nunca sobre el propio `<aside>`, para que un
 * solo script alcance sin importar cuántos componentes haya entre medio.
 */
export const SIDEBAR_COLAPSADO_CSS_VAR_ANCHO = "--mx-sidebar-w";
export const SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD = "--mx-sidebar-opacity";

/**
 * Aplica (o remueve) las custom properties de colapso sobre <html>. Es la
 * contraparte EN VIVO (se importa y ejecuta como código normal de React)
 * del script bloqueante de abajo, que por fuerza debe ser un texto
 * autocontenido — no puede llamar a esta función, porque corre antes de que
 * exista cualquier bundle de JS.
 */
export function aplicarColapsoSidebar(colapsado: boolean): void {
  const root = document.documentElement;
  if (colapsado) {
    root.style.setProperty(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO, "0px");
    root.style.setProperty(SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD, "0");
  } else {
    root.style.removeProperty(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO);
    root.style.removeProperty(SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD);
  }
}

/** Lee el estado actual desde el DOM (fuente de verdad = lo que ya aplicó
 *  el script bloqueante al cargar), para sincronizar el estado de React
 *  (aria-expanded/aria-hidden) al montar — ver app-shell.tsx. */
export function leerColapsadoSidebar(): boolean {
  return document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO).trim() === "0px";
}

/** Corre en el navegador, antes de que exista React — nunca se invoca
 *  directamente desde este módulo, solo se serializa como texto abajo. */
function aplicarColapsoInicial(key: string, varAncho: string, varOpacidad: string) {
  try {
    if (localStorage.getItem(key) === "1") {
      document.documentElement.style.setProperty(varAncho, "0px");
      document.documentElement.style.setProperty(varOpacidad, "0");
    }
  } catch {
    // localStorage inaccesible (modo privado estricto, etc.) — se degrada a
    // "expandido", el mismo estado por defecto que ya pinta el SSR.
  }
}

/**
 * Serializa `aplicarColapsoInicial` como IIFE de texto para imprimirla en
 * un <script dangerouslySetInnerHTML> (layout.tsx) — mismo mecanismo que
 * usa next-themes para su propio script anti-flash.
 */
export function sidebarColapsadoBlockingScript(): string {
  return `(${aplicarColapsoInicial.toString()})(${JSON.stringify(SIDEBAR_COLAPSADO_STORAGE_KEY)},${JSON.stringify(
    SIDEBAR_COLAPSADO_CSS_VAR_ANCHO,
  )},${JSON.stringify(SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD)})`;
}
