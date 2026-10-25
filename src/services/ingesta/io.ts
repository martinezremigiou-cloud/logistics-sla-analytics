// ============================================================
// src/services/ingesta/io.ts  (NO puro — E/S real: node:fs + xlsx)
// Lectura de archivos reales (.xlsx) a `WorkbookGrids`, y carga de la
// referencia de ABRIL 2026 (los fixtures de muestra YA versionados del
// ETL, ver `src/services/etl/__tests__/fixtures/muestra/`) para el
// comparativo estructural de `preflight.ts`.
//
// Usado por:
//  - `scripts/ingesta-mensual.mjs` (vía `scripts/ts-loader.mjs`, que
//    habilita que ese script — plain `node`, sin paso de build de TS —
//    importe este módulo y el resto del motor/preflight tal cual).
//  - Los tests de integración de `motor.ts`/`preflight.ts`.
//
// `motor.ts` y `preflight.ts` en sí NO importan este archivo (deben
// quedar PUROS): la composición (leer → mapear → analizar) ocurre en
// el llamador (CLI o test).
// ============================================================
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type * as XLSXTypes from 'xlsx';
import type { Grid, SheetGrid } from '../etl/types';
import type { WorkbookGrids } from './motor';

// `require('xlsx')` real (vía createRequire) en vez de `import * as`:
// el interop ESM<->CJS de Node no detecta de forma confiable TODOS los
// named exports de este paquete (namespace import a veces deja
// `XLSX.readFile` indefinido en runtime, aunque tsc lo tipe bien) —
// `require` de Node siempre da el `module.exports` completo, sin
// ambigüedad, y funciona igual bajo vitest (Vite) y bajo `node` plano
// (ver `scripts/ts-loader.mjs`). Import de tipos aparte (`import
// type`, se borra en runtime) para mantener el tipado fuerte sin `any`.
const require = createRequire(import.meta.url);
const XLSX: typeof XLSXTypes = require('xlsx');

/**
 * Lee TODAS las hojas de un .xlsx a `WorkbookGrids`. `raw:true`:
 * los parsers del ETL ya toleran número/texto/fecha-serial de forma
 * indistinta (ver `parseFecha`/`parseEuroNumber`), así que se preserva
 * el tipo nativo de la celda tal cual Excel lo guarda.
 *
 * Si `filePath` no existe, lanza un Error de dominio claro ("No existe
 * el archivo: <ruta>") en vez de dejar que `XLSX.readFile` reviente con
 * un ENOENT crudo — los libros de muestra en `muestra/` NO están
 * versionados en git (los genera `scripts/generar-datos-muestra.mjs`), así
 * que en un clon fresco faltan por diseño; los callers de este módulo
 * (tests de integración, `scripts/ingesta-mensual.mjs`)
 * necesitan un mensaje accionable, no un stacktrace de `xlsx` (fix M-1).
 */
export function leerWorkbookXlsx(filePath: string, nombreArchivo?: string): WorkbookGrids {
  if (!existsSync(filePath)) {
    throw new Error(`No existe el archivo: ${filePath}`);
  }
  const wb = XLSX.readFile(filePath, { cellDates: false });
  return workbookAGrids(wb, nombreArchivo ?? filePath);
}

/**
 * [RECEPCION] La MISMA conversión libro→grids que usa `leerWorkbookXlsx`,
 * extraída para que disco y memoria no puedan divergir.
 *
 * No es una preferencia de estilo: el Gate 2 de este bloque exige que el
 * camino viejo (archivo → CLI → JSON → /api/refresh) y el nuevo (archivo →
 * ruta → ETL) produzcan resultados IDÉNTICOS. Si cada uno tuviera su propia
 * llamada a `sheet_to_json`, esa igualdad dependería de que las dos listas
 * de opciones se mantengan sincronizadas a mano — y un `raw:false` o un
 * `defval:''` de más en una de las dos desplazaría cifras de forma
 * silenciosa (exactamente el tipo de divergencia que P11 describe: el
 * número visible casi no se mueve, y la fuente ya está mal leída).
 * Compartiendo esta función, la equivalencia es por CONSTRUCCIÓN: no hay
 * dos configuraciones que puedan separarse.
 */
