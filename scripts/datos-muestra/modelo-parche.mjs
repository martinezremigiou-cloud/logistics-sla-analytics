// ============================================================
// scripts/datos-muestra/modelo-parche.mjs
// MODELO de los datos de ejemplo del parche de clasificación
// (`src/services/parche/clasificacion.build.ts`): un libro de dos hojas
// (Inventario + INV WEST, la misma forma del libro unificado) y una FOTO de
// productos vivos (`productos-vivos-muestra.json`) con el ruido de calidad de
// dato que las reglas del builder necesitan.
//
// Parte de los productos y de las filas WEST de la era «unificado» (los mismos
// valores inventados del libro `muestra/inventario-unificado.xlsx`) y les
// añade, de forma explícita y con semilla fija, las rarezas que ejercen cada
// regla: placeholder de bodega en MARCA (con y sin contraparte en WEST),
// SKU que solo trae una de las hojas, huecos que rellena la otra, marcas que
// solo aparecen en WEST, familias que colisionan al normalizar espacios, SKU
// de la foto sin fila en el libro (y al revés) y SKU «basura» con espacios.
//
// Las cifras NO salen del builder: se cuentan aquí desde el modelo. Cada valor
// vivo se fabrica con un modo conocido (igual, espacios, caja, otro, nulo) cuyo
// efecto sobre la comparación «archivo vs vivo» se conoce por construcción.
// ============================================================
import { Rng, SEMILLA, nuevoSku, nuevaDescripcion, MARCAS_SEMBRADAS, KAM_NO_SEMBRADOS } from './base.mjs';
import { DORADO_INV, DORADO_WEST, WEST_TESTIGOS, WEST_UNIFICADO_SOLO } from './modelo-stock.mjs';
import { gridInventario, gridWest } from './grids.mjs';

export const RUTA_PARCHE = 'src/services/parche/__fixtures__';
export const LIBRO_PARCHE = 'muestra/clasificacion-parche.xlsx';

// ------------------------------------------------------------
// Catálogos «vivos» del contexto (marcas, familias, alias)
// ------------------------------------------------------------

/** Marcas ya existentes: las sembradas del catálogo de pruebas + tres que el libro también usa. */
export const MARCAS_VIVAS = [...MARCAS_SEMBRADAS, 'BRAND5', 'BRAND9', 'BRAND2'];

/** Familias ya existentes (las demás del libro quedan como NUEVAS). */
export const FAMILIAS_VIVAS = [
  'BRAND5', 'BRAND2', 'BRAND9', 'BRAND6', 'SERIES11', 'SERIES2', 'SERIES 2', 'SERIES3', 'SERIES4',
  'SERIES5', 'SERIES6', 'TAG', 'CABLE', 'POWER', 'SERIES 41', 'CARGADOR',
];

/** Alias de marca ya conocidos (clave de alias → marca canónica). */
export const ALIAS_VIVOS = { 'brand 6': 'BRAND6', brand1: 'BRAND1' };

/** Pares de familia que colisionan al normalizar (mismo texto, distinto espaciado interno). */
const PARES_COLISION = [
  ['SERIES 3 40 / SERIES 3 50', 'SERIES 3  40 / SERIES 3 50'],
  ['LATCH 2.0 / HOOK ADJUSTABLE', 'LATCH 2.0 /  HOOK ADJUSTABLE'],
  ['LATCH 2.0 / HOOK ADJUSTABLE HIGH GRADE', 'LATCH  2.0 / HOOK ADJUSTABLE HIGH GRADE'],
];

// ------------------------------------------------------------
// Utilidades (espejo MÍNIMO de la normalización de negocio, solo para el oráculo)
// ------------------------------------------------------------
const K = (s) => s.toUpperCase();
const t = (v) => (v === null || v === undefined ? null : String(v).trim() === '' ? null : String(v).trim());
const canon = (s) => s.replace(/\s+/g, ' ').trim().toUpperCase();
const claveAlias = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const esWest = (m) => m.trim().toUpperCase() === 'WEST';

