// ============================================================
// [INV-B8 · carril O6] Compilar una migración contra Postgres SIN aplicarla.
//
// POR QUÉ EXISTE. `scripts/verificar-migracion.mjs` es análisis ESTÁTICO y lo
// dice de sí mismo: verde significa "el desbalance de RAISE no está", no "la
// migración compila". `docs/known-limitations.md` (TAXO-6) lo registra como deuda
// abierta y escribe el remedio textual:
//
//     «Que el paso de aplicación del operador incluya SIEMPRE un
//      BEGIN; …; ROLLBACK; de compilación real contra Postgres antes del
//      apply definitivo.»
//
// Eso era un paso MANUAL que había que acordarse de hacer. Esto lo vuelve un
// comando. La 0011 se verificó cifra por cifra contra la base viva y aun así
// no había sido COMPILADA — que es el suceso que originó el verificador
// estático, y el que este script termina de cerrar.
//
// QUÉ CAZA que el estático no puede: nombres de tabla, columna o función
// inexistentes; tipos incompatibles; variables plpgsql no declaradas;
// gramática SQL fuera de RAISE; y el orden de dependencias entre sentencias.
// Es decir, exactamente la lista de "QUE NO CAZA" de `verificar-migracion.mjs`.
//
// CÓMO NO DEJA RASTRO. Sustituye el último `COMMIT;` de nivel superior por
// `ROLLBACK;` y manda el archivo entero en un solo mensaje simple-query, igual
// que `aplicar-migracion.mjs`. Todo lo que la migración cree, escriba o
// revoque se deshace al terminar. Las `RAISE NOTICE` de la guarda SÍ se
// imprimen: llegan por el canal de avisos, no en el resultado, así que se
// puede leer el veredicto completo de una migración que nunca se aplicó.
//
// LO QUE **NO** COMPRUEBA, y hay que decirlo para que su verde no se lea de
// más: que la migración sea CORRECTA. Una migración puede compilar y estar
// mal. Tampoco comprueba el efecto sobre datos reales de otra sesión, ni nada
// que dependa de commit (NOTIFY a PostgREST, por ejemplo).
//
// Uso:
//   node --env-file=.env.db scripts/compilar-migracion.mjs supabase/migrations/00NN_x.sql
//   exit 0 = compila · 1 = no compila · 2 = error de invocación
//
// La cadena de conexión NUNCA se imprime — misma regla que
// `aplicar-migracion.mjs`: los mensajes de `pg` a veces la traen dentro, así
// que solo se reporta el CÓDIGO del error de conexión.
// ============================================================
import { readFileSync } from 'node:fs';
import pg from 'pg';

function morir(mensaje, codigo = 2) {
  console.error(mensaje);
  process.exit(codigo);
}

const ruta = process.argv[2];
if (!ruta) {
  morir('Falta la ruta del .sql.\n  Uso: node --env-file=.env.db scripts/compilar-migracion.mjs supabase/migrations/00NN_x.sql');
}

let sql;
try {
  sql = readFileSync(ruta, 'utf8');
} catch (e) {
  morir(`No se pudo leer ${ruta}: ${e.code ?? e.message}`);
}

// El COMMIT de nivel superior es el ÚLTIMO del archivo. Se busca por
// `lastIndexOf` a propósito: una migración puede mencionar la palabra en un
// comentario, y lo que importa es el que cierra la transacción real.
const corte = sql.lastIndexOf('COMMIT;');
if (corte < 0) {
  morir(`${ruta} no tiene un COMMIT; de nivel superior.\n  Este script solo sirve para migraciones con transacción explícita (BEGIN; … COMMIT;).`);
}
const sqlDePrueba = sql.slice(0, corte) + 'ROLLBACK;' + sql.slice(corte + 'COMMIT;'.length);

const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!url) {
  morir('Falta DATABASE_URL (o SUPABASE_DB_URL) en el entorno.\n  Usa: node --env-file=.env.db scripts/compilar-migracion.mjs <sql>');
}

console.log('='.repeat(88));
console.log('COMPILAR MIGRACIÓN — se envía completa y se REVIERTE. No aplica nada.');
console.log('='.repeat(88));
console.log(`  archivo : ${ruta.split(/[\\/]/).pop()}`);
console.log(`  tamaño  : ${sql.length.toLocaleString('es-MX')} caracteres`);
console.log('  txn     : COMMIT; sustituido por ROLLBACK; (1 sustitución, la última)\n');

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
const avisos = [];
client.on('notice', (n) => avisos.push(n.message));

try {
  await client.connect();
} catch (e) {
  morir(`No se pudo conectar (${e.code ?? 'sin código'}). La cadena no se imprime a propósito.`, 2);
}

try {
  await client.query(sqlDePrueba);
  console.log(`COMPILA. ${avisos.length} nota(s) de la guarda, en orden:\n`);
  for (const aviso of avisos) console.log(`  · ${aviso}`);
  console.log('\nROLLBACK hecho: la base quedó exactamente como estaba.');
  console.log('LÍMITE DECLARADO: esto prueba que COMPILA y que su guarda pasa, no que sea correcta.');
} catch (e) {
  console.error(`NO COMPILA — ${e.code ?? 'sin código'}: ${e.message}`);
  if (e.where) console.error(`  where : ${e.where}`);
  if (e.hint) console.error(`  hint  : ${e.hint}`);
  if (avisos.length) {
    console.error(`\n  Las ${avisos.length} nota(s) que sí alcanzaron a imprimirse antes del fallo:`);
    for (const aviso of avisos) console.error(`    · ${aviso}`);
  }
  process.exitCode = 1;
} finally {
  await client.end();
}
