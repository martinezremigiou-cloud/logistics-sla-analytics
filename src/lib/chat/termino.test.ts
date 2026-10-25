// ============================================================
// [INV-B10] El caso que le da sentido a este archivo salió de sondear el
// modelo real, no de imaginarlo: devolvió «los CLIPS» y `ilike '%los CLIPS%'`
// no casa con «CLIPS 2.0 Pad». Habría dicho «no encuentro nada» sobre un
// término con varias coincidencias medidas.
// ============================================================
import { describe, it, expect } from 'vitest';
import { normalizarTermino } from './termino';

describe('[INV-B10] normalizarTermino', () => {
  it('el caso MEDIDO: «los CLIPS» busca CLIPS', () => {
    expect(normalizarTermino('los CLIPS')).toBe('CLIPS');
  });

  it('quita artículos encadenados, uno a uno', () => {
    expect(normalizarTermino('el de los Series11')).toBe('Series11');
  });

  it('NO toca un artículo que va en medio: puede ser parte del nombre', () => {
    expect(normalizarTermino('Base de la Torre')).toBe('Base de la Torre');
  });

  it('respeta las mayúsculas del término: el catálogo las tiene', () => {
    expect(normalizarTermino('  los Series2  ')).toBe('Series2');
  });

  it('quita comillas y signos que el usuario escribió alrededor', () => {
    expect(normalizarTermino('«los CLIPS»')).toBe('CLIPS');
    expect(normalizarTermino('los CLIPS?')).toBe('CLIPS');
  });

  // ============================================================
  // El borde peligroso: un término que se queda vacío lanzaría una búsqueda
  // sin filtro, o sea el catálogo entero presentado como «lo que encontré».
  // ============================================================
  it('nunca se vacía a sí mismo: un artículo solo se conserva', () => {
    expect(normalizarTermino('los')).toBe('los');
    expect(normalizarTermino('la')).toBe('la');
  });

  it('devuelve `null` cuando no hay nada que buscar', () => {
    expect(normalizarTermino(null)).toBeNull();
    expect(normalizarTermino('')).toBeNull();
    expect(normalizarTermino('   ')).toBeNull();
    expect(normalizarTermino('¿?')).toBeNull();
  });

  it('un término que ya viene limpio no se toca', () => {
    expect(normalizarTermino('CLIPS')).toBe('CLIPS');
    expect(normalizarTermino('0861-5844-9317')).toBe('0861-5844-9317');
  });
});
