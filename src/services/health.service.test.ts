import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

const resolveVigentesMock = vi.fn();

vi.mock('./vigente.service', () => ({
  resolveVigentes: (...args: unknown[]) => resolveVigentesMock(...args),
}));

import { getHealth } from './health.service';

const fakeDb = { __fakeDb: true } as unknown as SupabaseClient;

const stockRow: SnapshotVigente = {
  id: 'snap-stock-1',
  created_at: '2026-07-10T00:00:00.000Z',
  filas: 120,
  archivo: 'stock.xlsx',
};
const aduanaRow: SnapshotVigente = {
  id: 'snap-aduana-1',
  created_at: '2026-07-09T00:00:00.000Z',
  filas: 40,
  archivo: 'aduana.xlsx',
};

describe('getHealth', () => {
  beforeEach(() => {
    resolveVigentesMock.mockReset();
  });

  it('estado ok cuando ambas fuentes tienen snapshot vigente', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: stockRow, aduana: aduanaRow });

    const result = await getHealth(fakeDb);

    expect(result).toEqual({
      estado: 'ok',
      fuentes: {
        stock: {
          snapshotId: 'snap-stock-1',
          created_at: '2026-07-10T00:00:00.000Z',
          filas: 120,
          archivo: 'stock.xlsx',
        },
        aduana: {
          snapshotId: 'snap-aduana-1',
          created_at: '2026-07-09T00:00:00.000Z',
          filas: 40,
          archivo: 'aduana.xlsx',
        },
      },
    });
  });

  it('estado degradado cuando falta la fuente aduana', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: stockRow, aduana: null });

    const result = await getHealth(fakeDb);

    expect(result.estado).toBe('degradado');
    expect(result.fuentes.stock).not.toBeNull();
    expect(result.fuentes.aduana).toBeNull();
  });

  it('estado degradado cuando falta la fuente stock', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: aduanaRow });

    const result = await getHealth(fakeDb);

    expect(result.estado).toBe('degradado');
    expect(result.fuentes.stock).toBeNull();
  });

  it('estado degradado cuando faltan ambas fuentes', async () => {
    resolveVigentesMock.mockResolvedValueOnce({ stock: null, aduana: null });

    const result = await getHealth(fakeDb);

    expect(result).toEqual({ estado: 'degradado', fuentes: { stock: null, aduana: null } });
  });

  it('propaga el error si resolveVigentes lanza (BD caída) — el route decide el status', async () => {
    resolveVigentesMock.mockRejectedValueOnce(new Error('conexión perdida'));

    await expect(getHealth(fakeDb)).rejects.toThrow('conexión perdida');
  });
});
