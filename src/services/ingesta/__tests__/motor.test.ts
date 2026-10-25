import { describe, it, expect } from 'vitest';
import { basename } from 'node:path';
import {
  construirDatasets,
  aplicarAliasesHeader,
  datasetsStockFaltantes,
  DatasetsStockFaltantesError,
  type WorkbookGrids,
  type ClasificacionHojaStock,
} from '../motor';
import { leerWorkbookXlsx, cargarReferenciaAbril } from '../io';
import type { IngestaMapeoConfig } from '../../../config/ingesta-mapeo';
import { ingestaMapeoConfig } from '../../../config/ingesta-mapeo';
import { libroStockJulio, libroAduanaVivo, libroStockVivo } from './libros-muestra';

const CAPTURED_AT = '2026-07-13T00:00:00.000Z';

/** Atrapa el error lanzado por `fn` y lo regresa (en vez de propagarlo) — para inspeccionar sus campos sin anidar try/catch en cada test. */
function capturarError<T>(fn: () => unknown): T {
  try {
    fn();
  } catch (e) {
    return e as T;
  }
  throw new Error('Se esperaba que fn() lanzara un error, pero no lanzó.');
}

function cfgSintetico(): IngestaMapeoConfig {
  return {
    stock: {
      inventario: { nombres: ['Inventario'] },
      west: { nombres: ['WEST', 'INV_WEST'] },
      reserva: { nombres: ['Reserva'] },
      excluidas: [{ nombres: ['Compras'], motivo: 'fuera de alcance' }],
      pendientes: [],
    },
    aduana: {
      excluidas: [{ nombres: ['OC ABIERTAS'], motivo: 'control interno' }],
      pendientes: [{ nombres: ['GARANTIAS'], motivo: 'sin ratificar' }],
    },
    aliasesHeader: {
      inventario: { aliases: {}, tokensHeader: ['item', 'marca', 'total', 'resv'] },
      west: { aliases: { DESC: 'DESCRIPCION' }, tokensHeader: ['item', 'prov', 'fisico'] },
      reserva: { aliases: {}, tokensHeader: ['item'] },
      embarques: { aliases: {}, tokensHeader: ['item', 'estatus'] },
    },
  };
}

function hoja(nombre: string, grid: (string | number | null)[][]): { nombre: string; grid: (string | number | null)[][] } {
  return { nombre, grid };
}

describe('construirDatasets — matchers de nombre de hoja', () => {
  it('matchea por nombre exacto (Inventario/Reserva)', () => {
    const archivos = {
      stock: {
        nombreArchivo: 'stock.xlsx',
        hojas: [
          hoja('Inventario', [['ITEM', 'MARCA', 'TOTAL', 'RESV'], ['A-1', 'BRAND5', '1', '0']]),
          hoja('Reserva', [['ITEM']]),
          hoja('WEST', [['ITEM', 'PROV', 'FISICO'], ['A-1', 'X', '1']]),
        ],
      },
      aduana: { nombreArchivo: 'aduana.xlsx', hojas: [] },
    };
    const { reporte } = construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT });
    expect(reporte.stock.find((h) => h.hoja === 'Inventario')?.clasificacion).toEqual({
      estado: 'asignada',
      dataset: 'inventario',
    });
    expect(reporte.stock.find((h) => h.hoja === 'Reserva')?.clasificacion).toEqual({
      estado: 'asignada',
      dataset: 'reserva',
    });
  });

  it('tolera espacio inicial y mayúsculas/minúsculas en el nombre de hoja', () => {
    const archivos = {
      // stock vacío es filler para este test (solo importa `reporte.aduana`
      // abajo) — `stockOmitido: true` explícito, ver nota de la esquina F
      // más abajo ("gate bloqueante de STOCK"): sin declararlo, esto lanza.
      stock: { nombreArchivo: 's.xlsx', hojas: [] },
      aduana: {
        nombreArchivo: 'a.xlsx',
        hojas: [hoja('  oc abiertas', [['OC', 'ITEM']]), hoja(' HISTORIAL DEMO', [['ITEM', 'ESTATUS']])],
      },
    };
    const cfg = cfgSintetico();
    const { reporte } = construirDatasets(archivos, cfg, { capturedAt: CAPTURED_AT, stockOmitido: true });
    expect(reporte.aduana.find((h) => h.hoja === '  oc abiertas')?.clasificacion.estado).toBe('excluida');
    expect(reporte.aduana.find((h) => h.hoja === ' HISTORIAL DEMO')?.clasificacion).toEqual({
      estado: 'asignada',
      dataset: 'embarques',
    });
  });

  it("cubre el renombre 'INV_WEST' (abril) → 'WEST' (julio) listando ambos nombres", () => {
    const cfg = cfgSintetico();
    // Inventario+Reserva mínimos junto a WEST: el gate (INV-B8, ver
    // motor.ts) exige los 3 datasets obligatorios asignados para no
    // lanzar — WEST se deja en el índice 0 para no tocar las
    // aserciones de abajo.
    const archivosJulio = {
      stock: {
        nombreArchivo: 'j.xlsx',
        hojas: [
          hoja('WEST', [['ITEM', 'PROV', 'FISICO']]),
          hoja('Inventario', [['ITEM']]),
          hoja('Reserva', [['ITEM']]),
        ],
      },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const archivosAbril = {
      stock: {
        nombreArchivo: 'a.xlsx',
        hojas: [
          hoja('INV_WEST', [['ITEM', 'PROV', 'FISICO']]),
          hoja('Inventario', [['ITEM']]),
          hoja('Reserva', [['ITEM']]),
        ],
      },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const rJulio = construirDatasets(archivosJulio, cfg, { capturedAt: CAPTURED_AT }).reporte;
    const rAbril = construirDatasets(archivosAbril, cfg, { capturedAt: CAPTURED_AT }).reporte;
    expect(rJulio.stock[0].clasificacion).toEqual({ estado: 'asignada', dataset: 'west' });
    expect(rAbril.stock[0].clasificacion).toEqual({ estado: 'asignada', dataset: 'west' });
  });
});

