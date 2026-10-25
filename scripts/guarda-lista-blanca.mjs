// ============================================================
// GUARDA DEL INVARIANTE DE LISTA BLANCA · [MVP-2] frente A.
//
//   Ninguna sesión de usuario escribe DIRECTO sobre una tabla de lista
//   blanca.
//
// QUÉ ES UNA "TABLA DE LISTA BLANCA"
// ----------------------------------
// `0012_b7b_hardening` (P3 / TAXO-10) le quitó a `authenticated` el SELECT
// de TABLA sobre 3 tablas y se lo devolvió COLUMNA POR COLUMNA, menos la de
// autoría. El efecto lateral: PostgREST arma sus escrituras con
// `RETURNING *` —se encadene `.select()` o no—, ese `*` se expande, el
// chequeo de privilegios cae en TABLA y la escritura muere con 42501. Por
// eso `PUT /api/color` y `POST /api/imagenes` daban 500.
//
// POR QUÉ ESTA GUARDA MIRA LA ESCRITURA Y NO LA LECTURA
// ----------------------------------------------------
// La primera guarda que se propuso contrastaba los `.select()` del código
// contra los grants de la base. **Habría salido VERDE**: en `src/` no hay
// una sola lectura que pida la columna revocada — las 12 enumeran columnas.
// Una guarda que sale verde sobre un bug vivo no es inútil, es PEOR: da
// permiso para cerrar. El lado que sí tiene algo que encontrar es el de la
// ESCRITURA, y ahí sí hay una cuenta que puede subir de 0.
//
// LA LISTA DE TABLAS SE DERIVA DE LA BASE, NUNCA SE ESCRIBE A MANO
// ----------------------------------------------------------------
// Una lista escrita a mano deja fuera a la cuarta tabla de lista blanca el
// día que exista, y nadie se entera. Se deriva de `pg_class`/`pg_attribute`
// con el mismo criterio que define el problema: SELECT de tabla ausente
// para `authenticated` + al menos una columna con ACL propio.
//
// Uso:
//   node --env-file=.env.db.local scripts/guarda-lista-blanca.mjs
//   node scripts/guarda-lista-blanca.mjs --solo-estatico   (sin red, siempre corre)
//   ... --json
//
// Exit 0 = invariante intacto · 1 = hay escritura directa · 2 = entorno o
// escáner roto. Sale por `process.exitCode` (P1 / QA-REG-19).
//
// LÍMITES DECLARADOS (los tres, no solo el primero):
//   1. El escáner lee `.from('<literal>')`. Un nombre de tabla que llegue en
//      una variable se le escapa. Hoy no existe ninguno en `src/`.
//   2. La ventana de análisis corta en el primer `;`, así que una escritura
//      partida en dos sentencias (`const q = db.from('x'); q.upsert(…)`) no
//      se detecta. Tampoco existe hoy, y no es el estilo del repo.
//   3. Solo mira `src/`. Un script de `scripts/` que escribiera directo no
//      entra — corren con `service_role`, que no ve el REVOKE, así que no
//      es el mismo riesgo; pero queda dicho.
// El control positivo de abajo confirma que el escáner sí ve escrituras
// reales. Los límites son reales y quedan escritos, no escondidos.
// ============================================================
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(RAIZ, 'src');

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const SOLO_ESTATICO = argv.includes('--solo-estatico');
const log = (...a) => { if (!JSON_MODE) console.log(...a); };

const VERBOS = ['upsert', 'insert', 'update', 'delete'];

// ------------------------------------------------------------
// CAPA 1 · escaneo estático de `src/` — sin red, SIEMPRE corre.
// ------------------------------------------------------------
function archivosFuente(dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const completa = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      salida.push(...archivosFuente(completa));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      salida.push(completa);
    }
  }
  return salida;
}

