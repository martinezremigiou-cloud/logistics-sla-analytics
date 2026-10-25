// ============================================================
// scripts/datos-muestra/generador.mjs
// Orquesta los modelos y devuelve, SIN tocar disco:
//   · json:  texto de cada fixture versionado (ruta relativa a la raíz del repo → contenido)
//   · libros: libros .xlsx de muestra (ruta relativa → hojas con su grid)
//   · constantes: el manifiesto por construcción (cardinalidades, SKU testigo, sumas)
// Determinista: la misma semilla (base.mjs) produce los mismos bytes.
// ============================================================
import { Rng, SEMILLA, ANIO, KAM_SEMBRADOS, KAM_NO_SEMBRADOS, MARCAS_NUEVAS_TESTIGO } from './base.mjs';
import {
  DORADO_INV, DORADO_WEST, WEST_TESTIGOS, WEST_UNIFICADO_SOLO,
  construirProductos, construirWest, construirColumnasReserva, construirCeldasReserva,
  derivarStock, asignarResv,
} from './modelo-stock.mjs';
import { construirAduana, derivarAduana, gridAduana } from './modelo-aduana.mjs';
import { construirCinco } from './modelo-cinco.mjs';
import { gridInventario, gridWest, gridReserva, gridCompras, gridCinco } from './grids.mjs';
import { EDGE, gridsEdge } from './edge.mjs';
import { construirParche } from './modelo-parche.mjs';

export const RUTA_FIXTURES = 'src/services/etl/__tests__/fixtures';
export const RUTA_MUESTRA = 'muestra';

export const NOMBRES_LIBROS = {
  unificado: `${RUTA_MUESTRA}/inventario-unificado.xlsx`,
  julio: `${RUTA_MUESTRA}/inventario-julio.xlsx`,
  aduana: `${RUTA_MUESTRA}/seguimiento-embarques.xlsx`,
  cinco: `${RUTA_MUESTRA}/libro-5niveles/inventario-5niveles.xlsx`,
};

// ------------------------------------------------------------
// Serialización determinista (una fila por línea: diffs legibles)
// ------------------------------------------------------------
const filaJson = (f) => JSON.stringify(f);
const gridJson = (g) => `[\n${g.map(filaJson).join(',\n')}\n]\n`;
const hojasJson = (hojas) =>
  `[\n${hojas.map((h) => `{"hoja":${JSON.stringify(h.hoja)},"grid":[\n${h.grid.map(filaJson).join(',\n')}\n]}`).join(',\n')}\n]\n`;

/** Configuración de la era del libro unificado (la reutiliza también el modelo del parche de clasificación). */
export const CFG_UNIFICADO = {
  productos: 123, west: 41, matched: 8, skusReserva: 40, unificado: true,
  columnas: { nClientes: 14, anio3: 1, texto: 1, vacia: 1, serial: 1, sinCliente: 0, totales: true },
  repetidos: 2, celdasMalformadas: 4,
};

// ------------------------------------------------------------
// Una era de STOCK (productos + west + reserva) y sus cifras
// ------------------------------------------------------------
export function eraStock(etiqueta, cfg) {
  const productos = construirProductos(new Rng(`${etiqueta}-inv`), { n: cfg.productos, tecnologia: cfg.unificado, marcaBodega: cfg.marcaBodega ?? 6, miles: !!cfg.estiloAbril, numericos: !!cfg.estiloAbril });
  const usados = new Set(productos.map((p) => p.sku.toUpperCase()));
  const west = construirWest(new Rng(`${etiqueta}-west`), productos, usados, {
    n: cfg.west,
    matched: cfg.matched,
    unificado: !!cfg.unificado,
    testigosReales: !!cfg.estiloAbril,
    miles: !!cfg.estiloAbril,
    numericos: !!cfg.estiloAbril,
  });

  const columnas = construirColumnasReserva(new Rng(`${etiqueta}-cols`), cfg.columnas);
  // SKU con reserva: de Inventario, sin las dos doradas ni los de minúscula (las doradas conservan sus atributos tal cual)
  const candidatos = new Rng(`${etiqueta}-cand`).shuffle(productos.slice(2).map((p) => p.sku));
  const skusReserva = candidatos.slice(0, cfg.skusReserva);
  const filas = construirCeldasReserva(new Rng(`${etiqueta}-celdas`), skusReserva, columnas.columnas, {
    repetidos: cfg.repetidos ?? 2,
    celdasMalformadas: cfg.celdasMalformadas ?? 4,
  });
  const reserva = { columnas: columnas.columnas, filas, totales: columnas.totales };

  // resv por producto: mitad en paridad con Σ reservas válidas, mitad descuadrada
  const sumas = sumaValidaPorSku(reserva);
  asignarResv(new Rng(`${etiqueta}-resv`), productos, sumas, { paridad: 0.5 });
  const cifras = derivarStock(productos, west, reserva);
  return { productos, west, reserva, cifras };
}

