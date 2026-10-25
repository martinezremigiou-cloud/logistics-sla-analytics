import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseInventario } from '../parse.inventario';
import { loadGrid, realInventario } from './helpers';
import { libroStockJulio, libroStockVivo } from '@/services/ingesta/__tests__/libros-muestra';
import { MUESTRA } from './constantes-muestra';
import type { Cell, Grid } from '../types';

describe('parseInventario (edge)', () => {
  const grid = loadGrid('edge/inventario.edge.json');
  const { productos, stock, cuarentena } = parseInventario(grid);

  it('salta banner, gutter y detecta header en fila 4', () => {
    expect(productos.map((p) => p.sku)).toContain('AAA-1');
  });
  it('SKU normalizado a mayúsculas (bbb-2 → BBB-2)', () => {
    expect(productos.find((p) => p.sku === 'BBB-2')).toBeDefined();
  });
  it('locale: QTY/TOTAL 4.285 → 4285 en stock NORTH', () => {
    const s = stock.find((x) => x.sku === 'BBB-2' && x.almacen === 'NORTH');
    expect(s?.cantidad).toBe(4285);
  });
  it('fila TOTALES saltada (no es producto)', () => {
    expect(productos.find((p) => p.sku === 'TOTALES')).toBeUndefined();
  });
  it('fila con ITEM vacío (leyenda) saltada, NO cuenta como cuarentena de producto', () => {
    // la única cuarentena esperada es el renglón sin marca
    expect(cuarentena.filter((c) => c.motivo === 'producto_sin_marca')).toHaveLength(1);
  });
  it('producto sin marca → cuarentena (CCC-3), excluido de productos', () => {
    expect(productos.find((p) => p.sku === 'CCC-3')).toBeUndefined();
    expect(cuarentena.find((c) => c.sku === 'CCC-3')?.motivo).toBe('producto_sin_marca');
  });
  it('stock por almacén: NORTH y TRAN de AAA-1', () => {
    const aaa = stock.filter((s) => s.sku === 'AAA-1').sort((a, b) => a.almacen.localeCompare(b.almacen));
    expect(aaa).toEqual([
      { sku: 'AAA-1', almacen: 'NORTH', cantidad: 13 },
      { sku: 'AAA-1', almacen: 'TRAN', cantidad: 8 },
    ]);
  });
  it('resv y totalFuente capturados (AAA-1 resv 27 / total 21)', () => {
    const aaa = productos.find((p) => p.sku === 'AAA-1')!;
    expect(aaa.resv).toBe(27);
    expect(aaa.totalFuente).toBe(21);
  });
});

describe('parseInventario (fixture de muestra, cientos de SKUs)', () => {
  const { productos, stock } = parseInventario(realInventario());
  it('parsea todos los productos del fixture (cardinalidad por construcción del generador)', () =>
    expect(productos.length).toBe(MUESTRA.abril.productosInventario));
  it('el stock parseado tiene las filas que el modelo declara (SKU × bodega con cantidad > 0)', () =>
    expect(stock.length).toBe(MUESTRA.abril.stockInventario));
  it('marcas nuevas presentes en la data (las tres testigo del generador)', () => {
    const marcas = new Set(productos.map((p) => p.marca.toUpperCase()));
    for (const m of MUESTRA.marcasNuevasTestigo) expect(marcas.has(m)).toBe(true);
  });
  it('SKUs únicos (sin duplicados en productos)', () => {
    expect(new Set(productos.map((p) => p.sku)).size).toBe(productos.length);
  });
  it('stock nunca negativo', () => {
    expect(stock.every((s) => s.cantidad >= 0)).toBe(true);
  });
});

// ============================================================
// Bloque INV-B8 · carril A · O4: MISMOS asserts contra las 3 eras
// (unificado mayo 2026 = fuente mensual VIGENTE; julio 2026 y
// abril 2026 = histórico que debe seguir siendo legible — ver
// comentario de ERA en `src/config/ingesta-mapeo.ts`). abril usa el
// fixture YA versionado (`helpers.ts#realInventario`, única fuente de
// verdad de "cómo era abril" en este repo, ver
// `src/services/ingesta/io.ts#cargarReferenciaAbril`); julio/unificado
// se leen del .xlsx de muestra en `muestra/` (lo genera
// `scripts/generar-datos-muestra.mjs`) sin copia intermedia — se saltan
// (no fallan) si el archivo no está en el checkout, mismo criterio que
// `src/services/ingesta/__tests__/motor.test.ts`.
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

