// ============================================================
// Bloque 3 · API · familias.service.ts  (READ + WRITE admin)
// GET /api/familias: catálogo controlado de familias (D3). POST
// /api/familias: alta admin, con chequeo de duplicado case-insensitive
// vía el prechequeo `ilike` en el camino secuencial. El fallback 23505
// de abajo cubre la carrera contra CUALQUIERA de los dos UNIQUE de BD:
// `familias_nombre_unique` (case-sensitive, `UNIQUE (nombre)`,
// 0001_schema.sql) y `familias_nombre_lower_uidx` (case-insensitive,
// `UNIQUE (lower(nombre))`, `0006_b5_dominio.sql:73` — cierra la deuda
// B3-5, ver `docs/known-limitations.md` (B3-5)), así que una carrera entre variantes de
// casing (p.ej. "Blister" vs "BLISTER") también dispara 23505 y cae en
// el mismo `if` de abajo.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { escaparLike } from '@/lib/supabase/ilike';
import { separarFamilias } from '@/lib/familias';
import { esNoDisponiblePorMigracion, esForbidden, esNoEncontrado, esEntradaInvalida } from '@/lib/supabase/pg-errors';
import type { FusionFamiliaResultado, FusionPreviewResponse } from '@/types/api';

export interface FamiliaItem {
  id: string;
  nombre: string;
  activo: boolean;
}

/**
 * `origen` distingue un alta real de una reactivación (D, [MVP-2]): si
 * el nombre ya existía pero INACTIVO, `createFamilia` lo reactiva en
 * vez de bloquearlo para siempre — ver el docstring de `createFamilia`.
 */
export type CreateFamiliaResult =
  | { ok: true; familia: FamiliaItem; origen: 'creada'; aliasVivo?: false }
  /** `aliasVivo`: la familia reactivada sigue siendo alias de otra (frente C) — el ETL no le asignará nada hasta deshacer la fusión. */
  | { ok: true; familia: FamiliaItem; origen: 'reactivada'; aliasVivo: boolean }
  | { ok: false; motivo: 'duplicada' };

/** Catálogo de familias, ordenado por nombre. `incluirInactivas=false` filtra a `activo=true`. */
export async function listFamilias(
  db: SupabaseClient,
  incluirInactivas: boolean,
): Promise<{ items: FamiliaItem[] }> {
  let query = db.from('familias').select('id,nombre,activo').order('nombre', { ascending: true });
  if (!incluirInactivas) {
    query = query.eq('activo', true);
  }

  const { data, error } = await query;
  if (error) throw new Error('familias: ' + error.message);

  return { items: (data ?? []) as FamiliaItem[] };
}

/**
 * Alta de familia (admin). El prechequeo `ilike` de arriba busca un
 * match case-insensitive SIN filtrar por `activo` (activa o inactiva).
 * Si lo encuentra:
 *   - activo=true  → `{ ok:false, motivo:'duplicada' }`, sin tocar la BD.
 *   - activo=false → la REACTIVA (`UPDATE activo=true` sobre esa misma
 *     fila; D, [MVP-2]) y regresa `{ ok:true, familia,
 *     origen:'reactivada' }` en vez de bloquear el nombre para siempre
 *     — nada en la app pone `activo=false` hoy (solo un UPDATE manual
 *     en el panel de Supabase puede), pero sin este cambio esa familia
 *     inactiva se quedaba sin ninguna forma de recuperarse desde la UI.
 * Sin match → INSERT normal, `{ ok:true, familia, origen:'creada' }`.
 *
 * El fallback 23505 de abajo (si la carrera contra un UNIQUE de la BD
 * gana el INSERT de otro request concurrente) cubre TAMBIÉN duplicados
 * de casing distinto, no solo IDÉNTICO: además de
 * `familias_nombre_unique` (case-sensitive, `UNIQUE (nombre)`,
 * 0001_schema.sql) existe `familias_nombre_lower_uidx`
 * (`UNIQUE (lower(nombre))`, `0006_b5_dominio.sql:73`) sobre TODA la
 * tabla (activas e inactivas), así que una carrera entre "Blister" y
 * "BLISTER" también dispara 23505 y cae en el mismo `if` de abajo.
 * Deuda B3-5 (`docs/known-limitations.md`): CERRADA por ese índice desde el
 * Bloque 5 — este docstring seguía describiendo el estado previo a esa
 * migración.
 */
