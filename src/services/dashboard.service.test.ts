import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

const conVigenteStockMock = vi.fn();
const resolveVigenteMock = vi.fn();
vi.mock('./vigente.service', () => ({
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
}));

import {
  buildDashboard,
  vigentePorPeriodo,
  periodosOrdenados,
  cortesPorPeriodo,
  agruparPipeline,
  getDashboard,
  fetchDescuadresVigentes,
  heatmapPiezasUniverso,
  type BuildDashboardInput,
  type SnapshotPeriodoRow,
  type DashboardEstatusRow,
  type EmbarqueActivoLectura,
} from './dashboard.service';
import type { DashboardPipelineEtapa } from '@/types/api';
import type { ProductoLectura, StockLectura, ReservaLectura, ClasificacionV2Lectura } from './derivaciones';
import { SIN_TECNOLOGIA } from '@/lib/clasificacion';

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------

/** Las 11 etapas canónicas (0004_estatus.sql), en orden — mismo fixture que cruce.service.test.ts. */
const ESTATUS_FIXTURE: DashboardEstatusRow[] = [
  { orden: 1, nombre: 'Producto Solicitado' },
  { orden: 2, nombre: 'En Preparación' },
  { orden: 3, nombre: 'En Recolección' },
  { orden: 4, nombre: 'En Almacén FW' },
  { orden: 5, nombre: 'En Tránsito Aéreo' },
  { orden: 6, nombre: 'En Tránsito Marítimo' },
  { orden: 7, nombre: 'En Aduana' },
  { orden: 8, nombre: 'En Tránsito Terrestre' },
  { orden: 9, nombre: 'En Almacén Fiscal' },
  { orden: 10, nombre: 'En Almacén North' },
  { orden: 11, nombre: 'Producto Disponible' },
];

/**
 * [CAT-ITER-1 · O-5] `tecnologia` es EXPLÍCITO en la factoría, y no por gusto.
 *
 * Antes no estaba: `ProductoLectura.tecnologia` es opcional, así que todo
 * producto de este archivo nacía con `undefined`. Consecuencia medida — el
 * test de abajo que se llama «invariante: sin_v2 SIEMPRE está contenido en
 * sin_tecnologia» **no podía ponerse rojo por lo que dice vigilar**: la única
 * forma de romper esa contención es un SKU SIN fila v2 pero CON tecnología de
 * fuente, y ese caso era INEXPRESABLE mientras el campo no existiera en el
 * fixture. Un trinquete cuyo fixture no puede construir la violación no
 * vigila: acompaña. Es `P26` —el fixture prueba la comprensión, no el código—
 * en su forma más cara, porque el nombre del test promete lo contrario.
 *
 * `null` (no `undefined`) para que el «no hay dato» sea una decisión escrita y
 * no la ausencia de una línea.
 */
function producto(overrides: Partial<ProductoLectura> = {}): ProductoLectura {
  return { sku: 'A-1', marca: 'BRAND1', familia: 'CANDADOS', descr_origen: 'Descr', cliente: null, resv: 0, tecnologia: null, ...overrides };
}
function stockFx(sku: string, almacen: string, cantidad: number): StockLectura {
  return { sku, almacen, cantidad };
}
function reservaFx(sku: string, cantidad: number, kam: string | null = null): ReservaLectura {
  return { sku, kam, cliente: '', cantidad, motivo: null, fecha: '' };
}
function embarqueActivo(overrides: Partial<EmbarqueActivoLectura> = {}): EmbarqueActivoLectura {
  return { sku: 'A-1', piezas: 10, eta: null, fecha_llegada: null, estatus_id: 7, ...overrides };
}
function v2Fx(sku: string, overrides: Partial<ClasificacionV2Lectura> = {}): ClasificacionV2Lectura {
  return { sku, tecnologia: null, marca_v2: null, familia_v2: null, clase_v2: null, descr_v2: null, ...overrides };
}

function baseInput(overrides: Partial<BuildDashboardInput> = {}): BuildDashboardInput {
  return {
    hoy: '2026-07-20',
    vigenteStockSnap: null,
    vigenteAduanaSnap: null,
    productos: [],
    stock: [],
    reservas: [],
    overrides: [],
    v2: [],
    embarquesActivos: [],
    estatus: ESTATUS_FIXTURE,
    periodos: { actual: null, anterior: null },
    tendencia: [],
    piezasEnCaminoBase: null,
    pendientesAbiertos: 0,
    tecnologia: null,
    ...overrides,
  };
}

// ============================================================
// buildDashboard (núcleo PURO)
// ============================================================

describe('buildDashboard — catálogo (piezas_disponibles/skus_disponibles/sobre_reservados)', () => {
  it('catalogo_total = count(productos), sin importar disponibilidad', () => {
    const input = baseInput({ productos: [producto({ sku: 'A-1' }), producto({ sku: 'B-2' })] });
    expect(buildDashboard(input).kpis.catalogo_total).toEqual({ valor: 2, delta: null });
  });

  it('disponible por sku = total - resv (reservado = productos.resv, NUNCA Σreservas)', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', resv: 6 })],
      stock: [stockFx('A-1', 'NORTH', 10)],
      reservas: [reservaFx('A-1', 2)], // Σreservas=2, pero resv=6 manda
    });
    const result = buildDashboard(input);
    expect(result.kpis.piezas_disponibles.valor).toBe(4);
    expect(result.kpis.skus_disponibles.valor).toBe(1);
    expect(result.kpis.sobre_reservados.valor).toBe(0);
  });

  // [MVP-CIERRE] F5 · CAMBIO DE DEFINICIÓN, ratificado por producto el
  // 2026-07-31. Antes este test fijaba `piezas_disponibles = 14` (−6 + 20),
  // o sea el NETO. Ahora la cifra de cabecera suma solo POSITIVOS y el neto
  // vive en su propio campo. Las dos aritméticas son correctas; lo que
  // estaba mal era que la tarjeta CONTABA una (positivos, vía
  // `skus_disponibles`) y SUMABA la otra.
  it('sobre_reservado: la cifra de cabecera suma solo POSITIVOS; el neto va aparte', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', resv: 10 }), producto({ sku: 'B-2', resv: 0 })],
      stock: [stockFx('A-1', 'NORTH', 4), stockFx('B-2', 'NORTH', 20)],
    });
    const result = buildDashboard(input);

    // A-1 aporta CERO, no −6: un SKU sobre-reservado no puede compensar su
    // deuda contra la existencia de OTRO SKU — esa resta no ocurre en la bodega.
    expect(result.kpis.piezas_disponibles.valor).toBe(20);
    expect(result.kpis.piezas_sobre_reservadas.valor).toBe(-6);
    expect(result.kpis.piezas_disponibles_neto.valor).toBe(14); // −6 + 20, la vista contable

    // La invariante que amarra las tres y evita que puedan divergir.
    expect(result.kpis.piezas_disponibles.valor + result.kpis.piezas_sobre_reservadas.valor).toBe(
      result.kpis.piezas_disponibles_neto.valor,
    );

    // Mismo denominador que la cifra de cabecera: cuenta y suma hablan ya
    // del mismo universo (solo positivos). Es el arreglo de F5.
    expect(result.kpis.skus_disponibles.valor).toBe(1);
    expect(result.kpis.sobre_reservados.valor).toBe(1);
  });

  it('sin sobre-reservados, cabecera y neto coinciden (y la tarjeta oculta las líneas extra)', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', resv: 0 }), producto({ sku: 'B-2', resv: 0 })],
      stock: [stockFx('A-1', 'NORTH', 5), stockFx('B-2', 'NORTH', 20)],
    });
    const result = buildDashboard(input);
    expect(result.kpis.piezas_disponibles.valor).toBe(25);
    expect(result.kpis.piezas_disponibles_neto.valor).toBe(25);
    expect(result.kpis.piezas_sobre_reservadas.valor).toBe(0);
    expect(result.kpis.sobre_reservados.valor).toBe(0);
  });

  it('disponible === 0 no cuenta ni en disponibles ni en sobre_reservados', () => {
    const input = baseInput({ productos: [producto({ sku: 'A-1', resv: 5 })], stock: [stockFx('A-1', 'NORTH', 5)] });
    const result = buildDashboard(input);
    expect(result.kpis.skus_disponibles.valor).toBe(0);
    expect(result.kpis.sobre_reservados.valor).toBe(0);
  });

  it('sin productos → todos en 0', () => {
    const result = buildDashboard(baseInput());
    expect(result.kpis.catalogo_total.valor).toBe(0);
    expect(result.kpis.piezas_disponibles.valor).toBe(0);
    expect(result.kpis.skus_disponibles.valor).toBe(0);
    expect(result.kpis.sobre_reservados.valor).toBe(0);
  });
});

describe('buildDashboard — sin_v2', () => {
  it('cuenta productos vigentes SIN fila en clasificacion_v2 (una fila vacía SÍ cuenta como "con v2")', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' }), producto({ sku: 'B-2' }), producto({ sku: 'C-3' })],
      v2: [v2Fx('A-1')], // fila existe, todos sus campos null → de todas formas "tiene fila"
    });
    expect(buildDashboard(input).kpis.sin_v2.valor).toBe(2); // B-2, C-3
  });

  it('todas las filas tienen v2 → sin_v2 0', () => {
    const input = baseInput({ productos: [producto({ sku: 'A-1' })], v2: [v2Fx('A-1')] });
    expect(buildDashboard(input).kpis.sin_v2.valor).toBe(0);
  });
});

