// ============================================================
// [S2 · pruebas rojas · REPRODUCIBILIDAD] Prueba 5 · ingesta-degradada
// (columna de familia renombrada — P11)
// (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`: "El caso
// que SÍ pisa datos no es el vacío: es el degradado").
//
// Entrada: hoja Inventario con la columna FAMILIA renombrada (p.ej. a
// "GRUPO") — una columna que el parser real (`parse.inventario.ts`)
// reconoce como OPCIONAL (`CAMPOS_VISIBLES_OPCIONALES`), así que el
// header SIGUE siendo válido (ancla con item/marca/total/resv) y la fila
// SÍ entra al upsert de `productos`, pero con `familia: null` para cada
// producto — sobrescribiendo un valor bueno que sí existía en el
// snapshot anterior.
//
// LO QUE HOY YA EXISTE (documentado aquí, NO es lo rojo):
//   `parse.inventario.ts` SÍ registra un ítem de cuarentena a nivel de
//   HOJA (`columna_ausente_familia`) cuando la columna falta — eso ya es
//   parte del "mitigante real" que describe la Parte 0 del bloque
//   ("queda registrado en cambios con valor anterior y nuevo").
//
// LO ROJO — F3 del bloque, y es literalmente P11 ("Lo que falta es que
// alguien se entere SIN IR A BUSCARLO"): ese ítem de cuarentena vive
// enterrado en la respuesta JSON de la ingesta (`result.cuarentena`) y
// en la tabla `cambios`; NADA lo saca a un canal que alguien mire sin
// ir a buscarlo. F3 pide como mínimo "un console.error con conteo de
// columnas ausentes por dataset, para que aparezca en los logs de
// Vercel". Hoy, en TODO el árbol de `src/services/etl` y
// `src/services/ingesta` (grep verificado), no hay una sola llamada a
// `console.error`/`console.warn` — el pipeline puro es enteramente
// silencioso por consola, exactamente donde F3 exige lo contrario.
//
// No se prescribe AQUÍ el lugar exacto del fix (¿dentro del parser?
// ¿en runEtl? ¿en el route handler, junto a los console.error que ya
// existen ahí para otras condiciones?) — eso es implementación de S4,
// no de este frente. La prueba solo comprueba el efecto observable: al
// terminar de computar esta ingesta degradada, ¿se llamó a
// `console.error` al menos una vez? Hoy no.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import { computeSnapshot } from '../runEtl';
import { makeCatalogIndex } from './helpers';
import type { IngestJob, PrevState, Grid } from '../types';

const CAPTURED_AT = '2026-08-05T00:00:00.000Z';

// Mismo layout real que `inventarioMin` de computeSnapshot.test.ts, pero
// con la columna FAMILIA renombrada a "GRUPO" (no está en
// COLS.familia = ['familia'] de parse.inventario.ts, así que
// resolveColumns no la reconoce como ninguna columna canónica).
const inventarioFamiliaRenombrada: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'GRUPO', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
  [null, 'SKU-1', '', 'NACIONAL', 'texto que ya nadie lee', '', 'PRODUCTO DE PRUEBA', '10', '', '', '', '', '10', '0'],
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

function jobFamiliaRenombrada(): IngestJob {
  return {
    source: 'stock',
    capturedAt: CAPTURED_AT,
    archivo: 'stock-familia-renombrada.xlsx',
    inventario: inventarioFamiliaRenombrada,
    west: westVacio,
    reserva: reservaVacia,
  };
}

/** SKU-1 ya existía con una familia real: es el valor bueno en riesgo. */
function prevConFamiliaBuena(): PrevState {
  return {
    snapshotId: 'snap-anterior',
    hash: 'hash-anterior-no-coincide',
    productos: [
      { sku: 'SKU-1', marca: 'NACIONAL', tecnologia: null, producto: null, familia: 'FAMILIA VIEJA BUENA', class: null, descr: 'PRODUCTO DE PRUEBA', cliente: null, resv: 0, totalFuente: 10 },
    ],
    stock: [{ sku: 'SKU-1', almacen: 'NORTH', cantidad: 10 }],
    reservas: [],
    embarques: [],
    existingSkus: new Set(['SKU-1']),
  };
}

describe('ingesta STOCK con la columna FAMILIA renombrada (ingesta-degradada, P11)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('documenta el estado actual: la columna ausente SÍ deja un ítem de cuarentena a nivel de hoja, y SÍ sobrescribe la familia con null en cambios (MODIFICACION)', () => {
    const { result, payload } = computeSnapshot(jobFamiliaRenombrada(), makeCatalogIndex(), prevConFamiliaBuena());

    const item = result.cuarentena.items.find((q) => q.motivo === 'columna_ausente_familia');
    expect(item).toBeDefined();

    const perdioFamilia = payload.cambios.find(
      (c) => c.entidad === 'producto' && c.sku === 'SKU-1' && c.campo === 'familia' && c.tipo === 'MODIFICACION',
    );
    expect(perdioFamilia).toBeDefined();
    expect(perdioFamilia?.valor_anterior).toBe('FAMILIA VIEJA BUENA');
    expect(perdioFamilia?.valor_nuevo).toBe(null);
  });

  it('ROJO HOY (F3 / P11): al procesar esta ingesta degradada, NINGÚN console.error/console.warn avisa del problema — "alguien se entera sin ir a buscarlo" no se cumple', () => {
    const spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    computeSnapshot(jobFamiliaRenombrada(), makeCatalogIndex(), prevConFamiliaBuena());

    const huboAvisoVisible = spyError.mock.calls.length > 0 || spyWarn.mock.calls.length > 0;
    expect(huboAvisoVisible).toBe(true); // falla hoy: 0 llamadas a console.error/warn
  });
});
