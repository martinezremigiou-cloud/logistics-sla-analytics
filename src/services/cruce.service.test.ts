import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

const resolveVigenteMock = vi.fn();
vi.mock('./vigente.service', () => ({
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
}));

import {
  getCruce,
  buildCruce,
  type CruceEstatusRow,
  type CruceEmbarqueRow,
} from './cruce.service';

// ------------------------------------------------------------
// Fixtures — buildCruce (PURO)
// ------------------------------------------------------------
const HOY = '2026-07-12';

/** Los 11 estatus canónicos (0004_estatus.sql), en orden. */
const ESTATUS_FIXTURE: CruceEstatusRow[] = [
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

function embarqueRow(overrides: Partial<CruceEmbarqueRow> = {}): CruceEmbarqueRow {
  return {
    id: 'emb-1',
    sku: 'A-1',
    oc_po: 'OC-1',
    proveedor: 'PROV',
    piezas: 100,
    tipo_importacion: 'MAR',
    pais_origen: 'CN',
    etd: null,
    eta: '2026-08-01',
    fecha_llegada: null,
    fecha_disponibilidad: null,
    proyecto: null,
    estatus_id: 7,
    is_historial: false,
    ...overrides,
  };
}

describe('buildCruce', () => {
  it('11 etapas siempre presentes con ceros/[] aunque no haya embarques', () => {
    const result = buildCruce({
      estatus: ESTATUS_FIXTURE,
      embarques: [],
      descrPorSku: new Map(),
      snapshot: null,
      hoy: HOY,
    });

    expect(result.etapas).toHaveLength(11);
    expect(result.etapas.map((e) => e.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const etapa of result.etapas) {
      expect(etapa.activos).toEqual({ embarques: 0, piezas: 0 });
      expect(etapa.historial).toEqual({ embarques: 0, piezas: 0 });
      expect(etapa.items).toEqual([]);
    }
    expect(result.resumen).toEqual({
      embarques_activos: 0,
      piezas_activas: 0,
      embarques_historial: 0,
      piezas_historial: 0,
    });
    expect(result.skus_activos).toEqual([]);
  });

  it('reordena las etapas si el catálogo llega desordenado', () => {
    const desordenado = [...ESTATUS_FIXTURE].reverse();
    const result = buildCruce({
      estatus: desordenado,
      embarques: [],
      descrPorSku: new Map(),
      snapshot: null,
      hoy: HOY,
    });
    expect(result.etapas.map((e) => e.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.etapas[6].nombre).toBe('En Aduana');
  });

  it('agrega activos por etapa con Σ piezas', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, piezas: 100 }),
      embarqueRow({ id: 'e2', sku: 'A-2', estatus_id: 7, piezas: 50 }),
      embarqueRow({ id: 'e3', sku: 'B-1', estatus_id: 3, piezas: 20 }),
    ];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.activos).toEqual({ embarques: 2, piezas: 150 });
    expect(etapa7.items).toHaveLength(2);

    const etapa3 = result.etapas.find((e) => e.orden === 3)!;
    expect(etapa3.activos).toEqual({ embarques: 1, piezas: 20 });
  });

  it('historial NO entra a items ni a activos, solo a historial + resumen', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false, piezas: 10 }),
      embarqueRow({ id: 'h1', sku: 'A-1', estatus_id: 7, is_historial: true, piezas: 30 }),
    ];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.items.map((i) => i.id)).toEqual(['e1']);
    expect(etapa7.activos).toEqual({ embarques: 1, piezas: 10 });
    expect(etapa7.historial).toEqual({ embarques: 1, piezas: 30 });
    expect(result.resumen).toEqual({
      embarques_activos: 1,
      piezas_activas: 10,
      embarques_historial: 1,
      piezas_historial: 30,
    });
  });

  it('piezas null suma 0 en agregados, pero el item conserva null', () => {
    const embarques = [embarqueRow({ id: 'e1', piezas: null, estatus_id: 7 })];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.activos.piezas).toBe(0);
    expect(etapa7.items[0].piezas).toBeNull();
  });

  it('orden de items: eta ASC con nulls al final, desempate por id ASC', () => {
    const e1 = embarqueRow({ id: 'e1', eta: '2026-09-01', estatus_id: 7 });
    const e2 = embarqueRow({ id: 'e2', eta: '2026-08-01', estatus_id: 7 });
    const e0 = embarqueRow({ id: 'e0', eta: '2026-08-01', estatus_id: 7 }); // mismo eta que e2, id menor
    const e3 = embarqueRow({ id: 'e3', eta: null, estatus_id: 7 });
    const e4 = embarqueRow({ id: 'e4', eta: null, estatus_id: 7 });

    const result = buildCruce({
      estatus: ESTATUS_FIXTURE,
      embarques: [e1, e2, e0, e3, e4],
      descrPorSku: new Map(),
      snapshot: null,
      hoy: HOY,
    });

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.items.map((i) => i.id)).toEqual(['e0', 'e2', 'e1', 'e3', 'e4']);
  });

  it('skus_activos: distinct + orden ASC; un SKU solo-historial NO aparece', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'B-2', estatus_id: 7, is_historial: false }),
      embarqueRow({ id: 'e2', sku: 'B-2', estatus_id: 3, is_historial: false }),
      embarqueRow({ id: 'e3', sku: 'A-1', estatus_id: 7, is_historial: false }),
      embarqueRow({ id: 'h1', sku: 'C-3', estatus_id: 7, is_historial: true }),
    ];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
    expect(result.skus_activos).toEqual(['A-1', 'B-2']);
  });

  it('invariantes: resumen == Σ etapas (activos/historial, embarques/piezas/items)', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, piezas: 10, is_historial: false }),
      embarqueRow({ id: 'e2', sku: 'A-2', estatus_id: 3, piezas: 20, is_historial: false }),
      embarqueRow({ id: 'h1', sku: 'A-1', estatus_id: 7, piezas: 5, is_historial: true }),
      embarqueRow({ id: 'h2', sku: 'A-3', estatus_id: 1, piezas: null, is_historial: true }),
    ];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });

    const sumaActivosEmbarques = result.etapas.reduce((s, e) => s + e.activos.embarques, 0);
    const sumaActivosPiezas = result.etapas.reduce((s, e) => s + e.activos.piezas, 0);
    const sumaHistorialEmbarques = result.etapas.reduce((s, e) => s + e.historial.embarques, 0);
    const sumaHistorialPiezas = result.etapas.reduce((s, e) => s + e.historial.piezas, 0);
    const sumaItems = result.etapas.reduce((s, e) => s + e.items.length, 0);

    expect(result.resumen.embarques_activos).toBe(sumaActivosEmbarques);
    expect(result.resumen.piezas_activas).toBe(sumaActivosPiezas);
    expect(result.resumen.embarques_historial).toBe(sumaHistorialEmbarques);
    expect(result.resumen.piezas_historial).toBe(sumaHistorialPiezas);
    expect(result.resumen.embarques_activos).toBe(sumaItems);
  });

  it('snapshot null propaga a la respuesta', () => {
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques: [], descrPorSku: new Map(), snapshot: null, hoy: HOY });
    expect(result.snapshot).toBeNull();
  });

  it('snapshot presente se marca vigente:true', () => {
    const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 300, archivo: 'aduana.xlsx' };
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques: [], descrPorSku: new Map(), snapshot: snap, hoy: HOY });
    expect(result.snapshot).toEqual({ ...snap, vigente: true });
  });

  it('embarque con estatus_id huérfano (sin etapa) se ignora defensivamente', () => {
    const embarques = [embarqueRow({ id: 'e1', estatus_id: 99 })];
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
    expect(result.resumen).toEqual({ embarques_activos: 0, piezas_activas: 0, embarques_historial: 0, piezas_historial: 0 });
    expect(result.etapas.every((e) => e.items.length === 0)).toBe(true);
  });

  describe('retrasado', () => {
    it('true: eta pasada sin fecha_llegada', () => {
      const embarques = [embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: null, estatus_id: 7 })];
      const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
      expect(result.etapas.find((e) => e.orden === 7)!.items[0].retrasado).toBe(true);
    });

    it('false: con fecha_llegada aunque eta ya pasó', () => {
      const embarques = [embarqueRow({ id: 'e1', eta: '2026-07-01', fecha_llegada: '2026-07-05', estatus_id: 7 })];
      const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
      expect(result.etapas.find((e) => e.orden === 7)!.items[0].retrasado).toBe(false);
    });

    it('false: eta null', () => {
      const embarques = [embarqueRow({ id: 'e1', eta: null, fecha_llegada: null, estatus_id: 7 })];
      const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
      expect(result.etapas.find((e) => e.orden === 7)!.items[0].retrasado).toBe(false);
    });

    it('false: eta igual a hoy (comparación estricta <)', () => {
      const embarques = [embarqueRow({ id: 'e1', eta: HOY, fecha_llegada: null, estatus_id: 7 })];
      const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku: new Map(), snapshot: null, hoy: HOY });
      expect(result.etapas.find((e) => e.orden === 7)!.items[0].retrasado).toBe(false);
    });
  });

  it('descripcion efectiva viene del Map; null si el sku no está', () => {
    const embarques = [
      embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7 }),
      embarqueRow({ id: 'e2', sku: 'B-2', estatus_id: 7 }),
    ];
    const descrPorSku = new Map<string, string | null>([['A-1', 'Candado industrial']]);
    const result = buildCruce({ estatus: ESTATUS_FIXTURE, embarques, descrPorSku, snapshot: null, hoy: HOY });

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.items.find((i) => i.id === 'e1')!.descripcion).toBe('Candado industrial');
    expect(etapa7.items.find((i) => i.id === 'e2')!.descripcion).toBeNull();
  });
});

