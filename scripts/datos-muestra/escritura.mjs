// ============================================================
// scripts/datos-muestra/escritura.mjs
// Escribe a disco lo que `generador.mjs` calcula: fixtures JSON, constantes y libros .xlsx.
// Los .xlsx llevan metadatos NEUTROS («Demo») y fechas FIJAS: dos corridas dan los mismos bytes.
// ============================================================
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { construirMuestra, RUTA_FIXTURES } from './generador.mjs';

const require = createRequire(import.meta.url);

/** Ruta (relativa a la raíz) del manifiesto de constantes versionado. */
export const RUTA_CONSTANTES = `${RUTA_FIXTURES}/muestra/constantes.json`;

const FECHA_FIJA = new Date(Date.UTC(2031, 0, 15, 12, 0, 0));

function aHoja(XLSX, grid) {
  const aoa = grid.map((fila) =>
    fila.map((c) => {
      if (c === null || c === undefined) return undefined;
      if (typeof c === 'object' && c.__serial !== undefined) return { t: 'n', v: c.__serial, z: 'dd-mmm-yy' };
      return c;
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const ancho = grid.reduce((m, f) => Math.max(m, f.length), 0);
  // rango explícito: conserva las filas/columnas vacías de arriba (banner, gutter) tal como las trae un libro real
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(grid.length - 1, 0), c: Math.max(ancho - 1, 0) } });
  return ws;
}

/** Bytes de un libro (determinista). */
export function bytesDeLibro(libro) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  for (const h of libro.hojas) XLSX.utils.book_append_sheet(wb, aHoja(XLSX, h.grid), h.nombre);
  wb.Props = {
    Title: libro.titulo,
    Author: 'Demo',
    LastAuthor: 'Demo',
    Company: 'Demo',
    CreatedDate: FECHA_FIJA,
    ModifiedDate: FECHA_FIJA,
  };
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }));
}

/**
 * Escribe solo si el archivo falta o su contenido difiere, y por archivo temporal + renombrado:
 * dos corridas simultáneas (p. ej. dos `vitest` a la vez) nunca se pisan ni dejan un libro a medias.
 */
function escribir(ruta, contenido) {
  mkdirSync(dirname(ruta), { recursive: true });
  const nuevo = Buffer.isBuffer(contenido) ? contenido : Buffer.from(contenido, 'utf8');
  if (existsSync(ruta) && readFileSync(ruta).equals(nuevo)) return;
  const tmp = `${ruta}.${process.pid}.tmp`;
  writeFileSync(tmp, nuevo);
  try {
    renameSync(tmp, ruta);
  } catch {
    // Windows: el destino puede estar abierto por otra corrida; si ya tiene el mismo contenido, basta
    try {
      unlinkSync(tmp);
    } catch {
      /* nada que limpiar */
    }
    if (!(existsSync(ruta) && readFileSync(ruta).equals(nuevo))) throw new Error(`no se pudo escribir ${ruta}`);
  }
}

/** Texto del manifiesto de constantes. */
export function textoConstantes(constantes) {
  return `${JSON.stringify(constantes, null, 2)}\n`;
}

/**
 * Genera el conjunto. `raiz`: raíz del repo. `soloLibros`: no toca los JSON versionados.
 * Devuelve las rutas escritas.
 */
export function generarDatosMuestra({ raiz, soloLibros = false } = {}) {
  const base = raiz ?? process.cwd();
  const { json, libros, librosExtra, constantes } = construirMuestra();
  const escritas = [];
  if (!soloLibros) {
    for (const [rel, texto] of Object.entries(json)) {
      escribir(join(base, rel), texto);
      escritas.push(rel);
    }
    escribir(join(base, RUTA_CONSTANTES), textoConstantes(constantes));
    escritas.push(RUTA_CONSTANTES);
  }
  for (const libro of [...libros, ...librosExtra]) {
    escribir(join(base, libro.ruta), bytesDeLibro(libro));
    escritas.push(libro.ruta);
  }
  return escritas;
}

/** ¿Coinciden los JSON y el manifiesto del disco con lo que el generador emite hoy? Devuelve las rutas que difieren. */
export function verificarVersionados({ raiz } = {}) {
  const base = raiz ?? process.cwd();
  const { json, constantes } = construirMuestra();
  const difieren = [];
  const esperado = { ...json, [RUTA_CONSTANTES]: textoConstantes(constantes) };
  for (const [rel, texto] of Object.entries(esperado)) {
    const ruta = join(base, rel);
    if (!existsSync(ruta) || readFileSync(ruta, 'utf8') !== texto) difieren.push(rel);
  }
  return difieren;
}