describe('buildDashboard — sin_tecnologia (INV-B7B · O4, misma aritmética/Map que sin_v2)', () => {
  // LOS DOS TESTS DE ABAJO SE RETIRAN, y se dice por que en vez de borrarlos en
  // silencio: asertaban la ARITMETICA VIEJA de `sin_tecnologia` --sin fila v2 MAS
  // fila con `tecnologia` nula-- y ese universo dejo de existir cuando se acordo
  // que este KPI cuenta LA BANDEJA (`CAT-ITER-1 · O-2b`).
  //
  // El segundo se llamaba «invariante: sin_v2 SIEMPRE esta contenido en
  // sin_tecnologia». Ese invariante YA NO SE SOSTIENE, y no por un defecto:
  // medido ANTES de implementar la decision, se rompe para una parte de los sin fila
  // v2. Mantenerlo verde exigiria que el codigo siguiera contando la capa vieja;
  // mantenerlo rojo seria pedir que se cumpla algo que se decidio dejar de
  // cumplir. UN TEST DE UN INVARIANTE DEROGADO NO SE ARREGLA: SE RETIRA CON SU
  // MOTIVO, y lo que queda vigilando es el trinquete nuevo de mas abajo.

  it.skip('[RETIRADO · O-2b] cuenta sin fila v2 MAS fila v2 con tecnologia nula — aritmetica derogada', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' }), producto({ sku: 'B-2' }), producto({ sku: 'C-3' }), producto({ sku: 'D-4' })],
      v2: [
        v2Fx('A-1', { tecnologia: 'EAS' }), // con tecnología: NO cuenta
        v2Fx('B-2'), // fila v2 existe, tecnologia null (default de v2Fx): SÍ cuenta
        // C-3: sin fila v2 en absoluto (mismo caso que sin_v2): SÍ cuenta
        v2Fx('D-4', { tecnologia: 'BRAND1' }), // NO cuenta
      ],
    });
    expect(buildDashboard(input).kpis.sin_tecnologia.valor).toBe(2); // B-2, C-3
  });

  it.skip('[RETIRADO · O-2b] invariante sin_v2 ⊆ sin_tecnologia — DEROGADO: se rompe para la mayoría de los SKU sin fila v2, y es deliberado', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' }), producto({ sku: 'B-2' }), producto({ sku: 'C-3' })],
      v2: [v2Fx('C-3', { tecnologia: 'EAS' })], // A-1, B-2 sin fila v2; C-3 con fila y tecnología
    });
    const result = buildDashboard(input);
    expect(result.kpis.sin_v2.valor).toBe(2); // A-1, B-2
    expect(result.kpis.sin_tecnologia.valor).toBe(2); // los MISMOS A-1, B-2 — la contención se sostiene
  });

  // [CAT-ITER-1 · O-5] EL TRINQUETE QUE SÍ PUEDE PONERSE ROJO.
  //
  // `dashboard-kpis.tsx` IMPRIME EN PANTALLA que `sin_v2` está contenido en
  // `sin_tecnologia` («Los N sin fila ya están incluidos en los M…»). Hoy es
  // VERDAD, y por construcción: los dos cuentan contra la MISMA capa
  // (`clasificacion_v2`), así que un SKU sin fila v2 cae en los dos. Medido
  // contra el vigente: no quedaba ningún SKU sin fila v2 fuera de sin_tecnologia.
  //
  // La contención NO es una ley: es una consecuencia de que las dos cuenten
  // contra la misma capa. El día que `sin_tecnologia` pase a contar contra la
  // FUENTE (`productos.tecnologia`) —que es la precedencia que D-1 firmó y la
  // decisión que este bloque dejó CONGELADA— se rompe para los SKU sin fila v2
  // que SÍ traen tecnología del archivo: medido: una parte de ellos.
  //
  // Este caso es esa violación, reducida a su mínimo: UN producto, sin fila
  // v2, con tecnología de fuente. La población entera es el caso, así que
  // ningún otro SKU puede compensar el conteo —`UN-CONTEO-QUE-COMPENSA-NO-ES-
  // TESTIGO`—. Hoy pasa en verde; con la base en fuente se pone ROJO, y se
  // comprobó forzándolo (ver el reporte de QA del bloque).
  // [CAT-ITER-1 · O-2b] EL TRINQUETE CAMBIÓ DE SUJETO, Y ES LO QUE LO PROVOCÓ.
  //
  // Nació vigilando que `sin_v2` estuviera contenido en `sin_tecnologia`, que
  // es lo que la pantalla afirmaba. Al acordarse que el KPI cuenta LA
  // BANDEJA, se midió antes de implementarlo: la contención **se rompe para
  // la mayoría de los SKU** sin fila v2. O sea que la decisión no era un cambio de número:
  // obligaba a reescribir la frase, o la pantalla pasaba a mentir.
  //
  // El trinquete hizo su trabajo ANTES del despliegue, no después. Y ahora
  // vigila el invariante nuevo, que es el que puede volver a romperse: que este
  // KPI cuente LA BANDEJA y no una capa. Si alguien lo recablea a
  // `clasificacion_v2` o a `productos.tecnologia`, esto se pone rojo.
  it('TRINQUETE · sin_tecnologia cuenta LA BANDEJA, no una capa — recablearlo a v2 o a la fuente lo pone rojo', () => {
    const input = baseInput({
      // Poblaciones deliberadamente DISTINTAS entre sí para que ninguna
      // coincidencia de cardinal pueda hacer pasar el test por accidente:
      //   · 3 productos sin fila v2 y CON tecnología de fuente
      //     -> una base v2 daría 3; una base fuente daría 0
      //   · la bandeja dice 7
      productos: [
        producto({ sku: 'A-1', tecnologia: 'BRAND1' }),
        producto({ sku: 'B-2', tecnologia: 'EAS' }),
        producto({ sku: 'C-3', tecnologia: 'BRAND2' }),
      ],
      v2: [],
      pendientesSinTecnologia: 7,
    });
    const { kpis } = buildDashboard(input);

    expect(kpis.sin_v2.valor, 'los tres siguen sin fila v2').toBe(3);
    expect(
      kpis.sin_tecnologia.valor,
      'Este KPI debe contar los `sku_sin_tecnologia` ABIERTOS de la bandeja (7), que es el universo ' +
        'acordado. Si vale 3, se recableó a `clasificacion_v2`; si vale 0, a `productos.tecnologia`. ' +
        'Los tres son conjuntos distintos, no tres lecturas del mismo.',
    ).toBe(7);
  });

  it('fila v2 con tecnologia poblada nunca cuenta, aunque los demás campos v2 estén vacíos', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' })],
      v2: [v2Fx('A-1', { tecnologia: 'VERTICAL', marca_v2: null, familia_v2: null, clase_v2: null, descr_v2: null })],
    });
    expect(buildDashboard(input).kpis.sin_tecnologia.valor).toBe(0);
  });

  it('todas las filas v2 con tecnologia poblada → sin_tecnologia 0 aunque sin_v2 también sea 0', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' }), producto({ sku: 'B-2' })],
      v2: [v2Fx('A-1', { tecnologia: 'EAS' }), v2Fx('B-2', { tecnologia: 'BRAND2' })],
    });
    const result = buildDashboard(input);
    expect(result.kpis.sin_v2.valor).toBe(0);
    expect(result.kpis.sin_tecnologia.valor).toBe(0);
  });

  it('sin productos → sin_tecnologia 0', () => {
    expect(buildDashboard(baseInput()).kpis.sin_tecnologia.valor).toBe(0);
  });
});

describe('buildDashboard — alerta descuadre_reservas (aritmética compartida con pendientes.service)', () => {
  it('cuenta productos con resv !== Σreservas', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', resv: 10 }), producto({ sku: 'B-2', resv: 3 })],
      reservas: [reservaFx('A-1', 4), reservaFx('B-2', 3)],
    });
    const alerta = buildDashboard(input).alertas.find((a) => a.tipo === 'descuadre_reservas')!;
    expect(alerta.conteo).toBe(1);
    expect(alerta.href).toBe('/config?tab=pendientes');
  });

  it('sin descuadres → conteo 0', () => {
    const input = baseInput({ productos: [producto({ sku: 'A-1', resv: 3 })], reservas: [reservaFx('A-1', 3)] });
    expect(buildDashboard(input).alertas.find((a) => a.tipo === 'descuadre_reservas')!.conteo).toBe(0);
  });
});

describe('buildDashboard — aduana (piezas_en_camino/retrasados/pipeline)', () => {
  it('piezas_en_camino: Σ piezas (null→0) de embarquesActivos', () => {
    const input = baseInput({
      embarquesActivos: [embarqueActivo({ sku: 'A-1', piezas: 100 }), embarqueActivo({ sku: 'A-2', piezas: null, estatus_id: 3 })],
    });
    expect(buildDashboard(input).kpis.piezas_en_camino.valor).toBe(100);
  });

  it('retrasados: eta<hoy && sin fecha_llegada; eta==hoy NO cuenta (comparación estricta)', () => {
    const input = baseInput({
      hoy: '2026-07-20',
      embarquesActivos: [
        embarqueActivo({ sku: 'A-1', eta: '2026-07-01', fecha_llegada: null }), // retrasado
        embarqueActivo({ sku: 'A-2', eta: '2026-07-01', fecha_llegada: '2026-07-05' }), // llegó
        embarqueActivo({ sku: 'A-3', eta: null, fecha_llegada: null }), // sin eta
        embarqueActivo({ sku: 'A-4', eta: '2026-07-20', fecha_llegada: null }), // eta == hoy
      ],
    });
    expect(buildDashboard(input).kpis.retrasados.valor).toBe(1);
  });

  it('pipeline: SIEMPRE 11 etapas orden 1..11, reordenadas si llegan desordenadas', () => {
    const desordenado = [...ESTATUS_FIXTURE].reverse();
    const result = buildDashboard(baseInput({ estatus: desordenado }));
    expect(result.pipeline).toHaveLength(11);
    expect(result.pipeline.map((e) => e.orden)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.pipeline.every((e) => e.activos === 0 && e.piezas === 0)).toBe(true);
  });

  it('pipeline: activos/piezas agregados por etapa (estatus_id)', () => {
    const input = baseInput({
      embarquesActivos: [
        embarqueActivo({ sku: 'A-1', piezas: 100, estatus_id: 7 }),
        embarqueActivo({ sku: 'A-2', piezas: 50, estatus_id: 7 }),
        embarqueActivo({ sku: 'B-1', piezas: 20, estatus_id: 3 }),
      ],
    });
    const result = buildDashboard(input);
    expect(result.pipeline.find((e) => e.orden === 7)).toMatchObject({ activos: 2, piezas: 150 });
    expect(result.pipeline.find((e) => e.orden === 3)).toMatchObject({ activos: 1, piezas: 20 });
  });
});

