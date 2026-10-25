import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { CatalogoItem, CatalogoPage, CatalogoFacetas } from "@/types/api";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { separarFamilias } from "@/lib/familias";
import { SessionProvider, type SesionUsuario } from "@/components/providers/session-provider";

// ------------------------------------------------------------
// Fake router/URL compartido por next/navigation (useRouter/usePathname/
// useSearchParams), implementado sobre useSyncExternalStore para que los
// componentes se re-rendericen cuando `router.replace(...)` cambia la URL —
// simulando cómo Next.js re-renderiza cuando cambian los searchParams.
// ------------------------------------------------------------
const fakeNav = vi.hoisted(() => {
  let search = "";
  const listeners = new Set<() => void>();
  const replaceCalls: string[] = [];

  return {
    getSearch: () => search,
    setSearch: (s: string) => {
      search = s;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    replaceCalls,
    reset: (initial = "") => {
      search = initial;
      replaceCalls.length = 0;
      listeners.clear();
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: (url: string) => {
      fakeNav.replaceCalls.push(url);
      const qIndex = url.indexOf("?");
      fakeNav.setSearch(qIndex === -1 ? "" : url.slice(qIndex + 1));
    },
    push: (url: string) => {
      fakeNav.replaceCalls.push(url);
      const qIndex = url.indexOf("?");
      fakeNav.setSearch(qIndex === -1 ? "" : url.slice(qIndex + 1));
    },
  }),
  usePathname: () => "/catalogo",
  useSearchParams: () => {
    const snapshot = React.useSyncExternalStore(fakeNav.subscribe, fakeNav.getSearch, fakeNav.getSearch);
    return new URLSearchParams(snapshot);
  },
}));

import { CatalogoView } from "./catalogo-view";

// `CatalogoView` usa `useSesion()` (P3, [MVP-2] frente E) para decidir si
// pinta el chip "Sin clasificación v2" — por default se envuelve con rol
// 'admin' (preserva el comportamiento que ya cubrían estos tests antes de
// [MVP-2]: el chip siempre visible). Los tests de no-admin pasan 'kam'
// explícitamente.
function renderConSesion(rol: SesionUsuario["rol"] = "admin") {
  return render(
    <SessionProvider sesion={{ id: "u-1", email: "user@example.com", rol }}>
      <CatalogoView />
    </SessionProvider>,
  );
}

// ------------------------------------------------------------
// Fixtures + fetch mock de /api/inventory — R1-2: `CatalogoView` ya NO
// hace fetch-all (`pageSize=200`, `cargarCatalogoCompleto`) ni tiene
// `CatalogoFiltros` un `/api/familias` propio: las 4 dimensiones de
// filtro (árbol Y selects) se alimentan de `data.facetas`, la MISMA
// respuesta de `/api/inventory` que ya trae la tabla/grid — un solo
// endpoint, un solo fetch por cambio de URL.
// ------------------------------------------------------------
function item(overrides: Partial<CatalogoItem> = {}): CatalogoItem {
  // `familias` SIEMPRE coherente con `familia` (invariante real del
  // contrato: `familias === separarFamilias(familia)`) — si el caller
  // sobreescribe `familia` sin tocar `familias`, se recalcula solo.
  const familia = overrides.familia !== undefined ? overrides.familia : "CANDADOS";
  return {
    sku: "A-1",
    marca: "BRAND1",
    familia,
    familias: separarFamilias(familia),
    descripcion: "Descripción A",
    total: 10,
    reservado: 2,
    disponible: 8,
    badges: [],
    ...overrides,
  };
}

/** Facetas EN CASCADA coherentes con `items` (mismo criterio que `buildCatalogPage`, sin reimplementar la cascada real: solo agrupa por dimensión). */
function facetasDe(items: CatalogoItem[]): CatalogoFacetas {
  const contar = (vals: string[]) => {
    const mapa = new Map<string, number>();
    for (const v of vals) mapa.set(v, (mapa.get(v) ?? 0) + 1);
    return Array.from(mapa.entries())
      .map(([valor, conteo]) => ({ valor, conteo }))
      .sort((a, b) => (a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0));
  };
  return {
    tecnologias: contar(items.map((i) => i.tecnologia).filter((t): t is string => !!t)),
    marcas: contar(items.map((i) => i.marca)),
    familias: contar(items.flatMap((i) => i.familias)),
    productos: contar(items.map((i) => i.producto).filter((p): p is string => !!p)),
    almacenes: [],
    sin_familia: items.filter((i) => i.familias.length === 0).length,
    sin_tecnologia: items.filter((i) => i.tecnologia == null).length,
  };
}

