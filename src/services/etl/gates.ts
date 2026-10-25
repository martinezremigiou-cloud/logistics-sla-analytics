// ============================================================
// Bloque 2 · ETL · gates.ts  (PURO)
// Gates de integridad por-SKU (NO bloqueantes: nunca descartan ni
// rechazan la ingesta; producen DIAG y la data se conserva):
//   - Σ stock == TOTAL  (excluye WEST de la igualdad).
//   - Σ reservas == resv.
// Y verificación referencial (cuarentena, la data SÍ se excluye):
//   - sku de reserva/embarque sin producto.
// ============================================================
import type {
  ProductoCanon,
  StockCanon,
  ReservaCanon,
  DiagItem,
  QuarantineItem,
} from './types';

export function runGates(
  productos: ProductoCanon[],
  stock: StockCanon[],
  reservas: ReservaCanon[],
): { diag: DiagItem[]; cuarentena: QuarantineItem[] } {
  const diag: DiagItem[] = [];

  // Σ stock por SKU excluyendo WEST.
  const stockSum = new Map<string, number>();
  for (const s of stock) {
    if (s.almacen === 'WEST') continue;
    stockSum.set(s.sku, (stockSum.get(s.sku) ?? 0) + s.cantidad);
  }

  // Σ reservas por SKU.
  const resvSum = new Map<string, number>();
  for (const r of reservas) {
    resvSum.set(r.sku, (resvSum.get(r.sku) ?? 0) + r.cantidad);
  }

  for (const p of productos) {
    const obtenidoStock = stockSum.get(p.sku) ?? 0;
    if (obtenidoStock !== p.totalFuente) {
      diag.push({
        sku: p.sku,
        tipo: 'SUMA_STOCK',
        esperado: p.totalFuente,
        obtenido: obtenidoStock,
        delta: obtenidoStock - p.totalFuente,
      });
    }
    const obtenidoResv = resvSum.get(p.sku) ?? 0;
    if (obtenidoResv !== p.resv) {
      diag.push({
        sku: p.sku,
        tipo: 'SUMA_RESERVAS',
        esperado: p.resv,
        obtenido: obtenidoResv,
        delta: obtenidoResv - p.resv,
      });
    }
  }

  return { diag, cuarentena: [] };
}

/**
 * Integridad referencial: solo se conservan los registros cuyo SKU
 * exista en `validSkus`; el resto va a cuarentena (nunca se borra).
 */
export function checkReferential<T extends { sku: string }>(
  records: T[],
  validSkus: Set<string>,
  entidad: 'reserva' | 'embarque',
): { ok: T[]; cuarentena: QuarantineItem[] } {
  const ok: T[] = [];
  const cuarentena: QuarantineItem[] = [];
  for (const rec of records) {
    if (validSkus.has(rec.sku)) {
      ok.push(rec);
    } else {
      cuarentena.push({
        entidad,
        clave: rec.sku,
        sku: rec.sku,
        motivo: `${entidad}_sku_sin_producto`,
        origen: { hoja: entidad === 'reserva' ? 'Reserva' : 'Embarques' },
      });
    }
  }
  return { ok, cuarentena };
}
