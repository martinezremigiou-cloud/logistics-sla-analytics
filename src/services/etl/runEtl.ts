// ============================================================
// Bloque 2 · ETL · runEtl.ts
//   - computeSnapshot: PURO/determinista (no toca BD) → habilita
//     dry-run + TDD sin base de datos.
//   - runEtl: carga catálogo + prev (reads), llama computeSnapshot y,
//     si hay cambios, persiste vía RPC transaccional `ingest_snapshot` (0005).
// La estrategia de persistencia vive en UN solo punto (persistSnapshot).
//
// [REPRODUCIBILIDAD · S7-A] Guarda de universo entrante — 2026-08-07,
// Opción A ratificada.
//
// QUÉ COMPARA. El numerador/denominador es LA MISMA expresión que ya
// alimenta la columna `snapshots.filas` (`buildIngestPayload`,
// persist.ts:277 histórico): productos+stock+reservas+embarques. Se
// extrajo a `filasDelUniverso` (persist.ts) y se usa en los DOS lados
// —el conteo de esa columna y esta guarda— para que no puedan divergir.
//
// LA REGLA: `filasEntrantes / filasPrevias < 0.50` → RECHAZO (el corte
// es estrictamente `<`: exactamente 50.0% PASA). El umbral NO se eligió
// por parecer razonable: se midió contra la historia de corridas (de
// aduana y de stock) sobre este universo. Pisos legítimos medidos:
//
//   fuente  | piso legítimo                         | margen contra 50%
//   stock   | muy por encima del umbral             | cerca del doble
//   aduana  | máximo: el archivo nunca ha encogido  | el doble
//
// Un archivo vacío da 0.0 %.
//
// Nota de honestidad sobre el margen de aduana (Enmienda 3,
// textual): "El piso de aduana es el máximo porque ese archivo nunca ha
// encogido — pocas corridas casi idénticas. Eso no es
// evidencia de que no pueda encoger. El margen de aduana descansa sobre
// menos historia de la que el número aparenta."
//
// QUÉ NO CAZA (Enmienda 3, textual): "Esta guarda caza el
// VACIADO, no el DEGRADADO. Un archivo con todas sus filas y una
// columna renombrada da 100 % de universo y pasa limpio. El degradado
// sigue siendo responsabilidad de F2/F3 y sigue abierto. Que esta
// guarda esté verde no es cobertura de P11."
//
// EXCEPCIÓN (P17, `docs/engineering/failure-patterns.md` — "el universo vacío que
// pasa por resuelto"): si `prev.snapshotId === null` o
// `filasPrevias === 0`, la guarda NO APLICA — sin vigente anterior no
// hay delta que medir. Un universo vacío nunca es evidencia de que el
// trabajo ya se hizo.
//
// ESCAPE HATCH (Enmienda 2): el forzado es EXPLÍCITO de quien
// ingesta, nunca automático — tres cabeceras HTTP obligatorias JUNTAS
// (`x-forzar-universo-reducido: si`, `x-forzar-motivo`, `x-forzar-por`),
// leídas y validadas por las DOS rutas (`src/lib/api/forzar-universo.ts`),
// nunca por variable de entorno ni valor por defecto. Nota de
// honestidad: las dos rutas de ingesta autentican con INGEST_SECRET
// compartido (`ingestaAutorizada`), no con sesión de usuario —
// `x-forzar-por` es una identidad AUTO-DECLARADA, NO AUTENTICADA.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { rastroDe, RASTRO_VACIO } from '@/lib/supabase/reintento';
import { periodoDeCaptura } from '@/lib/fechas';
import type {
  IngestJob,
  CatalogIndex,
  PrevState,
  EtlResult,
  SnapshotPayload,
  QuarantineItem,
  DiagItem,
  ProductoCanon,
  ProductoRow,
  StockRow,
  ReservaRow,
  EmbarqueRow,
  CambioNuevo,
  ClaveAlmacen,
  ForzadoUniverso,
} from './types';
import { parseInventario } from './parse.inventario';
import { parseWest } from './parse.west';
import { parseReserva } from './parse.reserva';
import { parseEmbarques } from './parse.embarques';
import { reconcile } from './reconcile';
import { runGates, checkReferential } from './gates';
import { diffEntity, diffEmbarques } from './differ';
import { snapshotHash as hashRows } from './hash';
import { resolveMarca, resolveFamilia, resolveAlmacen, resolveKam, resolveEstatus } from './catalogs';
import { normalizeAliasKey, normalizeMarcaNombre } from './normalize';
import { loadCatalogIndex, loadPrevState, persistSnapshot, filasDelUniverso } from './persist';
import { EtlContractError, UniversoReducidoError, SnapshotDuplicadoError } from './errors';