describe('construirDatasets — alias de headers aplicado', () => {
  it("renombra la celda de header 'DESC' → 'DESCRIPCION' en el grid de west (no muta el original)", () => {
    const grid = [['ITEM', 'PROV', 'DESC', 'FISICO'], ['A-1', 'X', 'una desc', 1]];
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: {
        nombreArchivo: 's.xlsx',
        // Inventario+Reserva mínimos: ver nota del gate (INV-B8) arriba.
        hojas: [hoja('WEST', grid), hoja('Inventario', [['ITEM']]), hoja('Reserva', [['ITEM']])],
      },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const { bodyStock } = construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT });
    expect(bodyStock.datasets.west[0]).toEqual(['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']);
    // el grid original pasado como entrada no se mutó:
    expect(grid[0]).toEqual(['ITEM', 'PROV', 'DESC', 'FISICO']);
  });

  it('aplicarAliasesHeader: sin aliases configurados, regresa el mismo grid (fast path)', () => {
    const grid = [['ITEM', 'MARCA']];
    expect(aplicarAliasesHeader(grid, {}, ['item'])).toBe(grid);
  });

  it('aplicarAliasesHeader: sin fila de encabezado localizable (falta "item"), regresa el grid intacto', () => {
    const grid = [['FOO', 'BAR']];
    expect(aplicarAliasesHeader(grid, { FOO: 'CANON' }, ['item'])).toEqual([['FOO', 'BAR']]);
  });

  it("aplicarAliasesHeader: usa tokensHeader (no solo 'item') para anclar la fila de encabezado REAL cuando hay una celda 'item' suelta ANTES (fix B-3)", () => {
    const grid = [
      ['item'], // celda suelta ANTES del header real (p.ej. leyenda o banner) — NO debe anclar aquí
      ['ITEM', 'PROV', 'DESC', 'FISICO'],
      ['A-1', 'X', 'una desc', 1],
    ];
    const resultado = aplicarAliasesHeader(grid, { DESC: 'DESCRIPCION' }, ['item', 'prov', 'fisico']);
    expect(resultado[0]).toEqual(['item']); // fila suelta intacta, no tocada
    expect(resultado[1]).toEqual(['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']); // header real, alias aplicado
    expect(resultado[2]).toEqual(['A-1', 'X', 'una desc', 1]);
    // con el ancla débil anterior (solo ['item']) este mismo grid habría
    // renombrado la fila 0 (['item'] → sigue siendo ['item'], no tiene DESC
    // que renombrar) dejando la fila 1 (el header real) SIN el alias —
    // regresión cubierta por la aserción de arriba.
  });
});

