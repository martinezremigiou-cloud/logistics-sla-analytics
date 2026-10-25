// ============================================================
// scripts/ingesta-mensual.mjs
// CLI REUTILIZABLE de ingesta mensual: lee los libros de
// stock (Inventario/WEST/Reserva) y aduana (Embarques, multi-hoja),
// los mapea con `src/config/ingesta-mapeo.ts` vía
// `src/services/ingesta/motor.ts`, y en modo `--dry` corre el
// análisis de `src/services/ingesta/preflight.ts` (parsers REALES del
// ETL, sin DB) para anticipar conteos/gates/cuarentena/deltas
// estructurales vs abril 2026 — SIN red, SIN POST. En modo `--aplicar`
// (F3) hace los 2 POST reales a `/api/refresh` (stock, luego aduana).
//
// Este es el mismo motor/preflight que, más adelante, será el corazón
// de la integración con Power Automate (B7) — por eso importa el
// código de `src/` TAL CUAL (ver `ts-loader.mjs`), en vez de duplicar
// lógica de dominio en JS aparte.
//
// Uso:
//   node scripts/ingesta-mensual.mjs --stock <ruta> --aduana <ruta>   (= --dry)
//   node scripts/ingesta-mensual.mjs --dry --stock <ruta> --aduana <ruta>
//   node scripts/ingesta-mensual.mjs --aplicar --stock <ruta> --aduana <ruta>
//
// Flags:
//   --stock <ruta>        libro .xlsx de stock (obligatorio salvo --solo aduana)
//   --aduana <ruta>       libro .xlsx de aduana/embarques (obligatorio salvo --solo stock)
//   --solo stock|aduana   solo procesa ese lado (dry o aplicar)
//   --base-url <url>      default http://localhost:3000 (solo --aplicar)
//
// Los libros no viajan con el repo. Los de ejemplo (datos sintéticos, semilla
// fija) se generan con `node scripts/generar-datos-muestra.mjs` y quedan en
// `muestra/` (carpeta ignorada por git); pasa sus rutas con --stock y --aduana.
//
// --dry NO requiere red ni INGEST_SECRET. --aplicar SÍ: lee
// INGEST_SECRET de `process.env` o de `.env.local`.
// ============================================================
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------
// Guarda de versión (fix B-5): este CLI depende del type-stripping
// NATIVO de Node para importar `src/**/*.ts` tal cual (ver
// `ts-loader.mjs`, misma nota de versión ahí — mantener ambas en
// sync) — sin esto, el import dinámico de motor.ts/preflight.ts/io.ts
// revienta con un SyntaxError críptico, lejos de la causa real (Node
// viejo). Corre ANTES del re-spawn de abajo: si el Node actual
// (`process.execPath`, el mismo que se usaría para el hijo) no
// cumple, ni siquiera vale la pena spawnear.
// ------------------------------------------------------------
function verificarVersionNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const cumple = major > 23 || (major === 23 && minor >= 6);
  if (!cumple) {
    console.error(
      `[ERROR] Este CLI requiere Node ≥ 23.6 (type-stripping nativo). Versión actual: ${process.versions.node}`,
    );
    process.exit(1);
  }
}
verificarVersionNode();

// ------------------------------------------------------------
// Bootstrap: re-ejecuta UNA vez con --disable-warning (Node emite un
// aviso cosmético de perf al stripear tipos de los .ts del ETL sin
// que package.json declare "type":"module" — no se toca ese archivo,
// es config de repo compartida fuera de alcance de esta ingesta; el
// aviso es inofensivo pero ensucia el reporte `--dry`).
// ------------------------------------------------------------
const ESTE_ARCHIVO = fileURLToPath(import.meta.url);

if (!process.env.__INGESTA_MENSUAL_HIJO__) {
  const resultado = spawnSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', ESTE_ARCHIVO, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __INGESTA_MENSUAL_HIJO__: '1' } },
  );
  process.exit(resultado.status ?? 1);
}

// ------------------------------------------------------------
// Registra el loader de TS ANTES de cualquier import dinámico de `src/`.
// ------------------------------------------------------------
const { register } = await import('node:module');
register(new URL('./ts-loader.mjs', import.meta.url).href);

