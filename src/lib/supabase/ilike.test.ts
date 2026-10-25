import { describe, it, expect } from 'vitest';
import { escaparLike } from './ilike';

describe('escaparLike', () => {
  it('escapa %, _ y \\ (comparación literal, no patrón)', () => {
    expect(escaparLike('A%B_C\\D')).toBe('A\\%B\\_C\\\\D');
  });

  it('string limpio (sin caracteres especiales) pasa igual, sin modificar', () => {
    expect(escaparLike('CANDADOS')).toBe('CANDADOS');
  });

  it('string vacío → string vacío', () => {
    expect(escaparLike('')).toBe('');
  });
});
