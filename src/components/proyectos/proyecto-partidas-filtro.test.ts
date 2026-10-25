import { describe, it, expect } from "vitest";
import { filtrarPartidas, hayFiltrosActivos, FILTROS_PARTIDAS_VACIOS } from "./proyecto-partidas-filtro";
import type { PartidaItem } from "@/types/proyectos";

function partida(overrides: Partial<PartidaItem> = {}): PartidaItem {
  return {
    partida_id: "p1",
    sku: "SUJ500-F",
    descripcion: "Security Stand Alpha, high security",
    marca: "BRAND1",
    tecnologia: "SERIES 2",
    color: "azul",
    imagen_url: null,
    cantidad: 120,
    total: 2000,
    reservado: 463,
    disponible: 1537,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: null,
    eje_banda: "sin_banda",
    ...overrides,
  };
}

describe("hayFiltrosActivos", () => {
  it("false para FILTROS_PARTIDAS_VACIOS", () => {
    expect(hayFiltrosActivos(FILTROS_PARTIDAS_VACIOS)).toBe(false);
  });

  it("true si q trae solo espacios en blanco no cuenta (trim), pero true con texto real", () => {
    expect(hayFiltrosActivos({ ...FILTROS_PARTIDAS_VACIOS, q: "   " })).toBe(false);
    expect(hayFiltrosActivos({ ...FILTROS_PARTIDAS_VACIOS, q: "qmr" })).toBe(true);
  });

  it("true con marca, tecnologia o soloEnRiesgo activos", () => {
    expect(hayFiltrosActivos({ ...FILTROS_PARTIDAS_VACIOS, marca: "BRAND1" })).toBe(true);
    expect(hayFiltrosActivos({ ...FILTROS_PARTIDAS_VACIOS, tecnologia: "SERIES 2" })).toBe(true);
    expect(hayFiltrosActivos({ ...FILTROS_PARTIDAS_VACIOS, soloEnRiesgo: true })).toBe(true);
  });
});

describe("filtrarPartidas", () => {
  const partidas = [
    partida({ partida_id: "p1", sku: "SUJ500-F", descripcion: "Security Stand Alpha", marca: "BRAND1", tecnologia: "SERIES 2", en_riesgo: false }),
    partida({ partida_id: "p2", sku: "SUJ534-P", descripcion: "Security Stand Beta", marca: "BRAND1", tecnologia: "SERIES 2", en_riesgo: true }),
    partida({ partida_id: "p3", sku: "GRG2499", descripcion: "Series 28, 24 Pack", marca: "NACIONAL", tecnologia: "ADHESIVOS", en_riesgo: false }),
  ];

  it("sin filtros: regresa todas tal cual (mismo orden)", () => {
    expect(filtrarPartidas(partidas, FILTROS_PARTIDAS_VACIOS)).toEqual(partidas);
  });

  it("q matchea por SKU, case-insensitive", () => {
    const r = filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, q: "suj5" });
    expect(r.map((p) => p.sku)).toEqual(["SUJ500-F", "SUJ534-P"]);
  });

  it("q matchea por descripción, substring", () => {
    const r = filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, q: "pack" });
    expect(r.map((p) => p.sku)).toEqual(["GRG2499"]);
  });

  it("marca: igualdad exacta contra el valor efectivo", () => {
    const r = filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, marca: "NACIONAL" });
    expect(r.map((p) => p.sku)).toEqual(["GRG2499"]);
  });

  it("tecnologia: igualdad exacta", () => {
    const r = filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, tecnologia: "ADHESIVOS" });
    expect(r.map((p) => p.sku)).toEqual(["GRG2499"]);
  });

  it("soloEnRiesgo: solo partida.en_riesgo === true", () => {
    const r = filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, soloEnRiesgo: true });
    expect(r.map((p) => p.sku)).toEqual(["SUJ534-P"]);
  });

  it("combina TODOS los filtros con AND", () => {
    const r = filtrarPartidas(partidas, { q: "suj", marca: "BRAND1", tecnologia: "SERIES 2", soloEnRiesgo: true });
    expect(r.map((p) => p.sku)).toEqual(["SUJ534-P"]);
  });

  it("sin coincidencias: arreglo vacío", () => {
    expect(filtrarPartidas(partidas, { ...FILTROS_PARTIDAS_VACIOS, q: "zzz-no-existe" })).toEqual([]);
  });
});
