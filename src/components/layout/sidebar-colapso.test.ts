import { describe, it, expect, afterEach, vi } from "vitest";
import {
  SIDEBAR_COLAPSADO_STORAGE_KEY,
  SIDEBAR_COLAPSADO_CSS_VAR_ANCHO,
  SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD,
  aplicarColapsoSidebar,
  leerColapsadoSidebar,
  sidebarColapsadoBlockingScript,
} from "./sidebar-colapso";

function limpiar() {
  document.documentElement.style.cssText = "";
  localStorage.clear();
}

describe("sidebar-colapso — persistencia sin parpadeo (O16)", () => {
  afterEach(limpiar);

  it("aplicarColapsoSidebar(true) setea ambas custom properties sobre <html>", () => {
    aplicarColapsoSidebar(true);

    expect(document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO)).toBe("0px");
    expect(document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD)).toBe("0");
  });

  it("aplicarColapsoSidebar(false) remueve ambas custom properties (vuelve al default expandido del CSS)", () => {
    aplicarColapsoSidebar(true);
    aplicarColapsoSidebar(false);

    expect(document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO)).toBe("");
    expect(document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_OPACIDAD)).toBe("");
  });

  it("leerColapsadoSidebar refleja lo que ya aplicó aplicarColapsoSidebar", () => {
    expect(leerColapsadoSidebar()).toBe(false);

    aplicarColapsoSidebar(true);
    expect(leerColapsadoSidebar()).toBe(true);

    aplicarColapsoSidebar(false);
    expect(leerColapsadoSidebar()).toBe(false);
  });

  it("el script bloqueante, ejecutado literalmente como texto, colapsa el DOM si localStorage ya dice '1' (arranque en frío)", () => {
    localStorage.setItem(SIDEBAR_COLAPSADO_STORAGE_KEY, "1");

    // eslint-disable-next-line no-new-func -- es exactamente lo que hace el navegador con el <script> inline de layout.tsx.
    new Function(sidebarColapsadoBlockingScript())();

    expect(leerColapsadoSidebar()).toBe(true);
  });

  it("el script bloqueante NO toca el DOM si no hay preferencia guardada (default = expandido, igual que el SSR)", () => {
    // eslint-disable-next-line no-new-func
    new Function(sidebarColapsadoBlockingScript())();

    expect(leerColapsadoSidebar()).toBe(false);
    expect(document.documentElement.style.getPropertyValue(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO)).toBe("");
  });

  it("el script bloqueante NO truena si localStorage no es accesible (modo privado estricto, etc.)", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    expect(() => {
      // eslint-disable-next-line no-new-func
      new Function(sidebarColapsadoBlockingScript())();
    }).not.toThrow();
    expect(leerColapsadoSidebar()).toBe(false);

    spy.mockRestore();
  });
});
