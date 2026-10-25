// ============================================================
// B-PARCHE · F2 · clasificacion.build.test.ts (UNIT — grids sintéticos)
// Cada test aísla UNA regla del builder. Ver `clasificacion.build.ts`
// para el detalle de cada regla (comentario de cabecera).
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Cell, Grid } from '@/services/etl/types';
import { buildClasificacionV2, type ParcheContexto } from './clasificacion.build';

const INV_HEADER: Cell[] = ['ITEM', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'CLASE', 'DESCRIPCION'];
const DES_HEADER: Cell[] = ['ITEM', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'CLASE', 'DESCRIP'];

/** Fila con el mismo orden de columnas en ambas hojas sintéticas. */
function fila(
  sku: string,
  tecnologia: string | null,
  marca: string | null,
  familia: string | null,
  clase: string | null,
  descr: string | null,
): Cell[] {
  return [sku, tecnologia, marca, familia, clase, descr];
}

function inventarioGrid(...filas: Cell[][]): Grid {
  return [INV_HEADER, ...filas];
}
function westGrid(...filas: Cell[][]): Grid {
  return [DES_HEADER, ...filas];
}

function contexto(overrides: Partial<ParcheContexto> = {}): ParcheContexto {
  return {
    existingSkus: new Set(),
    fuenteActual: new Map(),
    familiasVivas: new Set(),
    marcasVivas: new Set(),
    aliasVivos: new Map(),
    ...overrides,
  };
}

describe('buildClasificacionV2 — header por contenido', () => {
  it('localiza el encabezado por el token ITEM, tolerando banners y filas vacías previas', () => {
    const inventario: Grid = [
      ['STOCK', null, null, null, null, null],
      [null, null, null, null, null, null],
      INV_HEADER,
      fila('SKU-1', 'EAS', 'BRAND5', 'BRAND5', 'A', 'Descr uno'),
    ];

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({
        existingSkus: new Set(['SKU-1']),
        fuenteActual: new Map([['SKU-1', { marca: 'BRAND5', familia: 'BRAND5', clase: 'A', descr: 'Descr uno' }]]),
        familiasVivas: new Set(['BRAND5']),
        marcasVivas: new Set(['BRAND5']),
      }),
    );

    expect(result.filas).toEqual([
      { sku: 'SKU-1', tecnologia: 'EAS', marca_v2: 'BRAND5', familia_v2: 'BRAND5', clase_v2: 'A', descr_v2: 'Descr uno' },
    ]);
    expect(result.reporte.aplicables.filas).toBe(1);
    // sin diffs: el candidato del archivo coincide exactamente con el vivo
    expect(result.reporte.aplicables.porCampo.descr.difiereDelVivo).toBe(0);
    expect(result.reporte.aplicables.porCampo.familia.difiereDelVivo).toBe(0);
    expect(result.reporte.aplicables.porCampo.marca.difiereDelVivo).toBe(0);
    // tecnologia no tiene catálogo vivo en este contexto: SIEMPRE "nueva"
    expect(result.catalogosNuevos.tecnologiasNuevas).toEqual(['EAS']);
    expect(result.catalogosNuevos.familiasNuevas).toEqual([]);
    expect(result.catalogosNuevos.marcasNuevas).toEqual([]);
  });
});

describe('buildClasificacionV2 — Overlap (precedencia Inventario)', () => {
  it('Inventario gana cuando aporta valor no-vacío; WEST solo rellena el hueco', () => {
    const inventario = inventarioGrid(
      fila('SKU-2', 'EAS', 'BRAND5', 'FAMILIA-INV', 'A', 'Descr inv'),
      fila('SKU-3', 'EAS', 'BRAND5', null, 'A', 'Descr 3'), // familia vacía en Inventario
    );
    const west = westGrid(
      fila('SKU-2', 'EAS', 'BRAND5', 'FAMILIA-WEST', 'A', 'Descr west'),
      fila('SKU-3', 'EAS', 'BRAND5', 'FAMILIA-WEST-3', 'A', 'Descr west 3'),
    );

    const result = buildClasificacionV2(
      { inventario, west },
      contexto({
        existingSkus: new Set(['SKU-2', 'SKU-3']),
        familiasVivas: new Set(['FAMILIA-INV', 'FAMILIA-WEST-3']),
        marcasVivas: new Set(['BRAND5']),
      }),
    );

    const s2 = result.filas.find((f) => f.sku === 'SKU-2');
    const s3 = result.filas.find((f) => f.sku === 'SKU-3');
    expect(s2?.familia_v2).toBe('FAMILIA-INV'); // Inventario gana (no vacío)
    expect(s3?.familia_v2).toBe('FAMILIA-WEST-3'); // Inventario vacío: WEST rellena
  });
});

