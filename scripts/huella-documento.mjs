// ============================================================
// [INV-B8.1] Captura la HUELLA canónica del par de documentos y la escribe a
// disco, para que el bloque pueda probar que la presentación cambió y el
// CONTENIDO no.
//
// Se corre DOS veces: una antes de tocar el generador (produce la línea base
// que se commitea) y otra después, para inspección manual. La comparación
// automática vive en `documento.presentacion.test.ts`, con la lista blanca de los
// tres deltas mandatados.
//
// EL ORDEN IMPORTA Y NO SE PUEDE INVERTIR: si se toca el generador antes de
// capturar la línea base, la prueba deja de ser posible — no habría con qué
// comparar. Por eso este script es lo primero del bloque.
//
// El modelo es un FIXTURE FIJO, no un proyecto de producción: `ahora` se
// inyecta con una fecha constante y las partidas incluyen a propósito los
// casos incómodos (peor caso de longitud, remanente, sobre-reservado, sin
// tecnología, con y sin foto). Un proyecto real cambiaría entre corridas y la
// huella no serviría para comparar nada.
//
// Uso:
//   node scripts/huella-documento.mjs <archivo-de-salida.json>
// ============================================================
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const RAIZ = process.cwd();
register('./scripts/ts-loader.mjs', pathToFileURL(RAIZ + '/'));
register('./scripts/gate-alias-loader.mjs', pathToFileURL(RAIZ + '/'));

const imp = async (rel) => import(pathToFileURL(join(RAIZ, rel)).href);
const { armarModelo } = await imp('src/services/documento/modelo.ts');
const { renderizarXlsx } = await imp('src/services/documento/xlsx.ts');
const { renderizarPdf, FORMATOS_PDF } = await imp('src/services/documento/pdf.ts');
const { huellaDe } = await imp('src/services/documento/huella.ts');
const { DETALLE_PEOR_CASO, SESION_FIXTURE, AHORA_FIXTURE } = await imp('src/services/documento/fixture-peor-caso.ts');
// Sin red: las fotos del fixture se sirven con bytes mínimos generados en código.
const { fetchDeImagenes } = await imp('src/services/documento/imagenes-minimas.ts');
globalThis.fetch = fetchDeImagenes().fetch;

const salida = process.argv[2];
if (!salida) {
  console.error('Uso: node scripts/huella-documento.mjs <archivo.json>');
  process.exit(2);
}

const base = { detalle: DETALLE_PEOR_CASO, sesion: SESION_FIXTURE, entorno: 'Desarrollo', ahora: AHORA_FIXTURE };
const xlsx = renderizarXlsx(armarModelo({ ...base, formatosEmpotrables: [] }));
const pdf = await renderizarPdf(armarModelo({ ...base, formatosEmpotrables: FORMATOS_PDF }));

const huella = huellaDe(xlsx, pdf);
writeFileSync(salida, JSON.stringify(huella, null, 2) + '\n');

console.log(`Huella escrita en ${salida}`);
console.log(`  páginas del PDF        : ${huella.pdfPaginas}`);
console.log(`  caracteres normalizados: ${huella.pdfNormalizado.length}`);
console.log(`  hojas del XLSX         : ${huella.xlsxHojas.join(', ')}`);
console.log(`  filas de Partidas      : ${huella.xlsxPartidas.length}`);
console.log(`  pares de Documento     : ${huella.xlsxDocumento.length}`);
console.log(`  hipervínculos          : ${huella.xlsxEnlaces.length}`);
