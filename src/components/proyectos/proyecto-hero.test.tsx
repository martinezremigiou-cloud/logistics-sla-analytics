import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProyectoHero } from "./proyecto-hero";
import type { ProyectoDetalle } from "@/types/proyectos";

function detalle(overrides: Partial<ProyectoDetalle> = {}): ProyectoDetalle {
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
    partidas: [],
    vigencia: { snapshot_id: null, tomado_en: null },
    agrupacion: { eje: "sin_banda", sinBanda: 0 },
    facetas: { marcas: [], tecnologias: [] },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ProyectoHero", () => {
  it("pinta folio, chips, título, descripción y 'Fecha · … N SKUs · N pz' (plural 'SKUs', spec del detalle)", () => {
    render(<ProyectoHero detalle={detalle()} />);
    expect(screen.getByText("PRJ-001")).toBeInTheDocument();
    expect(screen.getByText("Rollout")).toBeInTheDocument();
    expect(screen.getByText("Cotización")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Rollout Retailer9 Series2 Q2" })).toBeInTheDocument();
    expect(screen.getByText("Despliegue de Series2 en 40 tiendas Retailer9 zona centro.")).toBeInTheDocument();
    expect(screen.getByText(/30 abr 2026/)).toBeInTheDocument();
    expect(screen.getByText("3 SKUs · 400 pz")).toBeInTheDocument();
  });

  it("las notas se pintan con 📌 sobre fondo ámbar SOLO cuando vienen", () => {
    const { rerender } = render(<ProyectoHero detalle={detalle({ notas: "Confirmar disponibilidad de adhesivos antes de cierre." })} />);
    const nota = screen.getByText("Confirmar disponibilidad de adhesivos antes de cierre.").closest("div");
    expect(nota?.className).toContain("bg-warn-bg");
    expect(screen.getByText("📌")).toBeInTheDocument();

    rerender(<ProyectoHero detalle={detalle({ notas: null })} />);
    expect(screen.queryByText("📌")).not.toBeInTheDocument();
  });

  // Este test decia lo contrario: "NUNCA pinta 'Responsable', el contrato no
  // trae ese dato". Era correcto sobre el contrato de ese momento, y por eso el
  // dato se omitia — pintar el correo de la SESION habria sido falso para un
  // admin mirando el proyecto de un KAM. La conclusion correcta no era omitirlo
  // sino ARREGLAR EL CONTRATO: el servicio ahora embebe `perfiles(email)`, que
  // bajo RLS resuelve al dueno real en los dos casos. La maqueta pide
  // "Responsable · ..." en la linea de metadatos y ahora se cumple.
  it("pinta 'Responsable' con el dato del contrato, ya no lo omite", () => {
    render(<ProyectoHero detalle={detalle()} />);
    expect(screen.getByText(/Responsable/)).toBeInTheDocument();
  });

  // [2.0.1-C · F-5 B1] La prueba del disparo de `fetch` para XLSX SE MUDÓ a
  // `proyecto-documento-previa.test.tsx`: el botón "Exportar Excel" ya no
  // vive en el hero, vive en el panel de la pestaña Documento.
  //
  // Y esto de abajo es la aserción REAL de que se fue, no solo un comentario
  // que lo cuenta: un comentario no impide que alguien vuelva a agregar un
  // botón de exportar aquí mismo. Control positivo incluido, para que este
  // barrido no sea él mismo una guarda vacua (P19).
  it("NO expone ningún botón de exportar — F-5 B1 los movió al panel de la pestaña Documento", () => {
    render(<ProyectoHero detalle={detalle()} />);
    const conExportar = screen
      .queryAllByRole("button")
      .filter((boton) => /exportar/i.test(boton.textContent ?? "") || /exportar/i.test(boton.getAttribute("aria-label") ?? ""));
    expect(conExportar).toEqual([]);
  });

  it("control positivo del barrido de arriba: SÍ encuentra un botón de exportar cuando existe", () => {
    const testigo = document.createElement("div");
    testigo.innerHTML = '<button aria-label="Exportar Excel de X">Exportar Excel</button>';
    const conExportar = Array.from(testigo.querySelectorAll("button")).filter(
      (boton) => /exportar/i.test(boton.textContent ?? "") || /exportar/i.test(boton.getAttribute("aria-label") ?? ""),
    );
    expect(conExportar).toHaveLength(1);
  });
});

describe("ProyectoHero · responsable (D3 aplicado a la VISTA, no al documento)", () => {
  it("pinta el correo del DUEÑO del proyecto, que puede no ser quien mira", () => {
    render(<ProyectoHero detalle={detalle({ responsable: "elena@example.com" })} />);
    expect(screen.getByText("elena@example.com")).toBeInTheDocument();
  });

  it("proyecto huerfano (cuenta borrada): lo dice, en vez de dejar la linea coja", () => {
    render(<ProyectoHero detalle={detalle({ responsable: null })} />);
    expect(screen.getByText(/sin responsable/i)).toBeInTheDocument();
  });
});
