import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { reconcile } from '../reconcile';
import { parseInventario } from '../parse.inventario';
import { parseWest } from '../parse.west';
import { realInventario, realWest } from './helpers';
import { libroStockVivo } from '@/services/ingesta/__tests__/libros-muestra';
import { MUESTRA } from './constantes-muestra';
import type { ProductoCanon, WestCanon, Cell, Grid } from '../types';

describe('reconcile (fixture de muestra Inventario + INV_WEST)', () => {
  const inv = parseInventario(realInventario());
  const west = parseWest(realWest());
  const rec = reconcile({ productos: inv.productos, stock: inv.stock }, west.rows);

  const A = MUESTRA.abril;
  const doradoWest = MUESTRA.dorados.west;
  const soloWest = MUESTRA.westTestigos[0];
  it('WEST: complementan (matched) / nuevos', () => {
    expect(rec.westMatched).toBe(A.westMatched);
    expect(rec.westNuevos).toBe(A.westNuevos);
    expect(rec.westMatched + rec.westNuevos).toBe(west.rows.length); // invariante: matched + nuevos = filas WEST
  });
  it('productos = inventario + nuevos WEST', () => {
    expect(inv.productos.length).toBe(A.productosInventario);
    expect(rec.productos.length).toBe(A.productosInventario + A.westNuevos);
    expect(rec.productos.length).toBe(A.productosReconciliados);
  });
  it('matched agrega stock en almacén WEST al SKU existente', () => {
    const westStock = rec.stock.filter((s) => s.almacen === 'WEST');
    // el SKU dorado de WEST existe en Inventario y en WEST
    expect(inv.productos.some((p) => p.sku === doradoWest.sku)).toBe(true);
    expect(westStock.find((s) => s.sku === doradoWest.sku)?.cantidad).toBe(doradoWest.fisico);
  });
  it('nuevo WEST crea producto con marca = PROV (2444N-M → VERTICAL)', () => {
    const p = rec.productos.find((x) => x.sku === soloWest.sku);
    expect(p?.marca).toBe(soloWest.prov);
    expect(p?.totalFuente).toBe(0);
  });
});

describe('reconcile (unit)', () => {
  it('PROV vacío en nuevo → cuarentena, no crea producto', () => {
    const productos: ProductoCanon[] = [];
    const west: WestCanon[] = [
      { sku: 'X-1', prov: '', tecnologia: null, familia: null, class: null, descr: 'd', fisico: 3 },
    ];
    const rec = reconcile({ productos, stock: [] }, west);
    expect(rec.productos).toHaveLength(0);
    expect(rec.cuarentena[0].motivo).toBe('west_nuevo_sin_prov');
  });

  // [FIX-B1·T4] NUEVO: SKU que SOLO existe en WEST llega con tecnología,
  // familia y clase propagadas al ProductoCanon — antes se descartaban a
  // propósito (`null` fijo); ahora el parser ya las lee y reconcile debe
  // propagarlas sin tocarlas. `producto` sigue null: WEST nunca trae esa
  // columna, en ninguna era conocida.
  it('NUEVO: tecnología/familia/clase de WEST llegan al ProductoCanon', () => {
    const productos: ProductoCanon[] = [];
    const west: WestCanon[] = [
      {
        sku: 'Q017-07-R99',
        prov: 'GENERAL',
        tecnologia: 'EAS',
        familia: 'TAG',
        class: 'A',
        descr: 'ETIQUETA EAS',
        fisico: 10,
      },
    ];
    const rec = reconcile({ productos, stock: [] }, west);
    expect(rec.productos).toHaveLength(1);
    expect(rec.productos[0]).toMatchObject({
      sku: 'Q017-07-R99',
      marca: 'GENERAL',
      tecnologia: 'EAS',
      producto: null,
      familia: 'TAG',
      class: 'A',
    });
  });

  // [FIX-B1·T4] MATCHED: el SKU existe en las dos pestañas y WEST trae un
  // valor de familia/clase DISTINTO al de Inventario — reconcile NUNCA toca
  // el producto en la rama MATCHED (solo agrega stock), así que sigue
  // mandando Inventario. Caso de muestra: CABLE-USBX (Inventario dice
  // 'SERIES 41', WEST dice 'ENERGIA').
  it('MATCHED: WEST con familia distinta NO sobreescribe la del producto existente (manda Inventario)', () => {
    const productos: ProductoCanon[] = [
      {
        sku: 'CABLE-USBX',
        marca: 'GENERAL',
        tecnologia: null,
        producto: null,
        familia: 'SERIES 41',
        class: 'A',
        descr: 'CABLE USB X',
        cliente: null,
        resv: 0,
        totalFuente: 0,
      },
    ];
    const west: WestCanon[] = [
      {
        sku: 'CABLE-USBX',
        prov: 'GENERAL',
        tecnologia: null,
        familia: 'ENERGIA',
        class: null,
        descr: 'CABLE USB X',
        fisico: 7,
      },
    ];
    const rec = reconcile({ productos, stock: [] }, west);
    expect(rec.westMatched).toBe(1);
    expect(rec.productos).toHaveLength(1);
    expect(rec.productos[0].familia).toBe('SERIES 41');
    expect(rec.productos[0].class).toBe('A');
    // sí complementa stock en el almacén WEST, que es lo único que MATCHED hace
    expect(rec.stock).toEqual([{ sku: 'CABLE-USBX', almacen: 'WEST', cantidad: 7 }]);
  });
});

