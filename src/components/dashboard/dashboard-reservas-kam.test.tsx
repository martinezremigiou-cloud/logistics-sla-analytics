import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DashboardReservasKam, ReservaKamItem } from "@/types/api";
import { contrasteEntreClases, hexDeToken, razonDeContraste, TEMAS } from "./contraste.testutil";
import {
  anchoDeBarra,
  cabeLaCifra,
  DashboardReservasKamCard,
  empaquetar,
  MIN_BARRA_LEYENDA,
  RAMPA_RESERVAS,
  radioDeBurbuja,
  rotuloDelUniverso,
  tintaDelPaso,
  TONO_SIN_KAM,
  tonoDeRango,
} from "./dashboard-reservas-kam";

/**
 * El contrato lleva su denominador pegado al dato. Este helper lo
 * declara en cada caso en vez de dejarlo implícito — si un fixture no dice cuántos
 * KAM había, la prueba no puede afirmar nada sobre el recorte.
 */
const conUniverso = (items: ReservaKamItem[], total_kams?: number, total_piezas?: number): DashboardReservasKam => ({
  items,
  total_kams: total_kams ?? items.length,
  total_piezas: total_piezas ?? items.reduce((a, i) => a + i.piezas, 0),
});

/** Un reparto INVENTADO, muy disperso (36×), con tres KAM de más fuera del chart. */
const REPARTO: DashboardReservasKam = {
  items: [
    { kam: "Elena", piezas: 52200 },
    { kam: "Diego", piezas: 36540 },
    { kam: "Lucas", piezas: 21800 },
    { kam: "Julio", piezas: 12600 },
    { kam: "Laura", piezas: 3320 },
    { kam: "Sergio", piezas: 1450 },
  ],
  total_kams: 9,
  total_piezas: 130470,
};

describe("radioDeBurbuja (pura)", () => {
  // EL control positivo del carril. El error clásico de la burbuja es poner el RADIO
  // proporcional al valor: eso hace que el area crezca con el CUADRADO y exagere el
  // rango 36x en 36x mas en vez de en su raiz, 6x. La codificacion correcta es
  // AREA proporcional, o sea radio proporcional a la RAIZ.
  it("el ÁREA es proporcional al valor: cuadruplicar las piezas DUPLICA el radio", () => {
    expect(radioDeBurbuja(400, 400, 100)).toBeCloseTo(100, 6);
    expect(radioDeBurbuja(100, 400, 100)).toBeCloseTo(50, 6);
    expect(radioDeBurbuja(25, 400, 100)).toBeCloseTo(25, 6);
  });

  it("un reparto disperso comprime 36× en 6× — que es la razón de cambiar de forma", () => {
    const max = 52200;
    const rMayor = radioDeBurbuja(52200, max, 62);
    const rMenor = radioDeBurbuja(1450, max, 62);

    expect(52200 / 1450).toBeCloseTo(36, 2); // el rango en PIEZAS
    expect(rMayor / rMenor).toBeCloseTo(Math.sqrt(52200 / 1450), 6); // el rango en RADIO
    expect(rMayor / rMenor).toBeCloseTo(6, 2);
    // Y el mas chico sale VISIBLE sin ningun piso: 10,3 px de radio.
    expect(rMenor).toBeGreaterThan(10);
  });

  // «Cero visible, no fabricado», aplicado al area: un KAM sin piezas no puede
  // recibir un radio minimo, porque eso le inventaria una magnitud. Se nombra en la
  // leyenda con su cero — no se dibuja un circulo que afirme algo falso.
  it("cero piezas → radio CERO: no se le fabrica un mínimo", () => {
    expect(radioDeBurbuja(0, 400, 100)).toBe(0);
    expect(radioDeBurbuja(0, 0, 100)).toBe(0);
  });
});

