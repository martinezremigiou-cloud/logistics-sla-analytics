// ============================================================
// scripts/datos-muestra/edge.mjs
// Los tres fixtures de BORDE (`fixtures/edge/*.json`): grids mínimos escritos a mano
// con valores inventados. Cada uno concentra una rareza estructural que el parser maneja a propósito.
// Las constantes exportadas son lo que las pruebas aseveran sobre ellos.
// ============================================================

export const EDGE = {
  inventario: {
    // AAA-1: cliente, marca sembrada, NORTH=13, TRAN=8, TOTAL=21, RESV=27, QTY=-6
    // bbb-2: SKU en minúscula y NORTH con formato de miles «4.285»
    // CCC-3: sin marca (cuarentena) · fila con ITEM vacío (leyenda) · fila TOTALES
    sinMarca: 'CCC-3',
    minuscula: 'bbb-2',
    miles: { sku: 'BBB-2', texto: '4.285', valor: 4285 },
    primero: { sku: 'AAA-1', north: 13, tran: 8, total: 21, resv: 27 },
  },
  reserva: {
    // pivote mínimo: razón social en f1, KAM en f5, fechas en f7 (una malformada de año de 3 dígitos),
    // motivos en f8, clientes en f9; col B (total-fuente) ignorada; fila con ITEM vacío y fila TOTALES
    sku: 'SKU-1',
    valida: { cliente: 'RETAILER64', kam: 'Laura', cantidad: 11, motivo: 'pedido A', fecha: '2031-04-23' },
    totalFuenteIgnorado: 468,
  },
  embarques: {
    ocAbierta: { oc: 'QXL4180', sku: 'KR7710' },
    garantia: { sku: 'G-1' },
    activo: {
      sku: 'SUJ500-F',
      estatus: 'En Aduana',
      piezas: 100,
      fechaRecoleccion: '2031-03-27',
      eta: '2031-05-12',
    },
    historico: { sku: 'YEP6332', estatus: 'Producto Disponible', oc: 'QWN3304187' },
  },
};

export function gridsEdge() {
  const inventario = [
    [],
    [null, null, null, null, null, null, 'STOCK'],
    [],
    [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV', 'QTY'],
    [null, 'AAA-1', 'RETAILER2', 'SERIES5', 'SERIES11', 'A', 'Desc uno', '13', '', '', '8', '', '21', '27', '-6'],
    [null, 'bbb-2', '', 'BRAND9', 'LABEL ROLL', 'C', 'Etiqueta demo', '4.285', '', '', '', '', '4285', '0', '4.285'],
    [null, 'CCC-3', '', '', 'FAM', 'C', 'renglon sin marca', '1', '', '', '', '', '1', '0', '1'],
    [null, '', 'X', 'Y', 'Z', 'W', 'leyenda ITEM vacio', '', '', '', '', '', '', '', ''],
    [null, 'TOTALES', '', '', '', '', '', '100', '', '', '', '', '100', '', ''],
  ];

  const reserva = [
    ['DEMO COMERCIAL S DE RL DE CV'],
    [],
    [],
    [],
    [null, null, null, 'Laura', 'Lucas', 'Julio'],
    [],
    ['STOCK MEXICO', null, null, '23-abr-31', '19 mar 264', null],
    [null, null, null, 'pedido A', 'pedido B', 'pedido C'],
    ['ITEM', null, null, 'RETAILER64', 'RETAILER 56', null],
    ['SKU-1', '468', null, '11', '5', '9'],
    [null, '999', null, '1'],
    ['TOTALES', '10', null, '2'],
  ];

  const cabecera = [
    'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'OC', 'ITEM', 'DESCRIPCION', 'TOTAL PIEZAS', 'PROYECTO', 'FW',
    'TIPO DE IMPORTACION', 'FECHA DE RECOLECCION', 'ETD (FECHA DE SALIDA DE ORIGEN)', 'ETA (FECHA DE LLEGADA A ADUANA)',
    'FECHA DE LLEGADA A ALMACEN', 'FECHA ESTIMADA DE DISPONIBILIDAD', 'OBSERVACIONES', 'ESTATUS',
  ];
  const cabeceraHist = [
    'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'N° PO', 'ITEM', 'DESCRIPCION', 'PIEZAS', 'PROYECTO', 'FW',
    'TIPO DE IMPORTACION', 'FECHA DE RECOLECCION', 'ETD (FECHA DE SALIDA DE ORIGEN)', 'ETA (FECHA DE LLEGADA A ADUANA)',
    'FECHA DE LLEGADA A ALMACEN', 'FECHA DE DISPONIBILIDAD', 'OBSERVACIONES', 'ESTATUS',
  ];
  const e = EDGE.embarques;
  const embarques = [
    {
      hoja: 'OC ABIERTAS',
      grid: [
        ['OC', 'ITEM', 'DESCRIPCION', 'CANT. SOLICITADA', 'PROYECTO', 'OBSERVACIONES'],
        [e.ocAbierta.oc, e.ocAbierta.sku, 'kit', 590, 'STOCK', 'x'],
      ],
    },
    {
      hoja: 'GARANTIAS',
      grid: [
        ['ITEM', 'DESCRIPCION', 'ESTATUS'],
        [e.garantia.sku, 'garantia', 'En Aduana'],
      ],
    },
    {
      hoja: 'BRAND1',
      grid: [
        cabecera,
        ['REF-0481', 482615, 'HK', 'QXL5170384', e.activo.sku, 'Hook M12 angled', e.activo.piezas, 'RETAILER9', 'PARTNER 10', 'SEA/FCL', `${e.activo.fechaRecoleccion}T00:00:00`, '2031-04-11T00:00:00', `${e.activo.eta}T00:00:00`, null, '2031-06-17T00:00:00', 'En proceso', e.activo.estatus, 'Producto Solicitado'],
        [null, null, null, null, null, 'TOTALES', 100, null, null, null, null, null, null, null, null, null, 'En Preparación'],
      ],
    },
    {
      hoja: ' HISTORIAL DEMO',
      grid: [
        [null, null, null, null, null, null, null, null, null, 'ALMACEN DE INGRESO'],
        cabeceraHist,
        ['REF-0007', 531904, 'HK', e.historico.oc, e.historico.sku, 'Plate adhesive 58MM', 50, 'LOTE II', 'PARTNER5', 'EXPRESS', '2031-01-21T00:00:00', '2031-01-21T00:00:00', '2031-01-23T00:00:00', '2031-01-30T00:00:00', '2031-02-03T00:00:00', null, e.historico.estatus],
      ],
    },
  ];
  return { inventario, reserva, embarques };
}
