// ============================================================
// [FIX-B1 · item 7] Conteo ÚNICO de «productos sin tecnología»: el
// catálogo (`inventory.service.ts`, `facetas.sin_tecnologia`) y el
// tablero (`dashboard.service.ts`, `kpis.productos_sin_tecnologia`) usan
// la MISMA función (`contarSinTecnologia`, `derivaciones.ts`) — este test
// los ejercita a los DOS, con el MISMO universo de SKUs, y verifica que
// dan el MISMO número. No es un test de `contarSinTecnologia` en
// aislamiento (ver `derivaciones.test.ts` para eso): es el CRUCE entre
// los dos consumidores, que es justo donde una segunda implementación
// divergiría sin que ningún test lo note (P2).
//
// [C2] Qué prueba cada caso, porque NO son lo mismo:
//   · Los casos sobre los constructores PUROS (`buildCatalogPage` /
//     `buildDashboard`) les dan a los dos la MISMA entrada ya armada:
//     prueban la aritmética compartida (`resolverClasificacion` +
//     `contarSinTecnologia`) sobre esa entrada, no el fetch de ninguno.
//   · El último `describe` entra por `listInventory` / `getDashboard` sobre
//     UN cliente falso compartido: ahí cada mitad lee, excluye y mapea por
//     su propio camino — que es donde viven la exclusión por marca del
//     tablero y el mapeo de sus capturas.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

// Sólo lo usa el último `describe` (las lecturas reales). Los constructores
// puros no llaman a `vigente.service`, así que el mock no los toca.
const conVigenteStockMock = vi.fn();
const resolveVigenteMock = vi.fn();
vi.mock('./vigente.service', () => ({
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
  resolveVigente: (...args: unknown[]) => resolveVigenteMock(...args),
}));

import { buildCatalogPage, listInventory, type ProductoRow, type StockRow, type OverrideRow } from './inventory.service';
import { buildDashboard, getDashboard, type BuildDashboardInput, type DashboardEstatusRow } from './dashboard.service';
import type { InventoryQuery } from '@/schemas/inventory.schema';
import type { ProductoLectura, OverrideLectura } from './derivaciones';

/** Universo compartido: 5 SKU, 2 sin tecnología (fuente null, sin override). */
const SKUS: Array<{ sku: string; tecnologia: string | null }> = [
  { sku: 'A-1', tecnologia: 'EAS' },
  { sku: 'A-2', tecnologia: null },
  { sku: 'A-3', tecnologia: 'BRAND1' },
  { sku: 'A-4', tecnologia: null },
  { sku: 'A-5', tecnologia: 'BRAND2' },
];
const ESPERADO_SIN_TECNOLOGIA = 2;

const QUERY_BASE: InventoryQuery = {
  divergencia: false,
  sinV2: false,
  page: 1,
  pageSize: 50,
};

const ESTATUS_FIXTURE: DashboardEstatusRow[] = [
  { orden: 1, nombre: 'Producto Solicitado' },
  { orden: 2, nombre: 'En Preparación' },
  { orden: 3, nombre: 'En Recolección' },
  { orden: 4, nombre: 'En Almacén FW' },
  { orden: 5, nombre: 'En Tránsito Aéreo' },
  { orden: 6, nombre: 'En Tránsito Marítimo' },
  { orden: 7, nombre: 'En Aduana' },
  { orden: 8, nombre: 'En Tránsito Terrestre' },
  { orden: 9, nombre: 'En Almacén Fiscal' },
  { orden: 10, nombre: 'En Almacén North' },
  { orden: 11, nombre: 'Producto Disponible' },
];

function baseDashboardInput(overrides: Partial<BuildDashboardInput> = {}): BuildDashboardInput {
  return {
    hoy: '2026-07-20',
    vigenteStockSnap: null,
    vigenteAduanaSnap: null,
    productos: [],
    stock: [],
    reservas: [],
    overrides: [],
    v2: [],
    embarquesActivos: [],
    estatus: ESTATUS_FIXTURE,
    periodos: { actual: null, anterior: null },
    tendencia: [],
    piezasEnCaminoBase: null,
    pendientesAbiertos: 0,
    tecnologia: null,
    ...overrides,
  };
}