function sumaValidaPorSku(reserva) {
  const m = new Map();
  for (const f of reserva.filas) {
    for (const [k, qty] of Object.entries(f.celdas)) {
      const col = reserva.columnas[Number(k)];
      if (col.tipo === 'sinCliente' || col.tipo === 'anio3' || col.tipo === 'texto') continue;
      const key = f.sku.toUpperCase();
      m.set(key, (m.get(key) ?? 0) + qty);
    }
  }
  return m;
}

/** KAM (en MAYÚSCULAS) con al menos una reserva válida. */
function kamsConReserva(reserva) {
  const out = new Set();
  for (const f of reserva.filas) {
    for (const k of Object.keys(f.celdas)) {
      const col = reserva.columnas[Number(k)];
      if (['sinCliente', 'anio3', 'texto'].includes(col.tipo)) continue;
      if (col.kam) out.add(col.kam.toUpperCase());
    }
  }
  return [...out].sort();
}

function resumenEra(e, extra = {}) {
  const c = e.cifras;
  return {
    productosInventario: c.productosInventario,
    stockInventario: c.stockInventario,
    westRows: c.westRows,
    westMatched: c.westMatched,
    westNuevos: c.westNuevos,
    productosReconciliados: c.productosReconciliados,
    stockReconciliado: c.stockReconciliado,
    reservas: c.reservas,
    reservasMalformadas: c.reservasMalformadas,
    reservasClienteVacio: c.reservasClienteVacio,
    reservasSinProducto: c.reservasSinProducto,
    diagReservas: c.diagReservas,
    diagStock: c.diagStock,
    enParidad: c.enParidad,
    marcasNuevas: c.marcasNuevas,
    familiasNuevas: c.familiasNuevas,
    marcaBodega: c.marcaBodega,
    productosNacional: c.productosNacional,
    kamsConReserva: kamsConReserva(e.reserva),
    ...extra,
  };
}

const HOJA_OC = { hoja: 'OC ABIERTAS', tipo: 'oc', descartada: true };

/** Aduana: plan de hojas por era (abril: 9; julio: 10 con la hoja nueva no listada PARTNER9). */
function planAduana(era) {
  if (era === 'abril') {
    return [
      { ...HOJA_OC, n: 8 },
      { hoja: 'BRAND1', tipo: 'marcaA', n: 30, leyenda: true, extras: { subtotales: 12 } },
      { hoja: 'BRAND3', tipo: 'marcaB', n: 7, extras: { totales: true, vacias: 2 } },
      { hoja: 'SERIES 5', tipo: 'marcaB', n: 0, extras: { vacias: 10 } },
      { hoja: 'BRAND2', tipo: 'marcaC', n: 6 },
      { hoja: ' HISTORIAL DEMO', tipo: 'historial', historial: true, banner: true, n: 40, extras: { subtotales: 9, fechasMixtas: true } },
      { hoja: 'WEST', tipo: 'bodega', n: 2, extras: { vacias: 11 } },
      { hoja: 'HISTORIAL WEST', tipo: 'historialBodega', historial: true, n: 12 },
      { hoja: 'GARANTIAS', tipo: 'garantias', n: 0, descartada: true },
    ];
  }
  return [
    { ...HOJA_OC, n: 6 },
    { hoja: 'BRAND1', tipo: 'marcaA', n: 6, leyenda: true, extras: { subtotales: 4 } },
    { hoja: 'BRAND3', tipo: 'marcaB', n: 4, extras: { totales: true } },
    { hoja: 'SERIES 5', tipo: 'marcaB', n: 0, extras: { vacias: 10 } },
    { hoja: 'BRAND2', tipo: 'marcaC', n: 3 },
    { hoja: 'PARTNER9', tipo: 'marcaB', n: 2 }, // hoja nueva, no listada en la referencia de abril
    { hoja: ' HISTORIAL DEMO', tipo: 'historial', historial: true, banner: true, n: 38, extras: { subtotales: 9 } },
    { hoja: 'WEST', tipo: 'bodega', n: 0, extras: { vacias: 11 } },
    { hoja: 'HISTORIAL WEST', tipo: 'historialBodega', historial: true, n: 12 },
    { hoja: 'GARANTIAS', tipo: 'garantias', n: 0, descartada: true },
  ];
}

