// ============================================================
// [F3 · item 2] proyectos.service.ts NO TENÍA NINGUNA PRUEBA antes de este
// bloque — ni de la lectura (`leerUniversoDePartidas`, select ~:235) ni del
// mapeo fetch→DTO de `tecnologia` (~:290: `tecnologia: r.tecnologia ?? null,`).
//
// Ese mapeo es lo que alimenta la agrupación de partidas por eje de banda
// que usa el documento PDF (`resolverAgrupacion`/`resumenDeAgrupacion`,
// `documento/resoluciones.ts`, vía `armarDetalle` en este mismo servicio):
// sin `tecnologia`, TODAS las partidas caerían en el eje `sin_banda` aunque
// el Excel sí traiga la columna — el documento se imprimiría sin agrupar y
// nadie lo notaría porque no hay error, solo un DTO más pobre.
//
// CONTROL NEGATIVO (reportado en la entrega del bloque F3): mutar la línea
// `tecnologia: r.tecnologia ?? null,` a `tecnologia: null,` en
// `leerUniversoDePartidas` deja este test en ROJO.
//
// [C2 · CORRECCIÓN] Esta cabecera daba a entender que el archivo cubría la
// lectura y el camino completo hasta la banda. No era así, medido en la
// verificación de FIX-B1, por DOS huecos del fake:
//   · El fake devolvía `tecnologia` aunque el select no la pidiera: quitar
//     `,tecnologia` del select de `productos` dejaba ESTE archivo en VERDE.
//     Quien sí lo veía es `tsc` — medido en C2 sobre una copia: exit 2,
//     TS2339 «Property 'tecnologia' does not exist» en el mapeo
//     `r.tecnologia` (el parser de selects de supabase-js tipa la FORMA de la
//     fila aunque los valores salgan `any`). Pero vitest transpila con
//     esbuild y no comprueba tipos, así que esa guarda no vive en esta
//     suite. Ahora hay una segunda, aquí: una aserción sobre la CADENA del
//     select —como hace `dashboard.service.test.ts`—, en el último
//     `describe` de este archivo.
//   · El fake devolvía `[]` para `productos_override`, así que la captura del
//     portal nunca entraba: `resolverClasificacion(producto, [], v2)` en
//     `armarDetalle` dejaba 0 rojos. Ahora hay dos casos con captura activa
//     de `campo='tecnologia'`: sobre un SKU con el Excel VACÍO (la captura
//     llena el hueco) y sobre uno que YA trae Excel (gana el Excel —
//     `capaFuenteManual`, derivaciones.ts).
// CONTROLES NEGATIVOS de C2, medidos en una COPIA del árbol (no en éste):
// los dos mutantes de arriba —sin overrides; sin `,tecnologia` en el
// select— salen ROJOS en esta suite con los casos nuevos (el segundo,
// además, en `tsc`).
//
// [C2 · ronda 2] Quedaba un tercer hueco del MISMO tipo, y éste sin `tsc`
// detrás: el select de `productos_override` en `leerUniversoDePartidas`
// (`'id,sku,campo,valor_editado,editado_en,activo'`) no lo vigilaba nada.
// Su resultado pasa por `(overrides.data ?? []) as unknown as
// OverrideLectura[]`, y ESE CAST CIEGA A `tsc`: tira la forma que el parser
// de selects sí deduce, así que a la cadena se le puede caer una columna y
// `tsc` sale en 0 (lo contrario del `.map` de `productos`, que lee
// `r.tecnologia` y por eso sí truena). Sin `campo` o sin `activo`,
// `overrideActivo` (derivaciones.ts) descarta TODAS las capturas
// (`o.campo !== campo || !o.activo` → `continue`): la partida pierde la
// tecnología y la descripción capturadas, y la familia capturada deja de
// contar para el badge `sin_familia` (`derivarSku` → `badgesDe`). Y los
// casos de captura de arriba seguirían VERDES, porque el fake devuelve la
// fila completa pida lo que pida el select. Por eso la guarda es la CADENA
// fijada, en el último `describe`, con la misma convención que
// `inventory.service.test.ts` usa para su propio select de esta tabla.
// CONTROLES NEGATIVOS, medidos en una COPIA del árbol: quitar `campo` del
// select → ROJO aquí; quitar `activo` → ROJO aquí; en los dos, `tsc` → 0.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SnapshotVigente } from './vigente.service';

const conVigenteStockMock = vi.fn();
vi.mock('./vigente.service', () => ({
  conVigenteStock: (...args: unknown[]) => conVigenteStockMock(...args),
}));

