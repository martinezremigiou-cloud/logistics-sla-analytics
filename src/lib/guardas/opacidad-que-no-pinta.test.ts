import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * [DASH-F · D-5] `CLASE-QUE-NOMBRA-UN-COLOR-NO-PRUEBA-QUE-PINTE`
 *
 * **El defecto, medido el 17-sep-2026 en el CSS generado del build servido.** Una
 * clase como `bg-brand/85` no produce una declaración inválida: **no produce
 * ninguna**. `.bg-brand\/85` no existe en la hoja. Tailwind necesita los CANALES
 * del color para inyectar el alfa —`hsl(var(--x) / .85)`— y `brand` cuelga de
 * `var(--mx-accent)`, que es un color COMPLETO (`#2E78C7`). Sin canales, la
 * utilidad se descarta en silencio.
 *
 * **Y por eso la caja se comporta perfectamente en todo lo demás:** conserva su
 * alto, su ancho, su sitio y su tooltip. Lo único que le falta es la pintura. Las
 * barras de la tendencia estuvieron invisibles con `verificar` verde, sus propias
 * pruebas verdes y `layout-check` verde — **los tres midieron otra cosa**: las
 * alturas eran correctas, y una caja transparente tiene una geometría impecable.
 *
 * **Lo que hace fácil cometerlo es el nombre.** La clase se llama `bg-brand/85`;
 * leer el nombre SE SIENTE como leer el color. Un nombre de clase es una
 * intención, no un resultado.
 *
 * ---
 *
 * **POR QUÉ ESTA GUARDA NO MIRA EL COLOR COMPUTADO.** Tendría que correr en un
 * navegador sobre el CSS generado: en jsdom no hay hoja de Tailwind y **todo sale
 * transparente**, así que una guarda así daría rojo siempre — o se escribiría
 * tolerante y daría verde siempre. Lo que se comprueba aquí es el MECANISMO, que
 * es determinista: *una clase de color con modificador de opacidad cuyo token
 * base sea un color completo no se emite*. Esa regla **se verificó a grado (c)**
 * el 17-sep contra el CSS del build: las **ocho** clases que el navegador no
 * pintaba cuelgan todas de `var(--mx-*)`, y las **trece** que sí pintaba cuelgan
 * de `hsl(var(--x))` (canales) o de un literal. Cero excepciones en las dos
 * direcciones.
 *
 * **Es un TRINQUETE, no una prohibición.** Los usos que ya existían viven en ocho
 * territorios de cuatro frentes distintos y no se arreglan desde aquí: se
 * enumeran, con su dueño, y **el número no puede subir**.
 */

const RAIZ = process.cwd();
const TW = readFileSync(join(RAIZ, "tailwind.config.ts"), "utf8");

/** Las familias de utilidades cuyo valor ES un color y por tanto admiten `/NN`. */
const PREFIJOS = ["bg", "text", "border", "ring", "fill", "stroke", "divide", "outline", "placeholder", "decoration", "caret", "accent", "shadow"];

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, acc);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acc.push(ruta);
  }
  return acc;
}

export interface UsoDeOpacidad {
  archivo: string;
  clase: string;
  utilidad: string;
  valorDelToken: string | null;
}

/**
 * El valor que `tailwind.config.ts` le da a una utilidad de color.
 *
 * `bg-brand` → `brand.DEFAULT` → `"var(--mx-accent)"`. `text-ink-muted` →
 * `ink.muted`. Devuelve `null` cuando la familia no está en el config, que es el
 * caso de la paleta propia de Tailwind (`white`, `black`, `slate-500`…): ésas
 * traen canales y admiten el modificador.
 */
export function valorDeUtilidad(utilidad: string): string | null {
  const sinPrefijo = utilidad.replace(new RegExp(`^(${PREFIJOS.join("|")})-`), "");
  const partes = sinPrefijo.split("-");
  for (let corte = partes.length; corte >= 1; corte--) {
    const familia = partes.slice(0, corte).join("-");
    const clave = partes.slice(corte).join("-") || "DEFAULT";
    const bloque = TW.match(new RegExp(`\\b${familia}:\\s*\\{([^}]*)\\}`));
    if (!bloque) {
      // Familia sin sub-claves: `border: "hsl(var(--border))"`.
      const plano = TW.match(new RegExp(`\\b${familia}:\\s*"([^"]+)"`));
      if (plano && corte === partes.length) return plano[1];
      continue;
    }
    const par = bloque[1].match(new RegExp(`(?:^|[{,\\s])${clave}:\\s*"([^"]+)"`));
    if (par) return par[1];
  }
  return null;
}

/**
 * ¿Ese valor admite que Tailwind le inyecte un alfa?
 *
 * Sí cuando trae los CANALES sueltos —`hsl(var(--x))`, `rgb(var(--x))`— o cuando
 * es un literal que Tailwind sabe descomponer. **No cuando es un `var()` a secas**,
 * porque ahí la variable contiene un color completo y no hay canales que separar.
 */
