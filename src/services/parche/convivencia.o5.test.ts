// ============================================================
// B-PARCHE · F5 · convivencia.o5.test.ts
// SUITE O5 — gate de producto: "la capa v2 (clasificacion_v2/tecnologias,
// resuelta por `resolverClasificacion` en src/services/derivaciones.ts)
// NO debe afectar el pipeline de ingesta actual" (src/services/etl/** +
// /api/refresh). SOLO TESTS — cero código de producción tocado.
//
// Nivel 1a — AISLAMIENTO POR DISEÑO (estático, determinista): barrido
//   por fs de los fuentes del ETL + el contrato del RPC de ingesta,
//   verificando que ningún token de la capa v2 aparece ahí.
// Nivel 1b — SIMULACIÓN "mes siguiente" con el PIPELINE REAL
//   (computeSnapshot/differ/gates, importados de src/services/etl,
//   JAMÁS copiados) sobre una base "parcheada": 12 productos
//   inventados (de la misma forma que `productos-vivos-muestra.json`, el
//   fixture de clasificacion.build.integration.test.ts) como PrevState, más una
//   capa v2 simulada (Map, nunca pasada al pipeline) y un override
//   manual. Prueba que: (a) el feed de `cambios` sigue siendo el de
//   siempre (basado en fuente, ciego a v2); (b) el payload de
//   persistencia sigue sin claves v2; (c)/(d) `resolverClasificacion`
//   post-ingesta no "retrocede" nada aunque la fuente cambie; (e) la
//   regla B4 (BAJA → snapshot.stock.vigente=false) sigue intacta; y
//   (f) los gates de integridad (Σstock/Σreservas) evalúan igual,
//   indiferentes a la existencia de v2.
//
// NIVEL 2 (runtime vivo, post-O6): documentado en comentario al final.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { computeSnapshot } from '@/services/etl/runEtl';
import { buildIngestPayload } from '@/services/etl/persist';
import { makeCatalogIndex } from '@/services/etl/__tests__/helpers';
import type {
  IngestJob,
  Grid,
  PrevState,
  SnapshotPayload,
  ProductoCanon,
  StockCanon,
  ReservaCanon,
  CambioNuevo,
} from '@/services/etl/types';

import { resolverClasificacion } from '@/services/derivaciones';
import type { ProductoLectura, OverrideLectura, ClasificacionV2Lectura } from '@/services/derivaciones';

import { buildSkuDetalle } from '@/services/sku.service';
import type { SnapshotVigente } from '@/services/vigente.service';

// ============================================================
// Nivel 1a — aislamiento por diseño (estático, determinista)
// ============================================================

/** Tokens de la capa interpretativa v2 (B-PARCHE): el ETL no debe conocer ninguno. */
const TOKENS_V2 = [
  'clasificacion_v2',
  'productos_override',
  'tecnologias',
  'marca_v2',
  'familia_v2',
  'resolverClasificacion',
] as const;

function listarArchivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listarArchivosTs(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function violacionesEnArchivo(path: string): string[] {
  const contenido = readFileSync(path, 'utf8');
  return TOKENS_V2.filter((token) => contenido.includes(token)).map((token) => `${path} :: ${token}`);
}

describe('O5 · Nivel 1a — el ETL no conoce la capa interpretativa v2 (barrido estático)', () => {
  const ETL_DIR = join(process.cwd(), 'src/services/etl');
  const ROUTE_FILE = join(process.cwd(), 'src/app/api/refresh/route.ts');
  const SCHEMA_FILE = join(process.cwd(), 'src/schemas/refresh.schema.ts');
  // Bonus (no exigido explícitamente por la spec, pero es el shim real que
  // `route.ts` importa: `@/services/etl.service`, re-export 1:1 de
  // `./etl/runEtl` + `./etl/persist` + `./etl/errors` + `./etl/types`).
  // Se incluye para cerrar la cadena de custodia completa hasta el route.
  const ETL_SERVICE_SHIM = join(process.cwd(), 'src/services/etl.service.ts');

  it('1. cero ocurrencias de tokens v2 en src/services/etl/** (incl. sus propios tests, ya verificados limpios), route.ts y refresh.schema.ts', () => {
    const archivos = [...listarArchivosTs(ETL_DIR), ROUTE_FILE, SCHEMA_FILE, ETL_SERVICE_SHIM];

    // Sanity del propio barrido: si el path estuviera mal armado y
    // regresara [], el assert de abajo "pasaría" vacuamente sin probar nada.
    expect(archivos.length).toBeGreaterThanOrEqual(30);
    expect(archivos.some((f) => f.endsWith('runEtl.ts'))).toBe(true);
    expect(archivos.some((f) => f.endsWith('persist.ts'))).toBe(true);
    expect(archivos.some((f) => f.endsWith('computeSnapshot.test.ts'))).toBe(true);

    const violaciones = archivos.flatMap(violacionesEnArchivo);
    expect(violaciones).toEqual([]);
  });

  it('2. buildIngestPayload: claves top-level EXACTAS del jsonb → ninguna clave v2 puede viajar al RPC de ingesta', () => {
    const payload: SnapshotPayload = {
      fuente: 'stock',
      periodo: '2026-05',
      archivo: 'sanity.ods',
      capturedAt: '2026-05-07T00:00:00.000Z',
      hash: 'hash-sanity',
      createdBy: null,
      marcasNuevas: [],
      familiasNuevas: [],
      productos: [
        {
          sku: 'X-1',
          marca: 'NACIONAL',
          marca_id: 'm-1',
          tecnologia: null,
          producto: null,
          familia: null,
          familia_id: null,
          class: null,
          descr_origen: 'x',
          cliente: null,
          resv: 0,
        },
      ],
      stock: [{ sku: 'X-1', almacen: 'NORTH', almacen_id: 'alm-1', cantidad: 1 }],
      reservas: [],
      embarques: [],
      cambios: [],
      forzadoPor: null,
      forzadoMotivo: null,
    };
    const out = buildIngestPayload(payload);
    expect(Object.keys(out).sort()).toEqual(
      ['snapshot', 'marcasNuevas', 'familiasNuevas', 'productos', 'stock', 'reservas', 'embarques', 'cambios'].sort(),
    );
  });

  it('3. la RPC de ingesta (0005_ingest_fn.sql) tampoco referencia las tablas/campos v2', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0005_ingest_fn.sql'), 'utf8');
    expect(sql.length).toBeGreaterThan(100); // sanity: el archivo se leyó de verdad
    const violaciones = TOKENS_V2.filter((token) => sql.includes(token));
    expect(violaciones).toEqual([]);
  });
});

// ============================================================
// Nivel 1b — simulación "mes siguiente" con el pipeline REAL
// ============================================================

// 12 SKUs INVENTADOS (forma de SKU; marca/familia/clase/descr de ejemplo,
// "como los dejó la ingesta de abril"). Diversidad deliberada: 9 marcas
// distintas (NACIONAL, VERTICAL, BRAND5, SERIES5, BRAND6, EAS, BRAND2, CCTV,
// BRAND10), familias null y pobladas, class A/B/C/null. Ninguno proviene de
// datos reales: no dependen del fixture de productos vivos ni del generador.
const PREV_SNAPSHOT_ID = 'snap-2026-04-stock';

const prevProductos: ProductoCanon[] = [
  { sku: 'KR4172-B', marca: 'NACIONAL', tecnologia: null, producto: null, familia: 'TAGS', class: null, descr: 'Pin tag K27-A 40MM', cliente: null, resv: 0, totalFuente: 50 },
  { sku: '6204-K', marca: 'VERTICAL', tecnologia: null, producto: null, familia: null, class: null, descr: 'Wireless remote L52 24V', cliente: null, resv: 0, totalFuente: 10 },
  { sku: '2444N-M', marca: 'VERTICAL', tecnologia: null, producto: null, familia: null, class: null, descr: 'Link cord R14 2M', cliente: null, resv: 0, totalFuente: 10 },
  { sku: '5190-3382-41', marca: 'BRAND5', tecnologia: null, producto: null, familia: 'BRAND5', class: 'C', descr: 'Mount bracket F18 60 IN', cliente: null, resv: 0, totalFuente: 100 },
  { sku: 'ZB2917-C', marca: 'BRAND5', tecnologia: null, producto: null, familia: 'TAGS', class: 'C', descr: 'Security tag C33 58MM', cliente: null, resv: 0, totalFuente: 50 },
  { sku: '0861-5844-9317', marca: 'SERIES5', tecnologia: null, producto: null, familia: 'SERIES11', class: 'B', descr: 'SERIES11 AM ALFA SYSTEM 40 IN', cliente: null, resv: 0, totalFuente: 5 },
  { sku: 'T408-51-Q36', marca: 'BRAND6', tecnologia: null, producto: null, familia: 'TAGS', class: 'A', descr: 'Hook pin G91 12 PACK', cliente: null, resv: 0, totalFuente: 8 },
  { sku: 'FJ-K27', marca: 'EAS', tecnologia: null, producto: null, familia: null, class: null, descr: 'Clip holder N66 9M', cliente: null, resv: 0, totalFuente: 20 },
  { sku: 'QN3055', marca: 'BRAND2', tecnologia: null, producto: null, familia: 'SERIES3', class: 'A', descr: 'Charger kit V28 12V', cliente: null, resv: 5, totalFuente: 12 },
  { sku: 'XQ7NGS4021T', marca: 'CCTV', tecnologia: null, producto: null, familia: 'SERIES4', class: 'B', descr: 'Cord spool J70 5 PACK', cliente: null, resv: 0, totalFuente: 6 },
  { sku: 'ZCNTG4AB', marca: 'NACIONAL', tecnologia: null, producto: null, familia: null, class: null, descr: 'Label roll T61 40MM', cliente: null, resv: 0, totalFuente: 30 },
  { sku: 'VKBTJ8830RX', marca: 'BRAND10', tecnologia: null, producto: null, familia: 'TAGS', class: null, descr: 'Tamper probe M30 75MM', cliente: null, resv: 0, totalFuente: 4 },
];

