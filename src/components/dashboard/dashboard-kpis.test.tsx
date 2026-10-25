import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { DashboardKpis as DashboardKpisContrato } from "@/types/api";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { ROLES_TODOS, MUESTRA_PREGUNTAS_POR_RESOLVER } from "@/lib/roles";
import type { Rol } from "@/types/enums";
import { claseConPrefijo, contrasteEntreClases, hojasDeTexto, tintaHeredada, TEMAS } from "./contraste.testutil";
import { DashboardKpis, conFilaSinTecnologia } from "./dashboard-kpis";

function kpis(overrides: Partial<DashboardKpisContrato> = {}): DashboardKpisContrato {
  return {
    catalogo_total: { valor: 764, delta: null },
    // Fixture COHERENTE con la invariante del contrato:
    //   piezas_disponibles + piezas_sobre_reservadas === piezas_disponibles_neto
    // (24,850 − 430 = 24,420). Antes traía `sobre_reservados: 12` junto a
    // `piezas_sobre_reservadas: 0`, que es un estado imposible.
    piezas_disponibles: { valor: 24850, delta: null },
    piezas_disponibles_neto: { valor: 24420, delta: null },
    piezas_sobre_reservadas: { valor: -430, delta: null },
    skus_disponibles: { valor: 700, delta: null },
    sobre_reservados: { valor: 12, delta: null },
    piezas_en_camino: { valor: 3200, delta: null },
    retrasados: { valor: 4, delta: null },
    sin_v2: { valor: 22, delta: null },
    sin_tecnologia: { valor: 37, delta: null },
    // [FIX-B1 · T3] Universo REAL (contado sobre el catálogo, no la RPC de
    // pendientes) — distinto a propósito de `sin_tecnologia` en este fixture,
    // para que ninguna prueba pueda confundir las dos cifras por coincidencia.
    productos_sin_tecnologia: { valor: 44, delta: null },
    pendientes: { valor: 5, delta: null },
    ...overrides,
  };
}

