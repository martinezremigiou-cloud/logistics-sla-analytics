// ============================================================
// Tests del verificador estatico de migraciones (scripts/verificar-migracion.mjs)
//
// POR QUE EXISTEN
// ---------------
// Durante la construccion del verificador, su detector de dollar-quoting
// quedo roto (las clases de caracteres con escapes  colapsaron a
// rangos literales) y el verificador SIGUIO IMPRIMIENDO "VERDE": reportaba
// "0 cuerpo(s) $...$" sobre archivos que si los tienen, o sea que nunca
// llego a mirar el cuerpo de ninguna funcion plpgsql — justo donde vive el
// RAISE que hay que revisar.
//
// Una puerta que falla en silencio es peor que no tener puerta (patron P6
// de docs/engineering/failure-patterns.md). Por eso aqui NO basta con afirmar el
// veredicto verde/rojo: se afirma tambien CUANTO miro el verificador
// (RAISE analizados y cuerpos $...$ recorridos) y, en las rojas, la CLASE
// de error y la LINEA exacta. Si el analisis vuelve a morirse por dentro,
// los conteos cambian y estos tests fallan aunque el veredicto siga verde.
// ============================================================
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
// [S5 · REPRODUCIBILIDAD] transaccionesDeNivelSuperior() se exportó para
// que aplicar-migracion.mjs reuse el MISMO lexer (nunca una regex cruda)
// al decidir dónde splicear su registro del ledger. Import directo (no
// spawnSync): esta función es pura y el `main()` de abajo del archivo
// está guardado tras un check de punto-de-entrada, así que importar NO
// dispara `process.exit()` (ver ese guard en verificar-migracion.mjs).
import { transaccionesDeNivelSuperior } from "./verificar-migracion.mjs";

// `import.meta.url` no es un file:// utilizable bajo la transformacion de
// vitest, asi que la raiz se busca hacia arriba desde el cwd por sus dos
// senas de identidad. Funciona igual desde la raiz o desde un subdirectorio.
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
const VERIFICADOR = join(DIR_SCRIPTS, "verificar-migracion.mjs");
const DIR_FIXTURES = join(DIR_SCRIPTS, "fixtures-verificador");
const MIGRACION_0011 = join(RAIZ, "supabase", "migrations", "0011_taxo.sql");

