// ============================================================
// Bloque 3 · API · vigente.service.ts  (READS — anti-mezcla)
//
// "vigente(fuente)" = la fila de `snapshots` con fuente = F que
// maximiza (created_at, id). El segundo desempate por `id` es
// determinista: dos ingestas en la misma fuente podrían compartir
// `created_at` (mismo tick) y el orden por un solo campo no bastaría.
//
// Garantía anti-mezcla de `conVigenteStock`: las particiones de un
// snapshot (`stock_por_almacen`, `reservas`, `embarques`) son
// INMUTABLES una vez escritas por el RPC `ingest_snapshot` (0005) —
// nunca se editan filas de un snapshot_id ya persistido, solo se
// agregan snapshots nuevos. El único riesgo real de "mezclar" datos
// de dos ingestas distintas es la tabla `productos`, que hace upsert
// latest-wins (0005): si una ingesta nueva corre A MITAD de una
// lectura, un producto podría reflejar la marca/familia de la
// ingesta N+1 mientras el stock leído sigue siendo el de N.
//
// Mitigación: PIN explícito del snapshot vigente antes de leer,
// RE-VERIFICACIÓN después de leer y UN reintento completo si cambió.
// No se verifica más allá porque (a) las ingestas ocurren cada ~15
// min — un segundo cambio en el rango de milisegundos que toma un
// reintento es, en la práctica, imposible; y (b) aun en ese caso
// extremo el riesgo sigue acotado a `productos` (nunca a las
// particiones por snapshot_id, que son inmutables).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';

export interface SnapshotVigente {
  id: string;
  created_at: string;
  filas: number | null;
  archivo: string | null;
}

/** Únicas 2 fuentes canónicas de snapshot en B3. */
export type FuenteSnapshot = 'stock' | 'aduana';

/** Snapshot vigente de una fuente, o null si aún no hay ninguno. */
export async function resolveVigente(
  db: SupabaseClient,
  fuente: FuenteSnapshot,
): Promise<SnapshotVigente | null> {
  const { data, error } = await db
    .from('snapshots')
    .select('id,created_at,filas,archivo')
    .eq('fuente', fuente)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error('snapshots: ' + error.message);
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  return {
    id: String(row.id),
    created_at: String(row.created_at),
    filas: row.filas == null ? null : Number(row.filas),
    archivo: row.archivo == null ? null : String(row.archivo),
  };
}

/** Vigente de ambas fuentes canónicas, resueltas en paralelo. */
export async function resolveVigentes(
  db: SupabaseClient,
): Promise<{ stock: SnapshotVigente | null; aduana: SnapshotVigente | null }> {
  const [stock, aduana] = await Promise.all([
    resolveVigente(db, 'stock'),
    resolveVigente(db, 'aduana'),
  ]);
  return { stock, aduana };
}

/**
 * Ejecuta `fetcher` pinneado al snapshot 'stock' vigente, con
 * re-verificación anti-mezcla (ver comentario de cabecera).
 *   1. Resuelve S = vigente('stock'); si no hay → null (el caller
 *      sirve página vacía; no tiene sentido reintentar contra nada).
 *   2. Ejecuta fetcher(S).
 *   3. Re-resuelve S2. Si S2.id === S.id → el resultado es válido tal
 *      cual. Si cambió → UN reintento completo con S2 (sin verificar
 *      de nuevo tras el reintento).
 */
export async function conVigenteStock<T>(
  db: SupabaseClient,
  fetcher: (vigente: SnapshotVigente) => Promise<T>,
): Promise<T | null> {
  const s1 = await resolveVigente(db, 'stock');
  if (!s1) return null;

  const result = await fetcher(s1);

  const s2 = await resolveVigente(db, 'stock');
  if (s2?.id === s1.id) return result;

  // Carrera: llegó una ingesta nueva mientras leíamos. `s2` null aquí
  // es prácticamente irrepresentable (snapshots nunca se borran una
  // vez que existe uno), pero se maneja igual que "sin vigente".
  if (!s2) return null;

  return fetcher(s2);
}