/**
 * Valor vivo de un campo a partir del candidato del archivo, con un modo cuyo efecto se conoce:
 *   igual    → mismo texto                      → no difiere
 *   espacios → mismo texto con espacios a los lados → no difiere (la comparación recorta)
 *   caja     → mismo texto en otra caja         → difiere solo si el campo es sensible a la caja (cs)
 *   otro     → otro texto                       → difiere
 *   nulo     → null                             → difiere (el candidato no es vacío)
 * Candidato vacío: vivo vacío (no difiere) o un texto (difiere).
 */
function vivoDe(rng, cand, { cs, alterno, distinto = false, canonicoVivo = null }) {
  if (cand === null) {
    if (rng.chance(0.7)) return { vivo: null, difiere: false };
    return { vivo: alterno(), difiere: true };
  }
  const modo = distinto ? rng.pick(['otro', 'nulo']) : rng.weighted([['igual', 45], ['espacios', 10], ['caja', 12], ['otro', 25], ['nulo', 8]]);
  if (modo === 'igual') {
    if (canonicoVivo !== null) {
      const v = canonicoVivo(cand);
      return { vivo: v, difiere: K(v.trim()) !== K(cand) };
    }
    return { vivo: cand, difiere: false };
  }
  if (modo === 'espacios') return { vivo: `  ${cand} `, difiere: false };
  if (modo === 'caja') {
    const v = cand === cand.toLowerCase() ? cand.toUpperCase() : cand.toLowerCase();
    if (v === cand) return { vivo: cand, difiere: false };
    return { vivo: v, difiere: cs };
  }
  if (modo === 'nulo') return { vivo: null, difiere: true };
  for (let i = 0; i < 50; i++) {
    const v = alterno();
    if (K(v.trim()) !== K(cand)) return { vivo: v, difiere: true };
  }
  throw new Error('modelo-parche: no se pudo inventar un valor vivo distinto');
}

// ------------------------------------------------------------
// Construcción
// ------------------------------------------------------------

/**
 * `unificado`: resultado de `eraStock('unificado', CFG_UNIFICADO)` (productos + west).
 * Devuelve { json, libro, constantes } SIN tocar disco.
 */
