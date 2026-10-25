import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { TendenciaPunto } from "@/types/api";
import { formatoNumero, formatoPeriodoCorto } from "@/lib/formato";
import { claseConPrefijo, contrasteEntreClases, TEMAS } from "./contraste.testutil";
import {
  ALTO_BARRAS,
  ALTO_CIFRA,
  ALTO_PISTA,
  construirBarras,
  cortesDe,
  DashboardTendenciaCard,
  HUECO_ENTRE_BARRAS,
  hayCategorias,
  MIN_BARRA_VISIBLE,
  pasoRotulos,
  nivelDeBarra,
  NIVELES,
  rotuloDeNivel,
  rotuloPunto,
  tonoDeNivel,
  TOPE_ANCHO_BARRA,
  variacionSerie,
} from "./dashboard-tendencia";

describe("[DASH-F · D-1] la invariante de la pista — lo que el grado (c) tuvo que cazar una vez", () => {
  it("la barra más alta MÁS su cifra caben en la pista: si no, flex encoge la barra y la proporción miente", () => {
    // El defecto real, medido en el servido el 17-sep-2026: con las barras
    // ocupando la pista ENTERA, la columna pedía 302 px de 288 y flex le quitó
    // 13,5 px a la única barra que desbordaba —la mayor—. Las otras tres no se
    // movieron, así que la razón pintada entre la mayor y las demás cayó de
    // la del dato a una menor.
    //
    // jsdom no puede ver esto: no hay layout, y `style.height` devuelve lo que
    // el componente escribió, no lo que el navegador pinta. Esta línea es lo que
    // baja el caso de grado (c) a grado (a).
    expect(ALTO_BARRAS + ALTO_CIFRA).toBeLessThanOrEqual(ALTO_PISTA);
  });

  it("la barra que devuelve la función pura nunca excede el alto que se le pasó", () => {
    const h = construirBarras([1, 500, 700000], ALTO_BARRAS);
    expect(Math.max(...h)).toBeLessThanOrEqual(ALTO_BARRAS);
  });
});

describe("construirBarras (pura) — [DASH-F · D-1] la escala arranca en CERO", () => {
  it("la altura es proporcional al VALOR, no al rango de la serie", () => {
    // Éste es el candado del bloque. Con `dominioDe(valores)` a secas —sin
    // `incluirCero`— la serie se normaliza entre su propio mínimo y su máximo,
    // así que [100, 200] daría [0, 200]: la primera barra DESAPARECERÍA aun
    // valiendo la mitad que la segunda. Una barra cuyo largo no es su magnitud
    // es el ejemplar clásico de gráfica que miente.
    expect(construirBarras([100, 200], 200)).toEqual([100, 200]);
  });

  it("MUTANTE: quitar `incluirCero` hace desaparecer la barra menor — y esto lo caza", () => {
    const [menor, mayor] = construirBarras([100, 200], 200);
    expect(menor / mayor).toBeCloseTo(100 / 200, 6);
    expect(menor).toBeGreaterThan(MIN_BARRA_VISIBLE);
  });

  it("un valor de CERO se dibuja en CERO: «hay poco» y «no hay nada» no son la misma afirmación", () => {
    expect(construirBarras([0, 1000], 288)[0]).toBe(0);
  });

  it("un valor positivo diminuto no desaparece: se le garantiza el mínimo visible", () => {
    // 1 sobre 1 000 000 son 0,0003 px de 288. Sin el mínimo, la barra no existe
    // y el lector no puede distinguirla de un cero.
    expect(construirBarras([1, 1000000], 288)[0]).toBe(MIN_BARRA_VISIBLE);
  });

  it("serie vacía → [] (defensivo)", () => {
    expect(construirBarras([], 288)).toEqual([]);
  });

  it("LO QUE EL CERO CUESTA, dicho con una serie de ejemplo", () => {
    // 700 000 · 640 000 · 639 600 · 639 600. Las tres últimas difieren en menos
    // de medio píxel sobre 288: a ojo son la misma barra. No es un defecto del
    // dibujo — el stock no se movió de julio a septiembre. La línea que había
    // antes lo dramatizaba porque se normalizaba entre min y max.
    const h = construirBarras([700000, 640000, 639600, 639600], ALTO_BARRAS);
    expect(h[0]).toBeCloseTo(ALTO_BARRAS, 6);
    expect(Math.max(...h.slice(1)) - Math.min(...h.slice(1))).toBeLessThan(0.5);
    // Y la caída de abril sí se ve: ~9 % de 288 son ~25 px.
    expect(h[0] - h[1]).toBeGreaterThan(20);
  });
});

