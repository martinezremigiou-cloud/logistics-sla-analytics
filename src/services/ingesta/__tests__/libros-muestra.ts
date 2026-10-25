// ============================================================
// [RECEPCION] Helper de tests (NO es una suite: sin `.test.`, vitest no lo
// recolecta). Localiza los libros .xlsx de MUESTRA en la carpeta `muestra/`
// de la raíz del repo.
//
// Esa carpeta NO está versionada (la ignora git): la llena el generador de
// datos de muestra, `scripts/generar-datos-muestra.mjs` (semilla fija, valores
// inventados, misma estructura que los libros de producción). Los tres libros
// que esta suite espera, por fragmento de nombre:
//   - `inventario-unificado*.xlsx`  stock en el formato unificado vigente.
//   - `inventario-julio*.xlsx`      stock en el formato HISTÓRICO (convivencia).
//   - `seguimiento-embarques*.xlsx` aduana.
//
// Por qué no una ruta literal: un libro puede venir con sufijo (` (2)`, ` (3)`…)
// cuando el navegador lo deposita junto a otro del mismo nombre. Una ruta fija
// apuntaría a la copia rancia. Aquí se resuelve por patrón y se elige el de
// mtime MÁS RECIENTE.
//
// Bajo vitest el `globalSetup` (`vitest.config.ts` → `scripts/datos-muestra/global-setup.mjs`)
// genera esos libros antes de recolectar cualquier prueba (determinista, sin red), así que en
// `npm test` siempre existen; los saltos de abajo solo protegen a quien importe este helper por
// fuera de vitest.
//
// Si no hay ninguno (clon fresco sin haber corrido el generador), se devuelve
// `null` y la suite que lo use debe hacer `describe.skip` con una nota es-MX
// — mismo criterio que usan `motor.test.ts`/`preflight.test.ts`.
// ============================================================
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'muestra');

/** Ruta del libro más reciente cuyo nombre contiene TODOS los fragmentos dados, o `null`. */
export function libroMasReciente(...fragmentos: string[]): string | null {
  if (!existsSync(DIR)) return null;
  const candidatos = readdirSync(DIR)
    .filter((n) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$'))
    .filter((n) => fragmentos.every((f) => n.toLowerCase().includes(f.toLowerCase())))
    .map((n) => join(DIR, n));
  if (candidatos.length === 0) return null;
  return candidatos.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

/** Libro de STOCK vigente: el formato unificado (fuente mensual). */
export function libroStockVivo(): string | null {
  return libroMasReciente('inventario-unificado', '.xlsx');
}

/** Libro de ADUANA vigente: seguimiento de embarques. */
export function libroAduanaVivo(): string | null {
  return libroMasReciente('seguimiento-embarques');
}

/** Libro de STOCK en formato HISTÓRICO — se conserva legible (convivencia de eras). */
export function libroStockJulio(): string | null {
  return libroMasReciente('inventario-julio');
}
