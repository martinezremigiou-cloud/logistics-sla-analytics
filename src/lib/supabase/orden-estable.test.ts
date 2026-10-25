// ============================================================
// [2.0.1-A · cierre] orden-estable.test.ts — el TRINQUETE del `OFFSET` sin
// `ORDER BY`.
//
// ────────────────────────────────────────────────────────────
// EL DEFECTO, dicho una vez y bien.
//
// `fetchAllRows` pagina con `.range(from, to)`, que PostgREST traduce a
// `LIMIT/OFFSET`. **Postgres no promete NINGÚN orden sin `ORDER BY`**, y con un
// `ORDER BY` no ÚNICO tampoco promete nada entre las filas empatadas. Sobre una
// tabla que se lee en dos o más páginas, eso significa que la página 2 puede
// repetir una fila que ya vino en la página 1 y saltarse otra — sin error, sin
// aviso, y con un total que sigue pareciendo redondo. No es teórico aquí: la
// ingesta hace `upsert` sobre `productos`, y un `UPDATE` mueve la tupla al final
// del heap, así que una lectura paginada concurrente con una carga es
// exactamente el caso patológico.
//
// Este bloque lo encontró en su PROPIO código (`drift-familias.service.ts`, dos
// sitios: `cambios` ordenado por un `detectado_en` que es idéntico dentro de un
// snapshot, y `productos` sin orden ninguno con más de mil filas = dos páginas) y
// los arregló. Al medir la condición que lo permitió apareció que **el patrón
// es del repo entero, desde el Bloque 3**: 24 sitios más, incluidos los que
// alimentan el catálogo y el dashboard.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ UN TRINQUETE Y NO UN BARRIDO.
//
// Arreglar los 24 es tocar las lecturas principales de dos pantallas en
// producción al cerrar un bloque cuyo encargo era otro, y sin el QA que ese
// cambio merece. Se declara como deuda **A1-9** (con disparador) y se pone esta
// guarda, que hace lo único que hace falta hoy: **que el número no suba**. Un
// sitio nuevo sin orden estable pone la suite en rojo y nombra el archivo; un
// sitio arreglado también la pone en rojo, pidiendo que se baje el contador.
// El inventario deja de depender de que alguien se acuerde.
//
// LO QUE ESTA GUARDA NO PUEDE VER, declarado: lee TEXTO. Comprueba que exista un
// `.order(`, **no** que la columna ordenada sea única — eso no se decide desde
// el fuente. Un `.order('sku')` sobre `productos` filtrado por snapshot sí es
// total (PK); un `.order('detectado_en')` a secas no lo es, y esta guarda lo
// daría por bueno. Por eso el arreglo de los dos sitios de este bloque lleva
// escrito, en su comentario, POR QUÉ la columna elegida desempata.
//
// ────────────────────────────────────────────────────────────
// [FIX-B2 · ronda 2] LO QUE ESTA GUARDA NO VEÍA, y ahora sí.
//
// Medido el 29-sep-2026: seis lecturas con la forma del defecto y ninguna en
// rojo aquí, porque el escáner sólo reconocía `fetchAllRows(...).range(from,
// to)`. Cinco eran `.range(0, 4999)` (`avisos.service.ts` ×3,
// `proyectos.service.ts` ×2 — una de ellas la que ya mordía: el pulso de la
// campana perdía todo lo posterior al 17-sep) y la sexta era un bucle de
// paginación hecho a mano (`traerTodo`, en `avisos.service.ts`). **PostgREST
// devuelve como máximo 1 000 filas por respuesta SIN error, pida el rango lo
// que pida**: un `.range(0, 4999)` no da margen, da 1 000. Tres reglas nuevas:
//
//   1. RANGO LITERAL MÁS ANCHO QUE EL TOPE. Un `.range(a, b)` con números
//      literales y b − a + 1 > 1 000 (o un `.limit(n)` con n > 1 000) pide
//      filas que el servidor no va a dar. Hoy: CERO, y no puede subir. Uno de
//      hasta 1 000 filas no es rojo AQUÍ, pero tampoco queda libre: entra a la
//      regla 2 (inventario exacto + orden por llave única).
//   2. RANGO FUERA DE `fetchAllRows`. Todo `.range(` que no sea el de un sitio
//      de `fetchAllRows` es una paginación a mano (o una página de interfaz):
//      queda en un inventario EXACTO por archivo y, además, tiene que ordenar
//      por una llave única. Un bucle `for (desde = 0; ; desde += 1000)` con
//      `.range(desde, …)` cae aquí.
//   3. EL ORDEN TIENE QUE CUBRIR UNA LLAVE ÚNICA DE ESA TABLA. La regla vieja
//      aceptaba cualquier `.order('id'` o `.order('sku'` de la cadena, y daba
//      por total un `.order('sku')` sobre `stock_por_almacen`, cuya PK es
//      (sku, almacen_id, snapshot_id): ahí `sku` empata entre almacenes. Ahora
//      cada tabla declara su llave (con la línea de la migración que la
//      define) y la cadena tiene que cubrirla: cada columna, ordenada o fijada
//      por un `.eq(`.
//
// LO QUE ESTAS REGLAS TAMPOCO VEN, declarado:
//   · Siguen leyendo TEXTO. El filtro de comentarios es una heurística de
//     línea: un `.range(` detrás de un `//` o en una línea que empieza por
//     `*` no cuenta. Un comentario de bloque cuyas líneas no empiecen por `*`
//     sí contaría (falla hacia el rojo, que es el lado seguro); un `//` dentro
//     de una cadena ANTES del `.range(` en la misma línea lo escondería.
//   · La cadena de un rango fuera de `fetchAllRows` va desde el último
//     `.from(` anterior hasta el `.range(`. Una consulta armada en otra función
//     o con la tabla en una variable no deja tabla que leer: se reporta como
//     orden NO total, que también es el lado seguro.
//   · Una paginación por LLAVE (`.gt('id', ultimo).order('id').limit(1000)`)
//     no usa `.range` y no se ve. Tampoco lo necesita: si ordena por la llave
//     por la que avanza, es correcta por construcción.
//   · Sólo `src/`. `scripts/` queda fuera, como antes.
//   · [FIX-B2 · cierre] Un SELECT SIN `.range` ni `.limit` no se ve — y ésa
//     fue exactamente la forma del defecto de `loadPrevState` (productos
//     entera, más de mil filas). Medido el 29-sep: decenas de lecturas así en `src/`,
//     ninguna pasa hoy de 1 000 (la mayor, `familias`, queda muy por debajo). Tampoco se ve un
//     `.limit(CONSTANTE)`. Deuda `EL-TRINQUETE-NO-VE-LECTURAS-SIN-TOPE`.
//   · `ordenTotal` lee también los comentarios que quedan DENTRO de la cadena:
//     un `// antes llevaba .order('almacen_id')` contaría como orden. Falla
//     hacia el verde; declarado.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** El archivo que DEFINE `fetchAllRows` no es un sitio de llamada. */
const DEFINICION = join('src', 'lib', 'supabase', 'fetch-all.ts');

