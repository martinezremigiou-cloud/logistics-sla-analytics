import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';
import type { InventoryQuery } from '@/schemas/inventory.schema';

const conVigenteStockMock = vi.fn();
vi.mock('./vigente.service', () => ({
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
}));

import {
  listInventory,
  buildCatalogPage,
  type ProductoRow,
  type StockRow,
  type OverrideRow,
  type MetadataRow,
} from './inventory.service';
import { mapearV2, SIN_TECNOLOGIA } from '@/lib/clasificacion';
import { CLAVES_ESTATUS, resolverEstatus } from '@/lib/estatus';
import { separarFamilias } from '@/lib/familias';
import type { ClasificacionV2Lectura } from './derivaciones';

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------
function productoRow(overrides: Partial<ProductoRow> = {}): ProductoRow {
  return {
    sku: 'A-1',
    resv: 0,
    descr_origen: 'Descripción original',
    cliente: null,
    marcas: { nombre: 'BRAND1' },
    familias: { nombre: 'CANDADOS' },
    ...overrides,
  };
}
function stockRow(sku: string, almacen: string, cantidad: number): StockRow {
  return { sku, cantidad, almacenes: { clave: almacen } };
}
function overrideRow(
  sku: string,
  campo: 'familia' | 'descripcion',
  valor: string,
  opts: Partial<OverrideRow> = {},
): OverrideRow {
  return {
    id: 'ovr-1',
    sku,
    campo,
    valor_editado: valor,
    editado_en: '2026-07-01T00:00:00.000Z',
    activo: true,
    ...opts,
  };
}
function v2Row(sku: string, overrides: Partial<ClasificacionV2Lectura> = {}): ClasificacionV2Lectura {
  return {
    sku,
    tecnologia: 'RFID',
    marca_v2: 'MARCA V2',
    familia_v2: 'FAMILIA V2',
    clase_v2: 'CLASE V2',
    descr_v2: 'Descr V2',
    ...overrides,
  };
}
function query(overrides: Partial<InventoryQuery> = {}): InventoryQuery {
  // `sinV2` siempre boolean tras zod (default 'false' → transform) — el helper
  // de test lo mimetiza para que `InventoryQuery` (el tipo real, post-parse)
  // quede satisfecho sin tener que repetirlo en cada llamada a `query(...)`.
  return { page: 1, pageSize: 50, sinV2: false, divergencia: false, ...overrides };
}

/** `almacenes` SIEMPRE con las 6 claves fijas en conteo 0 — mismo shape que produce un catálogo/universo vacío. */
const FACETAS_VACIAS = {
  tecnologias: [],
  marcas: [],
  familias: [],
  productos: [],
  almacenes: [
    { valor: 'NORTH', conteo: 0 },
    { valor: 'SOUTH', conteo: 0 },
    { valor: 'EAST', conteo: 0 },
    { valor: 'TRAN', conteo: 0 },
    { valor: 'BO', conteo: 0 },
    { valor: 'WEST', conteo: 0 },
  ],
  sin_familia: 0,
  sin_tecnologia: 0,
};

