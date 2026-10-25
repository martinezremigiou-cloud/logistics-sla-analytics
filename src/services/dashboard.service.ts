// ============================================================
// Bloque 6 · F1 · API · dashboard.service.ts  (READS)
// GET /api/dashboard: KPIs, heatmap marca×almacén (INV-TAXO F4, antes
// familia×almacén — ver más abajo), radar por marca, rankings, pipeline
// de aduana resumido, tendencia y alertas-enlace de la página `/`.
// Núcleo PURO `buildDashboard(input)` (testeable sin red) + orquestador
// `getDashboard(db, query)` que hace los fetches con el session client
// — mismo patrón que `inventory.service.ts`/`cruce.service.ts`.
//
// Semánticas EXACTAS ratificadas por STOP&ASK (2026-07-21):
//   - catalogo_total = count(productos del snapshot 'stock' vigente).
//   - piezas_disponibles/skus_disponibles/sobre_reservados: disponible
//     por SKU = Σ su stock − su resv, vía `derivarSku` (derivaciones.ts,
//     MISMA aritmética que O1/O2 — reservado = productos.resv, NUNCA
//     Σreservas).
//   - piezas_en_camino/retrasados: SIEMPRE sobre embarques ACTIVOS
//     (is_historial=false) del snapshot 'aduana' vigente; retrasado =
//     eta !== null && fecha_llegada === null && eta < hoyMexico().
//   - sin_v2 = productos vigentes SIN fila en `clasificacion_v2`
//     (independiente de si esa fila tiene campos poblados).
//   - sin_tecnologia (INV-B7B · O4, CONGELADO desde CAT-ITER-1 · O-2b) =
//     `pendientesSinTecnologia` — los `pendientes_datos` tipo
//     `sku_sin_tecnologia` ABIERTOS de la bandeja (RPC `contar_pendientes()`,
//     eje 1 de permiso: sólo `admin` ve un valor real,
//     `MUESTRA_PREGUNTAS_POR_RESOLVER` en `lib/roles.ts`). YA NO recorre
//     `clasificacion_v2` ni `productos.tecnologia` — cuenta TRABAJO POR
//     HACER, no productos sin tecnología efectiva (el porqué del cambio,
//     con los tres universos medidos, está junto a `sinTecnologia` dentro
//     de `buildDashboard`, no aquí, para no repetirlo y divergir).
//   - productos_sin_tecnologia (FIX-B1 · item 7) = SKUs VISIBLES del
//     vigente con tecnología EFECTIVA `null`, vía `contarSinTecnologia`
//     (`derivaciones.ts`) — LA MISMA función que `CatalogoFacetas.
//     sin_tecnologia` (`inventory.service.ts`), así que catálogo y
//     tablero SIEMPRE coinciden. Universo DISTINTO de `sin_tecnologia`
//     (arriba): éste cuenta PRODUCTOS, no pendientes abiertos.
//   - pendientes = RPC `contar_pendientes()` (0009); si la RPC aún no
//     existe (0009 sin aplicar — PostgREST responde PGRST202, ver
//     `esNoDisponiblePorMigracion`), degrada a 0 con un warn silencioso
//     — NUNCA lanza por esto (ver `fetchPendientesAbiertos`).
//   - alerta `descuadre_reservas` = productos vigentes con
//     `resv !== Σ reservas.cantidad` (mismo snapshot), vía
//     `descuadresDe` (derivaciones.ts) — MISMA función que
//     `pendientes.service.ts` usa para su bloque DERIVADO (una sola
//     fuente, ver `fetchDescuadresVigentes` más abajo).
//   - marca/descr EFECTIVAS del heatmap/radar/rankings SIEMPRE vía
//     `resolverClasificacion` (v2>fuente) — NUNCA la `descr_efectiva` de 2
//     capas que trae `derivarSku` (esa ignora v2; `SkuVista`, más abajo,
//     ya ni siquiera tiene `familia` — se descarta aquí a propósito,
//     mismo criterio que `inventory.service.ts`/`cruce.service.ts`).
//
// INV-TAXO F4 — heatmap marca × almacén (antes familia × almacén; motivo,
// cifras, GATE y detector documentados en `docs/engineering/failure-patterns.md`, P8).
// Regla: `familia` es multi-valor y JAMÁS entra a una agregación de
// cantidad — se agrupa por `marca` (valor único); `separarFamilias` NUNCA
// se invoca en este archivo (ver GATE en `heatmapPiezasUniverso`, abajo).
//
// ASIMETRÍA DELIBERADA: `?tecnologia` filtra SOLO el heatmap (marcas
// candidatas a top-10 + sus celdas). KPIs, radar, rankings, pipeline,
// tendencia y alertas siguen SIEMPRE globales (sobre el universo
// COMPLETO) — filtrarlos en silencio por la tecnología activa daría el
// mismo número con otro significado (p.ej. "piezas disponibles" dejaría
// de ser el total real del catálogo). `DashboardHeatmap.tecnologias`
// (el selector) también es SIEMPRE global — sobre el universo completo,
// SIN aplicar el propio filtro — para que el usuario nunca se quede sin
// poder cambiar de tecnología (mismo espíritu que la regla anti-trampa
// de `CatalogoFacetas`, aunque aquí no hace falta "inyectar" nada: al
// no filtrarse a sí mismo, la lista nunca se vacía).
//
// DELTAS — política "solo honestos" (STOP&ASK): `productos` es upsert
// latest-wins (0005), así que el catálogo/resv de un periodo anterior
// YA NO EXISTE en BD tras una re-ingesta — comparar "hoy vs. antes"
// para catalogo_total/piezas_disponibles/etc. sería, en el mejor caso,
// una comparación contra datos parciales, y en el peor una mentira.
// ÚNICO delta real en v1: `kpis.piezas_en_camino`, porque `embarques`
// es INSERT-only inmutable (cada snapshot de aduana conserva sus
// filas para siempre) — el baseline honesto existe de verdad. TODOS
// los demás KPIs viajan `delta: null`.
//
// "vigente por periodo": `vigentePorPeriodo`/`periodosOrdenados` (PUROS,
// exportados) agrupan snapshots de UNA fuente por `periodo` y resuelven,
// DENTRO de cada grupo, el vigente = max(created_at, id) — mismo
// criterio que `resolveVigente` (vigente.service.ts) pero aplicado por
// periodo. Usado para `tendencia` (Σ stock del vigente de cada periodo,
// fuente 'stock') y para el baseline de `piezas_en_camino` (vigente de
// aduana del periodo anterior DISTINTO). Los snapshots recientes de
// julio son TODOS periodo='2026-07': sin este agrupamiento, "el
// snapshot anterior" compararía julio-contra-julio en vez de abril.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { embedName, embedClave, embedExcluida } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { hoyMexico } from '@/lib/fechas';
import { mapearV2, SIN_TECNOLOGIA } from '@/lib/clasificacion';
import { cmpStr } from '@/lib/orden';
import { conVigenteStock, resolveVigente, type SnapshotVigente, type FuenteSnapshot } from './vigente.service';
import {
  derivarSku,
  divergenciaFamilia,
  resolverClasificacion,
  agruparReservasPorSku,
  descuadresDe,
  esRetrasado,
  contarSinTecnologia,
  type ProductoLectura,
  type StockLectura,
  type ReservaLectura,
  type OverrideLectura,
  type ClasificacionV2Lectura,
  type Descuadre,
} from './derivaciones';
import type {
  DashboardResponse,
  DashboardKpis,
  DashboardHeatmap,
  HeatmapCelda,
  DashboardRadar,
  RankingItem,
  DashboardReservasKam,
  ReservaKamItem,
  DashboardPipelineEtapa,
  DashboardPipelineGrupo,
  FormaGrupoPipeline,
  TendenciaPunto,
  Alerta,
  Kpi,
  KpiDelta,
} from '@/types/api';
import { ALMACENES, type CampoOverride } from '@/types/enums';
import type { DashboardQuery } from '@/schemas/dashboard.schema';

