// ============================================================
// [FIX-B2 · ronda 2] proyectos.service.paginacion.test.ts — el corte de 1 000
// filas en el detalle de un proyecto (`obtenerProyecto` → `leerUniversoDePartidas`).
//
// EL DEFECTO: `stock_por_almacen` y `reservas` se leían con `.range(0, 4999)`,
// y la cabecera de `leerUniversoDePartidas` afirmaba que eso daba «margen».
// Era falso (P35): PostgREST devuelve como máximo 1 000 filas por respuesta SIN
// error, pida el rango lo que pida. Un proyecto lleno —`MAX_PARTIDAS`, 200
// SKU— con 6 almacenes por SKU son 1 200 filas de stock: las de los últimos
// SKU no llegaban, y el documento que sale hacia un cliente imprimía su
// disponibilidad en 0 sin ningún error.
//
// Se prueba por el camino REAL: `obtenerProyecto` con el `vigente.service` de
// verdad (sin mock) sobre el fake compartido
// (`src/lib/supabase/__tests__/fake-postgrest.ts`).
//
// ⚠ LO QUE ESTA PRUEBA NO PUEDE VER, declarado: las `reservas` sólo alimentan
// `reserva_descuadre` en `derivarSku`, y `PartidaItem` no expone ese campo —
// el detalle no tiene hoy ninguna salida que dependa de ellas. Por eso su
// lectura se prueba por la FORMA de la consulta (paginada, orden por PK), no
// por el DTO: es medir la representación (P27), y se dice en vez de disimularlo.
// ============================================================
import { describe, it, expect } from 'vitest';
import { obtenerProyecto } from './proyectos.service';
import { fakePostgrest, firmaOrden, revuelto, MAX_FILAS, type Fila } from '@/lib/supabase/__tests__/fake-postgrest';

const pad = (i: number) => String(i).padStart(4, '0');
const skuDe = (i: number) => `SKU-${pad(i)}`;

const PARTIDAS = 200; // MAX_PARTIDAS
const ALMACENES = [
  { id: 'alm-1', clave: 'NORTH' },
  { id: 'alm-2', clave: 'SOUTH' },
  { id: 'alm-3', clave: 'EAST' },
  { id: 'alm-4', clave: 'TRAN' },
  { id: 'alm-5', clave: 'BO' },
  { id: 'alm-6', clave: 'WEST' },
];
/** Potencias de 2 por almacén: la suma es 63 SÓLO si cada fila llega exactamente una vez. */
const CANTIDAD = [1, 2, 4, 8, 16, 32];
const TOTAL_POR_SKU = 63;
const RESERVAS_POR_SKU = 6;

function universo(): Record<string, Fila[]> {
  const proyectos: Fila[] = [
    {
      id: 'p-1',
      propietario: 'user-1',
      perfiles: null,
      folio: 'F-001',
      titulo: 'Proyecto lleno',
      descripcion: null,
      notas: null,
      fecha: '2026-09-29',
      tipo: null,
      intencion: null,
      creado_en: '2026-09-29T00:00:00.000Z',
    },
  ];
  const proyecto_partidas: Fila[] = [];
  const productos: Fila[] = [];
  const stock_por_almacen: Fila[] = [];
  const reservas: Fila[] = [];
  for (let i = 1; i <= PARTIDAS; i++) {
    const sku = skuDe(i);
    proyecto_partidas.push({ id: `partida-${pad(i)}`, proyecto_id: 'p-1', sku, cantidad: 1 });
    productos.push({
      sku,
      resv: 0,
      descr_origen: `Producto ${i}`,
      cliente: null,
      class: 'A',
      snapshot_id: 'snap-stock',
      tecnologia: null,
      marcas: { nombre: 'BRAND1' },
      familias: { nombre: 'SERIES11' },
    });
    // 200 × 6 = 1 200 filas: el corte (fila 1 000) cae DENTRO del SKU 167.
    ALMACENES.forEach((a, k) => {
      stock_por_almacen.push({ sku, almacen_id: a.id, snapshot_id: 'snap-stock', cantidad: CANTIDAD[k], almacenes: { clave: a.clave } });
      // Y el mismo SKU en un snapshot viejo: fuera por `.eq('snapshot_id')` en cada página.
      stock_por_almacen.push({ sku, almacen_id: a.id, snapshot_id: 'snap-viejo', cantidad: 1000, almacenes: { clave: a.clave } });
    });
    for (let r = 0; r < RESERVAS_POR_SKU; r++) {
      const j = (i - 1) * RESERVAS_POR_SKU + r + 1;
      reservas.push({
        id: `res-${pad(revuelto(j, PARTIDAS * RESERVAS_POR_SKU))}`,
        sku,
        cantidad: 1,
        cliente: 'RETAILER64',
        motivo: `pedido ${j}`,
        fecha: '2026-09-28',
        snapshot_id: 'snap-stock',
        kams: { nombre: 'Laura' },
      });
    }
  }
  const snapshots: Fila[] = [
    { id: 'snap-viejo', fuente: 'stock', created_at: '2026-09-01T00:00:00.000Z', filas: 1, archivo: null },
    { id: 'snap-stock', fuente: 'stock', created_at: '2026-09-29T00:00:00.000Z', filas: 1, archivo: null },
  ];
  return {
    proyectos,
    proyecto_partidas,
    productos,
    stock_por_almacen,
    reservas,
    snapshots,
    productos_override: [],
    productos_metadata: [],
    clasificacion_v2: [],
  };
}