describe('buildCatalogPage', () => {
  it('sin filtros: total = todos los productos, orden sku ASC', () => {
    const productos = [productoRow({ sku: 'B-2' }), productoRow({ sku: 'A-1' })];
    const stock = [stockRow('B-2', 'NORTH', 5), stockRow('A-1', 'NORTH', 3)];
    const page = buildCatalogPage(productos, stock, [], [], query());

    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.sku)).toEqual(['A-1', 'B-2']);
  });

  it('orden por comparación de string simple, no localeCompare/orden numérico', () => {
    // Con comparación simple: 'A-10' < 'A-2' (compara char a char: '1' < '2').
    const productos = [productoRow({ sku: 'A-2' }), productoRow({ sku: 'A-10' }), productoRow({ sku: 'B-2' })];
    const page = buildCatalogPage(productos, [], [], [], query());
    expect(page.items.map((i) => i.sku)).toEqual(['A-10', 'A-2', 'B-2']);
  });

  it('mapea marca/familia/descr desde los embeds (objeto)', () => {
    const productos = [productoRow({ sku: 'A-1', marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' } })];
    const page = buildCatalogPage(productos, [stockRow('A-1', 'NORTH', 4)], [], [], query());
    expect(page.items[0]).toMatchObject({ marca: 'BRAND1', familia: 'CANDADOS', descripcion: 'Descripción original' });
  });

  it('acepta embeds como array (PostgREST many-to-one a veces llega así)', () => {
    const productos = [productoRow({ sku: 'A-1', marcas: [{ nombre: 'BRAND1' }], familias: [{ nombre: 'CANDADOS' }] })];
    const stock = [{ sku: 'A-1', cantidad: 4, almacenes: [{ clave: 'NORTH' }] }];
    const page = buildCatalogPage(productos, stock, [], [], query());
    expect(page.items[0]).toMatchObject({ marca: 'BRAND1', familia: 'CANDADOS', total: 4 });
  });

  describe('filtros', () => {
    const productos = [
      productoRow({ sku: 'A-1', descr_origen: 'Candado industrial', marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' } }),
      productoRow({ sku: 'B-2', descr_origen: 'Sensor EAS', marcas: { nombre: 'EAS' }, familias: { nombre: 'SENSORES' } }),
      productoRow({ sku: 'C-3', descr_origen: 'Cargador USB', marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CARGADORES' } }),
    ];
    const stock = [
      stockRow('A-1', 'NORTH', 10),
      stockRow('B-2', 'SOUTH', 5),
      stockRow('C-3', 'WEST', 8),
    ];

    it('q: substring case-insensitive sobre sku', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ q: 'a-1' }));
      expect(page.items.map((i) => i.sku)).toEqual(['A-1']);
    });

    it('q: substring case-insensitive sobre descr_efectiva', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ q: 'sensor' }));
      expect(page.items.map((i) => i.sku)).toEqual(['B-2']);
    });

    it('q sobre descr con override activo aplicado (busca sobre el valor efectivo, no el origen)', () => {
      const overrides = [overrideRow('A-1', 'descripcion', 'Producto BUSCABLE-XYZ')];
      const page = buildCatalogPage(productos, stock, overrides, [], query({ q: 'buscable-xyz' }));
      expect(page.items.map((i) => i.sku)).toEqual(['A-1']);
      expect(page.items[0].descripcion).toBe('Producto BUSCABLE-XYZ');
    });

    it('marca: igualdad case-insensitive', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ marca: 'brand1' }));
      expect(page.items.map((i) => i.sku)).toEqual(['A-1', 'C-3']);
    });

    it('familia: igualdad case-insensitive sobre familia_efectiva', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ familia: 'sensores' }));
      expect(page.items.map((i) => i.sku)).toEqual(['B-2']);
    });

    it('familia con override activo: filtra por el valor efectivo', () => {
      const overrides = [overrideRow('C-3', 'familia', 'SENSORES')];
      const page = buildCatalogPage(productos, stock, overrides, [], query({ familia: 'sensores' }));
      expect(page.items.map((i) => i.sku)).toEqual(['B-2', 'C-3']);
    });

    it('almacen: SKUs con cantidad>0 en ese almacén (WEST incluido, no requiere tratamiento especial)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ almacen: 'WEST' }));
      expect(page.items.map((i) => i.sku)).toEqual(['C-3']);
    });

    it('almacen: ignora filas con cantidad 0', () => {
      const stockConCero = [...stock, stockRow('B-2', 'WEST', 0)];
      const page = buildCatalogPage(productos, stockConCero, [], [], query({ almacen: 'WEST' }));
      expect(page.items.map((i) => i.sku)).toEqual(['C-3']);
    });

    it('filtros combinables (AND): marca + almacen', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ marca: 'brand1', almacen: 'WEST' }));
      expect(page.items.map((i) => i.sku)).toEqual(['C-3']);
    });

    it('filtros combinables (AND): q + marca + familia sin resultados → items vacío, total 0', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ q: 'cargador', marca: 'eas' }));
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.totalPages).toBe(0);
    });
  });

  it('badges correctos en el item (sobre_reservado + sin_familia combinados)', () => {
    const productos = [productoRow({ sku: 'A-1', resv: 100, familias: null as unknown as { nombre: string } })];
    const stock = [stockRow('A-1', 'NORTH', 4)];
    const page = buildCatalogPage(productos, stock, [], [], query());
    expect(page.items[0].familia).toBeNull();
    expect(page.items[0].badges).toEqual(['sobre_reservado', 'sin_familia']);
  });

  it('badge stock_cero: SKU sin filas de stock', () => {
    const productos = [productoRow({ sku: 'A-1', resv: 0 })];
    const page = buildCatalogPage(productos, [], [], [], query());
    expect(page.items[0].total).toBe(0);
    expect(page.items[0].badges).toEqual(['stock_cero']);
  });

  it('página fuera de rango → items vacío, total/totalPages reales (sin error)', () => {
    const productos = [productoRow({ sku: 'A-1' }), productoRow({ sku: 'B-2' })];
    const page = buildCatalogPage(productos, [], [], [], query({ page: 5, pageSize: 50 }));
    expect(page.items).toEqual([]);
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(1);
    expect(page.page).toBe(5);
    expect(page.pageSize).toBe(50);
  });

  it('pageSize al tope (200): pagina correctamente un catálogo grande', () => {
    const productos: ProductoRow[] = Array.from({ length: 250 }, (_, i) =>
      productoRow({ sku: `SKU-${String(i).padStart(4, '0')}` }),
    );
    const page1 = buildCatalogPage(productos, [], [], [], query({ page: 1, pageSize: 200 }));
    const page2 = buildCatalogPage(productos, [], [], [], query({ page: 2, pageSize: 200 }));

    expect(page1.total).toBe(250);
    expect(page1.totalPages).toBe(2);
    expect(page1.items).toHaveLength(200);
    expect(page2.items).toHaveLength(50);
    expect(page1.items[0].sku).toBe('SKU-0000');
    expect(page2.items[page2.items.length - 1].sku).toBe('SKU-0249');
  });

  describe('metadata (color/imagen_url)', () => {
    it('sin fila de metadata para el sku → color e imagen_url null', () => {
      const productos = [productoRow({ sku: 'A-1' })];
      const page = buildCatalogPage(productos, [], [], [], query());
      expect(page.items[0]).toMatchObject({ color: null, imagen_url: null });
    });

    it('con fila de metadata → color e imagen_url del sku correspondiente', () => {
      const productos = [productoRow({ sku: 'A-1' }), productoRow({ sku: 'B-2' })];
      const metadata: MetadataRow[] = [{ sku: 'A-1', color: 'morado', imagen_url: 'https://cdn/a-1.png' }];
      const page = buildCatalogPage(productos, [], [], metadata, query());

      const a1 = page.items.find((i) => i.sku === 'A-1');
      const b2 = page.items.find((i) => i.sku === 'B-2');
      expect(a1).toMatchObject({ color: 'morado', imagen_url: 'https://cdn/a-1.png' });
      expect(b2).toMatchObject({ color: null, imagen_url: null });
    });

    it('metadata con color asignado pero imagen_url null (independientes entre sí)', () => {
      const productos = [productoRow({ sku: 'A-1' })];
      const metadata: MetadataRow[] = [{ sku: 'A-1', color: 'rosa', imagen_url: null }];
      const page = buildCatalogPage(productos, [], [], metadata, query());
      expect(page.items[0]).toMatchObject({ color: 'rosa', imagen_url: null });
    });
  });

  describe('CAT-B1 · Tramo B — clasificacion_v2 CONGELADA (D-1(a), 17-sep)', () => {
    // ⚠ VACUA desde D-1(a) (CAT-B1 · Tramo B, 17-sep): con `v2` ignorada por
    // `resolverClasificacion` (ver derivaciones.ts), pasar el Map vacío por
    // defecto o pasar uno poblado es TAUTOLÓGICAMENTE idéntico — el 6º
    // parámetro ya no puede mover el resultado. Este test seguiría en verde
    // con cualquier implementación, incluida una que borrara el parámetro
    // `v2` por completo.
    it('sin Map v2 (5 args, retro-compat): comportamiento IDÉNTICO a pre-F3', () => {
      const productos = [productoRow({ sku: 'A-1', marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' } })];
      const page = buildCatalogPage(productos, [stockRow('A-1', 'NORTH', 4)], [], [], query());
      expect(page.items[0]).toMatchObject({
        marca: 'BRAND1',
        familia: 'CANDADOS',
        descripcion: 'Descripción original',
        tecnologia: null,
      });
    });

    // ------------------------------------------------------------
    // D-1(a): la capa v2 se CONGELA — pierde la precedencia que tenía en
    // B-PARCHE F1, la tabla NO se toca. Los 4 tests de abajo antes se
    // llamaban "*_v2 gana ..."; ahora prueban justo lo contrario, y CADA
    // UNO trae su propio control: si `derivaciones.ts` volviera a dejar
    // ganar a la v2, estos son los tests que se pondrían en rojo.
    // ------------------------------------------------------------
    it('familia_v2 YA NO gana: la familia efectiva es la de fuente, aunque exista fila v2', () => {
      const productos = [productoRow({ sku: 'A-1', familias: { nombre: 'CANDADOS' } })];
      const v2 = mapearV2([v2Row('A-1', { familia_v2: 'SEGURIDAD V2' })]);
      const page = buildCatalogPage(productos, [], [], [], query(), v2);
      expect(page.items[0].familia).toBe('CANDADOS');
    });

    it('marca_v2 YA NO gana: la marca efectiva es la de fuente, aunque exista fila v2', () => {
      const productos = [productoRow({ sku: 'A-1', marcas: { nombre: 'BRAND1' } })];
      const v2 = mapearV2([v2Row('A-1', { marca_v2: 'MARCA NUEVA' })]);
      const page = buildCatalogPage(productos, [], [], [], query(), v2);
      expect(page.items[0].marca).toBe('BRAND1');
    });

    it('override manual de familia SIGUE ganando (la capa manual no se tocó)', () => {
      const productos = [productoRow({ sku: 'A-1', familias: { nombre: 'CANDADOS' } })];
      const overrides = [overrideRow('A-1', 'familia', 'FAM MANUAL')];
      const v2 = mapearV2([v2Row('A-1', { familia_v2: 'FAM V2' })]);
      const page = buildCatalogPage(productos, [], overrides, [], query(), v2);
      expect(page.items[0].familia).toBe('FAM MANUAL');
    });

    it('override manual de descripción SIGUE ganando (la capa manual no se tocó)', () => {
      const productos = [productoRow({ sku: 'A-1', descr_origen: 'Original' })];
      const overrides = [overrideRow('A-1', 'descripcion', 'DESCR MANUAL')];
      const v2 = mapearV2([v2Row('A-1', { descr_v2: 'DESCR V2' })]);
      const page = buildCatalogPage(productos, [], overrides, [], query(), v2);
      expect(page.items[0].descripcion).toBe('DESCR MANUAL');
    });

    it('badge sin_familia: familia_v2 YA NO puebla una familia nula de fuente → el badge SIGUE aplicando', () => {
      const productos = [productoRow({ sku: 'A-1', familias: null as unknown as { nombre: string } })];
      const v2 = mapearV2([v2Row('A-1', { familia_v2: 'FAM V2' })]);
      const page = buildCatalogPage(productos, [stockRow('A-1', 'NORTH', 1)], [], [], query(), v2);
      expect(page.items[0].familia).toBeNull();
      expect(page.items[0].badges).toEqual(['sin_familia']);
    });

    // ------------------------------------------------------------
    // `tecnologia` es el caso que CAMBIA DE FORMA, no solo de ganador:
    // antes de este bloque no tenía capa fuente (`capaV2Solo`, SOLO v2);
    // desde la migración 0036 + D-1(a), `productos.tecnologia` es la ÚNICA
    // fuente y v2 se ignora igual que los demás campos.
    // ------------------------------------------------------------
    it('tecnologia poblada: viaja de la columna fuente productos.tecnologia, NO de v2', () => {
      const productos = [productoRow({ sku: 'A-1', tecnologia: 'RFID' })];
      const v2 = mapearV2([v2Row('A-1', { tecnologia: 'OTRA DE V2' })]);
      const page = buildCatalogPage(productos, [], [], [], query(), v2);
      expect(page.items[0].tecnologia).toBe('RFID');
    });

    it('tecnologia null: la columna fuente no trae valor, aunque exista fila v2 con tecnologia poblada', () => {
      const productos = [productoRow({ sku: 'A-1' }), productoRow({ sku: 'B-2' })];
      const v2 = mapearV2([v2Row('A-1', { tecnologia: 'RFID' })]);
      const page = buildCatalogPage(productos, [], [], [], query(), v2);
      expect(page.items.find((i) => i.sku === 'A-1')?.tecnologia).toBeNull();
      expect(page.items.find((i) => i.sku === 'B-2')?.tecnologia).toBeNull();
    });

    it('tecnologia null: sin fila v2 en absoluto tampoco importa — solo mira la columna fuente', () => {
      const productos = [productoRow({ sku: 'A-1' })];
      const page = buildCatalogPage(productos, [], [], [], query());
      expect(page.items[0].tecnologia).toBeNull();
    });

    describe('filtro ?tecnologia=', () => {
      const productos = [
        productoRow({ sku: 'A-1', tecnologia: 'RFID' }),
        productoRow({ sku: 'B-2', tecnologia: 'EAS' }),
        productoRow({ sku: 'C-3' }), // sin tecnologia en la fuente → tecnología efectiva null
      ];

      it('igualdad case-insensitive sobre la tecnología efectiva', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ tecnologia: 'rfid' }));
        expect(page.items.map((i) => i.sku)).toEqual(['A-1']);
      });

      it('SIN_TECNOLOGIA filtra los items con tecnología efectiva null', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ tecnologia: '__sin_tecnologia__' }));
        expect(page.items.map((i) => i.sku)).toEqual(['C-3']);
      });

      it('combinable (AND) con otro filtro: tecnologia + marca', () => {
        const productosConMarca = [
          productoRow({ sku: 'A-1', marcas: { nombre: 'BRAND1' }, tecnologia: 'RFID' }),
          productoRow({ sku: 'B-2', marcas: { nombre: 'EAS' }, tecnologia: 'EAS' }),
        ];
        const page = buildCatalogPage(productosConMarca, [], [], [], query({ tecnologia: 'rfid', marca: 'eas' }));
        expect(page.items).toEqual([]);
      });
    });
  });

  describe('Bloque 6 (F1 · O1) — drill-down aditivo ?badge=/?sinV2= desde las alertas del dashboard', () => {
    const productos = [
      productoRow({ sku: 'A-1', resv: 0, marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' } }),
      productoRow({ sku: 'B-2', resv: 100, marcas: { nombre: 'EAS' }, familias: { nombre: 'SENSORES' } }), // sobre-reservado
      productoRow({ sku: 'C-3', resv: 0, marcas: { nombre: 'BRAND1' }, familias: null as unknown as { nombre: string } }), // sin_familia
    ];
    const stock = [stockRow('A-1', 'NORTH', 10), stockRow('B-2', 'NORTH', 5), stockRow('C-3', 'NORTH', 8)];
    // C-3 SÍ tiene fila v2, pero con familia_v2 null (no puebla la familia
    // de fuente, también null) — conserva el badge sin_familia y a la vez
    // no cuenta para el filtro sinV2. B-2 queda SIN fila v2 (el único caso).
    const v2 = mapearV2([v2Row('A-1'), v2Row('C-3', { familia_v2: null })]);

    it('sin params (badge/sinV2 ausentes): respuesta IDÉNTICA al comportamiento pre-B6 (snapshot de contrato)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query(), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['A-1', 'B-2', 'C-3']);
      expect(page.total).toBe(3);
    });

    it('badge=sobre_reservado: solo items con ese badge', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ badge: 'sobre_reservado' }), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['B-2']);
      expect(page.total).toBe(1);
    });

    it('badge=sin_familia: solo items con ese badge', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ badge: 'sin_familia' }), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['C-3']);
    });

    it('badge sin coincidencias → items vacío, total 0 (sin lanzar)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ badge: 'stock_cero' }), v2);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('sinV2=true: solo items SIN fila en clasificacion_v2', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ sinV2: true }), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['B-2']);
    });

    it('sinV2=false (explícito): equivalente a sin filtro', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ sinV2: false }), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['A-1', 'B-2', 'C-3']);
    });

    it('badge + sinV2 combinables (AND)', () => {
      // B-2 es el único sobre_reservado Y el único sin v2 → coincide con ambos.
      const page = buildCatalogPage(productos, stock, [], [], query({ badge: 'sobre_reservado', sinV2: true }), v2);
      expect(page.items.map((i) => i.sku)).toEqual(['B-2']);
    });

    it('badge + sinV2 combinables (AND) sin resultados → items vacío', () => {
      // A-1 SÍ tiene v2 → sinV2 lo descarta aunque coincidiera con otro filtro.
      const page = buildCatalogPage(productos, stock, [], [], query({ badge: 'stock_cero', sinV2: true }), v2);
      expect(page.items).toEqual([]);
    });
  });

  describe('[2.0.1-A] O1 — filtro ?estatus= (estatus RESUELTO, no presencia de badge)', () => {
    // Universo que EJERCE las 4 claves de la taxonomía, incluido el caso
    // DIVERGENTE que separa `?estatus=` de `?badge=`:
    //   DIV-0 · total=0, resv=5  → badges [sobre_reservado, stock_cero]; su
    //           estatus RESUELTO es Sobre-reservado (precedencia). Es el SKU
    //           que un filtro ingenuo por badge clasificaría como "Sin stock".
    //   SOB-1 · total=5, resv=8  → sobre_reservado a secas.
    //   SIN-2 · total=0, resv=0  → stock_cero a secas → "Sin stock".
    //   RES-3 · total=4, resv=4  → disponible=0 sin badges → "Reservado completo".
    //   DIS-4 · total=10, resv=2 → "Disponible" (única con marca EAS, para el AND).
    const productos = [
      productoRow({ sku: 'DIV-0', resv: 5 }),
      productoRow({ sku: 'SOB-1', resv: 8 }),
      productoRow({ sku: 'SIN-2', resv: 0 }),
      productoRow({ sku: 'RES-3', resv: 4 }),
      productoRow({ sku: 'DIS-4', resv: 2, marcas: { nombre: 'EAS' } }),
    ];
    const stock = [stockRow('SOB-1', 'NORTH', 5), stockRow('RES-3', 'NORTH', 4), stockRow('DIS-4', 'NORTH', 10)];

    it('cada clave de la taxonomía filtra su conjunto — las 4 ramas EJERCIDAS', () => {
      const porClave: Record<string, string[]> = {};
      for (const clave of CLAVES_ESTATUS) {
        porClave[clave] = buildCatalogPage(productos, stock, [], [], query({ estatus: clave })).items.map((i) => i.sku);
      }
      expect(porClave).toEqual({
        sobre_reservado: ['DIV-0', 'SOB-1'],
        sin_stock: ['SIN-2'],
        reservado_completo: ['RES-3'],
        disponible: ['DIS-4'],
      });
    });

    it('partición: las claves (iteradas desde CLAVES_ESTATUS, no a mano) son disjuntas y suman el total', () => {
      // Si mañana nace un estatus, entra solo a esta iteración — la partición
      // se re-afirma sin editar el test.
      const sinFiltro = buildCatalogPage(productos, stock, [], [], query());
      const vistos = new Set<string>();
      let suma = 0;
      for (const clave of CLAVES_ESTATUS) {
        const page = buildCatalogPage(productos, stock, [], [], query({ estatus: clave }));
        for (const it of page.items) {
          expect(vistos.has(it.sku)).toBe(false); // disjuntas
          vistos.add(it.sku);
        }
        suma += page.total;
      }
      expect(suma).toBe(sinFiltro.total);
      expect(vistos.size).toBe(sinFiltro.total);
    });

    it('DIVERGENTE: ?estatus=sin_stock NO trae al SKU con ambos badges; ?badge=stock_cero SÍ', () => {
      // Es la diferencia de contrato entre los dos params, fijada sobre datos:
      // badge mira PRESENCIA (sin precedencia), estatus mira el RESUELTO.
      const porEstatus = buildCatalogPage(productos, stock, [], [], query({ estatus: 'sin_stock' }));
      expect(porEstatus.items.map((i) => i.sku)).toEqual(['SIN-2']);
      const porBadge = buildCatalogPage(productos, stock, [], [], query({ badge: 'stock_cero' }));
      expect(porBadge.items.map((i) => i.sku)).toEqual(['DIV-0', 'SIN-2']);
    });

    it('el estatus por el que se filtra ES el que pinta el renglón: misma función, mismos campos del item', () => {
      // No es vacuo (P19): con un filtro ingenuo por badge, DIV-0 entraría a
      // `sin_stock` y esta aserción caería — verificado con ese sabotaje.
      for (const clave of CLAVES_ESTATUS) {
        const page = buildCatalogPage(productos, stock, [], [], query({ estatus: clave }));
        for (const it of page.items) {
          expect(resolverEstatus(it.badges, it.disponible).clave).toBe(clave);
        }
      }
    });

    it('estatus ausente: respuesta idéntica al comportamiento previo (los 5, orden sku ASC)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query());
      expect(page.items.map((i) => i.sku)).toEqual(['DIS-4', 'DIV-0', 'RES-3', 'SIN-2', 'SOB-1']);
      expect(page.total).toBe(5);
    });

    it('combinable (AND) con marca — y el AND puede dar vacío sin lanzar', () => {
      const conMarca = buildCatalogPage(productos, stock, [], [], query({ estatus: 'disponible', marca: 'eas' }));
      expect(conMarca.items.map((i) => i.sku)).toEqual(['DIS-4']);
      const vacio = buildCatalogPage(productos, stock, [], [], query({ estatus: 'sin_stock', marca: 'eas' }));
      expect(vacio.items).toEqual([]);
      expect(vacio.total).toBe(0);
    });

    it('las facetas NO reaccionan a ?estatus= (mismo contrato que q/badge/sinV2)', () => {
      const sinFiltro = buildCatalogPage(productos, stock, [], [], query());
      const filtrada = buildCatalogPage(productos, stock, [], [], query({ estatus: 'sin_stock' }));
      expect(filtrada.facetas).toEqual(sinFiltro.facetas);
    });
  });

  describe('[2.0.1-A · D3] la bandera de divergencia y su filtro ?divergencia= — tras D-1(a)', () => {
    // ⚠ CONSECUENCIA MEDIDA DE D-1(a) (ver `derivaciones.ts` · divergenciaFamilia):
    // con `v2` fuera de la precedencia, la única forma de que
    // `resuelto.familia.origen` NO sea `'fuente'` es que gane un OVERRIDE
    // MANUAL. La clase `'v2'` queda INALCANZABLE — no es un bug de este
    // bloque, es el reverso exacto de que la v2 ya no pueda ganar. Estos
    // tests antes tenían un caso "DIV-V2" que probaba la divergencia de v2;
    // ahora ese caso se reescribe para afirmar que, con v2 presente pero
    // IGNORADA, NO hay divergencia que marcar.
    //
    //   V2-IGNORADA · archivo OBSOLETO, v2 CLIP 2.0        → sin divergencia (v2 ya no gana)
    //   DIV-MAN     · archivo OBSOLETO, override CANDADOS → divergencia MANUAL (el único cubo alcanzable)
    //   IGUAL       · archivo CANDADOS, v2 CANDADOS       → ninguna
    const productos = [
      productoRow({ sku: 'V2-IGNORADA', familias: { nombre: 'OBSOLETO' }, snapshot_id: 'S1' }),
      productoRow({ sku: 'DIV-MAN', familias: { nombre: 'OBSOLETO' }, snapshot_id: 'S1' }),
      productoRow({ sku: 'IGUAL', familias: { nombre: 'CANDADOS' }, snapshot_id: 'S1' }),
    ];
    const stock = [stockRow('V2-IGNORADA', 'NORTH', 3), stockRow('DIV-MAN', 'NORTH', 3), stockRow('IGUAL', 'NORTH', 3)];
    const overrides = [overrideRow('DIV-MAN', 'familia', 'CANDADOS')];
    const v2 = mapearV2([
      v2Row('V2-IGNORADA', { familia_v2: 'CLIP 2.0' }),
      v2Row('IGUAL', { familia_v2: 'CANDADOS' }),
    ]);

    it('el item declara la clase de divergencia y el crudo del archivo — v2 presente ya NO cuenta', () => {
      const page = buildCatalogPage(productos, stock, overrides, [], query(), v2, 'S1');
      const por = new Map(page.items.map((i) => [i.sku, i]));
      expect(por.get('V2-IGNORADA')?.divergencia_familia).toBeNull();
      expect(por.get('V2-IGNORADA')?.familia_fuente).toBe('OBSOLETO');
      expect(por.get('DIV-MAN')?.divergencia_familia).toBe('manual');
      expect(por.get('IGUAL')?.divergencia_familia).toBeNull();
      // La familia que se MUESTRA ahora es la de FUENTE (v2 se ignora): no
      // hay dos verdades que reconciliar, así que 'familia' es 'OBSOLETO'.
      expect(por.get('V2-IGNORADA')?.familia).toBe('OBSOLETO');
    });

    it('?divergencia=1 ya NO trae ningún SKU: la clase "v2" es inalcanzable y la manual no entra a este cubo', () => {
      const page = buildCatalogPage(productos, stock, overrides, [], query({ divergencia: true }), v2, 'S1');
      expect(page.items).toEqual([]);
    });

    it('sin el param: respuesta idéntica (los 3, orden sku ASC)', () => {
      const page = buildCatalogPage(productos, stock, overrides, [], query(), v2, 'S1');
      expect(page.items.map((i) => i.sku)).toEqual(['DIV-MAN', 'IGUAL', 'V2-IGNORADA']);
    });

    it('las facetas NO reaccionan al filtro (no participa de la cascada)', () => {
      const sinFiltro = buildCatalogPage(productos, stock, overrides, [], query(), v2, 'S1');
      const filtrada = buildCatalogPage(productos, stock, overrides, [], query({ divergencia: true }), v2, 'S1');
      expect(filtrada.facetas).toEqual(sinFiltro.facetas);
    });

    it('sin snapshot pinneado: v2 sigue sin marcar divergencia (no depende de la cláusula de remanente)', () => {
      const page = buildCatalogPage(productos, stock, overrides, [], query(), v2);
      expect(page.items.find((i) => i.sku === 'V2-IGNORADA')?.divergencia_familia).toBeNull();
    });

    it('combinable (AND) con los demás filtros: con la clase "v2" inalcanzable, cualquier combinación da vacío', () => {
      const page = buildCatalogPage(
        productos,
        stock,
        overrides,
        [],
        query({ divergencia: true, q: 'v2-ignorada' }),
        v2,
        'S1',
      );
      expect(page.items).toEqual([]);
    });
  });

  describe('INV-TAXO F3 — multi-valor de familias (chips)', () => {
    it('invariante: item.familias === separarFamilias(item.familia), incluso multi-valor y compuerta anti-fantasma', () => {
      const productos = [
        productoRow({ sku: 'A-1', familias: { nombre: 'CANDADOS' } }),
        productoRow({ sku: 'A-2', familias: { nombre: 'CLIP 3.0 / CLIP ROTATIVO' } }),
        productoRow({ sku: 'A-3', familias: { nombre: 'ZV680G/K' } }), // compuerta: no se atomiza
        productoRow({ sku: 'A-4', familias: null as unknown as { nombre: string } }),
      ];
      const page = buildCatalogPage(productos, [], [], [], query());
      for (const item of page.items) {
        expect(item.familias).toEqual(separarFamilias(item.familia));
      }
      expect(page.items.find((i) => i.sku === 'A-2')?.familias).toEqual(['CLIP 3.0', 'CLIP ROTATIVO']);
      expect(page.items.find((i) => i.sku === 'A-3')?.familias).toEqual(['ZV680G/K']);
      expect(page.items.find((i) => i.sku === 'A-4')?.familias).toEqual([]);
    });

    describe('filtro ?familia= — de igualdad exacta a PERTENENCIA (caso real SERIES12/SERIES 12)', () => {
      const productos = [
        productoRow({ sku: 'X-1', familias: { nombre: 'SERIES12' } }),
        productoRow({ sku: 'X-2', familias: { nombre: 'SERIES 12' } }),
        productoRow({ sku: 'X-3', familias: { nombre: 'SERIES12 / SERIES 12' } }), // multi-valor: antes invisible a ?familia=SERIES12
        productoRow({ sku: 'X-4', familias: { nombre: 'CLIPS MODULAR' } }),
      ];

      it('?familia=SERIES12 ahora encuentra también al SKU multi-valor (X-3), sin capturar X-2 por substring', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ familia: 'SERIES12' }));
        expect(page.items.map((i) => i.sku)).toEqual(['X-1', 'X-3']);
      });

      it('?familia=SERIES 12 sigue siendo exacto (token completo) para X-2 y X-3', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ familia: 'SERIES 12' }));
        expect(page.items.map((i) => i.sku)).toEqual(['X-2', 'X-3']);
      });

      it('case-insensitive: ?familia=series12', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ familia: 'series12' }));
        expect(page.items.map((i) => i.sku)).toEqual(['X-1', 'X-3']);
      });
    });

    describe('?q= — substring también sobre cada átomo de familia (caso real ROTATIVO)', () => {
      const productos = [
        productoRow({ sku: 'R-1', descr_origen: 'Sin relación', familias: { nombre: 'CLIP 3.0 / CLIP ROTATIVO' } }),
        productoRow({ sku: 'R-2', descr_origen: 'Otra descripción', familias: { nombre: 'CANDADOS' } }),
      ];

      it('?q=rotativo encuentra R-1 vía familias aunque sku/descripción no lo contengan', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ q: 'rotativo' }));
        expect(page.items.map((i) => i.sku)).toEqual(['R-1']);
      });

      it('?q= sigue funcionando sobre sku/descripción cuando no hay match de familia', () => {
        const page = buildCatalogPage(productos, [], [], [], query({ q: 'otra descripción' }));
        expect(page.items.map((i) => i.sku)).toEqual(['R-2']);
      });
    });
  });

  describe('INV-TAXO F3 — facetas en cascada', () => {
    // Universo: 5 SKUs, 3 marcas (BRAND1, EAS, BRAND6), 2 tecnologías
    // (RFID, EAS) + 1 sin tecnología, familias multi-valor incluidas.
    const productos = [
      productoRow({ sku: 'P-1', marcas: { nombre: 'BRAND1' }, familias: { nombre: 'CANDADOS' }, tecnologia: 'RFID' }),
      productoRow({
        sku: 'P-2',
        marcas: { nombre: 'BRAND1' },
        familias: { nombre: 'SENSORES / CARGADORES' },
        tecnologia: 'RFID',
      }),
      productoRow({ sku: 'P-3', marcas: { nombre: 'EAS' }, familias: { nombre: 'SENSORES' }, tecnologia: 'EAS' }),
      productoRow({ sku: 'P-4', marcas: { nombre: 'EAS' }, familias: null as unknown as { nombre: string } }), // sin tecnologia en la fuente
      productoRow({ sku: 'P-5', marcas: { nombre: 'BRAND6' }, familias: { nombre: 'CLIPS' }, tecnologia: 'EAS' }),
    ];
    const stock = [
      stockRow('P-1', 'NORTH', 5),
      stockRow('P-2', 'SOUTH', 3),
      stockRow('P-3', 'NORTH', 2),
      stockRow('P-4', 'WEST', 1),
      stockRow('P-5', 'TRAN', 4),
    ];

    it('tecnologias: SIEMPRE sobre el universo completo (no reacciona a marca/familia/almacen)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ marca: 'BRAND1' }));
      expect(page.facetas.tecnologias).toEqual([
        { valor: 'EAS', conteo: 2 },
        { valor: 'RFID', conteo: 2 },
      ]);
    });

    it('marcas: sobre universo ∩ tecnología (NO reacciona a la propia marca ni a familia/almacen)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'RFID' }));
      expect(page.facetas.marcas).toEqual([{ valor: 'BRAND1', conteo: 2 }]);
    });

    it('marcas con otra tecnología: EAS+BRAND6, cada una con 1 SKU', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'EAS' }));
      expect(page.facetas.marcas).toEqual([
        { valor: 'BRAND6', conteo: 1 },
        { valor: 'EAS', conteo: 1 },
      ]);
    });

    it('familias + sin_familia: sobre universo ∩ tecnología ∩ marca — Σ familias.conteo puede ser > total de SKUs de ese alcance (multi-valor)', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'RFID', marca: 'BRAND1' }));
      expect(page.total).toBe(2); // P-1, P-2
      expect(page.facetas.familias).toEqual([
        { valor: 'CANDADOS', conteo: 1 },
        { valor: 'CARGADORES', conteo: 1 },
        { valor: 'SENSORES', conteo: 1 },
      ]);
      const sumaFamilias = page.facetas.familias.reduce((s, f) => s + f.conteo, 0);
      expect(sumaFamilias).toBe(3);
      expect(sumaFamilias).toBeGreaterThan(page.total);
      expect(page.facetas.sin_familia).toBe(0);
    });

    it('sin_familia cuenta los SKUs sin ninguna familia efectiva dentro del alcance', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: SIN_TECNOLOGIA }));
      expect(page.facetas.sin_familia).toBe(1); // P-4
      expect(page.facetas.familias).toEqual([]);
    });

    it('almacenes: SIEMPRE las 6 claves fijas (aunque varias queden en 0), sobre universo ∩ tecnología ∩ marca', () => {
      const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'RFID', marca: 'BRAND1' }));
      expect(page.facetas.almacenes).toEqual([
        { valor: 'NORTH', conteo: 1 },
        { valor: 'SOUTH', conteo: 1 },
        { valor: 'EAST', conteo: 0 },
        { valor: 'TRAN', conteo: 0 },
        { valor: 'BO', conteo: 0 },
        { valor: 'WEST', conteo: 0 },
      ]);
    });

    describe('REGLA ANTI-TRAMPA — el valor seleccionado viaja SIEMPRE, aunque su conteo sea 0', () => {
      it('marca seleccionada sin SKUs bajo la tecnología activa → viaja con conteo 0 (no desaparece del selector)', () => {
        // EAS (marca) no tiene ningún SKU con tecnología RFID.
        const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'RFID', marca: 'EAS' }));
        expect(page.facetas.marcas).toEqual([
          { valor: 'BRAND1', conteo: 2 },
          { valor: 'EAS', conteo: 0 },
        ]);
        expect(page.items).toEqual([]); // el filtro real SÍ excluye (AND real), solo la faceta lo preserva
      });

      it('tecnología seleccionada inexistente en el catálogo → viaja con conteo 0', () => {
        const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'NFC' }));
        expect(page.facetas.tecnologias).toEqual(
          expect.arrayContaining([{ valor: 'NFC', conteo: 0 }]),
        );
      });

      it('familia seleccionada sin SKUs en el alcance → viaja con conteo 0 (BRAND6 solo tiene CLIPS)', () => {
        const page = buildCatalogPage(productos, stock, [], [], query({ marca: 'BRAND6', familia: 'CANDADOS' }));
        expect(page.facetas.familias).toEqual([
          { valor: 'CANDADOS', conteo: 0 },
          { valor: 'CLIPS', conteo: 1 },
        ]);
      });

      it('el sentinel SIN_TECNOLOGIA NUNCA se inyecta como si fuera una tecnología real', () => {
        const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: SIN_TECNOLOGIA }));
        expect(page.facetas.tecnologias.some((f) => f.valor === SIN_TECNOLOGIA)).toBe(false);
        expect(page.facetas.tecnologias).toEqual([
          { valor: 'EAS', conteo: 2 },
          { valor: 'RFID', conteo: 2 },
        ]);
      });
    });

    // (INV-B7B · O2) `sin_tecnologia`: complemento de `tecnologias`, SIEMPRE
    // sobre el universo COMPLETO — mismo criterio que `almacenes`, sin la
    // regla anti-trampa (Tecnología es la raíz, no tiene cascada superior).
    describe('sin_tecnologia (O2) — universo completo, SIN regla anti-trampa', () => {
      it('cuenta los SKUs con tecnología efectiva null sobre el universo completo, sin filtros', () => {
        const page = buildCatalogPage(productos, stock, [], [], query());
        expect(page.facetas.sin_tecnologia).toBe(1); // P-4, sin tecnologia en la fuente
      });

      it('NO reacciona a ningún filtro de la cascada (marca/tecnologia/familia) — mismo valor siempre', () => {
        const sinFiltro = buildCatalogPage(productos, stock, [], [], query()).facetas.sin_tecnologia;
        const conMarca = buildCatalogPage(productos, stock, [], [], query({ marca: 'BRAND1' })).facetas.sin_tecnologia;
        const conTecnologia = buildCatalogPage(productos, stock, [], [], query({ tecnologia: 'RFID' })).facetas
          .sin_tecnologia;
        const conFamilia = buildCatalogPage(productos, stock, [], [], query({ familia: 'CLIPS' })).facetas
          .sin_tecnologia;
        expect(sinFiltro).toBe(1);
        expect(conMarca).toBe(1);
        expect(conTecnologia).toBe(1);
        expect(conFamilia).toBe(1);
      });

      it('0 cuando todos los SKUs del universo tienen tecnología efectiva poblada', () => {
        const productosTodosConTec = [
          productoRow({ sku: 'Z-1', tecnologia: 'RFID' }),
          productoRow({ sku: 'Z-2', tecnologia: 'EAS' }),
        ];
        const page = buildCatalogPage(productosTodosConTec, [], [], [], query());
        expect(page.facetas.sin_tecnologia).toBe(0);
      });

      it('el sentinel SIN_TECNOLOGIA como filtro activo no altera el conteo (sigue siendo universo completo)', () => {
        const page = buildCatalogPage(productos, stock, [], [], query({ tecnologia: SIN_TECNOLOGIA }));
        expect(page.facetas.sin_tecnologia).toBe(1);
      });
    });
  });
});

