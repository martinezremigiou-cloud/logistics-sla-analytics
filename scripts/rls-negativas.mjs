#!/usr/bin/env node
// ============================================================
// rls-negativas.mjs — Batería de pruebas NEGATIVAS de RLS para las tablas
// creadas DESPUÉS de B1: clasificacion_v2, tecnologias, pendientes_datos y
// storage.objects (bucket producto-imagenes). [INV-B7B] carril F (deuda B6-5).
//
// POR QUÉ EXISTE (léelo antes de tocar este archivo — docs/engineering/failure-patterns.md (P4))
// --------------------------------------------------------------------------
// Medido en vivo contra una base Supabase real:
//
//   anon SELECT productos|clasificacion_v2|pendientes_datos|perfiles|(13 tablas) -> 200 []
//   anon PATCH  clasificacion_v2?sku=eq.C926 {marca_v2:'HACK'}                    -> 200 []
//   anon DELETE tecnologias?nombre=eq.EAS                                        -> 200 []   <-- silencioso
//   anon POST   clasificacion_v2                                                 -> 401 42501 (el único ruidoso)
//   anon RPC    is_admin|contar_pendientes|resolver_pendiente|aplicar_override|
//               ingest_snapshot|aplicar_clasificacion_v2                         -> 401 42501
//   efecto real después: tecnologias intactas · C926.marca_v2 intacta
//
// O sea: SELECT, UPDATE y DELETE denegados devuelven `200 []`; solo INSERT y
// las RPC gritan. Una prueba que solo mire el status HTTP daría VERDE sobre
// una brecha real (un DELETE que SÍ borró la fila también responde `200`).
//
// FORMA DE LA ASERCIÓN (no negociable, ver la demostración del mutante en
// rls-negativas.test.ts): cada caso de escritura es una TRIPLETA
// (leer_antes con el testigo `service_role`, intentar con el rol bajo
// prueba, leer_después con el testigo) y se afirma antes === después. El
// status HTTP/código de error se registra aparte, como DATO — nunca como
// criterio de éxito (ver `evaluarEscritura`, que ni siquiera recibe el
// status como argumento).
//
// Para SELECT hay una trampa adicional: afirmar `filasRol === 0` no basta,
// porque `[]` también significa "la tabla está vacía" y la prueba pasaría
// en verde sobre una base vacía. Por eso `evaluarLectura` exige ADEMÁS que
// el mismo SELECT con `service_role` devuelva `> 0` filas — sin ese
// contraste, un `denegado` y una tabla vacía son indistinguibles.
//
// Como los 3 roles bajo prueba (anon, kam, visitante) NUNCA son admin, todo
// verbo de escritura (INSERT/UPDATE/DELETE, en las 3 tablas Y en Storage)
// comparte el MISMO invariante esperado: el estado no cambia. Por diseño,
// `evaluarEscritura` no necesita saber si el caso "debería" ser silencioso o
// ruidoso — esa etiqueta (`esperado`) es solo documental/de reporte; la
// aserción real es única y uniforme.
//
// USO
//   node scripts/rls-negativas.mjs                    corre la matriz completa contra Supabase real,
//                                                       fabricando y destruyendo sus 2 cuentas efímeras
//                                                       (kam + visitante) en esta misma corrida
//   node scripts/rls-negativas.mjs --json              ídem, salida JSON (para el test)
//   node scripts/rls-negativas.mjs --check-credenciales [--json]   sin red: ¿EXISTEN las 3 variables base?
//   node scripts/rls-negativas.mjs --solo-estructura   [--json]   sin red
//   node scripts/rls-negativas.mjs --autotest-evaluador [--json]  sin red (escenarios sintéticos)
//   exit 0 = verde, o batería OMITIDA con aviso explícito (sin variables base, o el entorno no respondió
//            al fabricar las cuentas efímeras — nunca se llegó a crear nada, o lo parcial ya se destruyó)
//   exit 1 = la batería SÍ corrió y ≥1 caso falló
//   exit 2 = error inesperado (bug real) O la limpieza de las cuentas efímeras falló — el mensaje trae
//            los UUID EXACTOS que quedaron vivos para borrarlos a mano, nunca en silencio (ver P9 abajo)
//
// [INV-B7B corrección, ronda anterior] `--check-credenciales` (y el entonces único `hayCredenciales()`)
// solo comprobaban que las variables EXISTIERAN — con las cuentas de prueba borradas (incidente de
// docs/known-limitations.md, B7B-19), las variables seguían presentes en `.env.local` pero apuntaban a cuentas
// muertas, así que la guarda decía "hay credenciales", el script intentaba loguearse, fallaba, y moría con
// `process.exit(2)` mientras los clientes de Supabase seguían con handles de red vivos — en Windows eso
// revienta con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` ANTES de que el exit code documentado
// llegara a observarse (exit REAL 127, no 2) y sin el JSON que el test espera. La corrida completa cierra
// siempre sus clientes (`cerrarClientes`) y sale por `process.exitCode` — nunca `process.exit()` con una
// promesa de red todavía en vuelo.
//
// [INV-B7B cierre — ESTE cambio] Esa corrección anterior seguía dependiendo de DOS CUENTAS PERMANENTES
// (`RLS_TEST_KAM_EMAIL`/`RLS_TEST_VISITANTE_EMAIL`), documentadas como deuda desde que nacieron (dos logins
// funcionales contra producción con password en `.env.local`) y además ya NO EXISTEN: el incidente de
// enumeración de abajo (P9) se las llevó por delante. Este archivo ya no las necesita ni las menciona en
// ninguna parte de su lógica: cada corrida fabrica sus propias 2 cuentas efímeras y las destruye antes de
// salir, pase lo que pase. `verificarLogin()` (que iniciaba sesión con las cuentas fijas) se sustituye por
// `prepararEntorno()` (que las FABRICA, inicia sesión, y devuelve también los `id` para poder destruirlas).
//
// GUARDAS DE BORRADO — P9 (docs/engineering/failure-patterns.md, leído ANTES de escribir esto)
// --------------------------------------------------------------------------
// El incidente que motiva estas guardas: un script de QA con permiso para borrar unas pocas cuentas desechables
// consultó `GET admin/users?email=X` de GoTrue para "encontrar" la cuenta a limpiar — ese endpoint NO
// filtra por `email` y devuelve TODO el proyecto; el bucle de `DELETE` recorrió TODAS las cuentas reales,
// incluida la de un administrador (docs/known-limitations.md, B7B-19). Esta corrida nunca le hace esa pregunta al servidor:
//   1. CREA guardando el `id` que devuelve el POST de `auth.admin.createUser` — nunca re-consulta para
//      "encontrar" lo que acaba de crear. Es el patrón estándar de limpieza segura
//      (crea, guarda `json.id`, borra por `admin/users/${id}`).
//   2. BORRA ÚNICAMENTE por ese `id` exacto: `admin.auth.admin.deleteUser(id)` llama, dentro del SDK,
//      exactamente `DELETE .../admin/users/<uuid>` — nunca `admin/users?...` con parámetros. La firma de
//      `destruirFixturesConGuardas` ni siquiera acepta un correo/prefijo/filtro: no hay parámetro por el
//      que colarse un criterio de búsqueda.
//   3. CUENTA `auth.users` ANTES de crear cualquier cosa y DESPUÉS de borrar todo; si el saldo no vuelve a
//      coincidir EXACTAMENTE, aborta ruidosamente diciendo qué esperaba y qué encontró.
//   4. TOPE DE RADIO: si alguna vez se fuera a borrar más ids de los que esta corrida creó
//      (`MAX_CUENTAS_EFIMERAS` = 2: kam + visitante), aborta ANTES de borrar una sola cuenta.
//   5. Si la limpieza falla, el error trae los UUID EXACTOS que siguen vivos (re-verificados uno por uno
//      con `getUserById`, nunca con una lista/búsqueda) para que un humano los borre a mano — nunca en
//      silencio.
//   6. Ninguna cuenta real (ni de administrador) aparece en ningún argumento de ninguna función
//      de este archivo — ni siquiera como literal de texto. Es imposible POR CONSTRUCCIÓN que este código
//      la toque: el único origen de un `id` que se borra es el arreglo que `crearFixtures` construyó él
//      mismo un momento antes, en la MISMA corrida. El único punto que lee `auth.users` en volumen
//      (`contarUsuariosAuth`) solo usa la LONGITUD de cada página — nunca el `.id`/`.email` de ninguna
//      fila —, así que ni siquiera un conteo puede convertirse en una decisión sobre a quién borrar.
//
// ⚠ NO LO CORRAS A LA VEZ QUE OTRO ARNÉS EN VIVO (cualquier script que fabrique
//   o borre cuentas de `auth.users`). La guarda #3 de arriba —contar `auth.users`
//   antes y después— es correcta y no se va a debilitar, pero eso significa que
//   CUALQUIER otro proceso que fabrique una cuenta al mismo tiempo la hace
//   abortar. Firma observada durante [MVP-2]: `auth.users esperado=4
//   encontrado=6`, y un `Test File` en ROJO con CERO aserciones fallidas — un
//   fallo de RECOLECCIÓN, que `QA-REG-18` enseña a no leer como "un test roto".
//   Aplica igual a DOS AGENTES sobre la misma base. Van EN SERIE. Antes de
//   culpar al código por un rojo aquí, comprueba si algo más estaba tocando la
//   base. Deuda MVP2-2.
//
// CREDENCIALES (nunca en el repo — ver README.md)
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — las ÚNICAS 3
//   que este script necesita. Ya NO existen `RLS_TEST_KAM_*`/`RLS_TEST_VISITANTE_*`: esta corrida fabrica
//   y destruye sus propias cuentas kam/visitante cada vez (ver "CLIENTES Y FIXTURES EFÍMEROS" abajo) — nada
//   que guardar, nada que rotar, nada que quede vivo entre corridas.
//   Se leen de `process.env`, y si faltan, de `.env.local` (nunca se commitea).
//
// LÍMITES DECLARADOS (patrón P5: lo que este verificador NO caza)
//   · No prueba el rol `admin`: esta es una batería NEGATIVA (roles sin
//     privilegio); las rutas de escritura admin ya las cubre el resto de la
//     suite (route handlers con DB mockeada) y el smoke de B7 (QA-REG-10).
//   · No repite N1-N8 de `supabase/tests/rls_negative_tests.sql` (B1: productos,
//     productos_override, productos_metadata, familias, perfiles, cambios) —
//     ese archivo sigue siendo la fuente para esas 6 tablas.
//   · No prueba condiciones de carrera ni concurrencia.
//   · No valida tipo/tamaño de imagen (eso es `validarImagen` en la app, capa
//     distinta de la policy de Storage que sí se prueba aquí).
//   · El conteo de SELECT usa `count:'exact'` sobre TODA la tabla — para
//     storage se acota deliberadamente al prefijo `_qa_rls_negativas/` (bajo
//     nuestro control) para no depender de que existan imágenes reales.
//   · El SELECT de `clasificacion_v2` usa una lista de columnas EXPLÍCITA (no
//     `*`) — la migración `0012_b7b_hardening.sql` (P3, YA APLICADA) revocó
//     SELECT de `updated_by` para `authenticated`; verificado en vivo (sonda
//     P5, no supuesto): `select=*` como kam ahora responde 403 incluso en un
//     HEAD de solo-conteo. Ver el comentario junto a `SELECT_COLUMNAS` abajo.
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID, randomBytes } from 'node:crypto';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

