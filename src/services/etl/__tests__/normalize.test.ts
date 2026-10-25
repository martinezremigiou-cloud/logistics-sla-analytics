import { describe, it, expect } from 'vitest';
import { normalizeSku, normalizeAliasKey, cellText, normalizeMarcaNombre } from '../normalize';

describe('normalizeSku', () => {
  it('trim + upper', () => expect(normalizeSku(' ve497-gl ')).toBe('VE497-GL'));
  it('vacío → null', () => expect(normalizeSku('   ')).toBeNull());
  it('null → null', () => expect(normalizeSku(null)).toBeNull());
  it('number → string upper', () => expect(normalizeSku(321)).toBe('321'));
});

describe('normalizeAliasKey', () => {
  it('lowercase + strip acentos + colapsa espacios', () =>
    expect(normalizeAliasKey('  En  Preparación ')).toBe('en preparacion'));
  it('errata trasito', () => expect(normalizeAliasKey('En Trasito Aéreo')).toBe('en trasito aereo'));
  it('mantiene el signo de grado', () => expect(normalizeAliasKey('N° PO')).toBe('n° po'));
});

describe('cellText / normalizeMarcaNombre', () => {
  it('cellText recorta', () => expect(cellText('  hola ')).toBe('hola'));
  it('cellText vacío → null', () => expect(cellText('  ')).toBeNull());
  it('marca upper + colapsa', () => expect(normalizeMarcaNombre(' brand  6 ')).toBe('BRAND 6'));
  it('marca vacía → null', () => expect(normalizeMarcaNombre('  ')).toBeNull());
});
