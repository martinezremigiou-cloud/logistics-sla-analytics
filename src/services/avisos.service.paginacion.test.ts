// ============================================================
// [FIX-B2 · ronda 2] avisos.service.paginacion.test.ts — el corte de 1 000
// filas en las LECTURAS de la campana y del correo.
//
// EL DEFECTO: `leerCambios`
// leía `cambios` con `.order('detectado_en', asc).range(0, 4999)`. PostgREST
// devuelve como máximo 1 000 filas por respuesta SIN error, pida el rango lo
// que pida; la ventana de 14 días podía pasar de las 1 000 filas, y como el orden es
// ascendente se quedaban las 1 000 MÁS VIEJAS: todo lo posterior a esas
// desaparecía del pulso. La misma forma estaba en `leerCifras` y
// `leerEnCamino` (sanas hoy por volumen), y `leerResumenCatalogo` paginaba a
// mano con un orden que no era total en `stock_por_almacen`.
//
// EL UNIVERSO REPRODUCE LA FORMA MEDIDA, no una cómoda: la ventana real tenía
// varios instantes con muchísimas filas en UNO solo (la ingesta sella con un
// instante toda la carga). Aquí, 2 600 filas en 7 instantes de tamaños
// desiguales, puestos para que los cortes de página (1 000 y 2 000) caigan
// DENTRO de un empate de `detectado_en`: ordenar sólo por fecha repite y salta
// filas en este fake igual que en Postgres.
//
// El fake es el compartido (`src/lib/supabase/__tests__/fake-postgrest.ts`):
// tope de 1 000 filas sin importar el `.range`, `.range` como OFFSET/LIMIT, y
// sin ORDER BY total no promete orden.
// ============================================================
import { describe, it, expect } from 'vitest';
import { leerCambios, leerCifras, leerEnCamino, leerResumenCatalogo } from './avisos.service';
import { fakePostgrest, firmaOrden, revuelto, MAX_FILAS, type Fila } from '@/lib/supabase/__tests__/fake-postgrest';

const pad = (i: number, n = 4) => String(i).padStart(n, '0');
const skuDe = (i: number) => `SKU-${pad(i)}`;

// ------------------------------------------------------------
// `cambios`
// ------------------------------------------------------------

/** Los 7 instantes de la ventana y cuántas filas sella cada uno. Acumulado: 120 · 570 · 1 270 · 1 650 · 2 150 · 2 450 · 2 600. */
const INSTANTES: Array<[string, number]> = [
  ['2026-09-16T10:00:00.000Z', 120],
  ['2026-09-17T16:00:00.000Z', 450],
  ['2026-09-17T21:30:00.000Z', 700], // el corte de 1 000 cae aquí dentro
  ['2026-09-20T09:12:00.000Z', 380],
  ['2026-09-23T18:30:00.000Z', 500], // y el de 2 000, aquí
  ['2026-09-26T08:00:00.000Z', 300],
  ['2026-09-29T00:00:02.000Z', 150], // lo MÁS RECIENTE: lo que el defecto perdía
];
const EN_VENTANA = 2600;
const DESDE = '2026-09-15T00:00:00.000Z';
const ULTIMO = INSTANTES[INSTANTES.length - 1][0];
const SKUS_CAMBIOS = 300;
const ENTIDADES = ['stock', 'producto', 'embarque'] as const;
const CAMPO: Record<(typeof ENTIDADES)[number], string> = { stock: 'cantidad', producto: 'resv', embarque: 'estatus' };

/**
 * `valor_nuevo` es único por fila (`v-<k>`) y es la IDENTIDAD que usan las
 * aserciones: no dependen de que el fake devuelva `id` —que el select no pide—.
 */