// ------------------------------------------------------------
// Entorno: process.env primero, si no `.env.local` (nunca se imprime nada).
// ------------------------------------------------------------
function cargarEnvLocal() {
  const ruta = join(RAIZ, '.env.local');
  if (!existsSync(ruta)) return;
  const raw = readFileSync(ruta, 'utf8');
  for (const linea of raw.split(/\r?\n/)) {
    const t = linea.trim();
    if (!t || t.startsWith('#')) continue;
    const igual = t.indexOf('=');
    if (igual === -1) continue;
    const clave = t.slice(0, igual).trim();
    const valor = t.slice(igual + 1).trim();
    if (clave && !(clave in process.env)) process.env[clave] = valor;
  }
}
cargarEnvLocal();

// [INV-B7B cierre] Solo las 3 variables base de Supabase — ya NO se requieren
// (ni se leen en ninguna parte de este archivo) `RLS_TEST_KAM_*`/
// `RLS_TEST_VISITANTE_*`: esta corrida fabrica sus propias cuentas kam/
// visitante (ver `crearFixtures` más abajo), así que no hay nada permanente
// que configurar ni rotar.
const REQUERIDAS_BASE = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];

export function faltantes() {
  return REQUERIDAS_BASE.filter((k) => !process.env[k]);
}
export function hayCredenciales() {
  return faltantes().length === 0;
}
function leerEnvObj() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

// ------------------------------------------------------------
// MATRIZ DECLARADA (4 tablas × 4 verbos × 3 roles) + 6 RPC × 3 roles.
// Puramente declarativa — sin red — para que la prueba estructural
// (rls-negativas.test.ts) pueda afirmar "cuánto se declaró" sin credenciales.
//
// `esperado` por verbo de ESCRITURA (INSERT/UPDATE/DELETE) es documental: no
// gatea la aserción (ver cabecera del archivo). `denegado_ruidoso` marca el
// único verbo que SIEMPRE es ruidoso en Postgres/PostgREST cuando no hay
// policy aplicable (INSERT: no hay fila previa que "filtrar en silencio",
// así que el motor tiene que devolver un error). `denegado_silencioso`
// marca UPDATE/DELETE, que sin policy aplicable simplemente afectan 0 filas.
// Para storage.objects se usa `denegado` sin matiz de ruido: la Storage API
// es un servicio aparte (no PostgREST puro) y su forma de superficie se
// mide en vivo, no se asume.
// ------------------------------------------------------------
export const ROLES = ['anon', 'kam', 'visitante'];
export const VERBOS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

export const TABLAS = [
  {
    // 0008_bparche_clasificacion_v2.sql: SELECT authenticated USING(true);
    // INSERT/UPDATE admin-only; SIN policy de DELETE (EMPTY-NEVER-CLEARS).
    tabla: 'clasificacion_v2',
    verbos: {
      SELECT: { anon: 'denegado', kam: 'permitido', visitante: 'permitido' },
      INSERT: { anon: 'denegado_ruidoso', kam: 'denegado_ruidoso', visitante: 'denegado_ruidoso' },
      UPDATE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
      DELETE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
    },
  },
  {
    // 0008: mismo patrón exacto que clasificacion_v2.
    tabla: 'tecnologias',
    verbos: {
      SELECT: { anon: 'denegado', kam: 'permitido', visitante: 'permitido' },
      INSERT: { anon: 'denegado_ruidoso', kam: 'denegado_ruidoso', visitante: 'denegado_ruidoso' },
      UPDATE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
      DELETE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
    },
  },
  {
    // 0009_b6_pendientes.sql: SELECT SOLO admin (is_admin()); SIN policy de
    // INSERT/UPDATE/DELETE para NADIE vía REST — solo las RPC (SECURITY
    // DEFINER) escriben aquí. kam/visitante NO leen esto (B7A-9 lo documenta
    // para authenticated no-admin); anon tampoco (ninguna policy "TO anon").
    tabla: 'pendientes_datos',
    verbos: {
      SELECT: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' },
      INSERT: { anon: 'denegado_ruidoso', kam: 'denegado_ruidoso', visitante: 'denegado_ruidoso' },
      UPDATE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
      DELETE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
    },
  },
  {
    // 0018_mvp2_familia_alias.sql ([MVP-2] C): mismo patrón EXACTO que
    // `marca_alias` — SELECT para cualquier sesión (el ETL y la UI lo
    // necesitan), INSERT/UPDATE admin-only, SIN policy de DELETE.
    //
    // Es la tabla más sensible que añadió [MVP-2] y por eso entra aquí: una
    // fila suya es una REGLA GLOBAL Y PERMANENTE sobre cómo el ETL clasifica
    // el catálogo entero. Un `kam` que pudiera escribirla redirigiría familias
    // enteras en la siguiente ingesta.
    tabla: 'familia_alias',
    verbos: {
      SELECT: { anon: 'denegado', kam: 'permitido', visitante: 'permitido' },
      INSERT: { anon: 'denegado_ruidoso', kam: 'denegado_ruidoso', visitante: 'denegado_ruidoso' },
      UPDATE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
      DELETE: { anon: 'denegado_silencioso', kam: 'denegado_silencioso', visitante: 'denegado_silencioso' },
    },
  },
  {
    // 0007_b5_storage.sql: SELECT `TO public` (B7A-10, deliberado: cualquiera
    // con la URL puede leer imágenes de producto, incluso sin sesión).
    // INSERT/UPDATE/DELETE requieren authenticated + is_admin().
    tabla: 'storage.objects',
    verbos: {
      SELECT: { anon: 'permitido', kam: 'permitido', visitante: 'permitido' },
      INSERT: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' },
      UPDATE: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' },
      DELETE: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' },
    },
  },
];

