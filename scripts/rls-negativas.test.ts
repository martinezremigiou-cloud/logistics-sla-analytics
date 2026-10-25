// ============================================================
// Tests de scripts/rls-negativas.mjs — batería de pruebas NEGATIVAS de RLS
// para clasificacion_v2, tecnologias, pendientes_datos y storage.objects
// (gap declarado B6-5 / QA-REG-04 — ver docs/known-limitations.md (B6-5), patrón P4
// de docs/engineering/failure-patterns.md). [INV-B7B] carril F.
//
// NOTA DEL REPO PÚBLICO: este archivo está EXCLUIDO de `npm test` y del CI
// (`test.exclude` en vitest.config.ts) porque su sección en vivo necesita una
// base Supabase corriendo. Se conserva y se corre a mano: quita esa ruta de
// `test.exclude` y corre `npx vitest run scripts/rls-negativas.test.ts`, o
// ejecuta `node scripts/rls-negativas.mjs` contra una base local (ver supabase/README.md).
//
// POR QUÉ EXISTEN
// ---------------
// El hallazgo que define el diseño de la batería (medido en vivo, ver la
// cabecera de rls-negativas.mjs): SELECT/UPDATE/DELETE denegados por RLS
// responden `200 []` — silenciosos — y solo INSERT y las RPC gritan. Una
// prueba que solo mirara el status HTTP daría VERDE sobre un DELETE que en
// realidad SÍ borró la fila. Por eso este archivo prueba tres capas
// DISTINTAS, cada una corrible de forma independiente:
//
//   1) LA MATRIZ DECLARADA (4 tablas × 4 verbos × 3 roles + 6 RPC × 3 roles
//      = 66 casos) — sin red, SIEMPRE corre, para que borrar un caso se
//      ponga rojo aunque nadie tenga credenciales (patrón P6: un gap
//      declarado con un skip permanente y mudo ES el patrón P4 otra vez).
//   2) EL EVALUADOR PURO (evaluarLectura/evaluarEscritura/evaluarRpc) contra
//      escenarios sintéticos — sin red, SIEMPRE corre, e incluye el
//      escenario ANTI-P4 (un DELETE con status 200 que SÍ cambió el estado):
//      es el mismo escenario que se usa para la demostración del mutante que
//      pide el bloque (mutar evaluarEscritura a "solo status" y comprobar
//      que ese mutante SÍ marcaría ok:true sobre la fuga simulada — la
//      corrida con y sin el mutante quedó pegada en el reporte del bloque,
//      no como código permanente en este archivo).
//   3) LA BATERÍA EN VIVO contra el proyecto Supabase real — solo se intenta
//      si las 3 variables base de Supabase existen (ver README.md) y solo
//      corre de verdad si además se pueden fabricar y loguear sus 2 cuentas
//      EFÍMERAS kam/visitante (no permanentes — cada corrida crea y destruye
//      las suyas, con guardas P9 de docs/engineering/failure-patterns.md — ver el
//      detalle de D1/D2/D3 más abajo), con un console.warn EXPLÍCITO en
//      cualquier caso en que se omita.
// ============================================================
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join } from "node:path";

// Mismo patrón que scripts/verificar-migracion.test.ts: `import.meta.url` no
// es un file:// utilizable bajo la transformación de vitest, así que la raíz
// se busca hacia arriba desde el cwd por sus dos señas de identidad.
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
  throw new Error(`No encuentro la raíz del repo partiendo de ${process.cwd()}`);
}

const RAIZ = raizRepo();
const SCRIPT = join(RAIZ, "scripts", "rls-negativas.mjs");

type Veredicto = { ok: boolean; detalle: string };
type ResultadoCaso = {
  grupo: "tabla" | "rpc";
  tabla?: string;
  rpc?: string;
  verbo?: string;
  rol: "anon" | "kam" | "visitante";
  esperado: string;
  omitido?: boolean;
  motivoOmision?: string;
  veredicto?: Veredicto;
};
type Estructura = {
  tablas: string[];
  verbos: string[];
  roles: string[];
  rpcs: string[];
  totalCasosTabla: number;
  totalCasosRpc: number;
  totalCasos: number;
};
type Autotest = {
  escenarios: Array<{ nombre: string; ok: boolean; esperadoOk: boolean; correcto: boolean; detalle: string }>;
  todosCorrectos: boolean;
};
// [INV-B7B corrección, ronda anterior] D1: los 3 estados REALES de las
// credenciales — antes solo existía `hayCredenciales: boolean`, que
// únicamente confirmaba que las variables EXISTIERAN (P6: una guarda de
// PRESENCIA, no de CAPACIDAD).
// [INV-B7B cierre — ESTE cambio] Ya no hay cuentas de prueba PERMANENTES que
// puedan estar "muertas": cada corrida fabrica y destruye sus propias 2
// cuentas efímeras (kam + visitante) — ver `rls-negativas.mjs`. El estado
// `cuentas_muertas` se renombra a `entorno_no_disponible`: cubre cualquier
// fallo al fabricar esas cuentas o iniciar su sesión (service_role inválida,
// red caída, proyecto pausado, etc.), nunca "la cuenta fija ya no existe" —
// ya no existe el concepto de una cuenta fija que este archivo dependa de
// encontrar.
type EstadoCredenciales = "sin_variables" | "cuentas_vivas" | "entorno_no_disponible";
type VerificacionLogin = { estado: EstadoCredenciales; faltantes: string[]; detalle: string | null };
type CorridaBateria = {
  estructura: Estructura;
  credenciales: VerificacionLogin;
  resumen: { total: number; ok: number; fallos: number; omitidos: number } | null;
  resultados: ResultadoCaso[] | null;
};

