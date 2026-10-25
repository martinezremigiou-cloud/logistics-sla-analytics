"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useSesion } from "@/components/providers/session-provider";
import { useApi } from "@/lib/hooks/use-api";
import { SinPermiso } from "@/components/shared/sin-permiso";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FichaImagen } from "@/components/ficha/ficha-imagen";
import { CargaDropzone } from "./carga-dropzone";
import type { CatalogoPage, SkuDetalle } from "@/types/api";

const DEBOUNCE_MS = 300;

/** Debounce genérico: regresa `value` recién después de `delayMs` sin cambios. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Isla client de `/carga`: gate por rol (SinPermiso para KAM), buscador de
 * SKU (debounced) y, al elegir uno, preview + dropzone de subida.
 */
export function CargaView() {
  const { rol } = useSesion();
  const [texto, setTexto] = useState("");
  const [skuSeleccionado, setSkuSeleccionado] = useState<string | null>(null);
  const [mostrarResultados, setMostrarResultados] = useState(false);

  const textoDebounced = useDebounced(texto.trim(), DEBOUNCE_MS);
  const esAdmin = rol === "admin";
  const buscarUrl = esAdmin && textoDebounced.length > 0 ? `/api/inventory?q=${encodeURIComponent(textoDebounced)}&pageSize=8` : null;
  const { data: resultados, loading: buscando } = useApi<CatalogoPage>(buscarUrl);

  const detalleUrl = esAdmin && skuSeleccionado ? `/api/sku/${encodeURIComponent(skuSeleccionado)}` : null;
  const { data: detalle, refetch: refetchDetalle } = useApi<SkuDetalle>(detalleUrl);

  if (!esAdmin) {
    return <SinPermiso rolActual={rol} />;
  }

  function elegirSku(sku: string) {
    setSkuSeleccionado(sku);
    setTexto(sku);
    setMostrarResultados(false);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative max-w-md">
        <label htmlFor="carga-buscador-sku" className="sr-only">
          Buscar SKU
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <Input
          id="carga-buscador-sku"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setMostrarResultados(true);
            setSkuSeleccionado(null);
          }}
          placeholder="Buscar SKU o descripción…"
          className="h-9 pl-8"
          autoComplete="off"
        />

        {mostrarResultados && resultados && resultados.items.length > 0 && (
          <Card className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-md">
            {resultados.items.map((item) => (
              <button
                key={item.sku}
                type="button"
                onClick={() => elegirSku(item.sku)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-1.5 text-left hover:bg-surface-3"
              >
                <span className="font-mono text-[12.5px] font-semibold text-ink">{item.sku}</span>
                <span className="text-[11.5px] text-ink-muted">{item.descripcion ?? "—"}</span>
              </button>
            ))}
          </Card>
        )}
        {mostrarResultados && !buscando && resultados && resultados.items.length === 0 && (
          <Card className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-surface p-3 text-[12.5px] text-ink-muted shadow-md">
            Sin resultados para &ldquo;{textoDebounced}&rdquo;.
          </Card>
        )}
      </div>

      {skuSeleccionado && detalle && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Card className="flex flex-col gap-1 rounded-2xl border border-line bg-surface p-4">
            <p className="font-mono text-[13px] font-semibold text-ink">{detalle.sku}</p>
            <p className="text-[13px] text-ink-2">{detalle.descr_efectiva ?? "—"}</p>
          </Card>
          <FichaImagen sku={detalle.sku} imagenUrl={detalle.imagen_url} descr={detalle.descr_efectiva} />
          <div className="md:col-span-2">
            <CargaDropzone sku={detalle.sku} tieneImagen={detalle.imagen_url !== null} onUploaded={refetchDetalle} />
          </div>
        </div>
      )}
    </div>
  );
}
