import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DashboardPipelineEtapa } from "@/types/api";
import { agruparPipeline } from "@/services/dashboard.service";
import { ICONO_POR_ORDEN } from "@/components/cruce/pipeline-aduana";
import { claseConPrefijo, claseDeColorConPrefijo, contrasteEntreClases, hexDeToken, razonDeContraste, tokenDeEstilo, TEMAS } from "./contraste.testutil";
import { altoDelBloque, DashboardRielEmbarques, ordenDelIcono } from "./dashboard-pipeline";

const NOMBRES = [
  "Producto Solicitado",
  "En Preparación",
  "En Recolección",
  "En Almacén FW",
  "En Tránsito Aéreo",
  "En Tránsito Marítimo",
  "En Aduana",
  "En Tránsito Terrestre",
  "En Almacén Fiscal",
  "En Almacén North",
  "Producto Disponible",
];

function pipelineVacio(): DashboardPipelineEtapa[] {
  return NOMBRES.map((nombre, i) => ({ orden: i + 1, nombre, activos: 0, piezas: 0 }));
}

/**
 * `piezas` NO es múltiplo de `activos`, y es deliberado. La primera versión de
 * este fixture hacía `piezas = activos * 10`, y con eso «67» era subcadena de
 * «670»: un componente que pintara PIEZAS donde debe pintar EMBARQUES pasaba la
 * prueba. El fixture probaba mi comprensión, no el código (P26).
 */
function pipelineCon(activosPorOrden: Record<number, number>): DashboardPipelineEtapa[] {
  return pipelineVacio().map((e) =>
    activosPorOrden[e.orden] === undefined ? e : { ...e, activos: activosPorOrden[e.orden], piezas: activosPorOrden[e.orden] * 10 + 7 },
  );
}

function pintar(pipeline: DashboardPipelineEtapa[]) {
  return render(<DashboardRielEmbarques pipeline={pipeline} grupos={agruparPipeline(pipeline)} />);
}

function grupo(container: HTMLElement, clave: string): HTMLElement {
  const el = container.querySelector(`[data-grupo="${clave}"]`);
  if (!el) throw new Error(`no hay grupo ${clave} en el riel`);
  return el as HTMLElement;
}

/** El bloque de un grupo: el enlace, no el envoltorio. */
function bloque(container: HTMLElement, clave: string): HTMLElement {
  return within(grupo(container, clave)).getByRole("link");
}

/** Los tokens `lucide-*` del `<svg>`, que identifican QUÉ ícono se dibujó — no cómo se dimensionó. */
function iconoDe(el: HTMLElement): string {
  const svg = el.querySelector("svg");
  if (!svg) throw new Error("el bloque no dibujó ningún ícono");
  return ((svg.getAttribute("class") ?? "").match(/lucide-[a-z0-9-]+/g) ?? []).join(" ");
}

/** El mismo ícono, a solas, para comparar contra el del riel sin depender del nombre que le ponga lucide. */
function iconoEsperado(orden: number): string {
  const Icono = ICONO_POR_ORDEN[orden];
  const { container } = render(<Icono />);
  return iconoDe(container as HTMLElement);
}

