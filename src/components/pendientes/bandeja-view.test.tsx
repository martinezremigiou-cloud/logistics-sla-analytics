import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { DescuadreItem, PendienteDato, PendientesResponse } from "@/types/api";
import { BandejaView } from "./bandeja-view";

// ------------------------------------------------------------
// Fixtures: los 4 `tipo` de pendiente (payloads reales, ver seed de la
// migración 0009_b6_pendientes.sql) en sus 3 `estado` posibles.
// ------------------------------------------------------------
function pendiente(overrides: Partial<PendienteDato> = {}): PendienteDato {
  return {
    id: "p-1",
    tipo: "kam_desconocido",
    clave_natural: "nadia",
    estado: "abierto",
    payload: { kam_raw: "NADIA", ocurrencias: 3, skus: ["A-1", "B-2", "C-3"] },
    detectado_por: "etl",
    detectado_en: "2026-07-19T00:00:00.000Z",
    snapshot_id: "snap-9",
    resolucion: null,
    resuelto_por: null,
    resuelto_en: null,
    ...overrides,
  };
}

const KAM_ABIERTO = pendiente({
  id: "p-kam",
  tipo: "kam_desconocido",
  clave_natural: "nadia",
  payload: { kam_raw: "NADIA", ocurrencias: 3, skus: ["A-1", "B-2", "C-3"] },
});
const MARCA_ABIERTO = pendiente({
  id: "p-marca",
  tipo: "marca_west",
  clave_natural: "hv3602",
  payload: { sku: "HV3602", marca_actual: "NACIONAL" },
});
const COLISION_ABIERTO = pendiente({
  id: "p-colision",
  tipo: "colision_familia",
  clave_natural: "series 2 48 / series 2 72",
  payload: {
    campo: "familia",
    canonico: "SERIES 2 48 / SERIES 2 72",
    variantes: ["SERIES 2 48  / SERIES 2 72", "SERIES 2 48 / SERIES 2 72"],
    skus: ["GLN8003", "RRC3965"],
  },
});
const CUARENTENA_ABIERTO = pendiente({
  id: "p-cuarentena",
  tipo: "cuarentena_etl",
  clave_natural: "hash-abc",
  payload: {},
});

// ------------------------------------------------------------
// (MVP-CIERRE F2) `sku_sin_tecnologia` — payloads EXACTOS a como los
// produce 0013, con la forma de las filas de la base tras aplicarla.
// ------------------------------------------------------------
const SIN_TEC_CON_FAMILIA = pendiente({
  id: "p-sin-tec-fam",
  tipo: "sku_sin_tecnologia",
  clave_natural: "4751-4339-9605",
  payload: {
    sku: "4751-4339-9605",
    campo: "tecnologia",
    pregunta: "¿Qué tecnología le corresponde a este SKU?",
    evidencia: "Entró como ALTA en el snapshot a1b2c3d4 y no tiene ficha en clasificacion_v2.",
    poblacion: "alta_reciente",
    sin_familia: false,
    descr_origen: "SERIES16 TX20 TRANSMITTER ANTENNA WITHOUT CASE",
    marca_origen: "SERIES5",
    familia_origen: "SERIES16",
  },
});
const SIN_TEC_SIN_FAMILIA = pendiente({
  id: "p-sin-tec-sinfam",
  tipo: "sku_sin_tecnologia",
  clave_natural: "7316",
  payload: {
    sku: "7316",
    campo: "tecnologia+familia",
    pregunta: "¿Qué tecnología y qué familia le corresponden a este SKU?",
    evidencia: "Entró como ALTA en el snapshot a1b2c3d4 y no tiene ficha en clasificacion_v2. Además NO tiene familia asignada.",
    poblacion: "alta_reciente",
    sin_familia: true,
    descr_origen: "PRODUCTO DEMO CON TAPA",
    marca_origen: "VERTICAL",
    familia_origen: null,
  },
});
const SIN_TEC_AUTOCERRADO = pendiente({
  id: "p-sin-tec-auto",
  tipo: "sku_sin_tecnologia",
  clave_natural: "VGR888-K",
  estado: "resuelto",
  payload: { sku: "VGR888-K", campo: "tecnologia", sin_familia: false, marca_origen: "BRAND1" },
  resolucion: {
    accion: "auto_cierre",
    motivo: "El SKU ya tiene tecnología asignada: el pendiente dejó de aplicar.",
    tecnologia: "BRAND1",
  },
  resuelto_por: "auto:ingesta",
  resuelto_en: "2026-07-31T20:00:00.000Z",
});

// ------------------------------------------------------------
// (INV-TAXO F2) Los 2 tipos nuevos de la migración 0011_taxo — payloads
// EXACTOS a como los produce esa migración (ver supabase/migrations/0011_taxo.sql).
// ------------------------------------------------------------
const MARCA_AMBIGUA_ABIERTO = pendiente({
  id: "p-marca-ambigua",
  tipo: "marca_ambigua",
  clave_natural: "01654365/3225",
  payload: {
    sku: "01654365/3225",
    campo: "marca",
    marca_actual: "SERIES5",
    marca_fuente: "VERTICAL",
    candidatas: ["SERIES5", "VERTICAL"],
    evidencia: "La marca de la FUENTE VIGENTE (VERTICAL) contradice la marca de la capa v2 (SERIES5).",
    pregunta: "¿Cuál es la marca correcta de este SKU?",
  },
});
const FAMILIA_ATOMO_ABIERTO = pendiente({
  id: "p-familia-atomo",
  tipo: "familia_atomo_dudoso",
  clave_natural: "zv680g/k",
  payload: {
    campo: "familia",
    canonico: "ZV680G/K",
    atomos: ["ZV680G", "K"],
    atomos_fantasma: ["K"],
    skus: Array.from({ length: 10 }, (_, i) => `SKU-${i}`),
    n_skus: 10,
    pregunta: "¿Es UNA familia con ese nombre completo, o son DOS familias distintas?",
    opcion_confirmar:
      'CONFIRMAR = "sí, es UNA sola familia: la compuerta anti-átomo-fantasma acertó". Ratifica el statu quo y NO cambia ningún dato.',
    opcion_descartar:
      'DESCARTAR = "no, son DOS familias distintas". Eso SÍ exige cambio de datos o de código y queda FUERA del alcance de 0011.',
  },
});