// ------------------------------------------------------------
// getCruce — orquestación (fake db mínimo, thenable por tabla)
// ------------------------------------------------------------
// `code` opcional (B-PARCHE F3): shape real de `PostgrestError`, usado por los
// tests de tolerancia 42P01 de `clasificacion_v2`.
type Resp = { data: unknown; error: { message: string; code?: string } | null };

interface FakeChain {
  eq(col: string, val: unknown): FakeChain;
  in(col: string, vals: unknown[]): FakeChain;
  range(from: number, to: number): Promise<Resp>;
  then<TResult1 = Resp, TResult2 = never>(
    onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}

function makeFakeDb(responses: Partial<Record<string, Resp>>) {
  const calls: { table: string; select: string; eq: [string, unknown][]; in: [string, unknown[]] | null }[] = [];

  function chain(table: string, select: string): FakeChain {
    const eqCalls: [string, unknown][] = [];
    let inCall: [string, unknown[]] | null = null;
    const record = () => calls.push({ table, select, eq: [...eqCalls], in: inCall });
    const resp = () => responses[table] ?? { data: [], error: null };

    const node: FakeChain = {
      eq(col, val) {
        eqCalls.push([col, val]);
        return node;
      },
      in(col, vals) {
        inCall = [col, vals];
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

describe('getCruce', () => {
  beforeEach(() => {
    resolveVigenteMock.mockReset();
  });

  it('sin vigente aduana → 11 etapas vacías y NO consulta embarques/productos/overrides', async () => {
    const { db, calls } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
    });
    resolveVigenteMock.mockResolvedValueOnce(null);

    const result = await getCruce(db);

    expect(result.snapshot).toBeNull();
    expect(result.etapas).toHaveLength(11);
    expect(result.etapas.every((e) => e.items.length === 0)).toBe(true);
    expect(calls.some((c) => c.table === 'embarques')).toBe(false);
    expect(calls.some((c) => c.table === 'productos')).toBe(false);
    expect(calls.some((c) => c.table === 'productos_override')).toBe(false);
    expect(resolveVigenteMock).toHaveBeenCalledTimes(1);
    expect(resolveVigenteMock).toHaveBeenCalledWith(db, 'aduana');
  });

  it('con vigente: pinnea embarques al snapshot, arma SKUs activos distinct para productos/overrides, delega a buildCruce', async () => {
    const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 3, archivo: 'aduana.xlsx' };
    resolveVigenteMock.mockResolvedValueOnce(snap);

    const embarquesData: CruceEmbarqueRow[] = [
      embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false }),
      embarqueRow({ id: 'e2', sku: 'A-1', estatus_id: 3, is_historial: false }), // mismo sku, otra etapa
      embarqueRow({ id: 'h1', sku: 'B-2', estatus_id: 1, is_historial: true }), // solo-historial
    ];

    const { db, calls } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: embarquesData, error: null },
      productos: { data: [{ sku: 'A-1', descr_origen: 'Descr A' }], error: null },
      productos_override: { data: [], error: null },
    });

