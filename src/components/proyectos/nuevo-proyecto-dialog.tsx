"use client";

// ============================================================
// [INV-B8] nuevo-proyecto-dialog.tsx — "+ Nuevo proyecto" de `/proyectos`.
//
// Tipo/Intención son texto libre con SUGERENCIAS (`<input list>` +
// `<datalist>`, mismo patrón que `fusion-alias`/`fusion-destino` en
// `config-familias.tsx`) — NO un `<select>` cerrado: el contrato
// (`crearProyectoSchema`) los acepta como cualquier texto ≤40 caracteres,
// así que restringirlos a una lista fija sería una regla de negocio que
// nadie pidió. Las sugerencias son las mismas categorías de la maqueta
// (`projTipoOptions`/`projIntencionOptions`), pero son solo eso —
// sugerencias, no un enum.
// ============================================================
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_TITULO, MAX_DESCRIPCION, MAX_NOTAS, MAX_CLASIFICADOR } from "@/schemas/proyectos.schema";
import type { ProyectoResumen } from "@/types/proyectos";

const TIPOS_SUGERIDOS = ["Rollout", "Apertura", "Reabasto", "Mantenimiento", "Proyecto especial"];
const INTENCIONES_SUGERIDAS = ["Cotización", "Referencia", "Planeación"];

const MENSAJE_ERROR_GENERICO = "No se pudo crear el proyecto.";

export interface NuevoProyectoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se invoca con el `ProyectoResumen` recién creado (201) — el caller decide adónde navegar. */
  onCreated: (proyecto: ProyectoResumen) => void;
}

export function NuevoProyectoDialog({ open, onOpenChange, onCreated }: NuevoProyectoDialogProps) {
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [notas, setNotas] = useState("");
  const [fecha, setFecha] = useState("");
  const [tipo, setTipo] = useState("");
  const [intencion, setIntencion] = useState("");
  const [guardando, setGuardando] = useState(false);

  function reset() {
    setTitulo("");
    setDescripcion("");
    setNotas("");
    setFecha("");
    setTipo("");
    setIntencion("");
  }

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next && !guardando) reset();
  }

  async function handleCrear() {
    const valorTitulo = titulo.trim();
    if (!valorTitulo) return;

    setGuardando(true);
    try {
      const res = await fetch("/api/proyectos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: valorTitulo,
          descripcion: descripcion.trim() || undefined,
          notas: notas.trim() || undefined,
          fecha: fecha || undefined,
          tipo: tipo.trim() || undefined,
          intencion: intencion.trim() || undefined,
        }),
      });
      if (!res.ok) {
        let mensaje = MENSAJE_ERROR_GENERICO;
        try {
          const body = (await res.json()) as { message?: string };
          if (typeof body.message === "string" && body.message) mensaje = body.message;
        } catch {
          // Respuesta de error sin JSON válido: se conserva el mensaje genérico.
        }
        toast.error(mensaje);
        return;
      }
      const creado = (await res.json()) as ProyectoResumen;
      reset();
      onCreated(creado);
    } catch {
      toast.error(MENSAJE_ERROR_GENERICO);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
          <DialogDescription>Los datos se pueden editar después desde el proyecto.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nuevo-proyecto-titulo">Título</Label>
            <Input
              id="nuevo-proyecto-titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              maxLength={MAX_TITULO}
              placeholder="Ej. Rollout Retailer 42"
              disabled={guardando}
              autoFocus
            />
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nuevo-proyecto-tipo">Tipo</Label>
              <Input
                id="nuevo-proyecto-tipo"
                list="nuevo-proyecto-tipo-opciones"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                maxLength={MAX_CLASIFICADOR}
                placeholder="Ej. Rollout"
                disabled={guardando}
              />
              <datalist id="nuevo-proyecto-tipo-opciones">
                {TIPOS_SUGERIDOS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nuevo-proyecto-intencion">Intención</Label>
              <Input
                id="nuevo-proyecto-intencion"
                list="nuevo-proyecto-intencion-opciones"
                value={intencion}
                onChange={(e) => setIntencion(e.target.value)}
                maxLength={MAX_CLASIFICADOR}
                placeholder="Ej. Cotización"
                disabled={guardando}
              />
              <datalist id="nuevo-proyecto-intencion-opciones">
                {INTENCIONES_SUGERIDAS.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nuevo-proyecto-fecha">Fecha objetivo</Label>
            <Input
              id="nuevo-proyecto-fecha"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              disabled={guardando}
              className="w-full sm:w-52"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nuevo-proyecto-descripcion">Descripción</Label>
            <Textarea
              id="nuevo-proyecto-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={MAX_DESCRIPCION}
              placeholder="Contexto del proyecto…"
              disabled={guardando}
              className="min-h-[64px]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nuevo-proyecto-notas">Notas</Label>
            <Textarea
              id="nuevo-proyecto-notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              maxLength={MAX_NOTAS}
              placeholder="Notas internas (opcional)"
              disabled={guardando}
              className="min-h-[52px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void handleCrear()} disabled={guardando || !titulo.trim()}>
            {guardando ? "Creando…" : "Crear proyecto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