// `vitest.config.ts` inyecta valores FALSOS de Supabase (`sb_publishable_test`,
// `sb_secret_test`, ...) en `test.env` para que el RESTO de la suite (que
// mockea `fetch`) nunca dependa de credenciales reales. Ese `process.env` del
// runner se hereda por defecto en `spawnSync` — si lo dejáramos pasar tal
// cual, `cargarEnvLocal()` del script hijo vería esas claves "ya presentes"
// y NUNCA leería los valores reales de `.env.local`: la batería en vivo
// fallaría con un "Invalid API key" que parece un bug de RLS pero es
// contaminación de entorno (patrón P1, docs/engineering/failure-patterns.md). Se
// eliminan explícitamente antes de heredar el resto del entorno del runner.
function envParaHijo(): NodeJS.ProcessEnv {
  const limpio = { ...process.env };
  delete limpio.NEXT_PUBLIC_SUPABASE_URL;
  delete limpio.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete limpio.SUPABASE_SERVICE_ROLE_KEY;
  delete limpio.INGEST_SECRET;
  return limpio;
}

/** Corre el script con `--json` SIEMPRE al final y parsea la ÚLTIMA línea no
 *  vacía de stdout (defensivo ante cualquier ruido que se cuele antes del
 *  único `console.log(JSON.stringify(...))` real del script). */
function correrJson<T>(...args: string[]): T {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, "--json"], {
    encoding: "utf8",
    windowsHide: true,
    env: envParaHijo(),
  });
  if (r.error) throw r.error;
  const lineas = (r.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  const ultima = lineas[lineas.length - 1];
  if (!ultima) {
    throw new Error(`rls-negativas.mjs ${args.join(" ")} no produjo salida JSON. stderr:\n${r.stderr}`);
  }
  return JSON.parse(ultima) as T;
}

/**
 * [INV-B7B cierre] Como `correrJson`, pero SOLO para la corrida en vivo, y
 * con una guarda extra que `correrJson` a propósito no tiene: exige que el
 * exit code del proceso hijo NO sea 2.
 *
 * Por qué hace falta un chequeo aparte: el contrato de exit code de
 * `rls-negativas.mjs` documenta 2 = "error inesperado (bug real) O la
 * limpieza de las 2 cuentas efímeras falló" (P9) — y esa limpieza corre en
 * el `finally` de `main()`, DESPUÉS de que el único
 * `console.log(JSON.stringify(...))` ya se imprimió. Si esta función se
 * limitara a parsear el JSON como `correrJson`, un fallo de limpieza (que
 * deja UUID reales vivos y exige borrado manual) podría convivir con un
 * JSON de "66/66 en verde" perfectamente válido — invisible para la suite,
 * exactamente el patrón P6 (cobertura que da falsa confianza) que este
 * mismo archivo existe para combatir. El mensaje incluye el `stderr`
 * completo del hijo porque ahí es donde `destruirFixturesConGuardas`
 * imprime los UUID exactos que quedaron vivos.
 *
 * Exit 0/1 se dejan pasar tal cual: 1 ("¿algún caso de la matriz falló de
 * verdad?") ya lo cazan con detalle las aserciones de contenido de abajo
 * (`resumen.fallos`, con el JSON completo de los casos en rojo) — duplicar
 * ese chequeo aquí solo perdería ese detalle sin ganar nada.
 */