function archivosFuente(dir: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) archivosFuente(ruta, salida);
    else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) salida.push(ruta);
  }
  return salida;
}

export interface SitioPaginado {
  archivo: string;
  /** El fragmento de cadena entre `fetchAllRows(` y su `.range(from, to)`. */
  cadena: string;
  ordenado: boolean;
  /** [FIX-B2] Posición de SU `.range(`: la regla 2 lo excluye de los rangos «a mano». */
  fin: number;
}

/**
 * Encuentra cada llamada a `fetchAllRows` y mira SU cadena, no el archivo
 * entero: un archivo con cinco lecturas y una sola `.order(` pasaría cualquier
 * comprobación a nivel de archivo mientras cuatro siguen rotas.
 */
export function sitiosPaginados(fuente: string, archivo: string): SitioPaginado[] {
  const sitios: SitioPaginado[] = [];
  const re = /fetchAllRows\s*(?:<[^>]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    const fin = fuente.indexOf('.range(from, to)', m.index);
    if (fin === -1) continue; // no es una lectura paginada por este helper
    const cadena = fuente.slice(m.index, fin);
    sitios.push({ archivo, cadena, ordenado: /\.order\(/.test(cadena), fin });
  }
  return sitios;
}

// ------------------------------------------------------------
// [FIX-B2 · ronda 2] Las tres reglas nuevas. Ver la cabecera.
// ------------------------------------------------------------

/** `max-rows` de PostgREST: lo más que devuelve UNA respuesta, sin error, pida lo que pida. */
const TOPE_POSTGREST = 1000;

/**
 * ¿La posición cae dentro de un comentario? Heurística de LÍNEA, declarada en
 * la cabecera: la línea empieza por `//`, `*` o `/*`, o hay un `//` antes en la
 * misma línea que no es parte de un `https://`.
 */
export function enComentario(fuente: string, indice: number): boolean {
  const inicio = fuente.lastIndexOf('\n', indice - 1) + 1;
  const previo = fuente.slice(inicio, indice);
  const recortado = previo.trimStart();
  if (recortado.startsWith('//') || recortado.startsWith('*') || recortado.startsWith('/*')) return true;
  return /(^|[^:])\/\//.test(previo);
}

function lineaDe(fuente: string, indice: number): number {
  return fuente.slice(0, indice).split('\n').length;
}

export interface PedidoLiteral {
  archivo: string;
  linea: number;
  /** El texto tal cual: `.range(0, 4999)` o `.limit(5000)`. */
  texto: string;
  filas: number;
}

/**
 * REGLA 1 · cada `.range(a, b)` y `.limit(n)` con números LITERALES, fuera de
 * comentarios, con las filas que pide. `conComentarios` existe sólo para la
 * prueba de anti-vacuidad del filtro.
 */
export function pedidosLiterales(fuente: string, archivo: string, conComentarios = false): PedidoLiteral[] {
  const salida: PedidoLiteral[] = [];
  const num = (s: string) => Number(s.replace(/_/g, ''));
  const reRango = /\.range\(\s*(\d[\d_]*)\s*,\s*(\d[\d_]*)\s*\)/g;
  const reLimite = /\.limit\(\s*(\d[\d_]*)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = reRango.exec(fuente)) !== null) {
    if (!conComentarios && enComentario(fuente, m.index)) continue;
    salida.push({ archivo, linea: lineaDe(fuente, m.index), texto: m[0], filas: num(m[2]) - num(m[1]) + 1 });
  }
  while ((m = reLimite.exec(fuente)) !== null) {
    if (!conComentarios && enComentario(fuente, m.index)) continue;
    salida.push({ archivo, linea: lineaDe(fuente, m.index), texto: m[0], filas: num(m[1]) });
  }
  return salida;
}

