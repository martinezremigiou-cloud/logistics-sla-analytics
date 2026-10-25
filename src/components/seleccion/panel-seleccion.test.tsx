import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PanelSeleccion, ANCLAJES } from "./panel-seleccion";
import { anclaDePiso } from "@/components/layout/carril";
import type { ItemSeleccion } from "@/lib/seleccion";

const ITEMS: ItemSeleccion[] = [
  { sku: "SUJ500-F", cantidad: 40 },
  { sku: "JE016-YD", cantidad: 1 },
  { sku: "PAULA: CAMBIA ZU7191-R MP0872-R", cantidad: 120 },
];

function pintar(over: Partial<React.ComponentProps<typeof PanelSeleccion>> = {}) {
  const props = {
    items: ITEMS,
    abierto: true,
    onAlternarAbierto: vi.fn(),
    onFijarCantidad: vi.fn(),
    onQuitar: vi.fn(),
    onVaciar: vi.fn(),
    ...over,
  };
  render(<PanelSeleccion {...props} />);
  return props;
}

describe("[INV-B8.2] PanelSeleccion", () => {
  it("sin nada seleccionado NO se pinta: el elemento flotante no ocupa pantalla sin tener qué decir", () => {
    const { container } = render(
      <PanelSeleccion
        items={[]}
        abierto
        onAlternarAbierto={vi.fn()}
        onFijarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("contraído muestra SKUs y piezas, no solo un número suelto", () => {
    pintar({ abierto: false });
    // 3 renglones, 161 piezas: el conteo de piezas es lo que se vuelca, y por
    // eso va en la píldora — «3» a secas no dice cuánto se va a pedir.
    expect(screen.getByText("3 SKU · 161 pz")).toBeInTheDocument();
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
  });

  it("desplegado lista cada SKU con su cantidad", () => {
    pintar();
    for (const item of ITEMS) {
      expect(screen.getByLabelText(`Cantidad de ${item.sku}`)).toHaveValue(String(item.cantidad));
    }
  });

  it("el − está DESHABILITADO en 1: quitar un SKU es una decisión, no el final de una cuesta abajo", () => {
    pintar();
    expect(screen.getByLabelText("Una pieza menos de JE016-YD")).toBeDisabled();
    expect(screen.getByLabelText("Una pieza menos de SUJ500-F")).toBeEnabled();
  });

  it("+ y − fijan la cantidad vecina", () => {
    const props = pintar();
    fireEvent.click(screen.getByLabelText("Una pieza más de SUJ500-F"));
    expect(props.onFijarCantidad).toHaveBeenCalledWith("SUJ500-F", 41);
    fireEvent.click(screen.getByLabelText("Una pieza menos de SUJ500-F"));
    expect(props.onFijarCantidad).toHaveBeenCalledWith("SUJ500-F", 39);
  });

  // ============================================================
  // El caso que motivó el borrador local. Sin él, limpiar el campo para
  // escribir otro número llamaría a `fijarCantidad(sku, 0)` — que QUITA el
  // renglón. El usuario vería desaparecer el SKU mientras teclea.
  // ============================================================
  it("vaciar el campo para reescribir NO borra el renglón mientras se teclea", () => {
    const props = pintar();
    const campo = screen.getByLabelText("Cantidad de SUJ500-F");
    fireEvent.change(campo, { target: { value: "" } });
    expect(props.onFijarCantidad).not.toHaveBeenCalled();
    fireEvent.change(campo, { target: { value: "8" } });
    expect(props.onFijarCantidad).not.toHaveBeenCalled();
    fireEvent.blur(campo);
    expect(props.onFijarCantidad).toHaveBeenCalledExactlyOnceWith("SUJ500-F", 8);
  });

  it("un campo que queda vacío al salir REVIERTE al valor que había", () => {
    const props = pintar();
    const campo = screen.getByLabelText("Cantidad de SUJ500-F");
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.blur(campo);
    expect(props.onFijarCantidad).not.toHaveBeenCalled();
    expect(campo).toHaveValue("40");
  });

  it("el campo no acepta letras ni signos: la cantidad no puede envenenarse desde el teclado", () => {
    pintar();
    const campo = screen.getByLabelText("Cantidad de SUJ500-F");
    fireEvent.change(campo, { target: { value: "-9e5x" } });
    expect(campo).toHaveValue("95");
  });

  it("la ✕ quita ese SKU y solo ese", () => {
    const props = pintar();
    fireEvent.click(screen.getByLabelText("Quitar JE016-YD de la Selección"));
    expect(props.onQuitar).toHaveBeenCalledExactlyOnceWith("JE016-YD");
  });

  it("Vaciar avisa una sola vez y no toca los renglones uno por uno", () => {
    const props = pintar();
    fireEvent.click(screen.getByRole("button", { name: /Vaciar/ }));
    expect(props.onVaciar).toHaveBeenCalledOnce();
    expect(props.onQuitar).not.toHaveBeenCalled();
  });

  // ============================================================
  // La geometría. Es lo que se pidió mirar en C1, y una prueba de clases no
  // sustituye a verlo — pero sí impide que alguien la borre sin enterarse: si
  // el anclaje deja de despejar la barra inferior, esto se pone rojo antes de
  // que nadie abra la evidencia.
  // ============================================================
  it("se ancla POR ENCIMA de la barra inferior móvil y por DEBAJO de ella en apilamiento", () => {
    const { container } = render(
      <PanelSeleccion
        items={ITEMS}
        abierto={false}
        onAlternarAbierto={vi.fn()}
        onFijarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );
    const anclaje = container.firstElementChild!.className;
    // [2.0.1-A] Antes esta línea fijaba `calc(3.5rem+env+0.75rem)` y su
    // comentario decía «3.5rem = el alto de BottomNav». Los dos eran una
    // suposición sobre un archivo ajeno: la barra medía **54 px** porque no
    // declaraba alto. Ahora el piso lo calcula el carril y esta guarda exige el
    // TOKEN — si alguien vuelve a escribir un número aquí, `carril.test.ts` lo
    // caza, y si el piso cambia, cambia en un solo sitio.
    expect(anclaje).toContain(anclaDePiso("seleccion"));
    // `BottomNav` es z-40: el panel tiene que quedar por debajo para que, si
    // algún día creciera de más, la navegación siga encima y siga usable.
    expect(anclaje).toContain("z-30");
  });
});

// ============================================================
// [INV-B11] O6 · EL RIEL ES ESTRECHO, Y ESO CAMBIA EL RENGLÓN.
//
// QUÉ ENCONTRÓ ESTO Y QUÉ NO. Nada de esto encontró el defecto: lo encontró
// **abrir el panel en el navegador con 15 SKU dentro** y medir
// `scrollWidth > clientWidth` sobre cada nodo. jsdom no calcula layout, así que
// desde aquí «no cabe» NO es observable — igual que en `flotantes.test.ts`, y
// esta vez le tocó a la mitad del límite que ese archivo ya declaraba: *«esto
// no ve el eje vertical ni los tamaños»*. Falló por los tamaños, en el mismo
// bloque.
//
// Lo que sí hace esta guarda: **fija la decisión** para que el arreglo no se
// deshaga solo. Si alguien devuelve el renglón del riel a una sola línea, o le
// quita el tope de alto, se pone rojo aquí y no en un pase manual.
// ============================================================
describe("[INV-B11] O6 · el renglón del riel", () => {
  function anclado(anclaje: "flotante" | "sidebar") {
    const { container } = render(
      <PanelSeleccion
        items={ITEMS}
        abierto
        anclaje={anclaje}
        onAlternarAbierto={vi.fn()}
        onFijarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );
    const seccion = container.firstElementChild as HTMLElement;
    const li = seccion.querySelector("li") as HTMLElement;
    return { seccion, li, sku: li.querySelector("span[title]") as HTMLElement };
  }

  it("en el riel el SKU tiene su PROPIA línea; flotando comparte renglón", () => {
    const riel = anclado("sidebar");
    expect(riel.li.className, "el renglón del riel volvió a una sola línea").toContain("flex-col");
    expect(riel.sku.className, "el SKU del riel volvió a repartirse el ancho con el paso de cantidad").toContain(
      "w-full",
    );

    // El control positivo del contraste: el mismo componente, en el anclaje
    // ancho, SIGUE en una línea. Sin esto, un `flex-col` puesto en los dos
    // anclajes pondría la de arriba en verde y habría roto el panel flotante.
    const flota = anclado("flotante");
    expect(flota.li.className).toContain("items-center");
    expect(flota.li.className).not.toContain("flex-col");
    expect(flota.sku.className).toContain("flex-1");
  });

  it("en el riel la píldora contraída da LÍNEA PROPIA al conteo, y no lo deja envolver", () => {
    const { container } = render(
      <PanelSeleccion
        items={ITEMS}
        abierto={false}
        anclaje="sidebar"
        onAlternarAbierto={vi.fn()}
        onFijarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );
    const boton = container.querySelector("button") as HTMLElement;
    expect(boton.className, "la píldora del riel volvió a una sola línea").toContain("flex-col");
    const chip = Array.from(boton.querySelectorAll("span")).find((s) => s.textContent === "3 SKU · 161 pz") as HTMLElement;
    expect(chip, "el conteo desapareció de la píldora").toBeDefined();
    // `whitespace-nowrap` es lo que convierte «no cabe» en un desbordamiento
    // visible en vez de en un salto de línea callado — que es el defecto.
    expect(chip.className, "el conteo puede volver a partirse en dos renglones").toContain("whitespace-nowrap");
    expect(chip.className, "el conteo no bajó el punto que se pidió").toContain("text-[10.5px]");

    // Control positivo: flotando la píldora SIGUE siendo una píldora de una
    // línea. Sin esto, un `flex-col` puesto en los dos anclajes pondría lo de
    // arriba en verde habiendo roto el otro estado.
    cleanup();
    const { container: flota } = render(
      <PanelSeleccion
        items={ITEMS}
        abierto={false}
        onAlternarAbierto={vi.fn()}
        onFijarCantidad={vi.fn()}
        onQuitar={vi.fn()}
        onVaciar={vi.fn()}
      />,
    );
    const pildora = flota.querySelector("button") as HTMLElement;
    expect(pildora.className).toContain("rounded-full");
    expect(pildora.className).not.toContain("flex-col");
    const chipFlota = Array.from(pildora.querySelectorAll("span")).find((s) => s.textContent === "3 SKU · 161 pz") as HTMLElement;
    expect(chipFlota.className, "el anclaje flotante heredó el tamaño del riel, y ahí sí cabía").toContain(
      "text-[11.5px]",
    );
  });

  it("en el riel la Selección tiene TOPE de alto: la navegación es lo primero", () => {
    // Sin esto el `<ul>` llegaba a `46vh` y el `<nav>` —`min-h-0 flex-1`— cedía
    // todo su espacio: la navegación quedó en **0 px** necesitando 327.
    expect(ANCLAJES.sidebar, "la Selección perdió su tope y puede comerse la navegación").toContain("max-h-[40vh]");
    const riel = anclado("sidebar");
    expect(riel.seccion.className).toContain("max-h-[40vh]");

    // Y EN `vh`, NO EN `%`. Un tope en porcentaje se resuelve contra el padre
    // inmediato —el envoltorio de `SeleccionFlotante`—, que sin `min-h-0`
    // computaba 1 160 px en un riel de 550: el tope se aplicó contra 1 160 y
    // aplastó al `<nav>` igual, en verde. Esta línea es lo único que separa
    // «hay un tope» de «hay un tope que topa».
    expect(ANCLAJES.sidebar, "el tope volvió a un porcentaje, que se resuelve contra el envoltorio").not.toContain(
      "%",
    );
    // Y la lista toma lo que sobra en vez de traer su propio tope en `vh`: dos
    // topes compitiendo es lo que dejó al `<nav>` sin espacio.
    const ul = riel.seccion.querySelector("ul") as HTMLElement;
    expect(ul.className).toContain("flex-1");
    expect(ul.className, "volvió el tope en vh dentro del riel").not.toContain("vh");

    // Control positivo: flotando el tope en `vh` SÍ está, y es el correcto.
    const ulFlota = anclado("flotante").seccion.querySelector("ul") as HTMLElement;
    expect(ulFlota.className).toContain("max-h-[38vh]");
  });
});
