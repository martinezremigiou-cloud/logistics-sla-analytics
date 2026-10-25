import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';
import type { EmbarquesQuery } from '@/schemas/embarques.schema';

const resolveVigenteMock = vi.fn();
const conVigenteStockMock = vi.fn();
vi.mock('./vigente.service', () => ({
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
}));

import { listEmbarques, buildEmbarquesPage, type EmbarquesEstatusRow, type EmbarquesEmbarqueRow } from './embarques.service';

// ------------------------------------------------------------
// Fixtures — buildEmbarquesPage (PURO)
// ------------------------------------------------------------
const HOY = '2026-07-26';

/** Los 11 estatus canónicos (0004_estatus.sql), en orden. */
const ESTATUS_FIXTURE: EmbarquesEstatusRow[] = [
  { orden: 1, nombre: 'Producto Solicitado' },
  { orden: 2, nombre: 'En Preparación' },
  { orden: 3, nombre: 'En Recolección' },
  { orden: 4, nombre: 'En Almacén FW' },
  { orden: 5, nombre: 'En Tránsito Aéreo' },
  { orden: 6, nombre: 'En Tránsito Marítimo' },
  { orden: 7, nombre: 'En Aduana' },
  { orden: 8, nombre: 'En Tránsito Terrestre' },
  { orden: 9, nombre: 'En Almacén Fiscal' },
  { orden: 10, nombre: 'En Almacén North' },
  { orden: 11, nombre: 'Producto Disponible' },
];

function embarqueRow(overrides: Partial<EmbarquesEmbarqueRow> = {}): EmbarquesEmbarqueRow {
  return {
    id: 'emb-1',
    sku: 'A-1',
    oc_po: null,
    proveedor: null,
    referencia: null,
    factura: null,
    pais_origen: null,
    piezas: null,
    fw: null,
    tipo_importacion: null,
    fecha_recoleccion: null,
    etd: null,
    eta: null,
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus_id: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    ...overrides,
  };
}