// RPCs: is_admin/contar_pendientes están otorgadas a `authenticated` a
// propósito (B7A-9, documentado y ratificado — devuelven solo agregados).
// Las 4 restantes exigen is_admin() dentro del cuerpo (o, en el caso de
// ingest_snapshot, ni siquiera tienen EXECUTE otorgado a authenticated).
export const RPCS = [
  { rpc: 'is_admin', esperado: { anon: 'denegado', kam: 'permitido', visitante: 'permitido' } },
  { rpc: 'contar_pendientes', esperado: { anon: 'denegado', kam: 'permitido', visitante: 'permitido' } },
  { rpc: 'resolver_pendiente', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'aplicar_override', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'aplicar_clasificacion_v2', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'ingest_snapshot', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },

  // ------------------------------------------------------------
  // [MVP-2] · las 5 funciones nuevas. Cuatro tienen EXECUTE otorgado a
  // `authenticated` y su enforcement REAL es la guarda `is_admin()` como
  // primera sentencia del cuerpo — exactamente el mismo trato que
  // `aplicar_override`. Que el GRANT exista y la guarda esté adentro es
  // justo lo que hay que PROBAR, no suponer: sin estos casos, nadie había
  // comprobado que un KAM no puede escribir metadata ni fusionar familias,
  // que es lo que esos frentes afirman asegurar (condición 1 de la
  // auditoría del bloque).
  //
  // `sincronizar_pendientes_familia` es la excepción y por otro motivo: no
  // tiene guarda propia porque NI SIQUIERA tiene EXECUTE para
  // `authenticated` — mismo molde que `ingest_snapshot`, solo service_role.
  // ------------------------------------------------------------
  { rpc: 'aplicar_metadata', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'fusionar_familia', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'desfusionar_familia', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'resolver_familia_nueva', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
  { rpc: 'sincronizar_pendientes_familia', esperado: { anon: 'denegado', kam: 'denegado', visitante: 'denegado' } },
];

export function generarCasosTabla() {
  const out = [];
  for (const t of TABLAS) {
    for (const verbo of VERBOS) {
      for (const rol of ROLES) {
        const esperado = t.verbos[verbo]?.[rol];
        if (!esperado) throw new Error(`matriz incompleta: ${t.tabla}/${verbo}/${rol}`);
        out.push({ grupo: 'tabla', tabla: t.tabla, verbo, rol, esperado });
      }
    }
  }
  return out;
}

export function generarCasosRpc() {
  const out = [];
  for (const def of RPCS) {
    for (const rol of ROLES) {
      const esperado = def.esperado[rol];
      if (!esperado) throw new Error(`matriz incompleta: rpc ${def.rpc}/${rol}`);
      out.push({ grupo: 'rpc', rpc: def.rpc, rol, esperado });
    }
  }
  return out;
}

export function generarEstructura() {
  const casosTabla = generarCasosTabla();
  const casosRpc = generarCasosRpc();
  return {
    tablas: TABLAS.map((t) => t.tabla),
    verbos: VERBOS,
    roles: ROLES,
    rpcs: RPCS.map((r) => r.rpc),
    totalCasosTabla: casosTabla.length,
    totalCasosRpc: casosRpc.length,
    totalCasos: casosTabla.length + casosRpc.length,
  };
}

// ------------------------------------------------------------
// EVALUADORES PUROS (sin red). Son el corazón de la batería: la aserción
// real vive aquí, no en el status HTTP. Ver rls-negativas.test.ts para la
// demostración del mutante (P6) que prueba que SÍ tienen dientes.
// ------------------------------------------------------------
function igualdadProfunda(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** SELECT: compara lo que ve el rol contra lo que ve el testigo (service_role).
 *  `esperado` ∈ {'permitido','denegado'}. La trampa (P4): "denegado" con el
 *  testigo también en 0 NO se puede afirmar — sería indistinguible de una
 *  tabla vacía — así que se marca como fallo explícito, no como aprobado. */
export function evaluarLectura(resultado, esperado) {
  const { filasRol, filasWitness } = resultado;
  if (esperado === 'denegado') {
    if (filasWitness === 0) {
      return {
        ok: false,
        detalle:
          `NO SE PUDO CONTRASTAR: el testigo (service_role) también ve 0 filas — ` +
          `no puedo distinguir "denegado" de "tabla vacía" (filasRol=${filasRol}).`,
      };
    }
    return {
      ok: filasRol === 0,
      detalle: `filasRol=${filasRol} (esperado 0) · filasWitness=${filasWitness} (>0, confirma que NO es tabla vacía)`,
    };
  }
  // permitido
  return {
    ok: filasWitness > 0 && filasRol === filasWitness,
    detalle: `filasRol=${filasRol} · filasWitness=${filasWitness} (deben coincidir y ser > 0)`,
  };
}

/** INSERT/UPDATE/DELETE (tablas o storage.objects): el único invariante que
 *  importa es que el estado NO haya cambiado — los 3 roles bajo prueba
 *  nunca son admin, así que TODO intento de escritura debe ser un no-op.
 *  Deliberadamente no recibe `esperado`/status: ver cabecera del archivo. */
export function evaluarEscritura(resultado) {
  const { antes, despues, errorRol, statusRol } = resultado;
  const iguales = igualdadProfunda(antes, despues);
  return {
    ok: iguales,
    detalle: iguales
      ? `estado sin cambios (antes === después) · status=${statusRol ?? 'n/a'} · error=${errorRol ?? '(sin error: denegado en silencio)'}`
      : `¡FUGA! el estado CAMBIÓ — antes=${JSON.stringify(antes)} · después=${JSON.stringify(despues)} · status=${statusRol ?? 'n/a'} · error=${errorRol ?? '(sin error)'}`,
  };
}

/** RPC: a diferencia de las tablas, aquí SÍ importa si hubo error, porque
 *  las 6 RPC son SECURITY DEFINER con guarda is_admin() PRIMERO en el
 *  cuerpo (o sin EXECUTE otorgado, para ingest_snapshot) — cualquier
 *  excepción aborta la transacción completa de PostgREST: "hubo error" y
 *  "no se escribió nada" son la MISMA afirmación aquí (no dos aparte). */
export function evaluarRpc(resultado, esperado, rpc) {
  const { data, errorRol } = resultado;
  if (esperado === 'permitido') {
    if (errorRol) return { ok: false, detalle: `error inesperado: ${errorRol}` };
    if (rpc === 'is_admin' && data !== false) {
      return { ok: false, detalle: `is_admin() devolvió ${JSON.stringify(data)}, esperaba false (la cuenta QA no debe ser admin)` };
    }
    if (rpc === 'contar_pendientes' && (typeof data !== 'object' || data === null || !('abiertos' in data))) {
      return { ok: false, detalle: `forma inesperada de contar_pendientes(): ${JSON.stringify(data)}` };
    }
    return { ok: true, detalle: `sin error · data=${JSON.stringify(data)}` };
  }
  return {
    ok: errorRol !== null,
    detalle: errorRol ? `denegado correctamente: ${errorRol}` : 'NO HUBO ERROR — posible fuga de permisos',
  };
}

// ------------------------------------------------------------
// AUTOTEST DEL EVALUADOR: escenarios sintéticos, SIN red. Sirven para (a)
// probar en cualquier máquina, sin credenciales, que los evaluadores hacen
// lo que dicen, y (b) como vehículo de la demostración del mutante P6.
// ------------------------------------------------------------
export function correrAutotestEvaluador() {
  const escenarios = [
    {
      nombre: 'lectura_denegada_real (0 filas rol, testigo>0)',
      esperadoOk: true,
      veredicto: evaluarLectura({ filasRol: 0, filasWitness: 120 }, 'denegado'),
    },
    {
      nombre: 'TRAMPA-P4: lectura 0/0 (tabla vacía en el testigo) no debe pasar como "denegado" válido',
      esperadoOk: false,
      veredicto: evaluarLectura({ filasRol: 0, filasWitness: 0 }, 'denegado'),
    },
    {
      nombre: 'lectura_permitida_real (rol ve lo mismo que el testigo, >0)',
      esperadoOk: true,
      veredicto: evaluarLectura({ filasRol: 120, filasWitness: 120 }, 'permitido'),
    },
    {
      nombre: 'lectura_permitida_pero_recortada (rol ve MENOS que el testigo -> mal)',
      esperadoOk: false,
      veredicto: evaluarLectura({ filasRol: 10, filasWitness: 120 }, 'permitido'),
    },
    {
      nombre: 'escritura_denegada_silenciosa_real (antes === después)',
      esperadoOk: true,
      veredicto: evaluarEscritura({
        antes: { sku: 'C926', marca_v2: 'EAS' },
        despues: { sku: 'C926', marca_v2: 'EAS' },
        errorRol: null,
        statusRol: 200,
      }),
    },
    {
      nombre: 'ANTI-P4: DELETE que responde 200 vacío pero SÍ borró la fila (fuga simulada)',
      esperadoOk: false,
      veredicto: evaluarEscritura({
        antes: { sku: 'C926', marca_v2: 'EAS' },
        despues: null,
        errorRol: null,
        statusRol: 200,
      }),
    },
    {
      nombre: 'rpc_permitido_real (sin error)',
      esperadoOk: true,
      veredicto: evaluarRpc({ data: false, errorRol: null }, 'permitido', 'is_admin'),
    },
    {
      nombre: 'rpc_denegado_real (con error)',
      esperadoOk: true,
      veredicto: evaluarRpc({ data: null, errorRol: '42501 forbidden' }, 'denegado', 'aplicar_override'),
    },
    {
      nombre: 'rpc_debia_denegar_pero_no_hubo_error (fuga de permisos)',
      esperadoOk: false,
      veredicto: evaluarRpc({ data: { escritas: 1 }, errorRol: null }, 'denegado', 'aplicar_override'),
    },
  ];
  const evaluados = escenarios.map((e) => ({
    nombre: e.nombre,
    ok: e.veredicto.ok,
    esperadoOk: e.esperadoOk,
    correcto: e.veredicto.ok === e.esperadoOk,
    detalle: e.veredicto.detalle,
  }));
  return { escenarios: evaluados, todosCorrectos: evaluados.every((e) => e.correcto) };
}

// ------------------------------------------------------------
// CLIENTES Y FIXTURES EFÍMEROS (impuro — red real). Import dinámico del
// paquete ya instalado. Esta corrida NUNCA depende de una cuenta que ya
// exista: fabrica sus propias 2 cuentas (kam + visitante), guarda sus `id`
// tal como los devuelve el POST, y las destruye por esos MISMOS `id` antes
// de salir (ver "GUARDAS DE BORRADO — P9" en la cabecera del archivo).
// ------------------------------------------------------------
async function crearClienteBase(url, key) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// kam+visitante — jamás más que esto por corrida (tope de radio, P9 pt.4).
const MAX_CUENTAS_EFIMERAS = 2;
const SELLO_CORRIDA = Date.now();

/** Correo único por corrida Y por llamada (sello de tiempo + random):
 *  nunca colisiona entre corridas concurrentes ni deja un correo reutilizable.
 *  Dominio reservado (`example.test`): nunca resuelve ni recibe correo. */
function correoEfimero(etiquetaRol) {
  return `qa-rls-negativas-${etiquetaRol}-${SELLO_CORRIDA}-${randomUUID().slice(0, 8)}@example.test`;
}
/** Contraseña desechable: aleatoria y sin caracteres ambiguos. */
function passwordEfimera() {
  return randomBytes(24).toString('base64url').replace(/[0Oo1lI]/g, '').slice(0, 16);
}

const USUARIOS_POR_PAGINA_CONTEO = 200;
const USUARIOS_MAX_PAGINAS_CONTEO = 10;

/**
 * Cuenta TODOS los usuarios reales de `auth.users`, paginando `listUsers`
 * mientras la página venga llena (mismo patrón que `listarTodosUsuariosAuth`
 * de `src/services/usuarios.service.ts`). A propósito NUNCA usa `data.total`
 * de la respuesta: en `@supabase/auth-js` ese campo solo se rellena cuando
 * GoTrue manda un header `Link` de paginación — verificado en el código del
 * SDK y contra el proyecto real, ese header NO aparece con pocos usuarios
 * (con pocas cuentas), así que confiar en `.total` habría
 * devuelto **0 en silencio** justo en el caso que esta guarda necesita medir
 * con exactitud (P5: un supuesto sobre un sistema externo, probado antes de
 * codificarlo). Esta función SOLO usa `.length` por página — nunca
 * `.id`/`.email` de ninguna fila: un conteo no es una decisión de a quién
 * borrar (P9), así que ni siquiera necesita leer el contenido de las filas,
 * de cualquier cuenta real. */
async function contarUsuariosAuth(admin) {
  let total = 0;
  for (let page = 1; page <= USUARIOS_MAX_PAGINAS_CONTEO; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USUARIOS_POR_PAGINA_CONTEO });
    if (error) throw new Error(`auth.admin.listUsers (conteo): ${error.message}`);
    total += data.users.length;
    if (data.users.length < USUARIOS_POR_PAGINA_CONTEO) break;
  }
  return total;
}

