// ============================================================
// Bloque 7-A · API · embarques.service.ts  (READS)
// GET /api/embarques — "Libro Mayor": TODOS los embarques del
// snapshot 'aduana' vigente (activos + histórico), a diferencia de
// `/api/cruce` (F1) que solo expone los 11 activos agrupados por
// etapa. Pinneado SIEMPRE a `vigente('aduana')` — mismo criterio que
// `cruce.service.ts` (las particiones `embarques` por snapshot son
// INMUTABLES, ver cabecera de `vigente.service.ts`; sin re-verificación
// anti-mezcla, esa es específica de 'stock').
//
// Filtrado/orden/paginado 100% EN MEMORIA en el builder PURO
// `buildEmbarquesPage` — cota de diseño ~5.000 filas (consistente con
// el resto de B3-4: inventory/cruce/dashboard.service.ts). El volumen
// real queda muy por debajo de la cota.
//
// Descripciones de display: PROHIBIDO `.in('sku', [...])` (con cientos de
// SKUs distintos, algunos con espacios/barras, la URL generada por
// PostgREST puede pasar de 8 KB y disparar 414 intermitentes). Se usa
// el patrón de `inventory.service.ts`: 3 `fetchAllRows` SIN lista de
// skus (productos vigentes de 'stock' + overrides activos de
// descripción + clasificacion_v2, tolerando `esNoDisponiblePorMigracion`),
// resueltas con `resolverClasificacion` (3 capas: manual > v2 > fuente)
// — NUNCA se reimplementa esa precedencia aquí.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { resolveVigente, conVigenteStock, type SnapshotVigente } from './vigente.service';
import {
  resolverClasificacion,
  esRetrasado,
  type OverrideLectura,
  type ProductoLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import { mapearV2 } from '@/lib/clasificacion';
import { hoyMexico } from '@/lib/fechas';
import { cmpStr } from '@/lib/orden';
import type {
  EmbarquesResponse,
  EmbarqueItem,
  EmbarquesResumen,
  EmbarquesFacetaEstatus,
  EmbarquesFacetaValor,
  EmbarquesFacetas,
  CampoOverride,
} from '@/types';
import type { EmbarquesQuery } from '@/schemas/embarques.schema';

/** Fila cruda de `estatus_catalogo` (las 11 etapas del pipeline de aduana). */
export interface EmbarquesEstatusRow {
  orden: number;
  nombre: string;
}

/** Fila cruda de `embarques` (ya filtrada al snapshot vigente de aduana) — SIN embed de `estatus_catalogo`: el nombre se resuelve en memoria (ver `buildEmbarquesPage`), para poder aplicar el fallback de estatus huérfano. */
export interface EmbarquesEmbarqueRow {
  id: string;
  sku: string;
  oc_po: string | null;
  proveedor: string | null;
  referencia: string | null;
  factura: string | null;
  pais_origen: string | null;
  piezas: number | null;
  fw: string | null;
  tipo_importacion: string | null;
  fecha_recoleccion: string | null;
  etd: string | null;
  eta: string | null;
  fecha_llegada: string | null;
  fecha_disponibilidad: string | null;
  estatus_id: number;
  proyecto: string | null;
  observaciones: string | null;
  is_historial: boolean;
}

/** Input de `buildEmbarquesPage`, en un objeto nombrado (mismo patrón que `BuildCruceInput`/`BuildDashboardInput`). */
export interface BuildEmbarquesInput {
  /** Las 11 etapas del pipeline (`estatus_catalogo`), en cualquier orden — se reordena defensivamente. */
  estatus: EmbarquesEstatusRow[];
  embarques: EmbarquesEmbarqueRow[];
  /** descripción EFECTIVA por sku (override ?? v2 ?? descr_origen), ya resuelta por el caller. */
  descrPorSku: Map<string, string | null>;
  snapshot: SnapshotVigente | null;
  query: EmbarquesQuery;
  /** 'YYYY-MM-DD', inyectada por `listEmbarques` — esta función es 100% pura, nunca llama `new Date()`. */
  hoy: string;
}

const CAMPO_FECHA = {
  eta: 'eta',
  etd: 'etd',
  llegada: 'fecha_llegada',
} as const satisfies Record<EmbarquesQuery['fechaCampo'], keyof EmbarqueItem>;

function cmpNum(a: number, b: number): number {
  return a - b;
}

/**
 * Nulls SIEMPRE al final, sin importar `dir` (ni en asc ni en desc se
 * invierten). `dir` solo decide el sentido de la comparación cuando
 * AMBOS lados tienen valor real.
 */
function compararConNullsAlFinal<T>(a: T | null, b: T | null, cmp: (x: T, y: T) => number, dir: 'asc' | 'desc'): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const base = cmp(a, b);
  return dir === 'asc' ? base : -base;
}

