import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';
import type { SnapshotsQuery, SnapshotCambiosQuery } from '@/schemas/snapshots.schema';
import type { SnapshotResumenCambios } from '@/types';

const resolveVigenteMock = vi.fn();
const resolveVigentesMock = vi.fn();
vi.mock('./vigente.service', () => ({
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
  resolveVigentes: (...args: unknown[]) => resolveVigentesMock(...args),
}));

import {
  listSnapshots,
  buildSnapshotsPage,
  getSnapshotCambios,
  buildCambiosPage,
  type CambioRow,
  type BuildCambiosPageInput,
} from './snapshots.service';

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------
interface RawSnapshotRow {
  id: string;
  fuente: string;
  periodo: string;
  archivo: string | null;
  filas: number | null;
  hash: string;
  created_at: string;
  created_by: string | null;
  total?: { count: number }[];
  altas?: { count: number }[];
  bajas?: { count: number }[];
  mods?: { count: number }[];
}

function snapshotRow(overrides: Partial<RawSnapshotRow> = {}): RawSnapshotRow {
  return {
    id: 'snap-1',
    fuente: 'stock',
    periodo: '2026-07',
    archivo: 'archivo.xlsx',
    filas: 100,
    hash: 'hash1234567890abcdef',
    created_at: '2026-07-20T08:00:00.000Z',
    created_by: 'bridge',
    total: [{ count: 0 }],
    altas: [{ count: 0 }],
    bajas: [{ count: 0 }],
    mods: [{ count: 0 }],
    ...overrides,
  };
}

function cambioRow(overrides: Partial<CambioRow> = {}): CambioRow {
  return {
    id: 'c1',
    entidad: 'producto',
    clave: 'A-1',
    sku: 'A-1',
    campo: '*',
    valor_anterior: null,
    valor_nuevo: '{}',
    tipo: 'ALTA',
    detectado_en: '2026-07-20T10:00:00.000Z',
    ...overrides,
  };
}

function snapshotsQueryFixture(overrides: Partial<SnapshotsQuery> = {}): SnapshotsQuery {
  return { page: 1, pageSize: 20, ...overrides };
}

function cambiosQueryFixture(overrides: Partial<SnapshotCambiosQuery> = {}): SnapshotCambiosQuery {
  return { page: 1, pageSize: 50, ...overrides };
}

// ------------------------------------------------------------
// A · buildSnapshotsPage (PURO)
// ------------------------------------------------------------
describe('buildSnapshotsPage', () => {
  it('hash_corto: 12 primeros caracteres de hash', () => {
    const result = buildSnapshotsPage({
      rows: [snapshotRow({ id: 's1', hash: 'abcdefghijklmnopqrstuvwxyz' })],
      total: 1,
      page: 1,
      pageSize: 20,
      vigentes: { stock: null, aduana: null },
    });
    expect(result.items[0].hash_corto).toBe('abcdefghijkl');
  });

  it('cambios: lee cada alias [{count}] → número; ausente/vacío → 0', () => {
    const result = buildSnapshotsPage({
      rows: [snapshotRow({ id: 's1', total: undefined, altas: [{ count: 5 }], bajas: [], mods: [{ count: 2 }] })],
      total: 1,
      page: 1,
      pageSize: 20,
      vigentes: { stock: null, aduana: null },
    });
    expect(result.items[0].cambios).toEqual({ total: 0, altas: 5, bajas: 0, modificaciones: 2 });
  });

  it('vigente:true solo si el id coincide con vigentes.stock o vigentes.aduana', () => {
    const vig: SnapshotVigente = { id: 's-vig', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    const result = buildSnapshotsPage({
      rows: [snapshotRow({ id: 's-vig' }), snapshotRow({ id: 's-otro' })],
      total: 2,
      page: 1,
      pageSize: 20,
      vigentes: { stock: vig, aduana: null },
    });
    expect(result.items.find((i) => i.id === 's-vig')!.vigente).toBe(true);
    expect(result.items.find((i) => i.id === 's-otro')!.vigente).toBe(false);
  });

  it('vigentes viaja SIEMPRE, marcado vigente:true internamente, aunque no esté en items', () => {
    const vigStock: SnapshotVigente = { id: 's-stock', created_at: '2026-07-20T00:00:00.000Z', filas: 1, archivo: null };
    const result = buildSnapshotsPage({ rows: [], total: 0, page: 1, pageSize: 20, vigentes: { stock: vigStock, aduana: null } });
    expect(result.vigentes.stock).toEqual({ ...vigStock, vigente: true });
    expect(result.vigentes.aduana).toBeNull();
  });

  it('totalPages = ceil(total/pageSize)', () => {
    const result = buildSnapshotsPage({ rows: [], total: 45, page: 1, pageSize: 20, vigentes: { stock: null, aduana: null } });
    expect(result.totalPages).toBe(3);
  });

  it('archivo/filas/created_by null se preservan (no se convierten a "" / 0)', () => {
    const result = buildSnapshotsPage({
      rows: [snapshotRow({ id: 's1', archivo: null, filas: null, created_by: null })],
      total: 1,
      page: 1,
      pageSize: 20,
      vigentes: { stock: null, aduana: null },
    });
    expect(result.items[0]).toMatchObject({ archivo: null, filas: null, created_by: null });
  });
});

// ------------------------------------------------------------
// B · listSnapshots — orquestación
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null; count?: number | null };

