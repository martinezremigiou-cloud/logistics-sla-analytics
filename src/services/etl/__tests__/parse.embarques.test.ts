import { describe, it, expect } from 'vitest';
import { parseEmbarques } from '../parse.embarques';
import { loadSheets, realEmbarques } from './helpers';
import { MUESTRA } from './constantes-muestra';

const EDGE = MUESTRA.edge.embarques;

describe('parseEmbarques (edge)', () => {
  const { embarques } = parseEmbarques(loadSheets('edge/embarques.edge.json'));

  it("hojas 'OC ABIERTAS' y 'GARANTIAS' saltadas", () => {
    expect(embarques.find((e) => e.oc_po === EDGE.ocAbierta.oc && e.sku === EDGE.ocAbierta.sku)).toBeUndefined();
    expect(embarques.find((e) => e.sku === EDGE.garantia.sku)).toBeUndefined();
  });
  it('BRAND1: estatus por posición de header (no la leyenda vertical)', () => {
    const e = embarques.find((x) => x.sku === EDGE.activo.sku)!;
    expect(e.estatus).toBe(EDGE.activo.estatus);
    expect(e.is_historial).toBe(false);
  });
  it('TOTALES saltado (ITEM vacío)', () => {
    expect(embarques.find((e) => e.piezas === EDGE.activo.piezas && e.sku === 'TOTALES')).toBeUndefined();
  });
  it('HISTORIAL por nombre de hoja → is_historial=true, banner saltado', () => {
    const h = embarques.find((x) => x.sku === EDGE.historico.sku)!;
    expect(h.is_historial).toBe(true);
    expect(h.estatus).toBe(EDGE.historico.estatus);
    expect(h.oc_po).toBe(EDGE.historico.oc); // alias N° PO → oc_po
  });
  it('fechas parseadas a ISO', () => {
    const e = embarques.find((x) => x.sku === EDGE.activo.sku)!;
    expect(e.fecha_recoleccion).toBe(EDGE.activo.fechaRecoleccion);
    expect(e.eta).toBe(EDGE.activo.eta);
  });
});

describe('parseEmbarques (fixture de muestra, multi-hoja)', () => {
  const { embarques } = parseEmbarques(realEmbarques());
  it('parsea activos e históricos (cardinalidad por construcción del generador)', () => {
    expect(embarques.some((e) => !e.is_historial)).toBe(true);
    expect(embarques.some((e) => e.is_historial)).toBe(true);
    expect(embarques.filter((e) => e.is_historial)).toHaveLength(MUESTRA.abril.embarques.historiales);
    expect(embarques.filter((e) => !e.is_historial)).toHaveLength(MUESTRA.abril.embarques.activos);
  });
  it('ningún embarque proviene de OC ABIERTAS / GARANTIAS', () => {
    expect(embarques).toHaveLength(MUESTRA.abril.embarques.total);
    // OC ABIERTAS no tiene columna ESTATUS → hoja descartada por header
    expect(embarques.every((e) => e.estatus !== null)).toBe(true);
  });
  it('estatus siempre string no vacío en el fixture de muestra', () => {
    expect(embarques.every((e) => e.estatus.length > 0)).toBe(true);
  });
});