// ------------------------------------------------------------
// (INV-B7B) Segundo PRODUCTOR de 'marca_ambigua': la migración
// 0012_b7b_hardening (regla "tecnología-categoría") — payload EXACTO a
// como lo produce esa migración (ver supabase/migrations/0012_b7b_hardening.sql,
// bloque P2). A diferencia de 0011, aquí `marca_actual`/`marca_fuente`
// pueden COINCIDIR (en buena parte de los casos reales) y trae `tecnologia` +
// `n_marcas_de_la_tecnologia` + hasta 9 `candidatas` (las marcas reales
// de la tecnología "EAS" en el catálogo, por # de SKUs desc). 0012
// TODAVÍA NO está aplicada — no hay datos reales de este shape en la BD
// hoy, de ahí que se cubra aquí con fixtures, no con datos simulados en
// la app.
// ------------------------------------------------------------
const CANDIDATAS_EAS_9 = ["SERIES5", "BRAND5", "EAS", "BRAND6", "NACIONAL", "BRAND9", "BRAND7", "BRAND8", "BRAND12"];

const MARCA_AMBIGUA_TEC_COINCIDE = pendiente({
  id: "p-marca-ambigua-tec-coincide",
  tipo: "marca_ambigua",
  clave_natural: "zt3717",
  payload: {
    sku: "ZT3717",
    campo: "marca",
    marca_actual: "EAS",
    marca_fuente: "EAS",
    marca_v2: "EAS",
    tecnologia: "EAS",
    candidatas: CANDIDATAS_EAS_9,
    n_marcas_de_la_tecnologia: 9,
    n_marcas_con_2_o_mas_skus: 6,
    n_skus_de_la_tecnologia: 163,
    descr_origen: "SENSOR EAS ACUSTICO",
    generacion: "b7b",
    regla: "tecnologia_categoria",
    evidencia:
      "La marca efectiva de este SKU es «EAS», que es el nombre de su TECNOLOGÍA y no el de un fabricante. Marcas reales observadas bajo esta tecnología: SERIES5 72, BRAND5 41, EAS 22, BRAND6 13, NACIONAL 9, BRAND9 3, BRAND7 1, BRAND8 1, BRAND12 1.",
    pregunta:
      "¿Cuál es la MARCA (el fabricante) de este SKU? Hoy su marca dice «EAS», que es el nombre de su TECNOLOGÍA: en el catálogo vigente esa tecnología se reparte entre 9 marcas distintas, así que es una CATEGORÍA de producto y no identifica a ningún fabricante. Elige la marca real entre las candidatas. Si de verdad el fabricante se llama así, confírmala tal cual.",
  },
});

const MARCA_AMBIGUA_TEC_DIFIERE = pendiente({
  id: "p-marca-ambigua-tec-difiere",
  tipo: "marca_ambigua",
  clave_natural: "wz1053",
  payload: {
    sku: "WZ1053",
    campo: "marca",
    marca_actual: "EAS",
    marca_fuente: "NACIONAL",
    marca_v2: "EAS",
    tecnologia: "EAS",
    candidatas: CANDIDATAS_EAS_9,
    n_marcas_de_la_tecnologia: 9,
    pregunta: "¿Cuál es la MARCA (el fabricante) de este SKU? Hoy su marca dice «EAS», que es el nombre de su TECNOLOGÍA.",
  },
});

// ------------------------------------------------------------
// (B, [MVP-2]) familia_nueva — payload EXACTO a como lo produce
// `sincronizar_pendientes_familia` (0019_mvp2_familia_nueva.sql): una
// fila por familia, con `prefijo` (todos los tokens menos el último,
// `null` si el nombre es de una sola palabra) y `hermanas` (familias
// activas que empiezan por ese prefijo, token-exacto).
// ------------------------------------------------------------
const FAMILIA_NUEVA_CON_HERMANAS = pendiente({
  id: "p-familia-nueva",
  tipo: "familia_nueva",
  clave_natural: "series 2 70",
  payload: {
    familia: "SERIES 2 70",
    prefijo: "SERIES 2",
    hermanas: ["SERIES 2 34", "SERIES 2 41", "SERIES 2 48"],
    skus: ["SKU-1", "SKU-2"],
  },
});
const FAMILIA_NUEVA_SIN_HERMANAS = pendiente({
  id: "p-familia-nueva-sin-hermanas",
  tipo: "familia_nueva",
  clave_natural: "zorp 10",
  payload: {
    familia: "ZORP 10",
    prefijo: "ZORP",
    hermanas: [],
    skus: ["SKU-9"],
  },
});
const FAMILIA_NUEVA_SIN_PREFIJO = pendiente({
  id: "p-familia-nueva-sin-prefijo",
  tipo: "familia_nueva",
  clave_natural: "gadget",
  payload: { familia: "GADGET", prefijo: null, hermanas: [], skus: ["SKU-1", "SKU-2", "SKU-3"] },
});

const KAM_RESUELTO = pendiente({
  id: "p-kam-r",
  tipo: "kam_desconocido",
  clave_natural: "nadia-vieja",
  estado: "resuelto",
  payload: { kam_raw: "NADIA VIEJA", ocurrencias: 1, skus: ["Z-9"] },
  resolucion: { accion: "confirmar", motivo: null, kam_id: "kam-1" },
  resuelto_por: "bridge",
  resuelto_en: "2026-07-19T10:00:00.000Z",
});
const MARCA_DESCARTADO = pendiente({
  id: "p-marca-d",
  tipo: "marca_west",
  clave_natural: "cs6605",
  estado: "descartado",
  payload: { sku: "CS6605", marca_actual: "NACIONAL" },
  resolucion: { accion: "descartar", motivo: "Ya no aplica, producto descontinuado" },
  resuelto_por: "admin@example.com",
  resuelto_en: "2026-07-20T00:00:00.000Z",
});

function fixtureCompleta(): PendienteDato[] {
  return [KAM_ABIERTO, MARCA_ABIERTO, COLISION_ABIERTO, CUARENTENA_ABIERTO, KAM_RESUELTO, MARCA_DESCARTADO];
}

// ------------------------------------------------------------
// Fetch mock con estado mutable: el GET siempre refleja
// `pendientesState`/`derivadosState`/`conteosState` "vigentes"; el POST
// registra la llamada y opcionalmente muta ese estado (`onPost`) para que
// un refetch posterior refleje la resolución — igual que el RPC real.
// ------------------------------------------------------------
let pendientesState: PendienteDato[] = [];
let derivadosState: DescuadreItem[] = [];
// [2.0.1-A · D2] Los dos bloques derivados nuevos. `null` por defecto = «no se
// pudo derivar», que es el estado más conservador para un fixture: los tests
// que los ejercen los siembran explícitamente.
const driftState: PendientesResponse["derivados"]["drift"] = null;
const puentesState: PendientesResponse["derivados"]["puentes"] = null;
let conteosState: PendientesResponse["conteos"] = { abiertos: 0, por_tipo: {} };
let postStatus = 200;
let postBody: unknown = { estado: "resuelto", actor: "admin@example.com" };
let onPost: ((id: string, body: Record<string, unknown>) => void) | null = null;
let tecnologiasState: string[] = ["EAS", "BRAND2", "BRAND1", "VERTICAL"];
const postCalls: { id: string; body: unknown }[] = [];