describe("pasoRotulos (pura) — ningún rótulo se solapa con otro", () => {
  it("con los 4 periodos de hoy se rotulan TODOS", () => {
    expect(pasoRotulos(4)).toBe(1);
  });

  it("el paso se deriva del ancho MÁS ANGOSTO, no del cómodo", () => {
    // 320 px útiles / 44 px por rótulo = 7 caben. Con 20 periodos, uno de cada 3.
    expect(pasoRotulos(20)).toBe(3);
    expect(pasoRotulos(7)).toBe(1);
    expect(pasoRotulos(8)).toBe(2);
  });

  it("casos degenerados: 0 y 1 periodos no dividen entre cero", () => {
    expect(pasoRotulos(0)).toBe(1);
    expect(pasoRotulos(1)).toBe(1);
  });
});

function punto(periodo: string, piezas: number, cortes = 1): TendenciaPunto {
  return { periodo, piezas, cortes };
}

describe("DashboardTendenciaCard — [DASH-D · D-2] cortes y variación", () => {
  it("cada periodo declara CUÁNTOS cortes resume: un punto de 1 corte y uno de 9 no son el mismo punto", () => {
    const tendencia = [punto("2026-07", 20000, 9), punto("2026-09", 24850, 1)];
    render(<DashboardTendenciaCard tendencia={tendencia} />);

    // [DASH-F · D-1] El periodo y sus cortes ya no viajan en un solo texto: son
    // dos renglones bajo la barra, para que quepan en una pista de ~80 px.
    expect(screen.getByText("9 cortes")).toBeInTheDocument();
    expect(screen.getByText("1 corte")).toBeInTheDocument();
  });

  it("la variación del primero al último se pinta, y se calcula con los valores que ya viajan", () => {
    // 20,000 → 24,850 = +24.25 %, redondeado a un decimal.
    const tendencia = [punto("2026-07", 20000, 9), punto("2026-09", 24850, 1)];
    render(<DashboardTendenciaCard tendencia={tendencia} />);

    expect(screen.getByText("Subió 24.3 % de jul 2026 a sep 2026")).toBeInTheDocument();
  });

  it("una serie PLANA no dice que subió ni que bajó: dice que no cambió", () => {
    const tendencia = [punto("2026-07", 24850, 9), punto("2026-09", 24850, 1)];
    render(<DashboardTendenciaCard tendencia={tendencia} />);

    expect(screen.getByText("Sin cambio de jul 2026 a sep 2026")).toBeInTheDocument();
  });

  it("con un periodo base en CERO no fabrica un porcentaje: no lo pinta", () => {
    // 0 → 100 no es «+∞ %» ni «+100 %». Sin base no hay porcentaje honesto,
    // que es la misma regla que ya gobierna el delta de `piezas_en_camino`.
    const tendencia = [punto("2026-07", 0, 1), punto("2026-09", 100, 1)];
    render(<DashboardTendenciaCard tendencia={tendencia} />);

    expect(screen.queryByText(/de jul 2026 a sep 2026/)).not.toBeInTheDocument();
  });
});