function query(overrides: Partial<EmbarquesQuery> = {}): EmbarquesQuery {
  return {
    ambito: 'todos',
    retrasado: false,
    fechaCampo: 'eta',
    orden: 'eta',
    dir: 'desc',
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

describe('buildEmbarquesPage', () => {
  it('a diferencia de El Cruce, incluye TODO (activos + histórico) por default', () => {
    const embarques = [embarqueRow({ id: 'e1', is_historial: false }), embarqueRow({ id: 'h1', is_historial: true })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.items.map((i) => i.id).sort()).toEqual(['e1', 'h1']);
    expect(result.total).toBe(2);
  });

  it('mapea sku y descripción efectiva desde el Map', () => {
    const embarques = [embarqueRow({ id: 'e1', sku: 'A-1' })];
    const descrPorSku = new Map([['A-1', 'Candado industrial']]);
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query(), hoy: HOY });
    expect(result.items[0]).toMatchObject({ sku: 'A-1', descripcion: 'Candado industrial' });
  });

  it('sku sin descripción en el Map → descripcion null', () => {
    const embarques = [embarqueRow({ id: 'e1', sku: 'Z-9' })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.items[0].descripcion).toBeNull();
  });

  it('resuelve nombre y orden de estatus desde el catálogo', () => {
    const embarques = [embarqueRow({ id: 'e1', estatus_id: 7 })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.items[0]).toMatchObject({ estatus: 'En Aduana', estatus_orden: 7 });
  });

  it('estatus_id huérfano: a diferencia de buildCruce, NUNCA descarta la fila — fallback estatus: ""', () => {
    const embarques = [embarqueRow({ id: 'e1', estatus_id: 99 })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ estatus: '', estatus_orden: 99 });
    expect(result.resumen.embarques).toBe(1);
  });

  it('proveedor viaja en el item aunque no exista filtro/faceta para él', () => {
    const embarques = [embarqueRow({ id: 'e1', proveedor: null })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.items[0].proveedor).toBeNull();
    expect(result.facetas).not.toHaveProperty('proveedores');
  });

  describe('facetas — SIEMPRE sobre el universo (nunca reaccionan al filtro)', () => {
    it('facetas.estatus: SIEMPRE las 11 etapas en orden ASC, aunque tengan conteo 0', () => {
      const embarques = [embarqueRow({ id: 'e1', estatus_id: 7 })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.facetas.estatus).toHaveLength(11);
      expect(result.facetas.estatus.map((e) => e.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      expect(result.facetas.estatus.find((e) => e.orden === 7)).toEqual({ orden: 7, nombre: 'En Aduana', conteo: 1 });
      expect(result.facetas.estatus.find((e) => e.orden === 1)).toEqual({ orden: 1, nombre: 'Producto Solicitado', conteo: 0 });
    });

    it('facetas.paises: distinct no-nulos, conteo del universo, orden ASC (string simple)', () => {
      const embarques = [
        embarqueRow({ id: 'e1', pais_origen: 'CHINA' }),
        embarqueRow({ id: 'e2', pais_origen: 'CHINA' }),
        embarqueRow({ id: 'e3', pais_origen: 'MEXICO' }),
        embarqueRow({ id: 'e4', pais_origen: null }),
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.facetas.paises).toEqual([
        { valor: 'CHINA', conteo: 2 },
        { valor: 'MEXICO', conteo: 1 },
      ]);
    });

    it('asimetría deliberada: un filtro reduce items/resumen pero NUNCA las facetas', () => {
      const embarques = [embarqueRow({ id: 'e1', pais_origen: 'CHINA' }), embarqueRow({ id: 'e2', pais_origen: 'MEXICO' })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ pais: 'china' }), hoy: HOY });
      expect(result.items).toHaveLength(1);
      expect(result.resumen.embarques).toBe(1);
      expect(result.facetas.paises).toEqual([
        { valor: 'CHINA', conteo: 1 },
        { valor: 'MEXICO', conteo: 1 },
      ]);
      expect(result.facetas.estatus.reduce((s, e) => s + e.conteo, 0)).toBe(2);
    });

    it('facetas.ambito: conteo activos/historial/todos del UNIVERSO (fix A3 — reemplaza el fetch auxiliar ?pageSize=1 de las tabs)', () => {
      const embarques = [
        embarqueRow({ id: 'e1', is_historial: false }),
        embarqueRow({ id: 'e2', is_historial: false }),
        embarqueRow({ id: 'h1', is_historial: true }),
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.facetas.ambito).toEqual({ todos: 3, activos: 2, historial: 1 });
    });

    it('facetas.ambito NO reacciona a `ambito`/otros filtros (mismo criterio que estatus/paises)', () => {
      const embarques = [
        embarqueRow({ id: 'e1', is_historial: false }),
        embarqueRow({ id: 'e2', is_historial: false }),
        embarqueRow({ id: 'h1', is_historial: true }),
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ ambito: 'activos' }), hoy: HOY });
      expect(result.items).toHaveLength(2);
      expect(result.facetas.ambito).toEqual({ todos: 3, activos: 2, historial: 1 });
    });
  });

  describe('filtro q (sku, oc_po, referencia, factura, descripción — NO observaciones)', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'CAND-1', oc_po: 'OC-100', referencia: 'REF-A', factura: 'FAC-1', observaciones: 'nota con BUSCABLE adentro' }),
      embarqueRow({ id: 'e2', sku: 'SENS-2', oc_po: 'OC-200', referencia: 'REF-B', factura: 'FAC-2' }),
    ];
    const descrPorSku = new Map([
      ['CAND-1', 'Candado industrial'],
      ['SENS-2', 'Sensor EAS'],
    ]);

    it('substring case-insensitive sobre sku', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'cand-1' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('substring sobre oc_po', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'oc-200' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e2']);
    });

    it('substring sobre referencia', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'ref-a' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('substring sobre factura', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'fac-2' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e2']);
    });

    it('substring sobre la descripción efectiva', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'sensor' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e2']);
    });

    it('NO matchea sobre observaciones (a propósito: texto largo que arruinaría la búsqueda)', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, query: query({ q: 'buscable' }), hoy: HOY });
      expect(result.items).toEqual([]);
    });
  });

  describe('filtro ambito', () => {
    const embarques = [embarqueRow({ id: 'e1', is_historial: false }), embarqueRow({ id: 'h1', is_historial: true })];

    it('todos (default): incluye ambos', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.items.map((i) => i.id).sort()).toEqual(['e1', 'h1']);
    });

    it('activos: solo is_historial=false', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ ambito: 'activos' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('historial: solo is_historial=true', () => {
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ ambito: 'historial' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['h1']);
    });
  });

  it('filtro estatus: igualdad exacta sobre estatus_orden', () => {
    const embarques = [embarqueRow({ id: 'e1', estatus_id: 7 }), embarqueRow({ id: 'e2', estatus_id: 3 })];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ estatus: 7 }), hoy: HOY });
    expect(result.items.map((i) => i.id)).toEqual(['e1']);
  });

  describe('filtro pais', () => {
    it('igualdad case-insensitive', () => {
      const embarques = [embarqueRow({ id: 'e1', pais_origen: 'China' })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ pais: 'CHINA' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('NULL nunca matchea', () => {
      const embarques = [embarqueRow({ id: 'e1', pais_origen: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ pais: 'china' }), hoy: HOY });
      expect(result.items).toEqual([]);
    });
  });

  describe('filtro retrasado', () => {
    it('true: solo retrasados', () => {
      const embarques = [
        embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: null }), // retrasado
        embarqueRow({ id: 'e2', eta: '2026-08-01', fecha_llegada: null }), // futuro
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ retrasado: true }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('false (default): sin filtro, incluye retrasados y no-retrasados', () => {
      const embarques = [
        embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: null }),
        embarqueRow({ id: 'e2', eta: '2026-08-01', fecha_llegada: null }),
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ retrasado: false }), hoy: HOY });
      expect(result.items.map((i) => i.id).sort()).toEqual(['e1', 'e2']);
    });

    // Fix [INV-B7A]: hallazgo verificado en vivo — varias filas is_historial=true
    // con ETA vencida, `fecha_disponibilidad` llena y SIN `fecha_llegada` (la
    // mercancía ya llegó; la fuente simplemente nunca llenó ese campo). El
    // retraso solo aplica a embarques EN CURSO: un histórico ya cerró su
    // ciclo y no puede estar "retrasado".
    it('fila histórica con ETA vencida y sin fecha_llegada: retrasado=false, no cuenta en resumen.retrasados', () => {
      const embarques = [embarqueRow({ id: 'h1', is_historial: true, eta: '2026-06-24', fecha_llegada: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.items[0].retrasado).toBe(false);
      expect(result.resumen.retrasados).toBe(0);
    });

    it('fila activa con ETA vencida y sin fecha_llegada: retrasado=true, sí cuenta en resumen.retrasados (caso que debe seguir funcionando)', () => {
      const embarques = [embarqueRow({ id: 'e1', is_historial: false, eta: '2026-06-24', fecha_llegada: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
      expect(result.items[0].retrasado).toBe(true);
      expect(result.resumen.retrasados).toBe(1);
    });

    it('?retrasado=1 no devuelve filas históricas, aunque tengan ETA vencida y sin fecha_llegada', () => {
      const embarques = [
        embarqueRow({ id: 'h1', is_historial: true, eta: '2026-06-24', fecha_llegada: null }),
        embarqueRow({ id: 'e1', is_historial: false, eta: '2026-06-24', fecha_llegada: null }),
      ];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ retrasado: true }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });
  });

  describe('rango de fechas (desde/hasta) sobre fechaCampo', () => {
    it('extremos INCLUSIVOS (fechaCampo=eta, default)', () => {
      const embarques = [
        embarqueRow({ id: 'e1', eta: '2026-08-01' }),
        embarqueRow({ id: 'e2', eta: '2026-08-05' }),
        embarqueRow({ id: 'e3', eta: '2026-08-10' }),
      ];
      const result = buildEmbarquesPage({
        estatus: ESTATUS_FIXTURE,
        embarques,
        descrPorSku: new Map(),
        snapshot: null,
        query: query({ desde: '2026-08-01', hasta: '2026-08-05' }),
        hoy: HOY,
      });
      expect(result.items.map((i) => i.id).sort()).toEqual(['e1', 'e2']);
    });

    it('con al menos un extremo presente, las filas con NULL en el campo elegido quedan FUERA', () => {
      const embarques = [embarqueRow({ id: 'e1', eta: '2026-08-01' }), embarqueRow({ id: 'e2', eta: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ desde: '2026-08-01' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('fechaCampo=etd usa etd, no eta', () => {
      const embarques = [embarqueRow({ id: 'e1', etd: '2026-07-01', eta: null }), embarqueRow({ id: 'e2', etd: '2026-09-01', eta: null })];
      const result = buildEmbarquesPage({
        estatus: ESTATUS_FIXTURE,
        embarques,
        descrPorSku: new Map(),
        snapshot: null,
        query: query({ fechaCampo: 'etd', desde: '2026-06-01', hasta: '2026-08-01' }),
        hoy: HOY,
      });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });

    it('fechaCampo=llegada usa fecha_llegada', () => {
      const embarques = [
        embarqueRow({ id: 'e1', fecha_llegada: '2026-07-15', eta: null }),
        embarqueRow({ id: 'e2', fecha_llegada: null, eta: '2026-07-15' }),
      ];
      const result = buildEmbarquesPage({
        estatus: ESTATUS_FIXTURE,
        embarques,
        descrPorSku: new Map(),
        snapshot: null,
        query: query({ fechaCampo: 'llegada', desde: '2026-07-01', hasta: '2026-07-31' }),
        hoy: HOY,
      });
      expect(result.items.map((i) => i.id)).toEqual(['e1']);
    });
  });

  describe('orden estable', () => {
    it('orden=piezas asc: nulls al final', () => {
      const embarques = [embarqueRow({ id: 'e1', piezas: 30 }), embarqueRow({ id: 'e2', piezas: 10 }), embarqueRow({ id: 'e3', piezas: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'piezas', dir: 'asc' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e2', 'e1', 'e3']);
    });

    it('orden=piezas desc: nulls SIGUEN al final (no se invierten con dir)', () => {
      const embarques = [embarqueRow({ id: 'e1', piezas: 30 }), embarqueRow({ id: 'e2', piezas: 10 }), embarqueRow({ id: 'e3', piezas: null })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'piezas', dir: 'desc' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1', 'e2', 'e3']);
    });

    it('desempate id ASC SIEMPRE, incluso con dir=desc', () => {
      const embarques = [embarqueRow({ id: 'e2', piezas: 10 }), embarqueRow({ id: 'e1', piezas: 10 })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'piezas', dir: 'desc' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e1', 'e2']);
    });

    it('orden=sku asc', () => {
      const embarques = [embarqueRow({ id: 'e1', sku: 'B-2' }), embarqueRow({ id: 'e2', sku: 'A-1' })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'sku', dir: 'asc' }), hoy: HOY });
      expect(result.items.map((i) => i.sku)).toEqual(['A-1', 'B-2']);
    });

    it('orden=estatus desc', () => {
      const embarques = [embarqueRow({ id: 'e1', estatus_id: 3 }), embarqueRow({ id: 'e2', estatus_id: 9 })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'estatus', dir: 'desc' }), hoy: HOY });
      expect(result.items.map((i) => i.id)).toEqual(['e2', 'e1']);
    });

    it('orden=eta/etd/llegada respetan su propio campo (no se confunden entre sí)', () => {
      const embarques = [
        embarqueRow({ id: 'e1', eta: '2026-09-01', etd: '2026-06-01', fecha_llegada: '2026-09-05' }),
        embarqueRow({ id: 'e2', eta: '2026-08-01', etd: '2026-07-01', fecha_llegada: '2026-09-01' }),
      ];
      const porEta = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'eta', dir: 'asc' }), hoy: HOY });
      expect(porEta.items.map((i) => i.id)).toEqual(['e2', 'e1']);
      const porEtd = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'etd', dir: 'asc' }), hoy: HOY });
      expect(porEtd.items.map((i) => i.id)).toEqual(['e1', 'e2']);
      const porLlegada = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ orden: 'llegada', dir: 'asc' }), hoy: HOY });
      expect(porLlegada.items.map((i) => i.id)).toEqual(['e2', 'e1']);
    });
  });

  describe('paginación', () => {
    it('page/pageSize acotan items; total/totalPages reflejan el filtrado completo', () => {
      const embarques = Array.from({ length: 5 }, (_, i) => embarqueRow({ id: `e${i}`, sku: `SKU-${i}` }));
      const result = buildEmbarquesPage({
        estatus: ESTATUS_FIXTURE,
        embarques,
        descrPorSku: new Map(),
        snapshot: null,
        query: query({ orden: 'sku', dir: 'asc', page: 2, pageSize: 2 }),
        hoy: HOY,
      });
      expect(result.items.map((i) => i.sku)).toEqual(['SKU-2', 'SKU-3']);
      expect(result.total).toBe(5);
      expect(result.totalPages).toBe(3);
    });

    it('página fuera de rango → items vacío, total/totalPages reales (sin error)', () => {
      const embarques = [embarqueRow({ id: 'e1' })];
      const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ page: 9 }), hoy: HOY });
      expect(result.items).toEqual([]);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  it('resumen se calcula sobre el FILTRADO, no sobre el universo', () => {
    const embarques = [
      embarqueRow({ id: 'e1', is_historial: false, piezas: 10, pais_origen: 'CHINA' }),
      embarqueRow({ id: 'e2', is_historial: true, piezas: 20, pais_origen: 'CHINA' }),
      embarqueRow({ id: 'e3', is_historial: false, piezas: 5, pais_origen: 'MEXICO' }),
    ];
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, query: query({ pais: 'china' }), hoy: HOY });
    expect(result.resumen).toEqual({ embarques: 2, piezas: 30, activos: 1, historial: 1, piezas_activas: 10, retrasados: 0 });
  });

  it('snapshot null propaga a la respuesta', () => {
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques: [], descrPorSku: new Map(), snapshot: null, query: query(), hoy: HOY });
    expect(result.snapshot).toBeNull();
  });

  it('snapshot presente se marca vigente:true', () => {
    const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-20T00:00:00.000Z', filas: 337, archivo: 'aduana.xlsx' };
    const result = buildEmbarquesPage({ estatus: ESTATUS_FIXTURE, embarques: [], descrPorSku: new Map(), snapshot: snap, query: query(), hoy: HOY });
    expect(result.snapshot).toEqual({ ...snap, vigente: true });
  });

  // ------------------------------------------------------------
  // Test de propiedad OBLIGATORIO: la paginación no debe barajar filas.
  // Universo sintético de 337 filas (tamaño inventado, de varias páginas),
  // con MUCHOS empates deliberados (fechas/piezas/estatus repetidos y
  // nulos) para forzar el desempate por id. Para los 6 órdenes × 2
  // direcciones, paginar con pageSize=50 debe cubrir exactamente las 337
  // filas, sin duplicados ni faltantes.
  //
  // FIX A2 (revisor-codigo, ronda 2 de [INV-B7A]): la versión anterior de
  // este test reusaba el MISMO array `UNIVERSO`, en el MISMO orden, en las
  // 8 iteraciones del loop de abajo. El `sort` de V8 es estable, así que
  // borrar el desempate por `id` (dejar `return 0;` en vez de
  // `return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;`, `compararEmbarques`,
  // embarques.service.ts:148) dejaba el test en VERDE de todas formas: cada
  // "página" volvía a ordenar la MISMA secuencia de entrada, así que el
  // orden relativo de los empates era idéntico en las 8 iteraciones y el
  // `slice` nunca podía chocar consigo mismo — el test solo ejercitaba la
  // aritmética del `slice`, nunca la estabilidad entre requests que dice
  // cubrir (el riesgo real: dos requests HTTP donde Postgres/PostgREST
  // devuelve las mismas filas en OTRO orden físico, ver A1 más arriba en
  // este archivo).
  //
  // Se simula ESE reordenamiento físico permutando el universo con un seed
  // determinista por página (`shuffleDeterminista(UNIVERSO, page)`, mismo
  // seed ⇒ misma permutación, reproducible): cada iteración del loop pasa
  // una copia del universo en un orden de entrada DISTINTO a
  // `buildEmbarquesPage`, como si fuera una request HTTP independiente.
  // Con el desempate real por `id`, el comparador es un orden total
  // (nunca hay un verdadero empate) y el resultado es el MISMO
  // independientemente del orden de entrada — las páginas siguen sin
  // solaparse. Sin él, el orden relativo de cada grupo empatado depende de
  // CÓMO llegó permutado en esa iteración, así que el mismo id puede caer
  // en el rango de dos páginas distintas (duplicado) o en ninguna
  // (faltante) entre iteraciones.
  //
  // Mutante que este test mata: `compararEmbarques` con `return 0;` en vez
  // del desempate real (embarques.service.ts:148). Demostración (rojo/verde)
  // documentada en la entrega de esta ronda.
  // ------------------------------------------------------------
  describe('orden estable — propiedad (paginación sin pérdidas ni duplicados)', () => {
    function makeUniverso(n: number): EmbarquesEmbarqueRow[] {
      const etas = [null, '2026-07-01', '2026-08-01', '2026-08-01', '2026-09-15'];
      const etds = [null, '2026-06-01', '2026-06-15'];
      const llegadas = [null, '2026-07-10'];
      const piezasOpciones = [null, 0, 10, 10, 250];
      const skus = Array.from({ length: 20 }, (_, i) => `SKU-${String(i).padStart(3, '0')}`);
      return Array.from({ length: n }, (_, i) => ({
        id: `id-${String(i).padStart(4, '0')}`,
        sku: skus[i % skus.length],
        oc_po: null,
        proveedor: null,
        referencia: null,
        factura: null,
        pais_origen: null,
        piezas: piezasOpciones[i % piezasOpciones.length],
        fw: null,
        tipo_importacion: null,
        fecha_recoleccion: null,
        etd: etds[i % etds.length],
        eta: etas[i % etas.length],
        fecha_llegada: llegadas[i % llegadas.length],
        fecha_disponibilidad: null,
        estatus_id: (i % 11) + 1,
        proyecto: null,
        observaciones: null,
        is_historial: i % 3 === 0,
      }));
    }

    /**
     * PRNG determinista (mulberry32): mismo `seed` ⇒ misma secuencia,
     * SOLO para permutar el universo de forma reproducible (nunca
     * aleatoriedad real) — sin esto ni el fallo del mutante ni la
     * demostración de esta ronda serían reproducibles entre corridas.
     */
    function mulberry32(seed: number): () => number {
      let a = seed;
      return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    /**
     * Shuffle Fisher-Yates determinista (mismo `seed` ⇒ misma permutación).
     * Simula que una request HTTP independiente recibe las MISMAS filas en
     * OTRO orden físico (ver doc-comment de arriba: escenario real sin el
     * `.order('id')` de fix A1).
     */
    function shuffleDeterminista<T>(arr: readonly T[], seed: number): T[] {
      const out = [...arr];
      const rand = mulberry32(seed);
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }

    const UNIVERSO = makeUniverso(337);
    const ORDENES: EmbarquesQuery['orden'][] = ['eta', 'etd', 'llegada', 'sku', 'estatus', 'piezas'];
    const DIRECCIONES: EmbarquesQuery['dir'][] = ['asc', 'desc'];
    const COMBINACIONES = ORDENES.flatMap((orden) => DIRECCIONES.map((dir) => ({ orden, dir })));

    it.each(COMBINACIONES)('orden=$orden dir=$dir: paginar con pageSize=50 cubre las 337 filas exactamente una vez', ({ orden, dir }) => {
      const PAGE_SIZE = 50;
      const MAX_PAGINAS = 10; // 337/50 ≈ 6.74 → 7 páginas reales; margen defensivo contra loop infinito.
      const idsVistos = new Set<string>();

      for (let page = 1; page <= MAX_PAGINAS; page++) {
        // Cada página = una request HTTP independiente: el universo llega
        // permutado (seed=page, ver doc-comment de arriba) ANTES de que
        // `buildEmbarquesPage` filtre/ordene/pagine.
        const universoDeLaRequest = shuffleDeterminista(UNIVERSO, page);
        const result = buildEmbarquesPage({
          estatus: ESTATUS_FIXTURE,
          embarques: universoDeLaRequest,
          descrPorSku: new Map(),
          snapshot: null,
          query: query({ orden, dir, page, pageSize: PAGE_SIZE }),
          hoy: HOY,
        });
        if (result.items.length === 0) break;
        for (const it of result.items) {
          expect(idsVistos.has(it.id)).toBe(false);
          idsVistos.add(it.id);
        }
      }

      expect(idsVistos.size).toBe(337);
    });
  });
});

