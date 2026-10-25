"use client";

// ============================================================
// [INV-B8 · 0025] reasignar-huerfano-dialog.tsx — la vía de rescate, visible.
//
// POR QUÉ ESTE DIÁLOGO EXISTE, y no es una funcionalidad que alguien pidió.
// La 0024 podía dejar un proyecto en un estado del que NADIE lo sacaba: al
// borrar una cuenta, `ON DELETE SET NULL` ponía `propietario` en NULL, y como
// `NULL = auth.uid()` no es TRUE, las policies de UPDATE y DELETE excluían a
// todo el mundo — incluido el admin, que sí lo VEÍA. La 0025 abre la salida en
// la base; esto la hace alcanzable sin `psql`.
//
// El invariante que sostiene, escrito entero porque es más grande que su caso:
// **ningún proyecto puede quedar en un estado del que nadie pueda sacarlo
// desde la aplicación.** Una fila que solo se arregla con SQL directo es, en la
// práctica, una fila que no se arregla.
//
// SOLO SE MONTA PARA UN ADMIN Y SOLO SOBRE UN HUÉRFANO. No porque el permiso
// dependa de eso —lo decide la policy `proyectos_update_huerfano_admin`, y la
// ruta exige `requireAdminSession`— sino porque un botón que la mayoría de la
// gente no puede usar es ruido en la pantalla de todos.
//
// La lista de cuentas sale de `GET /api/usuarios`, que ya existe y ya es
// admin-only. No se construye un segundo directorio de usuarios.
// ============================================================
import { useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { PUEDE_ESCRIBIR_PROYECTOS } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { UsuarioItem } from "@/types/api";
import type { ProyectoResumen } from "@/types/proyectos";

interface UsuariosResponse {
  items: UsuarioItem[];
}

interface Props {
  proyecto: ProyectoResumen;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReasignado: () => void;
}

export function ReasignarHuerfanoDialog({ proyecto, open, onOpenChange, onReasignado }: Props) {
  // La URL se apaga mientras el diálogo está cerrado: pedir el directorio de
  // usuarios para un diálogo que nadie abrió es una llamada admin-only gratis
  // en cada carga de la lista.
  const { data, loading } = useApi<UsuariosResponse>(open ? "/api/usuarios" : null);
  const [destino, setDestino] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Un visitante no puede POSEER un proyecto (`proyectos_insert_own_no_visitante`),
  // y la policy de rescate rechaza adoptarlo hacia uno. Filtrarlo aquí evita
  // ofrecer una opción que la base va a negar; el 403 sigue siendo la defensa.
  // Las cuentas suspendidas sí se ofrecen: siguen siendo dueños válidos.
  // [ROL-SOPORTE] Por el permiso, no por la identidad: `!== "visitante"`
  // ofrecería como dueño a cualquier rol nuevo, incluido uno de sólo lectura.
  const candidatos = (data?.items ?? []).filter((u) => PUEDE_ESCRIBIR_PROYECTOS[u.rol]);

  async function reasignar() {
    if (!destino) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await fetch(`/api/proyectos/${proyecto.id}/propietario`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propietario: destino }),
      });
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        setError(cuerpo.message ?? "No se pudo reasignar el proyecto.");
        return;
      }
      onOpenChange(false);
      onReasignado();
    } catch {
      setError("No se pudo reasignar el proyecto.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reasignar {proyecto.folio}</DialogTitle>
          <DialogDescription>
            La cuenta que creó este proyecto ya no existe, así que nadie puede editarlo ni borrarlo. Asígnalo a una
            cuenta viva para devolverle un responsable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="destino-reasignacion">Nuevo responsable</Label>
          <select
            id="destino-reasignacion"
            className="h-9 w-full rounded-md border border-line bg-surface px-3 text-[13px]"
            value={destino}
            onChange={(e) => setDestino(e.target.value)}
            disabled={loading || guardando}
          >
            <option value="">{loading ? "Cargando cuentas…" : "Elige una cuenta"}</option>
            {candidatos.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email} · {u.rol}
                {u.suspendido ? " (suspendida)" : ""}
              </option>
            ))}
          </select>
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={reasignar} disabled={!destino || guardando}>
            {guardando ? "Reasignando…" : "Reasignar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
