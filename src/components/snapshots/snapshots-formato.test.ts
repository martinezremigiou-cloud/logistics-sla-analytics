import { describe, it, expect } from "vitest";
import { formatoFuente, formatoRegistrosIngeridos, formatoAutor, ENTIDAD_LABELS, TIPO_LABELS } from "./snapshots-formato";

describe("formatoFuente", () => {
  it("'stock' → 'Inventario'", () => {
    expect(formatoFuente("stock")).toBe("Inventario");
  });

  it("'aduana' → 'Embarques'", () => {
    expect(formatoFuente("aduana")).toBe("Embarques");
  });

  it("fuente desconocida → regresa el valor crudo (defensivo)", () => {
    expect(formatoFuente("otra")).toBe("otra");
  });
});

describe("formatoRegistrosIngeridos", () => {
  it("nunca dice 'filas del archivo'", () => {
    expect(formatoRegistrosIngeridos(1846)).not.toMatch(/filas del archivo/i);
  });

  it("formatea con separador de miles y el rótulo 'registros ingeridos'", () => {
    expect(formatoRegistrosIngeridos(1846)).toBe("1,846 registros ingeridos");
  });

  it("0 se muestra explícito (no se confunde con null)", () => {
    expect(formatoRegistrosIngeridos(0)).toBe("0 registros ingeridos");
  });

  it("null → placeholder honesto, no un 0 inventado", () => {
    expect(formatoRegistrosIngeridos(null)).toBe("Registros ingeridos: —");
  });
});

describe("formatoAutor", () => {
  it("created_by null → 'Ingesta automática' (nunca '—')", () => {
    expect(formatoAutor(null)).toBe("Ingesta automática");
    expect(formatoAutor(null)).not.toBe("—");
  });

  it("created_by presente → se muestra tal cual", () => {
    expect(formatoAutor("bridge")).toBe("bridge");
  });
});

describe("ENTIDAD_LABELS / TIPO_LABELS", () => {
  it("cubren las 4 entidades del contrato", () => {
    expect(ENTIDAD_LABELS).toEqual({
      producto: "Producto",
      stock: "Stock",
      reserva: "Reserva",
      embarque: "Embarque",
    });
  });

  it("cubren los 3 tipos del contrato", () => {
    expect(TIPO_LABELS).toEqual({
      ALTA: "Alta",
      BAJA: "Baja",
      MODIFICACION: "Modificación",
    });
  });
});