describe('buildDashboard — heatmap (marca × almacén, INV-TAXO F4)', () => {
  it('eje_y="marca" (antes "familia"); eje_x/columnas sin cambio', () => {
    const result = buildDashboard(baseInput());
    expect(result.heatmap.eje_y).toBe('marca');
    expect(result.heatmap.eje_x).toBe('almacen');
    expect(result.heatmap.columnas).toEqual(['NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'WEST']);
  });

  it('celdas sparse: solo pares (marca,almacen) con valor > 0', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', marca: 'BRAND1' })],
      stock: [stockFx('A-1', 'NORTH', 10), stockFx('A-1', 'SOUTH', 0)],
    });
    const result = buildDashboard(input);
    expect(result.heatmap.celdas).toEqual([{ fila: 'BRAND1', columna: 'NORTH', valor: 10 }]);
    expect(result.heatmap.max).toBe(10);
    expect(result.heatmap.total_marcas).toBe(1);
  });

  it('marca "" (dato sucio) NUNCA se descarta en silencio: aporta al heatmap bajo la fila "" (patrón P4, ver docs/engineering/failure-patterns.md)', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', marca: '' }), producto({ sku: 'A-2', marca: 'BRAND1' })],
      stock: [stockFx('A-1', 'NORTH', 10), stockFx('A-2', 'SOUTH', 5)],
    });
    const result = buildDashboard(input);
    expect(result.heatmap.filas).toEqual(expect.arrayContaining(['', 'BRAND1']));
    expect(result.heatmap.celdas).toEqual(expect.arrayContaining([{ fila: '', columna: 'NORTH', valor: 10 }]));
    // La conservación de piezas no puede depender de que la marca tenga texto: si
    // se "saltara" la marca vacía en silencio, esta suma bajaría de 15 a 5.
    expect(heatmapPiezasUniverso(input)).toBe(15);
  });

  it('top-10 marcas por Σ piezas; la 11va se descarta — total_marcas cuenta las 11 (leyenda honesta)', () => {
    const productos = Array.from({ length: 11 }, (_, i) => producto({ sku: `SKU-${i}`, marca: `MARCA-${i}` }));
    const stock = productos.map((p, i) => stockFx(p.sku, 'NORTH', (11 - i) * 10)); // MARCA-0 la mayor … MARCA-10 la menor
    const result = buildDashboard(baseInput({ productos, stock }));
    expect(result.heatmap.filas).toHaveLength(10);
    expect(result.heatmap.filas).not.toContain('MARCA-10');
    expect(result.heatmap.filas[0]).toBe('MARCA-0');
    expect(result.heatmap.total_marcas).toBe(11);
  });

  it('marca efectiva vía resolverClasificacion (marca_v2 YA NO gana a fuente — D-1(a), CAT-B1 · Tramo B)', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', marca: 'BRAND1' })],
      stock: [stockFx('A-1', 'NORTH', 5)],
      v2: [v2Fx('A-1', { marca_v2: 'MARCA V2' })],
    });
    expect(buildDashboard(input).heatmap.filas).toEqual(['BRAND1']);
  });

  describe('?tecnologia — filtra SOLO el heatmap (asimetría deliberada, ver cabecera de dashboard.service.ts)', () => {
    // [CAT-B1 · Tramo B] `tecnologia` viaja en la FUENTE (`productos.tecnologia`,
    // migración 0036) desde D-1(a) — antes de este bloque venía de `v2Fx(...)`.
    // `v2` se deja poblado igual, a propósito: sirve para probar que se ignora.
    const productos = [
      producto({ sku: 'A-1', marca: 'BRAND1', resv: 0, tecnologia: 'RFID' }),
      producto({ sku: 'B-1', marca: 'EAS', resv: 0, tecnologia: 'EAS' }),
    ];
    const stock = [stockFx('A-1', 'NORTH', 10), stockFx('B-1', 'SOUTH', 20)];
    const v2 = [v2Fx('A-1', { tecnologia: 'OTRA DE V2' }), v2Fx('B-1', { tecnologia: 'OTRA DE V2' })];

    it('tecnologia ausente → tecnologia_activa null, heatmap sobre el universo completo', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2 }));
      expect(result.heatmap.tecnologia_activa).toBeNull();
      expect([...result.heatmap.filas].sort()).toEqual(['BRAND1', 'EAS']);
    });

    it('tecnologia=RFID → heatmap solo con las marcas de esa tecnología', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2, tecnologia: 'RFID' }));
      expect(result.heatmap.tecnologia_activa).toBe('RFID');
      expect(result.heatmap.filas).toEqual(['BRAND1']);
      expect(result.heatmap.total_marcas).toBe(1);
    });

    it('case-insensitive, igual criterio que ?tecnologia= de /api/inventory', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2, tecnologia: 'rfid' }));
      expect(result.heatmap.filas).toEqual(['BRAND1']);
    });

    it('SIN_TECNOLOGIA filtra marcas cuyos SKUs no tienen tecnología efectiva', () => {
      const conSinTec = [...productos, producto({ sku: 'C-1', marca: 'BRAND6', resv: 0 })];
      const stockConSinTec = [...stock, stockFx('C-1', 'BO', 7)];
      const result = buildDashboard(baseInput({ productos: conSinTec, stock: stockConSinTec, v2, tecnologia: SIN_TECNOLOGIA }));
      expect(result.heatmap.tecnologia_activa).toBe(SIN_TECNOLOGIA);
      expect(result.heatmap.filas).toEqual(['BRAND6']);
    });

    it('el sentinel SIN_TECNOLOGIA NUNCA se cuela en la lista `tecnologias` del selector', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2, tecnologia: SIN_TECNOLOGIA }));
      expect(result.heatmap.tecnologias).not.toContain(SIN_TECNOLOGIA);
    });

    it('tecnologia sin ningún SKU coincidente → heatmap vacío, pero NO afecta KPIs globales', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2, tecnologia: 'NFC' }));
      expect(result.heatmap.filas).toEqual([]);
      expect(result.heatmap.total_marcas).toBe(0);
      expect(result.kpis.catalogo_total.valor).toBe(2); // sigue global: 2 productos, filtro NFC no los toca
    });

    it('`tecnologias` (selector) es SIEMPRE global — no colapsa aunque tecnologia_activa esté fijado', () => {
      const result = buildDashboard(baseInput({ productos, stock, v2, tecnologia: 'RFID' }));
      expect([...result.heatmap.tecnologias].sort()).toEqual(['EAS', 'RFID']);
    });

    it('KPIs/radar/rankings/pipeline/tendencia/alertas son IDÉNTICOS con y sin `?tecnologia` — SOLO el heatmap cambia', () => {
      const embarquesActivos = [
        embarqueActivo({ sku: 'A-1', piezas: 5, estatus_id: 7 }),
        embarqueActivo({ sku: 'B-1', piezas: 7, estatus_id: 3 }),
      ];
      const conFiltro = buildDashboard(baseInput({ productos, stock, v2, embarquesActivos, tecnologia: 'RFID' }));
      const sinFiltro = buildDashboard(baseInput({ productos, stock, v2, embarquesActivos, tecnologia: null }));

      expect(conFiltro.kpis).toEqual(sinFiltro.kpis);
      expect(conFiltro.radar).toEqual(sinFiltro.radar);
      expect(conFiltro.top_sobre_reservados).toEqual(sinFiltro.top_sobre_reservados);
      expect(conFiltro.reservas_por_kam).toEqual(sinFiltro.reservas_por_kam);
      expect(conFiltro.pipeline).toEqual(sinFiltro.pipeline);
      expect(conFiltro.tendencia).toEqual(sinFiltro.tendencia);
      expect(conFiltro.alertas).toEqual(sinFiltro.alertas);
      expect(conFiltro.heatmap).not.toEqual(sinFiltro.heatmap);
    });
  });

  // ============================================================
  // GATE de conservación de piezas (INV-TAXO F4 — regla dura del
  // bloque, ver PRINCIPIO RECTOR y cabecera de dashboard.service.ts).
  // 16 marcas (más de 10 a propósito) — para que el top-10 SÍ recorte filas: la Σ emitida
  // en `celdas` (post-corte) es estrictamente MENOR al total del universo. El
  // total del universo (436834, cifra inventada) solo es verificable
  // vía `heatmapPiezasUniverso` (el DTO público trunca a top-10).
  // ============================================================
  describe('GATE de conservación de piezas', () => {
    const CANTIDAD_TOP10 = [120000, 90000, 70000, 50000, 40000, 30000, 20000, 10000, 5000, 1234];
    const CANTIDAD_RESTO_6 = [100, 100, 100, 100, 100, 100];
    const TODAS_LAS_CANTIDADES = [...CANTIDAD_TOP10, ...CANTIDAD_RESTO_6];
    const TOTAL_ESPERADO = 436834;

    const productosGate = TODAS_LAS_CANTIDADES.map((_, i) => producto({ sku: `G-${i}`, marca: `MARCA-${i}`, resv: 0 }));
    const stockGate = TODAS_LAS_CANTIDADES.map((cantidad, i) => stockFx(`G-${i}`, 'NORTH', cantidad));

    it('el fixture del GATE realmente suma 436834 (sanity check del propio test)', () => {
      expect(stockGate.reduce((s, r) => s + r.cantidad, 0)).toBe(TOTAL_ESPERADO);
    });

    it('GATE — con ?tecnologia ausente: Σ de TODOS los buckets (marca,almacén) ANTES del corte top-10 == 436834 (NO es la Σ de las celdas emitidas, que SÍ recorta)', () => {
      const input = baseInput({ productos: productosGate, stock: stockGate });
      const result = buildDashboard(input);

      // La aserción del GATE: el invariante de conservación, sin recorte.
      expect(heatmapPiezasUniverso(input)).toBe(TOTAL_ESPERADO);

      // Prueba de que el top-10 SÍ recorta (si no, este test no probaría nada):
      // la Σ de las celdas EMITIDAS es la de las 10 marcas mayores, sin las 6 de cola.
      const sumaCeldasEmitidas = result.heatmap.celdas.reduce((s, c) => s + c.valor, 0);
      const sumaTop10 = CANTIDAD_TOP10.reduce((s, v) => s + v, 0);
      expect(sumaCeldasEmitidas).toBe(sumaTop10);
      expect(sumaCeldasEmitidas).toBeLessThan(TOTAL_ESPERADO);

      expect(result.heatmap.filas).toHaveLength(10);
      expect(result.heatmap.total_marcas).toBe(16);
    });

    /**
     * Mutante obligatorio (patrón P6, ver docs/engineering/failure-patterns.md): la
     * demostración roja/verde de que este test SÍ caza una regresión se
     * hizo manualmente (reintroduciendo la explosión por familia en
     * `agregarPorMarcaAlmacen` y confirmando que el test de arriba se
     * pone rojo) — ver la entrega del bloque INV-TAXO para las 2
     * corridas (roja y verde) pegadas literalmente. No se deja un
     * mutante permanente en el árbol: mutar y revertir en el mismo
     * archivo dejaría el código roto a medio commit.
     */
    it('el GATE es sensible a la aritmética de agregación (no es un test que siempre pasa)', () => {
      // Contraprueba barata dentro de la propia suite: si "olvidáramos" una
      // marca del universo (equivalente a un skip silencioso), el invariante
      // deja de sostenerse — confirma que `heatmapPiezasUniverso` depende
      // realmente de las filas de stock recibidas, no de un valor fijo.
      const input = baseInput({ productos: productosGate.slice(0, -1), stock: stockGate.slice(0, -1) });
      expect(heatmapPiezasUniverso(input)).toBe(TOTAL_ESPERADO - 100);
      expect(heatmapPiezasUniverso(input)).not.toBe(TOTAL_ESPERADO);
    });
  });
});

