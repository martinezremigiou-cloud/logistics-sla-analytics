// ============================================================
// [INV-B9.1] Gate de seguridad del CORREO — el endpoint lee-todo y la tabla
// cerrada, con salida literal.
//
// POR QUÉ ESTE ARNÉS EXISTE. `/api/avisos/envios` devuelve los avisos de TODAS
// las personas: es, en la práctica, una credencial de lectura total. Y
// `envios_aviso` es la primera tabla del repo con RLS activa y **cero
// policies** — o sea, inalcanzable para cualquier sesión. Las dos afirmaciones
// hay que medirlas, no declararlas: la guarda de la 0027 lee el catálogo y ve
// que no hay policies, pero no ejecuta una consulta con un JWT real.
//
// PRUEBA DOS SUPERFICIES DISTINTAS, y por eso son dos secciones:
//
//   (A) La RUTA, por HTTP contra el server local. Sin secreto, con secreto
//       equivocado, y —el caso que se pidió explícito— **con una sesión de
//       usuario normal**. El endpoint no es para el navegador.
//   (B) La BASE, por PostgREST saltándose la app, que es la defensa que queda
//       en pie el día que alguien refactorice un route handler.
//
// CONTROL POSITIVO OBLIGATORIO. Si el token del KAM fuera inválido, el rechazo
// de (A) saldría verde sin haber probado nada — P17 aplicado a un arnés de
// seguridad. Por eso se demuestra primero que ESE MISMO token funciona contra
// PostgREST: es una sesión viva, y aun así la ruta la rechaza.
//
// ⚠️ NO CORRE EN PARALELO con los otros arneses en vivo: todos fabrican cuentas
// efímeras, pero solo `rls-negativas.mjs` cuenta `auth.users` antes y después
// (este no): una cuenta fabricada por otro proceso mientras ese conteo corre lo
// hace abortar.
//
// Uso:
//   AVISOS_SECRET=<el mismo del server> node --env-file=.env.local scripts/correo-negativas.mjs [--url http://localhost:3000]
//   exit 0 = todas las comprobaciones pasaron · 1 = alguna falló · 2 = no pudo correr
// ============================================================
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRETO = process.env.AVISOS_SECRET;

const iUrl = process.argv.indexOf('--url');
const BASE = iUrl >= 0 ? process.argv[iUrl + 1] : 'http://localhost:3000';

if (!URL_SB || !ANON || !SERVICE) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}
if (!SECRETO) {
  console.error('Falta AVISOS_SECRET. Tiene que ser EL MISMO valor con el que corre el server, o el control positivo sale rojo sin que nada esté mal.');
  process.exit(2);
}

const cliente = (key) =>
  createClient(URL_SB, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const admin = cliente(SERVICE);
let fallos = 0;

function comprobar(nombre, ok, evidencia) {
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'}  ${nombre}`);
  console.log(`          ${evidencia}`);
}

async function cuentaEfimera(rol, etiqueta) {
  const email = `b91-${etiqueta}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.test`;
  const password = `Arnes-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${etiqueta}): ${error.message}`);
  const { error: errRol } = await admin.from('perfiles').update({ rol }).eq('id', data.user.id);
  if (errRol) throw new Error(`fijar rol ${rol}: ${errRol.message}`);
  const db = cliente(ANON);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) throw new Error(`signIn(${etiqueta}): ${login.error?.message ?? 'sin sesión'}`);
  return { id: data.user.id, email, db, token: login.data.session.access_token };
}

const VENTANA = {
  desde: '2026-08-01T00:00:00.000Z',
  hasta: '2026-08-16T00:00:00.000Z',
  clave_intento: `arnes-negativas-${Date.now()}`,
};

