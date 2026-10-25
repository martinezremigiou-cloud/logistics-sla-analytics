import { describe, it, expect } from 'vitest';
import { SEPARADOR_FAMILIA, separarFamilias, contieneFamilia, perteneceAFamilia, sinFamilia } from './familias';

describe('SEPARADOR_FAMILIA', () => {
  it('es literalmente "/"', () => {
    expect(SEPARADOR_FAMILIA).toBe('/');
  });
});

describe('separarFamilias', () => {
  describe('casos base', () => {
    it('null → []', () => {
      expect(separarFamilias(null)).toEqual([]);
    });

    it('undefined → []', () => {
      expect(separarFamilias(undefined)).toEqual([]);
    });

    it('"" → []', () => {
      expect(separarFamilias('')).toEqual([]);
    });

    it('solo espacios → []', () => {
      expect(separarFamilias('   ')).toEqual([]);
    });

    it('un solo valor sin separador → [valor] (preserva el string tal cual)', () => {
      expect(separarFamilias('CANDADOS')).toEqual(['CANDADOS']);
    });
  });

  describe('regla 1 — SOLO "/"; jamás "&" ni "-" (nombres propios reales)', () => {
    it('SERIES 12 no se parte (no hay "/")', () => {
      expect(separarFamilias('SERIES 12')).toEqual(['SERIES 12']);
    });

    it('CLIPS MODULAR no se parte', () => {
      expect(separarFamilias('CLIPS MODULAR')).toEqual(['CLIPS MODULAR']);
    });

    it('P-LOCK: el guion NO es separador', () => {
      expect(separarFamilias('P-LOCK')).toEqual(['P-LOCK']);
    });

    it('R-LOCK: el guion NO es separador', () => {
      expect(separarFamilias('R-LOCK')).toEqual(['R-LOCK']);
    });

    it('CLIP NON-MODULAR: el guion NO es separador', () => {
      expect(separarFamilias('CLIP NON-MODULAR')).toEqual(['CLIP NON-MODULAR']);
    });

    it('CLIPS 5 & 9: el "&" NO es separador', () => {
      expect(separarFamilias('CLIPS 5 & 9')).toEqual(['CLIPS 5 & 9']);
    });

    it('CLIPS 5 & 9 PORT: el "&" NO es separador', () => {
      expect(separarFamilias('CLIPS 5 & 9 PORT')).toEqual(['CLIPS 5 & 9 PORT']);
    });
  });

  describe('regla 2 — "/" con o sin espacios alrededor (mismo concepto)', () => {
    it('QZ8/H5980 (sin espacios)', () => {
      expect(separarFamilias('QZ8/H5980')).toEqual(['QZ8', 'H5980']);
    });

    it('QZ8 / H5980 (con espacios) → MISMO resultado', () => {
      expect(separarFamilias('QZ8 / H5980')).toEqual(['QZ8', 'H5980']);
    });
  });

  describe('regla 3 — trim + colapsar espacios internos (nunca uppercase)', () => {
    it('doble espacio alrededor del separador: "SERIES 2 48  / SERIES 2 72"', () => {
      expect(separarFamilias('SERIES 2 48  / SERIES 2 72')).toEqual(['SERIES 2 48', 'SERIES 2 72']);
    });

    it('doble espacio DENTRO de un átomo (sin separador) se colapsa a uno', () => {
      expect(separarFamilias('CANDADOS  DE SEGURIDAD')).toEqual(['CANDADOS DE SEGURIDAD']);
    });

    it('el bug real de colisión (doble espacio tras "/") normaliza IGUAL que la variante de un solo espacio', () => {
      const conDobleEspacio = separarFamilias('CLIP 3.0 /  CLIP MODULAR');
      const conUnEspacio = separarFamilias('CLIP 3.0 / CLIP MODULAR');
      expect(conDobleEspacio).toEqual(['CLIP 3.0', 'CLIP MODULAR']);
      expect(conDobleEspacio).toEqual(conUnEspacio);
    });

    it('NUNCA uppercasea: preserva minúsculas del crudo', () => {
      expect(separarFamilias('series 23')).toEqual(['series 23']);
    });
  });

  describe('regla 4 — átomos vacíos se descartan', () => {
    it('"FOO / / BAR" → ["FOO", "BAR"] (atomiza normal: ningún átomo es sospechoso)', () => {
      expect(separarFamilias('FOO / / BAR')).toEqual(['FOO', 'BAR']);
    });

    it('separador al inicio y al final: "/FOO/BAR/"', () => {
      expect(separarFamilias('/FOO/BAR/')).toEqual(['FOO', 'BAR']);
    });

    /**
     * El ejemplo LITERAL del spec ("A / / B" → ['A','B']) usa átomos de
     * una sola letra como placeholder narrativo de "descartar vacíos" —
     * pero 'A' y 'B' tienen exactamente la MISMA forma que la 'K' de
     * `ZV680G/K` (longitud 1), el caso real que la regla 7 (compuerta
     * anti-átomo-fantasma) está diseñada para atrapar. No existe
     * heurística de longitud/numérico que distinga 'A' de 'K': ambas
     * son letras sueltas. Por diseño (regla 7 es la que protege el GATE
     * de conservación de piezas — ver dashboard.service.ts — y está
     * ratificada con evidencia real), la compuerta GANA: "A / / B" NO
     * se atomiza, se devuelve completo. El caso "descartar átomos
     * vacíos" en aislamiento queda cubierto arriba con FOO/BAR (átomos
     * que no disparan la compuerta).
     */
    it('"A / / B" (ejemplo literal del spec): la compuerta anti-átomo-fantasma GANA — "A" y "B" son letras sueltas (longitud 1), igual que la "K" real de ZV680G/K — se devuelve completo, sin atomizar', () => {
      expect(separarFamilias('A / / B')).toEqual(['A / / B']);
    });
  });

  describe('regla 5 — dedupe case-insensitive preservando el orden de aparición', () => {
    it('CLIP 3.0 / CLIP ROTATIVO: ambos átomos distintos, orden preservado (ejemplo de 4 SKUs)', () => {
      expect(separarFamilias('CLIP 3.0 / CLIP ROTATIVO')).toEqual(['CLIP 3.0', 'CLIP ROTATIVO']);
    });

    it('dedupe case-insensitive: gana la PRIMERA casing vista', () => {
      expect(separarFamilias('CANDADOS / candados')).toEqual(['CANDADOS']);
    });

    it('dedupe no rompe el orden de los átomos restantes', () => {
      expect(separarFamilias('FOO / BAR / foo / BAZ')).toEqual(['FOO', 'BAR', 'BAZ']);
    });

    it('13 átomos distintos: se conservan los 13, en orden', () => {
      const familias13 = Array.from({ length: 13 }, (_, i) => `FAM-${i + 1}`);
      const crudo = familias13.join(' / ');
      expect(separarFamilias(crudo)).toEqual(familias13);
    });
  });

  describe('regla 6 — null/vacío equivalente al familia===null de hoy', () => {
    it('null → [] (alimenta sin_familia)', () => {
      expect(separarFamilias(null)).toEqual([]);
    });

    it('"" → [] (alimenta sin_familia)', () => {
      expect(separarFamilias('')).toEqual([]);
    });
  });

  describe('regla 7 — COMPUERTA anti-átomo-fantasma (casos reales)', () => {
    it('ZV680G/K: "K" (length 1) es sospechoso → NO se atomiza, queda completo', () => {
      expect(separarFamilias('ZV680G/K')).toEqual(['ZV680G/K']);
    });

    it('Z1900 / 6693: "6693" (puramente numérico) es sospechoso → NO se atomiza, queda completo', () => {
      expect(separarFamilias('Z1900 / 6693')).toEqual(['Z1900 / 6693']);
    });

    it('límite: átomo de longitud 2 dispara la compuerta', () => {
      expect(separarFamilias('FOO/AB')).toEqual(['FOO/AB']);
    });

    it('límite: átomo puramente numérico de cualquier longitud dispara la compuerta', () => {
      expect(separarFamilias('FOO/100')).toEqual(['FOO/100']);
    });

    it('límite: átomo de longitud 3 NO numérico NO dispara la compuerta (se atomiza normal)', () => {
      expect(separarFamilias('FOO/ABC')).toEqual(['FOO', 'ABC']);
    });

    it('la compuerta normaliza (trim/colapsa) el string completo antes de devolverlo', () => {
      expect(separarFamilias('  ZV680G/K  ')).toEqual(['ZV680G/K']);
    });
  });

  describe('regla 8 (documental) — separarFamilias NUNCA hace substring; eso es contieneFamilia', () => {
    it('el resultado son átomos completos, no fragmentos de búsqueda', () => {
      expect(separarFamilias('SERIES 12')).not.toContain('SERIES12');
    });
  });
});