describe('construirDatasets — hoja excluida', () => {
  it("'Compras' (stock) y 'OC ABIERTAS' (aduana) se excluyen con motivo y NO entran al body — y NO cuentan para el gate (excluida ≠ faltante)", () => {
    const inventarioGrid = [['ITEM', 'MARCA', 'TOTAL', 'RESV'], ['A-1', 'BRAND5', '1', '0']];
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: {
        nombreArchivo: 's.xlsx',
        // Compras convive con las 3 hojas obligatorias, como en el
        // archivo real (4 hojas): 'excluida a propósito' NUNCA debe
        // hacer que el gate (INV-B8) piense que falta un dataset.
        hojas: [
          hoja('Compras', [['OC', 'ITEM', 'CANTIDAD']]),
          hoja('Inventario', inventarioGrid),
          hoja('WEST', [['ITEM', 'PROV', 'FISICO']]),
          hoja('Reserva', [['ITEM']]),
        ],
      },
      aduana: {
        nombreArchivo: 'a.xlsx',
        hojas: [hoja('OC ABIERTAS', [['OC', 'ITEM']])],
      },
    };
    const { bodyStock, bodyAduana, reporte } = construirDatasets(archivos, cfgSintetico(), {
      capturedAt: CAPTURED_AT,
    });
    expect(reporte.stock[0].clasificacion).toEqual({ estado: 'excluida', motivo: 'fuera de alcance' });
    expect(reporte.aduana[0].clasificacion).toEqual({ estado: 'excluida', motivo: 'control interno' });
    // 'Compras' no tiene lugar en `datasets` (el tipo ni lo contempla);
    // lo observable es que su exclusión NO dispara el gate bloqueante.
    expect(datasetsStockFaltantes(reporte.stock)).toEqual([]);
    expect(bodyStock.datasets.inventario).toEqual(inventarioGrid);
    expect(bodyAduana.datasets.embarques).toEqual([]);
  });
});

describe('construirDatasets — hoja pendiente reportada', () => {
  it("'GARANTIAS' se reporta como pendiente (con motivo) y NO entra al body de embarques", () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      // stock vacío es filler (este test solo mira aduana) — stockOmitido
      // explícito, igual que arriba.
      stock: { nombreArchivo: 's.xlsx', hojas: [] },
      aduana: {
        nombreArchivo: 'a.xlsx',
        hojas: [hoja('GARANTIAS', [['ITEM', 'STATUS']]), hoja('BRAND1', [['ITEM', 'ESTATUS']])],
      },
    };
    const { bodyAduana, reporte } = construirDatasets(archivos, cfgSintetico(), {
      capturedAt: CAPTURED_AT,
      stockOmitido: true,
    });
    expect(reporte.aduana.find((h) => h.hoja === 'GARANTIAS')?.clasificacion).toEqual({
      estado: 'pendiente',
      motivo: 'sin ratificar',
    });
    expect(bodyAduana.datasets.embarques.map((h) => h.hoja)).toEqual(['BRAND1']);
  });
});

describe('construirDatasets — hoja no-mapeable → error claro', () => {
  it('una hoja de stock que no matchea inventario/west/reserva/excluidas/pendientes es no_mapeable (aunque los 3 datasets obligatorios SÍ estén cubiertos por otras hojas)', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: {
        nombreArchivo: 's.xlsx',
        // Inventario+WEST+Reserva presentes: aísla "hoja no reconocida"
        // (no_mapeable) del gate de "dataset obligatorio faltante" — son
        // conceptos distintos (ver describe de más abajo para el gate).
        hojas: [
          hoja('HOJA MISTERIOSA', [['X']]),
          hoja('Inventario', [['ITEM']]),
          hoja('WEST', [['ITEM', 'PROV', 'FISICO']]),
          hoja('Reserva', [['ITEM']]),
        ],
      },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const { reporte } = construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT });
    expect(reporte.stock[0].clasificacion).toEqual({ estado: 'no_mapeable' });
  });

  it('aduana NO tiene no_mapeable: cualquier hoja no excluida/pendiente cae en embarques (catch-all)', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      // stock vacío es filler (este test solo mira aduana) — stockOmitido
      // explícito, igual que arriba.
      stock: { nombreArchivo: 's.xlsx', hojas: [] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [hoja('PROVEEDOR NUEVO NUNCA VISTO', [['ITEM', 'ESTATUS']])] },
    };
    const { reporte } = construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT, stockOmitido: true });
    expect(reporte.aduana[0].clasificacion).toEqual({ estado: 'asignada', dataset: 'embarques' });
  });

  it('datasetsStockFaltantes (función pura, sin pasar por construirDatasets): reporta qué dataset del contrato B2 no encontró hoja asignada', () => {
    const reporte: ClasificacionHojaStock[] = [
      { hoja: 'Inventario', filas: 1, clasificacion: { estado: 'asignada', dataset: 'inventario' } },
      { hoja: 'HOJA RARA', filas: 1, clasificacion: { estado: 'no_mapeable' } },
    ];
    expect(datasetsStockFaltantes(reporte)).toEqual(['west', 'reserva']);
  });

  it('construirDatasets: el mismo escenario (Inventario asignado, sin west/reserva) ahora LANZA DatasetsStockFaltantesError con faltantes=[west,reserva] — INV-B8, gate bloqueante', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: {
        nombreArchivo: 's.xlsx',
        hojas: [hoja('Inventario', [['ITEM']]), hoja('HOJA RARA', [['X']])],
      },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const err = capturarError<DatasetsStockFaltantesError>(() =>
      construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT }),
    );
    expect(err).toBeInstanceOf(DatasetsStockFaltantesError);
    expect(err.faltantes).toEqual(['west', 'reserva']);
    // el `reporte` completo sigue disponible en el error (no se pierde
    // al no poder leer `bodyStock`, que nunca llegó a construirse):
    expect(err.reporte.map((h) => h.hoja)).toEqual(['Inventario', 'HOJA RARA']);
  });
});