const BASE_INGESTA = new URL('../src/services/ingesta/', import.meta.url);
const importIngesta = (rel) => import(new URL(rel, BASE_INGESTA).href);

const { construirDatasets, datasetsStockFaltantes } = await importIngesta('motor.ts');
const { analizarStock, analizarAduana, compararEstructura } = await importIngesta('preflight.ts');
const { leerWorkbookXlsx, cargarReferenciaAbril } = await importIngesta('io.ts');
const { ingestaMapeoConfig } = await import(
  new URL('../src/config/ingesta-mapeo.ts', import.meta.url).href
);

// ------------------------------------------------------------
// Argumentos.
// ------------------------------------------------------------
/** El "valor" de un flag en realidad es OTRO flag (p.ej. `--stock --aduana`) — I-9: falta el valor, no se traga el siguiente flag. */
function pareceFlag(v) {
  return typeof v === 'string' && v.startsWith('--');
}

function parsearArgv(argv) {
  const aplicar = argv.includes('--aplicar');
  const modo = aplicar ? 'aplicar' : 'dry';

  const idxSolo = argv.indexOf('--solo');
  let solo = null;
  if (idxSolo >= 0) {
    solo = argv[idxSolo + 1];
    if (solo === undefined || pareceFlag(solo)) {
      console.error("[ERROR] falta el valor de --solo (requiere 'stock' o 'aduana').");
      process.exit(1);
    }
    if (solo !== 'stock' && solo !== 'aduana') {
      console.error(`[ERROR] --solo requiere 'stock' o 'aduana' (recibido: ${solo}).`);
      process.exit(1);
    }
  }

  const flagValor = (flag, def) => {
    const i = argv.indexOf(flag);
    if (i < 0) return def;
    const v = argv[i + 1];
    if (v === undefined || pareceFlag(v)) {
      console.error(`[ERROR] falta el valor de ${flag}.`);
      process.exit(1);
    }
    return v;
  };

  return {
    modo,
    solo,
    baseUrl: flagValor('--base-url', 'http://localhost:3000'),
    stockPath: flagValor('--stock', null),
    aduanaPath: flagValor('--aduana', null),
  };
}

const { modo, solo, baseUrl, stockPath, aduanaPath } = parsearArgv(process.argv.slice(2));
const procesarStock = solo !== 'aduana';
const procesarAduana = solo !== 'stock';

// Sin rutas por omisión: los libros reales nunca viajan con el repo. Si falta
// una ruta que esta corrida necesita, se dice y se sale ANTES de leer nada.
const faltantesDeRuta = [
  ...(procesarStock && !stockPath ? ['--stock <ruta>'] : []),
  ...(procesarAduana && !aduanaPath ? ['--aduana <ruta>'] : []),
];
if (faltantesDeRuta.length > 0) {
  console.error(`[ERROR] falta: ${faltantesDeRuta.join(', ')}.`);
  console.error('Genera libros de ejemplo con `node scripts/generar-datos-muestra.mjs` (quedan en muestra/) y pasa sus rutas.');
  process.exit(1);
}
const rutaStock = stockPath ? resolvePath(process.cwd(), stockPath) : null;
const rutaAduana = aduanaPath ? resolvePath(process.cwd(), aduanaPath) : null;
const capturedAt = new Date().toISOString();

// ------------------------------------------------------------
// Lectura + mapeo.
// ------------------------------------------------------------
function leerO(ruta, etiqueta) {
  try {
    // basename (no la ruta absoluta): fix B-6 — el nombre se persiste
    // INMUTABLE en `payload.archivo` de los snapshots; la ruta local de
    // quien corrió el CLI no debe quedar grabada para siempre. Los logs
    // de consola de abajo ("Archivo stock/aduana:") sí siguen mostrando
    // la ruta completa — eso es solo para esta corrida, no se persiste.
    return leerWorkbookXlsx(ruta, basename(ruta));
  } catch (e) {
    console.error(`[ERROR] no se pudo leer el archivo de ${etiqueta}: ${ruta}`);
    console.error(String(e?.message ?? e));
    process.exit(1);
  }
}

