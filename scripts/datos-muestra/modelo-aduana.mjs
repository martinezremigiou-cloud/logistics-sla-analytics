// ============================================================
// scripts/datos-muestra/modelo-aduana.mjs
// MODELO de las hojas de embarques (aduana): encabezados por tipo de hoja,
// filas inventadas y emisión a grid. Una sola definición sirve a abril (JSON,
// fechas ISO `YYYY-MM-DDT00:00:00`) y a julio (xlsx, fechas tipadas).
// ============================================================
import { nuevaDescripcion, nuevoSku, ESTATUS_PIPELINE, iso, serialExcel, fechaAleatoria } from './base.mjs';

const ETD = 'ETD (FECHA DE SALIDA DE ORIGEN)';
const ETA = 'ETA (FECHA DE LLEGADA A ADUANA)';
const COLA = [
  'FECHA DE RECOLECCION',
  ETD,
  ETA,
  'FECHA DE LLEGADA A ALMACEN',
  'FECHA ESTIMADA DE DISPONIBILIDAD',
  'OBSERVACIONES',
  'ESTATUS',
];

/** Encabezados por tipo de hoja (los nombres de columna son vocabulario del parser, no datos). */
export const ENCABEZADOS = {
  // hoja de marca con almacén de destino EAST
  marcaA: [
    'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'OC', 'ITEM', 'DESCRIPCION', 'TOTAL PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'NORTH', 'EAST', 'FECHA DE FIN DE ALISTAMIENTO',
    'TARIMAS', 'FW', 'TIPO DE IMPORTACION', ...COLA, null, null,
  ],
  // hoja de marca con almacén fiscal
  marcaB: [
    'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'OC', 'ITEM', 'DESCRIPCION', 'TOTAL PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'NORTH', 'FISCAL', 'FECHA DE FIN DE ALISTAMIENTO',
    'TARIMAS', 'FW', 'TIPO DE IMPORTACION', ...COLA, null, null,
  ],
  // hoja con alias distintos (FACTURA, N° PO, PIEZAS)
  marcaC: [
    'REFERENCIA', 'FACTURA', 'PAIS DE ORIGEN', 'N° PO', 'ITEM', 'DESCRIPCION', 'PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'FECHA DE FIN DE FABRICA', 'TARIMAS', 'FW',
    'TIPO DE IMPORTACION', ...COLA, null, null,
  ],
  historial: [
    'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'N° PO', 'ITEM', 'DESCRIPCION', 'PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'NORTH', 'SOUTH', 'FECHA DE FIN DE FABRICA',
    'TARIMAS', 'FW', 'TIPO DE IMPORTACION', 'FECHA DE RECOLECCION', ETD, ETA,
    'FECHA DE LLEGADA A ALMACEN', 'FECHA DE DISPONIBILIDAD', 'OBSERVACIONES', 'ESTATUS',
  ],
  // hoja de la bodega externa: REFERENCIA duplicada (cols 0 y 1)
  bodega: [
    'REFERENCIA', 'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'OC', 'ITEM', 'DESCRIPCION', 'TOTAL PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'NORTH', 'FISCAL', 'FECHA DE FIN DE ALISTAMIENTO',
    'TARIMAS', 'FW', 'TIPO DE IMPORTACION', ...COLA, null, null,
  ],
  // historial de la bodega externa: la primera columna lleva la sigla de un forwarder
  historialBodega: [
    'REFERENCIA PARTNER3', 'REFERENCIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'OC', 'ITEM', 'DESCRIPCION', 'TOTAL PIEZAS',
    'FECHA DE APROBACION', 'PROYECTO', 'NORTH', 'FISCAL', 'FECHA DE FIN DE ALISTAMIENTO',
    'TARIMAS', 'FW', 'TIPO DE IMPORTACION', ...COLA, null, null,
  ],
  // control interno de OC: sin ESTATUS
  oc: ['OC', 'ITEM', 'DESCRIPCION', 'CANT. SOLICITADA', 'PROYECTO', 'OBSERVACIONES'],
  // layout distinto: STATUS en lugar de ESTATUS
  garantias: [
    'EMBARQUE PREVIO', 'REFERENCIA PREVIA', 'FACTURA COMERCIAL', 'PAIS DE ORIGEN', 'ITEM', 'DESCRIPCION',
    'TOTAL PIEZAS', 'PROYECTO', 'FW', ETD, ETA, 'FECHA DE LLEGADA A ALMACEN', 'FECHA ESTIMADA DE DISPONIBILIDAD',
    'OBSERVACIONES', 'STATUS', null, null,
  ],
};