interface FakeChain {
  eq(col: string, val: unknown): FakeChain;
  order(col: string, opts: { ascending: boolean }): FakeChain;
  range(from: number, to: number): Promise<Resp>;
  maybeSingle(): Promise<Resp>;
}

function makeFakeDb(responses: Partial<Record<string, Resp>>) {
  const calls: { table: string; select: string; selectOpts: unknown; eq: [string, unknown][]; order: [string, boolean][] }[] = [];

  function chain(table: string, select: string, selectOpts: unknown): FakeChain {
    const eqCalls: [string, unknown][] = [];
    const orderCalls: [string, boolean][] = [];
    const record = () => calls.push({ table, select, selectOpts, eq: [...eqCalls], order: [...orderCalls] });
    const resp = (): Resp => responses[table] ?? { data: null, error: null };

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
      maybeSingle() {
        record();
        return Promise.resolve(resp());
      },
    };
    return node;
  }

  const db = {
    from(table: string) {
      return { select: (select: string, opts?: unknown) => chain(table, select, opts) };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

describe('listSnapshots', () => {
  beforeEach(() => {
    resolveVigentesMock.mockReset();
  });

  it('arma el select con count exacto + los 4 alias agregados + filtros de tipo por ALTA/BAJA/MODIFICACION, ordena created_at/id DESC', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    const { db, calls } = makeFakeDb({ snapshots: { data: [snapshotRow({ id: 'snap-1' })], error: null, count: 9 } });

    const result = await listSnapshots(db, snapshotsQueryFixture());

    expect(result.total).toBe(9);
    const call = calls.find((c) => c.table === 'snapshots')!;
    expect(call.select).toBe(
      'id,fuente,periodo,archivo,filas,hash,created_at,created_by,total:cambios(count),altas:cambios(count),bajas:cambios(count),mods:cambios(count)',
    );
    expect(call.selectOpts).toEqual({ count: 'exact' });
    expect(call.eq).toEqual(
      expect.arrayContaining([
        ['altas.tipo', 'ALTA'],
        ['bajas.tipo', 'BAJA'],
        ['mods.tipo', 'MODIFICACION'],
      ]),
    );
    expect(call.order).toEqual([
      ['created_at', false],
      ['id', false],
    ]);
  });

  it('filtro fuente/periodo: agrega esos .eq() SOLO cuando vienen en la query', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    const { db, calls } = makeFakeDb({ snapshots: { data: [], error: null, count: 0 } });

    await listSnapshots(db, snapshotsQueryFixture({ fuente: 'stock', periodo: '2026-07' }));

    const call = calls.find((c) => c.table === 'snapshots')!;
    expect(call.eq).toEqual(
      expect.arrayContaining([
        ['fuente', 'stock'],
        ['periodo', '2026-07'],
      ]),
    );
  });

  it('sin fuente/periodo: NO agrega esos .eq()', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    const { db, calls } = makeFakeDb({ snapshots: { data: [], error: null, count: 0 } });

    await listSnapshots(db, snapshotsQueryFixture());

    const call = calls.find((c) => c.table === 'snapshots')!;
    expect(call.eq.some(([col]) => col === 'fuente')).toBe(false);
    expect(call.eq.some(([col]) => col === 'periodo')).toBe(false);
  });

  it('paginación: from/to derivados de page/pageSize', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    let seenFrom: number | undefined;
    let seenTo: number | undefined;
    const db = {
      from: () => ({
        select: () => {
          const node = {
            eq: () => node,
            order: () => node,
            range: (from: number, to: number) => {
              seenFrom = from;
              seenTo = to;
              return Promise.resolve({ data: [], error: null, count: 0 });
            },
          };
          return node;
        },
      }),
    } as unknown as SupabaseClient;

    await listSnapshots(db, snapshotsQueryFixture({ page: 3, pageSize: 10 }));
    expect(seenFrom).toBe(20);
    expect(seenTo).toBe(29);
  });

  it('mapea filas reales + marca vigente vía resolveVigentes', async () => {
    const vig: SnapshotVigente = { id: 'snap-vig', created_at: '2026-07-20T00:00:00.000Z', filas: 100, archivo: null };
    resolveVigentesMock.mockResolvedValueOnce({ stock: vig, aduana: null });
    const rows = [
      snapshotRow({ id: 'snap-vig', hash: 'abcdef0123456789', total: [{ count: 2634 }], altas: [{ count: 1179 }], bajas: [{ count: 876 }], mods: [{ count: 579 }] }),
      snapshotRow({ id: 'snap-otro', hash: 'zzzz999900001111' }),
    ];
    const { db } = makeFakeDb({ snapshots: { data: rows, error: null, count: 2 } });

    const result = await listSnapshots(db, snapshotsQueryFixture());

    const vigItem = result.items.find((i) => i.id === 'snap-vig')!;
    expect(vigItem.hash_corto).toBe('abcdef012345');
    expect(vigItem.cambios).toEqual({ total: 2634, altas: 1179, bajas: 876, modificaciones: 579 });
    expect(vigItem.vigente).toBe(true);

    const otroItem = result.items.find((i) => i.id === 'snap-otro')!;
    expect(otroItem.vigente).toBe(false);
  });

  it('vigentes viaja SIEMPRE completo (ambas fuentes), aunque ninguno esté en items', async () => {
    const vigStock: SnapshotVigente = { id: 'snap-stock', created_at: '2026-07-20T00:00:00.000Z', filas: 100, archivo: null };
    const vigAduana: SnapshotVigente = { id: 'snap-aduana', created_at: '2026-07-19T00:00:00.000Z', filas: 50, archivo: null };
    resolveVigentesMock.mockResolvedValueOnce({ stock: vigStock, aduana: vigAduana });
    const { db } = makeFakeDb({ snapshots: { data: [snapshotRow({ id: 'snap-otro' })], error: null, count: 1 } });

    const result = await listSnapshots(db, snapshotsQueryFixture());

    expect(result.vigentes.stock).toEqual({ ...vigStock, vigente: true });
    expect(result.vigentes.aduana).toEqual({ ...vigAduana, vigente: true });
  });

  it('count null (defensivo) → total 0, totalPages 0', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    const { db } = makeFakeDb({ snapshots: { data: [], error: null, count: null } });
    const result = await listSnapshots(db, snapshotsQueryFixture());
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  it('error PostgREST → lanza sin filtrar el mensaje interno al caller (el route lo captura)', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });
    const { db } = makeFakeDb({ snapshots: { data: null, error: { message: 'constraint boom secreto' } } });
    await expect(listSnapshots(db, snapshotsQueryFixture())).rejects.toThrow(/constraint boom secreto/);
  });
});