/**
 * Orden ESTABLE: primario según `orden`/`dir` (nulls siempre al final,
 * ver `compararConNullsAlFinal`) → desempate `id` ASC SIEMPRE, nunca
 * invertido por `dir`. Crítico para la paginación: sin un desempate
 * determinista, las filas históricas que comparten fechas nulas
 * podrían reordenarse entre páginas (una fila repetida, otra perdida).
 */
function compararEmbarques(a: EmbarqueItem, b: EmbarqueItem, orden: EmbarquesQuery['orden'], dir: EmbarquesQuery['dir']): number {
  let primario = 0;
  switch (orden) {
    case 'eta':
      primario = compararConNullsAlFinal(a.eta, b.eta, cmpStr, dir);
      break;
    case 'etd':
      primario = compararConNullsAlFinal(a.etd, b.etd, cmpStr, dir);
      break;
    case 'llegada':
      primario = compararConNullsAlFinal(a.fecha_llegada, b.fecha_llegada, cmpStr, dir);
      break;
    case 'sku':
      // `sku` nunca es null: comparación directa, sin pasar por compararConNullsAlFinal.
      primario = dir === 'asc' ? cmpStr(a.sku, b.sku) : -cmpStr(a.sku, b.sku);
      break;
    case 'estatus':
      // `estatus_orden` nunca es null.
      primario = dir === 'asc' ? cmpNum(a.estatus_orden, b.estatus_orden) : -cmpNum(a.estatus_orden, b.estatus_orden);
      break;
    case 'piezas':
      primario = compararConNullsAlFinal(a.piezas, b.piezas, cmpNum, dir);
      break;
  }
  if (primario !== 0) return primario;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Construye la página del Libro Mayor a partir de sus filas ya
 * resueltas. 100% PURA — exportada para tests. Pipeline en este orden
 * exacto: normalizar/derivar → FACETAS (universo) → filtrar → ordenar
 * → RESUMEN (filtrado) → paginar.
 */
export function buildEmbarquesPage(input: BuildEmbarquesInput): EmbarquesResponse {
  const { estatus, embarques, descrPorSku, snapshot, query, hoy } = input;

  // --- 1) normalizar/derivar ---
  const estatusOrdenado = [...estatus].sort((a, b) => a.orden - b.orden);
  const nombrePorOrden = new Map(estatusOrdenado.map((e) => [e.orden, e.nombre]));

  const items: EmbarqueItem[] = embarques.map((row) => {
    const sku = String(row.sku);
    const eta = row.eta ?? null;
    const fecha_llegada = row.fecha_llegada ?? null;
    const estatus_orden = Number(row.estatus_id);
    const is_historial = Boolean(row.is_historial);
    return {
      id: String(row.id),
      sku,
      descripcion: descrPorSku.get(sku) ?? null,
      oc_po: row.oc_po ?? null,
      proveedor: row.proveedor ?? null,
      referencia: row.referencia ?? null,
      factura: row.factura ?? null,
      pais_origen: row.pais_origen ?? null,
      piezas: row.piezas ?? null,
      fw: row.fw ?? null,
      tipo_importacion: row.tipo_importacion ?? null,
      fecha_recoleccion: row.fecha_recoleccion ?? null,
      etd: row.etd ?? null,
      eta,
      fecha_llegada,
      fecha_disponibilidad: row.fecha_disponibilidad ?? null,
      // A diferencia de `buildCruce`, un estatus_id huérfano NUNCA descarta la
      // fila (invariante del libro mayor: Σfilas = filas del snapshot) — fallback ''.
      estatus: nombrePorOrden.get(estatus_orden) ?? '',
      estatus_orden,
      proyecto: row.proyecto ?? null,
      observaciones: row.observaciones ?? null,
      is_historial,
      // El retraso solo aplica a embarques EN CURSO (decisión de producto, fix
      // [INV-B7A]): un histórico ya cerró su ciclo y no puede estar
      // "retrasado". Hallazgo verificado en vivo contra la BD: varias filas
      // is_historial=true (estatus 11 "Producto Disponible") tienen
      // `fecha_disponibilidad` llena pero SIN `fecha_llegada` — la fuente
      // nunca llenó ese campo aunque la mercancía ya llegó — y `esRetrasado`
      // las pintaba como "Retraso" por error. `esRetrasado` en sí NO cambia:
      // sigue siendo la fuente compartida con `/cruce`, la Ficha y el
      // Dashboard (los tres ya acotan a activos).
      retrasado: is_historial ? false : esRetrasado(eta, fecha_llegada, hoy),
    };
  });

  // --- 2) FACETAS — sobre el UNIVERSO, antes de filtrar (ver doc-comment del DTO). ---
  const conteoPorEstatus = new Map<number, number>();
  const conteoPorPais = new Map<string, number>();
  let ambitoActivos = 0;
  let ambitoHistorial = 0;
  for (const it of items) {
    conteoPorEstatus.set(it.estatus_orden, (conteoPorEstatus.get(it.estatus_orden) ?? 0) + 1);
    if (it.pais_origen !== null) {
      conteoPorPais.set(it.pais_origen, (conteoPorPais.get(it.pais_origen) ?? 0) + 1);
    }
    if (it.is_historial) ambitoHistorial++;
    else ambitoActivos++;
  }
  const facetaEstatus: EmbarquesFacetaEstatus[] = estatusOrdenado.map((e) => ({
    orden: e.orden,
    nombre: e.nombre,
    conteo: conteoPorEstatus.get(e.orden) ?? 0,
  }));
  const facetaPaises: EmbarquesFacetaValor[] = Array.from(conteoPorPais.entries())
    .map(([valor, conteo]) => ({ valor, conteo }))
    .sort((a, b) => cmpStr(a.valor, b.valor));
  // Costo cero (fix A3, ronda 2): mismo loop de arriba, sin fetch adicional
  // — ver doc-comment de `EmbarquesFacetas.ambito` en types/api.ts.
  const facetaAmbito = { todos: items.length, activos: ambitoActivos, historial: ambitoHistorial };
  const facetas: EmbarquesFacetas = { estatus: facetaEstatus, paises: facetaPaises, ambito: facetaAmbito };

  // --- 3) filtrar (AND entre sí) ---
  const q = query.q?.toLowerCase();
  const pais = query.pais?.toLowerCase();

  let filtered = items;
  if (q) {
    filtered = filtered.filter(
      (it) =>
        it.sku.toLowerCase().includes(q) ||
        (it.oc_po ?? '').toLowerCase().includes(q) ||
        (it.referencia ?? '').toLowerCase().includes(q) ||
        (it.factura ?? '').toLowerCase().includes(q) ||
        (it.descripcion ?? '').toLowerCase().includes(q),
    );
  }
  if (query.ambito === 'activos') {
    filtered = filtered.filter((it) => !it.is_historial);
  } else if (query.ambito === 'historial') {
    filtered = filtered.filter((it) => it.is_historial);
  }
  if (query.estatus !== undefined) {
    const estatusFiltro = query.estatus;
    filtered = filtered.filter((it) => it.estatus_orden === estatusFiltro);
  }
  if (pais) {
    filtered = filtered.filter((it) => it.pais_origen !== null && it.pais_origen.toLowerCase() === pais);
  }
  if (query.retrasado) {
    filtered = filtered.filter((it) => it.retrasado);
  }
  if (query.desde !== undefined || query.hasta !== undefined) {
    const campo = CAMPO_FECHA[query.fechaCampo];
    const desde = query.desde;
    const hasta = query.hasta;
    filtered = filtered.filter((it) => {
      // En cuanto hay UN extremo del rango, las filas con NULL en el campo
      // elegido quedan FUERA (una fila sin fecha no puede estar "dentro" de
      // un rango) — incluirlas inflaría conteos en silencio.
      const valor = it[campo] as string | null;
      if (valor === null) return false;
      if (desde !== undefined && valor < desde) return false;
      if (hasta !== undefined && valor > hasta) return false;
      return true;
    });
  }

  // --- 4) ordenar ---
  const ordered = [...filtered].sort((a, b) => compararEmbarques(a, b, query.orden, query.dir));

  // --- 5) RESUMEN — sobre el FILTRADO (ver doc-comment del DTO). ---
  let piezas = 0;
  let activos = 0;
  let historial = 0;
  let piezas_activas = 0;
  let retrasados = 0;
  for (const it of filtered) {
    piezas += it.piezas ?? 0;
    if (it.is_historial) {
      historial++;
    } else {
      activos++;
      piezas_activas += it.piezas ?? 0;
    }
    if (it.retrasado) retrasados++;
  }
  const resumen: EmbarquesResumen = { embarques: filtered.length, piezas, activos, historial, piezas_activas, retrasados };

  // --- 6) paginar ---
  const total = filtered.length;
  const totalPages = Math.ceil(total / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = ordered.slice(start, start + query.pageSize);

  return {
    snapshot: snapshot ? { ...snapshot, vigente: true } : null,
    items: pageItems,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages,
    resumen,
    facetas,
  };
}

// ------------------------------------------------------------
// Orquestador — listEmbarques (fetches con el session client)
// ------------------------------------------------------------

interface DescripcionesProductoRow {
  sku: string;
  descr_origen: string | null;
}
/**
 * [FIX-B1] `campo: CampoOverride` (`@/types/enums`), no el literal
 * repetido — el fetch de abajo filtra `.eq('campo', 'descripcion')`, así
 * que en la práctica esta fila nunca trae `'tecnologia'`, pero el tipo ya
 * no lo repite a mano.
 */
interface DescripcionesOverrideRow {
  id: string;
  sku: string;
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}

/**
 * `clasificacion_v2` puede no existir aún en la DB (0008 pendiente de
 * aplicar); tolerado vía `esNoDisponiblePorMigracion`, mismo criterio
 * que inventory/sku/cruce/dashboard.service.ts.
 *
 * ⚠ SIN CONSUMIDOR desde D-1(a) (CAT-B1 · Tramo B): el fetch de
 * `clasificacion_v2` de abajo (`fetchAllRows` sobre la tabla ENTERA,
 * por petición) se indexa con `mapearV2` y se pasa a
 * `resolverClasificacion`, pero esa función ignora su 3er argumento (ver
 * derivaciones.ts) — el resultado no influye en `descrPorSku`. No se borra
 * (D-1(a): "congelar, no dejar de leer"); su retiro es decisión pendiente
 * de quien retome esta bandeja.
 */
async function fetchDescrPorSku(db: SupabaseClient, S: SnapshotVigente): Promise<Map<string, string | null>> {
  const [productos, overrides, v2Rows] = await Promise.all([
    fetchAllRows<DescripcionesProductoRow>((from, to) =>
      db.from('productos').select('sku,descr_origen').eq('snapshot_id', S.id).range(from, to),
    ),
    fetchAllRows<DescripcionesOverrideRow>((from, to) =>
      db
        .from('productos_override')
        .select('id,sku,campo,valor_editado,editado_en,activo')
        .eq('activo', true)
        .eq('campo', 'descripcion')
        .range(from, to),
    ),
    fetchAllRows<ClasificacionV2Lectura>(async (from, to) => {
      const res = await db
        .from('clasificacion_v2')
        .select('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2')
        .range(from, to);
      if (esNoDisponiblePorMigracion(res.error)) return { data: [], error: null };
      return res;
    }),
  ]);

  const overridesLectura: OverrideLectura[] = overrides.map((o) => ({
    sku: String(o.sku),
    campo: o.campo,
    valor_editado: String(o.valor_editado),
    editado_en: String(o.editado_en),
    id: String(o.id),
    activo: Boolean(o.activo),
  }));
  const v2PorSku = mapearV2(v2Rows);

  const descrPorSku = new Map<string, string | null>();
  for (const p of productos) {
    const sku = String(p.sku);
    const productoLectura: ProductoLectura = {
      sku,
      marca: '',
      familia: null,
      descr_origen: p.descr_origen ?? null,
      resv: 0,
      tecnologia: null,
    };
    const resuelto = resolverClasificacion(productoLectura, overridesLectura, v2PorSku.get(sku) ?? null);
    descrPorSku.set(sku, resuelto.descr.valor);
  }
  return descrPorSku;
}

/** Libro Mayor (Bloque 7-A). Sin vigente 'aduana' → "vacío digno" 200 con las 11 etapas en ceros (nunca 404/500). */
export async function listEmbarques(db: SupabaseClient, query: EmbarquesQuery): Promise<EmbarquesResponse> {
  const snapshot = await resolveVigente(db, 'aduana');
  const hoy = hoyMexico();

  if (!snapshot) {
    const { data, error } = await db.from('estatus_catalogo').select('orden,nombre');
    if (error) throw new Error('estatus_catalogo: ' + error.message);
    return buildEmbarquesPage({
      estatus: (data ?? []) as EmbarquesEstatusRow[],
      embarques: [],
      descrPorSku: new Map(),
      snapshot: null,
      query,
      hoy,
    });
  }

  const [estatusRes, embarquesRows, descrPorSku] = await Promise.all([
    db.from('estatus_catalogo').select('orden,nombre'),
    // `.order('id')` es OBLIGATORIO aquí (fix A1, ronda 2 de revisor-codigo):
    // `LIMIT/OFFSET` (`.range()`) consecutivos de `fetchAllRows` NO
    // garantizan estabilidad en Postgres una vez que la tabla cruza 1000
    // filas — benigno hoy (una sola página) pero no mañana.
    // Mismo criterio que la consulta de `cambios` en `snapshots.service.ts`
    // (el primer fetch que sí cruza esa cota hoy).
    fetchAllRows<EmbarquesEmbarqueRow>((from, to) =>
      db
        .from('embarques')
        .select(
          'id,sku,oc_po,proveedor,referencia,factura,pais_origen,piezas,fw,tipo_importacion,fecha_recoleccion,etd,eta,fecha_llegada,fecha_disponibilidad,estatus_id,proyecto,observaciones,is_historial',
        )
        .eq('snapshot_id', snapshot.id)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    // Descripciones vía el snapshot 'stock' vigente (con re-verificación
    // anti-mezcla, `conVigenteStock`) — sin vigente de stock → Map vacío
    // (los embarques se sirven igual, solo sin descripción de display).
    conVigenteStock(db, (S) => fetchDescrPorSku(db, S)),
  ]);
  if (estatusRes.error) throw new Error('estatus_catalogo: ' + estatusRes.error.message);

  return buildEmbarquesPage({
    estatus: (estatusRes.data ?? []) as EmbarquesEstatusRow[],
    embarques: embarquesRows,
    descrPorSku: descrPorSku ?? new Map(),
    snapshot,
    query,
    hoy,
  });
}
