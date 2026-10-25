import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EstadoError, EstadoVacio } from "./estado-carga";

describe("EstadoError", () => {
  it("muestra el título y el mensaje por defecto, y llama a onRetry al hacer click en Reintentar", () => {
    const onRetry = vi.fn();
    render(<EstadoError onRetry={onRetry} />);

    expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument();
    expect(screen.getByText("Ocurrió un error al consultar los datos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("muestra el mensaje personalizado cuando se provee", () => {
    render(<EstadoError mensaje="No hay conexión con el servidor." onRetry={vi.fn()} />);

    expect(screen.getByText("No hay conexión con el servidor.")).toBeInTheDocument();
    expect(screen.queryByText("Ocurrió un error al consultar los datos.")).not.toBeInTheDocument();
  });
});

describe("EstadoVacio", () => {
  it("muestra título, descripción y cta", () => {
    render(
      <EstadoVacio
        titulo="Sin resultados"
        descripcion="No encontramos SKUs para ese filtro."
        cta={<button type="button">Limpiar filtros</button>}
      />,
    );

    expect(screen.getByText("Sin resultados")).toBeInTheDocument();
    expect(screen.getByText("No encontramos SKUs para ese filtro.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  it("funciona solo con título (sin descripción ni cta)", () => {
    render(<EstadoVacio titulo="Nada por aquí" />);

    expect(screen.getByText("Nada por aquí")).toBeInTheDocument();
  });
});
