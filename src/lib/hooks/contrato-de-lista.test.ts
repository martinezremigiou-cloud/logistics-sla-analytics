import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sinComentarios, bloqueDe } from '@/lib/guardas/codigo-fuente';

// ============================================================
// [INV-B8.2] La guarda que faltaba: un endpoint que ENVUELVE se consume con un
// tipo que envuelve.
//
// EL BUG QUE LA MOTIVA. `GET /api/proyectos` devuelve `{ items }` — la
// convención de la casa para listas, la misma de `/api/usuarios` y
// `/api/familias`. El diálogo de volcado lo declaró como
// `useApi<ProyectoResumen[]>`, un arreglo pelón, y reventó en el navegador con
// `t.find is not a function`. Se encontró haciendo clic.
//
// POR QUÉ NI `tsc` NI LA SUITE LO VIERON, y es lo que hace falta entender para
// que esta guarda tenga sentido:
//
//   · **El genérico de `useApi<T>` es una AFIRMACIÓN, no una comprobación.**
//     Le dice a TypeScript qué forma tiene la respuesta; TypeScript no puede
//     verificar lo que devuelve un `fetch` en tiempo de ejecución. El tipo
//     declarado era coherente CONSIGO MISMO, así que `tsc` salió limpio.
//   · **El mock del test inventaba la misma forma equivocada.** Un doble que
//     devuelve un arreglo cuando la ruta devuelve `{items}` no prueba el
//     consumidor: confirma el error.
//
// LO QUE ESTA PRUEBA ES, dicho sin adornos: un análisis TEXTUAL del árbol. No
// entiende TypeScript, no ejecuta nada, y se puede engañar (una URL armada por
// concatenación, un tipo declarado fuera de `src/`). No sustituye a probar cada
// consumidor con la forma real de su ruta — eso se pidió como invariante
// y vive en los tests de cada componente. Lo que sí hace es cerrar EXACTAMENTE
// el agujero por el que se coló éste: declarar un arreglo sobre un endpoint que
// envuelve. Corre en cada `npm test` y nombra al culpable con archivo y línea.
// ============================================================

const RAIZ = process.cwd();

function archivos(dir: string, filtro: (f: string) => boolean): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) salida.push(...archivos(ruta, filtro));
    else if (filtro(entrada)) salida.push(ruta);
  }
  return salida;
}

/** Firmas `export async function X(…): Promise<…>` de todos los servicios, en un solo barrido. */
function firmasDeServicio(): Map<string, string> {
  const mapa = new Map<string, string>();
  const fuentes = archivos(
    join(RAIZ, 'src', 'services'),
    (f) => f.endsWith('.ts') && !f.includes('.test.'),
  );
  for (const archivo of fuentes) {
    const texto = readFileSync(archivo, 'utf8');
    const re = /export async function (\w+)\([\s\S]{0,600}?\):\s*(Promise<[\s\S]{0,200}?>)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) mapa.set(m[1], m[2]);
  }
  return mapa;
}

/**
 * Los endpoints de lista que responden envuelto en `{ items }`. Se leen del
 * ÁRBOL, no de una lista escrita a mano: una lista se queda vieja el día que
 * alguien agrega una ruta, y entonces la guarda deja de proteger sin ponerse
 * roja — el patrón P17 aplicado a sí misma.
 *
 * DOS SEÑALES, porque hay dos maneras de envolver y la primera versión de esta
 * función solo veía una:
 *
 *   1. La ruta lo escribe: `NextResponse.json({ items }, …)` — `/api/proyectos`
 *      y `/api/usuarios`.
 *   2. **El SERVICIO ya lo devuelve envuelto** y la ruta reenvía `result` tal
 *      cual: `listFamilias(): Promise<{ items: FamiliaItem[] }>` — `/api/familias`.
 *
 * Con solo la señal (1), `/api/familias` quedaba fuera del alcance y la guarda
 * se veía completa sin serlo. Es el mismo defecto que este bloque lleva
 * persiguiendo: algo plausible que no cubre lo que aparenta.
 */
