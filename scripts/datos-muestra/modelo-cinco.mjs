// ============================================================
// scripts/datos-muestra/modelo-cinco.mjs
// Inventario de CINCO niveles (TECNOLOGIA · MARCA · FAMILIA · PRODUCTO · CLASE).
// Tipado (números reales), 11 filas vacías al final, `SOUTH` siempre vacía,
// 2 filas con TOTAL distinto de la suma de bodegas. Invariante clave: toda fila
// con PRODUCTO trae la MISMA tecnología (PRODUCTO es una rama de esa tecnología).
// ============================================================
import { nuevoSku, nuevaDescripcion, FAMILIAS } from './base.mjs';

/** La tecnología de la que cuelga el nivel PRODUCTO. */
export const TECNOLOGIA_CON_PRODUCTO = 'BRAND1';

/** SKU testigo: la familia y el producto son DISTINTOS entre sí (PRODUCTO no vive en el casillero de FAMILIA). */
export const TESTIGO_CINCO = {
  sku: 'LV0029',
  familia: 'SERIES 41',
  producto: 'CLIP 3.0 CUSTOM RETAILER24',
  tecnologia: TECNOLOGIA_CON_PRODUCTO,
  marca: 'BRAND1',
};

const NOMBRES_PRODUCTO = ['CLIP', 'PLUG', 'BASE', 'SPIDER', 'HOOK', 'PUCK'];
const SUFIJOS = ['STANDARD', 'LITE', 'PRO', 'CUSTOM RETAILER9', 'CUSTOM RETAILER31', 'DUAL'];

export function construirCinco(rng, { n = 120, conTecnologia = 111, conProducto = 70, vacias = 11 }) {
  // el libro es un .xlsx: sin SKU de forma 9999-9999-9999 (junto a celdas numéricas de 2–3 dígitos se lee como teléfono)
  const usados = new Set([TESTIGO_CINCO.sku]);
  const filas = [];
  // 1) quién trae producto: las primeras `conProducto` (todas de la tecnología con producto)
  for (let i = 0; i < n; i++) {
    let tecnologia;
    let producto = null;
    if (i < conProducto) {
      tecnologia = TECNOLOGIA_CON_PRODUCTO;
      producto = `${rng.pick(NOMBRES_PRODUCTO)} ${rng.int(1, 4)}.${rng.int(0, 9)} ${rng.pick(SUFIJOS)}`;
    } else if (i < conTecnologia) {
      // tecnología sin producto: la misma tecnología (sin producto) o las otras
      tecnologia = rng.weighted([
        [TECNOLOGIA_CON_PRODUCTO, 3],
        ['EAS', 5],
        ['RFID', 3],
      ]);
    } else {
      tecnologia = null;
    }
    const alm = { north: rng.chance(0.85) ? rng.int(0, 200) : 0, south: null, east: null, tran: null, bo: null };
    if (rng.chance(0.06)) alm.east = rng.int(1, 80);
    if (rng.chance(0.05)) alm.tran = rng.int(1, 80);
    if (rng.chance(0.1)) alm.bo = rng.int(1, 80);
    const total = (alm.north ?? 0) + (alm.east ?? 0) + (alm.tran ?? 0) + (alm.bo ?? 0);
    const resv = rng.chance(0.25) ? rng.int(1, 40) : 0;
    filas.push({
      sku: nuevoSku(rng, usados, { numericos: false }),
      cliente: rng.chance(0.2) ? `RETAILER${rng.int(1, 40)}` : null,
      tecnologia,
      marca: rng.weighted([
        [tecnologia ?? 'GENERAL', 6],
        ['GENERAL', 4],
        ['NACIONAL', 1],
        ['WEST', 1],
        ['BRAND5', 2],
      ]),
      familia: rng.chance(0.9) ? rng.pick([...FAMILIAS, 'SERIES11']) : null,
      producto,
      clase: rng.chance(0.93) ? rng.pick(['A', 'B', 'C']) : null,
      descr: nuevaDescripcion(rng),
      alm,
      total,
      resv,
      qty: total - resv,
    });
  }
  // 2) el testigo (con producto): reemplaza la fila 3 de la rama con producto
  Object.assign(filas[3], {
    sku: TESTIGO_CINCO.sku,
    tecnologia: TESTIGO_CINCO.tecnologia,
    marca: TESTIGO_CINCO.marca,
    familia: TESTIGO_CINCO.familia,
    producto: TESTIGO_CINCO.producto,
  });
  // 3) dos filas con TOTAL distinto de la suma de bodegas (nunca el testigo)
  for (const i of [10, 90]) {
    filas[i].total += 3;
  }
  // 4) filas en blanco al final (el parser las salta sin cuarentena)
  const baseGrid = {
    filas,
    vacias,
  };
  // cifras por construcción
  const sinTecnologia = filas.filter((f) => f.tecnologia === null).length;
  const sinProducto = filas.filter((f) => f.producto === null).length;
  const productosOk = filas.every((f) => f.producto === null || f.tecnologia === TECNOLOGIA_CON_PRODUCTO);
  return {
    ...baseGrid,
    cifras: {
      productos: filas.length,
      conTecnologia: filas.length - sinTecnologia,
      conProducto: filas.length - sinProducto,
      sinTecnologia,
      sinProducto,
      filasVacias: vacias,
      tecnologiaConProducto: TECNOLOGIA_CON_PRODUCTO,
      invarianteProductoImplicaTecnologia: productosOk,
      testigo: TESTIGO_CINCO,
    },
  };
}
