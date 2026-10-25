import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bloqueDe, sinComentarios } from "@/lib/guardas/codigo-fuente";
import { ProyectoFotografias } from "./proyecto-fotografias";
import type { PartidaItem, ProyectoDetalle } from "@/types/proyectos";

const HOST_BUCKET = "http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes";

function partida(sku: string, imagen_url: string | null, descripcion: string | null = `Descripción de ${sku}`): PartidaItem {
  return {
    partida_id: `p-${sku}`,
    sku,
    descripcion,
    marca: "BRAND1",
    tecnologia: null,
    color: null,
    imagen_url,
    cantidad: 1,
    total: 10,
    reservado: 0,
    disponible: 10,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: null,
    eje_banda: "sin_banda",
  };
}

function detalle(partidas: PartidaItem[]): ProyectoDetalle {
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
    skus: partidas.length,
    piezas: partidas.length,
    partidas,
    vigencia: { snapshot_id: null, tomado_en: null },
    agrupacion: { eje: "sin_banda", sinBanda: partidas.length },
    facetas: { marcas: [], tecnologias: [] },
  };
}

describe("ProyectoFotografias", () => {
  it("reagrupa lo que ya viaja: rejilla con las que tienen foto, lista compacta con las que no", () => {
    const { container } = render(
      <ProyectoFotografias
        detalle={detalle([partida("A-1", `${HOST_BUCKET}/a1.png`), partida("B/2", null), partida("C-3", `${HOST_BUCKET}/c3.png`)])}
      />,
    );

    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByAltText("Fotografía de A-1")).toBeInTheDocument();
    expect(screen.getByAltText("Fotografía de C-3")).toBeInTheDocument();
    expect(screen.queryByAltText("Fotografía de B/2")).not.toBeInTheDocument();

    expect(screen.getByText("Sin fotografía cargada (1)")).toBeInTheDocument();
    expect(container.textContent).toContain("B/2");
  });

  it("la cifra concuerda con el DENOMINADOR, no con el numerador", () => {
    const unaSola = render(<ProyectoFotografias detalle={detalle([partida("A-1", `${HOST_BUCKET}/a1.png`), partida("B/2", null), partida("C-3", null)])} />);
    // «1 de 3 partidas», nunca «1 de 3 partida».
    expect(unaSola.container.textContent).toContain("1 de 3 partidas con fotografía cargada.");
    unaSola.unmount();

    const unica = render(<ProyectoFotografias detalle={detalle([partida("A-1", `${HOST_BUCKET}/a1.png`)])} />);
    expect(unica.container.textContent).toContain("1 de 1 partida con fotografía cargada.");
  });

  it("con TODAS fotografiadas no dice nada de «las demás» — una frase sobre el conjunto vacío no es comprobable", () => {
    const { container } = render(<ProyectoFotografias detalle={detalle([partida("A-1", `${HOST_BUCKET}/a1.png`), partida("C-3", `${HOST_BUCKET}/c3.png`)])} />);

    expect(container.textContent).toContain("2 de 2 partidas con fotografía cargada.");
    expect(container.textContent).not.toContain("las demás");
    expect(screen.queryByText(/Sin fotografía cargada/)).not.toBeInTheDocument();
  });

  it("sin partidas: lo dice y no pinta rejilla ni bloque de faltantes", () => {
    const { container } = render(<ProyectoFotografias detalle={detalle([])} />);
    expect(screen.getByText("Este proyecto todavía no tiene partidas.")).toBeInTheDocument();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.textContent).not.toContain("Sin fotografía cargada");
  });
});