const prevStock: StockCanon[] = [
  { sku: 'KR4172-B', almacen: 'NORTH', cantidad: 50 },
  { sku: '6204-K', almacen: 'NORTH', cantidad: 8 },
  { sku: '6204-K', almacen: 'TRAN', cantidad: 2 },
  { sku: '2444N-M', almacen: 'NORTH', cantidad: 10 }, // abril: 10 → mes siguiente: 16 (ver MODIFICACION de stock, a)
  { sku: '5190-3382-41', almacen: 'NORTH', cantidad: 100 },
  { sku: 'ZB2917-C', almacen: 'NORTH', cantidad: 40 },
  { sku: 'ZB2917-C', almacen: 'TRAN', cantidad: 10 },
  { sku: '0861-5844-9317', almacen: 'NORTH', cantidad: 5 },
  { sku: 'T408-51-Q36', almacen: 'NORTH', cantidad: 10 },
  { sku: 'FJ-K27', almacen: 'NORTH', cantidad: 20 },
  { sku: 'QN3055', almacen: 'NORTH', cantidad: 12 },
  { sku: 'XQ7NGS4021T', almacen: 'NORTH', cantidad: 6 },
  { sku: 'ZCNTG4AB', almacen: 'NORTH', cantidad: 30 },
  { sku: 'VKBTJ8830RX', almacen: 'NORTH', cantidad: 4 }, // se va de BAJA (no viene en el grid del mes siguiente)
];

const prevReservas: ReservaCanon[] = [
  { sku: 'QN3055', kam: 'Laura', cliente: 'RETAILER57', cantidad: 3, motivo: 'pedido especial', fecha: '2031-04-10' },
];

const prevState: PrevState = {
  snapshotId: PREV_SNAPSHOT_ID,
  hash: 'hash-abril-nunca-igual-al-hash-del-mes-siguiente',
  productos: prevProductos,
  stock: prevStock,
  reservas: prevReservas,
  embarques: [],
  existingSkus: new Set(prevProductos.map((p) => p.sku)),
};

// ---- Grids "mes siguiente" (mismo patrón que
// src/services/etl/__tests__/fixtures/edge/*.json: banner + gutter +
// header localizado por CONTENIDO, no por posición) ----

const INVENTARIO_MES_SIGUIENTE: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
  // v2 + override MANUAL (descr) + DRIFT de fuente (descr Y familia) — ver (a)/(c)
  [null, 'KR4172-B', '', 'NACIONAL', 'TAG', '', 'Pin tag K27 A 40MM', '50', '', '', '', '', '50', '0'],
  // v2 plano, sin drift
  [null, '6204-K', '', 'VERTICAL', '', '', 'Wireless remote L52 24V', '8', '', '', '2', '', '10', '0'],
  // v2 + CAMBIO DE STOCK (10→16), texto de fuente sin cambios — ver (a)
  [null, '2444N-M', '', 'VERTICAL', '', '', 'Link cord R14 2M', '16', '', '', '', '', '16', '0'],
  // v2 plano
  [null, '5190-3382-41', '', 'BRAND5', 'BRAND5', 'C', 'Mount bracket F18 60 IN', '100', '', '', '', '', '100', '0'],
  // v2 CON marca_v2 cross-ref (fuente sigue BRAND5; v2 reclasifica a BRAND6) — ver (c)
  [null, 'ZB2917-C', '', 'BRAND5', 'TAGS', 'C', 'Security tag C33 58MM', '40', '', '', '10', '', '50', '0'],
  // v2 plano
  [null, '0861-5844-9317', '', 'SERIES5', 'SERIES11', 'B', 'SERIES11 AM ALFA SYSTEM 40 IN', '5', '', '', '', '', '5', '0'],
  // v2 + MISMATCH deliberado de gate Σstock (TOTAL=8 vs NORTH=10) — ver (f)
  [null, 'T408-51-Q36', '', 'BRAND6', 'TAGS', 'A', 'Hook pin G91 12 PACK', '10', '', '', '', '', '8', '0'],
  // v2 plano (fuente sin familia; v2 la aporta desde null)
  [null, 'FJ-K27', '', 'EAS', '', '', 'Clip holder N66 9M', '20', '', '', '', '', '20', '0'],
  // v2 + MISMATCH deliberado de gate Σreservas (RESV=5 vs reservas=3) — ver (f)
  [null, 'QN3055', '', 'BRAND2', 'SERIES3', 'A', 'Charger kit V28 12V', '12', '', '', '', '', '12', '5'],
  // v2 plano
  [null, 'XQ7NGS4021T', '', 'CCTV', 'SERIES4', 'B', 'Cord spool J70 5 PACK', '6', '', '', '', '', '6', '0'],
  // SIN v2 + DRIFT de fuente (descr) — único caso "sin capa superior": la
  // efectiva SÍ debe seguir a la fuente nueva (ver c)
  [null, 'ZCNTG4AB', '', 'NACIONAL', '', '', 'Label roll T61 40MM BLACK', '30', '', '', '', '', '30', '0'],
  // ALTA: SKU nuevo, no vive en prev ni en la capa v2 — ver (d)
  [null, 'NB7741-J', '', 'NACIONAL', 'NEW LINE', '', 'New sample product', '25', '', '', '', '', '25', '0'],
  // VKBTJ8830RX (BAJA, sin v2): deliberadamente AUSENTE de este grid — ver (a)/(e)
];

