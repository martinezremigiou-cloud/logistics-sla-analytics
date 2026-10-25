import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listFamilias, createFamilia, previsualizarFusion, fusionarFamilia } from './familias.service';

// ------------------------------------------------------------
// Fake db: cada `db.from(table)` abre una cadena nueva que registra
// los métodos invocados (select/eq/ilike/order/insert/single/then) y,
// al llegar a un punto terminal (`.single()` o el `await` del thenable),
// consume la SIGUIENTE respuesta de una cola compartida — modela bien
// llamadas secuenciales a la misma tabla (p.ej. createFamilia: primero
// el SELECT de duplicados, luego el INSERT).
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };
type Call = { table: string; method: string; args: unknown[] };

function makeFakeDb(queue: Resp[]) {
  const calls: Call[] = [];
  let i = 0;

  function nextResp(): Resp {
    const r = queue[i] ?? { data: null, error: null };
    i += 1;
    return r;
  }

  function chain(table: string) {
    const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
    const node = {
      select(...args: unknown[]) {
        record('select', args);
        return node;
      },
      insert(...args: unknown[]) {
        record('insert', args);
        return node;
      },
      update(...args: unknown[]) {
        record('update', args);
        return node;
      },
      eq(...args: unknown[]) {
        record('eq', args);
        return node;
      },
      ilike(...args: unknown[]) {
        record('ilike', args);
        return node;
      },
      order(...args: unknown[]) {
        record('order', args);
        return node;
      },
      single() {
        record('single', []);
        return Promise.resolve(nextResp());
      },
      then<TResult1 = Resp, TResult2 = never>(
        onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        record('then', []);
        return Promise.resolve(nextResp()).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const db = { from: (table: string) => chain(table) };
  return { db: db as unknown as SupabaseClient, calls };
}

function familiaRow(overrides: Partial<{ id: string; nombre: string; activo: boolean }> = {}) {
  return { id: 'fam-1', nombre: 'CANDADOS', activo: true, ...overrides };
}

describe('listFamilias', () => {
  it('incluirInactivas=false: filtra por activo=true y ordena por nombre', async () => {
    const items = [familiaRow(), familiaRow({ id: 'fam-2', nombre: 'SENSORES' })];
    const { db, calls } = makeFakeDb([{ data: items, error: null }]);

    const result = await listFamilias(db, false);

    expect(result).toEqual({ items });
    expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'activo' && c.args[1] === true)).toBe(true);
    expect(calls.some((c) => c.method === 'order' && c.args[0] === 'nombre')).toBe(true);
  });

  it('incluirInactivas=true: trae todas, sin filtro eq(activo)', async () => {
    const items = [familiaRow(), familiaRow({ id: 'fam-3', nombre: 'BAJA', activo: false })];
    const { db, calls } = makeFakeDb([{ data: items, error: null }]);

    const result = await listFamilias(db, true);

    expect(result).toEqual({ items });
    expect(calls.some((c) => c.method === 'eq')).toBe(false);
  });

  it('sin filas → items []', async () => {
    const { db } = makeFakeDb([{ data: [], error: null }]);
    const result = await listFamilias(db, false);
    expect(result).toEqual({ items: [] });
  });

  it('error DB → throw', async () => {
    const { db } = makeFakeDb([{ data: null, error: { message: 'constraint boom secreto' } }]);
    await expect(listFamilias(db, false)).rejects.toThrow();
  });
});

describe('createFamilia', () => {
  it('nombre nuevo → INSERT y regresa { ok:true, familia, origen:"creada" }', async () => {
    const nueva = familiaRow({ id: 'fam-9', nombre: 'CARGADORES' });
    const { db, calls } = makeFakeDb([
      { data: [], error: null }, // SELECT duplicado: sin filas
      { data: nueva, error: null }, // INSERT: éxito
    ]);

    const result = await createFamilia(db, 'CARGADORES');

    expect(result).toEqual({ ok: true, familia: nueva, origen: 'creada' });
    const insertCall = calls.find((c) => c.method === 'insert');
    expect(insertCall?.args[0]).toEqual({ nombre: 'CARGADORES' });
  });

  it('existe ACTIVA (match case-insensitive) → { ok:false, motivo:duplicada }, sin llegar al INSERT ni al UPDATE', async () => {
    const existente = familiaRow({ nombre: 'BLISTER', activo: true });
    const { db, calls } = makeFakeDb([{ data: [existente], error: null }]);

    const result = await createFamilia(db, 'blister');

    expect(result).toEqual({ ok: false, motivo: 'duplicada' });
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
    expect(calls.some((c) => c.method === 'update')).toBe(false);
  });

  it('existe INACTIVA (match case-insensitive) → se reactiva (UPDATE activo=true por id) y regresa { ok:true, familia, origen:"reactivada" }, sin llegar al INSERT', async () => {
    const inactiva = familiaRow({ id: 'fam-7', nombre: 'BLISTER', activo: false });
    const reactivada = { ...inactiva, activo: true };
    const { db, calls } = makeFakeDb([
      { data: [inactiva], error: null }, // SELECT duplicado: la encuentra, inactiva
      { data: reactivada, error: null }, // UPDATE activo=true: éxito
    ]);

    const result = await createFamilia(db, 'blister');

    // `aliasVivo`: la familia reactivada NO es alias de otra (frente C, hallazgo B4-bis).
    expect(result).toEqual({ ok: true, familia: reactivada, origen: 'reactivada', aliasVivo: false });
    expect(calls.some((c) => c.method === 'insert')).toBe(false);
    const updateCall = calls.find((c) => c.method === 'update');
    expect(updateCall?.args[0]).toEqual({ activo: true });
    const eqCall = calls.find((c) => c.method === 'eq');
    expect(eqCall?.args).toEqual(['id', 'fam-7']);
  });

  it('error DB genérico en el UPDATE de reactivación → throw', async () => {
    const inactiva = familiaRow({ id: 'fam-7', nombre: 'BLISTER', activo: false });
    const { db } = makeFakeDb([
      { data: [inactiva], error: null },
      { data: null, error: { message: 'connection reset boom secreto', code: '57P01' } },
    ]);

    await expect(createFamilia(db, 'blister')).rejects.toThrow();
  });

  it('escapa %, _ y \\ del nombre antes del ilike (comparación literal, no patrón)', async () => {
    const { db, calls } = makeFakeDb([{ data: [], error: null }, { data: familiaRow(), error: null }]);

    await createFamilia(db, 'A%B_C\\D');

    const ilikeCall = calls.find((c) => c.method === 'ilike');
    expect(ilikeCall?.args).toEqual(['nombre', 'A\\%B\\_C\\\\D']);
  });

  it('carrera: INSERT falla con 23505 (unique violation) → duplicada, sin filtrar el mensaje PG', async () => {
    const { db } = makeFakeDb([
      { data: [], error: null }, // SELECT duplicado: sin filas (aún no existía)
      { data: null, error: { message: 'duplicate key value violates unique constraint "familias_nombre_unique"', code: '23505' } },
    ]);

    const result = await createFamilia(db, 'CANDADOS');

    expect(result).toEqual({ ok: false, motivo: 'duplicada' });
  });

  it('error DB genérico en el SELECT de duplicados → throw', async () => {
    const { db } = makeFakeDb([{ data: null, error: { message: 'constraint boom secreto' } }]);
    await expect(createFamilia(db, 'X')).rejects.toThrow();
  });

  it('error DB genérico (no 23505) en el INSERT → throw, sin mapear a duplicada', async () => {
    const { db } = makeFakeDb([
      { data: [], error: null },
      { data: null, error: { message: 'connection reset boom secreto', code: '57P01' } },
    ]);
    await expect(createFamilia(db, 'X')).rejects.toThrow();
  });
});

// ------------------------------------------------------------
// [MVP-2] C · previsualizarFusion — LECTURA pura (`familias`+embed
// `productos(count)`, mismo patrón que `cambios(count)` en
// `snapshots.service.ts`). Usa el MISMO `makeFakeDb` de arriba: el
// service hace `await db.from('familias').select(...)` sin encadenar
// nada más, y el helper resuelve un `await` directo sobre `.select()`
// vía su `.then()`.
// ------------------------------------------------------------
describe('previsualizarFusion', () => {
  function familiaConConteo(nombre: string, count: number, id = nombre) {
    return { id, nombre, productos: [{ count }] };
  }

  it('celda exacta existe: cubre=1, skus_directos del conteo embebido, sin compuestos afectados → no_cubre []', async () => {
    const rows = [familiaConConteo('SERIES 2', 5), familiaConConteo('OTRA FAMILIA', 2)];
    const { db, calls } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES 2');

    expect(result).toEqual({ alias: 'SERIES 2', cubre: 1, skus_directos: 5, no_cubre: [] });
    expect(calls.some((c) => c.method === 'select' && String(c.args[0]).includes('productos(count)'))).toBe(true);
  });

  it('celda exacta NO existe (el alias solo vive en el Excel, aún no es fila): cubre=0, skus_directos=0', async () => {
    const rows = [familiaConConteo('OTRA FAMILIA', 2)];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result).toEqual({ alias: 'SERIES2', cubre: 0, skus_directos: 0, no_cubre: [] });
  });

  it('case-insensitive y con espacios sobrantes: " series2 " matchea la celda "SERIES2"; el alias normalizado NO se uppercasea (fidelidad de display)', async () => {
    const rows = [familiaConConteo('SERIES2', 3)];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, ' series2 ');

    expect(result.cubre).toBe(1);
    expect(result.alias).toBe('series2');
  });

  it('el ejemplo del frente (cabecera 0018): fusionar SERIES2 detecta "SERIES2 26 / SERIES2 38" como compuesto NO cubierto', async () => {
    const rows = [
      familiaConConteo('SERIES2', 8),
      familiaConConteo('SERIES2 26 / SERIES2 38', 1),
      // "SERIES 12" no es compuesto (sin '/'): jamás entra a no_cubre, sin importar el alias.
      familiaConConteo('SERIES 12', 18),
    ];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result).toEqual({
      alias: 'SERIES2',
      cubre: 1,
      skus_directos: 8,
      no_cubre: [{ nombre: 'SERIES2 26 / SERIES2 38', skus: 1 }],
    });
  });

  it('JAMÁS substring: "SERIES2XYZ" (sin frontera de espacio) no cuenta como compuesto que contiene el alias', async () => {
    const rows = [familiaConConteo('SERIES2', 1), familiaConConteo('SERIES2XYZ / OTRO', 9)];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result.no_cubre).toEqual([]);
  });

  it('no filtra por `activo` — misma base que ve `fusionar_familia` al ejecutarse (ni la RPC lo filtra)', async () => {
    const rows = [{ id: 'x', nombre: 'SERIES2', activo: false, productos: [{ count: 2 }] }];
    const { db, calls } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result.cubre).toBe(1);
    expect(calls.some((c) => c.method === 'eq')).toBe(false);
  });

  it('familias sin productos (embed vacío/null): conteo 0, no revienta', async () => {
    const rows = [
      { id: 'x', nombre: 'SERIES2', productos: [] },
      { id: 'y', nombre: 'SERIES2 26 / SERIES2 38', productos: null },
    ];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result.skus_directos).toBe(0);
    expect(result.no_cubre).toEqual([{ nombre: 'SERIES2 26 / SERIES2 38', skus: 0 }]);
  });

  it('no_cubre viaja ordenado alfabéticamente (determinista)', async () => {
    const rows = [familiaConConteo('SERIES2', 1), familiaConConteo('CLIP 3.0 / SERIES2 MINI', 2), familiaConConteo('AAA 1 / SERIES2 9', 1)];
    const { db } = makeFakeDb([{ data: rows, error: null }]);

    const result = await previsualizarFusion(db, 'SERIES2');

    expect(result.no_cubre.map((c) => c.nombre)).toEqual(['AAA 1 / SERIES2 9', 'CLIP 3.0 / SERIES2 MINI']);
  });

  it('error DB → throw', async () => {
    const { db } = makeFakeDb([{ data: null, error: { message: 'constraint boom secreto' } }]);
    await expect(previsualizarFusion(db, 'SERIES2')).rejects.toThrow();
  });
});

