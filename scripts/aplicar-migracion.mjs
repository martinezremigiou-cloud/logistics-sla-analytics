// ============================================================
// [MVP-CIERRE] Aplicar UNA migración a Postgres, desde disco, todo-o-nada.
//
// POR QUÉ EXISTE, y es la razón que más pesa: hasta hoy este proyecto NO
// TENÍA forma propia de aplicar sus migraciones. El único camino era una
// sesión interactiva con el MCP de Supabase. Eso es un punto único de falla
// que nadie eligió — si esa sesión no está disponible, el repo no puede
// avanzar su propio esquema. Este script lo cierra.
//
// EL ARCHIVO NO PASA POR EL CONTEXTO DE NADIE. Se lee del disco y se manda
// tal cual. Ésa es la diferencia con transcribir 33 KB por un chat: lo que
// se aplica es, byte a byte, lo que está en el commit.
//
// TODO-O-NADA SIN `BEGIN` EXPLÍCITO. `client.query()` con varias sentencias
// las manda en un solo mensaje simple-query, y Postgres trata ese mensaje
// como UNA transacción implícita: si algo falla, se revierte completo. Por
// eso el .sql no lleva `BEGIN;`/`COMMIT;` propios — agregarlos rompería el
// bloque implícito en varios explícitos.
//
// LOS `RAISE NOTICE` VIAJAN POR UN CANAL APARTE. No vienen en el resultado
// del query: llegan por `client.on('notice', …)`. Sin ese listener, una
// migración cuya sección de verificación imprime sus cifras aplicaría en
// silencio y nos quedaríamos con "aplicó" y sin los números. Sería P15 otra
// vez — el instrumento gritando donde nadie lo oye.
//
// LA CADENA DE CONEXIÓN NUNCA SE IMPRIME. Se lee de `DATABASE_URL` (o
// `SUPABASE_DB_URL`). Si falta, se muere con un mensaje que no la incluye;
// si la conexión falla, se reporta el código del error, nunca la cadena —
// los mensajes de `pg` a veces la traen dentro.
//
// [S5 · REPRODUCIBILIDAD] REGISTRO EN EL LEDGER, DENTRO DE LA MISMA
// TRANSACCIÓN. Hasta antes de este cambio el script aplicaba pero nunca
// escribía en `supabase_migrations.schema_migrations` — por eso 0013-0015
// y 0017-0019 se registraron A MANO, y el ledger saltaba de 0015 a 0017.
// Convención medida contra la base real (no inventada — ver
// docs/decisions/0005-migration-guards-and-replay.md, y re-medida para
// S7-C, misma forma):
//   SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
//     version = TEXT, 14 dígitos `YYYYMMDDHHMMSS` (UTC), PRIMARY KEY.
//     name    = TEXT, el nombre del archivo SIN `.sql` (`00NN_slug`).
//     statements/rollback = TEXT[]; created_by/idempotency_key = TEXT.
// El INSERT viaja DENTRO del mismo mensaje simple-query que la migración:
// si el archivo NO trae `BEGIN;`/`COMMIT;` propios se concatena al final
// (mismo mensaje = misma transacción implícita); si SÍ los trae, se
// inserta justo ANTES del `COMMIT;` de nivel superior REAL (ver el punto
// del lexer, abajo). Si el registro falla, TODO el bloque se revierte: la
// migración no queda aplicada a medias. Con más de una transacción
// explícita (caso ya señalado como STOP&ASK del bloque) el registro
// automático NO se intenta: se avisa y se anota a mano.
//
// LA TABLA DEL LEDGER ES DE PLATAFORMA, NO DE UNA MIGRACIÓN DEL REPO
// (hallazgo de la auditoría adversarial). `supabase_migrations.schema_
// migrations` la provee Supabase, no ningún archivo bajo `supabase/
// migrations/`. Sin guarda, un REPLAY completo (0001→00NN) contra un
// Postgres recién provisto habría muerto en la PRIMERA migración con
// `42P01 relation "supabase_migrations.schema_migrations" does not exist`
// — y por la regla "si el registro falla, no se aplica nada", NINGUNA
// migración habría aplicado. `construirSqlConRegistro()` antepone
// `CREATE SCHEMA/TABLE IF NOT EXISTS` al registro: inerte contra
// producción (ya existe — verificado con BEGIN;…ROLLBACK; que las columnas
// antes/durante son idénticas) y suficiente para reconstruir el destino
// mínimo cuando no existe (verificado igual, contra un esquema-espejo
// ausente, nunca contra `supabase_migrations` real).
//
// IDEMPOTENTE POR `name`, no por `version`: como `version` se genera de
// nuevo (con la hora real) en cada corrida, dos corridas del MISMO archivo
// jamás colisionarían por PK — el candado real es un SELECT previo por
// `name` (la identidad estable del archivo), y corre SIEMPRE antes de
// aplicar, incluso cuando el registro automático no es posible (>1
// transacción explícita: es justo el caso que más necesita el candado, no
// menos). Si ya está registrado, el script NO reaplica el SQL. El INSERT
// final NO lleva `ON CONFLICT (version) DO NOTHING`: ese conflicto solo
// puede significar que DOS ARCHIVOS DISTINTOS cayeron en el mismo segundo
// UTC — silenciarlo perdería un registro real sin avisar; debe abortar
// TODO, ruidoso, como cualquier otro fallo del registro.
//
// SE VERIFICA EL EFECTO, NO SOLO EL MECANISMO (patrón P16 — la guarda que
// asume el efecto no es guarda). Tras aplicar, si se intentó registrar, se
// vuelve a leer el ledger con un SELECT y se falla RUIDOSO si la fila no
// aparece — la migración ya se aplicó (no hay vuelta atrás), pero el
// script no miente diciendo "registrada" si no lo verificó.
//
// [S5] VERIFICACIÓN ESTÁTICA OBLIGATORIA, incluso en `--dry`. Antes de
// tocar el archivo de cualquier otra forma se corre `verificar-migracion.mjs
// <archivo>` COMO SUBPROCESO (nunca `import`: aunque su `main()` ahora está
// guardado tras un check de punto-de-entrada — ver verificar-migracion.mjs
// — invocarlo como subproceso sigue siendo lo correcto aquí: es la MISMA
// forma en que lo correría un humano, y aísla su propio `process.exitCode`
// del de este script). El subproceso NO recibe `DATABASE_URL`/
// `SUPABASE_DB_URL`: es un analizador estático puro, no necesita
// credenciales y no debería heredarlas solo porque este proceso las tenga.
// Si encuentra hallazgos, se aborta: ni `--dry` ni la aplicación real
// siguen. Saltarlo requiere la bandera explícita y ruidosa
// `--saltar-verificacion`.
//
// [S7-C bis · P21] CONSECUENCIA MEDIDA DE LA REGLA 4 DEL VERIFICADOR, y hay
// que saberla ANTES de intentar un replay. Desde que existe esa regla,
// `verificar-migracion.mjs` marca como hallazgo la comparación literal
// contra `pg_get_function_identity_arguments()`, y hay exactamente DOS
// sitios en el repo — `0017:183` y `0020:729` — los dos en migraciones YA
// APLICADAS y congeladas por la regla de identidad byte a byte de P21 (los
// dos predicados salen true hoy, así que corregirlos no compra ningún
// invariante). Medido: `--dry` sobre esas dos ahora sale con exit 2, y
// sobre `0023` sale 0. En el día a día no bloquea nada (están aplicadas y
// el pre-chequeo por `name` las declararía YA REGISTRADAS)… pero un REPLAY
// completo 0001→0022 hecho POR ESTE SCRIPT se pararía en la 0017.
//
// ------------------------------------------------------------------
// PROCEDIMIENTO DE REPLAY 0001 → 0022  (ratificado)
// ------------------------------------------------------------------
// Se invoca este script UNA VEZ POR ARCHIVO, en orden numérico. Veinte de
// las veintidós corren normal, con el verificador vivo. DOS —y solo esas
// dos— llevan `--saltar-verificacion`:
//
//   supabase/migrations/0017_mvp2_metadata_por_rpc.sql
//     Motivo: `0017:183` compara literal contra
//     pg_get_function_identity_arguments(). El predicado sale TRUE, pero por
//     COINCIDENCIA: el autor escribió los nombres de los parámetros
//     ('p_sku text, p_campo text, p_valor text') y por eso la cadena casa.
//     Congelada por identidad byte a byte con lo aplicado (P21).
//
//   supabase/migrations/0020_repro_truncate_guarda_pendientes_creado_en.sql
//     Motivo: `0020:729` compara contra '' para una función SIN argumentos,
//     cuya lista de identidad ES la cadena vacía. Sale TRUE DE VERDAD: NO es
//     un bug latente, es un FALSO POSITIVO de la regla 4. NO LO ARREGLES.
//     Congelada por lo mismo desde que se aplicó.
//
// LA BANDERA VA POR INVOCACIÓN, NUNCA GLOBAL PARA TODA LA CORRIDA. No
// existe un modo "replay" que la encienda de una vez, y es deliberado: si
// se apagara el verificador para las veintidós, se apagaría también el
// chequeo de aridad de RAISE — el que atrapó el bug que tumbó la 0011
// entera (ver "POR QUE EXISTE" en verificar-migracion.mjs). El costo de
// dos banderas escritas a mano es exactamente el precio de no perder eso.
//
// Esto vive AQUÍ, y no solo en el texto de la bandera, porque quien intente
// un replay se estrella en la 0017 ANTES de tener motivo para leer la ayuda
// de un flag que no sabe que necesita.
//
// EL LEXER DE verificar-migracion.mjs, REUSADO PARA NO ADIVINAR CON REGEX
// (hallazgo de la auditoría adversarial). La versión anterior contaba
// BEGIN/COMMIT/ROLLBACK y ubicaba el punto de splice con
// `/^[ \t]*COMMIT[ \t]*;/im` sobre el texto CRUDO del archivo — una regex
// que no sabe de comentarios ni de dollar-quoting: un `COMMIT;` de EJEMPLO
// dentro de un `/* ... */` o de un cuerpo `$doc$...$doc$` (documentación
// embebida, nada raro en una migración) se contaba y se usaba igual que
// uno real. El registro quedaba spliceado DENTRO del comentario/cuerpo —
// texto inerte que nunca se ejecuta — mientras la migración sí aplicaba
// (por la transacción implícita) y el script imprimía "Ledger: registrada"
// sin que la fila existiera. `transaccionesDeNivelSuperior()`
// (verificar-migracion.mjs, exportada para este archivo) usa el MISMO
// lexer que ya distingue comentarios/cadenas/dollar-quoting para las
// reglas de RAISE: un cuerpo `$...$` se colapsa a un solo token opaco en
// vez de expandirse, así que nada de su interior puede colarse como
// "nivel superior". Casos adversariales reproducidos como fixtures
// permanentes: `fixtures-aplicador/9004_adversarial_comentario_bloque.sql`
// y `9005_adversarial_dollar_quoting.sql`.
//
// ============================================================
// [S7-C · punto 4 de la ratificación] EL NOMBRE DEL LEDGER SE DERIVA DEL
// ARCHIVO, SIEMPRE. NUNCA DE UN ARGUMENTO.
//
// El caso que lo origina: la fila 0015 del ledger dice
// `0015_mvp_cierre_universo_vacio` mientras el archivo en disco es
// `0015_mvp_cierre_autocierre_seguro.sql`. Registro manual histórico.
// Ratificación (docs/decisions/0005-migration-guards-and-replay.md): "gana el
// disco; se corrige la fila del ledger al nombre DEL ARCHIVO... y que el
// aplicar-migracion.mjs derive el nombre del archivo, nunca de un
// argumento — así no se puede repetir". El disco es canónico porque es lo
// que replica un replay; el ledger es el registro de lo que se corrió.
//
// Qué había ANTES de este cambio, medido, no supuesto: NO existía ninguna
// bandera ni argumento para pasar el nombre (`nombreLedger` ya salía de
// `basename(rutaAbs)`), así que no hubo que romper a ningún llamador —
// pero el parser de argumentos era permisivo: `args.find(a =>
// !a.startsWith('--'))` tomaba el PRIMER posicional y descartaba en
// silencio todo lo demás, y cualquier `--loquesea=...` desconocido se
// ignoraba sin decir nada. Sobre esa permisividad se podía volver a
// colgar un "nombre por argumento" sin que nada protestara. Ahora:
//   · `analizarArgumentos()` RECHAZA cualquier bandera no reconocida y
//     cualquier posicional de más, nombrándolo. No hay lugar donde un
//     nombre pueda entrar por la línea de comandos.
//   · `validarNombreDeArchivo()` exige que el basename cumpla el formato
//     del repo `NNNN_slug.sql` (4 dígitos, minúsculas/dígitos/guion bajo).
//     Si no cumple, ABORTA diciendo qué se esperaba y qué se recibió, y
//     NUNCA inventa un nombre "corregido".
//
// [S7-C] COTEJO LEDGER ↔ DISCO, ANTES DE APLICAR. Ésta es la comprobación
// que de verdad cierra el hueco, porque el pre-chequeo por `name` EXACTO
// nunca habría visto el caso 0015: busca `0015_mvp_cierre_autocierre_
// seguro`, no lo encuentra, y concluye "no registrada" — re-aplicando una
// migración ya aplicada CREYENDO que es la primera vez. `cotejarLedger
// ContraDisco()` compara los dos universos completos por NÚMERO de versión
// y aborta nombrando la fila y el archivo concretos:
//   · fila cuyo `name` no coincide con el archivo de su mismo número
//     → NOMBRE_DIVERGENTE (el caso 0015, exactamente).
//   · fila sin ningún archivo de ese número → FILA_SIN_ARCHIVO.
//   · archivo sin fila, con un número MENOR al máximo ya registrado
//     → ARCHIVO_SIN_FILA: no es "todavía no aplicada", es un hueco.
//   · dos archivos o dos filas con el mismo número, nombre de archivo que
//     no cumple el formato, fila con un `name` ajeno al repo → hallazgo.
// La salida legítima de "todavía no se ha aplicado, por eso no tiene
// fila" existe y es explícita: un archivo cuyo número es MAYOR al máximo
// del ledger se reporta como PENDIENTE y no aborta (hoy: 0020 y 0023).
// Con el ledger vacío o ausente (replay contra base limpia) TODO el disco
// es pendiente y el cotejo lo DICE — declara que en ese estado no puede
// detectar huecos, en vez de pasar en verde sin más (P19).
//
// [S7-C · punto 6b] ASERCIÓN DE `pg_default_acl` POR CORRIDA. Medido en
// producción (`SELECT pg_get_userbyid(defaclrole), nspname,
// defaclobjtype, defaclacl::text FROM pg_default_acl …`): el esquema
// `public` tiene DOS entradas para TABLAS, y las dos conceden `arwdDxtm`
// a `anon` y `authenticated` — la `D` es TRUNCATE:
//   dueño postgres        {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}
//   dueño supabase_admin  {postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}
// Consecuencia: toda tabla NUEVA de `public` nace con el hueco de TRUNCATE
// abierto sin que nadie lo pida. El `ALTER DEFAULT PRIVILEGES FOR ROLE
// postgres … REVOKE TRUNCATE` de la 0020 (otro frente) es la prevención;
// esto es la otra mitad, la que avisa si la prevención se cae:
//   · entrada de `postgres` con `D` para anon/authenticated/PUBLIC:
//       - si la migración que lo cierra (`0020_*`) YA está registrada en
//         el ledger (o es la que se acaba de aplicar) → HALLAZGO, ABORTA:
//         significa que la 0020 no quedó, alguien la revirtió, o la
//         plataforma restableció el default;
//       - si la 0020 todavía NO está registrada → AVISO RUIDOSO, no
//         aborta: sería negarse a aplicar la migración que arregla el
//         problema por el que uno se niega.
//   · entrada de `supabase_admin` con `D`: residual CONOCIDO y aceptado
//     por decisión de producto (no crea tablas nuestras, es configuración de
//     plataforma). Se INFORMA SIEMPRE, en cada corrida. No aborta. Pero
//     no puede quedar mudo: el punto entero de esta aserción es que nadie
//     aplique una migración sin ver ese hueco escrito en la salida.
//   · una TERCERA entrada (dueño distinto de postgres/supabase_admin) o
//     cualquier rol nuevo con `D` → HALLAZGO, ABORTA.
// El mensaje imprime el ACL **literal** que leyó, nunca una interpretación:
// si mañana Supabase cambia el formato, se ve crudo. Corre ANTES de
// aplicar (para no apilar DDL sobre un hueco que ya debía estar cerrado) y
// OTRA VEZ DESPUÉS (una migración que crea tablas acaba de heredar estos
// defaults; y si la que se aplicó era la 0020, aquí se comprueba su
// efecto real, no se asume — P16).
// Anti-vacuidad: si `pg_default_acl` viene VACÍA la aserción no puede
// afirmar nada, y eso se distingue leyendo si los roles `anon`/
// `authenticated` existen. Sí existen + tabla vacía = cambio real
// (HALLAZGO). No existen = no es un proyecto Supabase (aviso, replay en
// base limpia). Una guarda que se queda muda porque su consulta devolvió
// cero filas es justo lo que P19 prohíbe.
// ============================================================
//
// [S5] CHECKLIST DE IRREVERSIBILIDAD — responder ANTES de aplicar de
// verdad (no en `--dry`), y dejar la respuesta en el commit:
//   1. ¿Esta migración BORRA, CIERRA o MARCA COMO RESUELTO algo que no se
//      puede reconstruir con una re-ingesta ni con otra migración?
//   2. Si la respuesta es sí: ¿tiene un tope de radio de impacto
//      (`ROW_COUNT` esperado) que aborte si toca más filas de las
//      previstas? (patrón ya usado en 0010/0011/0012; ver
//      docs/engineering/failure-patterns.md P9)
//   3. ¿Decide qué cerrar/borrar/desactivar en función de la AUSENCIA de
//      datos (un snapshot vacío, un universo sin filas)? Si sí: necesita
//      su guarda de universo-no-vacío ANTES del cierre — ver
//      docs/engineering/failure-patterns.md P17.
// La 0013 habría contestado "sí" a la 1 y a la 3, y nadie se
// lo preguntó: cerró pendientes de forma irreversible ante un snapshot
// vacío (`ON CONFLICT DO NOTHING` y sin política de INSERT/UPDATE para
// reabrir). Documentarlo solo en la cabecera no basta — es el patrón P16
// (una guarda que solo vive en la intención de quien la escribió no es una
// guarda). Por eso una aplicación real EXIGE
// `--irreversibilidad="respuesta a la 1, y por qué"`; sin ella el script
// se niega ANTES de intentar conectarse. No es un prompt interactivo — el
// script corre con stdin vacío (automatización, un agente) y un prompt que
// espere respuesta lo colgaría — es una bandera explícita. La respuesta NO
// se queda solo en el historial del shell (eso era un sello de goma,
// hallazgo de la auditoría): se imprime en el propio log de la corrida Y
// viaja al ledger, en `created_by` — queda escrita en dos lugares
// duraderos, no solo en la memoria de quien tecleó el comando.
//
// DOS SHA256, ROTULADOS POR SEPARADO. `sha256` (siempre) es el del
// ARCHIVO tal cual está en disco/commit — sirve para contrastar contra
// git. `sha256 efectivo` (solo cuando hay registro que splicear) es el del
// TEXTO REALMENTE ENVIADO a Postgres, que ya incluye el INSERT del ledger
// y por lo tanto NO coincide con el del archivo — imprimir solo el primero
// mentiría sobre qué se ejecutó de verdad.
//
// PUNTO DE ENTRADA GUARDADO. Todo el flujo vive dentro de `main()` y solo
// corre cuando este archivo se EJECUTA directamente. Importarlo (lo hace
// scripts/aplicar-migracion.test.ts) no dispara nada: las guardas de S7-C
// son funciones PURAS exportadas y se prueban inyectándoles el estado que
// debe ponerlas en rojo, que es la única forma de saber que no son guardas
// vacías (P19). Mismo patrón que verificar-migracion.mjs.
//
// Uso:
//   node --env-file=.env.db scripts/aplicar-migracion.mjs supabase/migrations/00NN_x.sql --irreversibilidad="..."
//   DATABASE_URL=... node scripts/aplicar-migracion.mjs <archivo.sql> --irreversibilidad="..."
//   ... --dry                    → imprime qué haría (tamaño, hashes, destino, registro) sin conectarse
//   ... --saltar-verificacion    → NO corre verificar-migracion.mjs antes. SOLO para archivos
//                                  YA APLICADOS (hoy: 0017 y 0020, ver PROCEDIMIENTO DE REPLAY
//                                  arriba). Saltar la verificación NO salta solo la regla que te
//                                  estorba: salta TAMBIÉN el chequeo de aridad de RAISE, que es
//                                  el que atrapó el bug que tumbó la 0011 entera. Sobre un
//                                  archivo sin aplicar es exactamente la puerta que ese chequeo
//                                  existe para cerrar.
//   ... --irreversibilidad="..." → obligatorio fuera de --dry (ver checklist arriba)
// ============================================================
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { transaccionesDeNivelSuperior } from './verificar-migracion.mjs';