const stockWb = procesarStock ? leerO(rutaStock, 'stock') : { nombreArchivo: '(omitido por --solo aduana)', hojas: [] };
const aduanaWb = procesarAduana
  ? leerO(rutaAduana, 'aduana')
  : { nombreArchivo: '(omitido por --solo stock)', hojas: [] };

// stockOmitido: declaración EXPLÍCITA de la intención (Esquina F,
// docs/decisions/0003-empty-and-degraded-input-guards.md) — este CLI YA SABE si está
// corriendo `--solo aduana` (es literalmente lo que decide `procesarStock`
// un poco arriba); el gate de motor.ts ya NO lo infiere de
// `stockWb.hojas.length` (esa inferencia era la esquina que se cerró: un
// libro de STOCK genuinamente vacío, sin este flag, ahora SIEMPRE bloquea).
const { bodyStock, bodyAduana, reporte } = construirDatasets(
  { stock: stockWb, aduana: aduanaWb },
  ingestaMapeoConfig,
  { capturedAt, stockOmitido: !procesarStock },
);

// ------------------------------------------------------------
// Modo --aplicar (F3): POST reales a /api/refresh.
// ------------------------------------------------------------

/** Auditor-BAJO: INGEST_SECRET viaja en un header a `baseUrl` — si no es local, advertencia visible (no bloquea: B7 usará host remoto). */
function advertirSiHostRemoto(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return; // URL inválida: se reporta como error de conexión al intentar el fetch, más abajo.
  }
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    console.warn(
      `⚠ Enviando INGEST_SECRET a host remoto: ${hostname} — verifica que sea el deployment correcto (usa https)`,
    );
  }
}

/**
 * I-7 (guarda barata pre-POST): un drift estructural (hoja renombrada
 * sin actualizar `ingesta-mapeo.ts`, archivo con estructura distinta a
 * la esperada, etc.) debe fallar AQUÍ — local, legible, es-MX — no
 * como un 400 genérico del server tras un POST real.
 */
function verificarDriftEstructuralAntesDePost() {
  if (procesarStock) {
    const faltantes = datasetsStockFaltantes(reporte.stock);
    if (faltantes.length > 0) {
      console.error(
        `[ERROR] Faltan datasets de STOCK sin hoja asignada: ${faltantes.join(', ')}. ` +
          'Revisa src/config/ingesta-mapeo.ts (¿se renombró una hoja?) antes de --aplicar.',
      );
      process.exit(1);
    }
  }
  if (procesarAduana && bodyAduana.datasets.embarques.length === 0) {
    console.error(
      '[ERROR] 0 hojas de ADUANA quedaron mapeadas a "embarques" (ninguna hoja asignada). ' +
        'Revisa src/config/ingesta-mapeo.ts antes de --aplicar.',
    );
    process.exit(1);
  }
}

