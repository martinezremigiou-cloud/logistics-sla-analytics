import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatoFecha, formatoNumero } from "@/lib/formato";
import type { SkuReservaItem } from "@/types/api";

export interface FichaReservasProps {
  reservado: number;
  reservas: SkuReservaItem[];
  reservaDescuadre: boolean;
}

const TH_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

/**
 * Card "Reservas". `reservado` es el valor de sistema (`productos.resv`);
 * "Desglosado" es la Σ presentacional de las filas visibles de `reservas[]`
 * — pueden no coincidir (ver `reservaDescuadre`), y eso es justamente lo
 * que la nota de abajo del header comunica, en tono calmado (nunca alarmante).
 */
export function FichaReservas({ reservado, reservas, reservaDescuadre }: FichaReservasProps) {
  const desglosado = reservas.reduce((sum, r) => sum + r.cantidad, 0);

  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13.5px] font-semibold text-ink">Reservas</h2>
        <p className="font-mono text-[12.5px] font-semibold text-ink-2">Reservado total: {formatoNumero(reservado)}</p>
      </div>

      {reservaDescuadre && (
        <div className="flex items-start gap-2 rounded-[10px] bg-warn-bg px-3 py-2 text-[12px] text-warn">
          <Info className="h-4 w-4 shrink-0 translate-y-[1px]" aria-hidden="true" />
          <span className="inline-flex w-fit shrink-0 items-center rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-semibold text-warn">
            Atención
          </span>
          {/* [FIX-B1 · T3] Copy llano: dice de dónde sale el número que SÍ cuenta
              (el archivo de inventario) en vez de hablar de "el sistema" en abstracto. */}
          <span>
            El reservado total viene del archivo de inventario y es el que cuenta para el disponible. El detalle por
            cliente suma distinto.
          </span>
        </div>
      )}

      {reservas.length === 0 ? (
        <p className="py-4 text-center text-[12.5px] text-muted-foreground">Sin reservas registradas.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[10px] border border-line-soft">
            <Table>
              <TableHeader>
                <TableRow className="border-line-soft hover:bg-transparent">
                  <TableHead className={TH_CLASS}>KAM</TableHead>
                  <TableHead className={TH_CLASS}>Cliente</TableHead>
                  <TableHead className={`text-right ${TH_CLASS}`}>Cantidad</TableHead>
                  <TableHead className={TH_CLASS}>Motivo</TableHead>
                  <TableHead className={TH_CLASS}>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reservas.map((r, i) => (
                  <TableRow key={i} className="border-line-soft">
                    <TableCell className="text-[12.5px] text-ink-2">
                      {r.kam ?? (
                        <span className="inline-flex w-fit items-center rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                          sin KAM
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-[12.5px] text-ink-2">{r.cliente}</TableCell>
                    <TableCell className="text-right font-mono text-[12.5px] text-ink-2">{formatoNumero(r.cantidad)}</TableCell>
                    <TableCell className="text-[12.5px] text-ink-2">{r.motivo ?? "—"}</TableCell>
                    <TableCell className="text-[12.5px] text-ink-2">{formatoFecha(r.fecha)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[12px] text-ink-muted">Desglosado: {formatoNumero(desglosado)}</p>
        </>
      )}
    </Card>
  );
}
