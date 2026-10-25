import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Descuadre } from './derivaciones';

const fetchDescuadresVigentesMock = vi.fn();
vi.mock('./dashboard.service', () => ({
  fetchDescuadresVigentes: (...args: unknown[]) => fetchDescuadresVigentesMock(...args),
}));

import { listPendientes, resolverPendiente, resolverFamiliaNueva } from './pendientes.service';
import type { ResolverPendienteBody } from '@/schemas/pendientes.schema';

// ------------------------------------------------------------
// Fake db mínimo: `pendientes_datos` (select→order→range) + `.rpc()`.
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };

function makeFakeDb(
  pendientesResp: Resp,
  rpcHandler: (name: string, args: unknown) => Resp = () => ({ data: null, error: null }),
  // (MVP-CIERRE F2) `listPendientes` ahora también lee `public.tecnologias`
  // (el vocabulario declarado que la bandeja ofrece al resolver
  // `sku_sin_tecnologia`). Ese camino usa `.eq().order()` y termina en un
  // await directo, no en `.range()`.
  tecnologiasResp: Resp = { data: [{ nombre: 'EAS' }, { nombre: 'BRAND1' }], error: null },
) {
  const calls: { method: string; args: unknown[] }[] = [];

  const chain = {
    order(...args: unknown[]) {
      calls.push({ method: 'order', args });
      return chain;
    },
    range(...args: unknown[]) {
      calls.push({ method: 'range', args });
      return Promise.resolve(pendientesResp);
    },
  };

  const chainTecnologias = {
    eq(...args: unknown[]) {
      calls.push({ method: 'eq', args });
      return chainTecnologias;
    },
    order(...args: unknown[]) {
      calls.push({ method: 'order', args });
      return Promise.resolve(tecnologiasResp);
    },
  };

  const db = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      const esTecnologias = table === 'tecnologias';
      return {
        select: (sel: string) => {
          calls.push({ method: 'select', args: [sel] });
          return esTecnologias ? chainTecnologias : chain;
        },
      };
    },
    rpc(name: string, args?: unknown) {
      calls.push({ method: 'rpc', args: [name, args] });
      return Promise.resolve(rpcHandler(name, args));
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

function pendienteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    tipo: 'kam_desconocido',
    clave_natural: 'nadia',
    estado: 'abierto',
    payload: { kam_raw: 'NADIA' },
    detectado_por: 'etl',
    detectado_en: '2026-07-19T00:00:00.000Z',
    snapshot_id: 'snap-9',
    resolucion: null,
    resuelto_por: null,
    resuelto_en: null,
    ...overrides,
  };
}

const RPC_CONTEOS_OK = () => ({ data: { abiertos: 2, por_tipo: { kam_desconocido: 2 } }, error: null });