export function admiteAlfa(valor: string | null): boolean {
  if (valor === null) return true; // paleta propia de Tailwind
  if (/^(hsl|rgb)a?\(\s*var\(/.test(valor)) return true;
  if (/^var\(/.test(valor)) return false;
  return true; // hex, rgb(...), hsl(...) literales
}

/**
 * El contenido de las CADENAS del archivo, saltándose comentarios.
 *
 * **Hace falta, y lo descubrió esta misma guarda cazándose a sí misma.** El
 * comentario que explica este defecto en `dashboard-tendencia.tsx` cita la clase
 * mala en prosa, así que un barrido sobre el texto crudo contaba la EXPLICACIÓN
 * del defecto como un ejemplar suyo. Es P34 exacto: *el parser lee el TEXTO, y un
 * comentario es texto*.
 *
 * **No se usa `sinComentarios` de `codigo-fuente.ts` a propósito:** tiene el
 * defecto abierto `STRIPPER-DE-FUENTE-SE-COME-DESDE-UN-BLOQUE-FALSO` —quita los
 * bloques ANTES que las líneas, así que una apertura de bloque dentro de un
 * comentario de línea abre uno falso que no cierra hasta mucho después— y para un
 * TRINQUETE ése es el peor fallo posible: se comería usos reales y la guarda
 * saldría verde sin haber leído nada.
 *
 * Éste recorre carácter a carácter con tres estados, así que ni un comentario
 * dentro de una cadena ni una cadena dentro de un comentario lo confunden. Y
 * devuelve SOLO cadenas porque una clase de Tailwind siempre vive en una: prosa
 * que la nombre no cuenta.
 */
export function cadenasDe(fuente: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < fuente.length) {
    const c = fuente[i];
    const d = fuente[i + 1];
    if (c === "/" && d === "/") {
      while (i < fuente.length && fuente[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < fuente.length && !(fuente[i] === "*" && fuente[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const cierre = c;
      i++;
      let buf = "";
      while (i < fuente.length && fuente[i] !== cierre) {
        if (fuente[i] === "\\") {
          buf += fuente[i + 1] ?? "";
          i += 2;
          continue;
        }
        buf += fuente[i];
        i++;
      }
      i++;
      out.push(buf);
    } else {
      i++;
    }
  }
  return out;
}

/** Todos los usos de un modificador de opacidad sobre una clase de color, en el árbol. */
export function usosDeOpacidad(): UsoDeOpacidad[] {
  const re = new RegExp(`\\b((?:${PREFIJOS.join("|")})-[a-z0-9-]+)\\/([0-9]{1,3})\\b`, "g");
  const out: UsoDeOpacidad[] = [];
  for (const ruta of archivosFuente(join(RAIZ, "src"))) {
    const texto = cadenasDe(readFileSync(ruta, "utf8")).join("\n");
    for (const m of Array.from(texto.matchAll(re))) {
      const utilidad = m[1];
      out.push({
        archivo: ruta.slice(RAIZ.length + 1).replace(/\\/g, "/"),
        clase: `${utilidad}/${m[2]}`,
        utilidad,
        valorDelToken: valorDeUtilidad(utilidad),
      });
    }
  }
  return out;
}

/**
 * **EL TRINQUETE.** Los usos que ya existían el 17-sep-2026, con su dueño. Ninguno
 * es del frente de Dashboard: el único que lo era —`bg-brand/85`, la barra de la
 * tendencia— se arregló en este mismo cambio, y por eso no está en la lista.
 *
 * **No se arreglan desde aquí y se dice por qué:** viven en `app/`, `chat`,
 * `cruce`, `embarques`, `layout`, `pendientes`, `proyectos`, `shared` y
 * `snapshots` — territorio de otros frentes, y `components/proyectos/**` está
 * explícitamente vetado para éste. Quedan en el buzón y en la deuda con su
 * medición.
 */
const CONOCIDOS: Record<string, number> = {
  "src/app/error.tsx": 1,
  "src/app/not-found.tsx": 1,
  "src/components/chat/burbuja-chat.tsx": 2,
  "src/components/cruce/pipeline-aduana.tsx": 1,
  "src/components/embarques/embarques-filtros.tsx": 2,
  "src/components/layout/topbar.tsx": 1,
  "src/components/pendientes/pendiente-acciones.tsx": 1,
  "src/components/proyectos/proyecto-partidas.tsx": 1,
  "src/components/shared/chip-filtro-activo.tsx": 1,
  "src/components/shared/estado-carga.tsx": 1,
  "src/components/shared/page-placeholder.tsx": 1,
  "src/components/snapshots/snapshot-fila.tsx": 1,
};
const TOTAL_CONOCIDO = Object.values(CONOCIDOS).reduce((a, b) => a + b, 0);

describe("[DASH-F · D-5] una clase de color con /NN que no se emite — el trinquete", () => {
  const rotos = usosDeOpacidad().filter((u) => !admiteAlfa(u.valorDelToken));

  it("EL NÚMERO NO PUEDE SUBIR: ningún archivo estrena un modificador que no pinta", () => {
    const porArchivo: Record<string, number> = {};
    for (const r of rotos) porArchivo[r.archivo] = (porArchivo[r.archivo] ?? 0) + 1;

    const nuevos = Object.keys(porArchivo).filter((a) => !(a in CONOCIDOS));
    expect(
      nuevos,
      `archivos que estrenan una clase de opacidad que NO SE EMITE:\n` +
        nuevos.map((a) => `  ${a}: ${rotos.filter((r) => r.archivo === a).map((r) => r.clase).join(", ")}`).join("\n"),
    ).toEqual([]);

    for (const [archivo, tope] of Object.entries(CONOCIDOS)) {
      expect(porArchivo[archivo] ?? 0, `${archivo} subió de ${tope}`).toBeLessThanOrEqual(tope);
    }
    expect(rotos.length, "el total de clases que no pintan subió").toBeLessThanOrEqual(TOTAL_CONOCIDO);
  });

  it("el frente de DASHBOARD no tiene ninguna: la barra de la tendencia se arregló aquí", () => {
    const mias = rotos.filter((r) => r.archivo.startsWith("src/components/dashboard/"));
    expect(mias.map((m) => `${m.archivo} · ${m.clase}`)).toEqual([]);
  });

  // CONTROL POSITIVO. Sin esto, las dos de arriba podrían estar pasando porque el
  // clasificador dice «admite alfa» de todo, y nunca sabría nadie.
  it("CONTROL POSITIVO · el clasificador SEPARA, y lo hace igual que lo midió el navegador", () => {
    // Las ocho que el navegador NO pintaba el 17-sep, contra el CSS generado.
    for (const u of ["bg-brand", "text-ink", "border-warn", "bg-surface-3", "bg-info", "border-brand"]) {
      expect(admiteAlfa(valorDeUtilidad(u)), `${u} debería clasificarse como que NO admite alfa`).toBe(false);
    }
    // Las que SÍ pintaba: shadcn con canales, y la paleta propia de Tailwind.
    for (const u of ["bg-primary", "bg-muted", "bg-secondary", "bg-destructive"]) {
      expect(admiteAlfa(valorDeUtilidad(u)), `${u} debería clasificarse como que SÍ admite alfa`).toBe(true);
    }
    for (const u of ["bg-black", "text-white", "bg-navy-700", "bg-danger"]) {
      expect(admiteAlfa(valorDeUtilidad(u)), `${u} debería clasificarse como que SÍ admite alfa`).toBe(true);
    }
  });

  it("CONTROL POSITIVO · el barrido ENCUENTRA usos: si no leyera nada, todo saldría verde", () => {
    const todos = usosDeOpacidad();
    expect(todos.length, "el barrido no encontró ni un modificador de opacidad en todo el árbol").toBeGreaterThan(20);
    expect(rotos.length, "se esperaba encontrar los usos conocidos que no pintan").toBeGreaterThan(0);
  });

  it("la barra de la tendencia declara un color, y NO por un modificador que no se emite", () => {
    const fuente = readFileSync(join(RAIZ, "src/components/dashboard/dashboard-tendencia.tsx"), "utf8");
    // Se busca en las CADENAS, no en la prosa: el comentario que explica el defecto
    // cita la clase mala a propósito, y una guarda que la contara estaría midiendo
    // su propia explicación (P34).
    const cadenas = cadenasDe(fuente);

    // Lo que de verdad importa: que no vuelva un modificador sobre esta familia.
    expect(
      cadenas.some((c) => /\bbg-brand\/\d/.test(c)),
      "la barra volvió a llevar un modificador que no se emite",
    ).toBe(false);

    // Y que siga teniendo color POR ALGUNA VÍA.
    //
    // **Esta mitad estaba sobre-especificada y D-6 la puso en rojo el mismo día.**
    // Afirmaba literalmente `bg-brand`, o sea UN MECANISMO concreto; cuando D-6 movió
    // el color a un `style` en línea —porque ahora depende de la dirección de la
    // tendencia y se elige en tiempo de render— la guarda denunció «la barra perdió
    // su color» sobre una barra que pintaba perfectamente. Una guarda que fija la
    // implementación en vez de la propiedad denuncia los cambios correctos, y eso
    // acaba enseñando a ignorarla.
    const tieneColor =
      cadenas.some((c) => /\bbg-(brand|accent)\b/.test(c)) || /backgroundColor:\s*`var\(/.test(fuente);
    expect(tieneColor, "la barra no declara color ni por clase ni por estilo").toBe(true);
  });
});
