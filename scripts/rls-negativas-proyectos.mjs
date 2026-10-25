// ============================================================
// [INV-B8] Gate de seguridad del Módulo Proyectos — pruebas NEGATIVAS de RLS
// contra PostgREST, con JWT reales y SALTÁNDOSE LA APLICACIÓN.
//
// POR QUÉ NO SE PRUEBA A TRAVÉS DE LA APP. Porque la app tiene sus propios
// gates (`requireSessionNoVisitante`, `requireSameOrigin`) y un verde a
// través de ella no distingue "la RLS lo impidió" de "el gate de la app lo
// impidió". El día que alguien refactorice un route handler, la única
// defensa que queda en pie es la de la base — así que es la que hay que
// medir, y hay que medirla directo. Es el mismo criterio de
// `scripts/rls-negativas.mjs`, que fue quien descubrió con este método que
// `clasificacion_v2.updated_by` era legible por cualquier autenticado.
//
// LO QUE ESTE ARNÉS SABE Y NO ES OBVIO (heredado de su gemelo, medido en
// vivo): **SELECT, UPDATE y DELETE denegados por RLS devuelven `200 []`, no
// un 403.** Solo INSERT grita con 42501. Por eso aquí "denegado" NUNCA se
// afirma por el status: se afirma por el EFECTO — la fila sigue ahí, o no
// vino en la respuesta. Un arnés que buscara 403 en el DELETE saldría verde
// sobre un borrado que sí ocurrió.
//
// ⚠️ NO CORRE EN PARALELO con `rls-negativas.mjs` ni con ningún otro arnés vivo:
// todos fabrican cuentas efímeras, pero solo `rls-negativas.mjs` cuenta
// `auth.users` antes y después (este no). Una cuenta fabricada por otro proceso
// mientras ese conteo corre lo hace abortar y el rojo no sería del código.
//
// Uso:
//   node --env-file=.env.local scripts/rls-negativas-proyectos.mjs
//   exit 0 = todas las negativas se comportaron · 1 = alguna falló
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
const resultados = [];
let fallos = 0;

function comprobar(nombre, ok, evidencia) {
  resultados.push({ nombre, ok, evidencia });
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${nombre}`);
  console.log(`         ${evidencia}`);
}

/** Cuenta efímera con rol. Devuelve { id, email, password, db } ya con sesión iniciada. */
async function cuentaEfimera(rol, etiqueta) {
  const email = `b8-${etiqueta}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@arnes.test`;
  const password = `Arnes-${Math.random().toString(36).slice(2)}-${Date.now()}`;

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${etiqueta}): ${error.message}`);

  // El trigger `handle_new_user` crea el perfil con rol por defecto; se ajusta
  // al rol que esta prueba necesita.
  const { error: errRol } = await admin.from('perfiles').update({ rol }).eq('id', data.user.id);
  if (errRol) throw new Error(`fijar rol ${rol}: ${errRol.message}`);

  const db = cliente(ANON);
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error || !login.data.session) {
    throw new Error(`signInWithPassword(${etiqueta}): ${login.error?.message ?? 'sin sesión'}`);
  }

  return { id: data.user.id, email, db };
}

const aBorrar = [];