import { obtenerProyecto } from './proyectos.service';

// ------------------------------------------------------------
// Fake db — mismo espíritu que el `makeFakeDb` de dashboard.service.test.ts,
// adaptado a las formas de cadena que `proyectos.service.ts` usa de verdad:
// `.maybeSingle()` para filas únicas, y varias lecturas SIN `.range()` (el
// universo de un proyecto está topado por `MAX_PARTIDAS`, ver la cabecera
// de `leerUniversoDePartidas`).
// ------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code?: string } | null };

interface CallInfo {
  table: string;
  select: string;
  eq: [string, unknown][];
  in: [string, unknown[]] | null;
}

interface FakeChain extends PromiseLike<Resp> {
  eq(col: string, val: unknown): FakeChain;
  in(col: string, vals: unknown[]): FakeChain;
  // [FIX-B2] `stock_por_almacen` y `reservas` ahora paginan con `fetchAllRows`
  // y un orden total. Este fake acepta el `.order` sin aplicarlo: aquí esas
  // dos tablas responden vacío (una sola página). El corte de 1 000 filas y el
  // orden los prueba `proyectos.service.paginacion.test.ts`, con un fake que sí
  // se porta como PostgREST.
  order(col: string, opts?: { ascending?: boolean }): FakeChain;
  range(from: number, to: number): Promise<Resp>;
  maybeSingle(): Promise<Resp>;
  single(): Promise<Resp>;
}

function makeFakeDb(tableHandler: (info: CallInfo) => Resp) {
  const calls: CallInfo[] = [];

  function chain(table: string, select: string): FakeChain {
    const eqCalls: [string, unknown][] = [];
    let inCall: [string, unknown[]] | null = null;
    const resolve = (): Resp => {
      const info: CallInfo = { table, select, eq: [...eqCalls], in: inCall };
      calls.push(info);
      return tableHandler(info);
    };
    const node: FakeChain = {
      eq(col, val) {
        eqCalls.push([col, val]);
        return node;
      },
      in(col, vals) {
        inCall = [col, vals];
        return node;
      },
      order() {
        return node;
      },
      range() {
        return Promise.resolve(resolve());
      },
      maybeSingle() {
        return Promise.resolve(resolve());
      },
      single() {
        return Promise.resolve(resolve());
      },
      then(onfulfilled, onrejected) {
        return Promise.resolve(resolve()).then(onfulfilled, onrejected);
      },
    };
    return node;
  }

  const db = {
    from(table: string) {
      return { select: (sel: string) => chain(table, sel) };
    },
  };

  return { db: db as unknown as SupabaseClient, calls };
}

const PROYECTO_ROW = {
  id: 'p-1',
  propietario: 'user-1',
  perfiles: null,
  folio: 'F-001',
  titulo: 'Proyecto de prueba',
  descripcion: null,
  notas: null,
  fecha: '2026-09-01',
  tipo: null,
  intencion: null,
  creado_en: '2026-09-01T00:00:00.000Z',
};

const PARTIDAS_ROW = [
  { id: 'partida-1', sku: 'A-1', cantidad: 5 },
  { id: 'partida-2', sku: 'A-2', cantidad: 3 },
];

