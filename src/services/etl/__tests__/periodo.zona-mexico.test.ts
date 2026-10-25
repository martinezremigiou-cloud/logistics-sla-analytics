// ============================================================
// [S2 · pruebas rojas · REPRODUCIBILIDAD] Prueba 7 · `periodo` debe
// derivarse en zona civil de México, no en UTC
// (ver `docs/decisions/0006-civil-timezone-period-derivation.md`).
//
// NO SE TOCA `runEtl.ts` en esta prueba (prohibido para este frente:
// "modificar src/services/etl/runEtl.ts" está en la lista de PROHIBIDO).
//
// Cadena medida por el bloque, un solo eslabón:
//   route.ts:124   capturedAt: new Date().toISOString()   ← instante UTC
//   runEtl.ts:95   periodo = capturedDate.slice(0, 7)      ← recorta ESE UTC
//
// A las 20:00 CDMX del 31-jul-2026, el UTC correspondiente es 02:00 del
// 1-ago-2026 (México, zona 'America/Mexico_City', es UTC-6 todo el año
// desde la Ley de horario de 2022 — sin horario de verano en la CDMX).
// `capturedDate.slice(0,7)` sobre ese UTC da '2026-08'; el periodo CIVIL
// correcto (el día que de verdad era en México en el instante de la
// captura) es '2026-07'.
//
// PRUEBA PURA, SIN RED, SIN RELOJ DEL SISTEMA:
//   El instante se FIJA construyendo el ISO de origen con su offset
//   explícito ('-06:00'), nunca con `new Date()` sin argumentos ni con
//   `vi.useFakeTimers()` — `computeSnapshot` ya es 100% determinista
//   (no llama a `Date.now()` en ningún punto: solo hace `.slice()` sobre
//   el string `capturedAt` que se le pasa), así que fijar el string de
//   entrada basta para fijar el instante completo, sin depender de la TZ
//   del runner ni de la del CI (el repo ya tiene disciplina de zona:
//   `ZONA_MEXICO` en src/lib/formato.ts, y `vitest.config.ts` fija
//   `TZ=America/Mexico_City` para el proceso de test — pero esta prueba
//   NO depende de esa variable: construye el UTC exacto a mano).
//
// El job de entrada es el MÍNIMO posible que `computeSnapshot` acepta sin
// lanzar `EtlContractError` (los 3 datasets de stock son truthy incluso
// vacíos — un arreglo `[]` es truthy en JS) para aislar SOLO el cómputo
// de `periodo`, sin depender de ningún parseo real.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeSnapshot } from '../runEtl';
import { makeCatalogIndex, emptyPrev } from './helpers';
import type { IngestJob } from '../types';

function jobMinimoStock(capturedAt: string): IngestJob {
  return {
    source: 'stock',
    capturedAt,
    archivo: null,
    inventario: [],
    west: [],
    reserva: [],
  };
}

describe('computeSnapshot — periodo en zona civil de México (G4)', () => {
  it('[VERDE — premisa] 20:00 CDMX del 31-jul-2026 equivale a 2026-08-01T02:00:00.000Z en UTC', () => {
    const capturedAtFijo = new Date('2026-07-31T20:00:00-06:00').toISOString();
    expect(capturedAtFijo).toBe('2026-08-01T02:00:00.000Z');
  });

  it('[ROJO HOY] una ingesta capturada a las 20:00 CDMX del 31-jul-2026 debe registrar periodo="2026-07" (el día civil de México en el instante de captura), no "2026-08" (el día UTC)', () => {
    const capturedAtFijo = new Date('2026-07-31T20:00:00-06:00').toISOString();
    const { payload } = computeSnapshot(jobMinimoStock(capturedAtFijo), makeCatalogIndex(), emptyPrev());

    // Documenta, para quien lea el rojo, qué produce HOY el bug (recorte
    // de capturedDate en UTC): payload.periodo HOY === '2026-08'.
    // La aserción de abajo afirma el valor CORRECTO (civil MX), no el
    // actual — por eso falla hoy.
    expect(payload.periodo).toBe('2026-07'); // ← falla hoy: hoy vale '2026-08'
  });

  it('[VERDE — control negativo, no debe romperse por el fix] 23:59:59 UTC del 31-jul: UTC y CDMX (17:59:59) caen en el MISMO mes civil (julio) — este caso ya da "2026-07" hoy, y debe SEGUIR dando "2026-07" después del fix', () => {
    // Sin este control, un "periodo" que devolviera SIEMPRE una constante
    // fija (p.ej. quien "arregle" esto hardcodeando '2026-07') pasaría la
    // prueba de arriba sin realmente calcular nada — este caso lo
    // delata: NO cruza medianoche/mes al pasar de UTC a CDMX, así que
    // sigue siendo julio en ambas zonas; una implementación que ignore
    // la zona (el bug actual) igual acierta AQUÍ, por eso hoy es VERDE —
    // la prueba roja de arriba es la que aísla específicamente el cruce
    // de mes que introduce el bug.
    const capturedAtSinCruce = '2026-07-31T23:59:59.000Z';
    const { payload } = computeSnapshot(jobMinimoStock(capturedAtSinCruce), makeCatalogIndex(), emptyPrev());
    expect(payload.periodo).toBe('2026-07');
  });
});