function correr(...args: string[]) {
  const r = spawnSync(process.execPath, [VERIFICADOR, ...args], {
    encoding: "utf8",
    // El verificador no lee stdin ni variables de entorno del proyecto.
    windowsHide: true,
  });
  if (r.error) throw r.error;
  return { codigo: r.status, salida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const fixture = (nombre: string) => join(DIR_FIXTURES, nombre);

/** Contrato de cada fixture. `codigos` son las clases de error que DEBEN
 *  aparecer; `lineas` las posiciones exactas que deben senalarse. */
const CONTRATO: Array<{
  archivo: string;
  veredicto: "verde" | "rojo";
  codigos?: string[];
  lineas?: number[];
}> = [
  { archivo: "ok_todo_lo_dificil.sql", veredicto: "verde" },
  { archivo: "ok_adversarial.sql", veredicto: "verde" },
  {
    archivo: "rojo_regresion_395.sql",
    veredicto: "rojo",
    codigos: ["RAISE_POCOS_ARGS"],
    lineas: [31],
  },
  {
    archivo: "rojo_desbalances.sql",
    veredicto: "rojo",
    codigos: ["RAISE_POCOS_ARGS", "RAISE_MUCHOS_ARGS", "RAISE_ARG_VACIO", "RAISE_SINTAXIS"],
    lineas: [9, 12, 15, 18, 21, 24, 27],
  },
  {
    archivo: "rojo_ambiguos_y_lexico.sql",
    veredicto: "rojo",
    codigos: ["RAISE_AMBIGUO", "RAISE_CONDICION_DESCONOCIDA", "PARENTESIS_FALTAN"],
    lineas: [8, 11, 14, 19],
  },
  {
    archivo: "rojo_lexico2.sql",
    veredicto: "rojo",
    codigos: ["LEX_DOLAR_ABIERTO"],
    lineas: [7],
  },
];

describe("verificar-migracion · fixtures", () => {
  it("el contrato cubre TODAS las fixtures del directorio (nadie agrega una sin afirmarla)", () => {
    const enDisco = readdirSync(DIR_FIXTURES)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const enContrato = CONTRATO.map((c) => c.archivo).sort();
    expect(enDisco).toEqual(enContrato);
  });

  for (const caso of CONTRATO) {
    it(`${caso.archivo} → ${caso.veredicto.toUpperCase()}`, () => {
      const { codigo, salida } = correr(fixture(caso.archivo));

      if (caso.veredicto === "verde") {
        expect(salida).toContain("VERDE");
        expect(salida).not.toContain("ERROR ");
        expect(codigo).toBe(0);
      } else {
        // Fail-closed: una fixture rota TIENE que salir con exit != 0.
        // Si sale 0, la puerta dejaria pasar la migracion.
        expect(codigo).not.toBe(0);
        expect(salida).toContain("ROJO");
        for (const cod of caso.codigos ?? []) expect(salida).toContain(cod);
        for (const linea of caso.lineas ?? []) {
          expect(salida).toMatch(new RegExp(`${caso.archivo.replace(".", "\\.")}:${linea}:\\d+`));
        }
      }
    });
  }
});

describe("verificar-migracion · anti-silencio (patron P6)", () => {
  // Estas dos afirmaciones son las que atrapan el modo de falla real que
  // tuvo este verificador: analisis muerto por dentro, veredicto VERDE.
  // El conteo de cuerpos $...$ demuestra que SI entro a las funciones.
  it("recorre los cuerpos $...$ anidados de ok_adversarial (no se queda en la superficie)", () => {
    const { salida } = correr(fixture("ok_adversarial.sql"));
    expect(salida).toMatch(/\[7 RAISE .* 3 cuerpo\(s\)/);
  });

  // [REPRODUCIBILIDAD · costura S7-B↔S7-C] Estas dos cifras son una FOTO
  // DEL CONTENIDO de `0011_taxo.sql`, no una propiedad del verificador:
  // cambian cada vez que esa migracion cambia, y eso es deliberado — son el
  // canario contra un lexer que se queda corto y aun asi imprime VERDE.
  //
  // Pasaron de 27 a 32 RAISE porque S7-B agrego los 5 avisos
  // de la rama de universo vacio (ninguna migracion sale del replay,
  // ratificacion S2 punto 2). NO se bajo el numero para que la prueba
  // pasara: se verifico primero contra un oraculo INDEPENDIENTE del lexer
  // —`grep -o "RAISE  *\(NOTICE\|EXCEPTION\|WARNING\|INFO\)" | wc -l` = 32—
  // y contra el balance de cuerpos (8 etiquetas `$tag$`, cada una exactamente
  // 2 veces: abre y cierra). Las dos medidas coinciden con lo que reporta la
  // herramienta, asi que el lexer NO se quedo corto; el literal era el viejo.
  //
  // Si algun dia este test se pone rojo: NO toques el numero antes de correr
  // ese mismo grep. Si el grep y la herramienta discrepan, el rojo es real.
  it("recorre los 8 cuerpos $...$ y los 32 RAISE de 0011_taxo.sql", () => {
    const { salida } = correr(MIGRACION_0011);
    expect(salida).toMatch(/\[32 RAISE .* 8 cuerpo\(s\)/);
  });

  it("el modo --detalle audita RAISE por RAISE y todos cuadran en 0011_taxo.sql", () => {
    const { salida, codigo } = correr(
      "--detalle",
      MIGRACION_0011,
    );
    expect(codigo).toBe(0);
    expect(salida).not.toContain("DESCUADRA");
    // 32 filas de detalle, una por RAISE — misma foto del contenido que
    // arriba, y por la misma razon. Que el DETALLE y el RESUMEN coincidan es
    // lo que prueba que el modo --detalle no audita un subconjunto.
    expect(salida.match(/\| cuadra$/gm) ?? []).toHaveLength(32);
  });
});

// ============================================================
// [S7-C bis · P21] Las DOS ubicaciones congeladas del barrido del repo.
//
// Desde que existe la regla 4 (CATALOGO_COMPARACION_TEXTUAL), el barrido de
// `supabase/migrations/*.sql` sale en 1 de forma PERMANENTE. Es la decision A
// de producto, y estos son los dos unicos sitios — los dos en migraciones YA
// APLICADAS y por eso congeladas. Son casos DISTINTOS y la nota importa:
//
//   0017:183 → true POR ACCIDENTE: el autor escribió los nombres de los parámetros
//              ('p_sku text, p_campo text, p_valor text') y por eso la cadena casa.
//              Nada lo garantiza; renombrar un parámetro rompe el predicado.
//              EXENTO por identidad byte a byte con lo aplicado.
//   0020:729 → true DE VERDAD: función SIN argumentos, cuya lista de identidad es la
//              cadena vacía. NO es un bug latente: es un FALSO POSITIVO de esta regla.
//              NO LO ARREGLES. Exento por lo mismo.
//
// La regla que gobierna las dos exenciones (P21, docs/engineering/failure-patterns.md,
// tal como está escrita):
//
//   > La identidad byte a byte con lo aplicado es el DEFAULT. Se rompe solo
//   > cuando (1) romperla compra un invariante que no se puede obtener de
//   > otra forma, (2) el cambio es demostrablemente neutro respecto del
//   > estado resultante, y (3) esa neutralidad se DEMUESTRA, no se declara.
//
// Ninguno de los dos pasa la (1): los dos predicados salen true hoy, asi que
// tocarlos no compra ningun invariante. Por eso se exentan en vez de
// corregirse.
//
// POR QUE SE CLAVAN LAS UBICACIONES Y NO EL CONTEO. Un test que exigiera
// «el barrido devuelve 2» seguiria VERDE si alguien arreglara la 0017 e
// introdujera uno nuevo en otro archivo: dos menos uno mas dos. Afirmando
// `archivo:linea` uno por uno, el test se pone rojo en los DOS sentidos —
// si aparece una tercera ubicacion y si desaparece una de estas dos.
// ============================================================
const UBICACIONES_CATALOGO_CONGELADAS = [
  "supabase/migrations/0017_mvp2_metadata_por_rpc.sql:183",
  "supabase/migrations/0020_repro_truncate_guarda_pendientes_creado_en.sql:729",
];

/** Todo hallazgo impreso por el CLI: `{ archivo, linea, codigo }`. */
function hallazgosDe(salida: string): Array<{ archivo: string; linea: number; codigo: string }> {
  const re = /^\s+(\S+):(\d+):\d+\s+(?:ERROR|AMBIGUO) ([A-Z_]+)$/gm;
  const limpio = salida.replace(/\r/g, "");
  const out: Array<{ archivo: string; linea: number; codigo: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(limpio)) !== null) out.push({ archivo: m[1], linea: Number(m[2]), codigo: m[3] });
  return out;
}

/** `archivo:linea` de cada hallazgo del codigo pedido. */
function ubicacionesDe(salida: string, codigo: string): string[] {
  return hallazgosDe(salida)
    .filter((h) => h.codigo === codigo)
    .map((h) => `${h.archivo}:${h.linea}`)
    .sort();
}

/** Todos los codigos de hallazgo que aparecen en una salida, con repeticiones. */
function codigosDe(salida: string): string[] {
  return hallazgosDe(salida).map((h) => h.codigo);
}

describe("verificar-migracion · migraciones reales", () => {
  // Puerta de verdad: el barrido por defecto es supabase/migrations/*.sql.
  // Cualquier migracion futura con un RAISE desbalanceado rompe `npm test`
  // ANTES de que el operador intente aplicarla. Eso NO se relaja aqui: lo que
  // cambia es que ahora conviven con las dos ubicaciones congeladas de P21.
  it("el barrido por defecto reporta EXACTAMENTE las dos ubicaciones congeladas de P21 — ni una mas, ni una menos", () => {
    const { codigo, salida } = correr();
    expect(ubicacionesDe(salida, "CATALOGO_COMPARACION_TEXTUAL")).toEqual(UBICACIONES_CATALOGO_CONGELADAS);
    // Rojo permanente y aceptado (decision A de producto): el exit 1 del barrido
    // completo ES el estado esperado mientras esas dos sigan congeladas.
    expect(codigo).toBe(1);
  });

  it("el barrido no reporta NINGÚN otro hallazgo: un RAISE desbalanceado futuro sigue rompiendo la suite", () => {
    // Esta es la mitad que protege lo de antes. Si mañana alguien mete un
    // RAISE con la aridad rota, aquí sale — el rojo permanente de P21 no
    // sirve de tapadera para un rojo nuevo.
    const { salida } = correr();
    const otros = codigosDe(salida).filter((c) => c !== "CATALOGO_COMPARACION_TEXTUAL");
    expect(otros).toEqual([]);
    expect(salida).toMatch(/2 error\(es\) · 0 ambiguedad\(es\)/);
  });

  it("la 0022 NO se marca: su cita del bug vive en comentarios, y ya está corregida con to_regprocedure", () => {
    // Control negativo CONTRA EL REPO REAL, no contra un fixture: la cadena
    // exacta del bug está en 0022:421 dentro de un comentario `--`, que a su
    // vez vive dentro de un cuerpo `$...$`. Una regla hecha con grep marcaría
    // el archivo donde el bug YA está arreglado.
    const { codigo, salida } = correr(join(RAIZ, "supabase", "migrations", "0022_repro_registro_de_forzado.sql"));
    expect(codigo).toBe(0);
    expect(salida).toContain("VERDE");
    expect(ubicacionesDe(salida, "CATALOGO_COMPARACION_TEXTUAL")).toEqual([]);
    // Y la 0022 sí usa la forma correcta, así que la regla no tenía nada que
    // mirar ahí: cero llamadas de las que renderizan texto.
    expect(salida).toMatch(/0022_repro_registro_de_forzado\.sql\s+\[\d+ RAISE · \d+ cuerpo\(s\) \$\.\.\.\$ · 0 pg_get_\*\(\) textual\(es\)\]/);
  });
});

// ============================================================
// [S7-C bis · P21] REGLA 4 · comparación literal contra
// pg_get_function_identity_arguments()
//
// PRUEBA DE VACUIDAD (P19), que aquí es doble porque el patrón es doble:
//   · ¿puede ponerse ROJA?  → 9010, con las siete formas de la comparación.
//   · ¿puede ponerse VERDE? → 9011 (to_regprocedure) y 9012 (control
//     negativo). Una regla que marcara los dos sería inservible: empujaría
//     de vuelta a la comparación de texto que causó el bug.
// Los fixtures viven en `fixtures-aplicador/` (el conjunto de archivos de
// este frente); el CONTRATO de `fixtures-verificador/` no los cubre y por
// eso se afirman aquí, uno por uno.
// ============================================================
const DIR_FIXTURES_P21 = join(DIR_SCRIPTS, "fixtures-aplicador");
const fixtureP21 = (nombre: string) => join(DIR_FIXTURES_P21, nombre);

describe("verificar-migracion · regla 4 · comparación literal contra pg_get_*() (P21)", () => {
  it("ROJO · las siete formas de la comparación literal se marcan, con línea exacta", () => {
    const { codigo, salida } = correr(fixtureP21("9010_catalogo_comparacion_literal.sql"));
    expect(codigo).not.toBe(0);
    // Las siete: `=` en los dos órdenes, `<>`, `!=`, `IN (...)`, `LIKE`, y
    // una con `::text` de por medio (que no basta con mirar el token
    // inmediatamente posterior al paréntesis de cierre).
    const lineas = ubicacionesDe(salida, "CATALOGO_COMPARACION_TEXTUAL").map((u) => Number(u.split(":")[1]));
    expect(lineas).toEqual([25, 31, 37, 43, 49, 55, 62]);
    // El mensaje TIENE que decir cómo se arregla, textualmente.
    expect(salida).toContain("usa to_regprocedure('esquema.func(tipos)')");
  });

  it("ROJO pero AMBIGUO · comparar contra una VARIABLE no se afirma como error (fail-closed)", () => {
    const { salida } = correr(fixtureP21("9010_catalogo_comparacion_literal.sql"));
    expect(ubicacionesDe(salida, "CATALOGO_COMPARACION_AMBIGUA")).toEqual([
      "scripts/fixtures-aplicador/9010_catalogo_comparacion_literal.sql:69",
    ]);
    expect(salida).toContain("REVISION HUMANA");
    // Y la variable se nombra: un AMBIGUO sin decir qué vio no es revisable.
    expect(salida).toContain('palabra "v_firma"');
  });

  it("VERDE · la forma correcta (to_regprocedure) NO se marca — si se marcara, la regla sería inservible", () => {
    const { codigo, salida } = correr(fixtureP21("9011_catalogo_to_regprocedure_ok.sql"));
    expect(codigo).toBe(0);
    expect(salida).toContain("VERDE");
    expect(codigosDe(salida)).toEqual([]);
    // ANTI-SILENCIO (P6): el verde solo vale si la regla MIRÓ. El fixture
    // tiene una llamada legítima a la función de catálogo (leerla para
    // imprimirla), y el contador tiene que acusarla.
    expect(salida).toMatch(/9011_catalogo_to_regprocedure_ok\.sql\s+\[\d+ RAISE · \d+ cuerpo\(s\) \$\.\.\.\$ · 1 pg_get_\*\(\) textual\(es\)\]/);
  });

  it("CONTROL NEGATIVO · la misma cadena en comentarios y en un literal NO dispara (el lexer, no un grep)", () => {
    // Éste es el control que separa "cazar un predicado" de "cazar un texto".
    // El repo YA contiene el caso: 0022:421 cita la línea vieja dentro de un
    // comentario `--` que vive dentro de un cuerpo `$...$`.
    const { codigo, salida } = correr(fixtureP21("9012_catalogo_solo_texto_no_predicado.sql"));
    expect(codigo).toBe(0);
    expect(salida).toContain("VERDE");
    expect(codigosDe(salida)).toEqual([]);
    // Cero llamadas vistas: el lexer no emitió ni un token por ninguna de las
    // seis apariciones de la cadena.
    expect(salida).toMatch(/9012_catalogo_solo_texto_no_predicado\.sql\s+\[\d+ RAISE · \d+ cuerpo\(s\) \$\.\.\.\$ · 0 pg_get_\*\(\) textual\(es\)\]/);
  });

  it("ve DENTRO de los cuerpos $...$: los dos sitios reales del repo viven en bloques DO", () => {
    // Una regla que solo mirara el nivel superior saldría verde sobre 0017 y
    // 0020, que es donde de verdad está el patrón.
    const { salida } = correr(join(RAIZ, "supabase", "migrations", "0017_mvp2_metadata_por_rpc.sql"));
    expect(ubicacionesDe(salida, "CATALOGO_COMPARACION_TEXTUAL")).toEqual([
      "supabase/migrations/0017_mvp2_metadata_por_rpc.sql:183",
    ]);
  });
});

describe("transaccionesDeNivelSuperior · exportada para aplicar-migracion.mjs (auditoría adversarial)", () => {
  // Reemplaza, en aplicar-migracion.mjs, a una regex cruda
  // (`/^[ \t]*COMMIT[ \t]*;/im`) que SÍ spliceaba dentro de un comentario o
  // de un cuerpo $...$ — ver la cabecera de aplicar-migracion.test.ts.
  it("archivo sin BEGIN;/COMMIT; propios: 0 de todo, sin posiciones", () => {
    const r = transaccionesDeNivelSuperior("SELECT 1;\nSELECT 2;\n");
    expect(r).toEqual({ nBegin: 0, nCommit: 0, nRollback: 0, posicionesCommit: [], roto: false });
  });

  it("transacción explícita real: cuenta 1/1/0 y ubica el COMMIT; exacto", () => {
    const sql = "BEGIN;\nSELECT 1;\nCOMMIT;\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r.nBegin).toBe(1);
    expect(r.nCommit).toBe(1);
    expect(r.nRollback).toBe(0);
    expect(r.roto).toBe(false);
    expect(r.posicionesCommit).toHaveLength(1);
    expect(sql.slice(r.posicionesCommit[0], r.posicionesCommit[0] + 6)).toBe("COMMIT");
  });

  it("START TRANSACTION; cuenta como BEGIN (mismo criterio que revisarTransaccion)", () => {
    const r = transaccionesDeNivelSuperior("START TRANSACTION;\nSELECT 1;\nCOMMIT;\n");
    expect(r.nBegin).toBe(1);
    expect(r.nCommit).toBe(1);
  });

  it("un BEGIN;/COMMIT; de EJEMPLO dentro de /* ... */ NO cuenta (auditoría adversarial, caso 1)", () => {
    const sql = "/*\n  Ejemplo:\n    BEGIN;\n    COMMIT;\n*/\nSELECT 1;\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r).toEqual({ nBegin: 0, nCommit: 0, nRollback: 0, posicionesCommit: [], roto: false });
  });

  it("un BEGIN;/COMMIT; de EJEMPLO dentro de -- comentario de línea NO cuenta", () => {
    const sql = "-- BEGIN;\n-- COMMIT;\nSELECT 1;\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r.nBegin).toBe(0);
    expect(r.nCommit).toBe(0);
  });

  it("un BEGIN;/COMMIT; de EJEMPLO dentro de un cuerpo $doc$...$doc$ NO cuenta (auditoría adversarial, caso 2)", () => {
    const sql =
      "CREATE OR REPLACE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $doc$\n" +
      "/*\n  Ejemplo:\n    BEGIN;\n    COMMIT;\n*/\n" +
      "BEGIN\n  NULL;\nEND;\n$doc$;\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r.nBegin).toBe(0); // el BEGIN real del bloque plpgsql no lleva ';' pegado
    expect(r.nCommit).toBe(0);
    expect(r.roto).toBe(false);
  });

  it("un BEGIN;/COMMIT; de EJEMPLO dentro de una cadena 'texto...' NO cuenta", () => {
    const sql = "SELECT 'nota: BEGIN;\nCOMMIT;\n';\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r.nBegin).toBe(0);
    expect(r.nCommit).toBe(0);
  });

  it("dos transacciones explícitas: ubica AMBOS COMMIT;, en orden", () => {
    const sql = "BEGIN;\nSELECT 1;\nCOMMIT;\n\nBEGIN;\nSELECT 2;\nCOMMIT;\n";
    const r = transaccionesDeNivelSuperior(sql);
    expect(r.nBegin).toBe(2);
    expect(r.nCommit).toBe(2);
    expect(r.posicionesCommit).toHaveLength(2);
    expect(r.posicionesCommit[0]).toBeLessThan(r.posicionesCommit[1]);
  });

  it("léxico roto (comentario de bloque sin cerrar): roto=true, fail-closed", () => {
    const r = transaccionesDeNivelSuperior("/* nunca cierra\nBEGIN;\nCOMMIT;\n");
    expect(r.roto).toBe(true);
  });

  it("léxico roto (dollar-quote sin cerrar): roto=true, fail-closed", () => {
    const r = transaccionesDeNivelSuperior("SELECT $doc$ nunca cierra\nBEGIN;\nCOMMIT;\n");
    expect(r.roto).toBe(true);
  });
});