describe('obtenerProyecto — tecnología de fuente llega al detalle y a la agrupación del documento (PDF)', () => {
  it('fetch→mapeo: partida CON tecnología de fuente agrupa por eje "tecnologia"; partida SIN ella cae en "sin_banda"', async () => {
    const vigenteStock: SnapshotVigente = { id: 'stock-9', created_at: '2026-09-01T00:00:00.000Z', filas: 2, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigenteStock),
    );

    const productosRow = [
      {
        sku: 'A-1',
        resv: 0,
        descr_origen: 'Candado EAS',
        cliente: null,
        class: null,
        snapshot_id: 'stock-9',
        tecnologia: 'EAS',
        marcas: { nombre: 'BRAND1' },
        familias: null,
      },
      {
        sku: 'A-2',
        resv: 0,
        descr_origen: 'Sin tecnología',
        cliente: null,
        class: null,
        snapshot_id: 'stock-9',
        tecnologia: null,
        marcas: { nombre: 'BRAND1' },
        familias: null,
      },
    ];

    const { db } = makeFakeDb((info) => {
      if (info.table === 'proyectos') return { data: PROYECTO_ROW, error: null };
      if (info.table === 'proyecto_partidas') return { data: PARTIDAS_ROW, error: null };
      if (info.table === 'productos') return { data: productosRow, error: null };
      return { data: [], error: null };
    });

    const detalle = await obtenerProyecto(db, 'p-1');

    expect(detalle).not.toBeNull();
    const a1 = detalle!.partidas.find((p) => p.sku === 'A-1')!;
    const a2 = detalle!.partidas.find((p) => p.sku === 'A-2')!;

    expect(a1.tecnologia).toBe('EAS');
    expect(a1.banda).toBe('EAS');
    expect(a1.eje_banda).toBe('tecnologia');

    expect(a2.tecnologia).toBeNull();
    expect(a2.banda).toBeNull();
    expect(a2.eje_banda).toBe('sin_banda');

    // El resumen que el documento imprime: el MEJOR eje que produjo alguna
    // banda es 'tecnologia' (por A-1); A-2 queda DECLARADO sin banda, no
    // escondido (mismo criterio que el resto del dominio: cero visible, no
    // fabricado).
    expect(detalle!.agrupacion).toEqual({ eje: 'tecnologia', sinBanda: 1 });

    // El selector de facetas (pantalla y documento) sale del dato real, no
    // de una lista fija — con la mutación, esto quedaría en `[]`.
    expect(detalle!.facetas.tecnologias).toEqual(['EAS']);
  });

  it('NINGUNA partida trae tecnología de fuente → el documento agrupa "sin_banda" y lo declara (control positivo del caso opuesto)', async () => {
    const vigenteStock: SnapshotVigente = { id: 'stock-9', created_at: '2026-09-01T00:00:00.000Z', filas: 2, archivo: null };
    conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
      fetcher(vigenteStock),
    );

    const productosRow = [
      { sku: 'A-1', resv: 0, descr_origen: 'Sin tec 1', cliente: null, class: null, snapshot_id: 'stock-9', tecnologia: null, marcas: { nombre: 'BRAND1' }, familias: null },
      { sku: 'A-2', resv: 0, descr_origen: 'Sin tec 2', cliente: null, class: null, snapshot_id: 'stock-9', tecnologia: null, marcas: { nombre: 'BRAND1' }, familias: null },
    ];

    const { db } = makeFakeDb((info) => {
      if (info.table === 'proyectos') return { data: PROYECTO_ROW, error: null };
      if (info.table === 'proyecto_partidas') return { data: PARTIDAS_ROW, error: null };
      if (info.table === 'productos') return { data: productosRow, error: null };
      return { data: [], error: null };
    });

    const detalle = await obtenerProyecto(db, 'p-1');

    expect(detalle!.agrupacion).toEqual({ eje: 'sin_banda', sinBanda: 2 });
    expect(detalle!.facetas.tecnologias).toEqual([]);
  });
});

// ------------------------------------------------------------
// [C2] Arnés de los casos nuevos: el MISMO fake de arriba, pero ahora
// `productos_override` devuelve lo que cada caso le da — antes caía en el
// `return { data: [], ... }` genérico y la captura nunca llegaba a
// `resolverClasificacion`.
// ------------------------------------------------------------
const VIGENTE_STOCK: SnapshotVigente = { id: 'stock-9', created_at: '2026-09-01T00:00:00.000Z', filas: 2, archivo: null };

function filaProducto(sku: string, tecnologia: string | null) {
  return {
    sku,
    resv: 0,
    descr_origen: 'Descr ' + sku,
    cliente: null,
    class: null,
    snapshot_id: 'stock-9',
    tecnologia,
    marcas: { nombre: 'BRAND1' },
    familias: null,
  };
}

/** Una captura ACTIVA del portal, con la forma de fila que el select de `productos_override` pide. */
function capturaTecnologia(sku: string, valor: string) {
  return { id: 'ov-' + sku, sku, campo: 'tecnologia', valor_editado: valor, editado_en: '2026-09-01T00:00:00.000Z', activo: true };
}

async function obtenerCon(productosRow: unknown[], overridesRow: unknown[]) {
  conVigenteStockMock.mockImplementationOnce(async (_db: unknown, fetcher: (v: SnapshotVigente) => Promise<unknown>) =>
    fetcher(VIGENTE_STOCK),
  );
  const { db, calls } = makeFakeDb((info) => {
    if (info.table === 'proyectos') return { data: PROYECTO_ROW, error: null };
    if (info.table === 'proyecto_partidas') return { data: PARTIDAS_ROW, error: null };
    if (info.table === 'productos') return { data: productosRow, error: null };
    if (info.table === 'productos_override') return { data: overridesRow, error: null };
    return { data: [], error: null };
  });
  const detalle = await obtenerProyecto(db, 'p-1');
  return { detalle, calls };
}