// (B, [MVP-2]) POST /api/pendientes/[id]/fusionar — endpoint SEPARADO
// (otra RPC atrás, ver pendientes.service.ts), con su propio estado
// mutable para no mezclar sus asserts con los de `postCalls`.
let fusionPostStatus = 200;
let fusionPostBody: unknown = {
  fusion: { alias: "SERIES 2 70", destino: "SERIES 2 41", absorbida_existia: true, skus_que_migraran: 2 },
};
let onFusionPost: ((id: string, body: Record<string, unknown>) => void) | null = null;
const fusionCalls: { id: string; body: unknown }[] = [];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "/api/pendientes" && method === "GET") {
        const body: PendientesResponse = {
          pendientes: pendientesState,
          derivados: { descuadres: derivadosState, drift: driftState, puentes: puentesState },
          conteos: conteosState,
          // (MVP-CIERRE F2) Vocabulario DECLARADO real de `public.tecnologias`
          // — las 4 activas, verificadas contra la base.
          tecnologias: tecnologiasState,
        };
        return new Response(JSON.stringify(body), { status: 200 });
      }

      // (B, [MVP-2]) DEBE evaluarse ANTES del genérico de abajo: mismo
      // prefijo de URL (`/api/pendientes/<id>`), y ese regex es codicioso.
      const mFusion = url.match(/^\/api\/pendientes\/(.+)\/fusionar$/);
      if (mFusion && method === "POST") {
        const id = mFusion[1];
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        fusionCalls.push({ id, body });
        onFusionPost?.(id, body);
        return new Response(JSON.stringify(fusionPostBody), { status: fusionPostStatus });
      }

      const m = url.match(/^\/api\/pendientes\/(.+)$/);
      if (m && method === "POST") {
        const id = m[1];
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        postCalls.push({ id, body });
        onPost?.(id, body);
        return new Response(JSON.stringify(postBody), { status: postStatus });
      }

      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