describe('listPendientes', () => {
  beforeEach(() => {
    fetchDescuadresVigentesMock.mockReset();
  });

  it('happy path: mapea filas, trae conteos por RPC y el bloque derivado de descuadres', async () => {
    const descuadres: Descuadre[] = [{ sku: 'A-1', resv: 10, suma_reservas: 4 }];
    fetchDescuadresVigentesMock.mockResolvedValueOnce(descuadres);
    const { db, calls } = makeFakeDb({ data: [pendienteRow()], error: null }, RPC_CONTEOS_OK);

    const result = await listPendientes(db);

    expect(result.pendientes).toEqual([
      {
        id: 'p-1',
        tipo: 'kam_desconocido',
        clave_natural: 'nadia',
        estado: 'abierto',
        payload: { kam_raw: 'NADIA' },
        detectado_por: 'etl',
        detectado_en: '2026-07-19T00:00:00.000Z',
        snapshot_id: 'snap-9',
        resolucion: null,
        resuelto_por: null,
        resuelto_en: null,
      },
    ]);
    expect(result.conteos).toEqual({ abiertos: 2, por_tipo: { kam_desconocido: 2 } });
    // [2.0.1-A · D2] Los dos bloques derivados nuevos degradan a null con el
    // fake db de este test (no soporta la cadena .eq().gte().order()), y eso es
    // EXACTAMENTE lo que debe pasar: «no se pudo derivar» ≠ «no hay nada».
    expect(result.derivados).toEqual({ descuadres, drift: null, puentes: null });

    expect(calls.some((c) => c.method === 'from' && c.args[0] === 'pendientes_datos')).toBe(true);
    const orderCall = calls.find((c) => c.method === 'order');
    expect(orderCall?.args).toEqual(['detectado_en', { ascending: false }]);
    expect(fetchDescuadresVigentesMock).toHaveBeenCalledWith(db);
  });

  it('snapshot_id/resolucion/resuelto_por/resuelto_en null se preservan (pendiente sin resolver)', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb({ data: [pendienteRow({ snapshot_id: null })], error: null }, RPC_CONTEOS_OK);
    const result = await listPendientes(db);
    expect(result.pendientes[0].snapshot_id).toBeNull();
    expect(result.pendientes[0].resolucion).toBeNull();
  });

  it('resuelto: resolucion/resuelto_por/resuelto_en poblados viajan tal cual', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const row = pendienteRow({
      estado: 'resuelto',
      resolucion: { accion: 'confirmar', motivo: null, kam_id: 'kam-1' },
      resuelto_por: 'bridge',
      resuelto_en: '2026-07-19T10:00:00.000Z',
    });
    const { db } = makeFakeDb({ data: [row], error: null }, RPC_CONTEOS_OK);
    const result = await listPendientes(db);
    expect(result.pendientes[0]).toMatchObject({
      estado: 'resuelto',
      resolucion: { accion: 'confirmar', motivo: null, kam_id: 'kam-1' },
      resuelto_por: 'bridge',
      resuelto_en: '2026-07-19T10:00:00.000Z',
    });
  });

  it('payload null (defensivo) → {}', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb({ data: [pendienteRow({ payload: null })], error: null }, RPC_CONTEOS_OK);
    const result = await listPendientes(db);
    expect(result.pendientes[0].payload).toEqual({});
  });

  it('degradación: pendientes_datos aún no existe (PGRST205 real de PostgREST, 0009 sin aplicar) → pendientes: [], no lanza', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb(
      {
        data: null,
        error: { message: "Could not find the table 'public.pendientes_datos' in the schema cache", code: 'PGRST205' },
      },
      RPC_CONTEOS_OK,
    );
    const result = await listPendientes(db);
    expect(result.pendientes).toEqual([]);
  });

  it('degradación: contar_pendientes no disponible (PGRST202 real de PostgREST) → conteos {abiertos:0, por_tipo:{}}, no lanza', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb(
      { data: [], error: null },
      () => ({
        data: null,
        error: { message: 'Searched for the function public.contar_pendientes in the schema cache', code: 'PGRST202' },
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await listPendientes(db);
    expect(result.conteos).toEqual({ abiertos: 0, por_tipo: {} });
    warnSpy.mockRestore();
  });

  it('error genuino (no degradable) en pendientes_datos → lanza', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb({ data: null, error: { message: 'timeout secreto', code: '57014' } }, RPC_CONTEOS_OK);
    await expect(listPendientes(db)).rejects.toThrow(/timeout secreto/);
  });

  it('error genuino (no degradable) en contar_pendientes → lanza', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb({ data: [], error: null }, () => ({ data: null, error: { message: 'boom secreto', code: '57014' } }));
    await expect(listPendientes(db)).rejects.toThrow(/boom secreto/);
  });

  it('sin pendientes ni descuadres → shape vacío consistente', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb(
      { data: [], error: null },
      () => ({ data: { abiertos: 0, por_tipo: {} }, error: null }),
      { data: [], error: null },
    );
    const result = await listPendientes(db);
    expect(result).toEqual({
      pendientes: [],
      derivados: { descuadres: [], drift: null, puentes: null },
      conteos: { abiertos: 0, por_tipo: {} },
      tecnologias: [],
    });
  });

  // (MVP-CIERRE F2) El vocabulario declarado viaja en la MISMA respuesta que
  // la bandeja ya pedía: sin esto serían decenas de peticiones para la misma lista
  // de 4, o —peor— un diálogo pidiendo la tecnología a ciegas.
  it('trae el vocabulario DECLARADO de tecnologias, ya filtrado a activas y ordenado', async () => {
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db, calls } = makeFakeDb({ data: [], error: null }, RPC_CONTEOS_OK, {
      data: [{ nombre: 'EAS' }, { nombre: 'BRAND2' }, { nombre: 'BRAND1' }, { nombre: 'VERTICAL' }],
      error: null,
    });
    const result = await listPendientes(db);

    expect(result.tecnologias).toEqual(['EAS', 'BRAND2', 'BRAND1', 'VERTICAL']);
    // El filtro de activas se hace en la CONSULTA, no en memoria.
    expect(calls).toContainEqual({ method: 'eq', args: ['activo', true] });
  });

  it('si `tecnologias` no está disponible (tabla ausente) degrada a [] sin lanzar', async () => {
    // Misma disciplina que `fetchConteos`: la bandeja sigue funcionando y el
    // diálogo cae a texto libre. Nunca tumba la bandeja entera por esto.
    fetchDescuadresVigentesMock.mockResolvedValueOnce([]);
    const { db } = makeFakeDb({ data: [], error: null }, RPC_CONTEOS_OK, {
      data: null,
      error: { message: 'relation "public.tecnologias" does not exist', code: 'PGRST205' },
    });
    const result = await listPendientes(db);
    expect(result.tecnologias).toEqual([]);
  });
});

