"use client";

// ============================================================
// [INV-B8] proyecto-partida-fila.tsx — una fila de "Partidas del proyecto".
//
// Trato obligatorio de los DOS campos que la maqueta no tiene (spec del
// bloque):
//  · `fuera_del_vigente`: el estatus calculado (`EstatusPill`) sigue
//    pintándose SIEMPRE iguales — es el estatus real del catálogo—, pero
//    cuando este SKU ya no viene en el archivo vigente sus cifras son de
//    `dato_de`, no del snapshot del documento, y "Sin stock" mentiría por
//    omisión. Se agrega una insignia ámbar aparte que lo dice explícito.
//  · `en_riesgo` (`disponible < cantidad`): insignia aparte, mismo tono.
//
// "El botón de estado" del spec es el que enseña la CANTIDAD comprometida
// (lo único que este proyecto "sabe" de este SKU que el catálogo no sabe) y
// abre el editor; "quitar del proyecto" es un control PROPIO, no anidado
// dentro de ese diálogo, para no apilar dos capas modales de Radix a la vez.
// ============================================================
import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EstatusPill } from "@/components/catalogo/estatus-pill";
import { colorSkuInfo } from "@/lib/colores-sku";
import { formatoFechaHora, formatoNumero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { cambiarCantidadFetch, quitarPartidaFetch } from "./partidas-api";
import type { PartidaItem } from "@/types/proyectos";

export interface ProyectoPartidaFilaProps {
  proyectoId: string;
  partida: PartidaItem;
  /** Refetch del detalle (`useApi` de `ProyectoDetalleView`) — se invoca tras cada cambio de cantidad o borrado. */
  onChanged: () => void;
}

function cantidadValida(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function ProyectoPartidaFila({ proyectoId, partida, onChanged }: ProyectoPartidaFilaProps) {
  const colorInfo = colorSkuInfo(partida.color);
  const [editarOpen, setEditarOpen] = useState(false);
  const [eliminarOpen, setEliminarOpen] = useState(false);
  const [cantidadTexto, setCantidadTexto] = useState(String(partida.cantidad));
  const [procesando, setProcesando] = useState(false);

  function abrirEditar() {
    setCantidadTexto(String(partida.cantidad));
    setEditarOpen(true);
  }

  async function handleGuardar() {
    const nueva = cantidadValida(cantidadTexto);
    if (nueva === null) return;
    if (nueva === partida.cantidad) {
      setEditarOpen(false);
      return;
    }
    setProcesando(true);
    try {
      const ok = await cambiarCantidadFetch(proyectoId, partida.partida_id, nueva);
      if (ok) {
        toast.success("Cantidad actualizada.");
        setEditarOpen(false);
        onChanged();
      }
    } finally {
      setProcesando(false);
    }
  }

  async function handleEliminar() {
    setProcesando(true);
    try {
      const ok = await quitarPartidaFetch(proyectoId, partida.partida_id);
      if (ok) {
        toast.success(`${partida.sku} se quitó del proyecto.`);
        setEliminarOpen(false);
        onChanged();
      }
    } finally {
      setProcesando(false);
    }
  }

  const tituloFueraDelVigente = partida.dato_de
    ? `Cifras al ${formatoFechaHora(partida.dato_de)}, de una carga anterior.`
    : "Cifras de una carga anterior a la vigente.";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line-soft bg-surface px-3 py-2.5">
      <span
        aria-hidden="true"
        className={cn("h-9 w-1 shrink-0 self-stretch rounded-full", colorInfo?.bgClass ?? "bg-transparent")}
      />

      <div className="min-w-0 flex-1">
        <p className="font-mono text-[12.5px] font-semibold text-ink">{partida.sku}</p>
        <p className="truncate text-[12px] text-ink-muted">
          {partida.descripcion ?? "—"} · {partida.marca ?? "—"}
        </p>
        {(partida.fuera_del_vigente || partida.en_riesgo) && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {partida.fuera_del_vigente && (
              <span
                title={tituloFueraDelVigente}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warn-bg px-2 py-0.5 text-[10.5px] font-semibold text-warn"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                Fuera del inventario vigente
              </span>
            )}
            {partida.en_riesgo && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warn-bg px-2 py-0.5 text-[10.5px] font-semibold text-warn">
                ⚠ En riesgo
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5">
        <span className="font-mono text-[13px] font-semibold text-ink">disp {formatoNumero(partida.disponible)}</span>

        <button
          type="button"
          onClick={abrirEditar}
          title="Cambiar cantidad comprometida"
          className="rounded-full bg-surface-3 px-2.5 py-1 text-[11.5px] font-semibold text-ink-2 outline-none transition-colors hover:bg-surface-input focus-visible:ring-2 focus-visible:ring-brand"
        >
          {formatoNumero(partida.cantidad)} pz
        </button>

        <EstatusPill badges={partida.badges} disponible={partida.disponible} />

        <button
          type="button"
          onClick={() => setEliminarOpen(true)}
          aria-label={`Quitar ${partida.sku} del proyecto`}
          title="Quitar del proyecto"
          className="rounded-full p-1.5 text-ink-muted outline-none transition-colors hover:bg-warn-bg hover:text-warn focus-visible:ring-2 focus-visible:ring-brand"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <Dialog open={editarOpen} onOpenChange={setEditarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{partida.sku}</DialogTitle>
            <DialogDescription>Cambia la cantidad comprometida en este proyecto.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`partida-cantidad-${partida.partida_id}`}>Cantidad</Label>
            <Input
              id={`partida-cantidad-${partida.partida_id}`}
              type="number"
              min={1}
              step={1}
              value={cantidadTexto}
              onChange={(e) => setCantidadTexto(e.target.value)}
              disabled={procesando}
              className="w-32"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setEditarOpen(false)} disabled={procesando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleGuardar()} disabled={procesando || cantidadValida(cantidadTexto) === null}>
              {procesando ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={eliminarOpen} onOpenChange={setEliminarOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar {partida.sku} del proyecto</AlertDialogTitle>
            <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={procesando}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleEliminar();
              }}
              disabled={procesando}
            >
              {procesando ? "Quitando…" : "Quitar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