const ESPERA_PERFIL_INTENTOS = 10;
const ESPERA_PERFIL_MS = 300;

/** Espera (reintentos cortos) a que `handle_new_user` cree `perfiles.id=<id>`
 *  — misma carrera y mismos números que `scripts/bootstrap-admin.mjs` — y
 *  luego lo promueve al rol pedido. `kam` nunca pasa por aquí: nace correcto
 *  por el DEFAULT del trigger (`0002_rls.sql:50`, rol='kam'). */
async function promoverRol(admin, id, rol) {
  let perfil = null;
  for (let intento = 1; intento <= ESPERA_PERFIL_INTENTOS && !perfil; intento++) {
    const { data, error } = await admin.from('perfiles').select('id, rol').eq('id', id).maybeSingle();
    if (error) throw new Error(`perfiles (esperando fila de ${id}): ${error.message}`);
    perfil = data;
    if (!perfil) await new Promise((resolve) => setTimeout(resolve, ESPERA_PERFIL_MS));
  }
  if (!perfil) {
    throw new Error(`el trigger handle_new_user no creó perfiles.id=${id} tras ${ESPERA_PERFIL_INTENTOS} intentos`);
  }
  if (perfil.rol === rol) return;
  const { error } = await admin.from('perfiles').update({ rol }).eq('id', id);
  if (error) throw new Error(`perfiles (rol='${rol}' para ${id}): ${error.message}`);
}

/**
 * Fabrica las 2 cuentas efímeras de esta corrida (kam + visitante) vía
 * Admin API — EXACTAMENTE el patrón estándar de limpieza segura:
 * crea, guarda el `id` que devuelve el POST, nunca vuelve a preguntarle al
 * servidor "cuál es". `kam` nace lista con el rol por defecto del trigger;
 * `visitante` se promueve después de esperar su fila de `perfiles`.
 *
 * Si algo falla A MEDIO CAMINO (p.ej. se creó kam pero falló visitante), el
 * error que se lanza lleva `idsParciales` con lo que SÍ se alcanzó a crear
 * — el llamador puede destruirlas igual; ninguna cuenta se pierde de vista
 * por culpa de un fallo a medias.
 */
async function crearFixtures(admin) {
  const idsCreados = [];
  try {
    const emailKam = correoEfimero('kam');
    const passwordKam = passwordEfimera();
    const { data: dataKam, error: errKam } = await admin.auth.admin.createUser({
      email: emailKam,
      password: passwordKam,
      email_confirm: true,
    });
    if (errKam) throw new Error(`auth.admin.createUser(kam efímero): ${errKam.message}`);
    const idKam = dataKam.user.id; // el ÚNICO identificador que se usará para borrar esta cuenta
    idsCreados.push(idKam);

    const emailVisitante = correoEfimero('visitante');
    const passwordVisitante = passwordEfimera();
    const { data: dataVisitante, error: errVisitante } = await admin.auth.admin.createUser({
      email: emailVisitante,
      password: passwordVisitante,
      email_confirm: true,
    });
    if (errVisitante) throw new Error(`auth.admin.createUser(visitante efímero): ${errVisitante.message}`);
    const idVisitante = dataVisitante.user.id;
    idsCreados.push(idVisitante);

    await promoverRol(admin, idVisitante, 'visitante');

    return {
      ids: Object.freeze([idKam, idVisitante]),
      kam: { id: idKam, email: emailKam, password: passwordKam },
      visitante: { id: idVisitante, email: emailVisitante, password: passwordVisitante },
    };
  } catch (e) {
    e.idsParciales = idsCreados;
    throw e;
  }
}

/** Crea `anon`/`kam`/`visitante` e inicia sesión real de kam/visitante con
 *  las credenciales que `crearFixtures` acaba de fabricar. `admin` se
 *  recibe ya creado (una sola instancia para toda la corrida). */
async function iniciarSesionClientes(admin, env, fixtures) {
  const anon = await crearClienteBase(env.url, env.anonKey);
  const kam = await crearClienteBase(env.url, env.anonKey);
  const visitante = await crearClienteBase(env.url, env.anonKey);

  const loginKam = await kam.auth.signInWithPassword({ email: fixtures.kam.email, password: fixtures.kam.password });
  if (loginKam.error || !loginKam.data.session) {
    throw new Error(`signInWithPassword(kam efímero) falló: ${loginKam.error?.message ?? 'sin sesión'}`);
  }
  const loginVisitante = await visitante.auth.signInWithPassword({
    email: fixtures.visitante.email,
    password: fixtures.visitante.password,
  });
  if (loginVisitante.error || !loginVisitante.data.session) {
    throw new Error(`signInWithPassword(visitante efímero) falló: ${loginVisitante.error?.message ?? 'sin sesión'}`);
  }
  return { admin, anon, kam, visitante };
}

/**
 * ============================================================
 * BORRADO POR IDENTIDAD, NUNCA POR ENUMERACIÓN (P9 — ver cabecera del archivo)
 * ============================================================
 * `ids` SIEMPRE es el arreglo (completo o parcial) que devolvió/lanzó
 * `crearFixtures` — un valor que este MISMO proceso construyó al crear las
 * cuentas. La firma de esta función ni siquiera acepta un correo, un
 * prefijo o un filtro: no hay parámetro por el que colarse un criterio de
 * búsqueda, así que es imposible por construcción reproducir aquí el
 * incidente de `GET admin/users?email=X` (que no filtra y devuelve TODO
 * el proyecto).
 *
 * Pasos: (1) tope de radio — aborta ANTES de borrar nada si `ids.length`
 * excede `MAX_CUENTAS_EFIMERAS`; (2) borra cada `id` con
 * `admin.auth.admin.deleteUser(id)` — que internamente llama
 * `DELETE .../admin/users/<uuid>`, nunca `admin/users?...`, y valida que
 * `id` sea un UUID antes de mandar la petición; (3) cuenta `auth.users`
 * DESPUÉS y exige que coincida con `antes`; (4) si algo no cuadra, re-
 * verifica CADA `id` con `getUserById` (nunca con una lista) y lanza un
 * error con los UUID EXACTOS que siguen vivos, para borrado manual.
 */
async function destruirFixturesConGuardas(admin, ids, antes) {
  if (ids.length > MAX_CUENTAS_EFIMERAS) {
    throw new Error(
      `[rls-negativas] TOPE DE RADIO EXCEDIDO: se iba a intentar borrar ${ids.length} cuenta(s) pero el ` +
        `máximo por corrida es ${MAX_CUENTAS_EFIMERAS}. ABORTADO SIN BORRAR NADA — revisa a mano: ${ids.join(', ')}`,
    );
  }

  const fallosDelete = [];
  for (const id of ids) {
    const { error } = await admin.auth.admin.deleteUser(id); // DELETE .../admin/users/<uuid> — por id exacto
    if (error) fallosDelete.push({ id, motivo: error.message });
  }

  const despues = await contarUsuariosAuth(admin);

  if (fallosDelete.length > 0 || despues !== antes) {
    const vivos = [];
    for (const id of ids) {
      const { data, error } = await admin.auth.admin.getUserById(id); // verifica id por id, nunca por lista/filtro
      if (!error && data?.user) vivos.push(id);
    }
    const detalleFallos = fallosDelete.length
      ? fallosDelete.map((f) => `${f.id} (${f.motivo})`).join('; ')
      : '(ningún DELETE reportó error; el descuadre viene de otra parte — investigar aparte)';
    throw new Error(
      `[rls-negativas] LA LIMPIEZA DE FIXTURES FALLÓ — auth.users esperado=${antes} encontrado=${despues}. ` +
        `UUID EXACTOS que siguen vivos (bórralos a mano): ` +
        `${vivos.length ? vivos.join(', ') : `(ninguno de los ${ids.length} ids de esta corrida sigue vivo)`}. ` +
        `Detalle de fallos de DELETE: ${detalleFallos}.`,
    );
  }

  return { antes, despues, idsBorrados: ids };
}