describe('contieneFamilia', () => {
  describe('regla 8 — pertenencia TOKEN-EXACTA case-insensitive, NUNCA substring', () => {
    it('"SERIES12" NO matchea "SERIES 12" (substring rechazado)', () => {
      expect(contieneFamilia('SERIES 12', 'SERIES12')).toBe(false);
    });

    it('"SERIES 12" SÍ matchea "SERIES 12" (token exacto)', () => {
      expect(contieneFamilia('SERIES 12', 'SERIES 12')).toBe(true);
    });

    it('"CLIP" NO matchea "CLIPS MODULAR" (substring rechazado)', () => {
      expect(contieneFamilia('CLIPS MODULAR', 'CLIP')).toBe(false);
    });

    it('"CLIPS MODULAR" SÍ matchea "CLIPS MODULAR" (case-insensitive)', () => {
      expect(contieneFamilia('CLIPS MODULAR', 'clips modular')).toBe(true);
    });

    it('"LOCK" NO matchea "P-LOCK"', () => {
      expect(contieneFamilia('P-LOCK', 'LOCK')).toBe(false);
    });

    it('"LOCK" NO matchea "R-LOCK"', () => {
      expect(contieneFamilia('R-LOCK', 'LOCK')).toBe(false);
    });

    it('"P-LOCK" SÍ matchea "P-LOCK" (token completo, case-insensitive)', () => {
      expect(contieneFamilia('P-LOCK', 'p-lock')).toBe(true);
    });

    it('"SERIES20" NO matchea "CLIP 3.0 / CLIP ROTATIVO" (el átomo es "CLIP ROTATIVO", no "SERIES20"; ese caso lo resuelve ?q, no este filtro)', () => {
      expect(contieneFamilia('CLIP 3.0 / CLIP ROTATIVO', 'SERIES20')).toBe(false);
    });

    it('"CLIP ROTATIVO" SÍ matchea "CLIP 3.0 / CLIP ROTATIVO" (token completo)', () => {
      expect(contieneFamilia('CLIP 3.0 / CLIP ROTATIVO', 'CLIP ROTATIVO')).toBe(true);
    });
  });

  describe('multi-valor: pertenece a CUALQUIERA de los átomos', () => {
    it('matchea el segundo átomo de una lista', () => {
      expect(contieneFamilia('CANDADOS / SENSORES / CARGADORES', 'sensores')).toBe(true);
    });

    it('no matchea un valor ausente de la lista', () => {
      expect(contieneFamilia('CANDADOS / SENSORES', 'CLIPS')).toBe(false);
    });
  });

  describe('casos vacíos', () => {
    it('valor null → false', () => {
      expect(contieneFamilia(null, 'CANDADOS')).toBe(false);
    });

    it('valor "" → false', () => {
      expect(contieneFamilia('', 'CANDADOS')).toBe(false);
    });
  });

  describe('buscada con espacios/casing sucios (trim + case-insensitive del lado de búsqueda)', () => {
    it('buscada con espacios alrededor y casing distinto', () => {
      expect(contieneFamilia('CANDADOS', '  candados  ')).toBe(true);
    });
  });
});

