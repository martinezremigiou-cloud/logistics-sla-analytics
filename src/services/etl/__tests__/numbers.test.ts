import { describe, it, expect } from 'vitest';
import { parseEuroNumber, toIntNonNeg, toInt } from '../numbers';

describe('parseEuroNumber (locale europeo/es-MX)', () => {
  it('miles con punto: 4.285 → 4285', () => expect(parseEuroNumber('4.285')).toBe(4285));
  it('miles+decimal: 13.472,00 → 13472', () => expect(parseEuroNumber('13.472,00')).toBe(13472));
  it('miles+decimal: 3.915,00 → 3915', () => expect(parseEuroNumber('3.915,00')).toBe(3915));
  it('solo coma decimal: 3,00 → 3', () => expect(parseEuroNumber('3,00')).toBe(3));
  it('decimal con coma: 43,50 → 43.5', () => expect(parseEuroNumber('43,50')).toBe(43.5));
  it('negativo: -1 → -1', () => expect(parseEuroNumber('-1')).toBe(-1));
  it('entero plano: 4285 → 4285', () => expect(parseEuroNumber('4285')).toBe(4285));
  it('number passthrough', () => expect(parseEuroNumber(150)).toBe(150));
  it('punto decimal simple (no patrón de miles): 3.07 → 3.07', () =>
    expect(parseEuroNumber('3.07')).toBe(3.07));
  it('miles múltiples: 1.234.567 → 1234567', () =>
    expect(parseEuroNumber('1.234.567')).toBe(1234567));
  it('vacío → null', () => expect(parseEuroNumber('')).toBeNull());
  it('null → null', () => expect(parseEuroNumber(null)).toBeNull());
  it('texto no numérico → null', () => expect(parseEuroNumber('19 mar 264')).toBeNull());
  it('boolean → null', () => expect(parseEuroNumber(true)).toBeNull());
  it('con espacios: " 25 " → 25', () => expect(parseEuroNumber(' 25 ')).toBe(25));
});

describe('toIntNonNeg / toInt', () => {
  it('trunca a entero >= 0', () => expect(toIntNonNeg('4.285')).toBe(4285));
  it('negativo → fallback 0', () => expect(toIntNonNeg('-1')).toBe(0));
  it('vacío → fallback', () => expect(toIntNonNeg('', 7)).toBe(7));
  it('toInt permite negativos', () => expect(toInt('-1')).toBe(-1));
  it('toInt trunca decimal', () => expect(toInt('43,50')).toBe(43));
});
