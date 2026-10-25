import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseWest } from '../parse.west';
import { realWest } from './helpers';
import { libroStockJulio, libroStockVivo } from '@/services/ingesta/__tests__/libros-muestra';
import type { Cell, Grid } from '../types';
import { MUESTRA } from './constantes-muestra';

const DORADO = MUESTRA.dorados.west;
const [TESTIGO_1, TESTIGO_MILES, TESTIGO_DOS_MIL] = MUESTRA.westTestigos;

/** Regex «empieza con» sobre un texto literal del generador (sin metacaracteres de regex). */
const empiezaCon = (t: string) => new RegExp(`^${t}`);

describe('parseWest (fixture de muestra INV_WEST)', () => {
  const { rows } = parseWest(realWest());

  it('salta banner (fila 3) y header (fila 4), parsea data (filas por construcción del generador)', () => {
    expect(rows.length).toBe(MUESTRA.abril.westRows);
  });
  it(`locale europeo en FISICO: ${TESTIGO_1.texto} → ${TESTIGO_1.fisico}`, () => {
    expect(rows.find((r) => r.sku === TESTIGO_1.sku)?.fisico).toBe(TESTIGO_1.fisico);
  });
  it(`locale europeo: ${TESTIGO_MILES.texto} → ${TESTIGO_MILES.fisico}`, () => {
    expect(rows.find((r) => r.sku === TESTIGO_MILES.sku)?.fisico).toBe(TESTIGO_MILES.fisico);
  });
  it(`locale europeo: ${TESTIGO_DOS_MIL.texto} → ${TESTIGO_DOS_MIL.fisico}`, () => {
    expect(rows.find((r) => r.sku === TESTIGO_DOS_MIL.sku)?.fisico).toBe(TESTIGO_DOS_MIL.fisico);
  });
  it('PROV capturado (marca del nuevo)', () => {
    expect(rows.find((r) => r.sku === TESTIGO_1.sku)?.prov).toBe(TESTIGO_1.prov);
    expect(rows.find((r) => r.sku === DORADO.sku)?.prov).toBe(DORADO.prov);
  });
  it('SKU en mayúsculas y únicos', () => {
    expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);
  });
});

// ============================================================
// Bloque INV-B8 · carril A · O4: MISMOS asserts contra las 3 eras
// (unificado mayo 2026 = fuente mensual VIGENTE, hoja 'INV
// WEST' SIN columna PROV (A7: 'prov' se llena vía el respaldo MARCA,
// ver COLS.prov en parse.west.ts); julio 2026 hoja 'WEST' y abril
// 2026 hoja 'INV_WEST' = histórico, AMBAS con PROV directo — ver
// comentario de ERA en `src/config/ingesta-mapeo.ts`). abril usa el
// fixture YA versionado (`helpers.ts#realWest`); julio/unificado se
// leen del .xlsx de muestra en `muestra/` (lo genera
// `scripts/generar-datos-muestra.mjs`) sin copia intermedia — se saltan
// (no fallan) si el archivo no está en el checkout, mismo
// criterio que `src/services/ingesta/__tests__/motor.test.ts`.
// ============================================================
const ARCHIVO_JULIO = libroStockJulio();
const ARCHIVO_UNIFICADO = libroStockVivo();
const hayJulio = ARCHIVO_JULIO !== null;
const hayUnificado = ARCHIVO_UNIFICADO !== null;

