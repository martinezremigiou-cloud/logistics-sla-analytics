import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setOverride } from './override.service';
import type { OverrideBody } from '@/schemas/override.schema';

// ------------------------------------------------------------
// Fake db: los SELECT normales (`productos`, `familias`) siguen
// modelados por una cola FIFO de respuestas por tabla. La escritura
// atómica pasa por `rpc('aplicar_override', ...)`, mockeada aparte
// (una sola llamada por invocación de `setOverride`, en vez de las 3
// contra `productos_override` de B3).
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };
type Call = { table: string; method: string; args: unknown[] };

function makeFakeDb(opts: { responses?: Partial<Record<string, Resp[]>>; rpcResponse?: Resp } = {}) {
  const responses = opts.responses ?? {};
  const calls: Call[] = [];
  const cursors: Record<string, number> = {};

  function nextResp(table: string): Resp {
    const list = responses[table] ?? [];
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    return list[idx] ?? { data: null, error: null };
  }

  function chain(table: string) {
    const record = (method: string, args: unknown[]) => calls.push({ table, method, args });
    const node = {
      select(...args: unknown[]) {
        record('select', args);
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
      limit(...args: unknown[]) {
        record('limit', args);
        return node;
      },
      maybeSingle() {
        record('maybeSingle', []);
        return Promise.resolve(nextResp(table));
      },
      then<TResult1 = Resp, TResult2 = never>(
        onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        record('then', []);
        return Promise.resolve(nextResp(table)).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const rpcResponse: Resp = opts.rpcResponse ?? { data: [], error: null };
  const rpc = vi.fn((fn: string, args: unknown) => {
    calls.push({ table: 'rpc', method: fn, args: [args] });
    return Promise.resolve(rpcResponse);
  });

  const db = { from: (table: string) => chain(table), rpc };
  return { db: db as unknown as SupabaseClient, calls, rpc };
}

function input(overrides: Partial<OverrideBody> = {}): OverrideBody {
  return { sku: 'A-1', campo: 'descripcion', valor: 'Nueva descripción', ...overrides };
}

describe('setOverride', () => {
  it('sku inexistente → { tipo: "sku_no_encontrado" }, sin tocar familias ni el RPC', async () => {
    const { db, calls } = makeFakeDb({ responses: { productos: [{ data: null, error: null }] } });

    const result = await setOverride(db, input());

    expect(result).toEqual({ tipo: 'sku_no_encontrado' });
    expect(calls.some((c) => c.table === 'familias')).toBe(false);
    expect(calls.some((c) => c.table === 'rpc')).toBe(false);
  });

  it('familia inexistente/inactiva → { tipo: "familia_invalida", nombre }, sin invocar el RPC', async () => {
    const { db, calls } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: 'Descr', familias: { nombre: 'CANDADOS' } }, error: null }],
        familias: [{ data: [], error: null }],
      },
    });

    const result = await setOverride(db, input({ campo: 'familia', valor: 'NoExiste' }));

    expect(result).toEqual({ tipo: 'familia_invalida', nombre: 'NoExiste' });
    expect(calls.some((c) => c.table === 'rpc')).toBe(false);
  });

  it('escapa %, _ y \\ del valor antes del ilike al validar familia (comparación literal, no patrón)', async () => {
    const { db, calls } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: 'Descr', familias: null }, error: null }],
        familias: [{ data: [], error: null }],
      },
    });

    const result = await setOverride(db, input({ campo: 'familia', valor: 'A%B_C\\D' }));

    expect(result).toEqual({ tipo: 'familia_invalida', nombre: 'A%B_C\\D' });
    const ilikeCall = calls.find((c) => c.table === 'familias' && c.method === 'ilike');
    expect(ilikeCall?.args).toEqual(['nombre', 'A\\%B\\_C\\\\D']);
  });

  it('familia válida invoca el RPC con el nombre CANÓNICO del catálogo (envía "blister", catálogo tiene "BLISTER")', async () => {
    const { db, calls, rpc } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: 'Descr', familias: null }, error: null }],
        familias: [{ data: [{ id: 'fam-1', nombre: 'BLISTER' }], error: null }],
      },
      rpcResponse: {
        data: [
          {
            id: 'ovr-2',
            sku: 'A-1',
            campo: 'familia',
            valor_editado: 'BLISTER',
            editado_en: '2026-07-12T00:00:00.000Z',
            activo: true,
          },
        ],
        error: null,
      },
    });

    const result = await setOverride(db, input({ campo: 'familia', valor: 'blister' }));

    expect(result).toEqual({
      tipo: 'ok',
      resultado: {
        sku: 'A-1',
        campo: 'familia',
        valor_efectivo: 'BLISTER',
        familia_efectiva: 'BLISTER',
        descr_efectiva: 'Descr',
        tecnologia_efectiva: null,
      },
    });

    const ilikeCall = calls.find((c) => c.table === 'familias' && c.method === 'ilike');
    expect(ilikeCall?.args).toEqual(['nombre', 'blister']);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('aplicar_override', { p_sku: 'A-1', p_campo: 'familia', p_valor: 'BLISTER' });
  });

  it('descripcion happy: invoca el RPC con el valor tal cual, sin tocar el catálogo de familias', async () => {
    const { db, calls, rpc } = makeFakeDb({
      responses: {
        productos: [
          { data: { sku: 'A-1', descr_origen: 'Vieja descripción', familias: { nombre: 'CANDADOS' } }, error: null },
        ],
      },
      rpcResponse: {
        data: [
          {
            id: 'ovr-3',
            sku: 'A-1',
            campo: 'descripcion',
            valor_editado: 'Nueva descripción',
            editado_en: '2026-07-12T00:00:00.000Z',
            activo: true,
          },
        ],
        error: null,
      },
    });

    const result = await setOverride(db, input({ campo: 'descripcion', valor: 'Nueva descripción' }));

    expect(result).toEqual({
      tipo: 'ok',
      resultado: {
        sku: 'A-1',
        campo: 'descripcion',
        valor_efectivo: 'Nueva descripción',
        familia_efectiva: 'CANDADOS',
        descr_efectiva: 'Nueva descripción',
        tecnologia_efectiva: null,
      },
    });

    // campo='descripcion' no requiere validar contra el catálogo de familias.
    expect(calls.some((c) => c.table === 'familias')).toBe(false);

    expect(rpc).toHaveBeenCalledWith('aplicar_override', {
      p_sku: 'A-1',
      p_campo: 'descripcion',
      p_valor: 'Nueva descripción',
    });
    // editado_por ya no viaja desde JS: lo fija la DB desde el JWT dentro del RPC.
    const [, rpcArgs] = rpc.mock.calls[0];
    expect(rpcArgs).not.toHaveProperty('editado_por');
  });

  it('valor null (revertir) + campo="familia": RPC con p_valor null, sin validar el catálogo de familias', async () => {
    const { db, calls, rpc } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: 'Descr origen', familias: { nombre: 'CANDADOS' } }, error: null }],
      },
      // El override de familia quedó desactivado por el RPC, sin reemplazo: el
      // set activo fresco ya no trae ninguna fila de campo='familia'.
      rpcResponse: { data: [], error: null },
    });

    const result = await setOverride(db, input({ campo: 'familia', valor: null }));

    expect(result).toEqual({
      tipo: 'ok',
      resultado: {
        sku: 'A-1',
        campo: 'familia',
        valor_efectivo: 'CANDADOS',
        familia_efectiva: 'CANDADOS',
        descr_efectiva: 'Descr origen',
        tecnologia_efectiva: null,
      },
    });
    expect(calls.some((c) => c.table === 'familias')).toBe(false);
    expect(rpc).toHaveBeenCalledWith('aplicar_override', { p_sku: 'A-1', p_campo: 'familia', p_valor: null });
  });

  it('valor null (revertir) + campo="descripcion": RPC con p_valor null', async () => {
    const { db, rpc } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: 'Descr origen', familias: null }, error: null }],
      },
      rpcResponse: { data: [], error: null },
    });

    const result = await setOverride(db, input({ campo: 'descripcion', valor: null }));

    expect(result).toEqual({
      tipo: 'ok',
      resultado: {
        sku: 'A-1',
        campo: 'descripcion',
        valor_efectivo: 'Descr origen',
        familia_efectiva: null,
        descr_efectiva: 'Descr origen',
        tecnologia_efectiva: null,
      },
    });
    expect(rpc).toHaveBeenCalledWith('aplicar_override', { p_sku: 'A-1', p_campo: 'descripcion', p_valor: null });
  });

  it('error DB al leer productos → throw', async () => {
    const { db } = makeFakeDb({ responses: { productos: [{ data: null, error: { message: 'boom secreto' } }] } });
    await expect(setOverride(db, input())).rejects.toThrow();
  });

  it('error DB al buscar familias → throw', async () => {
    const { db } = makeFakeDb({
      responses: {
        productos: [{ data: { sku: 'A-1', descr_origen: null, familias: null }, error: null }],
        familias: [{ data: null, error: { message: 'boom secreto' } }],
      },
    });
    await expect(setOverride(db, input({ campo: 'familia', valor: 'X' }))).rejects.toThrow();
  });

  it('error del RPC aplicar_override → throw', async () => {
    const { db } = makeFakeDb({
      responses: { productos: [{ data: { sku: 'A-1', descr_origen: 'D', familias: null }, error: null }] },
      rpcResponse: { data: null, error: { message: 'boom secreto' } },
    });
    await expect(setOverride(db, input())).rejects.toThrow();
  });

  it('error del RPC con code 42501 (TOCTOU: el gate pasó pero is_admin() del RPC rechazó) → { tipo: "forbidden" }, sin throw', async () => {
    const { db } = makeFakeDb({
      responses: { productos: [{ data: { sku: 'A-1', descr_origen: 'D', familias: null }, error: null }] },
      rpcResponse: { data: null, error: { message: 'forbidden', code: '42501' } },
    });

    const result = await setOverride(db, input());

    expect(result).toEqual({ tipo: 'forbidden' });
  });

  // ============================================================
  // [FIX-B1] campo='tecnologia' — regla «el Excel gana», ver derivaciones.ts.
  // ============================================================
  describe("campo='tecnologia' (FIX-B1)", () => {
    it('Excel VACÍO: RPC ok → valor_efectivo/tecnologia_efectiva reflejan el override recién escrito', async () => {
      const { db, rpc } = makeFakeDb({
        responses: {
          productos: [{ data: { sku: 'A-1', descr_origen: 'D', tecnologia: null, familias: null }, error: null }],
        },
        rpcResponse: {
          data: [
            {
              id: 'ovr-tec-1',
              sku: 'A-1',
              campo: 'tecnologia',
              valor_editado: 'EAS',
              editado_en: '2026-07-12T00:00:00.000Z',
              activo: true,
            },
          ],
          error: null,
        },
      });

      const result = await setOverride(db, input({ campo: 'tecnologia', valor: 'EAS' }));

      expect(result).toEqual({
        tipo: 'ok',
        resultado: {
          sku: 'A-1',
          campo: 'tecnologia',
          valor_efectivo: 'EAS',
          familia_efectiva: null,
          descr_efectiva: 'D',
          tecnologia_efectiva: 'EAS',
        },
      });
      // Sin canonicalización de familia: el selector del cliente ya restringe
      // los valores, así que no hay `familias` que consultar aquí.
      expect(rpc).toHaveBeenCalledWith('aplicar_override', { p_sku: 'A-1', p_campo: 'tecnologia', p_valor: 'EAS' });
    });

    it('SQLSTATE MXEXL (el Excel ya trae tecnología) → { tipo: "excel_manda" }, sin throw', async () => {
      const { db } = makeFakeDb({
        responses: {
          productos: [{ data: { sku: 'A-1', descr_origen: 'D', tecnologia: 'BRAND1', familias: null }, error: null }],
        },
        rpcResponse: { data: null, error: { message: 'excel_manda', code: 'MXEXL' } },
      });

      const result = await setOverride(db, input({ campo: 'tecnologia', valor: 'EAS' }));

      expect(result).toEqual({ tipo: 'excel_manda' });
    });

    it('SQLSTATE MXTEC (valor fuera de tecnologias_seleccionables) → { tipo: "tecnologia_no_seleccionable", valor }, sin throw', async () => {
      const { db } = makeFakeDb({
        responses: {
          productos: [{ data: { sku: 'A-1', descr_origen: 'D', tecnologia: null, familias: null }, error: null }],
        },
        rpcResponse: { data: null, error: { message: 'tecnologia_no_seleccionable', code: 'MXTEC' } },
      });

      const result = await setOverride(db, input({ campo: 'tecnologia', valor: 'ROBOTICA' }));

      expect(result).toEqual({ tipo: 'tecnologia_no_seleccionable', valor: 'ROBOTICA' });
    });

    it('valor null (revertir): RPC con p_valor null, sin validar nada — la efectiva cae de vuelta a la fuente (o null si tampoco la trae)', async () => {
      const { db, rpc } = makeFakeDb({
        responses: {
          productos: [{ data: { sku: 'A-1', descr_origen: 'D', tecnologia: null, familias: null }, error: null }],
        },
        // El override quedó desactivado por el RPC, sin reemplazo.
        rpcResponse: { data: [], error: null },
      });

      const result = await setOverride(db, input({ campo: 'tecnologia', valor: null }));

      expect(result).toEqual({
        tipo: 'ok',
        resultado: {
          sku: 'A-1',
          campo: 'tecnologia',
          valor_efectivo: null,
          familia_efectiva: null,
          descr_efectiva: 'D',
          tecnologia_efectiva: null,
        },
      });
      expect(rpc).toHaveBeenCalledWith('aplicar_override', { p_sku: 'A-1', p_campo: 'tecnologia', p_valor: null });
    });

    it('Excel POBLADO y set activo fresco SIN fila de tecnologia (el RPC no dejó escribir/quedó desactivada) → tecnologia_efectiva es la del Excel', async () => {
      const { db } = makeFakeDb({
        responses: {
          productos: [{ data: { sku: 'A-1', descr_origen: 'D', tecnologia: 'BRAND1', familias: null }, error: null }],
        },
        rpcResponse: { data: [], error: null },
      });

      // Este caso no pasa por el RPC con éxito en la práctica (el Excel
      // poblado dispara MXEXL antes) — se deja documentado el comportamiento
      // de `resolverClasificacion` por si el set activo fresco llegara vacío
      // por cualquier otra vía: el Excel sigue ganando.
      const result = await setOverride(db, input({ campo: 'descripcion', valor: 'Otra' }));
      expect(result.tipo).toBe('ok');
      if (result.tipo === 'ok') {
        expect(result.resultado.tecnologia_efectiva).toBe('BRAND1');
      }
    });
  });
});