// ------------------------------------------------------------
// listEmbarques — orquestación (fake db mínimo, thenable por tabla)
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };

interface FakeChain {
  eq(col: string, val: unknown): FakeChain;
  order(col: string, opts: { ascending: boolean }): FakeChain;
  range(from: number, to: number): Promise<Resp>;
  then<TResult1 = Resp, TResult2 = never>(
    onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

function makeFakeDb(responses: Partial<Record<string, Resp>>) {
  const calls: { table: string; select: string; eq: [string, unknown][]; order: [string, boolean][] }[] = [];

  function chain(table: string, select: string): FakeChain {
    const eqCalls: [string, unknown][] = [];
    const orderCalls: [string, boolean][] = [];
    const record = () => calls.push({ table, select, eq: [...eqCalls], order: [...orderCalls] });
    const resp = () => responses[table] ?? { data: [], error: null };

    const node: FakeChain = {
      eq(col, val) {
        eqCalls.push([col, val]);
        return node;
      },
      order(col, opts) {
        orderCalls.push([col, opts.ascending]);
        return node;
      },
      range() {
        record();
        return Promise.resolve(resp());
      },
      then(onfulfilled, onrejected) {
        record();
        return Promise.resolve(resp()).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const db = {
    from(table: string) {
      return { select: (select: string) => chain(table, select) };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

describe('listEmbarques', () => {
  beforeEach(() => {
    resolveVigenteMock.mockReset();
    conVigenteStockMock.mockReset();
  });

  it('sin vigente aduana → "vacío digno": snapshot null, sin items, NO consulta embarques/productos', async () => {
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db, calls } = makeFakeDb({ estatus_catalogo: { data: ESTATUS_FIXTURE, error: null } });

    const result = await listEmbarques(db, query());

    expect(result.snapshot).toBeNull();
    expect(result.items).toEqual([]);
    expect(result.facetas.estatus).toHaveLength(11);
    expect(calls.some((c) => c.table === 'embarques')).toBe(false);
    expect(conVigenteStockMock).not.toHaveBeenCalled();
    expect(resolveVigenteMock).toHaveBeenCalledWith(db, 'aduana');
  });

  it('con vigente aduana: pinnea embarques a ese snapshot y resuelve descripciones vía conVigenteStock (patrón inventory.service.ts, sin .in())', async () => {
    const snapAduana: SnapshotVigente = { id: 'snap-adu-1', created_at: '2026-07-20T00:00:00.000Z', filas: 337, archivo: 'aduana.xlsx' };
    const snapStock: SnapshotVigente = { id: 'snap-stock-1', created_at: '2026-07-20T00:00:00.000Z', filas: 2400, archivo: 'stock.xlsx' };
    resolveVigenteMock.mockResolvedValueOnce(snapAduana);
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) => fetcher(snapStock));

    const { db, calls } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7 })], error: null },
      productos: { data: [{ sku: 'A-1', descr_origen: 'Descr A' }], error: null },
      productos_override: { data: [], error: null },
      clasificacion_v2: { data: [], error: null },
    });

    const result = await listEmbarques(db, query());

    expect(result.snapshot).toEqual({ ...snapAduana, vigente: true });
    expect(result.items[0]).toMatchObject({ id: 'e1', sku: 'A-1', descripcion: 'Descr A' });

    const embarquesCall = calls.find((c) => c.table === 'embarques');
    expect(embarquesCall?.eq).toEqual([['snapshot_id', 'snap-adu-1']]);
    expect(embarquesCall?.select).toBe(
      'id,sku,oc_po,proveedor,referencia,factura,pais_origen,piezas,fw,tipo_importacion,fecha_recoleccion,etd,eta,fecha_llegada,fecha_disponibilidad,estatus_id,proyecto,observaciones,is_historial',
    );
    // A1 (revisor-codigo, ronda 2): sin este ORDER BY, `fetchAllRows`
    // pagina con LIMIT/OFFSET inestable en cuanto la tabla cruce 1000 filas.
    expect(embarquesCall?.order).toEqual([['id', true]]);

    const productosCall = calls.find((c) => c.table === 'productos');
    expect(productosCall?.select).toBe('sku,descr_origen');
    expect(productosCall?.eq).toEqual([['snapshot_id', 'snap-stock-1']]);

    const overridesCall = calls.find((c) => c.table === 'productos_override');
    expect(overridesCall?.eq).toEqual([
      ['activo', true],
      ['campo', 'descripcion'],
    ]);

    const v2Call = calls.find((c) => c.table === 'clasificacion_v2');
    expect(v2Call?.select).toBe('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2');
  });