describe('construirDatasets — gate bloqueante de STOCK (INV-B8, O2: dataset vacío por hoja no mapeada nunca es éxito)', () => {
  const inventarioHoja = hoja('Inventario', [['ITEM', 'MARCA', 'TOTAL', 'RESV'], ['A-1', 'BRAND5', '1', '0']]);
  const reservaHoja = hoja('Reserva', [['ITEM']]);

  it('lanza DatasetsStockFaltantesError si la hoja WEST está AUSENTE (no aparece en el libro), aunque Inventario/Reserva sí estén', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: { nombreArchivo: 's.xlsx', hojas: [inventarioHoja, reservaHoja] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const err = capturarError<DatasetsStockFaltantesError>(() =>
      construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT }),
    );
    expect(err).toBeInstanceOf(DatasetsStockFaltantesError);
    expect(err.name).toBe('DatasetsStockFaltantesError');
    expect(err.faltantes).toEqual(['west']);
    expect(err.message).toContain('west');
  });

  it('NO lanza si la hoja WEST SÍ está pero sin filas de datos (grid vacío) — "hoja presente y vacía" ≠ "hoja ausente"', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: { nombreArchivo: 's.xlsx', hojas: [inventarioHoja, reservaHoja, hoja('WEST', [])] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const { bodyStock, reporte } = construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT });
    expect(bodyStock.datasets.west).toEqual([]); // 0 filas — legítimo (p.ej. mes sin novedades WEST)
    expect(datasetsStockFaltantes(reporte.stock)).toEqual([]);
    expect(reporte.stock.find((h) => h.hoja === 'WEST')?.clasificacion).toEqual({
      estado: 'asignada',
      dataset: 'west',
    });
  });

  it('NO lanza si el libro de stock viene con 0 hojas Y el caller declara `stockOmitido: true` — opt-out EXPLÍCITO (p.ej. un CLI de solo aduana, que arma un WorkbookGrids vacío como stub para stock Y pasa `stockOmitido: true`)', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: { nombreArchivo: '(omitido por --solo aduana)', hojas: [] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [hoja('BRAND1', [['ITEM', 'ESTATUS']])] },
    };
    const { bodyStock, bodyAduana } = construirDatasets(archivos, cfgSintetico(), {
      capturedAt: CAPTURED_AT,
      stockOmitido: true,
    });
    expect(bodyStock.datasets).toEqual({ inventario: [], west: [], reserva: [] });
    expect(bodyAduana.datasets.embarques).toHaveLength(1);
  });

  // [S4 · propia, no de S2] Reverso de la prueba de arriba — demuestra el
  // arreglo REAL de la esquina F (ver
  // `docs/decisions/0003-empty-and-degraded-input-guards.md`): la MISMA forma de `archivos` (stock sin hojas, aduana con
  // contenido) que arriba NO lanza SOLO porque el caller declaró
  // `stockOmitido: true`. Sin esa declaración explícita, 0 hojas de
  // STOCK es SIEMPRE fallo bloqueante — así aduana traiga contenido. Si
  // esto NO lanzara, un libro de STOCK genuinamente vacío (el fixture
  // `cero-hojas.xlsx` de la esquina F) se colaría disfrazado de opt-out
  // en cualquier caller que no declare nada — el bug original.
  it('SÍ lanza DatasetsStockFaltantesError si el libro de stock viene con 0 hojas y el caller NO declara `stockOmitido` — sin la declaración explícita, 0 hojas de STOCK bloquea aunque aduana traiga contenido', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: { nombreArchivo: 'stock-vacio-de-verdad.xlsx', hojas: [] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [hoja('BRAND1', [['ITEM', 'ESTATUS']])] },
    };
    const err = capturarError<DatasetsStockFaltantesError>(() =>
      // Nota: SIN `stockOmitido` — es justo lo que se está probando.
      construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT }),
    );
    expect(err).toBeInstanceOf(DatasetsStockFaltantesError);
    expect(err.faltantes).toEqual(['inventario', 'west', 'reserva']);
  });

  it('lanza con los 3 datasets como faltantes si el archivo es completamente ajeno (ninguna hoja obligatoria presente)', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: { nombreArchivo: 's.xlsx', hojas: [hoja('HOJA AJENA', [['X']])] },
      aduana: { nombreArchivo: 'a.xlsx', hojas: [] },
    };
    const err = capturarError<DatasetsStockFaltantesError>(() =>
      construirDatasets(archivos, cfgSintetico(), { capturedAt: CAPTURED_AT }),
    );
    expect(err.faltantes).toEqual(['inventario', 'west', 'reserva']);
  });
});

