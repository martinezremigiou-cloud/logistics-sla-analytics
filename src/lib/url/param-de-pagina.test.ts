// ============================================================
// [FIX-B1] `paramDePagina` decodifica EXACTAMENTE una vez el segmento
// dinámico de una página, y no cero ni dos.
//
// La segunda mitad es una ALARMA, no una prueba de `paramDePagina`: lee
// el propio Next.js de `node_modules` y exige que siga re-codificando
// `params` como lo medimos (app-render.js:117). Si una actualización de
// Next dejara de hacerlo, esta función pasaría a decodificar de más y el
// caso volvería a romperse por el lado contrario — la alarma es la forma
// de que eso no pase en silencio.
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paramDePagina } from "./param-de-pagina";

describe("paramDePagina", () => {
  it("decodifica un segmento con '/' codificado (SKU '01654365/3225')", () => {
    expect(paramDePagina("01654365%2F3225")).toBe("01654365/3225");
  });

  it("decodifica espacios, ':' y paréntesis", () => {
    expect(paramDePagina("NVHD4417T2%20(GPS)")).toBe("NVHD4417T2 (GPS)");
    expect(paramDePagina("PAULA%3A%20CAMBIA%20ZU7191-R%20MP0872-R")).toBe("PAULA: CAMBIA ZU7191-R MP0872-R");
  });

  it("un valor sin escapes queda igual (no hay nada que decodificar)", () => {
    expect(paramDePagina("GFTDL7362")).toBe("GFTDL7362");
  });

  it("un '%' suelto que no es un escape válido no revienta: se conserva tal cual", () => {
    // decodeURIComponent('100% off') lanza URIError — el caso que el
    // try/catch existe para cubrir, aunque no sea un caso real de SKU.
    expect(paramDePagina("100% off")).toBe("100% off");
  });
});

describe("[FIX-B1] alarma — Next sigue re-codificando `params` en páginas", () => {
  it("app-render.js todavía trae `value = encodeURIComponent(value);` (línea que motiva este helper)", () => {
    const ruta = join(process.cwd(), "node_modules", "next", "dist", "server", "app-render", "app-render.js");
    const contenido = readFileSync(ruta, "utf-8");
    expect(
      contenido,
      "Next dejó de re-codificar params de página: paramDePagina() ya decodificaría de más — revisar si el helper sigue haciendo falta",
    ).toMatch(/value = encodeURIComponent\(value\);/);
  });

  // [F3] La prueba de arriba vigila el FUENTE de desarrollo (`app-render.js`,
  // sin minificar) — pero lo que Vercel EJECUTA en producción es el bundle
  // compilado, minificado, con los nombres de variable cambiados (`value`
  // pasa a ser `o`, por ejemplo). Un revisor midió en 14.2.35:
  // `"string"==typeof o&&(o=encodeURIComponent(o))`. El nombre `o` no es el
  // invariante — es un identificador minificado que puede cambiar entre
  // builds del mismo Next sin que el mecanismo cambie. Lo que importa es la
  // FORMA: un chequeo de tipo string seguido de reasignar la variable a su
  // propio `encodeURIComponent`. Por eso la regex es sobre la forma
  // (`\w+` en las tres posiciones), no sobre el nombre literal `o`.
  it("el BUNDLE de producción (el que ejecuta Vercel) también re-codifica — mismo mecanismo, nombres minificados", () => {
    const ruta = join(
      process.cwd(),
      "node_modules",
      "next",
      "dist",
      "compiled",
      "next-server",
      "app-page.runtime.prod.js",
    );
    const contenido = readFileSync(ruta, "utf-8");
    const patron = /typeof \w+&&\(\w+=encodeURIComponent\(\w+\)\)/g;
    const coincidencias = contenido.match(patron) ?? [];
    expect(
      coincidencias.length,
      "El bundle de producción dejó de traer el patrón `typeof X&&(X=encodeURIComponent(X))` " +
        "(medido: 1 coincidencia en next@14.2.35) — revisar si Next sigue re-codificando params " +
        "en el runtime que corre en Vercel",
    ).toBe(1);
  });
});
