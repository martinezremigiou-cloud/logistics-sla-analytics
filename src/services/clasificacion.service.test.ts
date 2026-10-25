import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClasificacionBody } from '@/schemas/clasificacion.schema';
import type { BuildClasificacionResult } from '@/services/parche/clasificacion.build';

// El builder es PURO y ya está exhaustivamente cubierto por
// `clasificacion.build.test.ts` + `.integration.test.ts`: aquí se
// mockea para aislar la orquestación del service (armado de contexto,
// branching dryRun, payload de la RPC, propagación de errores).
const buildClasificacionV2Mock = vi.fn();
vi.mock('@/services/parche/clasificacion.build', () => ({
  buildClasificacionV2: (...args: unknown[]) => buildClasificacionV2Mock(...args),
}));

import { aplicarClasificacion } from './clasificacion.service';

// ------------------------------------------------------------
// Fake db: cada tabla tiene su propia cola FIFO de respuestas
// (`responses[table]`); por default resuelve `{ data: [], error: null }`.
// `range`/`limit` son terminales (mismo patrón que
// `override.service.test.ts` / `familias.service.test.ts`).
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };
type Call = { table: string; method: string; args: unknown[] };

function makeFakeDb(opts: { responses?: Partial<Record<string, Resp[]>>; rpcResponse?: Resp } = {}) {
  const responses = opts.responses ?? {};
  const calls: Call[] = [];
  const cursors: Record<string, number> = {};

  function nextResp(table: string): Resp {
    const list = responses[table] ?? [{ data: [], error: null }];
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    return list[Math.min(idx, list.length - 1)];
  }

  function chain(table: string) {
    const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
    const node = {
      select(...args: unknown[]) {
        record('select', args);
        return node;
      },
      range(...args: unknown[]) {
        record('range', args);
        return Promise.resolve(nextResp(table));
      },
      limit(...args: unknown[]) {
        record('limit', args);
        return Promise.resolve(nextResp(table));
      },
    };
    return node;
  }

  const rpcResponse: Resp = opts.rpcResponse ?? {
    data: { escritas: 3, version: 'v-test', actor: 'admin@example.com' },
    error: null,
  };
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push({ table: 'rpc', method: fn, args: [args] });
    return Promise.resolve(rpcResponse);
  });

  const db = { from: (table: string) => chain(table), rpc };
  return { db: db as unknown as SupabaseClient, calls, rpc };
}

function payload(overrides: Partial<ClasificacionBody> = {}): ClasificacionBody {
  return {
    fuente_version: '260713-v1',
    dryRun: false,
    hojas: { inventario: [['ITEM'], ['SKU-1']], west: [['ITEM']] },
    ...overrides,
  };
}

function buildResult(overrides: Partial<BuildClasificacionResult> = {}): BuildClasificacionResult {
  return {
    filas: [{ sku: 'SKU-1', tecnologia: 'EAS', marca_v2: 'BRAND5', familia_v2: 'BRAND5', clase_v2: 'A', descr_v2: 'D' }],
    catalogosNuevos: {
      tecnologiasNuevas: ['EAS'],
      familiasNuevas: [],
      marcasNuevas: [],
      marcaAliasNuevos: [],
    },
    reporte: {
      aplicables: {
        porCampo: {
          descr: { escribiria: 1, difiereDelVivo: 0 },
          familia: { escribiria: 1, difiereDelVivo: 0 },
          clase: { escribiria: 1, difiereDelVivo: 0 },
          marca: { escribiria: 1, difiereDelVivo: 0 },
          tecnologia: { escribiria: 1 },
        },
        filas: 1,
      },
      omitidos: { soloViejo: { total: 0, skus: [] }, soloNuevo: { total: 0, skus: [] } },
      cuarentena: {
        westNoResueltos: { total: 0, skus: [] },
        colisionesNormalizacion: [],
        duplicadosIntraArchivo: [],
        skusBasura: [],
      },
      catalogos: { familiasNuevas: 0, marcasNuevas: 0, tecnologiasNuevas: 1, aliasNuevos: 0 },
    },
    ...overrides,
  };
}