function endpointsQueEnvuelven(): string[] {
  const firmas = firmasDeServicio();
  const rutas = archivos(join(RAIZ, 'src', 'app', 'api'), (f) => f === 'route.ts');
  const salida: string[] = [];

  for (const ruta of rutas) {
    const texto = readFileSync(ruta, 'utf8');
    let envuelve = /NextResponse\.json\(\s*\{\s*items\b/.test(texto);

    if (!envuelve) {
      const re = /await\s+(\w+)\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(texto)) !== null) {
        const firma = firmas.get(m[1]);
        if (firma && /\bitems\s*[?:]/.test(firma)) {
          envuelve = true;
          break;
        }
      }
    }

    if (!envuelve) continue;
    // src/app/api/proyectos/route.ts → /api/proyectos
    const rel = relative(join(RAIZ, 'src', 'app'), ruta).split(sep).slice(0, -1).join('/');
    salida.push('/' + rel);
  }
  return salida.sort();
}

interface Consumo {
  archivo: string;
  linea: number;
  generico: string;
  endpoint: string;
}

/** Cada `useApi<T>(…)` que menciona uno de esos endpoints, con el tipo que declara. */
function consumos(endpoints: string[]): Consumo[] {
  const fuentes = archivos(
    join(RAIZ, 'src'),
    (f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && !f.includes('.test.'),
  );
  const salida: Consumo[] = [];

  for (const archivo of fuentes) {
    const lineas = readFileSync(archivo, 'utf8').split('\n');
    lineas.forEach((linea, i) => {
      const m = /useApi<([^>]+)>\(/.exec(linea);
      if (!m) return;
      // El argumento puede seguir en las dos líneas siguientes.
      const texto = lineas.slice(i, i + 3).join(' ');
      for (const endpoint of endpoints) {
        // El siguiente carácter NO puede ser `/`: si lo fuera sería el endpoint
        // de DETALLE (`/api/proyectos/${id}`), que devuelve el objeto pelado.
        const re = new RegExp(endpoint.replace(/\//g, '\\/') + '(?![\\w/])');
        if (re.test(texto)) {
          salida.push({ archivo: relative(RAIZ, archivo), linea: i + 1, generico: m[1].trim(), endpoint });
        }
      }
    });
  }
  return salida;
}

/**
 * `true` si ese nombre de tipo está declarado en `src/` con un campo `items`.
 *
 * ────────────────────────────────────────────────────────────
 * [2.0.1-B · S-1] ANTES CONTABA CARACTERES, Y ESO LA VOLVÍA FALSA.
 *
 * La versión anterior buscaba el cuerpo con un `[\s\S]{0,400}?`: un PRESUPUESTO
 * de 400 caracteres. En S-1 se le agregó a `ProyectosResponse` un campo
 * (`vigencia`) con su explicación, el cuerpo pasó de 400, la expresión dejó de
 * encajar y esta guarda declaró que `ProyectosResponse` **no tiene `items`** —
 * cuando lo tiene tres líneas más arriba.
 *
 * O sea: convirtió «alguien escribió un comentario largo» en «este consumidor va
 * a reventar en el navegador». Un rojo que no es del sujeto es peor que ningún
 * rojo, porque manda a arreglar lo que no está roto.
 *
 * Ahora empareja llaves (`bloqueDe`) sobre el fuente SIN COMENTARIOS. Lo segundo
 * no es adorno: una llave dentro de un comentario descuadraría el conteo, y este
 * repo tiene comentarios que citan código con llaves en casi todos los archivos
 * que esta guarda recorre.
 */
function declaraItems(nombre: string): boolean {
  if (nombre.endsWith('[]') || nombre.startsWith('Array<')) return false;
  const fuentes = archivos(join(RAIZ, 'src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  for (const archivo of fuentes) {
    const codigo = sinComentarios(readFileSync(archivo, 'utf8'));
    for (const clave of [`interface ${nombre}`, `type ${nombre}`]) {
      const i = codigo.indexOf(clave);
      // Límite de palabra a mano: `ProyectosResponse` no puede casar con
      // `ProyectosResponseVieja`.
      if (i === -1 || /[\w$]/.test(codigo[i + clave.length] ?? '')) continue;
      if (/\bitems\s*[?:]/.test(bloqueDe(codigo.slice(i), clave))) return true;
    }
  }
  return false;
}

describe('[INV-B8.2] contrato de los endpoints de lista', () => {
  const endpoints = endpointsQueEnvuelven();
  const usos = consumos(endpoints);

  it('encontró rutas que envuelven y consumidores que las llaman', () => {
    // Sin esto, un cambio de estructura de carpetas dejaría las dos listas
    // vacías y la comprobación de abajo pasaría por vacuidad. Los pisos están
    // medidos el 2026-08-14: 3 rutas (`/api/familias`, `/api/proyectos`,
    // `/api/usuarios`) y 6 consumos.
    expect(endpoints, 'no se detectó la ruta que motivó esta guarda').toContain('/api/proyectos');
    expect(endpoints.length, `rutas que envuelven: ${JSON.stringify(endpoints)}`).toBeGreaterThanOrEqual(3);
    expect(usos.length, 'ningún useApi<> menciona un endpoint que envuelve').toBeGreaterThanOrEqual(6);
  });

  // ============================================================
  // [2.0.1-C] TOPE DE TIEMPO EXPLÍCITO EN LAS DOS PRUEBAS QUE LEEN EL ÁRBOL.
  //
  // Estas dos leen ~610 fuentes y corren expresiones sobre cada una. Aisladas
  // tardan ~1,3 s. Bajo la suite completa REPROBARON TRES VECES SEGUIDAS, por
  // TIEMPO y no por lógica, contra el tope POR OMISIÓN de vitest (5 000 ms):
  //
  //     5 673 ms  ·  7 792 ms  ·  7 477 ms      (rango: 2 100 ms)
  //
  // y la de arriba pasó una de esas veces en 4 750 ms — a 250 ms del filo.
  //
  // LA CAUSA NO ESTÁ MEDIDA, y eso se dice aquí en vez de inventarla. Lo que
  // SÍ está medido es lo que NO es:
  //   · NO es el server de QA en `:3000` — se bajó y siguió roja a 7 477 ms.
  //   · NO es el `statSync` por entrada del recorrido — son 92 ms de 7 477;
  //     `withFileTypes` los bajaría a 14, o sea 78 ms de ahorro. Se llegó a
  //     escribir esa «corrección de una línea» antes de medirla: habría
  //     arreglado la causa equivocada.
  // La SOSPECHA es que el corredor compite por los núcleos de la máquina, y un
  // rango de 2 100 ms entre muestras no parece contención estable sino el
  // equipo haciendo otras cosas. **Sospecha, no causa.**
  //
  // POR QUÉ 20 000 Y NO UN FACTOR SOBRE LO MEDIDO: con 2 100 ms de variación,
  // un tope pegado al peor caso vuelve a fallar en la cuarta corrida — y un
  // tope que falla por la máquina enseña a ignorar la suite.
  //
  // ⚠ Y POR QUÉ ESTO NO CONTRADICE LO QUE SE DECIDIÓ CON `rls-negativas`,
  // donde el `hookTimeout` NO se subió aunque el arnés llevaba tres días
  // rojo: allí la causa era EXTERNA y VARIABLE —la red— que es exactamente lo
  // que un tope debe cazar; subirlo habría destruido el instrumento. Aquí la
  // causa está en la máquina que corre la suite, que **no es el sujeto de esta
  // guarda**: esta prueba mide un contrato de tipos, no la velocidad de nada.
  // Mismo síntoma, decisión opuesta, y la razón escrita.
  //
  // El presupuesto no se elige por omisión: se elige. Estas dos son las únicas
  // del repo con tope propio, y ésta es la razón.
  // Ver `docs/known-limitations.md` (GUARDA-DE-LISTA-CARA-SIN-CAUSA-MEDIDA).
  // ============================================================
  it('control positivo · `declaraItems` distingue de verdad, y no se rinde ante un cuerpo largo', () => {
    // Sin esto, un `declaraItems` que devolviera SIEMPRE `true` pondría verde a
    // la de abajo sin mirar nada (P19). Se ancla en las dos direcciones, y el
    // primer caso es justo el que la rompió: `ProyectosResponse` tiene el cuerpo
    // más largo de los tres por la explicación de `vigencia`.
    expect(declaraItems('ProyectosResponse'), 'el tipo que motivó la reescritura').toBe(true);
    expect(declaraItems('ProyectoResumen'), 'un tipo real SIN items no puede pasar por envoltorio').toBe(false);
    expect(declaraItems('TipoQueNoExisteEnEsteRepo')).toBe(false);
    expect(declaraItems('ProyectoResumen[]')).toBe(false);
  }, 20_000);

  it('ningún consumidor declara un ARREGLO sobre un endpoint que envuelve en { items }', () => {
    const malos = usos.filter((u) => !declaraItems(u.generico));
    expect(
      malos.map((u) => `${u.archivo}:${u.linea} → useApi<${u.generico}>("${u.endpoint}")`),
      'ese endpoint devuelve { items }: un genérico sin `items` compila y revienta en el navegador',
    ).toEqual([]);
  }, 20_000);
});
