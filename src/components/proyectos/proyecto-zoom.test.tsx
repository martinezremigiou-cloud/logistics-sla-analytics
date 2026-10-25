// ============================================================
// [2.0.1-B · S-1] proyecto-zoom.test.tsx
//
// Lo que estas pruebas NO pueden ver, dicho para que nadie las lea de más: si el
// zoom RELLENA el alto. Eso es geometría, en jsdom todo mide 0, y una prueba que
// lo afirmara sería verde por la razón equivocada. El criterio #2 —que el 57 %
// de vacío baje— lo mide el navegador con el mismo método que levantó el 57 %.
//
// Lo que sí fijan: que el zoom EXISTA con su contenido, que no invente la fecha
// del inventario, y que no ofrezca destinos que no existen.
// ============================================================
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProyectoZoom } from "./proyecto-zoom";
import type { ProyectoResumen } from "@/types/proyectos";

function proyecto(overrides: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: null,
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

describe("ProyectoZoom", () => {
  it("amplía el proyecto con su portada grande y la rejilla de identidad", () => {
    const { container } = render(<ProyectoZoom proyecto={proyecto()} />);
    const svg = container.querySelector("svg");
    // El viewBox de la §4, literal: un número distinto es otro dibujo.
    expect(svg?.getAttribute("viewBox")).toBe("0 0 760 280");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");

    expect(screen.getByRole("heading", { name: "Rollout Retailer9 Series2 Q2" })).toBeInTheDocument();
    expect(screen.getByText("PRJ-001")).toBeInTheDocument();
    expect(screen.getByText("kam@example.com")).toBeInTheDocument();
    expect(screen.getByText("3 SKU")).toBeInTheDocument();
    expect(screen.getByText("400 pz")).toBeInTheDocument();
    expect(screen.getByText(/30 abr 2026/)).toBeInTheDocument();
  });

  it("la región se nombra con el folio, para que no sea «un section» más", () => {
    render(<ProyectoZoom proyecto={proyecto()} />);
    expect(screen.getByRole("region", { name: "Vista ampliada de PRJ-001" })).toBeInTheDocument();
  });

  it("sin fecha de inventario NO pinta la frase — porque diría algo falso", () => {
    // «es la fecha que imprimirá el documento» sin snapshot sería exactamente al
    // revés: la fecha con la que NO se imprimiría nada.
    const { unmount } = render(<ProyectoZoom proyecto={proyecto()} inventarioEn="2026-08-20T17:02:00.000Z" />);
    expect(screen.getByText(/es la fecha que imprimirá el documento/)).toBeInTheDocument();
    unmount();

    render(<ProyectoZoom proyecto={proyecto()} inventarioEn={null} />);
    expect(screen.queryByText(/es la fecha que imprimirá el documento/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Inventario vigente/)).not.toBeInTheDocument();
  });

  it("sin dueño pinta «—», no un nombre inventado", () => {
    render(<ProyectoZoom proyecto={proyecto({ responsable: null })} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // ============================================================
  // [2.0.1-C · F-3] EL CORREO DEL RESPONSABLE YA NO INVADE LA CELDA DE FECHA.
  //
  // Causa raíz medida: en CSS Grid el mínimo por omisión de un ítem es `auto`
  // (su contenido intrínseco), y un correo sin espacios fuerza el ancho de su
  // columna aunque la pista declare `minmax(140px,1fr)`.
  //
  // CONTROL POSITIVO: la aserción mira `className` y `title`, no solo que el
  // texto exista — un `getByText` a secas pasaría igual con el defecto
  // intacto (P25), porque el correo SIGUE estando en el DOM aunque desborde.
  // ============================================================
  it("el correo largo del responsable trunca con elipsis y lleva el texto íntegro en `title` — las TRES piezas juntas, porque ninguna basta sola", () => {
    // [revisor-codigo ALTO] Borrar `min-w-0` del contenedor deja esta prueba
    // en verde si solo se mira `truncate`+`title` en el VALOR: las dos clases
    // siguen en el marcado, pero SIN efecto — en Grid el mínimo por omisión de
    // un ítem es su contenido intrínseco (`auto`), así que sin `min-w-0` la
    // pista se ensancha para caber el correo entero y no hay elipsis que
    // mostrar (el defecto original vuelve intacto). Por eso las tres piezas
    // —contenedor `min-w-0`, valor `truncate`, valor `title`— se afirman
    // juntas: cualquiera de las tres que se borre pone esto en rojo.
    const correo = "coordinador.compras.mx@example.com";
    expect(correo).toHaveLength(34);
    render(<ProyectoZoom proyecto={proyecto({ responsable: correo })} />);
    const valor = screen.getByText(correo);
    const contenedor = valor.parentElement;
    expect(contenedor?.className).toContain("min-w-0");
    expect(valor.className).toContain("truncate");
    expect(valor.getAttribute("title")).toBe(correo);
  });

  it("Fecha/Partidas/Piezas NO truncan — son siempre cortas", () => {
    render(<ProyectoZoom proyecto={proyecto()} />);
    expect(screen.getByText(/30 abr 2026/).className).not.toContain("truncate");
    expect(screen.getByText("3 SKU").className).not.toContain("truncate");
    expect(screen.getByText("400 pz").className).not.toContain("truncate");
  });

  it("ofrece «Abrir el proyecto» y NO «Revisar y exportar» — ese destino no existe hoy", () => {
    // La ausencia es la afirmación. La maqueta lleva ese botón a la pestaña
    // Documento del detalle, y esa pestaña no es direccionable por URL: un botón
    // que nombra un destino inexistente es el error del estado vacío otra vez.
    //
    // ⚠ Aquí decía que «si algún día la pestaña se vuelve direccionable, esta
    // prueba se pone roja». NO PUEDE: este archivo solo renderiza
    // `<ProyectoZoom>`, y volver direccionables las pestañas se hace en
    // `proyecto-detalle-view.tsx`, que este árbol no toca. Era P19 en prosa.
    //
    // Lo que esta prueba SÍ trinca es la otra dirección: que no vuelva el botón
    // mientras el destino no exista. El aviso del cambio inverso vive en
    // `proyecto-detalle-view.test.tsx`, que lee aquel fuente.
    render(<ProyectoZoom proyecto={proyecto()} />);
    expect(screen.getByRole("link", { name: "Abrir el proyecto" })).toHaveAttribute(
      "href",
      "/proyectos/11111111-1111-1111-1111-111111111111",
    );
    expect(screen.queryByText(/Revisar y exportar/)).not.toBeInTheDocument();
  });

  it("NO trae el editor de apariencia: el lápiz es S-2, ausente por decisión", () => {
    // Sin las columnas `color`/`simbolo` por proyecto no habría qué guardar. Se
    // afirma para que la ausencia se lea como decisión y no como olvido.
    //
    // [2.0.1-C · F-4] SIGUE SIENDO VÁLIDA TAL CUAL con la columna de 330 px:
    // esa columna se llena con «Inventario vigente» y «Abrir el proyecto» —lo
    // que YA existía—, no con un panel «Apariencia». La palabra sigue sin
    // aparecer por la misma razón de antes, así que esta prueba no cambia; lo
    // que sí se agrega es la estructura de dos columnas, abajo.
    render(<ProyectoZoom proyecto={proyecto()} />);
    expect(screen.queryByText(/Apariencia/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Restablecer/)).not.toBeInTheDocument();
  });
});

// ============================================================
// [2.0.1-C · F-4] LA COLUMNA DE 330 PX, RESERVADA — Y DENTRO DE LA REGIÓN.
//
// `PortadaZoom` es `viewBox 0 0 760 280` con `h-auto w-full` y sin tope: sin
// esta columna se come el espacio que la maqueta reserva para el costado. Lo
// que estas pruebas SÍ pueden ver sin navegador: que hay DOS ramas visuales,
// que las proporciones declaradas (`flex-[1_1_480px]` / `flex-[1_1_330px]`)
// son las del encargo, y que las DOS viven DENTRO de la única región nombrada
// —no que la columna quedara afuera, que era el defecto (revisor-codigo
// ALTO, WCAG 2.4.4: «Abrir el proyecto» sin folio, huérfano del landmark,
// entre nueve tarjetas que también son enlaces).
// ============================================================
describe("ProyectoZoom · la columna de 330 px (F-4)", () => {
  it("la REGIÓN MISMA es el contenedor de dos ramas, con las proporciones del encargo", () => {
    const { container } = render(<ProyectoZoom proyecto={proyecto()} inventarioEn="2026-08-20T17:02:00.000Z" />);
    const region = screen.getByRole("region", { name: "Vista ampliada de PRJ-001" });
    // La región ES el elemento raíz que renderiza el componente, no una rama
    // suya: así las dos cajas visuales quedan dentro del mismo landmark.
    expect(container.firstElementChild).toBe(region);
    expect(region.className).toContain("flex-wrap");
    expect(region.children).toHaveLength(2);

    const ramaIzquierda = region.children[0] as HTMLElement;
    const costado = region.children[1] as HTMLElement;
    expect(ramaIzquierda.className).toContain("flex-[1_1_480px]");
    expect(costado.className).toContain("flex-[1_1_330px]");
  });

  it("«Inventario vigente» y «Abrir el proyecto» viven DENTRO de la única región nombrada", () => {
    render(<ProyectoZoom proyecto={proyecto()} inventarioEn="2026-08-20T17:02:00.000Z" />);
    const region = screen.getByRole("region", { name: "Vista ampliada de PRJ-001" });
    const enlace = screen.getByRole("link", { name: "Abrir el proyecto" });
    // Contención por DOM, no por texto: la versión anterior de esta prueba
    // afirmaba `false` aquí y lo llamaba correcto — un trinquete en la
    // dirección equivocada. Fuera de la región, «Abrir el proyecto» es un
    // `link` sin folio entre nueve tarjetas-enlace: no basta por sí solo
    // fuera de contexto (WCAG 2.4.4). La decisión de producto fue el CONTENIDO de
    // la columna, nunca que quedara fuera del landmark.
    expect(region.contains(enlace)).toBe(true);
    expect(region.textContent).toMatch(/es la fecha que imprimirá el documento/);
    // Sigue habiendo UNA sola región con este nombre — la fusión no duplicó
    // el landmark ni dejó un segundo `aria-label` suelto en la rama interna.
    expect(screen.getAllByRole("region", { name: "Vista ampliada de PRJ-001" })).toHaveLength(1);
  });
});
