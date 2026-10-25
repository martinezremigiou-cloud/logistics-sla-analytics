// ============================================================
// Bloque 2 · ETL · reconcile.ts  (PURO)
// Fusiona el stock de Inventario con el de WEST y reconcilia los
// SKU de WEST:
//   - MATCHED: el SKU ya existe en Inventario → se agrega una fila de
//     stock en el almacén WEST (no crea producto).
//   - NUEVO: el SKU no existe en Inventario → alta de producto con
//     marca = PROV (WEST es almacén, PROV es la marca del nuevo) y
//     stock exclusivo en WEST.
// WEST NUNCA se descarta; PROV vacío en un NUEVO → cuarentena.
// ============================================================
import type {
  ProductoCanon,
  StockCanon,
  WestCanon,
  QuarantineItem,
} from './types';
import { normalizeMarcaNombre } from './normalize';

export interface ReconcileResult {
  productos: ProductoCanon[];
  stock: StockCanon[];
  cuarentena: QuarantineItem[];
  westMatched: number;
  westNuevos: number;
}

export function reconcile(
  inv: { productos: ProductoCanon[]; stock: StockCanon[] },
  west: WestCanon[],
): ReconcileResult {
  const productos: ProductoCanon[] = [...inv.productos];
  const stock: StockCanon[] = [...inv.stock];
  const cuarentena: QuarantineItem[] = [];

  const existentes = new Set(inv.productos.map((p) => p.sku));
  let westMatched = 0;
  let westNuevos = 0;

  for (const row of west) {
    if (existentes.has(row.sku)) {
      // MATCHED → complementa stock en WEST
      westMatched++;
      if (row.fisico > 0) {
        stock.push({ sku: row.sku, almacen: 'WEST', cantidad: row.fisico });
      }
      continue;
    }

    // NUEVO → alta de producto con marca = PROV
    const marca = normalizeMarcaNombre(row.prov);
    if (marca === null || marca === 'WEST') {
      cuarentena.push({
        entidad: 'producto',
        clave: row.sku,
        sku: row.sku,
        motivo: marca === 'WEST' ? 'west_prov_es_almacen' : 'west_nuevo_sin_prov',
        origen: { hoja: 'INV_WEST' },
        detalle: { fisico: row.fisico, descr: row.descr },
      });
      continue;
    }

    westNuevos++;
    existentes.add(row.sku);
    productos.push({
      sku: row.sku,
      marca,
      // [FIX-B1·T4] La hoja `INV WEST` SÍ trae TECNOLOGIA/FAMILIA/CLASE y
      // `parseWest` ya las lee (mismos alias que Inventario) — viajan aquí
      // para el SKU que SOLO existe en WEST. `producto` sigue `null`: WEST
      // nunca trajo esa columna, en ninguna era conocida.
      tecnologia: row.tecnologia,
      producto: null,
      familia: row.familia,
      class: row.class,
      descr: row.descr,
      cliente: null,
      resv: 0,
      totalFuente: 0,
    });
    if (row.fisico > 0) {
      stock.push({ sku: row.sku, almacen: 'WEST', cantidad: row.fisico });
    }
  }

  return { productos, stock, cuarentena, westMatched, westNuevos };
}