// ------------------------------------------------------------
// vigentePorPeriodo / periodosOrdenados (PUROS)
// ------------------------------------------------------------

/** Fila cruda de `snapshots`, ya filtrada a UNA fuente (columnas mínimas para agrupar por periodo). */
export interface SnapshotPeriodoRow {
  id: string;
  created_at: string;
  periodo: string;
  filas: number | null;
  archivo: string | null;
}

/**
 * Agrupa snapshots de una fuente por `periodo` y resuelve, dentro de
 * cada grupo, el vigente = max(created_at, id) (mismo tie-break que
 * `resolveVigente`). PURO. Ver comentario de cabecera del archivo.
 */
export function vigentePorPeriodo(snapshots: SnapshotPeriodoRow[]): Map<string, SnapshotPeriodoRow> {
  const porPeriodo = new Map<string, SnapshotPeriodoRow>();
  for (const s of snapshots) {
    const actual = porPeriodo.get(s.periodo);
    if (!actual || s.created_at > actual.created_at || (s.created_at === actual.created_at && s.id > actual.id)) {
      porPeriodo.set(s.periodo, s);
    }
  }
  return porPeriodo;
}

/**
 * Cuántos snapshots colapsó cada periodo — el tamaño de grupo que
 * `vigentePorPeriodo` calcula implícitamente y descarta. PURO.
 *
 * [DASH-D · D-2] Existe porque un punto de la tendencia que resume UN corte y
 * otro que resume MUCHOS se dibujan idénticos, y esa diferencia es la confianza
 * del punto: la cadencia de la ingesta es en racimos (ver `docs/ingestion.md`), así que
 * un mes puede traer muchos cortes y el siguiente uno solo. Sin este conteo la
 * superficie no puede distinguir «un mes bien muestreado» de «un mes con una
 * sola foto», que es la misma clase de confusión que **cero vs no-medido**.
 */
export function cortesPorPeriodo(snapshots: SnapshotPeriodoRow[]): Map<string, number> {
  const cortes = new Map<string, number>();
  for (const s of snapshots) cortes.set(s.periodo, (cortes.get(s.periodo) ?? 0) + 1);
  return cortes;
}

