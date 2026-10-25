import { describe, it, expect } from 'vitest';
import { buildIngestPayload } from '../persist';
import { computeSnapshot } from '../runEtl';
import { makeCatalogIndex, emptyPrev, realInventario, realWest, realReserva } from './helpers';
import type { SnapshotPayload, IngestJob } from '../types';

type Obj = Record<string, unknown>;
const asObjArr = (v: unknown): Obj[] => v as Obj[];
const asObj = (v: unknown): Obj => v as Obj;

function samplePayload(): SnapshotPayload {
  return {
    fuente: 'stock',
    periodo: '2026-04',
    archivo: '07ABRIL26.ods',
    capturedAt: '2026-04-07T00:00:00.000Z',
    hash: 'deadbeef',
    createdBy: 'user-1',
    marcasNuevas: ['BRAND5', 'BRAND9'],
    familiasNuevas: ['SERIES11'],
    productos: [
      { sku: 'A-1', marca: 'SERIES5', marca_id: 'm-1', tecnologia: null, producto: null, familia: 'SERIES11', familia_id: null, class: 'A', descr_origen: 'desc', cliente: 'RETAILER2', resv: 26 },
      { sku: 'A-2', marca: 'NACIONAL', marca_id: 'm-7', tecnologia: null, producto: null, familia: null, familia_id: null, class: null, descr_origen: null, cliente: null, resv: 0 },
    ],
    stock: [{ sku: 'A-1', almacen: 'NORTH', almacen_id: 'alm-1', cantidad: 10 }],
    reservas: [{ sku: 'A-1', kam: 'LAURA', kam_id: 'kam-6', cliente: 'RETAILER64', cantidad: 6, motivo: 'x', fecha: '2026-04-23' }],
    embarques: [
      { sku: 'A-1', oc_po: 'INV1', proveedor: null, referencia: 'R', factura: 'F', pais_origen: 'HK', piezas: 100, fw: 'AIR', tipo_importacion: 'MAR', fecha_recoleccion: '2031-03-27', etd: null, eta: '2031-05-12', fecha_llegada: null, fecha_disponibilidad: '2031-06-17', estatus: 'En Aduana', estatus_id: 7, proyecto: 'RETAILER9', observaciones: null, is_historial: false },
    ],
    cambios: [
      { snapshot_id: '', entidad: 'producto', clave: 'A-1', sku: 'A-1', campo: '*', valor_anterior: null, valor_nuevo: '{}', tipo: 'ALTA' },
    ],
    forzadoPor: null,
    forzadoMotivo: null,
  };
}

