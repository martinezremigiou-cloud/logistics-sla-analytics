// ============================================================
// [2.0.1-B · S-1] EL GATE DE `/control-estados`, PROBADO.
//
// Condición (1) acordada: «el gate se prueba — sin `LAYOUT_CHECK=1` responde
// `notFound()`, con su control positivo, igual que `/control-layout`».
//
// ⚠ Y de paso queda dicho un hueco que esto destapa: **`/control-layout` NO
// tiene esta prueba.** Su gate es del mismo tipo y vive sin guarda desde
// 2.0.1-A; nadie ha comprobado nunca que un entorno sin la variable lo esconda
// de verdad. No se arregla aquí —es otro archivo y otro carril— pero tampoco se
// deja sin nombrar: va como deuda GATE-DE-CONTROL-LAYOUT-SIN-PRUEBA.
//
// Por qué importa que el modo de fallo sea `notFound()` y no una página vacía:
// una ruta de instrumento servida en producción es superficie que nadie audita.
// Y al revés, si el arnés olvidara la variable, los casos salen no medidos en
// vez de verdes — el error cae del lado seguro en las dos direcciones.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound }));

const original = process.env.LAYOUT_CHECK;

beforeEach(() => {
  notFound.mockClear();
  vi.resetModules();
});
afterEach(() => {
  if (original === undefined) delete process.env.LAYOUT_CHECK;
  else process.env.LAYOUT_CHECK = original;
});

async function montar() {
  const mod = await import("./page");
  return mod.default;
}

describe("[2.0.1-B] /control-estados solo existe dentro de una corrida del gate", () => {
  it("SIN la variable: llama a notFound() y no devuelve pantalla", async () => {
    delete process.env.LAYOUT_CHECK;
    const Page = await montar();
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("con la variable en un valor QUE NO ES «1» tampoco se sirve", async () => {
    // El gate compara contra la cadena exacta. Un `LAYOUT_CHECK=true` heredado
    // de otro proceso no debe abrir la ruta: si la comparación fuera
    // «está definida», cualquier valor la serviría en producción.
    process.env.LAYOUT_CHECK = "true";
    const Page = await montar();
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
  });

  it("CONTROL POSITIVO · con LAYOUT_CHECK=1 la página SÍ se construye", async () => {
    // Sin esta mitad las dos de arriba pasarían con una página que siempre
    // lanza —o que no existe— y el gate parecería correcto sin serlo. Es la
    // prueba de vacuidad de este archivo.
    process.env.LAYOUT_CHECK = "1";
    const Page = await montar();
    const arbol = Page();
    expect(notFound).not.toHaveBeenCalled();
    expect(arbol).toBeTruthy();
  });

  it("no se alcanza desde ninguna navegación", async () => {
    // Condición (2) acordada. Misma regla que `/control-layout`: enlazar un
    // instrumento en el menú sería el reverso de P7 — prometer un destino que
    // no es del producto.
    const { NAV_ITEMS } = await import("@/lib/nav");
    expect(NAV_ITEMS.map((i) => i.href)).not.toContain("/control-estados");
    // Y tampoco por la barra móvil, que es una SEGUNDA lista de etiquetas
    // (la quinta superficie que R-2 descubrió). Se lee del fuente con la misma
    // raíz que el resto de las guardas del repo.
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const bottom = readFileSync(join(process.cwd(), "src/components/layout/bottom-nav.tsx"), "utf8");
    expect(bottom).not.toContain("control-estados");
  });
});