export async function createFamilia(db: SupabaseClient, nombre: string): Promise<CreateFamiliaResult> {
  const { data: existentes, error: buscarError } = await db
    .from('familias')
    .select('id,nombre,activo')
    .ilike('nombre', escaparLike(nombre));
  if (buscarError) throw new Error('familias: ' + buscarError.message);

  const existente = (existentes ?? [])[0] as FamiliaItem | undefined;
  if (existente) {
    if (existente.activo) {
      return { ok: false, motivo: 'duplicada' };
    }

    // Inactiva: reactivar en vez de bloquear el nombre para siempre (D,
    // [MVP-2]). RLS ya permite UPDATE a admin (0002_rls.sql) y la ruta
    // ya exige `requireAdminSession` — no hace falta migración.
    const { data: reactivada, error: updateError } = await db
      .from('familias')
      .update({ activo: true })
      .eq('id', existente.id)
      .select('id,nombre,activo')
      .single();
    if (updateError) throw new Error('familias: ' + updateError.message);

    // AVISO DE ALIAS VIVO (hallazgo B4-bis de la auditoría). Este bloque le
    // dio a `familias.activo` DOS escritores que se deshacen mutuamente: C lo
    // apaga al fusionar (junto con un alias) y esto lo enciende. Reactivar sin
    // quitar el alias deja una familia ofrecida en el `<Select>` a la que el
    // ETL NUNCA asignará nada, porque `resolveFamilia` consulta el alias
    // primero. No se bloquea la reactivación —puede ser justo lo que el admin
    // quiere antes de deshacer la fusión— pero se DICE, que era lo que
    // faltaba: el frente D no sabía nada del frente C.
    //
    // Tolerante a que la 0018 no esté aplicada: sin `familia_alias` no hay
    // alias que avisar y la reactivación se comporta como antes.
    // Sin `.limit(1)`: `familia_alias_lower_uidx` (0018) garantiza a lo sumo
    // una fila para este nombre, así que acotar no aporta nada y encadenar un
    // método más solo ensancha la superficie que cada fake de test debe imitar.
    const { data: alias, error: aliasError } = await db
      .from('familia_alias')
      .select('alias')
      .ilike('alias', escaparLike(existente.nombre));
    const aliasVivo =
      aliasError && !esNoDisponiblePorMigracion(aliasError) ? false : (alias ?? []).length > 0;

    return {
      ok: true,
      familia: reactivada as FamiliaItem,
      origen: 'reactivada',
      aliasVivo,
    };
  }

  const { data: creada, error: insertError } = await db
    .from('familias')
    .insert({ nombre })
    .select('id,nombre,activo')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, motivo: 'duplicada' };
    }
    throw new Error('familias: ' + insertError.message);
  }

  return { ok: true, familia: creada as FamiliaItem, origen: 'creada' };
}

// ============================================================
// [MVP-2] C · Fusión de familias vía alias (RPC `fusionar_familia`,
// 0018_mvp2_familia_alias.sql). Dos funciones separadas a propósito:
// `previsualizarFusion` es LECTURA pura (solo `familias`/`productos`,
// tablas de 0001 — funciona aunque 0018 no esté aplicada) para que la
// pantalla declare el alcance ANTES de confirmar; `fusionarFamilia`
// ejecuta la escritura real vía la RPC.
// ============================================================

/** Fila cruda de `familias` con el conteo agregado de `productos` — mismo patrón de embed (`hijo(count)`) que `cambios(count)` en `snapshots.service.ts`, sin `!inner` (preserva familias con 0 productos). */
interface FamiliaConConteoRow {
  id: string;
  nombre: string;
  productos: { count: number }[] | null;
}

function conteoProductos(row: FamiliaConConteoRow): number {
  return Number(row.productos?.[0]?.count ?? 0);
}

/** Escapa metacaracteres de regex — `alias`/`destino` son texto libre del admin, no un patrón. */
function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `true` si `atomo` contiene `aliasNorm` como FRASE COMPLETA delimitada
 * por frontera de espacio/inicio/fin — NUNCA como substring pegado.
 * Deliberadamente MÁS FINO que `perteneceAFamilia` (que compara el átomo
 * COMPLETO contra el buscado, ver `src/lib/familias.ts`): ahí "SERIES2" no
 * es igual a "SERIES2 26" y por diseño no debe serlo (evita que el filtro
 * `?familia=` mezcle familias reales distintas). Aquí el objetivo es
 * DISTINTO — avisar de un valor COMPUESTO textualmente emparentado con el
 * alias para que un humano lo revise antes de confirmar, nunca para
 * filtrar/agregar datos solo — así que "SERIES2 26" SÍ debe avisar para el
 * alias "SERIES2" (medido en vivo: una parte de las familias son compuestas, ver
 * cabecera de 0018). Mismo concepto de "token" que usa el productor de
 * `familia_nueva` para sus hermanas (0019: separa por espacio, nunca
 * substring) — "SERIES2XYZ" (sin frontera) NO cuenta.
 */
