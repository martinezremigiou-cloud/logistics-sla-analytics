import { describe, it, expect } from 'vitest';
import { analizarStock, analizarAduana, compararEstructura, evaluarGateStock } from '../preflight';
import { construirDatasets, type WorkbookGrids, type ClasificacionHojaAduana } from '../motor';
import { leerWorkbookXlsx, cargarReferenciaAbril } from '../io';
import { ingestaMapeoConfig } from '../../../config/ingesta-mapeo';
import { libroStockJulio, libroAduanaVivo, libroStockVivo } from './libros-muestra';
import { MUESTRA } from '@/services/etl/__tests__/constantes-muestra';

// ------------------------------------------------------------
// analizarStock / analizarAduana — sintéticos.
// ------------------------------------------------------------

describe('analizarStock', () => {
  it('cuenta productos/stock/west/reservas y expone diag + cuarentena (mismas reglas que gates.ts)', () => {
    const inventario = [
      [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
      [null, 'A-1', null, 'BRAND5', 'FAM', 'C', 'desc', 5, null, null, null, null, 5, 2],
      [null, 'A-2', null, 'BRAND5', 'FAM', 'C', 'desc', 3, null, null, null, null, 999, 0], // TOTAL no cuadra a propósito
    ];
    const west = [
      ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO'],
      ['A-1', 'X', 'd', 1], // MATCHED (ya existe en inventario)
      ['B-1', 'NUEVAMARCA', 'd nuevo', 4], // NUEVO
    ];
    const reserva = [
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, 'KAM1', null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, '01-abr-26', null, null, null],
      [null, null, null, 'motivo', null, null, null],
      ['ITEM', 'total', null, 'CLIENTE1', null, null, null],
      ['A-1', '10', null, 2, null, null, null],
    ];

    const r = analizarStock({ inventario, west, reserva });

    expect(r.conteos.productosInventario).toBe(2);
    expect(r.conteos.stockInventario).toBe(2); // NORTH de A-1 y A-2
    expect(r.conteos.westRows).toBe(2);
    expect(r.conteos.westMatched).toBe(1);
    expect(r.conteos.westNuevos).toBe(1);
    expect(r.conteos.productosReconciliados).toBe(3); // 2 inventario + 1 alta WEST
    expect(r.conteos.reservas).toBe(1);

    // A-2 tiene TOTAL=999 pero NORTH=3 → diag SUMA_STOCK.
    expect(r.diag.some((d) => d.tipo === 'SUMA_STOCK' && d.sku === 'A-2')).toBe(true);
    // [CAT-B1·A] Antés `toEqual([])`. El grid sintético de arriba trae FAMILIA/
    // CLASE/DESCR/CLIENTE pero no TECNOLOGIA ni PRODUCTO, así que ahora emite su
    // rastro de columna ausente a nivel de HOJA. El criterio NO se relaja: se
    // enumeran los dos motivos exactos y se exige que no haya NINGUNA cuarentena
    // de fila, que es lo que este assert quería decir con «cuarentena vacía».
    // [FIX-B1·T4] El grid WEST de arriba (ITEM/PROV/DESCRIPCION/FISICO) tampoco
    // trae TECNOLOGIA/FAMILIA/CLASE — 3 rastros más (uno de ellos repite el
    // motivo 'columna_ausente_tecnologia', que ya emitía Inventario: son HOJAS
    // distintas, cada una deja el suyo).
    expect(r.cuarentena.map((c) => c.motivo).sort()).toEqual([
      'columna_ausente_clase',
      'columna_ausente_familia',
      'columna_ausente_producto',
      'columna_ausente_tecnologia',
      'columna_ausente_tecnologia',
    ]);
    expect(r.cuarentena.filter((c) => c.sku !== null)).toEqual([]);
  });

  it('cuarentena anticipada: fecha malformada en Reserva se reporta (sin DB)', () => {
    const inventario = [
      [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
      [null, 'A-1', null, 'BRAND5', 'FAM', 'C', 'desc', 5, null, null, null, null, 5, 1],
    ];
    const west = [['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
    const reserva = [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, '19 mar 264'], // fecha malformada (3 dígitos de año)
      [null, null, null, null],
      ['ITEM', 'total', null, 'CLIENTE1'],
      ['A-1', '10', null, 1],
    ];
    const r = analizarStock({ inventario, west, reserva });
    expect(r.cuarentena.some((c) => c.motivo === 'reserva_fecha_malformada')).toBe(true);
  });

  it('reserva de SKU inexistente en el archivo → cuarentena reserva_sku_sin_producto (SÍ calculable file-only)', () => {
    const inventario = [
      [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
      [null, 'A-1', null, 'BRAND5', 'FAM', 'C', 'desc', 5, null, null, null, null, 5, 0],
    ];
    const west = [['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
    const reserva = [
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
      ['ITEM', 'total', null, 'CLIENTE1'],
      ['NO-EXISTE', '10', null, 3],
    ];
    const r = analizarStock({ inventario, west, reserva });
    expect(r.cuarentena.some((c) => c.motivo === 'reserva_sku_sin_producto' && c.sku === 'NO-EXISTE')).toBe(true);
    expect(r.conteos.reservas).toBe(0);
  });
});

describe('analizarAduana', () => {
  it('cuenta embarques por hoja y total, marca is_historial por nombre de hoja', () => {
    const embarques = [
      { hoja: 'BRAND1', grid: [['ITEM', 'ESTATUS'], ['A-1', 'En Aduana']] },
      {
        hoja: ' HISTORIAL DEMO',
        grid: [['ITEM', 'ESTATUS'], ['A-1', 'Producto Disponible'], ['A-2', 'Producto Disponible']],
      },
    ];
    const r = analizarAduana({ embarques });
    expect(r.porHoja).toEqual([
      { hoja: 'BRAND1', total: 1, historial: false },
      { hoja: ' HISTORIAL DEMO', total: 2, historial: true },
    ]);
    expect(r.total).toBe(3);
  });

  it('hoja sin estructura de embarque (sin ESTATUS) no arroja error, simplemente 0', () => {
    const r = analizarAduana({ embarques: [{ hoja: 'OC ABIERTAS', grid: [['OC', 'ITEM']] }] });
    expect(r.porHoja).toEqual([{ hoja: 'OC ABIERTAS', total: 0, historial: false }]);
  });
});

// ------------------------------------------------------------
// evaluarGateStock — "Gate 2" (INV-B8): clasifica STOCK sin construir
// el body ni lanzar (a diferencia de `construirDatasets`, que SÍ
// lanza `DatasetsStockFaltantesError` — ver motor.ts y su describe de
// "gate bloqueante" en motor.test.ts, donde vive la cobertura del
// throw en sí). Aquí se prueba la envoltura NO-throwing.
// ------------------------------------------------------------

describe('evaluarGateStock', () => {
  const cfgSintetico = () => ({
    stock: {
      inventario: { nombres: ['Inventario'] },
      west: { nombres: ['WEST', 'INV_WEST', 'INV WEST'] },
      reserva: { nombres: ['Reserva'] },
      excluidas: [{ nombres: ['Compras'], motivo: 'fuera de alcance' }],
      pendientes: [],
    },
    aduana: { excluidas: [], pendientes: [] },
    aliasesHeader: {
      inventario: { aliases: {}, tokensHeader: ['item'] },
      west: { aliases: {}, tokensHeader: ['item'] },
      reserva: { aliases: {}, tokensHeader: ['item'] },
      embarques: { aliases: {}, tokensHeader: ['item'] },
    },
  });

  it('completo=true, faltantes=[] cuando las 3 hojas obligatorias están asignadas — no lanza', () => {
    const workbook: WorkbookGrids = {
      nombreArchivo: 's.xlsx',
      hojas: [
        { nombre: 'Inventario', grid: [['ITEM']] },
        { nombre: 'WEST', grid: [['ITEM']] },
        { nombre: 'Reserva', grid: [['ITEM']] },
      ],
    };
    const gate = evaluarGateStock(workbook, cfgSintetico());
    expect(gate.completo).toBe(true);
    expect(gate.faltantes).toEqual([]);
    expect(gate.reporte).toHaveLength(3);
  });

  it('completo=false, faltantes=["west"] cuando falta la hoja WEST — SIN lanzar (a diferencia de construirDatasets)', () => {
    const workbook: WorkbookGrids = {
      nombreArchivo: 's.xlsx',
      hojas: [
        { nombre: 'Inventario', grid: [['ITEM']] },
        { nombre: 'Reserva', grid: [['ITEM']] },
      ],
    };
    expect(() => evaluarGateStock(workbook, cfgSintetico())).not.toThrow();
    const gate = evaluarGateStock(workbook, cfgSintetico());
    expect(gate.completo).toBe(false);
    expect(gate.faltantes).toEqual(['west']);
    expect(gate.reporte.map((h) => h.hoja)).toEqual(['Inventario', 'Reserva']);
  });

  it('distingue "excluida a propósito" (Compras, con motivo) de "no reconocida" (hoja sin nombre configurado) en el mismo reporte', () => {
    const workbook: WorkbookGrids = {
      nombreArchivo: 's.xlsx',
      hojas: [
        { nombre: 'Inventario', grid: [['ITEM']] },
        { nombre: 'WEST', grid: [['ITEM']] },
        { nombre: 'Reserva', grid: [['ITEM']] },
        { nombre: 'Compras', grid: [['OC']] },
        { nombre: 'HOJA DESCONOCIDA', grid: [['X']] },
      ],
    };
    const gate = evaluarGateStock(workbook, cfgSintetico());
    expect(gate.completo).toBe(true); // Compras excluida ≠ faltante
    const porHoja = Object.fromEntries(gate.reporte.map((h) => [h.hoja, h.clasificacion]));
    expect(porHoja['Compras'].estado).toBe('excluida');
    expect((porHoja['Compras'] as { estado: 'excluida'; motivo: string }).motivo).toBe('fuera de alcance');
    expect(porHoja['HOJA DESCONOCIDA']).toEqual({ estado: 'no_mapeable' });
  });

  it('hoja obligatoria presente pero con 0 filas de datos ("presente y vacía"): sigue completo=true — no se confunde con "ausente"', () => {
    const workbook: WorkbookGrids = {
      nombreArchivo: 's.xlsx',
      hojas: [
        { nombre: 'Inventario', grid: [['ITEM']] },
        { nombre: 'WEST', grid: [] },
        { nombre: 'Reserva', grid: [['ITEM']] },
      ],
    };
    const gate = evaluarGateStock(workbook, cfgSintetico());
    expect(gate.completo).toBe(true);
    expect(gate.faltantes).toEqual([]);
  });
});

// ------------------------------------------------------------
// compararEstructura — sintético.
// ------------------------------------------------------------

describe('compararEstructura', () => {
  const wbActual: WorkbookGrids = {
    nombreArchivo: 'julio.xlsx',
    hojas: [
      { nombre: 'WEST', grid: [['ITEM', 'PROV', 'FISICO', 'NUEVA']] },
      { nombre: 'PARTNER9', grid: [['ITEM', 'ESTATUS']] },
      { nombre: 'BRAND1', grid: [['ITEM', 'ESTATUS']] },
    ],
  };
  const wbReferencia: WorkbookGrids = {
    nombreArchivo: 'abril.xlsx',
    hojas: [
      { nombre: 'INV_WEST', grid: [['ITEM', 'PROV', 'FISICO']] },
      { nombre: 'BRAND1', grid: [['ITEM', 'ESTATUS', 'VIEJA']] },
    ],
  };
  const reporteActual: ClasificacionHojaAduana[] = [
    { hoja: 'WEST', filas: 1, clasificacion: { estado: 'asignada', dataset: 'embarques' } },
    { hoja: 'PARTNER9', filas: 1, clasificacion: { estado: 'asignada', dataset: 'embarques' } },
    { hoja: 'BRAND1', filas: 1, clasificacion: { estado: 'asignada', dataset: 'embarques' } },
  ];
  const reporteReferencia: ClasificacionHojaAduana[] = [
    { hoja: 'INV_WEST', filas: 1, clasificacion: { estado: 'asignada', dataset: 'embarques' } },
    { hoja: 'BRAND1', filas: 1, clasificacion: { estado: 'asignada', dataset: 'embarques' } },
  ];

  it('detecta hoja nueva (dataset catch-all: PARTNER9 no existía en la referencia)', () => {
    const d = compararEstructura(
      { workbook: wbActual, reporte: reporteActual },
      { workbook: wbReferencia, reporte: reporteReferencia },
    );
    expect(d.hojasNuevas).toContain('PARTNER9');
  });

  it('detecta RENOMBRE (mismo dataset, nombre de hoja distinto) como renombrada, no como nueva+desaparecida', () => {
    // en este caso 'WEST'/'INV_WEST' están dentro del mismo dataset catch-all
    // 'embarques' (sintético) → se tratan como hojas independientes ahí; el
    // caso de RENOMBRE real (dataset exacto 1:1) se prueba abajo con 'stock'.
    const reporteActualStock = [
      { hoja: 'WEST', filas: 1, clasificacion: { estado: 'asignada' as const, dataset: 'west' as const } },
    ];
    const reporteReferenciaStock = [
      { hoja: 'INV_WEST', filas: 1, clasificacion: { estado: 'asignada' as const, dataset: 'west' as const } },
    ];
    const d = compararEstructura(
      { workbook: wbActual, reporte: reporteActualStock },
      { workbook: wbReferencia, reporte: reporteReferenciaStock },
    );
    expect(d.renombradas).toEqual([{ dataset: 'west', de: 'INV_WEST', a: 'WEST' }]);
    expect(d.hojasNuevas).toEqual([]);
    expect(d.hojasDesaparecidas).toEqual([]);
  });

  it('detecta headers agregados/quitados por hoja (BRAND1: +NUEVA... ver WEST; -VIEJA en BRAND1)', () => {
    const d = compararEstructura(
      { workbook: wbActual, reporte: reporteActual },
      { workbook: wbReferencia, reporte: reporteReferencia },
    );
    const brand1 = d.headersCambiados.find((h) => h.hoja === 'BRAND1');
    expect(brand1?.quitados).toContain('vieja');
    expect(brand1?.agregados).toEqual([]);
  });

  it("NO compara headers del dataset 'reserva' (su fila 'item' trae clientes, no un schema — puro ruido mes a mes)", () => {
    const wbConReserva: WorkbookGrids = {
      nombreArchivo: 'julio.xlsx',
      hojas: [{ nombre: 'Reserva', grid: [['ITEM', 'CLIENTE-JULIO-A', 'CLIENTE-JULIO-B']] }],
    };
    const wbReferenciaReserva: WorkbookGrids = {
      nombreArchivo: 'abril.xlsx',
      hojas: [{ nombre: 'Reserva', grid: [['ITEM', 'CLIENTE-ABRIL-X']] }],
    };
    const reporteConReserva = [
      { hoja: 'Reserva', filas: 1, clasificacion: { estado: 'asignada' as const, dataset: 'reserva' as const } },
    ];
    const d = compararEstructura(
      { workbook: wbConReserva, reporte: reporteConReserva },
      { workbook: wbReferenciaReserva, reporte: reporteConReserva },
    );
    expect(d.headersCambiados).toEqual([]);
  });

  it('sin cambios estructurales entre dos workbooks idénticos → deltas vacíos', () => {
    const d = compararEstructura(
      { workbook: wbReferencia, reporte: reporteReferencia },
      { workbook: wbReferencia, reporte: reporteReferencia },
    );
    expect(d).toEqual({ hojasNuevas: [], hojasDesaparecidas: [], renombradas: [], headersCambiados: [] });
  });
});

// ============================================================
// INTEGRACIÓN: preflight sobre los libros de muestra en formato de julio 2026.
//
// Fix M-1: estos .xlsx NO están versionados en git (viven en `muestra/`,
// carpeta ignorada que llena el generador de datos de muestra) — en un
// clon fresco faltan por diseño. `leerWorkbookXlsx` se llama a TIEMPO DE
// COLECCIÓN (fuera de todo `it`); sin guarda, su ausencia revienta la
// colección ENTERA del archivo con un ENOENT críptico. Guarda:
// `describe.skip` (con nota es-MX) si faltan, y el cuerpo no lee nada
// cuando faltan (vitest ejecuta el cuerpo aun si es `.skip`).
// ============================================================
const archivoStockJulio = libroStockJulio();
const archivoAduanaJulio = libroAduanaVivo();
const hayArchivosJulio = archivoStockJulio !== null && archivoAduanaJulio !== null;

(hayArchivosJulio ? describe : describe.skip)(
  'preflight — INTEGRACIÓN CON LIBROS DE MUESTRA: formato de julio 2026 (requiere los .xlsx de muestra en `muestra/`)',
  () => {
    if (!hayArchivosJulio) return;
    const stock = leerWorkbookXlsx(archivoStockJulio!);
    const aduana = leerWorkbookXlsx(archivoAduanaJulio!);
    const { bodyStock, bodyAduana, reporte } = construirDatasets({ stock, aduana }, ingestaMapeoConfig, {
      capturedAt: '2026-07-13T00:00:00.000Z',
    });

    const stockPreflight = analizarStock(bodyStock.datasets);
    const aduanaPreflight = analizarAduana(bodyAduana.datasets);

    // Cifras POR CONSTRUCCIÓN: salen del modelo del generador de muestra (`MUESTRA.julio`), no de lo que
    // devuelve el parser — así «parser == constante» sí prueba algo.
    const J = MUESTRA.julio;

    it('conteos exactos de STOCK y ADUANA (fix A columna TOTALES): productos, west, reservas, embarquesTotal', () => {
      expect(stockPreflight.conteos.productosInventario).toBe(J.productosInventario);
      expect(stockPreflight.conteos.westRows).toBe(J.westRows);
      // fix A: la columna-cliente 'TOTALES' del pivote de Reserva (suma por
      // fila) ya no se ingiere como cliente real: eran reservas fantasma
      // (ver parse.reserva.ts y parse.reserva.test.ts).
      expect(stockPreflight.conteos.reservas).toBe(J.reservas);
      expect(aduanaPreflight.total).toBe(J.aduana.total);
    });

    it('el alias DESC→DESCRIPCION recupera todas las filas de WEST (sin el alias ninguna traía descripción, ver ingesta-mapeo.ts)', () => {
      // reconstruible desde bodyStock.datasets.west (ya con el alias del motor aplicado).
      expect(stockPreflight.conteos.westRows).toBe(J.westRows);
      expect(bodyStock.datasets.west.length - 1).toBe(J.westRows); // filas del grid sin el header
    });

    it('conteos reconciliados exactos (fix B-4): stock, west (matched/nuevos), productos y stock reconciliados', () => {
      expect(stockPreflight.conteos.stockInventario).toBe(J.stockInventario);
      expect(stockPreflight.conteos.westMatched).toBe(J.westMatched);
      expect(stockPreflight.conteos.westNuevos).toBe(J.westNuevos);
      expect(stockPreflight.conteos.productosReconciliados).toBe(J.productosReconciliados);
      expect(stockPreflight.conteos.stockReconciliado).toBe(J.stockReconciliado);
      // invariantes (no cifras): reconciliados = productos + nuevos · stock reconciliado = stock + west · matched + nuevos = filas west
      expect(stockPreflight.conteos.productosReconciliados).toBe(stockPreflight.conteos.productosInventario + stockPreflight.conteos.westNuevos);
      expect(stockPreflight.conteos.stockReconciliado).toBe(stockPreflight.conteos.stockInventario + stockPreflight.conteos.westRows);
      expect(stockPreflight.conteos.westMatched + stockPreflight.conteos.westNuevos).toBe(stockPreflight.conteos.westRows);
      // los gates de gates.ts NUNCA descartan datos: solo reportan (ver test de gates abajo).
      expect(Array.isArray(stockPreflight.diag)).toBe(true);
    });

    it('gates preliminares (fix A columna TOTALES): DIAG con SUMA_STOCK y SUMA_RESERVAS — NO bloquean (ver gates.ts)', () => {
      const sumaStock = stockPreflight.diag.filter((d) => d.tipo === 'SUMA_STOCK').length;
      const sumaResv = stockPreflight.diag.filter((d) => d.tipo === 'SUMA_RESERVAS').length;
      // fix A: buena parte de los descuadres SUMA_RESERVAS eran artificiales
      // (Σreservas inflada x2 por la columna-cliente 'TOTALES' sumándose
      // sobre sí misma); solo queda el residuo real.
      expect(stockPreflight.diag).toHaveLength(J.diagReservas + J.diagStock);
      expect(sumaStock).toBe(J.diagStock);
      expect(sumaStock).toBe(0); // invariante: TOTAL = Σ bodegas en todas las filas
      expect(sumaResv).toBe(J.diagReservas);
    });

    it('cuarentena anticipada de STOCK: total = fechas malformadas + cliente vacío + columnas que julio no trae', () => {
      // [CAT-B1·A] El libro de julio 2026 no trae TECNOLOGIA ni PRODUCTO en
      // Inventario, y desde ese bloque esa ausencia SÍ deja rastro — que es
      // justo lo que antes se perdía en silencio.
      // [FIX-B1·T4] la hoja 'WEST' de julio TAMPOCO trae
      // TECNOLOGIA/FAMILIA/CLASE (solo el unificado de mayo 2026 en adelante
      // las trae en 'INV WEST') — 3 rastros más, a nivel de HOJA (no de fila).
      // El de tecnología SUMA con el que ya emitía Inventario: son HOJAS
      // distintas, cada una con su propio rastro del mismo motivo. Se
      // enumeran los seis por motivo para que la cifra total nunca vuelva a
      // ser lo único que se afirma: un total cuadra por casualidad.
      const ausentes = J.columnasAusentes;
      const totalAusentes = ausentes.tecnologia + ausentes.producto + ausentes.familia + ausentes.clase;
      expect(stockPreflight.cuarentena).toHaveLength(J.reservasMalformadas + J.reservasClienteVacio + totalAusentes);
      const porMotivo = (motivo: string): number =>
        stockPreflight.cuarentena.filter((c) => c.motivo === motivo).length;
      expect(porMotivo('reserva_fecha_malformada')).toBe(J.reservasMalformadas);
      expect(porMotivo('reserva_cliente_vacio')).toBe(J.reservasClienteVacio);
      expect(porMotivo('columna_ausente_tecnologia')).toBe(ausentes.tecnologia); // Inventario (1) + WEST (1)
      expect(porMotivo('columna_ausente_producto')).toBe(ausentes.producto); // solo Inventario: WEST nunca trajo PRODUCTO
      expect(porMotivo('columna_ausente_familia')).toBe(ausentes.familia); // solo WEST: Inventario SÍ trae FAMILIA en julio
      expect(porMotivo('columna_ausente_clase')).toBe(ausentes.clase); // solo WEST: Inventario SÍ trae CLASS en julio
    });

    it('embarques por hoja (fix B-4): total por hoja y bandera de historial', () => {
      // las 8 hojas de embarque en el orden del libro (OC ABIERTAS y GARANTIAS no cuentan); totales por construcción
      expect(aduanaPreflight.porHoja.map((h) => h.hoja)).toEqual([
        'BRAND1',
        'BRAND3',
        'SERIES 5',
        'BRAND2',
        'PARTNER9',
        ' HISTORIAL DEMO',
        'WEST',
        'HISTORIAL WEST',
      ]);
      expect(aduanaPreflight.porHoja).toEqual(J.aduana.porHoja);
      expect(aduanaPreflight.total).toBe(J.aduana.total);
      expect(aduanaPreflight.total).toBe(J.aduana.porHoja.reduce((s, h) => s + h.total, 0)); // Σ por hoja = total
    });

    it('compararEstructura vs abril: WEST renombrada, PARTNER9 nueva, sin hojas desaparecidas', () => {
      const referencia = cargarReferenciaAbril();
      const refConstruido = construirDatasets(referencia, ingestaMapeoConfig, {
        capturedAt: '2026-04-15T00:00:00.000Z',
      });

      const deltaStock = compararEstructura(
        { workbook: stock, reporte: reporte.stock },
        { workbook: referencia.stock, reporte: refConstruido.reporte.stock },
      );
      expect(deltaStock.renombradas).toContainEqual({ dataset: 'west', de: 'INV_WEST', a: 'WEST' });

      const deltaAduana = compararEstructura(
        { workbook: aduana, reporte: reporte.aduana },
        { workbook: referencia.aduana, reporte: refConstruido.reporte.aduana },
      );
      expect(deltaAduana.hojasNuevas).toEqual([J.aduana.hojaNueva]);
      expect(deltaAduana.hojasDesaparecidas).toEqual([]);
    });
  },
);

// ============================================================
// INTEGRACIÓN: evaluarGateStock sobre el ARCHIVO UNIFICADO de muestra
// (INV-B8, "Gate 2" del bloque — medir sin persistir). Mismo archivo
// que motor.test.ts usa para probar `construirDatasets` directamente;
// aquí se prueba la envoltura no-throwing con el config REAL.
//
// Punto 3 (bloque INV-B8, mismo criterio que motor.test.ts): la copia
// de muestra es una instantánea con el formato de julio y SÍ
// trae 'Compras', pero el archivo VIVO ya no tiene esa hoja (se
// eliminó en el origen). Las aserciones de abajo NO
// exigen la presencia de 'Compras': verifican que las 3 hojas
// obligatorias se clasifican y, SI 'Compras' aparece, que quede
// excluida con motivo — así esta prueba vale tanto para esta copia
// (4 hojas) como para el archivo vivo (3 hojas).
// ============================================================
const archivoUnificadoPreflight = libroStockVivo();
const hayArchivoUnificadoPreflight = archivoUnificadoPreflight !== null;

(hayArchivoUnificadoPreflight ? describe : describe.skip)(
  'evaluarGateStock — INTEGRACIÓN: archivo UNIFICADO de muestra (requiere el .xlsx en `muestra/`)',
  () => {
    it(
      'clasifica las 3 hojas obligatorias de forma explícita (Inventario/Reserva/"INV WEST" asignadas); si ' +
        '"Compras" está presente (esta copia la trae) queda excluida CON MOTIVO, sin exigir su presencia — ' +
        'SIN lanzar y SIN construir el body — completo=true, faltantes=[]',
      () => {
        const stock = leerWorkbookXlsx(archivoUnificadoPreflight!);
        const gate = evaluarGateStock(stock, ingestaMapeoConfig);

        const porHoja = Object.fromEntries(gate.reporte.map((h) => [h.hoja, h.clasificacion]));
        expect(porHoja['Inventario']).toEqual({ estado: 'asignada', dataset: 'inventario' });
        expect(porHoja['Reserva']).toEqual({ estado: 'asignada', dataset: 'reserva' });
        expect(porHoja['INV WEST']).toEqual({ estado: 'asignada', dataset: 'west' });
        if (porHoja['Compras']) {
          expect(porHoja['Compras'].estado).toBe('excluida');
        }

        expect(gate.completo).toBe(true);
        expect(gate.faltantes).toEqual([]);
      },
    );
  },
);