describe('buildDashboard — radar (top-3 marcas EFECTIVAS)', () => {
  it('top-3 por Σ total de stock; ejes disponible/reservado agregados', () => {
    const productos = [
      producto({ sku: 'A-1', marca: 'BRAND1', resv: 5 }),
      producto({ sku: 'A-2', marca: 'BRAND1', resv: 0 }),
      producto({ sku: 'B-1', marca: 'EAS', resv: 0 }),
      producto({ sku: 'C-1', marca: 'BRAND6', resv: 0 }),
      producto({ sku: 'D-1', marca: 'SERIES5', resv: 0 }),
    ];
    const stock = [
      stockFx('A-1', 'NORTH', 20),
      stockFx('A-2', 'NORTH', 10),
      stockFx('B-1', 'NORTH', 15),
      stockFx('C-1', 'NORTH', 12),
      stockFx('D-1', 'NORTH', 1),
    ];
    const result = buildDashboard(baseInput({ productos, stock }));
    expect(result.radar.series.map((r) => r.marca)).toEqual(['BRAND1', 'EAS', 'BRAND6']);
    const brand1 = result.radar.series.find((r) => r.marca === 'BRAND1')!;
    expect(brand1.ejes.disponible).toBe(25); // (20-5)+(10-0)
    expect(brand1.ejes.reservado).toBe(5);
  });

  it('en_riesgo = Σ|disponible| donde disponible<0, por marca', () => {
    const productos = [producto({ sku: 'A-1', marca: 'BRAND1', resv: 10 }), producto({ sku: 'A-2', marca: 'BRAND1', resv: 0 })];
    const stock = [stockFx('A-1', 'NORTH', 4), stockFx('A-2', 'NORTH', 20)];
    const result = buildDashboard(baseInput({ productos, stock }));
    expect(result.radar.series[0].ejes.en_riesgo).toBe(6); // |4-10|; A-2 no aporta (disponible 20 > 0)
  });

  it('en_aduana: Σ piezas activas de embarques cuyo sku pertenece a esa marca', () => {
    const productos = [producto({ sku: 'A-1', marca: 'BRAND1' })];
    const stock = [stockFx('A-1', 'NORTH', 10)];
    const embarquesActivos = [
      embarqueActivo({ sku: 'A-1', piezas: 50, estatus_id: 7 }),
      embarqueActivo({ sku: 'A-1', piezas: 25, estatus_id: 3 }),
    ];
    const result = buildDashboard(baseInput({ productos, stock, embarquesActivos }));
    expect(result.radar.series[0].ejes.en_aduana).toBe(75);
  });

  it('embarque de un sku sin producto vigente no lanza y no se atribuye a ninguna marca', () => {
    const productos = [producto({ sku: 'A-1', marca: 'BRAND1' })];
    const embarquesActivos = [embarqueActivo({ sku: 'HUERFANO', piezas: 50 })];
    expect(() => buildDashboard(baseInput({ productos, embarquesActivos }))).not.toThrow();
  });

  it('menos de 3 marcas → radar con menos de 3 series (sin rellenar con vacíos)', () => {
    const result = buildDashboard(baseInput({ productos: [producto({ sku: 'A-1', marca: 'BRAND1' })] }));
    expect(result.radar.series).toHaveLength(1);
  });

  it('sin productos → radar []', () => {
    expect(buildDashboard(baseInput()).radar.series).toEqual([]);
  });

  // El radar recorta a 3 y HASTA AHORA NO DECIA A CUANTAS. El heatmap vecino si
  // confiesa el suyo (`total_marcas`), y por eso puede pintar «Top 10 de N marcas»;
  // el radar no podia, asi que el corte era MUDO: tres marcas dibujadas y ninguna
  // pista de si habia 3 o 300 detras.
  //
  // El denominador viaja DENTRO del objeto —`{ series, total_marcas }`— y no como
  // campo hermano a proposito: pegado al dato no se puede leer `series` sin tenerlo
  // delante. Un campo hermano se ignora para siempre, que es exactamente como el
  // radar se quedo mudo la primera vez.
  it('radar.total_marcas es el universo ANTES del recorte, no el numero de series', () => {
    const marcas = ['BRAND1', 'EAS', 'BRAND6', 'SERIES5', 'NACIONAL'];
    const productos = marcas.map((marca, i) => producto({ sku: `M-${i}`, marca, resv: 0 }));
    const stock = marcas.map((_, i) => stockFx(`M-${i}`, 'NORTH', 50 - i));

    const result = buildDashboard(baseInput({ productos, stock }));

    expect(result.radar.series).toHaveLength(3);
    expect(result.radar.total_marcas).toBe(5);
    // El control positivo del propio campo: capturarlo DESPUES del `.slice(0, 3)`
    // daria 3, y 3 === series.length es indistinguible de «no hay corte». Por eso la
    // asercion es contra 5 y ademas contra la desigualdad.
    expect(result.radar.total_marcas).toBeGreaterThan(result.radar.series.length);
  });

  it('sin corte, total_marcas coincide con las series — y eso es lo que permite NO anunciar nada', () => {
    const result = buildDashboard(baseInput({ productos: [producto({ sku: 'A-1', marca: 'BRAND1' })] }));
    expect(result.radar.series).toHaveLength(1);
    expect(result.radar.total_marcas).toBe(1);
  });
});

describe('buildDashboard — top_sobre_reservados', () => {
  it('solo disponible<0, orden ASC (más negativo primero), tope 10', () => {
    const productos = Array.from({ length: 12 }, (_, i) => producto({ sku: `SKU-${i}`, resv: 100 + i }));
    const stock = productos.map((p) => stockFx(p.sku, 'NORTH', 10));
    const result = buildDashboard(baseInput({ productos, stock }));
    expect(result.top_sobre_reservados).toHaveLength(10);
    expect(result.top_sobre_reservados[0]).toMatchObject({ sku: 'SKU-11', disponible: -101 });
  });

  it('shape exacto {sku, descripcion, marca, disponible, reservado, total}', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1', marca: 'BRAND1', resv: 10, descr_origen: 'Candado' })],
      stock: [stockFx('A-1', 'NORTH', 4)],
    });
    expect(buildDashboard(input).top_sobre_reservados).toEqual([
      { sku: 'A-1', descripcion: 'Candado', marca: 'BRAND1', disponible: -6, reservado: 10, total: 4 },
    ]);
  });

  it('sin sobre-reservados → []', () => {
    const input = baseInput({ productos: [producto({ sku: 'A-1', resv: 0 })], stock: [stockFx('A-1', 'NORTH', 5)] });
    expect(buildDashboard(input).top_sobre_reservados).toEqual([]);
  });
});

