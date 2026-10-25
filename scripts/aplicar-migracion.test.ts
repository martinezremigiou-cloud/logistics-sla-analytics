// ============================================================
// Tests de aplicar-migracion.mjs — registro en el ledger (G3.1),
// verificación estática obligatoria (G3.2), checklist de irreversibilidad
// (G3.3) y, desde S7-C, las dos guardas nuevas del protocolo: el nombre
// derivado del archivo (ratificación S2, punto 4) y la aserción de
// `pg_default_acl` por corrida (punto 6b).
//
// POR QUE EXISTEN
// ----------------
// Antes de S5, `aplicar-migracion.mjs` NUNCA escribía en
// `supabase_migrations.schema_migrations` (por eso 0013-0015 y 0017-0019
// se registraron A MANO) y podía llegar a `--dry`/aplicar sin que
// `verificar-migracion.mjs` se hubiera corrido ni una sola vez. Verificado
// en rojo, a mano, contra el árbol sin modificar:
//   - `node scripts/aplicar-migracion.mjs <archivo> --dry` nunca mencionaba
//     "registro" ni "ledger" en su salida — no había nada que probar ahí.
//   - el fixture con el RAISE desbalanceado que tumbó la 0011 SALÍA EN
//     VERDE (exit 0): el archivo con el bug real pasaba de largo porque
//     nada invocaba `verificar-migracion.mjs`.
//
// RONDA 2 — AUDITORÍA ADVERSARIAL. El "un solo COMMIT; de nivel superior"
// original se ubicaba con una regex cruda (`/^[ \t]*COMMIT[ \t]*;/im`) que
// no distingue comentarios ni dollar-quoting: un `COMMIT;` de EJEMPLO
// dentro de un `/* ... */` o de un cuerpo `$doc$...$doc$` se contaba y se
// usaba igual que uno real, y el registro quedaba spliceado DENTRO del
// comentario/cuerpo — texto inerte — mientras el script imprimía "Ledger:
// registrada". Confirmado en rojo contra la versión previa (extraída con
// `git show`). El describe() "splice adversarial" prueba, contra el árbol
// YA CORREGIDO (que ubica el COMMIT; con el MISMO lexer de
// verificar-migracion.mjs), que ambos fixtures se clasifican como
// implícitas y el registro se previsualiza al FINAL del archivo.
//
// ============================================================
// S7-C · LA REGLA QUE MANDA AQUÍ: P19, LA PRUEBA DE VACUIDAD
// ------------------------------------------------------------
// "Una guarda escrita contra un estado vacío, disjunto o coincidentemente
// correcto pasa siempre — y una guarda que pasa siempre da permiso para
// cerrar." Ninguna guarda de S7-C entra sin el caso construido a propósito
// que la pone ROJA. Por eso las dos guardas nuevas son FUNCIONES PURAS
// exportadas (`cotejarLedgerContraDisco`, `evaluarDefaultAclPublic`): a una
// función pura se le puede inyectar el estado exacto que debe hacerla
// abortar, y eso NO se puede hacer con un SELECT contra producción sin
// escribir en producción (prohibido para este frente).
//
// Y para que "pura y bien probada" no se convierta en "probada pero nunca
// llamada" (el antipatrón exacto del frente anterior: un detector que hacía
// match sobre una subcadena ajena y salía verde sin comprobar nada), el
// estado que se les inyecta NO es inventado: es el estado REAL de
// producción, medido con las mismas queries que corre el
// script, y va copiado literal en las constantes de abajo
// (LEDGER_PRODUCCION_*, DISCO_PRODUCCION_*, ACL_PRODUCCION_*). Contra ese
// estado real, hoy, las dos guardas salen en ROJO — y esos son los dos
// tests que más importan de este archivo.
//
// SEGURIDAD DE LA CORRIDA — por qué ningún test de aquí toca producción
// -----------------------------------------------------------------------
// Cada invocación de `aplicar-migracion.mjs` en este archivo usa `--dry`
// (que jamás se conecta, por diseño del propio script) o un comando SIN
// `--dry` construido para que tenga que fallar ANTES de intentar
// conectarse — con `DATABASE_URL`/`SUPABASE_DB_URL` explícitamente
// BORRADAS del entorno del subproceso (`envSinConexion`), sin importar si
// el entorno ambiente las trae puestas. Los tests de las guardas nuevas ni
// siquiera lanzan un subproceso: importan las funciones puras. Ningún test
// aquí puede, bajo ninguna configuración de entorno, terminar aplicando
// algo real — es una garantía estructural, no una promesa.
//
// El camino que SÍ toca la red (el INSERT real en el ledger, el
// `CREATE ... IF NOT EXISTS` defensivo, el pre-chequeo de idempotencia por
// `name`, el SELECT posterior que verifica el efecto, y las dos lecturas de
// `pg_default_acl`) NO tiene test automatizado aquí a propósito: hacerlo
// exigiría aplicar algo de verdad contra producción o mockear el cliente
// `pg` — y este script está diseñado para NO pasar por ningún mock (ver su
// cabecera: "byte a byte, lo que está en el commit"). Ese camino se
// verificó con sondas manuales `BEGIN;...ROLLBACK;` contra la base real
// (mismo mecanismo que `supabase/tests/rls_negative_tests.sql`), NINGUNA
// commiteada, y —para S7-C— con SELECTs de solo lectura cuya salida está
// copiada en las constantes de abajo.
// ============================================================
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
// [S7-C] Las guardas nuevas son funciones PURAS: se importan directo para
// poder inyectarles el estado que las pone en rojo. Importar este módulo NO
// dispara su `main()` (guarda de punto de entrada, igual que
// verificar-migracion.mjs).
import {
  analizarArgumentos,
  cotejarLedgerContraDisco,
  evaluarDefaultAclPublic,
  parsearAclitems,
  validarNombreDeArchivo,
} from "./aplicar-migracion.mjs";

function raizRepo(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "supabase", "migrations"))) {
      return dir;
    }
    const padre = dirname(dir);
    if (padre === dir) break;
    dir = padre;
  }
  throw new Error(`No encuentro la raiz del repo partiendo de ${process.cwd()}`);
}

