// ============================================================
// scripts/datos-muestra/modelo-stock.mjs
// MODELO (no grids) de los datos de STOCK de ejemplo: productos de Inventario,
// filas de la hoja de la bodega externa (WEST) y la hoja pivote Reserva.
//
// Todo se inventa desde la semilla fija. Las cifras que las pruebas aseveran se
// calculan AQUÍ, a partir del modelo (por construcción): no se leen de los
// parsers, para que una prueba que compara parser vs. constante pruebe algo.
// ============================================================
import {
  Rng,
  nuevoSku,
  nuevaDescripcion,
  fechaAleatoria,
  fechaEs,
  FAMILIAS,
  MARCAS_SEMBRADAS,
  KAM_SEMBRADOS,
  KAM_NO_SEMBRADOS,
} from './base.mjs';

// ------------------------------------------------------------
// SKU testigo: los fijan las pruebas (el generador debe emitirlos con estos atributos)
// ------------------------------------------------------------

/** SKU dorado de Inventario: mismo dato de negocio en las 3 eras (primera fila de datos). */
export const DORADO_INV = {
  sku: '0875-7566-14',
  marca: 'BRAND5',
  familia: 'BRAND5',
  clase: 'C',
  descr: 'CABLE DE PRUEBA 125 V',
  north: 7,
};

/** SKU dorado de la hoja de la bodega externa: físico 5 en las 3 eras (primera fila de datos). Existe también en Inventario. */
export const DORADO_WEST = {
  sku: '0861-5844-9317',
  prov: 'SERIES5',
  fisico: 5,
  descr: 'SERIES11 AM ALFA SYSTEM 40 IN',
  descrUnificado: 'SERIES11 AM ALFA SYSTEM 40 IN ADJUSTABLE BASE',
  tecnologia: 'EAS',
  familiaUnificado: 'SERIES11 ALFA',
  claseUnificado: 'A',
  // atributos que el SKU lleva en Inventario (abril/julio/unificado)
  marcaInv: 'SERIES5',
  familiaInv: 'SERIES11',
  claseInv: 'B',
  north: 12,
};

/** SKU solo en la bodega externa, con el formato de FISICO que ejerce cada patrón numérico europeo. */
export const WEST_TESTIGOS = [
  { sku: '2444N-M', prov: 'VERTICAL', fisico: 3, texto: '3,00', descr: 'Wireless remote K44 2M' },
  { sku: '7802-1101-3426', prov: 'CARGADOR', fisico: 13472, texto: '13.472,00', descr: 'Charger kit R12 24V' },
  { sku: '3818-3500-5293', prov: 'BRAND3', fisico: 3915, texto: '3.915,00', descr: 'Label roll T61 40MM' },
];

/** SKU que solo vive en la hoja de la bodega externa del libro unificado (marca de dos palabras, clase vacía). */
export const WEST_UNIFICADO_SOLO = {
  sku: 'Q017-07-R99',
  marca: 'BRAND 6',
  tecnologia: 'EAS',
  familia: 'TAG',
  clase: null,
  descr: 'Security tag Q17 58MM',
  fisico: 10,
};

// ------------------------------------------------------------
// Utilidades de normalización (espejo MÍNIMO de la regla de negocio, para el oráculo)
// ------------------------------------------------------------

const norm = (m) => m.replace(/\s+/g, ' ').trim().toUpperCase();

/** Marca con la que el ETL resuelve una marca escrita: WEST (almacén) → NACIONAL; «BRAND 6» → BRAND6 (alias). */
export function marcaEfectiva(m) {
  let c = norm(m);
  if (c === 'WEST') c = 'NACIONAL';
  if (c === 'BRAND 6') c = 'BRAND6';
  return c;
}

export const esMarcaSembrada = (m) => MARCAS_SEMBRADAS.includes(marcaEfectiva(m));

// ------------------------------------------------------------
// Productos de Inventario
// ------------------------------------------------------------

const PESO_MARCA = [
  ['BRAND1', 30],
  ['BRAND5', 12],
  ['BRAND9', 8],
  ['BRAND2', 8],
  ['BRAND3', 6],
  ['GENERAL', 8],
  ['SERIES5', 8],
  ['BRAND6', 5],
  ['VERTICAL', 5],
  ['EAS', 4],
  ['CARGADOR', 4],
];

