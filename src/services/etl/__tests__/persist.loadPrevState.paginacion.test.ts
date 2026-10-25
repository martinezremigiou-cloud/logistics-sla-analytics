// ============================================================
// [FIX-B2] persist.loadPrevState.paginacion.test.ts — el corte de 1 000 filas.
//
// EL DEFECTO: `loadPrevState` leía con
// SELECT a secas, y PostgREST devuelve como máximo 1 000 filas por respuesta
// SIN error. `productos` podía rebasar el tope, `existingSkus` quedó incompleto y
// `checkReferential` mandó a cuarentena en silencio embarques de SKU legítimos.
//
// POR QUÉ ESTE FAKE Y NO EL DE `persist.loadPrevState.test.ts`: aquel devuelve
// lo que se le da, sin mirar `.range`. Contra un fake así, una lectura SIN
// paginar recibe 1 200 filas y la prueba sale verde por la razón equivocada
// (P25): el fake le regala exactamente lo que el servidor real le niega (P36).
// Éste se porta como PostgREST en las tres cosas que deciden el defecto:
//
//   1. Nunca entrega más de 1 000 filas por respuesta — ni sin `.range`, ni con
//      un `.range` más ancho que eso.
//   2. Respeta `.range(from, to)` como `OFFSET from LIMIT to-from+1`.
//   3. Sin `ORDER BY` no promete orden: la n-ésima consulta a una misma tabla
//      ve las filas en orden físico natural si n es par y AL REVÉS si es impar,
//      y un `.order()` sobre una columna no única deja los empates en ese orden
//      físico. Así, paginar sin orden total repite filas y se salta otras aquí
//      igual que en Postgres — y la prueba lo ve.
//
// Su propia vara está en el primer `describe`: si el fake dejara de cortar, esas
// pruebas caen antes de que ninguna otra pueda salir verde por él.
//
// [FIX-B2 · ronda 2] El fake se extrajo a `src/lib/supabase/__tests__/fake-postgrest.ts`
// cuando el mismo corte apareció en `avisos.service.ts` y `proyectos.service.ts`.
// Y el universo se endureció: `reservas` y `embarques` traen ahora TRES filas por
// SKU, con el corte de página (fila 1 000) DENTRO del grupo del SKU 334. Antes
// traían una por SKU, así que ordenarlas por `sku` —que NO es su PK— era un
// orden total POR ACCIDENTE del fixture: sólo la prueba de la firma lo veía, y
// las de «completos y sin repetidos» salían verdes por la razón equivocada.
// ============================================================
import { describe, it, expect } from 'vitest';
import { loadPrevState } from '../persist';
import { checkReferential } from '../gates';
import type { EmbarqueRow } from '../types';
import {
  fakePostgrest,
  firmaOrden,
  revuelto as revueltoDe,
  MAX_FILAS,
  type Fila,
  type Respuesta,
} from '@/lib/supabase/__tests__/fake-postgrest';

// ------------------------------------------------------------
// El universo: 1 200 filas en cada tabla que crece. Todas cruzan el tope.
// ------------------------------------------------------------
const N = 1200;
const REMANENTES = 20; // los últimos 20 SKU quedaron en un snapshot viejo
const pad = (i: number) => String(i).padStart(4, '0');
const skuDe = (i: number) => `SKU-${pad(i)}`;
/** Biyección de 1..N sobre sí mismo: el `id` NO sigue el orden de inserción (como un uuid). */
const revuelto = (i: number) => revueltoDe(i, N);
/** Filas por SKU en `reservas` y `embarques`: 400 SKU × 3 = 1 200, y el corte (1 000) cae dentro del SKU 334. */
const POR_SKU = 3;

const ALMACENES = [
  { id: 'alm-1', clave: 'NORTH' },
  { id: 'alm-2', clave: 'SOUTH' },
  { id: 'alm-3', clave: 'EAST' },
];

