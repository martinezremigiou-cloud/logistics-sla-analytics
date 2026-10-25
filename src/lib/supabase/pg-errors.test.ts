import { describe, it, expect } from 'vitest';
import { esNoDisponiblePorMigracion, esForbidden, esNoEncontrado, esEntradaInvalida } from './pg-errors';

describe('esNoDisponiblePorMigracion', () => {
  it('code 42P01 ("relation does not exist", SQLSTATE directo) → true', () => {
    expect(esNoDisponiblePorMigracion({ code: '42P01' })).toBe(true);
  });

  it('code 42883 ("function does not exist", SQLSTATE directo) → true', () => {
    expect(esNoDisponiblePorMigracion({ code: '42883' })).toBe(true);
  });

  it('code PGRST202 (PostgREST real: RPC ausente del schema cache) → true', () => {
    expect(esNoDisponiblePorMigracion({ code: 'PGRST202' })).toBe(true);
  });

  it('code PGRST205 (PostgREST real: tabla ausente del schema cache) → true', () => {
    expect(esNoDisponiblePorMigracion({ code: 'PGRST205' })).toBe(true);
  });

  it('otro code → false', () => {
    expect(esNoDisponiblePorMigracion({ code: '42501' })).toBe(false);
  });

  it('sin code → false', () => {
    expect(esNoDisponiblePorMigracion({})).toBe(false);
  });

  it('null → false', () => {
    expect(esNoDisponiblePorMigracion(null)).toBe(false);
  });
});

describe('esForbidden', () => {
  it('code 42501 → true', () => {
    expect(esForbidden({ code: '42501' })).toBe(true);
  });

  it('otro code → false', () => {
    expect(esForbidden({ code: '42P01' })).toBe(false);
  });

  it('sin code → false', () => {
    expect(esForbidden({})).toBe(false);
  });

  it('null → false', () => {
    expect(esForbidden(null)).toBe(false);
  });
});

describe('esNoEncontrado', () => {
  it('code P0002 → true', () => {
    expect(esNoEncontrado({ code: 'P0002' })).toBe(true);
  });

  it('otro code → false', () => {
    expect(esNoEncontrado({ code: '22023' })).toBe(false);
  });

  it('sin code → false', () => {
    expect(esNoEncontrado({})).toBe(false);
  });

  it('null → false', () => {
    expect(esNoEncontrado(null)).toBe(false);
  });
});

describe('esEntradaInvalida', () => {
  it('code 22023 → true', () => {
    expect(esEntradaInvalida({ code: '22023' })).toBe(true);
  });

  it('otro code → false', () => {
    expect(esEntradaInvalida({ code: 'P0002' })).toBe(false);
  });

  it('sin code → false', () => {
    expect(esEntradaInvalida({})).toBe(false);
  });

  it('null → false', () => {
    expect(esEntradaInvalida(null)).toBe(false);
  });
});