const PAISES = ['HK', 'CN', 'US', 'DE', 'MX'];
const FW = ['PARTNER3', 'PARTNER5', 'PARTNER 10', 'PARTNER10', 'PARTNER7'];
const TIPOS = ['AIR/HUB-A', 'SEA/FCL', 'COURIER', 'ROAD/BORDER', 'AIR/HUB-B', 'SEA/LCL'];
const PREFIJOS_OC = ['QXL', 'QWN', 'KRV', 'TZP', 'VXN', 'JQM', 'ZKB', 'XPD'];
const PROYECTOS = ['STOCK', 'MUESTRA', 'LOTE II', 'LOTE III'];
const OBS = [null, null, null, 'Pendiente de pago', 'Revisión de calidad', 'Reclamo por daño', 'Liberación parcial'];
const ESTATUS_ACTIVOS = [
  ['En Aduana', 30],
  ['Producto Solicitado', 20],
  ['En Preparación', 20],
  ['En Tránsito Aéreo', 10],
  ['En Tránsito Marítimo', 10],
  ['En Recolección', 5],
  ['En Almacén FW', 5],
];

/** Marcador de fecha: el emisor lo vuelve ISO (JSON) o serial tipado (xlsx). */
const F = (y, m, d) => ({ __fecha: { y, m, d } });

function fechaAdelante(rng, base, minDias, maxDias) {
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + rng.int(minDias, maxDias)));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

function filaEmbarque(rng, h, ctx) {
  const { sku, descr, historial } = ctx;
  const inicio = fechaAleatoria(rng, 1, 5);
  const recoleccion = fechaAdelante(rng, inicio, 1, 10);
  const etd = fechaAdelante(rng, recoleccion, 1, 9);
  const eta = fechaAdelante(rng, etd, 5, 25);
  const llegada = fechaAdelante(rng, eta, 2, 12);
  const disp = fechaAdelante(rng, llegada, 1, 5);
  const estatus = historial ? 'Producto Disponible' : rng.weighted(ESTATUS_ACTIVOS);
  const piezas = rng.chance(0.1) ? rng.int(500, 990) : rng.int(2, 480);
  const valor = {
    REFERENCIA: `REF-${rng.digitos(4)}`,
    'REFERENCIA PREVIA': `REF-${rng.digitos(4)}`,
    'REFERENCIA PARTNER3': `KL${rng.digitos(5)}`,
    'EMBARQUE PREVIO': `EMB-${rng.digitos(4)}`,
    'FACTURA COMERCIAL': rng.chance(0.3) ? `${rng.digitos(6)}/${rng.digitos(7)}` : rng.int(100000, 999999),
    FACTURA: rng.int(100000, 999999),
    'PAIS DE ORIGEN': rng.pick(PAISES),
    OC: rng.chance(0.15) ? rng.int(1000000, 9999999) : `${rng.pick(PREFIJOS_OC)}${rng.digitos(7)}`,
    'N° PO': rng.chance(0.2) ? rng.int(1000000, 9999999) : `${rng.pick(PREFIJOS_OC)}${rng.digitos(7)}`,
    ITEM: sku,
    DESCRIPCION: descr,
    'TOTAL PIEZAS': piezas,
    PIEZAS: piezas,
    'FECHA DE APROBACION': F(inicio.y, inicio.m, inicio.d),
    PROYECTO: rng.chance(0.55) ? `RETAILER${rng.int(1, 40)}` : rng.pick(PROYECTOS),
    NORTH: rng.chance(0.4) ? rng.int(1, 300) : null,
    EAST: rng.chance(0.1) ? rng.int(1, 300) : null,
    SOUTH: rng.chance(0.1) ? rng.int(1, 300) : null,
    FISCAL: rng.chance(0.1) ? rng.int(1, 300) : null,
    'FECHA DE FIN DE ALISTAMIENTO': rng.chance(0.7) ? F(recoleccion.y, recoleccion.m, recoleccion.d) : null,
    'FECHA DE FIN DE FABRICA': rng.chance(0.7) ? F(recoleccion.y, recoleccion.m, recoleccion.d) : null,
    'TARIMAS': `${rng.int(1, 4)} P`,
    FW: rng.pick(FW),
    'TIPO DE IMPORTACION': rng.pick(TIPOS),
    'FECHA DE RECOLECCION': rng.chance(0.85) ? F(recoleccion.y, recoleccion.m, recoleccion.d) : null,
    [ETD]: rng.chance(0.85) ? F(etd.y, etd.m, etd.d) : null,
    [ETA]: rng.chance(0.9) ? F(eta.y, eta.m, eta.d) : null,
    'FECHA DE LLEGADA A ALMACEN': rng.chance(0.5) ? F(llegada.y, llegada.m, llegada.d) : null,
    'FECHA ESTIMADA DE DISPONIBILIDAD': rng.chance(0.7) ? F(disp.y, disp.m, disp.d) : null,
    'FECHA DE DISPONIBILIDAD': rng.chance(0.7) ? F(disp.y, disp.m, disp.d) : null,
    OBSERVACIONES: rng.pick(OBS),
    ESTATUS: estatus,
    STATUS: estatus,
    'CANT. SOLICITADA': piezas,
  };
  // la REFERENCIA duplicada de la hoja de la bodega: la 1.ª columna casi siempre vacía
  let vistaRef = 0;
  return h.map((nombre) => {
    if (nombre === null) return null;
    if (nombre === 'REFERENCIA' && h.indexOf('REFERENCIA') !== h.lastIndexOf('REFERENCIA')) {
      return vistaRef++ === 0 ? null : valor.REFERENCIA;
    }
    return valor[nombre] === undefined ? null : valor[nombre];
  });
}