const TECNOLOGIAS = ['EAS', 'RFID', 'CCTV', 'BRAND1'];

// Cantidades siempre de 3 dígitos o menos: así ninguna celda numérica de un .xlsx forma, junto a sus vecinas,
// una secuencia que un detector de teléfonos confundiría con un número (2–3 dígitos · 3–4 dígitos · 4 dígitos).
function cantidad(rng) {
  return rng.chance(0.15) ? rng.int(150, 400) : rng.int(1, 120);
}

function productoBase(rng, usados, { tecnologia, numericos }) {
  const marca = rng.weighted(PESO_MARCA);
  let familia;
  if (rng.chance(0.12)) familia = 'SERIES11';
  else if (rng.chance(0.1)) familia = marca;
  else familia = rng.pick(FAMILIAS);
  const alm = { north: 0, south: 0, east: 0, tran: 0, bo: 0 };
  if (rng.chance(0.7)) alm.north = cantidad(rng);
  if (rng.chance(0.06)) alm.east = cantidad(rng);
  if (rng.chance(0.06)) alm.tran = cantidad(rng);
  if (rng.chance(0.12)) alm.bo = cantidad(rng);
  return {
    sku: nuevoSku(rng, usados, { numericos }),
    skuTexto: null, // null = se escribe tal cual `sku`
    cliente: rng.chance(0.25) ? `RETAILER${rng.int(1, 40)}` : null,
    marca,
    familia,
    tecnologia: tecnologia ? rng.pick(TECNOLOGIAS) : null,
    clase: rng.weighted([
      ['A', 3],
      ['B', 3],
      ['C', 4],
    ]),
    descr: nuevaDescripcion(rng),
    alm,
    resv: 0,
  };
}

/**
 * Productos de Inventario de una era. `productos[0]` es el SKU dorado de
 * Inventario y `productos[1]` el dorado de la bodega externa (existe en ambas hojas).
 * Rarezas estructurales que las pruebas ejercitan (en filas distintas, sin tocar las 2 doradas).
 */
export function construirProductos(rng, { n, tecnologia = false, marcaBodega = 6, miles = false, numericos = true }) {
  const usados = new Set([DORADO_INV.sku, DORADO_WEST.sku].map((s) => s.toUpperCase()));
  const productos = [];
  const dorado = {
    sku: DORADO_INV.sku,
    skuTexto: null,
    cliente: null,
    marca: DORADO_INV.marca,
    familia: DORADO_INV.familia,
    tecnologia: tecnologia ? 'EAS' : null,
    clase: DORADO_INV.clase,
    descr: DORADO_INV.descr,
    alm: { north: DORADO_INV.north, south: 0, east: 0, tran: 0, bo: 0 },
    resv: 0,
  };
  const doradoWest = {
    sku: DORADO_WEST.sku,
    skuTexto: null,
    cliente: null,
    marca: DORADO_WEST.marcaInv,
    familia: DORADO_WEST.familiaInv,
    tecnologia: tecnologia ? 'EAS' : null,
    clase: DORADO_WEST.claseInv,
    descr: DORADO_WEST.descr,
    alm: { north: DORADO_WEST.north, south: 0, east: 0, tran: 0, bo: 0 },
    resv: 0,
  };
  productos.push(dorado, doradoWest);
  while (productos.length < n) productos.push(productoBase(rng, usados, { tecnologia, numericos }));

  // Rarezas: se reparten en posiciones distintas (nunca las dos primeras).
  const libres = rng.shuffle(Array.from({ length: n - 2 }, (_, i) => i + 2));
  const toma = (k) => libres.splice(0, k);
  for (const i of toma(marcaBodega)) productos[i].marca = 'WEST'; // la bodega externa escrita en MARCA
  for (const i of toma(3)) productos[i].marca = 'NACIONAL';
  for (const i of toma(1)) productos[i].marca = 'brand1'; // misma marca, caja distinta (alias sembrado)
  for (const i of toma(2)) productos[i].marca = 'BRAND 6'; // marca de dos palabras (alias sembrado)
  for (const i of toma(2)) productos[i].skuTexto = productos[i].sku.toLowerCase(); // SKU en minúscula
  const rarasClase = ['0', '0', 'OBSOLETO', 'a', '#N/D', 'NUEVO'];
  for (const c of rarasClase) productos[toma(1)[0]].clase = c;
  for (const i of toma(10)) productos[i].clase = null;
  for (const i of toma(4)) productos[i].familia = null;
  for (const i of toma(1)) productos[i].descr = null;
  if (miles) {
    // una existencia de 4 dígitos: la columna QTY la muestra con formato de miles («1.250»)
    productos[2].alm = { north: 1250, south: 0, east: 0, tran: 0, bo: 0 };
  }
  return productos;
}