async function pedir(cabeceras) {
  const res = await fetch(`${BASE}/api/avisos/envios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...cabeceras },
    body: JSON.stringify(VENTANA),
  });
  let cuerpo = null;
  try {
    cuerpo = await res.json();
  } catch {
    // Respuesta sin JSON: se reporta el status a secas.
  }
  return { status: res.status, cuerpo };
}

const cuentas = [];

async function main() {
  console.log('='.repeat(88));
  console.log('[INV-B9.1] SEGURIDAD DEL CORREO — el endpoint lee-todo y la tabla cerrada');
  console.log('='.repeat(88));
  console.log(`\nServer bajo prueba: ${BASE}\n`);

  const kam = await cuentaEfimera('kam', 'kam');
  const adm = await cuentaEfimera('admin', 'admin');
  cuentas.push(kam.id, adm.id);
  console.log(`Cuentas efímeras: kam=${kam.email} admin=${adm.email}\n`);

  // ============================================================
  console.log('--- (A) LA RUTA. Sin secreto no se entra, y una sesión no es un secreto.');
  // ============================================================

  // CONTROL POSITIVO del server: si la ruta no existiera o el secreto del
  // server fuera otro, todo lo de abajo saldría "rechazado" sin probar nada.
  const conSecreto = await pedir({ 'x-avisos-secret': SECRETO });
  comprobar(
    'CONTROL POSITIVO · con el secreto correcto la ruta RESPONDE 200 y trae la forma esperada',
    conSecreto.status === 200 && Array.isArray(conSecreto.cuerpo?.correos) && conSecreto.cuerpo?.ventana?.clave_intento === VENTANA.clave_intento,
    `status=${conSecreto.status} · correos=${conSecreto.cuerpo?.correos?.length ?? 'n/a'} · ventana=${JSON.stringify(conSecreto.cuerpo?.ventana ?? null)}`,
  );

  const sinNada = await pedir({});
  comprobar(
    'sin ninguna cabecera → rechazo',
    sinNada.status === 401,
    `status=${sinNada.status} · cuerpo=${JSON.stringify(sinNada.cuerpo)}`,
  );

  const malo = await pedir({ 'x-avisos-secret': SECRETO + 'x' });
  comprobar(
    'con el secreto EQUIVOCADO → rechazo',
    malo.status === 401,
    `status=${malo.status} · cuerpo=${JSON.stringify(malo.cuerpo)}`,
  );

  const vacio = await pedir({ 'x-avisos-secret': '' });
  comprobar(
    'con la cabecera VACÍA → rechazo (nunca se abre paso solo)',
    vacio.status === 401,
    `status=${vacio.status}`,
  );

  // EL CASO QUE SE PIDIÓ. Antes, el control positivo de que ese token está VIVO.
  const { data: vivo, error: errVivo } = await kam.db.from('seguimientos').select('sku').limit(1);
  comprobar(
    'CONTROL POSITIVO · el token del KAM es una sesión VIVA (PostgREST lo acepta)',
    !errVivo,
    `error=${errVivo?.message ?? 'ninguno'} · filas=${vivo?.length ?? 0} (sin esto, el rechazo de abajo no probaría nada)`,
  );

  const conSesion = await pedir({ Authorization: `Bearer ${kam.token}`, Cookie: `sb-access-token=${kam.token}` });
  comprobar(
    'con una SESIÓN DE USUARIO NORMAL → rechazo. El endpoint no es para el navegador',
    conSesion.status === 401,
    `status=${conSesion.status} · cuerpo=${JSON.stringify(conSesion.cuerpo)} · el mismo token que PostgREST SÍ acepta`,
  );

  const conSesionAdmin = await pedir({ Authorization: `Bearer ${adm.token}` });
  comprobar(
    'y con una sesión de ADMIN tampoco',
    conSesionAdmin.status === 401,
    `status=${conSesionAdmin.status}`,
  );

  // ============================================================
  console.log('\n--- (B) LA BASE. Lo que queda en pie si alguien refactoriza la ruta.');
  // ============================================================

  const { data: envKam, error: errEnvKam } = await kam.db.from('envios_aviso').select('perfil_id');
  const { count: envReales } = await admin.from('envios_aviso').select('perfil_id', { count: 'exact', head: true });
  comprobar(
    'un KAM no alcanza NI UNA fila de envios_aviso',
    (envKam ?? []).length === 0,
    `leyó=${JSON.stringify(envKam)} error=${errEnvKam?.code ?? 'ninguno'} · la verdad son ${envReales} fila(s) (si fueran 0, esta prueba sería vacua)`,
  );

  const { data: envAdmin } = await adm.db.from('envios_aviso').select('perfil_id');
  comprobar(
    'un ADMIN tampoco: no hay rama is_admin() porque no hay ninguna policy',
    (envAdmin ?? []).length === 0,
    `leyó=${JSON.stringify(envAdmin)}`,
  );

  const { error: errEscribe } = await kam.db
    .from('envios_aviso')
    .insert({ perfil_id: kam.id, clave_intento: 'forjada', desde: VENTANA.desde, hasta: VENTANA.hasta });
  comprobar(
    'un KAM no puede FORJAR un envío (silenciarse o forzar un reenvío)',
    Boolean(errEscribe),
    `codigo=${errEscribe?.code ?? 'SIN ERROR'} · ${errEscribe?.message?.slice(0, 60) ?? ''}`,
  );

  // El interruptor de correo es dato del usuario y sigue bajo la RLS de B9.
  const { data: prods } = await admin.from('productos').select('sku').order('sku').limit(1);
  await kam.db.from('seguimientos').insert({ sku: prods[0].sku, av_llegada: true, av_correo: true });
  const { data: mio } = await admin.from('seguimientos').select('sku,av_correo').eq('perfil_id', kam.id);
  comprobar(
    'CONTROL POSITIVO · el KAM encendió av_correo en un SKU suyo',
    (mio ?? []).length === 1 && mio[0].av_correo === true,
    `en base=${JSON.stringify(mio)}`,
  );

  const { data: ajeno } = await adm.db.from('seguimientos').select('sku,av_correo,perfil_id');
  comprobar(
    'nadie ve el av_correo de otro — tampoco un admin',
    (ajeno ?? []).length === 0,
    `el admin leyó=${JSON.stringify(ajeno)} · la verdad es 1 fila del KAM`,
  );
}

async function limpiar() {
  // El CASCADE de la 0027 se lleva los envios al borrar la cuenta, pero el
  // control positivo prepara filas para perfiles REALES que no se borran: esas
  // hay que quitarlas por clave.
  await admin.from('envios_aviso').delete().eq('clave_intento', VENTANA.clave_intento);
  for (const id of cuentas) await admin.auth.admin.deleteUser(id);
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
