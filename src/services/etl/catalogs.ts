// ============================================================
// Bloque 2 · ETL · catalogs.ts  (PURO, sobre CatalogIndex precargado)
// Resolución de marca / familia / almacén / kam / estatus.
// Marca/familia soportan ALTA (marca_id/familia_id null → nueva).
// ============================================================
import type { CatalogIndex, ClaveAlmacen } from './types';
import { normalizeAliasKey, normalizeMarcaNombre } from './normalize';

/**
 * Marca: alias normalizado → nombre canónico → id.
 * Devuelve { marca_id } si existe; { nueva } si hay que darla de alta;
 * {} si el texto es vacío (el llamador decide cuarentena).
 * Nota: 'WEST' NO es marca (es almacén); no se resuelve aquí.
 */
export function resolveMarca(
  raw: string,
  idx: CatalogIndex,
): { marca_id?: string; nueva?: string } {
  const canon = normalizeMarcaNombre(raw);
  if (canon === null) return {};
  const aliasHit = idx.marcaAlias.get(normalizeAliasKey(raw));
  if (aliasHit) return { marca_id: aliasHit };
  const nombreHit = idx.marcaByNombre.get(canon);
  if (nombreHit) return { marca_id: nombreHit };
  return { nueva: canon };
}

/**
 * Familia (nullable): alias → nombre canónico → id.
 * Vacío → null (producto sin familia). Nueva → { nueva }.
 *
 * ([MVP-2] C) El alias se consulta PRIMERO, exactamente como en
 * `resolveMarca`. Ese orden es todo el diseño: si el nombre malo tiene
 * alias, resuelve al `familia_id` bueno y NUNCA llega a `nueva`, así que
 * `familiasNuevas` no lo lleva y `ingest_snapshot` no vuelve a crear la
 * fila (`0013:317-319`). No es una corrección posterior a la ingesta: es
 * que el nombre malo deja de existir para el motor.
 *
 * La clave es la CELDA COMPLETA, no el átomo — `separarFamilias` no se
 * invoca aquí, a propósito (atomizar cambiaría el modelo de `familias`,
 * fuera de alcance). Un compuesto con errata necesita su propio alias, y
 * la UI de fusión lo declara antes de confirmar. Ver 0018.
 */
export function resolveFamilia(
  raw: string | null,
  idx: CatalogIndex,
): { familia_id?: string; nueva?: string } | null {
  if (raw === null) return null;
  const canon = normalizeMarcaNombre(raw);
  if (canon === null) return null;
  const aliasHit = idx.familiaAlias.get(normalizeAliasKey(raw));
  if (aliasHit) return { familia_id: aliasHit };
  const hit = idx.familiaByNombre.get(canon);
  if (hit) return { familia_id: hit };
  return { nueva: canon };
}

/** Almacén por clave canónica ('NORTH'..'WEST'). */
export function resolveAlmacen(
  clave: ClaveAlmacen,
  idx: CatalogIndex,
): string | null {
  return idx.almacenByClave.get(clave) ?? null;
}

/** KAM por nombre normalizado. null si no existe (reserva sin KAM). */
export function resolveKam(raw: string | null, idx: CatalogIndex): string | null {
  if (raw === null) return null;
  const key = normalizeAliasKey(raw);
  if (key === '') return null;
  return idx.kamByNombre.get(key) ?? null;
}

/**
 * Estatus crudo → orden 1..11 vía estatus_alias (tolerante a
 * acentos, caja y erratas conocidas). null si no resuelve.
 */
export function resolveEstatus(raw: string, idx: CatalogIndex): number | null {
  const key = normalizeAliasKey(raw);
  if (key === '') return null;
  return idx.estatusAlias.get(key) ?? null;
}
