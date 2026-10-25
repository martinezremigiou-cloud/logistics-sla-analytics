// ============================================================
// Bloque 7-A · API · snapshots.service.ts  (READS)
// GET /api/snapshots (lista) + GET /api/snapshots/[id]/cambios
// (detalle) — "Bitácora": historial de ingestas y su diff de
// trazabilidad. Dos orquestadores en un archivo porque ambas rutas
// viven bajo /api/snapshots y comparten el truco de conteo (ver abajo).
//
// Conteo de cambios por snapshot en UNA sola consulta (medido: una consulta
// frente a muchísimas más del N+1 ingenuo: un `count` por snapshot): PostgREST permite
// pedir un embed agregado con ALIAS repetido sobre la MISMA relación,
// cada uno con su propio filtro:
//   .select('...,total:cambios(count),altas:cambios(count),bajas:cambios(count),mods:cambios(count)')
//   .eq('altas.tipo','ALTA').eq('bajas.tipo','BAJA').eq('mods.tipo','MODIFICACION')
// El shape real de cada alias es `[{ count: N }]` (un array de un solo
// elemento) — SIEMPRE se lee `Number(row.alias?.[0]?.count ?? 0)`.
// PROHIBIDO usar `!inner` con un embed agregado: verificado que el
// header (Content-Range) y el cuerpo se contradicen bajo esa
// combinación (p.ej. Content-Range dice 2 filas, el body trae 9) — la
// paginación mentiría. Por eso NO existe un filtro server-side "solo
// snapshots con cambios" (decisión de producto ratificada).
//
// Detalle de cambios: filtrado/orden/paginado 100% EN MEMORIA en el
// builder PURO `buildCambiosPage` — mismo criterio de cota de diseño
// (~5.000 filas) que `embarques.service.ts`; el snapshot con más
// cambios queda cómodamente debajo de la cota. Orden
// determinista `entidad ASC, clave ASC, campo ASC, id ASC` — NUNCA
// `detectado_en` (constante dentro de un mismo snapshot: usarla
// haría la paginación no-determinista, ver `types/api.ts`).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { resolveVigente, resolveVigentes, type FuenteSnapshot, type SnapshotVigente } from './vigente.service';
import { cmpStr } from '@/lib/orden';
import type { SnapshotsPage, SnapshotBitacoraItem, SnapshotResumenCambios, CambiosPage, CambioItem } from '@/types';
import type { SnapshotsQuery, SnapshotCambiosQuery } from '@/schemas/snapshots.schema';

/** Shape real de cada alias agregado de PostgREST: `[{ count: N }]` (ver doc-comment de cabecera). */
type ConteoEmbed = { count: number }[] | null | undefined;

/** Fila cruda de `snapshots` + los 4 alias agregados de `cambios` (lista y detalle comparten este shape). */
interface SnapshotConCambiosRow {
  id: string;
  fuente: string;
  periodo: string;
  archivo: string | null;
  filas: number | null;
  hash: string;
  created_at: string;
  created_by: string | null;
  total?: ConteoEmbed;
  altas?: ConteoEmbed;
  bajas?: ConteoEmbed;
  mods?: ConteoEmbed;
}

function mapCambiosAgregado(row: Pick<SnapshotConCambiosRow, 'total' | 'altas' | 'bajas' | 'mods'>): SnapshotResumenCambios {
  return {
    total: Number(row.total?.[0]?.count ?? 0),
    altas: Number(row.altas?.[0]?.count ?? 0),
    bajas: Number(row.bajas?.[0]?.count ?? 0),
    modificaciones: Number(row.mods?.[0]?.count ?? 0),
  };
}

// ------------------------------------------------------------
// A · Lista — buildSnapshotsPage + listSnapshots
// ------------------------------------------------------------

export interface BuildSnapshotsPageInput {
  rows: SnapshotConCambiosRow[];
  /** Total de filas de `snapshots` que matchean el filtro (Content-Range de PostgREST, `count:'exact'`) — para paginar la Bitácora, NO los cambios. */
  total: number;
  page: number;
  pageSize: number;
  vigentes: { stock: SnapshotVigente | null; aduana: SnapshotVigente | null };
}

