/**
 * Utilidad DE PRUEBAS: resuelve una clase de Tailwind a su hex real y calcula
 * contraste WCAG. No la importa ningún componente — vive aquí por territorio
 * (`components/dashboard/**`) y por el sufijo `.testutil` para que nadie la
 * confunda con código de producción.
 *
 * **Por qué existe, con nombre y ejemplar.** La primera versión del trinquete de
 * contraste del riel vetaba UN VALOR POR NOMBRE:
 *
 * ```ts
 * expect(clase).toContain("border-ink-muted");
 * expect(clase).not.toContain("border-ink-muted3");
 * ```
 *
 * La revisión adversaria lo rompió en un intento: **`border-ink-muted2` mide
 * 2,56:1 y pasa las DOS aserciones** — contiene la subcadena exigida y no es la
 * prohibida. Es P20 exacto, *un umbral que no separa*: la prueba enumeraba un
 * tono malo conocido en vez de comprobar la propiedad que importa.
 *
 * Aquí la propiedad se comprueba: se lee la clase que el componente REALMENTE
 * puso, se resuelve a su token, se busca el hex en `globals.css` y se calcula la
 * razón. Un tono nuevo que no cumpla sale rojo aunque nadie lo haya previsto.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();
const CSS = readFileSync(join(raiz, "src/app/globals.css"), "utf8");
const TW = readFileSync(join(raiz, "tailwind.config.ts"), "utf8");

export type Tema = "claro" | "oscuro";

function bloqueDeTema(tema: Tema): string {
  const re = tema === "claro" ? /:root\s*\{[\s\S]*?\n\s*\}/ : /\.dark\s*\{[\s\S]*?\n\s*\}/;
  const m = CSS.match(re);
  if (!m) throw new Error(`no se pudo aislar el bloque de tokens ${tema} en globals.css`);
  return m[0];
}
const BLOQUE: Record<Tema, string> = { claro: bloqueDeTema("claro"), oscuro: bloqueDeTema("oscuro") };

/** El hex de un token `--mx-*` en un tema. Falla ruidosamente si el token desapareció. */
export function hexDeToken(token: string, tema: Tema): string {
  const m = BLOQUE[tema].match(new RegExp(`--${token}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`el token --${token} ya no está en el bloque ${tema} de globals.css`);
  return m[1];
}

/**
 * `ink-muted` → `--mx-muted`. El mapa NO se escribe aquí: se LEE de
 * `tailwind.config.ts`, porque una copia del mapa sería una segunda verdad sobre
 * el mismo hecho — el patrón que este repo ya pagó con `piezas_en_camino`.
 */
export function tokenDeColor(color: string): string {
  const [familia, ...resto] = color.split("-");
  const sufijo = resto.join("-");
  const m = TW.match(new RegExp(`\\b${familia}:\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`la familia de color \`${familia}\` no está en tailwind.config.ts`);
  const clave = sufijo === "" ? "DEFAULT" : sufijo;
  const par = m[1].match(new RegExp(`(?:^|[{,\\s])${clave}:\\s*"var\\(--([a-z0-9-]+)\\)"`));
  if (!par) throw new Error(`\`${familia}.${clave}\` no existe en tailwind.config.ts o no apunta a un var(--mx-*)`);
  return par[1];
}

/** `border-ink-muted` → `#64748B` en claro. Acepta cualquier utilidad de color de Tailwind. */
export function hexDeClase(clase: string, tema: Tema): string {
  const color = clase.replace(/^(?:border|bg|text|ring|ring-offset|fill|stroke)-/, "");
  return hexDeToken(tokenDeColor(color), tema);
}

/**
 * De una lista de clases, la primera que empiece por ese prefijo. Devuelve
 * `undefined` si no hay ninguna — quien llama decide si eso es un fallo, porque
 * «no hay clase» y «hay una clase mala» son dos defectos distintos.
 */
export function claseConPrefijo(className: string, prefijo: string): string | undefined {
  return className.split(/\s+/).find((c) => c.startsWith(prefijo));
}

/**
 * Como `claseConPrefijo`, pero descarta las utilidades de TAMAÑO que comparten
 * prefijo con las de COLOR. En Tailwind `ring-offset-2` (ancho) y
 * `ring-offset-surface-app` (color) empiezan igual, y `ring-2` y `ring-brand`
 * también: quedarse con la primera coincidencia devuelve el ancho y luego intenta
 * resolverlo como si fuera un color. La primera versión de esta prueba se cayó por
 * ahí, con el componente correcto — el instrumento acusándose a sí mismo.
 */
export function claseDeColorConPrefijo(className: string, prefijo: string): string | undefined {
  return className
    .split(/\s+/)
    .filter((c) => c.startsWith(prefijo))
    .find((c) => !/^\d+(\.\d+)?$/.test(c.slice(prefijo.length)));
}

/**
 * `"var(--mx-navy-ink)"` → `"mx-navy-ink"`. Los rellenos del riel NO van como clase
 * de Tailwind sino como `var()` en un estilo en línea, y es deliberado: son seis
 * valores elegidos por dato, el JIT de Tailwind no genera clases construidas en
 * tiempo de ejecución, y una `var()` ya se invierte sola con el tema. Mismo patrón
 * que `RADAR_COLORES`, que también pasa `var(--mx-*)` directo.
 */
export function tokenDeEstilo(valor: string): string | undefined {
  return valor.match(/var\(\s*--([a-z0-9-]+)\s*\)/)?.[1];
}

/**
 * La tinta EFECTIVA de un nodo: la clase `text-<familia>` más cercana subiendo por
 * los ancestros. El color casi nunca está en la hoja — `text-ink-muted2` vivía en
 * un `<div>` y los `<span>` de dentro no llevaban clase, así que mirar solo la hoja
 * devolvía cero tintas y la prueba salía verde sin medir nada (P19).
 *
 * Devuelve `undefined` cuando ningún ancestro declara una tinta de la familia
 * `--mx-*` — y eso NO es «no hay problema»: es «esta prueba no puede medir este
 * texto», que es lo que pasa con `text-muted-foreground`, el token de shadcn que
 * reprueba 3,61:1 en tema oscuro. Quien llama decide, y debería fallar.
 */
export function tintaHeredada(el: HTMLElement, raiz: HTMLElement, prefijo = "text-ink"): string | undefined {
  let n: HTMLElement | null = el;
  while (n && n !== raiz.parentElement) {
    const t = claseConPrefijo(typeof n.className === "string" ? n.className : "", prefijo);
    if (t) return t;
    n = n.parentElement;
  }
  return undefined;
}

/** Los textos de un subárbol, hoja por hoja: nodos sin hijos elemento y con texto. */
export function hojasDeTexto(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>("*")).filter(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0,
  );
}