const require = createRequire(import.meta.url);
const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR_MIGRACIONES = resolve(AQUI, '..', 'supabase', 'migrations');
const DIR_MIGRACIONES_ROTULO = 'supabase/migrations';

// Formato del repo, medido contra los archivos que hay hoy en
// supabase/migrations: 4 dígitos + '_' + slug de minúsculas/dígitos
// separados por guion bajo + '.sql'. Ni mayúsculas, ni guiones, ni 3
// dígitos, ni `.SQL`.
const RE_ARCHIVO_MIGRACION = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
// El `name` del ledger es el mismo, sin la extensión (medido contra el ledger).
const RE_NOMBRE_LEDGER = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)$/;
const FORMATO_ESPERADO = 'NNNN_slug.sql  (4 dígitos, guion bajo, y un slug de minúsculas/dígitos separados por guion bajo; extensión .sql en minúsculas)';

// --- pg_default_acl, esquema public ---------------------------------
// Roles a los que la `D` (TRUNCATE) NO les corresponde nunca por defecto.
// '' es PUBLIC en la representación textual de un aclitem (`=arwdDxtm/…`).
const ROLES_SIN_TRUNCATE = new Set(['anon', 'authenticated', '']);
// Roles a los que la `D` sí les corresponde: el dueño y el rol con el que
// escribe el ETL (que además pasa por encima de RLS por diseño).
const ROLES_CON_TRUNCATE_ESPERADO = new Set(['postgres', 'service_role', 'supabase_admin']);
// Las DOS entradas que existen hoy para public/tablas. Una tercera es un
// hallazgo por definición (nadie la pidió).
const DUENOS_ESPERADOS_PUBLIC = new Set(['postgres', 'supabase_admin']);
// La migración que cierra el default de `postgres` (otro frente, S7-B).
// Se identifica por PREFIJO NUMÉRICO, no por nombre completo, para no
// romperse si el slug cambia. Si un día el REVOKE se mueve a otra
// migración, este prefijo se mueve con él — y mientras tanto la propia
// aserción avisa si el prefijo quedó caduco (ver CONSTANTE_CADUCA), para
// que no degrade en silencio a "solo aviso" para siempre.
const PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE = '0020';

