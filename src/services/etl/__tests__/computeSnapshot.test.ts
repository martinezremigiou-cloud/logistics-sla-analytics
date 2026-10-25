import { describe, it, expect } from 'vitest';
import { computeSnapshot, type ComputeResult } from '../runEtl';
import { EtlContractError } from '../errors';
import { makeCatalogIndex, emptyPrev, realInventario, realWest, realReserva, realEmbarques } from './helpers';
import { MUESTRA } from './constantes-muestra';
import type { Grid, IngestJob, PrevState, QuarantineItem, ReservaCanon } from '../types';

function motivoBreakdown(items: QuarantineItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of items) out[q.motivo] = (out[q.motivo] ?? 0) + 1;
  return out;
}

// Evidencia de dry-run detrás de un flag para NO contaminar CI (B8).
// Correr con:  ETL_EVIDENCE=1 npx vitest run ... --disable-console-intercept
function evidencia(label: string, obj: unknown): void {
  if (!process.env.ETL_EVIDENCE) return;
  // eslint-disable-next-line no-console
  console.log(label, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2));
}

const idx = makeCatalogIndex();

const stockJob: IngestJob = {
  source: 'stock',
  capturedAt: '2026-04-07T00:00:00.000Z',
  archivo: '07ABRIL26 Inventario Demo.ods',
  inventario: realInventario(),
  west: realWest(),
  reserva: realReserva(),
};

describe('computeSnapshot — dry-run STOCK (fixtures de muestra)', () => {
  const prev = emptyPrev();
  const { payload, result, snapshotHash } = computeSnapshot(stockJob, idx, prev);

  it('EVIDENCIA (conteos)', () => {
    evidencia('[DRY-RUN STOCK]', {
      conteos: result.conteos,
      cuarentenaTotal: result.cuarentena.total,
      cuarentenaMotivos: motivoBreakdown(result.cuarentena.items),
      diagLength: result.diag.length,
      diagPorTipo: {
        SUMA_STOCK: result.diag.filter((d) => d.tipo === 'SUMA_STOCK').length,
        SUMA_RESERVAS: result.diag.filter((d) => d.tipo === 'SUMA_RESERVAS').length,
      },
      marcasNuevas: payload.marcasNuevas,
      familiasNuevasCount: payload.familiasNuevas.length,
      snapshotHash: snapshotHash.slice(0, 16),
    });
    // cifras por construcción del generador (inventario + WEST nuevos; reservas válidas; filas de stock reconciliado)
    expect(result.conteos.productos).toBe(MUESTRA.abril.productosReconciliados);
    expect(result.conteos.reservas).toBe(MUESTRA.abril.reservas);
    expect(result.conteos.stock).toBe(MUESTRA.abril.stockReconciliado);
  });

  it('marcas nuevas detectadas (BRAND5/BRAND9/BRAND2) para ALTA', () => {
    expect(payload.marcasNuevas).toEqual(expect.arrayContaining(MUESTRA.marcasNuevasTestigo));
    expect([...payload.marcasNuevas].sort()).toEqual(MUESTRA.abril.marcasNuevas);
  });
  it('WEST NUNCA es marca (regla almacén) — no aparece en marcasNuevas', () => {
    expect(payload.marcasNuevas).not.toContain('WEST');
    // los renglones MARCA=WEST se reasignan a NACIONAL (producto conservado)
    const nacional = payload.productos.filter((p) => p.marca === 'NACIONAL');
    expect(MUESTRA.abril.marcaBodega).toBeGreaterThan(0); // el fixture SÍ trae renglones con la bodega escrita en MARCA
    expect(nacional.length).toBe(MUESTRA.abril.productosNacional);
    expect(nacional.length).toBeGreaterThanOrEqual(MUESTRA.abril.marcaBodega);
  });
  it('familias nuevas detectadas (catálogo semilla vacío)', () => {
    expect(payload.familiasNuevas.length).toBeGreaterThan(0);
    expect(payload.familiasNuevas).toEqual(expect.arrayContaining([MUESTRA.familiaTestigo]));
    expect([...payload.familiasNuevas].sort()).toEqual(MUESTRA.abril.familiasNuevas);
  });
  it('no sinCambios en primera carga; cambios = ALTA de todo', () => {
    expect(result.sinCambios).toBe(false);
    expect(result.conteos.cambios).toBeGreaterThan(0);
  });
  it('gates: DIAG es informativo (no bloquea), data conservada', () => {
    expect(Array.isArray(result.diag)).toBe(true);
    // el POST no se rechaza aunque haya mismatches
    expect(result.conteos.productos).toBeGreaterThan(0);
  });
  it('WEST excluido de Σstock: producto WEST-nuevo no genera DIAG de stock', () => {
    const soloWest = MUESTRA.westTestigos[0].sku; // SKU que solo existe en WEST, con FISICO > 0
    const d = result.diag.find((x) => x.sku === soloWest && x.tipo === 'SUMA_STOCK');
    expect(d).toBeUndefined();
    expect(result.diag.filter((x) => x.tipo === 'SUMA_STOCK')).toHaveLength(MUESTRA.abril.diagStock);
  });
  it('paridad Σreservas==resv: hay SKUs en paridad (log)', () => {
    const suma = result.diag.filter((d) => d.tipo === 'SUMA_RESERVAS').length;
    const enParidad = result.conteos.productos - suma;
    evidencia('[PARIDAD RESV]', `productos=${result.conteos.productos} sin_diag_reservas=${enParidad} con_diag=${suma}`);
    expect(suma).toBe(MUESTRA.abril.diagReservas);
    expect(enParidad).toBe(MUESTRA.abril.enParidad);
    expect(enParidad).toBeGreaterThan(0);
  });
});