// [REPRODUCIBILIDAD · S7-A] Único lugar donde vive el número — la
// guarda lo usa para decidir Y `UniversoReducidoError` lo recibe para
// que el mensaje muestre EXACTAMENTE el umbral que se evaluó, nunca uno
// recalculado aparte.
const UMBRAL_UNIVERSO_MINIMO = 0.5;

// 'WEST' es un ALMACÉN, nunca una marca. Cuando aparece en la columna
// MARCA (algunos renglones), el producto se conserva pero se reasigna a
// esta marca catch-all seedeada (0003) en vez de crear una marca 'WEST'.
// STOP&ASK: confirmar con producto la marca destino de estos ítems.
const MARCA_FALLBACK_WEST = 'NACIONAL';

// ------------------------------------------------------------
// Claves de entidad para differ / hash.
// ------------------------------------------------------------
const skuKey = (p: { sku: string }) => p.sku;
const stockKey = (s: { sku: string; almacen: string }) => `${s.sku}|${s.almacen}`;
const reservaKey = (r: {
  sku: string;
  kam: string | null;
  cliente: string;
  fecha: string;
  motivo: string | null;
}) => `${r.sku}|${normalizeAliasKey(r.kam ?? '')}|${r.cliente}|${r.fecha}|${r.motivo ?? ''}`;
const embarqueKey = (e: { oc_po: string | null; sku: string }) => `${e.oc_po ?? ''}|${e.sku}`;

/** fuente lógica del snapshot (idempotencia + prev por fuente). */
export function fuenteOf(job: IngestJob): string {
  return job.source === 'aduana' || job.source === 'embarques' ? 'aduana' : 'stock';
}

// ------------------------------------------------------------
// [REPRODUCIBILIDAD · G4] `periodo` se deriva en la zona CIVIL de México.
//
// LA CADENA MEDIDA, un solo eslabón:
//
//   app/api/refresh/archivo/route.ts:124
//       capturedAt: new Date().toISOString()   ← un instante, en UTC
//   aquí (antes)
//       periodo = capturedAt.slice(0, 10).slice(0, 7)  ← recortaba ESE UTC
//
// Recortar el ISO recorta UTC. Con México hoy 6h detrás de UTC, a partir de
// las 18:00 CDMX el instante ya cayó en el día UTC siguiente; si además es el
// último día del mes, en el MES siguiente: una ingesta de las 20:00 del
// 31-jul quedaba sellada como '2026-08'. Afectaba a
// snapshots de las 18:00 en adelante del último día del mes. Los corrige la
// migración 0023 — DESPUÉS de que esto se despliegue.
//
// El arreglo NO se apoya en que el desfase sea constante (no lo es: México
// tuvo horario de verano hasta oct-2022, y `2021-08-01T05:30:00Z` cae en
// agosto en México, no en julio). Se apoya en declarar la ZONA IANA y dejar
// que la base de datos de zonas ponga la regla de cada fecha. Por eso el
// resultado coincide con `AT TIME ZONE 'America/Mexico_City'` del backfill.
//
// El derivador NO vive aquí sino en `@/lib/fechas`, junto a `hoyMexico()`,
// que hace el mismo corrimiento sobre el instante de ahora. Es una de las
// dos casas autorizadas por el alambre-trampa de F6
// (`una-sola-verdad-temporal.test.ts`): un `Intl.DateTimeFormat` dentro de
// un servicio es media verdad temporal, y esa regla es justamente la que
// evita que este bug tenga hermanos. La primera versión de este fix sí lo
// puso aquí y la suite lo cazó.
//
// NO se toca `formatoPeriodoCorto`: pinta fielmente lo que recibe; el
// valor equivocado se estampaba aquí, no allá.
//
// OJO — `periodo` tiene DOS consumidores dentro de `computeSnapshot`, y el
// segundo es fácil de pasar por alto:
//   1. `payload.periodo` → la columna `snapshots.periodo`.
//   2. el relleno `${periodo}-01` de las reservas SIN fecha en la hoja
//      (fix O5). Corregir `periodo` corrige también esa fecha, que es lo
//      correcto: pertenecen al mismo corte. Ver
//      `periodo.derivacion-civil.test.ts` caso A.
// ------------------------------------------------------------