// SKU presente en las 3 eras con el MISMO dato de negocio (marca/
// familia/clase/descr/NORTH) pese al header distinto por era (CLASS vs
// CLASE, DESCR vs DESCRIPCION) — presente en los 3
// libros de muestra (fila 5 de Inventario en las 3 eras).
const DORADO = MUESTRA.dorados.inventario;
const SKU_DORADO = DORADO.sku;

interface FormatoInventario {
  nombre: string;
  grid: () => Grid;
  /**
   * [CAT-B1·A] Los `columna_ausente_*` que ESTA era debe emitir, enumerados.
   *
   * Antes este archivo afirmaba «cero rastro» para las tres eras a la vez. Eso
   * dejó de ser cierto en cuanto TECNOLOGIA y PRODUCTO entraron a
   * `CAMPOS_VISIBLES_OPCIONALES`: abril y julio no traen ninguna de las dos, y
   * el unificado de mayo trae TECNOLOGIA pero NO PRODUCTO. El rojo era
   * CORRECTO — el rastro estaba haciendo su trabajo y el assert era el que
   * mentia, porque decía «cero» donde quería decir «cero de las columnas que
   * ESTA era sí trae».
   *
   * Por eso se declara POR ERA y con `toEqual` exacto: ni de más (una columna
   * que la era sí trae y se perdió aguas arriba) ni de menos (un rastro que
   * dejó de emitirse). Un rango o un `toBeLessThan` aquí sería apagar el gate.
   */
  ausentesEsperadas: string[];
  /** Una columna que ESTA era SÍ trae — sujeto del control positivo. */
  columnaPresente: string;
}

const FORMATOS: FormatoInventario[] = [
  ...(hayUnificado
    ? [
        {
          nombre: 'unificado mayo 2026 (vigente)',
          grid: () => hojaAGrid(ARCHIVO_UNIFICADO!, 'Inventario'),
          // Trae TECNOLOGIA; no trae PRODUCTO (esa llegó después, en el libro de 5 niveles).
          ausentesEsperadas: ['columna_ausente_producto'],
          columnaPresente: 'TECNOLOGIA',
        },
      ]
    : []),
  ...(hayJulio
    ? [
        {
          nombre: 'julio 2026 (histórico)',
          grid: () => hojaAGrid(ARCHIVO_JULIO!, 'Inventario'),
          ausentesEsperadas: ['columna_ausente_producto', 'columna_ausente_tecnologia'],
          columnaPresente: 'FAMILIA',
        },
      ]
    : []),
  {
    nombre: 'abril 2026 (histórico, fixture versionado)',
    grid: () => realInventario(),
    ausentesEsperadas: ['columna_ausente_producto', 'columna_ausente_tecnologia'],
    columnaPresente: 'FAMILIA',
  },
];

/** Devuelve el grid sin la columna cuyo encabezado sea `titulo` (fila física 4 = índice 3). */
function sinColumna(grid: Grid, titulo: string): Grid {
  const header = grid[3] ?? [];
  const i = header.findIndex((c) => String(c ?? '').trim().toUpperCase() === titulo);
  if (i < 0) throw new Error(`control positivo: la columna ${titulo} no está en esta era — sujeto equivocado`);
  return grid.map((fila) => {
    const copia = [...(fila ?? [])];
    copia.splice(i, 1);
    return copia as Cell[];
  });
}

