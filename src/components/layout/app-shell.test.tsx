import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AppShell } from "./app-shell";
import { SIDEBAR_COLAPSADO_CSS_VAR_ANCHO } from "@/components/layout/sidebar-colapso";

// Se aísla el test al contrato de AppShell (¿monta AvisoVersionNueva? ¿en
// dev se calla?) — Sidebar/Topbar/BottomNav ya tienen su propia cobertura
// (sidebar.test.tsx, topbar.test.tsx) y no hace falta re-probarlos aquí.
// El mock SÍ incluye un enlace real (href, focusable en cualquier
// navegador) — lo usa la suite de `inert` de más abajo (ronda 2, punto E)
// para comprobar que queda dentro del contenedor marcado `inert` cuando
// el sidebar está colapsado.
vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => (
    <div data-testid="sidebar-stub">
      <a href="/catalogo" data-testid="sidebar-mock-link">
        Catálogo
      </a>
    </div>
  ),
}));
vi.mock("@/components/layout/topbar", () => ({
  Topbar: () => <div data-testid="topbar-stub" />,
}));
vi.mock("@/components/layout/bottom-nav", () => ({
  BottomNav: () => <div data-testid="bottom-nav-stub" />,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function marcarVisible() {
  const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  document.dispatchEvent(new Event("visibilitychange"));
  return spy;
}

const ENV_KEY = "NEXT_PUBLIC_DEPLOY_ID";
let respaldoEnv: string | undefined;

describe("AppShell — monta AvisoVersionNueva (encargo final, Bloque 7-B)", () => {
  beforeEach(() => {
    respaldoEnv = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (respaldoEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = respaldoEnv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renderiza el shell con el aviso montado, sin romper el árbol ni el contenido", () => {
    render(
      <AppShell sesion={{ email: "kam@example.com", rol: "kam" }}>
        <p>Contenido de la página</p>
      </AppShell>,
    );

    expect(screen.getByTestId("sidebar-stub")).toBeInTheDocument();
    expect(screen.getByTestId("topbar-stub")).toBeInTheDocument();
    expect(screen.getByTestId("bottom-nav-stub")).toBeInTheDocument();
    expect(screen.getByText("Contenido de la página")).toBeInTheDocument();
    // AvisoVersionNueva devuelve null por default: no reserva hueco, no hay ningún <div role="status">.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("en dev ('dev' === 'dev'): ni siquiera con la pestaña pasando a visible pinta el banner de versión nueva", async () => {
    delete process.env[ENV_KEY]; // el lado horneado cae a 'dev', igual que /api/version en dev
    const fetchSpy = vi.fn(async () => jsonResponse({ deploymentId: "dev", skewProtection: false }));
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <AppShell sesion={{ email: "kam@example.com", rol: "kam" }}>
        <p>Contenido</p>
      </AppShell>,
    );

    marcarVisible();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("AppShell — sidebar colapsado queda `inert` (ronda 2, punto E)", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO);
  });

  it("expandido (default): el <aside> NO es inert — el sidebar sigue siendo parte normal del árbol de foco", () => {
    const { container } = render(
      <AppShell sesion={{ email: "kam@example.com", rol: "kam" }}>
        <p>Contenido</p>
      </AppShell>,
    );

    expect(container.querySelector("aside")).not.toHaveAttribute("inert");
  });

  it("colapsado (ya lo tenía así el script bloqueante/localStorage al montar): el <aside> completo queda `inert` — ningún enlace del sidebar queda alcanzable por teclado", async () => {
    // Misma señal que lee `leerColapsadoSidebar()` (sidebar-colapso.ts): el
    // script bloqueante de layout.tsx ya deja el ancho en "0px" ANTES de
    // que AppShell monte, cuando el usuario había colapsado el sidebar en
    // una sesión previa.
    document.documentElement.style.setProperty(SIDEBAR_COLAPSADO_CSS_VAR_ANCHO, "0px");

    const { container } = render(
      <AppShell sesion={{ email: "kam@example.com", rol: "kam" }}>
        <p>Contenido</p>
      </AppShell>,
    );

    await waitFor(() => expect(container.querySelector("aside")).toHaveAttribute("inert"));

    // jsdom no implementa el algoritmo de "focusable area" del spec de
    // HTML (no hay layout ni cómputo real de estilos/inert) — no puede
    // reproducir aquí que `.focus()` en el <Link> falle; eso solo lo
    // garantiza un navegador real. Lo que SÍ es verificable y suficiente:
    // el enlace del sidebar (mockeado con `href` real — focusable en
    // cualquier navegador) vive DENTRO del contenedor que quedó marcado
    // `inert`. El spec de HTML garantiza que TODO el subárbol de un nodo
    // `inert` queda fuera del orden de tabulación y del árbol de
    // accesibilidad — basta con que el atributo esté en el ancestro común
    // de todo el contenido del sidebar, que es justo lo que se prueba aquí.
    expect(container.querySelector("aside")).toContainElement(screen.getByTestId("sidebar-mock-link"));
  });
});
