// ============================================================
// [S2 · pruebas rojas · REPRODUCIBILIDAD] Prueba 6 · Esquina F
// ("F1 — el gate que se salta a sí mismo"; ver
// `docs/decisions/0003-empty-and-degraded-input-guards.md`).
//
// NO SE TOCA `motor.ts` en esta prueba (prohibido para este frente). Esta
// prueba debe FALLAR hoy y ponerse verde cuando otro frente (S4) mueva la
// condición de `motor.ts:292`.
//
// EL HALLAZGO MEDIDO POR S1, que esta prueba
// reproduce con el fixture REAL en vez de un objeto sintético:
//   · `XLSX.write(book_new())` (la librería) SE NIEGA a producir un libro
//     sin hojas — por eso el comentario de `motor.ts:33-35` ("un .xlsx
//     real siempre trae ≥1 hoja") parecía verdad.
//   · Pero un ZIP fabricado A MANO, con firma `PK\x03\x04` real y
//     `xl/workbook.xml` con `<sheets/>` VACÍO, SÍ es un .xlsx válido para
//     `XLSX.read` — y `leerWorkbookDesdeBuffer` (io.ts) lo acepta sin
//     lanzar, devolviendo `hojas: []`. La premisa del comentario es falsa;
//     solo estaba a salvo por OTRA guarda (`desde-archivo.ts:174`), no por
//     la razón que alega.
//
// Ese fixture es justo el que se usa aquí — copiado tal cual desde el
// scratchpad de S1 (1167 bytes, firma ZIP real), y se conserva como
// activo de prueba PERMANENTE (ese archivo vale más que el fix).
//
// LO QUE ESTA PRUEBA CUBRE Y NO DUPLICA:
//   `motor.test.ts` ya tiene el caso "NO lanza si el libro de stock viene
//   con 0 hojas — opt-out explícito del caller" (WorkbookGrids SINTÉTICO,
//   `{hojas: []}` escrito a mano, representando un CLI de
//   solo aduana). Ese test documenta un comportamiento HOY DESEADO
//   (opt-out deliberado) y no debe tocarse.
//
//   Esta prueba es OTRA cosa: alimenta `construirDatasets` con hojas: []
//   que vienen de un .xlsx REAL (bytes → `leerWorkbookDesdeBuffer` → 0
//   hojas), en el rol de una carga de STOCK genuina (no un stub de "aduana
//   omitió stock a propósito") — exactamente el caso que motor.ts:292 NO
//   puede distinguir del opt-out, porque ambos colapsan a
//   `archivos.stock.hojas.length === 0`. Se llama a `construirDatasets`
//   DIRECTO (no vía `desde-archivo.ts`) a propósito: motor.ts:292 sigue
//   teniendo la condición que se excluye a sí misma como defensa en
//   profundidad — si algún día otro caller (p.ej. el CLI) invoca
//   `construirDatasets` sin pasar por el guardia de `desde-archivo.ts:174`,
//   la rendija se abre sin que nada avise.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { construirDatasets, DatasetsStockFaltantesError, type WorkbookGrids } from '../motor';
import { leerWorkbookDesdeBuffer } from '../io';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CERO_HOJAS = join(AQUI, 'fixtures', 'cero-hojas.xlsx');
const CAPTURED_AT = '2026-08-05T00:00:00.000Z';

describe('esquina F · construirDatasets con un .xlsx REAL de cero hojas (fixture permanente)', () => {
  it('premisa: el fixture es un ZIP válido (firma PK\x03\x04, 1167 bytes) que leerWorkbookDesdeBuffer acepta con hojas.length === 0 — la base falsa del comentario de motor.ts:33-35', () => {
    const bytes = readFileSync(FIXTURE_CERO_HOJAS);
    expect(bytes.length).toBe(1167);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

    const libro = leerWorkbookDesdeBuffer(bytes, 'cero-hojas.xlsx');
    expect(libro.hojas).toEqual([]);
  });

  it('[ROJO HOY] construirDatasets(), alimentado con las hojas de un .xlsx REAL de cero hojas como STOCK genuino, DEBE lanzar DatasetsStockFaltantesError (mismo gate que ya dispara con un archivo ajeno) — motor.ts:292 lo salta hoy y devuelve 3 datasets vacíos sin avisar', () => {
    const bytes = readFileSync(FIXTURE_CERO_HOJAS);
    const libroCeroHojas: WorkbookGrids = leerWorkbookDesdeBuffer(bytes, 'cero-hojas.xlsx');
    expect(libroCeroHojas.hojas.length).toBe(0); // repite la premisa: esto NO es un stub sintético

    const aduanaVacia: WorkbookGrids = { nombreArchivo: '(no aplica en esta prueba)', hojas: [] };

    let lanzo: unknown = null;
    let resultadoSiNoLanzo: ReturnType<typeof construirDatasets> | null = null;
    try {
      resultadoSiNoLanzo = construirDatasets(
        { stock: libroCeroHojas, aduana: aduanaVacia },
        ingestaMapeoConfig,
        { capturedAt: CAPTURED_AT },
      );
    } catch (e) {
      lanzo = e;
    }

    // Documenta, si no lanzó, EXACTAMENTE lo que motor.ts:292 deja pasar
    // hoy: 3 datasets vacíos reportados como si fueran un resultado válido.
    if (lanzo === null && resultadoSiNoLanzo !== null) {
      expect(resultadoSiNoLanzo.bodyStock.datasets).toEqual({ inventario: [], west: [], reserva: [] });
    }

    expect(lanzo).toBeInstanceOf(DatasetsStockFaltantesError);
  });
});
