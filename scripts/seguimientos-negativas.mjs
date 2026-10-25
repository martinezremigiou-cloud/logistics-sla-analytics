// ============================================================
// [INV-B9] Gate de seguridad del SEGUIMIENTO — pruebas NEGATIVAS de RLS contra
// PostgREST, con JWT reales y SALTÁNDOSE LA APLICACIÓN.
//
// POR QUÉ NO SE PRUEBA A TRAVÉS DE LA APP. Porque la app tiene sus propios
// gates (`requireSession`, `requireSameOrigin`) y un verde a través de ella no
// distingue «la RLS lo impidió» de «el gate de la app lo impidió». El día que
// alguien refactorice un route handler, la única defensa que queda en pie es la
// de la base — así que es la que hay que medir, y hay que medirla directo.
//
// LO QUE ESTE ARNÉS SABE Y NO ES OBVIO (heredado de sus dos gemelos, medido en
// vivo): **SELECT, UPDATE y DELETE denegados por RLS devuelven `200 []`, no un
// 403.** Solo INSERT grita con 42501. Por eso aquí «denegado» NUNCA se afirma
// por el status: se afirma por el EFECTO — la fila sigue ahí, o no vino en la
// respuesta.
//
// LA COMPROBACIÓN QUE ESTE BLOQUE ESTRENA: **que un ADMIN tampoco vea el
// seguimiento de otro.** La RLS de `proyectos` sí tiene rama `is_admin()`
// porque supervisar el trabajo es parte de su función; la de `seguimientos` NO
// la tiene, porque lo que una persona sigue es su configuración. Sin esta
// prueba, esa diferencia sería solo un comentario.
//
// Y LA DEL ESTADO TERMINAL: borrar la cuenta se lleva sus seguimientos
// (`ON DELETE CASCADE`). Es la lección de la 0024/0025 aplicada por
// anticipado — allí un `SET NULL` dejó filas que nadie podía alcanzar.
//
// ⚠️ NO CORRE EN PARALELO con `rls-negativas.mjs`, `rls-negativas-proyectos.mjs`,
// `chat-negativas.mjs` ni ningún otro arnés vivo: todos fabrican cuentas
// efímeras, pero solo `rls-negativas.mjs` cuenta `auth.users` antes y después
// (este no). Una cuenta fabricada por otro proceso mientras ese conteo corre lo
// hace abortar y el rojo no sería del código.
//
// Uso:
//   node --env-file=.env.local scripts/seguimientos-negativas.mjs
//   exit 0 = todas las comprobaciones pasaron · 1 = alguna falló · 2 = no pudo correr
// ============================================================
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const cliente = (key) =>
  createClient(URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const admin = cliente(SERVICE);
let fallos = 0;

function comprobar(nombre, ok, evidencia) {
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'}  ${nombre}`);
  console.log(`          ${evidencia}`);
}

async function cuentaEfimera(rol, etiqueta) {
  const email = `b9-${etiqueta}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.test`;
  const password = `Arnes-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${etiqueta}): ${error.message}`);

  const { error: errRol } = await admin.from('perfiles').update({ rol }).eq('id', data.user.id);
  if (errRol) throw new Error(`fijar rol ${rol}: ${errRol.message}`);

  const db = cliente(ANON);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) {
    throw new Error(`signInWithPassword(${etiqueta}): ${login.error?.message ?? 'sin sesión'}`);
  }
  return { id: data.user.id, email, rol, db };
}

/** La verdad, leída con la llave de servicio: sin RLS de por medio. */
async function filasReales(perfilId) {
  const { data, error } = await admin.from('seguimientos').select('sku,av_llegada').eq('perfil_id', perfilId);
  if (error) throw new Error('leer seguimientos: ' + error.message);
  return data ?? [];
}

const cuentas = [];

