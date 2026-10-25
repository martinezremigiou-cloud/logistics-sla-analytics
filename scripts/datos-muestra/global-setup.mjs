// ============================================================
// scripts/datos-muestra/global-setup.mjs
// `globalSetup` de vitest: deja listos los libros .xlsx de muestra en `muestra/` ANTES de que
// se recolecte ninguna prueba (las suites de integración deciden a tiempo de colección si
// corren o se saltan según existan esos libros).
//
// · Determinista y rápido (< 1 s): la misma semilla produce los mismos bytes.
// · Sin red, sin dependencias nuevas: funciona igual en la máquina de desarrollo y en CI.
// · Idempotente y seguro con varias corridas simultáneas: solo escribe un libro si falta o su
//   contenido difiere, y lo hace por archivo temporal + renombrado (nunca deja un libro a medias).
// · No toca los JSON versionados: esos los cuida `npm run datos:muestra` y la prueba
//   `datos-muestra.test.ts` falla si dejan de coincidir con el generador.
// ============================================================
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generarDatosMuestra } from './escritura.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default function setup() {
  generarDatosMuestra({ raiz: RAIZ, soloLibros: true });
}
