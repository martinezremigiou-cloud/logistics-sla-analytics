// ============================================================
// Bloque 6 · F2 · API · pendientes.service.ts  (READ admin + WRITE admin)
// GET /api/pendientes: lista completa de `pendientes_datos` (RLS
// admin-only ya filtra sola — este service NO revalida rol, confía en
// el gate `requireAdminSession` del route, mismo patrón que
// usuarios.service.ts) + conteos vía RPC `contar_pendientes()` + el
// bloque DERIVADO de descuadres (computado al vuelo, NO persistido —
// MISMA `descuadresDe`/fetch que `dashboard.service.ts`, ver
// `fetchDescuadresVigentes`, una sola fuente de la aritmética).
//
// POST /api/pendientes/[id]: resuelve (confirmar/descartar) vía RPC
// `resolver_pendiente` (0009), con el SESSION client — el JWT del
// admin debe viajar para que `auth.jwt()`/`is_admin()` resuelvan
// dentro de la transacción (mismo patrón que `aplicar_override`,
// override.service.ts). Mapeo de errores PG: 42501→forbidden (TOCTOU
// de rol), P0002→no_encontrado (id inexistente), 22023→invalido
// (acción inválida / ya resuelto / motivo ausente al descartar).
//
// Degradación pre-0009: si `pendientes_datos`/`contar_pendientes` aún
// no existen (0009 sin aplicar), la lista/conteos degradan a vacío/0
// (mismo `esNoDisponiblePorMigracion` que el resto del dominio — el
// PostgREST vivo responde PGRST205/PGRST202 respectivamente, NUNCA
// 42P01, verificado empíricamente) — NUNCA lanzan por esto.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { leerDrift } from './drift-familias.service';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { esNoDisponiblePorMigracion, esForbidden, esNoEncontrado, esEntradaInvalida } from '@/lib/supabase/pg-errors';
import { fetchDescuadresVigentes } from './dashboard.service';
import type { ResolverPendienteBody, ResolverFamiliaNuevaBody } from '@/schemas/pendientes.schema';
import type {
  PendienteDato,
  PendientesResponse,
  ResolverPendienteResult,
  ResolverFamiliaNuevaResult,
  TipoPendiente,
  EstadoPendiente,
} from '@/types/api';

/** Fila cruda de `pendientes_datos` (0009). */
interface PendienteRow {
  id: string;
  tipo: string;
  clave_natural: string;
  estado: string;
  payload: Record<string, unknown> | null;
  detectado_por: string;
  detectado_en: string;
  snapshot_id: string | null;
  resolucion: Record<string, unknown> | null;
  resuelto_por: string | null;
  resuelto_en: string | null;
}

function toPendienteDato(r: PendienteRow): PendienteDato {
  return {
    id: String(r.id),
    tipo: r.tipo as TipoPendiente,
    clave_natural: String(r.clave_natural),
    estado: r.estado as EstadoPendiente,
    payload: r.payload ?? {},
    detectado_por: String(r.detectado_por),
    detectado_en: String(r.detectado_en),
    snapshot_id: r.snapshot_id == null ? null : String(r.snapshot_id),
    resolucion: r.resolucion ?? null,
    resuelto_por: r.resuelto_por ?? null,
    resuelto_en: r.resuelto_en ?? null,
  };
}

/**
 * Lista COMPLETA de `pendientes_datos` (RLS admin-only ya la filtra —
 * este service confía en el gate del route, no revalida rol), orden
 * `detectado_en` DESC (más reciente primero). Tabla aún no aplicada
 * (0009 pendiente) → `[]`, tolerado vía `esNoDisponiblePorMigracion`
 * (PostgREST responde PGRST205 "tabla ausente del schema cache").
 */