function lineal(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => lineal(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** Razón de contraste de WCAG 2.x. Simétrica: el orden de los argumentos no importa. */
export function razonDeContraste(a: string, b: string): number {
  const [alta, baja] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alta + 0.05) / (baja + 0.05);
}

/**
 * `--mx-heat-rgb` es el único token que se declara como COMPONENTES sueltos
 * (`46 120 199`, sin `#`) porque se consume dentro de `rgb(var(…) / alpha)`.
 */
export function hexDeHeatRgb(tema: Tema): string {
  const m = BLOQUE[tema].match(/--mx-heat-rgb:\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)/);
  if (!m) throw new Error(`--mx-heat-rgb ya no está en el bloque ${tema} de globals.css`);
  return "#" + m.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
}

/**
 * El color RESULTANTE de pintar `frente` con opacidad `alpha` sobre `fondo`.
 *
 * Se mezcla en sRGB sin linearizar, que es lo que hace el navegador al componer, y
 * es la única forma de medir un texto sobre un fondo semitransparente: medirlo
 * contra el token «puro» seria medir un color que en pantalla no existe (P27).
 */
export function mezclarAlfa(frente: string, fondo: string, alpha: number): string {
  const comp = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, b] = [comp(frente), comp(fondo)];
  return "#" + f.map((v, i) => Math.round(alpha * v + (1 - alpha) * b[i]).toString(16).padStart(2, "0")).join("");
}

