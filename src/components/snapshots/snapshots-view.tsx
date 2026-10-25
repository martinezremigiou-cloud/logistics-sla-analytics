"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { SnapshotsColumna } from "./snapshots-columna";
import { SnapshotsSkeleton } from "./snapshots-skeleton";
import { SnapshotsVigentesBanner } from "./snapshots-vigentes-banner";
import { formatoFuente } from "./snapshots-formato";
import type { SnapshotsPage } from "@/types/api";

/** Arma `/api/snapshots?fuente=...&page=...` — `page` se omite cuando es 1 (mismo criterio de URL "limpia" que el resto del catálogo). */
function buildSnapshotsUrl(fuente: "stock" | "aduana", page: number): string {
  const sp = new URLSearchParams({ fuente });
  if (page > 1) sp.set("page", String(page));
  return `/api/snapshots?${sp.toString()}`;
}

/**
 * Isla client de `/snapshots`: dos fetches independientes (uno por
 * fuente), cada uno con su propia paginación LOCAL (no hay más filtros
 * en esta lista — no hace falta URL-driven state, a diferencia de
 * `/catalogo`). El banner de vigentes usa `vigentes` de CUALQUIERA de
 * las dos respuestas (viaja idéntico en ambas, ver contrato).
 *
 * Chrome persistente: el skeleton compuesto de 2 tarjetas
 * (`SnapshotsSkeleton`) SOLO se muestra antes de que cualquiera de las
 * dos columnas haya resuelto (éxito o error) por primera vez. En cuanto
 * una resuelve, se monta la grilla de columnas para siempre — cada
 * `SnapshotsColumna` gestiona su propio estado sin desmontar a la
 * hermana (p.ej. paginar "Inventario" no toca "Embarques").
 */
export function SnapshotsView() {
  const [stockPage, setStockPage] = useState(1);
  const [aduanaPage, setAduanaPage] = useState(1);

  const stock = useApi<SnapshotsPage>(buildSnapshotsUrl("stock", stockPage));
  const aduana = useApi<SnapshotsPage>(buildSnapshotsUrl("aduana", aduanaPage));

  const vigentes = stock.data?.vigentes ?? aduana.data?.vigentes ?? null;

  const primeraCargaPendiente = !stock.data && !stock.error && !aduana.data && !aduana.error;

  return (
    <div className="flex flex-col gap-4">
      {vigentes && <SnapshotsVigentesBanner vigentes={vigentes} />}

      {primeraCargaPendiente ? (
        <SnapshotsSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SnapshotsColumna
            titulo={formatoFuente("stock")}
            data={stock.data}
            error={stock.error}
            loading={stock.loading}
            onRetry={stock.refetch}
            page={stockPage}
            onPageChange={setStockPage}
          />
          <SnapshotsColumna
            titulo={formatoFuente("aduana")}
            data={aduana.data}
            error={aduana.error}
            loading={aduana.loading}
            onRetry={aduana.refetch}
            page={aduanaPage}
            onPageChange={setAduanaPage}
          />
        </div>
      )}
    </div>
  );
}
