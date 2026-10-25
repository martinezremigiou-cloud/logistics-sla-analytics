// ============================================================
// [INV-B10] GATE DE SEGURIDAD DEL CHAT — contra Postgres, con JWT reales y
// SALTÁNDOSE LA APLICACIÓN.
//
// POR QUÉ NO SE PRUEBA A TRAVÉS DE LA RUTA. Porque la ruta tiene sus propios
// gates (`requireSession`, `requireSameOrigin`) y un verde a través de ella no
// distingue «la base lo impidió» de «la app lo impidió». El día que alguien
// refactorice el route handler, lo único que queda en pie es la base — así que
// es lo que hay que medir, y hay que medirlo directo.
//
// Y hay una razón extra en este bloque: `route.test.ts` prueba el ORDEN de las
// decisiones con dobles. **Un gate probado con dobles solo demuestra que los
// dobles hacen lo que se les dijo.** Esto mide lo otro.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTE ARNÉS SABE Y NO ES OBVIO:
//
//   · **Toda función nueva de `public` nace ejecutable por `anon`.** El
//     `pg_default_acl` de esta base concede EXECUTE a `anon` POR NOMBRE, y
//     `REVOKE ... FROM PUBLIC` no toca una concesión nominal. Lo cazó la guarda
//     de la 0028 abortando la transacción entera. Aquí se comprueba por EFECTO.
//   · **El techo vive en la base**, no en el servicio, así que se puede medir
//     sin levantar el portal: se llama a la función con topes chicos y se ve
//     dónde corta.
//   · **`chat_anotar_uso` es SECURITY DEFINER**, o sea que la RLS no la frena:
//     su filtro `perfil_id = auth.uid()` ES la autorización. Si ese filtro se
//     cayera, un usuario podría escribir consumo en el registro de otro — y eso
//     es justo lo que se prueba.
//
// ⚠️ NO CORRE EN PARALELO con `rls-negativas.mjs`, `rls-negativas-proyectos.mjs`,
// `seguimientos-negativas.mjs` ni cualquier otro arnés vivo:
// todos fabrican cuentas efímeras, pero solo `rls-negativas.mjs` cuenta
// `auth.users` antes y después (este no): una cuenta fabricada por otro proceso
// mientras ese conteo corre lo hace abortar.
//
// Uso:
//   node --env-file=.env.local scripts/chat-negativas.mjs
//   exit 0 = todas pasaron · 1 = alguna falló · 2 = no pudo correr
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
const anon = cliente(ANON);

let fallos = 0;
function comprobar(nombre, ok, evidencia) {
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK   ' : 'FALLA'}  ${nombre}`);
  console.log(`          ${evidencia}`);
}

const cuentas = [];

async function cuentaEfimera(rol, etiqueta) {
  const email = `b10-${etiqueta}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.test`;
  const password = `Arnes-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${etiqueta}): ${error.message}`);
  cuentas.push(data.user.id);

  const { error: errRol } = await admin.from('perfiles').update({ rol }).eq('id', data.user.id);
  if (errRol) throw new Error(`fijar rol ${rol}: ${errRol.message}`);

  const db = cliente(ANON);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) {
    throw new Error(`signInWithPassword(${etiqueta}): ${login.error?.message ?? 'sin sesión'}`);
  }
  return { id: data.user.id, email, rol, db };
}

/** Las filas de consumo de un perfil, leídas con la llave de servicio: sin RLS de por medio. */
async function filas(perfilId) {
  const { data, error } = await admin
    .from('consumo_chat')
    .select('id,intencion,modelo,tokens_entrada,tokens_salida,preguntado_en')
    .eq('perfil_id', perfilId)
    .order('preguntado_en');
  if (error) throw new Error('consumo_chat: ' + error.message);
  return data ?? [];
}

const TOPES = { p_por_hora: 30, p_por_dia: 150, p_global_dia: 100000 };

