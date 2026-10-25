import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EstatusPill } from "./estatus-pill";
import { resolverEstatus } from "@/lib/estatus";

describe("resolverEstatus (taxonomía, orden de precedencia)", () => {
  // [2.0.1-A] `clave` entró al contrato (es la identidad estable que viaja
  // en `?estatus=`); estos `toEqual` son de forma EXACTA a propósito — si
  // el shape de `Estatus` vuelve a cambiar, que se vea aquí y no en la URL.
  it("'sobre_reservado' en badges → Sobre-reservado, tono warn", () => {
    expect(resolverEstatus(["sobre_reservado"], -3)).toEqual({ clave: "sobre_reservado", label: "Sobre-reservado", tono: "warn" });
  });

  it("'stock_cero' en badges (sin sobre_reservado) → Sin stock, tono neutral", () => {
    expect(resolverEstatus(["stock_cero"], 0)).toEqual({ clave: "sin_stock", label: "Sin stock", tono: "neutral" });
  });

  it("disponible === 0 sin badges relevantes → Reservado completo, tono info", () => {
    expect(resolverEstatus([], 0)).toEqual({ clave: "reservado_completo", label: "Reservado completo", tono: "info" });
  });

  it("caso normal → Disponible, tono success", () => {
    expect(resolverEstatus([], 12)).toEqual({ clave: "disponible", label: "Disponible", tono: "success" });
  });

  it("precedencia: sobre_reservado gana aunque también venga stock_cero", () => {
    expect(resolverEstatus(["sobre_reservado", "stock_cero"], -5)).toEqual({
      clave: "sobre_reservado",
      label: "Sobre-reservado",
      tono: "warn",
    });
  });

  it("precedencia: stock_cero gana sobre disponible===0 si ambos aplican", () => {
    expect(resolverEstatus(["stock_cero"], 0)).toEqual({ clave: "sin_stock", label: "Sin stock", tono: "neutral" });
  });

  it("badge 'sin_familia' no afecta el estatus", () => {
    expect(resolverEstatus(["sin_familia"], 8)).toEqual({ clave: "disponible", label: "Disponible", tono: "success" });
  });
});

describe("EstatusPill", () => {
  it("renderiza el label 'Sobre-reservado'", () => {
    render(<EstatusPill badges={["sobre_reservado"]} disponible={-3} />);
    expect(screen.getByText("Sobre-reservado")).toBeInTheDocument();
  });

  it("renderiza el label 'Sin stock'", () => {
    render(<EstatusPill badges={["stock_cero"]} disponible={0} />);
    expect(screen.getByText("Sin stock")).toBeInTheDocument();
  });

  it("renderiza el label 'Reservado completo'", () => {
    render(<EstatusPill badges={[]} disponible={0} />);
    expect(screen.getByText("Reservado completo")).toBeInTheDocument();
  });

  it("renderiza el label 'Disponible'", () => {
    render(<EstatusPill badges={[]} disponible={20} />);
    expect(screen.getByText("Disponible")).toBeInTheDocument();
  });
});