describe('construirDatasets — bodies exactos del contrato B2', () => {
  it('bodyStock/bodyAduana tienen la forma {source, capturedAt, archivo, datasets}', () => {
    const archivos: { stock: WorkbookGrids; aduana: WorkbookGrids } = {
      stock: {
        nombreArchivo: 'STOCK.xlsx',
        hojas: [
          hoja('Inventario', [['ITEM']]),
          hoja('WEST', [['ITEM', 'PROV', 'FISICO']]),
          hoja('Reserva', [['ITEM']]),
        ],
      },
      aduana: { nombreArchivo: 'ADUANA.xlsx', hojas: [hoja('BRAND1', [['ITEM', 'ESTATUS']])] },
    };
    const { bodyStock, bodyAduana } = construirDatasets(archivos, cfgSintetico(), {
      capturedAt: CAPTURED_AT,
    });
    expect(bodyStock).toEqual({
      source: 'stock',
      capturedAt: CAPTURED_AT,
      archivo: 'STOCK.xlsx',
      datasets: {
        inventario: [['ITEM']],
        west: [['ITEM', 'PROV', 'FISICO']],
        reserva: [['ITEM']],
      },
    });
    expect(bodyAduana).toEqual({
      source: 'aduana',
      capturedAt: CAPTURED_AT,
      archivo: 'ADUANA.xlsx',
      datasets: { embarques: [{ hoja: 'BRAND1', grid: [['ITEM', 'ESTATUS']] }] },
    });
  });
});

describe('ingestaMapeoConfig (config real) — smoke test de forma', () => {
  it('tiene las 3 llaves de dataset de stock y el dataset embarques declarado', () => {
    expect(Object.keys(ingestaMapeoConfig.stock)).toEqual(
      expect.arrayContaining(['inventario', 'west', 'reserva', 'excluidas', 'pendientes']),
    );
    expect(ingestaMapeoConfig.aliasesHeader.embarques).toBeDefined();
  });
});

// ============================================================
// INTEGRACIÓN (a): los libros de muestra en formato de JULIO 2026 se leen
// y mapean completos con el config REAL (`ingestaMapeoConfig`).
//
// Fix M-1: estos .xlsx NO están versionados en git (viven en `muestra/`,
// carpeta ignorada que llena el generador de datos de muestra) — en un
// clon fresco faltan por diseño. Antes,
// `leerWorkbookXlsx` se llamaba a TIEMPO DE COLECCIÓN (fuera de todo
// `it`, directo en el cuerpo de `describe`), así que su ausencia
// reventaba la colección ENTERA del archivo de test con un ENOENT
// críptico. Guarda: `describe.skip` (con nota es-MX) si faltan, y el cuerpo
// no lee nada cuando faltan (vitest ejecuta el cuerpo aun si es `.skip`).
// ============================================================
const archivoStockJulio = libroStockJulio();
const archivoAduanaJulio = libroAduanaVivo();
const hayArchivosJulio = archivoStockJulio !== null && archivoAduanaJulio !== null;