describe('obtenerProyecto — la captura del portal (productos_override, campo=tecnologia) llega a la banda del documento', () => {
  it('captura activa sobre un SKU con el Excel VACÍO → la banda es el valor capturado (la captura llena el hueco)', async () => {
    const { detalle } = await obtenerCon(
      [filaProducto('A-1', 'EAS'), filaProducto('A-2', null)],
      [capturaTecnologia('A-2', 'RFID')],
    );

    expect(detalle).not.toBeNull();
    const a2 = detalle!.partidas.find((p) => p.sku === 'A-2')!;
    expect(a2.tecnologia).toBe('RFID');
    expect(a2.banda).toBe('RFID');
    expect(a2.eje_banda).toBe('tecnologia');

    // Con la captura ya nadie queda sin banda. Si la captura no llegara a
    // `resolverClasificacion`, A-2 volvería a `sin_banda` y esto diría 1.
    expect(detalle!.agrupacion).toEqual({ eje: 'tecnologia', sinBanda: 0 });
    expect(detalle!.facetas.tecnologias).toEqual(['EAS', 'RFID']);
  });

  it('captura activa sobre un SKU que YA trae Excel → la banda es la del Excel (el Excel gana)', async () => {
    const { detalle } = await obtenerCon(
      [filaProducto('A-1', 'EAS'), filaProducto('A-2', null)],
      [capturaTecnologia('A-1', 'RFID')],
    );

    expect(detalle).not.toBeNull();
    const a1 = detalle!.partidas.find((p) => p.sku === 'A-1')!;
    expect(a1.tecnologia).toBe('EAS');
    expect(a1.banda).toBe('EAS');
    expect(a1.eje_banda).toBe('tecnologia');

    // El valor capturado no aparece en NINGUNA superficie del documento: ni
    // en la partida ni en el selector de facetas. Si ganara el portal, aquí
    // saldría ['RFID'].
    expect(detalle!.facetas.tecnologias).toEqual(['EAS']);

    // Y una captura sobre OTRO SKU no le llena el hueco a A-2.
    expect(detalle!.agrupacion).toEqual({ eje: 'tecnologia', sinBanda: 1 });
  });
});

describe('leerUniversoDePartidas — lo que la lectura PIDE, no lo que el fake devuelve', () => {
  // El fake devuelve las filas que se le dan SIN mirar el select, así que
  // ninguna aserción sobre el DTO puede notar que a la cadena se le cayó una
  // columna: saldría verde por la razón equivocada (P25). `tsc` sí lo nota
  // (ver la cabecera), pero esta suite corre sin comprobar tipos. Por eso se
  // pinnea la CADENA completa, igual que `dashboard.service.test.ts` pinnea
  // la suya: protege `tecnologia` y, de paso, a las demás columnas que el
  // fake también enmascara (`class`, `snapshot_id`…).
  //
  // Esto vigila la REPRESENTACIÓN (que la columna se pida). Que la columna
  // exista en la base es la migración 0036, y eso no se prueba aquí (P27).
  it('el select de `productos` pide `tecnologia` — cadena exacta', async () => {
    const { calls } = await obtenerCon([filaProducto('A-1', 'EAS'), filaProducto('A-2', null)], []);

    const productosCall = calls.find((c) => c.table === 'productos');
    expect(productosCall?.select).toBe(
      'sku,resv,descr_origen,cliente,class,snapshot_id,tecnologia, marcas(nombre), familias(nombre)',
    );
  });

  // [C2 · ronda 2] Ver la cabecera: aquí el cast `as unknown as
  // OverrideLectura[]` deja a `tsc` sin nada que comparar, así que esta
  // cadena es la ÚNICA guarda de las columnas que `overrideActivo` lee
  // (`sku`, `campo`, `activo`, `editado_en`, `id`) y de la que la resolución
  // entrega (`valor_editado`). El filtro `activo = true` se fija también,
  // igual que en `inventory.service.test.ts`.
  it('el select de `productos_override` pide `campo` y `activo` — cadena exacta', async () => {
    const { calls } = await obtenerCon(
      [filaProducto('A-1', 'EAS'), filaProducto('A-2', null)],
      [capturaTecnologia('A-2', 'RFID')],
    );

    const overridesCall = calls.find((c) => c.table === 'productos_override');
    expect(overridesCall?.select).toBe('id,sku,campo,valor_editado,editado_en,activo');
    expect(overridesCall?.eq).toEqual([['activo', true]]);
  });
});
