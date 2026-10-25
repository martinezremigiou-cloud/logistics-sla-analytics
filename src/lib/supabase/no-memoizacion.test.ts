// ============================================================
// [MVP-CIERRE] F1 · Alambre-trampa contra la memoización del cliente.
//
// POR QUÉ EXISTE. El presupuesto de reintentos de F1 vive en el objeto del
// cliente, y todo el diseño descansa en una premisa: **un cliente por
// petición**. Si alguien memoizara el cliente a nivel de módulo, en un
// lambda tibio ese objeto sobreviviría entre invocaciones, el presupuesto
// se gastaría UNA vez en toda su vida y F1 dejaría de reintentar — sin que
// nada avise. Un fallo silencioso en el mecanismo que existe justamente
// para acabar con un fallo silencioso.
//
// LA ASIMETRÍA QUE ESTO CIERRA. `createSupabaseSessionClient()` llama a
// `cookies()` de `next/headers`, que LANZA fuera del ámbito de una
// petición: memoizarlo a nivel de módulo es imposible por CONSTRUCCIÓN, no
// por disciplina. `createSupabaseServerClient()` no tiene esa protección —
// hoy nadie lo memoiza, pero eso es convención, y la convención no se
// verifica sola. Esta prueba la vuelve verificable.
//
// LÍMITE DECLARADO, no asumido: esto es un alambre-trampa por texto, no un
// análisis del árbol sintáctico. Caza las dos formas realistas de
// memoizar (binding a nivel de módulo y singleton perezoso). Alguien
// suficientemente creativo puede evadirlo; el punto es que el descuido
// normal no pase.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ_SRC = join(process.cwd(), 'src');

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      archivosFuente(ruta, acc);
    } else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) {
      acc.push(ruta);
    }
  }
  return acc;
}

const FACTORIES = ['createSupabaseServerClient', 'createSupabaseSessionClient'] as const;

/** `const db = createSupabaseXClient()` SIN indentación ⇒ ámbito de módulo. */
const BINDING_DE_MODULO = new RegExp(
  `^(export\\s+)?(const|let|var)\\s+\\w+\\s*(:[^=]+)?=\\s*(await\\s+)?(${FACTORIES.join('|')})\\s*\\(`,
);

/** `db ??= createSupabaseXClient()` — singleton perezoso, memoiza igual. */
const SINGLETON_PEREZOSO = new RegExp(`(\\?\\?=|\\|\\|=)\\s*(${FACTORIES.join('|')})\\s*\\(`);

describe('F1 · el cliente de Supabase NUNCA se memoiza a nivel de módulo', () => {
  const archivos = archivosFuente(RAIZ_SRC);

  it('encuentra archivos que revisar (la prueba no pasa por estar vacía)', () => {
    expect(archivos.length).toBeGreaterThan(50);
  });

  it('ningún archivo liga un cliente a una variable de módulo', () => {
    const infractores: string[] = [];
    for (const ruta of archivos) {
      const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
      lineas.forEach((linea, i) => {
        if (BINDING_DE_MODULO.test(linea)) {
          infractores.push(`${ruta.replace(process.cwd(), '')}:${i + 1}  ${linea.trim()}`);
        }
      });
    }
    expect(
      infractores,
      'Un cliente a nivel de módulo sobrevive entre invocaciones del lambda: el presupuesto ' +
        'de reintentos de F1 se gastaría una sola vez en su vida y dejaría de proteger. ' +
        'Crea el cliente DENTRO del handler.',
    ).toEqual([]);
  });

  it('ningún archivo usa el patrón de singleton perezoso', () => {
    const infractores: string[] = [];
    for (const ruta of archivos) {
      const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
      lineas.forEach((linea, i) => {
        if (SINGLETON_PEREZOSO.test(linea)) {
          infractores.push(`${ruta.replace(process.cwd(), '')}:${i + 1}  ${linea.trim()}`);
        }
      });
    }
    expect(infractores, 'Memoizar perezosamente tiene el mismo efecto que memoizar arriba.').toEqual([]);
  });

  // Que el detector tenga dientes: si no reconociera las formas peligrosas,
  // las dos pruebas de arriba pasarían por ciegas y no por sanas.
  it('el detector RECONOCE las formas peligrosas (control positivo)', () => {
    expect(BINDING_DE_MODULO.test('const db = createSupabaseServerClient();')).toBe(true);
    expect(BINDING_DE_MODULO.test('export const admin = createSupabaseServerClient()')).toBe(true);
    expect(BINDING_DE_MODULO.test('let cliente = createSupabaseSessionClient();')).toBe(true);
    expect(SINGLETON_PEREZOSO.test('  db ??= createSupabaseServerClient();')).toBe(true);
    expect(SINGLETON_PEREZOSO.test('  db ||= createSupabaseServerClient();')).toBe(true);
  });

  it('y NO se queja de la forma correcta (control negativo)', () => {
    // Dentro de un handler, indentado: es exactamente lo que se quiere.
    expect(BINDING_DE_MODULO.test('  const db = createSupabaseServerClient();')).toBe(false);
    expect(BINDING_DE_MODULO.test('    const admin = createSupabaseServerClient();')).toBe(false);
    // La declaración de la propia factory tampoco es un binding.
    expect(BINDING_DE_MODULO.test('export function createSupabaseServerClient() {')).toBe(false);
  });
});
