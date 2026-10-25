import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionProvider } from "@/components/providers/session-provider";
import { ProyectosView } from "./proyectos-view";
import type { ProyectoResumen } from "@/types/proyectos";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function renderConRol(rol: "kam" | "admin" | "visitante") {
  return render(
    <SessionProvider sesion={{ id: "u1", email: "kam@example.com", rol }}>
      <ProyectosView />
    </SessionProvider>,
  );
}

function proyecto(overrides: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: "Despliegue de Series2.",
    notas: null,
    fecha: "2026-04-30",
    tipo: "Rollout",
    intencion: "Cotización",
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: 3,
    piezas: 400,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  pushMock.mockClear();
});

/**
 * [2.0.1-B · S-1] FIJA LA RAMA, y hacía falta decirlo.
 *
 * El stub de `matchMedia` de `vitest.setup.ts` devuelve `matches: false` para
 * TODA consulta, así que hasta S-1 **las pruebas de esta vista solo habían
 * renderizado la rama angosta** — la lista vertical— sin que nada lo dijera. La
 * pasarela se probaba aparte, montando el componente a mano, y por eso la
 * decisión de rama en sí (`esAncho ? pasarela : lista`) no tenía testigo.
 *
 * No es un detalle: es P17 en su forma de siempre. El universo con el que uno se
 * evalúa puede no contener el caso que importa, y entonces «todo verde» no dice
 * lo que parece.
 */
function conAncho(ancho: boolean) {
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: ancho,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("ProyectosView", () => {
  it("visitante: SinPermiso, sin pedir /api/proyectos", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderConRol("visitante");
    expect(screen.getByText("Sin permiso")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("kam: encabezado + lista de proyectos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [proyecto()] }), { status: 200 })));
    renderConRol("kam");
    expect(screen.getByRole("heading", { name: "Proyectos" })).toBeInTheDocument();
    expect(screen.getByText("Arma proyectos desde tu historial · cada KAM ve y edita los suyos")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Rollout Retailer9 Series2 Q2")).toBeInTheDocument());
  });

  // ============================================================
  // [2.0.1-B · S-1] EL ZOOM Y LA CADENA DE LA VIGENCIA.
  //
  // Las dos cosas que ninguna prueba de componente por separado puede ver:
  // que el zoom EXISTA junto al carril, y que el dato del sobre LLEGUE hasta
  // abajo. Cada eslabón —la ruta que lo resuelve, el tipo que lo declara, la
  // tarjeta que lo pinta— está verde por su cuenta aunque la cadena esté
  // cortada. Es P24: la media función se ve igual que la completa.
  // ============================================================
  it("de 768 para arriba, el zoom acompaña al carril — van juntos o no van", async () => {
    conAncho(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [proyecto()] }), { status: 200 })));
    renderConRol("kam");
    // El carril y su vista ampliada, los dos. La pasarela sola dejó ~590 px de
    // vacío bajo el carril: es una regresión visible sin el zoom.
    await waitFor(() => expect(screen.getByRole("list", { name: "Proyectos" })).toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Vista ampliada de PRJ-001" })).toBeInTheDocument();
  });

  it("la vigencia del SOBRE llega a la tarjeta y al zoom — y sin ella nadie inventa la fecha", async () => {
    conAncho(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ items: [proyecto()], vigencia: { snapshot_id: "snap-9", tomado_en: "2026-08-20T17:02:00.000Z" } }),
            { status: 200 },
          ),
      ),
    );
    const { unmount } = renderConRol("kam");
    // Dos apariciones: la línea de la tarjeta y el dato del zoom.
    await waitFor(() => expect(screen.getByText(/inventario del/)).toBeInTheDocument());
    expect(screen.getByText(/es la fecha que imprimirá el documento/)).toBeInTheDocument();
    unmount();

    // La otra mitad: un sobre SIN vigencia —el de un servidor viejo, o el de una
    // base sin snapshots— no puede producir una fecha de la nada.
    conAncho(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [proyecto()] }), { status: 200 })));
    renderConRol("kam");
    // Se espera al zoom y no al título: en la rama ancha el título sale DOS
    // veces —tarjeta y vista ampliada— y `getByText` es de una sola.
    await waitFor(() => expect(screen.getByRole("region", { name: "Vista ampliada de PRJ-001" })).toBeInTheDocument());
    expect(screen.queryByText(/inventario del/)).not.toBeInTheDocument();
    expect(screen.queryByText(/es la fecha que imprimirá el documento/)).not.toBeInTheDocument();
  });

  it("zero-state: sin proyectos", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
    renderConRol("kam");
    await waitFor(() => expect(screen.getByText("Aún no tienes proyectos.")).toBeInTheDocument());
  });

  it("error de red: EstadoError con reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "internal_error", message: "Fallo interno" }), { status: 500 })));
    renderConRol("kam");
    await waitFor(() => expect(screen.getByText("Fallo interno")).toBeInTheDocument());
  });

  it("crear un proyecto navega a /proyectos/{id} del recién creado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/proyectos" && init?.method === "POST") {
          return new Response(JSON.stringify(proyecto({ id: "nuevo-id" })), { status: 201 });
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }),
    );
    renderConRol("kam");
    await waitFor(() => expect(screen.getByText("Aún no tienes proyectos.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Nuevo proyecto" }));
    fireEvent.change(screen.getByLabelText("Título"), { target: { value: "Rollout Retailer 42" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear proyecto" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/proyectos/nuevo-id"));
  });
});