function atomoContieneAlias(atomo: string, aliasNorm: string): boolean {
  const patron = new RegExp(`(^|\\s)${escaparRegex(aliasNorm)}($|\\s)`, 'i');
  return patron.test(atomo);
}

/**
 * Alcance de una fusión ANTES de confirmar (C, [MVP-2]) — LECTURA pura,
 * no toca `familia_alias` ni la RPC `fusionar_familia` (0018): solo lee
 * `familias`/`productos`, así que funciona aunque 0018 no esté aplicada
 * todavía (sin `esNoDisponiblePorMigracion` aquí a propósito).
 *
 * `cubre`: 1 si existe una fila cuya celda COMPLETA (case-insensitive)
 * es exactamente `alias` — 0 si el alias solo vive en el Excel (la
 * absorbida puede no existir como fila, ver 0018). `no_cubre`: valores
 * COMPUESTOS (`separarFamilias` produce más de un átomo) que contienen
 * el alias en alguno de sus átomos — ver `atomoContieneAlias`. Nunca
 * filtra por `activo`: ni la RPC lo hace al buscar la absorbida, y un
 * alias es una regla hacia adelante (debe declarar el mismo universo que
 * verá `fusionar_familia` al ejecutarse).
 */
export async function previsualizarFusion(db: SupabaseClient, alias: string): Promise<FusionPreviewResponse> {
  const { data, error } = await db.from('familias').select('id,nombre, productos(count)');
  if (error) throw new Error('familias: ' + error.message);

  const rows = (data ?? []) as FamiliaConConteoRow[];
  const aliasNorm = alias.trim().replace(/\s+/g, ' ');
  const aliasLower = aliasNorm.toLowerCase();

  const exacta = rows.find((r) => r.nombre.trim().toLowerCase() === aliasLower);

  const noCubre = rows
    .filter((r) => r !== exacta)
    .filter((r) => {
      const atomos = separarFamilias(r.nombre);
      return atomos.length > 1 && atomos.some((atomo) => atomoContieneAlias(atomo, aliasNorm));
    })
    .map((r) => ({ nombre: r.nombre, skus: conteoProductos(r) }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return {
    alias: aliasNorm,
    cubre: exacta ? 1 : 0,
    skus_directos: exacta ? conteoProductos(exacta) : 0,
    no_cubre: noCubre,
  };
}

export type FusionarFamiliaOutcome =
  | { tipo: 'ok'; resultado: FusionFamiliaResultado }
  | { tipo: 'forbidden' }
  | { tipo: 'no_encontrada'; message: string }
  | { tipo: 'invalido'; message: string }
  | { tipo: 'no_disponible' };

/**
 * Ejecuta la fusión (C, [MVP-2]) vía la RPC `fusionar_familia` (0018),
 * con el cliente de SESIÓN (el JWT del admin viaja para que `is_admin()`
 * resuelva dentro de la transacción — mismo patrón que `aplicar_override`/
 * `resolver_pendiente`). Mapeo de errores PG: 42501→forbidden (TOCTOU de
 * rol), P0002→no_encontrada (el destino no existe en el catálogo),
 * 22023→invalido (alias/destino vacíos, mismo nombre, destino inactivo),
 * y `esNoDisponiblePorMigracion`→no_disponible (0018 aún sin aplicar —
 * degradación limpia, nunca un 500 genérico).
 */
export async function fusionarFamilia(
  db: SupabaseClient,
  alias: string,
  destino: string,
  skusEsperados: number,
): Promise<FusionarFamiliaOutcome> {
  const { data, error } = await db.rpc('fusionar_familia', { p_alias: alias, p_destino: destino, p_skus_esperados: skusEsperados });
  if (error) {
    if (esNoDisponiblePorMigracion(error)) return { tipo: 'no_disponible' };
    if (esForbidden(error)) return { tipo: 'forbidden' };
    if (esNoEncontrado(error)) return { tipo: 'no_encontrada', message: error.message };
    if (esEntradaInvalida(error)) return { tipo: 'invalido', message: error.message };
    throw new Error('fusionar_familia: ' + error.message);
  }
  return { tipo: 'ok', resultado: data as FusionFamiliaResultado };
}