describe('buildIngestPayload (constructor PURO del jsonb)', () => {
  const out = buildIngestPayload(samplePayload());
  const productos = asObjArr(out.productos);
  const stock = asObjArr(out.stock);
  const reservas = asObjArr(out.reservas);
  const embarques = asObjArr(out.embarques);
  const cambios = asObjArr(out.cambios);

  it('snapshot: llaves y filas = suma de entidades', () => {
    expect(out.snapshot).toEqual({
      fuente: 'stock',
      hash: 'deadbeef',
      periodo: '2026-04',
      archivo: '07ABRIL26.ods',
      filas: 2 + 1 + 1 + 1,
      created_by: 'user-1',
      forzado_por: null,
      forzado_motivo: null,
    });
  });
  it('marcasNuevas / familiasNuevas se propagan', () => {
    expect(out.marcasNuevas).toEqual(['BRAND5', 'BRAND9']);
    expect(out.familiasNuevas).toEqual(['SERIES11']);
  });
  it('productos por-NOMBRE (marca/familia), sin marca_id/familia_id', () => {
    // [CAT-B1·A] `toEqual` ESTRICTO a proposito: es la unica alarma automatica de
    // que el payload crecio. Se actualiza con los campos nuevos; jamas se cambia
    // por `toMatchObject` para que pase, que es como se apaga un trinquete.
    expect(productos[0]).toEqual({
      sku: 'A-1', marca: 'SERIES5', tecnologia: null, producto: null, familia: 'SERIES11', class: 'A', descr_origen: 'desc', cliente: 'RETAILER2', resv: 26,
    });
    expect(productos[0]).not.toHaveProperty('marca_id');
    expect(productos[1].familia).toBeNull();
  });
  it('stock con almacen_id resuelto en JS (no clave/nombre) — M1', () => {
    expect(stock[0]).toEqual({ sku: 'A-1', almacen_id: 'alm-1', cantidad: 10 });
    expect(stock[0]).not.toHaveProperty('almacen_clave');
    expect(stock[0]).not.toHaveProperty('almacen');
  });
  it('reservas con kam_id resuelto en JS Y kam crudo (B6 · encendido) — M1', () => {
    expect(reservas[0]).toMatchObject({
      sku: 'A-1',
      kam: 'LAURA',
      kam_id: 'kam-6',
      cliente: 'RETAILER64',
      cantidad: 6,
      fecha: '2026-04-23',
    });
  });

  it('kam desconocido (kam_id null): el payload sigue llevando el kam crudo — B6 (encolado kam_desconocido en 0009)', () => {
    const p = samplePayload();
    p.reservas = [{ sku: 'A-1', kam: 'NADIA', kam_id: null, cliente: 'RETAILER64', cantidad: 6, motivo: 'x', fecha: '2026-04-23' }];
    const out = buildIngestPayload(p);
    const reservasOut = asObjArr(out.reservas);
    expect(reservasOut[0]).toEqual({
      sku: 'A-1',
      kam: 'NADIA',
      kam_id: null,
      cliente: 'RETAILER64',
      cantidad: 6,
      motivo: 'x',
      fecha: '2026-04-23',
    });
  });
  it('embarques con estatus_orden (no estatus_id)', () => {
    expect(embarques[0].estatus_orden).toBe(7);
    expect(embarques[0]).not.toHaveProperty('estatus_id');
    expect(embarques[0].is_historial).toBe(false);
  });
  it('cambios sin snapshot_id (lo pone el RPC)', () => {
    expect(cambios[0]).toEqual({
      entidad: 'producto', clave: 'A-1', sku: 'A-1', campo: '*', valor_anterior: null, valor_nuevo: '{}', tipo: 'ALTA',
    });
    expect(cambios[0]).not.toHaveProperty('snapshot_id');
  });
});

describe('buildIngestPayload sobre computeSnapshot real (serializable)', () => {
  const idx = makeCatalogIndex();
  const job: IngestJob = {
    source: 'stock',
    capturedAt: '2026-04-07T00:00:00.000Z',
    archivo: '07ABRIL26.ods',
    inventario: realInventario(),
    west: realWest(),
    reserva: realReserva(),
  };
  const { payload } = computeSnapshot(job, idx, emptyPrev());
  const jsonb = buildIngestPayload(payload);
  const productos = asObjArr(jsonb.productos);
  const reservas = asObjArr(jsonb.reservas);
  const snapshot = asObj(jsonb.snapshot);

  it('conteos consistentes y JSON-serializable', () => {
    expect(productos).toHaveLength(payload.productos.length);
    expect(snapshot.filas).toBe(
      payload.productos.length + payload.stock.length + payload.reservas.length + payload.embarques.length,
    );
    expect(() => JSON.stringify(jsonb)).not.toThrow();
  });
  it('ningún producto viaja con marca_id (dinámico: por nombre)', () => {
    expect(productos.every((p) => !('marca_id' in p) && typeof p.marca === 'string')).toBe(true);
  });
  it('reservas viajan con kam_id (resuelto en JS) Y kam crudo (B6 · encendido) — M1', () => {
    expect(reservas.every((r) => 'kam' in r && 'kam_id' in r)).toBe(true);
    // los KAM reales (LAURA/LUCAS/…) resuelven a un id no nulo
    expect(reservas.some((r) => r.kam_id !== null)).toBe(true);
  });
});