async function fetchPendientes(db: SupabaseClient): Promise<PendienteDato[]> {
  const rows = await fetchAllRows<PendienteRow>(async (from, to) => {
    const res = await db
      .from('pendientes_datos')
      .select(
        'id,tipo,clave_natural,estado,payload,detectado_por,detectado_en,snapshot_id,resolucion,resuelto_por,resuelto_en',
      )
      // [2.0.1-A] `detectado_en` NO desempata: la ingesta sella con el mismo
      // instante todos los pendientes de una corrida, así que sobre esa
      // columna sola el `LIMIT/OFFSET` de `.range()` puede repetir una fila en
      // la página 2 y saltarse otra, en silencio. `id` es la PK y cierra el
      // orden. Mismo arreglo que en `drift-familias.service.ts`; el inventario
      // de los que faltan está en `orden-estable.test.ts` (deuda A1-9).
      .order('detectado_en', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (esNoDisponiblePorMigracion(res.error)) return { data: [], error: null };
    return res;
  });
  return rows.map(toPendienteDato);
}

/**
 * Conteos vía RPC `contar_pendientes()` (0009); degrada a `{abiertos:0,
 * por_tipo:{}}` con un warn silencioso si la RPC aún no existe
 * (PostgREST responde PGRST202 "función ausente del schema cache") —
 * NUNCA lanza por esto (mismo criterio que `dashboard.service.ts`).
 */
async function fetchConteos(db: SupabaseClient): Promise<PendientesResponse['conteos']> {
  const { data, error } = await db.rpc('contar_pendientes');
  if (error) {
    if (esNoDisponiblePorMigracion(error)) {
      console.warn('[pendientes.service] contar_pendientes no disponible aún (0009 sin aplicar) — degradando a 0');
      return { abiertos: 0, por_tipo: {} };
    }
    throw new Error('contar_pendientes: ' + error.message);
  }
  const conteo = data as { abiertos?: number; por_tipo?: Record<string, number> } | null;
  return { abiertos: Number(conteo?.abiertos ?? 0), por_tipo: conteo?.por_tipo ?? {} };
}

/**
 * (MVP-CIERRE F2) Catálogo DECLARADO de tecnologías activas, para que la
 * bandeja no pida el valor a ciegas al resolver `sku_sin_tecnologia`.
 *
 * Degrada a `[]` con la misma disciplina que `fetchConteos`: si la tabla no
 * existiera (proyecto sin 0008) la bandeja sigue funcionando y el diálogo
 * cae a texto libre — nunca lanza por esto.
 */
async function fetchTecnologias(db: SupabaseClient): Promise<string[]> {
  const res = await db.from('tecnologias').select('nombre').eq('activo', true).order('nombre');
  if (esNoDisponiblePorMigracion(res.error)) {
    console.warn('[pendientes.service] tecnologias no disponible aún — el diálogo caerá a texto libre');
    return [];
  }
  if (res.error) throw new Error('tecnologias: ' + res.error.message);
  return (res.data ?? [])
    .map((r) => String((r as { nombre?: unknown }).nombre ?? '').trim())
    .filter((n) => n !== '');
}

/** Bandeja completa (O·bandeja): lista + conteos + bloque DERIVADO de descuadres. */
export async function listPendientes(db: SupabaseClient): Promise<PendientesResponse> {
  const [pendientes, conteos, descuadres, tecnologias, drift] = await Promise.all([
    fetchPendientes(db),
    fetchConteos(db),
    fetchDescuadresVigentes(db),
    fetchTecnologias(db),
    // [2.0.1-A · D2] Lectura derivada, por el mismo carril que los descuadres:
    // ni una escritura nueva, ni un contacto con la ingesta.
    leerDrift(db),
  ]);

  return {
    pendientes,
    derivados: { descuadres, drift: drift.drift, puentes: drift.puentes },
    conteos,
    tecnologias,
  };
}

export type ResolverPendienteOutcome =
  | { tipo: 'ok'; resultado: ResolverPendienteResult }
  | { tipo: 'forbidden' }
  | { tipo: 'no_encontrado' }
  | { tipo: 'invalido'; message: string };

/**
 * Resuelve un pendiente (confirmar/descartar) vía RPC `resolver_pendiente`
 * (0009), con el cliente de SESIÓN (el JWT del admin viaja para que
 * `is_admin()`/`auth.jwt()` resuelvan dentro de la transacción —
 * `db` NUNCA debe ser un cliente `service_role` aquí).
 */
export async function resolverPendiente(
  db: SupabaseClient,
  id: string,
  body: ResolverPendienteBody,
): Promise<ResolverPendienteOutcome> {
  const { data, error } = await db.rpc('resolver_pendiente', {
    p_id: id,
    p_accion: body.accion,
    p_motivo: body.motivo ?? null,
    p_valor: body.valor ?? null,
  });
  if (error) {
    // Defensa en profundidad (TOCTOU, mismo patrón que aplicar_override):
    // `requireAdminSession` (route) ya exige rol='admin', pero el RPC
    // revalida `is_admin()` dentro de la misma transacción.
    if (esForbidden(error)) return { tipo: 'forbidden' };
    // El `id` no existe en `pendientes_datos` (RAISE explícito P0002 del RPC).
    if (esNoEncontrado(error)) return { tipo: 'no_encontrado' };
    // Acción inválida / pendiente ya resuelto-descartado / motivo ausente al
    // descartar (RAISE explícito 22023 del RPC) — mensaje curado, seguro de
    // mostrar al cliente (no es un detalle interno de Postgres).
    if (esEntradaInvalida(error)) return { tipo: 'invalido', message: error.message };
    throw new Error('resolver_pendiente: ' + error.message);
  }
  return { tipo: 'ok', resultado: data as ResolverPendienteResult };
}

// ============================================================
// (B, [MVP-2]) POST /api/pendientes/[id]/fusionar — resolución de
// `familia_nueva` por la rama "es la misma que X" (RPC
// `resolver_familia_nueva`, 0019_mvp2_familia_nueva.sql). Función
// SEPARADA de `resolverPendiente`: la RPC tiene una firma distinta
// (p_destino en vez de p_accion/p_valor) y compone `fusionar_familia`
// por dentro — la rama "es una familia legítima" de `familia_nueva` NO
// pasa por aquí, sigue usando `resolverPendiente` tal cual (confirmar,
// sin rama nueva).
// ============================================================
export type ResolverFamiliaNuevaOutcome =
  | { tipo: 'ok'; resultado: ResolverFamiliaNuevaResult }
  | { tipo: 'forbidden' }
  | { tipo: 'no_encontrado' }
  | { tipo: 'invalido'; message: string }
  | { tipo: 'no_disponible' };

/**
 * Resuelve un `familia_nueva` fusionándolo con una familia existente, vía
 * RPC `resolver_familia_nueva` (0019), con el cliente de SESIÓN (mismo
 * motivo que `resolverPendiente`: `is_admin()` necesita el JWT dentro de
 * la transacción). Mapeo de errores PG: 42501→forbidden, P0002→
 * no_encontrado (el `id` no existe, o — dentro de la misma RPC — el
 * destino no existe en el catálogo, ambos con ese SQLSTATE), 22023→
 * invalido (tipo distinto de `familia_nueva`, ya resuelto, destino
 * inactivo, alias=destino), y `esNoDisponiblePorMigracion`→no_disponible
 * (0019 aún sin aplicar — degradación limpia, nunca un 500 genérico).
 */
export async function resolverFamiliaNueva(
  db: SupabaseClient,
  id: string,
  body: ResolverFamiliaNuevaBody,
): Promise<ResolverFamiliaNuevaOutcome> {
  const { data, error } = await db.rpc('resolver_familia_nueva', {
    p_id: id,
    p_destino: body.destino,
    p_motivo: body.motivo ?? null,
    p_skus_esperados: body.skusEsperados,
  });
  if (error) {
    if (esNoDisponiblePorMigracion(error)) return { tipo: 'no_disponible' };
    if (esForbidden(error)) return { tipo: 'forbidden' };
    if (esNoEncontrado(error)) return { tipo: 'no_encontrado' };
    if (esEntradaInvalida(error)) return { tipo: 'invalido', message: error.message };
    throw new Error('resolver_familia_nueva: ' + error.message);
  }
  return { tipo: 'ok', resultado: data as ResolverFamiliaNuevaResult };
}