describe.each(FORMATOS)('parseInventario — MISMOS asserts en $nombre', ({ grid, ausentesEsperadas, columnaPresente }) => {
  const { productos, stock, cuarentena } = parseInventario(grid());

  it('parsea productos (header detectado pese al vocabulario de columna distinto por era)', () => {
    expect(productos.length).toBeGreaterThan(0);
  });

  it('SKUs únicos en productos', () => {
    expect(new Set(productos.map((p) => p.sku)).size).toBe(productos.length);
  });

  it('el rastro A5 denuncia EXACTAMENTE las columnas que esta era no trae — ni una más, ni una menos', () => {
    const rastro = cuarentena.filter((c) => c.motivo.startsWith('columna_ausente_')).map((c) => c.motivo).sort();
    expect(rastro).toEqual([...ausentesEsperadas].sort());
  });

  it(`control positivo: si se pierde ${columnaPresente}, que esta era SÍ trae, el rastro lo denuncia — sin esto el assert de arriba no prueba que el rastro funcione`, () => {
    const motivoEsperado = `columna_ausente_${columnaPresente.toLowerCase()}`;
    const { cuarentena: conFalta } = parseInventario(sinColumna(grid(), columnaPresente));
    const rastro = conFalta.filter((c) => c.motivo.startsWith('columna_ausente_')).map((c) => c.motivo).sort();
    expect(rastro).toContain(motivoEsperado);
    expect(rastro).toEqual([...ausentesEsperadas, motivoEsperado].sort());
  });

  it(`SKU dorado ${SKU_DORADO}: mismo dato de negocio pese al header distinto por era (A1: class/clase)`, () => {
    const p = productos.find((x) => x.sku === SKU_DORADO);
    expect(p).toBeDefined();
    expect(p?.marca).toBe(DORADO.marca);
    expect(p?.familia).toBe(DORADO.familia);
    expect(p?.class).toBe(DORADO.clase); // A1: 'CLASE' (unificado) y 'CLASS' (julio/abril) resuelven a lo mismo
    expect(p?.descr).toBe(DORADO.descr);
  });

  it(`SKU dorado ${SKU_DORADO}: ${DORADO.north} en NORTH en las 3 eras`, () => {
    const s = stock.find((x) => x.sku === SKU_DORADO && x.almacen === 'NORTH');
    expect(s?.cantidad).toBe(DORADO.north);
  });

  it('stock nunca negativo', () => {
    expect(stock.every((s) => s.cantidad >= 0)).toBe(true);
  });
});

// ============================================================
// A5: el rastro aparece cuando falta una columna esperada (y NO
// bloquea el parseo). Grid sintético mínimo: solo el ancla obligatoria
// del header (item/marca/total/resv) — familia/clase/descripción/
// cliente A PROPÓSITO ausentes.
// ============================================================
describe('parseInventario — A5: rastro de columna ausente', () => {
  const grid: Grid = [
    [null, 'ITEM', 'MARCA', 'TOTAL', 'RESV'],
    [null, 'SKU-1', 'ACME', 10, 0],
  ];
  const { productos, cuarentena } = parseInventario(grid);

  it('el producto SÍ se parsea — un rastro no es un bloqueo', () => {
    expect(productos).toHaveLength(1);
    expect(productos[0]).toMatchObject({
      sku: 'SKU-1',
      marca: 'ACME',
      tecnologia: null,
      producto: null,
      familia: null,
      class: null,
      descr: null,
      cliente: null,
    });
  });

  it('cuarentena trae 1 item por cada columna visible opcional ausente', () => {
    expect(cuarentena.map((c) => c.motivo).sort()).toEqual([
      'columna_ausente_clase',
      'columna_ausente_cliente',
      'columna_ausente_descripcion',
      'columna_ausente_familia',
      // [CAT-B1·A] Las dos nuevas: el grid sintético de este describe trae SOLO
      // el ancla obligatoria del header, así que las seis opcionales faltan.
      'columna_ausente_producto',
      'columna_ausente_tecnologia',
    ]);
  });

  it('cada item es a nivel de HOJA (diagnóstico, no de una fila): sku null, sin fila, entidad producto', () => {
    for (const c of cuarentena) {
      expect(c.sku).toBeNull();
      expect(c.entidad).toBe('producto');
      expect(c.origen).toEqual({ hoja: 'Inventario' });
    }
  });

  it('marca NO genera rastro A5 (es obligatoria para anclar el header, cuarentena aparte si la celda viene vacía)', () => {
    expect(cuarentena.some((c) => c.motivo === 'columna_ausente_marca')).toBe(false);
  });
});