    const result = await getCruce(db);

    expect(resolveVigenteMock).toHaveBeenCalledTimes(1);
    expect(resolveVigenteMock).toHaveBeenCalledWith(db, 'aduana');
    expect(result.snapshot).toEqual({ ...snap, vigente: true });
    expect(result.skus_activos).toEqual(['A-1']);

    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.items[0]).toMatchObject({ id: 'e1', sku: 'A-1', descripcion: 'Descr A' });

    const embarquesCall = calls.find((c) => c.table === 'embarques');
    expect(embarquesCall?.eq).toEqual([['snapshot_id', 'snap-a1']]);

    const productosCall = calls.find((c) => c.table === 'productos');
    expect(productosCall?.in).toEqual(['sku', ['A-1']]);

    const overridesCall = calls.find((c) => c.table === 'productos_override');
    // [FIX-B1] Cadena fijada: el cast `as CruceOverrideRow[]` ciega a tsc, y sin
    // `campo` o `activo` `overrideActivo` descarta las descripciones capturadas.
    expect(overridesCall?.select).toBe('id,sku,campo,valor_editado,editado_en,activo');
    expect(overridesCall?.eq).toEqual([
      ['activo', true],
      ['campo', 'descripcion'],
    ]);
    expect(overridesCall?.in).toEqual(['sku', ['A-1']]);
  });

  it('override activo pisa la descr_origen en la descripción efectiva', async () => {
    const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snap);

    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
      productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
      productos_override: {
        data: [
          {
            id: 'ovr-1',
            sku: 'A-1',
            campo: 'descripcion',
            valor_editado: 'Editada',
            editado_en: '2026-07-01T00:00:00.000Z',
            activo: true,
          },
        ],
        error: null,
      },
    });

    const result = await getCruce(db);
    const etapa7 = result.etapas.find((e) => e.orden === 7)!;
    expect(etapa7.items[0].descripcion).toBe('Editada');
  });

  describe('B-PARCHE F3 — capa v2 (clasificacion_v2)', () => {
    it('item con descr_v2 y sin override → la descripción efectiva muestra la FUENTE (D-1(a): v2 congelada, ya no gana)', async () => {
      const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
      resolveVigenteMock.mockResolvedValueOnce(snap);

      const { db, calls } = makeFakeDb({
        estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
        embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
        productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
        productos_override: { data: [], error: null },
        clasificacion_v2: { data: [{ sku: 'A-1', tecnologia: null, marca_v2: null, familia_v2: null, clase_v2: null, descr_v2: 'DESCR V2' }], error: null },
      });

      const result = await getCruce(db);
      const etapa7 = result.etapas.find((e) => e.orden === 7)!;
      // La v2 SIGUE LEYÉNDOSE (la tabla no se toca, `clasificacion_v2` se
      // consulta igual — ver el `v2Call` de abajo) pero SIN precedencia: la
      // descripción que se muestra es la de `productos.descr_origen`.
      expect(etapa7.items[0].descripcion).toBe('Origen');

      // ⚠ TRINQUETE SOBRE TRABAJO MUERTO, desde D-1(a) (CAT-B1 · Tramo B,
      // 17-sep): este assert protege que `fetchClasificacionV2ParaSkus` siga
      // consultándose con la misma forma, pero su resultado ya no alimenta
      // nada — `resolverClasificacion` ignora la v2 (ver el aviso "SIN
      // CONSUMIDOR" en la declaración de esa función, cruce.service.ts). No
      // se retira: sigue siendo la prueba de que la tabla se lee igual, que
      // es justo lo que D-1(a) pidió conservar.
      const v2Call = calls.find((c) => c.table === 'clasificacion_v2');
      expect(v2Call?.select).toBe('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2');
      expect(v2Call?.in).toEqual(['sku', ['A-1']]);
    });

    it('item con descr_v2 Y override manual activo → gana el override (manual sobre v2)', async () => {
      const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
      resolveVigenteMock.mockResolvedValueOnce(snap);

      const { db } = makeFakeDb({
        estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
        embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
        productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
        productos_override: {
          data: [
            {
              id: 'ovr-1',
              sku: 'A-1',
              campo: 'descripcion',
              valor_editado: 'Editada manualmente',
              editado_en: '2026-07-01T00:00:00.000Z',
              activo: true,
            },
          ],
          error: null,
        },
        clasificacion_v2: { data: [{ sku: 'A-1', tecnologia: null, marca_v2: null, familia_v2: null, clase_v2: null, descr_v2: 'DESCR V2' }], error: null },
      });

      const result = await getCruce(db);
      const etapa7 = result.etapas.find((e) => e.orden === 7)!;
      expect(etapa7.items[0].descripcion).toBe('Editada manualmente');
    });

    it('sin fila v2 para el sku → cae a la descr_origen (comportamiento pre-parche)', async () => {
      const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
      resolveVigenteMock.mockResolvedValueOnce(snap);

      const { db } = makeFakeDb({
        estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
        embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
        productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
        productos_override: { data: [], error: null },
        clasificacion_v2: { data: [], error: null },
      });

      const result = await getCruce(db);
      const etapa7 = result.etapas.find((e) => e.orden === 7)!;
      expect(etapa7.items[0].descripcion).toBe('Origen');
    });

    it('42P01 en clasificacion_v2 (tabla aún no aplicada) → cae a descr_origen, sin lanzar', async () => {
      const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
      resolveVigenteMock.mockResolvedValueOnce(snap);

      const { db } = makeFakeDb({
        estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
        embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
        productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
        productos_override: { data: [], error: null },
        clasificacion_v2: {
          data: null,
          error: { message: 'relation "public.clasificacion_v2" does not exist', code: '42P01' },
        },
      });

      const result = await getCruce(db);
      const etapa7 = result.etapas.find((e) => e.orden === 7)!;
      expect(etapa7.items[0].descripcion).toBe('Origen');
    });

    it('error genuino (no 42P01) en clasificacion_v2 → lanza', async () => {
      const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
      resolveVigenteMock.mockResolvedValueOnce(snap);

      const { db } = makeFakeDb({
        estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
        embarques: { data: [embarqueRow({ id: 'e1', sku: 'A-1', estatus_id: 7, is_historial: false })], error: null },
        productos: { data: [{ sku: 'A-1', descr_origen: 'Origen' }], error: null },
        productos_override: { data: [], error: null },
        clasificacion_v2: { data: null, error: { message: 'timeout secreto', code: '57014' } },
      });

      await expect(getCruce(db)).rejects.toThrow(/timeout secreto/);
    });
  });

  it('con vigente pero sin embarques activos (todo historial): NO consulta productos/overrides', async () => {
    const snap: SnapshotVigente = { id: 'snap-a2', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snap);

    const { db, calls } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: [embarqueRow({ id: 'h1', sku: 'B-2', estatus_id: 1, is_historial: true })], error: null },
    });

    const result = await getCruce(db);

    expect(result.skus_activos).toEqual([]);
    expect(calls.some((c) => c.table === 'productos')).toBe(false);
    expect(calls.some((c) => c.table === 'productos_override')).toBe(false);
    // (v2) B-PARCHE F3: mismo guard que productos/overrides — tampoco se consulta v2.
    expect(calls.some((c) => c.table === 'clasificacion_v2')).toBe(false);
  });

  it('error PostgREST en estatus_catalogo → lanza (el route lo captura y responde 500 sin fuga)', async () => {
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeDb({
      estatus_catalogo: { data: null, error: { message: 'constraint boom secreto' } },
    });
    await expect(getCruce(db)).rejects.toThrow(/constraint boom secreto/);
  });

  it('error PostgREST en embarques → lanza', async () => {
    const snap: SnapshotVigente = { id: 'snap-a1', created_at: '2026-07-09T00:00:00.000Z', filas: 1, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(snap);
    const { db } = makeFakeDb({
      estatus_catalogo: { data: ESTATUS_FIXTURE, error: null },
      embarques: { data: null, error: { message: 'timeout secreto' } },
    });
    await expect(getCruce(db)).rejects.toThrow(/timeout secreto/);
  });
});
