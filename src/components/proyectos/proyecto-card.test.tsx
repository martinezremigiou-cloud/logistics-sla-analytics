import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProyectoCard } from "./proyecto-card";
import { simboloDe } from "./apariencia-proyecto";
import type { ProyectoResumen } from "@/types/proyectos";

function proyecto(overrides: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: "Despliegue de Series2 en 40 tiendas Retailer9 zona centro.",
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

describe("ProyectoCard", () => {
  it("enlaza a /proyectos/{id} y pinta folio, título y la línea de metadatos", () => {
    render(<ProyectoCard proyecto={proyecto()} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/proyectos/11111111-1111-1111-1111-111111111111");
    expect(screen.getByText("PRJ-001")).toBeInTheDocument();
    expect(screen.getByText("Rollout Retailer9 Series2 Q2")).toBeInTheDocument();
    // Fecha date-only formateada + "N SKU · N pz" (singular "SKU", spec de la lista — distinto del detalle).
    expect(screen.getByText(/30 abr 2026/)).toBeInTheDocument();
    expect(screen.getByText("3 SKU · 400 pz")).toBeInTheDocument();
  });

  // ============================================================
  // [2.0.1-B · S-1] LA TARJETA PERDIÓ DOS CAMPOS, Y ESO ES EL ENTREGABLE.
  //
  // `descripcion` y `tipo` YA NO SE PINTAN. No es una regresión: la §3 de la
  // especificación enumera lo que lleva la tarjeta —folio, chip de intención,
  // título, responsable, fecha·SKU·piezas, «inventario del …»— y esos dos no
  // están. Se quedan en `proyecto-hero`, que es donde hay sitio para ellos.
  //
  // La prueba lo AFIRMA en vez de callarlo: si mañana alguien los devuelve a la
  // tarjeta, esto se pone rojo y tendrá que decidirlo a propósito.
  // ============================================================
  it("NO pinta descripción ni tipo: la §3 no los lista en la tarjeta", () => {
    render(<ProyectoCard proyecto={proyecto()} />);
    expect(screen.queryByText("Despliegue de Series2 en 40 tiendas Retailer9 zona centro.")).not.toBeInTheDocument();
    expect(screen.queryByText("Rollout")).not.toBeInTheDocument();
  });

  it("pinta el chip de intención cuando viene, y no revienta cuando no", () => {
    const { unmount } = render(<ProyectoCard proyecto={proyecto({ intencion: "Cotización" })} />);
    expect(screen.getByText("Cotización")).toBeInTheDocument();
    unmount();

    render(<ProyectoCard proyecto={proyecto({ tipo: null, intencion: null, descripcion: null })} />);
    expect(screen.queryByText("Cotización")).not.toBeInTheDocument();
  });

  // ============================================================
  // [2.0.1-B · S-0] ESTA PRUEBA AFIRMABA LO CONTRARIO DE LO QUE PASABA.
  //
  // Se titulaba «NUNCA pinta 'Responsable': el contrato (ProyectoResumen) no
  // trae ese dato» y solo comprobaba que no apareciera el LITERAL «Responsable».
  // Pasaba —y sigue pasando— porque la tarjeta imprime el correo del dueño SIN
  // rótulo. O sea: verde por una razón distinta de la que su título anuncia, y
  // sobre una premisa **falsa** desde que llegó el embed `perfiles(email)`.
  //
  // Es la gemela exacta del encabezado que S-0 corrigió quince líneas más
  // arriba en `proyecto-card.tsx`: se arregló el comentario y se dejó la prueba
  // diciendo lo mismo. Un título que miente es peor que ninguna prueba — la
  // siguiente persona lo lee como contrato.
  //
  // Lo que sí es un invariante y sí vale la pena vigilar: la tarjeta muestra al
  // DUEÑO DE LA FILA, y cuando no hay dueño no se lo inventa.
  // ============================================================
  it("muestra al dueño de la fila, y «—» cuando la fila no tiene dueño", () => {
    const { unmount } = render(<ProyectoCard proyecto={proyecto({ responsable: "otro.kam@example.com" })} />);
    expect(screen.getByText(/otro\.kam@example\.com/)).toBeInTheDocument();
    unmount();

    render(<ProyectoCard proyecto={proyecto({ responsable: null })} />);
    // Sin dueño se pinta «—», que es la verdad. Inventar un nombre —por ejemplo
    // el de quien mira— sería activamente falso para un admin viendo proyectos
    // de varios KAM.
    expect(screen.getByText(/—/)).toBeInTheDocument();
    expect(screen.queryByText(/otro\.kam@example\.com/)).not.toBeInTheDocument();
  });
});

describe("ProyectoCard · rescate del huerfano (invariante de la 0025)", () => {
  it("proyecto CON responsable: no ofrece reasignar ni el aviso", () => {
    render(<ProyectoCard proyecto={proyecto({ responsable: "kam@example.com" })} />);
    expect(screen.queryByRole("button", { name: "Reasignar" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin responsable/)).not.toBeInTheDocument();
  });

  it("huerfano con la accion disponible: explica POR QUE no se puede editar, no solo que falta un dato", () => {
    render(<ProyectoCard proyecto={proyecto({ responsable: null })} onReasignar={vi.fn()} />);
    expect(screen.getByText(/nadie puede editarlo/i)).toBeInTheDocument();
  });

  it("el boton dispara el rescate", () => {
    const alRescatar = vi.fn();
    render(<ProyectoCard proyecto={proyecto({ responsable: null })} onReasignar={alRescatar} />);
    fireEvent.click(screen.getByRole("button", { name: "Reasignar" }));
    expect(alRescatar).toHaveBeenCalledTimes(1);
  });

  it("la banda va SUPERPUESTA y FUERA del ancla — el alto no cambia y el HTML es válido", () => {
    // Las dos mitades de la decisión, en una prueba.
    //
    // 1 · FUERA del <Link>: un <button> anidado en un ancla es HTML inválido y
    //     rompe la navegación por teclado. Se comprueba por CONTENCIÓN del DOM,
    //     no por una clase.
    // 2 · SUPERPUESTA: si estuviera en el flujo, la tarjeta huérfana crecería y
    //     en la pasarela —donde todas comparten renglón— estiraría a las demás,
    //     que es el defecto de altos desiguales que midió el QA. Fuera del flujo
    //     el alto es idéntico la tape o no.
    const { container } = render(<ProyectoCard proyecto={proyecto({ responsable: null })} onReasignar={vi.fn()} />);
    const boton = screen.getByRole("button", { name: "Reasignar" });
    expect(screen.getByRole("link").contains(boton)).toBe(false);
    const banda = container.querySelector(".absolute.inset-x-0.bottom-0");
    expect(banda, "la banda del huérfano dejó de estar fuera del flujo").not.toBeNull();
    expect(banda?.contains(boton)).toBe(true);
  });
});

// ============================================================
// [2.0.1-B · S-1] LO QUE LA TARJETA GANÓ: la identidad del XUI.
//
// De los quince elementos de la §3, la versión anterior pintaba cinco. Estas
// pruebas fijan los que faltaban, uno por uno, para que «se construyó el
// contenedor y no la tarjeta» no pueda volver a pasar en silencio.
// ============================================================
describe("ProyectoCard · la identidad del XUI (§3)", () => {
  it("lleva PORTADA, y el símbolo por defecto es el mismo para todos", () => {
    const { container } = render(<ProyectoCard proyecto={proyecto()} />);
    const svg = container.querySelector("svg");
    expect(svg, "la tarjeta no tiene portada").not.toBeNull();
    // El viewBox de la §3, literal. Un número distinto aquí es un dibujo
    // distinto del aprobado.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 380 140");
    // Decorativa: no aporta información que el texto no dé, así que no se
    // anuncia. Un <svg> sin nombre accesible y sin aria-hidden sí sería ruido.
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.querySelector("path[d='" + simboloDe(null).d + "']")).not.toBeNull();
  });

  it("el folio va SOBRE la portada, no en la línea del título", () => {
    const { container } = render(<ProyectoCard proyecto={proyecto()} />);
    const folio = screen.getByText("PRJ-001");
    const portada = container.querySelector("svg");
    // Hermanos dentro del mismo contenedor posicionado: eso es «encima».
    expect(folio.parentElement).toBe(portada?.parentElement);
    expect(folio.className).toContain("absolute");
  });

  it("la tarjeta ACTIVA se distingue por borde de 1.5 px y sombra; la inactiva no", () => {
    const { container: activa } = render(<ProyectoCard proyecto={proyecto()} activa />);
    expect(activa.firstElementChild?.className).toContain("border-[1.5px]");
    expect(activa.firstElementChild?.className).toContain("shadow-[0_12px_28px_rgba(15,23,42,.14)]");

    const { container: quieta } = render(<ProyectoCard proyecto={proyecto()} />);
    expect(quieta.firstElementChild?.className).not.toContain("border-[1.5px]");
    expect(quieta.firstElementChild?.className).toContain("border-line");
  });

  it("«inventario del …» se pinta con la fecha que llega — y NO se inventa cuando no llega", () => {
    // La mitad que importa es la segunda. Sin snapshot no hay de qué fecha
    // hablar, y una tarjeta que imprimiera «inventario del —» afirmaría que hay
    // un corte que no existe.
    const { unmount } = render(<ProyectoCard proyecto={proyecto()} inventarioEn="2026-08-20T17:02:00.000Z" />);
    expect(screen.getByText(/inventario del/)).toBeInTheDocument();
    unmount();

    render(<ProyectoCard proyecto={proyecto()} inventarioEn={null} />);
    expect(screen.queryByText(/inventario del/)).not.toBeInTheDocument();
  });

  // ============================================================
  // [2.0.1-C · F-2] EL TÍTULO NO SE CORTA A MEDIA PALABRA.
  //
  // `line-clamp-2` recorta VISUALMENTE a dos renglones, pero no deja rastro
  // del texto íntegro para quien lo necesita completo: un lector de pantalla,
  // un tooltip nativo, o simplemente alguien copiando. `title` + `break-words`
  // lo resuelven sin tocar `DIMENSIONES_TARJETA` (fuente única con el
  // esqueleto — S-1).
  // ============================================================
  it("el título largo lleva su texto ÍNTEGRO en `title`, y sigue recortado a dos renglones", () => {
    const titulo =
      "Rollout Retailer9 Series2 Q2 en las cuarenta tiendas de la zona centro con instalación completa y capacitación";
    render(<ProyectoCard proyecto={proyecto({ titulo })} />);
    const nodo = screen.getByText(titulo);
    expect(nodo.getAttribute("title")).toBe(titulo);
    expect(nodo.className).toContain("line-clamp-2");
    // El comentario de arriba dice que `break-words` es parte de la solución
    // (una palabra larga sin espacios podría desbordar la tarjeta incluso
    // recortada a dos renglones); esta línea lo pinnea en vez de darlo por
    // sentado.
    expect(nodo.className).toContain("break-words");
  });

  it("la portada COMPACTA recorta en vez de escalar — es lo que fija el alto donde el ancho no lo es", () => {
    // En la lista vertical la tarjeta es `w-full`: con alto automático la
    // portada crecería con la pantalla y el alto de la tarjeta dejaría de ser un
    // número que el esqueleto pueda igualar. `slice` recorta.
    const { container } = render(<ProyectoCard proyecto={proyecto()} portadaCompacta />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    expect(svg?.getAttribute("class")).toContain("h-[72px]");
  });
});