describe('aplicarClasificacion', () => {
  beforeEach(() => {
    buildClasificacionV2Mock.mockReset();
    buildClasificacionV2Mock.mockReturnValue(buildResult());
  });

  it('dryRun=true: NO llama a la RPC y regresa { reporte, dryRun:true }', async () => {
    const { db, calls, rpc } = makeFakeDb();

    const result = await aplicarClasificacion(db, payload({ dryRun: true }));

    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ reporte: buildResult().reporte, dryRun: true });
    expect(calls.some((c) => c.table === 'rpc')).toBe(false);
  });

  it('dryRun=false: llama la RPC con el payload correcto (filas + catálogos + fuente_version)', async () => {
    const { db, rpc } = makeFakeDb();

    const result = await aplicarClasificacion(db, payload({ dryRun: false, fuente_version: '260713-v1' }));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('aplicar_clasificacion_v2', {
      payload: {
        fuente_version: '260713-v1',
        filas: buildResult().filas,
        tecnologiasNuevas: ['EAS'],
        familiasNuevas: [],
        marcasNuevas: [],
        marcaAliasNuevos: [],
      },
    });
    expect(result).toEqual({
      reporte: buildResult().reporte,
      rpc: { escritas: 3, version: 'v-test', actor: 'admin@example.com' },
    });
  });

  it('arma el contexto del builder desde productos/familias/marcas/marca_alias (embeds aplanados)', async () => {
    const { db } = makeFakeDb({
      responses: {
        productos: [
          {
            data: [
              { sku: 'sku-1', class: 'A', descr_origen: 'Descr', marcas: { nombre: 'BRAND5' }, familias: { nombre: 'BRAND5' } },
            ],
            error: null,
          },
        ],
        familias: [{ data: [{ nombre: 'BRAND5' }], error: null }],
        marcas: [{ data: [{ nombre: 'BRAND5' }], error: null }],
        marca_alias: [{ data: [{ alias: 'BRAND 6', marcas: { nombre: 'BRAND6' } }], error: null }],
      },
    });

    await aplicarClasificacion(db, payload());

    expect(buildClasificacionV2Mock).toHaveBeenCalledTimes(1);
    const [input, contexto] = buildClasificacionV2Mock.mock.calls[0];
    expect(input).toEqual({ inventario: payload().hojas.inventario, west: payload().hojas.west });
    expect(contexto.existingSkus.has('SKU-1')).toBe(true); // normalizeSku: trim+UPPER
    expect(contexto.fuenteActual.get('SKU-1')).toEqual({ marca: 'BRAND5', familia: 'BRAND5', clase: 'A', descr: 'Descr' });
    expect(contexto.familiasVivas.has('BRAND5')).toBe(true);
    expect(contexto.marcasVivas.has('BRAND5')).toBe(true);
    expect(contexto.aliasVivos.get('brand 6')).toBe('BRAND6');
  });

  it('tecnologias no existe aún (42P01) + dryRun=true: se tolera como catálogo vacío, no lanza', async () => {
    const { db } = makeFakeDb({
      responses: {
        tecnologias: [{ data: null, error: { message: 'relation "tecnologias" does not exist', code: '42P01' } }],
      },
    });

    await expect(aplicarClasificacion(db, payload({ dryRun: true }))).resolves.toBeDefined();
  });

  it('tecnologias no existe aún (42P01) + dryRun=false: NO se tolera, lanza', async () => {
    const { db } = makeFakeDb({
      responses: {
        tecnologias: [{ data: null, error: { message: 'relation "tecnologias" does not exist', code: '42P01' } }],
      },
    });

    await expect(aplicarClasificacion(db, payload({ dryRun: false }))).rejects.toThrow();
  });

  it('error genérico (no 42P01) al verificar tecnologias: lanza incluso en dryRun', async () => {
    const { db } = makeFakeDb({
      responses: {
        tecnologias: [{ data: null, error: { message: 'conexión perdida', code: '57P01' } }],
      },
    });

    await expect(aplicarClasificacion(db, payload({ dryRun: true }))).rejects.toThrow();
  });

  it('error de la RPC: lanza (la ruta lo traduce a 500 sin fuga)', async () => {
    const { db } = makeFakeDb({
      rpcResponse: { data: null, error: { message: 'constraint boom secreto', code: '23505' } },
    });

    await expect(aplicarClasificacion(db, payload({ dryRun: false }))).rejects.toThrow();
  });

  it('error genérico cargando productos: lanza', async () => {
    const { db } = makeFakeDb({
      responses: { productos: [{ data: null, error: { message: 'sin permisos' } }] },
    });

    await expect(aplicarClasificacion(db, payload())).rejects.toThrow();
  });
});