// ------------------------------------------------------------
// C · buildCambiosPage (PURO)
// ------------------------------------------------------------
describe('buildCambiosPage', () => {
  const SNAPSHOT_HEADER = {
    id: 'snap-1',
    fuente: 'aduana',
    periodo: '2026-07',
    archivo: 'a.xlsx',
    filas: 337,
    hash: 'hash1234567890',
    created_at: '2026-07-20T08:00:00.000Z',
    created_by: 'bridge',
    detectado_en: '2026-07-20T10:00:00.000Z',
  };
  const RESUMEN_FIXTURE: SnapshotResumenCambios = { total: 10, altas: 4, bajas: 3, modificaciones: 3 };

  function baseInput(overrides: Partial<BuildCambiosPageInput> = {}): BuildCambiosPageInput {
    return {
      snapshot: SNAPSHOT_HEADER,
      vigente: true,
      resumen: RESUMEN_FIXTURE,
      cambios: [],
      query: cambiosQueryFixture(),
      ...overrides,
    };
  }

  it('orden determinista: entidad ASC, clave ASC, campo ASC, id ASC — NUNCA detectado_en', () => {
    const cambios = [
      cambioRow({ id: 'c3', entidad: 'stock', clave: 'A-1|NORTH', campo: 'cantidad' }),
      cambioRow({ id: 'c1', entidad: 'embarque', clave: 'OC-2|A-1', campo: 'estatus' }),
      cambioRow({ id: 'c2', entidad: 'embarque', clave: 'OC-1|A-1', campo: 'estatus' }),
    ];
    const result = buildCambiosPage(baseInput({ cambios }));
    expect(result.items.map((i) => i.id)).toEqual(['c2', 'c1', 'c3']);
  });

  it('desempate por id ASC cuando entidad/clave/campo coinciden', () => {
    const cambios = [
      cambioRow({ id: 'c9', entidad: 'producto', clave: 'A-1', campo: 'descr_origen' }),
      cambioRow({ id: 'c2', entidad: 'producto', clave: 'A-1', campo: 'descr_origen' }),
    ];
    const result = buildCambiosPage(baseInput({ cambios }));
    expect(result.items.map((i) => i.id)).toEqual(['c2', 'c9']);
  });

  it('detectado_en distinto por fila NO afecta el orden (se ignora a propósito)', () => {
    const cambios = [
      cambioRow({ id: 'c2', entidad: 'producto', clave: 'A-1', campo: 'x', detectado_en: '2026-01-01T00:00:00.000Z' }),
      cambioRow({ id: 'c1', entidad: 'producto', clave: 'A-1', campo: 'x', detectado_en: '2099-01-01T00:00:00.000Z' }),
    ];
    const result = buildCambiosPage(baseInput({ cambios }));
    // Aunque c1 tenga un detectado_en "mayor", el desempate real es id ASC.
    expect(result.items.map((i) => i.id)).toEqual(['c1', 'c2']);
  });

  it('sin repetir detectado_en ni snapshot_id por item', () => {
    const cambios = [cambioRow({ id: 'c1', detectado_en: '2026-07-20T10:00:00.000Z' })];
    const result = buildCambiosPage(baseInput({ cambios }));
    expect(result.items[0]).not.toHaveProperty('detectado_en');
    expect(result.items[0]).not.toHaveProperty('snapshot_id');
  });

  describe('filtros (AND)', () => {
    const cambios = [
      cambioRow({ id: 'c1', entidad: 'embarque', tipo: 'MODIFICACION', campo: 'estatus', sku: 'A-1' }),
      cambioRow({ id: 'c2', entidad: 'producto', tipo: 'ALTA', campo: '*', sku: 'B-2' }),
      cambioRow({ id: 'c3', entidad: 'embarque', tipo: 'ALTA', campo: '*', sku: 'C-3' }),
    ];

    it('entidad', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ entidad: 'embarque' }) }));
      expect(result.items.map((i) => i.id).sort()).toEqual(['c1', 'c3']);
    });
    it('tipo', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ tipo: 'ALTA' }) }));
      expect(result.items.map((i) => i.id).sort()).toEqual(['c2', 'c3']);
    });
    it('campo (igualdad exacta)', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ campo: 'estatus' }) }));
      expect(result.items.map((i) => i.id)).toEqual(['c1']);
    });
    it('sku (igualdad exacta, sin normalizar casing)', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ sku: 'B-2' }) }));
      expect(result.items.map((i) => i.id)).toEqual(['c2']);
    });
    it('combinados (AND)', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ entidad: 'embarque', tipo: 'ALTA' }) }));
      expect(result.items.map((i) => i.id)).toEqual(['c3']);
    });
    it('sin coincidencias → items vacío, total 0 (sin lanzar)', () => {
      const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ sku: 'no-existe' }) }));
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  it('resumen viaja del snapshot COMPLETO, SIN filtros (aunque items quede acotado por el filtro)', () => {
    const cambios = [cambioRow({ id: 'c1', sku: 'A-1' }), cambioRow({ id: 'c2', sku: 'B-2' })];
    const result = buildCambiosPage(
      baseInput({ cambios, resumen: { total: 3129, altas: 1193, bajas: 1054, modificaciones: 882 }, query: cambiosQueryFixture({ sku: 'A-1' }) }),
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1); // total FILTRADO
    expect(result.resumen).toEqual({ total: 3129, altas: 1193, bajas: 1054, modificaciones: 882 }); // resumen SIN filtrar
  });

  it('snapshot.vigente pasa tal cual del input', () => {
    const result = buildCambiosPage(baseInput({ vigente: false }));
    expect(result.snapshot.vigente).toBe(false);
  });

  it('paginación: page/pageSize acotan items, total/totalPages reflejan el filtrado', () => {
    const cambios = Array.from({ length: 5 }, (_, i) => cambioRow({ id: `c${i}`, clave: `A-${i}` }));
    const result = buildCambiosPage(baseInput({ cambios, query: cambiosQueryFixture({ page: 2, pageSize: 2 }) }));
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
  });
});

