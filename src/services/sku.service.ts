// ============================================================
// Bloque 3 · API · sku.service.ts  (READS)
// GET /api/sku/[sku]: ficha de producto. Pin AUTO-CONSISTENTE al
// `snapshot_id` de la propia fila de `productos` (P_snap) para
// stock/reservas — NO al vigente('stock') global: así una ficha en
// BAJA (P_snap ≠ vigente('stock')) se sigue sirviendo, marcada con
// `snapshot.stock.vigente=false`. Embarques, en cambio, se pinnean
// SIEMPRE a `vigente('aduana')` (no hay equivalente de "P_snap" para
// aduana). 404 lo decide el route: aquí null = "no existe el SKU".
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVigentes, type SnapshotVigente } from './vigente.service';
import { embedName, embedClave, embedExcluida } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { hoyMexico } from '@/lib/fechas';
import { separarFamilias } from '@/lib/familias';
import {
  derivarSku,
  divergenciaFamilia,
  resolverClasificacion,
  overrideActivo,
  type ProductoLectura,
  type StockLectura,
  type ReservaLectura,
  type OverrideLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import type { SkuDetalle, SkuStockItem, SkuReservaItem, SkuEmbarqueItem, CampoOverride } from '@/types';

/** Fila cruda de `productos` (select con embeds many-to-one). */
export interface SkuProductoRow {
  sku: string;
  resv: number | null;
  descr_origen: string | null;
  cliente: string | null;
  /** Columna cruda `productos.class` (B-PARCHE F3). Opcional para no romper fixtures previos a F3. */
  class?: string | null;
  /**
   * [FIX-B1] `productos.tecnologia` (migración 0036) — el DEFECTO ALTO de
   * este bloque era exactamente que este `select` no la pedía y la Ficha
   * decía «Sin tecnología» para TODO SKU, aunque el archivo sí la trajera.
   * Opcional para no romper fixtures previos a este bloque (`undefined` se
   * resuelve como "no hay dato", misma convención que `class`).
   */
  tecnologia?: string | null;
  snapshot_id: string;
  marcas: unknown;
  familias: unknown;
}

/** Fila cruda de `stock_por_almacen` (ya filtrada a un sku+snapshot). */
export interface SkuStockRow {
  cantidad: number | null;
  almacenes: unknown;
}

/** Fila cruda de `reservas` (ya filtrada a un sku+snapshot). */
export interface SkuReservaRow {
  cliente: string;
  cantidad: number | null;
  motivo: string | null;
  fecha: string;
  kams: unknown;
}

/** Fila cruda de `productos_override` (ya filtrada a `sku` + `activo=true`). */
export interface SkuOverrideRow {
  id: string;
  sku: string;
  /** [FIX-B1] `CampoOverride` (`@/types/enums`) — desde este bloque también puede ser `'tecnologia'`. */
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}

/** Fila cruda de `embarques` (ya filtrada a un sku + snapshot vigente de aduana). */
export interface SkuEmbarqueRow {
  id: string;
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
  estatus_catalogo: unknown;
}

/** Fila cruda de `productos_metadata` (o null si el sku no tiene imagen/color). */
export interface SkuMetadataRow {
  imagen_url: string | null;
  color: string | null;
}

/**
 * Orden de embarques: activos primero (`is_historial` ASC) → pipeline
 * (`estatus_orden` ASC) → `eta` ASC con nulls al final. Comparación de
 * string simple sobre `eta` (formato fecha ISO `YYYY-MM-DD`, comparable
 * lexicográficamente) — mismo criterio de determinismo que O1.
 */
function compareEmbarques(a: SkuEmbarqueItem, b: SkuEmbarqueItem): number {
  if (a.is_historial !== b.is_historial) return a.is_historial ? 1 : -1;
  if (a.estatus_orden !== b.estatus_orden) return a.estatus_orden - b.estatus_orden;
  if (a.eta === b.eta) return 0;
  if (a.eta === null) return 1;
  if (b.eta === null) return -1;
  return a.eta < b.eta ? -1 : 1;
}

/** Prefijo de `clasificacion_v2.fuente_version` que marca un valor escrito por una persona al resolver un pendiente de la bandeja (migración 0011) — R2-4. */
const PREFIJO_PENDIENTE = 'pendiente:';

/**
 * `true` solo si `fuenteVersion` viene de la bandeja de pendientes (prefijo
 * `pendiente:`) Y el tipo que nombra decide la MARCA — hoy únicamente
 * `marca_ambigua` (R2-4). El string nombra el CAMPO decidido: si el
 * prefijo está pero el tipo no es de marca (p. ej. `familia_atomo_dudoso`),
 * `false` — marcar de más sería la misma media verdad que este campo
 * existe para corregir. Sin fila v2, `fuente_version` nulo o sin el
 * prefijo → `false`.
 */
function decididoEnBandejaMarca(fuenteVersion: string | null | undefined): boolean {
  if (fuenteVersion == null || !fuenteVersion.startsWith(PREFIJO_PENDIENTE)) return false;
  return fuenteVersion.slice(PREFIJO_PENDIENTE.length) === 'marca_ambigua';
}

/**
 * Input de `buildSkuDetalle`, en un objeto nombrado (no posicional):
 * evita transponer por accidente los 3 `SnapshotVigente | null`
 * (`vigenteStock`/`vigenteAduana`/`snapshotPropio`), indistinguibles
 * entre sí por tipo.
 */
export interface BuildSkuDetalleInput {
  producto: SkuProductoRow;
  stockRows: SkuStockRow[];
  reservasRows: SkuReservaRow[];
  overrides: SkuOverrideRow[];
  embarquesRows: SkuEmbarqueRow[];
  metadata: SkuMetadataRow | null;
  vigenteStock: SnapshotVigente | null;
  vigenteAduana: SnapshotVigente | null;
  snapshotPropio: SnapshotVigente | null;
  /** 'YYYY-MM-DD', inyectada por `getSkuDetalle` — esta función es 100% pura, nunca llama `new Date()`. */
  hoy: string;
  /**
   * Fila cruda de `clasificacion_v2` del sku (B-PARCHE F3), o `null` si no
   * existe. OPCIONAL (default `undefined`, equivalente a `null` para
   * `resolverClasificacion`) para no romper los tests previos a F3 que
   * construyen `BuildSkuDetalleInput` sin este campo.
   */
  v2?: ClasificacionV2Lectura | null;
}

/**
 * Construye la ficha de SKU a partir de sus filas ya resueltas. 100%
 * PURO — exportado para tests. `snapshotPropio` es la fila de
 * `snapshots` del `snapshot_id` propio de `producto` (P_snap, para
 * `snapshot.stock`); `vigenteAduana` siempre viaja como `vigente:true`
 * (no hay concepto de "P_snap" para aduana).
 */
export function buildSkuDetalle({
  producto,
  stockRows,
  reservasRows,
  overrides,
  embarquesRows,
  metadata,
  vigenteStock,
  vigenteAduana,
  snapshotPropio,
  hoy,
  v2,
}: BuildSkuDetalleInput): SkuDetalle {
  const sku = String(producto.sku);

  const productoLectura: ProductoLectura = {
    sku,
    marca: embedName(producto.marcas) ?? '',
    familia: embedName(producto.familias),
    descr_origen: producto.descr_origen ?? null,
    cliente: producto.cliente ?? null,
    resv: Number(producto.resv ?? 0),
    clase: producto.class ?? null,
    // [FIX-B1] SIN ESTA LÍNEA la ficha decía «Sin tecnología» para TODO SKU
    // (DEFECTO ALTO del bloque): el `select` ya la trae (ver `SkuProductoRow`)
    // pero se perdía justo aquí, igual que `snapshot_id` se perdía antes de
    // 2.0.1-A · D3 (ver el comentario de abajo).
    tecnologia: producto.tecnologia ?? null,
    // [2.0.1-A · D3] SIN ESTA LÍNEA la bandera de divergencia mentiría en los
    // REMANENTES: `divergenciaFamilia` no podría descartar un SKU que ya no
    // viene en el archivo vigente y lo marcaría como si la fuente lo hubiera
    // reclasificado. La columna ya viajaba en la fila cruda (`SkuProductoRow`,
    // se usa para pinnear) y se perdía justo aquí.
    snapshot_id: producto.snapshot_id ?? null,
  };

  const stockLectura: StockLectura[] = stockRows.map((s) => ({
    sku,
    almacen: embedClave(s.almacenes) ?? '',
    cantidad: Number(s.cantidad ?? 0),
  }));

  const reservasLectura: ReservaLectura[] = reservasRows.map((r) => ({
    sku,
    kam: embedName(r.kams),
    cliente: String(r.cliente),
    cantidad: Number(r.cantidad ?? 0),
    motivo: r.motivo ?? null,
    fecha: String(r.fecha),
  }));

  const overridesLectura: OverrideLectura[] = overrides.map((o) => ({
    sku: String(o.sku),
    campo: o.campo,
    valor_editado: String(o.valor_editado),
    editado_en: String(o.editado_en),
    id: String(o.id),
    activo: Boolean(o.activo),
  }));

  const derivado = derivarSku(productoLectura, stockLectura, reservasLectura, overridesLectura);
  // Resolución de clasificación (ver `resolverClasificacion`, derivaciones.ts):
  // hasta B-PARCHE F3 resolvía manual/v2/fuente — `marca`/`clase` caían a
  // v2??fuente y `tecnologia` era SIEMPRE v2 (sin capa fuente). Desde D-1(a)
  // (CAT-B1 · Tramo B) `clasificacion_v2` está CONGELADA: `familia`/
  // `descripcion` resuelven manual > fuente (el PORTAL gana), `marca`/`clase`/
  // `producto` resuelven SIEMPRE fuente, y [FIX-B1] `tecnologia` resuelve
  // fuente > manual (`productos.tecnologia`, migración 0036, ?? el override
  // capturado en el portal) — la ÚNICA capa donde EL EXCEL gana, ver
  // `capaFuenteManual` en `derivaciones.ts`.
  const v2Fila = v2 ?? null;
  const resuelto = resolverClasificacion(productoLectura, overridesLectura, v2Fila);
  // [FIX-B1] El valor CAPTURADO en el portal, independiente de si está en
  // efecto — para la nota «lo capturado en el portal (X) ya no aplica: manda
  // el Excel» cuando el archivo empieza a traer dato después de una captura
  // manual previa (ver `SkuDetalle.tecnologia_portal`, types/api.ts).
  const tecnologiaPortal = overrideActivo(overridesLectura, sku, 'tecnologia')?.valor_editado ?? null;

  const stockItems: SkuStockItem[] = stockLectura.map((s) => ({ almacen: s.almacen, cantidad: s.cantidad }));
  const reservaItems: SkuReservaItem[] = reservasLectura.map((r) => ({
    kam: r.kam,
    cliente: r.cliente,
    cantidad: r.cantidad,
    motivo: r.motivo,
    fecha: r.fecha,
  }));

  const embarqueItems: SkuEmbarqueItem[] = embarquesRows
    .map((e) => {
      const eta = e.eta ?? null;
      const fecha_llegada = e.fecha_llegada ?? null;
      return {
        id: String(e.id),
        oc_po: e.oc_po ?? null,
        proveedor: e.proveedor ?? null,
        referencia: e.referencia ?? null,
        factura: e.factura ?? null,
        pais_origen: e.pais_origen ?? null,
        piezas: e.piezas ?? null,
        fw: e.fw ?? null,
        tipo_importacion: e.tipo_importacion ?? null,
        fecha_recoleccion: e.fecha_recoleccion ?? null,
        etd: e.etd ?? null,
        eta,
        fecha_llegada,
        fecha_disponibilidad: e.fecha_disponibilidad ?? null,
        estatus: embedName(e.estatus_catalogo) ?? '',
        estatus_orden: Number(e.estatus_id),
        proyecto: e.proyecto ?? null,
        observaciones: e.observaciones ?? null,
        is_historial: Boolean(e.is_historial),
        retrasado: eta !== null && fecha_llegada === null && eta < hoy,
      };
    })
    .sort(compareEmbarques);

  // piezas_en_camino / piezas_historial: Σ piezas (null→0), separadas por
  // is_historial — reusan `embarqueItems` (ya normalizado), no las filas crudas.
  const piezas_en_camino = embarqueItems
    .filter((e) => !e.is_historial)
    .reduce((sum, e) => sum + (e.piezas ?? 0), 0);
  const piezas_historial = embarqueItems
    .filter((e) => e.is_historial)
    .reduce((sum, e) => sum + (e.piezas ?? 0), 0);

  return {
    sku,
    marca: resuelto.marca.valor ?? '',
    // [VERT-B2] Del EMBED de la fila cruda, no de `resuelto.marca`: la regla
    // está anclada a `marca_id` (la 0039 lo decidió así porque «BRAND 6» y
    // «BRAND6» son dos filas distintas de `marcas`), y `resuelto.marca` es un
    // NOMBRE. Preguntarle al nombre habría devuelto por la puerta de atrás la
    // fragilidad que la migración vino a quitar.
    marca_excluida: embedExcluida(producto.marcas),
    familia_efectiva: resuelto.familia.valor,
    // (INV-TAXO F3) multi-valor — ver src/lib/familias.ts. Invariante
    // testeada: familias_efectivas === separarFamilias(familia_efectiva).
    familias_efectivas: separarFamilias(resuelto.familia.valor),
    // [2.0.1-A · D3] Contra el vigente GLOBAL, no contra `snapshotPropio`:
    // comparar la fila consigo misma daría `null` siempre y la bandera nunca
    // se encendería — sería el ejemplar 12 de P25, el resultado correcto por
    // la razón equivocada.
    divergencia_familia: divergenciaFamilia(productoLectura, overridesLectura, v2Fila, vigenteStock?.id ?? null).clase,
    descr_efectiva: resuelto.descr.valor,
    original: { familia: productoLectura.familia, descr: productoLectura.descr_origen },
    stock: stockItems,
    total: derivado.total,
    reservado: derivado.reservado,
    disponible: derivado.disponible,
    sobre_reservado: derivado.sobre_reservado,
    reserva_descuadre: derivado.reserva_descuadre,
    reservas: reservaItems,
    embarques: embarqueItems,
    piezas_en_camino,
    piezas_historial,
    imagen_url: metadata?.imagen_url ?? null,
    color: metadata?.color ?? null,
    clase: resuelto.clase.valor,
    tecnologia: resuelto.tecnologia.valor,
    tecnologia_portal: tecnologiaPortal,
    // Los 4 primeros SIEMPRE tienen capa 'fuente' de respaldo (nunca `null` en la
    // práctica — ver `resolverClasificacion`); el `?? 'fuente'` solo satisface el
    // tipo estricto del DTO (`OrigenClasificacion`, no nullable para estos 4).
    origenes: {
      descr: resuelto.descr.origen ?? 'fuente',
      familia: resuelto.familia.origen ?? 'fuente',
      marca: resuelto.marca.origen ?? 'fuente',
      clase: resuelto.clase.origen ?? 'fuente',
      tecnologia: resuelto.tecnologia.origen,
    },
    // Valores CRUDOS de `clasificacion_v2` (sin resolver contra overrides): la UI
    // los usa para mostrar "la capa inmediata bajo un override manual" activo.
    v2: v2Fila
      ? {
          descr: v2Fila.descr_v2,
          familia: v2Fila.familia_v2,
          marca: v2Fila.marca_v2,
          clase: v2Fila.clase_v2,
          tecnologia: v2Fila.tecnologia,
        }
      : null,
    // (R2-4) hoy siempre `false` en las filas vigentes: la migración
    // 0011 (que empieza a escribir `fuente_version = 'pendiente:<tipo>'`
    // al resolver un pendiente) aún no se aplica — ver `decididoEnBandejaMarca`.
    decidido_en_bandeja: { marca: decididoEnBandejaMarca(v2Fila?.fuente_version) },
    snapshot: {
      stock: snapshotPropio
        ? {
            id: snapshotPropio.id,
            created_at: snapshotPropio.created_at,
            filas: snapshotPropio.filas,
            archivo: snapshotPropio.archivo,
            vigente: snapshotPropio.id === vigenteStock?.id,
          }
        : null,
      aduana: vigenteAduana
        ? {
            id: vigenteAduana.id,
            created_at: vigenteAduana.created_at,
            filas: vigenteAduana.filas,
            archivo: vigenteAduana.archivo,
            vigente: true,
          }
        : null,
    },
  };
}

/**
 * `clasificacion_v2` puede no existir aún en la DB (0008 pendiente de
 * aplicar — B-PARCHE F2 corre en paralelo). `esNoDisponiblePorMigracion`
 * vive en `@/lib/supabase/pg-errors`, compartida con
 * inventory/cruce/clasificacion.service.ts y con `esForbidden` (42501,
 * `override.service.ts`).
 */

/**
 * Fila v2 (B-PARCHE F3) del sku, o `null` si no existe fila o la tabla aún
 * no existe (tolerado vía `esNoDisponiblePorMigracion`). Incluye
 * `fuente_version` (R2-4, ver `decididoEnBandejaMarca`) — el único fetch de
 * `clasificacion_v2` que la pide: `inventory.service.ts`/`dashboard.service.ts`
 * no la necesitan.
 */
async function fetchClasificacionV2(db: SupabaseClient, sku: string): Promise<ClasificacionV2Lectura | null> {
  const { data, error } = await db
    .from('clasificacion_v2')
    .select('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2,fuente_version')
    .eq('sku', sku)
    .maybeSingle();
  if (error) {
    if (esNoDisponiblePorMigracion(error)) return null;
    throw new Error('clasificacion_v2: ' + error.message);
  }
  return (data ?? null) as ClasificacionV2Lectura | null;
}

/** Ficha de SKU (O2). `null` = el sku no existe en `productos` (404 lo decide el route). */
export async function getSkuDetalle(db: SupabaseClient, skuParam: string): Promise<SkuDetalle | null> {
  const { data: productoRow, error: prodErr } = await db
    .from('productos')
    .select('sku,resv,descr_origen,cliente,class,tecnologia,snapshot_id, marcas(nombre,excluida_del_catalogo), familias(nombre)')
    .eq('sku', skuParam)
    .maybeSingle();
  if (prodErr) throw new Error('productos: ' + prodErr.message);
  if (!productoRow) return null;

  const pSnap = String((productoRow as SkuProductoRow).snapshot_id);

  const [stockRes, reservasRes, overridesRes, metadataRes, vigentes, snapshotRes, v2Row] = await Promise.all([
    db.from('stock_por_almacen').select('cantidad, almacenes(clave)').eq('sku', skuParam).eq('snapshot_id', pSnap),
    db
      .from('reservas')
      .select('cliente,cantidad,motivo,fecha, kams(nombre)')
      .eq('sku', skuParam)
      .eq('snapshot_id', pSnap),
    db
      .from('productos_override')
      .select('id,sku,campo,valor_editado,editado_en,activo')
      .eq('sku', skuParam)
      .eq('activo', true),
    db.from('productos_metadata').select('imagen_url,color').eq('sku', skuParam).maybeSingle(),
    resolveVigentes(db),
    db.from('snapshots').select('id,created_at,filas,archivo').eq('id', pSnap).maybeSingle(),
    fetchClasificacionV2(db, skuParam),
  ]);

  if (stockRes.error) throw new Error('stock_por_almacen: ' + stockRes.error.message);
  if (reservasRes.error) throw new Error('reservas: ' + reservasRes.error.message);
  if (overridesRes.error) throw new Error('productos_override: ' + overridesRes.error.message);
  if (metadataRes.error) throw new Error('productos_metadata: ' + metadataRes.error.message);
  if (snapshotRes.error) throw new Error('snapshots: ' + snapshotRes.error.message);

  const vigenteAduana = vigentes.aduana;

  let embarquesRows: SkuEmbarqueRow[] = [];
  if (vigenteAduana) {
    const { data, error } = await db
      .from('embarques')
      .select(
        'id,oc_po,proveedor,referencia,factura,pais_origen,piezas,fw,tipo_importacion,fecha_recoleccion,etd,eta,fecha_llegada,fecha_disponibilidad,estatus_id,proyecto,observaciones,is_historial, estatus_catalogo(nombre)',
      )
      .eq('sku', skuParam)
      .eq('snapshot_id', vigenteAduana.id);
    if (error) throw new Error('embarques: ' + error.message);
    embarquesRows = (data ?? []) as SkuEmbarqueRow[];
  }

  const hoy = hoyMexico();

  return buildSkuDetalle({
    producto: productoRow as SkuProductoRow,
    stockRows: (stockRes.data ?? []) as SkuStockRow[],
    reservasRows: (reservasRes.data ?? []) as SkuReservaRow[],
    overrides: (overridesRes.data ?? []) as SkuOverrideRow[],
    embarquesRows,
    metadata: (metadataRes.data ?? null) as SkuMetadataRow | null,
    vigenteStock: vigentes.stock,
    vigenteAduana,
    snapshotPropio: (snapshotRes.data ?? null) as SnapshotVigente | null,
    hoy,
    v2: v2Row,
  });
}
