// ============================================================
// Bloque 2 · ETL · persist.ts  (EFECTOS — service_role)
// Único módulo del ETL que toca la BD.
//   - loadCatalogIndex / loadPrevState  → SELECTs (reads).
//   - buildIngestPayload                → constructor PURO del jsonb.
//   - persistSnapshot                   → RPC transaccional atómico
//     `ingest_snapshot` (0005). Decisión de producto: atomicidad vía RPC.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CatalogIndex,
  PrevState,
  SnapshotPayload,
  ProductoCanon,
  StockCanon,
  ReservaCanon,
  EmbarqueRow,
  ClaveAlmacen,
} from './types';
import { normalizeAliasKey, normalizeMarcaNombre } from './normalize';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { SnapshotDuplicadoError, CONSTRAINT_HASH_UNICO } from './errors';

/** Devuelve el nombre de la relación embebida (objeto u array → objeto). */
function embedName(rel: unknown): string | null {
  if (rel == null) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'nombre' in obj) {
    const v = (obj as { nombre: unknown }).nombre;
    return typeof v === 'string' ? v : null;
  }
  return null;
}
function embedClave(rel: unknown): string | null {
  if (rel == null) return null;
  const obj = Array.isArray(rel) ? rel[0] : rel;
  if (obj && typeof obj === 'object' && 'clave' in obj) {
    const v = (obj as { clave: unknown }).clave;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

/**
 * Aborta la carga si el SELECT de un catálogo falló. Fix (precarga traga
 * errores): antes, ningún `.error` de los 6 SELECTs se revisaba, y un
 * fallo transitorio (p.ej. "JWT issued at future" tras arranque frío)
 * construía el índice VACÍO en silencio vía `data ?? []` — riesgo real:
 * estatus_alias vacío en un POST de aduana cuarentenaría TODOS los
 * embarques en silencio y produciría un snapshot envenenado
 * válido-en-apariencia.
 */
function assertCatalogoOk(tabla: string, res: { error: { message: string } | null }): void {
  if (res.error) {
    throw new Error(`catalogos_no_disponibles: ${tabla}: ${res.error.message}`);
  }
}

/**
 * Gemela de assertCatalogoOk para los SELECTs de `loadPrevState` (fix
 * ratificado 2026-07-19, mismo patrón): ninguno revisaba `.error`, y un
 * fallo transitorio degradaba en silencio vía `.data ?? []` — existingSkus
 * vacío hace que checkReferential cuarentene TODOS los embarques (snapshot
 * envenenado); productos/stock/reservas vacíos degradan a "prev vacío" y
 * producen una ALTA masiva falsa contra un snapshot vigente real. Prefijo
 * `prev_state_no_disponible` (distinto de `catalogos_no_disponibles`) para
 * diagnóstico. OJO: "no hay snapshot previo aún" (tabla `snapshots` vacía /
 * sin fila vigente para la fuente) es LEGÍTIMO — solo un `.error` real
 * dispara esta guarda, nunca `data` vacío sin error.
 *
 * [FIX-B2] Desde este bloque sólo la usa la lectura de `snapshots` (una fila).
 * Las cinco lecturas de FILAS pasan por `leerPrevCompleto`, que produce el
 * mismo prefijo.
 */
function assertPrevOk(tabla: string, res: { error: { message: string } | null }): void {
  if (res.error) {
    throw new Error(`prev_state_no_disponible: ${tabla}: ${res.error.message}`);
  }
}

/**
 * [FIX-B2] La gemela de `assertPrevOk` para las lecturas PAGINADAS.
 *
 * `fetchAllRows` lanza `Error(error.message)` a secas en la primera página que
 * traiga `.error`; aquí se le antepone el mismo prefijo `prev_state_no_disponible:
 * <tabla>:` que produce `assertPrevOk`, para que el diagnóstico no cambie según
 * la página en la que tropezó la lectura. Envuelve CUALQUIER rechazo de la
 * lectura, no sólo el `.error` de PostgREST: los dos significan lo mismo para
 * la carga —el estado previo no se pudo leer entero— y los dos la abortan.
 */
async function leerPrevCompleto<T>(tabla: string, lectura: Promise<T[]>): Promise<T[]> {
  try {
    return await lectura;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    throw new Error(`prev_state_no_disponible: ${tabla}: ${mensaje}`);
  }
}

/** Valor de una lectura ya asentada, o su error (ya prefijado por `leerPrevCompleto`). */
function cumplida<T>(r: PromiseSettledResult<T>): T {
  if (r.status === 'rejected') {
    throw r.reason instanceof Error ? r.reason : new Error(String(r.reason));
  }
  return r.value;
}

// [FIX-B2] Forma de cada fila tal como la pide su SELECT en `loadPrevState`
// (columnas en `0001_schema.sql` y `0036`). Los embebidos (`marcas(nombre)`,
// `almacenes(clave)`, …) quedan `unknown` porque PostgREST los entrega como
// objeto o como arreglo, y `embedName`/`embedClave` ya resuelven las dos formas.
interface FilaSkuPrev {
  sku: string;
}
interface FilaEmbarquePrev {
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
  estatus_catalogo: unknown;
  estatus_id: number;
  proyecto: string | null;
  observaciones: string | null;
  is_historial: boolean;
}
interface FilaProductoPrev {
  sku: string;
  tecnologia: string | null;
  producto: string | null;
  class: string | null;
  descr_origen: string | null;
  cliente: string | null;
  resv: number | null;
  marcas: unknown;
  familias: unknown;
}
interface FilaStockPrev {
  sku: string;
  cantidad: number | null;
  almacenes: unknown;
}
interface FilaReservaPrev {
  sku: string;
  cliente: string;
  cantidad: number | null;
  motivo: string | null;
  fecha: string;
  kams: unknown;
}

/**
 * Carga los catálogos y arma los mapas de resolución PURA.
 *
 * [FIX-B2] Estas siete lecturas NO se paginan, y es una decisión medida, no un
 * olvido: PostgREST corta en 1 000 filas, y ninguna tabla de catálogo está
 * cerca (todas muy por debajo
 * del tope). La única que crece sola es `familias` (alta automática de
 * familia nueva en cada carga); si algún día se acerca a 1 000, se pagina con
 * `fetchAllRows` y un orden TOTAL (su llave primaria), igual que `loadPrevState`.
 */
export async function loadCatalogIndex(
  db: SupabaseClient,
): Promise<CatalogIndex> {
  const [marcas, alias, familias, almacenes, kams, estatusAlias, familiaAlias] =
    await Promise.all([
      db.from('marcas').select('id,nombre'),
      db.from('marca_alias').select('alias,marca_id'),
      db.from('familias').select('id,nombre'),
      db.from('almacenes').select('id,clave'),
      db.from('kams').select('id,nombre'),
      db.from('estatus_alias').select('alias,orden'),
      db.from('familia_alias').select('alias,familia_id'),
    ]);

  // Ver assertCatalogoOk: aborta ANTES de armar el índice si CUALQUIERA de
  // los 6 SELECTs falló (el route ya convierte throws en 500 limpio).
  assertCatalogoOk('marcas', marcas);
  assertCatalogoOk('marca_alias', alias);
  assertCatalogoOk('familias', familias);
  assertCatalogoOk('almacenes', almacenes);
  assertCatalogoOk('kams', kams);
  assertCatalogoOk('estatus_alias', estatusAlias);

  // ([MVP-2] C) `familia_alias` es el ÚNICO catálogo que se tolera ausente,
  // y solo por la razón concreta de que la 0018 puede no estar aplicada
  // todavía: el código se despliega antes que la migración, y sin esta
  // degradación la PRIMERA corrida de Power Automate tras el deploy moriría
  // con `catalogos_no_disponibles`. Es el mismo patrón que B6 ya usó para
  // `pendientes_datos` (`esNoDisponiblePorMigracion`, PGRST202/PGRST205 —
  // NO 42P01, que fue el fix crítico de aquel bloque). Sin alias, el índice
  // queda vacío y `resolveFamilia` se comporta EXACTAMENTE como antes de
  // este bloque: degradación a la conducta previa, no a una nueva.
  // Cualquier OTRO error sí es fatal, igual que los 6 de arriba.
  if (familiaAlias.error && !esNoDisponiblePorMigracion(familiaAlias.error)) {
    assertCatalogoOk('familia_alias', familiaAlias);
  }

  const idx: CatalogIndex = {
    marcaAlias: new Map(),
    marcaByNombre: new Map(),
    familiaAlias: new Map(),
    familiaByNombre: new Map(),
    almacenByClave: new Map(),
    kamByNombre: new Map(),
    estatusAlias: new Map(),
  };

  for (const m of marcas.data ?? []) {
    const nombre = normalizeMarcaNombre(String(m.nombre));
    if (nombre) idx.marcaByNombre.set(nombre, String(m.id));
  }
  for (const a of alias.data ?? []) {
    idx.marcaAlias.set(normalizeAliasKey(String(a.alias)), String(a.marca_id));
  }
  for (const f of familias.data ?? []) {
    const nombre = normalizeMarcaNombre(String(f.nombre));
    if (nombre) idx.familiaByNombre.set(nombre, String(f.id));
  }
  for (const a of familiaAlias.data ?? []) {
    idx.familiaAlias.set(normalizeAliasKey(String(a.alias)), String(a.familia_id));
  }
  for (const a of almacenes.data ?? []) {
    idx.almacenByClave.set(String(a.clave), String(a.id));
  }
  for (const k of kams.data ?? []) {
    idx.kamByNombre.set(normalizeAliasKey(String(k.nombre)), String(k.id));
  }
  for (const e of estatusAlias.data ?? []) {
    idx.estatusAlias.set(normalizeAliasKey(String(e.alias)), Number(e.orden));
  }

  return idx;
}

/**
 * Estado del snapshot vigente por fuente (para differ + idempotencia).
 *
 * [FIX-B2] TODA lectura de filas de aquí pasa por `fetchAllRows` con un orden
 * TOTAL. Antes eran SELECT a secas, y PostgREST devuelve como máximo 1 000
 * filas por respuesta SIN error ni aviso. Medido en producción:
 * `productos` rebasó el tope (las filas del vigente más algunos remanentes), el
 * `existingSkus` de abajo quedó incompleto, y `checkReferential` (gates.ts)
 * mandó a cuarentena en silencio embarques de varios SKU en una carga de
 * aduana. Las otras tres tablas van al mismo tope y estaban cerca de él.
 *
 * Y el orden no es adorno: `.range` es `LIMIT/OFFSET`, y sin un `ORDER BY`
 * único Postgres no promete que la página 2 no repita filas de la 1 ni se
 * salte otras (el orden total es requisito de toda lectura paginada). Cada lectura dice abajo por qué su orden es total.
 *
 * La lectura de `snapshots` sigue sin paginar a propósito: pide UNA fila.
 */
export async function loadPrevState(
  db: SupabaseClient,
  fuente: string,
): Promise<PrevState> {
  const empty: PrevState = {
    snapshotId: null,
    hash: null,
    productos: [],
    stock: [],
    reservas: [],
    embarques: [],
    existingSkus: new Set(),
  };

  // La tabla ENTERA, sin filtro de snapshot —incluye los remanentes, igual que
  // antes de FIX-B2—: es el universo contra el que `checkReferential` acepta el
  // SKU de un embarque. `sku` es la PK de `productos`: orden total.
  const filasSku = await leerPrevCompleto(
    'productos',
    fetchAllRows<FilaSkuPrev>((from, to) =>
      db.from('productos').select('sku').order('sku', { ascending: true }).range(from, to),
    ),
  );
  const existingSkus = new Set<string>(filasSku.map((r) => String(r.sku)));

  const snapRes = await db
    .from('snapshots')
    .select('id,hash')
    .eq('fuente', fuente)
    .order('created_at', { ascending: false })
    .limit(1);
  assertPrevOk('snapshots', snapRes);
  // Sin fila: "no hay snapshot previo aún" (primera carga) — LEGÍTIMO, no error.
  const snap = (snapRes.data ?? [])[0];
  if (!snap) return { ...empty, existingSkus };

  const snapshotId = String(snap.id);
  const hash = String(snap.hash);

  if (fuente === 'aduana') {
    // `id` es la PK de `embarques` (uuid): orden total. El orden de este arreglo
    // no cambia el diff: `diffEmbarques` colapsa por `oc_po|sku` al mayor
    // `estatus_id`, y entre empates sólo compara `estatus`, que sale de ese id.
    const filasEmb = await leerPrevCompleto(
      'embarques',
      fetchAllRows<FilaEmbarquePrev>((from, to) =>
        db
          .from('embarques')
          .select('*, estatus_catalogo(nombre)')
          .eq('snapshot_id', snapshotId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    );
    const embarques: EmbarqueRow[] = filasEmb.map((e) => ({
      sku: String(e.sku),
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
      eta: e.eta ?? null,
      fecha_llegada: e.fecha_llegada ?? null,
      fecha_disponibilidad: e.fecha_disponibilidad ?? null,
      estatus: embedName(e.estatus_catalogo) ?? '',
      estatus_id: Number(e.estatus_id),
      proyecto: e.proyecto ?? null,
      observaciones: e.observaciones ?? null,
      is_historial: Boolean(e.is_historial),
    }));
    return { snapshotId, hash, productos: [], stock: [], reservas: [], embarques, existingSkus };
  }

  // fuente 'stock' (o legacy inventario/west/reserva)
  //
  // `allSettled` y no `all`, para conservar la semántica de antes de FIX-B2: se
  // esperan las tres lecturas y, si fallan varias, se reporta la PRIMERA en este
  // orden fijo (productos · stock_por_almacen · reservas), no la que rechace antes.
  const [prod, stk, rsv] = await Promise.allSettled([
    // `sku` es la PK de `productos`: orden total.
    leerPrevCompleto(
      'productos',
      fetchAllRows<FilaProductoPrev>((from, to) =>
        db
          .from('productos')
          // [CAT-B1·A] Lado IZQUIERDO del diff. Es una CADENA: `tsc` no la mira. Si la
          // columna existe en la base pero no se pide aqui, `prev` llega con el campo
          // en `undefined` para siempre y el diff emite MODIFICACION en cada corrida.
          .select('sku,tecnologia,producto,class,descr_origen,cliente,resv, marcas(nombre), familias(nombre)')
          .eq('snapshot_id', snapshotId)
          .order('sku', { ascending: true })
          .range(from, to),
      ),
    ),
    // `stock_por_almacen` NO tiene `id`: su PK es (sku, almacen_id, snapshot_id).
    // Con `snapshot_id` fijo por el filtro, (sku, almacen_id) es único — por eso
    // las DOS columnas. `sku` sola empata entre los almacenes de un mismo SKU, y
    // un empate que cae en el corte de página repite una fila y se salta otra.
    leerPrevCompleto(
      'stock_por_almacen',
      fetchAllRows<FilaStockPrev>((from, to) =>
        db
          .from('stock_por_almacen')
          .select('sku,cantidad, almacenes(clave)')
          .eq('snapshot_id', snapshotId)
          .order('sku', { ascending: true })
          .order('almacen_id', { ascending: true })
          .range(from, to),
      ),
    ),
    // `id` es la PK de `reservas` (uuid): orden total. OJO con lo que este orden
    // NO garantiza: `diffEntity` indexa el previo por `reservaKey` (runEtl.ts) y,
    // si dos filas compartieran esa clave, ganaría la ÚLTIMA — y cuál es la
    // última depende del orden. Medido en el vigente: ninguna clave
    // repetida entre las reservas, así que hoy el resultado no depende del orden.
    leerPrevCompleto(
      'reservas',
      fetchAllRows<FilaReservaPrev>((from, to) =>
        db
          .from('reservas')
          .select('sku,cliente,cantidad,motivo,fecha, kams(nombre)')
          .eq('snapshot_id', snapshotId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
  ]);
  const filasProd = cumplida(prod);
  const filasStk = cumplida(stk);
  const filasRsv = cumplida(rsv);

  const productos: ProductoCanon[] = filasProd.map((p) => ({
    sku: String(p.sku),
    marca: embedName(p.marcas) ?? '',
    // `?? null`, NO `?? ''`: `valStr` del differ distingue null de '', y una
    // cadena vacia de un lado contra null del otro es MODIFICACION eterna.
    tecnologia: p.tecnologia ?? null,
    producto: p.producto ?? null,
    familia: embedName(p.familias),
    class: p.class ?? null,
    descr: p.descr_origen ?? null,
    cliente: p.cliente ?? null,
    resv: Number(p.resv ?? 0),
    totalFuente: 0,
  }));

  const stock: StockCanon[] = filasStk.map((s) => ({
    sku: String(s.sku),
    almacen: (embedClave(s.almacenes) ?? 'NORTH') as ClaveAlmacen,
    cantidad: Number(s.cantidad ?? 0),
  }));

  const reservas: ReservaCanon[] = filasRsv.map((r) => ({
    sku: String(r.sku),
    kam: embedName(r.kams),
    cliente: String(r.cliente),
    cantidad: Number(r.cantidad ?? 0),
    motivo: r.motivo ?? null,
    fecha: String(r.fecha),
  }));

  return { snapshotId, hash, productos, stock, reservas, embarques: [], existingSkus };
}

/**
 * [REPRODUCIBILIDAD · S7-A] El denominador/numerador de la guarda de
 * universo entrante (`computeSnapshot`, `runEtl.ts`) y la columna
 * `snapshots.filas` de este mismo archivo (abajo) son LA MISMA
 * expresión, nombrada aquí para que no puedan divergir: si mañana
 * alguien agrega una entidad al snapshot, hay UN solo lugar que
 * actualizar, no dos que puedan quedar desincronizados.
 */
export function filasDelUniverso(u: {
  productos: ReadonlyArray<unknown>;
  stock: ReadonlyArray<unknown>;
  reservas: ReadonlyArray<unknown>;
  embarques: ReadonlyArray<unknown>;
}): number {
  return u.productos.length + u.stock.length + u.reservas.length + u.embarques.length;
}

/**
 * Constructor PURO del payload jsonb para el RPC `ingest_snapshot`.
 * Diseño resolver-por-nombre: viaja con NOMBRES/CLAVES canónicos
 * (marca, familia, almacen_clave, kam, estatus_orden); la función SQL
 * resuelve los FK dentro de la transacción. Sin ids de snapshot ni UUIDs.
 */
export function buildIngestPayload(p: SnapshotPayload): Record<string, unknown> {
  return {
    snapshot: {
      fuente: p.fuente,
      hash: p.hash,
      periodo: p.periodo,
      archivo: p.archivo,
      filas: filasDelUniverso(p),
      created_by: p.createdBy,
      // [REPRODUCIBILIDAD · S7-A] `null`/`null` salvo que la guarda de
      // universo reducido se haya disparado Y forzado explícitamente
      // (ver ForzadoUniverso en types.ts). La RPC `ingest_snapshot`
      // (0005) vigente IGNORA estas dos claves extra del jsonb
      // (inofensivo) hasta que se aplique la migración 0022
      // (S7-B), que agrega `snapshots.forzado_por`/`forzado_motivo` y
      // las persiste — mismo patrón que ya usa `kam` (B6 · encendido,
      // ver `reservas` más abajo).
      forzado_por: p.forzadoPor,
      forzado_motivo: p.forzadoMotivo,
    },
    marcasNuevas: p.marcasNuevas,
    familiasNuevas: p.familiasNuevas,
    // [CAT-B1·A] Contrato JS<->SQL y NADIE lo comprueba: la clave es una cadena
    // de este lado y un `p->>'...'` del otro. Si no coinciden, la RPC lee NULL y
    // lo escribe sin quejarse — la columna entra nula en todas las filas y todo lo
    // demas sigue verde. Los nombres de aqui son los que lee la 0036.
    productos: p.productos.map((x) => ({
      sku: x.sku,
      marca: x.marca,
      tecnologia: x.tecnologia,
      producto: x.producto,
      familia: x.familia,
      class: x.class,
      descr_origen: x.descr_origen,
      cliente: x.cliente,
      resv: x.resv,
    })),
    // Catálogos FIJOS (almacenes, kams): id resuelto en JS vía
    // normalizeAliasKey (una sola estrategia). El RPC usa el id directo →
    // sin regresión de acentos por re-resolver con upper(nombre).
    stock: p.stock.map((x) => ({
      sku: x.sku,
      almacen_id: x.almacen_id,
      cantidad: x.cantidad,
    })),
    reservas: p.reservas.map((x) => ({
      sku: x.sku,
      // `kam` (crudo, B6 · encendido): la RPC `ingest_snapshot` vigente (0005)
      // IGNORA esta clave extra del jsonb (inofensivo) hasta que se
      // aplique 0009, que la persiste en `reservas.kam_raw` y encola
      // `kam_desconocido` en `pendientes_datos` cuando `kam_id` es null.
      kam: x.kam,
      kam_id: x.kam_id,
      cliente: x.cliente,
      cantidad: x.cantidad,
      motivo: x.motivo,
      fecha: x.fecha,
    })),
    embarques: p.embarques.map((e) => ({
      sku: e.sku,
      oc_po: e.oc_po,
      proveedor: e.proveedor,
      referencia: e.referencia,
      factura: e.factura,
      pais_origen: e.pais_origen,
      piezas: e.piezas,
      fw: e.fw,
      tipo_importacion: e.tipo_importacion,
      fecha_recoleccion: e.fecha_recoleccion,
      etd: e.etd,
      eta: e.eta,
      fecha_llegada: e.fecha_llegada,
      fecha_disponibilidad: e.fecha_disponibilidad,
      estatus_orden: e.estatus_id,
      proyecto: e.proyecto,
      observaciones: e.observaciones,
      is_historial: e.is_historial,
    })),
    cambios: p.cambios.map((c) => ({
      entidad: c.entidad,
      clave: c.clave,
      sku: c.sku,
      campo: c.campo,
      valor_anterior: c.valor_anterior,
      valor_nuevo: c.valor_nuevo,
      tipo: c.tipo,
    })),
  };
}

/**
 * Escritura ATÓMICA del snapshot vía RPC transaccional `ingest_snapshot`
 * (0005). Una sola llamada: si cualquier statement falla, ROLLBACK total.
 * Corre con service_role (único rol con EXECUTE sobre la función).
 */
export async function persistSnapshot(
  db: SupabaseClient,
  payload: SnapshotPayload,
): Promise<{ snapshotId: string }> {
  const { data, error } = await db.rpc('ingest_snapshot', {
    payload: buildIngestPayload(payload),
  });
  if (error) {
    // [ING-B1 · O-1] UNA restricción se clasifica; el resto sigue siendo 500.
    //
    // `snapshots_hash_unique` significa «ya tengo este contenido», que NO es un
    // fallo del servidor. Se compara el NOMBRE de la restricción, no un trozo
    // del mensaje: un `includes('duplicate key')` atraparía también cualquier
    // otra unicidad de la transacción (productos, stock, reservas) y las
    // convertiría en 200 — el arreglo se volvería el silencio que vino a quitar.
    //
    // PostgREST no expone `constraint` como campo propio en este cliente, así
    // que el nombre se busca en `message`+`details`+`hint`, que es donde
    // Postgres lo pone literal. Si algún día viniera tipado, esta comparación
    // se mueve a ese campo y el predicado no cambia.
    const texto = `${error.message} ${error.details ?? ''} ${error.hint ?? ''}`;
    if (texto.includes(CONSTRAINT_HASH_UNICO)) {
      throw new SnapshotDuplicadoError(payload.hash, CONSTRAINT_HASH_UNICO, error.message);
    }
    // No se filtran secretos: solo el mensaje del RPC.
    throw new Error(`ingest_snapshot falló: ${error.message}`);
  }
  if (!data) {
    throw new Error('ingest_snapshot no devolvió snapshotId');
  }
  return { snapshotId: data as string };
}