async function main() {
  console.log('='.repeat(88));
  console.log('[INV-B9] RLS del SEGUIMIENTO — pruebas NEGATIVAS contra PostgREST, sin pasar por la app');
  console.log('='.repeat(88));

  const { data: prods, error: errProds } = await admin.from('productos').select('sku').order('sku').limit(2);
  if (errProds) throw new Error('productos: ' + errProds.message);
  if (!prods || prods.length < 2) throw new Error(`El catálogo trajo ${prods?.length ?? 0} SKU; hacen falta 2.`);
  const [SKU1, SKU2] = prods.map((p) => p.sku);
  const SKU_FALSO = 'NO-EXISTE-ESTE-SKU-B9';
  console.log(`\nSKU reales del catálogo: ${SKU1} · ${SKU2}`);

  const kamA = await cuentaEfimera('kam', 'kam-a');
  const kamB = await cuentaEfimera('kam', 'kam-b');
  const adm = await cuentaEfimera('admin', 'admin');
  const visitante = await cuentaEfimera('visitante', 'visitante');
  cuentas.push(kamA.id, kamB.id, adm.id, visitante.id);
  console.log(`Cuentas efímeras: A=${kamA.email} B=${kamB.email} admin=${adm.email} visitante=${visitante.email}\n`);

  // ============================================================
  console.log('--- (1) CONTROL POSITIVO. Sin esto, todo lo de abajo saldría verde por vacuidad.');
  // ============================================================
  const { error: errAlta } = await kamA.db.from('seguimientos').insert({ sku: SKU1, av_llegada: true });
  const reales = await filasReales(kamA.id);
  comprobar(
    'el KAM A sigue un SKU y la fila queda a SU nombre, sin mandar perfil_id',
    !errAlta && reales.length === 1 && reales[0].sku === SKU1,
    `error=${errAlta?.message ?? 'ninguno'} · en base=${JSON.stringify(reales)}`,
  );

  const { data: leidoA } = await kamA.db.from('seguimientos').select('sku');
  comprobar(
    'y el KAM A lo lee de vuelta',
    (leidoA ?? []).length === 1,
    `leyó=${JSON.stringify(leidoA)}`,
  );

  // ============================================================
  console.log('\n--- (2) UN KAM NO VE NI TOCA EL SEGUIMIENTO DE OTRO.');
  // ============================================================
  const { data: leidoB } = await kamB.db.from('seguimientos').select('sku,perfil_id');
  comprobar(
    'el KAM B lee CERO filas — no ve las del KAM A',
    (leidoB ?? []).length === 0,
    `leyó=${JSON.stringify(leidoB)} (la verdad son ${(await filasReales(kamA.id)).length} filas del KAM A)`,
  );

  const { error: errUpd } = await kamB.db.from('seguimientos').update({ av_llegada: false }).eq('sku', SKU1);
  const trasUpd = await filasReales(kamA.id);
  comprobar(
    'el KAM B no puede APAGAR el aviso del KAM A (el UPDATE no alcanza la fila)',
    trasUpd[0]?.av_llegada === true,
    `error=${errUpd?.message ?? 'ninguno (200 con 0 filas: asi deniega la RLS un UPDATE)'} · en base=${JSON.stringify(trasUpd)}`,
  );

  const { error: errDel } = await kamB.db.from('seguimientos').delete().eq('sku', SKU1);
  const trasDel = await filasReales(kamA.id);
  comprobar(
    'el KAM B no puede BORRAR el seguimiento del KAM A',
    trasDel.length === 1,
    `error=${errDel?.message ?? 'ninguno (200 con 0 filas)'} · en base=${JSON.stringify(trasDel)}`,
  );

  const { error: errSuplanta } = await kamB.db.from('seguimientos').insert({ perfil_id: kamA.id, sku: SKU2, av_llegada: true });
  const trasSuplanta = await filasReales(kamA.id);
  comprobar(
    'el KAM B no puede INSERTAR una fila a nombre del KAM A',
    errSuplanta?.code === '42501' && trasSuplanta.length === 1,
    `codigo=${errSuplanta?.code ?? 'SIN ERROR'} · filas del KAM A=${trasSuplanta.length}`,
  );

  // ============================================================
  console.log('\n--- (3) LO QUE ESTE BLOQUE ESTRENA: UN ADMIN TAMPOCO.');
  // ============================================================
  const { data: leidoAdmin } = await adm.db.from('seguimientos').select('sku,perfil_id');
  comprobar(
    'el ADMIN lee CERO filas ajenas — a diferencia de `proyectos`, aqui NO hay rama is_admin()',
    (leidoAdmin ?? []).length === 0,
    `leyó=${JSON.stringify(leidoAdmin)} · lo que una persona sigue es su configuracion, no trabajo supervisable`,
  );

  const { error: errAdminUpd } = await adm.db.from('seguimientos').update({ av_llegada: false }).eq('sku', SKU1);
  const trasAdmin = await filasReales(kamA.id);
  comprobar(
    'el ADMIN tampoco puede modificarlo',
    trasAdmin[0]?.av_llegada === true,
    `error=${errAdminUpd?.message ?? 'ninguno (200 con 0 filas)'} · en base=${JSON.stringify(trasAdmin)}`,
  );

  const { data: prefAdmin } = await adm.db.from('preferencias_notificacion').select('perfil_id');
  comprobar(
    'y tampoco ve las preferencias de nadie',
    (prefAdmin ?? []).length === 0,
    `leyó=${JSON.stringify(prefAdmin)}`,
  );

  // ============================================================
  console.log('\n--- (4) UN VISITANTE SÍ PUEDE SEGUIR. El alcance es general (decision de producto).');
  // ============================================================
  const { error: errVis } = await visitante.db.from('seguimientos').insert({ sku: SKU1, av_llegada: true });
  const realesVis = await filasReales(visitante.id);
  comprobar(
    'el visitante sigue un SKU sin problema',
    !errVis && realesVis.length === 1,
    `error=${errVis?.message ?? 'ninguno'} · en base=${JSON.stringify(realesVis)}`,
  );

  // ============================================================
  console.log('\n--- (5) CARGA MANIPULADA.');
  // ============================================================
  const { error: errFalso } = await kamA.db.from('seguimientos').insert({ sku: SKU_FALSO, av_llegada: true });
  comprobar(
    'un SKU que no existe lo para la FK contra productos, no un 500',
    errFalso?.code === '23503',
    `codigo=${errFalso?.code ?? 'SIN ERROR'} · ${errFalso?.message?.slice(0, 70) ?? ''}`,
  );

  const { error: errVacio } = await kamA.db
    .from('seguimientos')
    .insert({ sku: SKU2, av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: false });
  comprobar(
    'seguir un SKU sin querer saber NADA lo para el CHECK',
    errVacio?.code === '23514',
    `codigo=${errVacio?.code ?? 'SIN ERROR'} · ${errVacio?.message?.slice(0, 70) ?? ''}`,
  );

  const { error: errPrefAjena } = await kamB.db
    .from('preferencias_notificacion')
    .insert({ perfil_id: kamA.id, av_llegada: true });
  comprobar(
    'no se pueden escribir las preferencias de otro',
    errPrefAjena?.code === '42501',
    `codigo=${errPrefAjena?.code ?? 'SIN ERROR'}`,
  );

  // ============================================================
  console.log('\n--- (6) EL ESTADO TERMINAL, EVITADO POR ANTICIPADO.');
  // ============================================================
  const { error: errPref } = await kamA.db.from('preferencias_notificacion').insert({ av_llegada: true });
  if (errPref) console.log('     (nota: no se pudo sembrar la preferencia del KAM A: ' + errPref.message + ')');

  const antesCascade = (await filasReales(kamA.id)).length;
  const { data: prefAntes } = await admin.from('preferencias_notificacion').select('perfil_id').eq('perfil_id', kamA.id);

  await admin.auth.admin.deleteUser(kamA.id);
  cuentas.splice(cuentas.indexOf(kamA.id), 1);

  const despuesCascade = (await filasReales(kamA.id)).length;
  const { data: prefDespues } = await admin.from('preferencias_notificacion').select('perfil_id').eq('perfil_id', kamA.id);

  comprobar(
    'borrar la cuenta se lleva sus seguimientos (ON DELETE CASCADE)',
    antesCascade > 0 && despuesCascade === 0,
    `antes=${antesCascade} filas · despues=${despuesCascade} · en 0024 un SET NULL dejo filas que nadie podia alcanzar`,
  );
  comprobar(
    'y tambien sus preferencias',
    (prefAntes ?? []).length > 0 && (prefDespues ?? []).length === 0,
    `antes=${(prefAntes ?? []).length} · despues=${(prefDespues ?? []).length}`,
  );

  const { data: huerfanas } = await admin.from('seguimientos').select('perfil_id').is('perfil_id', null);
  comprobar(
    'no queda NINGUNA fila huerfana',
    (huerfanas ?? []).length === 0,
    `filas con perfil_id NULL=${(huerfanas ?? []).length}`,
  );
}

async function limpiar() {
  for (const id of cuentas) {
    await admin.auth.admin.deleteUser(id);
  }
}

try {
  await main();
} catch (e) {
  console.error('\nEl arnés no pudo completarse:', e?.message ?? e);
  fallos = fallos || 1;
} finally {
  await limpiar();
  console.log('\n' + '='.repeat(88));
  console.log(fallos === 0 ? 'TODAS LAS COMPROBACIONES PASARON' : `${fallos} COMPROBACIÓN(ES) FALLARON`);
  console.log('='.repeat(88));
  process.exit(fallos === 0 ? 0 : 1);
}
