#!/usr/bin/env node
// ============================================================
// [2.0.1-C] copiar-pdf-worker.mjs — mantiene `public/pdf.worker.min.mjs`
// pegado a la versión de `pdfjs-dist` que está instalada.
//
// POR QUÉ EXISTE. `proyecto-documento-previa.tsx` fija
// `GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'` para que el worker
// cargue desde el MISMO origen (sin `blob:`, sin 404 relativo a la ruta
// `/proyectos/<uuid>`). Ese archivo no lo sirve node_modules: tiene que vivir
// en `public/`, que Next expone tal cual.
//
// EL RIESGO CON NOMBRE, si esto se vuelve un archivo copiado a mano una vez y
// olvidado: WORKER-DESINCRONIZADO. El parser (bundle de la app) y el worker
// (este archivo) tienen que ser de la MISMA versión de pdfjs-dist — versiones
// cruzadas hablan protocolos de mensajería distintos entre hilos. Un
// `npm install`/`npm update` que suba pdfjs-dist y NO vuelva a copiar el
// worker deja esa divergencia en silencio.
//
// POR QUÉ `postinstall` Y NO UN PASO MANUAL: `postinstall` corre en TODA
// invocación de `npm install`/`npm ci` en la raíz del proyecto —no solo la
// primera vez—, así que la copia se refresca sola cada vez que el árbol de
// dependencias se toca. `public/pdf.worker.min.mjs` está en `.gitignore` a
// propósito: es un artefacto DERIVADO de `node_modules/pdfjs-dist`, igual que
// `.next/`, y comitearlo sería la puerta para que las dos copias diverjan sin
// que nada lo note.
//
// FALLO SUAVE, no gate duro: si `pdfjs-dist` no está instalado (una
// instalación parcial, o alguien corriendo `npm install` sin red completa),
// este script AVISA y sale con 0 — no puede tumbar un `npm install` entero
// por un asset de una sola pestaña.
// ============================================================
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origen = join(raiz, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const destino = join(raiz, 'public', 'pdf.worker.min.mjs');

if (!existsSync(origen)) {
  console.warn(
    '[copiar-pdf-worker] No se encontró node_modules/pdfjs-dist/build/pdf.worker.min.mjs; ' +
      'se omite la copia (¿instalación parcial de pdfjs-dist?). La previa de Documento no va a poder ' +
      'montar su worker hasta que pdfjs-dist esté instalado y este script corra.',
  );
  process.exit(0);
}

mkdirSync(dirname(destino), { recursive: true });
copyFileSync(origen, destino);
console.log('[copiar-pdf-worker] public/pdf.worker.min.mjs actualizado desde pdfjs-dist.');
