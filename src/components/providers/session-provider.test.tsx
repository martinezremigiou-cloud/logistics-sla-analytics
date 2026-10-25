import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider, useSesion } from "./session-provider";

function Sonda() {
  const sesion = useSesion();
  return (
    <p>
      {sesion.id}·{sesion.email}·{sesion.rol}
    </p>
  );
}

describe("SessionProvider / useSesion", () => {
  it("expone id/email/rol a los consumidores dentro del árbol", () => {
    render(
      <SessionProvider sesion={{ id: "u1", email: "admin@example.com", rol: "admin" }}>
        <Sonda />
      </SessionProvider>,
    );
    expect(screen.getByText("u1·admin@example.com·admin")).toBeInTheDocument();
  });

  it("refleja rol='kam' cuando la sesión es kam", () => {
    render(
      <SessionProvider sesion={{ id: "u2", email: "kam@example.com", rol: "kam" }}>
        <Sonda />
      </SessionProvider>,
    );
    expect(screen.getByText("u2·kam@example.com·kam")).toBeInTheDocument();
  });

  it("useSesion() lanza si se usa fuera de un SessionProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Sonda />)).toThrow("useSesion() debe usarse dentro de <SessionProvider>.");
    spy.mockRestore();
  });
});