function morir(mensaje) {
  console.error(`\n[aplicar-migracion] ${mensaje}\n`);
  process.exitCode = 2;
}

// Formato medido contra `supabase_migrations.schema_migrations` real (ver
// cabecera): TEXT de 14 dígitos `YYYYMMDDHHMMSS`, en UTC — el mismo formato
// que usa el propio Supabase CLI para sus timestamps de migración.
export function generarVersionLedger(ahora = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  return (
    String(ahora.getUTCFullYear()) +
    p2(ahora.getUTCMonth() + 1) +
    p2(ahora.getUTCDate()) +
    p2(ahora.getUTCHours()) +
    p2(ahora.getUTCMinutes()) +
    p2(ahora.getUTCSeconds())
  );
}

// ============================================================
// [S7-C] GUARDA A · argumentos: nada que no se reconozca, y ningún
// posicional de más. El nombre del ledger no puede entrar por aquí.
// ============================================================
export function analizarArgumentos(args) {
  const errores = [];
  let ruta = null;
  const posicionalesExtra = [];
  let dry = false;
  let saltarVerificacion = false;
  let irreversibilidad = '';

  for (const a of args) {
    if (a.startsWith('-')) {
      if (a === '--dry') { dry = true; continue; }
      if (a === '--saltar-verificacion') { saltarVerificacion = true; continue; }
      if (a.startsWith('--irreversibilidad=')) {
        irreversibilidad = a.slice('--irreversibilidad='.length).trim();
        continue;
      }
      errores.push(
        `argumento no reconocido: ${a}\n` +
          '    Banderas válidas: --dry · --saltar-verificacion · --irreversibilidad="..."\n' +
          '    El nombre para el ledger NO se puede pasar por argumento: se DERIVA del\n' +
          '    basename del archivo (ratificación S2, punto 4 — gana el disco).',
      );
      continue;
    }
    if (ruta === null) ruta = a;
    else posicionalesExtra.push(a);
  }

  if (posicionalesExtra.length > 0) {
    errores.push(
      `sobran argumentos posicionales: ${posicionalesExtra.join(', ')}\n` +
        '    Este script recibe UNA sola ruta .sql. Antes se descartaban en silencio,\n' +
        '    que es justo por donde se podía colar un "nombre" que le mintiera al ledger.',
    );
  }

  return { ok: errores.length === 0, errores, ruta, dry, saltarVerificacion, irreversibilidad };
}

// ============================================================
// [S7-C] GUARDA A (cont.) · el nombre del ledger sale del basename, y el
// basename tiene que cumplir el formato del repo. Nunca se "corrige".
// ============================================================
export function validarNombreDeArchivo(archivo) {
  const m = RE_ARCHIVO_MIGRACION.exec(archivo);
  if (!m) {
    return {
      ok: false,
      archivo,
      numero: null,
      nombreLedger: null,
      motivo:
        'el nombre del archivo no cumple el formato de migración de este repo.\n' +
        `    se esperaba : ${FORMATO_ESPERADO}\n` +
        `    se recibió  : ${archivo}\n` +
        '    El `name` del ledger se deriva de este basename y de nada más, así que un\n' +
        '    nombre que no cumple el formato no puede registrarse coherentemente. No se\n' +
        '    inventa un nombre "corregido": renombra el archivo.',
    };
  }
  return { ok: true, archivo, numero: m[1], nombreLedger: archivo.slice(0, -4), motivo: null };
}