describe('buildDashboard — reservas_por_kam', () => {
  it('agrupa por kam y ordena por piezas DESC', () => {
    const reservas = [reservaFx('A-1', 10, 'LUCAS'), reservaFx('A-2', 30, 'LAURA'), reservaFx('A-3', 5, 'LUCAS')];
    expect(buildDashboard(baseInput({ reservas })).reservas_por_kam.items).toEqual([
      { kam: 'LAURA', piezas: 30 },
      { kam: 'LUCAS', piezas: 15 },
    ]);
  });

  it('bucket kam:null SIEMPRE presente si hay reservas sin KAM, aunque quede fuera del top-6 por valor', () => {
    const reservas = [
      ...Array.from({ length: 6 }, (_, i) => reservaFx(`SKU-${i}`, 100 - i, `KAM-${i}`)),
      reservaFx('SIN-KAM', 1, null),
    ];
    const result = buildDashboard(baseInput({ reservas }));
    expect(result.reservas_por_kam.items).toHaveLength(7);
    expect(result.reservas_por_kam.items.find((r) => r.kam === null)).toEqual({ kam: null, piezas: 1 });
  });

  it('sin reservas sin KAM → no se agrega un bucket null artificial', () => {
    const result = buildDashboard(baseInput({ reservas: [reservaFx('A-1', 10, 'LUCAS')] }));
    expect(result.reservas_por_kam.items.some((r) => r.kam === null)).toBe(false);
  });

  it('top-6 exacto cuando hay más de 6 kams (sin null)', () => {
    const reservas = Array.from({ length: 8 }, (_, i) => reservaFx(`SKU-${i}`, 100 - i, `KAM-${i}`));
    expect(buildDashboard(baseInput({ reservas })).reservas_por_kam.items).toHaveLength(6);
  });

  it('sin reservas → []', () => {
    expect(buildDashboard(baseInput()).reservas_por_kam.items).toEqual([]);
  });

  // En un vigente puede haber más KAM que el `slice(0, 6)`, que
  // cortaba a uno con muy pocas piezas. El chart no puede decir «6 de N»
  // porque el DATO no viaja — y la leccion ya esta escrita DOS VECES en este mismo
  // archivo: `buildHeatmap` emite `total_marcas` y `buildRadar` tambien, con el
  // comentario «ANTES del recorte: top3 ya perdio el universo» al lado. Este era el
  // tercer recorte y el unico mudo.
  it('reservas_por_kam declara su UNIVERSO: cuantos KAM habia y cuantas piezas, ANTES del recorte', () => {
    const reservas = Array.from({ length: 8 }, (_, i) => reservaFx(`SKU-${i}`, 100 - i, `KAM-${i}`));
    const r = buildDashboard(baseInput({ reservas })).reservas_por_kam;

    expect(r.items).toHaveLength(6);
    expect(r.total_kams).toBe(8);
    // 100+99+…+93 = 772. Los 6 pintados suman 100+99+98+97+96+95 = 585.
    expect(r.total_piezas).toBe(772);
    expect(r.items.reduce((a, i) => a + i.piezas, 0)).toBe(585);
  });

  // CONTROL POSITIVO del punto de captura: tomar el universo DESPUES del recorte
  // daria 6 y 585, y «6 de 6» es indistinguible de «no hay recorte» — el resultado
  // correcto por la razon equivocada (P25). Por eso se afirma la DESIGUALDAD.
  it('CONTROL POSITIVO · el universo es mayor que lo pintado cuando hay recorte, e IGUAL cuando no lo hay', () => {
    const conRecorte = Array.from({ length: 8 }, (_, i) => reservaFx(`SKU-${i}`, 100 - i, `KAM-${i}`));
    const r1 = buildDashboard(baseInput({ reservas: conRecorte })).reservas_por_kam;
    expect(r1.total_kams).toBeGreaterThan(r1.items.length);
    expect(r1.total_piezas).toBeGreaterThan(r1.items.reduce((a, i) => a + i.piezas, 0));

    const sinRecorte = [reservaFx('A-1', 10, 'LUCAS'), reservaFx('A-2', 30, 'LAURA')];
    const r2 = buildDashboard(baseInput({ reservas: sinRecorte })).reservas_por_kam;
    expect(r2.total_kams).toBe(r2.items.length);
    expect(r2.total_piezas).toBe(r2.items.reduce((a, i) => a + i.piezas, 0));
  });

  // El bucket nulo cuenta como un KAM del universo: existe, tiene piezas y el chart
  // tiene que poder nombrarlo. Contarlo aparte seria inventar una tercera categoria.
  it('el bucket nulo cuenta en el universo, y las piezas recortadas nunca se pierden de la suma', () => {
    const reservas = [
      ...Array.from({ length: 7 }, (_, i) => reservaFx(`SKU-${i}`, 100 - i, `KAM-${i}`)),
      reservaFx('SIN-KAM', 1, null),
    ];
    const r = buildDashboard(baseInput({ reservas })).reservas_por_kam;

    expect(r.total_kams).toBe(8); // 7 con nombre + el nulo
    expect(r.total_piezas).toBe(100 + 99 + 98 + 97 + 96 + 95 + 94 + 1);
    expect(r.items.some((i) => i.kam === null)).toBe(true); // reinyectado pese a ser el ultimo
  });

  it('sin reservas → universo en cero, no undefined', () => {
    const r = buildDashboard(baseInput()).reservas_por_kam;
    expect(r.total_kams).toBe(0);
    expect(r.total_piezas).toBe(0);
  });
});

describe('buildDashboard — alertas (orden fijo + hrefs)', () => {
  it('orden y hrefs exactos', () => {
    const result = buildDashboard(baseInput({ pendientesAbiertos: 3 }));
    expect(result.alertas.map((a) => a.tipo)).toEqual([
      'sobre_reservado',
      'retrasado',
      'sin_v2',
      'descuadre_reservas',
      'pendientes',
      'familia_movida',
    ]);
    expect(result.alertas.map((a) => a.href)).toEqual([
      '/catalogo?badge=sobre_reservado',
      '/embarques?retrasado=1',
      '/catalogo?sinV2=1',
      '/config?tab=pendientes',
      '/config?tab=pendientes',
      '/catalogo?divergencia=1',
    ]);
    expect(result.alertas.find((a) => a.tipo === 'pendientes')!.conteo).toBe(3);
  });
});

describe('buildDashboard — deltas "solo honestos"', () => {
  it('TODOS los KPIs salvo piezas_en_camino viajan delta:null siempre', () => {
    const input = baseInput({
      productos: [producto({ sku: 'A-1' })],
      periodos: { actual: '2026-07', anterior: '2026-04' },
      piezasEnCaminoBase: 100,
      embarquesActivos: [embarqueActivo({ piezas: 150 })],
      pendientesAbiertos: 5,
    });
    const result = buildDashboard(input);
    expect(result.kpis.catalogo_total.delta).toBeNull();
    expect(result.kpis.piezas_disponibles.delta).toBeNull();
    expect(result.kpis.skus_disponibles.delta).toBeNull();
    expect(result.kpis.sobre_reservados.delta).toBeNull();
    expect(result.kpis.retrasados.delta).toBeNull();
    expect(result.kpis.sin_v2.delta).toBeNull();
    expect(result.kpis.sin_tecnologia.delta).toBeNull();
    expect(result.kpis.pendientes.delta).toBeNull();
  });

  it('piezas_en_camino: delta real cuando hay baseline Y periodo anterior', () => {
    const input = baseInput({
      periodos: { actual: '2026-07', anterior: '2026-04' },
      piezasEnCaminoBase: 100,
      embarquesActivos: [embarqueActivo({ piezas: 150 })],
    });
    expect(buildDashboard(input).kpis.piezas_en_camino).toEqual({
      valor: 150,
      delta: { valor: 50, pct: 50, periodo_base: '2026-04', direccion: 'sube' },
    });
  });

  it('direccion "baja" cuando el valor cae', () => {
    const input = baseInput({
      periodos: { actual: '2026-07', anterior: '2026-04' },
      piezasEnCaminoBase: 100,
      embarquesActivos: [embarqueActivo({ piezas: 40 })],
    });
    expect(buildDashboard(input).kpis.piezas_en_camino.delta).toEqual({
      valor: -60,
      pct: -60,
      periodo_base: '2026-04',
      direccion: 'baja',
    });
  });

  it('direccion "igual" cuando no cambia', () => {
    const input = baseInput({
      periodos: { actual: '2026-07', anterior: '2026-04' },
      piezasEnCaminoBase: 100,
      embarquesActivos: [embarqueActivo({ piezas: 100 })],
    });
    expect(buildDashboard(input).kpis.piezas_en_camino.delta).toEqual({
      valor: 0,
      pct: 0,
      periodo_base: '2026-04',
      direccion: 'igual',
    });
  });

  it('pct null cuando el baseline es 0 (nunca se fabrica un "infinito")', () => {
    const input = baseInput({
      periodos: { actual: '2026-07', anterior: '2026-04' },
      piezasEnCaminoBase: 0,
      embarquesActivos: [embarqueActivo({ piezas: 40 })],
    });
    const delta = buildDashboard(input).kpis.piezas_en_camino.delta!;
    expect(delta.pct).toBeNull();
    expect(delta.valor).toBe(40);
  });

  it('sin baseline (piezasEnCaminoBase null) → delta null aunque haya periodo anterior', () => {
    const input = baseInput({ periodos: { actual: '2026-07', anterior: '2026-04' }, piezasEnCaminoBase: null });
    expect(buildDashboard(input).kpis.piezas_en_camino.delta).toBeNull();
  });

  it('sin periodo anterior → delta null aunque hubiera baseline', () => {
    const input = baseInput({ periodos: { actual: '2026-07', anterior: null }, piezasEnCaminoBase: 100 });
    expect(buildDashboard(input).kpis.piezas_en_camino.delta).toBeNull();
  });
});

describe('buildDashboard — snapshot/periodos/tendencia (passthrough)', () => {
  it('snapshot null cuando no hay vigente de ninguna fuente', () => {
    expect(buildDashboard(baseInput()).snapshot).toEqual({ stock: null, aduana: null });
  });

  it('snapshot vigente:true cuando hay snapshot', () => {
    const snap: SnapshotVigente = { id: 's-1', created_at: '2026-07-01T00:00:00.000Z', filas: 100, archivo: 'x.xlsx' };
    const result = buildDashboard(baseInput({ vigenteStockSnap: snap, vigenteAduanaSnap: snap }));
    expect(result.snapshot.stock).toEqual({ ...snap, vigente: true });
    expect(result.snapshot.aduana).toEqual({ ...snap, vigente: true });
  });

  it('periodos y tendencia viajan tal cual (ya resueltos por el orquestador)', () => {
    const tendencia = [
      { periodo: '2026-04', piezas: 100, cortes: 1 },
      { periodo: '2026-07', piezas: 200, cortes: 1 },
    ];
    const result = buildDashboard(baseInput({ periodos: { actual: '2026-07', anterior: '2026-04' }, tendencia }));
    expect(result.periodos).toEqual({ actual: '2026-07', anterior: '2026-04' });
    expect(result.tendencia).toEqual(tendencia);
  });
});