function workbookAGrids(wb: XLSXTypes.WorkBook, nombreArchivo: string): WorkbookGrids {
  presupuestoDeCeldas(wb, nombreArchivo);
  const hojas = wb.SheetNames.map((nombre) => ({
    nombre,
    grid: XLSX.utils.sheet_to_json(wb.Sheets[nombre], {
      header: 1,
      raw: true,
      defval: null,
    }) as Grid,
  }));
  return { nombreArchivo, hojas };
}

/**
 * Tope de celdas DECLARADAS por el libro, con margen medido.
 *
 * De dónde sale el número: un libro de inventario típico declara muchas
 * menos celdas, y la hoja individual más grande es la `Reserva`.
 * 2,000,000 deja más de un orden de magnitud de
 * holgura sobre el libro más grande esperado, y acota la
 * memoria en torno a los 70 MB (medido: 49.1 M celdas
 * consumieron 1,703 MB ⇒ ~35 bytes por celda).
 */
const MAX_CELDAS_LIBRO = 2_000_000;

/**
 * [RECEPCION] · Corta la AMPLIFICACIÓN por `<dimension>` antes de que
 * `sheet_to_json` asigne memoria.
 *
 * El problema, medido con la función real de este archivo: `sheet_to_json`
 * dimensiona el grid según el `<dimension ref>` que declara el XML de la
 * hoja — y ese XML lo controla quien manda el archivo. Un `.xlsx` VÁLIDO de
 * ~2 KB con `<dimension ref="A1:XFD3000"/>` produce un grid de
 * 3,000 × 16,384 y consume **1,703 MB de RSS en 24 s**; con `XFD200000` el
 * proceso muere por OOM (`heap out of memory`) a los ~48 s.
 *
 * Ninguna de las otras barreras lo detiene, y vale escribir por qué:
 *   · el tope de 15 MB del cuerpo no aplica — la entrada son 2 KB;
 *   · la guarda de firma ZIP tampoco — el archivo ES un ZIP válido, la
 *     firma solo mira 4 bytes y no sabe nada del contenido;
 *   · `maxDuration=60` acota el RELOJ, no la MEMORIA: el OOM llega antes
 *     del corte. Y fuera de Vercel (self-host con `next start`, que este
 *     proyecto soporta) `maxDuration` ni siquiera existe: el OOM se lleva
 *     el proceso Node entero, con todas las rutas y todos los usuarios.
 *
 * Por eso el cerrojo va aquí, sobre el rango DECLARADO y antes de asignar
 * nada — no sobre el resultado, que para entonces ya se pagó.
 *
 * Hallado por la auditoría adversarial de seguridad del bloque [RECEPCION].
 */
function presupuestoDeCeldas(wb: XLSXTypes.WorkBook, nombreArchivo: string): void {
  let total = 0;
  for (const nombre of wb.SheetNames) {
    const ref = wb.Sheets[nombre]?.['!ref'];
    if (!ref) continue; // hoja sin rango declarado: no asigna nada
    let rango: XLSXTypes.Range;
    try {
      rango = XLSX.utils.decode_range(ref);
    } catch {
      throw new Error(`La hoja "${nombre}" de "${nombreArchivo}" declara un rango ilegible (${ref}).`);
    }
    const filas = rango.e.r - rango.s.r + 1;
    const columnas = rango.e.c - rango.s.c + 1;
    if (filas <= 0 || columnas <= 0) continue;
    total += filas * columnas;
    if (total > MAX_CELDAS_LIBRO) {
      throw new Error(
        `El libro "${nombreArchivo}" declara demasiadas celdas (más de ${MAX_CELDAS_LIBRO.toLocaleString('es-MX')} ` +
          `al llegar a la hoja "${nombre}", que declara ${filas.toLocaleString('es-MX')} filas × ` +
          `${columnas.toLocaleString('es-MX')} columnas). Un libro real de este proyecto declara menos de 100,000 ` +
          'en total: un rango de este tamaño indica un archivo corrupto o manipulado, no un mes con muchos datos.',
      );
    }
  }
}

