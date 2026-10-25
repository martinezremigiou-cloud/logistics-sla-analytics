// ============================================================
// [S2 - pruebas rojas - REPRODUCIBILIDAD] Prueba 4 - ingesta-vacia
// (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`: una
// ingesta vacía no puede pasar por un archivo "bien formado").
//
// Entrada: libro de STOCK con las 3 hojas MAPEADAS (Inventario/WEST/
// Reserva, con su fila de encabezado real, banner y filas de estructura
// incluidas) pero SIN NINGUNA fila de datos debajo del encabezado.
//
// DECISION DE PRODUCTO (S7-A, 2026-08-07, Opcion A ratificada): "rechazar",
// no "aceptar con aviso". La senal exacta elegida es una guarda
// BLOQUEANTE en `computeSnapshot` (src/services/etl/runEtl.ts) que
// compara filasEntrantes/filasPrevias contra el snapshot vigente de la
// MISMA fuente y lanza `UniversoReducidoError`
// (src/services/etl/errors.ts) cuando el universo entrante cae por
// debajo del 50% del previo — con un escape hatch EXPLICITO de tres
// cabeceras HTTP para el caso de negocio legitimo (ver
// `src/lib/api/forzar-universo.ts` y el test dedicado
// `src/services/etl/__tests__/guarda-universo-reducido.test.ts`, que
// cubre el mecanismo completo: borde del umbral, la excepcion de
// universo vacio, el forzado, y lo que la guarda declara que NO caza).
// La asercion roja que este archivo tenia ("alguna senal observable, la
// que sea") se REEMPLAZA aqui por la senal exacta que se decidio,
// como ordena la cabecera original de este mismo archivo - no se borra.
//
// HALLAZGO ADICIONAL (no pedido explicitamente, documentado tambien en
// el reporte de entrega): MVP-CIERRE ya anadio un .min(2) a
// inventarioGridSchema (src/schemas/refresh.schema.ts) precisamente para
// este caso. Pero ese .min(2) cuenta FILAS TOTALES del grid crudo, no
// filas de DATOS bajo el encabezado real: la hoja Inventario real trae
// banner + fila en blanco ANTES del encabezado (ver inventarioMin en
// computeSnapshot.test.ts), asi que un archivo realista "solo
// encabezados" tiene longitud 4 (banner, blanco, blanco, encabezado) -
// muy por encima de 2. El test de abajo pasa el body completo por
// RefreshBody.safeParse para demostrarlo: el .min(2) NO detiene este
// caso con una geometria de hoja realista — por eso la guarda de
// universo hizo falta.
// ============================================================
import { describe, it, expect } from 'vitest';
import { construirDatasets, type WorkbookGrids } from '../motor';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';
import { RefreshBody } from '@/schemas/refresh.schema';
import { computeSnapshot } from '@/services/etl/runEtl';
import { UniversoReducidoError } from '@/services/etl/errors';
import { makeCatalogIndex } from '@/services/etl/__tests__/helpers';
import type { IngestJob, PrevState, Grid } from '@/services/etl/types';

const CAPTURED_AT = '2026-08-05T00:00:00.000Z';

// Misma geometria real que inventarioMin/westMin/reservaMin de
// computeSnapshot.test.ts (banner, filas de estructura, encabezado) pero
// SIN ninguna fila de datos abajo del encabezado.
const inventarioSoloEncabezados: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
];
const westSoloEncabezados: Grid = [
  ['INVENTARIO WEST'],
  [],
  ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO'],
];
const reservaSoloEncabezados: Grid = [
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

const libroStockSoloEncabezados: WorkbookGrids = {
  nombreArchivo: 'stock-solo-encabezados.xlsx',
  hojas: [
    { nombre: 'Inventario', grid: inventarioSoloEncabezados },
    { nombre: 'WEST', grid: westSoloEncabezados },
    { nombre: 'Reserva', grid: reservaSoloEncabezados },
  ],
};
const aduanaVacia: WorkbookGrids = { nombreArchivo: '(no aplica en esta prueba)', hojas: [] };

function prevConCatalogoPoblado(): PrevState {
  return {
    snapshotId: 'snap-anterior',
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

describe('ingesta STOCK con las 3 hojas mapeadas y SOLO ENCABEZADOS (ingesta-vacia)', () => {
  it('documenta el estado actual: hoy PASA el gate de motor.ts y PASA RefreshBody.safeParse', () => {
    const { bodyStock } = construirDatasets(
      { stock: libroStockSoloEncabezados, aduana: aduanaVacia },
      ingestaMapeoConfig,
      { capturedAt: CAPTURED_AT },
    );
    expect(bodyStock.datasets.inventario.length).toBe(4);
    expect(bodyStock.datasets.west.length).toBe(3);
    expect(bodyStock.datasets.reserva.length).toBe(9);

    const parsed = RefreshBody.safeParse({
      source: 'stock',
      capturedAt: CAPTURED_AT,
      archivo: bodyStock.archivo,
      datasets: bodyStock.datasets,
    });
    expect(parsed.success).toBe(true);
  });

  it('VERDE (S7-A, decision de producto 2026-08-07): frente a un catalogo previo con productos, el universo entrante vacio lanza UniversoReducidoError con AMBOS numeros', () => {
    const { bodyStock } = construirDatasets(
      { stock: libroStockSoloEncabezados, aduana: aduanaVacia },
      ingestaMapeoConfig,
      { capturedAt: CAPTURED_AT },
    );

    const job: IngestJob = {
      source: 'stock',
      capturedAt: CAPTURED_AT,
      archivo: bodyStock.archivo,
      inventario: bodyStock.datasets.inventario,
      west: bodyStock.datasets.west,
      reserva: bodyStock.datasets.reserva,
    };
    const idx = makeCatalogIndex();
    const prev = prevConCatalogoPoblado();

    let lanzo: unknown = null;
    try {
      computeSnapshot(job, idx, prev);
    } catch (e) {
      lanzo = e;
    }

    expect(lanzo).toBeInstanceOf(UniversoReducidoError);
    const err = lanzo as UniversoReducidoError;
    // prevConCatalogoPoblado(): 2 productos + 2 filas de stock + 0
    // reservas + 0 embarques = 4 filas de universo previo. El libro
    // "solo encabezados" no aporta ni un producto, ni una fila de stock,
    // ni una reserva → 0 filas entrantes.
    expect(err.filasPrevias).toBe(4);
    expect(err.filasEntrantes).toBe(0);
    expect(err.fuente).toBe('stock');
  });
});