describe("BandejaView", () => {
  beforeEach(() => {
    pendientesState = [];
    derivadosState = [];
    conteosState = { abiertos: 0, por_tipo: {} };
    postStatus = 200;
    postBody = { estado: "resuelto", actor: "admin@example.com" };
    onPost = null;
    postCalls.length = 0;
    fusionPostStatus = 200;
    fusionPostBody = {
      fusion: { alias: "SERIES 2 70", destino: "SERIES 2 41", absorbida_existia: true, skus_que_migraran: 2 },
    };
    onFusionPost = null;
    fusionCalls.length = 0;
    tecnologiasState = ["EAS", "BRAND2", "BRAND1", "VERTICAL"];
    // (MVP-CIERRE F2) El diálogo de `sku_sin_tecnologia` recuerda en
    // `localStorage` las tecnologías ya usadas. Sin limpiarlo, una resolución
    // exitosa de un test se filtra al siguiente y contamina sus asserts —
    // pasó de verdad: el caso de degradación veía un chip "BRAND1" recordado
    // por el caso anterior. Cada test arranca como un navegador nuevo.
    window.localStorage.clear();
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading: muestra el skeleton mientras la carga está en curso", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<BandejaView />);
    expect(screen.getByRole("status", { name: "Cargando pendientes…" })).toBeInTheDocument();
  });

  it("error: muestra EstadoError con el message del contrato y reintenta al hacer click", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "internal_error", message: "Fallo interno" }), { status: 500 })));
    render(<BandejaView />);

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();

    stubFetch();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByText("No se pudo cargar la información")).not.toBeInTheDocument());
  });

  it("badge de conteo muestra conteos.abiertos", async () => {
    pendientesState = [KAM_ABIERTO];
    conteosState = { abiertos: 1, por_tipo: { kam_desconocido: 1 } };
    render(<BandejaView />);
    expect(await screen.findByLabelText("1 pendientes abiertos")).toBeInTheDocument();
  });

  it("Abiertos: título y detalle es-MX de los 4 tipos", async () => {
    pendientesState = fixtureCompleta();
    render(<BandejaView />);

    expect(await screen.findByText("KAM desconocido: NADIA")).toBeInTheDocument();
    expect(screen.getByText("3 reservas en 3 SKUs")).toBeInTheDocument();

    expect(screen.getByText("Marca WEST sin resolver: HV3602")).toBeInTheDocument();
    expect(screen.getByText(/marca actual NACIONAL/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "HV3602" })).toHaveAttribute("href", "/catalogo/HV3602");

    expect(screen.getByText("Colisión de familia: SERIES 2 48 / SERIES 2 72")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2 48␣␣/ SERIES 2 72")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2 48 / SERIES 2 72")).toBeInTheDocument();
    expect(screen.getByText("2 SKUs afectados")).toBeInTheDocument();

    expect(screen.getByText("Registro en cuarentena de ETL")).toBeInTheDocument();
    expect(screen.getByText("Requiere revisión manual.")).toBeInTheDocument();

    // Los resueltos/descartados de la fixture NO aparecen en la tab Abiertos (activa por defecto).
    expect(screen.queryByText("KAM desconocido: NADIA VIEJA")).not.toBeInTheDocument();
    expect(screen.queryByText("Marca WEST sin resolver: CS6605")).not.toBeInTheDocument();
  });

  it("Abiertos: título y detalle es-MX de los 2 tipos nuevos (marca_ambigua / familia_atomo_dudoso, INV-TAXO F2)", async () => {
    pendientesState = [MARCA_AMBIGUA_ABIERTO, FAMILIA_ATOMO_ABIERTO];
    render(<BandejaView />);

    expect(await screen.findByText("Marca ambigua: 01654365/3225")).toBeInTheDocument();
    expect(screen.getByText(/v2 SERIES5 vs fuente VERTICAL/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "01654365/3225" })).toHaveAttribute("href", "/catalogo/01654365%2F3225");

    expect(screen.getByText("Familia con átomo dudoso: ZV680G/K")).toBeInTheDocument();
    expect(screen.getByText("ZV680G")).toBeInTheDocument();
    expect(screen.getByText("K")).toBeInTheDocument();
    expect(screen.getByText("10 SKUs con esta familia")).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // (INV-B7B) marca_ambigua tiene 2 productores (0011_taxo / 0012_b7b, ver
  // pendiente-copy.ts): la fila ya NO debe asumir contradicción entre capas.
  // ------------------------------------------------------------
  it("marca_ambigua (0012_b7b, capas COINCIDEN): NO pinta 'X vs X' — usa `tecnologia` + `n_marcas_de_la_tecnologia`", async () => {
    pendientesState = [MARCA_AMBIGUA_TEC_COINCIDE];
    render(<BandejaView />);

    expect(await screen.findByText("Marca ambigua: ZT3717")).toBeInTheDocument();
    expect(screen.getByText(/«EAS» es una tecnología, no un fabricante \(9 marcas posibles\)/)).toBeInTheDocument();
    expect(screen.queryByText(/vs fuente/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ZT3717" })).toHaveAttribute("href", "/catalogo/ZT3717");
  });

  it("marca_ambigua (0012_b7b, capas DIFIEREN): sigue pintando la contradicción real", async () => {
    pendientesState = [MARCA_AMBIGUA_TEC_DIFIERE];
    render(<BandejaView />);

    expect(await screen.findByText("Marca ambigua: WZ1053")).toBeInTheDocument();
    expect(screen.getByText(/v2 EAS vs fuente NACIONAL/)).toBeInTheDocument();
  });

  it("marca_ambigua sin `tecnologia` y con capas que coinciden (payload defensivo/futuro): respaldo neutro, sin 'vs'", async () => {
    pendientesState = [
      pendiente({
        id: "p-marca-ambigua-sin-tec",
        tipo: "marca_ambigua",
        clave_natural: "we9793",
        payload: { sku: "WE9793", marca_actual: "NACIONAL", marca_fuente: "NACIONAL" },
      }),
    ];
    render(<BandejaView />);

    expect(await screen.findByText("Marca ambigua: WE9793")).toBeInTheDocument();
    expect(screen.getByText(/marca actual NACIONAL/)).toBeInTheDocument();
    expect(screen.queryByText(/ vs /)).not.toBeInTheDocument();
  });

  // (R3-5) `n_skus` es el conteo REAL (el payload puede traer `skus`
  // acotado/muestreado) — antes se leía `skus.length`, que en este caso
  // real habría mostrado "3 SKUs" en vez de las 47 afectadas del fixture.
  it("familia_atomo_dudoso: usa n_skus (no skus.length) cuando ambos difieren", async () => {
    pendientesState = [
      pendiente({
        id: "p-familia-atomo-3",
        tipo: "familia_atomo_dudoso",
        clave_natural: "z1900 / 6693",
        payload: {
          campo: "familia",
          canonico: "Z1900 / 6693",
          atomos: ["Z1900", "6693"],
          atomos_fantasma: ["6693"],
          skus: ["SKU-A", "SKU-B", "SKU-C"],
          n_skus: 47,
        },
      }),
    ];
    render(<BandejaView />);
    expect(await screen.findByText("47 SKUs con esta familia")).toBeInTheDocument();
    expect(screen.queryByText("3 SKUs con esta familia")).not.toBeInTheDocument();
  });

  it("familia_atomo_dudoso: sin n_skus en el payload, usa skus.length como respaldo", async () => {
    pendientesState = [
      pendiente({
        id: "p-familia-atomo-4",
        tipo: "familia_atomo_dudoso",
        clave_natural: "zv680g/k",
        payload: {
          campo: "familia",
          canonico: "ZV680G/K",
          atomos: ["ZV680G", "K"],
          atomos_fantasma: ["K"],
          skus: ["SKU-A", "SKU-B"],
          // sin `n_skus` (fixture previo a ese campo).
        },
      }),
    ];
    render(<BandejaView />);
    expect(await screen.findByText("2 SKUs con esta familia")).toBeInTheDocument();
  });

  it("vacío por sub-tab: 'Sin pendientes abiertos — todo en orden.'", async () => {
    pendientesState = [];
    render(<BandejaView />);
    expect(await screen.findByText("Sin pendientes abiertos — todo en orden.")).toBeInTheDocument();
  });

  it("sub-tabs filtran client-side por estado (Resueltos/Descartados no ven Abiertos)", async () => {
    pendientesState = [KAM_ABIERTO, KAM_RESUELTO, MARCA_DESCARTADO];
    render(<BandejaView />);

    await screen.findByText("KAM desconocido: NADIA");
    expect(screen.getByRole("button", { name: "Confirmar como KAM" })).toBeInTheDocument();
    expect(screen.queryByText("KAM desconocido: NADIA VIEJA")).not.toBeInTheDocument();

    // Radix TabsTrigger activa por `onMouseDown`, no por "click".
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Resueltos" }));
    await waitFor(() => expect(screen.getByText("KAM desconocido: NADIA VIEJA")).toBeInTheDocument());
    expect(screen.queryByText("KAM desconocido: NADIA")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmar como KAM" })).not.toBeInTheDocument();
    expect(screen.getByText("Resuelto")).toBeInTheDocument();
    expect(screen.getByText("→ alta en catálogo KAMs")).toBeInTheDocument();
    expect(screen.getByText(/bridge/)).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Descartados" }));
    await waitFor(() => expect(screen.getByText("Marca WEST sin resolver: CS6605")).toBeInTheDocument());
    expect(screen.getByText("Descartado")).toBeInTheDocument();
    expect(screen.getByText("Ya no aplica, producto descontinuado")).toBeInTheDocument();
    expect(screen.queryByText("KAM desconocido: NADIA VIEJA")).not.toBeInTheDocument();
  });

  it("vacío en Resueltos/Descartados cuando no hay ninguno de ese estado", async () => {
    pendientesState = [KAM_ABIERTO];
    render(<BandejaView />);
    await screen.findByText("KAM desconocido: NADIA");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Resueltos" }));
    expect(await screen.findByText("Aún no hay resueltos.")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Descartados" }));
    expect(await screen.findByText("Aún no hay descartados.")).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // Matriz de acciones.
  // ------------------------------------------------------------
  it("Confirmar como KAM: input precargado capitalizado, editable, y el valor EDITADO viaja en el POST", async () => {
    pendientesState = [KAM_ABIERTO];
    conteosState = { abiertos: 1, por_tipo: { kam_desconocido: 1 } };
    onPost = (id) => {
      pendientesState = pendientesState.map((p) =>
        p.id === id
          ? { ...p, estado: "resuelto" as const, resuelto_por: "admin@example.com", resuelto_en: "2026-07-21T00:00:00.000Z", resolucion: { accion: "confirmar", motivo: null, kam_id: "kam-9" } }
          : p,
      );
      conteosState = { abiertos: 0, por_tipo: {} };
    };
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar como KAM" }));
    const input = await screen.findByLabelText("Nombre canónico");
    expect(input).toHaveValue("Nadia");

    fireEvent.change(input, { target: { value: "Nadia Lara" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(postCalls).toEqual([{ id: "p-kam", body: { accion: "confirmar", valor: "Nadia Lara" } }]));
    // Refetch tras éxito: la fila sale de Abiertos.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar como KAM" })).not.toBeInTheDocument());
  });

  it("Descartar: el botón de confirmar descarte está deshabilitado sin motivo y se habilita al escribir; el motivo viaja en el POST", async () => {
    pendientesState = [KAM_ABIERTO];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    const boton = await screen.findByRole("button", { name: "Confirmar descarte" });
    expect(boton).toBeDisabled();

    const textarea = screen.getByLabelText("Motivo");
    fireEvent.change(textarea, { target: { value: "  " } });
    expect(boton).toBeDisabled();

    fireEvent.change(textarea, { target: { value: "Duplicado" } });
    expect(boton).toBeEnabled();

    fireEvent.click(boton);
    await waitFor(() => expect(postCalls).toEqual([{ id: "p-kam", body: { accion: "descartar", motivo: "Duplicado" } }]));
  });

  it("Marcar resuelto (marca_west): POST confirmar SIN motivo/valor + botón 'Abrir ficha' apunta a la ficha del SKU", async () => {
    pendientesState = [MARCA_ABIERTO];
    render(<BandejaView />);

    expect(await screen.findByRole("link", { name: "Abrir ficha" })).toHaveAttribute("href", "/catalogo/HV3602");

    fireEvent.click(screen.getByRole("button", { name: "Marcar resuelto" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(postCalls).toEqual([{ id: "p-marca", body: { accion: "confirmar" } }]));
  });

  it("colision_familia: botón 'Abrir familias' navega a /config?tab=familias + Marcar resuelto", async () => {
    pendientesState = [COLISION_ABIERTO];
    render(<BandejaView />);

    expect(await screen.findByRole("link", { name: "Abrir familias" })).toHaveAttribute("href", "/config?tab=familias");

    fireEvent.click(screen.getByRole("button", { name: "Marcar resuelto" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(postCalls).toEqual([{ id: "p-colision", body: { accion: "confirmar" } }]));
  });

  it("cuarentena_etl: solo Marcar resuelto + Descartar (sin botón de navegación)", async () => {
    pendientesState = [CUARENTENA_ABIERTO];
    render(<BandejaView />);

    await screen.findByText("Registro en cuarentena de ETL");
    expect(screen.getByRole("button", { name: "Marcar resuelto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // (INV-TAXO F2) marca_ambigua: elegir candidata es OBLIGATORIO desde la UI.
  // ------------------------------------------------------------
  it("marca_ambigua: 'Confirmar' arranca deshabilitado (sin candidata elegida) y el valor elegido viaja en el POST", async () => {
    pendientesState = [MARCA_AMBIGUA_ABIERTO];
    render(<BandejaView />);

    expect(await screen.findByRole("link", { name: "Abrir ficha" })).toHaveAttribute("href", "/catalogo/01654365%2F3225");

    fireEvent.click(screen.getByRole("button", { name: "Elegir marca correcta" }));
    const botonConfirmar = await screen.findByRole("button", { name: "Confirmar" });
    expect(botonConfirmar).toBeDisabled();

    // Las 2 candidatas se muestran con su origen (v2 vs fuente vigente).
    expect(screen.getByRole("radio", { name: /SERIES5.*Clasificación v2/ })).toBeInTheDocument();
    const candidataFuente = screen.getByRole("radio", { name: /VERTICAL.*Fuente vigente/ });
    fireEvent.click(candidataFuente);
    expect(botonConfirmar).toBeEnabled();

    fireEvent.click(botonConfirmar);
    await waitFor(() =>
      expect(postCalls).toEqual([{ id: "p-marca-ambigua", body: { accion: "confirmar", valor: "VERTICAL" } }]),
    );
  });

  // (INV-B7B) 0012_b7b puede traer hasta 9 candidatas (vs. 2 de 0011) — el
  // diálogo debe aguantarlas todas (radiogroup con scroll interno, ver
  // pendiente-acciones.tsx) y usar la `pregunta` real del payload tal cual.
  it("marca_ambigua (0012_b7b, 9 candidatas): las 9 se renderizan sin romper el diálogo y usa la `pregunta` real del payload", async () => {
    pendientesState = [MARCA_AMBIGUA_TEC_COINCIDE];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Elegir marca correcta" }));

    expect(screen.getByText(MARCA_AMBIGUA_TEC_COINCIDE.payload.pregunta as string)).toBeInTheDocument();

    expect(screen.getAllByRole("radio")).toHaveLength(9);
    for (const marca of CANDIDATAS_EAS_9) {
      expect(screen.getByRole("radio", { name: new RegExp(marca) })).toBeInTheDocument();
    }

    const botonConfirmar = screen.getByRole("button", { name: "Confirmar" });
    expect(botonConfirmar).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /SERIES5/ }));
    expect(botonConfirmar).toBeEnabled();

    fireEvent.click(botonConfirmar);
    await waitFor(() =>
      expect(postCalls).toEqual([{ id: "p-marca-ambigua-tec-coincide", body: { accion: "confirmar", valor: "SERIES5" } }]),
    );
  });

  it("marca_ambigua sin `pregunta` en el payload: respaldo neutro que no asegura una contradicción", async () => {
    pendientesState = [
      pendiente({
        id: "p-marca-ambigua-sin-pregunta",
        tipo: "marca_ambigua",
        clave_natural: "wt1601",
        payload: { sku: "WT1601", marca_actual: "EAS", marca_fuente: "EAS", candidatas: ["EAS", "SERIES5"] },
      }),
    ];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Elegir marca correcta" }));
    expect(screen.getByText("Elige la marca correcta de WT1601 entre las opciones disponibles.")).toBeInTheDocument();
    expect(screen.queryByText(/distinta entre la fuente vigente/)).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // (INV-TAXO F2) familia_atomo_dudoso: confirmar RATIFICA (no escribe), descartar exige motivo.
  // ------------------------------------------------------------
  // ------------------------------------------------------------
  // (MVP-CIERRE F2) sku_sin_tecnologia
  // ------------------------------------------------------------
  it("sku_sin_tecnologia: la fila se puede decidir SIN abrir la ficha (marca, familia, descripción, origen)", async () => {
    pendientesState = [SIN_TEC_CON_FAMILIA];
    render(<BandejaView />);

    expect(await screen.findByText("Sin tecnología: 4751-4339-9605")).toBeInTheDocument();
    expect(screen.getByText(/marca SERIES5/)).toBeInTheDocument();
    expect(screen.getByText(/familia SERIES16/)).toBeInTheDocument();
    expect(screen.getByText("SERIES16 TX20 TRANSMITTER ANTENNA WITHOUT CASE")).toBeInTheDocument();
    expect(screen.getByText("entró en la última ingesta")).toBeInTheDocument();
  });

  it("sku_sin_tecnologia sin familia: el título lo dice y la familia se marca como faltante", async () => {
    pendientesState = [SIN_TEC_SIN_FAMILIA];
    render(<BandejaView />);
    expect(await screen.findByText("Sin tecnología ni familia: 7316")).toBeInTheDocument();
    expect(screen.getByText("sin familia")).toBeInTheDocument();
  });

  it("sku_sin_tecnologia: 'Clasificar' arranca deshabilitado y el valor viaja como JSON", async () => {
    pendientesState = [SIN_TEC_CON_FAMILIA];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Clasificar" }));
    // El botón del diálogo comparte el nombre con el disparador: se toma el del footer.
    const botones = await screen.findAllByRole("button", { name: "Clasificar" });
    const confirmar = botones[botones.length - 1];
    expect(confirmar).toBeDisabled();

    // Este SKU SÍ trae familia: no se le pide.
    expect(screen.queryByLabelText("Familia (opcional)")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "BRAND1" } });
    expect(confirmar).toBeEnabled();
    fireEvent.click(confirmar);

    await waitFor(() =>
      expect(postCalls).toEqual([
        { id: "p-sin-tec-fam", body: { accion: "confirmar", valor: JSON.stringify({ tecnologia: "BRAND1" }) } },
      ]),
    );
  });

  it("sku_sin_tecnologia SIN familia: se piden las DOS y ambas viajan en el mismo POST", async () => {
    pendientesState = [SIN_TEC_SIN_FAMILIA];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Clasificar" }));
    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "VERTICAL" } });
    fireEvent.change(screen.getByLabelText("Familia (opcional)"), { target: { value: "CAJAS" } });

    const botones = screen.getAllByRole("button", { name: "Clasificar" });
    fireEvent.click(botones[botones.length - 1]);

    // Un solo viaje por SKU: las dos decisiones en el mismo POST.
    await waitFor(() =>
      expect(postCalls).toEqual([
        {
          id: "p-sin-tec-sinfam",
          body: { accion: "confirmar", valor: JSON.stringify({ tecnologia: "VERTICAL", familia: "CAJAS" }) },
        },
      ]),
    );
  });

  it("sku_sin_tecnologia: el diálogo ofrece el vocabulario DECLARADO, no una lista vacía", async () => {
    pendientesState = [SIN_TEC_CON_FAMILIA];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Clasificar" }));

    // Las 4 de `public.tecnologias` (verificadas contra la base: EAS, BRAND2,
    // BRAND1, VERTICAL, todas activo=true). Arrancar vacío descartaba
    // información que el negocio YA declaró desde 0011.
    for (const t of ["EAS", "BRAND2", "BRAND1", "VERTICAL"]) {
      expect(screen.getByRole("button", { name: t })).toBeInTheDocument();
    }

    // Un clic llena el campo: es lo que evita teclear la misma palabra muchas veces.
    fireEvent.click(screen.getByRole("button", { name: "BRAND1" }));
    expect(screen.getByLabelText("Tecnología")).toHaveValue("BRAND1");
  });

  it("si el catálogo no está disponible, el diálogo NO se rompe: cae a texto libre", async () => {
    // Degradación declarada de `fetchTecnologias` (proyecto sin 0008, o la
    // tabla inaccesible): la bandeja sigue resolviendo, solo sin sugerencias.
    tecnologiasState = [];
    pendientesState = [SIN_TEC_CON_FAMILIA];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Clasificar" }));
    expect(screen.queryByRole("button", { name: "BRAND1" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "NUEVA" } });
    const botones = screen.getAllByRole("button", { name: "Clasificar" });
    fireEvent.click(botones[botones.length - 1]);
    await waitFor(() =>
      expect(postCalls).toEqual([
        { id: "p-sin-tec-fam", body: { accion: "confirmar", valor: JSON.stringify({ tecnologia: "NUEVA" }) } },
      ]),
    );
  });

  it("el auto-cierre de la ingesta SE VE: badge propio, no se confunde con una decisión humana", async () => {
    pendientesState = [SIN_TEC_AUTOCERRADO];
    render(<BandejaView />);

    // Vive en la sub-tab "Resueltos" (la de Abiertos es la activa por
    // defecto). Radix activa por `onMouseDown`, no por "click".
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Resueltos" }));
    expect(await screen.findByText("cerrado automáticamente")).toBeInTheDocument();
    expect(screen.getByText(/auto:ingesta/)).toBeInTheDocument();
    expect(screen.getByText(/ya tiene tecnología asignada/)).toBeInTheDocument();
  });

  it("familia_atomo_dudoso: 'Ratificar' usa `opcion_confirmar` del payload y el POST es confirmar SIN motivo/valor", async () => {
    pendientesState = [FAMILIA_ATOMO_ABIERTO];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar: es una sola familia" }));
    expect(screen.getByText(FAMILIA_ATOMO_ABIERTO.payload.opcion_confirmar as string)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ratificar" }));
    await waitFor(() => expect(postCalls).toEqual([{ id: "p-familia-atomo", body: { accion: "confirmar" } }]));
  });

  it("familia_atomo_dudoso: 'Descartar: son dos familias' muestra `opcion_descartar` y exige motivo; el POST es descartar con motivo", async () => {
    pendientesState = [FAMILIA_ATOMO_ABIERTO];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Descartar: son dos familias" }));
    expect(screen.getByText(FAMILIA_ATOMO_ABIERTO.payload.opcion_descartar as string)).toBeInTheDocument();

    const botonDescartar = screen.getByRole("button", { name: "Confirmar descarte" });
    expect(botonDescartar).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Son dos conceptos distintos" } });
    fireEvent.click(botonDescartar);

    await waitFor(() =>
      expect(postCalls).toEqual([{ id: "p-familia-atomo", body: { accion: "descartar", motivo: "Son dos conceptos distintos" } }]),
    );
  });

  it("familia_atomo_dudoso sin `opcion_confirmar`/`opcion_descartar`: usa un respaldo razonable (no revienta)", async () => {
    pendientesState = [
      pendiente({
        id: "p-familia-atomo-2",
        tipo: "familia_atomo_dudoso",
        clave_natural: "z1900 / 6693",
        payload: {
          campo: "familia",
          canonico: "Z1900 / 6693",
          atomos: ["Z1900", "6693"],
          atomos_fantasma: ["6693"],
          skus: ["SKU-X"],
          n_skus: 1,
        },
      }),
    ];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar: es una sola familia" }));
    expect(screen.getByText(/RATIFICA que es una sola familia/)).toBeInTheDocument();
  });

  it("POST con error (p.ej. 400 pendiente ya resuelto): no revienta, el diálogo sigue abierto (sin refetch) y la fila sigue en Abiertos", async () => {
    pendientesState = [MARCA_ABIERTO];
    postStatus = 400;
    postBody = { error: "pendiente_invalido", message: "El pendiente ya fue resuelto." };
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Marcar resuelto" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    // Falló: el diálogo NO se cierra solo (a diferencia del éxito) — se cierra manualmente para
    // revisar que, sin refetch, la fila original ("Abrir ficha") sigue intacta detrás de él.
    expect(screen.getByRole("dialog", { name: "Marcar como resuelto" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Abrir ficha" })).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // (B, [MVP-2]) familia_nueva
  // ------------------------------------------------------------
  it("familia_nueva: título + detalle con hermanas — N SKU, prefijo, chips de hermanas y la pregunta", async () => {
    pendientesState = [FAMILIA_NUEVA_CON_HERMANAS];
    render(<BandejaView />);

    expect(await screen.findByText("Familia nueva en la fuente: SERIES 2 70")).toBeInTheDocument();
    expect(screen.getByText("2 SKU la trajeron en esta ingesta.")).toBeInTheDocument();
    expect(screen.getByText("3 familias existentes")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2 34")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2 41")).toBeInTheDocument();
    expect(screen.getByText("SERIES 2 48")).toBeInTheDocument();
    expect(screen.getByText("¿Es una familia propia, o es la misma que una de éstas?")).toBeInTheDocument();
  });

  it("familia_nueva sin hermanas (1 SKU, singular): dice explícitamente que no hay hermanas — el silencio no vale", async () => {
    pendientesState = [FAMILIA_NUEVA_SIN_HERMANAS];
    render(<BandejaView />);

    expect(await screen.findByText("Familia nueva en la fuente: ZORP 10")).toBeInTheDocument();
    expect(screen.getByText("1 SKU la trajo en esta ingesta.")).toBeInTheDocument();
    expect(screen.getByText("Sin familias existentes que empiecen por «ZORP».")).toBeInTheDocument();
  });

  it("familia_nueva sin prefijo (nombre de una sola palabra): copy distinto, sin mencionar un prefijo vacío", async () => {
    pendientesState = [FAMILIA_NUEVA_SIN_PREFIJO];
    render(<BandejaView />);

    expect(await screen.findByText("Familia nueva en la fuente: GADGET")).toBeInTheDocument();
    expect(screen.getByText("Nombre de una sola palabra: sin hermanas que sugerir.")).toBeInTheDocument();
  });

  it("familia_nueva: 'Es la misma que…' — las hermanas prellenan el input (no seleccionan directo), Fusionar deshabilitado hasta que haya destino, y el POST va a /fusionar con el motivo trazado", async () => {
    pendientesState = [FAMILIA_NUEVA_CON_HERMANAS];
    onFusionPost = (id) => {
      pendientesState = pendientesState.map((p) =>
        p.id === id
          ? {
              ...p,
              estado: "resuelto" as const,
              resuelto_por: "admin@example.com",
              resuelto_en: "2026-08-03T00:00:00.000Z",
              resolucion: { accion: "confirmar", motivo: "Fusionada con «SERIES 2 41»." },
            }
          : p,
      );
    };
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Es la misma que…" }));
    const input = await screen.findByLabelText("Familia destino");
    expect(input).toHaveValue("");
    const botonFusionar = screen.getByRole("button", { name: "Fusionar" });
    expect(botonFusionar).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "SERIES 2 41" }));
    expect(input).toHaveValue("SERIES 2 41");
    expect(botonFusionar).toBeEnabled();

    fireEvent.click(botonFusionar);
    await waitFor(() =>
      expect(fusionCalls).toEqual([
        { id: "p-familia-nueva", body: { destino: "SERIES 2 41", motivo: "Fusionada con «SERIES 2 41».", skusEsperados: 2 } },
      ]),
    );
    // Refetch tras éxito: la fila sale de Abiertos.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Es la misma que…" })).not.toBeInTheDocument());
  });

  it("familia_nueva sin hermanas: 'Es la misma que…' no ofrece chips, pero el input sigue editable y el POST funciona igual", async () => {
    pendientesState = [FAMILIA_NUEVA_SIN_HERMANAS];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Es la misma que…" }));
    expect(screen.queryByText("hermanas:")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Familia destino"), { target: { value: "ZORP" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar" }));

    await waitFor(() =>
      expect(fusionCalls).toEqual([
        { id: "p-familia-nueva-sin-hermanas", body: { destino: "ZORP", motivo: "Fusionada con «ZORP».", skusEsperados: 1 } },
      ]),
    );
  });

  it("familia_nueva: 400 en /fusionar no revienta — toast con el mensaje curado, el diálogo sigue abierto (sin refetch)", async () => {
    pendientesState = [FAMILIA_NUEVA_CON_HERMANAS];
    fusionPostStatus = 400;
    fusionPostBody = { error: 'pendiente_invalido', message: 'la familia destino "X" esta inactiva' };
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Es la misma que…" }));
    fireEvent.change(screen.getByLabelText("Familia destino"), { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: "Fusionar" }));

    await waitFor(() => expect(fusionCalls).toHaveLength(1));
    // Falló: el diálogo NO se cierra solo (a diferencia del éxito) — mismo criterio que el genérico.
    expect(screen.getByRole("dialog", { name: "¿Con cuál familia existente es la misma?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Familia destino")).toHaveValue("X");
  });

  it("familia_nueva: 'Es una familia propia' confirma vía el genérico (sin fusionar) — POST confirmar sin motivo/valor", async () => {
    pendientesState = [FAMILIA_NUEVA_CON_HERMANAS];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Es una familia propia" }));
    expect(await screen.findByRole("dialog", { name: "¿Es una familia nueva?" })).toBeInTheDocument();
    expect(screen.getByText(/es una familia PROPIA, distinta de las existentes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(postCalls).toEqual([{ id: "p-familia-nueva", body: { accion: "confirmar" } }]));
    expect(fusionCalls).toEqual([]);
  });

  it("familia_nueva: Descartar exige motivo, igual que cualquier otro pendiente", async () => {
    pendientesState = [FAMILIA_NUEVA_CON_HERMANAS];
    render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    const boton = await screen.findByRole("button", { name: "Confirmar descarte" });
    expect(boton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Ya se corrigió en el Excel de origen" } });
    fireEvent.click(boton);

    await waitFor(() =>
      expect(postCalls).toEqual([
        { id: "p-familia-nueva", body: { accion: "descartar", motivo: "Ya se corrigió en el Excel de origen" } },
      ]),
    );
  });

  // ------------------------------------------------------------
  // Sección "Derivados" (descuadres, computados al vuelo).
  // ------------------------------------------------------------
  it("Derivados: lista descuadres con link mono a la ficha y nota de que se corrigen en la fuente", async () => {
    derivadosState = [{ sku: "A-1", resv: 10, suma_reservas: 4 }];
    render(<BandejaView />);

    expect(await screen.findByText("Descuadres de reservas (1)")).toBeInTheDocument();
    expect(screen.getByText("Se recalculan en cada ingesta — se corrigen en la fuente, no aquí.")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "A-1" });
    expect(link).toHaveAttribute("href", "/catalogo/A-1");
    expect(screen.getByText(/resv 10 vs Σ 4/)).toBeInTheDocument();
  });

  it("Derivados vacío: 'Sin descuadres detectados.'", async () => {
    derivadosState = [];
    render(<BandejaView />);
    expect(await screen.findByText("Descuadres de reservas (0)")).toBeInTheDocument();
    expect(screen.getByText("Sin descuadres detectados.")).toBeInTheDocument();
  });

  it("Derivados: colapsa a 10 con botón 'Ver todos' si hay más de 10", async () => {
    derivadosState = Array.from({ length: 13 }, (_, i) => ({ sku: `SKU-${i}`, resv: i + 1, suma_reservas: i }));
    render(<BandejaView />);

    await screen.findByText("Descuadres de reservas (13)");
    const linksVisibles = () => screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/catalogo/"));
    expect(linksVisibles()).toHaveLength(10);

    fireEvent.click(screen.getByRole("button", { name: "Ver todos (13)" }));
    expect(linksVisibles()).toHaveLength(13);
  });
});

// ------------------------------------------------------------
// R3-3 (ronda de corrección, docs/engineering/failure-patterns.md (P3)): el gate viejo
// `{loading && <Skeleton/>}` + `{!loading && !error && data && ...}`
// desmonta la tabla COMPLETA cada vez que se resuelve un pendiente, porque
// `onResuelto → refetch` pone `loading=true` con `data` TODAVÍA poblado
// (ver `use-api.ts`): un mock de `fetch` que resuelve en el mismo tick NO
// abre esa ventana (P3: "la ventana se cierra sola cuando no hay
// latencia"), así que este test usa un *deferred* controlado para el
// SEGUNDO GET (el disparado por el refetch) y deja el primero y el POST
// inmediatos — mismo patrón que `foco-sku.test.tsx`/`config-usuarios.test.tsx`.
// ------------------------------------------------------------
describe("BandejaView — anti-remount al resolver un pendiente (R3-3)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function crearDeferred<T>(): { promise: Promise<T>; resolver: (valor: T) => void } {
    let resolver!: (valor: T) => void;
    const promise = new Promise<T>((resolve) => {
      resolver = resolve;
    });
    return { promise, resolver };
  }

  it("MUTACIÓN: la fila sigue montada (sin esqueleto) mientras el refetch post-resolución está en vuelo; aria-busy queda en true", async () => {
    const segundoGet = crearDeferred<PendientesResponse>();
    let llamadasGet = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";

        if (url === "/api/pendientes" && method === "GET") {
          llamadasGet += 1;
          if (llamadasGet === 1) {
            const body: PendientesResponse = {
              pendientes: [KAM_ABIERTO],
              derivados: { descuadres: [], drift: null, puentes: null },
              conteos: { abiertos: 1, por_tipo: { kam_desconocido: 1 } },
              tecnologias: [],
            };
            return new Response(JSON.stringify(body), { status: 200 });
          }
          // 2do GET (disparado por `onResuelto` → `refetch`): queda COLGADO
          // hasta que el test lo resuelva explícitamente.
          const body = await segundoGet.promise;
          return new Response(JSON.stringify(body), { status: 200 });
        }

        const m = url.match(/^\/api\/pendientes\/(.+)$/);
        if (m && method === "POST") {
          return new Response(JSON.stringify({ estado: "resuelto", actor: "admin@example.com" }), { status: 200 });
        }

        throw new Error("URL no manejada en el mock de fetch: " + url);
      }),
    );

    const { container } = render(<BandejaView />);

    fireEvent.click(await screen.findByRole("button", { name: "Confirmar como KAM" }));
    await screen.findByLabelText("Nombre canónico");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    // El POST resuelve de inmediato → `onResuelto()` dispara el refetch → el
    // 2do GET queda en vuelo (`loading=true`, `data` TODAVÍA con la
    // respuesta anterior — ver `use-api.ts`).
    await waitFor(() => expect(llamadasGet).toBe(2));

    // Con el gate viejo (`!loading && !error && data && ...`) la tabla se
    // desmonta AQUÍ y la reemplaza el esqueleto — con el corregido
    // (`data && ...`) sigue montada.
    expect(screen.getByText("KAM desconocido: NADIA")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Cargando pendientes…" })).not.toBeInTheDocument();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

    segundoGet.resolver({
      pendientes: [
        {
          ...KAM_ABIERTO,
          estado: "resuelto",
          resuelto_por: "admin@example.com",
          resuelto_en: "2026-07-21T00:00:00.000Z",
          resolucion: { accion: "confirmar", motivo: null, kam_id: "kam-9" },
        },
      ],
      derivados: { descuadres: [], drift: null, puentes: null },
      conteos: { abiertos: 0, por_tipo: {} },
      tecnologias: [],
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirmar como KAM" })).not.toBeInTheDocument());
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