describe("empaquetar (pura)", () => {
  const radios = [62, 51.9, 40.1, 30.5, 15.6, 10.3];

  it("ninguna burbuja se solapa con otra", () => {
    const cs = empaquetar(radios);
    expect(cs).toHaveLength(radios.length);

    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const d = Math.hypot(cs[i].cx - cs[j].cx, cs[i].cy - cs[j].cy);
        expect(d, `${i} y ${j} se solapan: distancia ${d.toFixed(2)} < ${(cs[i].r + cs[j].r).toFixed(2)}`).toBeGreaterThanOrEqual(
          cs[i].r + cs[j].r - 0.001,
        );
      }
    }
  });

  it("es determinista: la misma entrada da la misma salida", () => {
    expect(empaquetar(radios)).toEqual(empaquetar(radios));
  });

  it("una sola burbuja se queda en el origen, y cero burbujas no revientan", () => {
    expect(empaquetar([50])).toEqual([{ cx: 0, cy: 0, r: 50 }]);
    expect(empaquetar([])).toEqual([]);
  });

  // Un radio 0 (KAM sin piezas) no puede empujar al resto ni ocupar un hueco: no
  // dibuja nada, asi que tampoco debe reservar sitio.
  it("un radio 0 no desplaza a las demás", () => {
    const sinCero = empaquetar([62, 30]);
    const conCero = empaquetar([62, 30, 0]);
    expect(conCero.slice(0, 2)).toEqual(sinCero);
  });
});

describe("rotuloDelUniverso (pura)", () => {
  // El rotulo se DERIVA del campo, nunca se escribe literal: el dia que
  // `total_kams === items.length` se simplifica solo, sin que nadie lo apague a mano.
  it("con recorte, declara las dos fracciones", () => {
    expect(rotuloDelUniverso(REPARTO)).toBe("6 de 9 KAM · 127,910 de 130,470 piezas");
  });

  it("SIN recorte, no inventa un corte que no existe", () => {
    const todo = conUniverso([
      { kam: "A", piezas: 10 },
      { kam: "B", piezas: 5 },
    ]);
    expect(rotuloDelUniverso(todo)).toBe("2 KAM · 15 piezas");
  });

  it("sin datos, no dice nada", () => {
    expect(rotuloDelUniverso(conUniverso([]))).toBeNull();
  });
});

