import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FichaImagen } from "./ficha-imagen";

describe("FichaImagen", () => {
  it("con imagenUrl: renderiza la imagen con alt correcto (sku + descripción)", () => {
    render(<FichaImagen sku="A-1" imagenUrl="http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes/a1.png" descr="Candado industrial" />);
    const img = screen.getByRole("img", { name: "Imagen de producto A-1 — Candado industrial" });
    expect(img).toBeInTheDocument();
    expect(screen.queryByText("Sin imagen cargada")).not.toBeInTheDocument();
  });

  it("con imagenUrl sin descr: alt cae solo al sku", () => {
    render(<FichaImagen sku="A-1" imagenUrl="http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes/a1.png" />);
    expect(screen.getByRole("img", { name: "Imagen de producto A-1" })).toBeInTheDocument();
  });

  it("sin imagenUrl: muestra el placeholder 'Sin imagen cargada' y ningún <img>", () => {
    render(<FichaImagen sku="A-1" imagenUrl={null} />);
    expect(screen.getByText("Sin imagen cargada")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
