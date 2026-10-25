import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BotonSeleccion } from "./boton-seleccion";
import { SeleccionFija } from "@/components/providers/seleccion-provider";
import { SELECCION_VACIA, agregar } from "@/lib/seleccion";

describe("[INV-B8.2] BotonSeleccion", () => {
  it("SIN provider no se pinta: la degradación es «no hay botón», no «la página se cae»", () => {
    const { container } = render(<BotonSeleccion sku="SUJ500-F" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fuera de la Selección invita a agregar; dentro, anuncia que ya está", () => {
    const { rerender } = render(
      <SeleccionFija seleccion={SELECCION_VACIA}>
        <BotonSeleccion sku="SUJ500-F" />
      </SeleccionFija>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button")).toHaveAccessibleName("Agregar SUJ500-F a la Selección");

    rerender(
      <SeleccionFija seleccion={agregar(SELECCION_VACIA, "SUJ500-F")}>
        <BotonSeleccion sku="SUJ500-F" />
      </SeleccionFija>,
    );
    // `aria-pressed` y no un nombre que cambie de sentido: un lector de
    // pantalla anuncia el estado del interruptor sin que el botón se mueva
    // bajo el foco.
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button")).toHaveAccessibleName("Quitar SUJ500-F de la Selección");
  });

  it("el estado se decide NORMALIZANDO: suj500-f y SUJ500-F son el mismo SKU", () => {
    render(
      <SeleccionFija seleccion={agregar(SELECCION_VACIA, "SUJ500-F")}>
        <BotonSeleccion sku="suj500-f" />
      </SeleccionFija>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  // ============================================================
  // El botón vive DENTRO de una fila que es un enlace a la ficha del SKU. Sin
  // frenar el evento, marcar un SKU navegaría fuera del catálogo — y el KAM
  // perdería el lugar donde iba, que es justo lo que la Selección viene a
  // evitar.
  // ============================================================
  it("no deja que el clic llegue al enlace de la fila", () => {
    const alNavegar = vi.fn();
    render(
      <SeleccionFija seleccion={SELECCION_VACIA}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a href="#ficha" onClick={alNavegar}>
          <span>SUJ500-F</span>
        </a>
      </SeleccionFija>,
    );
    // Referencia: sin el botón, un clic dentro del ancla SÍ lo activa.
    fireEvent.click(screen.getByText("SUJ500-F"));
    expect(alNavegar).toHaveBeenCalledOnce();

    alNavegar.mockClear();
    render(
      <SeleccionFija seleccion={SELECCION_VACIA}>
        {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
        <a href="#ficha" onClick={alNavegar}>
          <BotonSeleccion sku="JE016-YD" />
        </a>
      </SeleccionFija>,
    );
    fireEvent.click(screen.getByRole("button", { name: /JE016-YD/ }));
    expect(alNavegar, "el clic en el botón se propagó al enlace de la fila").not.toHaveBeenCalled();
  });

  it("la variante de la ficha dice «+ En proyecto»; la de la tabla, «+ Proyecto»", () => {
    const { rerender } = render(
      <SeleccionFija seleccion={SELECCION_VACIA}>
        <BotonSeleccion sku="SUJ500-F" variante="completo" />
      </SeleccionFija>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("+ En proyecto");

    rerender(
      <SeleccionFija seleccion={SELECCION_VACIA}>
        <BotonSeleccion sku="SUJ500-F" />
      </SeleccionFija>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("+ Proyecto");
  });
});