// [INV-B8 · deuda B8-8] TIMEOUT EXPLICITO, DIMENSIONADO PARA UNA MAQUINA OCUPADA.
//
// Cada `it()` de este archivo lanza un proceso Node REAL con `spawnSync`. El
// default de vitest son 5 000 ms y `vitest.config.ts` no lo sobreescribe, asi
// que ese era el presupuesto. Medido:
//
//   · en aislamiento, cada test tarda 373-428 ms — el 8 % del presupuesto;
//   · en la suite completa, ALGUNOS se pasan de los 5 000 ms, o sea se
//     degradan mas de 12x, y salen rojos con `STACK_TRACE_ERROR` y CERO
//     aserciones fallidas: la firma de un fallo de recoleccion, no de un bug.
//   · Los rojos CAMBIAN entre corridas (6 en una, 4 en la siguiente).
//
// El nombre correcto del defecto NO es "contencion": es un timeout calculado
// para una maquina ociosa aplicado a tests que compiten por CPU con todos los
// workers de vitest al arrancar un proceso del sistema operativo. La contencion
// es el disparador; el timeout es la condicion, y es la que se puede arreglar.
//
// 30 s deja 75x de holgura sobre el peor tramo medido en aislamiento y sigue
// cazando un cuelgue real. Lo que NO se hace es correr en serie: eso arreglaria
// el sintoma alargando toda la suite para todos.
vi.setConfig({ testTimeout: 30_000 });

const RAIZ = raizRepo();
const DIR_SCRIPTS = join(RAIZ, "scripts");
const APLICADOR = join(DIR_SCRIPTS, "aplicar-migracion.mjs");
const DIR_FIXTURES = join(DIR_SCRIPTS, "fixtures-aplicador");

const fixture = (nombre: string) => join(DIR_FIXTURES, nombre);

// Los fixtures llevan prefijo 9xxx desde S7-C: la guarda de nombre exige
// `NNNN_slug.sql` y aborta ANTES que cualquier otra cosa, así que un
// fixture sin prefijo moriría por el nombre y los tests de las otras
// puertas saldrían verdes por la razón equivocada. El rango 9xxx es
// deliberadamente inalcanzable para una migración real.
const F_IMPLICITA = fixture("9001_implicita_ok.sql");
const F_EXPLICITA = fixture("9002_explicita_ok.sql");
const F_DOS_TXN = fixture("9003_dos_transacciones.sql");
const F_ADV_COMENTARIO = fixture("9004_adversarial_comentario_bloque.sql");
const F_ADV_DOLAR = fixture("9005_adversarial_dollar_quoting.sql");
const F_RAISE_ROTO = fixture("9006_raise_desbalanceado.sql");

