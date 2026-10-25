"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { Paginacion } from "@/components/catalogo/paginacion";
import { SnapshotFila } from "./snapshot-fila";
import { SnapshotsFilasSkeleton } from "./snapshots-skeleton";
import { cn } from "@/lib/utils";
import type { ApiErrorBody } from "@/lib/hooks/use-api";
import type { SnapshotsPage } from "@/types/api";

export interface SnapshotsColumnaProps {
  titulo: string;
  data: SnapshotsPage | null;
  error: ApiErrorBody | null;
  loading: boolean;
  onRetry: () => void;
  page: number;
  onPageChange: (page: number) => void;
}

/**
 * Una columna de la Bitácora (una `Card` por fuente: "Inventario" o
 * "Embarques"). Gate de carga propio, independiente de la columna
 * hermana (C3/FIX-RESET: `loading && !data` solo en la PRIMERA carga de
 * ESTA columna; una vez que hay `data`, la lista queda montada mientras
 * refetch está en vuelo — p.ej. al cambiar de página — marcada
 * `aria-busy` y atenuada, nunca remontada a un skeleton).
 */
export function SnapshotsColumna({ titulo, data, error, loading, onRetry, page, onPageChange }: SnapshotsColumnaProps) {
  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[13.5px] font-semibold text-ink">{titulo}</h2>

      {loading && !data && <SnapshotsFilasSkeleton />}
      {error && !data && <EstadoError mensaje={error.message} onRetry={onRetry} />}

      {data && (
        <div className={cn("flex flex-col gap-3", loading && "opacity-60")}>
          {data.total === 0 ? (
            <EstadoVacio titulo="Aún no hay snapshots registrados para esta fuente." />
          ) : data.items.length === 0 ? (
            <EstadoVacio
              titulo="Sin resultados en esta página"
              cta={
                <Button variant="outline" onClick={() => onPageChange(1)}>
                  Ir a la página 1
                </Button>
              }
            />
          ) : (
            <>
              <ul aria-busy={loading} className="flex flex-col gap-2.5">
                {data.items.map((item) => (
                  <SnapshotFila key={item.id} item={item} />
                ))}
              </ul>
              {/*
                `page` (el prop, NO `data.page`): `useApi` conserva el
                `data` de la petición ANTERIOR mientras un refetch está en
                vuelo (chrome persistente) — usar `data.page` mostraría el
                número de página VIEJO durante esa ventana, aunque el
                usuario ya pidió otra. `page` es la fuente viva de "qué
                página se está pidiendo" y coincide con `data.page` en
                estado estable, así que nunca hay una regresión visible.
              */}
              <Paginacion page={page} totalPages={data.totalPages} total={data.total} onPageChange={onPageChange} />
            </>
          )}
        </div>
      )}
    </Card>
  );
}
