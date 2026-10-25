// ============================================================
// Bloque 2 · ETL · persist.loadPrevState.test.ts
// Fix B (mismo patrón que loadCatalogIndex, ratificado 2026-07-19):
// loadPrevState hacía varios SELECTs (productos/snapshots/embarques/
// stock_por_almacen/reservas) y NUNCA revisaba `.error` — con un fallo
// transitorio, `x.data ?? []` degradaba en silencio a estado vacío.
// Riesgo real: existingSkus vacío → checkReferential cuarentena TODOS
// los embarques (snapshot envenenado); el resto de las tablas vacías →
// "prev vacío" → ALTA masiva falsa contra un snapshot vigente real.
// Ahora se revisa `.error` de cada SELECT ANTES de usar su `.data`; si
// cualquiera falló, se lanza explícito con prefijo `prev_state_no_disponible`
// (distinto de `catalogos_no_disponibles`, para diagnóstico). El caso
// LEGÍTIMO — "no hay snapshot previo aún" (tabla `snapshots` vacía / sin
// fila vigente para la fuente) — NO es error: solo un `.error` real
// dispara la guarda.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPrevState } from '../persist';

type Resp = { data: unknown[] | null; error: { message: string } | null };

const OK: Resp = { data: [], error: null };

interface FakeQuery {
  eq(column: string, value: unknown): FakeQuery;
  order(column: string, opts?: { ascending: boolean }): FakeQuery;
  limit(count: number): FakeQuery;
  // [FIX-B2] Las lecturas de filas ahora paginan con `fetchAllRows`. Las
  // respuestas de este archivo traen menos de 1 000 filas, así que cada lectura
  // es UNA página; el corte de 1 000 lo prueba, con un fake que sí se porta
  // como PostgREST, `persist.loadPrevState.paginacion.test.ts`.
  //
  // [FIX-B2 · ronda 2] Y el rango ya NO se ignora: recorta con
  // `slice(from, to + 1)`, como un `OFFSET/LIMIT`. Ignorarlo era una trampa
  // latente: el día que alguien le diera a este fake una respuesta de 1 000
  // filas o más, cada página devolvería la MISMA respuesta llena y
  // `fetchAllRows` —que se detiene en la primera página corta— no se
  // detendría nunca. Con el recorte, la página siguiente sale vacía y termina.
  range(from: number, to: number): FakeQuery;
  then<TResult1 = Resp, TResult2 = never>(
    onfulfilled?: ((value: Resp) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

function makeChain(resp: Resp): FakeQuery {
  return {
    eq: () => makeChain(resp),
    order: () => makeChain(resp),
    limit: () => makeChain(resp),
    range: (from, to) => makeChain(resp.data === null ? resp : { ...resp, data: resp.data.slice(from, to + 1) }),
    then: (onfulfilled, onrejected) => Promise.resolve(resp).then(onfulfilled, onrejected),
  };
}

/**
 * Fake mínimo de SupabaseClient: `db.from(tabla).select(cols)[.eq()...]`
 * awaited al final de la cadena. `productos` se consulta DOS veces en la
 * rama 'stock' (existingSkus sin filtro, luego la filtrada por snapshot) —
 * si el valor es un ARRAY, cada llamada consume la siguiente respuesta
 * (round-robin); si es un Resp único, se reutiliza en todas las llamadas.
 */
function makeFakeDb(responses: Partial<Record<string, Resp | Resp[]>>): SupabaseClient {
  const callIndex: Record<string, number> = {};
  const db = {
    from(table: string) {
      return {
        select() {
          const entry = responses[table] ?? OK;
          let resp: Resp;
          if (Array.isArray(entry)) {
            const i = callIndex[table] ?? 0;
            resp = entry[Math.min(i, entry.length - 1)];
            callIndex[table] = i + 1;
          } else {
            resp = entry;
          }
          return makeChain(resp);
        },
      };
    },
  };
  return db as unknown as SupabaseClient;
}

const snapshotEncontrado: Resp = { data: [{ id: 'snap-1', hash: 'hash-1' }], error: null };

describe('[FIX-B2 · ronda 2] la vara de ESTE fake: `.range` recorta, así que paginar termina', () => {
  it('una respuesta de 1 000 filas se lee en dos páginas —la segunda vacía— y loadPrevState termina', async () => {
    const mil: Resp = { data: Array.from({ length: 1000 }, (_, i) => ({ sku: `S-${i}` })), error: null };
    const db = makeFakeDb({ productos: mil });

    // Primero la vara, y en voz alta: si el rango no recortara, la llamada de
    // abajo no terminaría NUNCA —cada página devolvería las mismas 1 000 filas
    // y todo se resuelve en microtareas, así que ni el timeout de vitest la
    // cortaría—. Mejor un rojo con nombre que una suite colgada.
    const p1 = await db.from('productos').select('sku').range(0, 999);
    const p2 = await db.from('productos').select('sku').range(1000, 1999);
    expect(p1.data).toHaveLength(1000);
    if ((p2.data ?? []).length !== 0) {
      throw new Error('el fake no recorta con `.range`: correr loadPrevState colgaría la suite');
    }

    const prev = await loadPrevState(db, 'stock');
    expect(prev.existingSkus.size).toBe(1000);
  });
});

describe('loadPrevState — falla explícita si algún SELECT no cargó', () => {
  it('productos (existingSkus) responde error → rechaza con mensaje que incluye la tabla', async () => {
    const db = makeFakeDb({
      productos: { data: null, error: { message: 'JWT issued at future' } },
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(
      /prev_state_no_disponible: productos: JWT issued at future/,
    );
  });

  it('snapshots responde error → rechaza mencionando "snapshots"', async () => {
    const db = makeFakeDb({
      snapshots: { data: null, error: { message: 'timeout' } },
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(/prev_state_no_disponible: snapshots: timeout/);
  });

  it('embarques (fuente aduana, snapshot vigente) responde error → rechaza mencionando "embarques"', async () => {
    const db = makeFakeDb({
      snapshots: snapshotEncontrado,
      embarques: { data: null, error: { message: 'conexión perdida' } },
    });
    await expect(loadPrevState(db, 'aduana')).rejects.toThrow(
      /prev_state_no_disponible: embarques: conexión perdida/,
    );
  });

  it('productos (segunda consulta, snapshot vigente de stock) responde error → rechaza (no se traga en silencio como prev vacío)', async () => {
    const db = makeFakeDb({
      snapshots: snapshotEncontrado,
      productos: [OK, { data: null, error: { message: 'boom' } }],
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(/prev_state_no_disponible: productos: boom/);
  });

  it('stock_por_almacen (snapshot vigente de stock) responde error → rechaza mencionando la tabla', async () => {
    const db = makeFakeDb({
      snapshots: snapshotEncontrado,
      stock_por_almacen: { data: null, error: { message: 'conexión perdida' } },
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(
      /prev_state_no_disponible: stock_por_almacen: conexión perdida/,
    );
  });

  it('reservas (snapshot vigente de stock) responde error → rechaza mencionando la tabla (caso real: gate SUMA_RESERVAS envenenado)', async () => {
    const db = makeFakeDb({
      snapshots: snapshotEncontrado,
      reservas: { data: null, error: { message: 'timeout' } },
    });
    await expect(loadPrevState(db, 'stock')).rejects.toThrow(/prev_state_no_disponible: reservas: timeout/);
  });
});

describe('loadPrevState — "no hay snapshot previo aún" es LEGÍTIMO (regresión clave, no debe lanzar)', () => {
  it('tabla snapshots vacía (sin fila vigente para la fuente) → PrevState vacío, SIN throw', async () => {
    const db = makeFakeDb({
      productos: { data: [{ sku: 'A-1' }, { sku: 'A-2' }], error: null },
      snapshots: OK, // data: [] SIN error — primera carga, aún no hay snapshot
    });
    const prev = await loadPrevState(db, 'stock');
    expect(prev).toEqual({
      snapshotId: null,
      hash: null,
      productos: [],
      stock: [],
      reservas: [],
      embarques: [],
      existingSkus: new Set(['A-1', 'A-2']),
    });
  });
});

describe('loadPrevState — caso feliz con snapshot vigente (sin regresión de mapeo)', () => {
  it('fuente "stock": productos/stock/reservas se mapean desde el snapshot vigente', async () => {
    const db = makeFakeDb({
      productos: [
        { data: [{ sku: 'A-1' }], error: null }, // existingSkus (catálogo global)
        {
          data: [
            { sku: 'A-1', class: 'C', descr_origen: 'desc', cliente: null, resv: 5, marcas: { nombre: 'BRAND1' }, familias: { nombre: 'SERIES11' } },
          ],
          error: null,
        },
      ],
      snapshots: snapshotEncontrado,
      stock_por_almacen: { data: [{ sku: 'A-1', cantidad: 10, almacenes: { clave: 'NORTH' } }], error: null },
      reservas: {
        data: [{ sku: 'A-1', cliente: 'RETAILER64', cantidad: 3, motivo: 'pedido A', fecha: '2026-07-01', kams: { nombre: 'Laura' } }],
        error: null,
      },
    });
    const prev = await loadPrevState(db, 'stock');
    expect(prev.snapshotId).toBe('snap-1');
    expect(prev.hash).toBe('hash-1');
    expect(prev.existingSkus).toEqual(new Set(['A-1']));
    expect(prev.productos).toEqual([
      { sku: 'A-1', marca: 'BRAND1', tecnologia: null, producto: null, familia: 'SERIES11', class: 'C', descr: 'desc', cliente: null, resv: 5, totalFuente: 0 },
    ]);
    expect(prev.stock).toEqual([{ sku: 'A-1', almacen: 'NORTH', cantidad: 10 }]);
    expect(prev.reservas).toEqual([
      { sku: 'A-1', kam: 'Laura', cliente: 'RETAILER64', cantidad: 3, motivo: 'pedido A', fecha: '2026-07-01' },
    ]);
    expect(prev.embarques).toEqual([]);
  });

  it('fuente "aduana": embarques se mapean desde el snapshot vigente', async () => {
    const db = makeFakeDb({
      productos: { data: [], error: null },
      snapshots: snapshotEncontrado,
      embarques: {
        data: [
          {
            sku: 'A-1', oc_po: 'OC-1', proveedor: null, referencia: null, factura: null, pais_origen: null,
            piezas: 10, fw: null, tipo_importacion: null, fecha_recoleccion: null, etd: null, eta: null,
            fecha_llegada: null, fecha_disponibilidad: null, estatus_catalogo: { nombre: 'En Aduana' },
            estatus_id: 7, proyecto: null, observaciones: null, is_historial: false,
          },
        ],
        error: null,
      },
    });
    const prev = await loadPrevState(db, 'aduana');
    expect(prev.snapshotId).toBe('snap-1');
    expect(prev.embarques).toHaveLength(1);
    expect(prev.embarques[0]).toMatchObject({ sku: 'A-1', oc_po: 'OC-1', estatus: 'En Aduana', estatus_id: 7 });
    expect(prev.productos).toEqual([]);
  });
});