describe('buildClasificacionV2 — vacío del archivo no emite (nunca borra)', () => {
  it('todos los campos vacíos → los 5 campos de la fila salen null', () => {
    const inventario = inventarioGrid(fila('SKU-4', null, null, null, null, null));

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({ existingSkus: new Set(['SKU-4']) }),
    );

    expect(result.filas).toEqual([
      { sku: 'SKU-4', tecnologia: null, marca_v2: null, familia_v2: null, clase_v2: null, descr_v2: null },
    ]);
    expect(result.reporte.aplicables.porCampo.descr.escribiria).toBe(0);
    expect(result.reporte.aplicables.porCampo.familia.escribiria).toBe(0);
    expect(result.reporte.aplicables.porCampo.clase.escribiria).toBe(0);
    expect(result.reporte.aplicables.porCampo.marca.escribiria).toBe(0);
    expect(result.reporte.aplicables.porCampo.tecnologia.escribiria).toBe(0);
  });
});

describe('buildClasificacionV2 — Cross-ref WEST (marca)', () => {
  it('1 resuelto (marca real en WEST) + 1 en cuarentena (sin fila en WEST)', () => {
    const inventario = inventarioGrid(
      fila('SKU-5', 'EAS', 'WEST', 'FAM', 'A', 'Descr 5'), // resuelve vía cross-ref
      fila('SKU-6', 'EAS', 'WEST', 'FAM', 'A', 'Descr 6'), // sin contraparte en WEST
    );
    const west = westGrid(fila('SKU-5', 'EAS', 'SERIES5', 'FAM', 'A', 'Descr 5 west'));

    const result = buildClasificacionV2(
      { inventario, west },
      contexto({
        existingSkus: new Set(['SKU-5', 'SKU-6']),
        familiasVivas: new Set(['FAM']),
        marcasVivas: new Set(['SERIES5']),
      }),
    );

    const s5 = result.filas.find((f) => f.sku === 'SKU-5');
    const s6 = result.filas.find((f) => f.sku === 'SKU-6');
    expect(s5?.marca_v2).toBe('SERIES5');
    expect(s6?.marca_v2).toBeNull();
    expect(result.reporte.cuarentena.westNoResueltos).toEqual({ total: 1, skus: ['SKU-6'] });
    // 'WEST' jamás se escribe como marca, ni siquiera en el resuelto ni en el cuarentenado
    expect(result.filas.some((f) => f.marca_v2 === 'WEST')).toBe(false);
  });
});

describe('buildClasificacionV2 — alias de marca', () => {
  it('resuelve un alias ya conocido a su canónica viva, sin sembrarlo como marca nueva', () => {
    const inventario = inventarioGrid(fila('SKU-7', 'EAS', 'BRAND 6', 'FAM', 'A', 'Descr 7'));

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({
        existingSkus: new Set(['SKU-7']),
        familiasVivas: new Set(['FAM']),
        marcasVivas: new Set(['BRAND6']),
        aliasVivos: new Map([['brand 6', 'BRAND6']]),
      }),
    );

    expect(result.filas[0].marca_v2).toBe('BRAND6');
    expect(result.catalogosNuevos.marcasNuevas).toEqual([]);
  });
});

describe('buildClasificacionV2 — duplicado intra-hoja', () => {
  it('conserva la primera ocurrencia y reporta la(s) siguiente(s) en cuarentena', () => {
    const inventario = inventarioGrid(
      fila('SKU-8', 'EAS', 'FIRST', 'FAM', 'A', 'Descr primero'),
      fila('SKU-8', 'EAS', 'SECOND', 'FAM', 'A', 'Descr segundo'),
    );

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({ existingSkus: new Set(['SKU-8']), familiasVivas: new Set(['FAM']), marcasVivas: new Set(['FIRST']) }),
    );

    expect(result.filas).toEqual([
      { sku: 'SKU-8', tecnologia: 'EAS', marca_v2: 'FIRST', familia_v2: 'FAM', clase_v2: 'A', descr_v2: 'Descr primero' },
    ]);
    expect(result.reporte.cuarentena.duplicadosIntraArchivo).toEqual([
      { sku: 'SKU-8', hoja: 'inventario', ocurrencias: 2 },
    ]);
  });
});

describe('buildClasificacionV2 — colisión de normalización', () => {
  it('dos variantes que canonicalizan igual NO se auto-fusionan: cuarentena informativa, SIN bloquear el valor escrito', () => {
    const inventario = inventarioGrid(
      fila('SKU-C1', 'EAS', 'BRAND5', 'Clip Nuevo', 'A', 'D1'),
      fila('SKU-C2', 'EAS', 'BRAND5', 'CLIP NUEVO', 'A', 'D2'),
    );

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({
        existingSkus: new Set(['SKU-C1', 'SKU-C2']),
        marcasVivas: new Set(['BRAND5']),
        // 'CLIP NUEVO' NO está en familiasVivas: candidata a "nueva" → colisión
      }),
    );

    const c1 = result.filas.find((f) => f.sku === 'SKU-C1');
    const c2 = result.filas.find((f) => f.sku === 'SKU-C2');
    // el valor escrito SIGUE siendo 100% determinista (normalizeMarcaNombre)
    expect(c1?.familia_v2).toBe('CLIP NUEVO');
    expect(c2?.familia_v2).toBe('CLIP NUEVO');
    // pero NO se siembra el catálogo con una de las 2 variantes arbitrariamente
    expect(result.catalogosNuevos.familiasNuevas).toEqual([]);
    expect(result.reporte.cuarentena.colisionesNormalizacion).toHaveLength(1);
    const colision = result.reporte.cuarentena.colisionesNormalizacion[0];
    expect(colision.campo).toBe('familia');
    expect(colision.canonico).toBe('CLIP NUEVO');
    expect(colision.variantes.sort()).toEqual(['CLIP NUEVO', 'Clip Nuevo'].sort());
    expect(colision.skus.sort()).toEqual(['SKU-C1', 'SKU-C2']);
  });
});

