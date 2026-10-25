// ============================================================
// Bloque 2 · ETL · types.ts
// ÚNICA fuente de tipos canónicos del pipeline de ingesta.
// `adapter.ts`, `refresh.schema.ts`, `route.ts` y los módulos
// puros importan de aquí. PURO (sin efectos, sin imports de BD).
// ============================================================
import type { Cambio, ClaveAlmacen } from '@/types';

export type { ClaveAlmacen };

// ------------------------------------------------------------
// Representación cruda: matriz de celdas (grid). El parser
// localiza header y columnas por contenido, no por posición.
// ------------------------------------------------------------
export type Cell = string | number | boolean | null;
export type Grid = Cell[][];

/** Hoja nombrada (embarques es multi-hoja). */
export interface SheetGrid {
  hoja: string;
  grid: Grid;
}

// ------------------------------------------------------------
// Job canónico normalizado desde el body de /api/refresh.
// `adapter.toIngestJob` (otro subagente) lo produce.
// ------------------------------------------------------------
export interface IngestJob {
  source: 'stock' | 'aduana' | 'inventario' | 'west' | 'reserva' | 'embarques';
  capturedAt: string;
  archivo: string | null;
  inventario?: Grid;
  west?: Grid;
  reserva?: Grid;
  embarques?: SheetGrid[];
}

// ------------------------------------------------------------
// Tipos canónicos por entidad (salida de los parsers).
// ------------------------------------------------------------
export interface ProductoCanon {
  sku: string;
  marca: string;
  // [CAT-B1·A] Los dos niveles que el archivo YA traía y el parser descartaba
  // en silencio. NO son opcionales (`?`) a propósito: declarados obligatorios,
  // `tsc --noEmit` enumera solo cada sitio que construye un ProductoCanon y
  // hay que propagarlos. Con `?` ese trinquete se pierde y los sitios hay que
  // encontrarlos a mano — que es como se pierde un campo en una de las copias.
  tecnologia: string | null;
  producto: string | null;
  familia: string | null;
  class: string | null;
  descr: string | null;
  cliente: string | null;
  resv: number;
  totalFuente: number;
}

export interface StockCanon {
  sku: string;
  almacen: ClaveAlmacen;
  cantidad: number;
}

export interface ReservaCanon {
  sku: string;
  kam: string | null;
  cliente: string;
  cantidad: number;
  motivo: string | null;
  fecha: string;
}

export interface WestCanon {
  sku: string;
  prov: string;
  // [FIX-B1·T4] La hoja `INV WEST` SÍ trae estos tres campos (mismos
  // alias que `Inventario`: 'tecnologia', 'familia', ['class','clase']).
  // Obligatorios (sin `?`) por el MISMO motivo que `ProductoCanon` arriba:
  // `tsc --noEmit` enumera cada sitio que construye un `WestCanon` y
  // obliga a decidir el valor, en vez de perderlo en silencio.
  tecnologia: string | null;
  familia: string | null;
  class: string | null;
  descr: string | null;
  fisico: number;
}

export interface EmbarqueCanon {
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
  estatus: string;
  proyecto: string | null;
  observaciones: string | null;
  is_historial: boolean;
}

// ------------------------------------------------------------
// Cuarentena y diagnóstico (nunca se descarta ni bloquea el POST).
// ------------------------------------------------------------
export interface QuarantineItem {
  entidad: Cambio['entidad'];
  clave: string;
  sku: string | null;
  motivo: string;
  origen: { hoja: string; fila?: number; col?: number };
  detalle?: Record<string, unknown>;
}

// Import de TIPO (se borra en runtime, así que `types.ts` sigue siendo
// seguro de importar desde cualquier lado) + re-export para que los
// consumidores del ETL no tengan que conocer la ruta del cliente.
import type { RastroResiliencia } from '@/lib/supabase/reintento';
export type { RastroResiliencia, EventoReintento } from '@/lib/supabase/reintento';

export interface DiagItem {
  sku: string;
  tipo: 'SUMA_STOCK' | 'SUMA_RESERVAS';
  esperado: number;
  obtenido: number;
  delta: number;
}

