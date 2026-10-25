// ============================================================
// scripts/datos-muestra/grids.mjs
// Emisión de GRIDS (arreglos de arreglos) a partir de los modelos.
//   modo 'texto'  → todo string o null: «texto mostrado» de una hoja ods (era abril)
//   modo 'tipado' → números reales (xlsx / libro de 5 niveles)
// Un marcador `{ __serial: n }` pide una celda de fecha tipada en el xlsx.
// ============================================================
import { RAZON_SOCIAL, serialExcel } from './base.mjs';
import { textoFechaColumna } from './modelo-stock.mjs';
import { totalProducto } from './modelo-stock.mjs';

const nulos = (n) => new Array(n).fill(null);

/** Miles con punto (formato mostrado de la columna QTY): 4285 → «4.285». */
function conMiles(n) {
  const s = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return n < 0 ? `-${s}` : s;
}

const ALM = ['north', 'south', 'east', 'tran', 'bo'];

/**
 * Hoja Inventario. `era`: 'abril' | 'julio' (encabezados CLASS/DESCR) | 'unificado' (TECNOLOGIA/CLASE/DESCRIPCION).
 * Geometría: fila 1 vacía, fila 2 banner `STOCK`, fila 3 vacía, fila 4 encabezado, gutter en la col A.
 */
