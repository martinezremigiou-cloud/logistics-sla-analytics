import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================
// [GATE-B1 · G1-5] TRINQUETE · NADIE NUEVO SE ESCAPA DEL SANDBOX DE PRUEBAS.
//
// EL SANDBOX existe y está declarado: `vitest.config.ts` inyecta en `test.env`
// credenciales FALSAS de Supabase. Un test que se conecte dentro de su propio
// proceso usa esas falsas y no alcanza producción. Ése es el suelo.
//
// LA PUERTA DE ATRÁS es el proceso hijo. Un `spawnSync` hereda el entorno, y
// basta con borrar las falsas —o hacer que el hijo cargue `.env.local`— para
// que el hijo lea las REALES. Eso es lo que hacía que `npm run verificar`
// tocara la base de producción: medido, cientos de corridas en semanas.
//
// Este trinquete vigila ESA puerta, y sólo ésa.
//
// ────────────────────────────────────────────────────────────
// EL PREDICADO ES UNA CONJUNCIÓN, y las dos mitades hacen falta. Medido sobre
// los 282 archivos de prueba del árbol, el 22-sep-2026:
//
//   importan `child_process` ........ 3   (los tres arneses de `scripts/`)
//   entregan credenciales reales .... 3   (uno de ellos es ESTE archivo, ver abajo)
//   LAS DOS COSAS ................... 1   <- exactamente el sujeto
//
// El tercero de la mitad de credenciales es este mismo archivo, y casa SÓLO POR
// SU PROSA: los comentarios de aquí nombran `.env.local` al explicar el
// predicado. Nunca se acusa —no importa `child_process`— pero es la
// demostración viva del tercer límite de abajo, así que se deja dicho en vez de
// disimularlo.
//
// Cualquiera de las dos POR SEPARADO habría nacido ruidosa: «lanza hijo» acusa
// también al arnés de migraciones, que hace el gesto CONTRARIO —le quita las
// credenciales al hijo para que NO pueda conectarse—, y sería un trinquete que
// denuncia a su propio control negativo.
//
// Y la detección de «lanza hijo» va por el IMPORT, no por el nombre de la
// llamada: un regex sobre `exec(` no distingue `child_process.exec` de
// `RegExp.prototype.exec`, y ese falso positivo ya se produjo una vez mientras
// se diseñaba esta pieza.
//
// ────────────────────────────────────────────────────────────
// ⚠ LO QUE ESTE TRINQUETE NO PUEDE VER, DECLARADO:
//
//   · Sólo caza la fuga POR PROCESO HIJO. Un test que se conecte EN SU MISMO
//     PROCESO con credenciales reales queda fuera de su alcance. Hoy eso lo
//     impide el sandbox de `test.env`, no esto — son dos capas distintas y
//     ésta no sustituye a la otra.
//   · Lee TEXTO. Un hijo lanzado por una función envuelta en otro módulo, o un
//     `.env.local` leído por una ruta construida en tiempo de ejecución, no
//     dejan rastro que este escáner pueda leer.
//   · LAS DOS MITADES NO SON IGUAL DE FINAS. La de `child_process` va por el
//     IMPORT y no se puede confundir con prosa; la de credenciales sigue siendo
//     una SUBCADENA, así que un comentario que nombre `.env.local` cuenta. Hoy
//     eso no produce ningún falso positivo en la conjunción —ningún archivo que
//     importe `child_process` nombra `.env.local` de adorno— pero eso es una
//     propiedad del ÁRBOL DE HOY, no del predicado.
//   · No sabe si el hijo ESCRIBE. Sabe que puede alcanzar credenciales reales.
//     Leer no es escribir —ésa es la vara de este bloque— y distinguirlo exige
//     ejecutarlo, que es justo lo que no se hace aquí.
// ============================================================

