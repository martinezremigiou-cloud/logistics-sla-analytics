import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/catalogo",
}));

vi.mock("@/lib/auth/actions", () => ({
  cerrarSesion: vi.fn(),
}));

describe("Sidebar", () => {
  it("pinta el email y el rol (KAM) de la sesión, y el botón Cerrar sesión", () => {
    render(<Sidebar sesion={{ email: "kam@example.com", rol: "kam" }} />);

    expect(screen.getByText("kam@example.com")).toBeInTheDocument();
    expect(screen.getByText("KAM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("pinta 'Admin' cuando sesion.rol es admin", () => {
    render(<Sidebar sesion={{ email: "admin@example.com", rol: "admin" }} />);

    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.queryByText("KAM")).not.toBeInTheDocument();
  });

  it("con rol kam NO aparece 'Carga de imágenes'", () => {
    render(<Sidebar sesion={{ email: "kam@example.com", rol: "kam" }} />);

    expect(screen.queryByText("Carga de imágenes")).not.toBeInTheDocument();
  });

  it("con rol admin SÍ aparece 'Carga de imágenes'", () => {
    render(<Sidebar sesion={{ email: "admin@example.com", rol: "admin" }} />);

    expect(screen.getByText("Carga de imágenes")).toBeInTheDocument();
  });

  it("el resto de la navegación (no adminOnly) se muestra para ambos roles", () => {
    render(<Sidebar sesion={{ email: "kam@example.com", rol: "kam" }} />);

    expect(screen.getByText("Catálogo")).toBeInTheDocument();
    expect(screen.getByText("Configuración")).toBeInTheDocument();
  });

  // Bloque 7-B · O16 — ancla el conteo real usado en el GATE de presupuesto
  // vertical (ver sidebar-presupuesto.test.tsx): admin ve los 8 NAV_ITEMS
  // completos, kam ve 7 (se oculta "Carga de imágenes"), visitante ve 6
  // (se oculta también "Proyectos", INV-B8).
  it("rol admin ve exactamente 8 ítems reales en el <nav>", () => {
    render(<Sidebar sesion={{ email: "admin@example.com", rol: "admin" }} />);

    expect(screen.getAllByRole("link")).toHaveLength(8);
  });

  it("rol kam ve exactamente 7 ítems reales en el <nav>", () => {
    render(<Sidebar sesion={{ email: "kam@example.com", rol: "kam" }} />);

    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  // [INV-B8] Segundo eje de permiso (`rolesPermitidos`, `src/lib/nav.ts`):
  // "Proyectos" es visible para admin y kam, oculto para visitante.
  it("rol admin SÍ aparece 'Proyectos'", () => {
    render(<Sidebar sesion={{ email: "admin@example.com", rol: "admin" }} />);

    expect(screen.getByText("Proyectos")).toBeInTheDocument();
  });

  it("rol kam SÍ aparece 'Proyectos'", () => {
    render(<Sidebar sesion={{ email: "kam@example.com", rol: "kam" }} />);

    expect(screen.getByText("Proyectos")).toBeInTheDocument();
  });

  it("rol visitante NO aparece 'Proyectos' (ni 'Carga de imágenes'), y ve exactamente 6 ítems", () => {
    render(<Sidebar sesion={{ email: "visitante@example.com", rol: "visitante" }} />);

    expect(screen.queryByText("Proyectos")).not.toBeInTheDocument();
    expect(screen.queryByText("Carga de imágenes")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(6);
  });
});