function invert(map: Map<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Array.from(map)) if (!out.has(v)) out.set(v, k);
  return out;
}

export interface ComputeResult {
  payload: SnapshotPayload;
  result: Omit<EtlResult, 'snapshotId'>;
  snapshotHash: string;
}

/**
 * Núcleo determinista: parse → normalize → reconcile → gates →
 * hash → differ. No consulta la BD (recibe CatalogIndex + PrevState).
 */
export function computeSnapshot(
  job: IngestJob,
  idx: CatalogIndex,
  prev: PrevState,
  // [REPRODUCIBILIDAD · S7-A] Escape hatch — SOLO lo arma la ruta, tras
  // validar las tres cabeceras completas. `undefined` = sin forzar.
  forzado?: ForzadoUniverso,
): ComputeResult {
  const cuarentena: QuarantineItem[] = [];
  let diag: DiagItem[] = [];

  const fuente = fuenteOf(job);

  const marcasNuevasSet = new Set<string>();
  const familiasNuevasSet = new Set<string>();
  const idToMarca = invert(idx.marcaByNombre);
  const idToFamilia = invert(idx.familiaByNombre);

  // (G4) Zona CIVIL de México, no UTC — ver `periodoDeCaptura` arriba.
  const periodo = periodoDeCaptura(job.capturedAt);

  let productoRows: ProductoRow[] = [];
  let stockRows: StockRow[] = [];
  let reservaRows: ReservaRow[] = [];
  let embarqueRows: EmbarqueRow[] = [];
  const cambios: CambioNuevo[] = [];

  // ---------- Selección de pipeline por job.source (A1) ----------
  // El pipeline se decide por la FUENTE, no por la presencia de datasets.
  // Guarda defensiva (segundo cinturón; el route ya rechaza legacy de una
  // sola hoja de stock con 400): jamás persistir snapshot vacío ni generar
  // BAJA masiva por datasets ausentes.
  const isStock = job.source === 'stock';
  const isAduana = job.source === 'aduana' || job.source === 'embarques';
  if (!isStock && !isAduana) {
    throw new EtlContractError(
      `fuente '${job.source}' no admitida en runEtl: la carga de una sola hoja de stock debe rechazarse en el route con 400`,
    );
  }
  if (isStock && (!job.inventario || !job.west || !job.reserva)) {
    throw new EtlContractError(
      "fuente 'stock' requiere los 3 datasets (inventario + west + reserva); faltan hojas → no se persiste snapshot",
    );
  }
  if (isAduana && (!job.embarques || job.embarques.length === 0)) {
    throw new EtlContractError("fuente 'aduana' requiere el dataset embarques (>= 1 hoja)");
  }

  // ---------- Pipeline STOCK (inventario + west + reserva) ----------
  if (isStock && job.inventario) {
    const inv = parseInventario(job.inventario);
    const west = job.west ? parseWest(job.west) : { rows: [], cuarentena: [] };
    const reservaParsed = job.reserva ? parseReserva(job.reserva) : { reservas: [], cuarentena: [] };

    cuarentena.push(...inv.cuarentena, ...west.cuarentena, ...reservaParsed.cuarentena);

    const rec = reconcile({ productos: inv.productos, stock: inv.stock }, west.rows);
    cuarentena.push(...rec.cuarentena);

    const validSkus = new Set(rec.productos.map((p) => p.sku));
    const reservaRef = checkReferential(reservaParsed.reservas, validSkus, 'reserva');
    cuarentena.push(...reservaRef.cuarentena);

    // Rellena fecha ausente ('') con el PERIODO (YYYY-MM-01), NO con
    // capturedAt exacto: con Power Automate corriendo cada ~15 min, usar
    // el día de captura rotaba esta fecha en cada corrida y rompía la
    // idempotencia (el differ veía una clave de reserva nueva → snapshot
    // "distinto" sin que hubiera cambio real). periodo-01 es estable
    // dentro del mes (bug hallado por O5 de B-PARCHE, ratificado
    // 2026-07-17; ruido residual de UNA rotación al mes documentado en
    // `docs/known-limitations.md` (BP-9)).
    const reservasOk = reservaRef.ok.map((r) => ({
      ...r,
      fecha: r.fecha === '' ? `${periodo}-01` : r.fecha,
    }));

    const gates = runGates(rec.productos, rec.stock, reservasOk);
    diag = gates.diag;
    cuarentena.push(...gates.cuarentena);

    // Filas resueltas (marca/familia → id o alta).
    productoRows = rec.productos.map((p) => {
      // Regla: 'WEST' en MARCA = almacén, no marca → catch-all NACIONAL.
      const marcaRaw = normalizeMarcaNombre(p.marca) === 'WEST' ? MARCA_FALLBACK_WEST : p.marca;
      const mr = resolveMarca(marcaRaw, idx);
      let marca: string;
      let marca_id: string | null;
      if (mr.marca_id) {
        marca_id = mr.marca_id;
        marca = idToMarca.get(mr.marca_id) ?? p.marca;
      } else {
        marca_id = null;
        marca = mr.nueva ?? p.marca;
        if (marca) marcasNuevasSet.add(marca);
      }
      const fr = resolveFamilia(p.familia, idx);
      let familia: string | null = null;
      let familia_id: string | null = null;
      if (fr) {
        if (fr.familia_id) {
          familia_id = fr.familia_id;
          familia = idToFamilia.get(fr.familia_id) ?? p.familia;
        } else if (fr.nueva) {
          familia = fr.nueva;
          familiasNuevasSet.add(fr.nueva);
        }
      }
      return {
        sku: p.sku,
        marca,
        marca_id,
        tecnologia: p.tecnologia,
        producto: p.producto,
        familia,
        familia_id,
        class: p.class,
        descr_origen: p.descr,
        cliente: p.cliente,
        resv: p.resv,
      };
    });

    stockRows = rec.stock.map((s) => ({
      sku: s.sku,
      almacen: s.almacen,
      almacen_id: resolveAlmacen(s.almacen as ClaveAlmacen, idx),
      cantidad: s.cantidad,
    }));

    reservaRows = reservasOk.map((r) => ({
      sku: r.sku,
      kam: r.kam,
      kam_id: resolveKam(r.kam, idx),
      cliente: r.cliente,
      cantidad: r.cantidad,
      motivo: r.motivo,
      fecha: r.fecha,
    }));

    // Differ (contra el snapshot vigente de la misma fuente).
    // [CAT-B1·A] Los dos campos nuevos van tambien AQUI, y no es redundante con
    // `productoRows`: este es el lado NUEVO del diff. Si estuvieran en `prev`
    // (persist.ts) y no aqui, el diff veria `'BRAND1'` contra `undefined` en cada
    // corrida y emitiria una MODIFICACION falsa por SKU, para siempre.
    const nextProductos: ProductoCanon[] = productoRows.map((p) => ({
      sku: p.sku,
      marca: p.marca,
      tecnologia: p.tecnologia,
      producto: p.producto,
      familia: p.familia,
      class: p.class,
      descr: p.descr_origen,
      cliente: p.cliente,
      resv: p.resv,
      totalFuente: 0,
    }));
    cambios.push(
      // [CAT-B1·A] Esta lista es `(keyof T)[]`: `tsc` valida que el nombre EXISTA,
      // jamas que la lista este COMPLETA. Agregar el campo al tipo y olvidarlo
      // aqui compila verde, pasa el gancho y pasa la suite — y el ALTA tampoco lo
      // llevaria, porque `diffEntity` serializa exactamente estos campos.
      ...diffEntity(prev.productos, nextProductos, skuKey, ['marca', 'tecnologia', 'producto', 'familia', 'class', 'descr', 'cliente', 'resv'], 'producto'),
      ...diffEntity(
        prev.stock,
        stockRows.map((s) => ({ sku: s.sku, almacen: s.almacen, cantidad: s.cantidad })),
        stockKey,
        ['cantidad'],
        'stock',
      ),
      ...diffEntity(
        prev.reservas,
        reservaRows.map((r) => ({
          sku: r.sku,
          // Simetría nuevo↔previo (fix idempotencia, ratificado 2026-07-19):
          // loadPrevState (persist.ts) reconstruye el kam previo vía JOIN
          // `kams(nombre)` sobre kam_id; si kam_id es null (KAM ausente del
          // catálogo, p.ej. 'RETAILER24'/'NADIA') el JOIN no aporta fila y el
          // previo llega con kam=null — NUNCA el texto crudo del Excel. Se
          // espeja aquí: el lado NUEVO de la clave también usa kam=null en
          // ese caso; solo se conserva el texto crudo cuando kam_id sí
          // resolvió (ahí normalizeAliasKey iguala mayúsculas/acentos entre
          // el crudo y el nombre canónico de kams). Evita claves asimétricas
          // que generaban ALTA+BAJA fantasma en cada re-POST (flap).
          kam: r.kam_id === null ? null : r.kam,
          cliente: r.cliente,
          cantidad: r.cantidad,
          motivo: r.motivo,
          fecha: r.fecha,
        })),
        reservaKey,
        ['cantidad'],
        'reserva',
      ),
    );
  }

  // ---------- Pipeline ADUANA (embarques) ----------
  if (isAduana && job.embarques) {
    const emb = parseEmbarques(job.embarques);
    cuarentena.push(...emb.cuarentena);

    const resolved: EmbarqueRow[] = [];
    for (const e of emb.embarques) {
      const orden = resolveEstatus(e.estatus, idx);
      if (orden === null) {
        cuarentena.push({
          entidad: 'embarque',
          clave: embarqueKey(e),
          sku: e.sku,
          motivo: 'embarque_estatus_no_resuelto',
          origen: { hoja: 'Embarques' },
          detalle: { estatus: e.estatus },
        });
        continue;
      }
      resolved.push({ ...e, estatus_id: orden });
    }

    const ref = checkReferential(resolved, prev.existingSkus, 'embarque');
    cuarentena.push(...ref.cuarentena);
    embarqueRows = ref.ok;

    // Históricos: ALTA en primera aparición (conjunto completo); MOD/BAJA
    // solo sobre activos. Ver diffEmbarques (spec §6).
    cambios.push(...diffEmbarques(prev.embarques, embarqueRows));
  }

  // ---------- [REPRODUCIBILIDAD · S7-A] Guarda de universo entrante ----------
  // Mecanismo (medición completa, tabla de pisos y las dos notas
  // textuales en la cabecera del módulo — no se repiten aquí para
  // no poder divergir de esa versión).
  //
  // EXCEPCIÓN P17 ("el universo vacío que pasa por resuelto",
  // `docs/engineering/failure-patterns.md`): si `prev.snapshotId === null` o
  // `filasPrevias === 0`, la guarda NO APLICA — sin vigente anterior no
  // hay delta que medir. Un universo vacío nunca es evidencia de que el
  // trabajo ya se hizo.
  const filasPreviasUniverso = filasDelUniverso(prev);
  const universoPrevioAplica = prev.snapshotId !== null && filasPreviasUniverso > 0;

  let universoForzado = false;
  let forzadoPorFinal: string | null = null;
  let forzadoMotivoFinal: string | null = null;

  if (universoPrevioAplica) {
    const filasEntrantesUniverso = filasDelUniverso({
      productos: productoRows,
      stock: stockRows,
      reservas: reservaRows,
      embarques: embarqueRows,
    });
    const proporcion = filasEntrantesUniverso / filasPreviasUniverso;

    // Esta guarda caza el VACIADO, no el DEGRADADO (Enmienda 3,
    // textual): "Un archivo con todas sus filas y una columna renombrada
    // da 100 % de universo y pasa limpio. El degradado sigue siendo
    // responsabilidad de F2/F3 y sigue abierto. Que esta guarda esté
    // verde no es cobertura de P11."
    if (proporcion < UMBRAL_UNIVERSO_MINIMO) {
      // Señal observable del rechazo (exigida por
      // `ingesta-vacia.test.ts`): SIEMPRE se registra, se fuerce o no.
      console.error(
        `[computeSnapshot] universo reducido: fuente=${fuente} filasPrevias=${filasPreviasUniverso} filasEntrantes=${filasEntrantesUniverso}`,
      );

      if (forzado) {
        // Escape hatch (Enmienda 2) — SOLO por decisión explícita
        // de quien ingesta, nunca automático. `forzado.por` es una
        // identidad AUTO-DECLARADA, NO AUTENTICADA: las dos rutas
        // autentican con INGEST_SECRET compartido, no con sesión de
        // usuario.
        console.warn(
          `[computeSnapshot] universo reducido FORZADO: fuente=${fuente} filasPrevias=${filasPreviasUniverso} filasEntrantes=${filasEntrantesUniverso} por="${forzado.por}" motivo="${forzado.motivo}"`,
        );
        universoForzado = true;
        forzadoPorFinal = forzado.por;
        forzadoMotivoFinal = forzado.motivo;
      } else {
        throw new UniversoReducidoError({
          fuente,
          filasPrevias: filasPreviasUniverso,
          filasEntrantes: filasEntrantesUniverso,
          umbral: UMBRAL_UNIVERSO_MINIMO,
        });
      }
    }
  }

  // ---------- Hash canónico (contenido, sin capturedAt/archivo) ----------
  const hashSet: unknown[] = [
    // [CAT-B1·A] El HASH es la puerta, no el diff: si un campo no entra aqui, un
    // archivo en el que SOLO cambio TECNOLOGIA da el mismo `snapshotHash`,
    // `sinCambios` sale true y el ETL devuelve el snapshot previo SIN PERSISTIR.
    // Ni error, ni fila escrita, ni rastro. Es el olvido mas caro de este archivo.
    ...productoRows.map((p) => ({ _e: 'p', sku: p.sku, marca: p.marca, tecnologia: p.tecnologia, producto: p.producto, familia: p.familia, class: p.class, descr: p.descr_origen, cliente: p.cliente, resv: p.resv })),
    ...stockRows.map((s) => ({ _e: 's', sku: s.sku, almacen: s.almacen, cantidad: s.cantidad })),
    ...reservaRows.map((r) => ({ _e: 'r', sku: r.sku, kam: r.kam, cliente: r.cliente, cantidad: r.cantidad, motivo: r.motivo, fecha: r.fecha })),
    ...embarqueRows.map((e) => ({
      _e: 'e', sku: e.sku, oc_po: e.oc_po, estatus_id: e.estatus_id, is_historial: e.is_historial,
      piezas: e.piezas, referencia: e.referencia, factura: e.factura, pais_origen: e.pais_origen,
      fw: e.fw, tipo_importacion: e.tipo_importacion, proyecto: e.proyecto, observaciones: e.observaciones,
      fecha_recoleccion: e.fecha_recoleccion, etd: e.etd, eta: e.eta, fecha_llegada: e.fecha_llegada, fecha_disponibilidad: e.fecha_disponibilidad,
    })),
  ];
  const snapshotHash = hashRows(hashSet);

  const sinCambios = prev.hash !== null && prev.hash === snapshotHash;

  const payload: SnapshotPayload = {
    fuente,
    periodo,
    archivo: job.archivo,
    capturedAt: job.capturedAt,
    hash: snapshotHash,
    createdBy: null,
    marcasNuevas: Array.from(marcasNuevasSet),
    familiasNuevas: Array.from(familiasNuevasSet),
    productos: productoRows,
    stock: stockRows,
    reservas: reservaRows,
    embarques: embarqueRows,
    cambios: sinCambios ? [] : cambios,
    forzadoPor: forzadoPorFinal,
    forzadoMotivo: forzadoMotivoFinal,
  };

  const result: Omit<EtlResult, 'snapshotId'> = {
    // `computeSnapshot` es PURA: no toca la red, así que no puede saber si
    // hubo reintentos. Arranca vacío y `runEtl` lo sobreescribe con el
    // rastro real del cliente justo antes de devolver.
    resiliencia: RASTRO_VACIO,
    sinCambios,
    source: job.source,
    conteos: {
      productos: productoRows.length,
      stock: stockRows.length,
      reservas: reservaRows.length,
      embarques: embarqueRows.length,
      cambios: sinCambios ? 0 : cambios.length,
    },
    cuarentena: { total: cuarentena.length, items: cuarentena },
    diag,
    universoForzado,
  };

  return { payload, result, snapshotHash };
}