/** La razón entre dos CLASES de Tailwind, en un tema. El atajo que usan las pruebas del riel. */
export function contrasteEntreClases(a: string, b: string, tema: Tema): number {
  return razonDeContraste(hexDeClase(a, tema), hexDeClase(b, tema));
}

export const TEMAS: readonly Tema[] = ["claro", "oscuro"];

// ============================================================
// [DASH-F · D-2] CIELAB — para las dos preguntas que la razón de contraste NO contesta.
//
// La razón de contraste mide LEGIBILIDAD: texto sobre fondo. Esta rampa necesita
// contestar otras dos, y usar el instrumento de al lado sería P27:
//
//   · «¿se puede confundir este tono con OTRO significado de la pantalla?» — entre
//     colores de matiz distinto, ΔL* no separa: dos tonos pueden compartir L* y ser
//     opuestos en el círculo. Su métrica es ΔE2000, sobre el Lab COMPLETO.
//   · «¿esto se lee como un COLOR o como un gris?» — su métrica es el croma C*.
//
// ΔL* sigue sirviendo para lo suyo —separar pasos DEL MISMO matiz— y no se toca.
// ============================================================

/** sRGB → XYZ (D65) → CIELAB. */
export function lab(hex: string): [number, number, number] {
  const lineal = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = [1, 3, 5].map((i) => lineal(parseInt(hex.slice(i, i + 2), 16) / 255));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** C* de CIELAB: cuánto COLOR tiene un tono. Un gris da 0 por muy claro u oscuro que sea. */
export function croma(hex: string): number {
  const [, a, b] = lab(hex);
  return Math.hypot(a, b);
}

/** ΔE2000 — la métrica estándar de «¿son dos colores distintos?». */
export function deltaE2000(h1: string, h2: string): number {
  const [L1, a1, b1] = lab(h1);
  const [L2, a2, b2] = lab(h2);
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const ap1 = (1 + G) * a1;
  const ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1);
  const Cp2 = Math.hypot(ap2, b2);
  const angulo = (a: number, b: number) => {
    if (a === 0 && b === 0) return 0;
    const d = (Math.atan2(b, a) * 180) / Math.PI;
    return d >= 0 ? d : d + 360;
  };
  const hp1 = angulo(ap1, b1);
  const hp2 = angulo(ap2, b2);
  const dLp = L2 - L1;
  const dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) {
    dhp = hp2 - hp1;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360);
  const Lb = (L1 + L2) / 2;
  const Cpb = (Cp1 + Cp2) / 2;
  let hpb: number;
  if (Cp1 * Cp2 === 0) hpb = hp1 + hp2;
  else {
    hpb = (hp1 + hp2) / 2;
    if (Math.abs(hp1 - hp2) > 180) hpb += hp1 + hp2 < 360 ? 180 : -180;
  }
  const T =
    1 -
    0.17 * Math.cos(((hpb - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hpb * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hpb + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hpb - 63) * Math.PI) / 180);
  const dTh = 30 * Math.exp(-Math.pow((hpb - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cpb, 7) / (Math.pow(Cpb, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
  const Sc = 1 + 0.045 * Cpb;
  const Sh = 1 + 0.015 * Cpb * T;
  const Rt = -Math.sin((2 * dTh * Math.PI) / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) + Math.pow(dCp / Sc, 2) + Math.pow(dHp / Sh, 2) + Rt * (dCp / Sc) * (dHp / Sh),
  );
}
