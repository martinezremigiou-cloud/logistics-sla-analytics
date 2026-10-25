// ============================================================
// [INV-B8] proyectos.service.ts — el Módulo Proyectos (lecturas + escrituras).
//
// LA REGLA QUE MANDA SOBRE TODO ESTE ARCHIVO: ni una sola cifra de
// disponibilidad se calcula aquí. `total`, `reservado` y `disponible` salen
// de `derivarSku` y de ningún otro lugar; `en_riesgo` de `enRiesgo`;
// `fuera_del_vigente` de `fueraDelVigente`; el estatus de `resolverEstatus`.
// Este archivo ORQUESTA lecturas y ARMA DTOs — no deriva.
//
// El motivo no es estético. `piezas_en_camino` se dejó derivar "donde hiciera
// falta" y hoy tiene VARIAS implementaciones (en `sku.service.ts`,
// `dashboard.service.ts` y `cruce.service.ts`), ninguna
// compartida, y nada las compara. El camino de menor resistencia para este
// bloque era escribir otra más.
//
// POR QUÉ NO SE REUSA `fetchSnapshot` DE `inventory.service.ts`. Porque
// filtra `productos` por `.eq('snapshot_id', S.id)`, y eso hace
// literalmente invisibles a los SKU que ya no vienen en el Excel — que
// son justo los que este módulo tiene que poder imprimir DICIENDO que
// salieron. Aquí `productos` se lee por `.in('sku', …)` SIN filtro de
// snapshot (la FK garantiza que la fila existe) y la pertenencia al
// snapshot vigente se DERIVA comparando `snapshot_id`. Las particiones
// (`stock_por_almacen`, `reservas`) sí van pinneadas, porque ahí el filtro
// es lo que define de qué corrida son las cifras.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { embedName, embedClave, embedEmail } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { fetchAllRows, comoRespuesta } from '@/lib/supabase/fetch-all';
import { conVigenteStock, type SnapshotVigente } from './vigente.service';
import {
  derivarSku,
  badgesDe,
  resolverClasificacion,
  fueraDelVigente,
  enRiesgo,
  type ProductoLectura,
  type StockLectura,
  type ReservaLectura,
  type OverrideLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import { resolverAgrupacion, resumenDeAgrupacion, type AgrupacionResuelta } from './documento/resoluciones';
import { cmpStr } from '@/lib/orden';
import type { ProyectoResumen, ProyectoDetalle, PartidaItem, VigenciaDelDato, ResultadoVolcado } from '@/types/proyectos';
import { MAX_CANTIDAD, type CrearProyectoInput, type EditarProyectoInput, type VolcarItemInput } from '@/schemas/proyectos.schema';

/** Columnas del proyecto que viajan al DTO. Explícitas: `select('*')` con ACL por columna muere con 42501 (TAXO-10). */
//
// El embed `perfiles(email)` resuelve el RESPONSABLE que pinta la vista, y
// funciona bajo RLS para los dos casos sin ninguna rama en el código: un KAM
// solo ve sus propios proyectos, así que el perfil que lee es el suyo
// (`perfiles_select_own_or_admin`, rama own); un admin ve los de todos y lee
// cualquier perfil por la rama `is_admin()`. Un proyecto huérfano
// (`propietario` NULL tras `ON DELETE SET NULL`) no trae fila embebida y el
// responsable queda en `null` — que es la verdad, no un hueco.
//
// NO se resuelve con el correo de la SESIÓN, y la distinción importa: para un
// admin mirando el proyecto de un KAM, la sesión sería falsa la mayoría de las
// veces. El firmante del DOCUMENTO sí es la sesión (D3) porque ahí la pregunta
// es otra — quién generó el archivo, no de quién es el proyecto.
const COLS_PROYECTO = 'id,folio,titulo,descripcion,notas,fecha,tipo,intencion,creado_en,propietario, perfiles(email)';

interface ProyectoRow {
  id: string;
  propietario: string | null;
  perfiles: unknown;
  folio: string;
  titulo: string;
  descripcion: string | null;
  notas: string | null;
  fecha: string;
  tipo: string | null;
  intencion: string | null;
  creado_en: string;
}

interface PartidaRow {
  id: string;
  sku: string;
  cantidad: number;
}

/** El embed de conteo pide SOLO `cantidad` — tiparlo como `PartidaRow` mentiría sobre un `sku` que no viene. */
interface PartidaConteoRow {
  cantidad: number;
}

export type CodigoProyectoError =
  | 'no_encontrado'
  | 'partida_duplicada'
  | 'proyecto_lleno'
  | 'sku_no_encontrado'
  | 'perfil_no_encontrado'
  | 'prohibido';

/**
 * Error de dominio que la ruta traduce a un código HTTP. Sin esto, un 23505
 * de Postgres se iría al cliente como 500 genérico.
 *
 * OJO CON LA FORMA DEL CONSTRUCTOR, y no es estilo: el campo se declara y se
 * asigna a mano en vez de usar una PROPIEDAD DE PARÁMETRO
 * (`constructor(readonly codigo: …)`). El type-stripping nativo de Node —el
 * que usan los scripts del repo vía `scripts/ts-loader.mjs`— **no soporta**
 * esa sintaxis: borra tipos, no genera código, y una propiedad de parámetro
 * exige generarlo. Con ella, `tsc` y vitest quedan en verde y cualquier
 * script `node` que importe este archivo muere con
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Medido al escribir
 * un script que importaba este archivo.
 */
export class ProyectoError extends Error {
  readonly codigo: CodigoProyectoError;

  constructor(codigo: CodigoProyectoError) {
    super(codigo);
    this.name = 'ProyectoError';
    this.codigo = codigo;
  }
}

// ------------------------------------------------------------
// LECTURAS
// ------------------------------------------------------------

/**
 * Los proyectos VISIBLES para la sesión. No filtra por propietario: lo hace
 * la RLS (`proyectos_select_own_or_admin`). Filtrar además aquí duplicaría
 * la regla de autorización en la capa equivocada y crearía dos verdades
 * sobre quién ve qué — el admin ve todos justamente porque la policy lo
 * dice, no porque este archivo se acuerde.
 */
export async function listarProyectos(db: SupabaseClient): Promise<ProyectoResumen[]> {
  const { data, error } = await db
    .from('proyectos')
    .select(`${COLS_PROYECTO}, proyecto_partidas(cantidad)`)
    .order('creado_en', { ascending: false })
    .order('id', { ascending: false });

  if (error) throw new Error('proyectos: ' + error.message);

  return (data ?? []).map((row) => {
    const partidas = (row.proyecto_partidas ?? []) as PartidaConteoRow[];
    return {
      ...proyectoDeFila(row as unknown as ProyectoRow),
      skus: partidas.length,
      piezas: partidas.reduce((suma, p) => suma + Number(p.cantidad), 0),
    };
  });
}

/** Cuántos proyectos ve la sesión — el badge numérico del sidebar. Cuenta sin traer filas. */
export async function contarProyectos(db: SupabaseClient): Promise<number> {
  const { count, error } = await db.from('proyectos').select('id', { count: 'exact', head: true });
  if (error) throw new Error('proyectos: ' + error.message);
  return count ?? 0;
}

/**
 * Un proyecto con sus partidas y las cifras ya derivadas, pinneadas al
 * snapshot 'stock' vigente. `null` si no existe O si no es visible para la
 * sesión: la RLS no distingue esos dos casos y este servicio tampoco debe
 * hacerlo — decir "existe pero no es tuyo" ya es filtrar información.
 *
 * ES EL ÚNICO CAMINO de lectura del detalle. La pantalla y los dos
 * documentos consumen ESTA función, así que no pueden contradecirse: si
 * divergieran, sería porque alguien escribió una segunda.
 */
export async function obtenerProyecto(db: SupabaseClient, id: string): Promise<ProyectoDetalle | null> {
  const { data: proyecto, error } = await db
    .from('proyectos')
    .select(COLS_PROYECTO)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('proyectos: ' + error.message);
  if (!proyecto) return null;

  const { data: partidasRaw, error: errPartidas } = await db
    .from('proyecto_partidas')
    .select('id,sku,cantidad')
    .eq('proyecto_id', id);

  if (errPartidas) throw new Error('proyecto_partidas: ' + errPartidas.message);

  const partidas = (partidasRaw ?? []) as PartidaRow[];
  const skus = partidas.map((p) => p.sku);

  // Sin snapshot vigente NO se sirve un error: se sirve el proyecto con la
  // vigencia en null, y quien lo lea sabrá que no hay de qué fecha hablar.
  // Mismo criterio que `listInventory` (página vacía, 200).
  const derivado = await conVigenteStock(db, (S) => leerUniversoDePartidas(db, skus, S));

  return armarDetalle(
    proyectoDeFila(proyecto as unknown as ProyectoRow),
    partidas,
    derivado,
  );
}

// [FIX-B2] Forma de cada fila tal como la pide su SELECT en
// `leerUniversoDePartidas`. Los embebidos (`almacenes(clave)`, `kams(nombre)`)
// quedan `unknown`: PostgREST los entrega como objeto o como arreglo, y
// `embedClave`/`embedName` ya resuelven las dos formas.
interface FilaStockPartida {
  sku: string;
  cantidad: number | null;
  almacenes: unknown;
}

interface FilaReservaPartida {
  sku: string;
  cantidad: number | null;
  cliente: string | null;
  motivo: string | null;
  fecha: string | null;
  kams: unknown;
}

interface UniversoPartidas {
  vigente: SnapshotVigente;
  productos: ProductoLectura[];
  stock: StockLectura[];
  reservas: ReservaLectura[];
  overrides: OverrideLectura[];
  metadata: { sku: string; color: string | null; imagen_url: string | null }[];
  v2: ClasificacionV2Lectura[];
}

/**
 * Las 6 lecturas que alimentan a `derivarSku` para un conjunto ACOTADO de
 * SKUs: el conjunto está topado por `MAX_PARTIDAS` (200).
 *
 * [FIX-B2] Esta cabecera decía que `stock_por_almacen` llevaba «un `.range`
 * explícito con margen», y era FALSO (P35): PostgREST devuelve como máximo
 * 1 000 filas por respuesta SIN error, pida el `.range` lo que pida, así que
 * `.range(0, 4999)` no daba margen — daba 1 000. Y dos tablas pueden pasar de
 * ahí con 200 SKU: `stock_por_almacen` (hasta 6 almacenes por SKU = 1 200) y
 * `reservas` (sin tope por SKU; el máximo medido era pequeño por
 * SKU). Esas dos van ahora por `fetchAllRows` con un orden TOTAL. Otras tres
 * traen a lo más una fila por SKU (`sku` es la PK de `productos`,
 * `productos_metadata` y `clasificacion_v2`) y se quedan como estaban. La
 * cuarta, `productos_override` activos, también se queda, pero su tope es de
 * CONVENCIÓN, no de esquema: la RPC deja una captura activa por (sku, campo)
 * —tres campos posibles, 600 filas con 200 SKU—, y no hay índice único que lo
 * imponga (lo declara la 0044).
 *
 * El manejo de errores no cambia: `comoRespuesta` devuelve la lectura paginada
 * con la forma `{ data, error }`, y `assertOk` las sigue revisando en el mismo
 * orden fijo con el mismo mensaje `<tabla>: <error>`.
 */
async function leerUniversoDePartidas(
  db: SupabaseClient,
  skus: string[],
  S: SnapshotVigente,
): Promise<UniversoPartidas> {
  if (skus.length === 0) {
    return { vigente: S, productos: [], stock: [], reservas: [], overrides: [], metadata: [], v2: [] };
  }

  const [productos, stock, reservas, overrides, metadata, v2] = await Promise.all([
    // SIN filtro de snapshot — ver la cabecera del archivo. `snapshot_id`
    // viaja para poder derivar `fuera_del_vigente`.
    // [FIX-B1] `tecnologia` en el select: sin ella, `resolverClasificacion`
    // no tenía columna fuente que leer y `PartidaItem.tecnologia` salía
    // SIEMPRE null — DEFECTO ALTO de este bloque, el mismo que RESTAURA el
    // agrupado por tecnología de los documentos PDF (`resolverAgrupacion`,
    // abajo, ya la consumía — solo le faltaba el dato).
    db
      .from('productos')
      .select('sku,resv,descr_origen,cliente,class,snapshot_id,tecnologia, marcas(nombre), familias(nombre)')
      .in('sku', skus),
    // `stock_por_almacen` NO tiene `id`: su PK es (sku, almacen_id,
    // snapshot_id). Con `snapshot_id` fijo por el filtro, (sku, almacen_id) es
    // único — por eso las DOS columnas; `sku` sola empataría entre almacenes.
    comoRespuesta(
      fetchAllRows<FilaStockPartida>((from, to) =>
        db
          .from('stock_por_almacen')
          .select('sku,cantidad, almacenes(clave)')
          .eq('snapshot_id', S.id)
          .in('sku', skus)
          .order('sku', { ascending: true })
          .order('almacen_id', { ascending: true })
          .range(from, to),
      ),
    ),
    // `id` es la PK de `reservas` (uuid): orden total.
    comoRespuesta(
      fetchAllRows<FilaReservaPartida>((from, to) =>
        db
          .from('reservas')
          .select('sku,cantidad,cliente,motivo,fecha, kams(nombre)')
          .eq('snapshot_id', S.id)
          .in('sku', skus)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ),
    db
      .from('productos_override')
      .select('id,sku,campo,valor_editado,editado_en,activo')
      .eq('activo', true)
      .in('sku', skus),
    db.from('productos_metadata').select('sku,color,imagen_url').in('sku', skus),
    // ⚠ SIN CONSUMIDOR desde D-1(a) (CAT-B1 · Tramo B): esta fila se
    // indexa en `armarDetalle` (`v2PorSku`) y se pasa a `resolverClasificacion`
    // (`clasificacion = resolverClasificacion(producto, overrides, v2)`), pero
    // esa función ignora su 3er argumento (ver derivaciones.ts) — el fetch
    // no influye en ningún campo del detalle. No se borra (D-1(a): "congelar,
    // no dejar de leer"); su retiro es decisión pendiente de quien retome
    // esta bandeja.
    db.from('clasificacion_v2').select('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2').in('sku', skus),
  ]);

  // Un `.data ?? []` sin mirar `.error` es la clase de bug que ING-9 cerró
  // en el ETL: una lectura fallida se vuelve "no había nada", y aquí eso
  // imprimiría disponibilidad 0 en un documento que sale hacia un cliente.
  assertOk('productos', productos.error);
  assertOk('stock_por_almacen', stock.error);
  assertOk('reservas', reservas.error);
  assertOk('productos_override', overrides.error);
  assertOk('productos_metadata', metadata.error);
  // `clasificacion_v2` es la única que tolera "no disponible por migración",
  // igual que en `inventory.service.ts`: degrada a [] en vez de lanzar.
  if (v2.error && !esNoDisponiblePorMigracion(v2.error)) {
    throw new Error('clasificacion_v2: ' + v2.error.message);
  }

  return {
    vigente: S,
    productos: (productos.data ?? []).map((r) => ({
      sku: String(r.sku),
      marca: embedName(r.marcas) ?? '',
      familia: embedName(r.familias),
      descr_origen: r.descr_origen ?? null,
      cliente: r.cliente ?? null,
      resv: Number(r.resv ?? 0),
      clase: r.class ?? null,
      snapshot_id: r.snapshot_id ? String(r.snapshot_id) : null,
      tecnologia: r.tecnologia ?? null,
    })),
    stock: (stock.data ?? []).map((r) => ({
      sku: String(r.sku),
      almacen: embedClave(r.almacenes) ?? '',
      cantidad: Number(r.cantidad ?? 0),
    })),
    reservas: (reservas.data ?? []).map((r) => ({
      sku: String(r.sku),
      kam: embedName(r.kams),
      cliente: String(r.cliente ?? ''),
      cantidad: Number(r.cantidad ?? 0),
      motivo: r.motivo ?? null,
      fecha: String(r.fecha ?? ''),
    })),
    overrides: (overrides.data ?? []) as unknown as OverrideLectura[],
    metadata: (metadata.data ?? []) as { sku: string; color: string | null; imagen_url: string | null }[],
    v2: (v2.data ?? []) as unknown as ClasificacionV2Lectura[],
  };
}

function assertOk(tabla: string, error: { message: string } | null): void {
  if (error) throw new Error(`${tabla}: ${error.message}`);
}

/** Arma el detalle a partir del proyecto, sus partidas y el universo ya leído. PURA salvo por los tipos. */
function armarDetalle(
  proyecto: Omit<ProyectoResumen, 'skus' | 'piezas'>,
  partidas: PartidaRow[],
  universo: UniversoPartidas | null,
): ProyectoDetalle {
  const porSku = new Map(universo?.productos.map((p) => [p.sku, p]) ?? []);
  const stockPorSku = agrupar(universo?.stock ?? [], (r) => r.sku);
  const reservasPorSku = agrupar(universo?.reservas ?? [], (r) => r.sku);
  const v2PorSku = new Map(universo?.v2.map((r) => [String(r.sku), r]) ?? []);
  const metaPorSku = new Map(universo?.metadata.map((r) => [r.sku, r]) ?? []);
  const overrides = universo?.overrides ?? [];
  const vigenteId = universo?.vigente.id ?? null;

  const agrupaciones: AgrupacionResuelta[] = [];

  const items: PartidaItem[] = partidas.map((partida) => {
    // Un SKU con partida SIEMPRE tiene fila en `productos` (lo garantiza la
    // FK). Si el universo no vino (sin snapshot vigente), se deriva sobre
    // un producto vacío: cifras en 0 y ninguna afirmación de procedencia.
    const producto: ProductoLectura = porSku.get(partida.sku) ?? {
      sku: partida.sku,
      marca: '',
      familia: null,
      descr_origen: null,
      resv: 0,
      tecnologia: null,
    };

    const v2 = v2PorSku.get(partida.sku) ?? null;
    const derivado = derivarSku(
      producto,
      stockPorSku.get(partida.sku) ?? [],
      reservasPorSku.get(partida.sku) ?? [],
      overrides,
    );
    const clasificacion = resolverClasificacion(producto, overrides, v2);
    const meta = metaPorSku.get(partida.sku);
    const fuera = fueraDelVigente(producto, vigenteId);

    const agrupacion = resolverAgrupacion({ categoria: null, tecnologia: clasificacion.tecnologia.valor });
    agrupaciones.push(agrupacion);

    return {
      partida_id: String(partida.id),
      sku: partida.sku,
      descripcion: clasificacion.descr.valor,
      marca: clasificacion.marca.valor,
      tecnologia: clasificacion.tecnologia.valor,
      color: meta?.color ?? null,
      imagen_url: meta?.imagen_url ?? null,
      cantidad: Number(partida.cantidad),
      total: derivado.total,
      reservado: derivado.reservado,
      disponible: derivado.disponible,
      badges: badgesDe(derivado),
      en_riesgo: enRiesgo(derivado, Number(partida.cantidad)),
      fuera_del_vigente: fuera,
      // La fecha de la fila solo se afirma cuando DIFIERE de la del
      // documento; si coincide, repetirla invita a leerla como otra cosa.
      dato_de: null,
      banda: agrupacion.banda,
      eje_banda: agrupacion.eje,
    };
  });

  items.sort((a, b) => cmpStr(a.sku, b.sku));

  const vigencia: VigenciaDelDato = {
    snapshot_id: vigenteId,
    tomado_en: universo?.vigente.created_at ?? null,
  };

  return {
    ...proyecto,
    skus: items.length,
    piezas: items.reduce((suma, i) => suma + i.cantidad, 0),
    partidas: items,
    vigencia,
    agrupacion: resumenDeAgrupacion(agrupaciones),
    facetas: {
      marcas: valoresUnicos(items.map((i) => i.marca)),
      tecnologias: valoresUnicos(items.map((i) => i.tecnologia)),
    },
  };
}

function agrupar<T>(filas: T[], clave: (fila: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const fila of filas) {
    const k = clave(fila);
    const arr = map.get(k);
    if (arr) arr.push(fila);
    else map.set(k, [fila]);
  }
  return map;
}

/** Valores presentes, sin nulos ni vacíos, ordenados. Puebla los selectores DEL DATO REAL, nunca de una lista fija. */
function valoresUnicos(valores: (string | null)[]): string[] {
  const set = new Set<string>();
  for (const v of valores) {
    const limpio = v?.trim();
    if (limpio) set.add(limpio);
  }
  return Array.from(set).sort(cmpStr);
}

function proyectoDeFila(row: ProyectoRow): Omit<ProyectoResumen, 'skus' | 'piezas'> {
  return {
    id: String(row.id),
    responsable: embedEmail(row.perfiles),
    folio: String(row.folio),
    titulo: String(row.titulo),
    descripcion: row.descripcion ?? null,
    notas: row.notas ?? null,
    fecha: String(row.fecha),
    tipo: row.tipo ?? null,
    intencion: row.intencion ?? null,
    creado_en: String(row.creado_en),
  };
}

// ------------------------------------------------------------
// ESCRITURAS
//
// Todas van con el cliente de SESIÓN y se apoyan en RLS, sin RPC: mientras
// estas tablas no tengan ACL por columna, el CRUD directo funciona y no
// hace falta `SECURITY DEFINER` (ver `docs/known-limitations.md` (TAXO-10)).
// ------------------------------------------------------------

export async function crearProyecto(db: SupabaseClient, input: CrearProyectoInput): Promise<ProyectoResumen> {
  const { data, error } = await db
    .from('proyectos')
    // `propietario` NO se envía: lo pone el DEFAULT `auth.uid()` de la tabla.
    .insert({
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      notas: input.notas ?? null,
      ...(input.fecha ? { fecha: input.fecha } : {}),
      tipo: input.tipo ?? null,
      intencion: input.intencion ?? null,
    })
    .select(COLS_PROYECTO)
    .single();

  if (error) {
    // 42501 = la RLS rechazo el INSERT. Se traduce AQUI porque es el ultimo
    // punto donde el error conserva su `code`: envolverlo en un Error de
    // texto lo convertiria en un 500 indistinguible de una caida real.
    if (error.code === '42501') throw new ProyectoError('prohibido');
    throw new Error('proyectos: ' + error.message);
  }
  return { ...proyectoDeFila(data as unknown as ProyectoRow), skus: 0, piezas: 0 };
}

export async function editarProyecto(
  db: SupabaseClient,
  id: string,
  input: EditarProyectoInput,
): Promise<ProyectoResumen> {
  const parche: Record<string, unknown> = {};
  if (input.titulo !== undefined) parche.titulo = input.titulo;
  if (input.descripcion !== undefined) parche.descripcion = input.descripcion ?? null;
  if (input.notas !== undefined) parche.notas = input.notas ?? null;
  if (input.fecha !== undefined) parche.fecha = input.fecha;
  if (input.tipo !== undefined) parche.tipo = input.tipo ?? null;
  if (input.intencion !== undefined) parche.intencion = input.intencion ?? null;

  const { data, error } = await db
    .from('proyectos')
    .update(parche)
    .eq('id', id)
    .select(`${COLS_PROYECTO}, proyecto_partidas(cantidad)`)
    .maybeSingle();

  if (error) throw new Error('proyectos: ' + error.message);
  // 0 filas afectadas = no existe o no es suyo. La RLS filtra el UPDATE
  // igual que el SELECT, así que aquí no hace falta —ni se debe— repetir
  // la condición de propiedad.
  if (!data) throw new ProyectoError('no_encontrado');

  const partidas = ((data as unknown as { proyecto_partidas?: PartidaConteoRow[] }).proyecto_partidas ?? []) as PartidaConteoRow[];
  return {
    ...proyectoDeFila(data as unknown as ProyectoRow),
    skus: partidas.length,
    piezas: partidas.reduce((suma, p) => suma + Number(p.cantidad), 0),
  };
}

/**
 * Agrega una partida. El SKU ya llega normalizado a `trim + UPPER` por el
 * schema, igual que lo guarda el ETL.
 *
 * Los dos errores que Postgres distingue y esta función traduce, en vez de
 * dejarlos salir como 500 genérico:
 *   · 23505 → el SKU ya está en el proyecto (UNIQUE proyecto_id,sku).
 *   · 23503 → el SKU no existe en `productos` (FK).
 */
export async function agregarPartida(
  db: SupabaseClient,
  proyectoId: string,
  input: { sku: string; cantidad: number },
  maxPartidas: number,
): Promise<void> {
  const { count, error: errCount } = await db
    .from('proyecto_partidas')
    .select('id', { count: 'exact', head: true })
    .eq('proyecto_id', proyectoId);

  if (errCount) throw new Error('proyecto_partidas: ' + errCount.message);
  if ((count ?? 0) >= maxPartidas) throw new ProyectoError('proyecto_lleno');

  const { error } = await db
    .from('proyecto_partidas')
    .insert({ proyecto_id: proyectoId, sku: input.sku, cantidad: input.cantidad });

  if (error) {
    if (error.code === '23505') throw new ProyectoError('partida_duplicada');
    if (error.code === '23503') {
      // Puede ser la FK del SKU o la del proyecto. La segunda solo ocurre
      // si el proyecto no existe; la RLS ya habría impedido leerlo.
      throw new ProyectoError(error.message.includes('sku') ? 'sku_no_encontrado' : 'no_encontrado');
    }
    // 42501: RLS rechazó el INSERT. Aquí el proyecto padre no es de esta
    // sesión (o no existe): 404, no 403 — decir 'prohibido' confirmaría que
    // el recurso existe.
    if (error.code === '42501') throw new ProyectoError('no_encontrado');
    throw new Error('proyecto_partidas: ' + error.message);
  }
}

// ============================================================
// [INV-B8.2] EL VOLCADO DE LA SELECCIÓN.
//
// Suma sobre lo que ya hay y lo DICE; y volcar dos veces la misma Selección no
// suma dos veces. El mecanismo está explicado donde vive el contrato
// (`volcarSeleccionSchema`, `src/schemas/proyectos.schema.ts`): cada renglón
// viaja con `cantidadVista` —lo que el cliente tenía enfrente—, el servidor la
// comprueba contra la base y de ahí salen los tres desenlaces. **La suma la
// hace el servidor**: el cliente nunca manda el total.
//
// LO QUE ESTA FUNCIÓN NO GARANTIZA, y hay que decirlo: la comprobación ocurre
// en la LECTURA, no dentro del `UPDATE`. Entre la lectura y la escritura caben
// milisegundos en los que otra pestaña del MISMO dueño podría cambiar una
// cantidad, y ese cambio se perdería. Cerrarlo del todo exige una función SQL
// (`INSERT … ON CONFLICT DO UPDATE … WHERE cantidad = $vista`) y por tanto una
// migración, que no es decisión de este carril. Lo que sí queda cerrado es el
// invariante que se pidió —el reintento— porque ahí la segunda lectura ya ve
// el efecto de la primera escritura. El resto del módulo (`cambiarCantidad`)
// tiene hoy MÁS exposición que esto: escribe sin comprobar nada.
//
// UNA SOLA ESCRITURA para todos los renglones. Un `upsert` es un statement, y
// un statement es atómico: si la RLS lo rechaza (un admin sobre el proyecto de
// otro — puede VERLO, no escribirlo) no queda un volcado a medias.
// ============================================================

interface PartidaCantidadRow {
  sku: string;
  cantidad: number;
}

export async function volcarSeleccion(
  db: SupabaseClient,
  proyectoId: string,
  items: VolcarItemInput[],
  maxPartidas: number,
): Promise<ResultadoVolcado> {
  // (1) ¿El proyecto existe y esta sesión lo ve? Sin esto, un id ajeno daría
  //     una lista de partidas vacía —la RLS filtra en silencio— y el volcado
  //     seguiría como si fuera un proyecto nuevo, para estrellarse después
  //     contra el WITH CHECK con un error mucho menos legible.
  const { data: proyecto, error: errProyecto } = await db
    .from('proyectos')
    .select('id')
    .eq('id', proyectoId)
    .maybeSingle();

  if (errProyecto) throw new Error('proyectos: ' + errProyecto.message);
  if (!proyecto) throw new ProyectoError('no_encontrado');

  // (2) Lo que ya hay. Es contra esto que se comprueba cada `cantidadVista`.
  const { data: filas, error: errFilas } = await db
    .from('proyecto_partidas')
    .select('sku,cantidad')
    .eq('proyecto_id', proyectoId);

  if (errFilas) throw new Error('proyecto_partidas: ' + errFilas.message);
  const enBase = new Map<string, number>(
    ((filas ?? []) as PartidaCantidadRow[]).map((f) => [f.sku, Number(f.cantidad)]),
  );

  // (3) Qué SKUs existen de verdad. La FK ya lo impediría, pero un 23503
  //     revienta el statement ENTERO: un solo SKU inventado en el cuerpo
  //     tiraría el volcado de los otros 199 y el usuario leería un error
  //     genérico. Preguntando antes, el SKU falso se reporta por su nombre y
  //     lo demás entra.
  const skus = items.map((i) => i.sku);
  const { data: productos, error: errProductos } = await db.from('productos').select('sku').in('sku', skus);

  if (errProductos) throw new Error('productos: ' + errProductos.message);
  const existentes = new Set(((productos ?? []) as { sku: string }[]).map((p) => p.sku));

  const resultado: ResultadoVolcado = { aplicadas: [], sinCambio: [], conflictos: [], desconocidos: [] };
  const aEscribir: { proyecto_id: string; sku: string; cantidad: number }[] = [];

  for (const item of items) {
    if (!existentes.has(item.sku)) {
      resultado.desconocidos.push(item.sku);
      continue;
    }

    const actual = enBase.get(item.sku) ?? 0;

    if (actual === item.cantidadVista) {
      // Primera vez: el mundo está como el cliente lo vio.
      const despues = actual + item.cantidad;
      if (despues > MAX_CANTIDAD) {
        resultado.conflictos.push({
          sku: item.sku,
          cantidadVista: item.cantidadVista,
          cantidadActual: actual,
          motivo: 'tope_cantidad',
        });
        continue;
      }
      aEscribir.push({ proyecto_id: proyectoId, sku: item.sku, cantidad: despues });
      resultado.aplicadas.push({ sku: item.sku, antes: actual, despues });
    } else if (actual === item.cantidadVista + item.cantidad) {
      // EL REINTENTO. Este volcado ya se aplicó: no se vuelve a sumar.
      resultado.sinCambio.push({ sku: item.sku, cantidad: actual });
    } else {
      resultado.conflictos.push({
        sku: item.sku,
        cantidadVista: item.cantidadVista,
        cantidadActual: actual,
        motivo: 'cambio_concurrente',
      });
    }
  }

  // (4) El tope solo lo mueven los SKUs NUEVOS: sumarle piezas a uno que ya
  //     está, o rechazar uno que no existe en el catálogo, no crea renglones.
  //
  //     Y solo se comprueba SI la operación crea alguno (`nuevos > 0`). La
  //     diferencia importa: un proyecto que ya estuviera por encima del tope
  //     —imposible hoy, `MAX_PARTIDAS` es constante, pero no si mañana se
  //     baja— vería rechazado hasta un volcado que no lo hace crecer. El tope
  //     acota el CRECIMIENTO; castigar una operación que no crece sería
  //     dejar el proyecto sin salida.
  const nuevos = resultado.aplicadas.filter((a) => a.antes === 0).length;
  if (nuevos > 0 && enBase.size + nuevos > maxPartidas) throw new ProyectoError('proyecto_lleno');

  if (aEscribir.length > 0) {
    const { error } = await db.from('proyecto_partidas').upsert(aEscribir, { onConflict: 'proyecto_id,sku' });
    if (error) {
      // 42501: la policy de INSERT/UPDATE exige ser el DUEÑO. Un admin ve el
      // proyecto ajeno (SELECT sí) y no lo escribe. 404 y no 403, misma
      // doctrina que el resto del módulo.
      if (error.code === '42501') throw new ProyectoError('no_encontrado');
      // Carrera contra el paso (3): el SKU existía al preguntar y ya no.
      if (error.code === '23503') throw new ProyectoError('sku_no_encontrado');
      throw new Error('proyecto_partidas: ' + error.message);
    }
  }

  return resultado;
}

export async function cambiarCantidad(
  db: SupabaseClient,
  proyectoId: string,
  partidaId: string,
  cantidad: number,
): Promise<void> {
  const { data, error } = await db
    .from('proyecto_partidas')
    .update({ cantidad })
    .eq('proyecto_id', proyectoId)
    .eq('id', partidaId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error('proyecto_partidas: ' + error.message);
  if (!data) throw new ProyectoError('no_encontrado');
}

/**
 * Quita una partida. **Es el primer borrado real contra Supabase de todo
 * `src/`** — hasta hoy el grep de `.delete(` solo encontraba
 * `URLSearchParams.delete` y `Set.delete`.
 *
 * La doctrina "la capa no borra" (`0018:117`) se escribió sobre dato
 * INGERIDO: hechos que el portal no produjo y no puede reponer. Una partida
 * es lo contrario — la escribió su dueño y su dueño la puede desescribir. La
 * decisión se tomó con esa distinción enfrente (STOP&ASK, 2026-08-12).
 *
 * `.select('id')` no es adorno: sin él, un DELETE que la RLS filtró se ve
 * EXACTAMENTE igual que uno que borró la fila —ambos "sin error"— y la UI
 * confirmaría un borrado que no ocurrió.
 */
export async function quitarPartida(db: SupabaseClient, proyectoId: string, partidaId: string): Promise<void> {
  const { data, error } = await db
    .from('proyecto_partidas')
    .delete()
    .eq('proyecto_id', proyectoId)
    .eq('id', partidaId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error('proyecto_partidas: ' + error.message);
  if (!data) throw new ProyectoError('no_encontrado');
}

/**
 * [INV-B8 · 0025] Reasigna un proyecto HUÉRFANO a una cuenta viva. Es la vía
 * de rescate del estado que la 0024 producía y no sabía deshacer: con
 * `propietario` en NULL, las policies de UPDATE y DELETE excluían a todo el
 * mundo —`NULL = auth.uid()` no es TRUE— así que el proyecto quedaba visible
 * para el admin y reparable por nadie.
 *
 * NO comprueba aquí que el proyecto esté huérfano ni que quien llama sea
 * admin: las dos cosas las decide la policy, y repetirlas en este archivo
 * crearía una segunda verdad sobre el permiso que puede divergir de la
 * primera. Lo que sí hace es distinguir los desenlaces:
 *
 *   · 0 filas afectadas → el proyecto no existe, no está huérfano, o quien
 *     llama no es admin. Un UPDATE denegado por RLS devuelve 200 con cero
 *     filas, igual que uno que no encontró nada (medido en
 *     `scripts/rls-negativas.mjs`), así que sin el `.select()` esto
 *     respondería "listo" sin haber reasignado nada.
 *   · 23503 → el uuid no corresponde a ningún perfil.
 *   · 42501 → la policy rechazó el resultado, típicamente por intentar
 *     adoptar hacia un visitante.
 */
export async function reasignarProyecto(
  db: SupabaseClient,
  id: string,
  nuevoPropietario: string,
): Promise<ProyectoResumen> {
  const { data, error } = await db
    .from('proyectos')
    .update({ propietario: nuevoPropietario })
    .eq('id', id)
    .select(`${COLS_PROYECTO}, proyecto_partidas(cantidad)`)
    .maybeSingle();

  if (error) {
    // 23503 aqui es la FK contra `perfiles`, no contra `productos`: el uuid
    // no corresponde a ninguna cuenta. Mapearlo a 'sku_no_encontrado' habria
    // dado un mensaje sobre el catalogo en una pantalla de administracion.
    if (error.code === '23503') throw new ProyectoError('perfil_no_encontrado');
    if (error.code === '42501') throw new ProyectoError('prohibido');
    throw new Error('proyectos: ' + error.message);
  }
  if (!data) throw new ProyectoError('no_encontrado');

  const partidas = ((data as unknown as { proyecto_partidas?: PartidaConteoRow[] }).proyecto_partidas ?? []) as PartidaConteoRow[];
  return {
    ...proyectoDeFila(data as unknown as ProyectoRow),
    skus: partidas.length,
    piezas: partidas.reduce((suma, p) => suma + Number(p.cantidad), 0),
  };
}
