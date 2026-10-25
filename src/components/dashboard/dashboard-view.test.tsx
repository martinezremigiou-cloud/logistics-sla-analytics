import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SessionProvider, type SesionUsuario } from "@/components/providers/session-provider";
import type { DashboardResponse } from "@/types/api";
import { DashboardView } from "./dashboard-view";
import { agruparPipeline } from '@/services/dashboard.service';

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

const ALMACENES = ["NORTH", "SOUTH", "EAST", "TRAN", "BO", "WEST"] as const;
const NOMBRES_ETAPA = [
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

function pipelineFixture(): DashboardResponse["pipeline"] {
  return NOMBRES_ETAPA.map((nombre, i) => ({ orden: i + 1, nombre, activos: i === 6 ? 3 : 0, piezas: i === 6 ? 90 : 0 }));
}

function respuestaCompleta(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    snapshot: {
      stock: { id: "snap-stock", created_at: "2026-07-10T00:00:00.000Z", filas: 900, archivo: "stock.xlsx", vigente: true },
      aduana: { id: "snap-aduana", created_at: "2026-07-09T00:00:00.000Z", filas: 40, archivo: "aduana.xlsx", vigente: true },
    },
    periodos: { actual: "2026-07", anterior: "2026-04" },
    kpis: {
      catalogo_total: { valor: 764, delta: null },
      piezas_disponibles: { valor: 24850, delta: null },
      piezas_disponibles_neto: { valor: 24850, delta: null },
      piezas_sobre_reservadas: { valor: 0, delta: null },
      skus_disponibles: { valor: 700, delta: null },
      sobre_reservados: { valor: 12, delta: null },
      piezas_en_camino: { valor: 3200, delta: { valor: 50, pct: 1.6, periodo_base: "2026-04", direccion: "sube" } },
      retrasados: { valor: 4, delta: null },
      sin_v2: { valor: 22, delta: null },
      sin_tecnologia: { valor: 37, delta: null },
      productos_sin_tecnologia: { valor: 44, delta: null },
      pendientes: { valor: 5, delta: null },
    },
    heatmap: {
      eje_y: "marca",
      eje_x: "almacen",
      // Marca distinta de las del radar (BRAND1/SERIES5/EAS, ver abajo) a propósito:
      // evita colisión de texto duplicado en la vista completa (radar + heatmap juntos).
      filas: ["NACIONAL"],
      columnas: [...ALMACENES],
      celdas: [{ fila: "NACIONAL", columna: "NORTH", valor: 100 }],
      max: 100,
      tecnologia_activa: null,
      tecnologias: [],
      total_marcas: 1,
    },
    radar: {
      series: [
        { marca: "BRAND1", ejes: { disponible: 100, reservado: 20, en_aduana: 10, en_riesgo: 0 } },
        { marca: "SERIES5", ejes: { disponible: 50, reservado: 10, en_aduana: 5, en_riesgo: 3 } },
        { marca: "EAS", ejes: { disponible: 30, reservado: 5, en_aduana: 2, en_riesgo: 1 } },
      ],
      // Hay corte: 3 dibujadas de 7 con stock. Es lo que E-4 tendra que confesar.
      total_marcas: 7,
    },
    top_sobre_reservados: [{ sku: "A-1", descripcion: "Candado", marca: "BRAND1", disponible: -12, reservado: 40, total: 28 }],
    reservas_por_kam: {
      items: [
        { kam: "LUCAS", piezas: 500 },
        { kam: null, piezas: 120 },
      ],
      // Hay recorte: 2 pintados de 4 KAM. Es lo que E-6 tendra que confesar.
      total_piezas: 900,
      total_kams: 4,
    },
    pipeline: pipelineFixture(),
    pipeline_grupos: agruparPipeline(pipelineFixture()),
    tendencia: [
      { periodo: "2026-04", piezas: 20000, cortes: 1 },
      { periodo: "2026-07", piezas: 24850, cortes: 1 },
    ],
    alertas: [
      { tipo: "sobre_reservado", conteo: 12, href: "/catalogo?badge=sobre_reservado" },
      { tipo: "retrasado", conteo: 4, href: "/embarques?retrasado=1" },
      { tipo: "sin_v2", conteo: 22, href: "/catalogo?sinV2=1" },
      { tipo: "descuadre_reservas", conteo: 0, href: "/config?tab=pendientes" },
      { tipo: "pendientes", conteo: 5, href: "/config?tab=pendientes" },
    ],
    ...overrides,
  };
}

