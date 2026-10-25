// ============================================================
// Bloque 4 · API · cruce.service.ts  (READS)
// GET /api/cruce (F1): pipeline de aduana agrupado por las 11 etapas
// de `estatus_catalogo`. Pinneado SIEMPRE a `vigente('aduana')` — las
// particiones por snapshot (`embarques`) son INMUTABLES una vez
// escritas (ver comentario de cabecera de `vigente.service.ts`), así
// que un solo `resolveVigente` alcanza para consistencia por
// construcción; NO se usa `conVigenteStock` (esa re-verificación
// anti-mezcla es específica de 'stock', donde `productos` hace
// upsert latest-wins).
//
// `productos` en cambio SÍ es latest-wins: se usa aquí ÚNICAMENTE
// como metadato de display (descripción efectiva de cada item), sin
// pin de consistencia — un desfase de milisegundos entre una ingesta
// de 'stock' y esta lectura, en el peor caso, muestra una descripción
// un tick desactualizada; no afecta al pipeline de embarques en sí
// (que sí está pinneado al snapshot de aduana vigente).
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVigente, type SnapshotVigente } from './vigente.service';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import {
  resolverClasificacion,
  esRetrasado,
  type OverrideLectura,
  type ProductoLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import { mapearV2 } from '@/lib/clasificacion';
import { hoyMexico } from '@/lib/fechas';
import type { CruceResponse, CruceEtapa, CruceEmbarqueItem, CruceAgregado, CampoOverride } from '@/types';

/** Fila cruda de `estatus_catalogo` (las 11 etapas del pipeline de aduana). */
export interface CruceEstatusRow {
  orden: number;
  nombre: string;
}

/** Fila cruda de `embarques` (ya filtrada al snapshot vigente de aduana). */
export interface CruceEmbarqueRow {
  id: string;
  sku: string;
  oc_po: string | null;
  proveedor: string | null;
  piezas: number | null;
  tipo_importacion: string | null;
  pais_origen: string | null;
  etd: string | null;
  eta: string | null;
  fecha_llegada: string | null;
  fecha_disponibilidad: string | null;
  proyecto: string | null;
  estatus_id: number;
  is_historial: boolean;
}

/** Fila cruda de `productos` (select mínimo para la descripción de display). */
export interface CruceProductoRow {
  sku: string;
  descr_origen: string | null;
}

/**
 * Fila cruda de `productos_override` (ya filtrada a `activo=true` +
 * `campo='descripcion'` — ver el `.eq('campo', 'descripcion')` del fetch,
 * más abajo: en la práctica `campo` nunca trae otra cosa aquí). [FIX-B1]
 * `campo: CampoOverride` (`@/types/enums`), no el literal repetido, para
 * que un cuarto campo de override nazca cubierto por el mismo tipo.
 */
export interface CruceOverrideRow {
  id: string;
  sku: string;
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}

/** Input de `buildCruce`, en un objeto nombrado (no posicional). */
export interface BuildCruceInput {
  estatus: CruceEstatusRow[];
  embarques: CruceEmbarqueRow[];
  /** descripción EFECTIVA por sku (override ?? descr_origen), ya resuelta por el caller. */
  descrPorSku: Map<string, string | null>;
  snapshot: SnapshotVigente | null;
  /** 'YYYY-MM-DD', inyectada por `getCruce` — esta función es 100% pura, nunca llama `new Date()`. */
  hoy: string;
}

/**
 * Orden de items dentro de una etapa: `eta` ASC con nulls al final →
 * desempate `id` ASC. Comparación de string simple sobre `eta`
 * (formato fecha ISO `YYYY-MM-DD`, comparable lexicográficamente) —
 * mismo criterio de determinismo que O1/O2.
 */
function compareCruceItems(a: CruceEmbarqueItem, b: CruceEmbarqueItem): number {
  if (a.eta !== b.eta) {
    if (a.eta === null) return 1;
    if (b.eta === null) return -1;
    return a.eta < b.eta ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toCruceItem(row: CruceEmbarqueRow, descrPorSku: Map<string, string | null>, hoy: string): CruceEmbarqueItem {
  const sku = String(row.sku);
  const eta = row.eta ?? null;
  const fecha_llegada = row.fecha_llegada ?? null;
  return {
    id: String(row.id),
    sku,
    descripcion: descrPorSku.get(sku) ?? null,
    oc_po: row.oc_po ?? null,
    proveedor: row.proveedor ?? null,
    piezas: row.piezas ?? null,
    tipo_importacion: row.tipo_importacion ?? null,
    pais_origen: row.pais_origen ?? null,
    etd: row.etd ?? null,
    eta,
    fecha_llegada,
    fecha_disponibilidad: row.fecha_disponibilidad ?? null,
    proyecto: row.proyecto ?? null,
    retrasado: esRetrasado(eta, fecha_llegada, hoy),
  };
}

/**
 * Construye la respuesta de El Cruce a partir de sus filas ya
 * resueltas. 100% PURA — exportada para tests. Las 11 etapas de
 * `estatus_catalogo` viajan SIEMPRE, ordenadas por `orden` ASC
 * (reordenadas defensivamente si llegan desordenadas); un embarque
 * con `estatus_id` sin etapa correspondiente se ignora (no cuenta en
 * ningún agregado, no genera item).
 */
export function buildCruce({ estatus, embarques, descrPorSku, snapshot, hoy }: BuildCruceInput): CruceResponse {
  const etapasOrdenadas = [...estatus].sort((a, b) => a.orden - b.orden);
  const ordenesValidos = new Set(etapasOrdenadas.map((e) => e.orden));

  const activosPorEtapa = new Map<number, CruceEmbarqueRow[]>();
  const historialPorEtapa = new Map<number, CruceEmbarqueRow[]>();

  for (const row of embarques) {
    const orden = Number(row.estatus_id);
    if (!ordenesValidos.has(orden)) continue; // estatus_id huérfano: se ignora defensivamente

    const bucket = row.is_historial ? historialPorEtapa : activosPorEtapa;
    const arr = bucket.get(orden);
    if (arr) arr.push(row);
    else bucket.set(orden, [row]);
  }

  const skusActivos = new Set<string>();
  let embarquesActivos = 0;
  let piezasActivas = 0;
  let embarquesHistorial = 0;
  let piezasHistorial = 0;

  const etapas: CruceEtapa[] = etapasOrdenadas.map((e) => {
    const activosRows = activosPorEtapa.get(e.orden) ?? [];
    const historialRows = historialPorEtapa.get(e.orden) ?? [];

    const items = activosRows.map((r) => toCruceItem(r, descrPorSku, hoy)).sort(compareCruceItems);
    for (const it of items) skusActivos.add(it.sku);

    const activos: CruceAgregado = {
      embarques: activosRows.length,
      piezas: activosRows.reduce((sum, r) => sum + (r.piezas ?? 0), 0),
    };
    const historial: CruceAgregado = {
      embarques: historialRows.length,
      piezas: historialRows.reduce((sum, r) => sum + (r.piezas ?? 0), 0),
    };

    embarquesActivos += activos.embarques;
    piezasActivas += activos.piezas;
    embarquesHistorial += historial.embarques;
    piezasHistorial += historial.piezas;

    return { orden: e.orden, nombre: e.nombre, activos, historial, items };
  });

  return {
    snapshot: snapshot ? { ...snapshot, vigente: true } : null,
    resumen: {
      embarques_activos: embarquesActivos,
      piezas_activas: piezasActivas,
      embarques_historial: embarquesHistorial,
      piezas_historial: piezasHistorial,
    },
    etapas,
    skus_activos: Array.from(skusActivos).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/**
 * `clasificacion_v2` puede no existir aún en la DB (0008 pendiente de
 * aplicar — B-PARCHE F2 corre en paralelo). `esNoDisponiblePorMigracion`
 * vive en `@/lib/supabase/pg-errors`, compartida con
 * inventory/sku/clasificacion.service.ts y con `esForbidden` (42501,
 * `override.service.ts`).
 */

/**
 * Filas v2 (B-PARCHE F3) de los SKUs activos, o `[]` si no hay ninguna o la
 * tabla aún no existe (tolerado vía `esNoDisponiblePorMigracion`).
 *
 * ⚠ SIN CONSUMIDOR desde D-1(a) (CAT-B1 · Tramo B): el resultado se
 * indexa más abajo (`mapearV2`) y se pasa a `resolverClasificacion`, pero esa
 * función ignora su 3er argumento (ver derivaciones.ts) — el fetch sigue
 * corriendo por cada llamada a `getCruce` sin que nada del resultado influya
 * en la respuesta. No se borra (D-1(a): "congelar, no dejar de leer"); su
 * retiro es decisión pendiente de quien retome esta bandeja.
 */
async function fetchClasificacionV2ParaSkus(db: SupabaseClient, skus: string[]): Promise<ClasificacionV2Lectura[]> {
  const { data, error } = await db
    .from('clasificacion_v2')
    .select('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2')
    .in('sku', skus);
  if (error) {
    if (esNoDisponiblePorMigracion(error)) return [];
    throw new Error('clasificacion_v2: ' + error.message);
  }
  return (data ?? []) as ClasificacionV2Lectura[];
}

/**
 * El Cruce (F1). Pinneado a `vigente('aduana')`; sin vigente →
 * "vacío digno" 200 con las 11 etapas en ceros (el route nunca
 * regresa 404 aquí).
 */
export async function getCruce(db: SupabaseClient): Promise<CruceResponse> {
  const snapshot = await resolveVigente(db, 'aduana');

  if (!snapshot) {
    const { data, error } = await db.from('estatus_catalogo').select('orden,nombre');
    if (error) throw new Error('estatus_catalogo: ' + error.message);
    const estatus = (data ?? []) as CruceEstatusRow[];
    const hoy = hoyMexico();
    return buildCruce({ estatus, embarques: [], descrPorSku: new Map(), snapshot: null, hoy });
  }

  const [estatusRes, embarques] = await Promise.all([
    db.from('estatus_catalogo').select('orden,nombre'),
    fetchAllRows<CruceEmbarqueRow>((from, to) =>
      db
        .from('embarques')
        .select(
          'id,sku,oc_po,proveedor,piezas,tipo_importacion,pais_origen,etd,eta,fecha_llegada,fecha_disponibilidad,proyecto,estatus_id,is_historial',
        )
        .eq('snapshot_id', snapshot.id)
        .range(from, to),
    ),
  ]);
  if (estatusRes.error) throw new Error('estatus_catalogo: ' + estatusRes.error.message);
  const estatus = (estatusRes.data ?? []) as CruceEstatusRow[];

  // SKUs con embarque ACTIVO, distinct: el pipeline de aduana solo muestra
  // descripción de display para items activos (los históricos no generan filas).
  const skusActivos = Array.from(new Set(embarques.filter((e) => !e.is_historial).map((e) => String(e.sku))));

  let descrPorSku = new Map<string, string | null>();
  if (skusActivos.length > 0) {
    const [productosRes, overridesRes, v2Rows] = await Promise.all([
      db.from('productos').select('sku,descr_origen').in('sku', skusActivos),
      db
        .from('productos_override')
        .select('id,sku,campo,valor_editado,editado_en,activo')
        .eq('activo', true)
        .eq('campo', 'descripcion')
        .in('sku', skusActivos),
      fetchClasificacionV2ParaSkus(db, skusActivos),
    ]);
    if (productosRes.error) throw new Error('productos: ' + productosRes.error.message);
    if (overridesRes.error) throw new Error('productos_override: ' + overridesRes.error.message);

    const productos = (productosRes.data ?? []) as CruceProductoRow[];
    const overridesLectura: OverrideLectura[] = ((overridesRes.data ?? []) as CruceOverrideRow[]).map((o) => ({
      sku: String(o.sku),
      campo: o.campo,
      valor_editado: String(o.valor_editado),
      editado_en: String(o.editado_en),
      id: String(o.id),
      activo: Boolean(o.activo),
    }));
    const v2PorSku = mapearV2(v2Rows);

    // Descripción EFECTIVA vía `resolverClasificacion` — MISMA composición que
    // catálogo/ficha, para que El Cruce muestre exactamente la misma descr.
    // `marca`/`familia`/`resv`/`tecnologia` son irrelevantes aquí (El Cruce
    // solo usa `.descr`): placeholders inertes. Hasta B-PARCHE F3 la
    // precedencia era manual > v2 > fuente; desde D-1(a) (CAT-B1 · Tramo B)
    // es manual > fuente — `v2PorSku` (línea de arriba) es el ÚNICO
    // uso de `fetchClasificacionV2ParaSkus`, y desde D-1(a) ese uso ya no
    // cambia nada del resultado (ver el aviso "SIN CONSUMIDOR" en su
    // declaración).
    descrPorSku = new Map(
      productos.map((p) => {
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
        return [sku, resuelto.descr.valor] as [string, string | null];
      }),
    );
  }

  const hoy = hoyMexico();
  return buildCruce({ estatus, embarques, descrPorSku, snapshot, hoy });
}