/** Hoja de libro → Grid. Helper LOCAL (solo de este archivo de test, mismo criterio que clasificacion.build.integration.test.ts). */
function hojaAGrid(path: string, hoja: string): Grid {
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheet = wb.Sheets[hoja];
  if (!sheet) throw new Error(`hoja no encontrada en ${path}: ${hoja}`);
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

// SKU presente en las 3 eras con el MISMO fisico (5) y la MISMA
// descripción base (unificado la trae más larga, pero con el mismo
// prefijo) — presente en los 3 libros de muestra (primera
// fila de datos de INV WEST/WEST en las 3 eras).
const SKU_DORADO = DORADO.sku;

interface FormatoWest {
  nombre: string;
  grid: () => Grid;
  provEsperado: string;
  // null = esta era escribe la descripción como 'DESC' (julio), que
  // `parse.west.ts` NO reconoce nativamente A PROPÓSITO (solo
  // 'descripcion'/'descr'/'descrip', A4) — 'DESC' se resuelve vía el
  // alias `DESC->DESCRIPCION` de `ingesta-mapeo.ts`, que aplica el
  // MOTOR antes de llamar al parser (fuera de alcance de este bloque/
  // carril; cubierto en `motor.test.ts`). Llamar a `parseWest`
  // DIRECTO (como aquí, sin pasar por el motor) es la prueba honesta
  // de qué reconoce el parser por sí solo.
  descrEsperado: RegExp | null;
  // [FIX-B1·T4] null en las 3 = esta era NO trae TECNOLOGIA/FAMILIA/CLASE en
  // 'INV WEST' (solo el unificado de mayo 2026 en adelante las trae — ver
  // el comentario de era al inicio de `parse.west.ts`).
  tecEsperada: string | null;
  familiaEsperada: string | null;
  claseEsperada: string | null;
}

const FORMATOS: FormatoWest[] = [
  ...(hayUnificado
    ? [
        {
          nombre: 'unificado mayo 2026 (vigente, SIN columna PROV — prov vía respaldo MARCA, A7)',
          grid: () => hojaAGrid(ARCHIVO_UNIFICADO!, 'INV WEST'),
          provEsperado: DORADO.prov, // A7: sin columna PROV, 'prov' se llena desde MARCA (ver COLS.prov)
          descrEsperado: empiezaCon(DORADO.descr), // header 'DESCRIP' (A4, nativo); el unificado la trae más larga, con el mismo prefijo
          tecEsperada: DORADO.tecnologiaUnificado,
          familiaEsperada: DORADO.familiaUnificado,
          claseEsperada: DORADO.claseUnificado,
        },
      ]
    : []),
  ...(hayJulio
    ? [
        {
          nombre: 'julio 2026 (histórico, CON prov)',
          grid: () => hojaAGrid(ARCHIVO_JULIO!, 'WEST'),
          provEsperado: DORADO.prov,
          descrEsperado: null, // header 'DESC' — ver nota de la interfaz arriba
          tecEsperada: null,
          familiaEsperada: null,
          claseEsperada: null,
        },
      ]
    : []),
  {
    nombre: 'abril 2026 (histórico, fixture versionado, CON prov)',
    grid: () => realWest(),
    provEsperado: DORADO.prov,
    descrEsperado: empiezaCon(DORADO.descr), // header 'DESCRIPCION' (A4, nativo)
    tecEsperada: null,
    familiaEsperada: null,
    claseEsperada: null,
  },
];

describe.each(FORMATOS)(
  'parseWest — MISMOS asserts en $nombre',
  ({ grid, provEsperado, descrEsperado, tecEsperada, familiaEsperada, claseEsperada }) => {
    const { rows } = parseWest(grid());

    it('parsea filas (header detectado con/sin banner, con/sin columna PROV)', () => {
      expect(rows.length).toBeGreaterThan(0);
    });

    it('SKUs únicos', () => {
      expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);
    });

    it(`SKU dorado ${SKU_DORADO}: fisico=5 en las 3 eras (locale europeo tolerado)`, () => {
      const r = rows.find((x) => x.sku === SKU_DORADO);
      expect(r).toBeDefined();
      expect(r?.fisico).toBe(5);
    });

    it(`SKU dorado ${SKU_DORADO}: descripción según lo que este header reconoce nativamente (A4)`, () => {
      const r = rows.find((x) => x.sku === SKU_DORADO);
      if (descrEsperado) expect(r?.descr).toMatch(descrEsperado);
      else expect(r?.descr).toBeNull();
    });

    it(`SKU dorado ${SKU_DORADO}: prov = '${provEsperado || "''"}' en esta era`, () => {
      const r = rows.find((x) => x.sku === SKU_DORADO);
      expect(r?.prov).toBe(provEsperado);
    });

    it(`SKU dorado ${SKU_DORADO}: tecnología/familia/clase según lo que este header trae (solo el unificado las tiene)`, () => {
      const r = rows.find((x) => x.sku === SKU_DORADO);
      expect(r?.tecnologia).toBe(tecEsperada);
      expect(r?.familia).toBe(familiaEsperada);
      expect(r?.class).toBe(claseEsperada);
    });
  },
);