(hayArchivosJulio ? describe : describe.skip)(
  'construirDatasets — INTEGRACIÓN CON LIBROS DE MUESTRA: formato de julio (requiere los .xlsx de muestra en `muestra/`)',
  () => {
    // `describe.skip` igual ejecuta este cuerpo al recolectar: sin libros, no se lee nada.
    if (!hayArchivosJulio) return;
    const archivoStock = archivoStockJulio!;
    const archivoAduana = archivoAduanaJulio!;

    const stock = leerWorkbookXlsx(archivoStock);
    const aduana = leerWorkbookXlsx(archivoAduana);
    const { bodyStock, bodyAduana, reporte } = construirDatasets(
      { stock, aduana },
      ingestaMapeoConfig,
      { capturedAt: '2026-07-13T00:00:00.000Z' },
    );

    it('lee las 4 hojas del libro de stock (Inventario/Reserva/Compras/WEST)', () => {
      expect(stock.hojas.map((h) => h.nombre)).toEqual(['Inventario', 'Reserva', 'Compras', 'WEST']);
    });

    it('lee las 10 hojas del libro de aduana', () => {
      expect(aduana.hojas.map((h) => h.nombre)).toEqual([
        'OC ABIERTAS',
        'BRAND1',
        'BRAND3',
        'SERIES 5',
        'BRAND2',
        'PARTNER9',
        ' HISTORIAL DEMO',
        'WEST',
        'HISTORIAL WEST',
        'GARANTIAS',
      ]);
    });

    it('mapeo de stock: Inventario/Reserva/WEST asignadas, Compras excluida — sin no_mapeable', () => {
      const porHoja = Object.fromEntries(reporte.stock.map((h) => [h.hoja, h.clasificacion]));
      expect(porHoja['Inventario']).toEqual({ estado: 'asignada', dataset: 'inventario' });
      expect(porHoja['Reserva']).toEqual({ estado: 'asignada', dataset: 'reserva' });
      expect(porHoja['WEST']).toEqual({ estado: 'asignada', dataset: 'west' });
      expect(porHoja['Compras'].estado).toBe('excluida');
      expect(reporte.stock.every((h) => h.clasificacion.estado !== 'no_mapeable')).toBe(true);
      expect(datasetsStockFaltantes(reporte.stock)).toEqual([]);
    });

    it('conteos crudos de filas (grid.length, incluye headers/banners): el reporte coincide con el grid leído', () => {
      const filasPorHoja = Object.fromEntries(reporte.stock.map((h) => [h.hoja, h.filas]));
      for (const nombre of ['Inventario', 'Reserva', 'Compras', 'WEST']) {
        expect(filasPorHoja[nombre]).toBe(stock.hojas.find((h) => h.nombre === nombre)!.grid.length);
        expect(filasPorHoja[nombre]).toBeGreaterThan(0);
      }
    });

    it('mapeo de aduana: 8 hojas asignadas a embarques, OC ABIERTAS excluida, GARANTIAS pendiente', () => {
      const porHoja = Object.fromEntries(reporte.aduana.map((h) => [h.hoja, h.clasificacion]));
      expect(porHoja['OC ABIERTAS'].estado).toBe('excluida');
      expect(porHoja['GARANTIAS'].estado).toBe('pendiente');
      const asignadas = reporte.aduana.filter((h) => h.clasificacion.estado === 'asignada');
      expect(asignadas).toHaveLength(8);
      expect(asignadas.map((h) => h.hoja)).toContain('PARTNER9'); // hoja nueva de julio
      expect(bodyAduana.datasets.embarques.map((h) => h.hoja)).toEqual(asignadas.map((h) => h.hoja));
    });

    it("aplica el alias DESC→DESCRIPCION al header real de WEST (bodyStock)", () => {
      expect(bodyStock.datasets.west[0]).toContain('DESCRIPCION');
      expect(bodyStock.datasets.west[0]).not.toContain('DESC');
    });

    it('bodyStock/bodyAduana tienen la forma exacta del contrato B2 (source/capturedAt/archivo/datasets)', () => {
      expect(bodyStock.source).toBe('stock');
      expect(bodyStock.archivo).toBe(archivoStock);
      expect(bodyAduana.source).toBe('aduana');
      expect(bodyAduana.archivo).toBe(archivoAduana);
      expect(bodyStock.datasets.inventario.length).toBeGreaterThan(0);
      expect(bodyStock.datasets.reserva.length).toBeGreaterThan(0);
    });

    it('fix B-6 (regresión): leerWorkbookXlsx con nombreArchivo=basename (como lo hace el CLI de ingesta mensual tras el fix) — archivo queda como basename, NO como ruta completa', () => {
      const stockConBasename = leerWorkbookXlsx(archivoStock, basename(archivoStock));
      const { bodyStock: bodyStockBasename } = construirDatasets(
        { stock: stockConBasename, aduana },
        ingestaMapeoConfig,
        { capturedAt: '2026-07-13T00:00:00.000Z' },
      );
      expect(bodyStockBasename.archivo).toBe(basename(archivoStock));
      expect(bodyStockBasename.archivo).not.toContain(process.cwd());
      // nota: `bodyStock.archivo` (SIN el 2º argumento, arriba) sigue
      // siendo la ruta completa — eso es el default PROPIO de
      // `leerWorkbookXlsx` (caller que no especifica queda con la ruta,
      // sin ambigüedad); el fix B-6 vive en el CLI de ingesta mensual, que ahora
      // SIEMPRE pasa basename explícito, como se prueba arriba.
    });
  },
);