function universo(): Record<string, Fila[]> {
  const productos: Fila[] = [];
  for (let i = 1; i <= N; i++) {
    productos.push({
      sku: skuDe(i),
      snapshot_id: i > N - REMANENTES ? 'snap-viejo' : 'snap-stock',
      tecnologia: null,
      producto: null,
      class: 'A',
      descr_origen: `desc ${i}`,
      cliente: null,
      resv: 0,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'SERIES11' },
    });
  }
  // 400 SKU × 3 almacenes = 1 200 filas. El corte de página (fila 1 000) cae
  // DENTRO del grupo del SKU 334: ordenar sólo por `sku` empata justo ahí.
  const stock: Fila[] = [];
  for (let i = 1; i <= N / ALMACENES.length; i++) {
    for (const a of ALMACENES) {
      stock.push({ sku: skuDe(i), almacen_id: a.id, snapshot_id: 'snap-stock', cantidad: i, almacenes: { clave: a.clave } });
    }
  }
  // `reservas` y `embarques`: la fila j es del SKU ⌈j/3⌉ — tres por SKU, 400
  // SKU. El corte de página (fila 1 000) cae DENTRO del grupo del SKU 334
  // (filas 999-1001, base 0): ordenar sólo por `sku` empata justo ahí, y la
  // página 2 repite una reserva y se salta otra. Su PK es `id`, que aquí está
  // revuelto (no sigue el orden de inserción), igual que un uuid.
  const reservas: Fila[] = [];
  const embarques: Fila[] = [];
  for (let j = 1; j <= N; j++) {
    const sku = skuDe(Math.ceil(j / POR_SKU));
    reservas.push({
      id: `res-${pad(revuelto(j))}`,
      sku,
      cliente: 'RETAILER64',
      cantidad: 1,
      motivo: `pedido ${j}`,
      fecha: '2026-09-28',
      snapshot_id: 'snap-stock',
      kams: { nombre: 'Laura' },
    });
    embarques.push({
      id: `emb-${pad(revuelto(j))}`,
      sku,
      oc_po: `OC-${pad(j)}`,
      proveedor: null,
      referencia: null,
      factura: null,
      pais_origen: null,
      piezas: 5,
      fw: null,
      tipo_importacion: null,
      fecha_recoleccion: null,
      etd: null,
      eta: null,
      fecha_llegada: null,
      fecha_disponibilidad: null,
      estatus_id: 7,
      estatus_catalogo: { nombre: 'En Aduana' },
      proyecto: null,
      observaciones: null,
      is_historial: j % 2 === 0,
      snapshot_id: 'snap-aduana',
    });
  }
  const snapshots: Fila[] = [
    { id: 'snap-viejo', hash: 'h-viejo', fuente: 'stock', created_at: '2026-09-01T00:00:00Z' },
    { id: 'snap-stock', hash: 'h-stock', fuente: 'stock', created_at: '2026-09-29T00:29:26Z' },
    { id: 'snap-aduana', hash: 'h-aduana', fuente: 'aduana', created_at: '2026-09-29T00:29:27Z' },
  ];
  return { productos, stock_por_almacen: stock, reservas, embarques, snapshots };
}

/** El embarque del SKU 1 100 tal como llega del Excel, ya resuelto su estatus. */
function embarqueEntrante(sku: string): EmbarqueRow {
  return {
    sku,
    oc_po: 'OC-NUEVA',
    proveedor: null,
    referencia: null,
    factura: null,
    pais_origen: null,
    piezas: 3,
    fw: null,
    tipo_importacion: null,
    fecha_recoleccion: null,
    etd: null,
    eta: null,
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: 'En Aduana',
    estatus_id: 7,
    proyecto: null,
    observaciones: null,
    is_historial: false,
  };
}

describe('[FIX-B2] la vara del fake: se porta como PostgREST (si no, todo lo de abajo es vacuo)', () => {
  it('SIN `.range` nunca entrega más de 1 000 filas de una tabla de 1 200', async () => {
    const { db } = fakePostgrest(universo());
    const r = (await db.from('productos').select('sku')) as unknown as Respuesta;
    expect(r.error).toBeNull();
    expect(r.data).toHaveLength(MAX_FILAS);
  });

  it('un `.range` más ancho que el tope también se corta en 1 000; la página 2 trae el resto', async () => {
    const { db } = fakePostgrest(universo());
    const ancho = (await db.from('productos').select('sku').order('sku').range(0, 1999)) as unknown as Respuesta;
    expect(ancho.data).toHaveLength(MAX_FILAS);
    const pagina2 = (await db.from('productos').select('sku').order('sku').range(1000, 1999)) as unknown as Respuesta;
    expect(pagina2.data).toHaveLength(N - MAX_FILAS);
  });

  it('sin ORDER BY no hay orden prometido: dos consultas seguidas ven órdenes distintos', async () => {
    const { db } = fakePostgrest(universo());
    const a = (await db.from('reservas').select('id')) as unknown as Respuesta;
    const b = (await db.from('reservas').select('id')) as unknown as Respuesta;
    expect(a.data?.[0]).not.toEqual(b.data?.[0]);
  });

  it('paginar SIN orden total repite y salta filas en este fake (el mecanismo que la prueba necesita ver)', async () => {
    const { db } = fakePostgrest(universo());
    // `sku` sola NO es única en `stock_por_almacen`: el corte cae dentro de un grupo empatado.
    const p1 = (await db.from('stock_por_almacen').select('*').order('sku').range(0, 999)) as unknown as Respuesta;
    const p2 = (await db.from('stock_por_almacen').select('*').order('sku').range(1000, 1999)) as unknown as Respuesta;
    const pares = new Set([...(p1.data ?? []), ...(p2.data ?? [])].map((f) => `${String(f.sku)}|${String(f.almacen_id)}`));
    expect(pares.size).toBeLessThan(N);
  });
});