function correrBateriaEnVivoJson(): CorridaBateria {
  const r = spawnSync(process.execPath, [SCRIPT, "--json"], {
    encoding: "utf8",
    windowsHide: true,
    env: envParaHijo(),
  });
  if (r.error) throw r.error;
  if (r.status === 2) {
    throw new Error(
      `rls-negativas.mjs salió con exit 2 — bug real O LIMPIEZA DE CUENTAS EFÍMERAS FALLIDA (P9). ` +
        `stderr completo del hijo (ahí viven los UUID exactos que podrían seguir vivos):\n${r.stderr}`,
    );
  }
  const lineas = (r.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  const ultima = lineas[lineas.length - 1];
  if (!ultima) {
    throw new Error(`rls-negativas.mjs --json no produjo salida JSON (exit=${r.status}). stderr:\n${r.stderr}`);
  }
  return JSON.parse(ultima) as CorridaBateria;
}

// ============================================================
// 1) LA MATRIZ DECLARADA — sin red, SIEMPRE corre.
// ============================================================
describe("rls-negativas · matriz declarada (sin credenciales, siempre corre)", () => {
  const estructura = correrJson<Estructura>("--solo-estructura");

  it("declara exactamente las 4 tablas post-B1 con RLS negativas pendientes (deuda B6-5)", () => {
    expect([...estructura.tablas].sort()).toEqual(
      ["clasificacion_v2", "familia_alias", "pendientes_datos", "storage.objects", "tecnologias"].sort(),
    );
  });

  it("declara los 4 verbos y los 3 roles de la matriz", () => {
    expect([...estructura.verbos].sort()).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"].sort());
    expect([...estructura.roles].sort()).toEqual(["anon", "kam", "visitante"].sort());
  });

  it("declara los 11 RPC de la matriz (las 6 de B7-B + las 5 que añadió [MVP-2])", () => {
    expect([...estructura.rpcs].sort()).toEqual(
      [
        "is_admin",
        "contar_pendientes",
        "resolver_pendiente",
        "aplicar_override",
        "aplicar_clasificacion_v2",
        "ingest_snapshot",
        // [MVP-2] · condición 1 de la auditoría: sin estas 5, nadie había
        // probado que un KAM no puede escribir metadata ni fusionar familias
        // — que es justo lo que esos frentes afirman asegurar.
        "aplicar_metadata",
        "fusionar_familia",
        "desfusionar_familia",
        "resolver_familia_nueva",
        "sincronizar_pendientes_familia",
      ].sort(),
    );
  });

  it("la matriz completa es 5 tablas × 4 verbos × 3 roles (60) + 11 RPC × 3 roles (33) = 93 — si alguien borra UN caso, esto se pone rojo", () => {
    expect(estructura.totalCasosTabla).toBe(60);
    expect(estructura.totalCasosRpc).toBe(33);
    expect(estructura.totalCasos).toBe(93);
  });
});

// ============================================================
// 2) EL EVALUADOR PURO — sin red, SIEMPRE corre.
// ============================================================
describe("rls-negativas · evaluador puro (sin red, siempre corre)", () => {
  const autotest = correrJson<Autotest>("--autotest-evaluador");

  it("los 9 escenarios sintéticos del evaluador se comportan como se documenta", () => {
    expect(autotest.escenarios).toHaveLength(9);
    for (const e of autotest.escenarios) {
      expect(e.correcto, `${e.nombre} → ok=${e.ok} (esperaba ${e.esperadoOk}): ${e.detalle}`).toBe(true);
    }
    expect(autotest.todosCorrectos).toBe(true);
  });

  it("ANTI-P4: un DELETE que responde 200 pero SÍ cambió el estado se marca ok:false, no éxito — este es el escenario del mutante", () => {
    const caso = autotest.escenarios.find((e) => e.nombre.startsWith("ANTI-P4"));
    expect(caso, "falta el escenario ANTI-P4 en el autotest").toBeDefined();
    expect(caso!.ok).toBe(false);
  });

  it("la TRAMPA de SELECT (0 filas del rol Y 0 filas del testigo) no se confunde con 'denegado' válido", () => {
    const caso = autotest.escenarios.find((e) => e.nombre.startsWith("TRAMPA-P4"));
    expect(caso, "falta el escenario TRAMPA-P4 en el autotest").toBeDefined();
    expect(caso!.ok).toBe(false);
  });
});

// ============================================================
// 2-bis) LA SONDA DE LATENCIA DEL `beforeAll` EN VIVO — sin red en ESTAS
// pruebas, SIEMPRE corren. [2.0.1-C] ESTO NO ES UN FIX DEL BLOQUE: es una
// CONTRAMEDIDA HEREDADA de 2.0.1-B, escrita al cerrar ese bloque, cuyo
// disparador se cumplió hoy:
//
//   «La segunda vez que un arnés en vivo agote su timeout, su `beforeAll`
//   tiene que MEDIR y DECLARAR — salir SIN VEREDICTO con la latencia, en vez
//   de un timeout pelón.»
//
// Es la segunda. Medido: `Error: Hook timed out in 180000ms.`
// en el `beforeAll` de la sección 3 (línea ~312 antes de este cambio),
// `RLS_EXIT=1`. Latencia de ESA máquina, 3 muestras por destino:
// `1.1.1.1` 6 079 ms · `registry.npmjs.org` 3 039 ms · Supabase 2 978 ms —
// Supabase fue el destino MÁS RÁPIDO de los tres, o sea la red de la
// máquina estaba degradada, no el servicio ni el arnés. Sin esta sonda, el
// mensaje `Hook timed out` acusa al código.
//
// EL PRESUPUESTO SE CALCULA, NO SE ADIVINA
// -----------------------------------------
// `TOTAL_CASOS_MATRIZ` × `LLAMADAS_POR_CASO` × mediana medida, contra
// `HOOK_TIMEOUT_BATERIA_MS` (el MISMO número que ya se le pasa a `beforeAll`
// más abajo — una sola constante, no dos que puedan divergir).
//
// `LLAMADAS_POR_CASO = 3` no es arbitrario: es una cota superior leída del
// propio `rls-negativas.mjs` —
//   · SELECT de tabla (`correrCasoTabla`): 2 llamadas (rol + testigo).
//   · INSERT/UPDATE/DELETE de tabla: 3 (`leerFilaPorColumna` antes,
//     `intentarEscrituraTabla`, `leerFilaPorColumna` después).
//   · RPC (`correrCasoRpc`): 1 llamada.
//   · Storage puede llegar a 4-6 (hay un `subirFixture`/`leerObjetoStorage`
//     de más por caso) pero son solo 12 de los 93 casos — 3 como cota para
//     TODOS los casos ya sobreestima el conteo real medido (~227 llamadas
//     reales para 93 casos, contra 279 = 93×3): el margen es deliberado,
//     porque esta sonda tiene que errar hacia ABORTAR de más, no de menos.
// No cuenta el overhead fijo de fixtures (login, siembra/limpieza de
// storage, alta/baja de las 2 cuentas efímeras, ~14 llamadas) — es
// constante frente a 279 y no cambia la conclusión.
//
// CONTROLES POSITIVOS (bloque QA-2.0.1-C): los dos primeros `it` de abajo
// prueban que `evaluarPresupuestoLatencia` (pura, sin red) SÍ distingue red
// lenta de red sana con medianas INYECTADAS; el tercero (anti-vacuidad)
// prueba que el camino de aborto de verdad LANZA con "SIN VEREDICTO" en el
// mensaje — nunca un pase silencioso.
// ============================================================

/** Mediana de N muestras — sin dependencias, N=3 es impar así que siempre
 *  cae en un elemento real (sin promediar dos). Se deja general (par/impar)
 *  porque probarla con ambos casos es gratis y una mediana mal calculada
 *  invalidaría toda la decisión de aborto. */
export function mediana(valores: number[]): number {
  if (valores.length === 0) throw new Error("mediana: arreglo vacío");
  const ordenado = [...valores].sort((a, b) => a - b);
  const mitad = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 !== 0 ? ordenado[mitad] : (ordenado[mitad - 1] + ordenado[mitad]) / 2;
}

// Mismo número que el segundo argumento de `beforeAll` en la sección 3 —
// UNA sola constante para que el presupuesto y el timeout real de vitest
// nunca puedan divergir en silencio. NO SE SUBE (decisión explícita de producto
// al cerrar 2.0.1-B): si el margen se gasta en la red, el día que el código
// se ponga lento de verdad este arnés ya no lo caza.
export const HOOK_TIMEOUT_BATERIA_MS = 180_000;
// 60 casos de tabla + 33 de RPC — el mismo total que afirma el `it` de la
// sección 1 ("la matriz completa es ... 93"). Si la matriz crece, ESE `it`
// se pone rojo primero y avisa de actualizar este número también.
export const TOTAL_CASOS_MATRIZ = 93;
export const LLAMADAS_POR_CASO = 3;

export type DestinoMasLento = "supabase" | "neutral" | "empate";

// [2.0.1-C · corrección] `destinoMasLento` NO puede decidirse con un `>`
// pelado: eso exige que dos medianas de red coincidan al milisegundo exacto
// para llamarlas "empate", y una medición de red NUNCA cae ahí — es un
// umbral que no separa (P20). Lo destapó una corrida real de este mismo
// archivo: **Supabase 1037 ms · neutral 997 ms** (4 % de diferencia,
// indistinguible del ruido) salió declarando "Supabase es el más lento",
// colgándole al hallazgo un adjetivo que nadie midió (P29) — y en la
// corrida siguiente, con **Supabase 3483 ms · neutral 5571 ms**, el
// veredicto se hubiera invertido sin que cambiara nada del mundo real.
//
// La corrección: "empate" es una BANDA, no una igualdad. Un destino se
// declara "más lento" solo cuando supera al otro por un FACTOR que el ruido
// no explica.
//
// `FACTOR_EMPATE_LATENCIA = 1.5`: elegido porque las dos corridas de arriba
// (mismo par de destinos, misma máquina, minutos de diferencia) ya variaron
// ~1.6× entre sí sin que la red "cambiara de opinión" sobre quién es el
// servicio lento — un factor menor habría seguido separando por ruido; 1.5×
// exige que el más lento le saque al más rápido la mitad de su propio
// tiempo, que ninguna de las dos corridas medidas por sí sola alcanza a
// explicar como jitter normal.
export const FACTOR_EMPATE_LATENCIA = 1.5;

/** PURA — sin red. Un destino solo se declara "más lento" si le saca al
 *  otro un factor ≥ `FACTOR_EMPATE_LATENCIA`; por debajo de eso es "empate":
 *  los dos están igual de lentos y la causa es la red de la máquina, no
 *  cuál de los dos servidores se mida más rápido en una muestra puntual. */
export function destinoMasLentoDe(medianaSupabaseMs: number, medianaNeutralMs: number): DestinoMasLento {
  const masLento = Math.max(medianaSupabaseMs, medianaNeutralMs);
  const masRapido = Math.min(medianaSupabaseMs, medianaNeutralMs);
  if (masLento === 0) return "empate"; // ambas medianas en 0 ms: empate exacto, sin división que hacer
  const razon = masRapido === 0 ? Infinity : masLento / masRapido;
  if (razon < FACTOR_EMPATE_LATENCIA) return "empate";
  return medianaSupabaseMs > medianaNeutralMs ? "supabase" : "neutral";
}

export interface PresupuestoLatencia {
  cabe: boolean;
  estimadoMs: number;
  medianaSupabaseMs: number;
  medianaNeutralMs: number;
  destinoMasLento: DestinoMasLento;
  totalCasos: number;
  llamadasPorCaso: number;
  hookTimeoutMs: number;
}

/**
 * PURA — sin red, siempre corre. Decide si la batería en vivo cabe en el
 * `hookTimeout` dadas las medianas YA MEDIDAS (inyectadas, nunca medidas
 * aquí adentro). El presupuesto usa la mediana de SUPABASE (es el destino
 * real que la batería llama 279 veces) — la mediana NEUTRAL viaja en el
 * resultado solo para el DIAGNÓSTICO del mensaje: distingue "Supabase está
 * lento/caído" (Supabase es notablemente el más lento de los dos, por fuera
 * de la banda de ruido) de "esta máquina no tiene red" (los dos destinos
 * están igual de lentos, dentro de la banda — ver `destinoMasLentoDe`).
 */
export function evaluarPresupuestoLatencia(
  medianaSupabaseMs: number,
  medianaNeutralMs: number,
  totalCasos: number = TOTAL_CASOS_MATRIZ,
  llamadasPorCaso: number = LLAMADAS_POR_CASO,
  hookTimeoutMs: number = HOOK_TIMEOUT_BATERIA_MS,
): PresupuestoLatencia {
  const estimadoMs = totalCasos * llamadasPorCaso * medianaSupabaseMs;
  const destinoMasLento = destinoMasLentoDe(medianaSupabaseMs, medianaNeutralMs);
  return {
    cabe: estimadoMs < hookTimeoutMs,
    estimadoMs,
    medianaSupabaseMs,
    medianaNeutralMs,
    destinoMasLento,
    totalCasos,
    llamadasPorCaso,
    hookTimeoutMs,
  };
}

/** El mensaje SIN VEREDICTO, literal — con los números, en es-MX. */
export function mensajeSinVeredicto(p: PresupuestoLatencia): string {
  const destinoTexto =
    p.destinoMasLento === "supabase"
      ? `Supabase — le saca al neutral un factor ≥${FACTOR_EMPATE_LATENCIA}×, por fuera del ruido: podría ser el servicio, no solo la red de esta máquina`
      : p.destinoMasLento === "neutral"
        ? `el destino neutral — le saca a Supabase un factor ≥${FACTOR_EMPATE_LATENCIA}×, por fuera del ruido: la red de ESTA máquina está degradada en general, no Supabase`
        : `ninguno — los dos destinos están IGUAL DE LENTOS (diferencia menor a ${FACTOR_EMPATE_LATENCIA}×, dentro del ruido de red): es la red de ESTA máquina, no el servicio`;
  return (
    `SIN VEREDICTO — esta corrida NO prueba que la RLS esté bien ni mal, y NO es un fallo del código: ` +
    `la latencia de red de esta máquina hace IMPOSIBLE que la batería de ${p.totalCasos} casos quepa en el ` +
    `hookTimeout de ${p.hookTimeoutMs} ms. Presupuesto = ${p.totalCasos} casos × ${p.llamadasPorCaso} llamadas/caso × ` +
    `${p.medianaSupabaseMs.toFixed(0)} ms (mediana a Supabase) = ${p.estimadoMs.toFixed(0)} ms estimados, contra un ` +
    `hookTimeout de ${p.hookTimeoutMs} ms. Medianas medidas — Supabase: ${p.medianaSupabaseMs.toFixed(0)} ms · neutral: ` +
    `${p.medianaNeutralMs.toFixed(0)} ms. Destino más lento: ${destinoTexto}. Vuelve a correr esta batería cuando la red mejore.`
  );
}

/** Falla CERRADO: si no cabe, LANZA (nunca devuelve silenciosamente). Este
 *  es el único punto que el `beforeAll` de la sección 3 llama antes de
 *  intentar la batería real. */
export function abortarSiNoCabe(p: PresupuestoLatencia): void {
  if (!p.cabe) {
    throw new Error(mensajeSinVeredicto(p));
  }
}

describe("rls-negativas · sonda de latencia del beforeAll en vivo (sin red, siempre corre)", () => {
  it("detecta la red lenta: con una mediana inyectada muy por encima del umbral, dice que NO CABE", () => {
    // Umbral real: 180000 / (93×3) ≈ 645 ms. 2978 ms es el valor medido hoy contra Supabase.
    const p = evaluarPresupuestoLatencia(2978, 6079);
    expect(p.cabe).toBe(false);
    expect(p.estimadoMs).toBe(93 * 3 * 2978);
  });

  it("NO se dispara con red sana: con una mediana inyectada de decenas de ms, dice que CABE", () => {
    const p = evaluarPresupuestoLatencia(35, 28);
    expect(p.cabe).toBe(true);
    expect(p.estimadoMs).toBe(93 * 3 * 35);
  });

  it("ANTI-VACUIDAD: el camino de aborto de verdad LANZA (nunca un pase silencioso) y el mensaje dice SIN VEREDICTO", () => {
    const lento = evaluarPresupuestoLatencia(2978, 6079);
    expect(() => abortarSiNoCabe(lento)).toThrow(/SIN VEREDICTO/);

    const sano = evaluarPresupuestoLatencia(35, 28);
    expect(() => abortarSiNoCabe(sano)).not.toThrow();
  });

  it("la mediana de 3 muestras (N usado por la sonda real) cae en el valor central, no en un promedio", () => {
    expect(mediana([10, 30, 20])).toBe(20);
    expect(mediana([100, 100, 100])).toBe(100);
  });

  // ------------------------------------------------------------
  // [2.0.1-C · corrección] `destinoMasLentoDe` — la banda de "empate", no la
  // igualdad exacta que tenía antes. Los 4 controles que pidió la revisión:
  // el caso REAL que destapó el defecto, la orilla ya existente (no se
  // toca), la orilla que faltaba (Supabase claramente el lento) y los dos
  // bordes exactos de la banda — porque medir el centro no mide la banda.
  // ------------------------------------------------------------
  describe("destinoMasLentoDe · la banda de empate", () => {
    it('el caso REAL que destapó el defecto: Supabase 1037 ms / neutral 997 ms (4 % de diferencia) es "empate", no "supabase"', () => {
      // Medido en esta misma máquina al correr este archivo — la corrida
      // anterior a esta corrección declaraba "Supabase es el más lento" por
      // 40 ms de diferencia (razón 1037/997 ≈ 1.04×), muy por debajo de
      // FACTOR_EMPATE_LATENCIA (1.5×): es ruido, no señal.
      expect(destinoMasLentoDe(1037, 997)).toBe("empate");
    });

    it('fuera de la banda sigue separando (control preexistente, sin tocar): Supabase 2978 ms / neutral 6079 ms (2,04×) sigue siendo "neutral"', () => {
      expect(destinoMasLentoDe(2978, 6079)).toBe("neutral");
    });

    it('la otra orilla: Supabase claramente el más lento (5000 ms / 1000 ms, 5×) dice "supabase" — antes esta rama no tenía control propio', () => {
      expect(destinoMasLentoDe(5000, 1000)).toBe("supabase");
    });

    it("los dos bordes exactos de la banda (1.5×): justo DENTRO es empate, justo FUERA separa — medir el centro no mide la banda", () => {
      // Justo DENTRO: 149/100 = 1.49× < 1.5× → empate.
      expect(destinoMasLentoDe(100, 149)).toBe("empate");
      // Justo FUERA: 151/100 = 1.51× ≥ 1.5× → separa (el neutral es el lento aquí).
      expect(destinoMasLentoDe(100, 151)).toBe("neutral");
    });
  });
});

// ============================================================
// 3) LA BATERÍA EN VIVO — solo se INTENTA si las variables existen; console.warn
// explícito si se omite (nunca un skip mudo). [INV-B7B corrección, D1+D2+D3;
// INV-B7B cierre — fixtures efímeros + guardas P9, ver más abajo]
//
// Tres defectos que tenía esta sección, corregidos en una ronda ANTERIOR:
//   D1 · la guarda de arriba (`--check-credenciales`) solo confirmaba que las
//        variables EXISTIERAN, nunca que la cuenta SIRVIERA — ahora
//        `rls-negativas.mjs` intenta fabricar y loguear de VERDAD y devuelve
//        `credenciales.estado` (sin_variables / cuentas_vivas /
//        entorno_no_disponible) — la única guarda de abajo (`beforeEach` +
//        `ctx.skip()`) reacciona a ESE estado real, no a la mera presencia
//        de variables.
//   D2 · un login que fallaba hacía que el script hijo muriera con
//        `process.exit(2)` con clientes de Supabase todavía con handles de
//        red vivos — en Windows eso revienta con una aserción de libuv ANTES
//        de imprimir el JSON, así que `correrJson` no tenía nada que parsear.
//        `rls-negativas.mjs` ya no hace eso (ver su cabecera): cierra sus
//        clientes y sale por `process.exitCode`, nunca `process.exit()` con
//        una promesa en vuelo.
//   D3 · la corrida en vivo (`correrJson<CorridaBateria>()`) se invocaba al
//        NIVEL SUPERIOR del módulo, fuera de todo `it`/`beforeAll` — un fallo
//        ahí (como el crash de D2) se volvía un error de RECOLECCIÓN de todo
//        el archivo (1 "Test File" rojo, 0 "Tests" rojos: invisible en el
//        contador que de verdad se lee). Ahora esa llamada vive en
//        `beforeAll`, así que los ~10 `it` de abajo YA están declarados
//        cuando podría fallar: un fallo real ahí es un test rojo CONTADO, no
//        un archivo que desaparece del conteo.
//
// [INV-B7B cierre] Lo que dependía de D1 eran 2 cuentas de prueba
// PERMANENTES (`RLS_TEST_KAM_EMAIL`/`RLS_TEST_VISITANTE_EMAIL`) — deuda
// documentada desde que nacieron y, además, ya NO EXISTEN (incidente de
// enumeración, `docs/engineering/failure-patterns.md` (P9): un borrado que preguntó
// "cuáles son las cuentas de prueba" en vez de usar la identidad que él
// mismo creó, y se llevó TODAS las cuentas del proyecto). `rls-negativas.mjs`
// ya no depende de NINGUNA cuenta permanente: cada corrida FABRICA sus
// propias 2 cuentas efímeras (kam + visitante), guardando el `id` exacto que
// devuelve el POST, y las DESTRUYE por ese mismo `id` antes de salir —
// contando `auth.users` antes/después y abortando ruidosamente si el saldo
// no cuadra. Este archivo no necesita probar esas guardas de nuevo (viven y
// se ejercitan dentro de `rls-negativas.mjs`, verificadas en la demostración
// del bloque); solo consume su salida JSON, igual que antes.
// ============================================================

// Única llamada de nivel superior de esta sección — igual que las de las
// secciones 1 y 2 de arriba: sin red, no puede lanzar. Decide si vale la pena
// intentar la batería en vivo, pero NO confirma que las cuentas sirvan (D1)
// — esa verificación, que sí necesita red, vive abajo en `beforeAll` (D3).
const infoVariables = correrJson<{ hayCredenciales: boolean; faltantes: string[] }>("--check-credenciales");

// ------------------------------------------------------------
// SONDA DE RED DE VERDAD (impura) — la ÚNICA parte de la contramedida
// que toca la red, y solo se ejecuta dentro del `beforeAll` de
// abajo, que a su vez solo existe si `infoVariables.hayCredenciales` (mismo
// gate que ya protegía a `correrBateriaEnVivoJson`). Mide con TCP crudo
// (`node:net`), no HTTP: un `connect()` a :443 es la petición "ligera" que
// pide el bloque — sin negociar TLS ni transferir un solo byte de payload.
// Un error o un timeout de conexión se trata como LATENCIA MÁXIMA (nunca
// como una excepción que tumbe la sonda): una red rota es exactamente el
// caso que esto existe para declarar, no para crashear con un stack ajeno.
// ------------------------------------------------------------
const PUERTO_SONDA = 443;
const MUESTRAS_SONDA = 3;
const TIMEOUT_SONDA_MS = 5_000;
// IP literal a propósito: sin resolución DNS de por medio, así la sonda
// neutral mide solo la red, no el resolutor. Ajeno al proyecto (Cloudflare).
const HOST_NEUTRAL = "1.1.1.1";

function hostSupabase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL no está definida en este proceso — no puedo sondear su latencia.");
  }
  return new URL(url).hostname;
}