export interface RangoAMano {
  archivo: string;
  linea: number;
  /** Desde el último `.from(` anterior hasta el `.range(`. */
  cadena: string;
}

/**
 * REGLA 2 · cada `.range(` que NO es el de un sitio de `fetchAllRows`, fuera de
 * comentarios — INCLUIDOS los de números literales. [FIX-B2 · cierre] Antes se
 * saltaban los literales «porque los juzga la regla 1», pero la regla 1 sólo
 * rechaza los de MÁS de 1 000 filas: `.range(0, 999)` sin orden sobre `cambios`
 * pasaba las tres reglas y repetía el defecto (las 1 000 más viejas). Medido
 * por el verificador W2 el 29-sep. Ahora un literal de una página también entra
 * al inventario y tiene que ordenar por una llave única.
 */
export function rangosAMano(fuente: string, archivo: string): RangoAMano[] {
  const deFetchAll = new Set(sitiosPaginados(fuente, archivo).map((s) => s.fin));
  const salida: RangoAMano[] = [];
  const re = /\.range\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fuente)) !== null) {
    if (deFetchAll.has(m.index) || enComentario(fuente, m.index)) continue;
    const desde = fuente.lastIndexOf('.from(', m.index);
    salida.push({ archivo, linea: lineaDe(fuente, m.index), cadena: fuente.slice(desde === -1 ? m.index : desde, m.index) });
  }
  return salida;
}