function universoCambios(): Fila[] {
  const filas: Fila[] = [];
  let k = 0;
  // Filas que los filtros tienen que dejar FUERA: antes de `desde`, y de una
  // entidad que no es aviso de ventas (`reserva`).
  for (let i = 0; i < 40; i++) {
    filas.push({ entidad: 'stock', campo: 'cantidad', tipo: 'MODIFICACION', sku: skuDe(1 + (i % SKUS_CAMBIOS)), valor_anterior: '0', valor_nuevo: `viejo-${i}`, detectado_en: '2026-09-10T00:00:00.000Z', snapshot_id: 'snap-viejo' });
  }
  INSTANTES.forEach(([instante, cuantas], s) => {
    for (let j = 0; j < cuantas; j++, k++) {
      const entidad = ENTIDADES[k % ENTIDADES.length];
      filas.push({
        entidad,
        campo: CAMPO[entidad],
        tipo: 'MODIFICACION',
        sku: skuDe(1 + ((k * 13) % SKUS_CAMBIOS)),
        valor_anterior: '1',
        valor_nuevo: `v-${pad(k, 5)}`,
        detectado_en: instante,
        snapshot_id: `snap-${s}`,
      });
    }
    for (let j = 0; j < 10; j++) {
      filas.push({ entidad: 'reserva', campo: 'cantidad', tipo: 'ALTA', sku: skuDe(1 + j), valor_anterior: null, valor_nuevo: `reserva-${s}-${j}`, detectado_en: instante, snapshot_id: `snap-${s}` });
    }
  });
  // La PK: un `id` por fila que NO sigue el orden de inserción, como un uuid.
  filas.forEach((f, i) => {
    f.id = `cam-${pad(revuelto(i + 1, filas.length), 5)}`;
  });
  return filas;
}

/** Lo que la consulta DEBE devolver, en el orden que el consumidor exige: (detectado_en, id) ascendente. */
function esperadoCambios(universo: Fila[], filtro: (f: Fila) => boolean): string[] {
  return universo
    .filter((f) => ENTIDADES.includes(f.entidad as (typeof ENTIDADES)[number]) && String(f.detectado_en) >= DESDE && filtro(f))
    .sort((a, b) =>
      String(a.detectado_en) < String(b.detectado_en)
        ? -1
        : String(a.detectado_en) > String(b.detectado_en)
          ? 1
          : String(a.id) < String(b.id)
            ? -1
            : String(a.id) > String(b.id)
              ? 1
              : 0,
    )
    .map((f) => String(f.valor_nuevo));
}

describe('[FIX-B2] la vara: el universo de `cambios` pone el corte de página dentro de un empate', () => {
  it('la ventana tiene 2 600 filas y los cortes 1 000 y 2 000 caen DENTRO de un instante, no en una frontera', () => {
    const acumulado = INSTANTES.reduce<number[]>((acc, [, n]) => [...acc, (acc[acc.length - 1] ?? 0) + n], []);
    expect(acumulado[acumulado.length - 1]).toBe(EN_VENTANA);
    // Ningún corte coincide con una frontera entre instantes: sin `id`, el
    // orden por fecha sola empata justo en el corte.
    for (const corte of [1000, 2000]) expect(acumulado).not.toContain(corte);
  });

  it('una consulta ordenada sólo por fecha, sin paginar, recibe 1 000 de 2 600 — las MÁS VIEJAS', async () => {
    const { db } = fakePostgrest({ cambios: universoCambios() });
    const r = (await db
      .from('cambios')
      .select('*')
      .gte('detectado_en', DESDE)
      .in('entidad', [...ENTIDADES])
      .order('detectado_en', { ascending: true })
      .range(0, 4999)) as unknown as { data: Fila[] };
    expect(r.data).toHaveLength(MAX_FILAS);
    expect(r.data.some((f) => f.detectado_en === ULTIMO)).toBe(false);
  });
});