describe('[FIX-B2] loadPrevState no se trunca en el tope de 1 000 filas', () => {
  it('existingSkus trae los 1 200 SKU de la tabla ENTERA (remanentes incluidos), no los primeros 1 000', async () => {
    const { db } = fakePostgrest(universo());
    const prev = await loadPrevState(db, 'aduana');
    expect(prev.existingSkus.size).toBe(N);
    expect(prev.existingSkus.has('SKU-1100')).toBe(true);
    expect(prev.existingSkus.has(skuDe(N))).toBe(true); // un remanente
  });

  it('el embarque del SKU 1 100 NO va a cuarentena (checkReferential real, como runEtl.ts:398)', async () => {
    const { db } = fakePostgrest(universo());
    const prev = await loadPrevState(db, 'aduana');
    const ref = checkReferential([embarqueEntrante('SKU-1100')], prev.existingSkus, 'embarque');
    expect(ref.cuarentena).toEqual([]);
    expect(ref.ok.map((e) => e.sku)).toEqual(['SKU-1100']);

    // Y ninguno de los 1 200: un embarque por SKU, todos con producto.
    const todos = checkReferential(
      Array.from({ length: N }, (_, k) => embarqueEntrante(skuDe(k + 1))),
      prev.existingSkus,
      'embarque',
    );
    expect(todos.cuarentena).toHaveLength(0);
  });

  it('fuente "aduana": los 1 200 embarques previos llegan completos y sin repetidos', async () => {
    const { db } = fakePostgrest(universo());
    const prev = await loadPrevState(db, 'aduana');
    expect(prev.embarques).toHaveLength(N);
    expect(new Set(prev.embarques.map((e) => e.oc_po)).size).toBe(N);
    // Los tres del SKU 334, el grupo que el corte de página parte en dos.
    expect(prev.embarques.filter((e) => e.sku === 'SKU-0334').map((e) => e.oc_po).sort()).toEqual([
      'OC-1000',
      'OC-1001',
      'OC-1002',
    ]);
    // El mapeo no cambió de contenido: mismo molde que el caso feliz de persist.loadPrevState.test.ts.
    expect(prev.embarques.find((e) => e.oc_po === 'OC-1100')).toMatchObject({
      sku: 'SKU-0367',
      estatus: 'En Aduana',
      estatus_id: 7,
      piezas: 5,
      is_historial: true,
    });
  });

  it('fuente "stock": productos (1 180 del vigente), stock (1 200) y reservas (1 200) previos llegan completos y sin repetidos', async () => {
    const { db } = fakePostgrest(universo());
    const prev = await loadPrevState(db, 'stock');
    expect(prev.snapshotId).toBe('snap-stock');
    expect(prev.hash).toBe('h-stock');

    expect(prev.productos).toHaveLength(N - REMANENTES);
    expect(new Set(prev.productos.map((p) => p.sku)).size).toBe(N - REMANENTES);

    expect(prev.stock).toHaveLength(N);
    expect(new Set(prev.stock.map((s) => `${s.sku}|${s.almacen}`)).size).toBe(N);

    expect(prev.reservas).toHaveLength(N);
    expect(new Set(prev.reservas.map((r) => r.motivo)).size).toBe(N);
    // Las tres del SKU 334, el grupo que el corte de página parte en dos.
    expect(prev.reservas.filter((r) => r.sku === 'SKU-0334').map((r) => r.motivo).sort()).toEqual([
      'pedido 1000',
      'pedido 1001',
      'pedido 1002',
    ]);

    expect(prev.existingSkus.size).toBe(N);
  });

  it('cada lectura pide un orden TOTAL y pagina en ventanas de 1 000 (0-999, 1000-1999)', async () => {
    const { db, consultas } = fakePostgrest(universo());
    await loadPrevState(db, 'stock');
    await loadPrevState(db, 'aduana');

    const deLaLectura = (tabla: string, conSnapshot: boolean) =>
      consultas.filter((c) => c.tabla === tabla && c.filtros.some(([col]) => col === 'snapshot_id') === conSnapshot);

    const esperado: Array<[string, boolean, string]> = [
      ['productos', false, 'sku'], // existingSkus: PK
      ['productos', true, 'sku'], // productos del previo: PK
      ['stock_por_almacen', true, 'sku,almacen_id'], // PK (sku, almacen_id, snapshot_id) con snapshot fijo
      ['reservas', true, 'id'], // PK
      ['embarques', true, 'id'], // PK
    ];
    for (const [tabla, conSnapshot, orden] of esperado) {
      const cs = deLaLectura(tabla, conSnapshot);
      // `existingSkus` se lee en las DOS corridas (stock y aduana): 2 páginas cada una.
      const paginas = tabla === 'productos' && !conSnapshot ? 4 : 2;
      expect(cs, `${tabla} (snapshot=${conSnapshot})`).toHaveLength(paginas);
      for (const c of cs) {
        expect(firmaOrden(c), `${tabla} (snapshot=${conSnapshot})`).toBe(orden);
        expect(c.rango, `${tabla} (snapshot=${conSnapshot})`).not.toBeNull();
      }
      expect(cs.map((c) => c.rango)).toEqual(
        Array.from({ length: paginas }, (_, k) => (k % 2 === 0 ? [0, 999] : [1000, 1999])),
      );
    }
  });
});