const RAIZ = process.cwd();
/**
 * Este mismo archivo, DERIVADO de `import.meta.url` y no tecleado: si se
 * renombra, el filtro de abajo lo sigue — una ruta a mano se quedaría vieja en
 * silencio y la anti-vacuidad volvería a sostenerse sola.
 */
const ESTE_ARCHIVO = relative(RAIZ, fileURLToPath(import.meta.url)).split(sep).join('/');
const IGNORAR = new Set(['node_modules', '.git', '.vitest', 'coverage', 'public']);

function archivosDePrueba(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (IGNORAR.has(e.name) || e.name.startsWith('.next')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!e.name.startsWith('.')) walk(p);
      } else if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(e.name)) {
        out.push(relative(RAIZ, p).split(sep).join('/'));
      }
    }
  };
  walk(RAIZ);
  return out.sort();
}

/** Importa `child_process` — la capacidad de salir del proceso de pruebas. */
const IMPORTA_HIJO =
  /from\s*['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/;

/**
 * Le entrega credenciales REALES a ese hijo: o le hace cargar `.env.local`, o
 * le borra del entorno las falsas que `vitest.config.ts` inyecta — que es el
 * gesto deliberado, no un accidente.
 */
const ENTREGA_CREDENCIALES =
  /\.env\.local|delete\s+\w+\.(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)/;

interface Clasificado {
  ruta: string;
  hijo: boolean;
  credenciales: boolean;
}

const clasificados: Clasificado[] = archivosDePrueba().map((ruta) => {
  const texto = readFileSync(join(RAIZ, ruta), 'utf8');
  return { ruta, hijo: IMPORTA_HIJO.test(texto), credenciales: ENTREGA_CREDENCIALES.test(texto) };
});

const escapan = clasificados.filter((c) => c.hijo && c.credenciales).map((c) => c.ruta);

/**
 * EL ÚNICO ARCHIVO CON PERMISO, y su razón.
 *
 * ⚠ NO es una deuda a pagar: es una excepción con motivo, y se queda. Su hijo
 * `--check-credenciales` existe precisamente para contestar si las tres
 * variables reales están presentes, y para eso tiene que poder leerlas. Lo que
 * `GATE-B1` le quita no es el acceso: es que su batería de ESCRITURA corra por
 * omisión.
 *
 * Su presencia aquí es además lo que vuelve NO VACUO a este trinquete: un
 * conjunto esperado vacío pasaría igual con el escáner roto.
 */
const PERMITIDOS: Record<string, string> = {
  'scripts/rls-negativas.test.ts':
    'el arnés de RLS negativas: su hijo --check-credenciales tiene que poder LEER las tres variables reales para responder si existen.',
};

describe('el suite de pruebas no se escapa del sandbox', () => {
  // ------------------------------------------------------------
  // ANTI-VACUIDAD. Un escáner que no encuentra archivos da «0 fugas» igual que
  // un árbol sano, y el error más fácil aquí es escanear sólo `src/`: el
  // archivo que motiva este trinquete vive en `scripts/`.
  // ------------------------------------------------------------
  it('el escáner ve TODO el árbol, no sólo src/ (si no, nace ciego a su propio sujeto)', () => {
    expect(clasificados.length, 'no se encontraron archivos de prueba').toBeGreaterThan(200);
    const fuera = clasificados.filter((c) => !c.ruta.startsWith('src/')).map((c) => c.ruta);
    expect(fuera, 'el escáner dejó de ver fuera de src/, que es donde vive el sujeto').toContain(
      'scripts/rls-negativas.test.ts',
    );
    // El número es el de hoy y está justo en el borde: si alguien MUEVE uno de
    // los tres arneses a `src/`, esto cae — y el escáner no habrá dejado de ver
    // nada, habrá cambiado el árbol. El mensaje lo dice para que quien lo lea
    // no persiga al instrumento.
    expect(
      fuera.length,
      'hay menos archivos de prueba fuera de src/ que antes. Si es porque se MOVIÓ uno, baja este número; si es porque el escáner dejó de mirar ahí, arregla el escáner.',
    ).toBeGreaterThanOrEqual(4);
  });

  it('las DOS mitades del predicado encuentran algo por separado, SIN contarse a sí mismas', () => {
    expect(clasificados.filter((c) => c.hijo).length, 'nadie importa child_process: el patrón se rompió').toBeGreaterThan(0);
    // ⚠ SE EXCLUYE ESTE ARCHIVO, y hace falta: su prosa nombra `.env.local` al
    // explicar el predicado, así que satisfaría esta aserción él solo. Sin el
    // filtro, el día que desaparecieran los sujetos reales esto seguiría verde
    // sobre mis propios comentarios — una guarda sostenida por su documentación.
    // Y la guarda de la guarda: si `ESTE_ARCHIVO` no resolviera a una ruta real
    // —un separador distinto, un cwd inesperado— el filtro de arriba sería un
    // NO-OP y esta prueba seguiría verde por los otros dos. El filtro tiene que
    // estar filtrando algo que existe.
    expect(
      clasificados.map((c) => c.ruta),
      'ESTE_ARCHIVO no resolvió a una ruta del escáner: la auto-exclusión de abajo no estaría excluyendo nada',
    ).toContain(ESTE_ARCHIVO);
    const ajenos = clasificados.filter((c) => c.ruta !== ESTE_ARCHIVO && c.credenciales);
    expect(ajenos.length, 'nadie MÁS que este archivo toca credenciales reales: el patrón se rompió').toBeGreaterThan(0);
  });

  // ------------------------------------------------------------
  // LOS DOS CONTROLES SON ARCHIVOS REALES DEL ÁRBOL, no escenarios fabricados:
  // hacen el MISMO gesto en direcciones opuestas, y por eso separan.
  // ------------------------------------------------------------
  it('control POSITIVO · el arnés de RLS cumple las dos condiciones', () => {
    const c = clasificados.find((x) => x.ruta === 'scripts/rls-negativas.test.ts');
    expect(c, 'desapareció el control positivo').toBeDefined();
    expect(c!.hijo).toBe(true);
    expect(c!.credenciales).toBe(true);
  });

  it('control NEGATIVO · el arnés de migraciones lanza hijo pero NO le da credenciales', () => {
    const c = clasificados.find((x) => x.ruta === 'scripts/aplicar-migracion.test.ts');
    expect(c, 'desapareció el control negativo').toBeDefined();
    expect(c!.hijo, 'el control negativo debe seguir lanzando un hijo, o no controla nada').toBe(true);
    // Hace el gesto CONTRARIO: le quita las credenciales al hijo para que no
    // pueda conectarse. Si la conjunción lo acusara, estaría midiendo la
    // capacidad en vez de la intención.
    expect(c!.credenciales).toBe(false);
  });

  // ------------------------------------------------------------
  // EL TRINQUETE, y en las DOS direcciones: un archivo nuevo que se escape lo
  // pone rojo, y uno que se quite de la lista sin dejar de escaparse también.
  // ------------------------------------------------------------
  it('NINGÚN archivo nuevo alcanza credenciales reales por proceso hijo', () => {
    expect(
      escapan.sort(),
      'Un archivo del suite lanza un proceso hijo Y le entrega credenciales REALES. Eso saca al hijo del sandbox de `test.env` y lo pone frente a la base de producción — que es lo que hacía que `npm run verificar` escribiera. Si es deliberado y tiene razón, decláralo en PERMITIDOS con su motivo.',
    ).toEqual(Object.keys(PERMITIDOS).sort());
  });

  it('cada permitido lleva su motivo escrito, no sólo su ruta', () => {
    for (const [ruta, motivo] of Object.entries(PERMITIDOS)) {
      expect(motivo.length, `«${ruta}» está permitido sin explicar por qué`).toBeGreaterThan(40);
    }
  });
});
