"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatoNumero } from "@/lib/formato";
import type { DescuadreItem } from "@/types/api";

const LIMITE_COLAPSADO = 10;

export interface DerivadosDescuadresProps {
  descuadres: DescuadreItem[];
}

/**
 * Sección "Derivados" (F4): descuadres de reservas, COMPUTADOS al vuelo en
 * cada `GET /api/pendientes` (misma aritmética que el dashboard,
 * `fetchDescuadresVigentes` en `dashboard.service.ts`) — NUNCA persistidos
 * en `pendientes_datos`, así que no tienen acciones de confirmar/descartar
 * (se recalculan solos en la siguiente ingesta; se corrigen en la fuente).
 */
export function DerivadosDescuadres({ descuadres }: DerivadosDescuadresProps) {
  const [expandido, setExpandido] = useState(false);
  const visibles = expandido ? descuadres : descuadres.slice(0, LIMITE_COLAPSADO);
  const hayMas = descuadres.length > LIMITE_COLAPSADO;

  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[13.5px] font-semibold text-ink">Descuadres de reservas ({formatoNumero(descuadres.length)})</h2>
        <p className="text-[12px] text-muted-foreground">Se recalculan en cada ingesta — se corrigen en la fuente, no aquí.</p>
      </div>

      {descuadres.length === 0 ? (
        <p className="py-2 text-[12.5px] text-muted-foreground">Sin descuadres detectados.</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line-soft">
            {visibles.map((d) => (
              <li key={d.sku} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/catalogo/${encodeURIComponent(d.sku)}`} className="font-mono text-[12.5px] font-semibold text-ink hover:text-brand">
                  {d.sku}
                </Link>
                <span className="inline-flex w-fit items-center rounded-full bg-warn-bg px-2.5 py-1 font-mono text-[11.5px] font-semibold text-warn">
                  resv {formatoNumero(d.resv)} vs Σ {formatoNumero(d.suma_reservas)}
                </span>
              </li>
            ))}
          </ul>
          {hayMas && !expandido && (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setExpandido(true)}>
              Ver todos ({formatoNumero(descuadres.length)})
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