// ------------------------------------------------------------
// [MVP-2] C · fusionarFamilia — WRITE vía RPC `fusionar_familia` (0018).
// Fake db propio (solo `.rpc()`, mismo patrón que `pendientes.service.test.ts`).
// ------------------------------------------------------------
describe('fusionarFamilia', () => {
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

  const FUSION_OK = { alias: 'SERIES2', destino: 'SERIES 2', absorbida_existia: true, skus_que_migraran: 8 };

  it('happy path: RPC recibe p_alias/p_destino, 200 ok con el resultado tal cual', async () => {
    const { db, calls } = fakeRpcDb(() => ({ data: FUSION_OK, error: null }));

    const result = await fusionarFamilia(db, 'SERIES2', 'SERIES 2', 0);

    expect(result).toEqual({ tipo: 'ok', resultado: FUSION_OK });
    expect(calls[0]).toEqual({ name: 'fusionar_familia', args: { p_alias: 'SERIES2', p_destino: 'SERIES 2', p_skus_esperados: 0 } });
  });

  it('42501 (forbidden, TOCTOU de rol) → {tipo:"forbidden"}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'forbidden', code: '42501' } }));
    const result = await fusionarFamilia(db, 'SERIES2', 'SERIES 2', 0);
    expect(result).toEqual({ tipo: 'forbidden' });
  });

  it('P0002 (el destino no existe en el catálogo) → {tipo:"no_encontrada", message} con el mensaje curado del RPC', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'la familia destino "X" no existe en el catalogo', code: 'P0002' } }));
    const result = await fusionarFamilia(db, 'SERIES2', 'X', 0);
    expect(result).toEqual({ tipo: 'no_encontrada', message: 'la familia destino "X" no existe en el catalogo' });
  });

  it('22023 (p.ej. destino inactivo, o alias=destino) → {tipo:"invalido", message}', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'la familia destino "X" esta inactiva', code: '22023' } }));
    const result = await fusionarFamilia(db, 'SERIES2', 'X', 0);
    expect(result).toEqual({ tipo: 'invalido', message: 'la familia destino "X" esta inactiva' });
  });

  it('degradación: fusionar_familia no disponible (PGRST202, 0018 sin aplicar) → {tipo:"no_disponible"}, no lanza', async () => {
    const { db } = fakeRpcDb(() => ({
      data: null,
      error: { message: 'Searched for the function public.fusionar_familia in the schema cache', code: 'PGRST202' },
    }));
    const result = await fusionarFamilia(db, 'SERIES2', 'SERIES 2', 0);
    expect(result).toEqual({ tipo: 'no_disponible' });
  });

  it('error genuino (código no mapeado) → lanza (el route responde 500 sin fuga)', async () => {
    const { db } = fakeRpcDb(() => ({ data: null, error: { message: 'timeout secreto', code: '57014' } }));
    await expect(fusionarFamilia(db, 'SERIES2', 'SERIES 2', 0)).rejects.toThrow(/timeout secreto/);
  });
});

describe('makeFakeDb (self-check del helper de test)', () => {
  beforeEach(() => {
    // no-op: aísla la suite de cualquier estado compartido entre archivos de test.
  });

  it('consume respuestas en orden por llamada terminal', async () => {
    const { db } = makeFakeDb([
      { data: [{ id: '1' }], error: null },
      { data: [{ id: '2' }], error: null },
    ]);
    const first = await db.from('familias').select('id');
    const second = await db.from('familias').select('id');
    expect(first).toEqual({ data: [{ id: '1' }], error: null });
    expect(second).toEqual({ data: [{ id: '2' }], error: null });
  });
});
