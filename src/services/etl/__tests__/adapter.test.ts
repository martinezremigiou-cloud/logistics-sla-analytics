import { describe, it, expect } from 'vitest';
import { toIngestJob } from '../adapter';
import type { RefreshBody } from '@/schemas/refresh.schema';

describe('toIngestJob (puro)', () => {
  it('stock → {inventario, west, reserva}', () => {
    const body: RefreshBody = {
      source: 'stock',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: 'stock.xlsx',
      datasets: {
        inventario: [['SKU', 'TOTAL']],
        west: [['SKU', 'FISICO']],
        reserva: [['SKU', 'CLIENTE']],
      },
    };
    expect(toIngestJob(body)).toEqual({
      source: 'stock',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: 'stock.xlsx',
      inventario: [['SKU', 'TOTAL']],
      west: [['SKU', 'FISICO']],
      reserva: [['SKU', 'CLIENTE']],
    });
  });

  it('stock: archivo ausente → null', () => {
    const body: RefreshBody = {
      source: 'stock',
      capturedAt: '2026-07-01T00:00:00.000Z',
      datasets: { inventario: [], west: [], reserva: [] },
    };
    expect(toIngestJob(body).archivo).toBeNull();
  });

  it('aduana → {embarques} multi-hoja tal cual', () => {
    const body: RefreshBody = {
      source: 'aduana',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: null,
      datasets: {
        embarques: [
          { hoja: 'Hoja1', grid: [['OC', 'SKU']] },
          { hoja: 'Hoja2', grid: [['OC', 'SKU']] },
        ],
      },
    };
    expect(toIngestJob(body)).toEqual({
      source: 'aduana',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: null,
      embarques: [
        { hoja: 'Hoja1', grid: [['OC', 'SKU']] },
        { hoja: 'Hoja2', grid: [['OC', 'SKU']] },
      ],
    });
  });

  it('legacy embarques → envuelve rows en una hoja sintética MANUAL', () => {
    const body: RefreshBody = {
      source: 'embarques',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: null,
      rows: [['OC', 'SKU'], ['PO-1', 'ABC-1']],
    };
    expect(toIngestJob(body)).toEqual({
      source: 'embarques',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: null,
      embarques: [{ hoja: 'MANUAL', grid: [['OC', 'SKU'], ['PO-1', 'ABC-1']] }],
    });
  });

});