describe("DashboardTendenciaCard", () => {
  it("≥2 puntos: una barra por periodo, con su cifra encima y su periodo debajo", () => {
    const tendencia = [punto("2026-04", 20000), punto("2026-07", 24850)];
    const { container } = render(<DashboardTendenciaCard tendencia={tendencia} />);

    const barras = container.querySelectorAll("[data-barra]");
    expect(barras).toHaveLength(2);
    // [DASH-F · D-1] Ya no hay SVG: las barras son cajas del documento, así que
    // sus cifras son TEXTO REAL — se seleccionan y las lee un lector de pantalla.
    expect(container.querySelector("svg[role='img']")).not.toBeInTheDocument();

    // «24,850» sale DOS veces: el titular y la cifra sobre su barra.
    expect(screen.getAllByText("24,850")).toHaveLength(2);
    // «20,000» solo sobre su barra: no es el último periodo.
    expect(screen.getAllByText("20,000")).toHaveLength(1);
    // «jul 2026» sale dos veces: junto al valor grande y bajo su barra.
    expect(screen.getAllByText("jul 2026")).toHaveLength(2);
    expect(screen.getAllByText("abr 2026")).toHaveLength(1);
    expect(screen.getByText("2 periodos de historial")).toBeInTheDocument();
    expect(screen.queryByText(/Aún no hay suficiente historial/)).not.toBeInTheDocument();
  });

  it("la ALTURA de cada barra es la que dice la función pura — el componente no reescala por su cuenta", () => {
    const tendencia = [punto("2026-04", 20000), punto("2026-07", 24850)];
    const { container } = render(<DashboardTendenciaCard tendencia={tendencia} />);

    // Se compara el VALOR, no su serialización: el DOM normaliza «288.0px» a
    // «288px», y una aserción sobre la cadena mediría cómo se escribe el número
    // en vez de cuánto mide la barra.
    const esperadas = construirBarras([20000, 24850], ALTO_BARRAS).map((h) => Number(h.toFixed(1)));
    const pintadas = Array.from(container.querySelectorAll<HTMLElement>("[data-barra]")).map((b) => parseFloat(b.style.height));
    expect(pintadas).toEqual(esperadas);
    // Y la proporción se sostiene contra el dato, que es lo que la barra afirma.
    //
    // La tolerancia se DERIVA, no se elige: las alturas se escriben con un
    // decimal, así que cada una trae hasta ±0,05 px de redondeo sobre una pista
    // de 274 px. Eso acota el error de la razón en ~3 × 10⁻⁴. Pedir más decimales
    // sería medir el redondeo del navegador, no la honestidad de la gráfica.
    const TOLERANCIA = (0.05 / ALTO_BARRAS) * (1 + 20000 / 24850) * 2;
    expect(Math.abs(pintadas[0] / pintadas[1] - 20000 / 24850)).toBeLessThan(TOLERANCIA);
  });

  it("1 punto: estado inline honesto en vez de una gráfica de una sola barra, pero SIEMPRE la nota de historial (singular)", () => {
    const { container } = render(<DashboardTendenciaCard tendencia={[punto("2026-07", 24850)]} />);
    expect(screen.getByText("Aún no hay suficiente historial — vuelve tras la próxima ingesta.")).toBeInTheDocument();
    expect(screen.getByText("1 periodo de historial")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-barra]")).toHaveLength(0);
    // El valor grande sigue mostrando el único punto disponible.
    expect(screen.getByText("24,850")).toBeInTheDocument();
  });

  it("0 puntos: valor grande '—' y nota '0 periodos de historial'", () => {
    render(<DashboardTendenciaCard tendencia={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("0 periodos de historial")).toBeInTheDocument();
  });

  it("no incluye ningún link/CTA (este widget no navega a nada en v1)", () => {
    const { container } = render(<DashboardTendenciaCard tendencia={[punto("2026-04", 100), punto("2026-07", 200)]} />);
    expect(container.querySelector("a")).not.toBeInTheDocument();
  });
});

/**
 * La puerta de E-5. Su trabajo es **impedir que la tarjeta diga algo que el dato
 * no trae**.
 *
 * `TendenciaPunto` trae exactamente tres campos: `periodo`, `piezas` y `cortes`.
 * La tentación de llenar el espacio con un promedio, una proyección, una fecha
 * exacta de corte o un segundo eje es precisamente lo que esta prueba prohíbe —
 * y [DASH-F · D-1] la vuelve más necesaria, no menos: la gráfica pasó de 80 px a
 * 288 y el espacio vacío es justo lo que invita a inventar una cuarta serie.
 */
describe("DashboardTendenciaCard · E-5 · la tarjeta no puede decir más de lo que el dato trae", () => {
  const P = (periodo: string, piezas: number, cortes: number): TendenciaPunto => ({ periodo, piezas, cortes });

  /** Todo el texto visible, hoja por hoja: los nodos que NO tienen hijos elemento. */
  function textosVisibles(raiz: HTMLElement): string[] {
    return Array.from(raiz.querySelectorAll<HTMLElement>("*"))
      .filter((el) => el.children.length === 0 && (el.textContent ?? "").trim().length > 0)
      .map((el) => (el.textContent ?? "").trim());
  }

  it("con 3 puntos, el texto de la tarjeta es EXACTAMENTE el que producen sus funciones puras", () => {
    const serie = [P("2026-04", 20000, 1), P("2026-07", 24850, 5), P("2026-09", 24850, 9)];
    const { container } = render(<DashboardTendenciaCard tendencia={serie} />);

    // Nada de esto se escribe a mano: se DERIVA de las mismas funciones que el
    // componente usa, así que la prueba no puede quedarse vieja respecto al formato.
    const esperado = [
      "Tendencia de stock", // el único literal
      formatoNumero(serie[2].piezas), // el titular
      formatoPeriodoCorto(serie[2].periodo), // el titular
      ...serie.map((p) => formatoNumero(p.piezas)), // la cifra sobre cada barra
      ...serie.map((p) => formatoPeriodoCorto(p.periodo)), // el periodo bajo cada barra
      ...serie.map((p) => cortesDe(p)), // y sus cortes, que son dato del dominio
      variacionSerie(serie)?.texto as string,
      `${serie.length} periodos de historial`, // derivado de `tendencia.length`, fórmula citable
      // [DASH-F · D-6] La referencia de color. Son TRES textos y los tres se enumeran:
      // «No sube» cubre bajar, quedar igual y no tener mes anterior, y ese rótulo es
      // justamente lo que impide que el dibujo llame «a la baja» a un mes que no bajó.
      // [DASH-F · D-7] La referencia de color: pico, medio y valle. VALLE se nombra
      // aunque hoy no aparezca ninguno — una referencia explica la escala completa.
      "Pico",
      "Medio",
      "Valle",
      "el mes más alto y el más bajo del historial mostrado",
    ];

    expect(textosVisibles(container).sort()).toEqual(esperado.sort());
  });

  it("los `cortes` viajan en TODOS los periodos, no solo en los extremos", () => {
    const serie = [P("2026-04", 20000, 1), P("2026-07", 24850, 5), P("2026-09", 24850, 9)];
    render(<DashboardTendenciaCard tendencia={serie} />);

    // [DASH-F · D-1] Antes solo se rotulaban el primero y el último; el punto de
    // en medio se dibujaba sin decir cuántos cortes resumía.
    expect(screen.getByText("1 corte")).toBeInTheDocument();
    expect(screen.getByText("5 cortes")).toBeInTheDocument();
    expect(screen.getByText("9 cortes")).toBeInTheDocument();
    expect(rotuloPunto(serie[0])).toContain("1 corte");
    expect(rotuloPunto(serie[2])).toContain("9 cortes");
  });

  // El rótulo es JUSTO el que confiesa cuántos cortes resume cada punto — la
  // información que D-2 añadió porque sin ella un punto de 1 corte y uno de 9 se
  // dibujan idénticos. Que ese texto sea el menos legible de la tarjeta
  // invierte la prioridad: lo que más cuesta leer es lo que más hay que leer.
  it("todo texto de la tarjeta cumple 4,5:1 contra la superficie de la tarjeta, en los dos temas", () => {
    const serie = [P("2026-04", 20000, 1), P("2026-07", 24850, 5), P("2026-09", 24850, 9)];
    const { container } = render(<DashboardTendenciaCard tendencia={serie} />);

    // El color casi nunca está en la hoja: `text-ink-muted2` vivía en el `<div>`
    // padre y los `<span>` de dentro no llevaban clase. Mirar solo la hoja daba
    // CERO tintas y la prueba salía verde sin medir nada — la primera versión de
    // esta prueba hizo exactamente eso (P19: una guarda que no puede morder).
    const tintaHeredada = (el: HTMLElement): string | undefined => {
      let n: HTMLElement | null = el;
      while (n && n !== container) {
        const t = claseConPrefijo(n.className ?? "", "text-ink");
        if (t) return t;
        n = n.parentElement;
      }
      return undefined;
    };

    const tintas = new Set<string>();
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      if (el.children.length > 0 || (el.textContent ?? "").trim() === "") continue;
      const tinta = tintaHeredada(el);
      // Y si NO hay tinta `--mx-*` arriba, la prueba falla en vez de encogerse de
      // hombros: `text-muted-foreground` (el token de shadcn) reprueba 3,61:1 en
      // oscuro y esta prueba no puede medirlo. Un texto que no se puede medir no
      // puede declararse conforme.
      expect(tinta, `un texto de la tarjeta no toma su color de un token --mx-*: ${JSON.stringify(el.textContent)}`).toBeTruthy();
      tintas.add(tinta as string);
    }
    expect(tintas.size, "se esperaba encontrar tintas que medir").toBeGreaterThan(0);

    for (const tinta of Array.from(tintas)) {
      for (const tema of TEMAS) {
        const razon = contrasteEntreClases(tinta, "bg-surface", tema);
        expect(razon, `${tinta} sobre la tarjeta en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // CONTROL POSITIVO de la prueba de arriba: el tono que la tarjeta usaba REPRUEBA
  // por esta misma medición. Sin esta línea, la prueba podría estar pasando porque
  // no encontró ninguna tinta que medir.
  it("CONTROL POSITIVO · --mx-muted-2, el tono que llevaba el rótulo, reprueba en los DOS temas", () => {
    for (const tema of TEMAS) {
      expect(contrasteEntreClases("text-ink-muted2", "bg-surface", tema)).toBeLessThan(4.5);
    }
  });
});
/**
 * [DASH-F · D-7b] El tope de ancho de D-6 y el NIVEL de cada barra: pico, medio y valle.
 */
describe("[DASH-F · D-7b] nivelDeBarra (pura) — ORDINAL: el mayor y el menor", () => {
  it("pico es el MAXIMO, valle el MINIMO, y lo demas medio", () => {
    const v = [10, 50, 30];
    expect(v.map((_, i) => nivelDeBarra(i, v))).toEqual(["valle", "pico", "medio"]);
  });

  it("LA SERIE DE EJEMPLO: abr pico, jul medio, ago y sep VALLE", () => {
    // 700 000 · 640 000 · 639 600 · 639 600. La regla anterior —banda sobre la mediana—
    // dejaba a los tres ultimos DENTRO de la banda y el color de valle no lo recibia
    // NADIE: la dispersion de esos tres es 0,06 %, y cualquier banda razonable se los
    // traga. La regla no estaba mal escrita: contestaba otra pregunta.
    const v = [700000, 640000, 639600, 639600];
    expect(v.map((_, i) => nivelDeBarra(i, v))).toEqual(["pico", "medio", "valle", "valle"]);
  });

  it("EMPATE EN EL MINIMO: los dos son valle — es el candado de la regla ordinal", () => {
    // Agosto y septiembre valen lo MISMO. El empate ya esta en los datos reales: no hay
    // que fabricarlo para probarlo.
    const v = [700000, 640000, 639600, 639600];
    expect(nivelDeBarra(2, v)).toBe(nivelDeBarra(3, v));
    expect(nivelDeBarra(2, v)).toBe("valle");
  });

  it("CONTROL POSITIVO · la regla POR POSICION se pondria roja con estos mismos datos", () => {
    // La version equivocada, escrita a proposito: clasifica por indice y no por valor.
    // Pintaria dos barras con el MISMO numero debajo de colores distintos.
    const porPosicion = (i: number, v: number[]) => (i === 0 ? "pico" : i === v.length - 1 ? "valle" : "medio");
    const v = [700000, 640000, 639600, 639600];
    expect(porPosicion(2, v)).not.toBe(porPosicion(3, v));
    expect(nivelDeBarra(2, v)).toBe(nivelDeBarra(3, v));
  });

  it("EMPATE EN EL MAXIMO: los dos son pico", () => {
    const v = [900, 900, 100];
    expect(v.map((_, i) => nivelDeBarra(i, v))).toEqual(["pico", "pico", "valle"]);
  });

  it("n = 2: uno pico y otro valle, SIN medio — correcto y honesto", () => {
    const v = [100, 200];
    expect(v.map((_, i) => nivelDeBarra(i, v))).toEqual(["valle", "pico"]);
  });

  it("TODOS IGUALES: no se categoriza, porque «todos son el pico» no informa", () => {
    const v = [500, 500, 500];
    expect(hayCategorias(v)).toBe(false);
    expect(v.map((_, i) => nivelDeBarra(i, v))).toEqual(["medio", "medio", "medio"]);
  });

  it("n = 1 y serie vacia: tampoco se categoriza", () => {
    expect(hayCategorias([500])).toBe(false);
    expect(hayCategorias([])).toBe(false);
    expect(nivelDeBarra(0, [500])).toBe("medio");
  });

  it("los TRES niveles toman tonos distintos, y el MEDIO conserva el acento que ya estaba", () => {
    const tonos = NIVELES.map(tonoDeNivel);
    expect(new Set(tonos).size).toBe(3);
    expect(tonoDeNivel("medio")).toBe("--mx-accent");
    // El valle es GRIS: el naranja que se ofrecio ya significa «sobre-reservado» en la
    // tarjeta de al lado, y el verde es identidad de KAM.
    expect(tonoDeNivel("valle")).toContain("gris");
    expect(NIVELES.map(rotuloDeNivel)).toEqual(["Pico", "Medio", "Valle"]);
  });
});

describe("[DASH-F · D-6] el TOPE de ancho", () => {
  it("cada barra declara el tope como MAXIMO, no como ancho fijo", () => {
    const serie = [punto("2026-04", 20000), punto("2026-07", 24850), punto("2026-08", 30000)];
    const { container } = render(<DashboardTendenciaCard tendencia={serie} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra]"));
    expect(barras).toHaveLength(3);
    for (const b of barras) {
      expect(parseFloat(b.style.maxWidth)).toBe(TOPE_ANCHO_BARRA);
      // `width` sigue al 100 % de la ranura: por debajo del tope la barra llena su
      // banda. Un ancho FIJO habria dejado huecos con muchos periodos.
      expect(b.className).toContain("w-full");
    }
  });

  it("CONTROL POSITIVO · el caso que el tope existe para impedir, con la aritmetica del componente", () => {
    // El spec del bloque proponia `n = 1` como control —la barra ocuparia la pista
    // entera—, pero ESE CASO ES INALCANZABLE: con menos de dos periodos la tarjeta
    // no dibuja grafica, muestra el estado de «historial insuficiente». El caso que
    // SI muerde es n = 2.
    //
    // Con la pista medida a 1280 el 17-sep (490,3 px) y el hueco de 6:
    const pista = 490.3;
    const ranura = (n: number) => (pista - HUECO_ENTRE_BARRAS * (n - 1)) / n;
    expect(ranura(2)).toBeCloseTo(242.15, 2);
    expect(Math.min(TOPE_ANCHO_BARRA, ranura(2))).toBe(TOPE_ANCHO_BARRA);
    // Sin tope, una barra de 242 px de ancho por 274 de alto: casi un cuadrado.
    expect(ranura(2)).toBeGreaterThan(4 * TOPE_ANCHO_BARRA);
  });

  it("el tope CADUCA SOLO, y su fecha depende de la pista — no es un numero fijo", () => {
    // Deja de actuar cuando la ranura natural ya cabe por debajo:
    //   n >= (pista + hueco) / (TOPE + hueco)
    const inerteDesde = (pista: number) => Math.ceil((pista + HUECO_ENTRE_BARRAS) / (TOPE_ANCHO_BARRA + HUECO_ENTRE_BARRAS));
    expect(inerteDesde(490.3)).toBe(8); // 1280, medido
    expect(inerteDesde(320)).toBe(5); // 390, medido
    // Y en el punto de cruce el tope ya no manda.
    const pista = 490.3;
    const ranura = (pista - HUECO_ENTRE_BARRAS * (8 - 1)) / 8;
    expect(ranura).toBeLessThanOrEqual(TOPE_ANCHO_BARRA);
  });
});
describe("[DASH-F · D-7b] la referencia de color y la fuente unica", () => {
  const REAL = [
    punto("2026-04", 700000, 2),
    punto("2026-07", 640000, 5),
    punto("2026-08", 639600, 7),
    punto("2026-09", 639600, 3),
  ];

  it("TRES recuadros, con los tres tonos de la escala", () => {
    const { container } = render(<DashboardTendenciaCard tendencia={REAL} />);
    const muestras = Array.from(container.querySelectorAll<HTMLElement>("[data-muestra]"));
    expect(muestras.map((m) => m.dataset.muestra)).toEqual(["pico", "medio", "valle"]);
    muestras.forEach((m, i) => expect(m.style.backgroundColor).toBe(`var(${tonoDeNivel(NIVELES[i])})`));
  });

  it("UN SOLO SITIO decide: el color de cada barra es el de su propio `data-nivel`", () => {
    // Si el color y la categoria se derivaran por caminos distintos podrian divergir sin
    // que nada lo dijera — asi nacieron las cuatro implementaciones de `piezas_en_camino`.
    const { container } = render(<DashboardTendenciaCard tendencia={REAL} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra]"));
    expect(barras.map((b) => b.dataset.nivel)).toEqual(["pico", "medio", "valle", "valle"]);
    for (const b of barras) {
      const nivel = b.dataset.nivel as "pico" | "medio" | "valle";
      expect(b.style.backgroundColor).toBe(`var(${tonoDeNivel(nivel)})`);
      expect(b.getAttribute("title")).toContain(rotuloDeNivel(nivel).toLowerCase());
    }
  });

  it("las dos barras EMPATADAS en el minimo salen del MISMO color", () => {
    const { container } = render(<DashboardTendenciaCard tendencia={REAL} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra]"));
    expect(barras[2].style.backgroundColor).toBe(barras[3].style.backgroundColor);
  });

  it("la leyenda dice lo que la regla HACE: el mas alto y el mas bajo, no la mediana", () => {
    render(<DashboardTendenciaCard tendencia={REAL} />);
    expect(screen.getByText("el mes más alto y el más bajo del historial mostrado")).toBeInTheDocument();
    expect(screen.queryByText(/mediana/)).not.toBeInTheDocument();
  });

  it("con TODOS IGUALES no se pinta la referencia: explicaria una distincion que no existe", () => {
    const planos = [punto("2026-07", 500, 1), punto("2026-08", 500, 1), punto("2026-09", 500, 1)];
    const { container } = render(<DashboardTendenciaCard tendencia={planos} />);
    expect(container.querySelector("[data-leyenda-tendencia]")).not.toBeInTheDocument();
    for (const b of Array.from(container.querySelectorAll<HTMLElement>("[data-barra]"))) {
      expect(b.getAttribute("title")).not.toContain("pico");
      expect(b.getAttribute("title")).not.toContain("valle");
    }
  });

  it("la leyenda NO se pinta cuando no hay grafica", () => {
    const { container } = render(<DashboardTendenciaCard tendencia={[punto("2026-07", 24850)]} />);
    expect(container.querySelector("[data-leyenda-tendencia]")).not.toBeInTheDocument();
  });

  it("[gate 4.7] el tope de ancho de D-6 SIGUE VIGENTE — se comprueba, no se supone", () => {
    // Tocar el mismo componente es donde muere un arreglo reciente.
    const { container } = render(<DashboardTendenciaCard tendencia={REAL} />);
    for (const b of Array.from(container.querySelectorAll<HTMLElement>("[data-barra]"))) {
      expect(parseFloat(b.style.maxWidth)).toBe(TOPE_ANCHO_BARRA);
    }
  });
});