/** Periodos distintos, orden ASC (comparación de string simple: `'YYYY-MM'` ordena cronológicamente). */
export function periodosOrdenados(porPeriodo: Map<string, SnapshotPeriodoRow>): string[] {
  return Array.from(porPeriodo.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ------------------------------------------------------------
// Núcleo PURO — buildDashboard
// ------------------------------------------------------------

/** Fila de embarque ACTIVO ya normalizada (is_historial=false, del snapshot 'aduana' vigente). */
export interface EmbarqueActivoLectura {
  sku: string;
  piezas: number | null;
  eta: string | null;
  fecha_llegada: string | null;
  estatus_id: number;
}

/** Fila de `estatus_catalogo` (las 11 etapas del pipeline de aduana). */
export interface DashboardEstatusRow {
  orden: number;
  nombre: string;
}

/**
 * Input de `buildDashboard`, en un objeto nombrado. Todas las filas ya
 * vienen "planas" (mismo criterio que `buildCatalogPage`/`buildCruce`):
 * el orquestador (`getDashboard`) hace los fetches y la normalización
 * mínima (embeds→string); el agrupamiento por sku ocurre AQUÍ.
 */
export interface BuildDashboardInput {
  /** `'YYYY-MM-DD'`, inyectada por `getDashboard` — esta función es 100% pura, nunca llama `new Date()`. */
  hoy: string;
  vigenteStockSnap: SnapshotVigente | null;
  vigenteAduanaSnap: SnapshotVigente | null;
  /** Productos del snapshot 'stock' vigente (TODOS, sin paginar/filtrar). */
  productos: ProductoLectura[];
  stock: StockLectura[];
  reservas: ReservaLectura[];
  overrides: OverrideLectura[];
  v2: ClasificacionV2Lectura[];
  /** Embarques ACTIVOS (is_historial=false) del snapshot 'aduana' vigente. */
  embarquesActivos: EmbarqueActivoLectura[];
  /** Las 11 etapas del pipeline (`estatus_catalogo`), en cualquier orden — `buildDashboard` reordena. */
  estatus: DashboardEstatusRow[];
  periodos: { actual: string | null; anterior: string | null };
  /** Σ stock por periodo, YA resuelto vía `vigentePorPeriodo` + agregado — ver `getDashboard`. */
  tendencia: TendenciaPunto[];
  /** Σ piezas activas del snapshot 'aduana' del periodo anterior DISTINTO; `null` = sin baseline honesto (delta queda null). */
  piezasEnCaminoBase: number | null;
  pendientesAbiertos: number;
  /**
   * [CAT-ITER-1 · O-2b] `pendientes_datos` ABIERTOS de tipo `sku_sin_tecnologia`.
   * Es el universo acordado para el KPI de «sin tecnología asignada».
   * Opcional para no romper los fixtures anteriores a esa decisión.
   */
  pendientesSinTecnologia?: number;
  /**
   * (INV-TAXO F4) Valor de `?tecnologia` (query de `GET /api/dashboard`),
   * verbatim — incluido el sentinel `SIN_TECNOLOGIA`; `null` = sin
   * filtro. Afecta SOLO al heatmap (ver la asimetría documentada en la
   * cabecera del archivo) — KPIs/radar/rankings/pipeline/tendencia/
   * alertas SIEMPRE se calculan sobre el universo completo, ignorando
   * este campo.
   */
  tecnologia: string | null;
}

/**
 * Vista por-sku ya resuelta (derivaciones + clasificación), compartida
 * por heatmap/radar/rankings. SIN `familia` (INV-TAXO F4: tras el
 * cambio de heatmap a marca×almacén nadie la consume — dejarla viva
 * sería una invitación a volver a sumar por familia, ver cabecera del
 * archivo).
 *
 * [FIX-B1 · revisión] `tecnologia` SIEMPRE vía `resolverClasificacion`,
 * pero YA NO es "única capa: v2, sin fuente cruda" — esa frase describía
 * el resto de los campos (D-1(a): v2 CONGELADA, JAMÁS se consulta, ver
 * `derivaciones.ts`). `tecnologia` es la ÚNICA capa con el orden
 * INVERTIDO (`capaFuenteManual`): `productos.tecnologia` (fuente cruda
 * del Excel) GANA en cuanto trae un valor, y la captura del portal sólo
 * llena el hueco cuando el Excel calla — v2 tampoco entra aquí, nunca
 * entró desde D-1(a). Usada SOLO por el heatmap para el filtro
 * `?tecnologia` (ver `buildHeatmap`).
 */
interface SkuVista {
  sku: string;
  marca: string;
  tecnologia: string | null;
  descr: string | null;
  total: number;
  reservado: number;
  disponible: number;
  /**
   * [2.0.1-A · D3] Un BOOLEANO de estado, no la familia: reintroducir familia
   * aqui reabriria la explosion multi-valor que la cabecera de este archivo
   * declara cerrada (un SKU con 13 familias contaria 13 veces). Cuenta SKUs.
   */
  divergenciaFamilia: 'v2' | 'manual' | null;
}

function buildVistas(
  productos: ProductoLectura[],
  stockBySku: Map<string, StockLectura[]>,
  reservasBySku: Map<string, ReservaLectura[]>,
  overrides: OverrideLectura[],
  v2PorSku: Map<string, ClasificacionV2Lectura>,
): SkuVista[] {
  return productos.map((p) => {
    const stockRows = stockBySku.get(p.sku) ?? [];
    const reservasRows = reservasBySku.get(p.sku) ?? [];
    // `derivado` aporta total/reservado/disponible (aritmética compartida con O1/O2);
    // su familia_efectiva/descr_efectiva se DESCARTA a propósito a favor de
    // `resolverClasificacion`, igual que inventory/cruce.service.ts — hasta
    // B-PARCHE F3 esa función tenía 3 capas (manual/v2/fuente); desde D-1(a)
    // (CAT-B1 · Tramo B) la v2 está CONGELADA y la precedencia es
    // manual > fuente, sin capa intermedia.
    // [FIX-B1] EXCEPCIÓN, en un campo que esta vista SÍ consume:
    // `tecnologia` (heatmap, `tecnologiasGlobal` y `contarSinTecnologia`) va
    // al revés — gana el Excel (`productos.tecnologia`) en cuanto trae texto,
    // y la captura del portal sólo llena el hueco. Ver `capaFuenteManual` en
    // derivaciones.ts.
    const derivado = derivarSku(p, stockRows, reservasRows, overrides);
    const resuelto = resolverClasificacion(p, overrides, v2PorSku.get(p.sku) ?? null);
    return {
      sku: p.sku,
      marca: resuelto.marca.valor ?? '',
      tecnologia: resuelto.tecnologia.valor,
      descr: resuelto.descr.valor,
      total: derivado.total,
      reservado: derivado.reservado,
      disponible: derivado.disponible,
      // Se calcula en el MISMO recorrido que ya resuelve las capas: dos
      // recorridos sobre el mismo concepto divergen (P2).
      divergenciaFamilia: divergenciaFamilia(p, overrides, v2PorSku.get(p.sku) ?? null, null).clase,
    };
  });
}

/** Comparación de string simple con `null` tratado como `''` (mismo criterio de determinismo del resto de B3+). */
function cmpNullable(a: string | null, b: string | null): number {
  const av = a ?? '';
  const bv = b ?? '';
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * Σ piezas por (marca, almacén) del universo de `vistas` recibido —
 * SIN ningún recorte top-N (esa es tarea de `buildHeatmap`, que la
 * llama). `marca` es de valor ÚNICO (a diferencia de `familia`,
 * multi-valor, ver `src/lib/familias.ts`): agrupar por ella NUNCA
 * multiplica el stock de un SKU, así que Σ de TODOS los buckets que
 * devuelve esta función es SIEMPRE exactamente Σ `cantidad` (>0) de las
 * filas de `stockBySku` de esos SKUs — invariante verificado por el
 * test del GATE (`dashboard.service.test.ts`) vía `heatmapPiezasUniverso`.
 *
 * Un SKU con marca resuelta `''` (dato sucio en `productos.marcas`/
 * `clasificacion_v2.marca_v2`) SÍ entra, bajo la fila `''` — NUNCA se
 * descarta en silencio: perderlo rompería la conservación de piezas del
 * GATE y escondería un problema de datos real bajo una fila que
 * simplemente falta (patrón P4 · silencio ante el fallo, ver
 * `docs/engineering/failure-patterns.md`). Una fila `''` en el heatmap ES la
 * alarma — visible en vez de invisible.
 */
function agregarPorMarcaAlmacen(
  vistas: SkuVista[],
  stockBySku: Map<string, StockLectura[]>,
): Map<string, Map<string, number>> {
  const porMarcaAlmacen = new Map<string, Map<string, number>>();
  for (const v of vistas) {
    const rows = stockBySku.get(v.sku) ?? [];
    for (const r of rows) {
      if (r.cantidad <= 0) continue;
      const porAlmacen = porMarcaAlmacen.get(v.marca) ?? new Map<string, number>();
      porAlmacen.set(r.almacen, (porAlmacen.get(r.almacen) ?? 0) + r.cantidad);
      porMarcaAlmacen.set(v.marca, porAlmacen);
    }
  }
  return porMarcaAlmacen;
}

/** `true` si `v` pertenece a `tecnologia` — mismo criterio que `?tecnologia=` de `inventory.service.ts` (`SIN_TECNOLOGIA` = tecnología efectiva `null`). */
function perteneceATecnologia(v: SkuVista, tecnologia: string): boolean {
  return tecnologia === SIN_TECNOLOGIA
    ? v.tecnologia === null
    : (v.tecnologia ?? '').toLowerCase() === tecnologia.toLowerCase();
}

/**
 * Heatmap marca×almacén (INV-TAXO F4 — ver GATE y asimetría de
 * `?tecnologia` documentados en la cabecera del archivo). `filas` =
 * hasta 10 marcas EFECTIVAS con mayor Σ piezas de stock, DENTRO del
 * universo ya acotado por `tecnologia` (si viene, mismo criterio que
 * `?tecnologia=` de O1); `columnas` = SIEMPRE las 6 claves de almacén.
 * `celdas` es SPARSE: solo se emiten pares (marca,almacén) con
 * `valor > 0`. `tecnologiasGlobal` viaja TAL CUAL a `tecnologias` del
 * DTO — el caller (`buildDashboard`) ya la calculó sobre el universo
 * GLOBAL, sin aplicar este mismo filtro (para que el selector nunca se
 * quede sin opciones).
 */
function buildHeatmap(
  vistas: SkuVista[],
  stockBySku: Map<string, StockLectura[]>,
  tecnologia: string | null,
  tecnologiasGlobal: string[],
): DashboardHeatmap {
  const vistasAlcance = tecnologia === null ? vistas : vistas.filter((v) => perteneceATecnologia(v, tecnologia));

  const porMarcaAlmacen = agregarPorMarcaAlmacen(vistasAlcance, stockBySku);
  const totalPorMarca = new Map<string, number>();
  porMarcaAlmacen.forEach((porAlmacen, marca) => {
    let suma = 0;
    porAlmacen.forEach((valor) => (suma += valor));
    totalPorMarca.set(marca, suma);
  });

  const filas = Array.from(totalPorMarca.entries())
    .sort((a, b) => b[1] - a[1] || cmpStr(a[0], b[0]))
    .slice(0, 10)
    .map(([marca]) => marca);

  const celdas: HeatmapCelda[] = [];
  let max = 0;
  for (const marca of filas) {
    const porAlmacen = porMarcaAlmacen.get(marca) ?? new Map<string, number>();
    for (const almacen of ALMACENES) {
      const valor = porAlmacen.get(almacen) ?? 0;
      if (valor <= 0) continue;
      celdas.push({ fila: marca, columna: almacen, valor });
      if (valor > max) max = valor;
    }
  }

  return {
    eje_y: 'marca',
    eje_x: 'almacen',
    filas,
    columnas: ALMACENES,
    celdas,
    max,
    tecnologia_activa: tecnologia,
    tecnologias: tecnologiasGlobal,
    total_marcas: porMarcaAlmacen.size,
  };
}

/**
 * Σ piezas de TODOS los buckets (marca,almacén) — SIN el filtro
 * `?tecnologia` ni el recorte top-10 que sí aplica `buildHeatmap` — del
 * universo recibido (mismo shape que los campos de datos de
 * `BuildDashboardInput`). Exportada ÚNICAMENTE para el test del GATE
 * (ver cabecera del archivo): el DTO público `DashboardHeatmap` trunca
 * a top-10 marcas y no expone este total agregado, así que verificar el
 * invariante de conservación de piezas requiere este acceso directo —
 * reutiliza el MISMO `agregarPorMarcaAlmacen` que `buildHeatmap`, para
 * que un mutante que reintroduzca la explosión por familia (multi-valor)
 * lo haga fallar también a él.
 */
export function heatmapPiezasUniverso(
  input: Pick<BuildDashboardInput, 'productos' | 'stock' | 'reservas' | 'overrides' | 'v2'>,
): number {
  const stockBySku = new Map<string, StockLectura[]>();
  for (const s of input.stock) {
    const arr = stockBySku.get(s.sku);
    if (arr) arr.push(s);
    else stockBySku.set(s.sku, [s]);
  }
  const reservasBySku = agruparReservasPorSku(input.reservas);
  const v2PorSku = mapearV2(input.v2);
  const vistas = buildVistas(input.productos, stockBySku, reservasBySku, input.overrides, v2PorSku);

  let total = 0;
  agregarPorMarcaAlmacen(vistas, stockBySku).forEach((porAlmacen) => {
    porAlmacen.forEach((valor) => (total += valor));
  });
  return total;
}

interface RadarAcc {
  disponible: number;
  reservado: number;
  en_riesgo: number;
  total: number;
}

/**
 * Top-3 marcas EFECTIVAS dinámicas por Σ total de stock; `en_aduana` cruza embarques
 * activos vía la marca efectiva del sku.
 *
 * **Devuelve también el universo**: `porMarca.size` capturado ANTES del `.slice(0, 3)`.
 * Capturarlo después daría 3, y 3 === `series.length` es indistinguible de «no hay
 * corte» — el resultado correcto por la razón equivocada (P25).
 */
function buildRadar(vistas: SkuVista[], embarquesActivos: EmbarqueActivoLectura[]): DashboardRadar {
  const porMarca = new Map<string, RadarAcc>();
  const marcaPorSku = new Map<string, string>();

  for (const v of vistas) {
    marcaPorSku.set(v.sku, v.marca);
    const acc = porMarca.get(v.marca) ?? { disponible: 0, reservado: 0, en_riesgo: 0, total: 0 };
    acc.disponible += v.disponible;
    acc.reservado += v.reservado;
    acc.total += v.total;
    if (v.disponible < 0) acc.en_riesgo += Math.abs(v.disponible);
    porMarca.set(v.marca, acc);
  }

  const enAduanaPorMarca = new Map<string, number>();
  for (const e of embarquesActivos) {
    const marca = marcaPorSku.get(e.sku);
    if (marca === undefined) continue; // embarque de un sku sin producto vigente en 'stock' (defensivo)
    enAduanaPorMarca.set(marca, (enAduanaPorMarca.get(marca) ?? 0) + (e.piezas ?? 0));
  }

  const top3 = Array.from(porMarca.entries())
    .sort((a, b) => b[1].total - a[1].total || cmpNullable(a[0], b[0]))
    .slice(0, 3);

  return {
    total_marcas: porMarca.size, // ANTES del recorte: `top3` ya perdió el universo
    series: top3.map(([marca, acc]) => ({
      marca,
      ejes: {
        disponible: acc.disponible,
        reservado: acc.reservado,
        en_aduana: enAduanaPorMarca.get(marca) ?? 0,
        en_riesgo: acc.en_riesgo,
      },
    })),
  };
}

/** Top-10 por `disponible` ASC (más negativo primero), solo `disponible < 0`; desempate por sku ASC. */
function buildTopSobreReservados(vistas: SkuVista[]): RankingItem[] {
  return vistas
    .filter((v) => v.disponible < 0)
    .sort((a, b) => a.disponible - b.disponible || cmpNullable(a.sku, b.sku))
    .slice(0, 10)
    .map((v) => ({
      sku: v.sku,
      descripcion: v.descr,
      marca: v.marca,
      disponible: v.disponible,
      reservado: v.reservado,
      total: v.total,
    }));
}

/**
 * Top-6 por Σ piezas DESC + el bucket `kam:null` SIEMPRE presente si existen reservas
 * sin KAM (aunque no entre en el top-6) — **y el UNIVERSO que había antes del recorte**.
 *
 * `total_kams` y `total_piezas` se capturan **antes** del `slice(0, 6)`. Tomarlos
 * después daría 6 y la suma de esos 6, y «6 de 6» es indistinguible de «no hay
 * recorte»: el resultado correcto por la razón equivocada (P25).
 *
 * Es el mismo movimiento que `buildRadar` ya hacía dos funciones más arriba. Este era
 * el tercer recorte del archivo y el único mudo.
 */
function buildReservasPorKam(reservas: ReservaLectura[]): DashboardReservasKam {
  const porKam = new Map<string | null, number>();
  for (const r of reservas) {
    porKam.set(r.kam, (porKam.get(r.kam) ?? 0) + r.cantidad);
  }
  const items: ReservaKamItem[] = Array.from(porKam.entries())
    .map(([kam, piezas]) => ({ kam, piezas }))
    .sort((a, b) => b.piezas - a.piezas || cmpNullable(a.kam, b.kam));

  // ANTES del recorte: `top6` ya perdió el universo.
  const total_kams = items.length;
  const total_piezas = items.reduce((a, i) => a + i.piezas, 0);

  const top6 = items.slice(0, 6);
  const nullBucket = items.find((i) => i.kam === null);
  const pintados = nullBucket && !top6.some((i) => i.kam === null) ? [...top6, nullBucket] : top6;

  return { items: pintados, total_kams, total_piezas };
}

/** Espejo aplanado de `CruceEtapa`: SIEMPRE 11 filas (orden 1..11 reordenado defensivamente), aunque en ceros. */
function buildPipeline(estatus: DashboardEstatusRow[], embarquesActivos: EmbarqueActivoLectura[]): DashboardPipelineEtapa[] {
  const porEtapa = new Map<number, { activos: number; piezas: number }>();
  for (const e of embarquesActivos) {
    const bucket = porEtapa.get(e.estatus_id) ?? { activos: 0, piezas: 0 };
    bucket.activos += 1;
    bucket.piezas += e.piezas ?? 0;
    porEtapa.set(e.estatus_id, bucket);
  }
  return [...estatus]
    .sort((a, b) => a.orden - b.orden)
    .map((et) => {
      const b = porEtapa.get(et.orden) ?? { activos: 0, piezas: 0 };
      return { orden: et.orden, nombre: et.nombre, activos: b.activos, piezas: b.piezas };
    });
}

/**
 * LA definición de los 6 grupos del riel de aduana. [DASH-E · E-1]
 *
 * Vive AQUÍ y en un solo sitio a propósito: el §2 del bloque lo dice literal —
 * *«los 6 grupos son una definición del NEGOCIO, no un `switch` en un
 * componente; si cada superficie los deriva por su cuenta habrá N verdades
 * sobre lo mismo»*. Es la misma lección que `piezas_en_camino` costó en este
 * repo, aplicada antes de que ocurra.
 *
 * La gramática (estancia/traslado) la dictó el equipo de Embarques el 9-sep.
 */
const GRUPOS_PIPELINE: ReadonlyArray<{
  clave: string;
  nombre: string;
  forma: FormaGrupoPipeline;
  ordenes: readonly number[];
}> = [
  { clave: 'importacion', nombre: 'Importación', forma: 'estancia', ordenes: [1, 2, 3, 4] },
  { clave: 'transito_intl', nombre: 'Tránsito internacional', forma: 'traslado', ordenes: [5, 6] },
  { clave: 'aduana', nombre: 'Aduana', forma: 'estancia', ordenes: [7] },
  { clave: 'transito_terrestre', nombre: 'Tránsito terrestre', forma: 'traslado', ordenes: [8] },
  { clave: 'almacenes', nombre: 'Almacenes', forma: 'estancia', ordenes: [9, 10] },
  { clave: 'disponible', nombre: 'Disponible', forma: 'traslado', ordenes: [11] },
];

/**
 * Agrupa las etapas del pipeline en los 6 grupos del riel. PURA.
 *
 * **La invariante, y es lo que la vuelve no-decorativa: ninguna etapa se pierde.**
 * Una etapa que el mapa no conoce —el día que el catálogo crezca— NO desaparece
 * del riel: se reinyecta en un grupo `sin_grupo` **nombrado**, igual que el
 * bucket `kam:null` de `buildReservasPorKam` se reinyecta etiquetado en vez de
 * omitirse. Es «cero visible, no fabricado» aplicado al agrupamiento, y su
 * corolario es comprobable: **Σ de los grupos = Σ del pipeline completo**.
 *
 * Y ese grupo NO dice `estancia`: dice `sin_clasificar`. Un rectángulo afirmaría
 * que el producto permanece ahí, y eso nadie lo ha declarado.
 */
export function agruparPipeline(etapas: DashboardPipelineEtapa[]): DashboardPipelineGrupo[] {
  const porOrden = new Map(etapas.map((e) => [e.orden, e]));
  const cubiertas = new Set<number>();

  const grupos: DashboardPipelineGrupo[] = GRUPOS_PIPELINE.map((g) => {
    const ordenes: number[] = [];
    let activos = 0;
    let piezas = 0;
    for (const orden of g.ordenes) {
      const etapa = porOrden.get(orden);
      if (!etapa) continue;
      cubiertas.add(orden);
      ordenes.push(orden);
      activos += etapa.activos;
      piezas += etapa.piezas;
    }
    return { clave: g.clave, nombre: g.nombre, forma: g.forma, ordenes, activos, piezas };
  });

  const huerfanas = etapas.filter((e) => !cubiertas.has(e.orden));
  if (huerfanas.length > 0) {
    grupos.push({
      clave: 'sin_grupo',
      nombre: 'Sin grupo asignado',
      forma: 'sin_clasificar',
      ordenes: huerfanas.map((e) => e.orden),
      activos: huerfanas.reduce((a, e) => a + e.activos, 0),
      piezas: huerfanas.reduce((a, e) => a + e.piezas, 0),
    });
  }

  return grupos;
}

/** `Kpi` sin delta (política "solo honestos" — todos salvo `piezas_en_camino` viajan así en v1). */
function kpiSinDelta(valor: number): Kpi {
  return { valor, delta: null };
}

/**
 * Ensambla `DashboardResponse` a partir de filas ya resueltas. 100%
 * PURA — exportada para tests. Ver comentario de cabecera del archivo
 * para las semánticas exactas de cada KPI/alerta.
 */
export function buildDashboard(input: BuildDashboardInput): DashboardResponse {
  const stockBySku = new Map<string, StockLectura[]>();
  for (const s of input.stock) {
    const arr = stockBySku.get(s.sku);
    if (arr) arr.push(s);
    else stockBySku.set(s.sku, [s]);
  }
  const reservasBySku = agruparReservasPorSku(input.reservas);
  const v2PorSku = mapearV2(input.v2);

  const vistas = buildVistas(input.productos, stockBySku, reservasBySku, input.overrides, v2PorSku);

  const catalogoTotal = input.productos.length;
  // [MVP-CIERRE] F5 · Las TRES cifras salen del MISMO recorrido, para que no
  // puedan divergir (mismo criterio que `sinV2`/`sinTecnologia` abajo).
  //
  // `piezasDisponibles` pasa a sumar solo los POSITIVOS. Antes era el neto y
  // convivía con `skusDisponibles`, que siempre contó solo positivos: la
  // tarjeta contaba una cosa y sumaba otra. Un SKU sobre-reservado aporta
  // CERO disponible, no un disponible negativo — restar su deuda contra la
  // existencia de OTRO SKU es una compensación que no ocurre en la bodega.
  // El neto no se pierde: se expone aparte y rotulado (ver `types/api.ts`).
  const piezasDisponibles = vistas.reduce((sum, v) => sum + Math.max(0, v.disponible), 0);
  const piezasSobreReservadas = vistas.reduce((sum, v) => sum + Math.min(0, v.disponible), 0);
  const piezasDisponiblesNeto = piezasDisponibles + piezasSobreReservadas;
  const skusDisponibles = vistas.filter((v) => v.disponible > 0).length;
  const sobreReservados = vistas.filter((v) => v.disponible < 0).length;
  const sinV2 = input.productos.filter((p) => !v2PorSku.has(p.sku)).length;
  // Mismo `v2PorSku` que `sinV2` — una sola aritmética por concepto (patrón
  // P2, docs/engineering/failure-patterns.md): sin fila (`?.tecnologia` da `undefined`)
  // Y fila con `tecnologia` sin poblar cuentan igual, así que sinV2 SIEMPRE
  // es ⊆ sinTecnologia por construcción — nunca dos recorridos que puedan
  // divergir entre sí.
  //
  // ⚠ DOS DENOMINADORES, medido sobre el vigente: este KPI sigue
  // contando contra `clasificacion_v2.tecnologia` (el universo A: SKU sin tecnología
  // v2) — pero desde D-1(a) (CAT-B1 · Tramo B) el filtro del catálogo
  // `?tecnologia=__sin_tecnologia__` (`inventory.service.ts`, faceta
  // `sin_tecnologia`) cuenta contra la tecnología RESUELTA
  // (`productos.tecnologia`, capa fuente): con la columna vacía, el catálogo entero.
  // Misma palabra "sin
  // tecnología", dos universos — y este KPI enlaza justo a ese filtro
  // (`dashboard-kpis.tsx`), así que el número que promete y el que entrega no
  // son el mismo. NO SE ARREGLA AQUÍ: cuál de los dos es el correcto es
  // decisión de quien retome la bandeja, no de este Tramo.
  //
  // 🔴 LO DE ARRIBA VENCIÓ · re-medido (CAT-ITER-1). Era
  // cierto mientras la columna estaba vacía; la ingesta posterior la pobló.
  // Hoy el filtro del catálogo ya no cuenta el catálogo entero: cuenta
  // un universo B menor. El resto del párrafo sigue en pie: son dos universos y este KPI
  // enlaza al otro.
  //
  // ⚠ Y LOS DOS CONJUNTOS NO ESTÁN ANIDADOS — medido, y cambia el arreglo:
  //
  //     sólo en A (v2 nula, la fuente SÍ trae) .......  hay
  //     sólo en B (fuente nula, la v2 SÍ trae) .......  hay
  //     en ambos .....................................  hay
  //
  // Pasar este KPI de A a B NO es subir un número: es CAMBIAR DE CONJUNTO,
  // y deja SKU sin contar sin que nadie lo vea. Y un tercer candidato mide
  // el trabajo real: la bandeja tiene los `sku_sin_tecnologia` abiertos, y
  // por `EXCEPT` en las dos direcciones son EXACTAMENTE la intersección (0 y
  // 0) — los otros dos sobre-cuentan.
  //
  // Sigue sin arreglarse aquí, y ahora por decisión explícita: el universo de
  // este KPI está CONGELADO a lo acordado (`CAT-ITER-1 · O-2b`).
  // [CAT-ITER-1 · O-2b] EL UNIVERSO DE ESTE KPI SE ACORDO: la BANDEJA.
  //
  // Habia TRES candidatos, medidos, y los tres eran CONJUNTOS DISTINTOS -- no
  // tres lecturas del mismo:
  //     A  contra `clasificacion_v2`     (sobre-cuenta: la fuente ya los trae)
  //     B  contra `productos.tecnologia` (sobre-cuenta: la v2 ya los trae)
  //     C  la bandeja abierta, que por `EXCEPT` en las dos direcciones es
  //        EXACTAMENTE la interseccion de los otros dos (0 y 0)
  //
  // Un KPI de portada dice CUANTO FALTA POR HACER, no cuantos huecos tiene una
  // capa; y los de C son los unicos que nadie ha contestado por ninguna via.
  //
  // CONSECUENCIA MEDIDA, y no es cosmetica: con este universo la CONTENCION
  // `sin_v2` ⊆ `sin_tecnologia` DEJA DE SOSTENERSE -- parte de los sin fila v2
  // no estan en la bandeja. La frase de `dashboard-kpis.tsx` que la afirmaba
  // se reescribio en el mismo commit, y el trinquete que la vigila es quien
  // obligo a verlo antes de desplegarlo.
  const sinTecnologia = input.pendientesSinTecnologia ?? 0;
  // [FIX-B1 · item 7] Universo DISTINTO del `sinTecnologia` de arriba
  // (congelado a la bandeja por CAT-ITER-1 · O-2b): éste cuenta PRODUCTOS
  // vigentes VISIBLES sin tecnología EFECTIVA, con la MISMA `contarSinTecnologia`
  // que usa `inventory.service.ts` para `facetas.sin_tecnologia` — nunca dos
  // recorridos que puedan divergir sobre la misma pregunta.
  const productosSinTecnologia = contarSinTecnologia(vistas);
  // [2.0.1-A · D3] SOLO la divergencia de v2: la manual ya no es silenciosa
  // (autor, fecha y boton de revertir en la ficha) y mezclarlas daria un
  // numero que no sirve para ninguna de las dos acciones.
  //
  // ⚠ CONTADOR QUE NO PUEDE INCREMENTARSE (P19), desde D-1(a) (CAT-B1 · Tramo
  // B): `v.divergenciaFamilia` viene de `divergenciaFamilia()`
  // (derivaciones.ts), y ese predicado documenta ahí mismo que la clase
  // `'v2'` quedó INALCANZABLE cuando la v2 dejó de tener precedencia —
  // `familiaMovida` da SIEMPRE 0 desde este cambio. Medido sobre el vigente:
  // antes de D-1(a) eran cientos de SKU con `familia_v2` distinta de la fuente; el
  // número visible pasa a 0. Rediseñar esta alerta (D3) es FUERA DE
  // ALCANCE de este Tramo — queda dicho para quien la retome, no decidido aquí.
  const familiaMovida = vistas.filter((v) => v.divergenciaFamilia === 'v2').length;
  const descuadres = descuadresDe(input.productos, reservasBySku);

  let piezasEnCamino = 0;
  let retrasados = 0;
  for (const e of input.embarquesActivos) {
    piezasEnCamino += e.piezas ?? 0;
    if (esRetrasado(e.eta, e.fecha_llegada, input.hoy)) retrasados++;
  }

  // `tecnologias` del selector: SIEMPRE sobre el universo GLOBAL (todas las
  // `vistas`, sin aplicar `input.tecnologia`) — así el usuario nunca se queda
  // sin poder cambiar de tecnología (ver asimetría en la cabecera del archivo).
  const tecnologiasGlobal = Array.from(new Set(vistas.flatMap((v) => (v.tecnologia !== null ? [v.tecnologia] : []))))
    .sort(cmpStr);
  const heatmap = buildHeatmap(vistas, stockBySku, input.tecnologia, tecnologiasGlobal);
  const radar = buildRadar(vistas, input.embarquesActivos);
  const top_sobre_reservados = buildTopSobreReservados(vistas);
  const reservas_por_kam = buildReservasPorKam(input.reservas);
  const pipeline = buildPipeline(input.estatus, input.embarquesActivos);

  // Orden fijo (mismo orden que `AlertaTipo` en types/api.ts).
  const alertas: Alerta[] = [
    { tipo: 'sobre_reservado', conteo: sobreReservados, href: '/catalogo?badge=sobre_reservado' },
    { tipo: 'retrasado', conteo: retrasados, href: '/embarques?retrasado=1' },
    { tipo: 'sin_v2', conteo: sinV2, href: '/catalogo?sinV2=1' },
    { tipo: 'descuadre_reservas', conteo: descuadres.length, href: '/config?tab=pendientes' },
    { tipo: 'pendientes', conteo: input.pendientesAbiertos, href: '/config?tab=pendientes' },
    // ⚠ P19: `familiaMovida` es un contador que ya no puede incrementarse
    // desde D-1(a) (ver el comentario donde se calcula, arriba) — este `href`
    // apunta a `/catalogo?divergencia=1`, una lista que hoy siempre está vacía.
    { tipo: 'familia_movida', conteo: familiaMovida, href: '/catalogo?divergencia=1' },
  ];

  let deltaPiezasEnCamino: KpiDelta | null = null;
  if (input.piezasEnCaminoBase !== null && input.periodos.anterior !== null) {
    const base = input.piezasEnCaminoBase;
    const diff = piezasEnCamino - base;
    deltaPiezasEnCamino = {
      valor: diff,
      pct: base === 0 ? null : (diff / base) * 100,
      periodo_base: input.periodos.anterior,
      direccion: diff > 0 ? 'sube' : diff < 0 ? 'baja' : 'igual',
    };
  }

  const kpis: DashboardKpis = {
    catalogo_total: kpiSinDelta(catalogoTotal),
    piezas_disponibles: kpiSinDelta(piezasDisponibles),
    piezas_disponibles_neto: kpiSinDelta(piezasDisponiblesNeto),
    piezas_sobre_reservadas: kpiSinDelta(piezasSobreReservadas),
    skus_disponibles: kpiSinDelta(skusDisponibles),
    sobre_reservados: kpiSinDelta(sobreReservados),
    piezas_en_camino: { valor: piezasEnCamino, delta: deltaPiezasEnCamino },
    retrasados: kpiSinDelta(retrasados),
    sin_v2: kpiSinDelta(sinV2),
    sin_tecnologia: kpiSinDelta(sinTecnologia),
    productos_sin_tecnologia: kpiSinDelta(productosSinTecnologia),
    pendientes: kpiSinDelta(input.pendientesAbiertos),
  };

  return {
    snapshot: {
      stock: input.vigenteStockSnap ? { ...input.vigenteStockSnap, vigente: true } : null,
      aduana: input.vigenteAduanaSnap ? { ...input.vigenteAduanaSnap, vigente: true } : null,
    },
    periodos: input.periodos,
    kpis,
    heatmap,
    radar,
    top_sobre_reservados,
    reservas_por_kam,
    pipeline,
    pipeline_grupos: agruparPipeline(pipeline),
    tendencia: input.tendencia,
    alertas,
  };
}

// ------------------------------------------------------------
// Orquestador — getDashboard (fetches con el session client)
// ------------------------------------------------------------

interface DashboardProductoRow {
  sku: string;
  resv: number | null;
  descr_origen: string | null;
  cliente: string | null;
  /**
   * [FIX-B1] `productos.tecnologia` (migración 0036) — SIN este campo en el
   * `select`, `sinTecnologia`/`tecnologiasGlobal`/el heatmap filtrado por
   * `?tecnologia` quedaban `null` SIEMPRE (DEFECTO ALTO de este bloque).
   */
  tecnologia: string | null;
  marcas: unknown;
  familias: unknown;
}
interface DashboardStockRow {
  sku: string;
  cantidad: number | null;
  almacenes: unknown;
}
interface DashboardReservaRow {
  sku: string;
  cantidad: number | null;
  kams: unknown;
}
interface DashboardOverrideRow {
  id: string;
  sku: string;
  /** [FIX-B1] `CampoOverride` (`@/types/enums`) — desde este bloque también puede ser `'tecnologia'`. */
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}
interface DashboardEmbarqueRow {
  sku: string;
  piezas: number | null;
  eta: string | null;
  fecha_llegada: string | null;
  estatus_id: number;
}

interface StockCore {
  vigente: SnapshotVigente;
  productos: ProductoLectura[];
  stock: StockLectura[];
  reservas: ReservaLectura[];
  overrides: OverrideLectura[];
  v2: ClasificacionV2Lectura[];
}

/**
 * `clasificacion_v2` puede no existir aún en la DB (misma tolerancia que
 * inventory/sku/cruce/clasificacion.service.ts, vía
 * `esNoDisponiblePorMigracion` de `@/lib/supabase/pg-errors`).
 */
async function fetchStockCore(db: SupabaseClient, S: SnapshotVigente): Promise<StockCore> {
  const [productosRows, stockRows, reservasRows, overridesRows, v2Rows] = await Promise.all([
    fetchAllRows<DashboardProductoRow>((from, to) =>
      db
        .from('productos')
        .select('sku,resv,descr_origen,cliente,tecnologia, marcas(nombre,excluida_del_catalogo), familias(nombre)')
        .eq('snapshot_id', S.id)
        .range(from, to),
    ),
    fetchAllRows<DashboardStockRow>((from, to) =>
      db.from('stock_por_almacen').select('sku,cantidad, almacenes(clave)').eq('snapshot_id', S.id).range(from, to),
    ),
    // cliente/motivo/fecha no se seleccionan: el dashboard solo usa kam+cantidad
    // (descuadre + reservas_por_kam) — placeholders inertes al normalizar abajo,
    // mismo patrón que `descrPorSku` en cruce.service.ts.
    fetchAllRows<DashboardReservaRow>((from, to) =>
      db.from('reservas').select('sku,cantidad, kams(nombre)').eq('snapshot_id', S.id).range(from, to),
    ),
    fetchAllRows<DashboardOverrideRow>((from, to) =>
      db.from('productos_override').select('id,sku,campo,valor_editado,editado_en,activo').eq('activo', true).range(from, to),
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

  // [VERT-B2] LA MISMA REGLA QUE EL CATALOGO, Y POR EL MISMO CAMINO.
  //
  // Se filtra AQUI -- en la lectura, sobre el embed por `marca_id` -- y no en
  // `buildDashboard`, que recibe `ProductoLectura` y solo conoce el NOMBRE de la
  // marca. Comparar por nombre habria reintroducido justo la fragilidad que la
  // 0039 vino a quitar: «BRAND 6» y «BRAND6» son dos filas distintas de
  // `marcas`, y «CABLE» y «CABLES» tambien.
  //
  // Y va aqui, no en cada consumidor: `catalogo_total`, el mapa de calor, el
  // radar y los rankings cuelgan todos de `input.productos`. Filtrar el origen
  // es lo que impide que uno de los cuatro cuente las marcas excluidas -- que es C-1 del
  // censo, y es el defecto que este bloque existe para impedir.
  const productosVisibles = productosRows.filter((p) => !embedExcluida(p.marcas));
  const productos: ProductoLectura[] = productosVisibles.map((p) => ({
    sku: String(p.sku),
    marca: embedName(p.marcas) ?? '',
    familia: embedName(p.familias),
    descr_origen: p.descr_origen ?? null,
    cliente: p.cliente ?? null,
    resv: Number(p.resv ?? 0),
    tecnologia: p.tecnologia ?? null,
  }));
  const stock: StockLectura[] = stockRows.map((s) => ({
    sku: String(s.sku),
    almacen: embedClave(s.almacenes) ?? '',
    cantidad: Number(s.cantidad ?? 0),
  }));
  const reservas: ReservaLectura[] = reservasRows.map((r) => ({
    sku: String(r.sku),
    kam: embedName(r.kams),
    cliente: '',
    cantidad: Number(r.cantidad ?? 0),
    motivo: null,
    fecha: '',
  }));
  const overrides: OverrideLectura[] = overridesRows.map((o) => ({
    sku: String(o.sku),
    campo: o.campo,
    valor_editado: String(o.valor_editado),
    editado_en: String(o.editado_en),
    id: String(o.id),
    activo: Boolean(o.activo),
  }));

  return { vigente: S, productos, stock, reservas, overrides, v2: v2Rows };
}

interface AduanaCore {
  vigente: SnapshotVigente | null;
  embarquesActivos: EmbarqueActivoLectura[];
  estatus: DashboardEstatusRow[];
}

/** `estatus_catalogo` SIEMPRE se trae (aunque no haya vigente de aduana) — mismo criterio que `getCruce`. */
async function fetchAduanaCore(db: SupabaseClient): Promise<AduanaCore> {
  const vigente = await resolveVigente(db, 'aduana');

  if (!vigente) {
    const { data, error } = await db.from('estatus_catalogo').select('orden,nombre');
    if (error) throw new Error('estatus_catalogo: ' + error.message);
    return { vigente: null, embarquesActivos: [], estatus: (data ?? []) as DashboardEstatusRow[] };
  }

  const [estatusRes, embarquesRows] = await Promise.all([
    db.from('estatus_catalogo').select('orden,nombre'),
    fetchAllRows<DashboardEmbarqueRow>((from, to) =>
      db
        .from('embarques')
        .select('sku,piezas,eta,fecha_llegada,estatus_id')
        .eq('snapshot_id', vigente.id)
        .eq('is_historial', false)
        .range(from, to),
    ),
  ]);
  if (estatusRes.error) throw new Error('estatus_catalogo: ' + estatusRes.error.message);

  const embarquesActivos: EmbarqueActivoLectura[] = embarquesRows.map((e) => ({
    sku: String(e.sku),
    piezas: e.piezas ?? null,
    eta: e.eta ?? null,
    fecha_llegada: e.fecha_llegada ?? null,
    estatus_id: Number(e.estatus_id),
  }));

  return { vigente, embarquesActivos, estatus: (estatusRes.data ?? []) as DashboardEstatusRow[] };
}

async function fetchSnapshotsPorFuente(db: SupabaseClient, fuente: FuenteSnapshot): Promise<SnapshotPeriodoRow[]> {
  const rows = await fetchAllRows<{
    id: string;
    created_at: string;
    periodo: string;
    filas: number | null;
    archivo: string | null;
  }>((from, to) => db.from('snapshots').select('id,created_at,periodo,filas,archivo').eq('fuente', fuente).range(from, to));

  return rows.map((r) => ({
    id: String(r.id),
    created_at: String(r.created_at),
    periodo: String(r.periodo),
    filas: r.filas == null ? null : Number(r.filas),
    archivo: r.archivo == null ? null : String(r.archivo),
  }));
}

/**
 * Conteo de `pendientes_datos` abiertos vía RPC `contar_pendientes()`
 * (0009). Si la RPC aún no existe (0009 sin aplicar — PostgREST responde
 * PGRST202, verificado empíricamente contra el PostgREST vivo, NUNCA
 * 42P01), degrada a 0 con un warn silencioso (NUNCA lanza) — mismo
 * criterio de tolerancia que el resto del dominio, vía
 * `esNoDisponiblePorMigracion`.
 */
async function fetchPendientesAbiertos(db: SupabaseClient): Promise<{ abiertos: number; sinTecnologia: number }> {
  const { data, error } = await db.rpc('contar_pendientes');
  if (error) {
    if (esNoDisponiblePorMigracion(error)) {
      console.warn('[dashboard.service] contar_pendientes no disponible aún (0009 sin aplicar) — degradando a 0');
      return { abiertos: 0, sinTecnologia: 0 };
    }
    throw new Error('contar_pendientes: ' + error.message);
  }
  // [CAT-ITER-1 · O-2b] `por_tipo` YA venía en la RPC (0009) y nadie lo leía.
  // El KPI de «sin tecnología» pasa a contar la BANDEJA ABIERTA por decisión
  // firmada de producto, y sale de aquí: no hace falta consulta nueva.
  const conteo = data as { abiertos?: number; por_tipo?: Record<string, number> } | null;
  return {
    abiertos: Number(conteo?.abiertos ?? 0),
    sinTecnologia: Number(conteo?.por_tipo?.sku_sin_tecnologia ?? 0),
  };
}

/**
 * Dashboard completo (F1). Sin vigente 'stock'/'aduana' → "vacío digno"
 * (KPIs en 0, 11 etapas en ceros), nunca 404/500. `query` es OPCIONAL
 * (default `{}`, `tecnologia` ausente ⇒ heatmap sin filtro) para no
 * romper posicionalmente los call-sites previos a INV-TAXO F4.
 */
export async function getDashboard(db: SupabaseClient, query: DashboardQuery = {}): Promise<DashboardResponse> {
  const hoy = hoyMexico();

  const [stockCore, aduanaCore, snapshotsStock, snapshotsAduana, pendientesAbiertos] = await Promise.all([
    conVigenteStock(db, (S) => fetchStockCore(db, S)),
    fetchAduanaCore(db),
    fetchSnapshotsPorFuente(db, 'stock'),
    fetchSnapshotsPorFuente(db, 'aduana'),
    fetchPendientesAbiertos(db),
  ]);

  const stockPorPeriodo = vigentePorPeriodo(snapshotsStock);
  const periodosAsc = periodosOrdenados(stockPorPeriodo);
  const periodoActual = periodosAsc.length > 0 ? periodosAsc[periodosAsc.length - 1] : null;
  const periodoAnterior = periodosAsc.length > 1 ? periodosAsc[periodosAsc.length - 2] : null;

  const idsPorPeriodo = Array.from(stockPorPeriodo.values()).map((s) => s.id);
  const stockAgregadoRows = idsPorPeriodo.length
    ? await fetchAllRows<{ snapshot_id: string; cantidad: number | null }>((from, to) =>
        db.from('stock_por_almacen').select('snapshot_id,cantidad').in('snapshot_id', idsPorPeriodo).range(from, to),
      )
    : [];
  const sumaPorSnapshot = new Map<string, number>();
  for (const r of stockAgregadoRows) {
    const key = String(r.snapshot_id);
    sumaPorSnapshot.set(key, (sumaPorSnapshot.get(key) ?? 0) + Number(r.cantidad ?? 0));
  }
  // [DASH-D · D-2] `cortesPorPeriodo` se calcula sobre la MISMA lista que
  // `vigentePorPeriodo` ya recorrió: no hay consulta nueva ni columna nueva —
  // es el tamaño de grupo que el reductor descartaba.
  const cortesStock = cortesPorPeriodo(snapshotsStock);
  const tendencia: TendenciaPunto[] = periodosAsc.map((periodo) => {
    const snap = stockPorPeriodo.get(periodo)!;
    return { periodo, piezas: sumaPorSnapshot.get(snap.id) ?? 0, cortes: cortesStock.get(periodo) ?? 1 };
  });

  let piezasEnCaminoBase: number | null = null;
  if (periodoAnterior !== null) {
    const aduanaPorPeriodo = vigentePorPeriodo(snapshotsAduana);
    const snapAnteriorAduana = aduanaPorPeriodo.get(periodoAnterior);
    // Sin snapshot de aduana para ese periodo → sin baseline honesto (delta queda null, NO se fabrica un 0).
    if (snapAnteriorAduana) {
      const rows = await fetchAllRows<{ piezas: number | null }>((from, to) =>
        db
          .from('embarques')
          .select('piezas')
          .eq('snapshot_id', snapAnteriorAduana.id)
          .eq('is_historial', false)
          .range(from, to),
      );
      piezasEnCaminoBase = rows.reduce((sum, r) => sum + (r.piezas ?? 0), 0);
    }
  }

  return buildDashboard({
    hoy,
    vigenteStockSnap: stockCore?.vigente ?? null,
    vigenteAduanaSnap: aduanaCore.vigente,
    productos: stockCore?.productos ?? [],
    stock: stockCore?.stock ?? [],
    reservas: stockCore?.reservas ?? [],
    overrides: stockCore?.overrides ?? [],
    v2: stockCore?.v2 ?? [],
    embarquesActivos: aduanaCore.embarquesActivos,
    estatus: aduanaCore.estatus,
    periodos: { actual: periodoActual, anterior: periodoAnterior },
    tendencia,
    piezasEnCaminoBase,
    pendientesAbiertos: pendientesAbiertos.abiertos,
    pendientesSinTecnologia: pendientesAbiertos.sinTecnologia,
    tecnologia: query.tecnologia ?? null,
  });
}

// ------------------------------------------------------------
// fetchDescuadresVigentes — compartido con pendientes.service.ts
// ------------------------------------------------------------

async function fetchDescuadreRows(db: SupabaseClient, S: SnapshotVigente): Promise<Descuadre[]> {
  const [productosRows, reservasRows] = await Promise.all([
    fetchAllRows<{ sku: string; resv: number | null }>((from, to) =>
      db.from('productos').select('sku,resv').eq('snapshot_id', S.id).range(from, to),
    ),
    fetchAllRows<{ sku: string; cantidad: number | null }>((from, to) =>
      db.from('reservas').select('sku,cantidad').eq('snapshot_id', S.id).range(from, to),
    ),
  ]);

  const productos: ProductoLectura[] = productosRows.map((p) => ({
    sku: String(p.sku),
    marca: '',
    familia: null,
    descr_origen: null,
    resv: Number(p.resv ?? 0),
    tecnologia: null, // irrelevante para descuadresDe(): no usa tecnologia
  }));
  const reservas: ReservaLectura[] = reservasRows.map((r) => ({
    sku: String(r.sku),
    kam: null,
    cliente: '',
    cantidad: Number(r.cantidad ?? 0),
    motivo: null,
    fecha: '',
  }));

  return descuadresDe(productos, agruparReservasPorSku(reservas));
}

/**
 * Productos vigentes ('stock') con `resv` descuadrado contra Σ
 * reservas — bloque DERIVADO de la bandeja de pendientes
 * (`pendientes.service.ts`). Fetch DEDICADO y ligero (solo
 * sku/resv/cantidad): `getDashboard` NO lo llama — ya tiene
 * productos/reservas cargados para las demás métricas y computa su
 * propio conteo con la MISMA `descuadresDe` sobre esos datos (ver
 * `buildDashboard`), sin duplicar el fetch. Sin snapshot 'stock'
 * vigente → `[]` (nunca lanza).
 */
export async function fetchDescuadresVigentes(db: SupabaseClient): Promise<Descuadre[]> {
  const result = await conVigenteStock(db, (S) => fetchDescuadreRows(db, S));
  return result ?? [];
}