/**
 * Hojas de aduana de una era. `plan`: [{hoja, tipo, n, historial?, banner?, leyenda?, descartada?}]
 * `universo`: SKU del universo de productos (los embarques los referencian); `fuera` = embarques
 * cuyo SKU NO está en el universo (cuarentena referencial). Devuelve hojas con `filas` (arreglos
 * con marcadores de fecha) y las cifras por construcción.
 */
export function construirAduana(rng, universo, descrPorSku, plan, { fuera = 3 } = {}) {
  const universoArr = [...universo];
  const usados = new Set(universoArr.map((s) => s.toUpperCase()));
  const skusFuera = Array.from({ length: fuera }, () => nuevoSku(rng, usados));
  let fueraPorColocar = fuera;
  const hojas = [];
  for (const p of plan) {
    const h = ENCABEZADOS[p.tipo];
    const filas = [];
    let conItem = 0;
    let fueraEnHoja = 0;
    const skusHoja = [];
    for (let i = 0; i < p.n; i++) {
      let sku;
      let descr;
      if (fueraPorColocar > 0 && !p.descartada && p.n > 3 && i === 1) {
        sku = skusFuera[fuera - fueraPorColocar];
        fueraPorColocar--;
        fueraEnHoja++;
        descr = nuevaDescripcion(rng);
      } else {
        // los SKU se repiten entre hojas a propósito (mismo SKU en varios embarques)
        sku = rng.pick(universoArr);
        descr = descrPorSku.get(sku.toUpperCase()) ?? nuevaDescripcion(rng);
      }
      filas.push(filaEmbarque(rng, h, { sku, descr, historial: !!p.historial }));
      skusHoja.push(sku);
      conItem++;
    }
    hojas.push({
      hoja: p.hoja,
      tipo: p.tipo,
      historial: !!p.historial,
      banner: !!p.banner,
      leyenda: !!p.leyenda,
      descartada: !!p.descartada,
      filas,
      conItem,
      fueraEnHoja,
      skusHoja,
      extras: p.extras ?? {},
    });
  }
  return { hojas, skusFuera };
}

