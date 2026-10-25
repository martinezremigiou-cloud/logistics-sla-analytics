import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CatalogoArbol, resumenSeleccionArbol } from "./catalogo-arbol";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import type { CatalogoFacetas } from "@/types/api";

function facetas(overrides: Partial<CatalogoFacetas> = {}): CatalogoFacetas {
  return {
    tecnologias: [],
    marcas: [],
    familias: [],
    productos: [],
    almacenes: [],
    sin_familia: 0,
    sin_tecnologia: 0,
    ...overrides,
  };
}

// (INV-TAXO F3) Facetas EN CASCADA de ejemplo: tecnologias (universo) →
// marcas (∩ tecnología) → familias/sin_familia (∩ tecnología ∩ marca). El
// componente NUNCA recalcula esta cascada — solo renderiza lo que recibe.
const FACETAS_EJEMPLO: CatalogoFacetas = facetas({
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
    { valor: "SERIES 12", conteo: 18 },
  ],
  sin_familia: 3,
});

function props(overrides: Partial<React.ComponentProps<typeof CatalogoArbol>> = {}) {
  return {
    facetas: FACETAS_EJEMPLO,
    loading: false,
    error: false,
    onRetry: vi.fn(),
    tecnologiaActiva: null,
    marcaActiva: null,
    familiaActiva: null,
    sinFamiliaActiva: false,
    productoActiva: null,
    onSelectTecnologia: vi.fn(),
    onSelectMarca: vi.fn(),
    onSelectFamilia: vi.fn(),
    onSelectSinFamilia: vi.fn(),
    onSelectProducto: vi.fn(),
    ...overrides,
  };
}

/** (O1) Ubica el `<details>` de una sección por el texto de su `<summary>`. */
function detailsFor(nombreSeccion: string): HTMLDetailsElement {
  return screen.getByText(nombreSeccion).closest("details") as HTMLDetailsElement;
}

describe("resumenSeleccionArbol (puro)", () => {
  it("sin ninguna selección → 'Todas'", () => {
    expect(resumenSeleccionArbol(null, null, null, false)).toBe("Todas");
  });

  it("solo tecnología", () => {
    expect(resumenSeleccionArbol("RFID", null, null, false)).toBe("RFID");
  });

  it("tecnología + marca", () => {
    expect(resumenSeleccionArbol("RFID", "BRAND1", null, false)).toBe("RFID › BRAND1");
  });

  it("tecnología + marca + familia", () => {
    expect(resumenSeleccionArbol("RFID", "BRAND1", "SERIES 12", false)).toBe("RFID › BRAND1 › SERIES 12");
  });

  // (CAT-B1 · Tramo C) `producto` es un 5º argumento OPCIONAL (default
  // `null`) — el test de arriba (4 args) sigue pasando sin tocarlo.
  it("tecnología + marca + familia + producto", () => {
    expect(resumenSeleccionArbol("RFID", "BRAND1", "SERIES 12", false, "PM3")).toBe("RFID › BRAND1 › SERIES 12 › PM3");
  });

  it("sinFamiliaActiva=true (familia=null) aparece como 'Sin familia asignada' al final", () => {
    expect(resumenSeleccionArbol("RFID", "BRAND1", null, true)).toBe("RFID › BRAND1 › Sin familia asignada");
  });

  // (O1) El sentinel SIN_TECNOLOGIA jamás se muestra crudo en copy de
  // usuario — mismo criterio que el chip de `catalogo-view.tsx`.
  it("tecnologia=SIN_TECNOLOGIA nunca expone el sentinel crudo: se lee 'Sin tecnología'", () => {
    expect(resumenSeleccionArbol(SIN_TECNOLOGIA, null, null, false)).toBe("Sin tecnología");
  });

  it("tecnologia=SIN_TECNOLOGIA + marca", () => {
    expect(resumenSeleccionArbol(SIN_TECNOLOGIA, "BRAND1", null, false)).toBe("Sin tecnología › BRAND1");
  });
});