/**
 * REGLA 3 · la llave ÚNICA de cada tabla que se lee paginada con orden, con la
 * migración que la define (medida también en la base el 29-sep-2026 para
 * `cambios`, `embarques`, `productos`, `reservas` y `stock_por_almacen`). Si
 * una tabla nueva aparece en un sitio ordenado, se declara AQUÍ — que es donde
 * se puede leer la razón—, no se relaja la regla.
 */
const LLAVES_UNICAS: Record<string, string[][]> = {
  productos: [['sku']], // 0001_schema.sql:154
  stock_por_almacen: [['sku', 'almacen_id', 'snapshot_id']], // 0001_schema.sql:175-176
  reservas: [['id']], // 0001_schema.sql:202
  embarques: [['id']], // 0001_schema.sql:240
  cambios: [['id']], // 0001_schema.sql:325
  snapshots: [['id']], // 0001_schema.sql:128
  pendientes_datos: [['id']], // 0009_b6_pendientes.sql:27
};

export interface JuicioDeOrden {
  tabla: string | null;
  total: boolean;
}

/**
 * ¿La cadena ordena por una llave única de SU tabla? Una llave queda cubierta
 * si cada columna está en un `.order('col'` o fijada por un `.eq('col',`.
 * Tabla desconocida o no literal ⇒ NO total (el lado seguro).
 */