function pageResponse(items: CatalogoItem[], overrides: Partial<CatalogoPage> = {}): CatalogoPage {
  return { items, page: 1, pageSize: 50, total: items.length, totalPages: 1, facetas: facetasDe(items), excluidos: { total: 0, marcas: [] }, ...overrides };
}

type MainResponder = (url: string) => { status: number; body: unknown };

function okResponder(page: CatalogoPage | ((url: string) => CatalogoPage)): MainResponder {
  return (url) => ({ status: 200, body: typeof page === "function" ? page(url) : page });
}

let mainResponder: MainResponder = okResponder(pageResponse([]));

/**
 * `waitForMain` (R1-1): por default la carga resuelve de inmediato. El
 * mutante de más abajo la reemplaza por un `crearDeferred`/
 * `esperarSoloEnRefetch` (mismo patrón que `embarques-view.test.tsx`/
 * `config-usuarios.test.tsx`) para dejar un refetch "genuinamente en
 * vuelo" y determinista — sin latencia real, el render intermedio nunca
 * commitea y el bug es invisible (`docs/engineering/failure-patterns.md`, P3).
 */
function stubFetch(waitForMain: () => Promise<void> = () => Promise.resolve()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/inventory")) {
        await waitForMain();
        const { status, body } = mainResponder(url);
        return new Response(JSON.stringify(body), { status });
      }
      throw new Error("URL no manejada en el mock de fetch: " + url);
    }),
  );
}

/** Llamadas de fetch al endpoint de inventario (hoy el ÚNICO que pide esta vista). */
function mainCalls(): string[] {
  const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map((c: unknown[]) => String(c[0])).filter((u: string) => u.startsWith("/api/inventory"));
}

/** Deferred controlado por el test (R1-1, mismo patrón que `config-usuarios.test.tsx`/`embarques-view.test.tsx`). */
function crearDeferred(): { promise: Promise<void>; resolver: () => void } {
  let resolver!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return { promise, resolver };
}
function esperarSoloEnRefetch(deferred: { promise: Promise<void> }): () => Promise<void> {
  let llamadas = 0;
  return () => (llamadas++ === 0 ? Promise.resolve() : deferred.promise);
}