type Responder = () => { status: number; body: unknown };
let responder: Responder = () => ({ status: 200, body: respuestaCompleta() });

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/dashboard")) {
        const { status, body } = responder();
        return new Response(JSON.stringify(body), { status });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

function renderConSesion(rol: SesionUsuario["rol"] = "admin") {
  return render(
    <SessionProvider sesion={{ id: "u-1", email: "lara@example.com", rol }}>
      <DashboardView />
    </SessionProvider>,
  );
}

describe("DashboardView", () => {
  beforeEach(() => {
    responder = () => ({ status: 200, body: respuestaCompleta() });
    stubFetch();
    pushMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading: el saludo (session, no fetch) ya está visible + skeleton en el cuerpo", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    renderConSesion();
    expect(screen.getByRole("heading", { name: "Hola, lara" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Cargando panel…" })).toBeInTheDocument();
  });

  it("error: EstadoError con retry; el saludo sigue montado", async () => {
    responder = () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    renderConSesion();
    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hola, lara" })).toBeInTheDocument();
  });

  it("cold-start (snapshot.stock === null): EstadoVacio de página completa con CTA a /snapshots", async () => {
    responder = () => ({
      status: 200,
      body: respuestaCompleta({ snapshot: { stock: null, aduana: null }, periodos: { actual: null, anterior: null } }),
    });
    renderConSesion();
    await waitFor(() => expect(screen.getByText("Aún no hay datos de inventario cargados")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Ir a Snapshots" })).toHaveAttribute("href", "/snapshots");
    expect(screen.queryByText("Snapshot vigente")).not.toBeInTheDocument();
  });

  it("estado real: header + KPIs (delta solo en 'En camino') + heatmap→push + radar 3 series + alertas-link + bucket Sin KAM", async () => {
    renderConSesion("admin");

    await waitFor(() =>
      expect(
        screen.getByText("Inventario al 09 jul 2026, 06:00 p.m. · Embarques al 08 jul 2026, 06:00 p.m."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Snapshot vigente")).toBeInTheDocument();

    expect(screen.getByText("SKUs en catálogo")).toBeInTheDocument();
    expect(screen.getByText("+50 (+1.6%) vs abr 2026")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "NACIONAL · NORTH: 100 piezas" }));
    expect(pushMock).toHaveBeenCalledWith("/catalogo?marca=NACIONAL&almacen=NORTH");

    // [DASH-E · E-4] Acotado a la LEYENDA del radar: desde E-4 cada marca aparece
    // tambien en la tabla de valores crudos con signo, asi que `getByText` a secas
    // encuentra dos. La ambiguedad es informacion —el nombre viaja por dos
    // superficies a proposito— y la prueba dice cual de las dos esta mirando.
    const leyendaRadar = document.querySelector("[data-leyenda-radar]") as HTMLElement;
    expect(within(leyendaRadar).getByText("BRAND1")).toBeInTheDocument();
    expect(within(leyendaRadar).getByText("SERIES5")).toBeInTheDocument();
    expect(within(leyendaRadar).getByText("EAS")).toBeInTheDocument();

    // Y el corte del radar, que hasta E-4 no se confesaba: 3 dibujadas de 7.
    expect(screen.getByText("Top 3 de 7 marcas con stock")).toBeInTheDocument();

    // [C-DASH·11] El SUJETO de esta aserción cambió, no su intención. El enlace que
    // afirmaba era el de la alerta homónima, retirada. El drill-down sobrevive —lo
    // MIDIÓ el paso 1 antes de retirar nada— en el KPI de SKUs disponibles y en la
    // tarjeta Top sobre-reservados, con el MISMO href. Por eso son dos, y por eso se
    // afirma el conjunto y no «el primero que aparezca»: si mañana queda uno solo,
    // esto se pone rojo y alguien tiene que decidirlo, en vez de descubrirlo.
    // Se afirma por HREF y no por nombre accesible, porque las dos puertas NO se
    // llaman igual —una dice «N SKUs sobre-reservados (−N pz)» en el KPI y la otra
    // «Ver catálogo →» en la cabecera del Top— y buscar por nombre encontraba una
    // sola. El href es lo que MEDÍ; el rótulo es cómo se llama hoy.
    const puertasSobreReservado = Array.from(document.querySelectorAll('a[href="/catalogo?badge=sobre_reservado"]'));
    expect(puertasSobreReservado, "el KPI de disponibles y la cabecera del Top").toHaveLength(2);

    expect(screen.getByText("Sin KAM (directo a cliente)")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "A-1" })).toHaveAttribute("href", "/catalogo/A-1");

    // [DASH-E · E-1] Siguen siendo DOS, pero uno cambió de forma: el `<h2>` visible
    // de la tarjeta de pipeline no cabe en una columna de 64 px y pasó a `sr-only`,
    // y su enlace se volvió el cintillo del riel —ícono + «Embarques» a 10 px—.
    // Quitarle al vidente el nombre Y la afordancia habría sido pagar dos veces por
    // un problema de ancho. El otro sigue siendo el de Accesos rápidos.
    const linksCruce = screen.getAllByRole("link", { name: "Embarques" });
    expect(linksCruce).toHaveLength(2);
    for (const link of linksCruce) expect(link).toHaveAttribute("href", "/embarques");

    // Y el clic del riel NO se perdió: se multiplicó. Cada bloque de grupo es un
    // enlace vivo al mismo destino — la regla 3 protege el clic, no su ubicación.
    const bloquesDelRiel = screen.getAllByRole("link", { name: /embarques activos$/ });
    expect(bloquesDelRiel.length).toBeGreaterThan(0);
    for (const link of bloquesDelRiel) expect(link).toHaveAttribute("href", "/embarques");

    // Nombre exacto (no substring): distingue del link de la alerta "Embarques retrasados".
    expect(screen.getByRole("link", { name: "Histórico de embarques" })).toHaveAttribute("href", "/embarques/historico");
  });

  it("KPI 'SKUs en catálogo' (admin, FIX-B1 · T3): TRES enlaces —sin fila v2 / productos sin tecnología / preguntas por resolver—", async () => {
    renderConSesion("admin");
    await waitFor(() => expect(screen.getByText("SKUs en catálogo")).toBeInTheDocument());

    expect(screen.getByRole("link", { name: "22 sin fila en clasificación v2" })).toHaveAttribute("href", "/catalogo?sinV2=1");
    expect(screen.getByRole("link", { name: "44 productos sin tecnología →" })).toHaveAttribute(
      "href",
      "/catalogo?tecnologia=__sin_tecnologia__",
    );
    expect(screen.getByRole("link", { name: "37 preguntas de tecnología por resolver →" })).toHaveAttribute(
      "href",
      "/config?tab=pendientes",
    );
  });

  // [FIX-B1 · T3] `sin_tecnologia`/`pendientes` salen de una RPC que sólo
  // cuenta para `admin` (dato del eje 1) — para `kam` la RPC responde 0
  // SIEMPRE, sea cual sea la realidad. Antes esto se disfrazaba de "0 sin
  // tecnología asignada" y "Pendientes de datos" en 0; ahora la superficie
  // entera se oculta, para no servir un cero fabricado por el permiso como
  // si fuera el dato real.
  it("rol kam: la bandeja de tecnología y 'Pendientes de datos' NO se pintan (ni en cero, ni como texto plano)", async () => {
    renderConSesion("kam");
    const tarjetaCatalogo = await waitFor(() => screen.getByText("SKUs en catálogo").closest(".rounded-\\[15px\\]") as HTMLElement);

    // Acotado a LA TARJETA de "SKUs en catálogo": el heatmap de al lado
    // tiene su PROPIO selector "Tecnología (solo este mapa)", ajeno a este
    // permiso — un `screen.queryByText` sin acotar encontraría dos y el
    // matcher reventaría por ambigüedad en vez de decir nada sobre el KPI.
    expect(within(tarjetaCatalogo).queryByText(/tecnolog/i)).not.toBeInTheDocument();
    expect(within(tarjetaCatalogo).queryByText(/preguntas/i)).not.toBeInTheDocument();

    expect(screen.queryByText("Pendientes de datos")).not.toBeInTheDocument();
    expect(screen.queryByText("Los gestiona el administrador")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Resolver en Configuración/ })).not.toBeInTheDocument();
  });

  it("historial corto (1 periodo): estado honesto en la card de Tendencia, no un chart engañoso", async () => {
    responder = () => ({ status: 200, body: respuestaCompleta({ tendencia: [{ periodo: "2026-07", piezas: 24850, cortes: 1 }] }) });
    renderConSesion();
    await waitFor(() =>
      expect(screen.getByText("Aún no hay suficiente historial — vuelve tras la próxima ingesta.")).toBeInTheDocument(),
    );
    expect(screen.getByText("1 periodo de historial")).toBeInTheDocument();
  });
});

/**
 * La puerta de E-0 · el ENCUADRE.
 *
 * Lo que vigila NO es que el tablero se vea bien: es que **reencuadrar no pierda
 * ni reordene una sección en silencio**, que es la única forma en que un cambio de
 * rejilla hace daño de verdad. Un grid mal escrito no revienta — deja una tarjeta
 * fuera de la vista, o la manda al final, y todo sigue verde.
 *
 * Vive en ESTE archivo y no en uno propio a propósito: el arnés (`respuestaCompleta`
 * + `renderConSesion`) ya existe aquí, y una copia suya en otro archivo sería una
 * segunda verdad sobre el mismo DTO — el patrón que este repo ya pagó cuatro veces
 * con `piezas_en_camino`.
 */
describe("DashboardView · encuadre (E-0)", () => {
  beforeEach(() => {
    responder = () => ({ status: 200, body: respuestaCompleta() });
    stubFetch();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const zona = (container: HTMLElement, nombre: string): HTMLElement => {
    const el = container.querySelector(`[data-encuadre="${nombre}"]`);
    if (!el) throw new Error(`el encuadre no declara la zona \`${nombre}\``);
    return el as HTMLElement;
  };

  const esperarTablero = () => waitFor(() => expect(screen.getByText("SKUs en catálogo")).toBeInTheDocument());

  // La regresión que esto cierra, medida por la revisión adversaria: el riel
  // montado DENTRO de la fila de contenido estiraba esa fila a ~658 px, y con ella
  // la tarjeta de Tendencia. El riel no es una tarjeta — es una columna hermana.
  it("el riel es COLUMNA HERMANA del contenido, no una tarjeta dentro de él", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const riel = screen.getByRole("navigation", { name: "Pipeline de embarques" });
    const contenido = zona(container, "contenido");
    const tablero = zona(container, "tablero");

    expect(contenido.contains(riel)).toBe(false);
    expect(riel.parentElement).toBe(tablero);
    expect(contenido.parentElement).toBe(tablero);
  });

  it("la rejilla declara sus dos columnas desde lg, y una sola debajo", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const clases = zona(container, "tablero").className;
    expect(clases).toContain("grid-cols-1");
    // 72 y no 64: el bloque mide 64 y su anillo de foco sobresale 4 px por lado
    // (`ring-offset-2` + `ring-2`). Con la pista a 64 el foco se recortaría contra
    // el contenido.
    //
    // EL CORTE ES `lg` (1024) DESDE C-DASH·13. Era `md`, y la razón vieja —reusar el
    // corte del sidebar— estaba invertida: a 768 con el corte en `md` el riel se pone
    // en columna mientras el sidebar sigue robando 230 px, y la columna de contenido
    // se queda con 387 px. Medido moviendo el corte de verdad: 387 → 489 (+26 %) a
    // 768 y 510 → 612 (+20 %) a 900. El docstring de `ENCUADRE` lleva el detalle.
    expect(clases).toContain("lg:grid-cols-[72px_1fr]");
  });

  // LA prueba del bloque: reencuadrar no puede perder ni reordenar nada. Se afirma
  // sobre los TÍTULOS, que son contenido, no sobre clases.
  it("las 6 secciones del contenido salen COMPLETAS y en orden", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const titulos = Array.from(zona(container, "contenido").querySelectorAll("h2")).map((h) => (h.textContent ?? "").trim());
    // [C-DASH·11] «Alertas» se retira por decisión de producto, dada dos veces. Eran 7.
    expect(titulos).toEqual([
      "Mapa de calor · marca × almacén",
      "Perfil por marca",
      "Tendencia de stock",
      "Reservas por KAM",
      "Top sobre-reservados",
      "Accesos rápidos",
    ]);
  });

  // [C-DASH·11] LO QUE SE MIDIÓ ANTES DE RETIRAR, y por eso esto es una prueba y no
  // una nota: de los seis avisos, CUATRO conservan su puerta — y no gracias a la
  // campana (medida disjunta), sino a los KPI de esta misma pantalla. Sin esta
  // prueba, el próximo reencuadre puede llevarse también esas tres sin que nadie
  // lo note, y entonces sí se perderían seis.
  //
  // MEDIDO contra un corte real: sobre_reservado, retrasado, sin_v2, descuadre,
  // pendientes y familia_movida (esta última, la de mayor conteo de las seis).
  it("retirada Alertas, las tres puertas que la reemplazan siguen vivas en el tablero", async () => {
    renderConSesion("admin");
    await esperarTablero();

    const destinos = Array.from(document.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
    expect(destinos, "sobre-reservados: lo llevan el KPI y la tarjeta Top").toContain("/catalogo?badge=sobre_reservado");
    expect(destinos, "sin clasificación v2: lo lleva el KPI de SKUs en catálogo").toContain("/catalogo?sinV2=1");
    expect(destinos, "pendientes y descuadres: lo lleva el KPI de pendientes").toContain("/config?tab=pendientes");

    // Y LAS DOS QUE SE PERDIERON, ya REPARADAS — el ratchet giró en C-DASH·12.
    //
    // Al retirar Alertas estas dos aserciones decían `not.toContain`, y eran ciertas:
    // dos filtros VIVOS se habían quedado sin su única entrada. **Esta prueba se puso
    // ROJA sola cuando E-7 los devolvió**, que es exactamente lo que se le pedía — un
    // ratchet que no se entera de que el defecto se arregló tampoco se enteraría de
    // que volvió. Ahora vigila la otra dirección: si alguien vuelve a quitar estos
    // dos accesos, esto se pone rojo y hay que decidirlo, no descubrirlo.
    // Ver `dashboard-accesos-rapidos.tsx` y la deuda `DOS-FILTROS-VIVOS-SIN-PUERTA`.
    expect(destinos, "familia_movida: su puerta vive ahora en Accesos rápidos").toContain("/catalogo?divergencia=1");
    expect(destinos, "retrasado: su puerta vive ahora en Accesos rápidos").toContain("/embarques?retrasado=1");
  });

  // `auto-fit` colapsa solo; una rejilla de proporción fija NO lo hereda. Sin
  // quiebre explícito, dos columnas asimétricas se aplastan en un teléfono y hoy
  // nada lo caza (M-11 del §2).
  it("las dos rejillas asimétricas declaran su quiebre explícito — no heredan el auto-colapso", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const asimetricas = Array.from(zona(container, "contenido").children).filter((el) => el.className.includes("lg:grid-cols-["));
    expect(asimetricas).toHaveLength(2);
    for (const g of asimetricas) {
      expect(g.className).toContain("grid-cols-1");
      expect(g.className).not.toContain("auto-fit");
    }
  });

  it("el header queda FUERA de la rejilla, con sus textos propios (el reencuadre no los toca)", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const header = container.querySelector("header") as HTMLElement;
    expect(zona(container, "tablero").contains(header)).toBe(false);

    expect(within(header).getByText("Resumen operativo")).toBeInTheDocument();
    expect(within(header).getByRole("heading", { level: 1, name: "Hola, lara" })).toBeInTheDocument();
    expect(within(header).getByText(/^Inventario al /)).toBeInTheDocument();
  });

  // El nodo `aria-busy` tiene que envolver TODO el subárbol vivo. Al sacar el riel
  // de la columna de contenido, dejar el `aria-busy` donde estaba lo habría dejado
  // fuera: un refetch marcaría ocupado el tablero menos el riel (P24).
  it("aria-busy envuelve el subárbol vivo COMPLETO, riel incluido", async () => {
    const { container } = renderConSesion();
    await esperarTablero();

    const ocupado = container.querySelector("[aria-busy]") as HTMLElement;
    expect(ocupado).toBe(zona(container, "tablero"));
    expect(ocupado.contains(screen.getByRole("navigation", { name: "Pipeline de embarques" }))).toBe(true);
    expect(ocupado.contains(screen.getByText("SKUs en catálogo"))).toBe(true);
  });

  it("las ramas previas al tablero siguen intactas: el vacío conserva sus textos y su link, y NO monta el encuadre", async () => {
    responder = () => ({
      status: 200,
      body: respuestaCompleta({ snapshot: { stock: null, aduana: null } as unknown as DashboardResponse["snapshot"] }),
    });
    const { container } = renderConSesion();

    await waitFor(() => expect(screen.getByText("Aún no hay datos de inventario cargados")).toBeInTheDocument());
    expect(screen.getByText("Cuando corra la primera ingesta, el panel aparecerá aquí.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Snapshots" })).toHaveAttribute("href", "/snapshots");
    expect(container.querySelector('[data-encuadre="tablero"]')).toBeNull();
  });
});