// Hoja WEST presente (el contrato D1 la exige para fuente 'stock') pero sin
// filas de datos: ninguno de los 12 SKUs de este escenario depende de
// resolución cruzada WEST (eso es un mecanismo distinto, de
// clasificacion.build.ts, no de runEtl).
const WEST_MES_SIGUIENTE: Grid = [['INVENTARIO WEST'], [], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];

// Misma reserva de QN3055 que en `prevReservas`, byte a byte → 0 cambios de
// reserva; el mismatch Σreservas (f) es un gate del mes actual, no un diff.
const RESERVA_MES_SIGUIENTE: Grid = [
  ['DEMO COMERCIAL S DE RL DE CV'],
  [],
  [],
  [],
  [null, null, null, 'Laura'],
  [],
  ['STOCK MEXICO', null, null, '10-abr-31'],
  [null, null, null, 'pedido especial'],
  ['ITEM', null, null, 'RETAILER57'],
  ['QN3055', '0', null, '3'],
];

const MES_SIGUIENTE_JOB: IngestJob = {
  source: 'stock',
  capturedAt: '2026-05-07T00:00:00.000Z',
  archivo: '07MAYO26 Inventario Demo.ods',
  inventario: INVENTARIO_MES_SIGUIENTE,
  west: WEST_MES_SIGUIENTE,
  reserva: RESERVA_MES_SIGUIENTE,
};

// ---- Capa v2 simulada (Map en memoria; JAMÁS se pasa a computeSnapshot) ----
// 10 de los 12 SKUs; 1 con marca_v2 cross-ref (ZB2917-C); descr_v2/familia_v2
// = "nueva taxonomía", deliberadamente distinta de la fuente (vieja o nueva).
const V2_LAYER = new Map<string, ClasificacionV2Lectura>([
  ['KR4172-B', { sku: 'KR4172-B', tecnologia: null, marca_v2: null, familia_v2: 'TAG LINE', clase_v2: null, descr_v2: 'Security pin K27 (TAXONOMY 2.0)' }],
  ['6204-K', { sku: '6204-K', tecnologia: null, marca_v2: null, familia_v2: 'REMOTES', clase_v2: null, descr_v2: 'Wireless remote L52 (V2)' }],
  ['2444N-M', { sku: '2444N-M', tecnologia: null, marca_v2: null, familia_v2: 'LINK CORDS', clase_v2: null, descr_v2: 'Link cord R14 (V2)' }],
  ['5190-3382-41', { sku: '5190-3382-41', tecnologia: null, marca_v2: null, familia_v2: 'MOUNT KITS', clase_v2: null, descr_v2: 'Mount bracket F18 (V2)' }],
  ['ZB2917-C', { sku: 'ZB2917-C', tecnologia: null, marca_v2: 'BRAND6', familia_v2: 'TAG LINE', clase_v2: null, descr_v2: 'Security tag C33 (V2)' }],
  ['0861-5844-9317', { sku: '0861-5844-9317', tecnologia: null, marca_v2: null, familia_v2: 'SERIES11 STANDS', clase_v2: null, descr_v2: 'Floor stand SERIES11 (V2)' }],
  ['T408-51-Q36', { sku: 'T408-51-Q36', tecnologia: null, marca_v2: null, familia_v2: 'TAG LINE', clase_v2: null, descr_v2: 'Hook pin G91 (V2)' }],
  ['FJ-K27', { sku: 'FJ-K27', tecnologia: null, marca_v2: null, familia_v2: 'CLIP HOLDERS', clase_v2: null, descr_v2: 'Clip holder N66 (V2)' }],
  ['QN3055', { sku: 'QN3055', tecnologia: null, marca_v2: null, familia_v2: 'CHARGERS', clase_v2: null, descr_v2: 'Charger kit V28 (V2)' }],
  ['XQ7NGS4021T', { sku: 'XQ7NGS4021T', tecnologia: null, marca_v2: null, familia_v2: 'CORD SPOOLS', clase_v2: null, descr_v2: 'Cord spool J70 (V2)' }],
]);
// ZCNTG4AB y VKBTJ8830RX quedan deliberadamente SIN fila v2 (2 de los 12).

