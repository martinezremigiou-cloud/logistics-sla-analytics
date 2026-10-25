import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Topbar } from "./topbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/layout/freshness-indicator", () => ({
  FreshnessIndicator: () => null,
}));

vi.mock("@/components/layout/theme-toggle", () => ({
  ThemeToggle: () => null,
}));

describe("Topbar — control de ocultar/mostrar el sidebar (Bloque 7-B · O16)", () => {
  it("con colapsado=false: botón dice 'Ocultar barra lateral' y aria-expanded=true", () => {
    render(<Topbar onMenuClick={vi.fn()} colapsado={false} onToggleColapsado={vi.fn()} />);

    const boton = screen.getByRole("button", { name: "Ocultar barra lateral" });
    expect(boton).toHaveAttribute("aria-expanded", "true");
  });

  it("con colapsado=true: botón dice 'Mostrar barra lateral' y aria-expanded=false", () => {
    render(<Topbar onMenuClick={vi.fn()} colapsado={true} onToggleColapsado={vi.fn()} />);

    const boton = screen.getByRole("button", { name: "Mostrar barra lateral" });
    expect(boton).toHaveAttribute("aria-expanded", "false");
  });

  it("clic en el botón llama a onToggleColapsado", () => {
    const onToggleColapsado = vi.fn();
    render(<Topbar onMenuClick={vi.fn()} colapsado={false} onToggleColapsado={onToggleColapsado} />);

    fireEvent.click(screen.getByRole("button", { name: "Ocultar barra lateral" }));

    expect(onToggleColapsado).toHaveBeenCalledTimes(1);
  });

  it("el botón de colapso solo vive en desktop (hidden md:flex) — el móvil ya tiene su <Sheet> vía 'Abrir menú'", () => {
    render(<Topbar onMenuClick={vi.fn()} colapsado={false} onToggleColapsado={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Ocultar barra lateral" })).toHaveClass("hidden", "md:flex");
    expect(screen.getByRole("button", { name: "Abrir menú" })).toHaveClass("md:hidden");
  });
});