describe("DashboardReservasKamCard · E-6 · el cúmulo", () => {
  it("[] → 'Sin reservas registradas.'", () => {
    render(<DashboardReservasKamCard reservas={conUniverso([])} />);
    expect(screen.getByText("Sin reservas registradas.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Reservas por KAM/ })).not.toBeInTheDocument();
  });

  // La burbuja ORDENA bien y CUANTIFICA mal: el ojo subestima el area. La
  // contramedida es estandar y no es opcional — la cifra va escrita. Sin ella el
  // chart cambia una mentira (el piso del 5 %) por otra (el area percibida).
  it("cada KAM trae su NOMBRE y su CIFRA como texto real", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const leyenda = container.querySelector("[data-leyenda-kam]") as HTMLElement;

    for (const i of REPARTO.items) {
      expect(within(leyenda).getByText(i.kam as string)).toBeInTheDocument();
    }
    expect(within(leyenda).getByText("52,200")).toBeInTheDocument();
    expect(within(leyenda).getByText("1,450")).toBeInTheDocument();
  });

  it("el rótulo del universo se pinta, derivado del campo", () => {
    render(<DashboardReservasKamCard reservas={REPARTO} />);
    expect(screen.getByText("6 de 9 KAM · 127,910 de 130,470 piezas")).toBeInTheDocument();
  });

  // El bucket nulo no existe en el vigente de hoy, pero el camino SI existe en el
  // codigo: si un dia hay reservas sin KAM, tiene que nombrarse igual que las demas.
  it("el bucket sin KAM se nombra igual que cualquier otro, si existe", () => {
    const con = conUniverso([
      { kam: "LUCAS", piezas: 500 },
      { kam: null, piezas: 120 },
    ]);
    const { container } = render(<DashboardReservasKamCard reservas={con} />);
    const leyenda = container.querySelector("[data-leyenda-kam]") as HTMLElement;
    expect(within(leyenda).getByText("Sin KAM (directo a cliente)")).toBeInTheDocument();
    expect(within(leyenda).getByText("120")).toBeInTheDocument();
  });

  // CONTROL POSITIVO · un KAM en cero no puede desaparecer en silencio. No dibuja
  // circulo —eso le inventaria magnitud— pero SE NOMBRA con su cero.
  it("CONTROL POSITIVO · un KAM con 0 piezas no dibuja círculo, pero se nombra", () => {
    const con = conUniverso([
      { kam: "LUCAS", piezas: 500 },
      { kam: "VACIO", piezas: 0 },
    ]);
    const { container } = render(<DashboardReservasKamCard reservas={con} />);
    const leyenda = container.querySelector("[data-leyenda-kam]") as HTMLElement;

    expect(within(leyenda).getByText("VACIO")).toBeInTheDocument();
    expect(within(leyenda).getByText("0")).toBeInTheDocument();
    // Acotado al GRAFICO, no al DOM entero: el icono `Users` de lucide lleva su
    // propio `<circle>` en la cabecera, asi que `container.querySelectorAll("svg circle")`
    // contaba dos y no medía las burbujas (P27, medir la representacion en vez de la cosa).
    const grafico = screen.getByRole("img", { name: /Reservas por KAM/ });
    expect(grafico.querySelectorAll("circle")).toHaveLength(1); // solo LUCAS
  });

  // El color ESPERA AL ARTEFACT: la rampa monocroma no esta firmada. Lo que si esta
  // cerrado es que no puede usar un tono del riel — seis de los ocho ya significan
  // los grupos, en la misma pantalla.
  it("no usa NINGÚN tono del riel: dos significados en un color es lo que esto evita", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const DEL_RIEL = ["--mx-navy-ink", "--mx-info", "--mx-graf-pizarra", "--mx-accent", "--mx-graf-petroleo", "--mx-graf-jade"];

    for (const t of DEL_RIEL) {
      expect(RAMPA_RESERVAS as readonly string[]).not.toContain(t);
      expect(container.innerHTML, `el cúmulo usa ${t}, que es un grupo del riel`).not.toContain(t);
    }
  });

  // La RAMPA codifica el RANGO, no la magnitud — eso lo hace el area. Por eso el paso
  // sale del INDICE (que es el rango, porque el servicio ya ordeno) y no de las piezas.
  it("cada burbuja toma el paso de rampa de SU rango, en orden", () => {
    render(<DashboardReservasKamCard reservas={REPARTO} />);
    const grafico = screen.getByRole("img", { name: /Reservas por KAM/ });
    const rellenos = Array.from(grafico.querySelectorAll("circle")).map((c) => (c as SVGElement).style.fill);

    expect(rellenos).toHaveLength(6);
    rellenos.forEach((f, i) => expect(f, `la burbuja ${i + 1} no lleva el paso ${i + 1}`).toContain(RAMPA_RESERVAS[i]));
  });

  // El bucket nulo NO es un rango: es la ausencia de KAM. Darle un paso diria que esta
  // ranqueado. Va en neutro, y ese neutro pasa 3:1 — el `--mx-muted-3` de la barra
  // anterior daba 1,36:1 (M-7a).
  it("el bucket sin KAM va en NEUTRO, fuera de la rampa", () => {
    expect(tonoDeRango(0, true)).toBe(TONO_SIN_KAM);
    expect(tonoDeRango(0, false)).toBe(RAMPA_RESERVAS[0]);
    expect(RAMPA_RESERVAS as readonly string[]).not.toContain(TONO_SIN_KAM);

    const con = conUniverso([
      { kam: "LUCAS", piezas: 500 },
      { kam: null, piezas: 120 },
    ]);
    render(<DashboardReservasKamCard reservas={con} />);
    const grafico = screen.getByRole("img", { name: /Reservas por KAM/ });
    const rellenos = Array.from(grafico.querySelectorAll("circle")).map((c) => (c as SVGElement).style.fill);
    expect(rellenos[1]).toContain(TONO_SIN_KAM);
  });

  // La otra mitad del contrato A: `riel-contraste.test.ts` afirma que ALGUNA tinta pasa
  // en cada paso; esta afirma que la que el COMPONENTE elige es esa. Una sola de las dos
  // dejaria pasar un paso con la tinta equivocada y la tabla en verde (P27).
  it("la tinta que el componente elige por paso es una que PASA 4,5:1, en los dos temas", () => {
    for (let i = 0; i < RAMPA_RESERVAS.length; i++) {
      const tinta = tintaDelPaso(i).replace("--", "");
      const relleno = RAMPA_RESERVAS[i].replace("--", "");
      for (const tema of TEMAS) {
        const razon = razonDeContraste(hexDeToken(tinta, tema), hexDeToken(relleno, tema));
        expect(razon, `paso ${i + 1} en ${tema}: ${tinta} sobre ${relleno} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // La cifra dentro es ARITMETICA, no ojo: n caracteres a 11 px miden ~n*0,62*11 y la
  // cuerda util de un circulo de radio r es ~1,7*r. De ahi r >= n*4,01.
  it("la cifra entra en la burbuja solo si CABE, y las que no caben siguen en la leyenda", () => {
    expect(cabeLaCifra(62, 6)).toBe(true); // Elena, «52,200»
    expect(cabeLaCifra(10.3, 5)).toBe(false); // Sergio, «1,450»
    expect(cabeLaCifra(24.1, 6)).toBe(true);
    expect(cabeLaCifra(24.0, 6)).toBe(false);

    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const grafico = screen.getByRole("img", { name: /Reservas por KAM/ });
    expect(grafico.querySelectorAll("text").length).toBeGreaterThan(0);
    expect(grafico.querySelectorAll("text").length).toBeLessThan(6); // las chicas no caben
    const leyenda = container.querySelector("[data-leyenda-kam]") as HTMLElement;
    expect(within(leyenda).getByText("1,450")).toBeInTheDocument(); // y aun asi esta escrita
  });

  it("el SVG se anuncia con un nombre que dice qué se está midiendo", () => {
    render(<DashboardReservasKamCard reservas={REPARTO} />);
    expect(screen.getByRole("img", { name: /Reservas por KAM/ })).toBeInTheDocument();
  });

  it("todo texto de la tarjeta cumple 4,5:1 contra su superficie, en los dos temas", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const tintas = new Set<string>();
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("*"))) {
      const clases = typeof el.className === "string" ? el.className.split(/\s+/) : [];
      for (const c of clases) if (c.startsWith("text-ink")) tintas.add(c);
    }
    expect(tintas.size).toBeGreaterThan(0);
    for (const tinta of Array.from(tintas)) {
      for (const tema of TEMAS) {
        const razon = contrasteEntreClases(tinta, "bg-surface", tema);
        expect(razon, `${tinta} en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

/**
 * [DASH-F · D-3] La barra de la leyenda.
 *
 * La primera medición midió el hueco VERTICAL (70 px) y concluyó que no cabía
 * una gráfica; el hueco bueno era el
 * HORIZONTAL, que medido a 1280 son **~358 px por renglón × 6**. La barra cabe sin
 * mover un píxel de la fila, que era exactamente su condición.
 */
describe("anchoDeBarra (pura) — [DASH-F · D-3]", () => {
  it("el denominador es el MAYOR de la serie, no el total", () => {
    // Con el total, el mayor sería una fracción pequeña y las seis barras se aplastarían
    // contra el borde izquierdo. Contra el mayor, la primera llena la pista.
    expect(anchoDeBarra(52200, 52200)).toBe(100);
    expect(anchoDeBarra(36540, 52200)).toBeCloseTo(70, 2);
  });

  it("un reparto disperso: el menor es el 2,8 % del mayor, y eso NO se maquilla", () => {
    // 36× de dispersión. La barra dice la proporción que hay, no una cómoda.
    const anchos = REPARTO.items.map((i) => anchoDeBarra(i.piezas, 52200));
    expect(anchos[0]).toBe(100);
    expect(anchos[5]).toBeCloseTo(2.78, 2);
    // Y es monótona, porque el servicio entrega ordenado.
    for (let i = 1; i < anchos.length; i++) expect(anchos[i]).toBeLessThanOrEqual(anchos[i - 1]);
  });

  it("casos degenerados: sin máximo no hay proporción, y cero es cero", () => {
    expect(anchoDeBarra(100, 0)).toBe(0);
    expect(anchoDeBarra(0, 52200)).toBe(0);
  });
});

describe("DashboardReservasKamCard · la leyenda con barras — [DASH-F · D-3]", () => {
  it("una barra por renglón, con el ancho que dice la función pura", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra-kam]"));
    expect(barras).toHaveLength(REPARTO.items.length);

    const esperado = REPARTO.items.map((i) => anchoDeBarra(i.piezas, 52200));
    const pintado = barras.map((b) => parseFloat(b.style.width));
    pintado.forEach((w, i) => expect(w).toBeCloseTo(esperado[i], 6));
    // La primera llena la pista: es la referencia de la escala, y por eso la leyenda
    // no lleva carril de fondo.
    expect(pintado[0]).toBe(100);
  });

  it("la barra y su burbuja dicen lo MISMO con el mismo color", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra-kam]"));
    barras.forEach((b, i) => {
      expect(b.style.backgroundColor).toBe(`var(${tonoDeRango(i, false)})`);
    });
  });

  it("la leyenda es una REJILLA: cuatro celdas por renglón, no un flex por fila", () => {
    // No es un detalle de implementación. Con un flex por renglón la pista de la barra
    // mediría lo que sobra DESPUÉS del nombre, así que un KAM de nombre largo tendría
    // una pista más corta y su barra no sería comparable con la del vecino. Dos barras
    // que no comparten escala no son una gráfica.
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const leyenda = container.querySelector("[data-leyenda-kam]") as HTMLElement;
    expect(leyenda.children).toHaveLength(REPARTO.items.length * 4);
  });

  it("un KAM en CERO no recibe barra fabricada: ancho 0 y sin mínimo", () => {
    // «Cero visible, no fabricado», el mismo criterio que ya gobierna su burbuja.
    const conCero = conUniverso([
      { kam: "Elena", piezas: 52200 },
      { kam: "Nadie", piezas: 0 },
    ]);
    const { container } = render(<DashboardReservasKamCard reservas={conCero} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra-kam]"));
    expect(parseFloat(barras[1].style.width)).toBe(0);
    expect(parseFloat(barras[1].style.minWidth) || 0).toBe(0);
  });

  it("una barra de valor > 0 nunca desaparece: lleva el mínimo declarado", () => {
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const barras = Array.from(container.querySelectorAll<HTMLElement>("[data-barra-kam]"));
    for (const b of barras) expect(b.style.minWidth).toBe(`${MIN_BARRA_LEYENDA}px`);
  });

  it("la cifra exacta sigue al lado de cada barra — la barra no la sustituye", () => {
    // Se acota a la LEYENDA a propósito: la cifra sale dos veces, porque las cuatro
    // burbujas mayores la llevan dentro. Buscar en todo el documento encontraría dos
    // nodos y la prueba fallaría midiendo otra cosa.
    const { container } = render(<DashboardReservasKamCard reservas={REPARTO} />);
    const leyenda = within(container.querySelector("[data-leyenda-kam]") as HTMLElement);
    for (const i of REPARTO.items) {
      expect(leyenda.getByText(i.piezas.toLocaleString("en-US"))).toBeInTheDocument();
    }
  });
});