/**
 * Neutraliza comentarios para no contar un `.upsert(` citado en una
 * explicación — pero **conservando longitud y saltos de línea**, no
 * borrándolos.
 *
 * Por qué importa: la primera versión los BORRABA, así que los offsets del
 * texto analizado dejaban de corresponder con los del archivo real y el
 * número de línea reportado salía de un `indexOf` sobre el crudo — que
 * devuelve la PRIMERA aparición, no la de este match. Resultado medido:
 * señalaba `familias.service.ts:29` (un SELECT) en vez de `:69` (el
 * INSERT), y reportaba dos escrituras distintas de `perfiles` en la misma
 * línea. Una guarda que manda a alguien a la línea equivocada gasta la
 * confianza que necesita para que le hagan caso.
 *
 * Y el `(^|[^:])` del segundo reemplazo NO estaba. Su ausencia era una ceguera
 * MEDIDA, no teórica: sin él, todo lo que comparta línea con una URL se
 * blanquea, así que un `db.from('perfiles').insert(...)` escrito después de un
 * `fetch("https://...")` en la misma línea **no lo veía esta guarda**. Cero
 * ejemplares en `src/` hoy (medido), o sea latente y no un agujero abierto —
 * pero una guarda de seguridad que falla ABIERTA no espera a su primer
 * ejemplar (P4).
 *
 * Ésta es la SEXTA copia de la misma función y la única que no puede importar
 * `src/lib/guardas/codigo-fuente.ts`: este script corre con `node` a secas,
 * sin TypeScript y sin el alias `@/`. Por eso no se unifica — se COMPARA,
 * carácter por carácter del resultado, en `codigo-fuente.test.ts`.
 */
function sinComentarios(texto) {
  const enBlanco = (m) => m.replace(/[^\n]/g, ' ');
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, enBlanco)
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_m, antes, comentario) => antes + enBlanco(comentario));
}

/**
 * Toda escritura de supabase-js con nombre de tabla LITERAL.
 *
 * `.storage.from(` queda fuera a propósito: es el bucket de Storage, no una
 * tabla, y sus privilegios son otros (policies de `storage.objects`).
 */
function escanearEscrituras() {
  const hallazgos = [];
  for (const archivo of archivosFuente(SRC)) {
    const crudo = readFileSync(archivo, 'utf8');
    const texto = sinComentarios(crudo);
    const re = /(\.storage)?\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(texto)) !== null) {
      if (m[1]) continue; // .storage.from(...)
      const tabla = m[2];
      // Ventana: desde aquí hasta el siguiente `.from(` o el fin del
      // statement. La cadena puede ocupar varias líneas (`await db\n
      // .from(...)\n .upsert(...)`), así que no basta con mirar la línea.
      const desde = m.index + m[0].length;
      const siguienteFrom = texto.indexOf('.from(', desde);
      const finStatement = texto.indexOf(';', desde);
      const corte = Math.min(
        siguienteFrom === -1 ? texto.length : siguienteFrom,
        finStatement === -1 ? texto.length : finStatement,
      );
      const ventana = texto.slice(desde, corte);
      const verbo = VERBOS.find((v) => new RegExp(`\\.${v}\\s*\\(`).test(ventana));
      if (verbo) {
        hallazgos.push({
          tabla,
          verbo,
          archivo: path.relative(RAIZ, archivo).replace(/\\/g, '/'),
          // `sinComentarios` conserva longitud, así que `m.index` de
          // `texto` es el mismo offset que en `crudo`.
          linea: crudo.slice(0, m.index).split('\n').length,
        });
      }
    }
  }
  return hallazgos;
}

// ------------------------------------------------------------
// CAPA 2 · la lista blanca, DERIVADA de la base.
// ------------------------------------------------------------
const SQL_LISTA_BLANCA = `
  SELECT c.relname AS tabla
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'r'
     AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attnum > 0
                    AND NOT a.attisdropped AND a.attacl IS NOT NULL)
   ORDER BY 1`;

async function listaBlancaViva() {
  const conn = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!conn) return { estado: 'sin_variables', tablas: [] };
  const { Client } = require('pg');
  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    const { rows } = await client.query(SQL_LISTA_BLANCA);
    return { estado: 'viva', tablas: rows.map((r) => r.tabla) };
  } catch (e) {
    // NUNCA se imprime la cadena: los errores de `pg` a veces la traen dentro.
    return { estado: 'entorno_no_disponible', tablas: [], detalle: e?.code ?? 'error de conexión' };
  } finally {
    await client.end().catch(() => {});
  }
}

// ============================================================
const escrituras = escanearEscrituras();

// CONTROL POSITIVO — sin esto, un escáner roto (regex que no matchea nada)
// reportaría "0 escrituras directas" y saldría VERDE sobre cualquier
// violación. Es exactamente el fallo que este bloque vino a matar: una
// guarda que no puede fallar no es una guarda.
const escanerVivo = escrituras.length > 0;