// ============================================================
// [S7-C] GUARDA B · cotejo del ledger contra el disco.
//
// Función PURA a propósito: recibe las filas del ledger y la lista de
// archivos, y devuelve hallazgos/pendientes/líneas. Así se le puede
// inyectar el estado exacto que debe ponerla en ROJO (P19), incluido el
// estado de producción medido, sin tocar la base.
// ============================================================
export function cotejarLedgerContraDisco(entrada) {
  const {
    archivosDisco = [],
    filasLedger = [],
    ledgerDisponible = true,
    directorio = DIR_MIGRACIONES_ROTULO,
    // Por qué no hay ledger, cuando no lo hay. Son dos situaciones muy
    // distintas y decir la equivocada es mentir en la salida:
    //   'tabla-ausente' → la tabla de plataforma no existe (replay limpio)
    //   'sin-conexion'  → no se leyó porque --dry no se conecta
    motivoSinLedger = 'tabla-ausente',
  } = entrada ?? {};

  const hallazgos = [];
  const lineas = [];
  const pendientes = [];

  // --- lado disco ---
  const porNumeroDisco = new Map();
  for (const archivo of [...archivosDisco].sort()) {
    const v = validarNombreDeArchivo(archivo);
    if (!v.ok) {
      hallazgos.push({
        codigo: 'DISCO_NOMBRE_INVALIDO',
        mensaje:
          `archivo '${directorio}/${archivo}': ${v.motivo.split('\n')[0]}\n` +
          `      se esperaba: ${FORMATO_ESPERADO}\n` +
          '      Un archivo así nunca podría cotejarse con una fila del ledger.',
      });
      continue;
    }
    if (!porNumeroDisco.has(v.numero)) porNumeroDisco.set(v.numero, []);
    porNumeroDisco.get(v.numero).push(v);
  }
  for (const [numero, lista] of porNumeroDisco) {
    if (lista.length > 1) {
      hallazgos.push({
        codigo: 'DISCO_NUMERO_DUPLICADO',
        mensaje:
          `dos o más archivos comparten el número ${numero}: ${lista.map((x) => x.archivo).join(', ')}\n` +
          '      El número de versión es la identidad de la migración: duplicarlo hace\n' +
          '      imposible decidir cuál corresponde a la fila del ledger.',
      });
    }
  }

  // --- lado ledger ---
  const porNumeroLedger = new Map();
  if (ledgerDisponible) {
    for (const fila of filasLedger) {
      const nombre = fila?.name ?? null;
      if (typeof nombre !== 'string' || !RE_NOMBRE_LEDGER.test(nombre)) {
        hallazgos.push({
          codigo: 'LEDGER_FILA_AJENA',
          mensaje:
            `fila del ledger version=${fila?.version} name=${JSON.stringify(nombre)}\n` +
            '      no tiene la forma NNNN_slug que usan las migraciones de este repo, así que\n' +
            '      no puede corresponder a ningún archivo del disco. O la escribió otra\n' +
            '      herramienta (Studio, MCP, el CLI de Supabase) o es basura: revísala a mano.',
        });
        continue;
      }
      const numero = nombre.slice(0, 4);
      if (!porNumeroLedger.has(numero)) porNumeroLedger.set(numero, []);
      porNumeroLedger.get(numero).push({ version: fila.version, name: nombre });
    }
  }

  for (const [numero, filas] of porNumeroLedger) {
    if (filas.length > 1) {
      hallazgos.push({
        codigo: 'LEDGER_NUMERO_DUPLICADO',
        mensaje:
          `dos o más filas del ledger comparten el número ${numero}: ` +
          filas.map((f) => `version=${f.version} name='${f.name}'`).join(' · '),
      });
    }
    const enDisco = porNumeroDisco.get(numero) ?? [];
    for (const fila of filas) {
      if (enDisco.length === 0) {
        hallazgos.push({
          codigo: 'FILA_SIN_ARCHIVO',
          mensaje:
            `fila del ledger version=${fila.version} name='${fila.name}' — no existe NINGÚN archivo\n` +
            `      ${numero}_*.sql en ${directorio}/. El ledger afirma haber corrido algo que el\n` +
            '      disco no tiene: un replay desde este repo NO reproduce esa base.',
        });
        continue;
      }
      if (!enDisco.some((a) => a.nombreLedger === fila.name)) {
        hallazgos.push({
          codigo: 'NOMBRE_DIVERGENTE',
          mensaje:
            `el número ${numero} existe en los dos lados con nombres DISTINTOS:\n` +
            `        ledger : version=${fila.version}  name='${fila.name}'\n` +
            `        disco  : ${enDisco.map((a) => `${directorio}/${a.archivo}`).join(', ')}\n` +
            '      Gana el disco (ratificación S2, punto 4): corrige la FILA del ledger para que\n' +
            `      su name sea exactamente '${enDisco[0].nombreLedger}'. Mientras no se corrija, el\n` +
            '      pre-chequeo por name exacto no encuentra la fila y este script re-aplicaría la\n' +
            '      migración creyendo que es la primera vez.',
        });
      }
    }
  }

  const numerosLedger = [...porNumeroLedger.keys()].sort();
  const maxLedger = numerosLedger.length > 0 ? numerosLedger[numerosLedger.length - 1] : null;

  // --- archivos sin fila: pendiente legítimo vs hueco ---
  for (const numero of [...porNumeroDisco.keys()].sort()) {
    if (porNumeroLedger.has(numero)) continue;
    const archivo = porNumeroDisco.get(numero)[0];
    if (!ledgerDisponible || maxLedger === null || numero > maxLedger) {
      pendientes.push(archivo.archivo);
      continue;
    }
    hallazgos.push({
      codigo: 'ARCHIVO_SIN_FILA',
      mensaje:
        `archivo '${directorio}/${archivo.archivo}' sin fila en el ledger, y el ledger ya llegó\n` +
        `      al ${maxLedger}. No es "todavía no se ha aplicado": es un HUECO — o se aplicó y\n` +
        '      nunca se registró, o se escribió y se saltó. Un replay 0001→NNNN aplicaría este\n' +
        '      archivo y produciría una base distinta de producción.',
    });
  }

  // --- líneas de salida (siempre, aunque no haya hallazgos) ---
  lineas.push(`  disco   : ${archivosDisco.length} archivo(s) .sql en ${directorio}/`);
  if (!ledgerDisponible) {
    if (motivoSinLedger === 'sin-conexion') {
      lineas.push('  ledger  : NO leído (--dry no se conecta a nada). COTEJO PARCIAL: solo corrieron');
      lineas.push('            las reglas del lado del disco (formato de los nombres y números');
      lineas.push('            duplicados) — sin ledger no se puede detectar ni un nombre divergente');
      lineas.push('            ni un hueco. Eso se comprueba al aplicar de verdad.');
    } else {
      lineas.push('  ledger  : NO disponible (la tabla de plataforma supabase_migrations.schema_migrations');
      lineas.push('            no existe todavía). COTEJO PARCIAL: solo se revisó el lado del disco —');
      lineas.push('            sin ledger no se puede detectar ni un nombre divergente ni un hueco.');
    }
  } else if (filasLedger.length === 0) {
    lineas.push('  ledger  : 0 filas — base limpia / replay desde cero. Todo el disco cuenta como');
    lineas.push('            pendiente y, DECLARADO: con el ledger vacío este cotejo no puede');
    lineas.push('            detectar huecos ni nombres divergentes. No es un verde con contenido.');
  } else {
    lineas.push(`  ledger  : ${filasLedger.length} fila(s), máximo registrado ${maxLedger ?? '(ninguno con forma NNNN_slug)'}`);
  }
  if (pendientes.length > 0 && ledgerDisponible) {
    lineas.push(`  pendientes (sin fila porque todavía no se han aplicado — legítimo): ${pendientes.join(', ')}`);
  } else if (ledgerDisponible && filasLedger.length > 0) {
    lineas.push('  pendientes: ninguna — todo archivo del disco tiene su fila.');
  }

  return { hallazgos, pendientes, lineas, maxLedger, ledgerDisponible };
}

// ============================================================
// [S7-C] GUARDA C · pg_default_acl del esquema public.
// ============================================================
// Parseo del texto de un aclitem[]: `{grantee=privs/grantor,...}`.
// Fail-closed: si no se puede parsear, se dice, con el literal a la vista.
export function parsearAclitems(literal) {
  /** @type {{ok:boolean, items:Array<{grantee:string,privilegios:string,grantor:string}>, nulo:boolean, motivo:string|null}} */
  const vacio = { ok: true, items: [], nulo: false, motivo: null };
  if (literal === null || literal === undefined) return { ...vacio, nulo: true };
  const txt = String(literal).trim();
  if (!txt.startsWith('{') || !txt.endsWith('}')) {
    return { ...vacio, ok: false, motivo: 'no tiene la forma {…} de un aclitem[]' };
  }
  const cuerpo = txt.slice(1, -1);
  if (cuerpo.trim() === '') return { ...vacio };

  // Corte por comas de nivel superior, respetando comillas dobles (un rol
  // puede llevar comas si va entrecomillado).
  const partes = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < cuerpo.length; i++) {
    const c = cuerpo[i];
    if (c === '"') {
      if (enComillas && cuerpo[i + 1] === '"') { actual += '""'; i++; continue; }
      enComillas = !enComillas;
      actual += c;
      continue;
    }
    if (c === ',' && !enComillas) { partes.push(actual); actual = ''; continue; }
    actual += c;
  }
  partes.push(actual);
  if (enComillas) return { ...vacio, ok: false, motivo: 'comillas dobles sin cerrar' };

  const items = [];
  for (const parte of partes) {
    const m = /^(.*?)=([a-zA-Z*]*)\/(.*)$/.exec(parte);
    if (!m) return { ...vacio, ok: false, motivo: `no reconozco el aclitem ${JSON.stringify(parte)}` };
    const desentrecomillar = (s) =>
      s.startsWith('"') && s.endsWith('"') && s.length >= 2 ? s.slice(1, -1).replace(/""/g, '"') : s;
    items.push({ grantee: desentrecomillar(m[1]), privilegios: m[2], grantor: desentrecomillar(m[3]) });
  }
  return { ...vacio, items };
}

const rotuloRol = (g) => (g === '' ? 'PUBLIC' : g);

/**
 * @param {Array<{rol_dueno:string, esquema:string, tipo:string, acl_literal:string|null}>} filas
 *        TODAS las filas de pg_default_acl (sin filtrar), tal cual las devolvió Postgres.
 * @param {{correccionEnEfecto?:boolean, correccionConocida?:boolean, momento?:string,
 *          rolesSupabasePresentes?:boolean}} ctx
 */