describe('computeSnapshot — guarda de contrato por fuente (A1)', () => {
  it("stock sin el dataset 'reserva' → EtlContractError (no snapshot vacío)", () => {
    const bad: IngestJob = {
      source: 'stock',
      capturedAt: '2026-04-07T00:00:00.000Z',
      archivo: null,
      inventario: realInventario(),
      west: realWest(),
      // falta reserva
    };
    expect(() => computeSnapshot(bad, idx, emptyPrev())).toThrow(EtlContractError);
  });
  it("legacy de una sola hoja de stock ('inventario') NO admitida en runEtl", () => {
    const legacy: IngestJob = {
      source: 'inventario',
      capturedAt: '2026-04-07T00:00:00.000Z',
      archivo: null,
      inventario: realInventario(),
    };
    expect(() => computeSnapshot(legacy, idx, emptyPrev())).toThrow(EtlContractError);
  });
  it('aduana sin dataset embarques → EtlContractError', () => {
    const bad: IngestJob = {
      source: 'aduana',
      capturedAt: '2026-04-07T00:00:00.000Z',
      archivo: null,
    };
    expect(() => computeSnapshot(bad, idx, emptyPrev())).toThrow(EtlContractError);
  });
  it("legacy 'embarques' (una hoja, fuente aduana) SÍ es válida", () => {
    const legacy: IngestJob = {
      source: 'embarques',
      capturedAt: '2026-04-07T00:00:00.000Z',
      archivo: null,
      embarques: [{ hoja: 'MANUAL', grid: realEmbarques()[MUESTRA.abril.embarques.indiceHojaConEstatus].grid }],
    };
    expect(() => computeSnapshot(legacy, idx, emptyPrev(['SUJ500-F']))).not.toThrow();
  });
});

