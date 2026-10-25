// ============================================================
// Bloque 3 · API · health.service.ts  (READS)
// Salud del sistema = ¿hay snapshot vigente por cada fuente canónica?
// 'ok' solo si AMBAS fuentes (stock + aduana) tienen snapshot vigente;
// si falta alguna (o ambas) → 'degradado'. No lanza a propósito: si
// `resolveVigentes` lanza (BD caída), el error SUBE tal cual — el
// route decide cómo mapearlo a status HTTP.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveVigentes, type SnapshotVigente } from './vigente.service';

/** Espejo de `EtlResult`: `snapshotId` (no `id`) para consistencia entre endpoints. */
export interface HealthFuente {
  snapshotId: string;
  created_at: string;
  filas: number | null;
  archivo: string | null;
}

export interface HealthResponse {
  estado: 'ok' | 'degradado';
  fuentes: {
    stock: HealthFuente | null;
    aduana: HealthFuente | null;
  };
}

function toHealthFuente(v: SnapshotVigente | null): HealthFuente | null {
  if (!v) return null;
  return { snapshotId: v.id, created_at: v.created_at, filas: v.filas, archivo: v.archivo };
}

export async function getHealth(db: SupabaseClient): Promise<HealthResponse> {
  const { stock, aduana } = await resolveVigentes(db);
  return {
    estado: stock && aduana ? 'ok' : 'degradado',
    fuentes: { stock: toHealthFuente(stock), aduana: toHealthFuente(aduana) },
  };
}