// ------------------------------------------------------------
// PREPARACIÓN DE LA CORRIDA EN VIVO (impuro, red SOLO si hay variables).
// Sustituye al antiguo `verificarLogin()` (que abría sesión con 2 cuentas
// FIJAS): ahora FABRICA las cuentas efímeras y luego abre su sesión. NUNCA
// lanza por una precondición CONOCIDA (variables base faltantes, o el
// entorno no responde al fabricar/loguear) — esos casos vuelven como
// `estado` para que `main()` decida omitir con aviso (exit 0). Si en el
// camino se alcanzó a crear alguna cuenta antes de fallar, su(s) `id` viaja
// en `idsCreados` para que el llamador la(s) destruya de todos modos —
// nunca queda una cuenta huérfana por culpa de un fallo a medias.
// ------------------------------------------------------------
export async function prepararEntorno() {
  const falt = faltantes();
  if (falt.length > 0) {
    return { estado: 'sin_variables', faltantes: falt, detalle: null, admin: null, clientes: null, antes: null, idsCreados: [] };
  }

  const env = leerEnvObj();
  const admin = await crearClienteBase(env.url, env.serviceRoleKey);

  let antes;
  try {
    antes = await contarUsuariosAuth(admin);
  } catch (e) {
    return { estado: 'entorno_no_disponible', faltantes: [], detalle: e.message, admin, clientes: null, antes: null, idsCreados: [] };
  }

  let fixtures;
  try {
    fixtures = await crearFixtures(admin);
  } catch (e) {
    return {
      estado: 'entorno_no_disponible',
      faltantes: [],
      detalle: e.message,
      admin,
      clientes: null,
      antes,
      idsCreados: Array.isArray(e.idsParciales) ? e.idsParciales : [],
    };
  }

  try {
    const clientes = await iniciarSesionClientes(admin, env, fixtures);
    return { estado: 'cuentas_vivas', faltantes: [], detalle: null, admin, clientes, antes, idsCreados: fixtures.ids };
  } catch (e) {
    return { estado: 'entorno_no_disponible', faltantes: [], detalle: e.message, admin, clientes: null, antes, idsCreados: fixtures.ids };
  }
}

/** D2 — cierra la sesión de los clientes que SÍ se autenticaron (kam/visitante;
 *  admin/anon nunca llaman signInWithPassword, no tienen sesión que cerrar)
 *  antes de que el proceso termine. `scope:'local'` a propósito: invalida solo
 *  el estado en memoria de ESTE cliente, sin un round-trip de red adicional
 *  que reintroduzca la misma ventana de handles-en-vuelo que esto arregla.
 *  Best-effort real: un error AL cerrar nunca se convierte en la razón de un
 *  mal cierre del proceso (por eso el try/catch se traga el error aquí, no
 *  más arriba). */
export async function cerrarClientes(clientes) {
  if (!clientes) return;
  for (const rol of ['kam', 'visitante']) {
    const cliente = clientes[rol];
    if (!cliente) continue;
    try {
      await cliente.auth.signOut({ scope: 'local' });
    } catch {
      // best-effort — ver doc-comment de la función.
    }
  }
}

// ------------------------------------------------------------
// EJECUTORES DE TABLA (impuro — red real).
// ------------------------------------------------------------
async function leerFilaPorColumna(cliente, tabla, columna, valor) {
  const { data, error } = await cliente.from(tabla).select('*').eq(columna, valor).maybeSingle();
  if (error) throw new Error(`no pude leer ${tabla}.${columna}=${valor} con el testigo: ${error.message}`);
  return data;
}

const _cache = {};

/** SKU en `productos` que TODAVÍA no tiene fila en `clasificacion_v2` — el
 *  único objetivo de INSERT que aísla la RLS de la FK: si usara un sku YA
 *  clasificado, un intento denegado y una violación de llave duplicada se
 *  verían IDÉNTICOS (antes === después por casualidad, no por RLS). */
async function skuSinClasificacionV2(admin) {
  if ('skuSinV2' in _cache) return _cache.skuSinV2;
  const { data: productos, error: e1 } = await admin.from('productos').select('sku').limit(1000);
  if (e1) throw new Error('productos: ' + e1.message);
  const { data: clasif, error: e2 } = await admin.from('clasificacion_v2').select('sku').limit(1000);
  if (e2) throw new Error('clasificacion_v2: ' + e2.message);
  const clasificados = new Set((clasif ?? []).map((r) => r.sku));
  const candidato = (productos ?? []).find((p) => !clasificados.has(p.sku));
  _cache.skuSinV2 = candidato?.sku ?? null;
  return _cache.skuSinV2;
}

async function skuConClasificacionV2(admin, preferido = 'C926') {
  if ('skuConV2' in _cache) return _cache.skuConV2;
  const pref = await leerFilaPorColumna(admin, 'clasificacion_v2', 'sku', preferido);
  if (pref) {
    _cache.skuConV2 = preferido;
    return preferido;
  }
  const { data, error } = await admin.from('clasificacion_v2').select('sku').limit(1);
  if (error) throw new Error('clasificacion_v2: ' + error.message);
  _cache.skuConV2 = data?.[0]?.sku ?? null;
  return _cache.skuConV2;
}

/**
 * ([MVP-2]) Alias objetivo para las sondas de UPDATE/DELETE sobre
 * `familia_alias`. La tabla nace VACÍA (0018 no hace seed), así que a
 * diferencia de `tecnologias` aquí no hay una fila preexistente que usar —
 * y sin blanco, esos dos casos quedarían `omitido`, que es exactamente el
 * agujero silencioso que esta batería existe para no tener.
 *
 * Se fabrica uno EFÍMERO con `service_role` y se destruye al final por su
 * `alias` EXACTO —el que esta corrida generó—, nunca por búsqueda ni por
 * prefijo (P9: borrar por identidad propia, no por enumeración).
 */
async function aliasFamiliaExistente(admin) {
  if ('aliasFamilia' in _cache) return _cache.aliasFamilia;
  const { data: fam } = await admin.from('familias').select('id').limit(1);
  const familiaId = fam?.[0]?.id ?? null;
  if (!familiaId) {
    _cache.aliasFamilia = null;
    return null;
  }
  const alias = `QA-RLS-NEGATIVAS-${randomUUID().slice(0, 8)}`;
  const { error } = await admin.from('familia_alias').insert({ alias, familia_id: familiaId });
  _cache.aliasFamilia = error ? null : alias;
  return _cache.aliasFamilia;
}

/** Borra el alias efímero por su valor EXACTO. Idempotente; se llama en el `finally` de la corrida. */
async function borrarAliasFamiliaEfimero(admin) {
  const alias = _cache.aliasFamilia;
  if (!alias) return;
  await admin.from('familia_alias').delete().eq('alias', alias);
  const { data } = await admin.from('familia_alias').select('alias').eq('alias', alias);
  if ((data ?? []).length > 0) {
    throw new Error(`[rls-negativas] no se pudo borrar el alias efímero "${alias}" — BÓRRALO A MANO`);
  }
}

async function nombreTecnologiaExistente(admin, preferido = 'EAS') {
  if ('nombreTec' in _cache) return _cache.nombreTec;
  const pref = await leerFilaPorColumna(admin, 'tecnologias', 'nombre', preferido);
  if (pref) {
    _cache.nombreTec = preferido;
    return preferido;
  }
  const { data, error } = await admin.from('tecnologias').select('nombre').limit(1);
  if (error) throw new Error('tecnologias: ' + error.message);
  _cache.nombreTec = data?.[0]?.nombre ?? null;
  return _cache.nombreTec;
}

async function idPendienteExistente(admin) {
  if ('idPendiente' in _cache) return _cache.idPendiente;
  const { data, error } = await admin.from('pendientes_datos').select('id').limit(1);
  if (error) throw new Error('pendientes_datos: ' + error.message);
  _cache.idPendiente = data?.[0]?.id ?? null;
  return _cache.idPendiente;
}

async function resolverObjetivoEscritura(admin, tabla, verbo) {
  if (tabla === 'clasificacion_v2') {
    if (verbo === 'INSERT') {
      const sku = await skuSinClasificacionV2(admin);
      return sku ? { columna: 'sku', valor: sku } : null;
    }
    const sku = await skuConClasificacionV2(admin);
    return sku ? { columna: 'sku', valor: sku } : null;
  }
  if (tabla === 'tecnologias') {
    if (verbo === 'INSERT') {
      return { columna: 'nombre', valor: `QA-RLS-NEGATIVAS-${randomUUID().slice(0, 8)}` };
    }
    const nombre = await nombreTecnologiaExistente(admin);
    return nombre ? { columna: 'nombre', valor: nombre } : null;
  }
  if (tabla === 'familia_alias') {
    if (verbo === 'INSERT') {
      return { columna: 'alias', valor: `QA-RLS-NEGATIVAS-${randomUUID().slice(0, 8)}` };
    }
    const alias = await aliasFamiliaExistente(admin);
    return alias ? { columna: 'alias', valor: alias } : null;
  }
  if (tabla === 'pendientes_datos') {
    if (verbo === 'INSERT') {
      return { columna: 'clave_natural', valor: `qa-rls-negativas-probe-${randomUUID().slice(0, 8)}` };
    }
    const id = await idPendienteExistente(admin);
    return id ? { columna: 'id', valor: id } : null;
  }
  throw new Error(`tabla desconocida: ${tabla}`);
}

function construirFilaInsert(tabla, valorPk) {
  const marca = 'QA-RLS-NEGATIVAS-PROBE';
  if (tabla === 'clasificacion_v2') return { sku: valorPk, tecnologia: marca, fuente_version: marca };
  // `familia_id` random: la RLS deniega ANTES de que la FK pueda evaluarse,
  // igual que el `sku` inexistente de `clasificacion_v2` arriba.
  if (tabla === 'familia_alias') return { alias: valorPk, familia_id: randomUUID() };
  if (tabla === 'tecnologias') return { nombre: valorPk };
  if (tabla === 'pendientes_datos') return { tipo: 'kam_desconocido', clave_natural: valorPk, payload: { probe: true } };
  throw new Error(`insert no definido para ${tabla}`);
}

function construirCambiosUpdate(tabla) {
  const marca = 'QA-RLS-NEGATIVAS-HACK';
  if (tabla === 'clasificacion_v2') return { marca_v2: marca };
  if (tabla === 'familia_alias') return { familia_id: randomUUID() };
  if (tabla === 'tecnologias') return { nombre: marca };
  if (tabla === 'pendientes_datos') return { estado: 'resuelto', resuelto_por: marca };
  throw new Error(`update no definido para ${tabla}`);
}