describe('[FIX-B2] leerCambios trae la ventana ENTERA, en orden (detectado_en, id) ascendente', () => {
  it('global (pulso): las 2 600 filas, sin repetidas, en el orden exacto, y las más recientes presentes', async () => {
    const universo = universoCambios();
    const { db } = fakePostgrest({ cambios: universo });

    const r = await leerCambios(db, DESDE, null);

    expect(r).toHaveLength(EN_VENTANA);
    expect(new Set(r.map((c) => c.valor_nuevo)).size).toBe(EN_VENTANA);
    expect(r.map((c) => c.valor_nuevo)).toEqual(esperadoCambios(universo, () => true));
    // Lo que el defecto perdía: todo lo posterior al corte de la primera página.
    expect(r.filter((c) => c.detectado_en === ULTIMO)).toHaveLength(150);
    expect(r[r.length - 1].detectado_en).toBe(ULTIMO);
    // Y los filtros viajaron en CADA página: nada de antes de `desde`, nada de `reserva`.
    expect(r.some((c) => c.entidad === 'reserva' || c.detectado_en < DESDE)).toBe(false);
  });

  it('global con `hasta` (la ventana del correo): el techo se aplica en todas las páginas', async () => {
    const universo = universoCambios();
    const { db } = fakePostgrest({ cambios: universo });
    const HASTA = '2026-09-23T18:30:00.000Z'; // incluye el 5.º instante, excluye los dos últimos

    const r = await leerCambios(db, DESDE, null, HASTA);

    const esperado = esperadoCambios(universo, (f) => String(f.detectado_en) <= HASTA);
    expect(esperado).toHaveLength(2150);
    expect(r.map((c) => c.valor_nuevo)).toEqual(esperado);
  });

  it('por lotes de SKU (avisos): los 300 SKU en dos lotes, todas sus filas, y cada SKU en orden (detectado_en, id)', async () => {
    const universo = universoCambios();
    const { db, consultas } = fakePostgrest({ cambios: universo });
    const skus = Array.from({ length: SKUS_CAMBIOS }, (_, i) => skuDe(i + 1));

    const r = await leerCambios(db, DESDE, skus);

    expect(r).toHaveLength(EN_VENTANA);
    expect(new Set(r.map((c) => c.valor_nuevo)).size).toBe(EN_VENTANA);
    expect(r.filter((c) => c.detectado_en === ULTIMO)).toHaveLength(150);

    // El orden global por fecha se restaura tras el troceo…
    for (let i = 1; i < r.length; i++) expect(r[i - 1].detectado_en <= r[i].detectado_en).toBe(true);
    // …y el de CADA SKU —lo único que `agregarPorSku` lee— es (detectado_en, id).
    for (const sku of skus) {
      expect(r.filter((c) => c.sku === sku).map((c) => c.valor_nuevo), sku).toEqual(
        esperadoCambios(universo, (f) => f.sku === sku),
      );
    }

    // Y de verdad fueron dos lotes, y el primero cruzó el tope (paginó).
    const lotes = new Set(consultas.map((c) => JSON.stringify(c.listas.find(([col]) => col === 'sku')?.[1])));
    expect(lotes.size).toBe(2);
    expect(consultas.some((c) => c.rango?.[0] === MAX_FILAS)).toBe(true);
  });

  it('por lotes, con un subconjunto de SKU: sólo sus filas, y ninguna de otro', async () => {
    const universo = universoCambios();
    const { db } = fakePostgrest({ cambios: universo });
    const skus = Array.from({ length: 250 }, (_, i) => skuDe(i + 1));
    const dentro = new Set(skus);

    const r = await leerCambios(db, DESDE, skus);

    const esperado = esperadoCambios(universo, (f) => dentro.has(String(f.sku)));
    expect(esperado.length).toBeGreaterThan(MAX_FILAS);
    expect(r).toHaveLength(esperado.length);
    expect(new Set(r.map((c) => c.valor_nuevo))).toEqual(new Set(esperado));
    expect(r.every((c) => dentro.has(String(c.sku)))).toBe(true);
  });

  it('cada página pide el orden TOTAL (detectado_en, id) y avanza de 1 000 en 1 000', async () => {
    const { db, consultas } = fakePostgrest({ cambios: universoCambios() });
    await leerCambios(db, DESDE, null);

    expect(consultas.map((c) => c.rango)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    for (const c of consultas) expect(firmaOrden(c)).toBe('detectado_en,id');
  });

  it('`skus` vacío no consulta nada', async () => {
    const { db, consultas } = fakePostgrest({ cambios: universoCambios() });
    expect(await leerCambios(db, DESDE, [])).toEqual([]);
    expect(consultas).toHaveLength(0);
  });

  it('un error en la PÁGINA 2 conserva el mensaje `cambios: <error>` (global y por lotes)', async () => {
    const falla = (c: { rango: [number, number] | null }) => (c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null);
    const global = fakePostgrest({ cambios: universoCambios() }, falla);
    await expect(leerCambios(global.db, DESDE, null)).rejects.toThrow(/^cambios: timeout en la página 2$/);

    const porLotes = fakePostgrest({ cambios: universoCambios() }, falla);
    const skus = Array.from({ length: SKUS_CAMBIOS }, (_, i) => skuDe(i + 1));
    await expect(leerCambios(porLotes.db, DESDE, skus)).rejects.toThrow(/^cambios: timeout en la página 2$/);
  });
});

// ------------------------------------------------------------
// `stock_por_almacen` · `productos` · `embarques`
// ------------------------------------------------------------

const ALMACENES = ['alm-1', 'alm-2', 'alm-3', 'alm-4', 'alm-5', 'alm-6'];
/** Potencias de 2 por almacén: la suma es 63 SÓLO si cada fila llega exactamente una vez (una repetida y una saltada no se compensan). */
const CANTIDAD = [1, 2, 4, 8, 16, 32];
const TOTAL_POR_SKU = 63;
/** 62: con él, `disponible` es 1 (> 0) sólo si las 6 filas del SKU llegaron; con una de menos es negativo. */
const RESV = TOTAL_POR_SKU - 1;
const SKUS_STOCK = 200; // un lote de `LOTE_IN`: 200 × 6 = 1 200 filas, el corte cae dentro del SKU 167

const SNAPSHOTS: Fila[] = [
  { id: 'snap-viejo', fuente: 'stock', created_at: '2026-09-01T00:00:00.000Z', filas: 1, archivo: null },
  { id: 'snap-stock', fuente: 'stock', created_at: '2026-09-29T00:00:00.000Z', filas: 1, archivo: null },
  { id: 'snap-aduana', fuente: 'aduana', created_at: '2026-09-29T00:00:02.000Z', filas: 1, archivo: null },
];

function filasStock(skus: number, snapshot = 'snap-stock'): Fila[] {
  const filas: Fila[] = [];
  for (let i = 1; i <= skus; i++) {
    ALMACENES.forEach((almacen_id, a) => {
      filas.push({ sku: skuDe(i), almacen_id, snapshot_id: snapshot, cantidad: CANTIDAD[a] });
    });
  }
  return filas;
}

describe('[FIX-B2] leerCifras: el stock de un lote de 200 SKU (1 200 filas) llega entero', () => {
  it('cada SKU suma sus 6 almacenes: disponible = 63 − 62 = 1 para los 200', async () => {
    const productos = Array.from({ length: SKUS_STOCK }, (_, i) => ({ sku: skuDe(i + 1), resv: RESV, snapshot_id: 'snap-stock' }));
    // Filas de un snapshot VIEJO de los mismos SKU: el `.eq('snapshot_id')` tiene que dejarlas fuera en cada página.
    const stock = [...filasStock(SKUS_STOCK), ...filasStock(SKUS_STOCK, 'snap-viejo').map((f) => ({ ...f, cantidad: 1000 }))];
    const { db, consultas } = fakePostgrest({ snapshots: SNAPSHOTS, productos, stock_por_almacen: stock });
    const skus = productos.map((p) => p.sku);

    const cifras = await leerCifras(db, skus);

    expect(cifras.size).toBe(SKUS_STOCK);
    for (const sku of skus) expect(cifras.get(sku), sku).toEqual({ disponible: 1, reservado: RESV });

    const lecturas = consultas.filter((c) => c.tabla === 'stock_por_almacen');
    expect(lecturas.map((c) => c.rango)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    for (const c of lecturas) expect(firmaOrden(c)).toBe('sku,almacen_id');
  });

  it('un error en la página 2 del stock conserva `stock_por_almacen: <error>`', async () => {
    const productos = Array.from({ length: SKUS_STOCK }, (_, i) => ({ sku: skuDe(i + 1), resv: 0, snapshot_id: 'snap-stock' }));
    const { db } = fakePostgrest({ snapshots: SNAPSHOTS, productos, stock_por_almacen: filasStock(SKUS_STOCK) }, (c) =>
      c.tabla === 'stock_por_almacen' && c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null,
    );
    await expect(leerCifras(db, productos.map((p) => p.sku))).rejects.toThrow(/^stock_por_almacen: timeout en la página 2$/);
  });
});

describe('[FIX-B2] leerEnCamino: los embarques vivos del vigente llegan todos aunque pasen de 1 000', () => {
  const ETAPAS = Array.from({ length: 11 }, (_, i) => ({ orden: i + 1, nombre: `Etapa ${i + 1}` }));

  function embarques(): Fila[] {
    const filas: Fila[] = [];
    for (let j = 1; j <= 2000; j++) {
      filas.push({
        id: `emb-${pad(revuelto(j, 2000))}`,
        sku: skuDe(j),
        piezas: j,
        estatus_id: 1 + (j % 11),
        // 1 300 vivos y 700 en el histórico, intercalados.
        is_historial: j % 20 >= 13,
        snapshot_id: 'snap-aduana',
      });
    }
    // Otro snapshot de aduana: fuera por el `.eq('snapshot_id')`.
    filas.push({ id: 'emb-viejo', sku: 'SKU-VIEJO', piezas: 1, estatus_id: 1, is_historial: false, snapshot_id: 'snap-otro' });
    return filas;
  }

  it('1 300 vivos → 1 300 en camino, cada uno con su etapa, sin repetidos', async () => {
    const universo = embarques();
    const vivos = universo.filter((f) => f.snapshot_id === 'snap-aduana' && f.is_historial === false);
    expect(vivos).toHaveLength(1300);
    const { db, consultas } = fakePostgrest({ snapshots: SNAPSHOTS, estatus_catalogo: ETAPAS, embarques: universo });

    const r = await leerEnCamino(db);

    expect(r).toHaveLength(1300);
    expect(new Set(r.map((e) => e.sku))).toEqual(new Set(vivos.map((f) => f.sku)));
    const porSku = new Map(r.map((e) => [e.sku, e]));
    for (const f of vivos) {
      expect(porSku.get(String(f.sku))).toEqual({ sku: f.sku, piezas: f.piezas, etapa: `Etapa ${String(f.estatus_id)}` });
    }

    const lecturas = consultas.filter((c) => c.tabla === 'embarques');
    expect(lecturas.map((c) => c.rango)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    for (const c of lecturas) expect(firmaOrden(c)).toBe('id');
  });

  it('si fallan el catálogo Y la página 2 de embarques, se reporta el catálogo primero (el orden de antes)', async () => {
    const { db } = fakePostgrest({ snapshots: SNAPSHOTS, estatus_catalogo: ETAPAS, embarques: embarques() }, (c) => {
      if (c.tabla === 'estatus_catalogo') return 'catálogo caído';
      if (c.tabla === 'embarques' && c.rango !== null && c.rango[0] >= MAX_FILAS) return 'timeout en la página 2';
      return null;
    });
    await expect(leerEnCamino(db)).rejects.toThrow(/^estatus_catalogo: catálogo caído$/);
  });

  it('y si sólo falla la página 2 de embarques: `embarques: <error>`', async () => {
    const { db } = fakePostgrest({ snapshots: SNAPSHOTS, estatus_catalogo: ETAPAS, embarques: embarques() }, (c) =>
      c.tabla === 'embarques' && c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null,
    );
    await expect(leerEnCamino(db)).rejects.toThrow(/^embarques: timeout en la página 2$/);
  });
});

describe('[FIX-B2] leerResumenCatalogo: 1 200 productos y 1 200 filas de stock, con orden TOTAL en las dos', () => {
  const PRODUCTOS = 1200;

  function universo() {
    const productos: Fila[] = [];
    for (let i = 1; i <= PRODUCTOS; i++) productos.push({ sku: skuDe(i), resv: RESV, snapshot_id: 'snap-stock' });
    // Remanentes de un snapshot viejo: no son del catálogo vigente.
    for (let i = 1; i <= 20; i++) productos.push({ sku: `REM-${pad(i)}`, resv: 0, snapshot_id: 'snap-viejo' });
    return { snapshots: SNAPSHOTS, productos, stock_por_almacen: filasStock(SKUS_STOCK) };
  }

  it('total = 1 200 del vigente; disponibles = los 200 con stock (63 − 62); conReserva = los 1 200', async () => {
    const { db } = fakePostgrest(universo());
    expect(await leerResumenCatalogo(db)).toEqual({ total: PRODUCTOS, disponibles: SKUS_STOCK, conReserva: PRODUCTOS });
  });

  it('cada lectura pagina de 1 000 en 1 000 con la PK de su tabla: productos (sku) · stock (sku, almacen_id)', async () => {
    const { db, consultas } = fakePostgrest(universo());
    await leerResumenCatalogo(db);

    for (const [tabla, orden] of [
      ['productos', 'sku'],
      ['stock_por_almacen', 'sku,almacen_id'],
    ] as const) {
      const cs = consultas.filter((c) => c.tabla === tabla);
      expect(cs.map((c) => c.rango), tabla).toEqual([
        [0, 999],
        [1000, 1999],
      ]);
      for (const c of cs) expect(firmaOrden(c), tabla).toBe(orden);
    }
  });

  it('un error en la página 2 conserva `<tabla>: <error>`', async () => {
    for (const tabla of ['productos', 'stock_por_almacen']) {
      const { db } = fakePostgrest(universo(), (c) =>
        c.tabla === tabla && c.rango !== null && c.rango[0] >= MAX_FILAS ? 'timeout en la página 2' : null,
      );
      await expect(leerResumenCatalogo(db), tabla).rejects.toThrow(new RegExp(`^${tabla}: timeout en la página 2$`));
    }
  });
});
