import { describe, it, expect } from 'vitest';
import { detectHeaderRow, resolveColumns } from '../grid';
import type { Grid } from '../types';

const grid: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'TOTAL', 'RESV'],
  [null, 'AAA', '', 'SERIES5', 'SERIES11', 'A', 'd', '10', '10', '0'],
];

describe('detectHeaderRow', () => {
  it('encuentra el header por tokens, saltando banner', () =>
    expect(detectHeaderRow(grid, ['item', 'marca', 'total', 'resv'])).toBe(3));
  it('-1 si falta un token', () =>
    expect(detectHeaderRow(grid, ['item', 'inexistente'])).toBe(-1));
});

describe('resolveColumns', () => {
  const col = resolveColumns(grid[3], {
    sku: ['item'],
    marca: ['marca'],
    total: ['total'],
    north: ['north'],
    inexistente: ['zzz'],
  });
  it('respeta el gutter (col A vacía) → ITEM en índice 1', () => expect(col.sku).toBe(1));
  it('resuelve MARCA', () => expect(col.marca).toBe(3));
  it('resuelve TOTAL', () => expect(col.total).toBe(8));
  it('campo sin match queda ausente', () => expect(col.inexistente).toBeUndefined());
  it('duplicados → primera coincidencia', () => {
    const c = resolveColumns([null, 'OC', 'ITEM', 'OC'], { oc: ['oc'] });
    expect(c.oc).toBe(1);
  });
});