// Nunca hereda credenciales de BD: aunque el entorno ambiente las traiga
// puestas, este subproceso no las ve. Ver "SEGURIDAD DE LA CORRIDA" arriba.
const envSinConexion = { ...process.env };
delete envSinConexion.DATABASE_URL;
delete envSinConexion.SUPABASE_DB_URL;

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [APLICADOR, ...args], {
    encoding: "utf8",
    windowsHide: true,
    env: envSinConexion,
  });
  if (r.error) throw r.error;
  return { codigo: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

// ============================================================
// ESTADO REAL DE PRODUCCIÓN, medido (solo SELECT).
// Es la materia prima de las pruebas de vacuidad: contra ESTO las guardas
// nuevas tienen que salir en rojo hoy.
// ============================================================

// SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
const LEDGER_PRODUCCION_2026_08_07 = [
  { version: "20260101000001", name: "0001_schema" },
  { version: "20260101000003", name: "0002_rls" },
  { version: "20260101000004", name: "0003_seeds" },
  { version: "20260101000005", name: "0004_estatus" },
  { version: "20260101000006", name: "0005_ingest_fn" },
  { version: "20260101000007", name: "0006_b5_dominio" },
  { version: "20260101000008", name: "0007_b5_storage" },
  { version: "20260101000009", name: "0008_bparche_clasificacion_v2" },
  { version: "20260101000010", name: "0009_b6_pendientes" },
  { version: "20260101000011", name: "0010_b7a_rol_visitante" },
  { version: "20260101000012", name: "0011_taxo" },
  { version: "20260101000013", name: "0012_b7b_hardening" },
  { version: "20260101000014", name: "0013_mvp_cierre_bandeja_ingesta" },
  { version: "20260101000015", name: "0014_mvp_cierre_tecnologia_canonica" },
  // ↓ EL DESAJUSTE: el archivo en disco es 0015_mvp_cierre_autocierre_seguro.sql
  { version: "20260101000016", name: "0015_mvp_cierre_universo_vacio" },
  { version: "20260101000017", name: "0017_mvp2_metadata_por_rpc" },
  { version: "20260101000018", name: "0018_mvp2_familia_alias" },
  { version: "20260101000019", name: "0019_mvp2_familia_nueva" },
];

// ls supabase/migrations/*.sql  → los archivos del disco, al abrir S7-C.
//
// INSTANTÁNEA CONGELADA A PROPÓSITO, y hay que decirlo: mientras se
// escribía este frente, otro retiró del disco la 0016 (decisión 3 de la
// ratificación: absorbida por la 0020, nunca aplicada, y su presencia
// producía justo el hueco que se ve abajo) y agregó la 0022. O sea que
// contra el disco de AHORA el caso ARCHIVO_SIN_FILA ya no dispara — el
// que sigue vivo contra producción es el NOMBRE_DIVERGENTE de la 0015,
// porque la fila del ledger todavía no se ha corregido. La instantánea NO
// se actualiza: es el estado que ejercita las DOS reglas a la vez, y un
// caso rojo real vale más congelado que perdido.
const DISCO_PRODUCCION_2026_08_07 = [
  "0001_schema.sql",
  "0002_rls.sql",
  "0003_seeds.sql",
  "0004_estatus.sql",
  "0005_ingest_fn.sql",
  "0006_b5_dominio.sql",
  "0007_b5_storage.sql",
  "0008_bparche_clasificacion_v2.sql",
  "0009_b6_pendientes.sql",
  "0010_b7a_rol_visitante.sql",
  "0011_taxo.sql",
  "0012_b7b_hardening.sql",
  "0013_mvp_cierre_bandeja_ingesta.sql",
  "0014_mvp_cierre_tecnologia_canonica.sql",
  "0015_mvp_cierre_autocierre_seguro.sql",
  // ↓ escrita, nunca aplicada, sin fila en el ledger, y con número MENOR
  //   al máximo registrado (0019): un hueco, no una pendiente.
  "0016_mvp_cierre_truncate_y_constraint_portante.sql",
  "0017_mvp2_metadata_por_rpc.sql",
  "0018_mvp2_familia_alias.sql",
  "0019_mvp2_familia_nueva.sql",
  "0020_repro_truncate_guarda_pendientes_creado_en.sql",
  "0023_reproducibilidad_backfill_periodo_civil.sql",
];

// SELECT pg_get_userbyid(defaclrole), nspname, defaclobjtype, defaclacl::text
//   FROM pg_default_acl LEFT JOIN pg_namespace …;
// Copiadas literales. Las dos que importan son las de esquema `public`,
// tipo `r` (tablas): las DOS conceden D (TRUNCATE) a anon y authenticated.
const ACL_PRODUCCION_2026_08_07 = [
  { rol_dueno: "postgres", esquema: "public", tipo: "S", acl_literal: "{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}" },
  { rol_dueno: "postgres", esquema: "public", tipo: "f", acl_literal: "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}" },
  { rol_dueno: "postgres", esquema: "public", tipo: "r", acl_literal: "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}" },
  { rol_dueno: "postgres", esquema: "storage", tipo: "S", acl_literal: "{postgres=rwU/postgres,anon=rwU/postgres,authenticated=rwU/postgres,service_role=rwU/postgres}" },
  { rol_dueno: "postgres", esquema: "storage", tipo: "f", acl_literal: "{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}" },
  { rol_dueno: "postgres", esquema: "storage", tipo: "r", acl_literal: "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}" },
  { rol_dueno: "supabase_admin", esquema: "extensions", tipo: "S", acl_literal: "{postgres=r*w*U*/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "extensions", tipo: "f", acl_literal: "{postgres=X*/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "extensions", tipo: "r", acl_literal: "{postgres=a*r*w*d*D*x*t*m*/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql", tipo: "S", acl_literal: "{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql", tipo: "f", acl_literal: "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql", tipo: "r", acl_literal: "{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql_public", tipo: "S", acl_literal: "{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql_public", tipo: "f", acl_literal: "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "graphql_public", tipo: "r", acl_literal: "{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "public", tipo: "S", acl_literal: "{postgres=rwU/supabase_admin,anon=rwU/supabase_admin,authenticated=rwU/supabase_admin,service_role=rwU/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "public", tipo: "f", acl_literal: "{postgres=X/supabase_admin,anon=X/supabase_admin,authenticated=X/supabase_admin,service_role=X/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "public", tipo: "r", acl_literal: "{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "realtime", tipo: "S", acl_literal: "{postgres=rwU/supabase_admin,dashboard_user=rwU/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "realtime", tipo: "f", acl_literal: "{postgres=X/supabase_admin,dashboard_user=X/supabase_admin}" },
  { rol_dueno: "supabase_admin", esquema: "realtime", tipo: "r", acl_literal: "{postgres=arwdDxtm/supabase_admin,dashboard_user=arwdDxtm/supabase_admin}" },
  { rol_dueno: "supabase_auth_admin", esquema: "auth", tipo: "S", acl_literal: "{postgres=rwU/supabase_auth_admin,dashboard_user=rwU/supabase_auth_admin}" },
  { rol_dueno: "supabase_auth_admin", esquema: "auth", tipo: "f", acl_literal: "{postgres=X/supabase_auth_admin,dashboard_user=X/supabase_auth_admin}" },
  { rol_dueno: "supabase_auth_admin", esquema: "auth", tipo: "r", acl_literal: "{postgres=arwdDxtm/supabase_auth_admin,dashboard_user=arwdDxtm/supabase_auth_admin}" },
];

const ACL_PUBLIC_POSTGRES_TABLAS =
  "{postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const ACL_PUBLIC_SUPABASE_ADMIN_TABLAS =
  "{postgres=arwdDxtm/supabase_admin,anon=arwdDxtm/supabase_admin,authenticated=arwdDxtm/supabase_admin,service_role=arwdDxtm/supabase_admin}";

const codigos = (lista: Array<{ codigo: string }>) => lista.map((h) => h.codigo);
const texto = (lista: Array<{ codigo: string; mensaje: string }>) =>
  lista.map((h) => `${h.codigo} ${h.mensaje}`).join("\n");

describe("aplicar-migracion · verificación estática obligatoria (G3.2)", () => {
  it("un archivo con el RAISE desbalanceado de la 0011 aborta en --dry (antes pasaba de largo)", () => {
    const { codigo, salida } = correr(F_RAISE_ROTO, "--dry");
    expect(codigo).not.toBe(0);
    expect(salida).toContain("RAISE_POCOS_ARGS");
    expect(salida).toContain("verificar-migracion.mjs encontró hallazgos");
    expect(salida).toContain("la migración NO se aplica");
    // El fixture SÍ trae BEGIN;...COMMIT; balanceado: sin el corte tras el
    // abort, el análisis de transacción seguiría corriendo e imprimiría
    // "txn : EXPLÍCITA..." como si algo hubiera continuado bien.
    expect(salida).not.toContain("txn     :");
    expect(salida).not.toContain("registro: supabase_migrations.schema_migrations");
    expect(salida).not.toContain("--dry: no se conecta ni se aplica nada.");
  });

  it("--saltar-verificacion omite la puerta y avisa RUIDOSAMENTE que lo hizo", () => {
    const { codigo, salida } = correr(F_RAISE_ROTO, "--dry", "--saltar-verificacion");
    expect(codigo).toBe(0);
    expect(salida).toContain("VERIFICACIÓN ESTÁTICA SALTADA A PROPÓSITO (--saltar-verificacion)");
    expect(salida).toContain("--dry: no se conecta ni se aplica nada.");
    expect(salida).not.toContain("verificar-migracion.mjs encontró hallazgos");
  });

  it("un archivo limpio SÍ pasa por el verificador y lo reporta (no se saltó nada)", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("VERIFICADOR ESTATICO DE MIGRACIONES");
    expect(salida).toMatch(/OK\s+.*9001_implicita_ok\.sql/);
  });
});

describe("aplicar-migracion · registro en el ledger, vista previa por --dry (G3.1)", () => {
  it("transacción IMPLÍCITA (sin BEGIN;/COMMIT;): el registro se previsualiza al final del archivo", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("registro: supabase_migrations.schema_migrations");
    expect(salida).toContain("name     : 9001_implicita_ok");
    expect(salida).toContain("posición : al final del archivo (transacción implícita)");
    expect(salida).toMatch(/version {2}: \d{14}/); // YYYYMMDDHHMMSS, formato medido contra el ledger real
  });

  it("transacción EXPLÍCITA (BEGIN;...COMMIT;): el registro se previsualiza antes del COMMIT;", () => {
    const { codigo, salida } = correr(F_EXPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("name     : 9002_explicita_ok");
    expect(salida).toMatch(/posición : antes del COMMIT; de la línea \d+ \(transacción explícita\)/);
  });

  it("DOS transacciones explícitas: el registro automático se OMITE (nunca adivina dónde splicear)", () => {
    const { codigo, salida } = correr(F_DOS_TXN, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("NO se registra automáticamente (2 transacciones explícitas)");
    expect(salida).toContain("regístralo a mano");
  });

  it("cuando hay registro que splicear, se imprime TAMBIÉN el sha256 EFECTIVO (del texto real a enviar)", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toMatch(/sha256\s+: [0-9a-f]{16}…\s+\(del ARCHIVO, contrastable contra el commit\)/);
    expect(salida).toMatch(/sha256 efectivo : [0-9a-f]{16}…\s+\(del TEXTO REAL a enviar, incluye el registro\)/);
    // Y los dos hashes DEBEN diferir: el efectivo incluye el INSERT del
    // ledger que el del archivo, por definición, no tiene.
    const [, delArchivo] = salida.match(/sha256\s+: ([0-9a-f]{16})…/) ?? [];
    const [, efectivo] = salida.match(/sha256 efectivo : ([0-9a-f]{16})…/) ?? [];
    expect(delArchivo).toBeTruthy();
    expect(efectivo).toBeTruthy();
    expect(efectivo).not.toBe(delArchivo);
  });

  it("DOS transacciones explícitas: NO imprime sha256 efectivo (no hay texto distinto que enviar todavía)", () => {
    const { salida } = correr(F_DOS_TXN, "--dry");
    expect(salida).not.toContain("sha256 efectivo");
  });
});

describe("aplicar-migracion · splice adversarial: el lexer, no una regex cruda (auditoría adversarial)", () => {
  it("un BEGIN;/COMMIT; de EJEMPLO dentro de un comentario /* ... */ NO cuenta como transacción explícita", () => {
    const { codigo, salida } = correr(F_ADV_COMENTARIO, "--dry");
    expect(codigo).toBe(0);
    // La clasificación correcta es implícita: el decoy vive dentro de un
    // comentario, invisible para el lexer (y por lo tanto para el conteo).
    expect(salida).toContain("txn     : implícita");
    expect(salida).not.toContain("txn     : EXPLÍCITA");
    expect(salida).toContain("posición : al final del archivo (transacción implícita)");
  });

  it("un BEGIN;/COMMIT; de EJEMPLO dentro de un cuerpo $doc$...$doc$ NO cuenta como transacción explícita", () => {
    const { codigo, salida } = correr(F_ADV_DOLAR, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("txn     : implícita");
    expect(salida).not.toContain("txn     : EXPLÍCITA");
    expect(salida).toContain("posición : al final del archivo (transacción implícita)");
  });
});

describe("aplicar-migracion · checklist de irreversibilidad (G3.3)", () => {
  it("una aplicación real (sin --dry) SIN --irreversibilidad se niega ANTES de tocar la red", () => {
    const { codigo, salida } = correr(F_IMPLICITA);
    expect(codigo).toBe(2);
    expect(salida).toContain("Falta responder el checklist de irreversibilidad");
    expect(salida).toContain('--irreversibilidad="tu respuesta a la 1, y por qué"');
    // La prueba de que de verdad no se intentó conectar: ese texto solo
    // aparece después de pasar este gate.
    expect(salida).not.toContain("conectando");
  });

  it("--dry NUNCA exige --irreversibilidad (y lo dice explícitamente)", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("--dry no la exige");
  });

  it("con --irreversibilidad puesta, el checklist YA NO bloquea y cae al siguiente gate existente (falta de credenciales)", () => {
    const { codigo, salida } = correr(
      F_IMPLICITA,
      "--irreversibilidad=no, es un SELECT de prueba sin efecto en el esquema",
    );
    expect(codigo).toBe(2);
    expect(salida).not.toContain("checklist de irreversibilidad");
    expect(salida).toContain("Falta la cadena de conexión");
  });

  it('--irreversibilidad="" (vacía tras trim) cuenta como NO respondida', () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--irreversibilidad=   ");
    expect(codigo).toBe(2);
    expect(salida).toContain("Falta responder el checklist de irreversibilidad");
  });

  it("la respuesta de --irreversibilidad se HACE ECO en el log de la corrida (no solo vive en el historial del shell)", () => {
    // Hallazgo de la auditoría adversarial: el texto se exigía pero nunca
    // se imprimía, ni se guardaba — un sello de goma. Ahora viaja al log
    // (aquí) Y al ledger (columna created_by, no testeable sin red).
    const t = "no, es un SELECT de prueba sin efecto en el esquema";
    const { salida } = correr(F_IMPLICITA, `--irreversibilidad=${t}`);
    expect(salida).toContain(`irreversibilidad: ${t}`);
  });
});

// ============================================================
// [S7-C · punto 4] EL NOMBRE SE DERIVA DEL ARCHIVO, NUNCA DE UN ARGUMENTO
// ============================================================
describe("aplicar-migracion · S7-C · el nombre del ledger sale del basename (ratificación S2, punto 4)", () => {
  it("ROJO de vacuidad · un basename sin prefijo numérico ABORTA, y dice qué esperaba y qué recibió", () => {
    // Sin esta guarda el archivo pasaba de largo: su SQL es intachable y
    // el `name` derivado (`sin_prefijo_numerico`) se habría registrado tal
    // cual, imposible de cotejar con ninguna fila por número de versión.
    const { codigo, salida } = correr(fixture("sin_prefijo_numerico.sql"), "--dry");
    expect(codigo).toBe(2);
    expect(salida).toContain("Nombre de archivo rechazado");
    expect(salida).toContain("se esperaba : NNNN_slug.sql");
    expect(salida).toContain("se recibió  : sin_prefijo_numerico.sql");
    // No inventa un nombre "corregido" — la única salida es renombrar.
    expect(salida).toContain("No se\n    inventa un nombre \"corregido\": renombra el archivo.");
    // Y aborta ANTES de todo lo demás: ni siquiera llegó al verificador.
    expect(salida).not.toContain("VERIFICADOR ESTATICO");
    expect(salida).not.toContain("--dry: no se conecta ni se aplica nada.");
  });

  it("ROJO de vacuidad · TRES dígitos (901_) no es NNNN_: aborta", () => {
    const { codigo, salida } = correr(fixture("901_tres_digitos.sql"), "--dry");
    expect(codigo).toBe(2);
    expect(salida).toContain("se recibió  : 901_tres_digitos.sql");
  });

  it("ROJO de vacuidad · una MAYÚSCULA en el slug: aborta", () => {
    const { codigo, salida } = correr(fixture("9007_Mayuscula.sql"), "--dry");
    expect(codigo).toBe(2);
    expect(salida).toContain("se recibió  : 9007_Mayuscula.sql");
  });

  it("ROJO de vacuidad · guiones en vez de guion bajo: aborta", () => {
    const { codigo, salida } = correr(fixture("9008-guion-en-vez-de-guion-bajo.sql"), "--dry");
    expect(codigo).toBe(2);
    expect(salida).toContain("se recibió  : 9008-guion-en-vez-de-guion-bajo.sql");
  });

  it("un basename válido pasa, y el `name` impreso es EXACTAMENTE el basename sin .sql", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("name    : 9001_implicita_ok   (DERIVADO del basename; no hay argumento que lo cambie)");
  });

  it("ROJO de vacuidad · un argumento desconocido (p.ej. --nombre=...) ABORTA nombrándolo", () => {
    // Hoy no existe ninguna bandera de nombre — y ésta es la razón de que
    // no pueda volver a existir sin que alguien la escriba a propósito:
    // cualquier bandera no reconocida es fatal, no se ignora en silencio.
    const { codigo, salida } = correr(F_IMPLICITA, "--dry", "--nombre=0099_mentira");
    expect(codigo).toBe(2);
    expect(salida).toContain("argumento no reconocido: --nombre=0099_mentira");
    expect(salida).toContain("El nombre para el ledger NO se puede pasar por argumento");
    expect(salida).not.toContain("0099_mentira   (DERIVADO");
  });

  it("ROJO de vacuidad · un segundo posicional (el sitio donde se colaría un nombre) ABORTA", () => {
    const { codigo, salida } = correr(F_IMPLICITA, "--dry", "0099_otro_nombre");
    expect(codigo).toBe(2);
    expect(salida).toContain("sobran argumentos posicionales: 0099_otro_nombre");
  });

  it("analizarArgumentos (pura): reconoce las tres banderas válidas y nada más", () => {
    const ok = analizarArgumentos(["x.sql", "--dry", "--saltar-verificacion", "--irreversibilidad=  sí, borra  "]);
    expect(ok.ok).toBe(true);
    expect(ok.ruta).toBe("x.sql");
    expect(ok.dry).toBe(true);
    expect(ok.saltarVerificacion).toBe(true);
    expect(ok.irreversibilidad).toBe("sí, borra"); // trim

    // `--irreversibilidad` SIN `=` no es una bandera conocida: antes se
    // ignoraba en silencio y el usuario creía haber respondido.
    const sinIgual = analizarArgumentos(["x.sql", "--irreversibilidad"]);
    expect(sinIgual.ok).toBe(false);
    expect(sinIgual.errores.join(" ")).toContain("--irreversibilidad");
  });

  it("validarNombreDeArchivo (pura): la matriz completa de aceptado/rechazado", () => {
    for (const bueno of [
      "0001_schema.sql",
      "0008_bparche_clasificacion_v2.sql",
      "0020_repro_truncate_guarda_pendientes_creado_en.sql",
      "9001_implicita_ok.sql",
    ]) {
      const r = validarNombreDeArchivo(bueno);
      expect(r.ok, bueno).toBe(true);
      expect(r.nombreLedger).toBe(bueno.slice(0, -4));
      expect(r.numero).toBe(bueno.slice(0, 4));
    }
    for (const malo of [
      "schema.sql",
      "001_tres.sql",
      "00001_cinco.sql",
      "0001-guion.sql",
      "0001_Mayuscula.sql",
      "0001_schema.SQL",
      "0001_schema",
      "0001_.sql",
      "0001_doble__guion.sql",
      "0001_acentuación.sql",
    ]) {
      const r = validarNombreDeArchivo(malo);
      expect(r.ok, malo).toBe(false);
      expect(r.nombreLedger, malo).toBeNull();
    }
  });
});

// ============================================================
// [S7-C] COTEJO LEDGER ↔ DISCO
// ============================================================
describe("aplicar-migracion · S7-C · cotejo ledger ↔ disco antes de aplicar", () => {
  it("ROJO CONTRA PRODUCCIÓN REAL · el estado del fixture produce EXACTAMENTE dos hallazgos", () => {
    // Ésta es la prueba de vacuidad que más pesa: no es un estado
    // inventado para que la guarda se vea bien, es el ledger y el disco
    // reales, medidos, y la guarda tiene que ponerse roja sobre ellos.
    const r = cotejarLedgerContraDisco({
      archivosDisco: DISCO_PRODUCCION_2026_08_07,
      filasLedger: LEDGER_PRODUCCION_2026_08_07,
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos).sort()).toEqual(["ARCHIVO_SIN_FILA", "NOMBRE_DIVERGENTE"]);

    const t = texto(r.hallazgos);
    // Nombra la FILA y el ARCHIVO concretos, no dice "hay divergencia".
    expect(t).toContain("version=20260101000016");
    expect(t).toContain("name='0015_mvp_cierre_universo_vacio'");
    expect(t).toContain("supabase/migrations/0015_mvp_cierre_autocierre_seguro.sql");
    expect(t).toContain("'0015_mvp_cierre_autocierre_seguro'"); // el nombre al que hay que corregir la fila
    expect(t).toContain("supabase/migrations/0016_mvp_cierre_truncate_y_constraint_portante.sql");
    expect(t).toContain("el ledger ya llegó");

    // Y la salida legítima existe y está separada del hallazgo: 0020 y
    // 0023 son PENDIENTES, no huecos.
    expect(r.pendientes).toEqual([
      "0020_repro_truncate_guarda_pendientes_creado_en.sql",
      "0023_reproducibilidad_backfill_periodo_civil.sql",
    ]);
    expect(r.lineas.join("\n")).toContain("todavía no se han aplicado — legítimo");
    expect(r.maxLedger).toBe("0019");
  });

  it("VERDE · con la fila 0015 corregida al nombre del archivo y la 0016 retirada del disco, no queda ni un hallazgo", () => {
    // Es decir: la guarda no es un "siempre rojo" tampoco. Este es
    // exactamente el estado que dejan las decisiones 3 y 4 de la
    // ratificación una vez ejecutadas.
    const ledger = LEDGER_PRODUCCION_2026_08_07.map((f) =>
      f.name === "0015_mvp_cierre_universo_vacio"
        ? { ...f, name: "0015_mvp_cierre_autocierre_seguro" }
        : f,
    );
    const disco = DISCO_PRODUCCION_2026_08_07.filter(
      (a) => a !== "0016_mvp_cierre_truncate_y_constraint_portante.sql",
    );
    const r = cotejarLedgerContraDisco({ archivosDisco: disco, filasLedger: ledger, ledgerDisponible: true });
    expect(r.hallazgos).toEqual([]);
    expect(r.pendientes).toEqual([
      "0020_repro_truncate_guarda_pendientes_creado_en.sql",
      "0023_reproducibilidad_backfill_periodo_civil.sql",
    ]);
  });

  it("ROJO · una fila del ledger sin NINGÚN archivo de ese número (el replay no reproduce esa base)", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql"],
      filasLedger: [
        { version: "20260101000001", name: "0001_schema" },
        { version: "20260101000002", name: "0099_fantasma" },
      ],
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos)).toContain("FILA_SIN_ARCHIVO");
    expect(texto(r.hallazgos)).toContain("name='0099_fantasma'");
    expect(texto(r.hallazgos)).toContain("0099_*.sql");
  });

  it("ROJO · dos archivos con el mismo número de versión", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql", "0001_schema_bis.sql"],
      filasLedger: [{ version: "20260101000001", name: "0001_schema" }],
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos)).toContain("DISCO_NUMERO_DUPLICADO");
    expect(texto(r.hallazgos)).toContain("0001_schema_bis.sql");
  });

  it("ROJO · dos filas del ledger con el mismo número de versión", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql"],
      filasLedger: [
        { version: "20260101000001", name: "0001_schema" },
        { version: "20260101000002", name: "0001_schema_otra_vez" },
      ],
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos)).toContain("LEDGER_NUMERO_DUPLICADO");
    expect(codigos(r.hallazgos)).toContain("NOMBRE_DIVERGENTE");
  });

  it("ROJO · una fila con un `name` que ni siquiera tiene la forma del repo (la escribió otra herramienta)", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql"],
      filasLedger: [
        { version: "20260101000001", name: "0001_schema" },
        { version: "20260101000020", name: "arreglo_rapido_desde_studio" },
      ],
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos)).toContain("LEDGER_FILA_AJENA");
    expect(texto(r.hallazgos)).toContain('"arreglo_rapido_desde_studio"');
  });

  it("ROJO · un .sql en supabase/migrations que no cumple el formato", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql", "parche_manual.sql"],
      filasLedger: [{ version: "20260101000001", name: "0001_schema" }],
      ledgerDisponible: true,
    });
    expect(codigos(r.hallazgos)).toContain("DISCO_NOMBRE_INVALIDO");
    expect(texto(r.hallazgos)).toContain("parche_manual.sql");
  });

  it("VACUIDAD DECLARADA · con el ledger VACÍO la misma divergencia NO se detecta — y la salida lo dice", () => {
    // El caso que P19 llama por su nombre: una guarda contra un estado
    // vacío pasa siempre. Aquí pasa (no hay con qué cotejar), pero no se
    // queda callada fingiendo verde.
    const r = cotejarLedgerContraDisco({
      archivosDisco: DISCO_PRODUCCION_2026_08_07,
      filasLedger: [],
      ledgerDisponible: true,
    });
    expect(r.hallazgos).toEqual([]);
    expect(r.pendientes.length).toBe(21);
    const l = r.lineas.join("\n");
    expect(l).toContain("0 filas");
    expect(l).toContain("este cotejo no puede");
    expect(l).toContain("No es un verde con contenido");
  });

  it("VACUIDAD DECLARADA · sin la tabla del ledger (replay contra Postgres limpio) el cotejo es PARCIAL y lo dice", () => {
    const r = cotejarLedgerContraDisco({
      archivosDisco: DISCO_PRODUCCION_2026_08_07,
      filasLedger: [],
      ledgerDisponible: false,
    });
    expect(r.hallazgos).toEqual([]);
    const l = r.lineas.join("\n");
    expect(l).toContain("NO disponible");
    expect(l).toContain("la tabla de plataforma");
    expect(l).toContain("COTEJO PARCIAL");
    // Pero las reglas del lado del disco SÍ siguen vivas sin ledger:
    const conBasura = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql", "0001_duplicada.sql", "basura.sql"],
      filasLedger: [],
      ledgerDisponible: false,
    });
    expect(codigos(conBasura.hallazgos).sort()).toEqual(["DISCO_NOMBRE_INVALIDO", "DISCO_NUMERO_DUPLICADO"]);
  });

  it("no dice 'la tabla no existe' cuando lo que pasó es que no se conectó (son dos cosas distintas)", () => {
    // Una salida que confunde "no hay tabla" con "no la leí" es una salida
    // que miente, y sobre esa mentira alguien concluiría que el ledger de
    // producción se perdió.
    const sinConexion = cotejarLedgerContraDisco({
      archivosDisco: ["0001_schema.sql"],
      filasLedger: [],
      ledgerDisponible: false,
      motivoSinLedger: "sin-conexion",
    });
    const l = sinConexion.lineas.join("\n");
    expect(l).toContain("NO leído (--dry no se conecta a nada)");
    expect(l).not.toContain("no existe todavía");
    // Y sin ledger no se inventa una lista de "pendientes": sin con qué
    // comparar, TODO el disco parecería pendiente y eso no informa nada.
    expect(l).not.toContain("pendientes (");
  });

  it("CABLEADO · --dry corre el cotejo contra el directorio REAL del repo (no contra una lista vacía)", () => {
    // Que la función pura esté bien probada no sirve de nada si nadie la
    // llama con datos de verdad. Esto afirma que la llamada existe y que
    // ve el disco real: hoy hay decenas de archivos, mañana puede haber más.
    const { codigo, salida } = correr(F_IMPLICITA, "--dry");
    expect(codigo).toBe(0);
    expect(salida).toContain("cotejo ledger ↔ disco (PARCIAL: --dry no se conecta)");
    const m = salida.match(/disco {3}: (\d+) archivo\(s\) \.sql en supabase\/migrations\//);
    expect(m).toBeTruthy();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(15);
    // Y dice la verdad sobre POR QUÉ el cotejo fue parcial.
    expect(salida).toContain("NO leído (--dry no se conecta a nada)");
    expect(salida).not.toContain("no existe todavía");
  });
});

