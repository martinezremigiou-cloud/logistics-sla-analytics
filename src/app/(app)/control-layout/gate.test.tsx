// ============================================================
// [2.0.1-B · S] EL GATE DE `/control-layout`, PROBADO — con dos años de retraso.
//
// ────────────────────────────────────────────────────────────
// QUÉ ES ESTO Y QUÉ NO ES.
//
// **No es una reparación: es la guarda que faltaba.** Se midió el gate antes
// de pedir esto y se confirmó que compara contra la cadena exacta
// (`page.tsx:46`, `!== "1"`), igual que el de `/control-estados` (`:93`). O sea
// que aquí no hay exposición viva. Lo que había era una regla servida en
// producción sin nada que la vigilara: si mañana alguien la relajara a «está
// definida», nada se pondría rojo.
//
// Por eso este archivo entra SOLO como prueba. `page.tsx` no se toca: modificar
// código servido es otra decisión, y si algo de aquí saliera rojo sería un
// HALLAZGO que se reporta, no algo que se arregla de pasada.
//
// ────────────────────────────────────────────────────────────
// EL MODO DE FALLO, dicho, porque decide cuánto importa esto.
//
// Las tres copias del valor `"1"` —los dos gates y el arnés
// (`scripts/layout-check.mjs:293`)— fallan hacia el lado SEGURO si se
// desincronizan: si el arnés pusiera otro valor, las dos páginas de control
// darían 404 durante la corrida, sus casos saldrían SIN MEDIR y el veredicto
// sería 2. Nunca un verde falso. Eso es lo que baja la severidad de esta deuda,
// y por eso se dice aquí y no solo en el documento.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sinComentarios } from "@/lib/guardas/codigo-fuente";

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

describe("[2.0.1-B] /control-layout solo existe dentro de una corrida del gate", () => {
  it("SIN la variable: llama a notFound() y no devuelve pantalla", async () => {
    delete process.env.LAYOUT_CHECK;
    const Page = await montar();
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("con un valor QUE NO ES «1» tampoco se sirve", async () => {
    // La mitad que importa: si la comparación fuera «está definida», un
    // `LAYOUT_CHECK=true` heredado de otro proceso serviría en producción una
    // página con defectos plantados a propósito.
    process.env.LAYOUT_CHECK = "true";
    const Page = await montar();
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
  });

  it("CONTROL POSITIVO · con LAYOUT_CHECK=1 la página SÍ se construye", async () => {
    // Sin esta tercera, las dos de arriba pasarían sobre una página que lanza
    // siempre y el gate parecería correcto sin serlo. Es el universo vacío de
    // esta prueba, cerrado.
    process.env.LAYOUT_CHECK = "1";
    const Page = await montar();
    expect(Page()).toBeTruthy();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("no se alcanza desde ninguna navegación", async () => {
    const { NAV_ITEMS } = await import("@/lib/nav");
    expect(NAV_ITEMS.map((i) => i.href)).not.toContain("/control-layout");
    const bottom = readFileSync(join(process.cwd(), "src/components/layout/bottom-nav.tsx"), "utf8");
    expect(bottom).not.toContain("control-layout");
  });
});

describe("[2.0.1-B] las TRES copias del valor de LAYOUT_CHECK dicen lo mismo", () => {
  // El contenido real de la deuda no era «falta una prueba»: es que la cadena
  // `"1"` vive en tres archivos y **nada los ata**, y que `LAYOUT_CHECK` no
  // está en `src/lib/env.ts`, así que ningún validador declara cuál es el valor
  // válido. Esto ata los tres sin tocar una línea de código servido — que es
  // todo lo que un archivo de prueba puede hacer, y es más de lo que había.
  const FUENTES = [
    "src/app/(app)/control-layout/page.tsx",
    "src/app/(app)/control-estados/page.tsx",
    "scripts/layout-check.mjs",
  ];

  it("los dos gates comparan contra la cadena exacta, no contra «está definida»", () => {
    for (const f of ["src/app/(app)/control-layout/page.tsx", "src/app/(app)/control-estados/page.tsx"]) {
      const codigo = readFileSync(join(process.cwd(), f), "utf8");
      expect(codigo, `${f} no compara LAYOUT_CHECK contra "1"`).toMatch(/process\.env\.LAYOUT_CHECK !== ["']1["']/);
    }
  });

  it("y el arnés arranca su server con ESE mismo valor", () => {
    const arnes = readFileSync(join(process.cwd(), "scripts/layout-check.mjs"), "utf8");
    expect(arnes, "el arnés pondría un valor que los gates no reconocen").toMatch(/LAYOUT_CHECK: ["']1["']/);
  });

  it("control positivo · el detector NO pasa sobre una comparación laxa", () => {
    // El troceador que no troceaba: una regex demasiado permisiva daría verde
    // sobre justo la relajación que esto vigila.
    const laxo = 'if (!process.env.LAYOUT_CHECK) { notFound(); }';
    expect(/process\.env\.LAYOUT_CHECK !== ["']1["']/.test(laxo)).toBe(false);
    const estricto = 'if (process.env.LAYOUT_CHECK !== "1") notFound();';
    expect(/process\.env\.LAYOUT_CHECK !== ["']1["']/.test(estricto)).toBe(true);
  });

  /**
   * Quien USA el valor, no quien nombra la variable. La distinción no es
   * cosmética: un comentario que cita `LAYOUT_CHECK=1` para explicar el gate no
   * es una copia de la regla, y `LAYOUT_CHECK_PORT` es OTRA variable — un
   * censo por subcadena las contaba a las dos y ya me dio un rojo falso.
   */
  const USA_EL_VALOR = /process\.env\.LAYOUT_CHECK\b(?!_)|LAYOUT_CHECK:\s*['"]/;


  it("y el conjunto de copias no crece en silencio", () => {
    // Si mañana una cuarta pantalla leyera el valor, esta línea la obliga a
    // pasar por aquí — que es donde está escrito cuál es el válido, a falta de
    // un `src/lib/env.ts` que lo declare.
    const usan: string[] = [];
    const buscar = (dir: string) => {
      for (const e of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) buscar(rel);
        else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (USA_EL_VALOR.test(sinComentarios(readFileSync(join(process.cwd(), rel), "utf8")))) usan.push(rel);
        }
      }
    };
    buscar("src");
    buscar("scripts");
    expect(usan.sort()).toEqual([...FUENTES].sort());
  });

  it("control positivo · el censo separa el USO de la mención y de LAYOUT_CHECK_PORT", () => {
    expect(USA_EL_VALOR.test('if (process.env.LAYOUT_CHECK !== "1") notFound();')).toBe(true);
    expect(USA_EL_VALOR.test("env: { ...process.env, LAYOUT_CHECK: '1' },")).toBe(true);
    expect(USA_EL_VALOR.test("// gateada por LAYOUT_CHECK=1 y sin enlace en el nav")).toBe(false);
    expect(USA_EL_VALOR.test("const PUERTO = Number(process.env.LAYOUT_CHECK_PORT ?? 3210);")).toBe(false);
    // Y la prosa que EXPLICA el gate no es el gate — el rojo que este censo se dio a si mismo.
    expect(USA_EL_VALOR.test(sinComentarios("// lee process.env.LAYOUT_CHECK y ese es el gate"))).toBe(false);
  });
});