describe('[FIX-B2] un error en la PÁGINA 2 conserva el prefijo `prev_state_no_disponible: <tabla>:`', () => {
  const casos: Array<{ nombre: string; fuente: string; tabla: string; conSnapshot: boolean }> = [
    { nombre: 'productos (existingSkus)', fuente: 'stock', tabla: 'productos', conSnapshot: false },
    { nombre: 'embarques', fuente: 'aduana', tabla: 'embarques', conSnapshot: true },
    { nombre: 'productos (del previo)', fuente: 'stock', tabla: 'productos', conSnapshot: true },
    { nombre: 'stock_por_almacen', fuente: 'stock', tabla: 'stock_por_almacen', conSnapshot: true },
    { nombre: 'reservas', fuente: 'stock', tabla: 'reservas', conSnapshot: true },
  ];

  for (const caso of casos) {
    it(`${caso.nombre}: la página 1 responde, la 2 falla → rechaza con el prefijo y la tabla`, async () => {
      const { db, consultas } = fakePostgrest(universo(), (c) =>
        c.tabla === caso.tabla &&
        c.filtros.some(([col]) => col === 'snapshot_id') === caso.conSnapshot &&
        c.rango !== null &&
        c.rango[0] >= MAX_FILAS
          ? 'timeout en la página 2'
          : null,
      );
      await expect(loadPrevState(db, caso.fuente)).rejects.toThrow(
        new RegExp(`^prev_state_no_disponible: ${caso.tabla}: timeout en la página 2$`),
      );
      // Y fue la página 2 la que falló, después de una página 1 buena.
      const cs = consultas.filter(
        (c) => c.tabla === caso.tabla && c.filtros.some(([col]) => col === 'snapshot_id') === caso.conSnapshot,
      );
      expect(cs.map((c) => c.rango)).toEqual([
        [0, 999],
        [1000, 1999],
      ]);
    });
  }

  it('si fallan DOS lecturas del previo, se reporta la primera del orden fijo, no la que rechazó antes', async () => {
    // `reservas` falla en su página 1 y rechaza ANTES que `productos`, que falla
    // hasta su página 2. Antes de FIX-B2 las tres se esperaban y se revisaban en
    // orden (productos · stock_por_almacen · reservas); eso se conserva.
    const { db } = fakePostgrest(universo(), (c) => {
      if (c.tabla === 'reservas') return 'reservas caída';
      const delPrevio = c.filtros.some(([col]) => col === 'snapshot_id');
      if (c.tabla === 'productos' && delPrevio && c.rango !== null && c.rango[0] >= MAX_FILAS) return 'productos caída';
      return null;
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(/^prev_state_no_disponible: productos: productos caída$/);
  });
});