// 1 override MANUAL activo (descr) sobre uno de los 10 SKUs con v2.
const OVERRIDE_CON_OVERRIDE: OverrideLectura = {
  sku: 'KR4172-B',
  campo: 'descripcion',
  valor_editado: 'Pin tag K27-A 40MM - QA REVIEWED',
  editado_en: '2026-05-01T10:00:00.000Z',
  id: 'ovr-o5-1',
  activo: true,
};

function resumenCambios(cambios: CambioNuevo[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const c of cambios) {
    out[c.entidad] = out[c.entidad] ?? {};
    out[c.entidad][c.tipo] = (out[c.entidad][c.tipo] ?? 0) + 1;
  }
  return out;
}

describe('O5 · Nivel 1b — simulación "mes siguiente" (pipeline real) sobre base parcheada', () => {
  const idx = makeCatalogIndex();
  const { payload, result } = computeSnapshot(MES_SIGUIENTE_JOB, idx, prevState);

  function productoLecturaDesde(sku: string): ProductoLectura {
    const p = payload.productos.find((x) => x.sku === sku);
    if (!p) throw new Error(`fixture del test: sku ${sku} no está en payload.productos`);
    return {
      sku: p.sku,
      marca: p.marca,
      familia: p.familia,
      descr_origen: p.descr_origen,
      cliente: p.cliente,
      resv: p.resv,
      clase: p.class,
      // [CAT-B1 · Tramo B] propagados igual que los demás campos de `p`: este
      // grid NO trae columnas TECNOLOGIA/PRODUCTO (de ahí la cuarentena
      // 'columna_ausente_*' del test de "setup"), así que ambos quedan `null`
      // para las 12 filas — consistente con lo que la ficha real vería hoy.
      tecnologia: p.tecnologia,
      producto: p.producto,
    };
  }

  it('setup: 12 supervivientes+alta, sin cuarentena (sanity antes de a-f)', () => {
    expect(result.conteos.productos).toBe(12);
    expect(result.conteos.stock).toBe(14);
    expect(result.conteos.reservas).toBe(1);
    expect(result.conteos.embarques).toBe(0);
    // [CAT-B1·A] Antes decia `toBe(0)`. El grid sintetico de este test NO trae
    // TECNOLOGIA ni PRODUCTO, asi que ahora emite su rastro de columna ausente a
    // nivel de HOJA. El rojo era CORRECTO: el rastro hacia su trabajo.
    // NO se relaja el criterio — se hace MAS estricto: se enumeran los dos items
    // exactos y se exige que NINGUNO sea de fila, que es lo que este assert
    // queria decir con «sin cuarentena». Un `toBeLessThan` o un rango aqui
    // habria sido apagar el gate.
    // [FIX-B1·T4] 2 → 5: `WEST_MES_SIGUIENTE` (arriba) solo trae ITEM/PROV/
    // DESCRIPCION/FISICO — tampoco trae TECNOLOGIA/FAMILIA/CLASE, así que su
    // hoja deja su propio rastro de las 3 (el de tecnología SUMA con el que ya
    // emitía Inventario: son HOJAS distintas). Mismo criterio de arriba: se
    // enumeran los cinco motivos exactos, nunca un rango.
    const motivos = result.cuarentena.items.map((c) => c.motivo).sort();
    expect(motivos).toEqual([
      'columna_ausente_clase',
      'columna_ausente_familia',
      'columna_ausente_producto',
      'columna_ausente_tecnologia',
      'columna_ausente_tecnologia',
    ]);
    expect(result.cuarentena.items.every((c) => c.sku === null)).toBe(true);
    expect(result.cuarentena.total).toBe(5);
  });

  it('a. el diff detecta EXACTAMENTE 1 ALTA + 1 BAJA + 1 MODIFICACION de stock, más las MODIFICACIONes de fuente (descr/familia) que produce la fuente vieja — el feed refleja la FUENTE, no las efectivas', () => {
    expect(result.sinCambios).toBe(false);
    expect(payload.cambios).toHaveLength(8);
    expect(resumenCambios(payload.cambios)).toEqual({
      producto: { ALTA: 1, BAJA: 1, MODIFICACION: 3 },
      stock: { ALTA: 1, BAJA: 1, MODIFICACION: 1 },
    });

    const altaProducto = payload.cambios.find((c) => c.entidad === 'producto' && c.tipo === 'ALTA')!;
    expect(altaProducto).toMatchObject({ clave: 'NB7741-J', sku: 'NB7741-J' });

    const bajaProducto = payload.cambios.find((c) => c.entidad === 'producto' && c.tipo === 'BAJA')!;
    expect(bajaProducto).toMatchObject({ clave: 'VKBTJ8830RX', sku: 'VKBTJ8830RX' });

    const stockMod = payload.cambios.find((c) => c.entidad === 'stock' && c.tipo === 'MODIFICACION')!;
    expect(stockMod).toMatchObject({
      clave: '2444N-M|NORTH',
      sku: '2444N-M',
      campo: 'cantidad',
      valor_anterior: '10',
      valor_nuevo: '16',
    });

    // Coherencia del feed: la FUENTE "cambió" descr/familia en 2 SKUs — esto
    // es NORMAL y esperado (edición ordinaria de la hoja de origen, sin
    // relación con la capa v2). `cambios` documenta SIEMPRE el valor de
    // FUENTE, nunca la clasificación efectiva (manual/v2) — eso se resuelve
    // aparte en (c), donde se prueba que la efectiva NO se ve arrastrada.
    const modsProducto = payload.cambios.filter((c) => c.entidad === 'producto' && c.tipo === 'MODIFICACION');
    expect(modsProducto.map((c) => `${c.sku}.${c.campo}`).sort()).toEqual(
      ['ZCNTG4AB.descr', 'KR4172-B.descr', 'KR4172-B.familia'].sort(),
    );
    expect(modsProducto.find((c) => c.sku === 'KR4172-B' && c.campo === 'familia')!).toMatchObject({
      valor_anterior: 'TAGS',
      valor_nuevo: 'TAG',
    });
    expect(modsProducto.find((c) => c.sku === 'ZCNTG4AB')!).toMatchObject({
      valor_anterior: 'Label roll T61 40MM',
      valor_nuevo: 'Label roll T61 40MM BLACK',
    });
  });

  it('b. el payload de persistencia NO contiene ninguna clave v2 (re-aserción sobre este escenario realista)', () => {
    const jsonb = buildIngestPayload(payload);
    expect(Object.keys(jsonb).sort()).toEqual(
      ['snapshot', 'marcasNuevas', 'familiasNuevas', 'productos', 'stock', 'reservas', 'embarques', 'cambios'].sort(),
    );
    expect(() => JSON.stringify(jsonb)).not.toThrow();
  });

  it('c. [D-1(a), CAT-B1 · Tramo B] resolución post-ingesta: manual SIGUE ganando; v2 YA NO gana — las efectivas son SIEMPRE la fuente nueva salvo override', () => {
    // KR4172-B: manual sigue ganando descr pese al drift. familia YA NO la
    // gana v2 (D-1(a)): cae a la fuente NUEVA, con drift y todo — es
    // exactamente lo que (a) ya documentó que hace el feed de `cambios`
    // ('TAGS'→'TAG'), ahora visible también en la efectiva.
    const conOverrideLectura = productoLecturaDesde('KR4172-B');
    const conOverride = resolverClasificacion(conOverrideLectura, [OVERRIDE_CON_OVERRIDE], V2_LAYER.get('KR4172-B') ?? null);
    expect(conOverride.descr).toEqual({ valor: 'Pin tag K27-A 40MM - QA REVIEWED', origen: 'manual' });
    expect(conOverride.familia).toEqual({ valor: conOverrideLectura.familia, origen: 'fuente' });
    expect(conOverrideLectura.familia).toBe('TAG'); // la fuente nueva, con drift — dicho con valor, no solo con forma
    expect(conOverride.marca).toEqual({ valor: 'NACIONAL', origen: 'fuente' }); // sin marca_v2 ni manual de marca (sin cambio)

    // Los otros 9 SKUs con v2 (sin override): descr_efectiva Y familia_efectiva
    // son SIEMPRE la fuente — la fila v2 (`fila`) se pasa igual, y se ignora.
    const sinOverride = ['6204-K', '2444N-M', '5190-3382-41', 'ZB2917-C', '0861-5844-9317', 'T408-51-Q36', 'FJ-K27', 'QN3055', 'XQ7NGS4021T'];
    for (const sku of sinOverride) {
      const fila = V2_LAYER.get(sku)!;
      const p = productoLecturaDesde(sku);
      const r = resolverClasificacion(p, [], fila);
      expect(r.descr, sku).toEqual({ valor: p.descr_origen, origen: 'fuente' });
      expect(r.familia, sku).toEqual({ valor: p.familia, origen: 'fuente' });
      // Y NINGUNO coincide con la taxonomía v2 (si coincidiera por accidente
      // de fixture, esta línea lo delataría): confirma que de verdad se ignoró.
      expect(r.descr.valor).not.toBe(fila.descr_v2);
    }

    // marca_v2 cross-ref: ZB2917-C YA NO resuelve a BRAND6 (v2) — vuelve a BRAND5 (fuente).
    const conMarcaV2 = resolverClasificacion(productoLecturaDesde('ZB2917-C'), [], V2_LAYER.get('ZB2917-C')!);
    expect(conMarcaV2.marca).toEqual({ valor: 'BRAND5', origen: 'fuente' });
    // FJ-K27 nunca tuvo marca_v2 → sin cambio, sigue en fuente.
    const sinMarcaV2 = resolverClasificacion(productoLecturaDesde('FJ-K27'), [], V2_LAYER.get('FJ-K27')!);
    expect(sinMarcaV2.marca).toEqual({ valor: 'EAS', origen: 'fuente' });

    // ZCNTG4AB (sin v2, sin manual): único caso que NUNCA tuvo capa superior —
    // la efectiva SÍ sigue a la fuente nueva, exactamente como antes de D-1(a)
    // (no es un retroceso, es el mismo comportamiento que ya tenía).
    const sinV2 = resolverClasificacion(productoLecturaDesde('ZCNTG4AB'), [], null);
    expect(sinV2.descr).toEqual({ valor: 'Label roll T61 40MM BLACK', origen: 'fuente' });
    expect(sinV2.familia).toEqual({ valor: null, origen: 'fuente' });
  });

  it('d. SKU NUEVO (alta): resolverClasificacion sin fila v2 → TODAS las capas en "fuente", incluida tecnologia (CAT-B1: ahora SÍ tiene capa fuente)', () => {
    const r = resolverClasificacion(productoLecturaDesde('NB7741-J'), [], null);
    expect(r.descr).toEqual({ valor: 'New sample product', origen: 'fuente' });
    expect(r.familia).toEqual({ valor: 'NEW LINE', origen: 'fuente' });
    expect(r.marca).toEqual({ valor: 'NACIONAL', origen: 'fuente' });
    expect(r.clase).toEqual({ valor: null, origen: 'fuente' });
    // Antes de CAT-B1: `{valor: null, origen: null}` (sin capa fuente). Este
    // grid no trae columna TECNOLOGIA (cuarentena 'columna_ausente_tecnologia'
    // del test de "setup"), así que el VALOR sigue null — pero el ORIGEN ya
    // es 'fuente', nunca `null`: la capa existe, simplemente no trae dato.
    expect(r.tecnologia).toEqual({ valor: null, origen: 'fuente' });
    // CAMPO NUEVO de esta resolución: mismo caso, sin columna PRODUCTO en el
    // grid ('columna_ausente_producto').
    expect(r.producto).toEqual({ valor: null, origen: 'fuente' });
  });

  it('e. BAJA: buildSkuDetalle (import real de sku.service) con P_snap ≠ vigente(stock) simulado → snapshot.stock.vigente===false (B4 intacta)', () => {
    // La RPC (0005) hace upsert por sku SOLO de los skus presentes en el
    // payload nuevo (`ON CONFLICT (sku) DO UPDATE`); VKBTJ8830RX no viene en
    // el grid del mes siguiente → su fila en `productos` NUNCA se toca y
    // sigue apuntando al snapshot_id de abril (P_snap), mientras
    // vigente('stock') avanza al snapshot de mayo. Se simula ese estado.
    const vigenteStockMayo: SnapshotVigente = {
      id: 'snap-2026-05-stock',
      created_at: '2026-05-07T00:10:00.000Z',
      filas: 27,
      archivo: MES_SIGUIENTE_JOB.archivo,
    };
    const snapshotPropioAbril: SnapshotVigente = {
      id: PREV_SNAPSHOT_ID,
      created_at: '2026-04-07T00:10:00.000Z',
      filas: 15,
      archivo: 'abril.ods',
    };
    const baja = prevProductos.find((p) => p.sku === 'VKBTJ8830RX')!;

    const detalle = buildSkuDetalle({
      producto: {
        sku: baja.sku,
        resv: baja.resv,
        descr_origen: baja.descr,
        cliente: baja.cliente,
        class: baja.class,
        snapshot_id: PREV_SNAPSHOT_ID,
        marcas: { nombre: baja.marca },
        familias: baja.familia ? { nombre: baja.familia } : null,
      },
      stockRows: [{ cantidad: 4, almacenes: { clave: 'NORTH' } }],
      reservasRows: [],
      overrides: [],
      embarquesRows: [],
      metadata: null,
      vigenteStock: vigenteStockMayo,
      vigenteAduana: null,
      snapshotPropio: snapshotPropioAbril,
      hoy: '2026-05-10',
      v2: V2_LAYER.get('VKBTJ8830RX') ?? null, // no existe fila v2 (2 de 12 SKUs quedaron sin v2)
    });

    expect(detalle.sku).toBe('VKBTJ8830RX');
    expect(detalle.snapshot.stock).toEqual({
      id: PREV_SNAPSHOT_ID,
      created_at: snapshotPropioAbril.created_at,
      filas: 15,
      archivo: 'abril.ods',
      vigente: false,
    });
    // la ficha se sigue sirviendo con normalidad (no hay hueco ni 404 aquí)
    expect(detalle.total).toBe(4);
    expect(detalle.marca).toBe('BRAND10');
    expect(detalle.origenes?.descr).toBe('fuente');
  });

  it('f. gates (Σstock, Σreservas) evalúan igual sobre la base parcheada — el Map v2 nunca se pasa a computeSnapshot/gates', () => {
    expect(result.diag).toHaveLength(2);
    expect(result.diag).toEqual(
      expect.arrayContaining([
        { sku: 'T408-51-Q36', tipo: 'SUMA_STOCK', esperado: 8, obtenido: 10, delta: 2 },
        { sku: 'QN3055', tipo: 'SUMA_RESERVAS', esperado: 5, obtenido: 3, delta: -2 },
      ]),
    );
    // [CAT-B1·A] Antes decia `toBe(0)`. El grid sintetico de este test NO trae
    // TECNOLOGIA ni PRODUCTO, asi que ahora emite su rastro de columna ausente a
    // nivel de HOJA. El rojo era CORRECTO: el rastro hacia su trabajo.
    // NO se relaja el criterio — se hace MAS estricto: se enumeran los dos items
    // exactos y se exige que NINGUNO sea de fila, que es lo que este assert
    // queria decir con «sin cuarentena». Un `toBeLessThan` o un rango aqui
    // habria sido apagar el gate.
    // [FIX-B1·T4] 2 → 5: mismo motivo que en el test de "setup" de arriba —
    // `WEST_MES_SIGUIENTE` tampoco trae TECNOLOGIA/FAMILIA/CLASE.
    const motivos = result.cuarentena.items.map((c) => c.motivo).sort();
    expect(motivos).toEqual([
      'columna_ausente_clase',
      'columna_ausente_familia',
      'columna_ausente_producto',
      'columna_ausente_tecnologia',
      'columna_ausente_tecnologia',
    ]);
    expect(result.cuarentena.items.every((c) => c.sku === null)).toBe(true);
    expect(result.cuarentena.total).toBe(5);
  });
});