describe("CatalogoView", () => {
  beforeEach(() => {
    fakeNav.reset();
    mainResponder = okResponder(pageResponse([]));
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loading: muestra el skeleton mientras la carga está en curso", () => {
    renderConSesion();
    expect(screen.getByRole("status", { name: "Cargando catálogo…" })).toBeInTheDocument();
  });

  it("error: muestra EstadoError con el message del contrato y reintenta al hacer click", async () => {
    mainResponder = () => ({ status: 500, body: { error: "internal_error", message: "Fallo interno" } });
    renderConSesion();

    await waitFor(() => expect(screen.getByText("No se pudo cargar la información")).toBeInTheDocument());
    expect(screen.getByText("Fallo interno")).toBeInTheDocument();

    // El árbol comparte `error`/`refetch` con el fetch principal (A1: se
    // alimenta de la MISMA respuesta que la tabla) — con un fetch fallido
    // aparecen DOS botones "Reintentar" (tabla + árbol), ambos llaman al
    // mismo `refetch` (mismo patrón ya establecido para "Limpiar filtros",
    // ver el test de más abajo).
    const llamadasAntes = mainCalls().length;
    const botones = screen.getAllByRole("button", { name: "Reintentar" });
    expect(botones).toHaveLength(2);
    fireEvent.click(botones[0]);
    await waitFor(() => expect(mainCalls().length).toBeGreaterThan(llamadasAntes));
  });

  it("vacío sin ingesta (sin filtros, total=0): copy + link a /snapshots", async () => {
    mainResponder = okResponder(pageResponse([]));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Aún no hay datos de inventario cargados.")).toBeInTheDocument());
    expect(screen.getByText("Cuando corra la primera ingesta, el catálogo aparecerá aquí.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Snapshots" })).toHaveAttribute("href", "/snapshots");
  });

  it("vacío con filtros (total=0, con ?marca=): copy + botón Limpiar filtros que resetea la URL", async () => {
    fakeNav.reset("marca=NOPE");
    mainResponder = okResponder(pageResponse([]));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("Ningún SKU coincide con los filtros actuales.")).toBeInTheDocument();

    // Chrome persistente (C3): con un filtro activo hay DOS botones "Limpiar
    // filtros" en pantalla — el de `CatalogoFiltros` (siempre montado) y el
    // del estado vacío. Ambos llaman al mismo `handleLimpiar`; cualquiera
    // de los dos resetea la URL igual.
    const botones = screen.getAllByRole("button", { name: "Limpiar filtros" });
    fireEvent.click(botones[0]);
    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
  });

  // ============================================================
  // [VERT-B2] LA DECLARACIÓN DE LO ESCONDIDO.
  //
  // Una población oculta EN SILENCIO es el defecto que este bloque existe para
  // impedir. Estas pruebas exigen las dos mitades del trato: que la pantalla lo
  // DIGA cuando hay algo escondido, y que NO invente nada cuando no lo hay.
  // ============================================================
  it("declara lo excluido: «N SKU no se listan…» y el detalle nombra las marcas", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1" })], { total: 1, excluidos: { total: 64, marcas: ["VERTICAL"] } }),
    );
    renderConSesion();

    await waitFor(() => expect(screen.getByText(/no se listan en el catálogo por regla de marca/)).toBeInTheDocument());
    expect(screen.getByText("64 SKU")).toBeInTheDocument();
    // El detalle vive dentro del <details>: está en el DOM aunque esté plegado,
    // que es justo lo que permite afirmarlo sin simular el clic de apertura.
    expect(screen.getByText("VERTICAL")).toBeInTheDocument();
  });

  // ⚠ ESTE ES EL CASO QUE SE OLVIDA, y es el que más hace falta: `barra` —donde
  // vive «N resultados»— es null en las ramas de total 0, así que una
  // declaración anclada ahí se vería perfecta en el caso feliz y DESAPARECERÍA
  // justo aquí. Sin esta prueba, la media función se ve igual que la completa.
  it("y la declara TAMBIÉN con la rejilla vacía, que es donde más falta hace", async () => {
    fakeNav.reset("q=zzz");
    mainResponder = okResponder(pageResponse([], { excluidos: { total: 64, marcas: ["VERTICAL"] } }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText(/no se listan en el catálogo por regla de marca/)).toBeInTheDocument();
  });

  it("sin nada excluido NO inventa el aviso (total 0 ⇒ no se pinta)", async () => {
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByRole("link", { name: "A-1" })).toBeInTheDocument());
    expect(screen.queryByText(/no se listan en el catálogo por regla de marca/)).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // Y el vacío tiene que decir POR QUÉ. Con `?marca=VERTICAL` el copy genérico
  // es verdadero e inútil: sugiere que el filtro no encontró nada, cuando lo
  // que pasó es que una regla escondió la marca entera.
  // ------------------------------------------------------------
  it("?marca=<excluida>: el vacío explica la REGLA, no dice «ningún SKU coincide»", async () => {
    fakeNav.reset("marca=VERTICAL");
    mainResponder = okResponder(pageResponse([], { excluidos: { total: 64, marcas: ["VERTICAL"] } }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("VERTICAL no se lista en el catálogo")).toBeInTheDocument());
    expect(screen.queryByText("Ningún SKU coincide con los filtros actuales.")).not.toBeInTheDocument();

    // Y la salida sigue existiendo: la anti-trampa dejó de reinyectar el nodo,
    // así que el usuario necesita este botón para no quedarse encerrado.
    fireEvent.click(screen.getByRole("button", { name: "Quitar el filtro de marca" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
  });

  it("y se compara sin importar la capitalización: ?marca=vertical explica igual", async () => {
    fakeNav.reset("marca=vertical");
    mainResponder = okResponder(pageResponse([], { excluidos: { total: 64, marcas: ["VERTICAL"] } }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("vertical no se lista en el catálogo")).toBeInTheDocument());
  });

  it("una marca NO excluida con 0 resultados sigue cayendo al copy genérico", async () => {
    fakeNav.reset("marca=NOPE");
    mainResponder = okResponder(pageResponse([], { excluidos: { total: 64, marcas: ["VERTICAL"] } }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("Ningún SKU coincide con los filtros actuales.")).toBeInTheDocument();
  });

  it("data: renderiza la tabla con los items de la página y el contador de resultados", async () => {
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" }), item({ sku: "B-2", marca: "EAS" })], { total: 2 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByRole("link", { name: "A-1" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "B-2" })).toBeInTheDocument();
    expect(screen.getByText("2 resultados")).toBeInTheDocument();
  });

  it("página fuera de rango (items=[] con total>0): mensaje + botón 'Ir a la página 1'", async () => {
    fakeNav.reset("page=9");
    mainResponder = okResponder(pageResponse([], { page: 9, total: 40, totalPages: 4 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados en esta página")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ir a la página 1" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
  });

  it("?q= inicial de la URL se aplica al fetch y precarga el input de búsqueda", async () => {
    fakeNav.reset("q=candado");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(mainCalls().some((u) => u.includes("q=candado"))).toBe(true));
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("candado");
  });

  it("cambiar filtros construye la URL /api/inventory esperada y actualiza la URL propia", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1" })], {
        total: 1,
        facetas: {
          tecnologias: [],
          marcas: [
            { valor: "BRAND1", conteo: 1 },
            { valor: "EAS", conteo: 1 },
          ],
          familias: [],
          productos: [],
          almacenes: [],
          sin_familia: 0,
          sin_tecnologia: 0,
        },
      }),
    );
    renderConSesion();

    await waitFor(() => expect(within(screen.getByLabelText("Marca")).getByRole("option", { name: "BRAND1" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "BRAND1" } });

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?marca=BRAND1");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1"));
  });

  it("cambiar de filtro varias veces NO remonta CatalogoFiltros (mismo nodo del input — R1-2: ya no hay /api/familias que contar)", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1" })], {
        total: 1,
        facetas: {
          tecnologias: [],
          marcas: [
            { valor: "BRAND1", conteo: 1 },
            { valor: "EAS", conteo: 1 },
          ],
          familias: [],
          productos: [],
          almacenes: [{ valor: "NORTH", conteo: 1 }],
          sin_familia: 0,
          sin_tecnologia: 0,
        },
      }),
    );
    renderConSesion();

    await waitFor(() => expect(within(screen.getByLabelText("Marca")).getByRole("option", { name: "BRAND1" })).toBeInTheDocument());
    const inputAntes = screen.getByLabelText("Buscar en el catálogo");

    // Antes de C3, cada transición de loading desmontaba <CatalogoFiltros>
    // por completo (early-return del `loading`); con R1-2, además,
    // `CatalogoFiltros` ya no tiene NINGÚN fetch propio (antes pedía
    // /api/familias) — hoy la única forma observable de detectar un
    // remount es la identidad del nodo del DOM.
    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "BRAND1" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1"));

    fireEvent.change(screen.getByLabelText("Almacén"), { target: { value: "NORTH" } });
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1&almacen=NORTH"));

    expect(screen.getByLabelText("Buscar en el catálogo")).toBe(inputAntes);
  });

  it("R1-2: el select de Almacén se alimenta de data.facetas.almacenes (antes: lista fija hardcodeada en CatalogoFiltros)", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1" })], {
        total: 1,
        facetas: {
          tecnologias: [],
          marcas: [],
          familias: [],
          productos: [],
          almacenes: [{ valor: "TRAN", conteo: 4 }],
          sin_familia: 0,
          sin_tecnologia: 0,
        },
      }),
    );
    renderConSesion();

    await waitFor(() => expect(within(screen.getByLabelText("Almacén")).getByRole("option", { name: "TRAN" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Almacén"), { target: { value: "TRAN" } });

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?almacen=TRAN");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?almacen=TRAN"));
  });

  it("cambiar de página construye la URL /api/inventory esperada", async () => {
    mainResponder = okResponder((url) => {
      const page = Number(new URLSearchParams(url.split("?")[1] ?? "").get("page") ?? "1");
      return pageResponse([item({ sku: "A-1" })], { page, total: 120, totalPages: 3 });
    });
    renderConSesion();

    await waitFor(() => expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?page=2");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?page=2"));
  });

  it("cambiar de vista a Grid no dispara un nuevo fetch (misma página de datos)", async () => {
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByRole("link", { name: "A-1" })).toBeInTheDocument());
    const llamadasAntes = mainCalls().length;

    fireEvent.click(screen.getByRole("button", { name: /Grid/ }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?vista=grid");
    expect(mainCalls().length).toBe(llamadasAntes);
    expect(screen.getByRole("link", { name: /A-1/ })).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // B-PARCHE F4: filtro de Tecnología (select data-driven + "Sin tecnología").
  // ------------------------------------------------------------
  it("select de tecnología: opciones derivadas de data.facetas (ya vienen ordenadas ASC del backend) + 'Sin tecnología' fija", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1" })], {
        total: 1,
        facetas: {
          tecnologias: [
            { valor: "AM", conteo: 1 },
            { valor: "RFID", conteo: 1 },
          ],
          marcas: [],
          familias: [],
          productos: [],
          almacenes: [],
          sin_familia: 0,
          sin_tecnologia: 0,
        },
      }),
    );
    renderConSesion();

    await waitFor(() => expect(within(screen.getByLabelText("Tecnología")).getByRole("option", { name: "AM" })).toBeInTheDocument());
    const opciones = within(screen.getByLabelText("Tecnología"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual(["Tecnología: todas", "AM", "RFID", "Sin tecnología"]);
  });

  it("cambiar el select de tecnología construye la URL /api/inventory esperada (?tecnologia=RFID)", async () => {
    mainResponder = okResponder(
      pageResponse([item({ sku: "A-1", marca: "BRAND1", tecnologia: "RFID" })], {
        total: 1,
        facetas: {
          tecnologias: [{ valor: "RFID", conteo: 1 }],
          marcas: [],
          familias: [],
          productos: [],
          almacenes: [],
          sin_familia: 0,
          sin_tecnologia: 0,
        },
      }),
    );
    renderConSesion();

    await waitFor(() => expect(within(screen.getByLabelText("Tecnología")).getByRole("option", { name: "RFID" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "RFID" } });

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=RFID");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?tecnologia=RFID"));
  });

  it("elegir 'Sin tecnología' construye ?tecnologia=__sin_tecnologia__ (valor reservado SIN_TECNOLOGIA)", async () => {
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByLabelText("Tecnología")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: SIN_TECNOLOGIA } });

    expect(fakeNav.replaceCalls.at(-1)).toBe(`/catalogo?tecnologia=${SIN_TECNOLOGIA}`);
    await waitFor(() => expect(mainCalls().at(-1)).toBe(`/api/inventory?tecnologia=${SIN_TECNOLOGIA}`));
  });

  it("vacío con filtro de tecnología (total=0): copy 'Sin resultados' + Limpiar (no el vacío de ingesta, sinFiltros incluye tecnologia)", async () => {
    fakeNav.reset("tecnologia=RFID");
    mainResponder = okResponder(pageResponse([], { total: 0 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("Ningún SKU coincide con los filtros actuales.")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay datos de inventario cargados.")).not.toBeInTheDocument();

    const botones = screen.getAllByRole("button", { name: "Limpiar filtros" });
    fireEvent.click(botones[0]);
    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
  });

  // ------------------------------------------------------------
  // Bloque 6 · F4: drill-down `?badge=`/`?sinV2=` (enlaces del dashboard) —
  // pass-through hacia /api/inventory + chip removible sobre la tabla.
  // ------------------------------------------------------------
  it("?badge=sobre_reservado: reenvía el param a /api/inventory y pinta el chip 'Sobre-reservados'", async () => {
    fakeNav.reset("badge=sobre_reservado");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?badge=sobre_reservado"));
    expect(screen.getByRole("button", { name: "Sobre-reservados" })).toBeInTheDocument();
  });

  it("la × del chip de badge limpia SOLO ese param (URL + fetch), preservando otros filtros", async () => {
    fakeNav.reset("marca=BRAND1&badge=sobre_reservado");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1&badge=sobre_reservado"));
    fireEvent.click(screen.getByRole("button", { name: "Sobre-reservados" }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?marca=BRAND1");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1"));
    expect(screen.queryByRole("button", { name: "Sobre-reservados" })).not.toBeInTheDocument();
  });

  it("admin: ?sinV2=1 reenvía el param a /api/inventory y pinta el chip 'Sin clasificación v2'; la × lo limpia", async () => {
    fakeNav.reset("sinV2=1");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion("admin");

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?sinV2=1"));
    expect(screen.getByRole("button", { name: "Sin clasificación v2" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sin clasificación v2" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory"));
  });

  // [MVP-2 · frente E] Decisión de producto: KAM/Visitante no ven el vocabulario
  // técnico "clasificación v2". El filtro SIGUE aplicándose igual (pass-
  // through puro hacia /api/inventory, sin cambios) — solo el chip deja de
  // pintarse para estos roles.
  it("no-admin (kam): ?sinV2=1 sigue reenviando el param a /api/inventory, pero el chip 'Sin clasificación v2' NO se pinta", async () => {
    fakeNav.reset("sinV2=1");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion("kam");

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?sinV2=1"));
    expect(screen.queryByRole("button", { name: "Sin clasificación v2" })).not.toBeInTheDocument();
  });

  it("sin badge/sinV2 en la URL: no aparece ningún chip", async () => {
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();
    await waitFor(() => expect(screen.getByText("1 resultados")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Sobre-reservados" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sin clasificación v2" })).not.toBeInTheDocument();
  });

  it("badge y sinV2 activos a la vez: 2 chips independientes", async () => {
    fakeNav.reset("badge=sobre_reservado&sinV2=1");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?badge=sobre_reservado&sinV2=1"));
    expect(screen.getByRole("button", { name: "Sobre-reservados" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sin clasificación v2" })).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // [2.0.1-A] O1 · filtro ?estatus= — mismo mecanismo que el resto de
  // CAMPOS_QUERY (pass-through a /api/inventory), con select propio en la
  // barra y chip removible cuyo label sale de la MISMA taxonomía.
  // ------------------------------------------------------------
  it("cambiar el select de Estatus escribe ?estatus= en la URL (con reset de página) y reenvía a /api/inventory", async () => {
    fakeNav.reset("page=3");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByLabelText("Estatus")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "sobre_reservado" } });

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?estatus=sobre_reservado");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?estatus=sobre_reservado"));
  });

  it("?estatus=sobre_reservado: pinta el chip 'Estatus: Sobre-reservado' (label de la taxonomía) y la × limpia SOLO ese param", async () => {
    fakeNav.reset("marca=BRAND1&estatus=sobre_reservado");
    mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
    renderConSesion();

    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1&estatus=sobre_reservado"));
    fireEvent.click(screen.getByRole("button", { name: "Estatus: Sobre-reservado" }));

    expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?marca=BRAND1");
    await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1"));
    expect(screen.queryByRole("button", { name: "Estatus: Sobre-reservado" })).not.toBeInTheDocument();
  });

  it("vacío con ?estatus= (total=0): copy 'Sin resultados', NO el vacío de ingesta (sinFiltros incluye estatus)", async () => {
    // Sin `estatus` dentro de `sinFiltros`, este caso caería al cold-start
    // («Aún no hay datos de inventario cargados… Ir a Snapshots») — una
    // mentira alcanzable desde el <select>, que badge/sinV2 nunca alcanzan
    // porque solo llegan por drill-down.
    fakeNav.reset("estatus=sin_stock");
    mainResponder = okResponder(pageResponse([], { total: 0 }));
    renderConSesion();

    await waitFor(() => expect(screen.getByText("Sin resultados")).toBeInTheDocument());
    expect(screen.getByText("Ningún SKU coincide con los filtros actuales.")).toBeInTheDocument();
    expect(screen.queryByText("Aún no hay datos de inventario cargados.")).not.toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // R1-1 (ronda de corrección) + su cierre (aria-busy también en Grid, una
  // ronda después): compuerta anti-remount. Con el código viejo (`if
  // (loading) resultados = <Skeleton/>`, sin mirar `data`), CUALQUIER
  // refetch con `data` ya poblado reemplazaba la tabla/grid entero por el
  // esqueleto — mientras `CatalogoArbol`, alimentado por el MISMO fetch,
  // seguía montado con `aria-busy`: la misma vista reaccionaba distinto
  // al mismo evento. El fix decide el esqueleto con `!data` (nunca
  // `loading` a secas); con `data` presente, el contenedor de resultados
  // queda montado (mismo nodo) marcado `aria-busy` (`docs/engineering/failure-patterns.md`, P3).
  //
  // PARAMETRIZADO por vista (Lista/Grid) a propósito: el cierre agregó
  // `ariaBusy` a `CatalogoGrid` porque, hasta entonces, SOLO `CatalogoTabla`
  // lo tenía — un refetch en vista Grid no anunciaba nada a un lector de
  // pantalla y NINGÚN test lo cazaba (el mutante original solo cubría
  // Lista). Este `it.each` corre el MISMO caso/assert para las dos vistas:
  // si mañana alguien vuelve a desconectar `ariaBusy` de cualquiera de las
  // dos en `catalogo-view.tsx`, ESE caso puntual se pone rojo.
  //
  // Resultado real de las dos corridas del mutante (vista Lista, pegado en
  // el reporte del bloque):
  //   - Código viejo (`if (loading) {...}` sin `!data`): ROJO — timeout,
  //     el contenedor capturado antes del refetch queda huérfano
  //     (desmontado, reemplazado por `<CatalogoResultadosSkeleton/>`) y su
  //     `aria-busy` congelado en "false" nunca pasa a "true".
  //   - Código nuevo (este árbol): VERDE.
  // ------------------------------------------------------------
  it.each([
    { vista: "lista" as const, qs: "" },
    { vista: "grid" as const, qs: "vista=grid" },
  ])(
    "MUTANTE R1-1 [vista=$vista]: durante un refetch con data ya presente, el contenedor de resultados sigue montado (mismo nodo) y marcado aria-busy",
    async ({ vista, qs }) => {
      fakeNav.reset(qs);
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      const deferred = crearDeferred();
      stubFetch(esperarSoloEnRefetch(deferred));
      renderConSesion();

      // Lista: cada fila es un <tr> dentro de un <table> — el link SOLO
      // trae el SKU como texto accesible. Grid: la card COMPLETA es el
      // <Link> (envuelve imagen/descripción/estatus también), así que su
      // nombre accesible es más largo — de ahí el regex en vez del string
      // exacto. El contenedor a vigilar también difiere: el `<table>`
      // mismo en Lista; el `<div>` que envuelve TODAS las cards en Grid
      // (ver `catalogo-grid.tsx`) — se busca con `closest` y no como padre
      // directo desde [INV-B8.2], cuando la tarjeta ganó un envoltorio para
      // sacar el botón de Selección fuera del ancla.
      const nombreLink = vista === "lista" ? "A-1" : /A-1/;
      await waitFor(() => expect(screen.getByRole("link", { name: nombreLink })).toBeInTheDocument());
      const contenedorAntes =
        vista === "lista"
          ? screen.getByRole("table")
          : (screen.getByRole("link", { name: nombreLink }).closest("[aria-busy]") as HTMLElement);
      expect(contenedorAntes).toHaveAttribute("aria-busy", "false");

      // Dispara un refetch (búsqueda) que queda EN VUELO, colgado en `deferred`.
      fireEvent.change(screen.getByLabelText("Buscar en el catálogo"), { target: { value: "candado" } });
      fireEvent.submit(screen.getByLabelText("Buscar en el catálogo").closest("form") as HTMLFormElement);
      await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?q=candado"));

      // Con el gate viejo (o con `ariaBusy` desconectado de esta vista),
      // `contenedorAntes` queda huérfano/congelado en "false": este
      // `waitFor` nunca cierra y el test se pone rojo por timeout.
      await waitFor(() => expect(contenedorAntes).toHaveAttribute("aria-busy", "true"));
      // Chrome persistente: los filtros/árbol siguen montados y respondiendo, no solo el contenedor de resultados.
      expect(screen.getByRole("link", { name: nombreLink })).toBeInTheDocument();
      expect(screen.getByLabelText("Marca")).toBeInTheDocument();

      deferred.resolver();

      await waitFor(() => expect(contenedorAntes).toHaveAttribute("aria-busy", "false"));
    },
  );

  // ------------------------------------------------------------
  // INV-TAXO F2/F3 · A1: el árbol de 3 niveles (tecnología → marca →
  // familia) se alimenta de `data.facetas` — la MISMA respuesta de
  // /api/inventory que ya trae la tabla — NO de un fetch de catálogo
  // completo. Cada nivel navega en cascada: elegirlo resetea los niveles
  // inferiores.
  // ------------------------------------------------------------
  describe("A1: árbol de 3 niveles alimentado por data.facetas", () => {
    it("el árbol muestra tecnología/marca/familia de data.facetas, coherente con el fetch principal (sin fetch decoupled)", async () => {
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "RFID", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [{ valor: "CANDADOS", conteo: 5 }],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "RFID 5" })).toBeInTheDocument());
      expect(screen.getByRole("button", { name: "BRAND1 5" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "CANDADOS 5" })).toBeInTheDocument();
    });

    it("clic en una tecnología navega a ?tecnologia=X reseteando marca y familia previas", async () => {
      fakeNav.reset("marca=OLD&familia=OLDFAM");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "RFID", conteo: 5 }],
            marcas: [],
            familias: [],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "RFID 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "RFID 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=RFID");
    });

    it("clic en una marca navega a ?marca=Y preservando la tecnología y reseteando la familia previa", async () => {
      fakeNav.reset("tecnologia=RFID&familia=OLDFAM");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "RFID", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "BRAND1 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "BRAND1 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=RFID&marca=BRAND1");
    });

    it("clic en una familia navega a ?familia=Z preservando tecnología + marca", async () => {
      fakeNav.reset("tecnologia=RFID&marca=BRAND1");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "RFID", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [{ valor: "CANDADOS", conteo: 5 }],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "CANDADOS 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "CANDADOS 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=RFID&marca=BRAND1&familia=CANDADOS");
    });

    // (CAT-B1 · Tramo C) `producto` es el ÚLTIMO nivel — gemelo de familia,
    // mismo camino URL→cascada→consulta, sin nivel inferior que resetear.
    it("clic en un producto navega a ?producto=W preservando tecnología + marca + familia", async () => {
      fakeNav.reset("tecnologia=BRAND1&marca=BRAND1&familia=CANDADOS");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "BRAND1", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [{ valor: "CANDADOS", conteo: 5 }],
            productos: [{ valor: "PM3", conteo: 5 }],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "PM3 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "PM3 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=BRAND1&marca=BRAND1&familia=CANDADOS&producto=PM3");
    });

    it("elegir una familia distinta limpia un producto previamente activo (cascada: familia resetea el nivel inferior)", async () => {
      fakeNav.reset("tecnologia=BRAND1&marca=BRAND1&familia=OLDFAM&producto=PM3");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "BRAND1", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [{ valor: "CANDADOS", conteo: 5 }],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "CANDADOS 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "CANDADOS 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=BRAND1&marca=BRAND1&familia=CANDADOS");
    });

    it("clic en 'Sin familia asignada' navega con ?badge=sin_familia y limpia una familia previa", async () => {
      fakeNav.reset("tecnologia=RFID&marca=BRAND1&familia=OLDFAM");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [{ valor: "RFID", conteo: 5 }],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [],
            productos: [],
            almacenes: [],
            sin_familia: 2,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "Sin familia asignada 2" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Sin familia asignada 2" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=RFID&marca=BRAND1&badge=sin_familia");
    });

    it("elegir una familia real limpia un badge=sin_familia previamente activo (mutuamente excluyentes)", async () => {
      fakeNav.reset("badge=sin_familia");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [],
            marcas: [],
            familias: [{ valor: "CANDADOS", conteo: 5 }],
            productos: [],
            almacenes: [],
            sin_familia: 2,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "CANDADOS 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "CANDADOS 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?familia=CANDADOS");
    });

    it("clic en una marca preserva un badge distinto de 'sin_familia' (p.ej. drill-down sobre_reservado del dashboard)", async () => {
      fakeNav.reset("badge=sobre_reservado");
      mainResponder = okResponder(
        pageResponse([item({ sku: "A-1" })], {
          total: 1,
          facetas: {
            tecnologias: [],
            marcas: [{ valor: "BRAND1", conteo: 5 }],
            familias: [],
            productos: [],
            almacenes: [],
            sin_familia: 0,
            sin_tecnologia: 0,
          },
        }),
      );
      renderConSesion();

      await waitFor(() => expect(screen.getByRole("button", { name: "BRAND1 5" })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "BRAND1 5" }));

      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?badge=sobre_reservado&marca=BRAND1");
    });
  });

  // ------------------------------------------------------------
  // A4: chips de filtro activo por las 4 dimensiones (tecnología, marca,
  // familia, almacén) — mismo `ChipFiltroActivo` compartido que badge/sinV2.
  // ------------------------------------------------------------
  describe("A4: chips de filtro activo (tecnología, marca, familia, almacén)", () => {
    it("?tecnologia=RFID pinta 'Tecnología: RFID'; su × limpia solo ese filtro", async () => {
      // Orden de reenvío hacia /api/inventory = orden fijo de `CAMPOS_QUERY`
      // (marca antes que tecnología), NO el orden literal de la URL propia.
      fakeNav.reset("tecnologia=RFID&marca=BRAND1");
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().at(-1)).toBe("/api/inventory?marca=BRAND1&tecnologia=RFID"));
      expect(screen.getByRole("button", { name: "Tecnología: RFID" })).toBeInTheDocument();

      // Decisión de diseño (cascada consistente en AMBAS entradas — árbol Y
      // chip/select): quitar la tecnología resetea marca/familia también,
      // igual que elegir OTRA tecnología (`handleTecnologia`, único handler
      // compartido) — evita que un usuario quede con una marca que quizás
      // no exista fuera de la tecnología que acaba de abandonar.
      fireEvent.click(screen.getByRole("button", { name: "Tecnología: RFID" }));
      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
    });

    it("?tecnologia=__sin_tecnologia__ pinta 'Sin tecnología' (nunca el sentinel crudo)", async () => {
      fakeNav.reset(`tecnologia=${SIN_TECNOLOGIA}`);
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
      expect(screen.getByRole("button", { name: "Sin tecnología" })).toBeInTheDocument();
      expect(screen.queryByText(SIN_TECNOLOGIA)).not.toBeInTheDocument();
    });

    it("?marca=BRAND1 pinta 'Marca: BRAND1'; su × limpia solo ese filtro", async () => {
      fakeNav.reset("marca=BRAND1&almacen=NORTH");
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: "Marca: BRAND1" }));
      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?almacen=NORTH");
    });

    it("?familia=CANDADOS pinta 'Familia: CANDADOS'; su × limpia solo ese filtro", async () => {
      fakeNav.reset("familia=CANDADOS");
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: "Familia: CANDADOS" }));
      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
    });

    // (CAT-B1 · Tramo C) Gemelo del chip de familia.
    it("?producto=PM3 pinta 'Producto: PM3'; su × limpia solo ese filtro", async () => {
      fakeNav.reset("tecnologia=BRAND1&producto=PM3");
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
      expect(screen.getByRole("button", { name: "Producto: PM3" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Producto: PM3" }));
      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo?tecnologia=BRAND1");
    });

    it("?almacen=NORTH pinta 'Almacén: NORTH'; su × limpia solo ese filtro", async () => {
      fakeNav.reset("almacen=NORTH");
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();

      await waitFor(() => expect(mainCalls().length).toBeGreaterThan(0));
      fireEvent.click(screen.getByRole("button", { name: "Almacén: NORTH" }));
      expect(fakeNav.replaceCalls.at(-1)).toBe("/catalogo");
    });

    it("sin ninguna de las 4 dimensiones activa: ninguno de sus chips aparece", async () => {
      mainResponder = okResponder(pageResponse([item({ sku: "A-1" })], { total: 1 }));
      renderConSesion();
      await waitFor(() => expect(screen.getByText("1 resultados")).toBeInTheDocument());
      expect(screen.queryByRole("button", { name: /^Tecnología:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Marca:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Familia:/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Almacén:/ })).not.toBeInTheDocument();
    });
  });
});