async function main() {
  console.log('='.repeat(92));
  console.log('[INV-B10] GATE DEL CHAT — negativas contra Postgres, sin pasar por la app');
  console.log('='.repeat(92));

  const kam = await cuentaEfimera('kam', 'kam');
  const otro = await cuentaEfimera('kam', 'otro');
  const visitante = await cuentaEfimera('visitante', 'visitante');
  console.log(`\nCuentas efímeras: kam · otro · visitante\n`);

  // ============================================================
  console.log('--- (0) CONTROL POSITIVO. Sin esto, todo lo de abajo saldría verde por vacuidad (P19).');
  // ============================================================
  const { data: v1, error: e1 } = await kam.db.rpc('chat_registrar_pregunta', { ...TOPES, p_intencion: 'pipeline', p_modelo: null });
  comprobar(
    'un KAM con sesión SÍ puede registrar una pregunta',
    !e1 && v1?.permitido === true && typeof v1?.id === 'string',
    `error=${e1?.message ?? 'ninguno'} · permitido=${v1?.permitido} · id=${v1?.id ? 'sí' : 'no'}`,
  );

  const trasUna = await filas(kam.id);
  comprobar(
    'y deja UNA fila, con su intención y sin tokens todavía',
    trasUna.length === 1 && trasUna[0].intencion === 'pipeline' && trasUna[0].tokens_entrada === null,
    `filas=${trasUna.length} · intencion=${trasUna[0]?.intencion} · tokens_entrada=${trasUna[0]?.tokens_entrada}`,
  );

  // ============================================================
  console.log('\n--- (1) `anon` NO alcanza nada. El default ACL de esta base concede EXECUTE a');
  console.log('        `anon` por NOMBRE en toda función nueva; `REVOKE ... FROM PUBLIC` no lo toca.');
  // ============================================================
  const rpcAnon = await anon.rpc('chat_registrar_pregunta', TOPES);
  comprobar(
    '`anon` NO puede ejecutar `chat_registrar_pregunta`',
    rpcAnon.error?.code === '42501',
    `code=${rpcAnon.error?.code ?? 'SIN ERROR'} · ${rpcAnon.error?.message?.slice(0, 60) ?? 'ejecutó (MAL)'}`,
  );

  const anotarAnon = await anon.rpc('chat_anotar_uso', {
    p_id: trasUna[0].id, p_intencion: 'x', p_modelo: 'x', p_tok_in: 1, p_tok_out: 1,
  });
  comprobar(
    '`anon` NO puede ejecutar `chat_anotar_uso`',
    anotarAnon.error?.code === '42501',
    `code=${anotarAnon.error?.code ?? 'SIN ERROR'}`,
  );

  const leerAnon = await anon.from('consumo_chat').select('id').limit(1);
  comprobar(
    '`anon` NO puede leer `consumo_chat`',
    leerAnon.error?.code === '42501',
    `code=${leerAnon.error?.code ?? 'SIN ERROR'}`,
  );

  // ============================================================
  console.log('\n--- (2) Un usuario AUTENTICADO tampoco toca la tabla. La RLS está activa con CERO');
  console.log('        policies y encima se le revocaron los privilegios: dos vueltas de llave.');
  // ============================================================
  const leerKam = await kam.db.from('consumo_chat').select('id').limit(5);
  comprobar(
    'un KAM NO puede LEER su propio consumo directo',
    leerKam.error?.code === '42501',
    `code=${leerKam.error?.code ?? 'SIN ERROR'} · leyó ${leerKam.data?.length ?? 0} filas`,
  );

  const borrarKam = await kam.db.from('consumo_chat').delete().eq('perfil_id', kam.id).select('id');
  const trasBorrar = await filas(kam.id);
  comprobar(
    'un KAM NO puede BORRAR su consumo para reiniciarse el techo',
    trasBorrar.length === trasUna.length,
    `code=${borrarKam.error?.code ?? 'sin error'} · filas antes=${trasUna.length} después=${trasBorrar.length}`,
  );

  const insertarKam = await kam.db.from('consumo_chat').insert({ perfil_id: kam.id }).select('id');
  comprobar(
    'un KAM NO puede INSERTAR filas a mano',
    insertarKam.error?.code === '42501',
    `code=${insertarKam.error?.code ?? 'SIN ERROR'}`,
  );

  // ============================================================
  console.log('\n--- (3) EL VISITANTE ENTRA. Decisión medida, no concesión: ya lee la ficha');
  console.log('        completa por /api/sku/[sku], así que negarle el chat no protege ningún dato.');
  // ============================================================
  const { data: vVis, error: eVis } = await visitante.db.rpc('chat_registrar_pregunta', { ...TOPES, p_intencion: 'llegada' });
  comprobar(
    'un `visitante` SÍ puede preguntar, y se le cobra el mismo techo',
    !eVis && vVis?.permitido === true,
    `error=${eVis?.message ?? 'ninguno'} · permitido=${vVis?.permitido} · restantes_hora=${vVis?.restantes_hora}`,
  );

  // ============================================================
  console.log('\n--- (4) EL TECHO CORTA DE VERDAD, y corta en la base — no en el servicio.');
  // ============================================================
  const TOPE_CHICO = { p_por_hora: 3, p_por_dia: 150, p_global_dia: 100000 };
  const antes = (await filas(otro.id)).length;
  const veredictos = [];
  for (let i = 0; i < 5; i++) {
    const { data } = await otro.db.rpc('chat_registrar_pregunta', { ...TOPE_CHICO, p_intencion: 'pipeline' });
    veredictos.push(data);
  }
  const permitidas = veredictos.filter((v) => v?.permitido).length;
  const despues = (await filas(otro.id)).length;
  comprobar(
    'con tope 3, la 4ª y la 5ª se rechazan',
    permitidas === 3 && veredictos[3]?.permitido === false && veredictos[4]?.permitido === false,
    `permitidas=${permitidas}/5 · motivos=${veredictos.map((v) => (v?.permitido ? 'ok' : v?.motivo)).join(',')}`,
  );
  comprobar(
    'y un RECHAZO NO deja fila — si la dejara, un bucle rechazado escribiría sin tope',
    despues - antes === 3,
    `filas nuevas=${despues - antes} (esperado 3, no 5)`,
  );
  comprobar(
    'el rechazo dice CUÁL techo y con qué tope, no un «límite alcanzado» a secas',
    veredictos[3]?.motivo === 'tope_hora' && veredictos[3]?.tope === 3,
    `motivo=${veredictos[3]?.motivo} · tope=${veredictos[3]?.tope} · usadas=${veredictos[3]?.usadas}`,
  );

  // ============================================================
  console.log('\n--- (5) `chat_anotar_uso`: el filtro por dueño ES la autorización.');
  //
  // La función es SECURITY DEFINER, así que la RLS NO la frena. Sin el
  // `perfil_id = auth.uid()`, cualquiera con un id ajeno escribiría consumo en
  // el registro de otro.
  // ============================================================
  const miFila = (await filas(kam.id))[0];

  const ajena = await otro.db.rpc('chat_anotar_uso', {
    p_id: miFila.id, p_intencion: 'disponibilidad', p_modelo: 'modelo-ajeno', p_tok_in: 999, p_tok_out: 999,
  });
  const trasAjena = (await filas(kam.id))[0];
  comprobar(
    'OTRO usuario NO puede anotar una fila que no es suya',
    ajena.data === false && trasAjena.modelo === null && trasAjena.tokens_entrada === null,
    `devolvió ${ajena.data} · modelo=${trasAjena.modelo} · tokens=${trasAjena.tokens_entrada}`,
  );

  const propia = await kam.db.rpc('chat_anotar_uso', {
    p_id: miFila.id, p_intencion: 'pipeline', p_modelo: 'gpt-5.6-luna', p_tok_in: 400, p_tok_out: 30,
  });
  const trasPropia = (await filas(kam.id))[0];
  comprobar(
    'el DUEÑO sí puede, y completa su fila sin crear otra',
    propia.data === true && trasPropia.tokens_entrada === 400 && (await filas(kam.id)).length === trasUna.length,
    `devolvió ${propia.data} · modelo=${trasPropia.modelo} · tok_in=${trasPropia.tokens_entrada} · filas=${(await filas(kam.id)).length}`,
  );

  // Idempotente, con el molde de `confirmarEnvio` (B9.1).
  const repe = await kam.db.rpc('chat_anotar_uso', {
    p_id: miFila.id, p_intencion: 'llegada', p_modelo: 'otro-modelo', p_tok_in: 1, p_tok_out: 1,
  });
  const trasRepe = (await filas(kam.id))[0];
  comprobar(
    'anotar DOS veces no pisa el consumo ya registrado',
    repe.data === false && trasRepe.tokens_entrada === 400 && trasRepe.modelo === 'gpt-5.6-luna',
    `devolvió ${repe.data} · tok_in sigue en ${trasRepe.tokens_entrada} · modelo sigue en ${trasRepe.modelo}`,
  );

  // ============================================================
  console.log('\n--- (6) LO QUE NO SE REGISTRA, comprobado por ausencia de columna.');
  // ============================================================
  // LISTA BLANCA y no lista negra, y el cambio salió de que mi primera versión
  // se marcó a sí misma: `preguntado_en` casa con /pregunta/i y es una marca de
  // tiempo. Una lista negra falla en los dos sentidos —marca lo bueno y deja
  // pasar lo que nadie anticipó—; una lista blanca obliga a que TODA columna
  // nueva se justifique, que es la propiedad que de verdad se quiere.
  const ESPERADAS = ['id', 'perfil_id', 'preguntado_en', 'intencion', 'modelo', 'tokens_entrada', 'tokens_salida'];
  const { data: crudas } = await admin.from('consumo_chat').select('*').eq('perfil_id', kam.id).limit(1);
  const columnas = Object.keys(crudas?.[0] ?? {}).sort();
  const inesperadas = columnas.filter((c) => !ESPERADAS.includes(c));
  comprobar(
    'las columnas son EXACTAMENTE las declaradas: no hay dónde guardar el texto de la pregunta',
    inesperadas.length === 0 && columnas.length === ESPERADAS.length,
    `columnas=[${columnas.join(', ')}] · inesperadas=${inesperadas.length ? inesperadas.join(',') : 'ninguna'}`,
  );

  console.log('\n' + '='.repeat(92));
  console.log(fallos === 0 ? 'TODAS PASARON.' : `${fallos} COMPROBACIÓN(ES) FALLARON.`);
  console.log('='.repeat(92));
}

async function limpiar() {
  for (const id of cuentas) await admin.auth.admin.deleteUser(id).catch(() => {});
  const { count } = await admin
    .from('consumo_chat')
    .select('id', { count: 'exact', head: true })
    .in('perfil_id', cuentas.length ? cuentas : ['00000000-0000-0000-0000-000000000000']);
  console.log(`\nLimpieza: ${cuentas.length} cuenta(s) borrada(s) · filas de consumo_chat que quedaron: ${count ?? 0}`);
  if ((count ?? 0) > 0) {
    console.log('  ⚠️ El CASCADE no se las llevó. Eso es un hallazgo, no un residuo.');
    fallos++;
  }
}

let salida = 0;
try {
  await main();
} catch (e) {
  console.error('\nNo pudo correr: ' + (e?.message ?? e));
  salida = 2;
}
await limpiar();
if (salida !== 2) salida = fallos === 0 ? 0 : 1;
process.exit(salida);
