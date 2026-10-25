// ============================================================
// [INV-B11] O1/O3 · LA SINCRONIZACIÓN, con la fuente LOCAL.
//
// Corre el indexador entero —manifiesto, diff, parada ante secreto, troceo,
// embebido y escritura— contra la copia del corpus que hay en disco.
//
// POR QUÉ ESTO EXISTE ANTES QUE LA FUENTE DE GIT. Porque la fuente de git
// depende de que exista un repo privado del corpus, y **el resto del indexador
// no tiene por qué esperar a eso**. Con la frontera en `FuenteCorpus`, esta fuente y la de git entran por
// el mismo hueco: cuando exista el repo, se cambia la fuente y nada más.
//
// ────────────────────────────────────────────────────────────
// EL HASH ES EL DE GIT, A PROPÓSITO, Y AHORRA UNA RE-INDEXACIÓN ENTERA.
//
// Un `sha256` del contenido habría sido lo natural. Pero el día que la fuente
// pase a git, el manifiesto traería SHA de blob y **ninguno coincidiría**: el
// diff vería todo como cambiado, se re-embeberían todos los trozos y se volvería a
// pagar, sin que nada hubiera cambiado en el corpus.
//
// Así que aquí se calcula **el mismo hash que calcularía git**:
//
//     sha1("blob " + <bytes> + "\0" + contenido)
//
// Es el formato de objeto de git, no una imitación. Al cambiar de transporte el
// diff dirá «0 cambios», que es la verdad.
//
// ────────────────────────────────────────────────────────────
// `version()` DEVUELVE `local-sin-git`, Y ESO ES INFORMACIÓN.
//
// La `0030` advirtió en su propio RAISE NOTICE que un `commit_sha` falso
// produce una procedencia que se ve perfecta. Aquí no hay commit, así que se
// escribe algo que **no se puede confundir con un sha**. Quien lea
// `local-sin-git` en la base sabe que esa procedencia no se puede verificar.
//
// Uso:
//   node --env-file=.env.local scripts/corpus-sync.mjs --simular
//   node --env-file=.env.local scripts/corpus-sync.mjs
//   node --env-file=.env.local scripts/corpus-sync.mjs --irreversibilidad="..."
//
//   (OPENAI_API_KEY se toma del entorno del proceso; ver .env.example)
//   --raiz=<carpeta>   raíz del corpus (por omisión ./corpus-ejemplo)
//
//   exit 0 = ok · 1 = detenido · 2 = no pudo correr
// ============================================================
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const RAIZ_REPO = process.cwd();
register('./scripts/ts-loader.mjs', pathToFileURL(RAIZ_REPO + '/'));
register('./scripts/gate-alias-loader.mjs', pathToFileURL(RAIZ_REPO + '/'));
const imp = async (r) => import(pathToFileURL(join(RAIZ_REPO, r)).href);

const { sincronizar } = await imp('src/services/corpus.service.ts');
const { embebedorOpenAI } = await imp('src/lib/corpus/embebedor-openai.ts');

// El corpus real nunca viaja con el repo: la raíz por omisión es una carpeta
// local de ejemplo (que cada quien crea) y se cambia con --raiz=<carpeta>.
const RAIZ_POR_OMISION = './corpus-ejemplo';
const EN_ALCANCE = ['00_Indice', '10_Cuentas', '20_Seguridad', '70_Notas-de-Campo', '80_Registro'];

const arg = (n) => process.argv.find((a) => a.startsWith('--' + n + '='))?.split('=').slice(1).join('=');
const RAIZ = resolve(arg('raiz') ?? RAIZ_POR_OMISION);
const SIMULAR = process.argv.includes('--simular');
// Medido sobre el corpus original: casi todas las fichas son UN SOLO trozo, asi
// que no hay nada que recuperar DENTRO de una ficha. Ver el parametro `embebedor` del servicio.
const SIN_EMBEDDINGS = process.argv.includes('--sin-embeddings');
const IRREVERSIBILIDAD = arg('irreversibilidad') ?? '';

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI = process.env.OPENAI_API_KEY;

if (!URL_SB || !SERVICE) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exitCode = 2;
} else if (!OPENAI && !SIMULAR && !SIN_EMBEDDINGS) {
  console.error('Falta OPENAI_API_KEY en el entorno del proceso.');
  console.error('  export OPENAI_API_KEY="<tu llave>"');
  console.error('  (o corre con --simular, que no embebe nada)');
  process.exitCode = 2;
} else if (!existsSync(RAIZ)) {
  console.error('No encontré el corpus en: ' + RAIZ);
  process.exitCode = 2;
} else {
  await correr();
}

