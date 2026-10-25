import { describe, it, expect } from 'vitest';
import { generarContrasenaTemporal } from './passwords';

describe('generarContrasenaTemporal', () => {
  it('longitud exacta de 14 caracteres', () => {
    expect(generarContrasenaTemporal()).toHaveLength(14);
  });

  it('charset: solo base64url (A-Z a-z 0-9 - _), sin caracteres ambiguos', () => {
    for (let i = 0; i < 50; i++) {
      const pass = generarContrasenaTemporal();
      expect(pass).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(pass).not.toMatch(/[0Oo1lI]/);
    }
  });

  it('unicidad básica: 200 llamadas sin colisión', () => {
    const set = new Set(Array.from({ length: 200 }, () => generarContrasenaTemporal()));
    expect(set.size).toBe(200);
  });
});
