// ============================================================
// [CHAT-B1] scripts/chat-sonda-proveedor.mjs — la sonda del proveedor.
//
// POR QUÉ EXISTE. `lib/chat/proveedor.ts` trae escritos un endpoint y un id de
// modelo que salieron de la DOCUMENTACIÓN del proveedor, no de una llamada. Esta
// casa ya tiene el precedente de cómo se cierra esa diferencia:
// `modelo-openai.ts:37-42` confirmó que `gpt-5.6-luna` era correcto **por un 400
// real de la API** —un id inexistente habría dado `model_not_found`, no un error
// de parámetro—. Una afirmación sobre un servicio remoto no se verifica
// cotejando dos copias locales: se verifica preguntándole al servicio.
//
// LO QUE YA PAGO, la primera vez que se corrio: el bloque pedia
// `deepseek-v4.1-flash` y **ese id NO EXISTE**. La API expone `deepseek-flash` y
// `deepseek-v4-pro`. Sin esta sonda, el chat habria dado HTTP 400 en CADA
// pregunta, en produccion, con toda la suite en verde — porque ninguna prueba
// puede saber que ids tiene un servicio remoto.
//
// LO QUE HACE, EN ESTE ORDEN Y NO EN OTRO:
//   1. Le pide al proveedor SU LISTA DE MODELOS. Primero preguntar, luego
//      suponer: si el id que trae el código no está en esa lista, la sonda lo
//      dice en vez de descubrirlo en un 400 ambiguo.
//   2. Una clasificación real, con el prompt de producción.
//   3. Una redacción real, con una ficha de juguete DENTRO del perímetro.
//
// LO QUE NUNCA IMPRIME: la llave. Ni entera, ni en un mensaje de error, ni en
// una URL. regla de seguridad del repo — un log de fallo publica lo que le den, así que aquí no se
// le da. De la llave solo salen su longitud y su prefijo de tres caracteres.
//
// CÓMO SE CORRE (la llave va en el PROCESO, nunca en un argumento):
//
//   export DEEPSEEK_API_KEY="<tu llave>"
//   (la llave sale de tu gestor de secretos, no del repo)
//   node scripts/chat-sonda-proveedor.mjs --proveedor=deepseek
// ============================================================
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// El prompt de PRODUCCION, no una copia de juguete. Es lo que vuelve util esta
// seccion: el dia que alguien reescriba `promptDelSistema()` y le quite la
// palabra «json», DeepSeek devolvera 400 y esto lo dira — mientras que una copia
// aqui dentro seguiria verde sobre un prompt que ya no existe.
const RAIZ = process.cwd();
register('./scripts/ts-loader.mjs', pathToFileURL(RAIZ + '/'));
register('./scripts/gate-alias-loader.mjs', pathToFileURL(RAIZ + '/'));
const { promptDelSistema } = await import(pathToFileURL(join(RAIZ, 'src/lib/chat/modelo.ts')).href);

const arg = (n) => process.argv.find((a) => a.startsWith('--' + n + '='))?.split('=').slice(1).join('=');

const PROVEEDORES = {
  openai: { base: 'https://api.openai.com/v1', modelo: 'gpt-5.6-luna', variable: 'OPENAI_API_KEY' },
  deepseek: { base: 'https://api.deepseek.com/v1', modelo: 'deepseek-flash', variable: 'DEEPSEEK_API_KEY' },
};

const nombre = (arg('proveedor') ?? 'deepseek').toLowerCase();
const cfg = PROVEEDORES[nombre];
if (!cfg) {
  console.error('Proveedor desconocido: ' + nombre + '. Son: ' + Object.keys(PROVEEDORES).join(', '));
  process.exit(2);
}

const KEY = process.env[cfg.variable];
if (!KEY) {
  console.error(`Falta ${cfg.variable} EN EL ENTORNO DEL PROCESO (no en .env.local, y es a proposito).`);
  console.error(`  export ${cfg.variable}="<tu llave>"`);
  process.exit(2);
}

const MODELO = arg('modelo') ?? cfg.modelo;
const L = '─'.repeat(72);
let fallos = 0;

const huella = (s) => `len=${s.length} prefijo=${s.slice(0, 3)}…`;

console.log(L);
console.log(`SONDA DEL PROVEEDOR · ${nombre}`);
console.log(`  base    : ${cfg.base}`);
console.log(`  modelo  : ${MODELO}${arg('modelo') ? '   (por argumento)' : '   (el que trae el codigo)'}`);
console.log(`  llave   : ${huella(KEY)}   <- NUNCA se imprime entera`);
console.log(L);

const cabeceras = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/** Un fetch que NUNCA deja la llave ni la URL completa en un mensaje de error. */
async function pedir(ruta, opciones) {
  try {
    return await fetch(cfg.base + ruta, opciones);
  } catch (e) {
    // Se relanza SIN la URL: regla de seguridad — el mensaje de un fallo de red puede
    // arrastrar lo que se le pasó, y de ahí salió una fuga documentada.
    throw new Error(`no se pudo alcanzar ${nombre}${ruta} (${e?.name ?? 'error'})`);
  }
}