// ------------------------------------------------------------
// Índice de catálogos precargado (para resolución PURA).
// ------------------------------------------------------------
export interface CatalogIndex {
  marcaAlias: Map<string, string>; // normalizeAliasKey(raw) → marca_id
  marcaByNombre: Map<string, string>; // UPPER(nombre) → marca_id
  /**
   * ([MVP-2] C) normalizeAliasKey(alias) → familia_id. Gemelo de
   * `marcaAlias`: la fusión de familias que sobrevive al espejo. Vacío
   * mientras la migración 0018 no esté aplicada — ver `loadCatalogIndex`.
   */
  familiaAlias: Map<string, string>;
  familiaByNombre: Map<string, string>; // UPPER(nombre) → familia_id
  almacenByClave: Map<string, string>; // clave → almacen_id
  kamByNombre: Map<string, string>; // normalizeAliasKey(nombre) → kam_id
  estatusAlias: Map<string, number>; // normalizeAliasKey(alias) → orden 1..11
}

// ------------------------------------------------------------
// Cambio sin metadata autogenerada (differ los produce; snapshot_id
// es placeholder en computeSnapshot y lo backfillea persist).
// ------------------------------------------------------------
export type CambioNuevo = Omit<Cambio, 'id' | 'detectado_en'>;

// ------------------------------------------------------------
// Filas listas para persistir (nombres canónicos + ids resueltos).
// marca_id/familia_id null ⇒ catálogo nuevo pendiente de alta.
// ------------------------------------------------------------
export interface ProductoRow {
  sku: string;
  marca: string;
  marca_id: string | null;
  // [CAT-B1·A] Viajan como TEXTO, sin catalogo ni id: a diferencia de marca y
  // familia, para estos dos no hay tabla de catalogo que resolver aqui.
  //
  // Y la tabla que HOY sirve uno de los dos no se nombra en este directorio —
  // NI EN PROSA. El barrido de convivencia es por SUBSTRING sobre todo
  // `src/services/etl/**`, comentarios incluidos. Escrito tras romperlo aqui
  // mismo al redactar este comentario: la guarda mordio, y lo que se arreglo
  // fue el texto, no la guarda.
  tecnologia: string | null;
  producto: string | null;
  familia: string | null;
  familia_id: string | null;
  class: string | null;
  descr_origen: string | null;
  cliente: string | null;
  resv: number;
}

export interface StockRow {
  sku: string;
  almacen: ClaveAlmacen;
  almacen_id: string | null;
  cantidad: number;
}

export interface ReservaRow {
  sku: string;
  kam: string | null;
  kam_id: string | null;
  cliente: string;
  cantidad: number;
  motivo: string | null;
  fecha: string;
}

export interface EmbarqueRow extends EmbarqueCanon {
  estatus_id: number;
}

// ------------------------------------------------------------
// [REPRODUCIBILIDAD · S7-A] Escape hatch EXPLÍCITO de la guarda de
// universo reducido (`computeSnapshot`, `runEtl.ts`) — nunca automático,
// nunca por variable de entorno ni valor por defecto. Lo arma la RUTA
// SOLO cuando las tres cabeceras HTTP llegan completas y validadas
// (`x-forzar-universo-reducido: si`, `x-forzar-motivo`, `x-forzar-por`).
//
// Nota de honestidad: las dos rutas de ingesta autentican con
// INGEST_SECRET compartido (`ingestaAutorizada`), no con sesión de
// usuario — `por` es una identidad AUTO-DECLARADA, NO AUTENTICADA.
// ------------------------------------------------------------
export interface ForzadoUniverso {
  por: string;
  motivo: string;
}

