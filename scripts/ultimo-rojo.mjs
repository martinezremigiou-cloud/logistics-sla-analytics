// ============================================================
// [MVP-CIERRE] · ¿Cuál fue el último test que falló, y cuándo?
//
// Existe porque un instrumento que nadie sabe leer no es un instrumento.
// `vitest.config.ts` deja una corrida por archivo en `.vitest/` con marca
// de tiempo; esto las recorre de la más nueva a la más vieja, encuentra la
// última que tuvo rojos y los imprime con nombre, archivo y mensaje.
//
// Sirve sobre todo para las INTERMITENTES: la corrida roja de hace media
// hora sigue ahí aunque después hayan pasado cuatro verdes. Antes de esto,
// el reflejo era volver a correr la suite — y eso borraba justo la
// evidencia que se buscaba (P15).
//
// Uso:
//   node scripts/ultimo-rojo.mjs          # la última corrida con fallos
//   node scripts/ultimo-rojo.mjs --todas  # resumen de todas las corridas
// ============================================================
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), '.vitest');
const TODAS = process.argv.includes('--todas');

if (!existsSync(DIR)) {
  console.log(
    'No hay corridas registradas todavía (.vitest/ no existe).\n' +
      'Corre la suite una vez: npx vitest run',
  );
  process.exitCode = 0;
} else {
  const corridas = readdirSync(DIR)
    .filter((n) => n.startsWith('corrida-') && n.endsWith('.json'))
    .map((n) => ({ nombre: n, ruta: join(DIR, n), mtime: statSync(join(DIR, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (corridas.length === 0) {
    console.log('No hay corridas registradas todavía en .vitest/.');
    process.exitCode = 0;
  } else {
    /** Aplana los resultados del reporter json de vitest a una lista de fallos. */
    function fallosDe(json) {
      const fallos = [];
      for (const suite of json.testResults ?? []) {
        for (const t of suite.assertionResults ?? []) {
          if (t.status === 'failed') {
            fallos.push({
              archivo: suite.name ?? suite.testFilePath ?? '(archivo?)',
              titulo: [...(t.ancestorTitles ?? []), t.title].filter(Boolean).join(' > '),
              mensaje: (t.failureMessages ?? []).join('\n').split('\n').slice(0, 6).join('\n'),
            });
          }
        }
      }
      return fallos;
    }

    const leer = (c) => {
      try {
        return JSON.parse(readFileSync(c.ruta, 'utf8'));
      } catch {
        return null;
      }
    };

    if (TODAS) {
      console.log(`${corridas.length} corrida(s) registradas:\n`);
      for (const c of corridas) {
        const j = leer(c);
        if (!j) {
          console.log(`  ${c.nombre}  (ilegible)`);
          continue;
        }
        const f = fallosDe(j);
        const marca = c.nombre.replace('corrida-', '').replace('.json', '');
        console.log(
          `  ${f.length === 0 ? 'VERDE' : `ROJO(${f.length})`.padEnd(5)}  ${marca}  ` +
            `${j.numTotalTests ?? '?'} tests`,
        );
      }
      process.exitCode = 0;
    } else {
      let encontrada = null;
      let fallos = [];
      for (const c of corridas) {
        const j = leer(c);
        if (!j) continue;
        const f = fallosDe(j);
        if (f.length > 0) {
          encontrada = c;
          fallos = f;
          break;
        }
      }

      if (!encontrada) {
        console.log(
          `Ninguna de las ${corridas.length} corrida(s) registradas tuvo fallos.\n` +
            `La más reciente: ${corridas[0].nombre.replace('corrida-', '').replace('.json', '')}`,
        );
        process.exitCode = 0;
      } else {
        const marca = encontrada.nombre.replace('corrida-', '').replace('.json', '');
        const posicion = corridas.indexOf(encontrada);
        console.log('='.repeat(88));
        console.log(`ÚLTIMA CORRIDA CON FALLOS: ${marca}`);
        if (posicion > 0) {
          console.log(`(hubo ${posicion} corrida(s) VERDE después — señal de INTERMITENTE)`);
        }
        console.log('='.repeat(88));
        for (const f of fallos) {
          console.log(`\n  ARCHIVO: ${f.archivo}`);
          console.log(`  TEST:    ${f.titulo}`);
          console.log(`  ${f.mensaje.split('\n').join('\n  ')}`);
        }
        console.log('');
        console.log('='.repeat(88));
        process.exitCode = 0;
      }
    }
  }
}
