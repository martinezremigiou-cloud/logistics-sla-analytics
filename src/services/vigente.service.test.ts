import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveVigente,
  resolveVigentes,
  conVigenteStock,
  type SnapshotVigente,
} from './vigente.service';

type Row = { id: string; created_at: string; filas: number | null; archivo: string | null };
type Resp = { data: Row[] | null; error: { message: string } | null };
type OrderCall = [string, boolean];

/**
 * Stub chainable mínimo de supabase-js: `from().select().eq().order().order().limit()`.
 * Las respuestas se consumen en orden por fuente (FIFO); si se agotan, repite la última.
 * Registra cada llamada completa (tabla, columnas, fuente, orders y límite pedidos)
 * para poder asertar tanto la forma exacta de la query como el desempate.
 */
function createFakeDb(byFuente: Record<string, Resp[]>) {
  const calls: { table: string; cols: string; fuente: string; orders: OrderCall[]; limit: number }[] = [];
  const counters: Record<string, number> = {};

  const db = {
    from(table: string) {
      return {
        select(cols: string) {
          return {
            eq(_col: string, fuente: string) {
              const orders: OrderCall[] = [];
              const builder = {
                order(column: string, opts: { ascending: boolean }) {
                  orders.push([column, opts.ascending]);
                  return builder;
                },
                limit(n: number) {
                  calls.push({ table, cols, fuente, orders: [...orders], limit: n });
                  const i = counters[fuente] ?? 0;
                  counters[fuente] = i + 1;
                  const seq = byFuente[fuente] ?? [];
                  const resp = seq[Math.min(i, seq.length - 1)] ?? { data: [], error: null };
                  return Promise.resolve(resp);
                },
              };
              return builder;
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

describe('resolveVigente', () => {
  it('resuelve el snapshot vigente pidiendo desempate determinista por (created_at, id)', async () => {
    const row: Row = { id: 'snap-2', created_at: '2026-07-10T00:00:00.000Z', filas: 120, archivo: 'stock.xlsx' };
    const { db, calls } = createFakeDb({ stock: [{ data: [row], error: null }] });

    const result = await resolveVigente(db, 'stock');

    expect(result).toEqual(row);
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('snapshots');
    expect(calls[0].cols).toBe('id,created_at,filas,archivo');
    expect(calls[0].fuente).toBe('stock');
    expect(calls[0].limit).toBe(1);
    expect(calls[0].orders).toEqual([
      ['created_at', false],
      ['id', false],
    ]);
  });

  it('sin snapshots para la fuente → null', async () => {
    const { db } = createFakeDb({ aduana: [{ data: [], error: null }] });
    const result = await resolveVigente(db, 'aduana');
    expect(result).toBeNull();
  });

  it('null también cuando data viene null (defensivo)', async () => {
    const { db } = createFakeDb({ stock: [{ data: null, error: null }] });
    const result = await resolveVigente(db, 'stock');
    expect(result).toBeNull();
  });

  it('error de la query → throw (el route lo captura)', async () => {
    const { db } = createFakeDb({
      stock: [{ data: null, error: { message: 'conexión perdida' } }],
    });
    await expect(resolveVigente(db, 'stock')).rejects.toThrow('snapshots: conexión perdida');
  });

  it('filas/archivo null se preservan como null (no se convierten a 0/"")', async () => {
    const row: Row = { id: 'snap-3', created_at: '2026-07-11T00:00:00.000Z', filas: null, archivo: null };
    const { db } = createFakeDb({ stock: [{ data: [row], error: null }] });
    const result = await resolveVigente(db, 'stock');
    expect(result).toEqual({ id: 'snap-3', created_at: '2026-07-11T00:00:00.000Z', filas: null, archivo: null });
  });
});

describe('resolveVigentes', () => {
  it('resuelve stock y aduana en paralelo', async () => {
    const stockRow: Row = { id: 's1', created_at: '2026-07-10T00:00:00.000Z', filas: 10, archivo: 'a.xlsx' };
    const aduanaRow: Row = { id: 'a1', created_at: '2026-07-09T00:00:00.000Z', filas: 5, archivo: 'b.xlsx' };
    const { db, calls } = createFakeDb({
      stock: [{ data: [stockRow], error: null }],
      aduana: [{ data: [aduanaRow], error: null }],
    });

    const result = await resolveVigentes(db);

    expect(result).toEqual({ stock: stockRow, aduana: aduanaRow });
    expect(calls.map((c) => c.fuente).sort()).toEqual(['aduana', 'stock']);
  });

  it('regresa null en la fuente sin snapshot', async () => {
    const aduanaRow: Row = { id: 'a1', created_at: '2026-07-09T00:00:00.000Z', filas: 5, archivo: 'b.xlsx' };
    const { db } = createFakeDb({
      stock: [{ data: [], error: null }],
      aduana: [{ data: [aduanaRow], error: null }],
    });

    const result = await resolveVigentes(db);
    expect(result).toEqual({ stock: null, aduana: aduanaRow });
  });
});

describe('conVigenteStock', () => {
  it('vigente estable → el fetcher se ejecuta una sola vez', async () => {
    const row: Row = { id: 'snap-1', created_at: '2026-07-10T00:00:00.000Z', filas: 10, archivo: null };
    const { db, calls } = createFakeDb({
      stock: [
        { data: [row], error: null }, // pin inicial
        { data: [row], error: null }, // re-verificación: sin cambio
      ],
    });
    const fetcher = vi.fn(async (v: SnapshotVigente) => `ok:${v.id}`);

    const result = await conVigenteStock(db, fetcher);

    expect(result).toBe('ok:snap-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(row);
    expect(calls).toHaveLength(2); // pin + re-verificación, sin reintento
  });

  it('el vigente cambia durante la lectura → reintenta exactamente 1 vez con el id nuevo', async () => {
    const rowOld: Row = { id: 'snap-1', created_at: '2026-07-10T00:00:00.000Z', filas: 10, archivo: null };
    const rowNew: Row = { id: 'snap-2', created_at: '2026-07-10T00:15:00.000Z', filas: 20, archivo: null };
    const { db, calls } = createFakeDb({
      stock: [
        { data: [rowOld], error: null }, // pin inicial
        { data: [rowNew], error: null }, // re-verificación: cambió
      ],
    });
    const fetcher = vi.fn(async (v: SnapshotVigente) => `ok:${v.id}`);

    const result = await conVigenteStock(db, fetcher);

    expect(result).toBe('ok:snap-2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, rowOld);
    expect(fetcher).toHaveBeenNthCalledWith(2, rowNew);
    // Tras el reintento no se vuelve a re-verificar (2 llamadas a resolveVigente en total).
    expect(calls).toHaveLength(2);
  });

  it('sin snapshot vigente inicial → null y el fetcher NO se llama', async () => {
    const { db } = createFakeDb({ stock: [{ data: [], error: null }] });
    const fetcher = vi.fn();

    const result = await conVigenteStock(db, fetcher);

    expect(result).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