// ============================================================
// INTEGRACIÓN (b): REUSABILIDAD — el MISMO config/motor mapea
// igual de bien los nombres de hoja de ABRIL 2026 (vía los fixtures
// de muestra versionados), y el body resultante conserva hojas y tamaños
// de grid de esos mismos fixtures.
// ============================================================
describe('construirDatasets — INTEGRACIÓN: reusabilidad con fixtures de abril 2026', () => {
  const referencia = cargarReferenciaAbril();
  const { bodyStock, bodyAduana, reporte } = construirDatasets(referencia, ingestaMapeoConfig, {
    capturedAt: '2026-04-15T00:00:00.000Z',
  });

  it('mapea Inventario/Reserva/INV_WEST (nombres de abril) igual que julio', () => {
    const porHoja = Object.fromEntries(reporte.stock.map((h) => [h.hoja, h.clasificacion]));
    expect(porHoja['Inventario']).toEqual({ estado: 'asignada', dataset: 'inventario' });
    expect(porHoja['Reserva']).toEqual({ estado: 'asignada', dataset: 'reserva' });
    expect(porHoja['INV_WEST']).toEqual({ estado: 'asignada', dataset: 'west' });
    expect(datasetsStockFaltantes(reporte.stock)).toEqual([]);
  });

  it('mapea las 9 hojas de embarques de abril: 7 asignadas, OC ABIERTAS excluida, GARANTIAS pendiente', () => {
    expect(reporte.aduana).toHaveLength(9);
    const porHoja = Object.fromEntries(reporte.aduana.map((h) => [h.hoja, h.clasificacion]));
    expect(porHoja['OC ABIERTAS'].estado).toBe('excluida');
    expect(porHoja['GARANTIAS'].estado).toBe('pendiente');
    const asignadas = reporte.aduana.filter((h) => h.clasificacion.estado === 'asignada');
    expect(asignadas).toHaveLength(7);
    expect(asignadas.map((h) => h.hoja)).not.toContain('PARTNER9'); // no existía en abril
  });

  it('bodyStock: sin alias que aplicar (headers ya canónicos en abril) — grid preservado tal cual el fixture', () => {
    // Abril ya trae 'DESCRIPCION' (no 'DESC'): el alias es un no-op ahí.
    expect(bodyStock.datasets.west).toEqual(referencia.stock.hojas.find((h) => h.nombre === 'INV_WEST')!.grid);
    expect(bodyStock.datasets.inventario).toEqual(
      referencia.stock.hojas.find((h) => h.nombre === 'Inventario')!.grid,
    );
  });

  it('bodyAduana: conserva las hojas del mismo fixture (spot: mismas hojas, mismos tamaños de grid)', () => {
    const hojasOriginalesNoExcluidas = referencia.aduana.hojas.filter(
      (h) => h.nombre !== 'OC ABIERTAS' && h.nombre !== 'GARANTIAS',
    );
    expect(bodyAduana.datasets.embarques.map((h) => h.hoja)).toEqual(
      hojasOriginalesNoExcluidas.map((h) => h.nombre),
    );
    expect(bodyAduana.datasets.embarques.map((h) => h.grid.length)).toEqual(
      hojasOriginalesNoExcluidas.map((h) => h.grid.length),
    );
  });
});