/** Construye la página de la Bitácora a partir de filas ya resueltas. 100% PURA — exportada para tests. */
export function buildSnapshotsPage(input: BuildSnapshotsPageInput): SnapshotsPage {
  const { rows, total, page, pageSize, vigentes } = input;

  const vigenteIds = new Set(
    [vigentes.stock?.id, vigentes.aduana?.id].filter((id): id is string => id !== undefined && id !== null),
  );

  const items: SnapshotBitacoraItem[] = rows.map((r) => ({
    id: String(r.id),
    fuente: String(r.fuente),
    periodo: String(r.periodo),
    archivo: r.archivo ?? null,
    filas: r.filas == null ? null : Number(r.filas),
    created_at: String(r.created_at),
    created_by: r.created_by ?? null,
    hash_corto: String(r.hash).slice(0, 12),
    cambios: mapCambiosAgregado(r),
    vigente: vigenteIds.has(String(r.id)),
  }));

  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
    vigentes: {
      stock: vigentes.stock ? { ...vigentes.stock, vigente: true } : null,
      aduana: vigentes.aduana ? { ...vigentes.aduana, vigente: true } : null,
    },
  };
}

const SNAPSHOTS_CAMBIOS_SELECT =
  'id,fuente,periodo,archivo,filas,hash,created_at,created_by,total:cambios(count),altas:cambios(count),bajas:cambios(count),mods:cambios(count)';

/** Bitácora de snapshots (Bloque 7-A·A). `requireSession` (NO admin) la protege — RLS `USING(true)` para autenticados. */
export async function listSnapshots(db: SupabaseClient, query: SnapshotsQuery): Promise<SnapshotsPage> {
  let builder = db
    .from('snapshots')
    .select(SNAPSHOTS_CAMBIOS_SELECT, { count: 'exact' })
    .eq('altas.tipo', 'ALTA')
    .eq('bajas.tipo', 'BAJA')
    .eq('mods.tipo', 'MODIFICACION');

  if (query.fuente) builder = builder.eq('fuente', query.fuente);
  if (query.periodo) builder = builder.eq('periodo', query.periodo);

  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const [{ data, error, count }, vigentes] = await Promise.all([
    builder.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to),
    resolveVigentes(db),
  ]);
  if (error) throw new Error('snapshots: ' + error.message);

  return buildSnapshotsPage({
    rows: (data ?? []) as SnapshotConCambiosRow[],
    total: count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
    vigentes,
  });
}

// ------------------------------------------------------------
// B · Detalle — buildCambiosPage + getSnapshotCambios
// ------------------------------------------------------------

/** Fila cruda de `cambios` (ya filtrada a un `snapshot_id`) — incluye `detectado_en` solo para que el orquestador lo lea UNA vez (ver `getSnapshotCambios`); `buildCambiosPage` no lo copia al DTO por fila. */
export interface CambioRow {
  id: string;
  entidad: 'producto' | 'stock' | 'reserva' | 'embarque';
  clave: string;
  sku: string | null;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  tipo: 'ALTA' | 'BAJA' | 'MODIFICACION';
  detectado_en?: string;
}

export interface BuildCambiosPageInput {
  snapshot: {
    id: string;
    fuente: string;
    periodo: string;
    archivo: string | null;
    filas: number | null;
    hash: string;
    created_at: string;
    created_by: string | null;
    detectado_en: string;
  };
  vigente: boolean;
  /** Del snapshot COMPLETO, SIN filtros (ver doc-comment de `CambiosPage.resumen`). */
  resumen: SnapshotResumenCambios;
  /** TODAS las filas de `cambios` de este snapshot — `buildCambiosPage` filtra/ordena/pagina en memoria. */
  cambios: CambioRow[];
  query: SnapshotCambiosQuery;
}

/** `entidad ASC, clave ASC, campo ASC, id ASC` — NUNCA `detectado_en` (ver doc-comment de cabecera). */
function compararCambios(a: CambioItem, b: CambioItem): number {
  return (
    cmpStr(a.entidad, b.entidad) ||
    cmpStr(a.clave, b.clave) ||
    cmpStr(a.campo, b.campo) ||
    cmpStr(a.id, b.id)
  );
}

