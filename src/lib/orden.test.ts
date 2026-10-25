import { describe, it, expect } from 'vitest';
import { cmpStr } from './orden';

describe('cmpStr', () => {
  it('a < b → -1', () => {
    expect(cmpStr('A-1', 'B-2')).toBe(-1);
  });

  it('a > b → 1', () => {
    expect(cmpStr('B-2', 'A-1')).toBe(1);
  });

  it('a === b → 0', () => {
    expect(cmpStr('A-1', 'A-1')).toBe(0);
  });

  it('comparación simple, NO numérica: "A-10" < "A-2" (compara char a char)', () => {
    expect(cmpStr('A-10', 'A-2')).toBe(-1);
  });

  it('comparación simple, NO localeCompare: mayúsculas ordenan antes que minúsculas', () => {
    // En localeCompare "a" y "A" suelen considerarse casi iguales; en
    // comparación simple por code point, 'A' (65) < 'a' (97).
    expect(cmpStr('A', 'a')).toBe(-1);
  });

  it('string vacío ordena antes que cualquier no-vacío', () => {
    expect(cmpStr('', 'A')).toBe(-1);
  });

  it('sirve como comparador de Array.prototype.sort (ASC estable)', () => {
    const valores = ['SOUTH', 'SERIES12', 'CLIP'];
    expect([...valores].sort(cmpStr)).toEqual(['CLIP', 'SERIES12', 'SOUTH']);
  });
});
