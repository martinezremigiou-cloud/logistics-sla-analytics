import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SinPermiso } from "./sin-permiso";

describe("SinPermiso", () => {
  it("rol kam: muestra el mensaje con 'KAM' y el botón vuelve a /", () => {
    render(<SinPermiso rolActual="kam" />);
    expect(screen.getByText("Sin permiso")).toBeInTheDocument();
    expect(screen.getByText(/Tu sesión actual es KAM\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver al Dashboard" })).toHaveAttribute("href", "/");
  });

  it("rol admin: muestra el mensaje con 'Admin'", () => {
    render(<SinPermiso rolActual="admin" />);
    expect(screen.getByText(/Tu sesión actual es Admin\./)).toBeInTheDocument();
  });
});