describe('resolverPendiente', () => {
  function fakeRpcDb(rpcHandler: (name: string, args: unknown) => Resp) {
    const calls: { name: string; args: unknown }[] = [];
    const db = {
      rpc(name: string, args?: unknown) {
        calls.push({ name, args });
        return Promise.resolve(rpcHandler(name, args));
      },
    };
    return { db: db as unknown as SupabaseClient, calls };
  }

  it('confirmar (kam_desconocido) sin motivo/valor: RPC recibe null en ambos, 200 ok con el resultado', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: { estado: 'resuelto', actor: 'admin@example.com', ref: { kam_id: 'kam-9' } }, error: null }));
    const body: ResolverPendienteBody = { accion: 'confirmar' };

    const result = await resolverPendiente(db, 'p-1', body);

    expect(result).toEqual({ tipo: 'ok', resultado: { estado: 'resuelto', actor: 'admin@example.com', ref: { kam_id: 'kam-9' } } });
    expect(calls[0]).toEqual({ name: 'resolver_pendiente', args: { p_id: 'p-1', p_accion: 'confirmar', p_motivo: null, p_valor: null } });
  });

  it('confirmar con valor (nombre real del KAM): se propaga como p_valor', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: { estado: 'resuelto', actor: 'x' }, error: null }));
    await resolverPendiente(db, 'p-1', { accion: 'confirmar', valor: 'NADIA REAL' });
    expect(calls[0].args).toMatchObject({ p_valor: 'NADIA REAL' });
  });

  it('descartar con motivo: se propaga como p_motivo, 200 ok', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: { estado: 'descartado', actor: 'admin@example.com' }, error: null }));
    const result = await resolverPendiente(db, 'p-1', { accion: 'descartar', motivo: 'Duplicado' });
    expect(result).toEqual({ tipo: 'ok', resultado: { estado: 'descartado', actor: 'admin@example.com' } });
    expect(calls[0].args).toMatchObject({ p_accion: 'descartar', p_motivo: 'Duplicado' });
  });

  it('42501 (forbidden, TOCTOU de rol) → {tipo:"forbidden"}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'forbidden', code: '42501' } }));
    const result = await resolverPendiente(db, 'p-1', { accion: 'descartar', motivo: 'x' });
    expect(result).toEqual({ tipo: 'forbidden' });
  });

  it('P0002 (id inexistente) → {tipo:"no_encontrado"}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'pendiente inexistente', code: 'P0002' } }));
    const result = await resolverPendiente(db, 'no-existe', { accion: 'confirmar' });
    expect(result).toEqual({ tipo: 'no_encontrado' });
  });

  it('22023 (pendiente ya resuelto/descartado) → {tipo:"invalido", message} con el mensaje curado del RPC', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'pendiente ya resuelto/descartado', code: '22023' } }));
    const result = await resolverPendiente(db, 'p-1', { accion: 'confirmar' });
    expect(result).toEqual({ tipo: 'invalido', message: 'pendiente ya resuelto/descartado' });
  });

  it('error genuino (código no mapeado) → lanza (el route responde 500 sin fuga)', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'timeout secreto', code: '57014' } }));
    await expect(resolverPendiente(db, 'p-1', { accion: 'confirmar' })).rejects.toThrow(/timeout secreto/);
  });
});