// ── 1 · LA LISTA DE MODELOS ────────────────────────────────────────────────
console.log('\n1 · QUE MODELOS DICE TENER');
let idsConocidos = null;
try {
  const res = await pedir('/models', { headers: cabeceras });
  console.log(`  HTTP ${res.status}`);
  if (res.ok) {
    const b = await res.json();
    idsConocidos = (b.data ?? []).map((m) => String(m.id));
    console.log(`  modelos (${idsConocidos.length}): ${idsConocidos.join(', ')}`);
    const esta = idsConocidos.includes(MODELO);
    console.log(`  ¿esta «${MODELO}» en la lista? ${esta ? 'SI' : 'NO'}`);
    if (!esta) {
      console.log('  ⚠ EL ID QUE TRAE EL CODIGO NO EXISTE EN ESTE PROVEEDOR.');
      fallos++;
    }
  } else {
    console.log(`  (no expone /models, o no con esta llave: ${(await res.text().catch(() => '')).slice(0, 120)})`);
  }
} catch (e) {
  console.log(`  ERROR: ${e.message}`);
  fallos++;
}

// ── 2 · UNA CLASIFICACION REAL ─────────────────────────────────────────────
console.log('\n2 · UNA CLASIFICACION REAL');
try {
  const res = await pedir('/chat/completions', {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({
      model: MODELO,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: promptDelSistema() },
        { role: 'user', content: 'hablame de los CLIPS' },
      ],
    }),
  });
  console.log(`  ¿el prompt lleva «json»? ${/json/i.test(promptDelSistema()) ? 'SI' : 'NO  <- DeepSeek dara 400'}`);
  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`  cuerpo: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    fallos++;
  } else {
    const b = await res.json();
    const c = b.choices?.[0]?.message?.content ?? '';
    console.log(`  modelo que contesto : ${b.model ?? '(no lo dice)'}`);
    console.log(`  uso                 : entrada=${b.usage?.prompt_tokens ?? '?'} salida=${b.usage?.completion_tokens ?? '?'}`);
    console.log(`  contenido           : ${c.slice(0, 160)}`);
    let ok = false;
    try { JSON.parse(c); ok = true; } catch { /* lo dice abajo */ }
    console.log(`  ¿JSON parseable?    : ${ok ? 'SI' : 'NO'}`);
    if (!ok) fallos++;
  }
} catch (e) {
  console.log(`  ERROR: ${e.message}`);
  fallos++;
}

// ── 3 · UNA REDACCION REAL, CON max_tokens ─────────────────────────────────
console.log('\n3 · UNA REDACCION REAL (con max_tokens, que es nuevo en este repo)');
try {
  const res = await pedir('/chat/completions', {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({
      model: MODELO,
      response_format: { type: 'json_object' },
      // 3 000 y no 600: `deepseek-flash` RAZONA y sus tokens de razonamiento
      // cuentan contra este techo. Medido: con 600 quemaba los 600 razonando y
      // devolvia `content` VACIO con HTTP 200 — se paga todo y no llega nada.
      max_tokens: 3000,
      messages: [
        {
          role: 'system',
          content: [
            'Contestas en espanol de Mexico solo con lo que este en las SECCIONES.',
            '',
            'SECCIONES:',
            '[0] Peso',
            'Peso del equipo: 3.2 kg.',
            '',
            // La palabra «json» es OBLIGATORIA para DeepSeek: sin ella, HTTP 400.
            'Devuelve json EXACTAMENTE asi:',
            '{"tipo":"respuesta","frases":[{"texto":"…","orden":N,"cita":"…"}]}',
            '"cita" es un fragmento COPIADO TAL CUAL de esa seccion.',
          ].join('\n'),
        },
        { role: 'user', content: '¿cuanto pesa?' },
      ],
    }),
  });
  console.log(`  HTTP ${res.status}`);
  if (!res.ok) {
    console.log(`  cuerpo: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    fallos++;
  } else {
    const b = await res.json();
    const c = b.choices?.[0]?.message?.content ?? '';
    console.log(`  uso       : entrada=${b.usage?.prompt_tokens ?? '?'} salida=${b.usage?.completion_tokens ?? '?'}`);
    console.log(`  contenido : ${c.slice(0, 300)}`);
    try {
      const j = JSON.parse(c);
      console.log(`  forma     : tipo=${j.tipo} frases=${Array.isArray(j.frases) ? j.frases.length : 'n/a'}`);
    } catch {
      console.log('  forma     : NO PARSEA');
      fallos++;
    }
  }
} catch (e) {
  console.log(`  ERROR: ${e.message}`);
  fallos++;
}

console.log('\n' + L);
console.log(fallos === 0 ? 'SONDA VERDE.' : `SONDA CON ${fallos} HALLAZGO(S).`);
console.log('Limite declarado: mide EL PROVEEDOR, no el portal. Que la ruta lo use bien');
console.log('se prueba en vitest; que el prompt de produccion rinda, en el arnes de evaluacion.');
console.log(L);
process.exit(fallos === 0 ? 0 : 1);