// ------------------------------------------------------------
// Payload determinista de un snapshot (entrada de persistSnapshot).
// Producido por computeSnapshot; NO incluye ids de snapshot.
// ------------------------------------------------------------
export interface SnapshotPayload {
  fuente: string;
  periodo: string;
  archivo: string | null;
  capturedAt: string;
  hash: string;
  createdBy: string | null;
  marcasNuevas: string[];
  familiasNuevas: string[];
  productos: ProductoRow[];
  stock: StockRow[];
  reservas: ReservaRow[];
  embarques: EmbarqueRow[];
  cambios: CambioNuevo[];
  /**
   * [REPRODUCIBILIDAD · S7-A] Quién forzó la guarda de universo reducido
   * y por qué — `null`/`null` cuando la guarda no se disparó o no hizo
   * falta forzarla. `buildIngestPayload` (persist.ts) los emite como
   * `forzado_por`/`forzado_motivo` dentro de `snapshot`; las columnas
   * `snapshots.forzado_por`/`forzado_motivo` y la RPC que las escribe
   * son de otro frente (S7-B, migración 0022).
   */
  forzadoPor: string | null;
  forzadoMotivo: string | null;
}

// ------------------------------------------------------------
// Estado del snapshot vigente por fuente (para differ + idempotencia).
// ------------------------------------------------------------
export interface PrevState {
  snapshotId: string | null;
  hash: string | null;
  productos: ProductoCanon[];
  stock: StockCanon[];
  reservas: ReservaCanon[];
  embarques: EmbarqueRow[];
  existingSkus: Set<string>;
}

// ------------------------------------------------------------
// Respuesta del ETL (contrato de /api/refresh).
// ------------------------------------------------------------
export interface EtlResult {
  snapshotId: string | null;
  sinCambios: boolean;

  /**
   * [ING-B1 · O-1] Presente SÓLO cuando `sinCambios` salió true porque la base
   * RECHAZÓ el INSERT por `snapshots_hash_unique`, no porque los hashes
   * coincidieran. **Los dos casos responden 200 y no escriben nada** — la
   * decisión de producto, y su razón es operativa: el nodo de embarques de Power
   * Automate no corre si el de inventario no termina en verde, así que un 4xx
   * no dejaría el ciclo «distinguible»: dejaría los DOS flujos muertos.
   *
   * Pero no son la misma cosa, y por eso el cuerpo los separa aunque el HTTP no
   * pueda: `causaProbable` dice si el archivo se repitió o si cambió en campos
   * que ESTA versión no mete en el hash. Ausente en el camino normal.
   */
  duplicado?: {
    hash: string;
    constraint: string;
    causaProbable: 'archivo_repetido' | 'receta_del_hash';
    mensaje: string;
  };
  source: string;
  conteos: {
    productos: number;
    stock: number;
    reservas: number;
    embarques: number;
    cambios: number;
  };
  cuarentena: { total: number; items: QuarantineItem[] };
  diag: DiagItem[];
  /**
   * [MVP-CIERRE] F1 · Qué tuvo que aguantar esta corrida para salir viva.
   *
   * Campo propio y NO un `DiagItem` más: `diag` es un tipo estrecho por SKU
   * para los gates de suma (`SUMA_STOCK`/`SUMA_RESERVAS`) y esto no tiene
   * SKU ni esperado/obtenido. Meterlo ahí sería modelar una cosa como otra
   * (P8) y obligaría a los consumidores de `diag` a filtrar ruido.
   *
   * Viaja en la respuesta HTTP a propósito: los logs de runtime de Vercel
   * en plan Hobby se retienen ~1 hora — por eso hoy NO tenemos el mensaje
   * literal de las corridas que fallaron. Power Automate conserva
   * su Run history 28 días, así que el rastro sobrevive ahí aunque el log
   * del servidor ya se haya evaporado.
   */
  resiliencia: RastroResiliencia;
  /**
   * [REPRODUCIBILIDAD · S7-A] `true` cuando la guarda de universo
   * reducido SÍ se disparó y quien ingesta la forzó explícitamente (las
   * tres cabeceras del escape hatch). Campo propio y no solo un
   * `console.warn`: un forzado que solo vive en el log es un forzado
   * invisible para Power Automate y para el CLI, que leen esta
   * respuesta, no los logs de Vercel.
   */
  universoForzado: boolean;
}