  it('sin vigente de stock (conVigenteStock → null): embarques se sirven igual, sin descripción', async () => {
    const snapAduana: SnapshotVigente = { id: 'snap-adu-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snapAduana);
    conVigenteStockMock.mockResolvedValueOnce(null);

    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1' })], error: null },
    });

    const result = await listEmbarques(db, query());
    expect(result.items[0]).toMatchObject({ id: 'e1', descripcion: null });
  });

  it('override manual activo gana sobre descr_origen (3 capas, manual > v2 > fuente)', async () => {
    const snapAduana: SnapshotVigente = { id: 'snap-adu-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    const snapStock: SnapshotVigente = { id: 'snap-stock-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snapAduana);
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) => fetcher(snapStock));

    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1' })], error: null },
      productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
      productos_override: {
        data: [{ id: 'ovr-1', sku: 'A-1', campo: 'descripcion', valor_editado: 'Editada', editado_en: '2026-07-01T00:00:00.000Z', activo: true }],
        error: null,
      },
      clasificacion_v2: { data: [], error: null },
    });

    const result = await listEmbarques(db, query());
    expect(result.items[0].descripcion).toBe('Editada');
  });

  it('42P01 en clasificacion_v2 (tabla aún no aplicada) → no lanza, cae a manual/fuente', async () => {
    const snapAduana: SnapshotVigente = { id: 'snap-adu-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    const snapStock: SnapshotVigente = { id: 'snap-stock-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snapAduana);
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) => fetcher(snapStock));

    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1' })], error: null },
      productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
      productos_override: { data: [], error: null },
      clasificacion_v2: { data: null, error: { message: 'relation "public.clasificacion_v2" does not exist', code: '42P01' } },
    });

    const result = await listEmbarques(db, query());
    expect(result.items[0].descripcion).toBe('Origen');
  });

  it('error PostgREST en estatus_catalogo → lanza', async () => {
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeDb({ estatus_catalogo: { data: null, error: { message: 'constraint boom secreto' } } });
    await expect(listEmbarques(db, query())).rejects.toThrow(/constraint boom secreto/);
  });

  it('error PostgREST en embarques → lanza', async () => {
    const snapAduana: SnapshotVigente = { id: 'snap-adu-1', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snapAduana);
    conVigenteStockMock.mockResolvedValueOnce(new Map());
    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: null, error: { message: 'timeout secreto' } },
    });
    await expect(listEmbarques(db, query())).rejects.toThrow(/timeout secreto/);
  });
});
