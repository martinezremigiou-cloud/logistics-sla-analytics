// ============================================================
// [INV-B11] O6 · EL ENVOLTORIO QUE APLASTÓ LA NAVEGACIÓN.
//
// `SeleccionFlotante` monta un `<div>` alrededor del panel cuando el llamador
// pide clases. Ese `<div>` lo introduje en O6 y en el riel es un ítem de flex:
// **sin `min-h-0` no baja de la altura de su contenido**. Medido en el
// navegador, computaba **1 160 px dentro de un riel de 550**, y el `<nav>`
// —que sí es `min-h-0 flex-1`— cedió hasta **0 px** necesitando 327.
//
// El daño no se ve desde aquí: jsdom no calcula layout, así que ni el 1 160 ni
// el 0 son observables. Lo que esta guarda impide es que la clase desaparezca
// —o que alguien la mueva al `className` del llamador, donde una pantalla nueva
// se olvidaría de ponerla.
// ============================================================
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SeleccionFija } from "@/components/providers/seleccion-provider";
import { SeleccionFlotante } from "./seleccion-flotante";
import { ID_PANEL } from "./panel-seleccion";
import type { Seleccion } from "@/lib/seleccion";

const SELECCION: Seleccion = { items: [{ sku: "KYA2490", cantidad: 1 }] };

function pintar(props: Parameters<typeof SeleccionFlotante>[0] = {}) {
  const { container } = render(
    <SeleccionFija seleccion={SELECCION} panelAbierto>
      <SeleccionFlotante {...props} />
    </SeleccionFija>,
  );
  return container;
}

describe("[INV-B11] O6 · el envoltorio de la Selección", () => {
  it("el envoltorio lleva `min-h-0` SIEMPRE, lo pida o no el llamador", () => {
    const container = pintar({ anclaje: "sidebar", conDialogo: false, className: "px-1.5" });
    const envoltorio = container.firstElementChild as HTMLElement;
    expect(envoltorio.tagName).toBe("DIV");
    expect(envoltorio.className, "el envoltorio puede volver a inflarse y aplastar la navegación").toContain("min-h-0");
    // Y sin perder lo que pidió el llamador: si `cn` se comiera uno de los dos,
    // esta prueba pasaría a medias y el padding se habría ido en silencio.
    expect(envoltorio.className).toContain("px-1.5");
  });

  it("sin `className` NO hay envoltorio: un `<div>` de más rompe el flujo del pie", () => {
    // El control positivo del de arriba. Si el envoltorio se montara siempre,
    // la primera prueba seguiría verde y esta rama —la que usa el punto
    // flotante— habría cambiado sin que nadie se enterara.
    const container = pintar({ anclaje: "sidebar", conDialogo: false });
    const primero = container.firstElementChild as HTMLElement;
    expect(primero.tagName).toBe("SECTION");
    // [2.0.1-A] El id se DERIVA del anclaje: dos puntos de render, dos
    // identidades. La prueba deja de repetir la cadena para que no pueda
    // afirmar un id que el componente ya no usa.
    expect(primero.id).toBe(ID_PANEL.sidebar);
  });
});