async function modoAplicar() {
  advertirSiHostRemoto(baseUrl);
  verificarDriftEstructuralAntesDePost();
  const secret = leerIngestSecret();
  const targets = [];
  if (procesarStock) targets.push({ clave: 'stock', etiqueta: 'STOCK (inventario + west + reserva)', body: bodyStock });
  if (procesarAduana) targets.push({ clave: 'aduana', etiqueta: 'ADUANA (embarques multi-hoja)', body: bodyAduana });

  let fallo = false;
  for (const { clave, etiqueta, body } of targets) {
    process.stdout.write(`\n=== POST ${etiqueta} -> ${baseUrl}/api/refresh\n`);
    let ok = false;
    try {
      const res = await fetch(`${baseUrl}/api/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ingest-secret': secret },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      console.log(`HTTP ${res.status}`);
      console.log(JSON.stringify(json, null, 2));
      ok = res.ok;
    } catch (e) {
      console.error(`[ERROR] no se pudo conectar: ${e.message}`);
      console.error('Verifica que `npm run dev` esté corriendo (puerto 3000, o pasa --base-url).');
      ok = false;
    }

    if (!ok) {
      fallo = true;
      // Dependencia de orden real: la cuarentena referencial de ADUANA
      // depende de los productos que STOCK inserta. Postear ADUANA tras un
      // STOCK fallido produce una ingesta asimétrica (aduana cuarentenaría
      // de más, o contra un catálogo de SKUs desactualizado). Se aborta
      // AQUÍ, antes de intentar ADUANA — salvo que esta corrida ya sea
      // `--solo aduana` (stock explícitamente fuera de alcance).
      if (clave === 'stock' && procesarAduana) {
        console.error(
          '\n[ERROR] el POST de STOCK falló — se ABORTA sin postear ADUANA ' +
            '(la cuarentena referencial de aduana depende de los productos que inserta stock).',
        );
        // [MVP-CIERRE] F3 · Estado NOMBRADO: "no ejecutada por dependencia"
        // != "saltada". Sin esta linea, el historial se lee igual que si
        // aduana nunca se hubiera intentado, y saber CUAL pata murio exige
        // abrir la corrida.
        console.error('[RESULTADO] stock=FALLO · aduana=NO_EJECUTADA_POR_DEPENDENCIA');
      }
      break;
    }
  }

  // [MVP-CIERRE] Línea de resultado legible de un vistazo.
  if (!fallo) console.log(`
[RESULTADO] ${targets.map((t) => `${t.clave}=OK`).join(' · ')}`);

  // P1 / QA-REG-19: `process.exit()` DESPUÉS de usar la red aborta en libuv
  // en Windows/Node 24 con exit 127 y stdout TRUNCADO — o sea, se pierde
  // justo la salida que dice cómo termino la ingesta. Este era el UNICO
  // `process.exit` del archivo en el camino post-red; los otros 10 se
  // auditaron: el del bootstrap (linea 73) es del proceso PADRE, que nunca
  // importa supabase-js ni hace fetch, y el resto corre ANTES de los POST.
  process.exitCode = fallo ? 1 : 0;
}

function leerIngestSecret() {
  if (process.env.INGEST_SECRET) return process.env.INGEST_SECRET;
  try {
    const contenido = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    const linea = contenido.split(/\r?\n/).find((l) => l.startsWith('INGEST_SECRET='));
    const valor = linea?.slice('INGEST_SECRET='.length).trim();
    if (valor) return valor;
  } catch {
    // cae al mensaje de error de abajo
  }
  console.error('[ERROR] INGEST_SECRET no encontrado (ni en env ni en .env.local).');
  process.exit(1);
  return ''; // inalcanzable — calma a los linters de "must return"
}

// ------------------------------------------------------------
// Modo --dry: reporte completo, es-MX, sin red.
// ------------------------------------------------------------
function resumenMotivos(cuarentena) {
  const m = new Map();
  for (const c of cuarentena) m.set(c.motivo, (m.get(c.motivo) ?? 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

function imprimirMapeo(titulo, lista) {
  console.log(`\n--- Mapeo de hojas — ${titulo} (${lista.length}) ---`);
  for (const h of lista) {
    const c = h.clasificacion;
    let detalle;
    if (c.estado === 'asignada') detalle = `asignada -> ${c.dataset}`;
    else if (c.estado === 'excluida') detalle = `excluida (${c.motivo})`;
    else if (c.estado === 'pendiente') detalle = `PENDIENTE (${c.motivo})`;
    else detalle = 'NO MAPEABLE -- revisar src/config/ingesta-mapeo.ts';
    console.log(`  ${h.hoja.padEnd(24)} filas=${String(h.filas).padStart(5)}  ${detalle}`);
  }
}

function imprimirDelta(titulo, delta) {
  console.log(`\n--- Deltas estructurales vs ABRIL 2026 — ${titulo} ---`);
  console.log(`  Hojas nuevas:        ${delta.hojasNuevas.length ? delta.hojasNuevas.join(', ') : '(ninguna)'}`);
  console.log(
    `  Hojas desaparecidas: ${delta.hojasDesaparecidas.length ? delta.hojasDesaparecidas.join(', ') : '(ninguna)'}`,
  );
  console.log(
    `  Renombradas:         ${
      delta.renombradas.length ? delta.renombradas.map((r) => `${r.dataset}: ${r.de} -> ${r.a}`).join(', ') : '(ninguna)'
    }`,
  );
  if (delta.headersCambiados.length === 0) {
    console.log('  Headers cambiados:   (ninguno)');
  } else {
    console.log('  Headers cambiados:');
    for (const h of delta.headersCambiados) {
      console.log(`    ${h.hoja}: agregados=[${h.agregados.join(', ') || '—'}] quitados=[${h.quitados.join(', ') || '—'}]`);
    }
  }
}

function imprimirStock(pf) {
  console.log('\n--- Conteos — STOCK ---');
  console.log(`  Productos (Inventario):       ${pf.conteos.productosInventario}`);
  console.log(`  Stock (Inventario, filas):    ${pf.conteos.stockInventario}`);
  console.log(`  WEST (filas):                ${pf.conteos.westRows}`);
  console.log(`    matched (ya en Inventario):  ${pf.conteos.westMatched}`);
  console.log(`    nuevos (alta de producto):   ${pf.conteos.westNuevos}`);
  console.log(`  Productos reconciliados:      ${pf.conteos.productosReconciliados}`);
  console.log(`  Stock reconciliado (filas):   ${pf.conteos.stockReconciliado}`);
  console.log(`  Reservas (válidas):           ${pf.conteos.reservas}`);

  const sumaStock = pf.diag.filter((d) => d.tipo === 'SUMA_STOCK').length;
  const sumaResv = pf.diag.filter((d) => d.tipo === 'SUMA_RESERVAS').length;
  console.log('\n--- Gates preliminares — STOCK (NO bloqueantes, ver gates.ts) ---');
  console.log(`  DIAG total:               ${pf.diag.length}`);
  console.log(`  SUMA_STOCK (Σstock≠TOTAL):    ${sumaStock} SKU(s)`);
  console.log(`  SUMA_RESERVAS (Σresv≠RESV):   ${sumaResv} SKU(s)`);

  console.log('\n--- Cuarentena anticipada — STOCK ---');
  console.log(`  Total: ${pf.cuarentena.length}`);
  for (const [motivo, n] of resumenMotivos(pf.cuarentena)) {
    console.log(`    ${motivo.padEnd(34)} ${n}`);
  }
}

function imprimirAduana(pf) {
  console.log('\n--- Conteos — ADUANA (embarques por hoja) ---');
  for (const h of pf.porHoja) {
    console.log(`  ${h.hoja.padEnd(24)} total=${String(h.total).padStart(4)}  ${h.historial ? '(histórico)' : '(activo)'}`);
  }
  console.log(`  TOTAL:                    ${pf.total}`);

  // Fix M-2: parseEmbarques (nivel parser, sin BD) nunca emite
  // cuarentena — las 2 fuentes REALES de cuarentena de aduana
  // (estatus no resuelto + SKU sin producto) requieren BD y solo se
  // ven en el POST real (ver header-doc de preflight.ts). 0 aquí NO
  // implica 0 en el POST real.
  console.log(
    '\n--- Cuarentena anticipada — ADUANA (solo nivel parser; estatus/referencial requieren BD y se reportan en el POST real) ---',
  );
  console.log(`  Total: ${pf.cuarentena.length}`);
  for (const [motivo, n] of resumenMotivos(pf.cuarentena)) {
    console.log(`    ${motivo.padEnd(34)} ${n}`);
  }
}

function imprimirComparativo(stockPf, refStockPf, aduanaPf, refAduanaPf) {
  console.log('\n--- Comparativo grueso: JULIO 2026 vs ABRIL 2026 ---');
  if (stockPf && refStockPf) {
    console.log(`  Productos (reconciliados):  abril=${refStockPf.conteos.productosReconciliados}  ->  julio=${stockPf.conteos.productosReconciliados}`);
    console.log(`  Reservas (válidas):         abril=${refStockPf.conteos.reservas}  ->  julio=${stockPf.conteos.reservas}`);
    console.log(`  WEST (filas):              abril=${refStockPf.conteos.westRows}  ->  julio=${stockPf.conteos.westRows}`);
  }
  if (aduanaPf && refAduanaPf) {
    console.log(`  Embarques (total):          abril=${refAduanaPf.total}  ->  julio=${aduanaPf.total}`);
    for (const h of aduanaPf.porHoja) {
      const ref = refAduanaPf.porHoja.find((r) => r.hoja.trim().toLowerCase() === h.hoja.trim().toLowerCase());
      console.log(`    ${h.hoja.padEnd(24)} abril=${String(ref?.total ?? '—').padStart(4)}  ->  julio=${String(h.total).padStart(4)}`);
    }
  }
}

function imprimirPendientes(reporteCompleto) {
  console.log('\n--- Pendientes / decisiones requeridas ---');
  const items = [];
  const todas = [...(procesarStock ? reporteCompleto.stock : []), ...(procesarAduana ? reporteCompleto.aduana : [])];
  for (const h of todas) {
    if (h.clasificacion.estado === 'pendiente') items.push(`  [PENDIENTE]    ${h.hoja}: ${h.clasificacion.motivo}`);
    if (h.clasificacion.estado === 'no_mapeable') {
      items.push(`  [NO MAPEABLE]  ${h.hoja}: no coincide con ningún matcher del config — revisar src/config/ingesta-mapeo.ts`);
    }
  }
  if (items.length === 0) console.log('  (ninguna)');
  else items.forEach((i) => console.log(i));
}

async function modoDry() {
  console.log('='.repeat(78));
  console.log('INGESTA MENSUAL -- REPORTE DRY (sin POST, sin red, sin DB)');
  console.log('='.repeat(78));
  console.log(`Fecha de corrida:  ${capturedAt}`);
  if (procesarStock) console.log(`Archivo stock:     ${rutaStock}`);
  if (procesarAduana) console.log(`Archivo aduana:    ${rutaAduana}`);
  console.log(`Modo:              DRY${solo ? ` (--solo ${solo})` : ''}`);

  if (procesarStock) imprimirMapeo('STOCK', reporte.stock);
  if (procesarAduana) imprimirMapeo('ADUANA', reporte.aduana);

  const referencia = cargarReferenciaAbril();
  const refConstruido = construirDatasets(referencia, ingestaMapeoConfig, {
    capturedAt: '2026-04-15T00:00:00.000Z',
  });

  if (procesarStock) {
    imprimirDelta(
      'STOCK',
      compararEstructura(
        { workbook: stockWb, reporte: reporte.stock },
        { workbook: referencia.stock, reporte: refConstruido.reporte.stock },
      ),
    );
  }
  if (procesarAduana) {
    imprimirDelta(
      'ADUANA',
      compararEstructura(
        { workbook: aduanaWb, reporte: reporte.aduana },
        { workbook: referencia.aduana, reporte: refConstruido.reporte.aduana },
      ),
    );
  }

  let stockPf = null;
  let aduanaPf = null;
  let refStockPf = null;
  let refAduanaPf = null;
  if (procesarStock) {
    stockPf = analizarStock(bodyStock.datasets);
    refStockPf = analizarStock(refConstruido.bodyStock.datasets);
    imprimirStock(stockPf);
  }
  if (procesarAduana) {
    aduanaPf = analizarAduana(bodyAduana.datasets);
    refAduanaPf = analizarAduana(refConstruido.bodyAduana.datasets);
    imprimirAduana(aduanaPf);
  }

  imprimirComparativo(stockPf, refStockPf, aduanaPf, refAduanaPf);
  imprimirPendientes(reporte);

  console.log(`\n${'='.repeat(78)}`);
  console.log('DRY-RUN: no se hizo ningún POST. Para aplicar de verdad: --aplicar');
  console.log('='.repeat(78));
  process.exit(0);
}

// ------------------------------------------------------------
// Main.
// ------------------------------------------------------------
if (modo === 'aplicar') {
  await modoAplicar();
} else {
  await modoDry();
}
