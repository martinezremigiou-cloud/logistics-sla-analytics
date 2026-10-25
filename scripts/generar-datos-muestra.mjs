#!/usr/bin/env node
// ============================================================
// scripts/generar-datos-muestra.mjs
// Generador de DATOS DE MUESTRA: valores 100 % inventados, desde una semilla fija
// (`scripts/datos-muestra/base.mjs`), con la misma estructura que los archivos de
// producción que el ETL lee. Sin red, sin dependencias nuevas (usa `xlsx`).
//
// Qué emite:
//   · fixtures JSON versionados  src/services/etl/__tests__/fixtures/{muestra,edge}/
//   · manifiesto de constantes   src/services/etl/__tests__/fixtures/muestra/constantes.json
//     (cardinalidades, SKU testigo y sumas calculadas POR CONSTRUCCIÓN: las pruebas lo importan)
//   · libros .xlsx (carpeta `muestra/`, IGNORADA por git, se regeneran siempre)
//   · parche de clasificación (src/services/parche/__fixtures__/): foto de productos vivos inventada
//     + su manifiesto de constantes (JSON versionados) y el libro `muestra/clasificacion-parche.xlsx`
//     (hojas Inventario + INV WEST); modelo en scripts/datos-muestra/modelo-parche.mjs
//
// Uso:
//   npm run datos:muestra                 → todo
//   node scripts/generar-datos-muestra.mjs --solo-libros
//   node scripts/generar-datos-muestra.mjs --verificar   → falla (exit 1) si los JSON versionados
//                                                           ya no coinciden con lo que el generador emite
// Como módulo: `import { generarDatosMuestra } from './generar-datos-muestra.mjs'`.
// ============================================================
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generarDatosMuestra, verificarVersionados } from './datos-muestra/escritura.mjs';

export { generarDatosMuestra, verificarVersionados };
export { construirMuestra } from './datos-muestra/generador.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--verificar')) {
    const difieren = verificarVersionados({ raiz: RAIZ });
    if (difieren.length > 0) {
      console.error(`Los fixtures versionados NO coinciden con el generador:\n  ${difieren.join('\n  ')}\nCorre: npm run datos:muestra`);
      process.exit(1);
    }
    console.log('Fixtures versionados al día.');
  } else {
    const escritas = generarDatosMuestra({ raiz: RAIZ, soloLibros: args.includes('--solo-libros') });
    console.log(`Datos de muestra generados (${escritas.length} archivos):\n  ${escritas.join('\n  ')}`);
  }
}
