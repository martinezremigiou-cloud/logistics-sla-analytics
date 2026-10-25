import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionProvider } from "@/components/providers/session-provider";
import { ConfigView } from "./config-view";

// ------------------------------------------------------------
// Fake router/URL compartido por next/navigation (mismo patrón que
// `catalogo-view.test.tsx`/`cruce-view.test.tsx`): reactivo vía
// useSyncExternalStore para que `router.replace(...)` re-renderice el
// componente con la nueva URL. Necesario desde que `ConfigView` lee
// `?tab=` (Bloque 6, F4).
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
  }),
  useSearchParams: () => {
    const snapshot = React.useSyncExternalStore(fakeNav.subscribe, fakeNav.getSearch, fakeNav.getSearch);
    return new URLSearchParams(snapshot);
  },
}));

function renderConRol(rol: "kam" | "admin", urlInicial = "") {
  fakeNav.reset(urlInicial);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // [VERT-B2] El gobierno de marcas tiene su propia forma. Antes este arnés
      // servía `{items: []}` a TODA url, y con eso el panel reventaba y se
      // llevaba la pestaña — así se encontró que le faltaba la guarda de forma.
      if (url.startsWith("/api/marcas")) {
        return new Response(JSON.stringify({ excluidas: [], sinDecidir: [], total: 21 }), { status: 200 });
      }
      if (url.startsWith("/api/pendientes")) {
        return new Response(
          JSON.stringify({ pendientes: [], derivados: { descuadres: [] }, conteos: { abiertos: 0, por_tipo: {} } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }),
  );
  return render(
    <SessionProvider sesion={{ id: "u1", email: "user@example.com", rol }}>
      <ConfigView />
    </SessionProvider>,
  );
}

describe("ConfigView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ------------------------------------------------------------
  // [INV-B11] O6-adenda · EL KAM AHORA SÍ VE PESTAÑAS, y por qué eso no
  // debilita nada.
  //
  // Estas dos pruebas comprobaban `queryByRole("tablist")` → ausente. Eso era
  // el PROXY, no el invariante: lo que había que proteger es **que nada de
  // admin aparezca en el DOM del KAM**. Al darle la pestaña «Ayuda» —que es
  // suya, y donde viven los contactos de escalada que él necesita— el proxy
  // deja de valer y el invariante sigue igual de vivo.
  //
  // Así que se comprueba el invariante DIRECTO, y con los tres nombres de
  // admin en vez de dos: es estrictamente más fuerte que lo que había.
  // ------------------------------------------------------------
  const ADMIN_EN_EL_DOM = [
    "Usuarios y roles",
    "Familias",
    "Pendientes",
    // [VERT-B2] El gobierno de marcas es admin-only: ni su rótulo ni su
    // contenido pueden estar montados en el DOM de un KAM.
    "Marcas",
    "Marcas excluidas del catálogo",
    // Y no solo los rótulos: el CONTENIDO tampoco puede estar montado y oculto.
    "Pendientes de datos",
  ];

  it("kam: ve Preferencias y Ayuda, y NADA de admin en el DOM", () => {
    renderConRol("kam");
    expect(screen.getByRole("tab", { name: "Preferencias" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ayuda" })).toBeInTheDocument();
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
    for (const texto of ADMIN_EN_EL_DOM) {
      expect(screen.queryByText(texto), `«${texto}» se coló en el DOM de un KAM`).not.toBeInTheDocument();
    }
    // Control positivo del barrido: si `queryByText` estuviera roto y devolviera
    // `null` siempre, el bucle de arriba pasaría con la pantalla llena de admin.
    expect(screen.queryByText("Preferencias")).toBeInTheDocument();
  });

  it("kam: la pestaña Ayuda le da los cuatro contactos de escalada", () => {
    renderConRol("kam");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Ayuda" }));
    for (const nombre of ["Hugo Lara", "Tomas Ruiz", "Paula Soto", "Raquel Vega"]) {
      expect(screen.getByText(nombre), `falta ${nombre} en Ayuda`).toBeInTheDocument();
    }
  });

  // [VERT-B2] El título de esta prueba decía «las CINCO pestañas» y NO CONTABA
  // ninguna: enumeraba cinco nombres y exigía que cada uno estuviera. Así que
  // al entrar la sexta siguió en verde con su nombre ya mintiendo — una cifra
  // afirmada que nada medía. Ahora la lista es la fuente y el conteo se compara
  // contra ella: el número no puede divergir del título porque no hay número en
  // el título.
  const TABS_ADMIN = ["Preferencias", "Usuarios y roles", "Familias", "Marcas", "Pendientes", "Ayuda"];

  it("admin: ve TODAS sus pestañas y NINGUNA otra", () => {
    renderConRol("admin");
    for (const nombre of TABS_ADMIN) {
      expect(screen.getByRole("tab", { name: nombre })).toBeInTheDocument();
    }
    expect(
      screen.getAllByRole("tab").map((t) => t.textContent),
      "apareció o desapareció una pestaña sin actualizar esta lista",
    ).toEqual(TABS_ADMIN);
  });

  it("admin: ve las 3 tabs (Preferencias, Usuarios y roles, Familias)", () => {
    renderConRol("admin");
    expect(screen.getByRole("tab", { name: "Preferencias" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Usuarios y roles" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Familias" })).toBeInTheDocument();
  });

  it("admin: la tab Preferencias está activa por defecto", () => {
    renderConRol("admin");
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // Bloque 6 · F4: 4ª tab "Pendientes" (admin-only) + soporte de `?tab=`.
  // ------------------------------------------------------------
  it("admin: ve también la pestaña 'Pendientes'", () => {
    renderConRol("admin");
    expect(screen.getByRole("tab", { name: "Pendientes" })).toBeInTheDocument();
  });

  it("kam: '?tab=pendientes' no tiene efecto — cae a Preferencias y la bandeja no se monta", () => {
    renderConRol("kam", "tab=pendientes");
    expect(screen.getByRole("tab", { name: "Preferencias" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
    expect(screen.queryByText("Pendientes de datos")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Pendientes" })).not.toBeInTheDocument();
  });

  it("admin: '?tab=pendientes' activa esa pestaña directamente (aterriza en la bandeja)", async () => {
    renderConRol("admin", "tab=pendientes");
    expect(screen.getByRole("tab", { name: "Pendientes" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Pendientes de datos")).toBeInTheDocument();
  });

  // [VERT-B2] ALCANZABILIDAD del gobierno de marcas: se monta la COMPOSICIÓN
  // REAL de la pantalla, no `ConfigMarcas` suelto con props. La alarma de marca
  // nueva sólo sirve si alguien puede llegar a ella desde el estado por omisión
  // — una alarma inalcanzable es la misma alarma que no existe.
  it("admin: '?tab=marcas' aterriza en el gobierno de la regla", async () => {
    renderConRol("admin", "tab=marcas");
    expect(screen.getByRole("tab", { name: "Marcas" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByText("Marcas excluidas del catálogo")).toBeInTheDocument();
  });

  it("kam: '?tab=marcas' no tiene efecto — cae a Preferencias y el panel no se monta", () => {
    renderConRol("kam", "tab=marcas");
    expect(screen.getByRole("tab", { name: "Preferencias" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("Marcas excluidas del catálogo")).not.toBeInTheDocument();
  });

  it("admin: '?tab=xyz' inválido cae a Preferencias (retro-compatible, igual que sin param)", () => {
    renderConRol("admin", "tab=xyz");
    expect(screen.getByRole("tab", { name: "Preferencias" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Apariencia")).toBeInTheDocument();
  });

  it("admin: cambiar de pestaña actualiza la URL vía router.replace", () => {
    renderConRol("admin");
    // Radix TabsTrigger activa por `onMouseDown` (roving focus group), no por "click".
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Usuarios y roles" }));
    expect(fakeNav.replaceCalls.at(-1)).toBe("/config?tab=usuarios");
  });
});