// ============================================================
// NIVEL 2 (runtime vivo, post-O6) — NO SE IMPLEMENTA EN ESTA SUITE.
// Requiere red + service_role contra el proyecto Supabase REAL (fuera del
// alcance de F5, que es 100% en memoria/fs). Se ejecuta a mano
// DESPUÉS de aplicar el parche real (migración 0008 + `clasificacion_v2`
// poblada por O6):
//   1. Re-POST de los MISMOS fixtures originales de abril
//      (`src/services/etl/__tests__/fixtures/muestra/*.json`, los mismos que
//      lee `cargarReferenciaAbril` en `src/services/ingesta/io.ts`) a `/api/refresh`, dos veces
//      seguidas (`x-ingest-secret` + `source: 'stock'` y `source: 'aduana'`).
//   2. Esperar `sinCambios: true` en AMBOS POSTs:
//        - El primero confirma, contra una BD real, lo que aquí se prueba
//          en frío (Nivel 1b): poblar `clasificacion_v2` no altera el hash
//          del snapshot vigente de `productos` — la capa v2 nunca re-escribe
//          filas de `productos`.
//        - El segundo es el control de idempotencia estándar del ETL (ya
//          cubierto en frío por computeSnapshot.test.ts), ahora validado
//          con la capa v2 ya presente en la base.
//   3. Verificar que `GET /api/sku/[sku]` de algún SKU con fila v2 real
//      sigue devolviendo `origenes.*` coherentes (manual>v2>fuente) después
//      de ese re-POST.
// ============================================================