// ============================================================
// EL LÍMITE DECLARADO, VUELTO TRINQUETE.
//
// Esta pantalla NO puede decir POR QUÉ una partida no trae fotografía propia:
// la cadena resuelta (`capa`, `motivos`) es del GENERADOR de documentos y no
// viaja al cliente. Mientras las superficies que llegan al navegador no los
// traigan, la afirmación «no puede» es un hecho del tipo, no una intención.
//
// ⚠ LA PRIMERA VERSIÓN DE ESTE TRINQUETE TENÍA DOS FUGAS, y las dos importan:
//
//   1. Miraba `PartidaItem` y esta pantalla recibe `ProyectoDetalle` — que
//      además `extends ProyectoResumen`, o sea tres cuerpos, no uno.
//   2. Buscaba los IDENTIFICADORES `capa`/`motivos`. Un campo cuyo TIPO los
//      porta —`imagen: ImagenDePartida`— lo dejaba VERDE. La guarda vigilaba la
//      palabra, no la cosa (P27).
//
// Ahora el conjunto de portadores se DERIVA del archivo (toda interfaz cuyo
// cuerpo mencione el porqué) y la cadena de herencia también. Ninguna de las
// dos es una lista que alguien tenga que acordarse de actualizar.
// ============================================================
describe("el porqué de una foto degradada NO viaja al cliente", () => {
  // `bloqueDe` empareja llaves y localiza por `indexOf`: su propio contrato
  // exige texto sin comentarios. `PartidaItem` trae ocho bloques de prosa.
  const TIPOS = sinComentarios(readFileSync(join(process.cwd(), "src/types/proyectos.ts"), "utf8"));

  /** Interfaces del archivo cuyo cuerpo menciona el porqué. Derivado, no listado. */
  function portadoresDelPorque(fuente: string): string[] {
    return Array.from(fuente.matchAll(/^export interface (\w+)/gm))
      .map((m) => m[1])
      .filter((nombre) => /\bcapa\b|\bmotivos\b/.test(bloqueDe(fuente, `export interface ${nombre}`)));
  }

  /** La interfaz y todo lo que hereda: `ProyectoDetalle extends ProyectoResumen` son DOS cuerpos. */
  function cadenaDe(fuente: string, raiz: string): string[] {
    const vistos: string[] = [];
    const pendientes = [raiz];
    while (pendientes.length > 0) {
      const nombre = pendientes.pop() as string;
      if (vistos.includes(nombre)) continue;
      vistos.push(nombre);
      const decl = fuente.match(new RegExp(`^export interface ${nombre}(?: extends ([^{]+))?\\s*\\{`, "m"));
      const padres = decl?.[1];
      if (padres) pendientes.push(...padres.split(",").map((p) => p.trim()).filter(Boolean));
    }
    return vistos;
  }

  /** Los portadores que asoman en alguna superficie que SÍ llega al navegador. */
  function fugasHaciaElCliente(fuente: string): string[] {
    const portadores = portadoresDelPorque(fuente);
    const superficies = Array.from(new Set([...cadenaDe(fuente, "PartidaItem"), ...cadenaDe(fuente, "ProyectoDetalle")]));
    const sospechosos = ["capa", "motivos", ...portadores];
    return superficies.flatMap((s) => {
      const cuerpo = bloqueDe(fuente, `export interface ${s}`);
      return sospechosos.filter((t) => new RegExp(`\\b${t}\\b`).test(cuerpo)).map((t) => `${s}.${t}`);
    });
  }

  it("ninguna superficie que llega al navegador porta el porqué — ni por nombre de campo ni por tipo", () => {
    expect(fugasHaciaElCliente(TIPOS)).toEqual([]);
  });

  it("anti-vacuidad: el barrido mira cuerpos reales, la herencia y un conjunto de portadores NO vacío", () => {
    expect(cadenaDe(TIPOS, "ProyectoDetalle")).toEqual(expect.arrayContaining(["ProyectoDetalle", "ProyectoResumen"]));
    expect(portadoresDelPorque(TIPOS)).toContain("ImagenDePartida");
    expect(bloqueDe(TIPOS, "export interface PartidaItem")).toMatch(/\bimagen_url\b/);
    expect(bloqueDe(TIPOS, "export interface ImagenDePartida")).toMatch(/\bcapa\b/);
  });

  it("control positivo: muerde la fuga POR TIPO, que es la que la versión anterior dejaba pasar", () => {
    const testigo = [
      "export interface ProyectoResumen {",
      "  folio: string;",
      "}",
      "export interface PartidaItem {",
      "  sku: string;",
      "  imagen: ImagenDePartida;", // ← ni `capa` ni `motivos` escritos, y sin embargo trae los dos
      "}",
      "export interface ProyectoDetalle extends ProyectoResumen {",
      "  partidas: PartidaItem[];",
      "}",
      "export interface ImagenDePartida {",
      "  capa: CapaImagen;",
      "  motivos: MotivoDegradacion[];",
      "}",
    ].join("\n");

    expect(fugasHaciaElCliente(testigo)).toEqual(["PartidaItem.ImagenDePartida"]);
  });

  it("control positivo: muerde también la fuga por HERENCIA, que la raíz sola no ve", () => {
    const testigo = [
      "export interface ProyectoResumen {",
      "  motivos: string[];", // ← el porqué entra por el padre, no por `ProyectoDetalle`
      "}",
      "export interface PartidaItem {",
      "  sku: string;",
      "}",
      "export interface ProyectoDetalle extends ProyectoResumen {",
      "  partidas: PartidaItem[];",
      "}",
    ].join("\n");

    expect(fugasHaciaElCliente(testigo)).toEqual(["ProyectoResumen.motivos"]);
  });
});