// ============================================================
// INTEGRACIÓN (c) — INV-B8, carril B: el ARCHIVO UNIFICADO
// (libro de muestra `inventario-unificado*.xlsx`, con 4 hojas: Inventario/Reserva/Compras/"INV WEST" —
// nombre con ESPACIO, no guion bajo, y headers ITEM/TECNOLOGIA/MARCA/
// FAMILIA/CLASE/DESCRIP/FISICO — sin PROV).
//
// Nota de orden (carriles paralelos, ver ALCANCE del bloque): el
// mapeo de "INV WEST" en `ingesta-mapeo.ts`/`parse.west.ts` lo
// arregla OTRO agente, en curso al momento de escribir este archivo.
// Mientras ese carril no aterrizara, este mismo test (con
// `construirDatasets` esperando LANZAR) hacía fallar el archivo
// unificado — y eso era lo correcto: la prueba de que el gate
// funciona. ATERRIZÓ durante esta sesión (confirmado: 'INV WEST' ya
// está en `stock.west.nombres` y `tokensHeader` de west ya no exige
// 'prov'), así que este test ahora afirma el camino FELIZ (sin
// lanzar) — la cobertura del gate en sí (que SÍ debe lanzar cuando
// falta un dataset obligatorio) vive en fixtures propios, arriba
// ("gate bloqueante de STOCK"), y es verificable sin depender de este
// archivo ni de ese otro carril.
//
// Punto 3 (bloque INV-B8): esta copia de muestra es una
// instantánea con el formato de julio y SÍ trae 'Compras' — pero el archivo
// VIVO (el que de verdad llega mes a mes) YA NO tiene esa hoja (fue
// eliminada en el origen). La entrada `stock.excluidas` de 'Compras'
// en `ingesta-mapeo.ts` SE QUEDA (abril y julio sí la traen y deben
// seguir siendo legibles) — lo que cambia aquí es que las
// aserciones de abajo NO exigen la presencia de 'Compras': verifican
// que las 3 hojas obligatorias se asignan y, SI 'Compras' aparece, que
// quede excluida con motivo — así esta copia se puede reemplazar por
// el archivo vivo (3 hojas) sin que esta prueba se ponga roja.
// ============================================================
const archivoUnificado = libroStockVivo();
const hayArchivoUnificado = archivoUnificado !== null;

(hayArchivoUnificado ? describe : describe.skip)(
  'construirDatasets — INTEGRACIÓN: archivo UNIFICADO de muestra (requiere el .xlsx en `muestra/`)',
  () => {
    if (!hayArchivoUnificado) return;
    const stock = leerWorkbookXlsx(archivoUnificado!);
    const aduana: WorkbookGrids = { nombreArchivo: '(no aplica en este test)', hojas: [] };

    it(
      'lee las hojas del libro: incluye las 3 obligatorias (Inventario, Reserva, "INV WEST" con ' +
        'espacio, no guion bajo) — "Compras" NO se exige: esta copia la trae (instantánea de julio), el ' +
        'archivo vivo ya no (Punto 3, ver nota arriba)',
      () => {
        expect(stock.hojas.map((h) => h.nombre)).toEqual(
          expect.arrayContaining(['Inventario', 'Reserva', 'INV WEST']),
        );
      },
    );

    it(
      'las 3 hojas obligatorias se clasifican de forma explícita (Inventario→inventario, Reserva→reserva, ' +
        '"INV WEST"→west); si "Compras" está presente (esta copia la trae) queda excluida CON MOTIVO, sin ' +
        'exigir su presencia (Punto 3) — el gate NO lanza: datasetsStockFaltantes()===[]',
      () => {
        const { reporte } = construirDatasets({ stock, aduana }, ingestaMapeoConfig, { capturedAt: CAPTURED_AT });
        const porHoja = Object.fromEntries(reporte.stock.map((h) => [h.hoja, h.clasificacion]));
        expect(porHoja['Inventario']).toEqual({ estado: 'asignada', dataset: 'inventario' });
        expect(porHoja['Reserva']).toEqual({ estado: 'asignada', dataset: 'reserva' });
        expect(porHoja['INV WEST']).toEqual({ estado: 'asignada', dataset: 'west' });
        // 'Compras', SI aparece, es A PROPÓSITO (con un motivo real y no vacío, no confundir con "no
        // reconocida") — pero no se exige que aparezca: el archivo vivo ya no trae esta hoja (Punto 3).
        if (porHoja['Compras']) {
          expect(porHoja['Compras'].estado).toBe('excluida');
          expect((porHoja['Compras'] as { estado: 'excluida'; motivo: string }).motivo.length).toBeGreaterThan(0);
        }
        expect(datasetsStockFaltantes(reporte.stock)).toEqual([]);
      },
    );

    it('el body de STOCK se construye SIN lanzar, con las filas de datos de "INV WEST" (el grid crudo completo, header incluido)', () => {
      const { bodyStock } = construirDatasets({ stock, aduana }, ingestaMapeoConfig, { capturedAt: CAPTURED_AT });
      expect(bodyStock.datasets.west.length).toBe(
        stock.hojas.find((h) => h.nombre === 'INV WEST')!.grid.length,
      ); // grid crudo completo (header incluido), tal como lo deja el motor
      expect(bodyStock.datasets.inventario.length).toBeGreaterThan(0);
      expect(bodyStock.datasets.reserva.length).toBeGreaterThan(0);
    });
  },
);