/**
 * [RECEPCION] O2 · Lee un .xlsx que YA está en memoria (lo que llega por
 * HTTP), sin pasar por disco. En un servidor no hay ruta: Power Automate
 * entrega un flujo de bytes.
 *
 * `XLSX.read(..., { type: 'buffer' })` con las MISMAS opciones de
 * conversión que la variante de disco (ver `workbookAGrids`).
 *
 * EXIGE la firma de ZIP (`PK\x03\x04`) antes de entregar los bytes a la
 * librería, y esa guarda es LO CONTRARIO de decorativa. Medido:
 * `XLSX.read` AUTODETECTA formato, así que con bytes que no son un ZIP no
 * lanza ni devuelve un libro vacío — cae a interpretarlos como CSV/texto y
 * devuelve una hoja `Sheet1` con contenido plausible:
 *
 *     0 bytes                -> hojas=['Sheet1'], grid [[null]]
 *     [1,2,3,4,5]            -> hojas=['Sheet1'], grid [['\x01\x02…']]
 *     'hola, no soy un excel'-> hojas=['Sheet1'], grid [['hola',' no soy…']]
 *
 * Sin esta guarda, un cuerpo corrupto entraba al pipeline disfrazado de
 * libro legítimo. Para STOCK el gate de INV-B8 lo habría atrapado (ninguna
 * hoja se llama Inventario/Reserva/INV WEST ⇒ `DatasetsStockFaltantesError`),
 * pero para ADUANA **no**: el dataset `embarques` es CATCH-ALL —toda hoja
 * no excluida cae ahí— así que `Sheet1` se habría asignado y el resultado
 * sería un snapshot de 0 embarques reportado como éxito. Justo el éxito
 * falso que P10 describe, entrando por el único lado que aquel gate no
 * cubre.
 *
 * Un ZIP con firma válida pero contenido roto SÍ hace lanzar a la librería
 * (`Unsupported ZIP Compression method …`), y ese error se deja propagar:
 * el caller —la ruta HTTP— lo traduce a un error de dominio. Aquí no se
 * atrapa, para no volver a confundir "ilegible" con "vacío".
 */
export function leerWorkbookDesdeBuffer(
  datos: ArrayBuffer | Uint8Array,
  nombreArchivo: string,
): WorkbookGrids {
  const buffer = datos instanceof Uint8Array ? datos : new Uint8Array(datos);
  if (!esZip(buffer)) {
    throw new Error(
      `El contenido de "${nombreArchivo}" no es un .xlsx: no empieza con la firma de un ZIP.`,
    );
  }
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  return workbookAGrids(wb, nombreArchivo);
}

/** Firma `PK\x03\x04`: todo .xlsx es un ZIP por dentro. */
function esZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

const FIXTURES_DIR = join(process.cwd(), 'src/services/etl/__tests__/fixtures/muestra');

function leerFixtureJson<T>(nombre: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, nombre), 'utf8')) as T;
}

/**
 * Referencia de ABRIL 2026: reconstruida desde los fixtures de muestra YA
 * versionados de B2 —
 * única fuente de verdad de "cómo era abril", sin mantener una segunda
 * copia. Los nombres de hoja de STOCK están hardcodeados porque esos
 * 3 fixtures son grids sueltos (sin nombre de hoja adjunto, ver
 * `adapter.ts`/`refresh.schema.ts`: el body de stock manda cada
 * dataset como un `Grid` suelto, no como hoja nombrada); son los
 * nombres de hoja del libro de origen. Los de ADUANA sí vienen con nombre de hoja
 * (`embarques.sheets.json` es `{hoja, grid}[]`).
 */
export function cargarReferenciaAbril(): { stock: WorkbookGrids; aduana: WorkbookGrids } {
  const inventario = leerFixtureJson<Grid>('inventario.grid.json');
  const west = leerFixtureJson<Grid>('west.grid.json');
  const reserva = leerFixtureJson<Grid>('reserva.grid.json');
  const embarques = leerFixtureJson<SheetGrid[]>('embarques.sheets.json');

  return {
    stock: {
      nombreArchivo: '07ABRIL26 Inventario Demo.ods (fixture de muestra, abril 2026)',
      hojas: [
        { nombre: 'Inventario', grid: inventario },
        { nombre: 'INV_WEST', grid: west },
        { nombre: 'Reserva', grid: reserva },
      ],
    },
    aduana: {
      nombreArchivo: 'Seguimiento de Embarques Demo 2026 .xlsx (fixture de muestra, abril 2026)',
      hojas: embarques.map((s) => ({ nombre: s.hoja, grid: s.grid })),
    },
  };
}