/** El SHA-1 de objeto de git para un blob. No una imitación: el formato real. */
function shaDeGit(contenido) {
  const buf = Buffer.from(contenido, 'utf8');
  return createHash('sha1')
    .update('blob ' + buf.length + '\0')
    .update(buf)
    .digest('hex');
}

function fuenteLocal(raiz) {
  const rel = (p) => p.slice(raiz.length + 1).split(sep).join('/');
  const todos = () => {
    const out = [];
    const anda = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        // `.obsidian` se excluye como DIRECTORIO, no por la lista de sus
        // archivos de hoy.
        if (e.isDirectory()) {
          if (e.name !== '.obsidian') anda(p);
          continue;
        }
        if (e.name.endsWith('.md')) out.push(p);
      }
    };
    for (const c of EN_ALCANCE) {
      const d = join(raiz, c);
      if (existsSync(d)) anda(d);
    }
    return out;
  };

  return {
    nombre: 'local:' + raiz,
    version: async () => 'local-sin-git',
    listar: async () => todos().map((p) => ({ ruta: rel(p), hash: shaDeGit(readFileSync(p, 'utf8')) })),
    leer: async (ruta) => readFileSync(join(raiz, ...ruta.split('/')), 'utf8'),
  };
}

async function correr() {
  const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
  const fuente = fuenteLocal(RAIZ);
  const emb = SIN_EMBEDDINGS ? null : embebedorOpenAI(OPENAI ?? 'sin-llave-modo-simulacion');

  const L = '='.repeat(88);
  console.log(L);
  console.log('[INV-B11] SINCRONIZACIÓN DEL CORPUS' + (SIMULAR ? '  ·  SIMULACIÓN' : ''));
  console.log(L);
  console.log('  fuente     ' + fuente.nombre);
  console.log('  version    local-sin-git   <- NO es un sha: la procedencia no se puede verificar, y se dice');
  console.log('  embebedor  ' + (emb ? emb.nombre + '  (' + emb.dimensiones + ' dim)' : 'NINGUNO — la ficha ES el trozo (fichas de 1 solo trozo)'));
  console.log('');

  const r = await sincronizar(db, fuente, emb, {
    simular: SIMULAR,
    irreversibilidad: IRREVERSIBILIDAD,
  });

  console.log('  intento    ' + (r.intentoId ?? '(no se registró)'));
  console.log('  resultado  ' + r.resultado.toUpperCase());
  console.log('');
  console.log('EL DIFF');
  console.log('  altas ........... ' + r.diff.altas.length);
  console.log('  cambios ......... ' + r.diff.cambios.length);
  console.log('  bajas ........... ' + r.diff.bajas.length);
  console.log('  sin cambio ...... ' + r.diff.sinCambio);
  console.log('');
  console.log('LO QUE SE HIZO');
  console.log('  leídos .......... ' + r.leidos);
  console.log('  embebibles ...... ' + r.embebidos);
  console.log('  excluidos ....... ' + r.excluidos + '   (se GUARDAN igual: si no, volverían como alta cada corrida)');
  console.log('  trozos .......... ' + r.trozos);
  console.log('  tokens .......... ' + r.tokens + (r.tokens ? '   ≈ $' + ((r.tokens / 1e6) * 0.02).toFixed(4) : ''));

  const paran = r.hallazgos.filter((h) => h.para);
  const avisan = r.hallazgos.filter((h) => !h.para);
  if (r.hallazgos.length > 0) {
    console.log('');
    console.log('DETECTORES DE SECRETO — ' + paran.length + ' que PARAN · ' + avisan.length + ' avisos');
    for (const h of paran) console.log('  PARA   ' + h.ruta + '  [' + h.detector + ']');
    for (const h of avisan.slice(0, 8)) console.log('  aviso  ' + h.ruta + '  [' + h.detector + ']');
  }

  if (r.motivo) {
    console.log('');
    console.log('MOTIVO');
    for (const linea of r.motivo.match(/.{1,84}(\s|$)/g) ?? [r.motivo]) console.log('  ' + linea.trim());
  }

  console.log('');
  console.log(L);
  console.log(
    r.resultado === 'ok'
      ? SIMULAR
        ? 'SIMULACIÓN COMPLETA. No se embebió ni se escribió nada.'
        : 'SINCRONIZADO.'
      : r.resultado === 'detenido'
        ? 'DETENIDO — y eso NO es un error: es una guarda haciendo su trabajo.'
        : 'ERROR.',
  );
  console.log(L);

  process.exitCode = r.resultado === 'ok' ? 0 : r.resultado === 'detenido' ? 1 : 2;
}