// ============================================================
// A3/A5, sobre archivo REAL: julio (CON PROV, pero con 'DESC' que el
// parser no reconoce nativo) deja SOLO el rastro de descripción
// ausente — no hace falta sintético para ese caso, el archivo real YA
// lo ejercita de forma natural.
// El unificado (SIN columna PROV, CON DESCRIP) dejaba (antes de A7)
// SOLO el rastro de prov ausente; desde A7 'MARCA' respalda a 'prov'
// (ver COLS.prov en parse.west.ts), así que ya NO deja ese rastro —
// el caso "ni PROV ni MARCA" sigue cubierto, ahora solo de forma
// sintética, en el describe "sin PROV ni DESCR" más abajo.
// ============================================================
describe('parseWest — A3/A5 sobre archivo real: PROV opcional, con rastro cuando falta', () => {
  (hayUnificado ? it : it.skip)(
    'unificado (INV WEST real, SIN columna PROV pero CON MARCA de respaldo, A7): parsea igual y SIN rastro de columna ausente (MARCA cubre prov, DESCRIP cubre descr, y TECNOLOGIA/FAMILIA/CLASE ya están nativas)',
    () => {
      const { rows, cuarentena } = parseWest(hojaAGrid(ARCHIVO_UNIFICADO!, 'INV WEST'));
      expect(rows.length).toBeGreaterThan(0);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_prov')).toEqual([]); // A7: MARCA respalda a PROV
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_descripcion')).toEqual([]); // DESCRIP sí está (A4)
      // [FIX-B1·T4]: el unificado SÍ trae TECNOLOGIA/FAMILIA/CLASE nativas.
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_tecnologia')).toEqual([]);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_familia')).toEqual([]);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_clase')).toEqual([]);
    },
  );

  (hayJulio ? it : it.skip)(
    "julio (WEST real, CON columna PROV pero header 'DESC'): sin rastro de prov ausente, " +
      'SÍ de descripción (DESC necesita el alias del motor, fuera de alcance aquí — ver motor.test.ts), ' +
      'y [FIX-B1·T4] SÍ de tecnología/familia/clase: julio no trae esas 3 columnas en INV WEST',
    () => {
      const { cuarentena } = parseWest(hojaAGrid(ARCHIVO_JULIO!, 'WEST'));
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_prov')).toEqual([]);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_descripcion')).toHaveLength(1);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_tecnologia')).toHaveLength(1);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_familia')).toHaveLength(1);
      expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_clase')).toHaveLength(1);
    },
  );
});

// ============================================================
// A4: las 3 formas NATIVAS que reconoce parse.west.ts por sí mismo
// (sin pasar por ningún alias del motor). DESCRIPCION (abril, real,
// arriba) y DESCRIP (unificado, real, arriba) ya quedaron cubiertas;
// 'DESCR' a secas no aparece hoy en ningún archivo real de los 3, así
// que se prueba con un grid mínimo — sigue siendo NATIVO del parser,
// no vía config.
// ============================================================
describe("parseWest — A4: 'DESCR' (forma nativa, sin archivo real actual que la use)", () => {
  const grid: Grid = [
    [null, 'ITEM', 'PROV', 'DESCR', 'FISICO'],
    [null, 'SKU-1', 'ACME', 'Repuesto generico', 2],
  ];
  const { rows } = parseWest(grid);

  it("'DESCR' resuelve a la misma columna lógica que DESCRIPCION/DESCRIP", () => {
    expect(rows).toEqual([
      { sku: 'SKU-1', prov: 'ACME', tecnologia: null, familia: null, class: null, descr: 'Repuesto generico', fisico: 2 },
    ]);
  });
});

// ============================================================
// A5: rastro cuando falta DESCR — caso sintético (ningún archivo real
// actual carece de descripción, así que se prueba el mecanismo general
// con un grid mínimo). [FIX-B1·T4] El mismo grid mínimo (solo ITEM +
// FISICO) también carece de TECNOLOGIA/FAMILIA/CLASE, así que ahora
// suma esos 3 rastros a los 2 que ya dejaba.
// ============================================================
describe('parseWest — A5: rastro de columna ausente (sintético, sin PROV ni DESCR)', () => {
  const grid: Grid = [
    [null, 'ITEM', 'FISICO'],
    [null, 'SKU-1', 3],
  ];
  const { rows, cuarentena } = parseWest(grid);

  it('la fila SÍ se parsea — un rastro no es un bloqueo', () => {
    expect(rows).toEqual([
      { sku: 'SKU-1', prov: '', tecnologia: null, familia: null, class: null, descr: null, fisico: 3 },
    ]);
  });

  it('cuarentena trae los 5 rastros A5 (prov, descripción, tecnología, familia y clase ausentes)', () => {
    expect(cuarentena.map((c) => c.motivo).sort()).toEqual([
      'columna_ausente_clase',
      'columna_ausente_descripcion',
      'columna_ausente_familia',
      'columna_ausente_prov',
      'columna_ausente_tecnologia',
    ]);
  });

  it('cada item es a nivel de HOJA (diagnóstico, no de una fila): sku null, sin fila, entidad stock', () => {
    for (const c of cuarentena) {
      expect(c.sku).toBeNull();
      expect(c.entidad).toBe('stock');
      expect(c.origen).toEqual({ hoja: 'INV_WEST' });
    }
  });
});

