import { describe, it, expect } from 'vitest';
import { sha256Hex, canonicalJson, rowHash, snapshotHash } from '../hash';

describe('hash', () => {
  it('sha256Hex determinista', () =>
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ));
  it('canonicalJson ordena claves', () =>
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 })));
  it('rowHash estable ante orden de claves', () =>
    expect(rowHash({ x: 1, y: 2 })).toBe(rowHash({ y: 2, x: 1 })));
  it('snapshotHash estable ante orden de filas', () => {
    const a = [{ sku: 'A', n: 1 }, { sku: 'B', n: 2 }];
    const b = [{ sku: 'B', n: 2 }, { sku: 'A', n: 1 }];
    expect(snapshotHash(a)).toBe(snapshotHash(b));
  });
  it('snapshotHash cambia si cambia el contenido', () => {
    const a = [{ sku: 'A', n: 1 }];
    const b = [{ sku: 'A', n: 2 }];
    expect(snapshotHash(a)).not.toBe(snapshotHash(b));
  });
});