function medirConexionTcp(host: string, port: number, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    const inicio = Date.now();
    const socket = connect({ host, port, timeout: timeoutMs });
    const terminar = (valorMs: number) => {
      socket.destroy();
      resolve(valorMs);
    };
    socket.once("connect", () => terminar(Date.now() - inicio));
    socket.once("timeout", () => terminar(timeoutMs));
    socket.once("error", () => terminar(timeoutMs));
  });
}

async function medirMedianaMs(host: string, port: number, muestras: number, timeoutMs: number): Promise<number> {
  const valores: number[] = [];
  for (let i = 0; i < muestras; i++) {
    valores.push(await medirConexionTcp(host, port, timeoutMs));
  }
  return mediana(valores);
}

// La batería EN VIVO es opcional y EXPLÍCITA: además de las variables, exige
// `RLS_EN_VIVO=1`. Así `npm test` y el CI (que copian `.env.example`, con
// marcadores presentes pero sin base detrás) corren las secciones de arriba —
// sin red, siempre — y nunca intentan sondas ni logins contra un stack que no
// existe. Para correrla: stack local de Supabase arriba, `.env.local` con sus
// valores y `RLS_EN_VIVO=1 npx vitest run scripts/rls-negativas.test.ts`.
describe.skipIf(!infoVariables.hayCredenciales || process.env.RLS_EN_VIVO !== "1")("rls-negativas · batería EN VIVO contra Supabase real", () => {
  let credenciales: VerificacionLogin;
  let corrida: CorridaBateria | null = null;

  beforeAll(async () => {
    // [2.0.1-C] CONTRAMEDIDA HEREDADA de 2.0.1-B (ver el bloque 2-bis arriba
    // para el disparador citado y la aritmética) — corre ANTES de intentar
    // la batería real: si la red no da para 279 llamadas en el tiempo que
    // queda, aborta con un mensaje SIN VEREDICTO en vez de dejar que el
    // `Hook timed out` pelón de vitest acuse al código.
    const medianaSupabaseMs = await medirMedianaMs(hostSupabase(), PUERTO_SONDA, MUESTRAS_SONDA, TIMEOUT_SONDA_MS);
    const medianaNeutralMs = await medirMedianaMs(HOST_NEUTRAL, PUERTO_SONDA, MUESTRAS_SONDA, TIMEOUT_SONDA_MS);
    abortarSiNoCabe(evaluarPresupuestoLatencia(medianaSupabaseMs, medianaNeutralMs));

    // Única llamada de RED (de la batería en sí) de todo el archivo: corre la
    // matriz completa una sola vez para las ~10 aserciones de abajo (no
    // dentro de cada `it`, para no repetir ~66 casos × llamadas de red varias
    // veces). Internamente (`rls-negativas.mjs`) fabrica sus 2 cuentas
    // efímeras, corre la matriz y las destruye — NUNCA lanza por
    // credenciales — `credenciales.estado` es el dato real, sea cual sea.
    // `correrBateriaEnVivoJson` (no `correrJson` a secas) además exige que
    // el exit code no sea 2, para que un fallo de limpieza de las cuentas
    // efímeras (P9) no quede invisible detrás de un JSON de resultados en
    // verde (ver el doc-comment de esa función). Si esto lanza por algo
    // genuinamente inesperado, los ~10 `it` de abajo ya existen como tests
    // nombrados: el fallo se cuenta en "Tests", no desaparece como error de
    // recolección (D3).
    corrida = correrBateriaEnVivoJson();
    credenciales = corrida.credenciales;

    if (credenciales.estado !== "cuentas_vivas") {
      console.warn(
        credenciales.estado === "entorno_no_disponible"
          ? `[rls-negativas.test] ENTORNO NO DISPONIBLE (${credenciales.detalle}) — se omite la batería EN VIVO ` +
              `(los tests de abajo se SALTAN, no desaparecen). Esto NO es un fallo de RLS: revisa que ` +
              `SUPABASE_SERVICE_ROLE_KEY sea válida y el proyecto esté accesible — esta corrida no depende de ` +
              `ninguna cuenta permanente, fabrica las suyas propias cada vez.`
          : `[rls-negativas.test] SIN VARIABLES (${credenciales.faltantes.join(", ")}) — se omite la batería EN ` +
              `VIVO (los tests de abajo se SALTAN, no desaparecen). Define las 3 variables base de Supabase ` +
              `(NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) en ` +
              `.env.local para correr esta batería en vivo. Ver README.md.`,
      );
    }
    // [MVP-2] Presupuesto 60 s → 180 s. NO es "subirlo hasta que pase": el
    // presupuesto se dimensionó para una matriz de 66 casos y la batería
    // ahora corre 93 (5 tablas × 4 verbos × 3 roles + 11 RPC × 3 roles), cada
    // uno con sus idas y vueltas de red reales contra Supabase. Medido
    // aislado: **58.2 s** — 2 s por debajo del tope viejo, o sea que bajo la
    // carga de la suite completa lo cruzaba a veces y el archivo moría en
    // `beforeAll` con CERO aserciones fallidas: un fallo de RECOLECCIÓN, que
    // es justo el que `QA-REG-18` enseña a no leer como "un test roto".
    // Con 180 s hay ~3× de holgura sobre la medición. Si algún día se acerca
    // otra vez, el número a mirar es cuántos casos declara la matriz, no este
    // tope. [2.0.1-C] `HOOK_TIMEOUT_BATERIA_MS` en vez del literal `180_000`:
    // es la MISMA constante que usa `evaluarPresupuestoLatencia` arriba —
    // este número y el presupuesto de la sonda no pueden divergir en silencio.
  }, HOOK_TIMEOUT_BATERIA_MS);

  // Corre antes de CADA `it` de este describe (incluido el primero) — si las
  // cuentas no sirven, cada test se salta individualmente con un motivo
  // explícito: siguen apareciendo en el reporte como "skip" y CONTADOS como
  // tales (nunca ausentes), nunca como un archivo que falló al recolectar.
  beforeEach((ctx) => {
    if (credenciales.estado !== "cuentas_vivas") {
      ctx.skip(`credenciales.estado="${credenciales.estado}" — ver el aviso impreso arriba (beforeAll)`);
    }
  });

  it("las 66 combinaciones (tablas + RPC) pasan: anon/kam/visitante nunca alteran datos ni leen lo que no deben", () => {
    const r = corrida!;
    const fallidos = (r.resultados ?? []).filter((x) => x.veredicto && !x.veredicto.ok);
    expect(r.resumen?.fallos, `casos con FALLA:\n${JSON.stringify(fallidos, null, 2)}`).toBe(0);
    expect(r.resumen?.omitidos, `casos OMITIDOS (sin fila objetivo viva):\n${JSON.stringify((r.resultados ?? []).filter((x) => x.omitido), null, 2)}`).toBe(0);
    expect(r.resumen?.total).toBe(93);
  });

  it("kam y visitante SÍ leen clasificacion_v2/tecnologias (200 con filas) y NADIE lee pendientes_datos — esperado conocido, re-verificado en vivo", () => {
    const resultados = corrida!.resultados ?? [];
    const buscar = (tabla: string, verbo: string, rol: string) =>
      resultados.find((x) => x.grupo === "tabla" && x.tabla === tabla && x.verbo === verbo && x.rol === rol);

    for (const tabla of ["clasificacion_v2", "tecnologias"]) {
      for (const rol of ["kam", "visitante"]) {
        const caso = buscar(tabla, "SELECT", rol);
        expect(caso?.esperado, `${tabla} SELECT/${rol}`).toBe("permitido");
        expect(caso?.veredicto?.ok, `${tabla} SELECT/${rol}: ${caso?.veredicto?.detalle}`).toBe(true);
      }
    }
    for (const rol of ["anon", "kam", "visitante"]) {
      const caso = buscar("pendientes_datos", "SELECT", rol);
      expect(caso?.veredicto?.ok, `pendientes_datos SELECT/${rol}: ${caso?.veredicto?.detalle}`).toBe(true);
    }
  });

  it("ninguno de los 3 roles escribe NADA en clasificacion_v2/tecnologias/pendientes_datos (3 tablas × 3 verbos de escritura × 3 roles = 27 casos)", () => {
    const resultados = corrida!.resultados ?? [];
    const escrituras = resultados.filter(
      (x) => x.grupo === "tabla" && x.tabla !== "storage.objects" && x.verbo !== "SELECT",
    );
    expect(escrituras).toHaveLength(36);
    for (const c of escrituras) {
      expect(c.veredicto?.ok, `${c.tabla} ${c.verbo}/${c.rol}: ${c.veredicto?.detalle}`).toBe(true);
    }
  });

  it("storage.objects: SELECT es público por diseño (B7A-10) pero INSERT/UPDATE/DELETE siguen bloqueados para los 3 roles", () => {
    const resultados = corrida!.resultados ?? [];
    const storage = (verbo: string, rol: string) =>
      resultados.find((x) => x.grupo === "tabla" && x.tabla === "storage.objects" && x.verbo === verbo && x.rol === rol);

    for (const rol of ["anon", "kam", "visitante"]) {
      expect(storage("SELECT", rol)?.esperado).toBe("permitido");
      expect(storage("SELECT", rol)?.veredicto?.ok).toBe(true);
      for (const verbo of ["INSERT", "UPDATE", "DELETE"]) {
        expect(storage(verbo, rol)?.veredicto?.ok, `storage.objects ${verbo}/${rol}`).toBe(true);
      }
    }
  });

  it("is_admin() y contar_pendientes() SÍ son ejecutables por authenticated (B7A-9, deliberado) — el resto de las RPC rechaza a los 3 roles", () => {
    const resultados = corrida!.resultados ?? [];
    const buscarRpc = (rpc: string, rol: string) =>
      resultados.find((x) => x.grupo === "rpc" && x.rpc === rpc && x.rol === rol);

    for (const rol of ["kam", "visitante"]) {
      expect(buscarRpc("is_admin", rol)?.esperado).toBe("permitido");
      expect(buscarRpc("is_admin", rol)?.veredicto?.ok).toBe(true);
      expect(buscarRpc("contar_pendientes", rol)?.veredicto?.ok).toBe(true);
    }
    expect(buscarRpc("is_admin", "anon")?.veredicto?.ok).toBe(true); // "ok" = correctamente denegado
    expect(buscarRpc("is_admin", "anon")?.esperado).toBe("denegado");

    for (const rpc of ["resolver_pendiente", "aplicar_override", "aplicar_clasificacion_v2", "ingest_snapshot"]) {
      for (const rol of ["anon", "kam", "visitante"]) {
        const caso = buscarRpc(rpc, rol);
        expect(caso?.esperado, `${rpc}/${rol}`).toBe("denegado");
        expect(caso?.veredicto?.ok, `${rpc}/${rol}: ${caso?.veredicto?.detalle}`).toBe(true);
      }
    }
  });
});
