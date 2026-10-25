"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ConfigAvisos } from "./config-avisos";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const MIN_PASSWORD = 8;

/**
 * Card "Apariencia" (modo oscuro real, conectado a `next-themes`) + card
 * "Cuenta" (cambiar la propia contraseña vía `auth.updateUser`). Visible
 * para KAM y admin por igual — sección neutra de `/config`.
 */
export function ConfigPreferencias() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const modoOscuro = mounted && resolvedTheme === "dark";

  const [nueva, setNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (nueva.length < MIN_PASSWORD) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (nueva !== confirmar) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setGuardando(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: nueva });
      if (updateError) {
        toast.error("No se pudo actualizar la contraseña.");
        return;
      }
      toast.success("Contraseña actualizada.");
      setNueva("");
      setConfirmar("");
    } catch {
      toast.error("No se pudo actualizar la contraseña.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Apariencia</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="pref-modo-oscuro">Modo oscuro</Label>
            <p className="text-[12px] text-muted-foreground">Cambia el tema de toda la aplicación.</p>
          </div>
          <Switch
            id="pref-modo-oscuro"
            checked={modoOscuro}
            disabled={!mounted}
            onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
          />
        </div>
      </Card>

      {/* [INV-B9] Los avisos van aqui, no en una pantalla nueva. */}
      <ConfigAvisos />

      <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-[13.5px] font-semibold text-ink">Cuenta</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3" noValidate>
          {error && (
            <div role="alert" className="rounded-[10px] bg-warn-bg px-3 py-2 text-[12.5px] text-warn">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pref-nueva-password">Nueva contraseña</Label>
            <Input
              id="pref-nueva-password"
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              disabled={guardando}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pref-confirmar-password">Confirmar contraseña</Label>
            <Input
              id="pref-confirmar-password"
              type="password"
              autoComplete="new-password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              disabled={guardando}
            />
          </div>
          <Button type="submit" disabled={guardando} className="w-fit">
            {guardando ? "Guardando…" : "Cambiar contraseña"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