describe('conteo único de «sin tecnología»: catálogo y tablero coinciden', () => {
  it('sobre el MISMO universo de 5 SKU (2 sin tecnología), facetas.sin_tecnologia === kpis.productos_sin_tecnologia.valor === 2', () => {
    // --- Catálogo (inventory.service.ts) ---
    const productosRow: ProductoRow[] = SKUS.map((s) => ({
      sku: s.sku,
      resv: 0,
      descr_origen: 'Descr',
      cliente: null,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'CANDADOS' },
      tecnologia: s.tecnologia,
    }));
    const stockRows: StockRow[] = SKUS.map((s) => ({ sku: s.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    const catalogo = buildCatalogPage(productosRow, stockRows, [], [], QUERY_BASE);

    expect(catalogo.facetas.sin_tecnologia).toBe(ESPERADO_SIN_TECNOLOGIA);

    // --- Tablero (dashboard.service.ts) — MISMO universo, otra forma de fila ---
    const productosLectura: ProductoLectura[] = SKUS.map((s) => ({
      sku: s.sku,
      marca: 'BRAND1',
      familia: 'CANDADOS',
      descr_origen: 'Descr',
      cliente: null,
      resv: 0,
      tecnologia: s.tecnologia,
    }));
    const stockLectura = SKUS.map((s) => ({ sku: s.sku, almacen: 'NORTH', cantidad: 10 }));
    const dashboard = buildDashboard(
      baseDashboardInput({ productos: productosLectura, stock: stockLectura }),
    );

    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(ESPERADO_SIN_TECNOLOGIA);

    // --- EL CRUCE: los dos números, uno al lado del otro ---
    expect(catalogo.facetas.sin_tecnologia).toBe(dashboard.kpis.productos_sin_tecnologia.valor);
  });

  it('universo vacío en ambos → 0 y 0, no undefined ni NaN', () => {
    const catalogo = buildCatalogPage([], [], [], [], QUERY_BASE);
    const dashboard = buildDashboard(baseDashboardInput());

    expect(catalogo.facetas.sin_tecnologia).toBe(0);
    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(0);
  });

  it('TODOS con tecnología en ambos → 0 y 0', () => {
    const productosRow: ProductoRow[] = SKUS.map((s) => ({
      sku: s.sku,
      resv: 0,
      descr_origen: 'Descr',
      cliente: null,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'CANDADOS' },
      tecnologia: 'EAS', // todos con tecnología, sin importar el fixture original
    }));
    const stockRows: StockRow[] = SKUS.map((s) => ({ sku: s.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    const catalogo = buildCatalogPage(productosRow, stockRows, [], [], QUERY_BASE);

    const productosLectura: ProductoLectura[] = SKUS.map((s) => ({
      sku: s.sku,
      marca: 'BRAND1',
      familia: 'CANDADOS',
      descr_origen: 'Descr',
      cliente: null,
      resv: 0,
      tecnologia: 'EAS',
    }));
    const stockLectura = SKUS.map((s) => ({ sku: s.sku, almacen: 'NORTH', cantidad: 10 }));
    const dashboard = buildDashboard(baseDashboardInput({ productos: productosLectura, stock: stockLectura }));

    expect(catalogo.facetas.sin_tecnologia).toBe(0);
    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(0);
  });

  // [F3 · item 3] Los tres tests de arriba solo cruzan CONTEOS DE NULOS: la
  // tecnología siempre viene (o no) de `producto.tecnologia`, nunca de una
  // captura. Esto deja sin ejercitar la MISMA `resolverClasificacion` que los
  // dos consumidores comparten (`capaFuenteManual` — el Excel gana, la
  // captura llena el hueco, ver derivaciones.ts).
  //
  // [C2 · CORRECCIÓN] Este comentario terminaba diciendo que catálogo y
  // tablero podían divergir «porque cada uno le pasa `overrides` por su
  // propio camino de fetch» — y el caso de abajo NO toca ningún fetch: les
  // da el MISMO arreglo de capturas a los dos constructores puros. Lo que
  // prueba es la aritmética compartida sobre la misma entrada: que las dos
  // mitades resuelven igual una captura sobre Excel vacío y la cuentan
  // igual. El fetch de capturas del tablero (`fetchStockCore`) lo cubre
  // `dashboard.service.test.ts` («fetch→mapeo: tecnología de Excel + captura
  // activa…»); el de las DOS mitades a la vez, el último `describe` de este
  // archivo.
  it('una captura activa de tecnología (override) CUENTA como con tecnología en los dos consumidores — cruce real, no solo nulos', () => {
    // A-2 no trae tecnología en el Excel (fuente null), pero SÍ tiene una
    // captura activa del portal — el hueco que `capaFuenteManual` llena
    // cuando el Excel calla. Solo A-4 (sin fuente y sin captura) debe seguir
    // contando como sin tecnología: el universo baja de 2 a 1.
    const overridesRow: OverrideRow[] = [
      { id: 'ov-1', sku: 'A-2', campo: 'tecnologia', valor_editado: 'RFID', editado_en: '2026-09-01T00:00:00.000Z', activo: true },
    ];
    const overridesLectura: OverrideLectura[] = overridesRow;

    // --- Catálogo (inventory.service.ts) ---
    const productosRow: ProductoRow[] = SKUS.map((s) => ({
      sku: s.sku,
      resv: 0,
      descr_origen: 'Descr',
      cliente: null,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'CANDADOS' },
      tecnologia: s.tecnologia,
    }));
    const stockRows: StockRow[] = SKUS.map((s) => ({ sku: s.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    const catalogo = buildCatalogPage(productosRow, stockRows, overridesRow, [], QUERY_BASE);

    expect(catalogo.facetas.sin_tecnologia).toBe(1); // solo A-4

    // --- Tablero (dashboard.service.ts) — MISMO override, misma forma OverrideLectura ---
    const productosLectura: ProductoLectura[] = SKUS.map((s) => ({
      sku: s.sku,
      marca: 'BRAND1',
      familia: 'CANDADOS',
      descr_origen: 'Descr',
      cliente: null,
      resv: 0,
      tecnologia: s.tecnologia,
    }));
    const stockLectura = SKUS.map((s) => ({ sku: s.sku, almacen: 'NORTH', cantidad: 10 }));
    const dashboard = buildDashboard(
      baseDashboardInput({ productos: productosLectura, stock: stockLectura, overrides: overridesLectura }),
    );

    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(1); // solo A-4

    // --- EL CRUCE: los dos números, uno al lado del otro ---
    expect(catalogo.facetas.sin_tecnologia).toBe(dashboard.kpis.productos_sin_tecnologia.valor);
  });

  // [C2] El caso INVERSO del de arriba: la captura cae sobre un SKU que YA
  // trae tecnología del Excel. La cifra no se mueve —A-1 ya contaba como «con
  // tecnología»—, así que el conteo por sí solo NO distingue «gana el Excel»
  // de «gana el portal». Lo que sí lo distingue es la LISTA de tecnologías de
  // cada superficie: si ganara el portal, 'RFID' aparecería y 'EAS' se iría.
  // Mismo arreglo de capturas para los dos constructores, igual que el caso
  // de arriba: prueba la aritmética compartida, no un fetch.
  it('una captura sobre un SKU que YA trae Excel NO mueve la cifra ni se asoma entre las tecnologías de ninguno de los dos', () => {
    const overridesRow: OverrideRow[] = [
      { id: 'ov-1', sku: 'A-1', campo: 'tecnologia', valor_editado: 'RFID', editado_en: '2026-09-01T00:00:00.000Z', activo: true },
    ];
    const overridesLectura: OverrideLectura[] = overridesRow;

    // --- Catálogo (inventory.service.ts) ---
    const productosRow: ProductoRow[] = SKUS.map((s) => ({
      sku: s.sku,
      resv: 0,
      descr_origen: 'Descr',
      cliente: null,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'CANDADOS' },
      tecnologia: s.tecnologia,
    }));
    const stockRows: StockRow[] = SKUS.map((s) => ({ sku: s.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    const catalogo = buildCatalogPage(productosRow, stockRows, overridesRow, [], QUERY_BASE);

    expect(catalogo.facetas.sin_tecnologia).toBe(ESPERADO_SIN_TECNOLOGIA); // A-2 y A-4, igual que sin captura
    expect(catalogo.items.find((it) => it.sku === 'A-1')?.tecnologia).toBe('EAS');
    const tecnologiasCatalogo = catalogo.facetas.tecnologias.map((f) => f.valor).sort();
    expect(tecnologiasCatalogo).toEqual(['BRAND1', 'BRAND2', 'EAS']);

    // --- Tablero (dashboard.service.ts) — MISMO universo, MISMA captura ---
    const productosLectura: ProductoLectura[] = SKUS.map((s) => ({
      sku: s.sku,
      marca: 'BRAND1',
      familia: 'CANDADOS',
      descr_origen: 'Descr',
      cliente: null,
      resv: 0,
      tecnologia: s.tecnologia,
    }));
    const stockLectura = SKUS.map((s) => ({ sku: s.sku, almacen: 'NORTH', cantidad: 10 }));
    const dashboard = buildDashboard(
      baseDashboardInput({ productos: productosLectura, stock: stockLectura, overrides: overridesLectura }),
    );

    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(ESPERADO_SIN_TECNOLOGIA);
    const tecnologiasTablero = [...dashboard.heatmap.tecnologias].sort();
    expect(tecnologiasTablero).toEqual(['BRAND1', 'BRAND2', 'EAS']);

    // --- EL CRUCE: la cifra Y la lista ---
    expect(catalogo.facetas.sin_tecnologia).toBe(dashboard.kpis.productos_sin_tecnologia.valor);
    expect(tecnologiasCatalogo).toEqual(tecnologiasTablero);
  });
});

// ------------------------------------------------------------
// [C2] LAS DOS MITADES POR SU CAMINO DE LECTURA REAL.
//
// Los casos de arriba le dan a cada constructor PURO una entrada ya armada.
// Eso deja fuera un borde que NO vive en la misma capa en los dos lados: la
// exclusión por marca (VERT-B2). El catálogo la aplica DENTRO de
// `buildCatalogPage`; el tablero, ANTES, en `fetchStockCore`
// (`productosVisibles`) — `buildDashboard` nunca la ve, y darle un SKU
// excluido directo lo CONTARÍA. Por eso aquí las dos mitades entran por
// `listInventory` / `getDashboard` sobre el MISMO cliente falso, que es el
// molde de `vert-b2-regla-exclusion.test.ts`. De paso, las capturas viajan
// por el fetch de `productos_override` de cada lado, no por un arreglo que
// el test les reparte.
//
// El universo (6 filas de `productos` + 2 capturas), y por qué la cifra es 2:
//   R-1  BRAND1     'EAS'                     → con tecnología
//   R-2  BRAND1     null   + captura 'RFID'   → con tecnología (la captura llena el hueco)
//   R-3  EAS       null                      → SIN  ←
//   R-4  EAS       '   '                     → SIN  ← (blanco = ausente, `textoPresente`)
//   R-5  EAS       'BRAND1' + captura 'BLE'   → con tecnología, la del Excel
//   X-1  VERTICAL  null, marca EXCLUIDA      → no se cuenta: no es visible
// (La captura de R-5 es la que quedó de antes de que el Excel trajera el
// valor: hoy `aplicar_override` ya no dejaría escribirla — MXEXL.)
//
// ANTI-VACUIDAD (P17): la cifra se mueve con cada borde. Sin la exclusión en
// una mitad, ésa diría 3; con el blanco contado como presente, las dos
// dirían 1; si la captura de R-2 no llegara por el fetch de una mitad, ésa
// diría 3. «Gana el portal» no mueve la cifra pero cambia la lista: 'BLE'
// en vez de 'BRAND1'.
// ------------------------------------------------------------
const VIGENTE: SnapshotVigente = { id: 'snap-c2', created_at: '2026-09-24T00:00:00.000Z', filas: 6, archivo: null };

interface FilaProductos {
  sku: string;
  resv: number;
  descr_origen: string;
  cliente: null;
  snapshot_id: string;
  tecnologia: string | null;
  producto: null;
  marcas: { nombre: string; excluida_del_catalogo: boolean };
  familias: { nombre: string };
}

function filaReal(sku: string, marca: string, excluida: boolean, tecnologia: string | null): FilaProductos {
  return {
    sku,
    resv: 0,
    descr_origen: 'Descr ' + sku,
    cliente: null,
    snapshot_id: VIGENTE.id,
    tecnologia,
    producto: null,
    marcas: { nombre: marca, excluida_del_catalogo: excluida },
    familias: { nombre: 'CANDADOS' },
  };
}

const FILAS_REALES: FilaProductos[] = [
  filaReal('R-1', 'BRAND1', false, 'EAS'),
  filaReal('R-2', 'BRAND1', false, null),
  filaReal('R-3', 'EAS', false, null),
  filaReal('R-4', 'EAS', false, '   '),
  filaReal('R-5', 'EAS', false, 'BRAND1'),
  filaReal('X-1', 'VERTICAL', true, null),
];

const CAPTURAS_REALES: OverrideRow[] = [
  { id: 'ov-r2', sku: 'R-2', campo: 'tecnologia', valor_editado: 'RFID', editado_en: '2026-09-01T00:00:00.000Z', activo: true },
  { id: 'ov-r5', sku: 'R-5', campo: 'tecnologia', valor_editado: 'BLE', editado_en: '2026-09-01T00:00:00.000Z', activo: true },
];

/** Cliente falso que sirve A LAS DOS mitades: encadenable, thenable y con rpc. */
function clienteFalso(): SupabaseClient {
  const datos = (tabla: string): unknown[] => {
    if (tabla === 'productos') return FILAS_REALES;
    if (tabla === 'stock_por_almacen') {
      return FILAS_REALES.map((f) => ({ sku: f.sku, cantidad: 10, almacenes: { clave: 'NORTH' } }));
    }
    if (tabla === 'productos_override') return CAPTURAS_REALES;
    if (tabla === 'estatus_catalogo') return ESTATUS_FIXTURE;
    return [];
  };
  function chain(tabla: string) {
    const node: Record<string, unknown> = {
      eq: () => node,
      in: () => node,
      order: () => node,
      range: (from: number, to: number) =>
        Promise.resolve({ data: datos(tabla).slice(from, to + 1), error: null }),
      then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
        Promise.resolve({ data: datos(tabla), error: null }).then(ok, err),
    };
    return node;
  }
  return {
    from: (tabla: string) => ({ select: () => chain(tabla) }),
    rpc: async () => ({ data: { abiertos: 0, por_tipo: {} }, error: null }),
  } as unknown as SupabaseClient;
}

function armarMocks() {
  conVigenteStockMock.mockImplementation(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
    fetcher(VIGENTE),
  );
  resolveVigenteMock.mockResolvedValue(null);
}

describe('[C2] catálogo y tablero por su lectura REAL: marca excluida, blanco del Excel y capturas', () => {
  beforeEach(() => {
    conVigenteStockMock.mockReset();
    resolveVigenteMock.mockReset();
  });

  it('las dos mitades dejan fuera a X-1, cuentan 2 sin tecnología (R-3, R-4) y listan las MISMAS tecnologías', async () => {
    armarMocks();
    const catalogo = await listInventory(clienteFalso(), QUERY_BASE);
    armarMocks();
    const dashboard = await getDashboard(clienteFalso());

    // La exclusión se aplicó en las DOS, cada una en su capa. Sin esto, lo de
    // abajo podría salir verde por la razón equivocada (P25).
    expect(catalogo.excluidos.total).toBe(1);
    expect(catalogo.total).toBe(5);
    expect(dashboard.kpis.catalogo_total.valor).toBe(5);

    expect(catalogo.facetas.sin_tecnologia).toBe(2);
    expect(dashboard.kpis.productos_sin_tecnologia.valor).toBe(2);
    expect(catalogo.facetas.sin_tecnologia).toBe(dashboard.kpis.productos_sin_tecnologia.valor);

    // Ni el blanco de R-4 ni la captura de R-5 ('BLE') se asoman; la de R-2
    // ('RFID') sí, porque llena un hueco.
    const tecnologiasCatalogo = catalogo.facetas.tecnologias.map((f) => f.valor).sort();
    const tecnologiasTablero = [...dashboard.heatmap.tecnologias].sort();
    expect(tecnologiasCatalogo).toEqual(['BRAND1', 'EAS', 'RFID']);
    expect(tecnologiasTablero).toEqual(tecnologiasCatalogo);
  });
});
