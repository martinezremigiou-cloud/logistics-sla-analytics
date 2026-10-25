import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CambiosTabla } from "./cambios-tabla";
import type { CambioItem } from "@/types/api";

function cambio(overrides: Partial<CambioItem> = {}): CambioItem {
  return {
    id: "c1",
    entidad: "producto",
    clave: "A-1",
    sku: "A-1",
    campo: "familia",
    valor_anterior: "CANDADOS",
    valor_nuevo: "SENSORES",
    tipo: "MODIFICACION",
    ...overrides,
  };
}

describe("CambiosTabla", () => {
  it("renderiza las 5 columnas del molde de auditoría", () => {
    render(<CambiosTabla items={[cambio()]} />);
    expect(screen.getByRole("columnheader", { name: "Entidad" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Clave" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Campo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Valor anterior → nuevo" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Tipo" })).toBeInTheDocument();
  });

  it("sku no-null → Clave es un link a /catalogo/{sku}", () => {
    render(<CambiosTabla items={[cambio({ sku: "A-1", clave: "A-1" })]} />);
    const link = screen.getByRole("link", { name: "A-1" });
    expect(link).toHaveAttribute("href", "/catalogo/A-1");
  });

  it("sku null → Clave es texto plano, sin link", () => {
    render(<CambiosTabla items={[cambio({ sku: null, clave: "clave-sin-sku" })]} />);
    expect(screen.getByText("clave-sin-sku")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("ALTA: valor_anterior null se lee '— → X'", () => {
    render(<CambiosTabla items={[cambio({ tipo: "ALTA", valor_anterior: null, valor_nuevo: "SENSORES" })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("SENSORES")).toBeInTheDocument();
    expect(screen.getByText("→")).toBeInTheDocument();
  });

  it("BAJA: valor_nuevo null se lee 'X → —'", () => {
    render(<CambiosTabla items={[cambio({ tipo: "BAJA", valor_anterior: "CANDADOS", valor_nuevo: null })]} />);
    expect(screen.getByText("CANDADOS")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("pill de tipo: ALTA usa tono success", () => {
    render(<CambiosTabla items={[cambio({ id: "alta", tipo: "ALTA" })]} />);
    expect(screen.getByText("Alta").className).toContain("bg-success-bg");
  });

  it("pill de tipo: MODIFICACION usa tono info", () => {
    render(<CambiosTabla items={[cambio({ id: "mod", tipo: "MODIFICACION" })]} />);
    expect(screen.getByText("Modificación").className).toContain("bg-info-bg");
  });

  it("pill de tipo: BAJA usa tono warn (NUNCA danger/rojo)", () => {
    render(<CambiosTabla items={[cambio({ id: "baja", tipo: "BAJA" })]} />);
    const pill = screen.getByText("Baja");
    expect(pill.className).toContain("bg-warn-bg");
    expect(pill.className).not.toContain("danger");
  });

  it("aria-busy en el <table> durante loading", () => {
    render(<CambiosTabla items={[cambio()]} loading={true} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("aria-busy=false por defecto", () => {
    render(<CambiosTabla items={[cambio()]} />);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "false");
  });
});
