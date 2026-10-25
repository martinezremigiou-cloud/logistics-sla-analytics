import "@testing-library/jest-dom/vitest";

// ============================================================
// Bloque 5 · P3 · Polyfills de jsdom para Radix UI (Select/DropdownMenu).
// jsdom no implementa `scrollIntoView`, `hasPointerCapture`/
// `releasePointerCapture` ni `ResizeObserver` — Radix Select (vía
// `@radix-ui/react-popper` + `@radix-ui/react-use-size`) y
// DropdownMenu (Popper también) los invocan al montar/posicionar su
// contenido, y sin esto el render lanza en cualquier test que abra uno
// de estos componentes. Son no-ops: no cambian el comportamiento de
// ningún test que NO los use (los 705 tests previos a P3 no interactúan
// con Select/DropdownMenu).
// ============================================================
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}
if (typeof window.ResizeObserver !== "function") {
  class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;
}

// jsdom tampoco implementa `URL.createObjectURL`/`revokeObjectURL` — usado
// por el preview local de `CargaDropzone` (P3, Bloque 5). No-op: no afecta
// ningún test que no suba archivos.
if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = () => "blob:mock-url";
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = () => {};
}

// ============================================================
// [2.0.1-B · S-1] jsdom tampoco implementa `matchMedia` ni el desplazamiento
// programático de un elemento (`scrollTo`/`scrollBy`), y la pasarela de
// `/proyectos` usa los dos: `useEsAncho` decide en React la rama pasarela/lista
// y las flechas mueven el carril.
//
// SIN ESTOS STUBS EL ROJO ES DE INFRAESTRUCTURA Y SE LEE COMO FALLO DEL
// COMPONENTE: `ProyectosView` lanzaba en el primer render con «matchMedia is
// not a function» y las cinco pruebas de la vista caían señalando la vista.
// Pasó exactamente como la especificación de S-1 lo predijo.
//
// Y LO QUE ESTOS STUBS NO DAN, dicho para que nadie lea de más una prueba
// verde: **la geometría en jsdom vale 0**. `getBoundingClientRect` devuelve
// ceros, así que ninguna prueba de flechas escrita contra el DOM comprueba el
// desplazamiento — pasaría siempre (P25). Por eso el cálculo del paso vive en
// `pasoDe`, que es pura y sí se prueba, y el testigo del cableado real es el
// estado `pasarela-avanzada` del `layout-check`, en navegador.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = ((consulta: string) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}
if (typeof Element.prototype.scrollBy !== "function") {
  Element.prototype.scrollBy = () => {};
}