export function evaluarDefaultAclPublic(filas, ctx = {}) {
  const {
    correccionEnEfecto = false,
    correccionConocida = true,
    momento = 'antes de aplicar',
    rolesSupabasePresentes = true,
  } = ctx;

  const hallazgos = [];
  const avisos = [];
  const lineas = [];
  const todas = Array.isArray(filas) ? filas : [];
  const dePublic = todas.filter((f) => f.esquema === 'public');
  const tablasPublic = dePublic.filter((f) => f.tipo === 'r');

  lineas.push(`  pg_default_acl · lectura ${momento} · ${todas.length} fila(s) en total, ${dePublic.length} del esquema public`);
  lineas.push('  ACL LITERAL, tal cual lo devolvió Postgres (sin interpretar):');
  if (dePublic.length === 0) {
    lineas.push('    (ninguna entrada para el esquema public)');
  }
  for (const f of dePublic) {
    lineas.push(`    dueño=${f.rol_dueno}  tipo=${f.tipo}  ${f.acl_literal === null ? 'NULL' : f.acl_literal}`);
  }

  // Anti-vacuidad: cero filas en TODA la tabla. Con los roles de Supabase
  // presentes eso es un cambio real; sin ellos, es que no es un proyecto
  // Supabase (replay contra Postgres limpio) y no hay nada que aseverar.
  if (todas.length === 0) {
    if (rolesSupabasePresentes) {
      hallazgos.push({
        codigo: 'ACL_SIN_FILAS',
        mensaje:
          'pg_default_acl está VACÍA pero los roles anon/authenticated SÍ existen. En un\n' +
          '      proyecto Supabase eso no pasa solo: o alguien borró los defaults, o esta\n' +
          '      lectura se rompió. La aserción no puede afirmar nada — fail-closed.',
      });
    } else {
      avisos.push({
        codigo: 'ACL_SIN_FILAS_SIN_SUPABASE',
        mensaje:
          'pg_default_acl vacía y sin roles anon/authenticated: esto no parece un proyecto\n' +
          '      Supabase (replay contra un Postgres limpio). No hay defaults que aseverar.',
      });
    }
    return { hallazgos, avisos, lineas, entradasEvaluadas: 0 };
  }

  if (!correccionConocida) {
    hallazgos.push({
      codigo: 'CONSTANTE_CADUCA',
      mensaje:
        `no hay ningún archivo ${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_*.sql en ${DIR_MIGRACIONES_ROTULO}/ ni ninguna fila\n` +
        `      ${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_* en el ledger. Esta aserción usa ese prefijo para decidir si el\n` +
        '      REVOKE del default ya debería estar en efecto; si el prefijo quedó obsoleto, la\n' +
        '      aserción degradaría a "solo aviso" PARA SIEMPRE sin que nadie se entere.\n' +
        '      Actualiza PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE en este script.',
    });
  }

  const duenosVistos = new Set();
  for (const f of tablasPublic) {
    duenosVistos.add(f.rol_dueno);
    const parseo = parsearAclitems(f.acl_literal);
    if (!parseo.ok) {
      hallazgos.push({
        codigo: 'ACL_ILEGIBLE',
        mensaje:
          `no pude leer el ACL de la entrada dueño=${f.rol_dueno} (public/tablas): ${parseo.motivo}.\n` +
          `      literal: ${f.acl_literal}\n` +
          '      Fail-closed: si el formato cambió, esta aserción no puede afirmar nada.',
      });
      continue;
    }
    if (!DUENOS_ESPERADOS_PUBLIC.has(f.rol_dueno)) {
      hallazgos.push({
        codigo: 'DEFAULT_ACL_ENTRADA_NUEVA',
        mensaje:
          `entrada de pg_default_acl para public/tablas con un dueño que hoy NO existe: '${f.rol_dueno}'.\n` +
          `      Se esperaban exactamente dos: ${[...DUENOS_ESPERADOS_PUBLIC].join(' y ')}.\n` +
          `      literal: ${f.acl_literal}`,
      });
    }

    const conTruncate = parseo.items.filter((it) => it.privilegios.includes('D'));
    const prohibidos = conTruncate.filter((it) => ROLES_SIN_TRUNCATE.has(it.grantee));
    const desconocidos = conTruncate.filter(
      (it) => !ROLES_SIN_TRUNCATE.has(it.grantee) && !ROLES_CON_TRUNCATE_ESPERADO.has(it.grantee),
    );

    for (const it of desconocidos) {
      hallazgos.push({
        codigo: 'ROL_NUEVO_CON_TRUNCATE',
        mensaje:
          `el default de '${f.rol_dueno}' para public/tablas concede D (TRUNCATE) a un rol que hoy\n` +
          `      no aparece: '${rotuloRol(it.grantee)}' (privilegios '${it.privilegios}').\n` +
          `      literal: ${f.acl_literal}`,
      });
    }

    if (prohibidos.length === 0) {
      lineas.push(
        `  veredicto dueño=${f.rol_dueno}: NINGÚN rol de lectura pública tiene D (TRUNCATE) por defecto.`,
      );
      continue;
    }

    const quienes = prohibidos.map((it) => rotuloRol(it.grantee)).join(', ');
    if (f.rol_dueno === 'postgres') {
      if (correccionEnEfecto) {
        hallazgos.push({
          codigo: 'TRUNCATE_POR_DEFECTO_ABIERTO',
          mensaje:
            `el default de 'postgres' para TABLAS de public SIGUE concediendo D (TRUNCATE) a: ${quienes}.\n` +
            `      La migración ${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_* (el ALTER DEFAULT PRIVILEGES … REVOKE TRUNCATE) ya\n` +
            '      cuenta como aplicada, así que esto solo puede significar que no quedó, que\n' +
            '      alguien la revirtió, o que la plataforma restableció el default.\n' +
            `      literal: ${f.acl_literal}`,
        });
      } else {
        avisos.push({
          codigo: 'TRUNCATE_POR_DEFECTO_PENDIENTE',
          mensaje:
            `HUECO ABIERTO: el default de 'postgres' para TABLAS de public concede D (TRUNCATE)\n` +
            `      a: ${quienes}. Toda tabla NUEVA de public nace con TRUNCATE abierto sin que nadie\n` +
            `      lo pida. La migración que lo cierra (${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_*) todavía NO cuenta como\n` +
            '      aplicada: por eso esto AVISA en vez de abortar (negarse aquí sería negarse a\n' +
            '      aplicar justo la migración que lo arregla). En cuanto quede registrada, este\n' +
            '      mismo estado ABORTA.\n' +
            `      literal: ${f.acl_literal}`,
        });
      }
    } else if (f.rol_dueno === 'supabase_admin') {
      avisos.push({
        codigo: 'RESIDUAL_CONOCIDO_SUPABASE_ADMIN',
        mensaje:
          `RESIDUAL CONOCIDO, por decisión de producto (ratificación S2, punto 6): el default de\n` +
          `      'supabase_admin' para TABLAS de public concede D (TRUNCATE) a: ${quienes}, y NO se\n` +
          '      toca — no crea tablas nuestras y es configuración de plataforma. Toda tabla que\n' +
          '      SÍ cree supabase_admin en public nace con ese hueco. No aborta; se informa en\n' +
          '      CADA corrida, para que nadie aplique una migración sin verlo escrito.\n' +
          `      literal: ${f.acl_literal}`,
      });
    }
  }

  for (const dueno of DUENOS_ESPERADOS_PUBLIC) {
    if (!duenosVistos.has(dueno)) {
      avisos.push({
        codigo: 'DEFAULT_ACL_ENTRADA_AUSENTE',
        mensaje:
          `ya no hay entrada de pg_default_acl para public/tablas con dueño '${dueno}'. Sin entrada,\n` +
          '      una tabla nueva nace solo con los privilegios de su dueño: es un estado MÁS\n' +
          '      cerrado, no menos, así que se informa y no aborta. Pero cambió algo: revísalo.',
      });
    }
  }

  // Fuera del alcance ratificado (solo `public`), pero medido y no
  // escondido: otros esquemas con el mismo hueco.
  const otrosConD = todas
    .filter((f) => f.esquema !== 'public' && f.tipo === 'r')
    .filter((f) => {
      const p = parsearAclitems(f.acl_literal);
      return p.ok && p.items.some((it) => it.privilegios.includes('D') && ROLES_SIN_TRUNCATE.has(it.grantee));
    });
  for (const f of otrosConD) {
    lineas.push(
      `  fuera de alcance (solo se asevera public): esquema '${f.esquema}', dueño=${f.rol_dueno}, tablas —` +
        ' concede D a un rol público. Informado, NO aseverado.',
    );
    lineas.push(`    literal: ${f.acl_literal}`);
  }

  return { hallazgos, avisos, lineas, entradasEvaluadas: tablasPublic.length };
}

