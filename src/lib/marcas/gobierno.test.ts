import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CENTINELA_PRE_REGLA,
  esPosteriorALaRegla,
  tieneDecision,
  estadoDe,
  pideAtencion,
  autoriaIncompleta,
  type MarcaGobierno,
} from './gobierno';

function marca(over: Partial<MarcaGobierno> = {}): MarcaGobierno {
  return {
    nombre: 'BRAND1',
    excluida: false,
    motivo: null,
    por: null,
    en: null,
    creadaEn: CENTINELA_PRE_REGLA,
    ...over,
  };
}

// ============================================================
// EL COTEJO CONTRA LA MIGRACIÓN.
//
// `CENTINELA_PRE_REGLA` es una SEGUNDA COPIA de un valor que vive en la 0039.
// Que hoy coincidan no prueba nada mañana, y una alarma calibrada contra un
// centinela equivocado es peor que no tenerla: suena siempre o no suena nunca.
// Esto no la evita —la migración ya corrió y el código tiene que reconocer lo
// que ella escribió— pero la vuelve COTEJADA en vez de sólo coincidente.
// ============================================================
describe('el centinela está cotejado contra la migración que lo escribió', () => {
  const SQL = readFileSync('supabase/migrations/0039_vert_b2_exclusion_por_marca.sql', 'utf8');

  /**
   * Postgres escribe `2026-01-01 00:00:00+00`: espacio en vez de `T` y un
   * desplazamiento de dos dígitos que NO es ISO — `Date.parse` lo da `NaN`.
   * Se normaliza la GRAFÍA para poder comparar INSTANTES; si en vez de esto se
   * compararan las cadenas, la prueba mediría la ortografía de Postgres.
   */
  const instante = (sql: string) => Date.parse(sql.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));

  it('la 0039 sigue existiendo y sigue escribiendo un centinela (si no, esto es vacuo)', () => {
    expect(SQL).toContain('creada_en');
    expect(SQL).toMatch(/TIMESTAMPTZ\s+'[^']+'/);
  });

  it('el valor del módulo es EL MISMO instante que el de la migración', () => {
    // La migración lo escribe como `TIMESTAMPTZ '2026-01-01 00:00:00+00'`; aquí
    // vive en ISO. Se comparan como INSTANTES, no como texto: son dos grafías
    // del mismo momento y exigir la misma cadena sería medir la ortografía.
    const m = SQL.match(/SET creada_en = TIMESTAMPTZ '([^']+)'/);
    expect(m, 'la 0039 ya no siembra el centinela como se esperaba').not.toBeNull();
    expect(instante(m![1])).toBe(Date.parse(CENTINELA_PRE_REGLA));
  });

  it('y la consulta de la alarma de la migración usa ESE mismo centinela', () => {
    const m = SQL.match(/creada_en > TIMESTAMPTZ '([^']+)'/);
    expect(m, 'la 0039 ya no declara la alarma como se esperaba').not.toBeNull();
    expect(instante(m![1])).toBe(Date.parse(CENTINELA_PRE_REGLA));
  });
});

describe('esPosteriorALaRegla', () => {
  it('el centinela EXACTO es anterior (es la marca de «ya existía»), no posterior', () => {
    expect(esPosteriorALaRegla(CENTINELA_PRE_REGLA)).toBe(false);
  });

  it('un instante posterior sí lo es', () => {
    expect(esPosteriorALaRegla('2026-09-21T00:00:00.000Z')).toBe(true);
  });

  it('un instante anterior no lo es', () => {
    expect(esPosteriorALaRegla('2025-12-31T23:59:59.000Z')).toBe(false);
  });

  // `creada_en` es NOT NULL DEFAULT now() desde la 0039: un nulo sólo puede
  // venir de un camino que no pasó por ella. Tratarlo como «nueva» dispararía
  // la alarma por una fila vieja y rara, y así se aprende a ignorarla.
  it('null cuenta como ANTERIOR — no hace sonar la alarma', () => {
    expect(esPosteriorALaRegla(null)).toBe(false);
  });

  it('una fecha ilegible no hace sonar la alarma (y tampoco revienta)', () => {
    expect(esPosteriorALaRegla('no-es-una-fecha')).toBe(false);
  });
});