// ============================================================
// GATE C (CAT-B1 · Tramo C) — `productos`: ÚLTIMO nivel de la cascada
// (tecnologia ∩ marca ∩ familia). Fixture SINTÉTICO con una FORMA
// ilustrativa de catálogo: una tecnología (BRAND1) concentra todos los
// productos, con valores CRUDOS que llevan barra; las demás tecnologías
// (EAS, BRAND2) y los SKU sin tecnología no tienen ninguno. La faceta NO
// cuenta valores crudos: cuenta ÁTOMOS — `separarFamilias` atomiza esos
// crudos (ver `fixtureVigente`, abajo, para la aritmética exacta). CONTROL POSITIVO ESTRUCTURAL: ninguna tecnología ≠
// BRAND1 tiene UN SOLO producto — (b)/(c)/(BRAND2) de abajo verifican
// exactamente eso.
// ============================================================
describe('GATE C (CAT-B1 · Tramo C) — producto: 4º nivel de la cascada, proporciones sintéticas', () => {
  /**
   * (CAT-B1 · Tramo C, reparo 1) Universo BRAND1 sintético con barras
   * en `producto` (todo inventado): 39 valores CRUDOS de `producto`, de los cuales 15
   * llevan '/' — que `separarFamilias` atomiza a 32 ÁTOMOS distintos (24
   * elementales + 8 que SOLO existen combinados tras una barra). La
   * atomización NO es un no-op aquí: el crudo 'CLIP 3.0 / CLIP ROTATIVO' no
   * es igual a 'CLIP 3.0', y eso es justo lo que hace morder al gate si
   * `contieneFamilia`/`separarFamilias` degradan a `===` (ver el test
   * "MUERDE AL MUTANTE" abajo). Reproduce el caso 'CLIP 3.0': 5 SKU por
   * IGUALDAD (el crudo exacto 'CLIP 3.0') + 23 SKU MÁS por PERTENENCIA
   * (combinado con otro átomo tras la barra) = 28 por membresía — con `===`
   * se perderían esos 23 (la mayor parte de la rama).
   */
  function fixtureVigente(): ProductoRow[] {
    const rows: ProductoRow[] = [];
    let n = 0;
    function agregar(producto: string, cuenta: number) {
      for (let i = 0; i < cuenta; i++) {
        rows.push(
          productoRow({
            sku: `BRAND1-${n++}`,
            marcas: { nombre: 'BRAND1' },
            familias: { nombre: 'CANDADOS' },
            tecnologia: 'BRAND1',
            producto,
          }),
        );
      }
    }

    // El caso 'CLIP 3.0': 4 crudos (1 elemental + 3 con barra), 28 SKU por
    // pertenencia, 5 de ellos por igualdad exacta.
    agregar('CLIP 3.0', 5);
    agregar('CLIP 3.0 / CLIP ROTATIVO', 12);
    agregar('CLIP 3.0 / SERIES 2 26', 7);
    agregar('CLIP 3.0 / C5370', 4);
    // Los otros dos átomos de esos combos también existen SOLOS en el
    // vigente (no son fantasmas del combo) — se cuentan aparte.
    agregar('CLIP ROTATIVO', 4);
    agregar('SERIES 2 26', 9);
    agregar('C5370', 11);

    // 20 átomos elementales genéricos (sin barra, cada uno ES un átomo) +
    // 8 átomos que SOLO existen combinados tras una barra (nunca
    // elementales por sí solos). 12 crudos-con-barra emparejan cada uno de
    // los 8 con un elemental YA CONTADO (índices 0-11 de `genericos`): el
    // CRUDO es distinto en cada caso (la pareja cambia) pero el ÁTOMO de la
    // derecha no es nuevo — así es como 15 crudos-con-barra aportan solo 8
    // átomos nuevos en vez de hasta 30.
    const genericos = Array.from({ length: 20 }, (_, k) => `PRODUCTO-E-${k}`);
    const nuevos = Array.from({ length: 8 }, (_, k) => `ATOMO-NUEVO-${k}`);
    // 102 SKU repartidos entre 20 elementales + 12 combos (32 crudos):
    // 3 a cada uno + 1 extra a los primeros 6 (32*3 + 6 = 102).
    genericos.forEach((p, idx) => agregar(p, idx < 6 ? 4 : 3));
    for (let i = 0; i < 12; i++) {
      agregar(`${nuevos[i % 8]} / ${genericos[i]}`, 3);
    }
    // 39 crudos (24 elementales + 15 con barra), 32 átomos (24 + 8),
    // 154 SKU (28 + 24 + 102) — la aritmética exacta del Gate C.

    for (let i = 0; i < 40; i++) {
      rows.push(
        productoRow({ sku: `EAS-${i}`, marcas: { nombre: 'EAS' }, tecnologia: 'EAS', producto: null }),
      );
    }
    for (let i = 0; i < 25; i++) {
      rows.push(
        productoRow({ sku: `SINTEC-${i}`, marcas: { nombre: 'GENERICA' }, tecnologia: null, producto: null }),
      );
    }
    for (let i = 0; i < 6; i++) {
      rows.push(
        productoRow({ sku: `BRAND2-${i}`, marcas: { nombre: 'BRAND2' }, tecnologia: 'BRAND2', producto: null }),
      );
    }
    return rows;
  }

  it('CONTROL POSITIVO ESTRUCTURAL: 225 = 154 BRAND1 + 40 EAS + 25 sin tecnología + 6 BRAND2', () => {
    const productos = fixtureVigente();
    expect(productos.length).toBe(225);
    const porTecnologia = new Map<string, number>();
    for (const p of productos) {
      const clave = p.tecnologia ?? '__sin__';
      porTecnologia.set(clave, (porTecnologia.get(clave) ?? 0) + 1);
    }
    expect(porTecnologia.get('BRAND1')).toBe(154);
    expect(porTecnologia.get('EAS')).toBe(40);
    expect(porTecnologia.get('__sin__')).toBe(25);
    expect(porTecnologia.get('BRAND2')).toBe(6);
  });

  it('(a) tecnologia=BRAND1: 154 SKU con producto y 32 ÁTOMOS distintos (39 valores CRUDOS que `separarFamilias` atomiza)', () => {
    const page = buildCatalogPage(fixtureVigente(), [], [], [], query({ tecnologia: 'BRAND1' }));
    expect(page.total).toBe(154);
    expect(page.facetas.productos).toHaveLength(32);
  });

  it('MUERDE AL MUTANTE: la rama "CLIP 3.0" tiene conteo 28 (no 5) y `?producto=CLIP 3.0` trae 28 SKU — se rompe si `contieneFamilia`/`separarFamilias` degradan a `===` (perdería 23)', () => {
    const productos = fixtureVigente();
    const conFacetas = buildCatalogPage(productos, [], [], [], query({ tecnologia: 'BRAND1' }));
    const series24 = conFacetas.facetas.productos.find((f) => f.valor === 'CLIP 3.0');
    expect(series24?.conteo).toBe(28);
    const filtrado = buildCatalogPage(productos, [], [], [], query({ tecnologia: 'BRAND1', producto: 'CLIP 3.0' }));
    expect(filtrado.total).toBe(28);
  });

  it('ESTADO POR OMISIÓN (sin filtro de tecnología — lo primero que ve todo usuario en /catalogo): 32 ÁTOMOS, idéntico a tecnologia=BRAND1 porque SOLO BRAND1 aporta — y 71 SKU (40 EAS + 25 sin tecnología + 6 BRAND2, de 225) quedan FUERA de toda rama SIN complemento "sin_producto": decisión deliberada del bloque (ver doc-comment de CatalogoFacetas.productos, types/api.ts), no un hueco sin probar (P24)', () => {
    const page = buildCatalogPage(fixtureVigente(), [], [], [], query({ pageSize: 1000 }));
    expect(page.total).toBe(225);
    expect(page.facetas.productos).toHaveLength(32);
    const sinProducto = page.items.filter((it) => it.producto == null).length;
    expect(sinProducto).toBe(71);
  });

  it('(b) CONTROL POSITIVO: tecnologia=EAS → facetas.productos queda VACÍA (la sección no tiene con qué pintarse)', () => {
    const page = buildCatalogPage(fixtureVigente(), [], [], [], query({ tecnologia: 'EAS' }));
    expect(page.total).toBe(40);
    expect(page.facetas.productos).toEqual([]);
  });

  it('(c) SIN TECNOLOGIA: agrupa 25 y TAMPOCO puebla facetas.productos', () => {
    const page = buildCatalogPage(fixtureVigente(), [], [], [], query({ tecnologia: SIN_TECNOLOGIA }));
    expect(page.total).toBe(25);
    expect(page.facetas.sin_tecnologia).toBe(25);
    expect(page.facetas.productos).toEqual([]);
  });

  it('BRAND2 (la 4ª tecnología del universo): tampoco tiene productos', () => {
    const page = buildCatalogPage(fixtureVigente(), [], [], [], query({ tecnologia: 'BRAND2' }));
    expect(page.total).toBe(6);
    expect(page.facetas.productos).toEqual([]);
  });

  it('PERTENENCIA multi-valor: ?producto= filtra por el mismo mecanismo que ?familia= (contieneFamilia)', () => {
    const productos = [
      productoRow({ sku: 'M-1', tecnologia: 'BRAND1', producto: 'CLIP 3.0 / CLIP ROTATIVO' }),
      productoRow({ sku: 'M-2', tecnologia: 'BRAND1', producto: 'OTRO' }),
    ];
    const page = buildCatalogPage(productos, [], [], [], query({ producto: 'CLIP ROTATIVO' }));
    expect(page.items.map((i) => i.sku)).toEqual(['M-1']);
  });

  it('REGLA ANTI-TRAMPA: ?producto= seleccionado viaja con conteo 0 aunque la tecnología activa lo deje sin SKUs', () => {
    const productos = [productoRow({ sku: 'N-1', tecnologia: 'BRAND1', producto: 'SOLO-BRAND1' })];
    const page = buildCatalogPage(productos, [], [], [], query({ tecnologia: 'EAS', producto: 'SOLO-BRAND1' }));
    expect(page.facetas.productos).toEqual([{ valor: 'SOLO-BRAND1', conteo: 0 }]);
  });

  it('CatalogoItem.producto expone la capa fuente (gemelo de tecnologia)', () => {
    const productos = [productoRow({ sku: 'O-1', tecnologia: 'BRAND1', producto: 'PM3' })];
    const page = buildCatalogPage(productos, [], [], [], query());
    expect(page.items[0].producto).toBe('PM3');
  });
});