// Construye el SQL final a enviar (migración + creación defensiva del
// ledger + registro, dentro de la MISMA transacción — ver cabecera).
// `posicionesCommit` viene de transaccionesDeNivelSuperior() — posiciones
// REALES de nivel superior, ya filtradas de comentarios/cadenas/dollar-
// quoting por el lexer de verificar-migracion.mjs (nunca una regex cruda,
// que SÍ splicearía dentro de un comentario/cuerpo $...$ — hallazgo de la
// auditoría adversarial).
//
// Devuelve `sqlFinal: null` cuando el archivo declara más de una
// transacción explícita (no hay un único punto "antes del COMMIT" que
// splicear sin adivinar) o cuando el conteo no cuadra con las posiciones
// recibidas (fail-closed: nunca splicear a ciegas).
//
// `createdBy`: la respuesta de --irreversibilidad viaja aquí dentro del
// ledger (columna `created_by`), no solo en el historial del shell.
export function construirSqlConRegistro(sql, nBegin, posicionesCommit, version, nombre, createdBy) {
  const esc = (s) => s.replace(/'/g, "''");
  const columnas = createdBy ? '(version, name, created_by)' : '(version, name)';
  const valores = createdBy
    ? `('${version}', '${esc(nombre)}', '${esc(createdBy)}')`
    : `('${version}', '${esc(nombre)}')`;
  const registro =
    '\n-- [S5] registro atómico en el ledger de migraciones (misma transacción).\n' +
    '-- supabase_migrations.schema_migrations es una tabla de PLATAFORMA: ninguna\n' +
    '-- migración de este repo la crea (Supabase la provee). El CREATE ... IF NOT\n' +
    '-- EXISTS de abajo reconstruye el destino mínimo para que el REPLAY de\n' +
    '-- 0001..00NN sea posible incluso contra un Postgres limpio — inerte contra\n' +
    '-- producción, donde ya existe (verificado con BEGIN;...ROLLBACK;).\n' +
    'CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n' +
    'CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (\n' +
    '  version text PRIMARY KEY,\n' +
    '  statements text[],\n' +
    '  name text,\n' +
    '  created_by text,\n' +
    '  idempotency_key text UNIQUE,\n' +
    '  rollback text[]\n' +
    ');\n' +
    // Sin ON CONFLICT: la idempotencia real es el pre-chequeo POR NOMBRE del
    // flujo principal, que corre SIEMPRE antes de llegar aquí. Un choque de
    // PK (`version`) a estas alturas solo puede significar dos ARCHIVOS
    // DISTINTOS cayendo en el mismo segundo UTC — debe abortar TODO, ruidoso
    // (hallazgo de la auditoría adversarial: `ON CONFLICT (version) DO
    // NOTHING` perdía ese registro real en silencio).
    `INSERT INTO supabase_migrations.schema_migrations ${columnas}\n` +
    `VALUES ${valores};\n`;

  if (nBegin === 0) {
    // Transacción implícita (simple-query): concatenar al final deja el
    // registro dentro del MISMO mensaje que Postgres trata como una sola
    // transacción — igual que el resto del archivo.
    return { sqlFinal: sql + registro, posicion: 'al final del archivo (transacción implícita)' };
  }
  if (nBegin === 1 && posicionesCommit.length === 1) {
    const pos = posicionesCommit[0];
    const linea = sql.slice(0, pos).split('\n').length;
    const sqlFinal = sql.slice(0, pos) + registro + '\n' + sql.slice(pos);
    return { sqlFinal, posicion: `antes del COMMIT; de la línea ${linea} (transacción explícita)` };
  }
  return { sqlFinal: null, posicion: null }; // >1 transacción, o conteo/posiciones inconsistentes: no se auto-registra
}

// Lista de archivos .sql del directorio de migraciones (lado disco del
// cotejo). Devuelve `null` si el directorio no existe.
function archivosDeMigraciones() {
  if (!existsSync(DIR_MIGRACIONES)) return null;
  return readdirSync(DIR_MIGRACIONES)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort();
}

// Exportadas: son el CONTRATO entre la consulta y las funciones puras que
// evalúan su resultado. Una guarda pura perfecta sobre una consulta que
// devuelve otra forma es una guarda que no comprueba nada — poder correr
// EXACTAMENTE estas queries fuera del script es lo que permite verificar
// esa unión sin escribir una sola fila.
export const SQL_LEDGER = 'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version';
export const SQL_DEFAULT_ACL = `SELECT pg_get_userbyid(d.defaclrole) AS rol_dueno,
       coalesce(n.nspname, '(sin esquema)') AS esquema,
       d.defaclobjtype::text AS tipo,
       d.defaclacl::text AS acl_literal
  FROM pg_default_acl d
  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
 ORDER BY 1, 2, 3`;
export const SQL_ROLES_SUPABASE =
  "SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')";

function imprimirHallazgos(titulo, lista) {
  console.log(`  ${titulo}`);
  for (const h of lista) console.log(`    · [${h.codigo}] ${h.mensaje}`);
}

// ============================================================
// Flujo principal
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const cli = analizarArgumentos(args);
  if (!cli.ok) {
    morir('Invocación inválida:\n  - ' + cli.errores.join('\n  - '));
    return;
  }
  const { dry: DRY, saltarVerificacion: SALTAR_VERIFICACION, irreversibilidad: IRREVERSIBILIDAD } = cli;
  const ruta = cli.ruta;

  if (!ruta) {
    morir('Falta la ruta del .sql.\n  Uso: node scripts/aplicar-migracion.mjs supabase/migrations/00NN_x.sql');
    return;
  }
  if (!existsSync(ruta)) {
    morir(`No existe el archivo: ${ruta}`);
    return;
  }

  const rutaAbs = resolve(ruta);
  const base = basename(rutaAbs);

  // --- [S7-C] GUARDA A: el nombre sale del archivo y cumple el formato ---
  const nombre = validarNombreDeArchivo(base);
  if (!nombre.ok) {
    morir(`Nombre de archivo rechazado:\n    ${nombre.motivo}`);
    return;
  }
  const nombreLedger = nombre.nombreLedger;

  const sql = readFileSync(rutaAbs, 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex').slice(0, 16);

  console.log('='.repeat(88));
  console.log('APLICAR MIGRACIÓN — una sola transacción, aborta al primer error');
  console.log('='.repeat(88));
  console.log(`  archivo : ${base}`);
  console.log(`  tamaño  : ${sql.length.toLocaleString('es-MX')} caracteres`);
  console.log(`  sha256  : ${hash}…   (del ARCHIVO, contrastable contra el commit)`);
  console.log(`  name    : ${nombreLedger}   (DERIVADO del basename; no hay argumento que lo cambie)`);

  // Obligatorio incluso en --dry (ver cabecera). Corre como SUBPROCESO,
  // SIN credenciales: un analizador estático puro no las necesita y no
  // debe heredarlas solo por comodidad.
  //
  // [REPRODUCIBILIDAD] Esto era una LISTA NEGRA:
  //     const env = { ...process.env };
  //     delete env.DATABASE_URL; delete env.SUPABASE_DB_URL;
  // Correcta hoy, y solo hoy. `--env-file=.env.db` carga en `process.env`
  // TODO lo que contenga el archivo: el día que alguien le agregue una
  // segunda variable con otro nombre —`PGPASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`,
  // lo que sea— el borrado de dos nombres no la ve y el secreto viaja al hijo
  // sin que nadie se entere. Es la MISMA forma de guarda que este bloque
  // viene corrigiendo toda la semana: pasa porque la lista está completa, no
  // porque el mecanismo sea correcto (P19 en su variante "coincidencia").
  //
  // Invertida a LISTA BLANCA: el hijo recibe SOLO lo que necesita para
  // arrancar Node en este sistema operativo, y cualquier variable nueva —de
  // este archivo o del entorno— queda fuera POR CONSTRUCCIÓN, sin que haya
  // que acordarse de nada.
  //
  // `NODE_OPTIONS` se excluye A PROPÓSITO aunque exista: permite inyectar
  // `--require`/`--import` en el hijo, y el hijo es justamente la puerta que
  // decide si esta migración se aplica.
  const VARIABLES_HEREDADAS = [
    'PATH', 'Path',                     // Windows expone 'Path'; POSIX, 'PATH'
    'SystemRoot', 'SYSTEMROOT', 'windir', // sin esto, spawn falla en Windows
    'COMSPEC', 'ComSpec', 'PATHEXT',
    'TEMP', 'TMP', 'TMPDIR',
    'HOME', 'USERPROFILE',
    'LANG', 'LC_ALL',
  ];
  // LO QUE ESTA LISTA NO CONTROLA (P16 — se declara, no se asume). Medido
  // en Windows: el hijo terminó viendo 16 claves, y SEIS no salen
  // de aquí — `HOMEDRIVE`, `HOMEPATH`, `LOGONSERVER`, `SYSTEMDRIVE`,
  // `USERDOMAIN`, `USERNAME`. Las inyecta el sistema operativo al crear el
  // proceso. Ninguna es un secreto, pero la afirmación honesta es "el hijo
  // recibe SOLO lo que pasamos NOSOTROS más lo que Windows agregue", no "el
  // hijo recibe exactamente esta lista".
  //
  // Prueba de vacuidad de esta guarda (P19), reproducible a mano: correr con
  //   SECRETO_DE_PRUEBA=x DATABASE_URL=y PGPASSWORD=z node scripts/aplicar-migracion.mjs <sql> --dry
  // y comprobar que ninguna de las tres llega al hijo. Con la lista NEGRA
  // anterior, `SECRETO_DE_PRUEBA` y `PGPASSWORD` sí llegaban.
  const envSinCredenciales = Object.create(null);
  for (const k of VARIABLES_HEREDADAS) {
    if (process.env[k] !== undefined) envSinCredenciales[k] = process.env[k];
  }

  if (SALTAR_VERIFICACION) {
    console.log('\n' + '!'.repeat(88));
    console.log('  VERIFICACIÓN ESTÁTICA SALTADA A PROPÓSITO (--saltar-verificacion)');
    console.log('  Nadie comprobó que los RAISE de este archivo compilen — es la MISMA clase');
    console.log('  de bug que tumbó la 0011 completa. Bandera explícita, a tu propio riesgo.');
    console.log('');
    console.log('  ESTA BANDERA ES SOLO PARA ARCHIVOS YA APLICADOS. Su único uso ratificado');
    console.log('  (decisión de producto, 2026-08-10) es el REPLAY 0001→0022, donde 0017 y 0020 la llevan por');
    console.log('  un falso positivo conocido de la regla de predicados de catálogo — ver el');
    console.log('  PROCEDIMIENTO DE REPLAY en la cabecera de este script, con el motivo de');
    console.log('  cada una. Va POR INVOCACIÓN: las otras 20 corren con el verificador vivo.');
    console.log('  Sobre un archivo SIN aplicar, esta bandera abre exactamente la puerta que');
    console.log('  el chequeo de aridad de RAISE existe para cerrar.');
    console.log('!'.repeat(88) + '\n');
  } else {
    console.log('\n--- verificando estáticamente (obligatorio antes de --dry y de aplicar) ---');
    const verificador = resolve(AQUI, 'verificar-migracion.mjs');
    const v = spawnSync(process.execPath, [verificador, rutaAbs], {
      encoding: 'utf8',
      windowsHide: true,
      env: envSinCredenciales,
    });
    const salidaV = `${v.stdout ?? ''}${v.stderr ?? ''}`.trimEnd();
    if (salidaV) console.log(salidaV);
    if (v.status !== 0) {
      morir(
        'verificar-migracion.mjs encontró hallazgos (arriba) — la migración NO se aplica.\n' +
          '  Corrígelos, o si son falsos positivos confirmados a mano, vuelve a correr con\n' +
          '  --saltar-verificacion (bandera explícita, a tu propio riesgo).',
      );
      return;
    }
  }

  // ¿El archivo declara su propia transacción, y dónde está su COMMIT; de
  // nivel superior REAL? Vía el lexer de verificar-migracion.mjs (nunca
  // una regex cruda — ver cabecera, hallazgo de la auditoría adversarial):
  // un `BEGIN;`/`COMMIT;` de EJEMPLO dentro de un comentario o de un cuerpo
  // $...$ nunca se cuenta ni se usa como splice.
  //
  // La transacción explícita es la forma PREFERIDA, y es la que siguen
  // 0004–0012: con `BEGIN; … COMMIT;` el todo-o-nada es propiedad del
  // ARCHIVO; sin ella depende del corredor — `psql -f` sin `-1` manda
  // sentencia por sentencia y no habría atomicidad ninguna.
  const { nBegin, nCommit, nRollback, posicionesCommit, roto } = transaccionesDeNivelSuperior(sql);

  if (roto) {
    morir(
      'No se puede analizar con confianza la estructura de transacciones de este\n' +
        '  archivo: el lexer encontró una cadena, comentario o cuerpo $...$ sin\n' +
        '  cerrar. No se adivina: corrige el archivo, o corre verificar-migracion.mjs\n' +
        '  sin --saltar-verificacion para ver el detalle exacto.',
    );
    return;
  }
  if (nRollback > 0) {
    morir(`El .sql contiene ${nRollback} ROLLBACK; a nivel de archivo — no es una migración aplicable.`);
    return;
  }
  if (nBegin !== nCommit) {
    morir(
      `Transacción DESBALANCEADA: ${nBegin} BEGIN; y ${nCommit} COMMIT; de nivel superior.\n` +
        '  Un BEGIN sin su COMMIT dejaría la transacción abierta y el resto del\n' +
        '  archivo aplicándose fuera de ella. Revisa el archivo.',
    );
    return;
  }
  if (nBegin === 1) {
    console.log('  txn     : EXPLÍCITA (BEGIN; … COMMIT;) — el todo-o-nada es del archivo');
  } else if (nBegin === 0) {
    console.log('  txn     : implícita — este script la garantiza (simple-query),');
    console.log('            pero `psql -f` SIN `-1` NO sería atómico con este archivo');
  } else {
    console.log(`  txn     : ${nBegin} transacciones explícitas — se aplican en secuencia`);
  }

  // Registro en el ledger (ver cabecera): se calcula aquí, una sola vez,
  // para que --dry y la aplicación real muestren/usen EXACTAMENTE lo mismo.
  const versionLedger = generarVersionLedger();
  const { sqlFinal, posicion } = construirSqlConRegistro(
    sql,
    nBegin,
    posicionesCommit,
    versionLedger,
    nombreLedger,
    IRREVERSIBILIDAD || null,
  );
  // Segundo sha256 (ver cabecera): el del TEXTO REALMENTE enviado a
  // Postgres cuando hay registro que splicear — nunca coincide con el del
  // archivo, así que imprimir solo aquel mentiría sobre qué se ejecutó.
  const hashEfectivo = sqlFinal ? createHash('sha256').update(sqlFinal).digest('hex').slice(0, 16) : null;

  // Lado disco del cotejo: se necesita en --dry (parcial) y al aplicar.
  const archivosDisco = archivosDeMigraciones();
  if (archivosDisco === null) {
    morir(
      `No existe el directorio ${DIR_MIGRACIONES_ROTULO}/ (buscado en ${DIR_MIGRACIONES}).\n` +
        '  Sin el lado del disco no hay nada que cotejar contra el ledger: fail-closed.',
    );
    return;
  }

  if (DRY) {
    console.log('\n  registro: supabase_migrations.schema_migrations');
    if (sqlFinal) {
      console.log(`    version  : ${versionLedger}   (se genera de nuevo, con la hora real, al aplicar)`);
      console.log(`    name     : ${nombreLedger}`);
      console.log(`    posición : ${posicion}`);
      console.log(`  sha256 efectivo : ${hashEfectivo}…   (del TEXTO REAL a enviar, incluye el registro)`);
    } else {
      console.log(`    NO se registra automáticamente (${nBegin} transacciones explícitas) — regístralo a mano.`);
    }

    // [S7-C] Cotejo PARCIAL: sin conexión no hay ledger que leer, así que
    // solo corren las reglas del lado del disco. Se dice, no se calla.
    console.log('\n--- cotejo ledger ↔ disco (PARCIAL: --dry no se conecta) ---');
    const cotejo = cotejarLedgerContraDisco({
      archivosDisco,
      filasLedger: [],
      ledgerDisponible: false,
      motivoSinLedger: 'sin-conexion',
    });
    for (const l of cotejo.lineas) console.log(l);
    if (cotejo.hallazgos.length > 0) {
      imprimirHallazgos('HALLAZGOS del lado del disco:', cotejo.hallazgos);
      morir('El cotejo disco/ledger encontró hallazgos (arriba) — ni --dry sigue adelante.');
      return;
    }

    console.log('\n--- aserción de pg_default_acl ---');
    console.log('  NO corre en --dry: exige leer pg_default_acl y --dry no se conecta a nada.');
    console.log('  En una aplicación real corre DOS veces (antes y después) e imprime el ACL literal.');

    console.log('\n  irreversibilidad: --dry no la exige. Para aplicar de verdad hace falta');
    console.log('    --irreversibilidad="respuesta a la pregunta 1 de la cabecera, y por qué"');
    console.log('    (viaja al log de la corrida Y al ledger, columna created_by).');
    console.log('\n  --dry: no se conecta ni se aplica nada.');
    process.exitCode = 0;
    return;
  }

  if (!IRREVERSIBILIDAD) {
    morir(
      'Falta responder el checklist de irreversibilidad antes de aplicar (no es opcional).\n' +
        '  Preguntas (con su porqué, en la cabecera del script):\n' +
        '    1. ¿Esta migración BORRA, CIERRA o MARCA COMO RESUELTO algo que no se\n' +
        '       puede reconstruir con una re-ingesta ni con otra migración?\n' +
        '    2. Si sí: ¿tiene un tope de radio de impacto (ROW_COUNT esperado) que\n' +
        '       aborte si toca más filas de las previstas?\n' +
        '    3. ¿Decide qué cerrar/borrar/desactivar en función de la AUSENCIA de\n' +
        '       datos? Si sí: necesita su guarda de universo-no-vacío antes del\n' +
        '       cierre (docs/engineering/failure-patterns.md P17).\n' +
        '  Responde con:\n' +
        '    --irreversibilidad="tu respuesta a la 1, y por qué"\n' +
        '  No es un prompt interactivo (el script corre con stdin vacío): es una\n' +
        '  bandera explícita — la respuesta viaja al log de esta corrida y al\n' +
        '  ledger (created_by), no solo al historial del shell.',
    );
    return;
  }

  console.log(`\n  irreversibilidad: ${IRREVERSIBILIDAD}`);
  if (hashEfectivo) console.log(`  sha256 efectivo  : ${hashEfectivo}…   (del TEXTO REAL a enviar)`);

  const conn = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!conn) {
    morir(
      'Falta la cadena de conexión.\n' +
        '  Defínela en DATABASE_URL (o SUPABASE_DB_URL), por ejemplo con\n' +
        '  `node --env-file=.env.db ...`. NO se imprime en ningún lado.',
    );
    return;
  }

  const { Client } = require('pg');

  // [REPRODUCIBILIDAD · auditoría de fuga de credenciales]
  // Este constructor PARSEA la cadena, así que puede lanzar ANTES de entrar
  // a cualquier try — y `await main()` (final del archivo) no tiene catch de
  // nivel superior, así que ese throw lo imprimiría Node, no este script.
  //
  // Medido, no razonado: con una cadena malformada lanza `TypeError`
  // `ERR_INVALID_URL`, y Node v24 imprime `input: '*****REDACTED*****'` —
  // NO filtra la contraseña (0 ocurrencias en la salida completa). Pero esa
  // redacción es una cortesía del RUNTIME, no una garantía de este archivo:
  // depende de la versión de Node que corra mañana. Se envuelve para que la
  // garantía sea NUESTRA. Regla de la cabecera: la cadena no se imprime en
  // NINGÚN camino, y eso no puede depender de un tercero.
  let client;
  try {
    client = new Client({ connectionString: conn });
  } catch (e) {
    morir(
      `La cadena de conexión no se pudo interpretar${e?.code ? ` [${e.code}]` : ''}. ` +
        'No se muestra aquí, a propósito.\n' +
        '  Formato esperado: postgres://usuario:clave@host:puerto/base',
    );
    return;
  }

  // Sin este listener, los RAISE NOTICE de la migración se pierden.
  const notices = [];
  client.on('notice', (n) => {
    const linea = (n.message ?? String(n)).trimEnd();
    notices.push(linea);
    console.log(`  NOTICE  ${linea}`);
  });

  // `pg` a veces incluye la cadena en el error de conexión: se reporta
  // solo el código y una nota, nunca `e.message` crudo.
  const errorSeguro = (e) => {
    const codigo = e?.code ? ` [${e.code}]` : '';
    const donde = e?.position ? ` (posición ${e.position})` : '';
    return { codigo, donde, detalle: e?.detail ?? null, hint: e?.hint ?? null };
  };

  console.log('\n--- conectando (la cadena no se imprime) ---');
  try {
    await client.connect();
  } catch (e) {
    const { codigo } = errorSeguro(e);
    morir(`No se pudo conectar${codigo}. Revisa la cadena de conexión (no se muestra aquí).`);
    client.end().catch(() => {});
    return;
  }

  const t0 = performance.now();
  try {
    // ---------- lectura única del ledger ----------
    // La MISMA lectura alimenta el cotejo (S7-C) y el pre-chequeo de
    // idempotencia por `name`: un solo SELECT, un solo instante, sin
    // riesgo de que los dos vean estados distintos.
    let filasLedger = [];
    let ledgerDisponible = true;
    try {
      const r = await client.query(SQL_LEDGER);
      filasLedger = r.rows;
    } catch (e) {
      if (e?.code === '42P01') {
        // El ledger (tabla de PLATAFORMA) aún no existe en este destino:
        // primer replay contra un Postgres limpio. No es un error —
        // "no registrada" es la lectura correcta, y sqlFinal (si lo hay)
        // la crea con IF NOT EXISTS antes de insertar.
        ledgerDisponible = false;
      } else {
        throw e;
      }
    }

    // ---------- [S7-C] GUARDA B: cotejo ledger ↔ disco ----------
    console.log('\n--- cotejo ledger ↔ disco (antes de aplicar) ---');
    const cotejo = cotejarLedgerContraDisco({ archivosDisco, filasLedger, ledgerDisponible });
    for (const l of cotejo.lineas) console.log(l);
    if (cotejo.hallazgos.length > 0) {
      imprimirHallazgos(`${cotejo.hallazgos.length} HALLAZGO(S) — el ledger y el disco NO describen la misma base:`, cotejo.hallazgos);
      morir(
        'Divergencia entre el ledger y el disco (arriba, con la fila y el archivo concretos).\n' +
          '  NO se aplica nada: sobre un ledger que no describe el disco, ni la idempotencia\n' +
          '  por nombre ni un replay significan nada. Corrige la divergencia primero.',
      );
      await client.end().catch(() => {});
      return;
    }
    console.log('  cotejo  : sin divergencias.');

    // ---------- [S7-C] GUARDA C: pg_default_acl, lectura previa ----------
    const acl = await client.query(SQL_DEFAULT_ACL);
    const rolesSb = await client.query(SQL_ROLES_SUPABASE);
    const rolesSupabasePresentes = rolesSb.rows.length > 0;
    const hay0020EnDisco = archivosDisco.some((a) => a.startsWith(`${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_`));
    const hay0020EnLedger = filasLedger.some(
      (f) => typeof f.name === 'string' && f.name.startsWith(`${PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE}_`),
    );

    const evaluarAcl = (filas, momento, correccionEnEfecto) => {
      const r = evaluarDefaultAclPublic(filas, {
        correccionEnEfecto,
        correccionConocida: hay0020EnDisco || hay0020EnLedger,
        momento,
        rolesSupabasePresentes,
      });
      for (const l of r.lineas) console.log(l);
      for (const a of r.avisos) console.log(`  AVISO [${a.codigo}] ${a.mensaje}`);
      if (r.hallazgos.length > 0) imprimirHallazgos(`${r.hallazgos.length} HALLAZGO(S) en pg_default_acl:`, r.hallazgos);
      return r;
    };

    console.log('\n--- aserción de pg_default_acl (antes de aplicar) ---');
    const aclAntes = evaluarAcl(acl.rows, 'antes de aplicar', hay0020EnLedger);
    if (aclAntes.hallazgos.length > 0) {
      morir(
        'La aserción de pg_default_acl encontró hallazgos (arriba, con el ACL literal).\n' +
          '  NO se aplica nada: no se apila DDL nueva sobre un default que ya debería\n' +
          '  estar cerrado — cada tabla que se creara heredaría el hueco.',
      );
      await client.end().catch(() => {});
      return;
    }

    // ---------- idempotencia por `name` ----------
    const filaPrevia = filasLedger.find((f) => f.name === nombreLedger);
    if (filaPrevia) {
      console.log(`\n  YA REGISTRADA: name='${nombreLedger}' ya existe en el ledger (version=${filaPrevia.version}).`);
      console.log('  Idempotente: no se reaplica el SQL. Nada más que hacer.');
      process.exitCode = 0;
      await client.end().catch(() => {});
      return;
    }

    console.log('\n--- aplicando ---\n');
    await client.query(sqlFinal ?? sql);
    const ms = performance.now() - t0;
    console.log(`\n${'='.repeat(88)}`);
    console.log(`APLICADA. ${notices.length} NOTICE · ${ms.toFixed(0)} ms · transacción confirmada.`);

    if (sqlFinal) {
      // Se VERIFICA el efecto, no se asume (patrón P16): un SELECT
      // posterior confirma que la fila de verdad quedó ahí. Si el
      // splice hubiera caído dentro de un comentario/cuerpo $...$
      // (no debería, ver cabecera), esto es lo que lo delataría en
      // vez de reportar "registrada" sobre una fila que no existe.
      const post = await client.query(
        'SELECT version FROM supabase_migrations.schema_migrations WHERE name = $1',
        [nombreLedger],
      );
      if (post.rows.length === 0) {
        console.error('!'.repeat(88));
        console.error('LA MIGRACIÓN SE APLICÓ (no hay vuelta atrás) PERO EL REGISTRO NO APARECE');
        console.error(`EN EL LEDGER para name='${nombreLedger}'. Regístrala a mano y revisa por qué`);
        console.error('el INSERT no surtió efecto (¿cayó dentro de un comentario o $...$? ver cabecera).');
        console.error('!'.repeat(88));
        process.exitCode = 1;
      } else {
        console.log(
          `Ledger: registrada version=${post.rows[0].version} name=${nombreLedger} ` +
            '(verificado con SELECT posterior, no solo asumido).',
        );
        process.exitCode = 0;
      }
    } else {
      console.log(
        `Ledger: NO registrada automáticamente (${nBegin} transacciones explícitas) — regístrala a mano.`,
      );
      console.log('        (el pre-chequeo por nombre SÍ corrió: no estaba registrada antes de este apply)');
      process.exitCode = 0;
    }

    // ---------- [S7-C] GUARDA C otra vez: el efecto, no el mecanismo ----------
    // Una migración que acaba de CREAR tablas heredó estos defaults; y si
    // la que se aplicó era la que cierra el hueco, aquí se comprueba que
    // de verdad quedó cerrado (P16: no se asume).
    console.log('\n--- aserción de pg_default_acl (DESPUÉS de aplicar) ---');
    const aclDespues2 = await client.query(SQL_DEFAULT_ACL);
    const eraLaCorreccion = nombre.numero === PREFIJO_MIGRACION_QUE_CIERRA_TRUNCATE;
    const aclDespues = evaluarAcl(aclDespues2.rows, 'después de aplicar', hay0020EnLedger || eraLaCorreccion);
    if (aclDespues.hallazgos.length > 0) {
      console.error('!'.repeat(88));
      console.error('LA MIGRACIÓN YA SE APLICÓ, pero la aserción de pg_default_acl quedó en ROJO');
      console.error('(hallazgos arriba, con el ACL literal). No hay vuelta atrás sobre lo aplicado:');
      console.error('revisa el default y ciérralo antes de crear una sola tabla más.');
      console.error('!'.repeat(88));
      process.exitCode = 1;
    }
    console.log('='.repeat(88));
  } catch (e) {
    const { codigo, donde, detalle, hint } = errorSeguro(e);
    const ms = performance.now() - t0;
    console.error(`\n${'='.repeat(88)}`);
    console.error(`FALLÓ${codigo}${donde} tras ${ms.toFixed(0)} ms — LA TRANSACCIÓN SE REVIRTIÓ COMPLETA.`);
    console.error('La base quedó exactamente como estaba: no hay nada que limpiar.');
    // El mensaje de un error de SQL (a diferencia del de conexión) es
    // el diagnóstico y no trae la cadena: se muestra.
    console.error(`\nmensaje: ${e?.message ?? '(sin mensaje)'}`);
    if (detalle) console.error(`detalle: ${detalle}`);
    if (hint) console.error(`hint:    ${hint}`);
    console.error('='.repeat(88));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

// Guarda de punto de entrada: `main()` SOLO corre cuando este archivo se
// EJECUTA directamente. Importarlo (aplicar-migracion.test.ts lo hace para
// probar las guardas puras con estados inyectados) no dispara nada.
const ES_PUNTO_DE_ENTRADA =
  process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (ES_PUNTO_DE_ENTRADA) {
  await main();
}
// NUNCA process.exit(): tras usar la red, salir a la fuerza aborta en libuv (P1).
