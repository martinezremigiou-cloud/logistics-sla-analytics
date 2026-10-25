"use client";

// ============================================================
// [INV-B8] agregar-sku-dialog.tsx — "+ Agregar SKU" de la card "Partidas
// del proyecto".
//
// EL BUSCADOR REUSA `GET /api/inventory` (mismo contrato que ya consume
// `catalogo-view.tsx`/`carga-view.tsx`) — spec explícita del bloque: "NO
// construyas un segundo buscador de SKU". `useDebounced` se duplica aquí
// LOCAL y sin exportar, mismo patrón ya usado en `carga-view.tsx`: ese
// archivo vive fuera del alcance de este bloque (`src/components/carga/**`),
// así que no se toca para extraer un hook compartido.
// ============================================================
import { useState } from "react";
import { useEffect } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApi } from "@/lib/hooks/use-api";
import { formatoNumero } from "@/lib/formato";
import { agregarPartidaFetch } from "./partidas-api";
import type { CatalogoItem, CatalogoPage } from "@/types/api";

const DEBOUNCE_MS = 300;

/** Debounce genérico: regresa `value` recién después de `delayMs` sin cambios (duplicado de `carga-view.tsx`, ver cabecera del archivo). */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export interface AgregarSkuDialogProps {
  proyectoId: string;
  /** SKUs ya presentes en el proyecto — se deshabilitan en los resultados en vez de dejar que el POST falle con 409. */
  skusExistentes: Set<string>;
  /** Refetch del detalle (`useApi` de `ProyectoDetalleView`) — se invoca tras un alta exitosa. */
  onAgregado: () => void;
}

export function AgregarSkuDialog({ proyectoId, skusExistentes, onAgregado }: AgregarSkuDialogProps) {
  const [open, setOpen] = useState(false);
  const [texto, setTexto] = useState("");
  const [seleccionado, setSeleccionado] = useState<CatalogoItem | null>(null);
  const [cantidad, setCantidad] = useState("1");
  const [enviando, setEnviando] = useState(false);

  const textoDebounced = useDebounced(texto.trim(), DEBOUNCE_MS);
  const buscarUrl = open && !seleccionado && textoDebounced.length > 0 ? `/api/inventory?q=${encodeURIComponent(textoDebounced)}&pageSize=8` : null;
  const { data: resultados, loading: buscando } = useApi<CatalogoPage>(buscarUrl);

  function abrir() {
    setTexto("");
    setSeleccionado(null);
    setCantidad("1");
    setOpen(true);
  }

  function elegir(item: CatalogoItem) {
    if (skusExistentes.has(item.sku)) return;
    setSeleccionado(item);
  }

  const cantidadNum = Number(cantidad);
  const cantidadValida = Number.isInteger(cantidadNum) && cantidadNum >= 1;

  async function handleAgregar() {
    if (!seleccionado || !cantidadValida) return;
    setEnviando(true);
    try {
      const ok = await agregarPartidaFetch(proyectoId, seleccionado.sku, cantidadNum);
      if (ok) {
        toast.success(`${seleccionado.sku} agregado al proyecto.`);
        setOpen(false);
        onAgregado();
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Button type="button" size="sm" onClick={abrir}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        Agregar SKU
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar SKU al proyecto</DialogTitle>
            <DialogDescription>Busca por SKU o descripción y define la cantidad comprometida.</DialogDescription>
          </DialogHeader>

          <div className="relative">
            <label htmlFor="agregar-sku-buscador" className="sr-only">
              Buscar SKU
            </label>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
            <Input
              id="agregar-sku-buscador"
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setSeleccionado(null);
              }}
              placeholder="Buscar SKU o descripción…"
              className="h-9 pl-8"
              autoComplete="off"
              disabled={enviando}
            />
          </div>

          {!seleccionado && textoDebounced.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
              {buscando && <p className="px-3 py-2 text-[12.5px] text-ink-muted">Buscando…</p>}
              {!buscando && resultados && resultados.items.length === 0 && (
                <p className="px-3 py-2 text-[12.5px] text-ink-muted">Sin resultados para &ldquo;{textoDebounced}&rdquo;.</p>
              )}
              {resultados?.items.map((item) => {
                const yaAgregado = skusExistentes.has(item.sku);
                return (
                  <button
                    key={item.sku}
                    type="button"
                    disabled={yaAgregado}
                    onClick={() => elegir(item)}
                    className="flex w-full items-center justify-between gap-3 border-b border-line-soft px-3 py-2 text-left last:border-b-0 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    <span className="min-w-0">
                      <span className="block font-mono text-[12.5px] font-semibold text-ink">{item.sku}</span>
                      <span className="block truncate text-[11.5px] text-ink-muted">
                        {item.descripcion ?? "—"} · {item.marca}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-muted">
                      {yaAgregado ? "Ya en el proyecto" : `disp ${formatoNumero(item.disponible)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {seleccionado && (
            <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-3 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-[13px] font-semibold text-ink">{seleccionado.sku}</p>
                  <p className="truncate text-[12px] text-ink-muted">{seleccionado.descripcion ?? "—"}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSeleccionado(null)} disabled={enviando}>
                  Cambiar
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="agregar-sku-cantidad">Cantidad</Label>
                <Input
                  id="agregar-sku-cantidad"
                  type="number"
                  min={1}
                  step={1}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  disabled={enviando}
                  className="w-32"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={enviando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleAgregar()} disabled={enviando || !seleccionado || !cantidadValida}>
              {enviando ? "Agregando…" : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