// ============================================================
// A7 (bloque INV-B8): 'MARCA' como respaldo de 'prov' cuando la hoja
// NO trae columna PROV — caso sintético mínimo, independiente del
// .xlsx real (que además puede faltar en el checkout, ver `hayUnificado`
// arriba). Ver el comentario de `COLS.prov` en parse.west.ts para el
// razonamiento completo (por qué el dato alimenta la MARCA del
// producto NUEVO en reconcile.ts, por qué el campo se llama 'prov', y
// por qué 'prov' y 'marca' conviven como alias a propósito).
// ============================================================
describe("parseWest — A7: 'MARCA' resuelve como respaldo de 'prov' (sin columna PROV)", () => {
  const grid: Grid = [
    [null, 'ITEM', 'MARCA', 'DESCRIP', 'FISICO'],
    [null, 'SKU-7', 'SERIES5', 'Repuesto generico', 4],
  ];
  const { rows, cuarentena } = parseWest(grid);

  it("'MARCA' alimenta 'prov' cuando no hay columna PROV en la hoja", () => {
    expect(rows).toEqual([
      { sku: 'SKU-7', prov: 'SERIES5', tecnologia: null, familia: null, class: null, descr: 'Repuesto generico', fisico: 4 },
    ]);
  });

  it('sin rastro columna_ausente_prov: MARCA ya cubrió el campo', () => {
    expect(cuarentena.filter((c) => c.motivo === 'columna_ausente_prov')).toEqual([]);
  });

  it('si AMBAS columnas existen (PROV y MARCA), gana PROV (la de más a la izquierda, primera coincidencia)', () => {
    const gridConAmbas: Grid = [
      [null, 'ITEM', 'PROV', 'MARCA', 'FISICO'],
      [null, 'SKU-8', 'SERIES5', 'OTRAMARCA', 1],
    ];
    const { rows: r2 } = parseWest(gridConAmbas);
    expect(r2[0]?.prov).toBe('SERIES5');
  });
});

// ============================================================
// Punto 2 (bloque INV-B8): el archivo VIVO del unificado (que no está
// en el repo — la copia de muestra es una instantánea con
// header en fila 1) trae la cabecera de 'INV WEST'
// en la fila 4, con preámbulo arriba (mismo tipo de forma que abril
// 2026, que ya trae banner en fila 3 + header en fila 4 — ver fixture
// `fixtures/muestra/west.grid.json`). `detectHeaderRow` (grid.ts) localiza el
// header por CONTENIDO, escaneando fila por fila — a propósito
// indiferente a en qué fila caiga. Este test lo demuestra con el
// header NUEVO (formato unificado, con MARCA en vez de PROV): el mismo
// grid, con y sin preámbulo, debe parsear IDÉNTICO.
// ============================================================
describe('parseWest — Punto 2: cabecera del unificado en fila 4 con preámbulo (forma del archivo vivo) parsea IGUAL que en fila 1', () => {
  const HEADER_UNIFICADO = ['ITEM', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'CLASE', 'DESCRIP', 'FISICO'];
  const FILA_DATOS = [
    '0861-5844-9317',
    'EAS',
    'SERIES5',
    'SERIES11 ALFA',
    'A',
    'SERIES11 AM ALFA SYSTEM, INCLUDES CONTROL UNIT',
    5,
  ];

  const gridFila1: Grid = [HEADER_UNIFICADO, FILA_DATOS];

  const gridFila4: Grid = [
    ['INVENTARIO DEMO II UNIFICACIÓN', null, null, null, null, null, null], // preámbulo: título
    [null, null, null, null, null, null, null], // preámbulo: fila vacía
    ['Corte al cierre del mes', null, null, null, null, null, null], // preámbulo: leyenda
    HEADER_UNIFICADO, // fila 4 (índice 3)
    FILA_DATOS,
  ];

  it('mismos rows con header en fila 1 o en fila 4 (incluye prov vía respaldo MARCA, A7)', () => {
    const { rows: rowsFila1 } = parseWest(gridFila1);
    const { rows: rowsFila4 } = parseWest(gridFila4);
    expect(rowsFila1).toEqual([
      {
        sku: '0861-5844-9317',
        prov: 'SERIES5',
        tecnologia: 'EAS',
        familia: 'SERIES11 ALFA',
        class: 'A',
        descr: 'SERIES11 AM ALFA SYSTEM, INCLUDES CONTROL UNIT',
        fisico: 5,
      },
    ]);
    expect(rowsFila4).toEqual(rowsFila1);
  });

  it('sin cuarentena de columna ausente en ninguna de las 2 posiciones (MARCA y DESCRIP cubren prov/descr)', () => {
    expect(parseWest(gridFila1).cuarentena).toEqual([]);
    expect(parseWest(gridFila4).cuarentena).toEqual([]);
  });
});
