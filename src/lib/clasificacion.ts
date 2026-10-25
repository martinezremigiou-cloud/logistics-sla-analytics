// ============================================================
// B-PARCHE · F3 · lib · clasificacion.ts  (100% PURO)
// Constante reservada del filtro `?tecnologia=` (O1) + helper de
// indexado de `clasificacion_v2` por sku, compartidos por
// inventory.service.ts / sku.service.ts / cruce.service.ts al
// consumir la capa v2 (`resolverClasificacion`, F1) desde las
// LECTURAS. Sin imports de Supabase — ver comentario de cabecera de
// `derivaciones.ts` (mismo principio: dominio puro, sin BD).
// ============================================================
import type { ClasificacionV2Lectura } from '@/services/derivaciones';

/**
 * Valor reservado de `?tecnologia=` (O1): selecciona los items cuya
 * tecnología EFECTIVA es `null` (sin fila v2 para el sku, o el campo
 * `tecnologia` de esa fila no está poblado). No es un nombre real de
 * tecnología — `tecnologias.nombre` es texto libre capturado por
 * humanos, así que este valor (con guiones bajos dobles) nunca puede
 * colisionar con uno legítimo.
 */
export const SIN_TECNOLOGIA = '__sin_tecnologia__';

/** Indexa filas de `clasificacion_v2` por `sku` (relación 1:1 — última fila gana si hubiera duplicados). */
export function mapearV2(filas: ClasificacionV2Lectura[]): Map<string, ClasificacionV2Lectura> {
  const map = new Map<string, ClasificacionV2Lectura>();
  for (const fila of filas) {
    map.set(String(fila.sku), fila);
  }
  return map;
}