async function intentarEscrituraTabla(cliente, tabla, verbo, objetivo) {
  if (verbo === 'INSERT') {
    const { error, status } = await cliente.from(tabla).insert(construirFilaInsert(tabla, objetivo.valor));
    return { errorRol: error ? `${error.code ?? ''} ${error.message}`.trim() : null, statusRol: status ?? null };
  }
  if (verbo === 'UPDATE') {
    const { error, status } = await cliente
      .from(tabla)
      .update(construirCambiosUpdate(tabla))
      .eq(objetivo.columna, objetivo.valor);
    return { errorRol: error ? `${error.code ?? ''} ${error.message}`.trim() : null, statusRol: status ?? null };
  }
  if (verbo === 'DELETE') {
    const { error, status } = await cliente.from(tabla).delete().eq(objetivo.columna, objetivo.valor);
    return { errorRol: error ? `${error.code ?? ''} ${error.message}`.trim() : null, statusRol: status ?? null };
  }
  throw new Error(`verbo desconocido: ${verbo}`);
}

// [INV-B7B cierre] La migración `0012_b7b_hardening.sql` (P3, YA APLICADA)
// revocó SELECT de `clasificacion_v2.updated_by` para `authenticated`
// (cierra TAXO-10: esa columna guardaba el correo de quien tocó la fila).
// Consecuencia verificada EN VIVO (sonda P5 contra el proyecto real, no un
// supuesto): un `select=*` de kam/visitante contra `clasificacion_v2`
// responde AHORA 403 (`permission denied for column updated_by`) incluso en
// un HEAD de solo-conteo, porque Postgres resuelve privilegios de columna
// al planear la consulta sin importar si el body se descarta — y ESE es el
// comportamiento CORRECTO tras 0012 (documentado así en la propia migración,
// líneas ~561), no un defecto de esta batería. Por eso el SELECT de la
// tripleta usa, para esta tabla, la MISMA lista cerrada que ya usa la app
// real (0012_b7b_hardening.sql P3, líneas 524-528):
// `sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2,fuente_version` — el
// caso sigue probando "¿kam/visitante leen las filas que SÍ deben leer?"
// (permitido), sin tropezar con una columna que nunca debieron poder leer.
// `tecnologias`/`pendientes_datos` no tienen columnas revocadas: `'*'` sigue
// siendo correcto para ellas (sin cambio de comportamiento tras 0012).
const SELECT_COLUMNAS = {
  clasificacion_v2: 'sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2,fuente_version',
};
function columnasSelectDe(tabla) {
  return SELECT_COLUMNAS[tabla] ?? '*';
}

async function correrCasoTabla(clientes, caso) {
  if (caso.verbo === 'SELECT') {
    const cliente = clientes[caso.rol];
    const cols = columnasSelectDe(caso.tabla);
    const { count: filasRol, error: errRol } = await cliente.from(caso.tabla).select(cols, { count: 'exact', head: true });
    const { count: filasWitness, error: errWitness } = await clientes.admin
      .from(caso.tabla)
      .select(cols, { count: 'exact', head: true });
    if (errWitness) throw new Error(`testigo no pudo leer ${caso.tabla}: ${errWitness.message}`);
    const resultado = {
      filasRol: filasRol ?? 0,
      filasWitness: filasWitness ?? 0,
      errorRol: errRol ? `${errRol.code ?? ''} ${errRol.message}`.trim() : null,
    };
    return { ...caso, resultado, veredicto: evaluarLectura(resultado, caso.esperado) };
  }

  const objetivo = await resolverObjetivoEscritura(clientes.admin, caso.tabla, caso.verbo);
  if (!objetivo) {
    return { ...caso, omitido: true, motivoOmision: `no encontré una fila objetivo viva para ${caso.tabla}/${caso.verbo}` };
  }
  const antes = await leerFilaPorColumna(clientes.admin, caso.tabla, objetivo.columna, objetivo.valor);
  const intento = await intentarEscrituraTabla(clientes[caso.rol], caso.tabla, caso.verbo, objetivo);
  const despues = await leerFilaPorColumna(clientes.admin, caso.tabla, objetivo.columna, objetivo.valor);

  if (caso.verbo === 'INSERT' && antes === null && despues !== null) {
    // Fuga real: autosanación inmediata con el testigo (no dejar basura de la prueba).
    await clientes.admin.from(caso.tabla).delete().eq(objetivo.columna, objetivo.valor);
  }

  const resultado = { antes, despues, errorRol: intento.errorRol, statusRol: intento.statusRol, objetivo };
  return { ...caso, resultado, veredicto: evaluarEscritura(resultado) };
}

// ------------------------------------------------------------
// STORAGE (bucket producto-imagenes) — vía el cliente Storage (no PostgREST
// crudo: `storage.objects` no está expuesto por `/rest/v1/`; la Storage API
// es el camino real que la app usa, ver src/services/imagenes.service.ts).
// ------------------------------------------------------------
const BUCKET = 'producto-imagenes';
const PREFIJO_QA = '_qa_rls_negativas';
const RUTA_FIXTURE = `${PREFIJO_QA}/fixture.png`;
// El bucket restringe `allowed_mime_types` a image/png|jpeg|webp (0007_b5_storage.sql).
// La Storage API valida el CONTENT-TYPE declarado contra esa lista, no los magic
// bytes reales del contenido (esa validación es de la app, `validarImagen()`,
// y aquí se llama al cliente de Storage directo, sin pasar por /api/imagenes) —
// así que el contenido puede ser texto plano mientras el contentType declarado sea válido.
const CONTENT_TYPE_STORAGE = 'image/png';
const CONTENIDO_FIXTURE = Buffer.from('qa-rls-negativas-fixture-v1');
const CONTENIDO_HACKEO = Buffer.from('qa-rls-negativas-intento-de-sobreescritura');
const CONTENIDO_INSERT_PROBE = Buffer.from('qa-rls-negativas-insert-probe');

