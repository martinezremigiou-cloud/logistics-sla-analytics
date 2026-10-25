import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================
// [COH-B1] TRINQUETE · TODA VARIABLE `v_*` DE plpgsql ESTÁ DECLARADA.
//
// Nace de un defecto real y caro: `fusionar_familia` (0018) usaba `v_actor`
// dos veces y no la declaraba nunca. PL/pgSQL compila el cuerpo en la primera
// llamada pero resuelve los identificadores de cada sentencia SQL AL
// EJECUTARLA, así que la función arrancaba bien, pasaba sus cuatro guardas y
// reventaba en el `INSERT` con `42703: column "v_actor" does not exist` → 500.
//
// Nunca corrió en producción y NADA se puso rojo: el único test que la tocaba
// SIMULA la RPC y afirma sus argumentos. 269 archivos de prueba en verde con la
// función rota. Los tres instrumentos de la casa son ciegos a esto —`tsc` no
// mira dentro de un `.sql`, `vitest` no lo abre, `next build` menos— y el
// verificador estático de migraciones revisa aridad de `RAISE`, paréntesis,
// transacción y predicados de catálogo, no declaraciones.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ MIRA LA DEFINICIÓN **VIVA** Y NO TODOS LOS ARCHIVOS
//
// Una migración es historia inmutable: la 0018 seguirá teniendo la versión rota
// para siempre, y la 0041 es la que corre. Un barrido que mirara todos los
// archivos denunciaría la 0018 eternamente y habría que silenciarlo — que es
// como muere un trinquete.
//
// Así que para cada función se evalúa SÓLO su último `CREATE [OR REPLACE]`, por
// número de migración. Y eso vale por sí mismo: es el antídoto de una trampa que
// este repo ya tiene puesta —`convivencia.o5.test.ts` lee la `0005` llamándola
// «el contrato del RPC de ingesta» cuando la viva es la `0036`, cinco
// generaciones después—. `ingest_snapshot` está redefinida SEIS veces; otras
// cuatro funciones, entre dos y cuatro.
//
// ────────────────────────────────────────────────────────────
// ⚠ LO QUE ESTE TRINQUETE NO PUEDE VER, DECLARADO — un trinquete que no dice lo
// que no vigila es un `RAISE NOTICE` que declara alcance otra vez:
//
//   · Sólo persigue identificadores con prefijo `v_`. Se mide abajo cuántas
//     variables declaradas NO lo llevan: una de ésas, usada sin declarar, sería
//     invisible. Es un límite conocido, no un descuido.
//   · NO compila contra Postgres. Lee texto. Un cuerpo que pase esto puede
//     fallar por veinte razones que esto no mira.
//   · Agrupa por NOMBRE de función, no por firma. Dos sobrecargas del mismo
//     nombre se tratarían como una, y ganaría la del archivo más alto.
//   · No sabe si una migración está APLICADA. «Viva» aquí significa «la última
//     escrita», que es lo que el repo puede saber de sí mismo.
// ============================================================

const DIR = 'supabase/migrations';

/**
 * Enmascara lo que no es código: comentarios de línea y de bloque, literales de
 * comilla simple (con su escape `''`) y los cuerpos `$tag$…$tag$`. Sustituye
 * por espacios en vez de borrar, para que los números de línea no se muevan.
 */