// ============================================================
// [FIX-B1·T4] INTEGRACIÓN: el libro unificado de muestra
// (`muestra/inventario-unificado*.xlsx` — mismo archivo que usa
// `parse.west.test.ts` para las 3 eras). Se salta, no falla, si el
// archivo no está en el checkout (mismo criterio que el resto de la
// suite de integración de este directorio).
// ============================================================
const ARCHIVO_UNIFICADO_RECONCILE = libroStockVivo();
const hayUnificadoReconcile = ARCHIVO_UNIFICADO_RECONCILE !== null;

function hojaAGridReconcile(path: string, hoja: string): Grid {
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheet = wb.Sheets[hoja];
  if (!sheet) throw new Error(`hoja no encontrada en ${path}: ${hoja}`);
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

(hayUnificadoReconcile ? describe : describe.skip)(
  'reconcile — INTEGRACIÓN: libro unificado de muestra (en `muestra/`)',
  () => {
    if (!hayUnificadoReconcile) return; // `describe.skip` igual ejecuta este cuerpo
    const inv = parseInventario(hojaAGridReconcile(ARCHIVO_UNIFICADO_RECONCILE!, 'Inventario'));
    const west = parseWest(hojaAGridReconcile(ARCHIVO_UNIFICADO_RECONCILE!, 'INV WEST'));
    const rec = reconcile({ productos: inv.productos, stock: inv.stock }, west.rows);

    // SKU solo-WEST del libro de muestra — SOLO existe en 'INV WEST'
    // (no en 'Inventario'), con marca de DOS palabras, tecnología, familia y
    // CLASE vacía (esta fila no trae clase en el libro). Antes de este bloque
    // quedaba con tecnologia/familia/class en `null` a propósito; ahora
    // `parseWest` ya las lee y reconcile las propaga. Los valores salen del generador.
    const S = MUESTRA.westUnificadoSolo;
    it(`SKU que SOLO existe en WEST (${S.sku}) sale con tecnología/familia, no null`, () => {
      expect(inv.productos.some((x) => x.sku === S.sku)).toBe(false);
      const p = rec.productos.find((x) => x.sku === S.sku);
      expect(p).toBeDefined();
      expect(p?.marca).toBe(S.marca);
      expect(p?.tecnologia).toBe(S.tecnologia);
      expect(p?.familia).toBe(S.familia);
      expect(p?.class).toBe(S.clase); // esta fila del libro no trae CLASE (null)
      expect(p?.producto).toBeNull(); // WEST nunca trae PRODUCTO
    });

    it('cifras reconciliadas del libro unificado, por construcción: productos, matched y nuevos', () => {
      const U = MUESTRA.unificado;
      expect(inv.productos.length).toBe(U.productosInventario);
      expect(rec.westMatched).toBe(U.westMatched);
      expect(rec.westNuevos).toBe(U.westNuevos);
      expect(rec.productos.length).toBe(U.productosReconciliados);
    });
  },
);