describe('[FIX-B2] obtenerProyecto con 200 partidas: el stock (1 200 filas) llega entero', () => {
  it('cada una de las 200 partidas suma sus 6 almacenes: total = disponible = 63', async () => {
    const { db } = fakePostgrest(universo());

    const detalle = await obtenerProyecto(db, 'p-1');

    expect(detalle).not.toBeNull();
    expect(detalle!.partidas).toHaveLength(PARTIDAS);
    for (const p of detalle!.partidas) {
      expect({ sku: p.sku, total: p.total, disponible: p.disponible }).toEqual({
        sku: p.sku,
        total: TOTAL_POR_SKU,
        disponible: TOTAL_POR_SKU,
      });
      expect(p.badges).not.toContain('stock_cero');
    }
    expect(detalle!.vigencia.snapshot_id).toBe('snap-stock');
  });

  it('stock y reservas paginan de 1 000 en 1 000 con la PK de su tabla: (sku, almacen_id) · id', async () => {
    const { db, consultas } = fakePostgrest(universo());
    await obtenerProyecto(db, 'p-1');

    for (const [tabla, orden] of [
      ['stock_por_almacen', 'sku,almacen_id'],
      ['reservas', 'id'],
    ] as const) {
      const cs = consultas.filter((c) => c.tabla === tabla);
      expect(cs.map((c) => c.rango), tabla).toEqual([
        [0, 999],
        [1000, 1999],
      ]);
      for (const c of cs) {
        expect(firmaOrden(c), tabla).toBe(orden);
        // Los filtros viajan en CADA página: snapshot vigente y los SKU del proyecto.
        expect(c.filtros, tabla).toEqual([['snapshot_id', 'snap-stock']]);
        expect(c.listas.map(([col, vs]) => [col, vs.length]), tabla).toEqual([['sku', PARTIDAS]]);
      }
    }
  });

  it('un error en la página 2 del stock conserva `stock_por_almacen: <error>`', async () => {
    const { db } = fakePostgrest(universo(), (c) =>
      c.tabla === 'stock_por_almacen' && c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null,
    );
    await expect(obtenerProyecto(db, 'p-1')).rejects.toThrow(/^stock_por_almacen: timeout en la página 2$/);
  });

  it('un error en la página 2 de reservas conserva `reservas: <error>`', async () => {
    const { db } = fakePostgrest(universo(), (c) =>
      c.tabla === 'reservas' && c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null,
    );
    await expect(obtenerProyecto(db, 'p-1')).rejects.toThrow(/^reservas: timeout en la página 2$/);
  });

  it('si fallan `productos` y la página 2 del stock, se reporta `productos` (el orden fijo de `assertOk`, como antes)', async () => {
    const { db } = fakePostgrest(universo(), (c) => {
      if (c.tabla === 'productos') return 'productos caída';
      if (c.tabla === 'stock_por_almacen' && c.rango !== null && c.rango[0] >= MAX_FILAS) return 'timeout en la página 2';
      return null;
    });
    await expect(obtenerProyecto(db, 'p-1')).rejects.toThrow(/^productos: productos caída$/);
  });
});