async function main() {
  console.log('='.repeat(88));
  console.log('[INV-B8] RLS de Proyectos — pruebas NEGATIVAS contra PostgREST, sin pasar por la app');
  console.log('='.repeat(88));

  const kamA = await cuentaEfimera('kam', 'kam-a');
  const kamB = await cuentaEfimera('kam', 'kam-b');
  const visitante = await cuentaEfimera('visitante', 'visitante');
  aBorrar.push(kamA.id, kamB.id, visitante.id);
  console.log(`\nCuentas efímeras: kamA=${kamA.email}  kamB=${kamB.email}  visitante=${visitante.email}\n`);

  // Dos SKU cualquiera del catálogo cargado (la FK de las partidas exige que
  // existan en `productos`). No se escriben a mano: dependen de los datos que
  // haya en la base; con la base de ejemplo (scripts/generar-datos-muestra.mjs)
  // y una ingesta aplicada sobran.
  const { data: muestraSkus, error: errSkus } = await admin.from('productos').select('sku').limit(2);
  if (errSkus || !muestraSkus || muestraSkus.length < 2) {
    throw new Error('Se necesitan al menos 2 productos cargados en la base (ver scripts/generar-datos-muestra.mjs). Abortando.');
  }
  const [SKU_PROPIO, SKU_AJENO] = muestraSkus.map((r) => r.sku);

  // ---------- (1) El KAM A crea su proyecto. Control POSITIVO. ----------
  // Sin este control, todas las negativas de abajo podrían salir verdes
  // porque no hay NADA que leer — el fallo por universo vacío (P17).
  const alta = await kamA.db.from('proyectos').insert({ titulo: 'Proyecto del arnés B8' }).select('id,folio,propietario').single();
  comprobar(
    'CONTROL POSITIVO · el KAM A sí puede crear su proyecto',
    !alta.error && !!alta.data?.id,
    alta.error ? `error ${alta.error.code}: ${alta.error.message}` : `creado ${alta.data.folio} (id ${alta.data.id})`,
  );
  if (alta.error) throw new Error('Sin proyecto no hay nada que probar. Abortando.');

  const proyectoId = alta.data.id;
  comprobar(
    'CONTROL POSITIVO · el propietario lo puso la BASE, no el cliente',
    alta.data.propietario === kamA.id,
    `propietario=${alta.data.propietario} · auth.uid()=${kamA.id}`,
  );

  const partida = await kamA.db
    .from('proyecto_partidas')
    .insert({ proyecto_id: proyectoId, sku: SKU_PROPIO, cantidad: 120 })
    .select('id')
    .single();
  comprobar(
    'CONTROL POSITIVO · el KAM A sí puede agregar una partida',
    !partida.error,
    partida.error ? `error ${partida.error.code}: ${partida.error.message}` : `partida ${partida.data.id}`,
  );
  const partidaId = partida.data?.id;

  // ---------- (2) Sin sesión ----------
  const anon = cliente(ANON);
  const lecturaAnon = await anon.from('proyectos').select('id,titulo');
  comprobar(
    'SIN SESIÓN · anon no lee ningún proyecto',
    (lecturaAnon.data ?? []).length === 0,
    `status=${lecturaAnon.status} filas=${(lecturaAnon.data ?? []).length} error=${lecturaAnon.error?.code ?? 'ninguno'}`,
  );

  const altaAnon = await anon.from('proyectos').insert({ titulo: 'de nadie' }).select('id');
  comprobar(
    'SIN SESIÓN · anon no puede crear',
    !!altaAnon.error,
    altaAnon.error ? `rechazado con ${altaAnon.error.code}: ${altaAnon.error.message}` : 'CREÓ LA FILA — hueco abierto',
  );

  // ---------- (3) KAM B contra el proyecto del KAM A ----------
  const cruzadaLectura = await kamB.db.from('proyectos').select('id,titulo').eq('id', proyectoId);
  comprobar(
    'RLS CRUZADA · el KAM B no ve el proyecto del KAM A',
    (cruzadaLectura.data ?? []).length === 0,
    `status=${cruzadaLectura.status} filas=${(cruzadaLectura.data ?? []).length} (recordatorio: un SELECT denegado da 200 [], no 403)`,
  );

  const cruzadaPartidas = await kamB.db.from('proyecto_partidas').select('id,sku').eq('proyecto_id', proyectoId);
  comprobar(
    'RLS CRUZADA · el KAM B no ve las partidas del KAM A',
    (cruzadaPartidas.data ?? []).length === 0,
    `status=${cruzadaPartidas.status} filas=${(cruzadaPartidas.data ?? []).length}`,
  );

  const cruzadaEdicion = await kamB.db.from('proyectos').update({ titulo: 'secuestrado' }).eq('id', proyectoId).select('id');
  const trasEdicion = await admin.from('proyectos').select('titulo').eq('id', proyectoId).single();
  comprobar(
    'RLS CRUZADA · el KAM B no puede EDITAR el proyecto del KAM A (verificado POR EFECTO)',
    (cruzadaEdicion.data ?? []).length === 0 && trasEdicion.data.titulo === 'Proyecto del arnés B8',
    `filas afectadas=${(cruzadaEdicion.data ?? []).length} · título en la base sigue siendo "${trasEdicion.data.titulo}"`,
  );

  const cruzadaRobo = await kamB.db.from('proyectos').update({ propietario: kamB.id }).eq('id', proyectoId).select('id');
  const trasRobo = await admin.from('proyectos').select('propietario').eq('id', proyectoId).single();
  comprobar(
    'RLS CRUZADA · el KAM B no puede APROPIARSE del proyecto (el WITH CHECK del UPDATE)',
    trasRobo.data.propietario === kamA.id,
    `filas afectadas=${(cruzadaRobo.data ?? []).length} · propietario sigue siendo ${trasRobo.data.propietario === kamA.id ? 'el KAM A' : 'OTRO — HUECO'}`,
  );

  const cruzadaBorrado = await kamB.db.from('proyecto_partidas').delete().eq('id', partidaId).select('id');
  const trasBorrado = await admin.from('proyecto_partidas').select('id').eq('id', partidaId);
  comprobar(
    'RLS CRUZADA · el KAM B no puede BORRAR la partida del KAM A (verificado POR EFECTO, no por status)',
    (trasBorrado.data ?? []).length === 1,
    `filas devueltas por el delete=${(cruzadaBorrado.data ?? []).length} · la partida ${(trasBorrado.data ?? []).length === 1 ? 'SIGUE en la base' : 'DESAPARECIÓ — hueco'}`,
  );

  const cruzadaInserta = await kamB.db
    .from('proyecto_partidas')
    .insert({ proyecto_id: proyectoId, sku: SKU_AJENO, cantidad: 1 })
    .select('id');
  comprobar(
    'RLS CRUZADA · el KAM B no puede meter partidas en el proyecto del KAM A',
    !!cruzadaInserta.error,
    cruzadaInserta.error ? `rechazado con ${cruzadaInserta.error.code}` : 'INSERTÓ — hueco abierto',
  );

  // ---------- (4) Visitante ----------
  const altaVisitante = await visitante.db.from('proyectos').insert({ titulo: 'del visitante' }).select('id');
  comprobar(
    'VISITANTE · no puede crear proyectos (policy proyectos_insert_own_no_visitante)',
    !!altaVisitante.error,
    altaVisitante.error ? `rechazado con ${altaVisitante.error.code}: ${altaVisitante.error.message}` : 'CREÓ — hueco abierto',
  );

  const lecturaVisitante = await visitante.db.from('proyectos').select('id');
  comprobar(
    'VISITANTE · no ve ningún proyecto',
    (lecturaVisitante.data ?? []).length === 0,
    `filas=${(lecturaVisitante.data ?? []).length}`,
  );

  // ---------- (5) Lo que este arnés NO puede medir, dicho en voz alta ----------
  // TRUNCATE no pasa por aquí: PostgREST no expone ese verbo, así que desde
  // este arnés es INALCANZABLE por construcción y un verde suyo no probaría
  // nada. Lo verifica la guarda de la migración 0024 con
  // `has_table_privilege`, que es donde sí se puede medir. Se deja escrito
  // para que nadie lea la ausencia de esta prueba como un descuido.
  console.log('\n  NOTA  TRUNCATE no se prueba aquí: PostgREST no expone el verbo.');
  console.log('         Lo verifica por efecto la guarda de supabase/migrations/0024_b8_proyectos.sql.\n');

  // ---------- (5-bis) REGRESIÓN de un bloqueo real que el gate de
  //            arquitectura encontró antes de aplicar la migración.
  //
  // Con la FK de `propietario` en NO ACTION, borrar una cuenta con proyectos
  // era IMPOSIBLE para todos: `perfiles.id → auth.users(id)` cascadea, la FK
  // lo bloqueaba con 23503, y las policies le niegan al admin la escritura de
  // proyectos ajenos. Ni el dueño (ya no existe), ni el admin, ni el
  // operador. Este arnés mismo se habría roto: fabrica cuentas y las destruye
  // en cada corrida.
  //
  // Se prueba el escenario COMPLETO: una cuenta con proyecto vivo, borrada
  // SIN limpiar antes. Con `ON DELETE SET NULL` la cuenta se va y el trabajo
  // sobrevive huérfano, visible solo para admin.
  const efimero = await cuentaEfimera('kam', 'huerfano');
  const suyo = await efimero.db.from('proyectos').insert({ titulo: 'Proyecto que sobrevive al arnés B8' }).select('id').single();
  const borradoDeCuenta = await admin.auth.admin.deleteUser(efimero.id);
  comprobar(
    'REGRESIÓN H4 · una cuenta CON proyectos vivos sí se puede borrar',
    !borradoDeCuenta.error,
    borradoDeCuenta.error
      ? `bloqueada con ${borradoDeCuenta.error.message} — la FK volvió a NO ACTION`
      : 'la cuenta se borró sin que la FK de propietario la bloqueara',
  );

  const huerfano = await admin.from('proyectos').select('id,propietario').eq('id', suyo.data.id).maybeSingle();
  comprobar(
    'REGRESIÓN H4 · el proyecto sobrevive huérfano, no se destruyó en silencio',
    !!huerfano.data && huerfano.data.propietario === null,
    huerfano.data
      ? `sigue en la base con propietario=${huerfano.data.propietario === null ? 'NULL (correcto)' : huerfano.data.propietario}`
      : 'DESAPARECIÓ — la FK quedó en CASCADE y borró trabajo sin consentimiento',
  );

  const huerfanoParaKam = await kamB.db.from('proyectos').select('id').eq('id', suyo.data.id);
  comprobar(
    'REGRESIÓN H4 · el proyecto huérfano no le aparece a ningún KAM',
    (huerfanoParaKam.data ?? []).length === 0,
    `filas visibles para un KAM cualquiera=${(huerfanoParaKam.data ?? []).length} (solo la rama is_admin() del SELECT lo alcanza)`,
  );

  // ---------- (5-ter) EL ESTADO HUÉRFANO, que es lo que faltaba probar ----------
  //
  // Esta es la clase de prueba que este arnés NO tenía y por eso dejó pasar el
  // bug: comprobaba caminos felices y DENEGACIONES, nunca un ESTADO TERMINAL.
  // Un huérfano quedaba visible para el admin y no editable ni borrable por
  // NADIE, permanentemente, porque `NULL = auth.uid()` no es TRUE. La 0025
  // abre la única salida: que un admin lo reasigne.
  const adminReal = await cuentaEfimera('admin', 'admin');
  aBorrar.push(adminReal.id);

  const huerfanoId = suyo.data.id;

  const kamIntentaAdoptar = await kamB.db
    .from('proyectos')
    .update({ propietario: kamB.id })
    .eq('id', huerfanoId)
    .select('id');
  const trasIntentoKam = await admin.from('proyectos').select('propietario').eq('id', huerfanoId).single();
  comprobar(
    'HUÉRFANO · un KAM NO puede adoptar un proyecto huérfano',
    trasIntentoKam.data.propietario === null,
    `filas afectadas=${(kamIntentaAdoptar.data ?? []).length} · propietario sigue ${trasIntentoKam.data.propietario === null ? 'NULL (correcto)' : 'REASIGNADO — hueco'}`,
  );

  const adopcion = await adminReal.db
    .from('proyectos')
    .update({ propietario: kamA.id })
    .eq('id', huerfanoId)
    .select('id,propietario')
    .maybeSingle();
  comprobar(
    'HUÉRFANO · un admin SÍ lo rescata reasignándolo (invariante: reparable desde la app)',
    !!adopcion.data && adopcion.data.propietario === kamA.id,
    adopcion.data
      ? `reasignado al KAM A (${adopcion.data.propietario})`
      : `NO se pudo reasignar (error ${adopcion.error?.code ?? 'sin código'}) — el proyecto sigue congelado`,
  );

  // Y la mitad que hace que el rescate sirva de algo: tras la adopción, el
  // dueño nuevo recupera el control completo. Sin esto, "reasignar" habría
  // movido el uuid sin devolver a nadie la capacidad de arreglar la fila.
  const dueñoNuevoEdita = await kamA.db
    .from('proyectos')
    .update({ titulo: 'Rescatado y editable' })
    .eq('id', huerfanoId)
    .select('id');
  comprobar(
    'HUÉRFANO · tras el rescate, el dueño nuevo YA puede editarlo',
    (dueñoNuevoEdita.data ?? []).length === 1,
    `filas afectadas por el dueño nuevo=${(dueñoNuevoEdita.data ?? []).length}`,
  );

  const dueñoNuevoBorra = await kamA.db.from('proyectos').delete().eq('id', huerfanoId).select('id');
  comprobar(
    'HUÉRFANO · tras el rescate, el dueño nuevo YA puede borrarlo (el estado terminal desapareció)',
    (dueñoNuevoBorra.data ?? []).length === 1,
    `filas borradas por el dueño nuevo=${(dueñoNuevoBorra.data ?? []).length}`,
  );

  // El límite del alcance decidido: el admin RESCATA, no gobierna. Un
  // proyecto CON dueño le sigue estando vedado para escribir.
  const adminSobreProyectoVivo = await adminReal.db
    .from('proyectos')
    .update({ titulo: 'el admin no manda aquí' })
    .eq('id', proyectoId)
    .select('id');
  const trasAdmin = await admin.from('proyectos').select('titulo').eq('id', proyectoId).single();
  comprobar(
    'ALCANCE · el admin NO puede editar un proyecto que SÍ tiene dueño (la policy de rescate no le da eso)',
    (adminSobreProyectoVivo.data ?? []).length === 0 && trasAdmin.data.titulo === 'Proyecto del arnés B8',
    `filas afectadas=${(adminSobreProyectoVivo.data ?? []).length} · título intacto: "${trasAdmin.data.titulo}"`,
  );

  const adminBorraAjeno = await adminReal.db.from('proyectos').delete().eq('id', proyectoId).select('id');
  const sigueVivo = await admin.from('proyectos').select('id').eq('id', proyectoId);
  comprobar(
    'ALCANCE · el admin NO borra proyectos ajenos (decisión de producto: con reasignar basta)',
    (sigueVivo.data ?? []).length === 1,
    `filas devueltas por el delete=${(adminBorraAjeno.data ?? []).length} · el proyecto ${(sigueVivo.data ?? []).length === 1 ? 'SIGUE vivo' : 'DESAPARECIÓ — hueco'}`,
  );

  // ---------- (6) El dueño SÍ puede, al final ----------
  // Cierra la pinza: si todo lo anterior fuera verde porque la tabla está
  // rota, esto también fallaría.
  const borradoPropio = await kamA.db.from('proyecto_partidas').delete().eq('id', partidaId).select('id');
  comprobar(
    'CONTROL POSITIVO FINAL · el dueño SÍ puede borrar su partida',
    (borradoPropio.data ?? []).length === 1,
    `filas borradas=${(borradoPropio.data ?? []).length}`,
  );
}

async function limpiar() {
  console.log('\n--- limpieza ---');
  for (const id of aBorrar) {
    // Los proyectos se van solos: `propietario` es ON DELETE SET NULL, así que
    // borrar la cuenta NO los arrastra. Se borran a mano con service_role
    // para no dejar basura del arnés.
    const { error: errProy } = await admin.from('proyectos').delete().eq('propietario', id);
    if (errProy) console.log(`  aviso: no se pudieron borrar proyectos de ${id}: ${errProy.message}`);
    const { error } = await admin.auth.admin.deleteUser(id);
    console.log(`  ${error ? `FALLA borrando ${id}: ${error.message}` : `borrada ${id}`}`);
  }
  // Cualquier proyecto huérfano que haya quedado del arnés.
  await admin.from('proyectos').delete().is('propietario', null).like('titulo', '%arnés B8%');
}

try {
  await main();
} catch (e) {
  console.error(`\nEXCEPCIÓN: ${e.message}`);
  fallos++;
} finally {
  await limpiar();
}

console.log('\n' + '='.repeat(88));
console.log(`${resultados.length} comprobaciones · ${resultados.length - fallos} en verde · ${fallos} en rojo`);
console.log('='.repeat(88));
process.exit(fallos === 0 ? 0 : 1);
