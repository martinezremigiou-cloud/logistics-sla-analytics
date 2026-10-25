// ============================================================
// Bloque 2 · ETL · differ.ts  (PURO)
// Diff genérico entre el estado previo y el nuevo por entidad:
//   ALTA         (clave nueva)          → 1 Cambio (campo '*').
//   BAJA         (clave ausente)        → 1 Cambio (campo '*').
//   MODIFICACION (campo distinto)       → 1 Cambio POR campo.
// snapshot_id es placeholder ('' por defecto); persist lo backfillea.
// ============================================================
import type { Cambio } from '@/types';
import type { CambioNuevo, EmbarqueRow } from './types';

function skuOf(rec: unknown): string | null {
  if (rec && typeof rec === 'object' && 'sku' in rec) {
    const v = (rec as { sku: unknown }).sku;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

function valStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

/**
 * Colapsa registros por clave conservando el de mayor `orden`
 * (p.ej. embarques duplicados por oc_po|sku → estatus más avanzado).
 */
export function collapseByKey<T>(
  records: T[],
  keyFn: (t: T) => string,
  ordenFn: (t: T) => number,
): T[] {
  const best = new Map<string, T>();
  for (const rec of records) {
    const k = keyFn(rec);
    const cur = best.get(k);
    if (cur === undefined || ordenFn(rec) > ordenFn(cur)) best.set(k, rec);
  }
  return Array.from(best.values());
}

export function diffEntity<T>(
  prev: T[],
  next: T[],
  keyFn: (t: T) => string,
  fields: (keyof T)[],
  entidad: Cambio['entidad'],
  snapshotId = '',
): CambioNuevo[] {
  const prevByKey = new Map<string, T>();
  for (const p of prev) prevByKey.set(keyFn(p), p);
  const nextByKey = new Map<string, T>();
  for (const n of next) nextByKey.set(keyFn(n), n);

  const cambios: CambioNuevo[] = [];

  // ALTA y MODIFICACION
  for (const [key, nrec] of Array.from(nextByKey)) {
    const precMaybe = prevByKey.get(key);
    if (precMaybe === undefined) {
      const detalle: Record<string, unknown> = {};
      for (const f of fields) detalle[String(f)] = nrec[f];
      cambios.push({
        snapshot_id: snapshotId,
        entidad,
        clave: key,
        sku: skuOf(nrec),
        campo: '*',
        valor_anterior: null,
        valor_nuevo: JSON.stringify(detalle),
        tipo: 'ALTA',
      });
      continue;
    }
    const prec: T = precMaybe;
    for (const f of fields) {
      const a = valStr(prec[f]);
      const b = valStr(nrec[f]);
      if (a !== b) {
        cambios.push({
          snapshot_id: snapshotId,
          entidad,
          clave: key,
          sku: skuOf(nrec),
          campo: String(f),
          valor_anterior: a,
          valor_nuevo: b,
          tipo: 'MODIFICACION',
        });
      }
    }
  }

  // BAJA
  for (const [key, prec] of Array.from(prevByKey)) {
    if (nextByKey.has(key)) continue;
    const detalle: Record<string, unknown> = {};
    for (const f of fields) detalle[String(f)] = prec[f];
    cambios.push({
      snapshot_id: snapshotId,
      entidad,
      clave: key,
      sku: skuOf(prec),
      campo: '*',
      valor_anterior: JSON.stringify(detalle),
      valor_nuevo: null,
      tipo: 'BAJA',
    });
  }

  return cambios;
}

/**
 * Differ de embarques con semántica de históricos (spec §6):
 *   - ALTA: sobre el conjunto COMPLETO (activos + históricos) por clave
 *     nueva `oc_po|sku` → un histórico emite ALTA en su PRIMERA aparición.
 *   - MODIFICACION / BAJA: SOLO sobre el subconjunto ACTIVO
 *     (is_historial=false) → los históricos nunca emiten MOD ni BAJA.
 * Duplicados por clave colapsan al estatus más avanzado (mayor orden).
 */
export function diffEmbarques(
  prev: EmbarqueRow[],
  next: EmbarqueRow[],
  snapshotId = '',
): CambioNuevo[] {
  const key = (e: EmbarqueRow) => `${e.oc_po ?? ''}|${e.sku}`;
  const orden = (e: EmbarqueRow) => e.estatus_id;
  const activo = (e: EmbarqueRow) => !e.is_historial;

  const completePrev = collapseByKey(prev, key, orden);
  const completeNext = collapseByKey(next, key, orden);
  const activePrev = collapseByKey(prev.filter(activo), key, orden);
  const activeNext = collapseByKey(next.filter(activo), key, orden);

  const altas = diffEntity(completePrev, completeNext, key, ['estatus'], 'embarque', snapshotId).filter(
    (c) => c.tipo === 'ALTA',
  );
  const modBajas = diffEntity(activePrev, activeNext, key, ['estatus'], 'embarque', snapshotId).filter(
    (c) => c.tipo !== 'ALTA',
  );
  return [...altas, ...modBajas];
}