describe("DashboardKpis", () => {
  // [MVP-CIERRE] F5 · el caso limpio: sin sobre-reservados, cabecera y neto
  // son idénticos y pintarlos por separado sugeriría una distinción que no
  // existe. La tarjeta oculta las dos líneas extra.
  it("sin sobre-reservados: no pinta ni la alerta ni el neto", () => {
    render(
      <DashboardKpis
        kpis={kpis({
          sobre_reservados: { valor: 0, delta: null },
          piezas_sobre_reservadas: { valor: 0, delta: null },
          piezas_disponibles_neto: { valor: 24850, delta: null },
        })}
        rol="admin"
      />,
    );
    expect(screen.getByText("700 SKUs con disponible")).toBeInTheDocument();
    expect(screen.queryByText(/Neto con sobre-reservas/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sobre-reservados/i })).not.toBeInTheDocument();
  });

  it("renderiza los KPIs ratificados con sus subs derivados (rol admin: 4 tarjetas)", () => {
    render(<DashboardKpis kpis={kpis()} rol="admin" />);
    expect(screen.getByText("SKUs en catálogo")).toBeInTheDocument();
    expect(screen.getByText("764")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "22 sin fila en clasificación v2" })).toHaveAttribute("href", "/catalogo?sinV2=1");
    expect(screen.getByRole("link", { name: "44 productos sin tecnología →" })).toHaveAttribute(
      "href",
      `/catalogo?tecnologia=${SIN_TECNOLOGIA}`,
    );
    expect(screen.getByRole("link", { name: "37 preguntas de tecnología por resolver →" })).toHaveAttribute(
      "href",
      "/config?tab=pendientes",
    );

    expect(screen.getByText("Piezas disponibles")).toBeInTheDocument();
    expect(screen.getByText("24,850")).toBeInTheDocument();
    expect(screen.getByText("700 SKUs con disponible")).toBeInTheDocument();
    // [MVP-CIERRE] F5 · los sobre-reservados tienen superficie y drill-down,
    // y el neto queda ROTULADO en vez de disfrazado de "disponibles".
    expect(screen.getByRole("link", { name: "12 SKUs sobre-reservados (−430 pz)" })).toHaveAttribute(
      "href",
      "/catalogo?badge=sobre_reservado",
    );
    expect(screen.getByText(/Neto con sobre-reservas: 24,420/)).toBeInTheDocument();

    expect(screen.getByText("En camino")).toBeInTheDocument();
    expect(screen.getByText("3,200")).toBeInTheDocument();
    expect(screen.getByText("4 con retraso")).toBeInTheDocument();

    expect(screen.getByText("Pendientes de datos")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("el delta chip SOLO aparece en 'En camino' (política 'solo honestos')", () => {
    const fixture = kpis({
      piezas_en_camino: { valor: 3200, delta: { valor: 50, pct: 1.6, periodo_base: "2026-04", direccion: "sube" } },
    });
    render(<DashboardKpis kpis={fixture} rol="admin" />);
    expect(screen.getByText(/vs abr 2026/)).toBeInTheDocument();
    expect(screen.getByText("+50 (+1.6%) vs abr 2026")).toBeInTheDocument();
  });

  it("sin delta (piezas_en_camino.delta === null): no se pinta ningún chip de delta", () => {
    render(<DashboardKpis kpis={kpis()} rol="admin" />);
    expect(screen.queryByText(/vs [a-z]{3} \d{4}/)).not.toBeInTheDocument();
  });

  it("direccion 'baja': signo '−' en el chip (valor y pct)", () => {
    const fixture = kpis({
      piezas_en_camino: { valor: 3200, delta: { valor: 80, pct: -2, periodo_base: "2026-04", direccion: "baja" } },
    });
    render(<DashboardKpis kpis={fixture} rol="admin" />);
    expect(screen.getByText("−80 (−2.0%) vs abr 2026")).toBeInTheDocument();
  });

  it("INFO-pct: pct !== null se pinta entre paréntesis con 1 decimal", () => {
    const fixture = kpis({
      piezas_en_camino: { valor: 3200, delta: { valor: 123, pct: 4.2, periodo_base: "2026-04", direccion: "sube" } },
    });
    render(<DashboardKpis kpis={fixture} rol="admin" />);
    expect(screen.getByText("+123 (+4.2%) vs abr 2026")).toBeInTheDocument();
  });

  it("INFO-pct: pct === null (base=0, sin porcentaje honesto) no pinta paréntesis", () => {
    const fixture = kpis({
      piezas_en_camino: { valor: 50, delta: { valor: 50, pct: null, periodo_base: "2026-04", direccion: "sube" } },
    });
    render(<DashboardKpis kpis={fixture} rol="admin" />);
    expect(screen.getByText("+50 vs abr 2026")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("rol admin: sub de 'Pendientes de datos' es un link a /config?tab=pendientes", () => {
    render(<DashboardKpis kpis={kpis()} rol="admin" />);
    const link = screen.getByRole("link", { name: "Resolver en Configuración →" });
    expect(link).toHaveAttribute("href", "/config?tab=pendientes");
  });
});

/**
 * [MVP-2 · frente E, vocabulario] Decisión de producto: KAM/Visitante dejan de
 * ver el vocabulario técnico "clasificación v2" — Admin lo conserva.
 */
describe("DashboardKpis — sub de 'SKUs en catálogo': vocabulario v2 exclusivo de admin ([MVP-2] frente E)", () => {
  it("rol admin: SÍ ve el enlace 'sin fila en clasificación v2'", () => {
    render(<DashboardKpis kpis={kpis()} rol="admin" />);
    expect(screen.getByRole("link", { name: "22 sin fila en clasificación v2" })).toHaveAttribute("href", "/catalogo?sinV2=1");
  });

  it("rol kam: NO ve el enlace 'sin fila en clasificación v2'", () => {
    render(<DashboardKpis kpis={kpis()} rol="kam" />);
    expect(screen.queryByRole("link", { name: /sin fila en clasificación v2/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/clasificación v2/)).not.toBeInTheDocument();
  });
});

describe("conFilaSinTecnologia (ronda de revisión INV-B7B, punto B — aritmética movida fuera del render, con recorte a 0)", () => {
  it("caso normal: sin_tecnologia > sin_v2 → la resta directa", () => {
    const fixture = kpis({ sin_v2: { valor: 28, delta: null }, sin_tecnologia: { valor: 37, delta: null } });
    expect(conFilaSinTecnologia(fixture)).toBe(9);
  });

  it("iguales: 0, no negativo ni undefined", () => {
    const fixture = kpis({ sin_v2: { valor: 28, delta: null }, sin_tecnologia: { valor: 28, delta: null } });
    expect(conFilaSinTecnologia(fixture)).toBe(0);
  });

  it("RECORTE A 0 (defensivo): si la invariante 'sin_v2 ⊆ sin_tecnologia' se rompiera en dashboard.service.ts y sin_v2 > sin_tecnologia, esta función NUNCA regresa un número negativo", () => {
    const fixture = kpis({ sin_v2: { valor: 43, delta: null }, sin_tecnologia: { valor: 37, delta: null } });
    expect(conFilaSinTecnologia(fixture)).toBe(0);
  });

  it("ambos en 0: 0", () => {
    const fixture = kpis({ sin_v2: { valor: 0, delta: null }, sin_tecnologia: { valor: 0, delta: null } });
    expect(conFilaSinTecnologia(fixture)).toBe(0);
  });
});

/**
 * [FIX-B1 · T3] LA PUERTA DEL DEFECTO MEDIDO: la RPC `contar_pendientes()`
 * sólo cuenta para `admin` (dato del eje 1). Antes esta tarjeta le mostraba a
 * TODOS los roles un enlace "{sin_tecnologia} sin tecnología asignada", y
 * para cualquier no-admin `sin_tecnologia` viene en 0 SIEMPRE — no porque no
 * haya pendientes, sino porque el rol no tiene permiso para que la RPC se
 * los cuente. Un 0 fabricado por el permiso se ve IDÉNTICO a un 0 real, así
 * que la única forma honesta de no mentir es no mostrar la superficie.
 *
 * Parametrizada sobre TODOS los roles sin la bandeja (molde de la casa: un
 * rol nuevo con `MUESTRA_PREGUNTAS_POR_RESOLVER=false` cae aquí solo,
 * ningún `if` nuevo que alguien tenga que acordarse de escribir), y con DOS
 * fixtures — la forma real de producción (0 en las dos RPC-cifras) Y una
 * fixture con valores distintos de cero (P25: si sólo se probara el caso
 * `0`, un defecto que sólo se manifiesta con datos reales pasaría en verde
 * por la razón equivocada — "no hay texto" en vez de "el texto está
 * oculto").
 */
describe("DashboardKpis — FIX-B1 · roles sin `MUESTRA_PREGUNTAS_POR_RESOLVER`: la bandeja de tecnología se OCULTA, no se pinta en 0", () => {
  const ROLES_SIN_BANDEJA = ROLES_TODOS.filter((r) => !MUESTRA_PREGUNTAS_POR_RESOLVER[r]);

  // Anti-vacuidad (P17): si el reparto de roles cambiara y esta lista
  // quedara vacía, el `it.each` de abajo no correría ningún caso y la
  // descripción completa del bloque pasaría en verde sin haber mirado nada.
  it("hay al menos un rol sin la bandeja (si esto falla, el resto de este describe no prueba nada)", () => {
    expect(ROLES_SIN_BANDEJA.length).toBeGreaterThan(0);
  });

  const FIXTURES: Array<{ nombre: string; overrides: Partial<DashboardKpisContrato> }> = [
    {
      nombre: "forma real de producción: sin_tecnologia 0, pendientes 0 (lo que la RPC devuelve a un no-admin)",
      overrides: { sin_tecnologia: { valor: 0, delta: null }, pendientes: { valor: 0, delta: null } },
    },
    {
      nombre: "valores distintos de cero (si la RPC un día SÍ contara, igual se ocultan)",
      overrides: { sin_tecnologia: { valor: 37, delta: null }, pendientes: { valor: 5, delta: null } },
    },
  ];

  for (const rol of ROLES_SIN_BANDEJA) {
    for (const { nombre, overrides } of FIXTURES) {
      it(`${rol} · ${nombre}`, () => {
        render(<DashboardKpis kpis={kpis(overrides)} rol={rol as Rol} />);

        expect(screen.queryByText(/tecnolog/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/preguntas/i)).not.toBeInTheDocument();
        expect(screen.queryByText("Pendientes de datos")).not.toBeInTheDocument();

        const tarjetas = document.querySelectorAll(".rounded-\\[15px\\]");
        expect(tarjetas.length, "3 tarjetas: catálogo, disponibles, en camino").toBe(3);
      });
    }
  }
});

/**
 * La puerta de E-2.
 *
 * La forma en que una tarjeta de KPI miente es **recortando una cifra**. Un
 * «24,8…» o un «2» donde iba «24,850» no revienta nada: se ve como una tarjeta
 * normal con un número distinto. Por eso la invariante del carril no es
 * geométrica sino de política: **si no cabe, la tarjeta crece en alto; la cifra
 * nunca se trunca.**
 *
 * Lo que jsdom NO puede medir —que a 207, 271 o 309 px de ancho real ningún dígito
 * se recorte— es trabajo de `layout-check`, que sí tiene un navegador. Aquí se
 * cierra la otra mitad: que no exista en el árbol ninguna instrucción que PERMITA
 * recortar. Las dos mitades, otra vez; ninguna sola basta.
 */
describe("DashboardKpis · E-2 · la cifra nunca se trunca: la tarjeta crece", () => {
  /** Clases que autorizan a recortar, ocultar o impedir que el texto parta línea. */
  const RECORTA = ["truncate", "overflow-hidden", "text-ellipsis", "text-clip", "whitespace-nowrap"];

  function ancestrosHasta(el: HTMLElement, raiz: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    let n: HTMLElement | null = el;
    while (n && n !== raiz.parentElement) {
      out.push(n);
      n = n.parentElement;
    }
    return out;
  }

  it("ni la cifra grande ni ninguno de sus ancestros autoriza recortar", () => {
    const { container } = render(<DashboardKpis kpis={kpis()} rol="admin" />);
    const cifra = screen.getByText("24,850");

    for (const el of ancestrosHasta(cifra, container)) {
      for (const clase of RECORTA) {
        expect(
          el.className.split(/\s+/),
          `<${el.tagName.toLowerCase()}> autoriza \`${clase}\` sobre la cifra`,
        ).not.toContain(clase);
      }
    }
  });

  // El chip de delta es el elemento más largo de la tarjeta —signo, cifra,
  // porcentaje y periodo base— y era el único con `whitespace-nowrap`: no podía
  // partir línea, así que a poco ancho empujaba fuera a la cifra en vez de bajar.
  it("el chip de delta puede partir línea", () => {
    const conDelta = kpis({
      piezas_en_camino: { valor: 3200, delta: { valor: 50, pct: 1.6, periodo_base: "2026-04", direccion: "sube" } },
    });
    const { container } = render(<DashboardKpis kpis={conDelta} rol="admin" />);
    const chip = screen.getByText(/vs abr 2026/).closest("span") as HTMLElement;

    expect(chip).toBeInTheDocument();
    expect(chip.className).not.toContain("whitespace-nowrap");
    expect(container.innerHTML).not.toContain("whitespace-nowrap");
  });

  it("ninguna tarjeta declara alto fijo: el alto lo pone el contenido", () => {
    const { container } = render(<DashboardKpis kpis={kpis()} rol="admin" />);
    const tarjetas = Array.from(container.querySelectorAll<HTMLElement>("div")).filter((d) =>
      d.className.includes("rounded-[15px]"),
    );

    expect(tarjetas.length, "se esperaban las 4 tarjetas del molde").toBe(4);
    for (const t of tarjetas) {
      expect(claseConPrefijo(t.className, "h-[")).toBeUndefined();
      expect(claseConPrefijo(t.className, "max-h-")).toBeUndefined();
    }
  });

  it("todo texto de las tarjetas cumple 4,5:1 contra su superficie, en los dos temas", () => {
    const { container } = render(<DashboardKpis kpis={kpis()} rol="admin" />);

    const tintas = new Set<string>();
    for (const el of hojasDeTexto(container)) {
      const tinta = tintaHeredada(el, container);
      if (!tinta) continue; // el chip de delta usa `text-info`, que se mide aparte
      tintas.add(tinta);
    }
    expect(tintas.size).toBeGreaterThan(0);
    for (const tinta of Array.from(tintas)) {
      for (const tema of TEMAS) {
        const razon = contrasteEntreClases(tinta, "bg-surface", tema);
        expect(razon, `${tinta} sobre la tarjeta en ${tema} = ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
