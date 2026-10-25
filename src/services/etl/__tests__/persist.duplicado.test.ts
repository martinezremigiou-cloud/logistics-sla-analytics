// ============================================================
// Bloque ING-B1 · O-3 · persist.duplicado.test.ts
//
// EL TRINQUETE DE «YA TENGO ESTE CONTENIDO».
//
// El flujo programado de Power Automate quedaba en rojo en cada corrida
// porque `ingest_snapshot` rechazaba el INSERT por
// `snapshots_hash_unique` y `persistSnapshot` lo lanzaba como un `Error` pelado:
// caía al `internalError` de las dos rutas y salía **500**.
//
// Este archivo vigila las DOS mitades del arreglo, y la segunda es la que lo
// vuelve un trinquete en vez de un adorno:
//
//   (a) esa restricción, POR NOMBRE, se clasifica -> `SnapshotDuplicadoError`
//   (b) CUALQUIER OTRO fallo del RPC sigue siendo un `Error` genérico -> 500
//
// Sin (b), «atrapar el duplicado» y «atrapar todo» dan exactamente el mismo
// verde, y el arreglo se convertiría en el silencio que vino a quitar.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { persistSnapshot } from '../persist';
import { SnapshotDuplicadoError, CONSTRAINT_HASH_UNICO } from '../errors';
import type { SnapshotPayload } from '../types';

// Hash de muestra (sha256 de una cadena inventada), no el de ningún snapshot real.
const HASH = '6b2eb7724296ada440aed11bd7ed36d346f91fcc178067060be9d4c93785ca22';

function payloadMinimo(): SnapshotPayload {
  return {
    fuente: 'stock',
    periodo: '2026-09',
    archivo: 'inventario.xlsx',
    capturedAt: '2026-09-21T19:31:36.000Z',
    hash: HASH,
    createdBy: null,
    marcasNuevas: [],
    familiasNuevas: [],
    productos: [],
    stock: [],
    reservas: [],
    embarques: [],
    cambios: [],
    forzadoPor: null,
    forzadoMotivo: null,
  } as unknown as SnapshotPayload;
}

/** Ejecuta y devuelve lo que LANZÓ, no la unión con el valor de éxito. */
async function loQueLanza(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('no lanzó, y este caso existe justamente porque debe lanzar');
}

/** Cliente falso cuyo único trabajo es devolver lo que el RPC respondería. */
function dbQueRpcResponde(resp: { data: unknown; error: unknown }): SupabaseClient {
  return { rpc: async () => resp } as unknown as SupabaseClient;
}

describe('persistSnapshot · el duplicado de hash se clasifica, y SOLO ése', () => {
  // El mensaje real de PostgREST, copiado de un log de runtime — no una
  // paráfrasis: si el texto de Postgres cambiara de forma, este
  // test es el que tiene que enterarse.
  const errorReal = {
    message: 'duplicate key value violates unique constraint "snapshots_hash_unique"',
    details: 'Key (hash)=(6b2eb77…) already exists.',
    hint: null,
    code: '23505',
  };

  it('(a) la violación de snapshots_hash_unique sale como SnapshotDuplicadoError, con su hash y su constraint', async () => {
    const db = dbQueRpcResponde({ data: null, error: errorReal });

    await expect(persistSnapshot(db, payloadMinimo())).rejects.toBeInstanceOf(SnapshotDuplicadoError);

    const e = (await loQueLanza(() => persistSnapshot(db, payloadMinimo()))) as SnapshotDuplicadoError;
    expect(e.hash, 'el error lleva el hash que se rechazó, para poder buscarlo en snapshots').toBe(HASH);
    expect(e.constraint).toBe(CONSTRAINT_HASH_UNICO);
  });

  // ⚠ ESTA ES LA MITAD QUE DISCRIMINA. Sin ella, un `catch` que atrapara
  // CUALQUIER error del RPC daría el mismo verde que el arreglo correcto — y
  // convertiría un fallo real de la transacción en un 200 silencioso.
  it('(b) CUALQUIER OTRO fallo del RPC sigue siendo Error genérico — sigue siendo 500', async () => {
    const otros = [
      { nombre: 'otra unicidad de la misma transacción', error: { message: 'duplicate key value violates unique constraint "productos_pkey"', details: null, hint: null, code: '23505' } },
      { nombre: 'violación de llave foránea', error: { message: 'insert or update on table "stock_por_almacen" violates foreign key constraint', details: null, hint: null, code: '23503' } },
      { nombre: 'permiso denegado', error: { message: 'permission denied for function ingest_snapshot', details: null, hint: null, code: '42501' } },
      { nombre: 'la función no existe', error: { message: 'Could not find the function public.ingest_snapshot', details: null, hint: null, code: 'PGRST202' } },
    ];

    for (const caso of otros) {
      const db = dbQueRpcResponde({ data: null, error: caso.error });
      const e = (await loQueLanza(() => persistSnapshot(db, payloadMinimo()))) as Error;
      expect(e, `«${caso.nombre}» NO puede clasificarse como duplicado de hash: si lo hiciera, un fallo real de la transacción se respondería 200 y nadie se enteraría`).not.toBeInstanceOf(SnapshotDuplicadoError);
      expect(e).toBeInstanceOf(Error);
      expect(e.message).toContain('ingest_snapshot falló');
    }
  });

  it('(c) se compara el NOMBRE de la restricción, no un trozo del mensaje', async () => {
    // Mismo código 23505 y mismo «duplicate key» que el caso bueno, pero otra
    // restricción. Un `includes('duplicate key')` pasaría este test en verde
    // y estaría mal: por eso el predicado busca el nombre.
    const db = dbQueRpcResponde({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "snapshots_pkey"', details: null, hint: null, code: '23505' },
    });
    const e = (await loQueLanza(() => persistSnapshot(db, payloadMinimo()))) as Error;
    expect(e, 'snapshots_pkey no es snapshots_hash_unique, aunque las dos digan «duplicate key»').not.toBeInstanceOf(SnapshotDuplicadoError);
  });

  it('(d) sin error, devuelve el snapshotId y no clasifica nada', async () => {
    const db = dbQueRpcResponde({ data: 'abc-123', error: null });
    await expect(persistSnapshot(db, payloadMinimo())).resolves.toEqual({ snapshotId: 'abc-123' });
  });
});
