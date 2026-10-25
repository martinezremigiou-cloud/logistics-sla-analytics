// ============================================================
// [REPRODUCIBILIDAD · S7-A] Guarda de universo entrante — Opción A,
// ratificada el 2026-08-07. Cubre el mecanismo COMPLETO desde
// `computeSnapshot`: rechazo, borde exacto del umbral, la excepción de
// universo vacío (P17), el escape hatch forzado, y lo que la guarda
// declara explícitamente que NO caza (Enmienda 3).
//
// Lo que NO vive aquí: la lectura/validación de las tres cabeceras HTTP
// del escape hatch (`src/lib/api/forzar-universo.ts`, con su propio
// test) y el mapeo a HTTP 409 en las dos rutas, incluido el caso
// "forzado incompleto → el mensaje nombra la que falta" (prueba 7 del
// bloque, a nivel de ruta — ver `route.test.ts` de las dos puertas).
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeSnapshot } from '../runEtl';
import { UniversoReducidoError } from '../errors';
import { makeCatalogIndex, emptyPrev } from './helpers';
import type { Grid, IngestJob, PrevState, SheetGrid, EmbarqueRow } from '../types';

const CAPTURED_AT = '2026-08-05T00:00:00.000Z';

// ---- Fixtures STOCK: 3 hojas mapeadas, geometría real, 0 filas de datos ----
const inventarioSoloEncabezado: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
];
const westVacio: Grid = [['INVENTARIO WEST'], [], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
const reservaVacia: Grid = [
  ['DEMO COMERCIAL S DE RL DE CV'],
  [],
  [],
  [],
  [null, null, null, 'Laura'],
  [],
  ['STOCK MEXICO', null, null, '23-abr-26'],
  [null, null, null, 'pedido A'],
  ['ITEM', null, null, 'RETAILER64'],
];

function jobStockVacio(): IngestJob {
  return {
    source: 'stock',
    capturedAt: CAPTURED_AT,
    archivo: 'stock-vacio.xlsx',
    inventario: inventarioSoloEncabezado,
    west: westVacio,
    reserva: reservaVacia,
  };
}

/** prev STOCK con 2 productos + 2 filas de stock (4 filas de universo). */
function prevStockPoblado(): PrevState {
  return {
    snapshotId: 'snap-anterior-stock',
    hash: 'hash-anterior-no-coincide-con-nada-vacio',
    productos: [
      { sku: 'OLD-1', marca: 'NACIONAL', tecnologia: null, producto: null, familia: 'FAMILIA VIEJA', class: null, descr: 'PRODUCTO VIEJO 1', cliente: null, resv: 0, totalFuente: 10 },
      { sku: 'OLD-2', marca: 'NACIONAL', tecnologia: null, producto: null, familia: 'FAMILIA VIEJA', class: null, descr: 'PRODUCTO VIEJO 2', cliente: null, resv: 0, totalFuente: 5 },
    ],
    stock: [
      { sku: 'OLD-1', almacen: 'NORTH', cantidad: 10 },
      { sku: 'OLD-2', almacen: 'NORTH', cantidad: 5 },
    ],
    reservas: [],
    embarques: [],
    existingSkus: new Set(['OLD-1', 'OLD-2']),
  };
}

// ---- Fixtures ADUANA: grid sintético de N embarques, 1 SKU compartido ----
function embarquesGridDeN(n: number): SheetGrid[] {
  const header: Grid[number] = ['ITEM', 'OC', 'ESTATUS'];
  const filas: Grid = Array.from({ length: n }, (_, i) => ['SKU-1', `OC-${i}`, 'disponible']);
  return [{ hoja: 'ACTIVOS', grid: [header, ...filas] }];
}

function jobAduana(n: number): IngestJob {
  return {
    source: 'aduana',
    capturedAt: CAPTURED_AT,
    archivo: 'embarques.xlsx',
    embarques: embarquesGridDeN(n),
  };
}

function embarqueRowDummy(i: number): EmbarqueRow {
  return {
    sku: 'SKU-1',
    oc_po: `OC-PREV-${i}`,
    proveedor: null,
    referencia: null,
    factura: null,
    pais_origen: null,
    piezas: null,
    fw: null,
    tipo_importacion: null,
    fecha_recoleccion: null,
    etd: null,
    eta: null,
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: 'Producto Disponible',
    estatus_id: 11,
    proyecto: null,
    observaciones: null,
    is_historial: false,
  };
}

function prevAduanaDeN(n: number): PrevState {
  return {
    snapshotId: 'snap-anterior-aduana',
    hash: 'hash-anterior-no-coincide-con-nada-vacio',
    productos: [],
    stock: [],
    reservas: [],
    embarques: Array.from({ length: n }, (_, i) => embarqueRowDummy(i)),
    existingSkus: new Set(['SKU-1']),
  };
}

describe('guarda de universo entrante (S7-A) — computeSnapshot', () => {
  it('1. ROJA: stock con 0 filas de datos contra un prev poblado → lanza, y el mensaje trae AMBOS números y las tres cabeceras', () => {
    const idx = makeCatalogIndex();
    let error: unknown = null;
    try {
      computeSnapshot(jobStockVacio(), idx, prevStockPoblado());
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UniversoReducidoError);
    const err = error as UniversoReducidoError;
    expect(err.filasPrevias).toBe(4);
    expect(err.filasEntrantes).toBe(0);
    expect(err.fuente).toBe('stock');
    // Los DOS números, literales, en el mensaje.
    expect(err.message).toContain('4 previas');
    expect(err.message).toContain('0 filas');
    // Las TRES cabeceras EXACTAS para forzar.
    expect(err.message).toContain('x-forzar-universo-reducido: si');
    expect(err.message).toMatch(/x-forzar-motivo/);
    expect(err.message).toMatch(/x-forzar-por/);
  });

  it('2. ROJA por aduana: hoja de embarques presente pero sin filas de datos contra un prev con embarques → lanza', () => {
    const idx = makeCatalogIndex();
    const prev = prevAduanaDeN(5);
    let error: unknown = null;
    try {
      computeSnapshot(jobAduana(0), idx, prev);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UniversoReducidoError);
    const err = error as UniversoReducidoError;
    expect(err.fuente).toBe('aduana');
    expect(err.filasPrevias).toBe(5);
    expect(err.filasEntrantes).toBe(0);
  });

  it('3. NO habría disparado sobre la historia: reproduce un encogimiento legítimo moderado (2000 → 1840, cifras de ejemplo) y PASA — el umbral no se eligió al azar', () => {
    const idx = makeCatalogIndex();
    const prev = prevAduanaDeN(2000);
    const { result } = computeSnapshot(jobAduana(1840), idx, prev);
    expect(result.conteos.embarques).toBe(1840);
    expect(result.universoForzado).toBe(false);
  });

  it('4a. borde: exactamente 50.0% del universo previo PASA (el corte es estrictamente "<0.50")', () => {
    const idx = makeCatalogIndex();
    const prev = prevAduanaDeN(1000);
    expect(() => computeSnapshot(jobAduana(500), idx, prev)).not.toThrow();
  });

  it('4b. borde: 49.9% del universo previo RECHAZA', () => {
    const idx = makeCatalogIndex();
    const prev = prevAduanaDeN(1000);
    expect(() => computeSnapshot(jobAduana(499), idx, prev)).toThrow(UniversoReducidoError);
  });

  it('5a. universo vacío (P17): prev.snapshotId===null → la guarda NO APLICA aunque el entrante sea 0 filas', () => {
    const idx = makeCatalogIndex();
    expect(() => computeSnapshot(jobStockVacio(), idx, emptyPrev())).not.toThrow();
  });

  it('5b. universo vacío (P17): filasPrevias===0 con snapshotId presente (caso real de `loadPrevState` recién creado el snapshot) → la guarda NO APLICA', () => {
    const idx = makeCatalogIndex();
    const prev: PrevState = { ...emptyPrev(), snapshotId: 'snap-1' };
    expect(() => computeSnapshot(jobStockVacio(), idx, prev)).not.toThrow();
  });

  it('6. forzado: la MISMA entrada de (1), con el escape hatch armado → PASA, el payload lleva forzadoPor/forzadoMotivo, y EtlResult.universoForzado===true', () => {
    const idx = makeCatalogIndex();
    const por = 'hugo@example.com';
    const motivo = 'Demo dio de baja toda la línea este mes; vaciado legítimo, confirmado con el KAM.';
    const { payload, result } = computeSnapshot(jobStockVacio(), idx, prevStockPoblado(), { por, motivo });
    expect(result.universoForzado).toBe(true);
    expect(payload.forzadoPor).toBe(por);
    expect(payload.forzadoMotivo).toBe(motivo);
  });

  it('8. PRUEBA DE VACUIDAD: construye deliberadamente el estado que DEBE poner la guarda en rojo, y comprueba que en efecto se pone en rojo', () => {
    const idx = makeCatalogIndex();
    // Deliberado: 5 embarques vigentes contra 0 entrantes — la guarda
    // TIENE que dispararse aquí; si no lo hace, la guarda está rota.
    const prevDeliberadamentePoblado = prevAduanaDeN(5);
    const jobDeliberadamenteVacio = jobAduana(0);

    let sePusoRoja = false;
    try {
      computeSnapshot(jobDeliberadamenteVacio, idx, prevDeliberadamentePoblado);
    } catch (e) {
      sePusoRoja = e instanceof UniversoReducidoError;
    }
    expect(sePusoRoja).toBe(true);
  });

  it('9. lo que NO caza (Enmienda 3): un archivo con TODAS sus filas y una columna renombrada → la guarda PASA limpio', () => {
    // Mismo patrón que `ingesta-degradada.familia-renombrada.test.ts`:
    // FAMILIA renombrada a GRUPO, columna opcional para el parser →
    // header sigue siendo válido, la fila SÍ entra, familia queda null.
    const inventarioFamiliaRenombrada: Grid = [
      [],
      [null, null, null, null, null, null, 'STOCK'],
      [],
      [null, 'ITEM', 'CLIENTE', 'MARCA', 'GRUPO', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
      [null, 'SKU-1', '', 'NACIONAL', 'texto que ya nadie lee', '', 'PRODUCTO DE PRUEBA', '10', '', '', '', '', '10', '0'],
    ];
    const job: IngestJob = {
      source: 'stock',
      capturedAt: CAPTURED_AT,
      archivo: 'stock-familia-renombrada.xlsx',
      inventario: inventarioFamiliaRenombrada,
      west: westVacio,
      reserva: reservaVacia,
    };
    const prev: PrevState = {
      snapshotId: 'snap-anterior-familia',
      hash: 'hash-anterior-no-coincide-con-nada-vacio',
      productos: [
        { sku: 'SKU-1', marca: 'NACIONAL', tecnologia: null, producto: null, familia: 'FAMILIA VIEJA BUENA', class: null, descr: 'PRODUCTO DE PRUEBA', cliente: null, resv: 0, totalFuente: 10 },
      ],
      stock: [{ sku: 'SKU-1', almacen: 'NORTH', cantidad: 10 }],
      reservas: [],
      embarques: [],
      existingSkus: new Set(['SKU-1']),
    };

    const idx = makeCatalogIndex();
    const { payload, result } = computeSnapshot(job, idx, prev);

    // La guarda pasa limpio: mismo conteo de filas de universo (1+1=2
    // ambos lados), aunque el CONTENIDO se degradó.
    expect(result.universoForzado).toBe(false);
    const producto = payload.productos.find((p) => p.sku === 'SKU-1');
    expect(producto?.familia).toBeNull(); // degradado real: la guarda NO lo cazó (no es su trabajo — F2/F3)
  });
});
