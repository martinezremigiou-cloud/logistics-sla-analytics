import { describe, it, expect } from "vitest";
import { COLORES_SKU, ORDEN_COLORES_SKU, esColorSku, colorSkuInfo, type ColorSku } from "./colores-sku";

const HEX_RE = /^#[0-9A-F]{6}$/i;
const SLUGS_ESPERADOS = ["azul", "verde", "naranja", "morado", "rojo", "turquesa", "rosa", "grafito"] as const;

describe("COLORES_SKU", () => {
  it("expone exactamente los 8 slugs curados (espejo del CHECK/zod)", () => {
    expect(Object.keys(COLORES_SKU).sort()).toEqual([...SLUGS_ESPERADOS].sort());
  });

  it.each(SLUGS_ESPERADOS)("'%s' trae label no vacío y hex válidos en light/dark", (slug) => {
    const info = COLORES_SKU[slug as ColorSku];
    expect(info.label.length).toBeGreaterThan(0);
    expect(info.light).toMatch(HEX_RE);
    expect(info.dark).toMatch(HEX_RE);
  });

  it("light y dark difieren entre sí para cada color (contraste real por tema)", () => {
    for (const slug of SLUGS_ESPERADOS) {
      const info = COLORES_SKU[slug as ColorSku];
      expect(info.light).not.toBe(info.dark);
    }
  });

  it("bgClass sigue el patrón literal bg-[var(--mx-tag-{slug})] para cada color", () => {
    for (const slug of SLUGS_ESPERADOS) {
      expect(COLORES_SKU[slug as ColorSku].bgClass).toBe(`bg-[var(--mx-tag-${slug})]`);
    }
  });

  it("ORDEN_COLORES_SKU contiene los 8 slugs, sin repetidos, y coincide con las claves de COLORES_SKU", () => {
    expect(ORDEN_COLORES_SKU).toHaveLength(8);
    expect(new Set(ORDEN_COLORES_SKU).size).toBe(8);
    expect([...ORDEN_COLORES_SKU].sort()).toEqual(Object.keys(COLORES_SKU).sort());
  });
});

describe("esColorSku", () => {
  it("true para los 8 slugs curados", () => {
    for (const slug of SLUGS_ESPERADOS) {
      expect(esColorSku(slug)).toBe(true);
    }
  });

  it("false para un string que no es un slug curado", () => {
    expect(esColorSku("amarillo")).toBe(false);
    expect(esColorSku("")).toBe(false);
  });
});

describe("colorSkuInfo", () => {
  it("regresa la metadata correcta para un slug válido", () => {
    expect(colorSkuInfo("azul")).toEqual(COLORES_SKU.azul);
  });

  it("regresa null para null/undefined/slug desconocido, sin lanzar", () => {
    expect(colorSkuInfo(null)).toBeNull();
    expect(colorSkuInfo(undefined)).toBeNull();
    expect(colorSkuInfo("no-existe")).toBeNull();
  });
});