// ============================================================
// vigentePorPeriodo / periodosOrdenados (PUROS)
// ============================================================

describe('vigentePorPeriodo', () => {
  it('agrupa por periodo: un snapshot resuelto por grupo', () => {
    const rows: SnapshotPeriodoRow[] = [
      { id: 's-abril', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 's-julio-1', created_at: '2026-07-01T00:00:00.000Z', periodo: '2026-07', filas: 200, archivo: null },
    ];
    const result = vigentePorPeriodo(rows);
    expect(result.size).toBe(2);
    expect(result.get('2026-04')?.id).toBe('s-abril');
    expect(result.get('2026-07')?.id).toBe('s-julio-1');
  });

  it('snapshots 5-9 TODOS periodo 2026-07: se agrupan en UNA sola entrada (la de mayor created_at) — NO 6 grupos', () => {
    const rows: SnapshotPeriodoRow[] = [
      { id: 'snap-4', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 'snap-5', created_at: '2026-07-01T10:00:00.000Z', periodo: '2026-07', filas: 200, archivo: null },
      { id: 'snap-6', created_at: '2026-07-01T11:00:00.000Z', periodo: '2026-07', filas: 205, archivo: null },
      { id: 'snap-7', created_at: '2026-07-02T09:00:00.000Z', periodo: '2026-07', filas: 210, archivo: null },
      { id: 'snap-8', created_at: '2026-07-02T09:30:00.000Z', periodo: '2026-07', filas: 220, archivo: null },
      { id: 'snap-9', created_at: '2026-07-02T10:00:00.000Z', periodo: '2026-07', filas: 2400, archivo: 'julio.xlsx' },
    ];
    const result = vigentePorPeriodo(rows);
    expect(result.size).toBe(2);
    expect(result.get('2026-07')?.id).toBe('snap-9');
    expect(result.get('2026-04')?.id).toBe('snap-4');
  });

  it('empate en created_at → desempate por id ASC (mayor id gana)', () => {
    const rows: SnapshotPeriodoRow[] = [
      { id: 'snap-a', created_at: '2026-07-01T00:00:00.000Z', periodo: '2026-07', filas: 1, archivo: null },
      { id: 'snap-b', created_at: '2026-07-01T00:00:00.000Z', periodo: '2026-07', filas: 2, archivo: null },
    ];
    expect(vigentePorPeriodo(rows).get('2026-07')?.id).toBe('snap-b');
  });

  it('el resultado no depende del orden de entrada', () => {
    const a: SnapshotPeriodoRow = { id: 'snap-a', created_at: '2026-07-01T00:00:00.000Z', periodo: '2026-07', filas: 1, archivo: null };
    const b: SnapshotPeriodoRow = { id: 'snap-b', created_at: '2026-07-05T00:00:00.000Z', periodo: '2026-07', filas: 2, archivo: null };
    expect(vigentePorPeriodo([a, b]).get('2026-07')?.id).toBe('snap-b');
    expect(vigentePorPeriodo([b, a]).get('2026-07')?.id).toBe('snap-b');
  });

  it('sin snapshots → Map vacío', () => {
    expect(vigentePorPeriodo([]).size).toBe(0);
  });
});

describe('periodosOrdenados', () => {
  it('orden ASC por comparación de string simple (YYYY-MM ordena cronológicamente)', () => {
    const map = new Map<string, SnapshotPeriodoRow>([
      ['2026-07', { id: 'x', created_at: '', periodo: '2026-07', filas: null, archivo: null }],
      ['2026-04', { id: 'y', created_at: '', periodo: '2026-04', filas: null, archivo: null }],
    ]);
    expect(periodosOrdenados(map)).toEqual(['2026-04', '2026-07']);
  });

  it('Map vacío → []', () => {
    expect(periodosOrdenados(new Map())).toEqual([]);
  });
});

// ============================================================
// cortesPorPeriodo (PURO) — [DASH-D · D-2]
// ============================================================

describe('cortesPorPeriodo', () => {
  it('cuenta los snapshots que cada periodo colapsó — el tamaño de grupo que `vigentePorPeriodo` descarta', () => {
    // Mismo fixture que el caso «snapshots 5-9 TODOS periodo 2026-07» de arriba:
    // ahí se comprueba que julio colapsa a UNA entrada. Lo que se perdía es que
    // esa entrada resume CINCO cortes y la de abril resume UNO — y en la gráfica
    // los dos puntos se dibujan idénticos.
    const rows: SnapshotPeriodoRow[] = [
      { id: 'snap-4', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 'snap-5', created_at: '2026-07-01T10:00:00.000Z', periodo: '2026-07', filas: 200, archivo: null },
      { id: 'snap-6', created_at: '2026-07-01T11:00:00.000Z', periodo: '2026-07', filas: 205, archivo: null },
      { id: 'snap-7', created_at: '2026-07-02T09:00:00.000Z', periodo: '2026-07', filas: 210, archivo: null },
      { id: 'snap-8', created_at: '2026-07-02T09:30:00.000Z', periodo: '2026-07', filas: 220, archivo: null },
      { id: 'snap-9', created_at: '2026-07-02T10:00:00.000Z', periodo: '2026-07', filas: 2400, archivo: 'julio.xlsx' },
    ];

    const result = cortesPorPeriodo(rows);

    expect(result.get('2026-07')).toBe(5);
    expect(result.get('2026-04')).toBe(1);
  });

  it('sin snapshots devuelve un mapa vacío, no un cero fabricado', () => {
    expect(cortesPorPeriodo([]).size).toBe(0);
  });
});

// ============================================================
// agruparPipeline (PURO) — [DASH-E · E-1]
// ============================================================

describe('agruparPipeline', () => {
  const ETAPAS: DashboardPipelineEtapa[] = [
    { orden: 1, nombre: 'Producto Solicitado', activos: 9, piezas: 52 },
    { orden: 2, nombre: 'En Preparación', activos: 58, piezas: 10874 },
    { orden: 3, nombre: 'En Recolección', activos: 0, piezas: 0 },
    { orden: 4, nombre: 'En Almacén FW', activos: 0, piezas: 0 },
    { orden: 5, nombre: 'En Tránsito Aéreo', activos: 0, piezas: 0 },
    { orden: 6, nombre: 'En Tránsito Marítimo', activos: 0, piezas: 0 },
    { orden: 7, nombre: 'En Aduana', activos: 0, piezas: 0 },
    { orden: 8, nombre: 'En Tránsito Terrestre', activos: 0, piezas: 0 },
    { orden: 9, nombre: 'En Almacén Fiscal', activos: 0, piezas: 0 },
    { orden: 10, nombre: 'En Almacén North', activos: 0, piezas: 0 },
    { orden: 11, nombre: 'Producto Disponible', activos: 392, piezas: 148207 },
  ];

  it('agrupa las 11 etapas del catálogo en los 6 grupos que dictó Embarques', () => {
    const grupos = agruparPipeline(ETAPAS);

    expect(grupos.map((g) => g.clave)).toEqual(['importacion', 'transito_intl', 'aduana', 'transito_terrestre', 'almacenes', 'disponible']);
    expect(grupos.map((g) => g.ordenes)).toEqual([[1, 2, 3, 4], [5, 6], [7], [8], [9, 10], [11]]);
  });

  it('la FORMA alterna estancia/traslado — es la gramática, no decoración', () => {
    // Rectángulo = ESTANCIA (el producto está en un sitio) · elipse = TRASLADO (se mueve).
    // De ahí sale que los rects se estiren y las elipses queden compactas.
    expect(agruparPipeline(ETAPAS).map((g) => g.forma)).toEqual([
      'estancia', 'traslado', 'estancia', 'traslado', 'estancia', 'traslado',
    ]);
  });

  it('suma `activos` y `piezas` por grupo', () => {
    const grupos = agruparPipeline(ETAPAS);

    expect(grupos[0]).toMatchObject({ clave: 'importacion', activos: 67, piezas: 10926 });
    expect(grupos[5]).toMatchObject({ clave: 'disponible', activos: 392, piezas: 148207 });
    expect(grupos[1]).toMatchObject({ clave: 'transito_intl', activos: 0, piezas: 0 });
  });

  it('LA INVARIANTE: la Σ de los grupos es la Σ del pipeline completo — ninguna etapa se pierde', () => {
    const grupos = agruparPipeline(ETAPAS);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

    expect(sum(grupos.map((g) => g.activos))).toBe(sum(ETAPAS.map((e) => e.activos)));
    expect(sum(grupos.map((g) => g.piezas))).toBe(sum(ETAPAS.map((e) => e.piezas)));
  });

  it('CONTROL POSITIVO · una etapa 12 que el mapa no conoce aparece NOMBRADA, no desaparece', () => {
    // El día que el catálogo crezca, una etapa sin grupo no puede evaporarse del riel: se reinyecta
    // etiquetada, igual que el bucket `kam:null` de reservas-KAM. «Cero visible, no fabricado»
    // aplicado al agrupamiento — y la Σ lo sigue cumpliendo, que es lo que lo hace comprobable.
    const doce = [...ETAPAS, { orden: 12, nombre: 'Etapa Nueva', activos: 7, piezas: 70 }];

    const grupos = agruparPipeline(doce);

    expect(grupos).toHaveLength(7);
    expect(grupos[6]).toMatchObject({ clave: 'sin_grupo', ordenes: [12], activos: 7, piezas: 70 });
    expect(grupos.reduce((a, g) => a + g.piezas, 0)).toBe(159203);
  });

  it('`sin_grupo` NO se fabrica cuando todas las etapas están cubiertas', () => {
    expect(agruparPipeline(ETAPAS).some((g) => g.clave === 'sin_grupo')).toBe(false);
  });
});

// ============================================================
// getDashboard / fetchDescuadresVigentes — orquestación
// ============================================================