export function gridInventario(productos, { era, modo }) {
  const unificado = era === 'unificado';
  const encabezado = unificado
    ? [null, 'ITEM', 'CLIENTE', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'CLASE', 'DESCRIPCION', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV', 'QTY']
    : [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV', 'QTY'];
  const ancho = encabezado.length;
  const idxDescr = encabezado.indexOf(unificado ? 'DESCRIPCION' : 'DESCR');
  const banner = nulos(ancho);
  banner[idxDescr] = 'STOCK';
  const grid = [nulos(ancho), banner, nulos(ancho), encabezado];
  const texto = modo === 'texto';
  const num = (v) => (texto ? String(v) : v);
  for (const p of productos) {
    const total = totalProducto(p);
    const qty = total - p.resv;
    const alm = ALM.map((k) => {
      if (k === 'north') return num(p.alm.north); // NORTH: siempre presente ("0" incluido)
      return p.alm[k] > 0 ? num(p.alm[k]) : null;
    });
    const qtyCelda = texto ? conMiles(qty) : qty;
    const comunes = [p.skuTexto ?? p.sku, p.cliente];
    const atributos = unificado
      ? [p.tecnologia, p.marca, p.familia, p.clase, p.descr]
      : [p.marca, p.familia, p.clase, p.descr];
    grid.push([null, ...comunes, ...atributos, ...alm, num(total), num(p.resv), qtyCelda]);
  }
  return grid;
}

/** Hoja de la bodega externa. `era`: 'abril' (banner + encabezado en la fila 4, texto europeo) | 'julio' (header DESC en la fila 1) | 'unificado'. */
export function gridWest(filas, { era }) {
  if (era === 'abril') {
    const g = [nulos(4), nulos(4), ['INVENTARIO WEST', null, null, null], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
    for (const f of filas) g.push([f.sku, f.prov, f.descr, f.texto ?? fisicoTexto(f.fisico)]);
    return g;
  }
  if (era === 'julio') {
    const g = [['ITEM', 'PROV', 'DESC', 'FISICO']];
    for (const f of filas) g.push([f.sku, f.prov, f.descr, f.fisico]);
    return g;
  }
  // unificado: sin columna PROV; MARCA hace de respaldo. Una de cada 8 filas (la dorada nunca) escribe el físico como texto europeo.
  const g = [['ITEM', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'CLASE', 'DESCRIP', 'Físico']];
  filas.forEach((f, i) => {
    g.push([f.sku, f.tecnologia, f.prov, f.familia, f.clase, f.descr, i % 8 === 3 ? fisicoTexto(f.fisico) : f.fisico]);
  });
  return g;
}

export function fisicoTexto(n) {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')},00`;
}

/**
 * Hoja Reserva (pivote). `itemFila` = fila 1-based del ancla ITEM (9 abril/unificado, 8 julio).
 * Offsets del parser: KAM = ITEM-4, fecha = ITEM-2, motivo = ITEM-1.
 * Col A = SKU · col B = total-fuente (ignorada) · col C vacía · clientes desde la col D.
 */
export function gridReserva(reserva, { itemFila, modo }) {
  const { columnas, filas, totales } = reserva;
  const ancho = 3 + columnas.length + (totales ? 1 : 0);
  const texto = modo === 'texto';
  const item = itemFila - 1;
  const g = [];
  for (let r = 0; r < item; r++) g.push(nulos(ancho));
  g[0][0] = RAZON_SOCIAL;
  g[item - 5 >= 1 ? item - 5 : 1][10] = 'RESERVA RETAILER'; // banner (no se lee)
  const kamRow = g[item - 4];
  const fechaRow = g[item - 2];
  const motivoRow = g[item - 1];
  fechaRow[0] = 'STOCK MEXICO';
  const clienteRow = nulos(ancho);
  clienteRow[0] = 'ITEM';
  columnas.forEach((c, k) => {
    const col = 3 + k;
    kamRow[col] = c.kam;
    motivoRow[col] = c.motivo;
    const f = textoFechaColumna(c);
    if (c.tipo === 'serial' && !texto) fechaRow[col] = { __serial: serialExcel(c.fecha.y, c.fecha.m, c.fecha.d) };
    else fechaRow[col] = f;
    clienteRow[col] = c.tipo === 'sinCliente' ? null : c.cliente;
  });
  if (totales) clienteRow[ancho - 1] = 'TOTALES';
  g.push(clienteRow);
  const num = (v) => (texto ? String(v) : v);
  for (const f of filas) {
    const row = nulos(ancho);
    row[0] = f.sku;
    row[1] = num(f.totalFuente);
    let suma = 0;
    for (const [k, qty] of Object.entries(f.celdas)) {
      row[3 + Number(k)] = num(qty);
      suma += qty;
    }
    if (totales) row[ancho - 1] = num(suma);
    g.push(row);
  }
  if (totales) {
    const fila = nulos(ancho);
    fila[0] = 'TOTALES';
    fila[1] = num(0);
    g.push(fila);
  }
  return g;
}

/** Hoja Compras: orden de compra a proveedores, SIN encabezado ITEM (la hoja se excluye por nombre). */
export function gridCompras(rng, n) {
  const g = [['OC', 'PROVEEDOR', 'DESCRIPCION', 'CANTIDAD', 'FECHA ENTREGA', 'ESTATUS OC']];
  for (let i = 0; i < n; i++) {
    g.push([
      `PO-${rng.digitos(5)}`,
      `PARTNER${rng.int(1, 12)}`,
      `Compra ${rng.letras(3)}${rng.int(10, 99)}`,
      rng.int(5, 900),
      { __serial: serialExcel(2031, rng.int(1, 12), rng.int(1, 28)) },
      rng.pick(['Abierta', 'Recibida', 'Parcial']),
    ]);
  }
  return g;
}

/** Inventario de cinco niveles (tipado): ITEM·CLIENTE·TECNOLOGIA·MARCA·FAMILIA·PRODUCTO·CLASE·DESCRIPCION·bodegas·TOTAL·RESV·QTY. */
export function gridCinco({ filas, vacias }) {
  const encabezado = [null, 'ITEM', 'CLIENTE', 'TECNOLOGIA', 'MARCA', 'FAMILIA', 'PRODUCTO', 'CLASE', 'DESCRIPCION', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV', 'QTY'];
  const ancho = encabezado.length;
  const banner = nulos(ancho);
  banner[8] = 'STOCK';
  const g = [nulos(ancho), banner, nulos(ancho), encabezado];
  for (const f of filas) {
    g.push([
      null, f.sku, f.cliente, f.tecnologia, f.marca, f.familia, f.producto, f.clase, f.descr,
      f.alm.north, f.alm.south, f.alm.east, f.alm.tran, f.alm.bo, f.total, f.resv, f.qty,
    ]);
  }
  for (let i = 0; i < vacias; i++) g.push(nulos(ancho));
  return g;
}