// ------------------------------------------------------------
// Hoja de la bodega externa (WEST)
// ------------------------------------------------------------

const PESO_PROV = [
  ['VERTICAL', 45],
  ['SERIES5', 15],
  ['BRAND 6', 10],
  ['NACIONAL', 8],
  ['CARGADOR', 12],
  ['BRAND3', 10],
];

function fisicoAleatorio(rng, { miles = false } = {}) {
  return rng.weighted([
    [() => rng.int(1, 9), 70],
    [() => rng.int(10, 99), 20],
    [() => rng.int(100, 999), 6],
    [() => (miles ? rng.int(1000, 9999) : rng.int(100, 400)), 4],
  ])();
}

/** Texto europeo de un entero: «5,00», «123,00», «3.915,00», «13.472,00». */
export function fisicoTextoEuropeo(n) {
  const s = String(n);
  const conMiles = s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conMiles},00`;
}

/**
 * Filas de WEST: la primera es el dorado (matched), luego `matched-1` SKU de
 * Inventario, los tres testigo (nuevos) y SKU nuevos hasta completar `n`.
 * `unificado` añade tecnología/familia/clase y el SKU solo-WEST de marca de dos palabras.
 */
export function construirWest(rng, productos, usadosExtra, { n, matched, unificado = false, descrNula = true, testigosReales = true, miles = false, numericos = true }) {
  const usados = new Set(usadosExtra);
  const filas = [];
  const fila = (o) => ({
    sku: o.sku,
    prov: o.prov,
    fisico: o.fisico,
    descr: o.descr ?? null,
    tecnologia: null,
    familia: null,
    clase: null,
    ...o,
  });
  filas.push(
    fila({
      sku: DORADO_WEST.sku,
      prov: DORADO_WEST.prov,
      fisico: DORADO_WEST.fisico,
      descr: unificado ? DORADO_WEST.descrUnificado : DORADO_WEST.descr,
      tecnologia: unificado ? DORADO_WEST.tecnologia : null,
      familia: unificado ? DORADO_WEST.familiaUnificado : null,
      clase: unificado ? DORADO_WEST.claseUnificado : null,
    }),
  );

  // matched: SKU de Inventario (distintos del dorado de Inventario y del dorado de WEST)
  const candidatos = rng.shuffle(productos.slice(2).map((p) => p.sku));
  const resto = [];
  for (const sku of candidatos.slice(0, matched - 1)) {
    resto.push(
      fila({
        sku,
        prov: rng.weighted(PESO_PROV),
        fisico: fisicoAleatorio(rng, { miles }),
        descr: nuevaDescripcion(rng),
        ...(unificado ? atributosUnificado(rng) : {}),
      }),
    );
  }
  for (const t of WEST_TESTIGOS) {
    usados.add(t.sku.toUpperCase());
    resto.push(
      fila({
        sku: t.sku,
        prov: t.prov,
        // los formatos de miles (3,00 · 13.472,00 · 3.915,00) viven en el fixture de abril (texto);
        // en los libros .xlsx el físico de esos SKU es un número chico
        fisico: testigosReales ? t.fisico : rng.int(1, 99),
        descr: t.descr,
        ...(unificado ? atributosUnificado(rng) : {}),
      }),
    );
  }
  if (unificado) {
    usados.add(WEST_UNIFICADO_SOLO.sku.toUpperCase());
    resto.push(
      fila({
        sku: WEST_UNIFICADO_SOLO.sku,
        prov: WEST_UNIFICADO_SOLO.marca,
        fisico: WEST_UNIFICADO_SOLO.fisico,
        descr: WEST_UNIFICADO_SOLO.descr,
        tecnologia: WEST_UNIFICADO_SOLO.tecnologia,
        familia: WEST_UNIFICADO_SOLO.familia,
        clase: WEST_UNIFICADO_SOLO.clase,
      }),
    );
  }
  while (filas.length + resto.length < n) {
    resto.push(
      fila({
        sku: nuevoSku(rng, usados, { numericos }),
        prov: rng.weighted(PESO_PROV),
        fisico: fisicoAleatorio(rng, { miles }),
        descr: nuevaDescripcion(rng),
        ...(unificado ? atributosUnificado(rng) : {}),
      }),
    );
  }
  const mezcladas = rng.shuffle(resto);
  // una descripción vacía (rareza), sin tocar a los testigo
  if (descrNula) {
    const i = mezcladas.findIndex((f) => !WEST_TESTIGOS.some((t) => t.sku === f.sku) && f.sku !== WEST_UNIFICADO_SOLO.sku);
    if (i >= 0) mezcladas[i].descr = null;
  }
  const final = [...filas, ...mezcladas];
  if (!numericos) {
    // un SKU numérico (9999-9999-…) justo después de un físico de 2–3 dígitos se lee como teléfono: el físico previo pasa a 1 dígito
    for (let i = 1; i < final.length; i++) {
      if (/^d{3,4}-d{4}/.test(final[i].sku)) final[i - 1].fisico = rng.int(1, 9);
    }
  }
  return final;
}

function atributosUnificado(rng) {
  return {
    tecnologia: rng.pick(['EAS', 'RFID', 'CCTV']),
    familia: rng.pick(FAMILIAS),
    clase: rng.pick(['A', 'B', 'C']),
  };
}

// ------------------------------------------------------------
// Hoja pivote Reserva
// ------------------------------------------------------------

const MOTIVOS = ['pedido A', 'pedido B', 'proyecto otoño', 'ajuste mensual', 'cuenta clave', 'muestra', 'campaña 3'];

/**
 * Columnas de cliente del pivote. `tipo`:
 *  ok · anio3 (año de 3 dígitos → fecha malformada) · texto (MARZO → malformada)
 *  vacia (sin fecha → sentinel) · serial (fecha tipada en xlsx; texto en JSON) · sinCliente (celda de cliente vacía)
 */
export function construirColumnasReserva(rng, { nClientes, anio3 = 1, texto = 1, vacia = 1, serial = 0, sinCliente = 0, totales = false }) {
  const numeros = rng.shuffle([12, 7, 33, 45, 21, 9, 38, 17, 52, 29, 41, 3, 60, 14, 26, 48, 5, 36]);
  const kams = [...KAM_SEMBRADOS.filter((k) => ['LAURA', 'LUCAS', 'JULIO', 'DIEGO', 'HUGO'].includes(k)), ...KAM_NO_SEMBRADOS.slice(0, 2)];
  const cols = [];
  for (let i = 0; i < nClientes; i++) {
    let cliente = `RETAILER${numeros[i % numeros.length]}`;
    if (i === 3) cliente = 'RETAILER 56'; // variante con espacio
    if (i === 4) cliente = `retailer${numeros[i]}`; // minúsculas
    if (i === 5) cliente = 'stock'; // columna de existencias, en minúsculas
    if (i === 6) cliente = `RETAILER${numeros[6]} STORE3`; // con prefijo de tienda
    if (i === 8) cliente = cols[2].cliente; // duplicada (otro KAM y otro motivo)
    cols.push({
      cliente,
      kam: i % 6 === 5 ? null : kams[i % kams.length],
      motivo: i % 5 === 4 ? null : MOTIVOS[i % MOTIVOS.length],
      tipo: 'ok',
      fecha: fechaAleatoria(rng, 1, 12),
    });
  }
  // la columna duplicada difiere en KAM y motivo: así la clave de reserva no se repite
  cols[8].kam = cols[2].kam === 'LAURA' ? 'LUCAS' : 'LAURA';
  cols[8].motivo = 'ajuste mensual';
  // tipos de fecha especiales, en columnas que no son las duplicadas
  const libres = rng.shuffle([...cols.keys()].filter((i) => ![2, 8].includes(i)));
  const asigna = (tipo, k) => libres.splice(0, k).forEach((i) => (cols[i].tipo = tipo));
  asigna('anio3', anio3);
  asigna('texto', texto);
  asigna('vacia', vacia);
  asigna('serial', serial);
  asigna('sinCliente', sinCliente);
  return { columnas: cols, totales };
}

/**
 * Celdas del pivote. Cada SKU con reserva ocupa 1 fila (2 los `repetidos`).
 * Devuelve filas [{sku, celdas: {k: cantidad}}], donde k = índice de columna de cliente.
 */
export function construirCeldasReserva(rng, skus, columnas, { repetidos = 2, celdasMalformadas = 4 }) {
  const buenas = columnas.map((c, i) => [c, i]).filter(([c]) => ['ok', 'vacia', 'serial'].includes(c.tipo)).map(([, i]) => i);
  const malas = columnas.map((c, i) => [c, i]).filter(([c]) => ['anio3', 'texto'].includes(c.tipo)).map(([, i]) => i);
  const sinCliente = columnas.map((c, i) => [c, i]).filter(([c]) => c.tipo === 'sinCliente').map(([, i]) => i);
  const filas = [];
  const rep = new Set(skus.slice(0, repetidos));
  let malasPorPoner = celdasMalformadas;
  let vaciasPorPoner = sinCliente.length;
  for (const sku of skus) {
    const k = rng.int(1, 4);
    const cols = rng.shuffle(buenas).slice(0, k);
    const celdas = {};
    for (const c of cols) celdas[c] = rng.chance(0.2) ? rng.int(60, 150) : rng.int(1, 60);
    if (malasPorPoner > 0 && malas.length && rng.chance(0.15)) {
      celdas[rng.pick(malas)] = rng.int(1, 30);
      malasPorPoner--;
    }
    if (vaciasPorPoner > 0 && rng.chance(0.1)) {
      celdas[sinCliente[0]] = rng.int(1, 30);
      vaciasPorPoner--;
    }
    if (rep.has(sku) && Object.keys(celdas).length >= 2) {
      // la fila repetida reparte sus celdas en dos filas del mismo SKU
      const ks = Object.keys(celdas);
      const a = {};
      const b = {};
      ks.forEach((key, idx) => ((idx % 2 === 0 ? a : b)[key] = celdas[key]));
      filas.push({ sku, celdas: a }, { sku, celdas: b });
    } else {
      filas.push({ sku, celdas });
    }
  }
  // garantías: celdas malformadas / sin cliente colocadas aunque el azar no las haya puesto
  const faltanMalas = malas.length ? celdasMalformadas - contarCeldas(filas, malas) : 0;
  for (let i = 0; i < faltanMalas; i++) filas[i * 2 + 1].celdas[malas[i % malas.length]] = rng.int(1, 30);
  if (sinCliente.length && contarCeldas(filas, sinCliente) === 0) filas[filas.length - 1].celdas[sinCliente[0]] = rng.int(1, 30);
  // total-fuente (col B): suma de la fila casi siempre; algunas filas no cuadran (la columna se ignora)
  for (const f of filas) {
    const suma = Object.values(f.celdas).reduce((s, v) => s + v, 0);
    f.totalFuente = rng.chance(0.85) ? suma : suma + rng.int(1, 9);
  }
  return filas;
}

function contarCeldas(filas, cols) {
  let n = 0;
  for (const f of filas) for (const c of cols) if (f.celdas[c] !== undefined) n++;
  return n;
}

/** Fecha `dd-mmm-yy` de una columna, o el texto especial. */
export function textoFechaColumna(col) {
  if (col.tipo === 'anio3') return `${String(col.fecha.d).padStart(2, '0')} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][col.fecha.m - 1]} 264`;
  if (col.tipo === 'texto') return 'MARZO';
  if (col.tipo === 'vacia') return null;
  return fechaEs(col.fecha);
}

// ------------------------------------------------------------
// Oráculo: cifras por construcción (a partir del modelo, sin pasar por los parsers)
// ------------------------------------------------------------

/** Σ de cantidades válidas por SKU y conteos de cuarentena de la hoja Reserva. */
export function derivarReserva(columnas, filas, skusDeProducto) {
  const sumaPorSku = new Map();
  let validas = 0;
  let malformadas = 0;
  let clienteVacio = 0;
  let sinProducto = 0;
  for (const f of filas) {
    for (const [k, qty] of Object.entries(f.celdas)) {
      const col = columnas[Number(k)];
      if (col.tipo === 'sinCliente') {
        clienteVacio++;
        continue;
      }
      if (col.tipo === 'anio3' || col.tipo === 'texto') {
        malformadas++;
        continue;
      }
      if (!skusDeProducto.has(f.sku.toUpperCase())) {
        sinProducto++;
        continue;
      }
      validas++;
      const key = f.sku.toUpperCase();
      sumaPorSku.set(key, (sumaPorSku.get(key) ?? 0) + qty);
    }
  }
  return { validas, malformadas, clienteVacio, sinProducto, sumaPorSku };
}

/** Fija `resv` de cada producto: mitad en paridad con Σ reservas, mitad descuadrada. */
export function asignarResv(rng, productos, sumaPorSku, { paridad = 0.5 } = {}) {
  for (const p of productos.slice(2)) {
    const s = sumaPorSku.get(p.sku.toUpperCase());
    if (s === undefined) {
      p.resv = rng.chance(0.08) ? rng.int(1, 40) : 0;
    } else {
      p.resv = rng.chance(paridad) ? s : s + rng.int(1, 9);
    }
  }
}

const totalAlm = (p) => p.alm.north + p.alm.south + p.alm.east + p.alm.tran + p.alm.bo;
export const totalProducto = totalAlm;

/**
 * Cifras reconciliadas de una era: conteos que las pruebas aseveran.
 * Invariantes: productosReconciliados = productos + westNuevos · stockReconciliado = stockInventario + west ·
 * westMatched + westNuevos = filas west.
 */
export function derivarStock(productos, west, reserva) {
  const skus = new Set(productos.map((p) => p.sku.toUpperCase()));
  const nuevos = west.filter((w) => !skus.has(w.sku.toUpperCase()));
  const matched = west.length - nuevos.length;
  const universo = new Set([...skus, ...nuevos.map((w) => w.sku.toUpperCase())]);
  const res = derivarReserva(reserva.columnas, reserva.filas, universo);

  const stockInventario = productos.reduce((s, p) => s + Object.values(p.alm).filter((v) => v > 0).length, 0);
  const stockReconciliado = stockInventario + west.filter((w) => w.fisico > 0).length;

  // DIAG de los gates: Σ stock (sin WEST) vs TOTAL (siempre cuadran: TOTAL = Σ) y Σ reservas vs RESV
  let diagReservas = 0;
  let paridad = 0;
  const todos = [...productos.map((p) => [p.sku.toUpperCase(), p.resv]), ...nuevos.map((w) => [w.sku.toUpperCase(), 0])];
  for (const [sku, resv] of todos) {
    const s = res.sumaPorSku.get(sku) ?? 0;
    if (s !== resv) diagReservas++;
    else paridad++;
  }

  // marcas y familias que el ETL daría de alta (catálogo semilla: solo MARCAS_SEMBRADAS; familias VACÍAS)
  const marcasProductos = productos.map((p) => marcaEfectiva(p.marca));
  const marcasNuevasWest = nuevos.map((w) => marcaEfectiva(w.prov));
  const marcasNuevas = [...new Set([...marcasProductos, ...marcasNuevasWest].filter((m) => !MARCAS_SEMBRADAS.includes(m)))].sort();
  const familias = [...new Set([...productos.map((p) => p.familia), ...nuevos.map((w) => w.familia)].filter((f) => f !== null).map(norm))].sort();
  const nacional = [...marcasProductos, ...marcasNuevasWest].filter((m) => m === 'NACIONAL').length;
  const marcaBodega = productos.filter((p) => norm(p.marca) === 'WEST').length;

  return {
    productosInventario: productos.length,
    stockInventario,
    westRows: west.length,
    westMatched: matched,
    westNuevos: nuevos.length,
    productosReconciliados: productos.length + nuevos.length,
    stockReconciliado,
    reservas: res.validas,
    reservasMalformadas: res.malformadas,
    reservasClienteVacio: res.clienteVacio,
    reservasSinProducto: res.sinProducto,
    diagReservas,
    enParidad: paridad,
    diagStock: 0,
    marcasNuevas,
    familiasNuevas: familias,
    marcaBodega,
    productosNacional: nacional,
    skusReconciliados: [...universo],
  };
}

/** RNG de una era (flujo independiente por etiqueta). */
export const rngDe = (etiqueta) => new Rng(etiqueta);
