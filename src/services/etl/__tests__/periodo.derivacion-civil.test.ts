// ============================================================
// [S6 · REPRODUCIBILIDAD G4] Los EFECTOS DE SEGUNDO ORDEN de derivar
// `periodo` en zona civil de México.
// (ver `docs/decisions/0006-civil-timezone-period-derivation.md`)
//
// La prueba que fija el criterio principal es
// `periodo.zona-mexico.test.ts` (S2) y NO se toca. Esta cubre lo que
// aquella no mira, y que el bloque exige "medir, no suponer":
//
//   A · el relleno `${periodo}-01` de las reservas SIN fecha en la hoja
//       (fix O5) CUELGA de `periodo`. Si `periodo` se corrige, esa fecha
//       se corrige con él. Es el otro consumidor del valor dentro de
//       `computeSnapshot`, y hoy estampa agosto en una captura que en
//       México todavía era julio.
//   B · la corrección solo puede mover el periodo HACIA ATRÁS (México es
//       UTC-6 todo el año). Esa propiedad es lo que vuelve sano al
//       predicado (A) del backfill 0023 —`periodo = mes UTC` significa
//       "lo estampó la máquina con el bug"—: si la corrección pudiera
//       adelantar el mes, (A) dejaría de identificar el sello de la
//       máquina.
//   C/D · controles de NO-REGRESIÓN de las dos ramas degradadas que la
//       implementación anterior tenía y que el fix no debe perder.
//
// Sobre los rótulos: [ROJO HOY] = falla contra el código sin el fix, así
// que prueba algo. [VERDE — no-regresión] = ya pasa hoy y su trabajo es
// seguir pasando; se declara para no venderla como guarda nueva
// (STOP&ASK 1 del bloque: "una guarda que se pone verde a la primera no
// probó nada").
//
// Determinismo: igual que la prueba de S2, el instante se FIJA en el
// string de entrada (con offset explícito `-06:00` o con `Z`), nunca con
// `new Date()` sin argumentos. `computeSnapshot` es pura respecto del
// reloj: solo lee `job.capturedAt`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { computeSnapshot } from '../runEtl';
import { RefreshBody } from '@/schemas/refresh.schema';
import { makeCatalogIndex, emptyPrev } from './helpers';
import type { Grid, IngestJob } from '../types';

