import { describe, it, expect } from 'vitest';
import { diffEntity, collapseByKey, diffEmbarques } from '../differ';
import type { EmbarqueRow } from '../types';

function emb(oc_po: string, sku: string, estatus: string, estatus_id: number, is_historial: boolean): EmbarqueRow {
  return {
    sku, oc_po, proveedor: null, referencia: null, factura: null, pais_origen: null,
    piezas: null, fw: null, tipo_importacion: null, fecha_recoleccion: null, etd: null,
    eta: null, fecha_llegada: null, fecha_disponibilidad: null, estatus, estatus_id,
    proyecto: null, observaciones: null, is_historial,
  };
}

interface P { sku: string; resv: number; marca: string }
const key = (p: P) => p.sku;

describe('diffEntity', () => {
  it('ALTA para clave nueva', () => {
    const c = diffEntity<P>([], [{ sku: 'A', resv: 1, marca: 'X' }], key, ['resv', 'marca'], 'producto');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ tipo: 'ALTA', clave: 'A', sku: 'A', campo: '*' });
  });
  it('BAJA para clave ausente', () => {
    const c = diffEntity<P>([{ sku: 'A', resv: 1, marca: 'X' }], [], key, ['resv'], 'producto');
    expect(c[0]).toMatchObject({ tipo: 'BAJA', clave: 'A' });
  });
  it('MODIFICACION: un Cambio POR campo distinto', () => {
    const prev: P[] = [{ sku: 'A', resv: 1, marca: 'X' }];
    const next: P[] = [{ sku: 'A', resv: 2, marca: 'Y' }];
    const c = diffEntity(prev, next, key, ['resv', 'marca'], 'producto');
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.campo).sort()).toEqual(['marca', 'resv']);
    const resv = c.find((x) => x.campo === 'resv')!;
    expect(resv).toMatchObject({ tipo: 'MODIFICACION', valor_anterior: '1', valor_nuevo: '2' });
  });
  it('sin cambios → sin Cambios', () => {
    const same: P[] = [{ sku: 'A', resv: 1, marca: 'X' }];
    expect(diffEntity(same, same, key, ['resv', 'marca'], 'producto')).toHaveLength(0);
  });
});

describe('collapseByKey (embarque duplicado → estatus más avanzado)', () => {
  it('conserva el de mayor orden', () => {
    const rows = [
      { k: 'OC|SKU', orden: 3 },
      { k: 'OC|SKU', orden: 7 },
      { k: 'OC|SKU', orden: 5 },
    ];
    const out = collapseByKey(rows, (r) => r.k, (r) => r.orden);
    expect(out).toHaveLength(1);
    expect(out[0].orden).toBe(7);
  });
});

describe('diffEmbarques — históricos: ALTA en primera aparición (M2, spec §6)', () => {
  it('histórico nuevo → 1 ALTA', () => {
    const next = [emb('INV001', 'YEP6332', 'Producto Disponible', 11, true)];
    const c = diffEmbarques([], next);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ tipo: 'ALTA', clave: 'INV001|YEP6332', entidad: 'embarque' });
  });
  it('mismo histórico en 2ª ingesta → 0 cambios (nunca MOD ni BAJA)', () => {
    const prev = [emb('INV001', 'YEP6332', 'Producto Disponible', 11, true)];
    const next = [emb('INV001', 'YEP6332', 'Producto Disponible', 11, true)];
    expect(diffEmbarques(prev, next)).toHaveLength(0);
  });
  it('histórico que "cambia" estatus → 0 cambios (históricos congelados)', () => {
    const prev = [emb('INV001', 'YEP6332', 'En Aduana', 7, true)];
    const next = [emb('INV001', 'YEP6332', 'Producto Disponible', 11, true)];
    expect(diffEmbarques(prev, next)).toHaveLength(0);
  });
  it('activo nuevo → 1 ALTA (no duplicada)', () => {
    const c = diffEmbarques([], [emb('INV002', 'JV059-S', 'En Aduana', 7, false)]);
    expect(c.filter((x) => x.tipo === 'ALTA')).toHaveLength(1);
  });
  it('activo con estatus más avanzado → 1 MODIFICACION', () => {
    const prev = [emb('INV002', 'JV059-S', 'En Aduana', 7, false)];
    const next = [emb('INV002', 'JV059-S', 'Producto Disponible', 11, false)];
    const c = diffEmbarques(prev, next);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ tipo: 'MODIFICACION', campo: 'estatus', valor_anterior: 'En Aduana', valor_nuevo: 'Producto Disponible' });
  });
  it('activo ausente en la nueva → 1 BAJA', () => {
    const prev = [emb('INV002', 'JV059-S', 'En Aduana', 7, false)];
    const c = diffEmbarques(prev, []);
    expect(c).toHaveLength(1);
    expect(c[0].tipo).toBe('BAJA');
  });
  it('duplicados activos colapsan al estatus más avanzado antes de diffear', () => {
    const prev: EmbarqueRow[] = [];
    const next = [
      emb('INV002', 'CT488-J', 'En Aduana', 7, false),
      emb('INV002', 'CT488-J', 'Producto Disponible', 11, false),
    ];
    const c = diffEmbarques(prev, next);
    expect(c).toHaveLength(1); // 1 ALTA colapsada
    expect(JSON.parse(String(c[0].valor_nuevo)).estatus).toBe('Producto Disponible');
  });
});