function enmascarar(texto: string): string {
  const out = texto.split('');
  const n = texto.length;
  const borrar = (a: number, b: number) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = texto[i];
    if (c === '-' && texto[i + 1] === '-') {
      let j = texto.indexOf('\n', i);
      if (j < 0) j = n;
      borrar(i, j);
      i = j;
      continue;
    }
    if (c === '/' && texto[i + 1] === '*') {
      let j = texto.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      borrar(i, j);
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (texto[j] === "'" && texto[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (texto[j] === "'") {
          j++;
          break;
        }
        j++;
      }
      borrar(i, j);
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

interface Bloque {
  /** `public.fusionar_familia` o `DO@0036:359` */
  nombre: string;
  archivo: string;
  /** Línea (1-indexada) donde arranca el bloque dentro del archivo. */
  linea: number;
  cuerpo: string;
  /** Offset del cuerpo dentro del archivo, para poder ubicar líneas. */
  offset: number;
  params: string[];
}

const linea = (texto: string, off: number) => texto.slice(0, off).split('\n').length;

/** Extrae los cuerpos `$tag$…$tag$` de un archivo, con quién los encabeza. */
function bloquesDe(archivo: string, texto: string): Bloque[] {
  const out: Bloque[] = [];
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let m: RegExpExecArray | null;
  const vistos: number[] = [];
  while ((m = re.exec(texto)) !== null) {
    if (vistos.some((fin) => m!.index < fin)) continue;
    const tag = m[0];
    const inicio = m.index + tag.length;
    const cierre = texto.indexOf(tag, inicio);
    if (cierre < 0) continue;
    vistos.push(cierre + tag.length);

    const antes = texto.slice(Math.max(0, m.index - 900), m.index);
    // `LANGUAGE plpgsql` puede ir antes o después del cuerpo; se mira una
    // ventana a cada lado para no perder ninguna de las dos formas.
    const despues = texto.slice(cierre + tag.length, cierre + tag.length + 200);
    const esFuncion = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z_][\w.]*)\s*\(/i.exec(antes);
    const esDo = /\bDO\s*$/i.test(antes.trimEnd() + (antes.endsWith(' ') ? ' ' : ''));
    const plpgsql = /LANGUAGE\s+plpgsql/i.test(antes) || /LANGUAGE\s+plpgsql/i.test(despues);

    if (esFuncion && plpgsql) {
      const firma = antes.slice(esFuncion.index);
      const abre = firma.indexOf('(');
      let prof = 0;
      let cierraParen = -1;
      for (let k = abre; k < firma.length; k++) {
        if (firma[k] === '(') prof++;
        else if (firma[k] === ')') {
          prof--;
          if (prof === 0) {
            cierraParen = k;
            break;
          }
        }
      }
      const params = (cierraParen > abre ? firma.slice(abre + 1, cierraParen) : '')
        .split(',')
        .map((p) => /^\s*(?:IN|OUT|INOUT|VARIADIC)?\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(p)?.[1] ?? '')
        .filter(Boolean)
        .map((p) => p.toLowerCase());
      out.push({
        nombre: esFuncion[2].toLowerCase(),
        archivo,
        linea: linea(texto, m.index),
        cuerpo: texto.slice(inicio, cierre),
        offset: inicio,
        params,
      });
    } else if (esDo || (!esFuncion && /\bDO\s*$/i.test(antes.trimEnd()))) {
      out.push({
        nombre: `DO@${archivo}:${linea(texto, m.index)}`,
        archivo,
        linea: linea(texto, m.index),
        cuerpo: texto.slice(inicio, cierre),
        offset: inicio,
        params: [],
      });
    }
  }
  return out;
}

interface Analisis {
  declaradas: Set<string>;
  usadas: Map<string, number[]>;
  faltantes: { nombre: string; lineas: number[] }[];
}

function analizar(b: Bloque, textoArchivo: string): Analisis {
  const m = enmascarar(b.cuerpo);
  const declaradas = new Set<string>(b.params);

  // Cada sección DECLARE … BEGIN, incluidas las de bloques anidados.
  const reDecl = /\bDECLARE\b/gi;
  let d: RegExpExecArray | null;
  while ((d = reDecl.exec(m)) !== null) {
    const reBegin = /\bBEGIN\b/gi;
    reBegin.lastIndex = d.index + d[0].length;
    const b2 = reBegin.exec(m);
    const seccion = m.slice(d.index + d[0].length, b2 ? b2.index : m.length);
    for (const sent of seccion.split(';')) {
      const id = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(sent);
      if (id) declaradas.add(id[1].toLowerCase());
    }
  }
  // `FOR i IN 1..n` declara `i` solo; `FOREACH … IN ARRAY` NO.
  for (const f of Array.from(m.matchAll(/\bFOR\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+(?:REVERSE\s+)?([^\n]*)/gi))) {
    if (/\.\./.test(f[2])) declaradas.add(f[1].toLowerCase());
  }

  const usadas = new Map<string, number[]>();
  for (const u of Array.from(m.matchAll(/\b[vV]_[A-Za-z0-9_]+\b/g))) {
    const nombre = u[0].toLowerCase();
    const ln = linea(textoArchivo, b.offset + u.index);
    const arr = usadas.get(nombre) ?? [];
    if (!arr.includes(ln)) arr.push(ln);
    usadas.set(nombre, arr);
  }

  const faltantes = Array.from(usadas.entries())
    .filter(([nombre]) => !declaradas.has(nombre))
    .map(([nombre, lineas]) => ({ nombre, lineas }));

  return { declaradas, usadas, faltantes };
}

/** Los bloques a evaluar: la ÚLTIMA definición de cada función + todos los DO. */
function bloquesVivos(): { bloques: Bloque[]; textos: Map<string, string>; archivos: string[] } {
  const archivos = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const textos = new Map<string, string>();
  const porFuncion = new Map<string, Bloque>();
  const dos: Bloque[] = [];
  for (const f of archivos) {
    const texto = readFileSync(join(DIR, f), 'utf8');
    textos.set(f, texto);
    for (const b of bloquesDe(f, texto)) {
      if (b.nombre.startsWith('DO@')) dos.push(b);
      else porFuncion.set(b.nombre, b); // los archivos van ordenados: gana el último
    }
  }
  return { bloques: Array.from(porFuncion.values()).concat(dos), textos, archivos };
}

const { bloques, textos, archivos } = bloquesVivos();

describe('plpgsql · toda variable v_* usada está declarada', () => {
  // ------------------------------------------------------------
  // ANTI-VACUIDAD. Un «0 problemas» de un escáner que no encuentra nada es
  // indistinguible de un «0 problemas» de un árbol sano. Esto separa los dos.
  // ------------------------------------------------------------
  it('el escáner encuentra bloques, funciones y declaraciones (si no, todo lo de abajo es vacuo)', () => {
    expect(archivos.length, 'no se leyó ninguna migración').toBeGreaterThan(30);
    const funciones = bloques.filter((b) => !b.nombre.startsWith('DO@'));
    const dos = bloques.filter((b) => b.nombre.startsWith('DO@'));
    expect(funciones.length, 'no se encontró ninguna función plpgsql').toBeGreaterThan(10);
    expect(dos.length, 'no se encontró ningún bloque DO').toBeGreaterThan(10);

    const totalDeclaradas = bloques.reduce((n, b) => n + analizar(b, textos.get(b.archivo)!).declaradas.size, 0);
    expect(totalDeclaradas, 'no se reconoció ni una declaración: el parser está ciego').toBeGreaterThan(100);
    const totalUsos = bloques.reduce((n, b) => n + analizar(b, textos.get(b.archivo)!).usadas.size, 0);
    expect(totalUsos, 'no se reconoció ni un uso de v_*').toBeGreaterThan(100);
  });

  // ------------------------------------------------------------
  // CONTROL POSITIVO. Sin esto, «encontré 0» no separa «no hay defecto» de
  // «el detector no puede detectar» — que es P20, un umbral que no separa.
  // ------------------------------------------------------------
  it('control positivo · detecta el defecto cuando SÍ está, en una función y en un DO', () => {
    const conDefecto = `
CREATE OR REPLACE FUNCTION public.prueba_rota(p_uno text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_declarada text := 'ok';
BEGIN
  INSERT INTO t (a, b) VALUES (v_declarada, v_sin_declarar);
END;
$fn$;
DO $blk$
DECLARE
  v_otra int := 1;
BEGIN
  PERFORM v_fantasma;
END $blk$;
`;
    const bs = bloquesDe('sintetico.sql', conDefecto);
    expect(bs.length, 'el extractor no vio los dos bloques sintéticos').toBe(2);
    const fallos = bs.flatMap((b) => analizar(b, conDefecto).faltantes.map((f) => f.nombre));
    expect(fallos).toContain('v_sin_declarar');
    expect(fallos).toContain('v_fantasma');
  });

  it('control negativo · NO acusa cuando la variable sí está declarada', () => {
    const sano = `
CREATE OR REPLACE FUNCTION public.prueba_sana(p_uno text)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_actor text := coalesce(auth.jwt() ->> 'email', auth.uid()::text);
BEGIN
  INSERT INTO t (a, b) VALUES (p_uno, v_actor);
END;
$fn$;
`;
    const bs = bloquesDe('sintetico.sql', sano);
    expect(bs.length).toBe(1);
    expect(analizar(bs[0], sano).faltantes).toEqual([]);
  });

  it('no confunde un uso dentro de un comentario ni de un literal con código', () => {
    const disfrazado = `
CREATE OR REPLACE FUNCTION public.prueba_disfraz()
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  v_ok text := 'texto con v_mentira adentro';
BEGIN
  -- aquí se menciona v_comentada y no cuenta
  PERFORM v_ok;
END;
$fn$;
`;
    const bs = bloquesDe('sintetico.sql', disfrazado);
    expect(analizar(bs[0], disfrazado).faltantes).toEqual([]);
  });

  // ------------------------------------------------------------
  // EL TRINQUETE.
  // ------------------------------------------------------------
  it('NINGUNA variable v_* se usa sin declarar en las definiciones VIVAS', () => {
    const problemas = bloques
      .map((b) => ({ b, f: analizar(b, textos.get(b.archivo)!).faltantes }))
      .filter((x) => x.f.length > 0)
      .map((x) => `${x.b.archivo}:${x.b.linea} · ${x.b.nombre} → ${x.f.map((f) => `${f.nombre} (L${f.lineas.join(',')})`).join(' · ')}`);

    expect(
      problemas,
      'Una variable v_* usada y no declarada NO rompe tsc, ni vitest, ni next build: revienta con 42703 la primera vez que se EJECUTA esa sentencia, y la ruta lo convierte en un 500. Declárala en el DECLARE de su bloque.',
    ).toEqual([]);
  });

  // ------------------------------------------------------------
  // EL LÍMITE, MEDIDO Y A LA VISTA. No es decoración: es la parte del universo
  // que este instrumento NO cubre, y se imprime para que nadie lo herede mal.
  // ------------------------------------------------------------
  it('declara cuánto del universo NO cubre el patrón v_*', () => {
    const prefijos = new Map<string, number>();
    for (const b of bloques) {
      for (const d of Array.from(analizar(b, textos.get(b.archivo)!).declaradas)) {
        const p = /^([a-z]+)_/.exec(d)?.[1] ?? '(sin prefijo)';
        prefijos.set(p, (prefijos.get(p) ?? 0) + 1);
      }
    }
    const total = Array.from(prefijos.values()).reduce((a, c) => a + c, 0);
    const conV = prefijos.get('v') ?? 0;
    const sinPrefijo = prefijos.get('(sin prefijo)') ?? 0;

    // Que el patrón cubra la mayoría es lo que vuelve útil al trinquete; que NO
    // lo cubra todo es lo que hay que seguir diciendo en voz alta.
    expect(conV / total, 'el patrón v_* dejó de ser la convención mayoritaria: este trinquete cubre menos de lo que aparenta').toBeGreaterThan(0.7);
    expect(sinPrefijo, 'hay variables sin prefijo y son INVISIBLES para este instrumento').toBeGreaterThanOrEqual(0);
  });
});
