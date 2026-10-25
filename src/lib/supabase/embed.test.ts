import { describe, it, expect } from 'vitest';
import { embedName, embedClave, embedExcluida } from './embed';

describe('embedName', () => {
  it('objeto: extrae nombre', () => {
    expect(embedName({ nombre: 'BRAND1' })).toBe('BRAND1');
  });

  it('array de 1: extrae nombre del primer elemento', () => {
    expect(embedName([{ nombre: 'BRAND1' }])).toBe('BRAND1');
  });

  it('null → null', () => {
    expect(embedName(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(embedName(undefined)).toBeNull();
  });

  it('array vacío → null (shape raro)', () => {
    expect(embedName([])).toBeNull();
  });

  it('objeto sin la propiedad nombre → null (shape raro)', () => {
    expect(embedName({ clave: 'NORTH' })).toBeNull();
  });

  it('valor de nombre no-string → null', () => {
    expect(embedName({ nombre: 42 })).toBeNull();
  });

  it('string suelto (no objeto/array) → null (shape raro)', () => {
    expect(embedName('BRAND1')).toBeNull();
  });
});

describe('embedClave', () => {
  it('objeto: extrae clave', () => {
    expect(embedClave({ clave: 'NORTH' })).toBe('NORTH');
  });

  it('array de 1: extrae clave del primer elemento', () => {
    expect(embedClave([{ clave: 'NORTH' }])).toBe('NORTH');
  });

  it('null → null', () => {
    expect(embedClave(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(embedClave(undefined)).toBeNull();
  });

  it('array vacío → null (shape raro)', () => {
    expect(embedClave([])).toBeNull();
  });

  it('objeto sin la propiedad clave → null (shape raro)', () => {
    expect(embedClave({ nombre: 'BRAND1' })).toBeNull();
  });

  it('valor de clave no-string → null', () => {
    expect(embedClave({ clave: 7 })).toBeNull();
  });
});

// ============================================================
// [VERT-B2] embedExcluida — la función que comparten LAS DOS MITADES.
//
// La regla de exclusión vive en la columna `marcas.excluida_del_catalogo`
// (migración 0039). Esta función es lo único que la desenvuelve, y la leen
// `inventory.service.ts` y `dashboard.service.ts` — o sea que un error aquí
// se manifiesta en las dos pantallas a la vez y con el mismo signo, que es
// justo el caso que NINGÚN cotejo entre mitades puede detectar.
// Hasta este bloque no tenía ni una prueba.
// ============================================================
describe('embedExcluida', () => {
  it('objeto con true → true', () => {
    expect(embedExcluida({ excluida_del_catalogo: true })).toBe(true);
  });

  it('objeto con false → false', () => {
    expect(embedExcluida({ excluida_del_catalogo: false })).toBe(false);
  });

  it('array de 1: lee el primer elemento (la cardinalidad la decide PostgREST)', () => {
    expect(embedExcluida([{ excluida_del_catalogo: true }])).toBe(true);
  });

  // ⚠ EL CASO QUE GOBIERNA EL DISEÑO, y por eso lleva su razón escrita.
  // `false` ante la columna ausente es FALLA-ABIERTA a propósito: si el select
  // se olvida de pedirla, esto no lanza — deja de excluir en silencio. La
  // alternativa (lanzar) haría que un select incompleto tumbara el catálogo
  // entero, y se eligió no hacerlo. La red que sostiene esa elección NO está
  // aquí: son las cadenas de select pinneadas en inventory/dashboard/sku y el
  // cotejo de `vert-b2-regla-exclusion.test.ts`.
  it('embed SIN la columna → false (falla-ABIERTA: el select se la olvidó y esto NO lo denuncia)', () => {
    expect(embedExcluida({ nombre: 'VERTICAL' })).toBe(false);
  });

  it('null → false', () => {
    expect(embedExcluida(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(embedExcluida(undefined)).toBe(false);
  });

  it('array vacío → false (shape raro)', () => {
    expect(embedExcluida([])).toBe(false);
  });

  // Estrictamente `=== true`: un 'true' de texto o un 1 NO excluyen. Postgres
  // manda booleanos, pero el día que alguien lea esta columna por otra vía
  // (una vista, un RPC, un CSV) la coerción decidiría a escondidas qué marcas
  // desaparecen del catálogo. Eso se decide en la columna, no en un truthy.
  it("'true' de texto → false (no se coacciona: qué marca desaparece no lo decide un truthy)", () => {
    expect(embedExcluida({ excluida_del_catalogo: 'true' })).toBe(false);
  });

  it('1 → false (mismo criterio)', () => {
    expect(embedExcluida({ excluida_del_catalogo: 1 })).toBe(false);
  });

  it('null en la columna (marca sin decidir) → false', () => {
    expect(embedExcluida({ excluida_del_catalogo: null })).toBe(false);
  });
});
