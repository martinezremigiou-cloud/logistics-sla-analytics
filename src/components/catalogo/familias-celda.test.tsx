import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FamiliasCelda } from "./familias-celda";

describe("FamiliasCelda", () => {
  it("familias=[] (sin_familia): chip neutro 'Sin familia', sin botón expandible", () => {
    render(<FamiliasCelda familias={[]} />);
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("una sola familia: la muestra tal cual, sin contador '+N' ni botón expandible", () => {
    render(<FamiliasCelda familias={["CANDADOS"]} />);
    expect(screen.getByText("CANDADOS")).toBeInTheDocument();
    expect(screen.queryByText(/\+/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("N>1 familias: colapsado muestra 'primera +resto' y NO muestra las demás", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0", "CLIP ROTATIVO"]} />);
    expect(screen.getByText("SERIES 12 +2")).toBeInTheDocument();
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();
    expect(screen.queryByText("CLIP ROTATIVO")).not.toBeInTheDocument();
  });

  it("el trigger es un <button> real con aria-expanded=false por defecto", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("hover (mouseEnter en el contenedor) revela TODAS las familias; mouseLeave las oculta", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0", "CLIP ROTATIVO"]} />);
    const contenedor = screen.getByRole("button").parentElement as HTMLElement;

    fireEvent.mouseEnter(contenedor);
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();

    fireEvent.mouseLeave(contenedor);
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();
  });

  it("foco de teclado (Tab al botón) revela todas las familias; perder el foco las oculta", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    const btn = screen.getByRole("button");

    fireEvent.focus(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();

    fireEvent.blur(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();
  });

  it("click/tap alterna un estado 'fijado' que persiste aunque no haya hover (soporta touch, sin evento hover)", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("CLIP 3.0")).not.toBeInTheDocument();
  });

  it("Escape colapsa el panel aunque estuviera fijado por click", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    const btn = screen.getByRole("button");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(btn, { key: "Escape" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("el click del trigger detiene la propagación (no navega si está anidado en un <a>)", () => {
    const onClickAncestro = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
      <div onClick={onClickAncestro}>
        <FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClickAncestro).not.toHaveBeenCalled();
  });

  it("aria-label del trigger describe cuántas familias más hay (singular/plural)", () => {
    const { rerender } = render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    expect(screen.getByRole("button", { name: "SERIES 12 y 1 familia más" })).toBeInTheDocument();

    rerender(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0", "CLIP ROTATIVO"]} />);
    expect(screen.getByRole("button", { name: "SERIES 12 y 2 familias más" })).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // R1-4: hover y foco viven en estados separados — perder el foco
  // (`blur`) ya NO colapsa el panel si el mouse sigue encima del
  // contenedor. Antes ambos escribían el MISMO booleano, así que un
  // `blur` posterior a un `mouseEnter` pisaba el hover activo.
  // ------------------------------------------------------------
  it("R1-4: perder el foco (blur) del trigger NO colapsa el panel si el mouse sigue encima (hover y foco ya no comparten estado)", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    const btn = screen.getByRole("button");
    const contenedor = btn.parentElement as HTMLElement;

    // El mouse entra al contenedor (hover) Y el trigger recibe foco (p.ej. un click real dispara ambos).
    fireEvent.mouseEnter(contenedor);
    fireEvent.focus(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");

    // Se pierde el foco (blur) pero el mouse NUNCA salió del contenedor.
    fireEvent.blur(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();

    // Ahora sí sale el mouse: recién ahí colapsa.
    fireEvent.mouseLeave(contenedor);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("R1-4: el panel expandido se centra bajo el trigger (left-1/2 -translate-x-1/2), no se ancla a left-0 (evita el recorte en la última columna de la tabla)", () => {
    render(<FamiliasCelda familias={["SERIES 12", "CLIP 3.0"]} />);
    fireEvent.click(screen.getByRole("button"));

    const panel = screen.getByText("CLIP 3.0").closest("div.absolute") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.className).toContain("left-1/2");
    expect(panel.className).toContain("-translate-x-1/2");
    expect(panel.className).not.toContain("left-0");
  });
});