describe("CatalogoArbol — estados de carga (facetas viene de la MISMA fetch que la tabla)", () => {
  it("facetas=null y loading=true (primera carga) → skeleton, sin secciones ni botones de valor", () => {
    render(<CatalogoArbol {...props({ facetas: null, loading: true })} />);
    expect(screen.queryByText("Tecnología")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /RFID/ })).not.toBeInTheDocument();
  });

  it("facetas=null y error=true → mensaje + botón Reintentar, dispara onRetry", () => {
    const onRetry = vi.fn();
    render(<CatalogoArbol {...props({ facetas: null, error: true, onRetry })} />);
    expect(screen.getByText("No se pudo cargar el árbol del catálogo.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("facetas=null sin loading/error (defensivo) → mensaje neutro", () => {
    render(<CatalogoArbol {...props({ facetas: null })} />);
    expect(screen.getByText("Sin datos disponibles.")).toBeInTheDocument();
  });

  it("facetas realmente vacías (catálogo sin ingesta) → 'Sin datos disponibles.'", () => {
    render(<CatalogoArbol {...props({ facetas: facetas() })} />);
    expect(screen.getByText("Sin datos disponibles.")).toBeInTheDocument();
  });

  it("PATRÓN ANTI-REMOUNT: facetas ya cargadas + loading=true (refetch en curso) NO reemplaza el árbol por el skeleton", () => {
    render(<CatalogoArbol {...props({ loading: true })} />);
    expect(screen.getByRole("button", { name: "RFID 120" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toHaveAttribute("aria-busy", "true");
  });

  it("con facetas y loading=false, aria-busy es 'false'", () => {
    render(<CatalogoArbol {...props()} />);
    expect(screen.getByRole("navigation")).toHaveAttribute("aria-busy", "false");
  });
});

describe("CatalogoArbol — O1: 3 secciones colapsables HERMANAS (Tecnología, Marca, Familia)", () => {
  it("sección Tecnología con conteos reales de la faceta", () => {
    render(<CatalogoArbol {...props()} />);
    expect(screen.getByText("Tecnología")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AM 80" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "RFID 120" })).toBeInTheDocument();
  });

  it("sección Marca con conteos reales de la faceta", () => {
    render(<CatalogoArbol {...props()} />);
    expect(screen.getByText("Marca")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EAS 30" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "BRAND1 45" })).toBeInTheDocument();
  });

  it("sección Familia + nodo final 'Sin familia asignada' con su conteo", () => {
    render(<CatalogoArbol {...props()} />);
    expect(screen.getByText("Familia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CANDADOS 12" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SERIES 12 18" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sin familia asignada 3" })).toBeInTheDocument();
  });

  it("sin_familia=0 no renderiza el nodo 'Sin familia asignada'", () => {
    render(
      <CatalogoArbol
        {...props({ facetas: facetas({ familias: [{ valor: "CANDADOS", conteo: 1 }], sin_familia: 0 }) })}
      />,
    );
    expect(screen.queryByText("Sin familia asignada")).not.toBeInTheDocument();
  });

  it("tecnologias=[] Y sin_tecnologia=0 oculta la sección Tecnología entera (no un encabezado vacío)", () => {
    render(<CatalogoArbol {...props({ facetas: facetas({ marcas: [{ valor: "EAS", conteo: 1 }] }) })} />);
    expect(screen.queryByText("Tecnología")).not.toBeInTheDocument();
    expect(screen.getByText("Marca")).toBeInTheDocument();
  });

  it("REGLA ANTI-TRAMPA (backend): un valor con conteo 0 igual se renderiza, nunca se filtra en el cliente", () => {
    render(<CatalogoArbol {...props({ facetas: facetas({ marcas: [{ valor: "FANTASMA", conteo: 0 }] }) })} />);
    expect(screen.getByRole("button", { name: "FANTASMA 0" })).toBeInTheDocument();
  });

  it("las 3 secciones son HERMANAS en el DOM, NUNCA anidadas (ratificado: anidar de verdad escondería la Marca ya elegida al colapsar Tecnología)", () => {
    render(<CatalogoArbol {...props()} />);
    const tec = detailsFor("Tecnología");
    const marca = detailsFor("Marca");
    const familia = detailsFor("Familia");
    expect(tec.tagName).toBe("DETAILS");
    expect(marca.tagName).toBe("DETAILS");
    expect(familia.tagName).toBe("DETAILS");
    expect(tec.contains(marca)).toBe(false);
    expect(marca.contains(familia)).toBe(false);
    expect(tec.contains(familia)).toBe(false);
    expect(tec.parentElement).toBe(marca.parentElement);
    expect(marca.parentElement).toBe(familia.parentElement);
  });

  it("sangría + riel comunican la jerarquía SIN anidar: Tecnología ml-0, Marca ml-3+riel, Familia ml-6+riel", () => {
    render(<CatalogoArbol {...props()} />);
    expect(detailsFor("Tecnología")).toHaveClass("ml-0");
    expect(detailsFor("Marca")).toHaveClass("ml-3", "border-l", "border-line", "pl-3");
    expect(detailsFor("Familia")).toHaveClass("ml-6", "border-l", "border-line", "pl-3");
  });

  it("badge de conteo en cada <summary> = CANTIDAD DE RAMAS de esa faceta (facetas.X.length), NUNCA la suma de sus conteos de SKUs (P8: familia es multi-valor)", () => {
    render(<CatalogoArbol {...props()} />);
    // Tecnología: 2 ramas (AM, RFID) — no "200" (80+120).
    expect(detailsFor("Tecnología").querySelector("summary")?.textContent).toContain("2");
    // Marca: 2 ramas (EAS, BRAND1) — no "75" (30+45).
    expect(detailsFor("Marca").querySelector("summary")?.textContent).toContain("2");
    // Familia: 2 ramas (CANDADOS 12, SERIES 12 18). Σ de sus conteos = 30,
    // pero el badge de la sección es la CANTIDAD DE RAMAS (2), nunca una Σ
    // de piezas/SKUs de un campo multi-valor — ver
    // docs/engineering/failure-patterns.md (P8): ninguna rama del árbol suma piezas.
    const resumenFamilia = detailsFor("Familia").querySelector("summary")?.textContent ?? "";
    expect(resumenFamilia).toContain("2");
    expect(resumenFamilia).not.toContain("30");
  });

  it("oculta el marcador nativo del <summary> (cross-browser) sin depender de las keyframes accordion-* muertas de tailwind.config.ts", () => {
    render(<CatalogoArbol {...props()} />);
    const summary = detailsFor("Tecnología").querySelector("summary")!;
    expect(summary.className).toContain("[&::-webkit-details-marker]:hidden");
    expect(summary.className).toContain("[&::marker]:content-none");
    expect(summary.className).not.toContain("accordion");
  });

  it("el chevron de cada sección usa la variante NATIVA group-open de Tailwind (sin JS, sin @radix-ui/react-accordion)", () => {
    render(<CatalogoArbol {...props()} />);
    const chevron = detailsFor("Tecnología").querySelector("summary svg");
    expect(chevron?.getAttribute("class") ?? "").toContain("group-open:rotate-90");
  });

  it("cada <summary> trae el ring de foco y es focoseable de fábrica (sin tabIndex/role manual)", () => {
    render(<CatalogoArbol {...props()} />);
    const summary = detailsFor("Tecnología").querySelector("summary")!;
    expect(summary.className).toContain("focus-visible:ring-2");
    expect(summary.className).toContain("focus-visible:ring-brand");
    expect(summary).not.toHaveAttribute("tabindex");
    expect(summary).not.toHaveAttribute("role");
  });

  it("el contenido de cada sección nunca lleva hidden/display:none/tabIndex manual — se apoya 100% en el <details> nativo", () => {
    render(<CatalogoArbol {...props()} />); // Familia arranca cerrada (sin selección activa)
    const contenidoFamilia = screen.getByRole("button", { name: "CANDADOS 12" }).closest("ul")!.parentElement!;
    expect(contenidoFamilia).not.toHaveAttribute("hidden");
    expect(contenidoFamilia).not.toHaveAttribute("tabindex");
    expect(contenidoFamilia.getAttribute("style")).toBeFalsy();
  });

  it("la lista de Familia SIEMPRE lleva su propio tope de scroll (max-h-[260px] overflow-y-auto), haya filtro o no", () => {
    const { rerender } = render(<CatalogoArbol {...props()} />);
    let contenedor = screen.getByRole("button", { name: "CANDADOS 12" }).closest("ul")!.parentElement!;
    expect(contenedor).toHaveClass("max-h-[260px]", "overflow-y-auto", "pr-1");

    rerender(<CatalogoArbol {...props({ tecnologiaActiva: "RFID" })} />);
    contenedor = screen.getByRole("button", { name: "CANDADOS 12" }).closest("ul")!.parentElement!;
    expect(contenedor).toHaveClass("max-h-[260px]", "overflow-y-auto", "pr-1");
  });

  it("Tecnología y Marca NO llevan tope de scroll (solo Familia lo necesita)", () => {
    render(<CatalogoArbol {...props()} />);
    const contenedorTec = screen.getByRole("button", { name: "RFID 120" }).closest("ul")!.parentElement!;
    const contenedorMarca = screen.getByRole("button", { name: "BRAND1 45" }).closest("ul")!.parentElement!;
    expect(contenedorTec).not.toHaveClass("max-h-[260px]");
    expect(contenedorMarca).not.toHaveClass("max-h-[260px]");
  });
});

describe("CatalogoArbol — O1: apertura por defecto (regla exacta)", () => {
  it("Tecnología y Marca arrancan SIEMPRE abiertas, incluso sin ninguna selección activa", () => {
    render(<CatalogoArbol {...props()} />);
    expect(detailsFor("Tecnología").open).toBe(true);
    expect(detailsFor("Marca").open).toBe(true);
  });

  it("Familia arranca CERRADA cuando NO hay tecnología/marca/familia/sinFamilia activos", () => {
    render(<CatalogoArbol {...props()} />);
    expect(detailsFor("Familia").open).toBe(false);
  });

  it.each([
    ["tecnologiaActiva", { tecnologiaActiva: "RFID" }],
    ["marcaActiva", { marcaActiva: "BRAND1" }],
    ["familiaActiva", { familiaActiva: "SERIES 12" }],
    ["sinFamiliaActiva", { sinFamiliaActiva: true }],
  ] as const)(
    "Familia arranca ABIERTA si %s ya viene activo desde el PRIMER render (deep-link, sin clics previos)",
    (_nombre, activo) => {
      render(<CatalogoArbol {...props(activo)} />);
      expect(detailsFor("Familia").open).toBe(true);
    },
  );
});

describe("CatalogoArbol — O1: sin persistencia; el toggle manual del usuario manda mientras el componente siga montado", () => {
  it("cerrar Tecnología a mano sobrevive a un refetch con los mismos filtros activos (React no reimpone `open`)", () => {
    const { rerender } = render(<CatalogoArbol {...props()} />);
    const tecDetails = detailsFor("Tecnología");
    expect(tecDetails.open).toBe(true);

    fireEvent.click(screen.getByText("Tecnología"));
    expect(tecDetails.open).toBe(false);

    // Simula un refetch en curso (mismos filtros activos: solo cambia
    // `loading`) — el criterio de apertura de Tecnología es SIEMPRE `true`,
    // así que no cambia entre renders y React nunca vuelve a tocar el
    // atributo DOM `open`: el toggle manual sobrevive.
    rerender(<CatalogoArbol {...props({ loading: true })} />);
    expect(tecDetails.open).toBe(false);
  });

  it("Familia se auto-abre en cuanto una selección se activa por primera vez (transición false→true)", () => {
    const { rerender } = render(<CatalogoArbol {...props()} />);
    expect(detailsFor("Familia").open).toBe(false);

    rerender(<CatalogoArbol {...props({ familiaActiva: "CANDADOS" })} />);
    expect(detailsFor("Familia").open).toBe(true);
  });

  it("NO persiste el estado de apertura en ningún storage (ni localStorage ni sessionStorage)", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    render(<CatalogoArbol {...props()} />);
    fireEvent.click(screen.getByText("Marca"));
    fireEvent.click(screen.getByText("Tecnología"));
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });
});

describe("CatalogoArbol — O1: nodo 'Sin tecnología' (mismo mecanismo `sufijo` que 'Sin familia asignada', cero props nuevos)", () => {
  it("aparece con el conteo de facetas.sin_tecnologia formateado con formatoNumero — nunca hardcoded en el componente", () => {
    render(
      <CatalogoArbol
        {...props({ facetas: facetas({ tecnologias: FACETAS_EJEMPLO.tecnologias, sin_tecnologia: 53 }) })}
      />,
    );
    expect(screen.getByRole("button", { name: "Sin tecnología 53" })).toBeInTheDocument();
  });

  it("sin_tecnologia=0 no renderiza el nodo", () => {
    render(
      <CatalogoArbol
        {...props({ facetas: facetas({ tecnologias: FACETAS_EJEMPLO.tecnologias, sin_tecnologia: 0 }) })}
      />,
    );
    expect(screen.queryByText("Sin tecnología")).not.toBeInTheDocument();
  });

  it("clic dispara onSelectTecnologia(SIN_TECNOLOGIA) — mismo callback que una tecnología real, sin prop nuevo", () => {
    const onSelectTecnologia = vi.fn();
    render(<CatalogoArbol {...props({ onSelectTecnologia, facetas: facetas({ sin_tecnologia: 53 }) })} />);
    fireEvent.click(screen.getByRole("button", { name: "Sin tecnología 53" }));
    expect(onSelectTecnologia).toHaveBeenCalledWith(SIN_TECNOLOGIA);
    expect(onSelectTecnologia).toHaveBeenCalledTimes(1);
  });

  it("aria-current='page' + mismo estilo activo que 'Sin familia asignada' (bg-info-bg font-semibold not-italic text-brand) cuando tecnologiaActiva===SIN_TECNOLOGIA", () => {
    render(
      <CatalogoArbol {...props({ tecnologiaActiva: SIN_TECNOLOGIA, facetas: facetas({ sin_tecnologia: 53 }) })} />,
    );
    const boton = screen.getByRole("button", { name: "Sin tecnología 53" });
    expect(boton).toHaveAttribute("aria-current", "page");
    expect(boton.className).toContain("bg-info-bg");
    expect(boton.className).toContain("font-semibold");
    expect(boton.className).toContain("not-italic");
    expect(boton.className).toContain("text-brand");
  });

  it("sin selección activa, el nodo va en itálica muted (mismo estilo inactivo que 'Sin familia asignada')", () => {
    render(<CatalogoArbol {...props({ facetas: facetas({ sin_tecnologia: 53 }) })} />);
    const boton = screen.getByRole("button", { name: "Sin tecnología 53" });
    expect(boton).not.toHaveAttribute("aria-current");
    expect(boton.className).toContain("italic");
    expect(boton.className).toContain("text-ink-muted");
  });

  it("con una tecnología real activa (no el sentinel), el nodo 'Sin tecnología' NO queda marcado activo", () => {
    render(
      <CatalogoArbol
        {...props({
          tecnologiaActiva: "RFID",
          facetas: facetas({ tecnologias: FACETAS_EJEMPLO.tecnologias, sin_tecnologia: 53 }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Sin tecnología 53" })).not.toHaveAttribute("aria-current");
  });

  it("tecnologias=[] pero sin_tecnologia>0: la sección Tecnología SIGUE mostrándose (mismo criterio que Familia/sin_familia)", () => {
    render(
      <CatalogoArbol
        {...props({
          facetas: facetas({ tecnologias: [], marcas: [{ valor: "EAS", conteo: 1 }], sin_tecnologia: 53 }),
        })}
      />,
    );
    expect(screen.getByText("Tecnología")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sin tecnología 53" })).toBeInTheDocument();
  });
});

describe("CatalogoArbol — A2: un SKU con N familias vive en las N ramas (no se agregan piezas, P8)", () => {
  it("cada familia de la faceta es un nodo navegable independiente, con su propio conteo de SKUs", () => {
    render(
      <CatalogoArbol
        {...props({
          facetas: facetas({
            familias: [
              { valor: "CLIP 3.0", conteo: 4 },
              { valor: "CLIP ROTATIVO", conteo: 4 },
            ],
          }),
        })}
      />,
    );
    // Un mismo SKU con ambas familias cuenta UNA vez en cada rama — el
    // componente no valida aritmética, solo confirma que ambas ramas son
    // nodos clicables independientes (la Σ de conteos de familias puede
    // exceder el total del catálogo, eso es correcto y no es un bug de UI;
    // ver docs/engineering/failure-patterns.md (P8) — ninguna rama del árbol suma piezas).
    expect(screen.getByRole("button", { name: "CLIP 3.0 4" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLIP ROTATIVO 4" })).toBeInTheDocument();
  });
});

describe("CatalogoArbol — selección (click) dispara los callbacks con el valor exacto de la faceta", () => {
  it("tecnología", () => {
    const onSelectTecnologia = vi.fn();
    render(<CatalogoArbol {...props({ onSelectTecnologia })} />);
    fireEvent.click(screen.getByRole("button", { name: "RFID 120" }));
    expect(onSelectTecnologia).toHaveBeenCalledWith("RFID");
  });

  it("marca", () => {
    const onSelectMarca = vi.fn();
    render(<CatalogoArbol {...props({ onSelectMarca })} />);
    fireEvent.click(screen.getByRole("button", { name: "BRAND1 45" }));
    expect(onSelectMarca).toHaveBeenCalledWith("BRAND1");
  });

  it("familia", () => {
    const onSelectFamilia = vi.fn();
    render(<CatalogoArbol {...props({ onSelectFamilia })} />);
    fireEvent.click(screen.getByRole("button", { name: "SERIES 12 18" }));
    expect(onSelectFamilia).toHaveBeenCalledWith("SERIES 12");
  });

  it("'Sin familia asignada' dispara onSelectSinFamilia() sin argumentos", () => {
    const onSelectSinFamilia = vi.fn();
    render(<CatalogoArbol {...props({ onSelectSinFamilia })} />);
    fireEvent.click(screen.getByRole("button", { name: "Sin familia asignada 3" }));
    expect(onSelectSinFamilia).toHaveBeenCalledTimes(1);
  });
});

describe("CatalogoArbol — aria-current='page' refleja el estado activo (comparación case-insensitive)", () => {
  it("solo el nodo de tecnología activo lo tiene", () => {
    render(<CatalogoArbol {...props({ tecnologiaActiva: "RFID" })} />);
    expect(screen.getByRole("button", { name: "RFID 120" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "AM 80" })).not.toHaveAttribute("aria-current");
  });

  it("solo el nodo de marca activo lo tiene (case-insensitive: 'brand1' activa 'BRAND1')", () => {
    render(<CatalogoArbol {...props({ marcaActiva: "brand1" })} />);
    expect(screen.getByRole("button", { name: "BRAND1 45" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "EAS 30" })).not.toHaveAttribute("aria-current");
  });

  it("solo el nodo de familia activo lo tiene", () => {
    render(<CatalogoArbol {...props({ familiaActiva: "CANDADOS" })} />);
    expect(screen.getByRole("button", { name: "CANDADOS 12" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "SERIES 12 18" })).not.toHaveAttribute("aria-current");
  });

  it("'Sin familia asignada' lo tiene cuando sinFamiliaActiva=true, y ninguna familia real queda marcada", () => {
    render(<CatalogoArbol {...props({ sinFamiliaActiva: true })} />);
    expect(screen.getByRole("button", { name: "Sin familia asignada 3" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "SERIES 12 18" })).not.toHaveAttribute("aria-current");
  });
});

describe("CatalogoArbol — botón móvil (Sheet)", () => {
  it("sin ninguna selección: 'Árbol: Todas'", () => {
    render(<CatalogoArbol {...props()} />);
    expect(screen.getByRole("button", { name: "Árbol: Todas" })).toBeInTheDocument();
  });

  it("con selección activa: resume la ruta tecnología › marca", () => {
    render(<CatalogoArbol {...props({ tecnologiaActiva: "RFID", marcaActiva: "BRAND1" })} />);
    expect(screen.getByRole("button", { name: "Árbol: RFID › BRAND1" })).toBeInTheDocument();
  });

  it("clic abre el Sheet con el mismo contenido (título 'Árbol del catálogo') — mismo cuerpo que la versión de escritorio, sin componente aparte", () => {
    render(<CatalogoArbol {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Árbol: Todas" }));
    expect(screen.getByRole("heading", { name: "Árbol del catálogo" })).toBeInTheDocument();
  });
});

// ============================================================
// GATE C (CAT-B1 · Tramo C) — 4ª sección "Producto", SOLO bajo
// tecnologia=BRAND1. Proporciones medidas contra un snapshot real: todos los
// SKU de BRAND1 tienen producto (valores CRUDOS que `separarFamilias`
// atomiza a menos — ese es el número que pinta la faceta); ninguna otra
// tecnología tiene uno solo. Este test es de DOM: recibe `facetas.productos`
// YA calculada (no reimplementa la atomización) — la atomización se mide en
// `inventory.service.test.ts`. CONTROL POSITIVO ESTRUCTURAL: ninguna
// tecnología ≠ BRAND1 tiene UN SOLO producto — (b)/(c) de abajo verifican
// exactamente eso a nivel de DOM.
// ============================================================
describe("CatalogoArbol — GATE C (CAT-B1 · Tramo C): sección 'Producto'", () => {
  it("(a) tecnologia=BRAND1 con muchos valores en facetas.productos: la sección 'Producto' se pinta con esa cantidad", () => {
    // Cifras inventadas: la sección pinta la CANTIDAD de valores de la faceta
    // `productos` (ramas), que es menor que el conteo de SKU de la tecnología.
    const N_PRODUCTOS = 37;
    const productos = Array.from({ length: N_PRODUCTOS }, (_, i) => ({ valor: `PRODUCTO-${i}`, conteo: 1 }));
    render(
      <CatalogoArbol
        {...props({
          tecnologiaActiva: "BRAND1",
          facetas: facetas({ tecnologias: [{ valor: "BRAND1", conteo: 412 }], productos }),
        })}
      />,
    );
    expect(screen.getByText("Producto")).toBeInTheDocument();
    expect(detailsFor("Producto").querySelector("summary")?.textContent).toContain(String(N_PRODUCTOS));
    expect(screen.getByRole("button", { name: "PRODUCTO-0 1" })).toBeInTheDocument();
  });

  it("(b) CONTROL POSITIVO: tecnologia=EAS (facetas.productos=[]) → la sección 'Producto' NO EXISTE EN EL DOM (no está vacía: no está)", () => {
    render(
      <CatalogoArbol
        {...props({
          tecnologiaActiva: "EAS",
          facetas: facetas({ tecnologias: [{ valor: "EAS", conteo: 58 }], productos: [] }),
        })}
      />,
    );
    expect(screen.queryByText("Producto")).not.toBeInTheDocument();
  });

  it("(c) SIN TECNOLOGIA agrupa su conteo (nodo presente) y TAMPOCO pinta la sección 'Producto'", () => {
    render(
      <CatalogoArbol
        {...props({
          tecnologiaActiva: SIN_TECNOLOGIA,
          facetas: facetas({ sin_tecnologia: 27, productos: [] }),
        })}
      />,
    );
    expect(screen.getByRole("button", { name: "Sin tecnología 27" })).toBeInTheDocument();
    expect(screen.queryByText("Producto")).not.toBeInTheDocument();
  });

  it("selección de un nodo dispara onSelectProducto con el valor exacto de la faceta", () => {
    const onSelectProducto = vi.fn();
    render(
      <CatalogoArbol
        {...props({ onSelectProducto, facetas: facetas({ productos: [{ valor: "PM3", conteo: 12 }] }) })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "PM3 12" }));
    expect(onSelectProducto).toHaveBeenCalledWith("PM3");
  });

  it("REGLA ANTI-TRAMPA (backend): un producto con conteo 0 igual se renderiza, nunca se filtra en el cliente", () => {
    render(<CatalogoArbol {...props({ facetas: facetas({ productos: [{ valor: "FANTASMA", conteo: 0 }] }) })} />);
    expect(screen.getByRole("button", { name: "FANTASMA 0" })).toBeInTheDocument();
  });

  it("'Producto' es HERMANA de las otras secciones en el DOM (nunca anidada) y va MÁS indentada (ml-9)", () => {
    // Semilla con las 3 secciones YA pobladas (FACETAS_EJEMPLO) + productos:
    // sin esto, Tecnología/Marca/Familia quedarían ausentes (facetas() por
    // default está vacía) y la comparación de "hermanas" sería vacua.
    render(<CatalogoArbol {...props({ facetas: facetas({ ...FACETAS_EJEMPLO, productos: [{ valor: "PM3", conteo: 1 }] }) })} />);
    const tec = detailsFor("Tecnología");
    const marca = detailsFor("Marca");
    const familia = detailsFor("Familia");
    const producto = detailsFor("Producto");
    expect(producto.tagName).toBe("DETAILS");
    expect(tec.contains(producto)).toBe(false);
    expect(marca.contains(producto)).toBe(false);
    expect(familia.contains(producto)).toBe(false);
    expect(tec.parentElement).toBe(producto.parentElement);
    expect(producto).toHaveClass("ml-9", "border-l", "border-line", "pl-3");
  });

  it("el botón móvil incluye el producto activo al final del resumen", () => {
    render(<CatalogoArbol {...props({ tecnologiaActiva: "BRAND1", productoActiva: "PM3" })} />);
    expect(screen.getByRole("button", { name: "Árbol: BRAND1 › PM3" })).toBeInTheDocument();
  });
});