/** Conteos por construcción: solo hojas cuyo encabezado trae ITEM y ESTATUS cuentan como embarques. */
export function derivarAduana(hojasAduana) {
  const embarques = hojasAduana.hojas.filter((h) => !h.descartada && h.tipo !== 'oc' && h.tipo !== 'garantias');
  const porHoja = embarques.map((h) => ({ hoja: h.hoja, total: h.conItem, historial: h.historial }));
  const total = porHoja.reduce((s, x) => s + x.total, 0);
  const fuera = embarques.reduce((s, h) => s + h.fueraEnHoja, 0);
  const historiales = porHoja.filter((x) => x.historial).reduce((s, x) => s + x.total, 0);
  return { porHoja, total, fuera, historiales, activos: total - historiales, hojasTotales: hojasAduana.hojas.length };
}

/** Convierte un valor del modelo a celda: modo 'json' → ISO `T00:00:00`; modo 'xlsx' → marcador tipado. */
function celda(v, modo) {
  if (v !== null && typeof v === 'object' && v.__fecha) {
    const { y, m, d } = v.__fecha;
    return modo === 'json' ? `${iso(y, m, d)}T00:00:00` : { __serial: serialExcel(y, m, d) };
  }
  return v;
}

/**
 * Emite el grid de una hoja. Rarezas: banner `ALMACEN DE INGRESO` en la fila 1 (hojas históricas),
 * filas sin ITEM con descripción y piezas (subtotales), fila TOTALES, leyenda vertical de estatus
 * en la última columna extra, columnas extra sin encabezado.
 */
export function gridAduana(hoja, modo) {
  const h = ENCABEZADOS[hoja.tipo];
  const ancho = h.length;
  const filas = hoja.filas.map((f) => f.map((v) => celda(v, modo)));
  const idxItem = h.indexOf('ITEM');
  const idxDesc = h.indexOf('DESCRIPCION');
  const idxPiezas = Math.max(h.indexOf('TOTAL PIEZAS'), h.indexOf('PIEZAS'));
  const vacia = () => new Array(ancho).fill(null);

  const cuerpo = [];
  const ex = hoja.extras;
  filas.forEach((f, i) => {
    cuerpo.push(f);
    // subtotales sin ITEM (descripción + piezas), cada cierto número de filas
    if (ex.subtotales && (i + 1) % ex.subtotales === 0 && idxDesc >= 0) {
      const s = vacia();
      s[idxDesc] = 'Subtotal';
      if (idxPiezas >= 0) s[idxPiezas] = 120 + i;
      cuerpo.push(s);
    }
  });
  if (ex.fechasMixtas && modo === 'json') {
    // un serial de Excel y un dd-mmm-yy dentro del JSON, para ejercer parseFecha desde el fixture
    const iEta = h.indexOf(ETA);
    const iLleg = h.indexOf('FECHA DE LLEGADA A ALMACEN');
    const ref = filas[0];
    if (ref && ref[iEta] !== null) ref[iEta] = 48000 + (filas.length % 300);
    const ref2 = filas[1];
    if (ref2 && iLleg >= 0) ref2[iLleg] = '14-feb-31';
  }
  if (ex.totales && idxItem >= 0) {
    const t = vacia();
    t[idxItem] = 'TOTALES';
    if (idxPiezas >= 0) t[idxPiezas] = 999;
    cuerpo.push(t);
  }
  for (let i = 0; i < (ex.vacias ?? 0); i++) cuerpo.push(vacia());
  if (hoja.tipo === 'garantias') {
    // 5 filas vacías y una leyenda suelta en la última columna
    for (let i = 0; i < 5; i++) cuerpo.push(vacia());
    cuerpo[cuerpo.length - 1][ancho - 1] = 'Producto Disponible';
  }
  if (hoja.leyenda) {
    // leyenda vertical de estatus: última columna extra, desde la fila 2 (índice 1 del grid)
    ESTATUS_PIPELINE.forEach((e, i) => {
      while (cuerpo.length <= i) cuerpo.push(vacia());
      cuerpo[i][ancho - 1] = e;
    });
  }
  const grid = [];
  if (hoja.banner) {
    const b = vacia();
    b[9] = 'ALMACEN DE INGRESO';
    grid.push(b);
  }
  grid.push([...h]);
  grid.push(...cuerpo);
  // asegura el ancho uniforme
  for (const r of grid) while (r.length < ancho) r.push(null);
  return grid;
}