describe('buildClasificacionV2 — colisión field-aware (marca case-insensible vs familia case-sensible)', () => {
  it('marca: "Cables" en Inventario + "CABLES" en WEST (mismo sku) NO colisiona — se siembra 1 sola vez', () => {
    const inventario = inventarioGrid(fila('SKU-M1', 'EAS', 'Cables', 'FAM', 'A', 'D1'));
    const west = westGrid(fila('SKU-M1', 'EAS', 'CABLES', 'FAM', 'A', 'D1'));

    const result = buildClasificacionV2(
      { inventario, west },
      contexto({
        existingSkus: new Set(['SKU-M1']),
        familiasVivas: new Set(['FAM']),
        // 'CABLES' NO está en marcasVivas: candidata a "nueva"
      }),
    );

    expect(result.catalogosNuevos.marcasNuevas).toEqual(['CABLES']); // se siembra 1 sola vez, no colisiona
    expect(result.reporte.cuarentena.colisionesNormalizacion).toEqual([]);
  });

  it('contraste: familia "Clip Nuevo" vs "CLIP NUEVO" (2 skus) SIGUE colisionando (case-sensible, sin cambios)', () => {
    const inventario = inventarioGrid(
      fila('SKU-F1', 'EAS', 'BRAND5', 'Clip Nuevo', 'A', 'D1'),
      fila('SKU-F2', 'EAS', 'BRAND5', 'CLIP NUEVO', 'A', 'D2'),
    );

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({
        existingSkus: new Set(['SKU-F1', 'SKU-F2']),
        marcasVivas: new Set(['BRAND5']),
      }),
    );

    expect(result.catalogosNuevos.familiasNuevas).toEqual([]);
    expect(result.reporte.cuarentena.colisionesNormalizacion).toHaveLength(1);
    expect(result.reporte.cuarentena.colisionesNormalizacion[0].campo).toBe('familia');
  });
});

describe('buildClasificacionV2 — filtrado de altas/bajas contra existingSkus', () => {
  it('sku vivo sin fila en el archivo → soloViejo (no emite fila); sku del archivo sin match en vivos → soloNuevo', () => {
    const inventario = inventarioGrid(fila('SKU-12', 'EAS', 'BRAND5', 'FAM', 'A', 'Descr 12'));

    const result = buildClasificacionV2(
      { inventario, west: [] },
      contexto({ existingSkus: new Set(['SKU-11']) }), // SKU-11 vivo, no está en el archivo
    );

    expect(result.filas).toEqual([]); // SKU-12 no está en existingSkus: se omite
    expect(result.reporte.omitidos.soloViejo).toEqual({ total: 1, skus: ['SKU-11'] });
    expect(result.reporte.omitidos.soloNuevo).toEqual({ total: 1, skus: ['SKU-12'] });
  });

  it('skusBasura: subconjunto informativo de soloViejo con espacios internos (no parecen SKU real)', () => {
    const result = buildClasificacionV2(
      { inventario: [], west: [] },
      contexto({ existingSkus: new Set(['SKU-REAL-1', 'NOTA: SKU RARO']) }),
    );

    expect(result.reporte.omitidos.soloViejo.total).toBe(2);
    expect(result.reporte.cuarentena.skusBasura).toEqual(['NOTA: SKU RARO']);
  });
});

describe('buildClasificacionV2 — descubrimiento de marcas nuevas escanea ambas hojas', () => {
  it('siembra la marca de WEST aunque Inventario gane la precedencia del campo para ese sku', () => {
    const inventario = inventarioGrid(fila('SKU-CAB', 'EAS', 'NACIONAL', 'FAM', 'A', 'Descr'));
    const west = westGrid(fila('SKU-CAB', 'EAS', 'CABLES', 'FAM', 'A', 'Descr west'));

    const result = buildClasificacionV2(
      { inventario, west },
      contexto({
        existingSkus: new Set(['SKU-CAB']),
        familiasVivas: new Set(['FAM']),
        marcasVivas: new Set(['NACIONAL']),
      }),
    );

    // el campo escrito sigue la precedencia normal (Inventario gana)
    expect(result.filas[0].marca_v2).toBe('NACIONAL');
    // pero "CABLES" (solo en WEST) igual se siembra como marca nueva descubierta
    expect(result.catalogosNuevos.marcasNuevas).toEqual(['CABLES']);
  });
});
