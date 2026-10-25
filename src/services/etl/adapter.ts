// ============================================================
// Bloque 2 · ETL · adapter.ts
//   toIngestJob: body validado (RefreshBody) → IngestJob canónico
//   que consume runEtl. PURO — no toca BD, no importa persist/runEtl.
// ============================================================
import type { IngestJob } from './types';
import type { RefreshBody } from '@/schemas/refresh.schema';

/**
 * stock  → {inventario, west, reserva}
 * aduana → {embarques} (multi-hoja, tal cual)
 * legacy (única hoja coherente = 'embarques') → se envuelve en una única
 *          hoja sintética 'MANUAL' (carga manual, no Excel real). El schema
 *          ya rechaza legacy 'inventario'/'west'/'reserva' (400 invalid_body):
 *          un snapshot de stock exige las 3 hojas juntas (D1).
 */
export function toIngestJob(body: RefreshBody): IngestJob {
  const capturedAt = body.capturedAt;
  const archivo = body.archivo ?? null;

  switch (body.source) {
    case 'stock':
      return {
        source: 'stock',
        capturedAt,
        archivo,
        inventario: body.datasets.inventario,
        west: body.datasets.west,
        reserva: body.datasets.reserva,
      };
    case 'aduana':
      return {
        source: 'aduana',
        capturedAt,
        archivo,
        embarques: body.datasets.embarques,
      };
    case 'embarques':
      return {
        source: 'embarques',
        capturedAt,
        archivo,
        embarques: [{ hoja: 'MANUAL', grid: body.rows }],
      };
  }
}