describe('listInventory', () => {
  beforeEach(() => {
    conVigenteStockMock.mockReset();
  });

  it('sin snapshot vigente → página vacía con page/pageSize del query (200, no error)', async () => {
    conVigenteStockMock.mockResolvedValueOnce(null);
    const fakeDb = {} as unknown as SupabaseClient;

    const result = await listInventory(fakeDb, query({ page: 2, pageSize: 25 }));

    expect(result).toEqual({ items: [], page: 2, pageSize: 25, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } });
  });

  it('pinnea contra el snapshot vigente y arma el fetch paralelo (productos/stock/overrides/metadata)', async () => {
    const calls: { table: string; select: string; eq: [string, unknown][] }[] = [];
    const dataByTable: Record<string, unknown[]> = {
      productos: [
        {
          sku: 'A-1',
          resv: 0,
          descr_origen: 'Descr A',
          cliente: null,
          marcas: { nombre: 'BRAND1' },
          familias: { nombre: 'CANDADOS' },
        },
      ],
      stock_por_almacen: [{ sku: 'A-1', cantidad: 10, almacenes: { clave: 'NORTH' } }],
      productos_override: [],
      productos_metadata: [{ sku: 'A-1', color: 'azul', imagen_url: 'https://cdn/a-1.png' }],
    };

    function fakeDb() {
      return {
        from(table: string) {
          const eqCalls: [string, unknown][] = [];
          return {
            select(sel: string) {
              function range(from: number, to: number) {
                calls.push({ table, select: sel, eq: [...eqCalls] });
                const rows = dataByTable[table] ?? [];
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
              }
              return {
                eq(col: string, val: unknown) {
                  eqCalls.push([col, val]);
                  return { range };
                },
                // `productos_metadata` no filtra por snapshot: encadena `.range()` directo, sin `.eq()`.
                range,
              };
            },
          };
        },
      } as unknown as SupabaseClient;
    }

    const vigente: SnapshotVigente = { id: 'snap-9', created_at: '2026-07-10T00:00:00.000Z', filas: 1, archivo: null };
    conVigenteStockMock.mockImplementationOnce(
      async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) => fetcher(vigente),
    );

    const result = await listInventory(fakeDb(), query());

    expect(result.total).toBe(1);
    // (v2) `tecnologia` se agrega SIEMPRE al item (B-PARCHE F3); sin filas en
    // `clasificacion_v2` (tabla ausente de `dataByTable` ⇒ `[]`) → null.
    expect(result.items).toEqual([
      {
        sku: 'A-1',
        marca: 'BRAND1',
        familia: 'CANDADOS',
        familias: ['CANDADOS'],
        descripcion: 'Descr A',
        total: 10,
        reservado: 0,
        disponible: 10,
        badges: [],
        // [2.0.1-A · D3] los dos campos nuevos del contrato: sin fila v2 gana la
        // fuente, así que no hay dos verdades y la bandera es null.
        divergencia_familia: null,
        familia_fuente: 'CANDADOS',
        color: 'azul',
        imagen_url: 'https://cdn/a-1.png',
        tecnologia: null,
        // [CAT-B1 · Tramo C] gemelo de `tecnologia`: sin `producto` en la fila cruda, null.
        producto: null,
      },
    ]);

    const productosCall = calls.find((c) => c.table === 'productos');
    const stockCall = calls.find((c) => c.table === 'stock_por_almacen');
    const overridesCall = calls.find((c) => c.table === 'productos_override');
    const metadataCall = calls.find((c) => c.table === 'productos_metadata');
    const clasificacionV2Call = calls.find((c) => c.table === 'clasificacion_v2');

    expect(productosCall?.select).toBe(
      'sku,resv,descr_origen,cliente,snapshot_id,tecnologia,producto, marcas(nombre,excluida_del_catalogo), familias(nombre)',
    );
    expect(productosCall?.eq).toEqual([['snapshot_id', 'snap-9']]);
    expect(stockCall?.select).toBe('sku,cantidad, almacenes(clave)');
    expect(stockCall?.eq).toEqual([['snapshot_id', 'snap-9']]);
    expect(overridesCall?.select).toBe('id,sku,campo,valor_editado,editado_en,activo');
    expect(overridesCall?.eq).toEqual([['activo', true]]);
    expect(metadataCall?.select).toBe('sku,color,imagen_url');
    expect(metadataCall?.eq).toEqual([]);
    // (v2) B-PARCHE F3: fetch nuevo de clasificacion_v2, sin filtro de snapshot (como metadata).
    expect(clasificacionV2Call?.select).toBe('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2');
    expect(clasificacionV2Call?.eq).toEqual([]);
  });

  it('(v2) 42P01 en clasificacion_v2 (tabla aún no aplicada) → catálogo idéntico al pre-parche, sin lanzar', async () => {
    const dataByTable: Record<string, unknown[]> = {
      productos: [
        {
          sku: 'A-1',
          resv: 0,
          descr_origen: 'Descr A',
          cliente: null,
          marcas: { nombre: 'BRAND1' },
          familias: { nombre: 'CANDADOS' },
        },
      ],
      stock_por_almacen: [{ sku: 'A-1', cantidad: 10, almacenes: { clave: 'NORTH' } }],
      productos_override: [],
      productos_metadata: [],
    };

    function fakeDb() {
      return {
        from(table: string) {
          return {
            select() {
              function range(from: number, to: number) {
                if (table === 'clasificacion_v2') {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'relation "public.clasificacion_v2" does not exist', code: '42P01' },
                  });
                }
                const rows = dataByTable[table] ?? [];
                return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
              }
              return {
                eq() {
                  return { range };
                },
                range,
              };
            },
          };
        },
      } as unknown as SupabaseClient;
    }

    const vigente: SnapshotVigente = { id: 'snap-9', created_at: '2026-07-10T00:00:00.000Z', filas: 1, archivo: null };
    conVigenteStockMock.mockImplementationOnce(
      async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) => fetcher(vigente),
    );

    const result = await listInventory(fakeDb(), query());

    expect(result.items).toEqual([
      {
        sku: 'A-1',
        marca: 'BRAND1',
        familia: 'CANDADOS',
        familias: ['CANDADOS'],
        descripcion: 'Descr A',
        total: 10,
        reservado: 0,
        disponible: 10,
        badges: [],
        divergencia_familia: null,
        familia_fuente: 'CANDADOS',
        color: null,
        imagen_url: null,
        tecnologia: null,
        producto: null,
      },
    ]);
  });
});