// ------------------------------------------------------------
// (B, [MVP-2]) resolverFamiliaNueva — RPC `resolver_familia_nueva`
// (0019), firma distinta de `resolver_pendiente` (p_destino, no
// p_accion/p_valor).
// ------------------------------------------------------------
describe('resolverFamiliaNueva', () => {
  function fakeRpcDb(rpcHandler: (name: string, args: unknown) => Resp) {
    const calls: { name: string; args: unknown }[] = [];
    const db = {
      rpc(name: string, args?: unknown) {
        calls.push({ name, args });
        return Promise.resolve(rpcHandler(name, args));
      },
    };
    return { db: db as unknown as SupabaseClient, calls };
  }

  const FUSION_OK = { alias: 'SERIES 2 44', destino: 'SERIES 2 18', absorbida_existia: true, skus_que_migraran: 3 };

  it('destino + motivo: RPC recibe p_id/p_destino/p_motivo, 200 ok con {fusion}', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: { fusion: FUSION_OK }, error: null }));

    const result = await resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', motivo: 'Fusionada con «SERIES 2 18».', skusEsperados: 0 });

    expect(result).toEqual({ tipo: 'ok', resultado: { fusion: FUSION_OK } });
    expect(calls[0]).toEqual({
      name: 'resolver_familia_nueva',
      args: { p_id: 'p-1', p_destino: 'SERIES 2 18', p_motivo: 'Fusionada con «SERIES 2 18».', p_skus_esperados: 0 },
    });
  });

  it('sin motivo (opcional): RPC recibe p_motivo null', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: { fusion: FUSION_OK }, error: null }));
    await resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', skusEsperados: 0 });
    expect(calls[0].args).toMatchObject({ p_motivo: null });
  });

  it('42501 (forbidden, TOCTOU de rol) → {tipo:"forbidden"}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'forbidden', code: '42501' } }));
    const result = await resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', skusEsperados: 0 });
    expect(result).toEqual({ tipo: 'forbidden' });
  });

  it('P0002 (id inexistente, o destino inexistente dentro de fusionar_familia) → {tipo:"no_encontrado"}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'pendiente inexistente', code: 'P0002' } }));
    const result = await resolverFamiliaNueva(db, 'no-existe', { destino: 'SERIES 2 18', skusEsperados: 0 });
    expect(result).toEqual({ tipo: 'no_encontrado' });
  });

  it('22023 (p.ej. tipo distinto de familia_nueva, o ya resuelto) → {tipo:"invalido", message} con el mensaje curado del RPC', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'este pendiente no es familia_nueva (es kam_desconocido)', code: '22023' } }));
    const result = await resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', skusEsperados: 0 });
    expect(result).toEqual({ tipo: 'invalido', message: 'este pendiente no es familia_nueva (es kam_desconocido)' });
  });

  it('degradación: resolver_familia_nueva no disponible (PGRST202, 0019 sin aplicar) → {tipo:"no_disponible"}, no lanza', async () => {
    const { db } = fakeRpcDb(() => ({
      data: null,
      error: { message: 'Searched for the function public.resolver_familia_nueva in the schema cache', code: 'PGRST202' },
    }));
    const result = await resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', skusEsperados: 0 });
    expect(result).toEqual({ tipo: 'no_disponible' });
  });

  it('error genuino (código no mapeado) → lanza (el route responde 500 sin fuga)', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'timeout secreto', code: '57014' } }));
    await expect(resolverFamiliaNueva(db, 'p-1', { destino: 'SERIES 2 18', skusEsperados: 0 })).rejects.toThrow(/timeout secreto/);
  });
});