describe('computeSnapshot — idempotencia por hash', () => {
  it('re-POST idéntico (mismo hash previo) → sinCambios, 0 cambios', () => {
    const first = computeSnapshot(stockJob, idx, emptyPrev());
    const prevWithHash = { ...emptyPrev(), snapshotId: 'snap-1', hash: first.snapshotHash };
    const second = computeSnapshot(stockJob, idx, prevWithHash);
    expect(second.result.sinCambios).toBe(true);
    expect(second.result.conteos.cambios).toBe(0);
    expect(second.snapshotHash).toBe(first.snapshotHash);
  });
  it('hash estable entre dos corridas idénticas', () => {
    const a = computeSnapshot(stockJob, idx, emptyPrev()).snapshotHash;
    const b = computeSnapshot(stockJob, idx, emptyPrev()).snapshotHash;
    expect(a).toBe(b);
  });
});

// Fix O5 (ratificado 2026-07-17): las reservas SIN fecha en la hoja se
// rellenaban con capturedAt EXACTO → con Power Automate corriendo cada
// ~15 min, la clave de esa reserva (que incluye `fecha`) rotaba en cada
// corrida y rompía la idempotencia (snapshot "distinto" sin cambio real).
// Ahora se rellenan con el PERIODO (YYYY-MM-01), estable dentro del mes.
describe('computeSnapshot — idempotencia intra-mes de reservas sin fecha (fix O5)', () => {
  // Geometría mínima válida (mismo patrón que
  // src/services/etl/__tests__/fixtures/edge/*.json y el escenario O5 de
  // convivencia.o5.test.ts): header por CONTENIDO, no por posición.
  const inventarioMin: Grid = [
    [],
    [null, null, null, null, null, null, 'STOCK'],
    [],
    [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
    [null, 'SKU-1', '', 'NACIONAL', '', '', 'PRODUCTO DE PRUEBA', '10', '', '', '', '', '10', '0'],
  ];
  const westMin: Grid = [['INVENTARIO WEST'], [], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
  // col 3 (RETAILER64) = reserva CON fecha propia → control, nunca debe rotar.
  // col 4 (RETAILER 56) = reserva SIN fecha (sentinel '') → la que el bug rotaba.
  const reservaMin: Grid = [
    ['DEMO COMERCIAL S DE RL DE CV'],
    [],
    [],
    [],
    [null, null, null, 'Laura', 'Lucas'],
    [],
    ['STOCK MEXICO', null, null, '23-abr-26', null],
    [null, null, null, 'pedido A', 'pedido B'],
    ['ITEM', null, null, 'RETAILER64', 'RETAILER 56'],
    ['SKU-1', '0', null, '8', '5'],
  ];

  function jobAt(capturedAt: string): IngestJob {
    return {
      source: 'stock',
      capturedAt,
      archivo: 'idempotencia-o5.ods',
      inventario: inventarioMin,
      west: westMin,
      reserva: reservaMin,
    };
  }

  /** Estado previo real (no emptyPrev) para diffear contra un snapshot ya persistido. */
  function prevStateFromResult(a: ComputeResult): PrevState {
    return {
      snapshotId: 'snap-1',
      hash: a.snapshotHash,
      productos: a.payload.productos.map((p) => ({
        sku: p.sku, marca: p.marca, tecnologia: p.tecnologia, producto: p.producto, familia: p.familia, class: p.class,
        descr: p.descr_origen, cliente: p.cliente, resv: p.resv, totalFuente: 0,
      })),
      stock: a.payload.stock.map((s) => ({ sku: s.sku, almacen: s.almacen, cantidad: s.cantidad })),
      reservas: a.payload.reservas.map((r) => ({
        sku: r.sku, kam: r.kam, cliente: r.cliente, cantidad: r.cantidad, motivo: r.motivo, fecha: r.fecha,
      })),
      embarques: [],
      existingSkus: new Set(a.payload.productos.map((p) => p.sku)),
    };
  }

  it('reserva sin fecha se rellena con periodo-01 (no con capturedAt exacto); la reserva con fecha propia queda intacta', () => {
    const { payload } = computeSnapshot(jobAt('2026-04-20T08:15:00.000Z'), idx, emptyPrev());
    const sinFecha = payload.reservas.find((r) => r.cliente === 'RETAILER 56');
    const conFecha = payload.reservas.find((r) => r.cliente === 'RETAILER64');
    expect(sinFecha?.fecha).toBe('2026-04-01'); // periodo, NO el día 20 de captura
    expect(conFecha?.fecha).toBe('2026-04-23'); // fecha propia de la hoja, sin tocar
  });

  it('mismo mes, capturedAt DISTINTO (simula corridas de PA cada 15 min) → MISMO hash (sinCambios)', () => {
    const a = computeSnapshot(jobAt('2026-04-07T00:00:00.000Z'), idx, emptyPrev());
    const prevWithHash = { ...emptyPrev(), snapshotId: 'snap-1', hash: a.snapshotHash };
    const b = computeSnapshot(jobAt('2026-04-20T08:15:00.000Z'), idx, prevWithHash);
    expect(b.snapshotHash).toBe(a.snapshotHash);
    expect(b.result.sinCambios).toBe(true);
    expect(b.result.conteos.cambios).toBe(0);
  });

  it('mes DISTINTO → el hash SÍ cambia, pero SOLO por la reserva sin fecha (ruido residual mensual esperado; deuda BP-9)', () => {
    const a = computeSnapshot(jobAt('2026-04-07T00:00:00.000Z'), idx, emptyPrev());
    const b = computeSnapshot(jobAt('2026-05-03T00:00:00.000Z'), idx, prevStateFromResult(a));

    expect(b.snapshotHash).not.toBe(a.snapshotHash);
    expect(b.result.sinCambios).toBe(false);

    // La clave de reserva incluye `fecha` → rotarla se ve como BAJA (clave de
    // abril) + ALTA (clave de mayo) del mismo sku/kam/cliente/motivo, nunca
    // como MODIFICACION. Es el ruido documentado en `docs/known-limitations.md` (BP-9).
    const cambiosReserva = b.payload.cambios.filter((c) => c.entidad === 'reserva');
    expect(cambiosReserva).toHaveLength(2);
    expect(cambiosReserva.map((c) => c.tipo).sort()).toEqual(['ALTA', 'BAJA']);
    expect(cambiosReserva.every((c) => c.clave.includes('RETAILER 56'))).toBe(true);

    // producto/stock y la reserva CON fecha propia (RETAILER64): sin cambios.
    expect(b.payload.cambios.filter((c) => c.entidad !== 'reserva')).toHaveLength(0);
  });
});

// Fix (bug idempotencia KAM desconocido, ratificado 2026-07-19): cuando el
// KAM crudo del Excel no existe en el catálogo `kams` (resolveKam → null),
// la reserva se persiste con kam_id=null. loadPrevState (persist.ts)
// reconstruye el KAM previo vía JOIN `kams(nombre)` sobre kam_id: con
// kam_id null el JOIN no aporta fila → kam previo = null (NUNCA el texto
// crudo 'RETAILER24'). Antes del fix, el lado NUEVO de diffEntity armaba la
// clave con el kam crudo del Excel → claves asimétricas nuevo↔previo →
// BAJA+ALTA fantasma en CADA re-POST del mismo archivo (flap de
// idempotencia; caso típico: KAMs desconocidos ausentes del
// catálogo, claves `SW8196|retailer24|RETAILER24|2026-07-01|`
// ALTA vs `SW8196||RETAILER24|2026-07-01|` BAJA en cada corrida).
describe('computeSnapshot — idempotencia de reserva con KAM desconocido (fix asimetría nuevo↔previo)', () => {
  const inventarioMin: Grid = [
    [],
    [null, null, null, null, null, null, 'STOCK'],
    [],
    [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
    [null, 'SW8196', '', 'NACIONAL', '', '', 'PRODUCTO DE PRUEBA', '10', '', '', '', '', '10', '0'],
  ];
  const westMin: Grid = [['INVENTARIO WEST'], [], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];

  // KAM 'RETAILER24' NO existe en makeCatalogIndex() → resolveKam devuelve null
  // (caso típico: KAMs desconocidos, ausentes del
  // catálogo `kams`).
  const reservaKamDesconocido: Grid = [
    ['DEMO COMERCIAL S DE RL DE CV'],
    [],
    [],
    [],
    [null, null, 'RETAILER24'],
    [],
    ['STOCK MEXICO', null, '01-jul-26'],
    [],
    ['ITEM', null, 'RETAILER24'],
    ['SW8196', '0', '22'],
  ];

  const job: IngestJob = {
    source: 'stock',
    capturedAt: '2026-07-05T00:00:00.000Z',
    archivo: 'julio.ods',
    inventario: inventarioMin,
    west: westMin,
    reserva: reservaKamDesconocido,
  };

  /** Espeja el colapso a null de loadPrevState (persist.ts): kam_id null ⇒
   *  el JOIN `reservas.select('..., kams(nombre)')` no aporta fila ⇒ el kam
   *  previo reconstruido es null (nunca el texto crudo del Excel). Cuando
   *  kam_id SÍ resolvió, loadPrevState devuelve el NOMBRE CANÓNICO de la
   *  tabla `kams` (vía el JOIN) — no necesariamente el mismo texto crudo:
   *  son equivalentes POR CLAVE (reservaKey normaliza con
   *  normalizeAliasKey), no por igualdad literal de string. `kamCanonico`
   *  permite modelar ese caso (ver test (c): crudo 'LAURA' vs canónico
   *  'Laura'); si se omite, se reusa el crudo (coincide con el canónico
   *  en los tests (a)/(b), donde el kam es null de cualquier forma). */
  function comoPrevReconstruido(
    result: ComputeResult,
    cantidadOverride?: number,
    kamCanonico?: string,
  ): ReservaCanon[] {
    return result.payload.reservas.map((r) => ({
      sku: r.sku,
      kam: r.kam_id === null ? null : (kamCanonico ?? r.kam),
      cliente: r.cliente,
      cantidad: cantidadOverride ?? r.cantidad,
      motivo: r.motivo,
      fecha: r.fecha,
    }));
  }

  it('(a) prev vacío → ALTA con segmento KAM VACÍO en la clave (nunca el crudo "retailer24")', () => {
    const { payload } = computeSnapshot(job, idx, emptyPrev());
    const cambiosReserva = payload.cambios.filter((c) => c.entidad === 'reserva');
    expect(cambiosReserva).toHaveLength(1);
    expect(cambiosReserva[0]).toMatchObject({
      tipo: 'ALTA',
      clave: 'SW8196||RETAILER24|2026-07-01|',
    });
  });

  it('(b) [BUG] re-POST contra el prev TAL COMO lo reconstruye loadPrevState (kam null) → 0 cambios de reserva (antes del fix: ALTA+BAJA fantasma)', () => {
    const first = computeSnapshot(job, idx, emptyPrev());
    const prev: PrevState = {
      snapshotId: 'snap-1',
      hash: 'hash-anterior-no-coincide', // evita el atajo de sinCambios por hash
      productos: [],
      stock: [],
      reservas: comoPrevReconstruido(first),
      embarques: [],
      existingSkus: new Set(first.payload.productos.map((p) => p.sku)),
    };
    const second = computeSnapshot(job, idx, prev);
    const cambiosReserva = second.payload.cambios.filter((c) => c.entidad === 'reserva');
    expect(cambiosReserva).toHaveLength(0);
  });

  it('(c) regresión: KAM conocido sigue usando su nombre en la clave y detecta MODIFICACION de cantidad (crudo "LAURA" vs canónico "Laura" del catálogo — ejercita la ruta crudo↔canónico)', () => {
    // Crudo en caja distinta a la canónica del catálogo (makeCatalogIndex
    // siembra 'Laura'); resolveKam es case-insensitive (normalizeAliasKey)
    // así que kam_id SÍ resuelve, pero el texto crudo persistido en
    // payload.reservas[].kam es 'LAURA' tal cual vino del Excel.
    const reservaKamConocido: Grid = [
      ['DEMO COMERCIAL S DE RL DE CV'],
      [],
      [],
      [],
      [null, null, 'LAURA'],
      [],
      ['STOCK MEXICO', null, '01-jul-26'],
      [],
      ['ITEM', null, 'ACME'],
      ['SW8196', '0', '22'],
    ];
    const jobConocido: IngestJob = { ...job, reserva: reservaKamConocido };

    const first = computeSnapshot(jobConocido, idx, emptyPrev());
    const altaReserva = first.payload.cambios.find((c) => c.entidad === 'reserva');
    expect(altaReserva).toMatchObject({
      tipo: 'ALTA',
      clave: 'SW8196|laura|ACME|2026-07-01|',
    });

    const prev: PrevState = {
      snapshotId: 'snap-1',
      hash: 'hash-anterior-no-coincide',
      productos: [],
      stock: [],
      // El prev reconstruido trae el nombre CANÓNICO ('Laura', vía el
      // JOIN real a `kams`), distinto en caja del crudo 'LAURA' de arriba
      // — deben seguir resolviendo a la MISMA clave normalizada.
      reservas: comoPrevReconstruido(first, 22 + 3, 'Laura'), // fuerza MODIFICACION de cantidad
      embarques: [],
      existingSkus: new Set(first.payload.productos.map((p) => p.sku)),
    };
    const second = computeSnapshot(jobConocido, idx, prev);
    const cambiosReserva = second.payload.cambios.filter((c) => c.entidad === 'reserva');
    expect(cambiosReserva).toHaveLength(1);
    expect(cambiosReserva[0]).toMatchObject({
      tipo: 'MODIFICACION',
      campo: 'cantidad',
      clave: 'SW8196|laura|ACME|2026-07-01|',
    });
  });
});

describe('computeSnapshot — dry-run ADUANA (embarques)', () => {
  // existingSkus = productos del pipeline stock (para referencial de embarques)
  const stock = computeSnapshot(stockJob, idx, emptyPrev());
  const existingSkus = stock.payload.productos.map((p) => p.sku);

  const aduanaJob: IngestJob = {
    source: 'aduana',
    capturedAt: '2026-04-07T00:00:00.000Z',
    archivo: 'Seguimiento de Embarques Demo 2026 .xlsx',
    embarques: realEmbarques(),
  };
  const { payload, result, snapshotHash } = computeSnapshot(aduanaJob, idx, emptyPrev(existingSkus));

  it('EVIDENCIA (conteos aduana)', () => {
    evidencia('[DRY-RUN ADUANA]', {
      conteos: result.conteos,
      cuarentenaTotal: result.cuarentena.total,
      cuarentenaMotivos: motivoBreakdown(result.cuarentena.items),
      diagLength: result.diag.length,
      snapshotHash: snapshotHash.slice(0, 16),
    });
    // embarques persistibles = filas con ITEM de las hojas de embarque − las de SKU fuera del universo (cuarentena)
    expect(result.conteos.embarques).toBe(MUESTRA.abril.embarques.total - MUESTRA.abril.embarques.fuera);
  });
  it('embarques con SKU sin producto → cuarentena (referencial)', () => {
    const q = result.cuarentena.items.filter((c) => c.motivo === 'embarque_sku_sin_producto');
    expect(q.length).toBe(MUESTRA.abril.embarques.fuera);
    expect(q.length).toBeGreaterThan(0);
  });
  it('todos los embarques persistibles tienen estatus_id 1..11', () => {
    expect(payload.embarques.every((e) => e.estatus_id >= 1 && e.estatus_id <= 11)).toBe(true);
  });
  it('is_historial presente (activos e históricos)', () => {
    expect(payload.embarques.some((e) => e.is_historial)).toBe(true);
    expect(payload.embarques.some((e) => !e.is_historial)).toBe(true);
  });
});
