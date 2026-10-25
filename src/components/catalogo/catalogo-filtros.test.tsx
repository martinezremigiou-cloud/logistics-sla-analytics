import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CatalogoFiltros } from "./catalogo-filtros";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { TAXONOMIA_ESTATUS } from "@/lib/estatus";
import type { CatalogoFacetas } from "@/types/api";

/** (R1-2) Facetas de ejemplo con las 4 dimensiones pobladas — misma forma que `CatalogoArbol.test.tsx`. */
function facetas(overrides: Partial<CatalogoFacetas> = {}): CatalogoFacetas {
  return {
    tecnologias: [
      { valor: "AM", conteo: 80 },
      { valor: "RFID", conteo: 120 },
    ],
    marcas: [
      { valor: "EAS", conteo: 30 },
      { valor: "BRAND1", conteo: 45 },
    ],
    familias: [
      { valor: "CANDADOS", conteo: 12 },
      { valor: "SENSORES", conteo: 18 },
    ],
    productos: [],
    almacenes: [
      { valor: "NORTH", conteo: 10 },
      { valor: "SOUTH", conteo: 5 },
      { valor: "EAST", conteo: 3 },
      { valor: "TRAN", conteo: 2 },
      { valor: "BO", conteo: 1 },
      { valor: "WEST", conteo: 0 },
    ],
    sin_familia: 3,
    sin_tecnologia: 8,
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof CatalogoFiltros>> = {}) {
  return {
    facetas: facetas(),
    q: "",
    marca: null,
    familia: null,
    almacen: null,
    tecnologia: null,
    estatus: null,
    onSubmitQ: vi.fn(),
    onChangeMarca: vi.fn(),
    onChangeFamilia: vi.fn(),
    onChangeAlmacen: vi.fn(),
    onChangeTecnologia: vi.fn(),
    onChangeEstatus: vi.fn(),
    onLimpiar: vi.fn(),
    ...overrides,
  };
}

describe("CatalogoFiltros", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sin filtros activos: no muestra 'Limpiar filtros' y los selects están en sus valores por defecto", () => {
    render(<CatalogoFiltros {...baseProps()} />);

    expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Marca")).toHaveValue("");
    expect(screen.getByLabelText("Almacén")).toHaveValue("");
    expect(screen.getByLabelText("Tecnología")).toHaveValue("");
    expect(screen.getByLabelText("Familia")).toHaveValue("");
  });

  // ------------------------------------------------------------
  // R1-2: las 4 dimensiones (Marca, Familia, Almacén, Tecnología) se
  // renderizan SIEMPRE a partir del prop `facetas` — SIN fetch propio
  // (antes: `useApi("/api/familias")` para Familia + `marcasDisponibles`/
  // `tecnologiasDisponibles` calculadas en `catalogo-view.tsx` a partir de
  // `cargarCatalogoCompleto`, dos orígenes más aparte de `data.facetas`).
  // ------------------------------------------------------------
  it("las opciones de Marca vienen de facetas.marcas (sin fetch)", () => {
    render(<CatalogoFiltros {...baseProps()} />);
    expect(within(screen.getByLabelText("Marca")).getByRole("option", { name: "EAS" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Marca")).getByRole("option", { name: "BRAND1" })).toBeInTheDocument();
  });

  it("las opciones de Familia vienen de facetas.familias (sin fetch a /api/familias)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<CatalogoFiltros {...baseProps()} />);

    expect(within(screen.getByLabelText("Familia")).getByRole("option", { name: "CANDADOS" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Familia")).getByRole("option", { name: "SENSORES" })).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("las opciones de Almacén vienen de facetas.almacenes, en el orden recibido (ya no es una lista hardcodeada)", () => {
    render(<CatalogoFiltros {...baseProps()} />);
    const opciones = within(screen.getByLabelText("Almacén"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual(["Almacén: todos", "NORTH", "SOUTH", "EAST", "TRAN", "BO", "WEST"]);
  });

  it("las opciones de Tecnología vienen de facetas.tecnologias + 'Sin tecnología' fija al final", () => {
    render(<CatalogoFiltros {...baseProps()} />);
    const opciones = within(screen.getByLabelText("Tecnología"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual(["Tecnología: todas", "AM", "RFID", "Sin tecnología"]);
  });

  it("facetas=null (antes de la primera carga): los 4 <select> quedan solo con su opción fija, sin romper el render", () => {
    render(<CatalogoFiltros {...baseProps({ facetas: null })} />);
    expect(within(screen.getByLabelText("Marca")).getAllByRole("option")).toHaveLength(1);
    expect(within(screen.getByLabelText("Familia")).getAllByRole("option")).toHaveLength(1);
    expect(within(screen.getByLabelText("Almacén")).getAllByRole("option")).toHaveLength(1);
    // Tecnología siempre trae además la opción fija "Sin tecnología".
    expect(within(screen.getByLabelText("Tecnología")).getAllByRole("option")).toHaveLength(2);
  });

  // ------------------------------------------------------------
  // R1-2 · REGLA ANTI-TRAMPA: el valor actualmente seleccionado nunca debe
  // desaparecer del <select> aunque su conteo caiga a 0 tras la cascada
  // (mismo criterio ya probado para el árbol, `catalogo-arbol.test.tsx`) —
  // si desapareciera, el usuario queda atrapado sin poder volver a "todas".
  // ------------------------------------------------------------
  it("REGLA ANTI-TRAMPA: una familia seleccionada con conteo 0 (p.ej. tras filtrar por marca=BRAND10) sigue listada y seleccionada", () => {
    render(
      <CatalogoFiltros
        {...baseProps({
          familia: "FAMILIA DEMO",
          facetas: facetas({ familias: [{ valor: "FAMILIA DEMO", conteo: 0 }] }),
        })}
      />,
    );
    const select = screen.getByLabelText("Familia");
    expect(within(select).getByRole("option", { name: "FAMILIA DEMO" })).toBeInTheDocument();
    expect(select).toHaveValue("FAMILIA DEMO");
  });

  it("REGLA ANTI-TRAMPA: lo mismo aplica a Marca/Tecnología/Almacén — conteo 0 no las oculta ni las deselecciona", () => {
    render(
      <CatalogoFiltros
        {...baseProps({
          marca: "FANTASMA",
          tecnologia: "RFID",
          almacen: "WEST",
          facetas: facetas({
            marcas: [{ valor: "FANTASMA", conteo: 0 }],
            tecnologias: [{ valor: "RFID", conteo: 0 }],
            almacenes: [{ valor: "WEST", conteo: 0 }],
          }),
        })}
      />,
    );
    expect(screen.getByLabelText("Marca")).toHaveValue("FANTASMA");
    expect(screen.getByLabelText("Tecnología")).toHaveValue("RFID");
    expect(screen.getByLabelText("Almacén")).toHaveValue("WEST");
  });

  it("cambiar el select de marca dispara onChangeMarca con el valor (o null en 'todas')", () => {
    const onChangeMarca = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeMarca, marca: "EAS" })} />);

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "BRAND1" } });
    expect(onChangeMarca).toHaveBeenCalledWith("BRAND1");

    fireEvent.change(screen.getByLabelText("Marca"), { target: { value: "" } });
    expect(onChangeMarca).toHaveBeenCalledWith(null);
  });

  it("cambiar el select de almacén dispara onChangeAlmacen", () => {
    const onChangeAlmacen = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeAlmacen })} />);

    fireEvent.change(screen.getByLabelText("Almacén"), { target: { value: "WEST" } });
    expect(onChangeAlmacen).toHaveBeenCalledWith("WEST");
  });

  it("cambiar el select de familia dispara onChangeFamilia", () => {
    const onChangeFamilia = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeFamilia })} />);

    fireEvent.change(screen.getByLabelText("Familia"), { target: { value: "CANDADOS" } });
    expect(onChangeFamilia).toHaveBeenCalledWith("CANDADOS");
  });

  it("escribir y enviar el formulario de búsqueda dispara onSubmitQ con el texto recortado", () => {
    const onSubmitQ = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onSubmitQ })} />);

    const input = screen.getByLabelText("Buscar en el catálogo");
    fireEvent.change(input, { target: { value: "  candado  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onSubmitQ).toHaveBeenCalledWith("candado");
  });

  it("el input de búsqueda se resincroniza cuando cambia el prop q", () => {
    const { rerender } = render(<CatalogoFiltros {...baseProps({ q: "" })} />);
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("");

    rerender(<CatalogoFiltros {...baseProps({ q: "candado" })} />);
    expect(screen.getByLabelText("Buscar en el catálogo")).toHaveValue("candado");
  });

  it("con algún filtro activo muestra 'Limpiar filtros' y el click dispara onLimpiar", () => {
    const onLimpiar = vi.fn();
    render(<CatalogoFiltros {...baseProps({ marca: "EAS", onLimpiar })} />);

    const boton = screen.getByRole("button", { name: "Limpiar filtros" });
    fireEvent.click(boton);
    expect(onLimpiar).toHaveBeenCalledTimes(1);
  });

  it("select de tecnología: 'Sin tecnología' es una opción fija con el valor reservado SIN_TECNOLOGIA (B-PARCHE F4)", () => {
    render(<CatalogoFiltros {...baseProps()} />);

    const select = screen.getByLabelText("Tecnología");
    const sinTecnologia = within(select).getByRole("option", { name: "Sin tecnología" }) as HTMLOptionElement;
    expect(sinTecnologia.value).toBe(SIN_TECNOLOGIA);
  });

  it("cambiar el select de tecnología dispara onChangeTecnologia con el valor (o null en 'todas')", () => {
    const onChangeTecnologia = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeTecnologia, tecnologia: "AM" })} />);

    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "RFID" } });
    expect(onChangeTecnologia).toHaveBeenCalledWith("RFID");

    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: "" } });
    expect(onChangeTecnologia).toHaveBeenCalledWith(null);
  });

  it("elegir 'Sin tecnología' dispara onChangeTecnologia con el valor reservado SIN_TECNOLOGIA", () => {
    const onChangeTecnologia = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeTecnologia })} />);

    fireEvent.change(screen.getByLabelText("Tecnología"), { target: { value: SIN_TECNOLOGIA } });
    expect(onChangeTecnologia).toHaveBeenCalledWith(SIN_TECNOLOGIA);
  });

  it("con tecnología activa (y ningún otro filtro) muestra 'Limpiar filtros'", () => {
    render(<CatalogoFiltros {...baseProps({ tecnologia: "AM" })} />);
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });

  // ------------------------------------------------------------
  // [2.0.1-A] O1 · select de Estatus. Sus opciones NO vienen de `facetas`:
  // se DERIVAN de TAXONOMIA_ESTATUS (la misma data que la pastilla del
  // renglón) — por eso la expectativa se construye desde la taxonomía y no
  // como lista literal: un estatus nuevo entra al select sin editar nada.
  // ------------------------------------------------------------
  it("las opciones de Estatus se DERIVAN de TAXONOMIA_ESTATUS, en su orden de precedencia", () => {
    render(<CatalogoFiltros {...baseProps()} />);
    const opciones = within(screen.getByLabelText("Estatus"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opciones).toEqual(["Estatus: todos", ...TAXONOMIA_ESTATUS.map((e) => e.label)]);
    // Anclas literales de hoy, para que el lector vea qué significa la derivación:
    expect(within(screen.getByLabelText("Estatus")).getByRole("option", { name: "Sobre-reservado" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("Estatus")).getByRole("option", { name: "Reservado completo" })).toBeInTheDocument();
  });

  it("el value de cada opción de Estatus es la CLAVE (identidad de URL), no el label", () => {
    render(<CatalogoFiltros {...baseProps()} />);
    const sinStock = within(screen.getByLabelText("Estatus")).getByRole("option", { name: "Sin stock" }) as HTMLOptionElement;
    expect(sinStock.value).toBe("sin_stock");
  });

  it("facetas=null: el select de Estatus conserva TODAS sus opciones (no depende del universo, a diferencia de las 4 facetadas)", () => {
    render(<CatalogoFiltros {...baseProps({ facetas: null })} />);
    expect(within(screen.getByLabelText("Estatus")).getAllByRole("option")).toHaveLength(1 + TAXONOMIA_ESTATUS.length);
  });

  it("cambiar el select de Estatus dispara onChangeEstatus con la clave (o null en 'todos')", () => {
    const onChangeEstatus = vi.fn();
    render(<CatalogoFiltros {...baseProps({ onChangeEstatus, estatus: "disponible" })} />);

    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "sobre_reservado" } });
    expect(onChangeEstatus).toHaveBeenCalledWith("sobre_reservado");

    fireEvent.change(screen.getByLabelText("Estatus"), { target: { value: "" } });
    expect(onChangeEstatus).toHaveBeenCalledWith(null);
  });

  it("con estatus activo (y ningún otro filtro) muestra 'Limpiar filtros'", () => {
    render(<CatalogoFiltros {...baseProps({ estatus: "sin_stock" })} />);
    expect(screen.getByRole("button", { name: "Limpiar filtros" })).toBeInTheDocument();
  });
});