export interface EtlDeps {
  db: SupabaseClient;
  now?: () => Date;
  createdBy?: string | null;
  /**
   * [REPRODUCIBILIDAD · S7-A] Escape hatch de la guarda de universo
   * reducido — SOLO lo arma la ruta HTTP tras validar las tres cabeceras
   * completas (`src/lib/api/forzar-universo.ts`). Nunca automático,
   * nunca por variable de entorno ni valor por defecto.
   */
  forzado?: ForzadoUniverso;
}

/**
 * Orquestador con efectos: reads (catálogo + prev) → computeSnapshot →
 * (si hay cambios) persistSnapshot. Único punto que conoce la BD.
 */
export async function runEtl(job: IngestJob, deps: EtlDeps): Promise<EtlResult> {
  const { db } = deps;
  const fuente = fuenteOf(job);
  const [idx, prev] = await Promise.all([
    loadCatalogIndex(db),
    loadPrevState(db, fuente),
  ]);

  const { payload, result } = computeSnapshot(job, idx, prev, deps.forzado);

  // [MVP-CIERRE] F1 · el rastro se lee DESPUÉS de todas las lecturas y
  // ANTES de devolver, en los dos caminos de salida. Si esto solo se
  // pusiera en el camino "con cambios", una corrida que se auto-curó y
  // terminó en `sinCambios` reportaría cero reintentos — que es
  // exactamente el silencio que este bloque existe para romper.
  const conRastro = <T extends { resiliencia: unknown }>(r: T): T => ({
    ...r,
    resiliencia: rastroDe(db),
  });

  if (result.sinCambios) {
    return conRastro({ ...result, snapshotId: prev.snapshotId });
  }

  payload.createdBy = deps.createdBy ?? null;
  try {
    const { snapshotId } = await persistSnapshot(db, payload);
    return conRastro({ ...result, snapshotId });
  } catch (e) {
    // [ING-B1 · O-1] «Ya tengo este contenido» SALE POR EL MISMO CAMINO que el
    // `sinCambios` legítimo: 200, sin fila escrita, mismo cuerpo. Se resuelve
    // AQUÍ y no en las dos rutas para que las dos lo hereden idéntico -- una
    // sola verdad sobre qué responde el portal cuando no hay nada nuevo.
    //
    // ⚠ Y el motivo NO es el mismo que el de arriba, aunque el síntoma sí:
    //   sinCambios arriba  -> `prev.hash` y el hash entrante COINCIDEN
    //   sinCambios aquí    -> NO coinciden, y aun así la base ya tiene ese hash
    // Lo segundo sólo puede pasar si `prev` se hasheó con OTRA receta que la de
    // este código. Medido en producción: el build desplegado tenía un
    // hashSet que NO incluía `tecnologia` ni `producto`, contra una fila escrita
    // antes por un build que SÍ los incluía. Por eso `causaProbable` viaja en
    // el cuerpo: el HTTP no puede distinguirlas y un humano tiene que poder.
    if (e instanceof SnapshotDuplicadoError) {
      const mismaReceta = prev.hash === payload.hash;
      return conRastro({
        ...result,
        snapshotId: prev.snapshotId,
        sinCambios: true,
        duplicado: {
          hash: payload.hash,
          constraint: e.constraint,
          causaProbable: (mismaReceta ? 'archivo_repetido' : 'receta_del_hash') as 'archivo_repetido' | 'receta_del_hash',
          mensaje: e.message,
        },
      });
    }
    throw e;
  }
}