describe('perteneceAFamilia (R2-2 — recibe el arreglo YA separado)', () => {
  it('delega exactamente lo mismo que contieneFamilia(valor, buscada) vs perteneceAFamilia(separarFamilias(valor), buscada)', () => {
    expect(perteneceAFamilia(separarFamilias('SERIES 12'), 'SERIES12')).toBe(false);
    expect(perteneceAFamilia(separarFamilias('SERIES 12'), 'SERIES 12')).toBe(true);
    expect(perteneceAFamilia(separarFamilias('CANDADOS / SENSORES / CARGADORES'), 'sensores')).toBe(true);
  });

  it('token-exacto, NUNCA substring, directo sobre el arreglo', () => {
    expect(perteneceAFamilia(['CLIPS MODULAR'], 'CLIP')).toBe(false);
    expect(perteneceAFamilia(['P-LOCK'], 'LOCK')).toBe(false);
  });

  it('arreglo vacío → false para cualquier búsqueda', () => {
    expect(perteneceAFamilia([], 'CANDADOS')).toBe(false);
  });

  it('case-insensitive y con espacios sucios del lado de búsqueda', () => {
    expect(perteneceAFamilia(['CANDADOS'], '  candados  ')).toBe(true);
  });

  it('contieneFamilia delega en perteneceAFamilia: mismo resultado que llamarla a mano', () => {
    const valor = 'CLIP 3.0 / CLIP ROTATIVO';
    expect(contieneFamilia(valor, 'CLIP ROTATIVO')).toBe(perteneceAFamilia(separarFamilias(valor), 'CLIP ROTATIVO'));
  });
});

describe('sinFamilia (R2-1 — único predicado de "sin familia", casos frontera)', () => {
  it('null → true', () => {
    expect(sinFamilia(null)).toBe(true);
  });

  it('undefined → true', () => {
    expect(sinFamilia(undefined)).toBe(true);
  });

  it('"" → true', () => {
    expect(sinFamilia('')).toBe(true);
  });

  it('"   " (solo espacios) → true', () => {
    expect(sinFamilia('   ')).toBe(true);
  });

  it('"/" (un solo separador, sin átomos) → true', () => {
    expect(sinFamilia('/')).toBe(true);
  });

  it('" / / " (separadores con espacios, sin átomos) → true', () => {
    expect(sinFamilia(' / / ')).toBe(true);
  });

  it('con una familia real → false', () => {
    expect(sinFamilia('CANDADOS')).toBe(false);
  });

  it('multi-valor → false (basta con que quede al menos un átomo)', () => {
    expect(sinFamilia('CLIP 3.0 / CLIP ROTATIVO')).toBe(false);
  });

  it('exactamente equivalente a separarFamilias(valor).length === 0 (definición literal)', () => {
    for (const valor of [null, undefined, '', '   ', '/', ' / / ', 'CANDADOS', 'A / B']) {
      expect(sinFamilia(valor)).toBe(separarFamilias(valor).length === 0);
    }
  });
});