type Resp = { data: unknown; error: { message: string; code?: string } | null };
interface CallInfo {
  table: string;
  /**
   * [VERT-B2] La CADENA del `select`, capturada.
   *
   * Hasta este bloque el fake db la TIRABA (`select: () => chain(table)`), así
   * que ningún test del dashboard podía cotejarla — y eso no era «falta una
   * aserción», era **falta el instrumento**: `productosCall?.select` salía
   * `undefined` y cualquier `toBe(cadena)` habría fallado por la razón
   * equivocada (P23, gate rojo con aserción mala) en vez de por el defecto.
   *
   * Hace falta porque `embedExcluida` es FALLA-ABIERTA a propósito (ver su
   * doc-comment): si a este `select` se le cae `excluida_del_catalogo`, el
   * embed no trae la columna, la función devuelve `false` para TODAS las filas
   * y el dashboard deja de excluir EN SILENCIO — vuelve a contar las marcas
   * excluidas dentro del catálogo, y con la suite en verde.
   */
  select: string;
  eq: [string, unknown][];
  in: [string, unknown[]] | null;
}

interface FakeChain {
  eq(col: string, val: unknown): FakeChain;
  in(col: string, vals: unknown[]): FakeChain;
  range(from: number, to: number): Promise<Resp>;
  then<T1 = Resp, T2 = never>(
    onfulfilled?: ((value: Resp) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2>;
}

function eqVal(info: CallInfo, col: string): unknown {
  return info.eq.find(([c]) => c === col)?.[1];
}

function makeFakeDb(
  tableHandler: (info: CallInfo) => Resp,
  rpcHandler: (name: string, args: unknown) => Resp = () => ({ data: null, error: null }),
) {
  const calls: CallInfo[] = [];

  function chain(table: string, select: string): FakeChain {
    const eqCalls: [string, unknown][] = [];
    let inCall: [string, unknown[]] | null = null;
    const resolve = (): Resp => {
      const info: CallInfo = { table, select, eq: [...eqCalls], in: inCall };
      calls.push(info);
      return tableHandler(info);
    };
    const node: FakeChain = {
      eq(col, val) {
        eqCalls.push([col, val]);
        return node;
      },
      in(col, vals) {
        inCall = [col, vals];
        return node;
      },
      range() {
        return Promise.resolve(resolve());
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(resolve()).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const db = {
    from(table: string) {
      return { select: (sel: string) => chain(table, sel) };
    },
    rpc(name: string, args?: unknown) {
      return Promise.resolve(rpcHandler(name, args));
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

const RPC_PENDIENTES_OK = () => ({ data: { abiertos: 0, por_tipo: {} }, error: null });

describe('getDashboard', () => {
  beforeEach(() => {
    conVigenteStockMock.mockReset();
    resolveVigenteMock.mockReset();
  });

  it('sin vigente stock ni aduana, sin snapshots de ninguna fuente → dashboard "vacío digno", no lanza', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    resolveVigenteMock.mockResolvedValueOnce(null);

    const { db, calls } = makeFakeDb((info) => {
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);

    expect(result.snapshot).toEqual({ stock: null, aduana: null });
    expect(result.periodos).toEqual({ actual: null, anterior: null });
    expect(result.kpis.catalogo_total.valor).toBe(0);
    expect(result.pipeline).toHaveLength(11);
    expect(result.tendencia).toEqual([]);
    expect(conVigenteStockMock).toHaveBeenCalledTimes(1);
    expect(resolveVigenteMock).toHaveBeenCalledWith(db, 'aduana');
    // sin periodos resueltos → nunca se dispara el fetch agregado de stock_por_almacen por periodo
    expect(calls.some((c) => c.table === 'stock_por_almacen' && c.in)).toBe(false);
  });

  it('vigente por periodo: agrupa snapshots 5-9 (todos 2026-07) y NO compara julio contra julio', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    resolveVigenteMock.mockResolvedValueOnce(null);

    const stockSnapshots = [
      { id: 'snap-4', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 'snap-5', created_at: '2026-07-01T10:00:00.000Z', periodo: '2026-07', filas: 200, archivo: null },
      { id: 'snap-6', created_at: '2026-07-01T11:00:00.000Z', periodo: '2026-07', filas: 205, archivo: null },
      { id: 'snap-7', created_at: '2026-07-02T09:00:00.000Z', periodo: '2026-07', filas: 210, archivo: null },
      { id: 'snap-8', created_at: '2026-07-02T09:30:00.000Z', periodo: '2026-07', filas: 220, archivo: null },
      { id: 'snap-9', created_at: '2026-07-02T10:00:00.000Z', periodo: '2026-07', filas: 2400, archivo: 'julio.xlsx' },
    ];
    const stockPorSnapshot: Record<string, number> = { 'snap-4': 900, 'snap-9': 2400 };

    const { db, calls } = makeFakeDb((info) => {
      if (info.table === 'snapshots') {
        const fuente = eqVal(info, 'fuente');
        return { data: fuente === 'stock' ? stockSnapshots : [], error: null };
      }
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      if (info.table === 'stock_por_almacen' && info.in) {
        const ids = info.in[1] as string[];
        const rows = ids.flatMap((id) => (stockPorSnapshot[id] !== undefined ? [{ snapshot_id: id, cantidad: stockPorSnapshot[id] }] : []));
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);

    expect(result.periodos).toEqual({ actual: '2026-07', anterior: '2026-04' });
    // [DASH-D · D-2] `cortes` es la mitad que faltaba de esta misma prueba: el
    // agrupamiento colapsa los CINCO snapshots de julio a un punto (lo que ya
    // aseveraba), y ahora el punto DICE que resume cinco mientras el de abril
    // dice que resume uno. Sin eso, los dos se dibujaban idénticos.
    expect(result.tendencia).toEqual([
      { periodo: '2026-04', piezas: 900, cortes: 1 },
      { periodo: '2026-07', piezas: 2400, cortes: 5 },
    ]);

    const stockPorAlmacenCall = calls.find((c) => c.table === 'stock_por_almacen' && c.in);
    expect(stockPorAlmacenCall?.in?.[1]).toHaveLength(2); // 2 periodos distintos → 2 ids resueltos, NO 6
  });

  it('piezas_en_camino: delta real usando el snapshot de aduana del periodo anterior DISTINTO', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    const vigenteAduana: SnapshotVigente = { id: 'aduana-julio', created_at: '2026-07-10T00:00:00.000Z', filas: 300, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(vigenteAduana);

    const stockSnaps = [
      { id: 'snap-4', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 'snap-9', created_at: '2026-07-02T10:00:00.000Z', periodo: '2026-07', filas: 2400, archivo: null },
    ];
    const aduanaSnaps = [
      { id: 'aduana-abril', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 50, archivo: null },
      { id: 'aduana-julio', created_at: '2026-07-10T00:00:00.000Z', periodo: '2026-07', filas: 300, archivo: null },
    ];

    const { db } = makeFakeDb((info) => {
      if (info.table === 'snapshots') {
        const fuente = eqVal(info, 'fuente');
        return { data: fuente === 'stock' ? stockSnaps : aduanaSnaps, error: null };
      }
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      if (info.table === 'embarques') {
        const snapshotId = eqVal(info, 'snapshot_id');
        if (snapshotId === vigenteAduana.id) {
          return { data: [{ sku: 'A-1', piezas: 150, eta: null, fecha_llegada: null, estatus_id: 7 }], error: null };
        }
        if (snapshotId === 'aduana-abril') {
          return { data: [{ piezas: 100 }], error: null };
        }
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);

    expect(result.kpis.piezas_en_camino).toEqual({
      valor: 150,
      delta: { valor: 50, pct: 50, periodo_base: '2026-04', direccion: 'sube' },
    });
  });

  it('sin snapshot de aduana para el periodo anterior → delta null (nunca fabrica un baseline de 0)', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    const vigenteAduana: SnapshotVigente = { id: 'aduana-julio', created_at: '2026-07-10T00:00:00.000Z', filas: 300, archivo: null };
    resolveVigenteMock.mockResolvedValueOnce(vigenteAduana);

    const stockSnaps = [
      { id: 'snap-4', created_at: '2026-04-07T00:00:00.000Z', periodo: '2026-04', filas: 100, archivo: null },
      { id: 'snap-9', created_at: '2026-07-02T10:00:00.000Z', periodo: '2026-07', filas: 2400, archivo: null },
    ];
    // aduana SOLO tiene julio (arranque frío / historia incompleta) — sin contraparte de abril.
    const aduanaSnaps = [{ id: 'aduana-julio', created_at: '2026-07-10T00:00:00.000Z', periodo: '2026-07', filas: 300, archivo: null }];

    const { db } = makeFakeDb((info) => {
      if (info.table === 'snapshots') {
        const fuente = eqVal(info, 'fuente');
        return { data: fuente === 'stock' ? stockSnaps : aduanaSnaps, error: null };
      }
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      if (info.table === 'embarques') {
        return { data: [{ sku: 'A-1', piezas: 150, eta: null, fecha_llegada: null, estatus_id: 7 }], error: null };
      }
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);
    expect(result.kpis.piezas_en_camino.valor).toBe(150);
    expect(result.kpis.piezas_en_camino.delta).toBeNull();
  });

  it('pendientes: RPC contar_pendientes no disponible (PGRST202 real de PostgREST, 0009 sin aplicar) → degrada a 0, no lanza', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeDb(
      (info) => (info.table === 'estatus_catalogo' ? { data: ESTATUS_FIXTURE, error: null } : { data: [], error: null }),
      () => ({
        data: null,
        error: { message: 'Searched for the function public.contar_pendientes in the schema cache', code: 'PGRST202' },
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await getDashboard(db);

    expect(result.kpis.pendientes.valor).toBe(0);
    expect(result.alertas.find((a) => a.tipo === 'pendientes')!.conteo).toBe(0);
    warnSpy.mockRestore();
  });

  it('pendientes: error genuino (no degradable) en la RPC → lanza (el route lo mapea a 500)', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeDb(
      (info) => (info.table === 'estatus_catalogo' ? { data: ESTATUS_FIXTURE, error: null } : { data: [], error: null }),
      () => ({ data: null, error: { message: 'timeout secreto', code: '57014' } }),
    );
    await expect(getDashboard(db)).rejects.toThrow(/timeout secreto/);
  });

  it('pendientes: RPC ok con conteo → viaja tal cual a kpis.pendientes y a la alerta', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    resolveVigenteMock.mockResolvedValueOnce(null);
    const { db } = makeFakeDb(
      (info) => (info.table === 'estatus_catalogo' ? { data: ESTATUS_FIXTURE, error: null } : { data: [], error: null }),
      () => ({ data: { abiertos: 7, por_tipo: { kam_desconocido: 3, marca_west: 4 } }, error: null }),
    );
    const result = await getDashboard(db);
    expect(result.kpis.pendientes.valor).toBe(7);
  });

  it('con vigente stock: pinnea al snapshot y arma productos/stock/reservas/overrides/v2 (fetchStockCore real)', async () => {
    const vigenteStock: SnapshotVigente = { id: 'stock-9', created_at: '2026-07-02T10:00:00.000Z', filas: 1, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigenteStock),
    );
    resolveVigenteMock.mockResolvedValueOnce(null);

    const { db, calls } = makeFakeDb((info) => {
      if (info.table === 'productos') {
        return {
          data: [
            {
              sku: 'A-1',
              resv: 5,
              descr_origen: 'Descr',
              cliente: null,
              marcas: { nombre: 'BRAND1' },
              familias: { nombre: 'CANDADOS' },
            },
          ],
          error: null,
        };
      }
      if (info.table === 'stock_por_almacen' && !info.in) {
        return { data: [{ sku: 'A-1', cantidad: 10, almacenes: { clave: 'NORTH' } }], error: null };
      }
      if (info.table === 'reservas') return { data: [{ sku: 'A-1', cantidad: 5, kams: { nombre: 'LUCAS' } }], error: null };
      if (info.table === 'productos_override') return { data: [], error: null };
      if (info.table === 'clasificacion_v2') return { data: [], error: null };
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);

    expect(result.snapshot.stock).toEqual({ ...vigenteStock, vigente: true });
    expect(result.kpis.catalogo_total.valor).toBe(1);
    expect(result.kpis.piezas_disponibles.valor).toBe(5); // 10-5
    expect(result.reservas_por_kam.items).toEqual([{ kam: 'LUCAS', piezas: 5 }]);

    const productosCall = calls.find((c) => c.table === 'productos');
    expect(productosCall?.eq).toEqual([['snapshot_id', 'stock-9']]);
    // [VERT-B2] LA COLUMNA DE LA REGLA, PINNEADA POR SU CADENA EXACTA.
    //
    // Gemela de inventory.service.test.ts y sku.service.test.ts, y la tercera
    // pata de una asimetría deliberada: catálogo y dashboard PIDEN la columna,
    // la Ficha NO (se sirve siempre — `C-3`). Las tres están pinneadas cada una
    // en SU archivo, una sola vez: tres copias de la misma cadena en un archivo
    // «resumen» serían tres sitios que actualizar y uno que se queda atrás.
    //
    // Esto vigila la REPRESENTACIÓN (que la columna se pida). Que además se
    // APLIQUE lo vigila el cotejo de `vert-b2-regla-exclusion.test.ts`, porque
    // pedir la columna y no usarla sale verde aquí (P27).
    expect(productosCall?.select).toBe(
      'sku,resv,descr_origen,cliente,tecnologia, marcas(nombre,excluida_del_catalogo), familias(nombre)',
    );
  });

  // [F3 · item 1] Ninguna prueba de `getDashboard` ejercitaba el mapeo
  // `tecnologia: p.tecnologia ?? null,` de `fetchStockCore` (línea señalada en
  // el comentario `[FIX-B1]` de ese mismo mapeo) — el test "con vigente stock"
  // de arriba NUNCA puebla `tecnologia` en su fixture de `productos`, así que
  // `p.tecnologia` sale `undefined` con o sin el `?? null`: un revisor mutó
  // ese mapeo a `tecnologia: null` fijo y la suite completa siguió en VERDE.
  //
  // Este test SÍ puebla tecnología real por SKU (3 con tecnología de Excel, 2
  // sin ella) más una captura activa (override `campo='tecnologia'`) sobre un
  // SKU cuyo Excel viene vacío — el caso real donde `capaFuenteManual` llena
  // el hueco. CONTROL NEGATIVO reportado en la entrega del bloque: mutar esa
  // línea a `tecnologia: null,` pone este test en ROJO.
  it('fetch→mapeo: tecnología de Excel + captura activa llegan a kpis.productos_sin_tecnologia y al heatmap', async () => {
    const vigenteStock: SnapshotVigente = { id: 'stock-9', created_at: '2026-07-02T10:00:00.000Z', filas: 5, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigenteStock),
    );
    resolveVigenteMock.mockResolvedValueOnce(null);

    const productosRow = [
      { sku: 'A-1', resv: 0, descr_origen: 'D1', cliente: null, tecnologia: 'EAS', marcas: { nombre: 'BRAND1' }, familias: null },
      { sku: 'A-2', resv: 0, descr_origen: 'D2', cliente: null, tecnologia: 'BRAND1', marcas: { nombre: 'BRAND1' }, familias: null },
      { sku: 'A-3', resv: 0, descr_origen: 'D3', cliente: null, tecnologia: 'RFID', marcas: { nombre: 'EAS' }, familias: null },
      // A-4: sin tecnología en el Excel, sin captura — sigue contando como sin tecnología.
      { sku: 'A-4', resv: 0, descr_origen: 'D4', cliente: null, tecnologia: null, marcas: { nombre: 'EAS' }, familias: null },
      // A-5: Excel vacío, PERO con captura activa (override) — el hueco que la captura llena.
      { sku: 'A-5', resv: 0, descr_origen: 'D5', cliente: null, tecnologia: null, marcas: { nombre: 'BRAND6' }, familias: null },
    ];

    const { db } = makeFakeDb((info) => {
      if (info.table === 'productos') return { data: productosRow, error: null };
      if (info.table === 'productos_override') {
        return {
          data: [{ id: 'ov-1', sku: 'A-5', campo: 'tecnologia', valor_editado: 'BLE', editado_en: '2026-09-01T00:00:00.000Z', activo: true }],
          error: null,
        };
      }
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);

    // Solo A-4 queda sin tecnología efectiva: A-1/A-2/A-3 la traen del Excel,
    // A-5 la recibe de la captura activa (el Excel calla, la captura llena).
    expect(result.kpis.productos_sin_tecnologia.valor).toBe(1);

    // El selector de tecnologías (global, ver la asimetría documentada en la
    // cabecera del archivo) refleja las CUATRO tecnologías efectivas.
    expect([...result.heatmap.tecnologias].sort()).toEqual(['BLE', 'BRAND1', 'EAS', 'RFID']);
  });

  it('clasificacion_v2 con 42P01 (0008 sin aplicar) no rompe el dashboard: sin_v2 = catalogo_total', async () => {
    const vigenteStock: SnapshotVigente = { id: 'stock-9', created_at: '2026-07-02T10:00:00.000Z', filas: 1, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigenteStock),
    );
    resolveVigenteMock.mockResolvedValueOnce(null);

    const { db } = makeFakeDb((info) => {
      if (info.table === 'productos') {
        return { data: [{ sku: 'A-1', resv: 0, descr_origen: null, cliente: null, marcas: { nombre: 'BRAND1' }, familias: null }], error: null };
      }
      if (info.table === 'clasificacion_v2') {
        return { data: null, error: { message: 'relation "public.clasificacion_v2" does not exist', code: '42P01' } };
      }
      if (info.table === 'estatus_catalogo') return { data: ESTATUS_FIXTURE, error: null };
      return { data: [], error: null };
    }, RPC_PENDIENTES_OK);

    const result = await getDashboard(db);
    expect(result.kpis.sin_v2.valor).toBe(1);
    // [CAT-ITER-1 · O-2b] Antes esperaba 1, «porque sin fila v2 también cuenta
    // como sin tecnología». Eso era cierto mientras los dos contaban la misma
    // capa; desde que este KPI cuenta LA BANDEJA son universos distintos, y en
    // este escenario la RPC `contar_pendientes` no aporta ninguno.
    // El caso que este test protege —que un 42P01 de `clasificacion_v2` NO
    // rompa el dashboard— sigue intacto: lo prueba `sin_v2 = catalogo_total`.
    expect(result.kpis.sin_tecnologia.valor).toBe(0);
  });
});

describe('fetchDescuadresVigentes', () => {
  beforeEach(() => {
    conVigenteStockMock.mockReset();
  });

  it('sin vigente stock → []', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    const result = await fetchDescuadresVigentes({} as SupabaseClient);
    expect(result).toEqual([]);
  });

  it('con vigente: fetch dedicado sku/resv + sku/cantidad, computa vía descuadresDe', async () => {
    const vigente: SnapshotVigente = { id: 'stock-9', created_at: '2026-07-02T10:00:00.000Z', filas: 1, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigente),
    );

    const { db, calls } = makeFakeDb((info) => {
      if (info.table === 'productos') {
        return {
          data: [
            { sku: 'A-1', resv: 10 },
            { sku: 'B-2', resv: 3 },
          ],
          error: null,
        };
      }
      if (info.table === 'reservas') {
        return {
          data: [
            { sku: 'A-1', cantidad: 4 },
            { sku: 'B-2', cantidad: 3 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    const result = await fetchDescuadresVigentes(db);
    expect(result).toEqual([{ sku: 'A-1', resv: 10, suma_reservas: 4 }]);

    const productosCall = calls.find((c) => c.table === 'productos');
    expect(productosCall?.eq).toEqual([['snapshot_id', 'stock-9']]);
    const reservasCall = calls.find((c) => c.table === 'reservas');
    expect(reservasCall?.eq).toEqual([['snapshot_id', 'stock-9']]);
  });
});