// ============================================================
// [S7-C · punto 6b] ASERCIÓN DE pg_default_acl POR CORRIDA
// ============================================================
describe("aplicar-migracion · S7-C · aserción de pg_default_acl (punto 6b)", () => {
  const ctxBase = { correccionConocida: true, rolesSupabasePresentes: true, momento: "antes de aplicar" };

  it("ROJO CONTRA PRODUCCIÓN REAL · con la 0020 ya en efecto, el ACL medido hoy ABORTA", () => {
    const r = evaluarDefaultAclPublic(ACL_PRODUCCION_2026_08_07, { ...ctxBase, correccionEnEfecto: true });
    expect(codigos(r.hallazgos)).toEqual(["TRUNCATE_POR_DEFECTO_ABIERTO"]);
    const t = texto(r.hallazgos);
    expect(t).toContain("anon, authenticated");
    expect(t).toContain("no quedó");
    // El ACL LITERAL, no una interpretación (si Supabase cambia el
    // formato, se ve crudo).
    expect(t).toContain(ACL_PUBLIC_POSTGRES_TABLAS);
  });

  it("AVISO, NO ABORTO · mientras la 0020 no cuente como aplicada, el mismo ACL avisa fuerte y deja pasar", () => {
    // Si abortara aquí, sería imposible aplicar justamente la migración
    // que cierra el hueco. Pero no puede quedarse callada.
    const r = evaluarDefaultAclPublic(ACL_PRODUCCION_2026_08_07, { ...ctxBase, correccionEnEfecto: false });
    expect(r.hallazgos).toEqual([]);
    expect(codigos(r.avisos)).toContain("TRUNCATE_POR_DEFECTO_PENDIENTE");
    const t = texto(r.avisos);
    expect(t).toContain("HUECO ABIERTO");
    expect(t).toContain("Toda tabla NUEVA de public nace con TRUNCATE abierto");
    expect(t).toContain(ACL_PUBLIC_POSTGRES_TABLAS);
  });

  it("NUNCA MUDO · el residual de supabase_admin se informa SIEMPRE, incluso cuando todo lo demás está verde", () => {
    // Éste es el test que impide que alguien "limpie" la salida: el punto
    // entero de la aserción es que nadie aplique una migración sin ver ese
    // hueco escrito. Aquí el default de `postgres` YA está corregido (sin
    // D para anon/authenticated) y la corrección cuenta como aplicada —
    // el estado más verde posible — y aun así el residual sale impreso.
    const aclCorregido = ACL_PRODUCCION_2026_08_07.map((f) =>
      f.esquema === "public" && f.tipo === "r" && f.rol_dueno === "postgres"
        ? {
            ...f,
            acl_literal:
              "{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres}",
          }
        : f,
    );
    const r = evaluarDefaultAclPublic(aclCorregido, { ...ctxBase, correccionEnEfecto: true });
    expect(r.hallazgos).toEqual([]);
    expect(codigos(r.avisos)).toContain("RESIDUAL_CONOCIDO_SUPABASE_ADMIN");
    const t = texto(r.avisos);
    expect(t).toContain("decisión de producto");
    expect(t).toContain(ACL_PUBLIC_SUPABASE_ADMIN_TABLAS);
    // Y el veredicto positivo de la entrada de postgres también se dice.
    expect(r.lineas.join("\n")).toContain("veredicto dueño=postgres: NINGÚN rol de lectura pública tiene D");
  });

  it("el ACL literal de las DOS entradas de public/tablas se imprime en toda corrida", () => {
    const r = evaluarDefaultAclPublic(ACL_PRODUCCION_2026_08_07, { ...ctxBase, correccionEnEfecto: false });
    const l = r.lineas.join("\n");
    expect(l).toContain("ACL LITERAL, tal cual lo devolvió Postgres (sin interpretar)");
    expect(l).toContain(ACL_PUBLIC_POSTGRES_TABLAS);
    expect(l).toContain(ACL_PUBLIC_SUPABASE_ADMIN_TABLAS);
    expect(r.entradasEvaluadas).toBe(2);
  });

  it("ROJO · una TERCERA entrada para public/tablas (un dueño que hoy no existe)", () => {
    const conTercera = [
      ...ACL_PRODUCCION_2026_08_07,
      {
        rol_dueno: "un_admin_nuevo",
        esquema: "public",
        tipo: "r",
        acl_literal: "{un_admin_nuevo=arwdDxtm/un_admin_nuevo,anon=arwdDxtm/un_admin_nuevo}",
      },
    ];
    const r = evaluarDefaultAclPublic(conTercera, { ...ctxBase, correccionEnEfecto: false });
    expect(codigos(r.hallazgos)).toContain("DEFAULT_ACL_ENTRADA_NUEVA");
    expect(texto(r.hallazgos)).toContain("un_admin_nuevo");
  });

  it("ROJO · un ROL NUEVO con D dentro de una entrada conocida", () => {
    const conRolNuevo = ACL_PRODUCCION_2026_08_07.map((f) =>
      f.esquema === "public" && f.tipo === "r" && f.rol_dueno === "postgres"
        ? {
            ...f,
            acl_literal:
              "{postgres=arwdDxtm/postgres,anon=arwdxtm/postgres,authenticated=arwdxtm/postgres,service_role=arwdDxtm/postgres,rol_de_reportes=arwdDxtm/postgres}",
          }
        : f,
    );
    const r = evaluarDefaultAclPublic(conRolNuevo, { ...ctxBase, correccionEnEfecto: true });
    expect(codigos(r.hallazgos)).toContain("ROL_NUEVO_CON_TRUNCATE");
    expect(texto(r.hallazgos)).toContain("rol_de_reportes");
  });

  it("ROJO · PUBLIC (grantee vacío) con D cuenta como hueco, igual que anon", () => {
    const conPublic = ACL_PRODUCCION_2026_08_07.map((f) =>
      f.esquema === "public" && f.tipo === "r" && f.rol_dueno === "postgres"
        ? { ...f, acl_literal: "{postgres=arwdDxtm/postgres,=arwdDxtm/postgres}" }
        : f,
    );
    const r = evaluarDefaultAclPublic(conPublic, { ...ctxBase, correccionEnEfecto: true });
    expect(codigos(r.hallazgos)).toContain("TRUNCATE_POR_DEFECTO_ABIERTO");
    expect(texto(r.hallazgos)).toContain("PUBLIC");
  });

  it("ROJO · un ACL que no se puede leer NO pasa por verde (fail-closed)", () => {
    const ilegible = ACL_PRODUCCION_2026_08_07.map((f) =>
      f.esquema === "public" && f.tipo === "r" && f.rol_dueno === "postgres"
        ? { ...f, acl_literal: "algo-que-no-es-un-aclitem" }
        : f,
    );
    const r = evaluarDefaultAclPublic(ilegible, { ...ctxBase, correccionEnEfecto: true });
    expect(codigos(r.hallazgos)).toContain("ACL_ILEGIBLE");
    expect(texto(r.hallazgos)).toContain("algo-que-no-es-un-aclitem");
  });

  it("ROJO · pg_default_acl VACÍA con los roles de Supabase presentes: la aserción no puede afirmar nada", () => {
    // Anti-vacuidad de la CONSULTA, no solo de la lógica: si la lectura se
    // rompe y devuelve cero filas, un evaluador ingenuo diría "todo bien".
    const r = evaluarDefaultAclPublic([], { ...ctxBase, correccionEnEfecto: true });
    expect(codigos(r.hallazgos)).toContain("ACL_SIN_FILAS");
  });

  it("VERDE justificado · pg_default_acl vacía y SIN roles de Supabase: no es un proyecto Supabase, avisa y no aborta", () => {
    const r = evaluarDefaultAclPublic([], {
      ...ctxBase,
      correccionEnEfecto: true,
      rolesSupabasePresentes: false,
    });
    expect(r.hallazgos).toEqual([]);
    expect(codigos(r.avisos)).toContain("ACL_SIN_FILAS_SIN_SUPABASE");
  });

  it("ROJO · si el prefijo de la migración que cierra el hueco queda caduco, la aserción lo dice en vez de degradar en silencio", () => {
    const r = evaluarDefaultAclPublic(ACL_PRODUCCION_2026_08_07, {
      ...ctxBase,
      correccionEnEfecto: false,
      correccionConocida: false,
    });
    expect(codigos(r.hallazgos)).toContain("CONSTANTE_CADUCA");
    expect(texto(r.hallazgos)).toContain("degradaría a \"solo aviso\" PARA SIEMPRE");
  });

  it("ROJO · si desaparece una de las dos entradas esperadas, se informa (estado más cerrado, pero cambió)", () => {
    const sinSupabaseAdmin = ACL_PRODUCCION_2026_08_07.filter(
      (f) => !(f.esquema === "public" && f.tipo === "r" && f.rol_dueno === "supabase_admin"),
    );
    const r = evaluarDefaultAclPublic(sinSupabaseAdmin, { ...ctxBase, correccionEnEfecto: false });
    expect(codigos(r.avisos)).toContain("DEFAULT_ACL_ENTRADA_AUSENTE");
  });

  it("el hueco de `storage` (mismo patrón, fuera del alcance ratificado) se informa sin aseverarlo", () => {
    const r = evaluarDefaultAclPublic(ACL_PRODUCCION_2026_08_07, { ...ctxBase, correccionEnEfecto: false });
    const l = r.lineas.join("\n");
    expect(l).toContain("fuera de alcance (solo se asevera public): esquema 'storage'");
    expect(l).toContain("Informado, NO aseverado");
  });

  it("parsearAclitems: la `d` minúscula (DELETE) NO es la `D` (TRUNCATE) — confundirlas daría verde sobre el bug", () => {
    const sinTruncate = parsearAclitems("{anon=arwd/postgres}");
    expect(sinTruncate.ok).toBe(true);
    expect(sinTruncate.items[0].privilegios.includes("D")).toBe(false);

    const conTruncate = parsearAclitems(ACL_PUBLIC_POSTGRES_TABLAS);
    expect(conTruncate.ok).toBe(true);
    expect(conTruncate.items.map((i) => i.grantee)).toEqual([
      "postgres",
      "anon",
      "authenticated",
      "service_role",
    ]);
    expect(conTruncate.items.every((i) => i.privilegios.includes("D"))).toBe(true);

    // Opción de concesión (`*`), como la de extensions.
    const conEstrella = parsearAclitems("{postgres=a*r*w*d*D*x*t*m*/supabase_admin}");
    expect(conEstrella.ok).toBe(true);
    expect(conEstrella.items[0].privilegios).toBe("a*r*w*d*D*x*t*m*");

    // Grantee vacío = PUBLIC.
    const publico = parsearAclitems("{=arwdDxtm/postgres}");
    expect(publico.items[0].grantee).toBe("");

    // Y lo que no se entiende, no se inventa.
    expect(parsearAclitems("arwdDxtm").ok).toBe(false);
    expect(parsearAclitems("{anon-arwd-postgres}").ok).toBe(false);
    expect(parsearAclitems(null).nulo).toBe(true);
  });

  it("CABLEADO · --dry declara que la aserción de pg_default_acl NO corrió (y por qué)", () => {
    const { salida } = correr(F_IMPLICITA, "--dry");
    expect(salida).toContain("aserción de pg_default_acl");
    expect(salida).toContain("NO corre en --dry");
    expect(salida).toContain("corre DOS veces (antes y después)");
  });
});