export function ordenTotal(cadena: string): JuicioDeOrden {
  const tabla = /\.from\(\s*['"`]([\w.]+)['"`]\s*\)/.exec(cadena)?.[1] ?? null;
  if (tabla === null || !(tabla in LLAVES_UNICAS)) return { tabla, total: false };
  const cubiertas = new Set<string>();
  const re = /\.(?:order|eq)\(\s*['"`]([\w.]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cadena)) !== null) cubiertas.add(m[1]);
  return { tabla, total: LLAVES_UNICAS[tabla].some((llave) => llave.every((col) => cubiertas.has(col))) };
}

/**
 * Rangos fuera de `fetchAllRows` que existen A PROPÓSITO, contados por archivo.
 * **Este mapa sólo puede bajar** — o subir con su razón escrita aquí.
 *
 *   · `snapshots.service.ts` · `listSnapshots`: la bitácora de cargas es una
 *     página de INTERFAZ (`page`/`pageSize` del cliente), no una lectura
 *     completa; `pageSize` lo acota `snapshotsQuerySchema` a 100
 *     (`snapshots.schema.ts:19`), y ordena por (created_at, id), que cubre la PK.
 */
const RANGOS_A_MANO: Record<string, number> = {
  [join('src', 'services', 'snapshots.service.ts')]: 1,
};

/**
 * DEUDA A1-9 · sitios sin orden estable que ya existían antes de este bloque,
 * contados por archivo. Medido el 2026-08-27. **Este mapa sólo puede bajar.**
 */
const DEUDA_A1_9: Record<string, number> = {
  [join('src', 'services', 'clasificacion.service.ts')]: 4,
  [join('src', 'services', 'cruce.service.ts')]: 1,
  [join('src', 'services', 'dashboard.service.ts')]: 11,
  [join('src', 'services', 'embarques.service.ts')]: 3,
  [join('src', 'services', 'inventory.service.ts')]: 5,
};

describe('[2.0.1-A] paginación: ningún `OFFSET` nuevo sin `ORDER BY`', () => {
  const todos = archivosFuente('src')
    .filter((f) => f !== DEFINICION)
    .flatMap((f) => sitiosPaginados(readFileSync(join(process.cwd(), f), 'utf8'), f));

  it('el escáner encuentra lecturas paginadas (si no, todo lo de abajo es vacuo)', () => {
    // P17 sobre la propia guarda: con un extractor roto el mapa saldría vacío y
    // la comparación con un mapa vacío sería verde. Se ancla el orden de
    // magnitud y se exige que existan sitios de las dos clases.
    expect(todos.length).toBeGreaterThan(20);
    expect(todos.filter((s) => s.ordenado).length).toBeGreaterThan(0);
    expect(todos.filter((s) => !s.ordenado).length).toBeGreaterThan(0);
  });

  it('el inventario de sitios sin orden estable coincide EXACTO con la deuda declarada', () => {
    const conteo: Record<string, number> = {};
    for (const s of todos.filter((x) => !x.ordenado)) conteo[s.archivo] = (conteo[s.archivo] ?? 0) + 1;
    expect(
      conteo,
      'un `fetchAllRows` sin `.order(...)` cambió de sitio o de número. Si lo AÑADISTE: ponle un orden ' +
        'total (la PK sirve) — `LIMIT/OFFSET` sin `ORDER BY` repite y salta filas en silencio. Si lo ' +
        'ARREGLASTE: baja el contador de A1-9 aquí y en docs/known-limitations.md.',
    ).toEqual(DEUDA_A1_9);
  });

  it('todo sitio ORDENADO cubre una llave única DE SU TABLA (regla 3)', () => {
    // La mitad que le falta a «tiene `.order(`»: un orden que no es TOTAL
    // pagina tan mal como ninguno, y así estaban los dos sitios que este
    // bloque arregló (`cambios` por `detectado_en`, `pendientes_datos` por
    // `detectado_en`).
    //
    // [FIX-B2 · ronda 2] Antes esto era `/\.order\('(id|sku)'/` sobre la
    // cadena: bastaba NOMBRAR `sku` o `id`, fuera cual fuera la tabla. Daba
    // por total `.order('sku')` sobre `stock_por_almacen`, cuya PK es (sku,
    // almacen_id, snapshot_id) — el control negativo de abajo lo fija. Ahora
    // la llave es la de la tabla de la cadena, declarada en `LLAVES_UNICAS`.
    const flojos = todos
      .filter((s) => s.ordenado && !ordenTotal(s.cadena).total)
      .map((s) => `${s.archivo} (${ordenTotal(s.cadena).tabla ?? 'tabla no literal'})`);
    expect(
      flojos,
      `orden que no cubre una llave única en: ${flojos.join(', ')}. Ordena por la PK de la tabla (o fija ` +
        'sus columnas con `.eq`); si la tabla es nueva, declara su llave en LLAVES_UNICAS con su migración.',
    ).toEqual([]);
  });

  it('REGLA 1 · ningún `.range`/`.limit` LITERAL pide más filas que el tope de PostgREST', () => {
    const anchos = archivosFuente('src')
      .filter((f) => f !== DEFINICION)
      .flatMap((f) => pedidosLiterales(readFileSync(join(process.cwd(), f), 'utf8'), f))
      .filter((p) => p.filas > TOPE_POSTGREST)
      .map((p) => `${p.archivo}:${p.linea} ${p.texto} (${p.filas} filas)`);
    expect(
      anchos,
      'PostgREST devuelve como máximo 1 000 filas por respuesta SIN error: este rango promete filas que no ' +
        'llegan. Pagina con `fetchAllRows` y un orden total (la PK de la tabla).',
    ).toEqual([]);
  });

  it('REGLA 1 · anti-vacuidad: el escáner SÍ ve rangos anchos en el árbol — hoy sólo en comentarios, que no cuentan', () => {
    // Si el filtro de comentarios no hiciera nada, la prueba de arriba estaría
    // en rojo por los comentarios que CITAN el defecto (`avisos.service.ts`,
    // `proyectos.service.ts`). Y si la expresión regular no casara con el
    // texto real, estos serían cero y la de arriba sería verde por vacía (P17).
    // Si algún día esos comentarios se van, este anclaje se sustituye por otro
    // —no se borra—: su trabajo es probar que el escáner lee el árbol.
    const citados = archivosFuente('src')
      .filter((f) => f !== DEFINICION)
      .flatMap((f) => pedidosLiterales(readFileSync(join(process.cwd(), f), 'utf8'), f, true))
      .filter((p) => p.filas > TOPE_POSTGREST);
    expect(citados.length).toBeGreaterThan(0);
  });

  it('REGLA 2 · los rangos fuera de `fetchAllRows` coinciden EXACTO con los declarados, y todos ordenan por llave única', () => {
    const aMano = archivosFuente('src')
      .filter((f) => f !== DEFINICION)
      .flatMap((f) => rangosAMano(readFileSync(join(process.cwd(), f), 'utf8'), f));
    const conteo: Record<string, number> = {};
    for (const r of aMano) conteo[r.archivo] = (conteo[r.archivo] ?? 0) + 1;
    expect(
      conteo,
      'un `.range(` fuera de `fetchAllRows` cambió de sitio o de número. Si es un bucle de paginación a mano, ' +
        'cámbialo por `fetchAllRows` con un orden total. Si es una página de interfaz legítima, declárala en ' +
        'RANGOS_A_MANO con su razón.',
    ).toEqual(RANGOS_A_MANO);
    const flojos = aMano.filter((r) => !ordenTotal(r.cadena).total).map((r) => `${r.archivo}:${r.linea}`);
    expect(flojos, `rango a mano sin orden total en: ${flojos.join(', ')}`).toEqual([]);
  });

  it('control positivo · las reglas nuevas ven lo que dicen ver (y la regla vieja de UNICAS no lo veía)', () => {
    // Regla 1: ancho literal, con `_`, y `.limit`. El comentario no cuenta; un rango de una página sí se permite.
    const r1 = pedidosLiterales(
      [
        "db.from('cambios').select('*').order('detectado_en').range(0, 4999);",
        "db.from('t').select('*').range(0, 999);",
        "db.from('t').select('*').range(0, 4_999);",
        "db.from('t').select('*').limit(5000);",
        '// medido: `.range(0, 4999)` sobre 6 000 devuelve 1 000',
        '   * y en un bloque: .range(0, 9999)',
      ].join('\n'),
      'x.ts',
    );
    expect(r1.map((p) => [p.texto, p.filas])).toEqual([
      ['.range(0, 4999)', 5000],
      ['.range(0, 999)', 1000],
      ['.range(0, 4_999)', 5000],
      ['.limit(5000)', 5000],
    ]);

    // Regla 2: el `traerTodo` de `leerResumenCatalogo` tal como estaba en zv13b61 —
    // bucle a mano, tabla en variable, orden sólo por `sku`— se ve y NO es total.
    const traerTodo = [
      'for (let desde = 0; ; desde += 1000) {',
      '  const { data, error } = await db',
      '    .from(tabla)',
      '    .select(cols)',
      "    .eq('snapshot_id', S.id)",
      "    .order('sku', { ascending: true })",
      '    .range(desde, desde + 999);',
      '}',
    ].join('\n');
    const aMano = rangosAMano(traerTodo, 'x.ts');
    expect(aMano).toHaveLength(1);
    expect(ordenTotal(aMano[0].cadena)).toEqual({ tabla: null, total: false });
    // Y un sitio de `fetchAllRows` NO es «a mano».
    expect(rangosAMano("fetchAllRows((from, to) => db.from('t').select('a').order('id').range(from, to))", 'x.ts')).toEqual([]);
    // [FIX-B2 · cierre] Un literal de UNA página sin orden también es «a mano», y NO es total:
    // antes se saltaba y `.range(0, 999)` sobre `cambios` pasaba las tres reglas (verificador W2, M2).
    const unaPagina = rangosAMano("const r = await db.from('cambios').select('*').gte('detectado_en', d).range(0, 999);", 'x.ts');
    expect(unaPagina).toHaveLength(1);
    expect(ordenTotal(unaPagina[0].cadena)).toEqual({ tabla: 'cambios', total: false });

    // Regla 3: `stock_por_almacen` por `sku` sola NO es total; con `almacen_id` y el snapshot fijo, sí.
    const soloSku =
      "fetchAllRows((from, to) => db.from('stock_por_almacen').select('*').eq('snapshot_id', s).order('sku').range(from, to))";
    const conAlmacen =
      "fetchAllRows((from, to) => db.from('stock_por_almacen').select('*').eq('snapshot_id', s).order('sku').order('almacen_id').range(from, to))";
    const sinFijarSnapshot =
      "fetchAllRows((from, to) => db.from('stock_por_almacen').select('*').in('snapshot_id', ids).order('sku').order('almacen_id').range(from, to))";
    expect(ordenTotal(sitiosPaginados(soloSku, 'x.ts')[0].cadena)).toEqual({ tabla: 'stock_por_almacen', total: false });
    expect(ordenTotal(sitiosPaginados(conAlmacen, 'x.ts')[0].cadena)).toEqual({ tabla: 'stock_por_almacen', total: true });
    expect(ordenTotal(sitiosPaginados(sinFijarSnapshot, 'x.ts')[0].cadena).total).toBe(false);
    // …que es exactamente lo que la regla vieja NO distinguía:
    const UNICAS_VIEJA = /\.order\('(id|sku)'/;
    expect(UNICAS_VIEJA.test(sitiosPaginados(soloSku, 'x.ts')[0].cadena)).toBe(true);
    // `cambios` por fecha sola no es total; con `id`, sí. Una tabla sin llave declarada, nunca.
    expect(ordenTotal(".from('cambios').select('*').order('detectado_en')").total).toBe(false);
    expect(ordenTotal(".from('cambios').select('*').order('detectado_en').order('id')").total).toBe(true);
    expect(ordenTotal(".from('tabla_nueva').select('*').order('id')")).toEqual({ tabla: 'tabla_nueva', total: false });
  });

  it('los dos sitios del drift (D2) quedaron ordenados — el arreglo de este bloque', () => {
    const drift = todos.filter((s) => s.archivo.endsWith(join('services', 'drift-familias.service.ts')));
    expect(drift).toHaveLength(2);
    expect(drift.every((s) => s.ordenado)).toBe(true);
    // Y con la columna que DESEMPATA, no con cualquiera: `detectado_en` empata
    // dentro de un snapshot por construcción, así que sin `id` el orden no es total.
    expect(drift.some((s) => /\.order\('id'/.test(s.cadena))).toBe(true);
    expect(drift.some((s) => /\.order\('sku'/.test(s.cadena))).toBe(true);
  });

  it('control positivo · el escáner distingue una cadena ordenada de una que no', () => {
    const sin = sitiosPaginados("fetchAllRows<X>((from, to) => db.from('t').select('a').range(from, to))", 'x.ts');
    expect(sin).toHaveLength(1);
    expect(sin[0].ordenado).toBe(false);

    const con = sitiosPaginados(
      "fetchAllRows<X>((from, to) => db.from('t').select('a').order('id').range(from, to))",
      'x.ts',
    );
    expect(con).toHaveLength(1);
    expect(con[0].ordenado).toBe(true);

    // Un `.order(` que vive DESPUÉS del `.range(` no ordena esta página: la
    // cadena se corta en el `.range`, y por eso el corte importa.
    const despues = sitiosPaginados(
      "fetchAllRows<X>((from, to) => db.from('t').select('a').range(from, to)); db.from('u').order('id')",
      'x.ts',
    );
    expect(despues[0].ordenado).toBe(false);

    // Y una llamada que no pagina con este helper no se cuenta como sitio.
    expect(sitiosPaginados('const f = fetchAllRows;', 'x.ts')).toHaveLength(0);
  });
});