export function construirParche(unificado) {
  const productos = unificado.productos.map((p) => ({ ...p, alm: { ...p.alm } }));
  const west = unificado.west.map((w) => ({ ...w }));
  const westPorSku = new Map(west.map((w) => [K(w.sku), w]));
  const invPorSku = new Map(productos.map((p) => [K(p.sku), p]));

  // ---- roles en los SKU que viven en AMBAS hojas (sin el dorado: conserva sus atributos y prueba «gana Inventario»)
  const solapados = productos.filter((p) => westPorSku.has(K(p.sku)) && K(p.sku) !== K(DORADO_WEST.sku));
  if (solapados.length < 7) throw new Error('modelo-parche: el libro unificado trae menos de 7 SKU solapados');
  const [oCruzA, oCruzB, oMarcaVacia, oSoloWest, oCajas, oHuecos, oDescrVacia] = solapados;
  const rolesOverlap = {
    cruzadoResueltoA: { inv: oCruzA, w: westPorSku.get(K(oCruzA.sku)) },
    cruzadoResueltoB: { inv: oCruzB, w: westPorSku.get(K(oCruzB.sku)) },
    marcaVaciaEnInventario: { inv: oMarcaVacia, w: westPorSku.get(K(oMarcaVacia.sku)) },
    marcaNuevaSoloWest: { inv: oSoloWest, w: westPorSku.get(K(oSoloWest.sku)) },
    variantesDeCaja: { inv: oCajas, w: westPorSku.get(K(oCajas.sku)) },
    huecosFamiliaClase: { inv: oHuecos, w: westPorSku.get(K(oHuecos.sku)) },
    huecosDescrClase: { inv: oDescrVacia, w: westPorSku.get(K(oDescrVacia.sku)) },
  };
  const rng = new Rng('parche');
  // placeholder de bodega CON contraparte en WEST (se resuelve por cruce): una escrita en otra caja
  rolesOverlap.cruzadoResueltoA.inv.marca = 'West';
  rolesOverlap.cruzadoResueltoA.w.prov = 'BRAND3';
  rolesOverlap.cruzadoResueltoB.inv.marca = 'WEST';
  rolesOverlap.cruzadoResueltoB.w.prov = 'VERTICAL';
  // MARCA vacía en Inventario: la rellena la de WEST
  rolesOverlap.marcaVaciaEnInventario.inv.marca = null;
  rolesOverlap.marcaVaciaEnInventario.w.prov = 'CARGADOR';
  // Inventario gana la marca, pero WEST trae una marca NUEVA que igual se descubre
  rolesOverlap.marcaNuevaSoloWest.inv.marca = 'NACIONAL';
  rolesOverlap.marcaNuevaSoloWest.w.prov = 'BRAND11';
  // misma marca nueva en dos cajas distintas (Inventario / WEST): NO es colisión (marca es insensible a la caja)
  rolesOverlap.variantesDeCaja.inv.marca = 'BRAND13';
  rolesOverlap.variantesDeCaja.w.prov = 'Brand13';
  // huecos en Inventario que rellena WEST
  rolesOverlap.huecosFamiliaClase.inv.familia = null;
  rolesOverlap.huecosFamiliaClase.inv.clase = null;
  rolesOverlap.huecosFamiliaClase.w.familia ??= 'TAG';
  rolesOverlap.huecosFamiliaClase.w.clase ??= 'B';
  rolesOverlap.huecosDescrClase.inv.descr = null;
  rolesOverlap.huecosDescrClase.inv.clase = null;
  rolesOverlap.huecosDescrClase.w.descr ??= nuevaDescripcion(rng);
  rolesOverlap.huecosDescrClase.w.clase ??= 'C';
  const skuOverlap = new Set(solapados.map((p) => K(p.sku)));

  // ---- colisiones de normalización de familia: 3 pares, 6 filas de solo-Inventario
  const candidatasColision = rng
    .shuffle(productos.map((p, i) => i))
    .filter((i) => i >= 2 && !skuOverlap.has(K(productos[i].sku)) && productos[i].marca !== 'WEST');
  const filasColision = candidatasColision.slice(0, PARES_COLISION.length * 2);
  PARES_COLISION.forEach((par, k) => {
    productos[filasColision[2 * k]].familia = par[0];
    productos[filasColision[2 * k + 1]].familia = par[1];
  });
  const skuColision = new Set(filasColision.map((i) => K(productos[i].sku)));

  // ---- SKU que el libro trae y la foto NO (soloNuevo): 4 filas nuevas de Inventario + 2 filas solo-WEST
  const usados = new Set([...productos.map((p) => K(p.sku)), ...west.map((w) => K(w.sku))]);
  const rngN = new Rng('parche-nuevo');
  for (let i = 0; i < 4; i++) {
    const sku = nuevoSku(rngN, usados, { numericos: false });
    productos.splice(rngN.int(2, productos.length), 0, {
      sku,
      skuTexto: null,
      cliente: null,
      marca: rngN.pick(['BRAND1', 'BRAND5', 'VERTICAL', 'BRAND9']),
      familia: rngN.pick(['TAG', 'CABLE', 'POWER', 'SERIES3']),
      tecnologia: rngN.pick(['EAS', 'RFID', 'CCTV']),
      clase: rngN.pick(['A', 'B', 'C']),
      descr: nuevaDescripcion(rngN),
      alm: { north: rngN.int(1, 99), south: 0, east: 0, tran: 0, bo: 0 },
      resv: 0,
    });
  }
  const soloNuevoInv = productos.slice().filter((p) => !invPorSku.has(K(p.sku))).map((p) => K(p.sku));
  const westSolo = west.find(
    (w) => !invPorSku.has(K(w.sku)) && !WEST_TESTIGOS.some((x) => x.sku === w.sku) && w.sku !== WEST_UNIFICADO_SOLO.sku,
  );
  const soloNuevoSkus = [...soloNuevoInv, K(WEST_UNIFICADO_SOLO.sku), K(westSolo.sku)];
  const soloNuevoSet = new Set(soloNuevoSkus);

  // ---- vista del ARCHIVO por SKU
  const invFila = (p) => ({ tec: t(p.tecnologia), marca: t(p.marca), fam: t(p.familia), clase: t(p.clase), descr: t(p.descr) });
  const westFila = (w) => ({ tec: t(w.tecnologia), marca: t(w.prov), fam: t(w.familia), clase: t(w.clase), descr: t(w.descr) });
  const archivoInv = new Map(productos.map((p) => [K(p.sku), invFila(p)]));
  const archivoWest = new Map(west.map((w) => [K(w.sku), westFila(w)]));
  const fileSkus = [...new Set([...archivoInv.keys(), ...archivoWest.keys()])];
  const overlap = fileSkus.filter((s) => archivoInv.has(s) && archivoWest.has(s));
  const emitidos = fileSkus.filter((s) => !soloNuevoSet.has(s)).sort();

  const candidato = (sku, campo) => archivoInv.get(sku)?.[campo] ?? archivoWest.get(sku)?.[campo] ?? null;
  const candidatoMarca = (sku) => {
    const im = archivoInv.get(sku)?.marca ?? null;
    const wm = archivoWest.get(sku)?.marca ?? null;
    if (im !== null && esWest(im)) return wm !== null ? { valor: wm, placeholder: true, noResuelto: false } : { valor: im, placeholder: true, noResuelto: true };
    if (im !== null) return { valor: im, placeholder: false, noResuelto: false };
    return { valor: wm, placeholder: false, noResuelto: false };
  };

  // ---- foto de VIVOS: un valor vivo por SKU emitido, fabricado con efecto conocido
  const rngV = new Rng('parche-vivos');
  const alt = {
    descr: () => nuevaDescripcion(rngV),
    familia: () => rngV.pick(FAMILIAS_VIVAS),
    clase: () => rngV.pick(['A', 'B', 'C']),
    marca: () => rngV.pick(MARCAS_VIVAS),
  };
  const difiere = { descr: 0, familia: 0, clase: 0, marca: 0 };
  const difiereMarcaPlaceholder = { total: 0 };
  const vivos = [];
  for (const sku of emitidos) {
    const d = vivoDe(rngV, candidato(sku, 'descr'), { cs: true, alterno: alt.descr });
    const f = vivoDe(rngV, candidato(sku, 'fam'), { cs: true, alterno: alt.familia });
    const c = vivoDe(rngV, candidato(sku, 'clase'), { cs: false, alterno: alt.clase });
    const cm = candidatoMarca(sku);
    const m = vivoDe(rngV, cm.valor, {
      cs: false,
      alterno: alt.marca,
      distinto: cm.placeholder, // un placeholder de bodega JAMÁS coincide con la marca viva
      canonicoVivo: (raw) => (canon(raw) === 'BRAND 6' ? 'BRAND6' : raw),
    });
    if (d.difiere) difiere.descr++;
    if (f.difiere) difiere.familia++;
    if (c.difiere) difiere.clase++;
    if (m.difiere) difiere.marca++;
    if (cm.placeholder) difiereMarcaPlaceholder.total++;
    vivos.push({
      sku,
      class: c.vivo,
      descr_origen: d.vivo,
      marcas: m.vivo === null ? null : { nombre: m.vivo },
      familias: f.vivo === null ? null : { nombre: f.vivo },
    });
  }

  // ---- SKU vivos que el libro NO trae (soloViejo), dos de ellos «basura» (espacios internos)
  const rngS = new Rng('parche-viejo');
  const skusViejos = [];
  for (let i = 0; i < 12; i++) skusViejos.push(nuevoSku(rngS, usados, { numericos: false }));
  const planos = skusViejos.slice(0, 9);
  const basura = [`${KAM_NO_SEMBRADOS[1]}: REVISAR ${skusViejos[9]} ${skusViejos[10]}`, `RMA ${skusViejos[11]}`];
  for (const sku of [...planos, ...basura]) {
    vivos.push({
      sku,
      class: rngS.pick(['A', 'B', 'C', null]),
      descr_origen: nuevaDescripcion(rngS),
      marcas: { nombre: rngS.pick(MARCAS_VIVAS) },
      familias: rngS.chance(0.8) ? { nombre: rngS.pick(FAMILIAS_VIVAS) } : null,
    });
  }
  const soloViejoSkus = [...planos.map(K), ...basura.map(K)].sort();
  const vivosOrdenados = new Rng('parche-orden').shuffle(vivos);

  // ---- ORÁCULO: cifras contadas desde el modelo (no desde el builder)
  const escribiria = { descr: 0, clase: 0, tecnologia: 0, marca: 0, familia: 0 };
  const noResueltos = [];
  const resueltos = [];
  const famGrupos = new Map(); // canónico → { variantes, skus }
  const tecGrupos = new Map();
  const marcaGrupos = new Map();
  const grupo = (mapa, can, variante, sku) => {
    if (!mapa.has(can)) mapa.set(can, { variantes: new Set(), skus: new Set() });
    mapa.get(can).variantes.add(variante);
    mapa.get(can).skus.add(sku);
  };
  const aliasMapa = new Map(Object.entries(ALIAS_VIVOS));
  const marcasVivasSet = new Set(MARCAS_VIVAS);
  const familiasVivasSet = new Set(FAMILIAS_VIVAS.map(canon));
  for (const sku of emitidos) {
    if (candidato(sku, 'descr') !== null) escribiria.descr++;
    if (candidato(sku, 'clase') !== null) escribiria.clase++;
    const tec = candidato(sku, 'tec');
    if (tec !== null) {
      escribiria.tecnologia++;
      grupo(tecGrupos, canon(tec), tec, sku);
    }
    const fam = candidato(sku, 'fam');
    if (fam !== null) {
      escribiria.familia++;
      if (!familiasVivasSet.has(canon(fam))) grupo(famGrupos, canon(fam), fam, sku);
    }
    const cm = candidatoMarca(sku);
    if (cm.noResuelto) noResueltos.push(sku);
    else if (cm.valor !== null) escribiria.marca++;
    if (cm.placeholder && !cm.noResuelto) resueltos.push(sku);
    for (const raw of [archivoInv.get(sku)?.marca ?? null, archivoWest.get(sku)?.marca ?? null]) {
      if (raw === null || esWest(raw)) continue;
      if (aliasMapa.has(claveAlias(raw)) || marcasVivasSet.has(canon(raw))) continue;
      grupo(marcaGrupos, canon(raw), raw.toUpperCase(), sku);
    }
  }
  const separar = (mapa) => {
    const nuevas = [];
    const colisiones = [];
    for (const [can, g] of mapa) (g.variantes.size > 1 ? colisiones : nuevas).push(can);
    return { nuevas: nuevas.sort(), colisiones: colisiones.sort() };
  };
  const fam = separar(famGrupos);
  const tec = separar(tecGrupos);
  const mar = separar(marcaGrupos);

  // guardas de construcción: si el modelo pierde una rareza, el generador falla en vez de emitir datos degenerados
  const exigir = (cond, msg) => {
    if (!cond) throw new Error(`modelo-parche: ${msg}`);
  };
  exigir(fam.colisiones.length === PARES_COLISION.length, 'las colisiones de familia no son las plantadas');
  exigir(tec.colisiones.length === 0 && mar.colisiones.length === 0, 'colisión inesperada en tecnología o marca');
  exigir(noResueltos.length >= 3 && resueltos.length >= 2, 'faltan placeholders de bodega con y sin contraparte');
  exigir(mar.nuevas.includes('BRAND11') && mar.nuevas.includes('BRAND13'), 'faltan las marcas nuevas plantadas');
  exigir(soloNuevoSet.size === 6 && soloViejoSkus.length === 11, 'cardinalidad de soloNuevo/soloViejo inesperada');
  exigir([...soloNuevoSet].every((s) => !skuOverlap.has(s) && !skuColision.has(s)), 'un soloNuevo cae en un SKU con rol');

  // ---- grids y libro
  const gInv = gridInventario(productos, { era: 'unificado', modo: 'tipado' });
  const gWest = gridWest(west, { era: 'unificado' });
  const libro = {
    ruta: LIBRO_PARCHE,
    titulo: 'Sample classification workbook',
    hojas: [
      { nombre: 'Inventario', grid: gInv },
      { nombre: 'INV WEST', grid: gWest },
    ],
  };

  const testigo = (sku) => K(sku);
  const constantes = {
    nota: 'Generado por scripts/generar-datos-muestra.mjs (semilla fija, valores inventados). Cifras contadas desde el modelo del generador, no desde el builder.',
    semilla: SEMILLA,
    libro: LIBRO_PARCHE,
    hojas: ['Inventario', 'INV WEST'],
    filasInventario: productos.length,
    filasWest: west.length,
    unionSkus: fileSkus.length,
    overlap: overlap.length,
    vivos: vivosOrdenados.length,
    enAmbos: emitidos.length,
    soloNuevo: { total: soloNuevoSkus.length, skus: [...soloNuevoSkus].sort() },
    soloViejo: { total: soloViejoSkus.length, skus: soloViejoSkus, basura: basura.map(K).sort() },
    duplicadosIntraArchivo: 0,
    westNoResueltos: { total: noResueltos.length, skus: [...noResueltos].sort() },
    westResueltos: { total: resueltos.length, skus: [...resueltos].sort() },
    escribiria,
    difiere,
    marcaDifierePlaceholders: difiereMarcaPlaceholder.total,
    catalogos: {
      tecnologiasNuevas: tec.nuevas,
      marcasNuevas: mar.nuevas,
      familiasNuevas: fam.nuevas.length,
      colisionesFamilia: fam.colisiones,
    },
    vivas: { marcas: MARCAS_VIVAS, familias: FAMILIAS_VIVAS, alias: ALIAS_VIVOS },
    testigos: {
      doradoOverlap: { sku: testigo(DORADO_WEST.sku), marcaV2: DORADO_WEST.marcaInv, familiaV2: DORADO_WEST.familiaInv, claseV2: DORADO_WEST.claseInv },
      doradoInventario: { sku: testigo(DORADO_INV.sku) },
      cruzadoResueltoA: { sku: testigo(oCruzA.sku), marcaV2: 'BRAND3' },
      cruzadoResueltoB: { sku: testigo(oCruzB.sku), marcaV2: 'VERTICAL' },
      marcaVaciaEnInventario: { sku: testigo(oMarcaVacia.sku), marcaV2: 'CARGADOR' },
      marcaNuevaSoloWest: { sku: testigo(oSoloWest.sku), marcaV2: 'NACIONAL', marcaNueva: 'BRAND11' },
      variantesDeCaja: { sku: testigo(oCajas.sku), marcaV2: 'BRAND13' },
      huecosFamiliaClase: { sku: testigo(oHuecos.sku), familiaV2: canon(rolesOverlap.huecosFamiliaClase.w.familia), claseV2: canon(rolesOverlap.huecosFamiliaClase.w.clase) },
      huecosDescrClase: { sku: testigo(oDescrVacia.sku), descrV2: t(rolesOverlap.huecosDescrClase.w.descr), claseV2: canon(rolesOverlap.huecosDescrClase.w.clase) },
    },
  };

  const json = {
    [`${RUTA_PARCHE}/productos-vivos-muestra.json`]: `${JSON.stringify(vivosOrdenados, null, 2)}\n`,
    [`${RUTA_PARCHE}/constantes-parche.json`]: `${JSON.stringify(constantes, null, 2)}\n`,
  };
  return { json, libro, constantes };
}
