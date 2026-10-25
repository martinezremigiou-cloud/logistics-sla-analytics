import { describe, it, expect } from 'vitest';
import { searchParamsToObject } from './query';

function req(url: string): Request {
  return new Request(url);
}

describe('searchParamsToObject', () => {
  it('params presentes → aparecen en el objeto plano', () => {
    const raw = searchParamsToObject(req('http://localhost/api/inventory?q=candado&marca=BRAND1'));
    expect(raw).toEqual({ q: 'candado', marca: 'BRAND1' });
  });

  it('sin query string → objeto vacío', () => {
    const raw = searchParamsToObject(req('http://localhost/api/inventory'));
    expect(raw).toEqual({});
  });

  it('params ausentes no aparecen como clave (ni undefined ni "")', () => {
    const raw = searchParamsToObject(req('http://localhost/api/inventory?q=candado'));
    expect(raw).not.toHaveProperty('marca');
    expect(Object.keys(raw)).toEqual(['q']);
  });

  it('clave repetida: gana la ÚLTIMA ocurrencia (comportamiento real de forEach, cada iteración sobrescribe)', () => {
    const raw = searchParamsToObject(req('http://localhost/api/inventory?marca=A&marca=B'));
    expect(raw).toEqual({ marca: 'B' });
  });
});