async function leerObjetoStorage(cliente, ruta) {
  const carpeta = ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) : '';
  const nombre = ruta.includes('/') ? ruta.slice(ruta.lastIndexOf('/') + 1) : ruta;
  const { data, error } = await cliente.storage.from(BUCKET).list(carpeta, { search: nombre, limit: 100 });
  if (error) throw new Error(`no pude listar storage "${ruta}" con el testigo: ${error.message}`);
  const encontrado = (data ?? []).find((o) => o.name === nombre);
  if (!encontrado) return null;
  const { data: blob, error: errDl } = await cliente.storage.from(BUCKET).download(ruta);
  if (errDl) throw new Error(`no pude descargar "${ruta}" con el testigo: ${errDl.message}`);
  const buf = Buffer.from(await blob.arrayBuffer());
  return { nombre: encontrado.name, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

async function contarPrefijoQa(cliente) {
  const { data, error } = await cliente.storage.from(BUCKET).list(PREFIJO_QA, { limit: 100 });
  if (error) throw new Error(`no pude listar ${PREFIJO_QA}: ${error.message}`);
  return (data ?? []).length;
}

async function subirFixture(admin) {
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(RUTA_FIXTURE, CONTENIDO_FIXTURE, { contentType: CONTENT_TYPE_STORAGE, upsert: true });
  if (error) throw new Error(`setup del fixture de storage falló: ${error.message}`);
}

async function limpiarPrefijoQa(admin) {
  const { data, error } = await admin.storage.from(BUCKET).list(PREFIJO_QA, { limit: 100 });
  if (error) return; // best-effort: si ni se puede listar, no hay nada que limpiar de forma confiable.
  const rutas = (data ?? []).map((o) => `${PREFIJO_QA}/${o.name}`);
  if (rutas.length) await admin.storage.from(BUCKET).remove(rutas);
}

async function correrCasoStorage(clientes, caso) {
  const cliente = clientes[caso.rol];

  if (caso.verbo === 'SELECT') {
    const filasRol = await contarPrefijoQa(cliente);
    const filasWitness = await contarPrefijoQa(clientes.admin);
    const resultado = { filasRol, filasWitness };
    return { ...caso, resultado, veredicto: evaluarLectura(resultado, caso.esperado) };
  }

  if (caso.verbo === 'INSERT') {
    const ruta = `${PREFIJO_QA}/insert-${caso.rol}.bin`;
    const antes = await leerObjetoStorage(clientes.admin, ruta);
    const { error, status } = await cliente.storage
      .from(BUCKET)
      .upload(ruta, CONTENIDO_INSERT_PROBE, { contentType: CONTENT_TYPE_STORAGE });
    const despues = await leerObjetoStorage(clientes.admin, ruta);
    if (antes === null && despues !== null) {
      await clientes.admin.storage.from(BUCKET).remove([ruta]); // autosanación
    }
    const resultado = { antes, despues, errorRol: error?.message ?? null, statusRol: error?.status ?? null };
    return { ...caso, resultado, veredicto: evaluarEscritura(resultado) };
  }

  // UPDATE/DELETE comparten el fixture — se restablece a estado conocido
  // ANTES de cada intento para que cada rol se pruebe de forma independiente
  // aunque un rol previo hubiera logrado alterarlo.
  await subirFixture(clientes.admin);

  if (caso.verbo === 'UPDATE') {
    const antes = await leerObjetoStorage(clientes.admin, RUTA_FIXTURE);
    const { error, status } = await cliente.storage
      .from(BUCKET)
      .update(RUTA_FIXTURE, CONTENIDO_HACKEO, { contentType: CONTENT_TYPE_STORAGE });
    const despues = await leerObjetoStorage(clientes.admin, RUTA_FIXTURE);
    const resultado = { antes, despues, errorRol: error?.message ?? null, statusRol: error?.status ?? null };
    return { ...caso, resultado, veredicto: evaluarEscritura(resultado) };
  }

  if (caso.verbo === 'DELETE') {
    const antes = await leerObjetoStorage(clientes.admin, RUTA_FIXTURE);
    const { error, status } = await cliente.storage.from(BUCKET).remove([RUTA_FIXTURE]);
    const despues = await leerObjetoStorage(clientes.admin, RUTA_FIXTURE); // estado REAL observado, antes de sanar
    if (antes !== null && despues === null) {
      await subirFixture(clientes.admin); // autosanación (no oculta la fuga: `resultado.despues` ya quedó capturado)
    }
    const resultado = { antes, despues, errorRol: error?.message ?? null, statusRol: error?.status ?? null };
    return { ...caso, resultado, veredicto: evaluarEscritura(resultado) };
  }

  throw new Error(`verbo desconocido: ${caso.verbo}`);
}

async function correrBateriaStorage(clientes, casos) {
  await limpiarPrefijoQa(clientes.admin);
  await subirFixture(clientes.admin);
  const resultados = [];
  for (const caso of casos) {
    resultados.push(await correrCasoStorage(clientes, caso));
  }
  await limpiarPrefijoQa(clientes.admin);
  return resultados;
}

// ------------------------------------------------------------
// RPC (impuro — red real). Argumentos deliberadamente "seguros": las 4 RPC
// mutantes chequean is_admin() como PRIMERA sentencia de su cuerpo (o, para
// ingest_snapshot, ni siquiera tienen EXECUTE otorgado a authenticated), así
// que un p_id/sku inexistente jamás llega a tocar una fila real — ver el
// razonamiento completo en el reporte de este bloque.
// ------------------------------------------------------------
const ARGS_RPC = {
  is_admin: () => ({}),
  contar_pendientes: () => ({}),
  resolver_pendiente: () => ({ p_id: randomUUID(), p_accion: 'confirmar' }),
  aplicar_override: () => ({ p_sku: 'QA-RLS-NEGATIVAS-NOPE', p_campo: 'descripcion', p_valor: 'x' }),
  aplicar_clasificacion_v2: () => ({ payload: { fuente_version: 'qa-rls-negativas', filas: [] } }),
  ingest_snapshot: () => ({ payload: { snapshot: { fuente: 'qa-rls-negativas' } } }),
  // [MVP-2] · argumentos INOFENSIVOS por construcción: las 4 con EXECUTE para
  // `authenticated` chequean `is_admin()` como PRIMERA sentencia de su cuerpo,
  // así que un sku/alias/id inexistente jamás llega a tocar una fila real; y
  // `sincronizar_pendientes_familia` ni siquiera tiene EXECUTE otorgado.
  aplicar_metadata: () => ({ p_sku: 'QA-RLS-NEGATIVAS-NOPE', p_campo: 'color', p_valor: null }),
  fusionar_familia: () => ({ p_alias: 'QA-RLS-NEGATIVAS-NOPE', p_destino: 'QA-RLS-NEGATIVAS-NOPE-2', p_skus_esperados: 0 }),
  desfusionar_familia: () => ({ p_alias: 'QA-RLS-NEGATIVAS-NOPE' }),
  resolver_familia_nueva: () => ({ p_id: randomUUID(), p_destino: 'QA-RLS-NEGATIVAS-NOPE', p_skus_esperados: 0 }),
  sincronizar_pendientes_familia: () => ({ p_snapshot: randomUUID(), p_familias: [] }),
};

async function correrCasoRpc(clientes, caso) {
  const cliente = clientes[caso.rol];
  const args = ARGS_RPC[caso.rpc]();
  const { data, error, status } = await cliente.rpc(caso.rpc, args);
  const resultado = {
    data,
    errorRol: error ? `${error.code ?? ''} ${error.message}`.trim() : null,
    statusRol: status ?? null,
  };
  return { ...caso, resultado, veredicto: evaluarRpc(resultado, caso.esperado, caso.rpc) };
}

// ------------------------------------------------------------
// ORQUESTADOR
// ------------------------------------------------------------
async function correrBateria(clientes, casosTabla, casosRpc) {
  const normales = casosTabla.filter((c) => c.tabla !== 'storage.objects');
  const storage = casosTabla.filter((c) => c.tabla === 'storage.objects');

  const resultados = [];
  for (const caso of normales) resultados.push(await correrCasoTabla(clientes, caso));
  resultados.push(...(await correrBateriaStorage(clientes, storage)));
  for (const caso of casosRpc) resultados.push(await correrCasoRpc(clientes, caso));
  return resultados;
}

function resumirResultados(resultados) {
  let ok = 0;
  let fallos = 0;
  let omitidos = 0;
  for (const r of resultados) {
    if (r.omitido) {
      omitidos++;
      continue;
    }
    if (r.veredicto?.ok) ok++;
    else fallos++;
  }
  return { total: resultados.length, ok, fallos, omitidos };
}

// ------------------------------------------------------------
// CLI
// ------------------------------------------------------------
/**
 * [GATE-B1 · G1-3b] Las banderas CONOCIDAS. Cualquier otra cosa es un error,
 * y esta lista existe para poder decirlo.
 *
 * 🔴 POR QUÉ, y no es teórico — pasó escribiendo este bloque: antes, un
 * argumento desconocido se IGNORABA en silencio. Quien tecleara `--ayuda`
 * —que no existe; la de verdad es `--help`— no obtenía ayuda ni un error:
 * caía al camino POR OMISIÓN, que es **la batería completa contra la base de
 * producción**, con sus dos cuentas y su fila de `familia_alias`.
 *
 * O sea que el camino que escribe era el que se alcanzaba POR ERRATA, y los
 * que no escriben exigían teclear su nombre exacto. Justo al revés de como
 * tiene que ser. Ahora una bandera desconocida sale por `exit 2` sin tocar
 * nada, y llegar a la batería es un acto sin ambigüedad.
 */
const BANDERAS_CONOCIDAS = new Set([
  '--json',
  '--check-credenciales',
  '--solo-estructura',
  '--autotest-evaluador',
  '--help',
  '-h',
]);

function parsearArgv(argv) {
  return {
    json: argv.includes('--json'),
    checkCredenciales: argv.includes('--check-credenciales'),
    soloEstructura: argv.includes('--solo-estructura'),
    autotestEvaluador: argv.includes('--autotest-evaluador'),
    ayuda: argv.includes('-h') || argv.includes('--help'),
    desconocidas: argv.filter((a) => !BANDERAS_CONOCIDAS.has(a)),
  };
}

function imprimirEstructura(e) {
  console.log('MATRIZ DECLARADA:');
  console.log(`  tablas (${e.tablas.length}): ${e.tablas.join(', ')}`);
  console.log(`  verbos (${e.verbos.length}): ${e.verbos.join(', ')}`);
  console.log(`  roles  (${e.roles.length}): ${e.roles.join(', ')}`);
  console.log(`  RPCs   (${e.rpcs.length}): ${e.rpcs.join(', ')}`);
  console.log(`  casos de tabla: ${e.totalCasosTabla} · casos de RPC: ${e.totalCasosRpc} · TOTAL: ${e.totalCasos}`);
}

function imprimirResultados(resultados) {
  console.log('');
  console.log('RESULTADOS:');
  for (const r of resultados) {
    const id = r.grupo === 'rpc' ? `RPC ${r.rpc}` : `${r.tabla} ${r.verbo}`;
    if (r.omitido) {
      console.log(`  OMITIDO  ${id} / ${r.rol} — ${r.motivoOmision}`);
      continue;
    }
    const estado = r.veredicto.ok ? 'OK   ' : 'FALLA';
    console.log(`  ${estado}  ${id} / ${r.rol}  (esperado: ${r.esperado})`);
    console.log(`           ${r.veredicto.detalle}`);
  }
}

function imprimirResumen(s) {
  console.log('');
  console.log(`RESUMEN: ${s.total} casos · ${s.ok} ok · ${s.fallos} fallo(s) · ${s.omitidos} omitido(s)`);
  console.log(s.fallos === 0 ? 'VERDE.' : 'ROJO. Revisa los FALLA de arriba.');
}

function imprimirAutotest(s) {
  console.log('AUTOTEST DEL EVALUADOR (escenarios sintéticos, sin red):');
  for (const e of s.escenarios) {
    console.log(`  ${e.correcto ? 'OK   ' : 'FALLA'}  ${e.nombre} → ok=${e.ok} (esperaba ${e.esperadoOk})`);
    console.log(`           ${e.detalle}`);
  }
  console.log(s.todosCorrectos ? 'VERDE.' : 'ROJO.');
}

function imprimirAyuda() {
  console.log('uso: node scripts/rls-negativas.mjs [opciones]');
  console.log('  (sin opciones)          corre la matriz completa contra Supabase real — fabrica y destruye');
  console.log('                          sus propias 2 cuentas efímeras (kam + visitante) en esta corrida');
  console.log('  --json                  salida JSON en vez de reporte legible');
  console.log('  --check-credenciales    sin red: ¿EXISTEN las 3 variables base de Supabase?');
  console.log('  --solo-estructura       solo declara la matriz (sin red)');
  console.log('  --autotest-evaluador    corre escenarios sintéticos del evaluador (sin red)');
}

// ------------------------------------------------------------
// [GATE-B1 · G1-3] LA LIMPIEZA, EXTRAÍDA — para que la puedan disparar DOS
// caminos: el `finally` de siempre y una señal.
//
// El residuo de una corrida interrumpida (unas cuentas y un alias, escritos en segundos)
// no es una corrida que fallara: es una que NO LLEGÓ a su `finally`. Node
// termina en `SIGINT`/`SIGTERM` sin ejecutar el `finally` de una función
// asíncrona, así que «limpia al final» era, en la práctica, «limpia a veces».
//
// IDEMPOTENTE por bandera, y hace falta: si la señal llega mientras la batería
// corre, el handler limpia y sale — pero si llega justo cuando el `finally` ya
// arrancó, los dos caminos se pisarían. Con la bandera, el segundo no hace
// nada en vez de intentar borrar lo ya borrado y reportar un fallo que no es.
//
// ⚠ LO QUE ESTO NO PUEDE ATRAPAR, dicho porque en esta máquina es lo habitual:
// `taskkill /F` (y `SIGKILL`) terminan el proceso SIN entregar señal — ningún
// manejador existe para ellos, en ningún lenguaje. Esto cierra el `Ctrl-C` y
// el cierre de terminal, no la muerte forzada. Un arnés que prometiera lo
// segundo estaría mintiendo.
// ------------------------------------------------------------
let limpiezaHecha = false;

async function limpiarFixtures({ admin, clientes, antes, idsCreados }) {
  if (limpiezaHecha) return;
  limpiezaHecha = true;

  // D2: los clientes se cierran SIEMPRE (incluso si `correrBateria` lanza) antes de que el
  // proceso pueda terminar — nunca dejamos un handle de red vivo colgando de la salida.
  await cerrarClientes(clientes);
  // P9: las 2 cuentas efímeras se destruyen SIEMPRE, pase lo que pase arriba. Un fallo AQUÍ es
  // más grave que cualquier FALLA de la matriz — pisa el exit code y queda como el mensaje final,
  // con los UUID exactos que un humano tendría que borrar a mano.
  // ([MVP-2]) El alias efímero de `familia_alias` va en su propio try para
  // que un fallo aquí NO impida destruir las cuentas, que es lo caro.
  try {
    await borrarAliasFamiliaEfimero(admin);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
  try {
    const limpieza = await destruirFixturesConGuardas(admin, idsCreados, antes);
    console.warn(
      `[rls-negativas] limpieza OK — auth.users antes=${limpieza.antes} después=${limpieza.despues} (coincide).`,
    );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}

/**
 * [GATE-B1 · G1-3] Ata `SIGINT`/`SIGTERM` a la misma limpieza. Devuelve una
 * función para soltarlos: registrados para siempre, el proceso no terminaría
 * solo después de una corrida normal.
 */
function atarSenales(estado) {
  const manejar = (senal) => async () => {
    console.warn(`\n[rls-negativas] ${senal} recibida — limpiando los fixtures antes de salir.`);
    try {
      await limpiarFixtures(estado);
    } catch (e) {
      console.error(`[rls-negativas] la limpieza por ${senal} falló: ${e.message}`);
    }
    // 130 es la convención para «terminado por SIGINT».
    process.exit(senal === 'SIGINT' ? 130 : 143);
  };
  const onInt = manejar('SIGINT');
  const onTerm = manejar('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  return () => {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  };
}

async function main() {
  const opts = parsearArgv(process.argv.slice(2));
  // [GATE-B1 · G1-3b] ANTES que nada, y antes de cualquier cliente: una
  // bandera desconocida NO puede caer al camino que escribe en producción.
  if (opts.desconocidas.length > 0) {
    console.error(`[rls-negativas] bandera(s) desconocida(s): ${opts.desconocidas.join(', ')}`);
    console.error('[rls-negativas] no se hace NADA. Usa --help para ver las que existen.');
    process.exitCode = 2;
    return;
  }
  if (opts.ayuda) {
    imprimirAyuda();
    process.exitCode = 0;
    return;
  }

  if (opts.checkCredenciales) {
    const salida = { hayCredenciales: hayCredenciales(), faltantes: faltantes() };
    if (opts.json) console.log(JSON.stringify(salida));
    else console.log(salida.hayCredenciales ? 'OK: hay credenciales.' : `FALTAN: ${salida.faltantes.join(', ')}`);
    process.exitCode = 0;
    return;
  }

  if (opts.autotestEvaluador) {
    const salida = correrAutotestEvaluador();
    if (opts.json) console.log(JSON.stringify(salida));
    else imprimirAutotest(salida);
    process.exitCode = salida.todosCorrectos ? 0 : 1;
    return;
  }

  const estructura = generarEstructura();

  if (opts.soloEstructura) {
    if (opts.json) console.log(JSON.stringify(estructura));
    else imprimirEstructura(estructura);
    process.exitCode = 0;
    return;
  }

  // A partir de aquí la ruta que intenta correr la matriz completa. `prepararEntorno()`
  // fabrica las cuentas efímeras y abre su sesión; NUNCA lanza por una precondición
  // conocida — devuelve uno de 3 estados (sin_variables / entorno_no_disponible / cuentas_vivas).
  const preparado = await prepararEntorno();

  if (preparado.estado === 'sin_variables') {
    console.warn(
      `[rls-negativas] SIN VARIABLES (${preparado.faltantes.join(', ')}) — se omite la batería en vivo contra ` +
        `Supabase (no se creó ninguna cuenta). La verificación estructural de la matriz SÍ corrió. Define las 3 ` +
        `variables base de Supabase en .env.local para correr en vivo.`,
    );
    const credenciales = { estado: preparado.estado, faltantes: preparado.faltantes, detalle: null };
    if (opts.json) console.log(JSON.stringify({ estructura, credenciales, resumen: null, resultados: null }));
    else imprimirEstructura(estructura);
    process.exitCode = 0;
    return;
  }

  if (preparado.estado === 'entorno_no_disponible') {
    // Puede haber cuentas PARCIALES ya creadas (p.ej. se creó kam pero falló visitante, o se
    // crearon ambas pero falló el login) — se destruyen igual, nunca quedan huérfanas.
    let limpiezaFallo = false;
    if (preparado.idsCreados.length > 0) {
      try {
        const limpieza = await destruirFixturesConGuardas(preparado.admin, preparado.idsCreados, preparado.antes);
        console.warn(
          `[rls-negativas] limpieza de ${preparado.idsCreados.length} cuenta(s) parcial(es) OK — auth.users ` +
            `antes=${limpieza.antes} después=${limpieza.despues}.`,
        );
      } catch (e) {
        console.error(e.message);
        limpiezaFallo = true;
      }
    }
    console.warn(
      `[rls-negativas] ENTORNO NO DISPONIBLE — se omite la batería en vivo (esto NO es un fallo de RLS): ` +
        `${preparado.detalle}. Revisa que SUPABASE_SERVICE_ROLE_KEY sea válida y el proyecto esté accesible.`,
    );
    const credenciales = { estado: preparado.estado, faltantes: [], detalle: preparado.detalle };
    if (opts.json) console.log(JSON.stringify({ estructura, credenciales, resumen: null, resultados: null }));
    else imprimirEstructura(estructura);
    process.exitCode = limpiezaFallo ? 2 : 0;
    return;
  }

  // estado === 'cuentas_vivas': la única rama que de verdad toca las 4 tablas + storage + RPC.
  const { admin, clientes, antes, idsCreados } = preparado;
  console.warn(`[rls-negativas] auth.users antes de fabricar fixtures: ${antes}`);
  // [GATE-B1 · G1-3] Desde AQUÍ y no antes: las señales se atan cuando ya hay
  // algo que limpiar. Atarlas al arrancar el proceso dejaría un manejador
  // apuntando a un `admin` que todavía no existe.
  const soltarSenales = atarSenales({ admin, clientes, antes, idsCreados });
  try {
    // ([MVP-2]) Siembra ANTES de la matriz. `familia_alias` nace vacía y el
    // caso SELECT no pasa por `objetivoDe`, así que sin esto el evaluador se
    // encontraba con "0 filas del rol Y 0 del testigo" y —correctamente— se
    // negaba a llamarlo denegado o permitido: no puede distinguir una
    // denegación de una tabla vacía. Es la TRAMPA-P4 que este archivo declara,
    // atrapándome a mí. La fila se destruye por su alias exacto en el finally.
    await aliasFamiliaExistente(admin);

    const casosTabla = generarCasosTabla();
    const casosRpc = generarCasosRpc();
    const resultados = await correrBateria(clientes, casosTabla, casosRpc);
    const resumen = resumirResultados(resultados);
    const credenciales = { estado: 'cuentas_vivas', faltantes: [], detalle: null };

    if (opts.json) {
      console.log(JSON.stringify({ estructura, credenciales, resumen, resultados }));
    } else {
      imprimirEstructura(estructura);
      imprimirResultados(resultados);
      imprimirResumen(resumen);
    }
    process.exitCode = resumen.fallos === 0 ? 0 : 1;
  } catch (e) {
    console.error(`[rls-negativas] la corrida de la batería falló de forma inesperada: ${e.message}`);
    process.exitCode = 2;
  } finally {
    // [GATE-B1 · G1-3] El cuerpo de esta limpieza vive ahora en
    // `limpiarFixtures`, para que la señal pueda disparar EXACTAMENTE lo mismo.
    // Es idempotente: si el manejador ya limpió, esto no hace nada.
    await limpiarFixtures({ admin, clientes, antes, idsCreados });
    // Y se sueltan las señales: registradas para siempre, el proceso no
    // terminaría solo tras una corrida normal.
    soltarSenales();
  }
}

// D2: nunca `process.exit()` — se deja `process.exitCode` puesto y el proceso termina cuando
// el bucle de eventos drena por su cuenta, ya con los clientes cerrados. `.catch()` es la única
// red de seguridad para un bug genuinamente inesperado (no una precondición conocida arriba).
main().catch((e) => {
  console.error('[rls-negativas] error inesperado: ' + (e && e.stack ? e.stack : String(e)));
  process.exitCode = 2;
});