// ------------------------------------------------------------
// D · getSnapshotCambios — orquestación
// ------------------------------------------------------------
function makeFakeCambiosDb(responses: { snapshots?: Resp; cambios?: Resp }) {
  const calls: { table: string; select: string; eq: [string, unknown][]; order: [string, boolean][] }[] = [];

  function chain(table: string, select: string) {
    const eqCalls: [string, unknown][] = [];
    const orderCalls: [string, boolean][] = [];
    const record = () => calls.push({ table, select, eq: [...eqCalls], order: [...orderCalls] });
    const resp = (): Resp => (table === 'snapshots' ? responses.snapshots : responses.cambios) ?? { data: null, error: null };

    const node = {
      eq(col: string, val: unknown) {
        eqCalls.push([col, val]);
        return node;
      },
      order(col: string, opts: { ascending: boolean }) {
        orderCalls.push([col, opts.ascending]);
        return node;
      },
      range() {
        record();
        return Promise.resolve(resp());
      },
      maybeSingle() {
        record();
        return Promise.resolve(resp());
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

describe('getSnapshotCambios', () => {
  beforeEach(() => {
    resolveVigenteMock.mockReset();
  });

  it('snapshot inexistente → null (el route decide 404), no resuelve vigente ni consulta cambios', async () => {
    const { db, calls } = makeFakeCambiosDb({ snapshots: { data: null, error: null } });
    const result = await getSnapshotCambios(db, 'snap-1', cambiosQueryFixture());
    expect(result).toBeNull();
    expect(resolveVigenteMock).not.toHaveBeenCalled();
    expect(calls.some((c) => c.table === 'cambios')).toBe(false);
  });

  it('snapshot existente: arma snapshot+resumen desde la misma fila, cambios vía fetchAllRows filtrado por snapshot_id', async () => {
    const row = snapshotRow({ id: 'snap-1', fuente: 'aduana', total: [{ count: 3 }], altas: [{ count: 2 }], bajas: [{ count: 1 }], mods: [{ count: 0 }] });
    const vig: SnapshotVigente = { id: 'snap-1', created_at: row.created_at, filas: row.filas, archivo: row.archivo };
    resolveVigenteMock.mockResolvedValueOnce(vig);

    const cambios = [
      cambioRow({ id: 'c1', entidad: 'embarque', clave: 'OC-1|A-1', campo: 'estatus', tipo: 'MODIFICACION' }),
      cambioRow({ id: 'c2', entidad: 'producto', clave: 'A-1', campo: '*', tipo: 'ALTA' }),
    ];
    const { db, calls } = makeFakeCambiosDb({ snapshots: { data: row, error: null }, cambios: { data: cambios, error: null } });

    const result = await getSnapshotCambios(db, 'snap-1', cambiosQueryFixture());

    expect(result).not.toBeNull();
    expect(result!.snapshot).toMatchObject({ id: 'snap-1', fuente: 'aduana', vigente: true, detectado_en: '2026-07-20T10:00:00.000Z' });
    expect(result!.resumen).toEqual({ total: 3, altas: 2, bajas: 1, modificaciones: 0 });
    expect(result!.items.map((i) => i.id)).toEqual(['c1', 'c2']); // 'embarque' < 'producto'

    const cambiosCall = calls.find((c) => c.table === 'cambios')!;
    expect(cambiosCall.eq).toEqual([['snapshot_id', 'snap-1']]);
    expect(cambiosCall.select).toBe('id,entidad,clave,sku,campo,valor_anterior,valor_nuevo,tipo,detectado_en');
    // A1 (revisor-codigo, ronda 2): sin este ORDER BY, `fetchAllRows` pagina
    // con LIMIT/OFFSET inestable en un snapshot con muchas filas de cambios
    // (varios `range()` sucesivos, cruza la cota de 1000 por página).
    expect(cambiosCall.order).toEqual([['id', true]]);

    expect(resolveVigenteMock).toHaveBeenCalledWith(db, 'aduana');
  });

  it('vigente:false cuando el id del snapshot NO coincide con el vigente de su propia fuente', async () => {
    const row = snapshotRow({ id: 'snap-viejo', fuente: 'stock' });
    resolveVigenteMock.mockResolvedValueOnce({ id: 'snap-nuevo', created_at: '2026-07-25T00:00:00.000Z', filas: 1, archivo: null });
    const { db } = makeFakeCambiosDb({ snapshots: { data: row, error: null }, cambios: { data: [], error: null } });

    const result = await getSnapshotCambios(db, 'snap-viejo', cambiosQueryFixture());
    expect(result!.snapshot.vigente).toBe(false);
  });

  it('detectado_en: se lee UNA vez en el header, NO se repite por item', async () => {
    const row = snapshotRow({ id: 'snap-1', fuente: 'aduana' });
    resolveVigenteMock.mockResolvedValueOnce(null);
    const cambios = [cambioRow({ id: 'c1', detectado_en: '2026-07-20T10:00:00.000Z' })];
    const { db } = makeFakeCambiosDb({ snapshots: { data: row, error: null }, cambios: { data: cambios, error: null } });

    const result = await getSnapshotCambios(db, 'snap-1', cambiosQueryFixture());
    expect(result!.snapshot.detectado_en).toBe('2026-07-20T10:00:00.000Z');
    expect(result!.items[0]).not.toHaveProperty('detectado_en');
  });

  it('sin filas de cambios (snapshot sin diff asociado) → detectado_en cae a created_at, sin lanzar', async () => {
    const row = snapshotRow({ id: 'snap-1', fuente: 'aduana', created_at: '2026-07-20T09:00:00.000Z' });
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeCambiosDb({ snapshots: { data: row, error: null }, cambios: { data: [], error: null } });

    const result = await getSnapshotCambios(db, 'snap-1', cambiosQueryFixture());
    expect(result!.snapshot.detectado_en).toBe('2026-07-20T09:00:00.000Z');
    expect(result!.items).toEqual([]);
  });

  it('error PostgREST en snapshots → lanza', async () => {
    const { db } = makeFakeCambiosDb({ snapshots: { data: null, error: { message: 'constraint boom secreto' } } });
    await expect(getSnapshotCambios(db, 'snap-1', cambiosQueryFixture())).rejects.toThrow(/constraint boom secreto/);
  });

  it('error PostgREST en cambios → lanza', async () => {
    const row = snapshotRow({ id: 'snap-1', fuente: 'aduana' });
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeCambiosDb({ snapshots: { data: row, error: null }, cambios: { data: null, error: { message: 'timeout secreto' } } });
    await expect(getSnapshotCambios(db, 'snap-1', cambiosQueryFixture())).rejects.toThrow(/timeout secreto/);
  });
});