log('='.repeat(72));
log('GUARDA · ninguna sesión escribe directo sobre una tabla de lista blanca');
log('='.repeat(72));
log(`Escrituras de supabase-js con tabla literal halladas en src/: ${escrituras.length}`);
for (const e of escrituras) log(`   ${e.verbo.padEnd(6)} ${e.tabla.padEnd(22)} ${e.archivo}:${e.linea}`);

if (!escanerVivo) {
  log('');
  log('ESCÁNER ROTO: no encontró NINGUNA escritura en todo src/. Eso es imposible');
  log('en este repo (hay altas de familias y de perfiles). El regex dejó de matchear:');
  log('arréglalo antes de creerle a esta guarda.');
  process.exitCode = 2;
} else if (SOLO_ESTATICO) {
  log('');
  log('--solo-estatico: no se consulta la base. NO hay veredicto del invariante.');
  log('Esto NO es verde: es "no se pudo medir". Sale 2 a propósito, para que');
  log('cablear esta bandera en CI no sea un pase permanente.');
  process.exitCode = 2;
  if (JSON_MODE) console.log(JSON.stringify({ escrituras, escanerVivo, listaBlanca: null, violaciones: null }));
} else {
  const { estado, tablas, detalle } = await listaBlancaViva();
  log('');
  log(`Lista blanca DERIVADA de la base: ${estado === 'viva' ? tablas.join(', ') || '(ninguna)' : `[${estado}]`}`);

  if (estado !== 'viva') {
    log('');
    log(
      estado === 'sin_variables'
        ? 'SIN CADENA DE CONEXIÓN — define DATABASE_URL (p.ej. `node --env-file=.env.db.local ...`).\n'
          + 'La guarda NO emite veredicto. Esto NO es verde: es "no se pudo medir".'
        : `ENTORNO NO DISPONIBLE (${detalle}) — la guarda NO emite veredicto.`,
    );
    process.exitCode = 2;
    if (JSON_MODE) console.log(JSON.stringify({ escrituras, escanerVivo, listaBlanca: { estado }, violaciones: null }));
  } else if (tablas.length === 0) {
    // CONTROL ANTI-VACUIDAD DE LA LISTA BLANCA — hallado por la auditoría, y
    // era esta misma guarda cometiendo P16.
    //
    // Si alguien corre el `GRANT SELECT ON TABLE … TO authenticated` de
    // reversión (`0012:604-606`, que se descartó), las 3 tablas dejan de
    // cumplir el criterio, la lista derivada queda VACÍA, la intersección
    // queda vacía… y esto imprimía VERDE con exit 0. **La guarda salía verde
    // exactamente cuando TAXO-10 se reabría.** El control equivalente ya
    // existía del lado del escáner y en la guarda SQL de `0017:187-189`;
    // faltaba justo en el camino que alguien va a correr.
    log('');
    log('LISTA BLANCA VACÍA: la base no devolvió NINGUNA tabla con SELECT de');
    log('tabla revocado para `authenticated`. O el criterio dejó de aplicar, o');
    log('alguien corrió el GRANT de reversión de 0012 y la fuga de TAXO-10 está');
    log('abierta. En ningún caso es verde: no hay invariante que verificar.');
    process.exitCode = 2;
    if (JSON_MODE) console.log(JSON.stringify({ escrituras, escanerVivo, listaBlanca: { estado, tablas }, violaciones: null }));
  } else {
    const violaciones = escrituras.filter((e) => tablas.includes(e.tabla));
    log('');
    if (violaciones.length === 0) {
      log('VERDE · 0 escrituras directas de sesión sobre una tabla de lista blanca.');
    } else {
      log(`ROJO · ${violaciones.length} escritura(s) directa(s) sobre tabla de lista blanca:`);
      for (const v of violaciones) log(`   !! ${v.verbo} ${v.tabla} — ${v.archivo}:${v.linea}`);
      log('');
      log('Llévalas a una RPC SECURITY DEFINER, como aplicar_metadata (0017),');
      log('aplicar_override (0006) o resolver_pendiente (0009+).');
      process.exitCode = 1;
    }
    if (JSON_MODE) {
      console.log(JSON.stringify({ escrituras, escanerVivo, listaBlanca: { estado, tablas }, violaciones }));
    }
  }
}
