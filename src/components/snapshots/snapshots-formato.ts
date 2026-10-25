// ============================================================
// Bloque 7-A · F · snapshots-formato.ts  (100% PURO)
// Helpers de formato/etiquetas es-MX exclusivos de la Bitácora de
// snapshots — co-localizados con sus consumidores (puro, sin JSX; no se
// tocan porque estas etiquetas no aplican a otras vistas). A diferencia
// de `formatoPeriodoCorto` (promovido a `src/lib/formato.ts` en la ronda
// 2 de B7-A — fix M7: lo comparten Dashboard y Snapshots), estos SÍ son
// específicos de esta vista.
// ============================================================
import { formatoNumero } from "@/lib/formato";
import type { CambioItem } from "@/types/api";

const FUENTE_LABELS: Record<string, string> = { stock: "Inventario", aduana: "Embarques" };

/**
 * "stock"→"Inventario", "aduana"→"Embarques" — mismo rótulo en las
 * columnas de la lista (`/snapshots`) y en el encabezado del detalle
 * (`/snapshots/[id]`). Fallback defensivo al valor crudo (hoy solo
 * existen estas 2 fuentes canónicas, ver `FuenteSnapshot`).
 */
export function formatoFuente(fuente: string): string {
  return FUENTE_LABELS[fuente] ?? fuente;
}

/**
 * "{n} registros ingeridos" — NUNCA "filas del archivo": `filas` cuenta
 * registros PERSISTIDOS por el ETL en esa ingesta (para 'stock':
 * productos + stock_por_almacen + reservas; para 'aduana': embarques),
 * no renglones del Excel de origen (ver doc-comment de
 * `SnapshotBitacoraItem` en `types/api.ts`). `null` es un caso límite
 * del contrato — sin dato real hoy, pero se maneja sin mentir con un 0.
 */
export function formatoRegistrosIngeridos(filas: number | null): string {
  if (filas === null) return "Registros ingeridos: —";
  return `${formatoNumero(filas)} registros ingeridos`;
}

/**
 * `created_by` es NULL en toda ingesta automática (Power Automate / el
 * bridge, todos los snapshots actuales) — se rotula explícitamente, nunca como
 * "—": sí hay un autor, es el sistema, y ocultarlo detrás de un guion
 * sería mentir por omisión en la pantalla de confianza del dato.
 */
export function formatoAutor(created_by: string | null): string {
  return created_by ?? "Ingesta automática";
}

/** Únicas 4 entidades del diff (ver `CambioItem.entidad`). */
export const ENTIDAD_LABELS: Record<CambioItem["entidad"], string> = {
  producto: "Producto",
  stock: "Stock",
  reserva: "Reserva",
  embarque: "Embarque",
};

/** Únicos 3 tipos de cambio (ver `CambioItem.tipo`). */
export const TIPO_LABELS: Record<CambioItem["tipo"], string> = {
  ALTA: "Alta",
  BAJA: "Baja",
  MODIFICACION: "Modificación",
};