function eraAduana(etiqueta, era, skus, descrPorSku) {
  return construirAduana(new Rng(`${etiqueta}-aduana`), skus, descrPorSku, planAduana(era), { fuera: 3 });
}

const descripciones = (productos, west) => {
  const m = new Map();
  for (const p of productos) if (p.descr) m.set(p.sku.toUpperCase(), p.descr);
  for (const w of west) if (w.descr && !m.has(w.sku.toUpperCase())) m.set(w.sku.toUpperCase(), w.descr);
  return m;
};

// ------------------------------------------------------------
// Construcción de todo el conjunto
// ------------------------------------------------------------
export function construirMuestra() {
  // ---- ABRIL: JSON versionados (strings = texto mostrado)
  const abril = eraStock('abril', {
    productos: 120, west: 40, matched: 8, skusReserva: 36, estiloAbril: true,
    columnas: { nClientes: 15, anio3: 1, texto: 1, vacia: 1, serial: 0, sinCliente: 0, totales: false },
    repetidos: 2, celdasMalformadas: 4,
  });
  const abrilAduana = eraAduana('abril', 'abril', abril.cifras.skusReconciliados, descripciones(abril.productos, abril.west));
  const abrilAduanaCifras = derivarAduana(abrilAduana);

  // ---- JULIO: xlsx (números tipados; header DESC en la hoja WEST, ITEM de Reserva en la fila 8)
  const julio = eraStock('julio', {
    productos: 126, west: 42, matched: 9, skusReserva: 44,
    columnas: { nClientes: 16, anio3: 2, texto: 1, vacia: 1, serial: 2, sinCliente: 1, totales: true },
    repetidos: 3, celdasMalformadas: 7,
  });
  const julioAduana = eraAduana('julio', 'julio', julio.cifras.skusReconciliados, descripciones(julio.productos, julio.west));
  const julioAduanaCifras = derivarAduana(julioAduana);

  // ---- UNIFICADO: xlsx (TECNOLOGIA/CLASE/DESCRIPCION; INV WEST sin PROV; ITEM de Reserva en la fila 9)
  const unificado = eraStock('unificado', CFG_UNIFICADO);

  // ---- PARCHE de clasificación: libro (Inventario + INV WEST) + foto de productos vivos + constantes propias
  const parche = construirParche(unificado);

  // ---- CINCO niveles (tipado)
  const cinco = construirCinco(new Rng('cinco'), { n: 120, conTecnologia: 111, conProducto: 70, vacias: 11 });

  // ---- Grids
  const gInvAbril = gridInventario(abril.productos, { era: 'abril', modo: 'texto' });
  const gWestAbril = gridWest(abril.west, { era: 'abril' });
  const gResAbril = gridReserva(abril.reserva, { itemFila: 9, modo: 'texto' });
  const hojasAduanaAbril = abrilAduana.hojas.map((h) => ({ hoja: h.hoja, grid: gridAduana(h, 'json') }));
  const gCinco = gridCinco(cinco);
  const edge = gridsEdge();

  const json = {
    [`${RUTA_FIXTURES}/muestra/inventario.grid.json`]: gridJson(gInvAbril),
    [`${RUTA_FIXTURES}/muestra/west.grid.json`]: gridJson(gWestAbril),
    [`${RUTA_FIXTURES}/muestra/reserva.grid.json`]: gridJson(gResAbril),
    [`${RUTA_FIXTURES}/muestra/embarques.sheets.json`]: hojasJson(hojasAduanaAbril),
    [`${RUTA_FIXTURES}/muestra/inventario-5niveles.grid.json`]: gridJson(gCinco),
    [`${RUTA_FIXTURES}/edge/inventario.edge.json`]: gridJson(edge.inventario),
    [`${RUTA_FIXTURES}/edge/reserva.edge.json`]: gridJson(edge.reserva),
    [`${RUTA_FIXTURES}/edge/embarques.edge.json`]: hojasJson(edge.embarques),
    ...parche.json,
  };

  const libros = [
    {
      ruta: NOMBRES_LIBROS.unificado,
      titulo: 'Sample stock workbook (unified format)',
      hojas: [
        { nombre: 'Inventario', grid: gridInventario(unificado.productos, { era: 'unificado', modo: 'tipado' }) },
        { nombre: 'Reserva', grid: gridReserva(unificado.reserva, { itemFila: 9, modo: 'tipado' }) },
        { nombre: 'Compras', grid: gridCompras(new Rng('unificado-compras'), 20) },
        { nombre: 'INV WEST', grid: gridWest(unificado.west, { era: 'unificado' }) },
      ],
    },
    {
      ruta: NOMBRES_LIBROS.julio,
      titulo: 'Sample stock workbook (historical format)',
      hojas: [
        { nombre: 'Inventario', grid: gridInventario(julio.productos, { era: 'julio', modo: 'tipado' }) },
        { nombre: 'Reserva', grid: gridReserva(julio.reserva, { itemFila: 8, modo: 'tipado' }) },
        { nombre: 'Compras', grid: gridCompras(new Rng('julio-compras'), 24) },
        { nombre: 'WEST', grid: gridWest(julio.west, { era: 'julio' }) },
      ],
    },
    {
      ruta: NOMBRES_LIBROS.aduana,
      titulo: 'Sample shipment tracking workbook',
      hojas: julioAduana.hojas.map((h) => ({ nombre: h.hoja, grid: gridAduana(h, 'xlsx') })),
    },
    {
      ruta: NOMBRES_LIBROS.cinco,
      titulo: 'Sample five-level stock workbook',
      hojas: [{ nombre: 'Inventario', grid: gCinco }],
    },
  ];

  const constantes = {
    semilla: SEMILLA,
    anio: ANIO,
    nota: 'Generado por scripts/generar-datos-muestra.mjs (semilla fija, valores inventados). Cifras calculadas por construccion desde el modelo, no desde los parsers.',
    libros: NOMBRES_LIBROS,
    dorados: {
      inventario: DORADO_INV,
      west: {
        sku: DORADO_WEST.sku,
        prov: DORADO_WEST.prov,
        fisico: DORADO_WEST.fisico,
        descr: DORADO_WEST.descr,
        descrUnificado: DORADO_WEST.descrUnificado,
        tecnologiaUnificado: DORADO_WEST.tecnologia,
        familiaUnificado: DORADO_WEST.familiaUnificado,
        claseUnificado: DORADO_WEST.claseUnificado,
      },
    },
    westTestigos: WEST_TESTIGOS.map((t) => ({ sku: t.sku, prov: t.prov, fisico: t.fisico, texto: t.texto })),
    westUnificadoSolo: WEST_UNIFICADO_SOLO,
    marcasNuevasTestigo: MARCAS_NUEVAS_TESTIGO,
    familiaTestigo: 'SERIES11',
    kam: { sembrados: KAM_SEMBRADOS, noSembrados: KAM_NO_SEMBRADOS },
    abril: {
      ...resumenEra(abril, {
        inventarioFilas: gInvAbril.length,
        westFilas: gWestAbril.length,
        reservaFilas: gResAbril.length,
        reservaColumnas: abril.reserva.columnas.length,
      }),
      embarques: {
        ...abrilAduanaCifras,
        indiceHojaConEstatus: 1,
        embarquesFueraDelUniverso: abrilAduanaCifras.fuera,
        skuFuera: abrilAduana.skusFuera,
      },
    },
    julio: {
      ...resumenEra(julio),
      hojasStock: ['Inventario', 'Reserva', 'Compras', 'WEST'],
      hojasAduana: julioAduana.hojas.map((h) => h.hoja),
      aduana: { ...julioAduanaCifras, hojaNueva: 'PARTNER9' },
      // rastros `columna_ausente_*` que la era emite: Inventario (tecnologia, producto) + WEST (tecnologia, familia, clase)
      columnasAusentes: { tecnologia: 2, producto: 1, familia: 1, clase: 1 },
      filasPorHoja: {
        Inventario: gridInventario(julio.productos, { era: 'julio', modo: 'tipado' }).length,
        Reserva: gridReserva(julio.reserva, { itemFila: 8, modo: 'tipado' }).length,
        Compras: gridCompras(new Rng('julio-compras'), 24).length,
        WEST: julio.west.length + 1,
      },
    },
    unificado: {
      ...resumenEra(unificado),
      hojasStock: ['Inventario', 'Reserva', 'Compras', 'INV WEST'],
    },
    cinco: cinco.cifras,
    edge: EDGE,
  };
  // libros que NO forman parte de `constantes.libros` del manifiesto: los del parche de clasificación
  const librosExtra = [parche.libro];
  return { json, libros, librosExtra, constantes };
}