describe("DashboardRielEmbarques", () => {
  it("pinta los 6 grupos, cada uno con su rótulo FUERA del bloque", () => {
    const { container } = pintar(pipelineVacio());

    for (const clave of ["importacion", "transito_intl", "aduana", "transito_terrestre", "almacenes", "disponible"]) {
      expect(grupo(container, clave)).toBeInTheDocument();
    }
    for (const nombre of ["Importación", "Tránsito internacional", "Aduana", "Tránsito terrestre", "Almacenes", "Disponible"]) {
      expect(screen.getByText(nombre)).toBeInTheDocument();
    }
  });

  // Texto EXACTO, no `toHaveTextContent`, que compara por SUBCADENA: con subcadena,
  // pintar `piezas` (684) donde va `activos` (67) pasaba la prueba.
  it("dentro del bloque van SOLO el ícono y la cifra, y la cifra es Σ de activos — exacta, no subcadena", () => {
    const { container } = pintar(pipelineCon({ 1: 9, 2: 58 })); // Importación = 1..4 ⇒ 67 activos, 684 piezas

    expect(bloque(container, "importacion").textContent?.trim()).toBe("67");
    // Y un grupo sin actividad enseña su CERO: cero visible, no fabricado.
    expect(bloque(container, "aduana").textContent?.trim()).toBe("0");
  });

  it("ninguna etapa se pierde: las 11 siguen nombradas, cada una en el detalle de su grupo", () => {
    const { container } = pintar(pipelineVacio());

    expect(within(grupo(container, "almacenes")).getByText("En Almacén Fiscal")).toBeInTheDocument();
    expect(within(grupo(container, "almacenes")).getByText("En Almacén North")).toBeInTheDocument();
    for (const nombre of NOMBRES) {
      expect(screen.getByText(nombre)).toBeInTheDocument();
    }
  });

  it("CONTROL POSITIVO · una etapa 12 sin mapear cae NOMBRADA en «Sin grupo asignado», no desaparece", () => {
    const doce = [...pipelineVacio(), { orden: 12, nombre: "Etapa Nueva", activos: 7, piezas: 77 }];
    const { container } = pintar(doce);

    expect(within(grupo(container, "sin_grupo")).getByText("Etapa Nueva")).toBeInTheDocument();
    expect(bloque(container, "sin_grupo").textContent?.trim()).toBe("7");
    expect(screen.getByText("Sin grupo asignado")).toBeInTheDocument();
  });

  // `sin_clasificar` es el TERCER valor de la gramática y el riel tiene que
  // dibujarlo como tercero. La versión anterior le ponía `border-dashed` sobre un
  // borde `transparent`: con el grupo VIVO los guiones eran invisibles y el bloque
  // salía idéntico a un `estancia`. La marca existía justo cuando no importaba.
  it("un grupo SIN GRAMÁTICA no se disfraza de estancia, ni aunque tenga actividad", () => {
    const doce = [...pipelineVacio(), { orden: 12, nombre: "Etapa Nueva", activos: 7, piezas: 77 }];
    const conCarga = doce.map((e) => (e.orden === 1 ? { ...e, activos: 5, piezas: 57 } : e));
    const { container } = pintar(conCarga);

    const sin = bloque(container, "sin_grupo");
    const estancia = bloque(container, "importacion"); // viva, para comparar contra el estado lleno

    // El relleno ES la marca de «vivo dentro del flujo». Se afirma sobre el relleno
    // efectivo y no sobre una clase concreta: desde que hay paleta, el tono viaja
    // como `var()` en un estilo en línea — si la aserción mirara `bg-brand`
    // seguiría verde con el bloque sin pintar (P27).
    expect(tokenDeEstilo(estancia.style.backgroundColor)).toBeTruthy();
    expect(sin.style.backgroundColor).toBe(""); // un grupo sin gramática no puede reclamarla
    expect(sin.className).toContain("bg-surface");
    expect(sin.className).toContain("border-dashed");
    expect(claseConPrefijo(sin.className, "border-ink-")).toBeTruthy(); // borde VISIBLE, no transparente
    expect(sin.className).not.toContain("border-transparent");
  });

  it("estancia = rectángulo que crece con sus etapas · traslado = elipse de alto fijo", () => {
    const { container } = pintar(pipelineVacio());

    expect(grupo(container, "importacion").style.getPropertyValue("--peso-riel")).toBe("4"); // 4 etapas
    expect(grupo(container, "aduana").style.getPropertyValue("--peso-riel")).toBe("1"); // 1 etapa
    expect(grupo(container, "transito_intl").style.getPropertyValue("--peso-riel")).toBe("0"); // traslado: compacta

    // El `flexGrow` del envoltorio no basta: si el bloque de dentro no toma su
    // tamano, el canal del eje largo queda muerto y la prueba seguiria verde. Hacen
    // falta las dos mitades — y desde el 14-sep la segunda mitad es un alto
    // DECLARADO, no un `flex-1`: repartir el hueco daba 1710 px a 768 y 42 a 390.
    expect(bloque(container, "importacion").className).toContain("rounded-[11px]");
    expect(bloque(container, "importacion").className).toContain("lg:h-[var(--alto-riel)]");
    expect(grupo(container, "importacion").style.getPropertyValue("--alto-riel")).toBe(`${altoDelBloque(4)}px`);
    expect(bloque(container, "transito_intl").className).toContain("rounded-full");
    expect(bloque(container, "transito_intl").className).toContain("h-16");
  });

  // [C-DASH·10] El peso del grupo REPARTE ANCHO en fila y NO DEBE repartir alto en
  // columna — ahí el alto se DECLARA (`--alto-riel`). Hasta el 15-sep eso vivía en
  // un `flexGrow` de estilo EN LÍNEA con un comentario que decía «en FILA», y
  // `flex-grow` no es condicional al eje: la propiedad no comprueba lo que su
  // comentario afirma. Es la forma de P32.
  //
  // Hoy es inofensivo SOLO porque el `<nav>` va con `self-start` y en columna no
  // sobra alto que repartir. MEDIDO el 15-sep inyectando `align-self:stretch` a
  // 768: entre el bloque de Importación (acaba en y=284) y el siguiente aparecen
  // **1 328 px**, de los cuales solo 260 son el conector — el resto es el
  // envoltorio creciendo por ese peso que nadie pidió en ese eje.
  //
  // Y el arreglo NO puede ser añadir `lg:grow-0` encima: **un estilo en línea gana
  // a cualquier clase de Tailwind, incluidas las de media query** (`important:
  // false` en este repo), así que la clase quedaría puesta, la caja rota y una
  // aserción sobre `className` VERDE. Por eso el valor sale del `style` y se va a
  // una variable, y la propiedad la ponen dos clases con su eje escrito.
  it("el peso del grupo reparte ANCHO en fila y queda apagado en columna — con las dos mitades", () => {
    const { container } = pintar(pipelineVacio());
    const g = grupo(container, "importacion");

    // 1 · el valor viaja como VARIABLE, no como propiedad final.
    expect(g.style.getPropertyValue("--peso-riel")).toBe("4");
    expect(g.style.flexGrow, "el peso no puede volver a ser una propiedad en línea").toBe("");

    // 2 · y la propiedad la ponen dos clases, una por eje.
    expect(g.className).toContain("grow-[var(--peso-riel,0)]");
    expect(g.className).toContain("lg:grow-0");

    // CONTROL POSITIVO de la mitad 1: sin la variable, `flex-grow: var(--peso-riel,0)`
    // cae al fallback 0 y el riel acostado repartiría UNIFORME, sin error de consola,
    // sin rojo de `tsc` y sin rojo de esta suite. Por eso se afirma el VALOR además
    // de la clase: cada mitad sola pasa verde con el defecto puesto.
    expect(grupo(container, "almacenes").style.getPropertyValue("--peso-riel")).toBe("2");
    expect(grupo(container, "disponible").style.getPropertyValue("--peso-riel")).toBe("0");
  });

  // MEDIDO en un navegador a 768 px el 14-sep: el bloque de Importación salía
  // **64 × 1710 px**, y a 390 los rectángulos medían **42**, no 64. Un solo
  // mecanismo produce las dos cosas: `flex-1` en el bloque, dentro de un envoltorio
  // en dirección COLUMNA, fija `flex-basis: 0` sobre la ALTURA. Estirado, el bloque
  // absorbe todo el hueco de la fila del grid; sin estirar, ese mismo `basis: 0`
  // ANULA el `h-16` y lo deja en el alto del contenido.
  //
  // `layout-check` no podía verlo: no es recorte, ni solape, ni desborde. Un
  // rectángulo de 1710 px de alto con un ícono y un número centrados es un layout
  // perfectamente válido para sus predicados.
  it("el alto del bloque en columna es EXPLÍCITO y acotado — nunca hereda el alto del contenido", () => {
    const { container } = pintar(pipelineVacio());

    for (const clave of ["importacion", "aduana", "almacenes"]) {
      const b = bloque(container, clave);
      // Sin `flex-1`: es la clase que rompía los dos extremos a la vez.
      expect(b.className, `${clave} no puede llevar flex-1`).not.toContain("flex-1");
      expect(b.className).toContain("lg:h-[var(--alto-riel)]");
    }
    // El alto viaja como variable en el envoltorio, que es donde se puede calcular.
    expect(grupo(container, "importacion").style.getPropertyValue("--alto-riel")).toBe(`${altoDelBloque(4)}px`);
    expect(grupo(container, "aduana").style.getPropertyValue("--alto-riel")).toBe(`${altoDelBloque(1)}px`);
    expect(grupo(container, "almacenes").style.getPropertyValue("--alto-riel")).toBe(`${altoDelBloque(2)}px`);
  });

  it("el alto crece con las etapas, es monótono y tiene techo", () => {
    expect(altoDelBloque(1)).toBe(104);
    expect(altoDelBloque(2)).toBe(140);
    expect(altoDelBloque(4)).toBe(212);
    expect(altoDelBloque(4)).toBeGreaterThan(altoDelBloque(2));
    expect(altoDelBloque(2)).toBeGreaterThan(altoDelBloque(1));
    // Un catálogo que creciera a 20 etapas en un grupo no puede devolver un riel de
    // 788 px: el techo existe para que el alto siga siendo una ESCALA y no una suma.
    expect(altoDelBloque(20)).toBeLessThanOrEqual(260);
  });

  // Se afirma sobre el TRAZO, no sobre `data-vivo`. `data-vivo` es la etiqueta que
  // el componente le pone a su propia decisión: comprobarla es comprobar que el
  // componente está de acuerdo consigo mismo (P27). Invertir las dos ramas del
  // `style` dejaba la prueba verde y el riel al revés.
  it("el conector es CONTINUO solo entre dos grupos vivos — y se comprueba el trazo, no la etiqueta", () => {
    const { container } = pintar(pipelineCon({ 1: 8 })); // solo Importación viva
    const tramos = Array.from(container.querySelectorAll("[data-conector]")) as HTMLElement[];
    expect(tramos).toHaveLength(5);
    for (const t of tramos) {
      expect(t.className).toContain("border-dashed");
      expect(t.className).not.toContain("border-solid");
    }

    // CONTROL POSITIVO: con las dos puntas vivas, el primer tramo se vuelve trazo continuo.
    const vivos = pipelineCon({ 1: 8, 5: 3 });
    const dos = render(<DashboardRielEmbarques pipeline={vivos} grupos={agruparPipeline(vivos)} />);
    const conDos = Array.from(dos.container.querySelectorAll("[data-conector]")) as HTMLElement[];
    expect(conDos[0].className).toContain("border-solid");
    expect(conDos[0].className).not.toContain("border-dashed");
    expect(conDos[1].className).toContain("border-dashed");
  });

  // El trazo del conector cambia de EJE con el ancho, así que no puede vivir en un
  // `style` en línea: un gradiente «hacia abajo» no se vuelve «hacia la derecha».
  // Va como `border-style`, que sí tiene variante responsiva — y sigue siendo el
  // trazo, no una etiqueta sobre el trazo.
  it("el conector cambia de eje con el ancho: borde izquierdo en columna, borde superior acostado", () => {
    const { container } = pintar(pipelineVacio());
    const t = container.querySelector("[data-conector]") as HTMLElement;

    expect(t.className).toContain("border-t-2"); // acostado (por omisión, móvil primero)
    expect(t.className).toContain("lg:border-t-0");
    expect(t.className).toContain("lg:border-l-2"); // en columna, desde `md`
  });

  // Un riel vertical de 64 px de ancho y ~670 de alto encima del contenido es lo
  // que le tocaría a un teléfono si la orientación no cambiara.
  //
  // EL CORTE ES `lg` (1024) DESDE C-DASH·13, y antes era `md`. La razón vieja
  // —reusar el corte con el que `app-shell.tsx:118` esconde el sidebar— estaba
  // invertida: con el corte en `md`, a 768 el riel se pone en COLUMNA y el sidebar
  // sigue robando 230 px, así que la columna de contenido se queda con 387 px
  // (MEDIDO). Lo que había que evitar no era el riel acostado: era la columna
  // estrangulada. El docstring de `ENCUADRE` en `dashboard-view.tsx` lleva las cifras.
  it("el riel se acuesta bajo lg y se pone en columna desde lg", () => {
    const { container } = pintar(pipelineVacio());
    const riel = container.querySelector("nav") as HTMLElement;

    expect(riel.className).toContain("flex-row");
    expect(riel.className).toContain("lg:flex-col");
    expect(riel.className).toContain("lg:w-16");

    // Y el bloque gira con el: acostado toma alto fijo y llena el ancho de su
    // envoltorio; en columna toma ancho fijo y su alto DECLARADO.
    const b = bloque(container, "importacion");
    expect(b.className).toContain("h-16"); // acostado
    expect(b.className).toContain("w-full");
    expect(b.className).toContain("lg:w-16"); // en columna
    expect(b.className).toContain("lg:h-[var(--alto-riel)]");
  });

  // [C-DASH·13 · D-3 rama `b`] EL DEFECTO QUE ESTO ARREGLA, MEDIDO ANTES:
  //
  //   a 390 px el riel necesita 540 px de contenido mínimo (6 × `min-w-16` = 384,
  //   5 × `w-4` = 80, cintillo `w-16 mr-3` = 76) y tiene una caja de 358. TRES de
  //   los seis bloques caían fuera del viewport —`transito_terrestre` [376,440],
  //   `almacenes` [463,527], `disponible` [543,607]— y se recortaban EN SILENCIO,
  //   porque el `<nav>` va con `overflow-x: visible` y quien recorta es `main` con
  //   `overflow-x-hidden`. Nadie veía un borde ni una barra. Los tres que se perdían
  //   eran el FINAL del flujo.
  //
  // Se acordó la rama `b`: dos filas de tres. Las otras dos salidas estaban
  // descartadas POR MEDICIÓN, no por gusto — `overflow-x:auto` obliga al eje Y a
  // `auto` y recorta el panel de detalle; encoger da 33,7 px por bloque, menos que
  // el ícono de 18 más la cifra.
  //
  // Y EL SALTO NO CUELGA DE UN UMBRAL DE ANCHO, SINO DEL CORTE — a propósito, porque
  // un umbral aquí sería P20, un umbral que no separa. MEDIDO: la caja del riel
  // acostado vale **599 px a 640** y **489 px a 768**, o sea que se ENCOGE al crecer
  // el viewport, porque el sidebar aparece en `md` y se lleva 230 px. Cualquier
  // número que separase «caben seis» de «no caben» acertaría a un lado del corte y
  // fallaría al otro.
  //
  // La regla es una y no tiene número: **acostado son dos filas de tres; en columna,
  // una sola.** El salto y el tramo escondido cuelgan los dos de `lg`, que es donde
  // el riel cambia de eje.
  it("acostado, el riel va en DOS FILAS de tres — y el tramo del salto no se dibuja", () => {
    const { container } = pintar(pipelineVacio());
    const riel = container.querySelector("nav") as HTMLElement;

    // 1 · el riel puede envolver acostado, y NUNCA en columna.
    expect(riel.className).toContain("flex-wrap");
    expect(riel.className, "en columna envolver crearía una segunda columna").toContain("lg:flex-nowrap");

    // 2 · el salto es EXPLÍCITO y está en un sitio declarado, no emergente. Con
    //     `flex-wrap` a secas, dónde parte depende del ancho del rótulo más largo:
    //     sería distinto en cada ancho y no se podría saber qué tramo esconder.
    const saltos = Array.from(container.querySelectorAll("[data-salto]"));
    expect(saltos, "un solo salto, y declarado").toHaveLength(1);
    expect(saltos[0].className).toContain("basis-full");
    expect(saltos[0].className, "en columna no hay fila que partir").toContain("lg:hidden");

    // 3 · el salto va ANTES del cuarto grupo — ni antes ni después.
    const hijos = Array.from(riel.children);
    const iSalto = hijos.findIndex((el) => el.hasAttribute("data-salto"));
    const iCuarto = hijos.findIndex((el) => el.getAttribute("data-grupo") === "transito_terrestre");
    expect(iSalto).toBeGreaterThan(-1);
    expect(iCuarto).toBeGreaterThan(iSalto);
    expect(hijos.slice(0, iSalto).filter((el) => el.hasAttribute("data-grupo")), "tres en la primera fila").toHaveLength(3);

    // 4 · EL TRAMO DEL SALTO NO SE DIBUJA, que es lo que se pidió con todas sus
    //     letras: «el tramo de la fila 1 a la fila 2 no tiene dibujo honesto — y eso
    //     se resuelve NO dibujándolo, no inventando un conector que mienta sobre el
    //     recorrido». Sigue en el DOM (son cinco tramos, siempre) y se esconde.
    const tramos = Array.from(container.querySelectorAll("[data-conector]")) as HTMLElement[];
    expect(tramos, "cinco tramos entre seis grupos, pase lo que pase").toHaveLength(5);
    expect(tramos[2].className, "el 3.º es el del salto").toContain("max-lg:hidden");

    // CONTROL POSITIVO: los otros CUATRO no se esconden. Sin esto, esconderlos todos
    // pasaría por arreglo y el riel acostado se quedaría sin un solo tramo.
    tramos.forEach((t, i) => {
      if (i === 2) return;
      expect(t.className, `el tramo ${i} no puede esconderse`).not.toContain("max-lg:hidden");
    });
  });

  // El bucket `sin_grupo` se AÑADE al final del arreglo, siempre, después de la
  // etapa terminal. Su posición no codifica nada: una etapa nueva podría ser
  // temprana. Un tramo continuo hacia él afirmaría un flujo «Disponible → Sin
  // grupo» que nadie declaró — el mismo P28 que la regla de las dos puntas evita.
  it("el tramo hacia un grupo SIN GRAMÁTICA nunca es continuo, aunque las dos puntas estén vivas", () => {
    const doce = [...pipelineCon({ 11: 392 }), { orden: 12, nombre: "Etapa Nueva", activos: 7, piezas: 77 }];
    const { container } = pintar(doce);

    const tramos = Array.from(container.querySelectorAll("[data-conector]")) as HTMLElement[];
    const ultimo = tramos[tramos.length - 1]; // Disponible(392) → Sin grupo(7): las dos vivas
    expect(ultimo.className).toContain("border-dashed");
    expect(ultimo.className).not.toContain("border-solid");
  });

  // El trinquete de contraste, en su forma buena: no veta un tono POR NOMBRE
  // —`border-ink-muted2` mide 2,56:1 y pasaba una lista negra— sino que resuelve la
  // clase que el componente puso de verdad y CALCULA su razón contra el fondo.
  it("el borde del bloque apagado cumple 3:1 en los dos temas, sea cual sea el tono que se elija", () => {
    const { container } = pintar(pipelineVacio());
    const clases = bloque(container, "aduana").className;

    const borde = claseConPrefijo(clases, "border-ink-");
    const fondo = claseConPrefijo(clases, "bg-");
    expect(borde, "el bloque apagado tiene que llevar un borde de color, no transparente").toBeTruthy();
    expect(fondo).toBeTruthy();

    for (const tema of TEMAS) {
      const razon = contrasteEntreClases(borde as string, fondo as string, tema);
      expect(razon, `${borde} sobre ${fondo} en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  it("el rótulo apagado cumple 4,5:1 sobre el fondo de la APP — que es donde vive, porque el riel no tiene marco", () => {
    const { container } = pintar(pipelineCon({ 1: 8 }));
    const apagado = within(grupo(container, "aduana")).getByText("Aduana");

    const tinta = claseConPrefijo(apagado.className, "text-ink");
    expect(tinta).toBeTruthy();
    for (const tema of TEMAS) {
      const razon = contrasteEntreClases(tinta as string, "bg-surface-app", tema);
      expect(razon, `${tinta} sobre el fondo de la app en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // El anillo de foco es un objeto gráfico que porta información (1.4.11, 3:1), y
  // Tailwind deja `--tw-ring-offset-color:#fff` por omisión: sin token de offset, en
  // tema oscuro el hueco se pinta BLANCO y el anillo cae a 2,76:1 contra su propia
  // aureola. Los otros 21 `ring-offset` del repo sí fijan el token.
  it("el anillo de foco fija su color de offset, y cumple 3:1 contra él en los dos temas", () => {
    const { container } = pintar(pipelineVacio());
    const clases = bloque(container, "disponible").className;

    // Se pide la utilidad de COLOR, no la de ancho: `ring-offset-2` y
    // `ring-offset-surface-app` comparten prefijo, y quedarse con la primera
    // devuelve el ancho. Sin token de color, Tailwind pinta el hueco de BLANCO.
    const offset = claseDeColorConPrefijo(clases, "focus-visible:ring-offset-");
    expect(offset, "sin token de offset, Tailwind lo pinta blanco y el anillo se rompe en oscuro").toBeTruthy();

    const anillo = (claseDeColorConPrefijo(clases, "focus-visible:ring-") ?? "").replace("focus-visible:", "");
    const fondoDelOffset = (offset as string).replace("focus-visible:ring-offset-", "bg-");
    for (const tema of TEMAS) {
      const razon = contrasteEntreClases(anillo, fondoDelOffset, tema);
      expect(razon, `anillo sobre su offset en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    }
  });

  // ——— LA PALETA · autorizada el 13-sep-2026 ———

  // El color es el QUINTO canal del grupo (posición, rótulo, forma e ícono ya lo
  // identifican). Que sea el quinto es justo lo que lo vuelve exigible: si añade
  // poco, no puede además costar contraste.
  it("cada grupo vivo se pinta con SU tono, y cada tono es un token del tema", () => {
    const vivos = pipelineCon({ 1: 9, 5: 3, 7: 2, 8: 1, 9: 4, 11: 392 });
    const { container } = pintar(vivos);

    const esperado: Record<string, string> = {
      importacion: "mx-navy-ink",
      transito_intl: "mx-info",
      aduana: "mx-graf-pizarra",
      transito_terrestre: "mx-accent",
      almacenes: "mx-graf-petroleo",
      disponible: "mx-graf-jade",
    };
    for (const [clave, token] of Object.entries(esperado)) {
      expect(tokenDeEstilo(bloque(container, clave).style.backgroundColor), `el tono de ${clave}`).toBe(token);
    }
  });

  // La otra mitad del trinquete. `riel-contraste.test.ts` afirma que esos SEIS
  // TOKENS pasan; esta afirma que el riel usa esos tokens Y recalcula la razón del
  // que puso de verdad. Un séptimo grupo con un tono malo sale rojo aquí aunque
  // nadie lo haya añadido a ninguna tabla.
  it("el tono que el riel PINTA cumple 4,5:1 con su tinta y 3:1 contra el fondo, en los dos temas", () => {
    const vivos = pipelineCon({ 1: 9, 5: 3, 7: 2, 8: 1, 9: 4, 11: 392 });
    const { container } = pintar(vivos);

    const claves = ["importacion", "transito_intl", "aduana", "transito_terrestre", "almacenes", "disponible"];
    for (const clave of claves) {
      const token = tokenDeEstilo(bloque(container, clave).style.backgroundColor);
      expect(token, `${clave} tiene que pintarse con un var(--mx-*), no con un hex suelto`).toBeTruthy();
      for (const tema of TEMAS) {
        const relleno = hexDeToken(token as string, tema);
        const conTinta = razonDeContraste(relleno, hexDeToken("mx-surface", tema));
        const conFondo = razonDeContraste(relleno, hexDeToken("mx-bg", tema));
        expect(conTinta, `A · ${clave} ${tema}: ${conTinta.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        expect(conFondo, `B · ${clave} ${tema}: ${conFondo.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // CONTROL POSITIVO del mapa: si el catálogo crece con un grupo canónico nuevo y
  // nadie le asigna tono, esto sale rojo. Sin esta prueba el grupo heredaría el
  // tono de reserva y se vería IDÉNTICO a «Tránsito terrestre» — un grupo
  // disfrazado de otro, que es peor que un grupo sin color.
  it("CONTROL POSITIVO · ningún grupo canónico se queda sin tono propio", () => {
    const vivos = pipelineCon({ 1: 9, 5: 3, 7: 2, 8: 1, 9: 4, 11: 392 });
    const { container } = pintar(vivos);

    const tonos = agruparPipeline(vivos)
      .filter((g) => g.forma !== "sin_clasificar")
      .map((g) => tokenDeEstilo(bloque(container, g.clave).style.backgroundColor));

    expect(tonos.every(Boolean)).toBe(true);
    expect(new Set(tonos).size, "dos grupos con el mismo tono es un grupo disfrazado de otro").toBe(tonos.length);
  });

  it("el relleno es la marca de VIVO: un grupo en cero no lleva su tono", () => {
    const { container } = pintar(pipelineCon({ 1: 8 }));

    expect(tokenDeEstilo(bloque(container, "importacion").style.backgroundColor)).toBe("mx-navy-ink");
    expect(bloque(container, "aduana").style.backgroundColor).toBe("");
    expect(bloque(container, "aduana").className).toContain("bg-surface");
  });

  // El ícono está declarado canal NO decorativo, así que tiene que haber una
  // aserción sobre lo que se DIBUJA. Sin ella, `const Icon = FileText` para todos
  // pasaba las 10 pruebas: la media función que se ve igual que la completa (P24).
  it("el ícono DIBUJADO es el de la etapa con más carga, y cambia cuando cambia la carga", () => {
    const a = pipelineCon({ 1: 9, 2: 58 });
    const rA = render(<DashboardRielEmbarques pipeline={a} grupos={agruparPipeline(a)} />);
    expect(iconoDe(bloque(rA.container as HTMLElement, "importacion"))).toBe(iconoEsperado(2));

    const b = pipelineCon({ 1: 58, 2: 9 });
    const rB = render(<DashboardRielEmbarques pipeline={b} grupos={agruparPipeline(b)} />);
    expect(iconoDe(bloque(rB.container as HTMLElement, "importacion"))).toBe(iconoEsperado(1));

    expect(iconoEsperado(1)).not.toBe(iconoEsperado(2)); // sin esto, lo anterior sería vacuo
  });

  it("el ícono es el de la etapa con más carga; el de la primera si el grupo está en cero", () => {
    const conCarga = pipelineCon({ 1: 9, 2: 58 });
    expect(ordenDelIcono(agruparPipeline(conCarga)[0], conCarga)).toBe(2);

    const vacio = pipelineVacio();
    expect(ordenDelIcono(agruparPipeline(vacio)[0], vacio)).toBe(1);

    const empate = pipelineCon({ 1: 5, 2: 5 });
    expect(ordenDelIcono(agruparPipeline(empate)[0], empate)).toBe(1);

    // Un grupo cuyas etapas no están en el catálogo se queda con `ordenes` vacío. La
    // firma lo dice —`number | undefined`— en vez de devolver `undefined` declarando
    // `number` y dejar que un `?? FileText` escrito para otra cosa lo tape (P25):
    // ahí `tsc` no ve nada y el fallback parece intencional.
    expect(ordenDelIcono({ clave: "x", nombre: "X", forma: "estancia", ordenes: [], activos: 0, piezas: 0 }, vacio)).toBeUndefined();
  });

  it("cada bloque del riel es un enlace vivo a /embarques, y el riel conserva su título visible", () => {
    pintar(pipelineVacio());
    const enlaces = screen.getAllByRole("link");
    expect(enlaces).toHaveLength(7); // 6 grupos + el rótulo del riel
    for (const a of enlaces) expect(a).toHaveAttribute("href", "/embarques");

    // El `<h2>` no cabe en 64 px, pero quitarle al vidente el nombre Y la afordancia
    // de enlace era pagar dos veces por un problema de ancho.
    expect(screen.getByRole("link", { name: "Embarques" })).toHaveAttribute("href", "/embarques");
    expect(screen.getByRole("heading", { level: 2, name: "Pipeline de embarques" })).toBeInTheDocument();
  });

  it("el nombre accesible del bloque concuerda en número — «1 embarque activo», no «1 embarques activos»", () => {
    pintar(pipelineCon({ 7: 1 })); // En Aduana, exactamente uno
    expect(screen.getByRole("link", { name: "Aduana, 1 embarque activo" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Almacenes, sin embarques activos" })).toBeInTheDocument();
  });

  it("el detalle del grupo está atado a su enlace por aria-describedby", () => {
    const { container } = pintar(pipelineVacio());
    const id = bloque(container, "almacenes").getAttribute("aria-describedby");

    expect(id).toBeTruthy();
    const panel = container.querySelector(`#${id}`);
    expect(panel).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("En Almacén North")).toBeInTheDocument();
  });

  // La revelación responde a las DOS: sin `:focus-within` el detalle no existiría
  // para quien navega con teclado, y la prueba de arriba seguiría verde porque
  // `aria-describedby` no depende de que el panel llegue a verse.
  // [C-DASH·13] EL PANEL SE RECORTABA A 390, Y NINGÚN INSTRUMENTO PODÍA VERLO.
  //
  // MEDIDO el 15-sep: `main` tenía `scrollWidth` 548 contra `clientWidth` 390 —
  // 158 px de desborde horizontal tragados en silencio— y el sujeto eran estos
  // paneles. Colgaban `absolute left-0 w-[238px]` de SU GRUPO; el tercer grupo de
  // cada fila arranca en x≈288, así que el panel llegaba a ≈526 sobre un viewport
  // de 390. Están `invisible` hasta el `:hover`/`:focus-within`, o sea que
  // **contribuían al desborde sin verse** — y al revelarlos con el teclado se
  // veían recortados.
  //
  // Y A1c, la aserción que este mismo bloque añadió, NO LO CUBRE: su `visible()`
  // excluye lo que está `visibility:hidden`. El arnés, además, nunca hace hover.
  // Por eso el arreglo va aquí con su prueba, y la medición con foco vive en una
  // sonda aparte.
  //
  // EL ARREGLO ES DE ANCLAJE, NO DE CONTENIDO: acostado el panel se ancla al RIEL
  // —que pasa a ser el ancestro posicionado— y toma su ancho; en columna se queda
  // exactamente como estaba, colgando del grupo a 78 px.
  it("acostado el detalle se ancla al RIEL y toma su ancho; en columna cuelga del grupo", () => {
    const { container } = pintar(pipelineVacio());
    const riel = container.querySelector("nav") as HTMLElement;
    const env = grupo(container, "almacenes");
    const panel = container.querySelector("#riel-detalle-almacenes") as HTMLElement;

    // 1 · quién es el ancestro posicionado en cada eje. Las dos mitades: si el
    //     envoltorio siguiera siendo `relative` acostado, el `left-0` del panel
    //     volvería a medirse contra el grupo y el recorte volvería.
    expect(riel.className, "acostado el panel se ancla al riel").toContain("relative");
    expect(env.className, "acostado el envoltorio NO puede estar posicionado").not.toMatch(/(^|\s)relative(\s|$)/);
    expect(env.className, "en columna sí, que es donde el panel cuelga del grupo").toContain("lg:relative");

    // 2 · el ancho: el del riel acostado (358 px a 390, medido), el de siempre en columna.
    expect(panel.className).toContain("w-full");
    expect(panel.className).toContain("lg:w-[238px]");
    expect(panel.className).toContain("lg:left-[78px]");
    expect(panel.className).toContain("lg:top-0");
  });

  it("el detalle se revela con :hover Y con :focus-within", () => {
    const { container } = pintar(pipelineVacio());
    const panel = container.querySelector(`#${bloque(container, "almacenes").getAttribute("aria-describedby")}`) as HTMLElement;

    expect(panel.className).toContain("group-hover:visible");
    expect(panel.className).toContain("group-focus-within:visible");
    expect(grupo(container, "almacenes").className).toContain("group");
  });
});