// Geometría mínima válida, misma que el escenario O5 de
// `computeSnapshot.test.ts`: header por CONTENIDO, no por posición.
const inventarioMin: Grid = [
  [],
  [null, null, null, null, null, null, 'STOCK'],
  [],
  [null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV'],
  [null, 'SKU-1', '', 'NACIONAL', '', '', 'PRODUCTO DE PRUEBA', '10', '', '', '', '', '10', '0'],
];
const westMin: Grid = [['INVENTARIO WEST'], [], ['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']];
// col 3 (RETAILER64) = reserva CON fecha propia → control, nunca debe moverse.
// col 4 (RETAILER 56) = reserva SIN fecha (sentinel '') → la que hereda `periodo`.
const reservaMin: Grid = [
  ['DEMO COMERCIAL S DE RL DE CV'],
  [],
  [],
  [],
  [null, null, null, 'Laura', 'Lucas'],
  [],
  ['STOCK MEXICO', null, null, '23-abr-26', null],
  [null, null, null, 'pedido A', 'pedido B'],
  ['ITEM', null, null, 'RETAILER64', 'RETAILER 56'],
  ['SKU-1', '0', null, '8', '5'],
];

function jobCompleto(capturedAt: string): IngestJob {
  return {
    source: 'stock',
    capturedAt,
    archivo: 'periodo-civil.ods',
    inventario: inventarioMin,
    west: westMin,
    reserva: reservaMin,
  };
}

/** Job mínimo (datasets vacíos pero truthy) para aislar SOLO el cómputo de `periodo`. */
function jobMinimo(capturedAt: string): IngestJob {
  return { source: 'stock', capturedAt, archivo: null, inventario: [], west: [], reserva: [] };
}

const periodoDe = (capturedAt: string) =>
  computeSnapshot(jobMinimo(capturedAt), makeCatalogIndex(), emptyPrev()).payload.periodo;

/** Mes UTC del mismo instante — el que estampaba el código con el bug. */
const mesUtc = (capturedAt: string) => capturedAt.slice(0, 7);

describe('computeSnapshot — efectos de segundo orden de `periodo` civil (G4)', () => {
  it('[ROJO HOY · A] el relleno `${periodo}-01` de una reserva SIN fecha sigue el mes CIVIL: capturada a las 20:00 CDMX del 31-jul debe quedar en 2026-07-01, no 2026-08-01', () => {
    const capturedAt = new Date('2026-07-31T20:00:00-06:00').toISOString(); // 2026-08-01T02:00:00.000Z
    const { payload } = computeSnapshot(jobCompleto(capturedAt), makeCatalogIndex(), emptyPrev());

    const sinFecha = payload.reservas.find((r) => r.cliente === 'RETAILER 56');
    const conFecha = payload.reservas.find((r) => r.cliente === 'RETAILER64');

    // Hoy vale '2026-08-01': el relleno hereda el `periodo` mal derivado.
    expect(sinFecha?.fecha).toBe('2026-07-01');
    // Control: la reserva que SÍ trae fecha en la hoja no la toca nadie,
    // ni antes ni después del fix.
    expect(conFecha?.fecha).toBe('2026-04-23');
  });

  it('[ROJO HOY · B] la corrección solo mueve el periodo HACIA ATRÁS: en el instante que cruza el mes el civil es el ANTERIOR al UTC; en el resto coinciden (México es UTC-6 todo el año)', () => {
    const casos: { capturedAt: string; civil: string; nota: string }[] = [
      // Cruza el mes: UTC ya es agosto, en México todavía es 31 de julio.
      { capturedAt: '2026-08-01T02:00:00.000Z', civil: '2026-07', nota: '20:00 CDMX del 31-jul' },
      { capturedAt: '2026-08-01T05:59:59.000Z', civil: '2026-07', nota: '23:59:59 CDMX del 31-jul (último instante malo)' },
      // Ya no cruza: 00:00 CDMX del 1-ago.
      { capturedAt: '2026-08-01T06:00:00.000Z', civil: '2026-08', nota: '00:00 CDMX del 1-ago (primer instante bueno)' },
      // No cruza el mes aunque cruce el DÍA: 17:59:59 CDMX del 31-jul.
      { capturedAt: '2026-07-31T23:59:59.000Z', civil: '2026-07', nota: 'mismo mes en ambas zonas' },
      { capturedAt: '2026-04-07T00:00:00.000Z', civil: '2026-04', nota: 'mismo mes en ambas zonas' },
    ];

    for (const c of casos) {
      const obtenido = periodoDe(c.capturedAt);
      expect(obtenido, `${c.capturedAt} (${c.nota})`).toBe(c.civil);
      // La propiedad que sostiene el predicado (A) de la 0023: el mes
      // civil NUNCA queda por delante del mes UTC.
      expect(obtenido <= mesUtc(c.capturedAt), `${c.capturedAt}: civil ${obtenido} no puede ir por delante del UTC ${mesUtc(c.capturedAt)}`).toBe(true);
    }
  });

  it('[ROJO HOY · C] cambio de comportamiento DELIBERADO y declarado: un `capturedAt` del día 1 a las 00:00Z pertenece al mes civil ANTERIOR (varias suites del repo usan ese valor; se pinea para que nadie lo "arregle" de vuelta a UTC)', () => {
    // '2026-07-01T00:00:00.000Z' es 18:00 CDMX del 30-jun.
    expect(periodoDe('2026-07-01T00:00:00.000Z')).toBe('2026-06');
  });

  it('[VERDE — no-regresión · D] `capturedAt` vacío sigue devolviendo periodo vacío, sin lanzar', () => {
    expect(periodoDe('')).toBe('');
  });

  it('[VERDE — no-regresión · E] un `capturedAt` NO parseable por V8 no lanza y degrada al recorte previo, idéntico al comportamiento anterior al fix', () => {
    for (const basura of ['no-es-fecha', 'x', '2026-13-99T00:00:00Z']) {
      expect(() => periodoDe(basura)).not.toThrow();
      // El recorte crudo `slice(0, 7)`, que es lo que hacía la versión vieja.
      expect(periodoDe(basura), basura).toBe(basura.slice(0, 7));
    }
  });

  it('[PELIGRO DECLARADO · F] la TERCERA rama: texto que V8 SÍ parsea pero no es ISO fabrica un periodo creíble donde la versión vieja dejaba basura visible', () => {
    // Esta NO es una guarda que pruebe el fix: es un peligro medido que se
    // pinea para que no sorprenda a nadie y para que quede claro qué lo
    // contiene (la prueba G, abajo). La versión anterior devolvía
    // `'0'`/`'2026'`/`'Dec 25,'` —basura obvia—; esta devuelve algo con la
    // forma exacta de un periodo válido, que se estamparía en
    // `snapshots.periodo` y en el relleno `${periodo}-01` sin que nada chille.
    expect(periodoDe('0')).toBe('2000-01');
    expect(periodoDe('Dec 25, 2026')).toBe('2026-12');
    // El peor: un año suelto sale como DICIEMBRE DEL AÑO ANTERIOR, porque V8
    // lo lee como medianoche UTC del 1-ene y en México eso aún es 31-dic.
    expect(periodoDe('2026')).toBe('2025-12');
  });

  it('[ROJO SI SE RELAJA · G] la puerta que contiene a F sigue cerrada: `RefreshBody` rechaza esas tres formas antes de que lleguen al ETL', () => {
    // Aquí está la contención real del peligro de F, y por eso esta prueba
    // sí es una guarda: si alguien afloja `z.string().datetime()`, la rama
    // fabricadora deja de ser latente y esto se pone rojo.
    const body = (capturedAt: string) => ({
      source: 'stock' as const,
      capturedAt,
      archivo: null,
      datasets: {
        inventario: [['ITEM'], ['SKU-1']],
        west: [['ITEM']],
        reserva: [['ITEM']],
      },
    });

    for (const peligrosa of ['0', '2026', 'Dec 25, 2026']) {
      expect(RefreshBody.safeParse(body(peligrosa)).success, peligrosa).toBe(false);
    }
    // Control positivo: un instante ISO de verdad sí pasa el schema — sin
    // esto, un schema que rechazara TODO también daría verde arriba.
    expect(RefreshBody.safeParse(body('2026-08-01T02:00:00.000Z')).success).toBe(true);
  });
});
