// ============================================================
// [S4 · prueba propia, no de S2] stockOmitido NO reabre la esquina F
// por la puerta HTTP (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`).
//
// Contexto: `construirBodyDesdeArchivo` (desde-archivo.ts) ahora declara
// `stockOmitido: opts.source === 'aduana'` al llamar a `construirDatasets`
// — necesario para que `source=aduana` (que SÍ omite stock a propósito,
// recibe UN archivo y no hay libro de stock que evaluar) no bloquee más.
//
// Esta prueba verifica el lado opuesto, el que el coordinador pidió
// comprobar explícito: para `source=stock` esa MISMA expresión da
// `stockOmitido: false`, así que un libro de STOCK con CERO HOJAS —el
// fixture REAL de la esquina F (`fixtures/cero-hojas.xlsx`), no un stub
// sintético— debe SEGUIR bloqueando. Dos capas, verificadas por separado:
//
//   capa 1 (la que corre en producción hoy): `desde-archivo.ts:199`
//     (`if (libro.hojas.length === 0) throw ArchivoIlegibleError`) —
//     NO se tocó en este bloque, sigue disparando ANTES de llegar a
//     `construirDatasets`.
//   capa 2 (defensa en profundidad, motor.ts): si la capa 1 no
//     existiera, `stockOmitido: false` para source=stock hace que
//     `construirDatasets` bloquee IGUAL por su propio gate — la
//     declaración explícita no es un permiso universal, es específica
//     a `source=aduana`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirBodyDesdeArchivo, ArchivoIlegibleError, type FuenteArchivo } from '../desde-archivo';
import { leerWorkbookDesdeBuffer } from '../io';
import { construirDatasets, DatasetsStockFaltantesError, type WorkbookGrids } from '../motor';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CERO_HOJAS = join(AQUI, 'fixtures', 'cero-hojas.xlsx');
const CAPTURED_AT = '2026-08-06T00:00:00.000Z';

describe('stockOmitido no reabre la esquina F por la puerta HTTP (source=stock)', () => {
  it('capa 1 (producción): construirBodyDesdeArchivo con source=stock y el fixture de cero hojas SIGUE lanzando ArchivoIlegibleError — desde-archivo.ts:199 no se tocó', () => {
    const bytes = readFileSync(FIXTURE_CERO_HOJAS);
    expect(() =>
      construirBodyDesdeArchivo(bytes, {
        source: 'stock',
        nombreArchivo: 'cero-hojas.xlsx',
        capturedAt: CAPTURED_AT,
      }),
    ).toThrow(ArchivoIlegibleError);
  });

  it('capa 2 (defensa en profundidad): la MISMA expresión que ahora usa desde-archivo.ts (`stockOmitido: source === "aduana"`) da `false` para source=stock — si la capa 1 no existiera, construirDatasets SIGUE bloqueando por su propio gate', () => {
    const bytes = readFileSync(FIXTURE_CERO_HOJAS);
    const libroCeroHojas: WorkbookGrids = leerWorkbookDesdeBuffer(bytes, 'cero-hojas.xlsx');
    expect(libroCeroHojas.hojas.length).toBe(0); // mismo fixture real, no un stub sintético

    // `opts.source` tipado como `FuenteArchivo` (no un literal `const`
    // suelto) a propósito: así la comparación de abajo es EXACTAMENTE la
    // misma expresión de desde-archivo.ts, sin que TS la marque como
    // "siempre falsa" por sobre-angostar un literal (TS2367).
    const opts: { source: FuenteArchivo } = { source: 'stock' };
    const stockOmitido = opts.source === 'aduana'; // === la expresión literal de desde-archivo.ts
    expect(stockOmitido).toBe(false);

    const aduanaConContenido: WorkbookGrids = {
      nombreArchivo: 'a.xlsx',
      hojas: [{ nombre: 'BRAND1', grid: [['ITEM', 'ESTATUS']] }],
    };

    expect(() =>
      construirDatasets({ stock: libroCeroHojas, aduana: aduanaConContenido }, ingestaMapeoConfig, {
        capturedAt: CAPTURED_AT,
        stockOmitido,
      }),
    ).toThrow(DatasetsStockFaltantesError);
  });
});