/** Construye el detalle de cambios de un snapshot a partir de filas ya resueltas. 100% PURA — exportada para tests. */
export function buildCambiosPage(input: BuildCambiosPageInput): CambiosPage {
  const { snapshot, vigente, resumen, cambios, query } = input;

  const items: CambioItem[] = cambios.map((c) => ({
    id: String(c.id),
    entidad: c.entidad,
    clave: String(c.clave),
    sku: c.sku ?? null,
    campo: String(c.campo),
    valor_anterior: c.valor_anterior ?? null,
    valor_nuevo: c.valor_nuevo ?? null,
    tipo: c.tipo,
  }));

  let filtered = items;
  if (query.entidad) filtered = filtered.filter((c) => c.entidad === query.entidad);
  if (query.tipo) filtered = filtered.filter((c) => c.tipo === query.tipo);
  if (query.campo) filtered = filtered.filter((c) => c.campo === query.campo);
  if (query.sku) filtered = filtered.filter((c) => c.sku === query.sku);

  const ordered = [...filtered].sort(compararCambios);

  const total = ordered.length;
  const totalPages = Math.ceil(total / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = ordered.slice(start, start + query.pageSize);

  return {
    snapshot: { ...snapshot, vigente },
    resumen,
    items: pageItems,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
  };
}

/**
 * Detalle de cambios de UN snapshot (Bloque 7-A·B). `null` = el
 * snapshot no existe (404 `snapshot_no_encontrado` lo decide el route,
 * mismo criterio que `getSkuDetalle`/404 en sku.service.ts).
 */
export async function getSnapshotCambios(
  db: SupabaseClient,
  id: string,
  query: SnapshotCambiosQuery,
): Promise<CambiosPage | null> {
  const { data, error } = await db
    .from('snapshots')
    .select(SNAPSHOTS_CAMBIOS_SELECT)
    .eq('altas.tipo', 'ALTA')
    .eq('bajas.tipo', 'BAJA')
    .eq('mods.tipo', 'MODIFICACION')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('snapshots: ' + error.message);
  if (!data) return null;

  const row = data as SnapshotConCambiosRow;

  const [cambiosRows, vigente] = await Promise.all([
    // `.order('id')` es OBLIGATORIO aquí (fix A1, ronda 2 de revisor-codigo):
    // sin él, `LIMIT/OFFSET` (`.range()`) consecutivos de `fetchAllRows` NO
    // garantizan estabilidad en Postgres una vez que la tabla cruza 1000
    // filas (un snapshot con muchos cambios requiere varios `range()`
    // sucesivos) — una fila puede repetirse en una página interna del fetch
    // y faltar en otra, ANTES de que `buildCambiosPage` llegue a ordenar en
    // memoria. Nótese que esto es independiente del orden final que expone
    // el contrato (`entidad ASC, clave ASC, campo ASC, id ASC`, ver
    // `compararCambios`): aquí solo se busca un orden ESTABLE de traída, no
    // el de salida.
    fetchAllRows<CambioRow>((from, to) =>
      db
        .from('cambios')
        .select('id,entidad,clave,sku,campo,valor_anterior,valor_nuevo,tipo,detectado_en')
        .eq('snapshot_id', id)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    // `row.fuente` solo toma 'stock'/'aduana' en la práctica (únicas 2 fuentes
    // que produce el ETL) — cast defensivo, `resolveVigente` es agnóstico del valor.
    resolveVigente(db, row.fuente as FuenteSnapshot),
  ]);

  // `detectado_en` es IDÉNTICO en todas las filas de un snapshot (timestamp de
  // LA TRANSACCIÓN, no un dato por fila) — leer de cualquiera basta. Fallback a
  // `created_at` en el caso límite de un snapshot sin ninguna fila de `cambios`
  // asociada (nunca se lanza por esto).
  const detectado_en = cambiosRows[0]?.detectado_en ?? String(row.created_at);

  return buildCambiosPage({
    snapshot: {
      id: String(row.id),
      fuente: String(row.fuente),
      periodo: String(row.periodo),
      archivo: row.archivo ?? null,
      filas: row.filas == null ? null : Number(row.filas),
      hash: String(row.hash),
      created_at: String(row.created_at),
      created_by: row.created_by ?? null,
      detectado_en,
    },
    vigente: vigente?.id === row.id,
    resumen: mapCambiosAgregado(row),
    cambios: cambiosRows,
    query,
  });
}
