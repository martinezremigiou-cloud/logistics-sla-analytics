// ============================================================
// B-PARCHE · F2 · API · clasificacion.service.ts  (READ + WRITE admin)
// POST /api/clasificacion: carga el estado vivo (`productos`, catálogos
// de `familias`/`marcas`/`marca_alias`), arma `ParcheContexto` y delega
// TODO el cálculo al builder PURO (`clasificacion.build.ts`, F2). En
// `dryRun`, regresa solo el reporte (sin invocar la RPC de escritura);
// fuera de `dryRun`, invoca `aplicar_clasificacion_v2` (0008) con las
// filas y catálogos nuevos descubiertos por el builder.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { embedName } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { normalizeSku, normalizeMarcaNombre, normalizeAliasKey } from '@/services/etl/normalize';
import {
  buildClasificacionV2,
  type ParcheContexto,
  type FuenteActualProducto,
  type ReporteParche,
} from '@/services/parche/clasificacion.build';
import type { ClasificacionBody } from '@/schemas/clasificacion.schema';

// ------------------------------------------------------------
// Filas crudas de las consultas de contexto
// ------------------------------------------------------------

interface ProductoContextoRow {
  sku: string;
  class: string | null;
  descr_origen: string | null;
  marcas: unknown;
  familias: unknown;
}

interface CatalogoNombreRow {
  nombre: string;
}

interface MarcaAliasRow {
  alias: string;
  marcas: unknown;
}

/**
 * `tecnologias` (0008) puede no existir aún en la DB real (RPC/tablas de
 * B-PARCHE F1 pendientes de aplicar a mano — ver cabecera del
 * proyecto). `esNoDisponiblePorMigracion` vive en `@/lib/supabase/pg-errors`
 * — único punto compartido con inventory/sku/cruce.service.ts (antes cada
 * uno tenía su propia copia).
 */

/**
 * Prueba de disponibilidad de `tecnologias`. En `dryRun`, un error de
 * "no disponible por migración" se tolera silenciosamente (permite
 * previsualizar el reporte ANTES de que se aplique 0008). Fuera de
 * `dryRun` cualquier error —incluido ese— se deja propagar: la escritura
 * real fallaría de todas formas en la RPC `aplicar_clasificacion_v2` si
 * 0008 no existe, así que no vale la pena enmascararlo aquí. NOTA:
 * `clasificacion.build.ts` (F2) no recibe un catálogo de tecnologías
 * vivas en su contrato (TODA tecnología con valor emitido se trata como
 * catálogo nuevo) — esta prueba es solo de disponibilidad, su resultado
 * no se mezcla en `ParcheContexto`.
 */
async function verificarTecnologiasDisponibles(db: SupabaseClient, dryRun: boolean): Promise<void> {
  const { error } = await db.from('tecnologias').select('nombre').limit(1);
  if (error && !(dryRun && esNoDisponiblePorMigracion(error))) {
    throw new Error('tecnologias: ' + error.message);
  }
}

async function cargarContexto(db: SupabaseClient, dryRun: boolean): Promise<ParcheContexto> {
  // `verificarTecnologiasDisponibles` se plegó al MISMO `Promise.all` que
  // las 4 fetches de contexto (antes corría serial, DESPUÉS de esperarlas
  // todas): su resultado (`void`) no se usa — solo lanza si aplica — así
  // que no hay motivo para pagar su latencia en serie; corre en paralelo
  // y `Promise.all` propaga el primer rechazo igual que antes.
  const [productos, familias, marcas, marcaAlias] = await Promise.all([
    fetchAllRows<ProductoContextoRow>((from, to) =>
      db.from('productos').select('sku,class,descr_origen,marcas(nombre),familias(nombre)').range(from, to),
    ),
    fetchAllRows<CatalogoNombreRow>((from, to) => db.from('familias').select('nombre').range(from, to)),
    fetchAllRows<CatalogoNombreRow>((from, to) => db.from('marcas').select('nombre').range(from, to)),
    fetchAllRows<MarcaAliasRow>((from, to) => db.from('marca_alias').select('alias,marcas(nombre)').range(from, to)),
    verificarTecnologiasDisponibles(db, dryRun),
  ]);

  const existingSkus = new Set<string>();
  const fuenteActual = new Map<string, FuenteActualProducto>();
  for (const p of productos) {
    const sku = normalizeSku(p.sku);
    if (sku === null) continue;
    existingSkus.add(sku);
    fuenteActual.set(sku, {
      marca: embedName(p.marcas),
      familia: embedName(p.familias),
      clase: p.class,
      descr: p.descr_origen,
    });
  }

  const familiasVivas = new Set<string>();
  for (const f of familias) {
    const canon = normalizeMarcaNombre(f.nombre);
    if (canon !== null) familiasVivas.add(canon);
  }

  const marcasVivas = new Set<string>();
  for (const m of marcas) {
    const canon = normalizeMarcaNombre(m.nombre);
    if (canon !== null) marcasVivas.add(canon);
  }

  const aliasVivos = new Map<string, string>();
  for (const a of marcaAlias) {
    const marcaNombre = embedName(a.marcas);
    if (marcaNombre === null) continue;
    aliasVivos.set(normalizeAliasKey(a.alias), marcaNombre);
  }

  return { existingSkus, fuenteActual, familiasVivas, marcasVivas, aliasVivos };
}

// ------------------------------------------------------------
// Resultado de la RPC `aplicar_clasificacion_v2` (0008)
// ------------------------------------------------------------

export interface RpcAplicarClasificacionResultado {
  escritas: number;
  version: string;
  actor: string;
}

export type AplicarClasificacionResult =
  | { reporte: ReporteParche; dryRun: true }
  | { reporte: ReporteParche; rpc: RpcAplicarClasificacionResultado };

/**
 * Orquesta el cálculo (builder puro) + la escritura (RPC atómica). En
 * `dryRun`, calcula y regresa el reporte sin tocar la BD.
 */
export async function aplicarClasificacion(
  db: SupabaseClient,
  payload: ClasificacionBody,
): Promise<AplicarClasificacionResult> {
  const contexto = await cargarContexto(db, payload.dryRun);

  const { filas, catalogosNuevos, reporte } = buildClasificacionV2(
    { inventario: payload.hojas.inventario, west: payload.hojas.west },
    contexto,
  );

  if (payload.dryRun) {
    return { reporte, dryRun: true };
  }

  const { data, error } = await db.rpc('aplicar_clasificacion_v2', {
    payload: {
      fuente_version: payload.fuente_version,
      filas,
      tecnologiasNuevas: catalogosNuevos.tecnologiasNuevas,
      familiasNuevas: catalogosNuevos.familiasNuevas,
      marcasNuevas: catalogosNuevos.marcasNuevas,
      marcaAliasNuevos: catalogosNuevos.marcaAliasNuevos,
    },
  });
  if (error) {
    throw new Error('aplicar_clasificacion_v2: ' + error.message);
  }

  return { reporte, rpc: data as RpcAplicarClasificacionResultado };
}