// ⚠ ESTA ES LA DISTINCIÓN QUE SOSTIENE LA ALARMA ENTERA.
describe('tieneDecision · «no excluida» NO es lo mismo que «nadie la miró»', () => {
  it('una marca con fecha de decisión SÍ tiene decisión, aunque no esté excluida', () => {
    expect(tieneDecision(marca({ excluida: false, en: '2026-09-21T00:00:00.000Z' }))).toBe(true);
  });

  it('una marca sin fecha NO tiene decisión, aunque su booleano diga false', () => {
    expect(tieneDecision(marca({ excluida: false, en: null }))).toBe(false);
  });
});

describe('estadoDe', () => {
  it('separa las excluidas y cuenta el total (el denominador, siempre a la vista)', () => {
    const e = estadoDe([
      marca({ nombre: 'BRAND1' }),
      marca({ nombre: 'VERTICAL', excluida: true, motivo: 'x', por: 'PO', en: '2026-09-21T00:00:00.000Z' }),
    ]);
    expect(e.excluidas.map((m) => m.nombre)).toEqual(['VERTICAL']);
    expect(e.total).toBe(2);
  });

  // EL ANTIPATRÓN QUE LA 0039 EVITÓ CON EL CENTINELA, comprobado aquí: sin él,
  // las marcas preexistentes habrían disparado la alarma el primer día.
  it('la alarma NACE EN CERO: las marcas con el centinela no suenan', () => {
    const e = estadoDe([marca({ nombre: 'A' }), marca({ nombre: 'B' }), marca({ nombre: 'C' })]);
    expect(e.sinDecidir).toEqual([]);
    expect(pideAtencion(e)).toBe(false);
  });

  it('una marca NUEVA sin decisión sí suena, y viaja para poder nombrarla', () => {
    const nueva = marca({ nombre: 'RECIEN', creadaEn: '2026-09-21T10:00:00.000Z' });
    const e = estadoDe([marca({ nombre: 'BRAND1' }), nueva]);
    expect(e.sinDecidir.map((m) => m.nombre)).toEqual(['RECIEN']);
    expect(pideAtencion(e)).toBe(true);
  });

  it('una marca nueva YA DECIDIDA deja de sonar — la alarma se apaga decidiendo, no ignorando', () => {
    const decidida = marca({
      nombre: 'RECIEN',
      creadaEn: '2026-09-21T10:00:00.000Z',
      en: '2026-09-21T11:00:00.000Z',
    });
    expect(estadoDe([decidida]).sinDecidir).toEqual([]);
  });

  it('una marca nueva decidida COMO EXCLUIDA tampoco suena, y sale en la otra lista', () => {
    const e = estadoDe([
      marca({
        nombre: 'RECIEN',
        creadaEn: '2026-09-21T10:00:00.000Z',
        excluida: true,
        motivo: 'no se cotiza',
        por: 'PO',
        en: '2026-09-21T11:00:00.000Z',
      }),
    ]);
    expect(e.sinDecidir).toEqual([]);
    expect(e.excluidas.map((m) => m.nombre)).toEqual(['RECIEN']);
  });

  it('universo vacío: cero excluidas, cero alarma, total 0 (y no revienta)', () => {
    const e = estadoDe([]);
    expect(e).toEqual({ excluidas: [], sinDecidir: [], total: 0 });
    expect(pideAtencion(e)).toBe(false);
  });
});

describe('autoriaIncompleta · el CHECK lo vuelve inexpresable, así que verlo es un síntoma', () => {
  it('excluida con los tres campos puestos: completa', () => {
    expect(
      autoriaIncompleta(marca({ excluida: true, motivo: 'x', por: 'PO', en: '2026-09-21T00:00:00.000Z' })),
    ).toBe(false);
  });

  it.each(['motivo', 'por', 'en'] as const)('excluida sin %s: incompleta', (campo) => {
    const base = marca({ excluida: true, motivo: 'x', por: 'PO', en: '2026-09-21T00:00:00.000Z' });
    expect(autoriaIncompleta({ ...base, [campo]: null })).toBe(true);
  });

  // No se acusa a una marca que NO está excluida: sus campos de autoría son
  // nulos por diseño y el CHECK lo permite explícitamente.
  it('NO excluida y sin autoría: eso es lo normal, no un síntoma', () => {
    expect(autoriaIncompleta(marca({ excluida: false }))).toBe(false);
  });
});
