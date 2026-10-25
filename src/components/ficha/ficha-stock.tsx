import { Card } from "@/components/ui/card";
import { formatoNumero } from "@/lib/formato";
import type { SkuStockItem } from "@/types/api";

export interface FichaStockProps {
  stock: SkuStockItem[];
  total: number;
  reservado: number;
  /** Σ piezas de embarques activos, tal cual viene del DTO — NUNCA se recalcula sumando `embarques[]` aquí. */
  piezasEnCamino: number;
}

interface MetricaProps {
  label: string;
  valor: number;
}

function Metrica({ label, valor }: MetricaProps) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-[11px] text-ink-muted">{label}</span>
      <span className="font-mono text-[13.5px] font-semibold text-ink">{formatoNumero(valor)}</span>
    </div>
  );
}

/** Card "Stock por almacén": barra proporcional al máximo del propio SKU (no al total global). */
export function FichaStock({ stock, total, reservado, piezasEnCamino }: FichaStockProps) {
  const maxCantidad = Math.max(1, ...stock.map((s) => s.cantidad));

  return (
    <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[13.5px] font-semibold text-ink">Stock por almacén</h2>

      {stock.length === 0 ? (
        <p className="py-3 text-center text-[12.5px] text-muted-foreground">Sin stock registrado en almacenes.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {stock.map((item) => {
            const pct = Math.round((item.cantidad / maxCantidad) * 100);
            return (
              <li key={item.almacen} className="flex items-center gap-3">
                <span className="w-20 shrink-0 font-mono text-[12px] font-semibold text-ink-2">{item.almacen}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div
                    data-testid={`stock-barra-${item.almacen}`}
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-[12.5px] text-ink-2">{formatoNumero(item.cantidad)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-line-soft pt-3">
        <Metrica label="Total" valor={total} />
        <Metrica label="Reservado" valor={reservado} />
        <Metrica label="En camino" valor={piezasEnCamino} />
      </div>
    </Card>
  );
}
