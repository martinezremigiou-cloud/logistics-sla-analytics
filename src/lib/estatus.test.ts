// ============================================================
// [2.0.1-A] estatus.test.ts — el contrato de la taxonomía como DATA.
//
// `estatus-pill.test.tsx` prueba la REGLA (precedencia, labels). Esto
// prueba lo que el filtro por estatus necesita creer de la ESTRUCTURA:
// que cada clave es alcanzable (una entrada muerta en el `<select>` sería
// P7, la interfaz fantasma), que la última entrada es total (sin eso
// `resolverEstatus` tendría un hueco), y que `CLAVES_ESTATUS` espeja el
// arreglo (es lo que consume `z.enum` y el `<select>` del catálogo).
// ============================================================
import { describe, it, expect } from 'vitest';
import { CLAVES_ESTATUS, TAXONOMIA_ESTATUS, resolverEstatus } from './estatus';
import type { BadgeCatalogo } from '@/types/api';

/**
 * Rejilla de entradas que EJERCE cada rama de la taxonomía (P26: la rama
 * tiene que ejecutarse, no solo existir). Cubre además las combinaciones
 * donde dos entradas aplican a la vez y decide la precedencia.
 */
const REJILLA: Array<{ badges: BadgeCatalogo[]; disponible: number; esperada: string }> = [
  { badges: ['sobre_reservado'], disponible: -3, esperada: 'sobre_reservado' },
  { badges: ['sobre_reservado', 'stock_cero'], disponible: -5, esperada: 'sobre_reservado' },
  { badges: ['stock_cero'], disponible: 0, esperada: 'sin_stock' },
  { badges: [], disponible: 0, esperada: 'reservado_completo' },
  { badges: [], disponible: 12, esperada: 'disponible' },
  { badges: ['sin_familia'], disponible: 8, esperada: 'disponible' },
];

describe('[2.0.1-A] TAXONOMIA_ESTATUS como data', () => {
  it('cada clave de la taxonomía es ALCANZABLE — la rejilla la produce al menos una vez', () => {
    const alcanzadas = new Set(REJILLA.map((c) => resolverEstatus(c.badges, c.disponible).clave));
    // No basta con que la rejilla acierte sus casos: el conjunto de claves
    // producidas tiene que ser EXACTAMENTE el de la taxonomía. Una entrada
    // nueva sin caso aquí pone este test en rojo — que es el punto: nace
    // con su rama ejercida o no nace.
    expect(Array.from(alcanzadas).sort()).toEqual(Array.from(CLAVES_ESTATUS).sort());
  });

  it('la rejilla resuelve cada caso a su clave esperada', () => {
    for (const caso of REJILLA) {
      expect(resolverEstatus(caso.badges, caso.disponible).clave).toBe(caso.esperada);
    }
  });

  it('la ÚLTIMA entrada es total: aplica a cualquier combinación de badges y disponible', () => {
    const ultima = TAXONOMIA_ESTATUS[TAXONOMIA_ESTATUS.length - 1];
    const badgesPosibles: BadgeCatalogo[][] = [[], ['sobre_reservado'], ['stock_cero'], ['sin_familia'], ['sobre_reservado', 'sin_familia', 'stock_cero']];
    for (const badges of badgesPosibles) {
      for (const disponible of [-10, -1, 0, 1, 500]) {
        expect(ultima.aplica(badges, disponible)).toBe(true);
      }
    }
  });

  it('CLAVES_ESTATUS espeja el arreglo en su orden (es lo que consumen z.enum y el <select>)', () => {
    expect(CLAVES_ESTATUS).toEqual(TAXONOMIA_ESTATUS.map((e) => e.clave));
  });

  it('resolverEstatus SIEMPRE devuelve una entrada de la taxonomía, con clave/label/tono de esa entrada', () => {
    const badgesPosibles: BadgeCatalogo[][] = [[], ['sobre_reservado'], ['stock_cero'], ['sobre_reservado', 'stock_cero'], ['sin_familia']];
    for (const badges of badgesPosibles) {
      for (const disponible of [-2, 0, 3]) {
        const r = resolverEstatus(badges, disponible);
        const entrada = TAXONOMIA_ESTATUS.find((e) => e.clave === r.clave);
        expect(entrada).toBeDefined();
        expect(r).toEqual({ clave: entrada!.clave, label: entrada!.label, tono: entrada!.tono });
      }
    }
  });
});
