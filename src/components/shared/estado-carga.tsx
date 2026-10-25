"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface EstadoErrorProps {
  /** Cuerpo del mensaje. Por defecto: "Ocurrió un error al consultar los datos." */
  mensaje?: string;
  onRetry: () => void;
}

/** Estado de error para vistas alimentadas por `useApi`. Tono siempre ámbar (warn), nunca rojo (danger). */
export function EstadoError({ mensaje, onRetry }: EstadoErrorProps) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface py-[54px] text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-warn-bg text-warn">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.8} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-ink">No se pudo cargar la información</p>
        <p className="text-[13px] text-muted-foreground">{mensaje ?? "Ocurrió un error al consultar los datos."}</p>
      </div>
      <Button variant="outline" onClick={onRetry}>Reintentar</Button>
    </Card>
  );
}

interface EstadoVacioProps {
  titulo: string;
  descripcion?: string;
  cta?: ReactNode;
}

/** Estado vacío neutro (sin resultados) para vistas alimentadas por `useApi`. */
export function EstadoVacio({ titulo, descripcion, cta }: EstadoVacioProps) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface py-[54px] text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-surface-app text-ink/40">
        <Inbox className="h-6 w-6" strokeWidth={1.8} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-ink">{titulo}</p>
        {descripcion && <p className="text-[13px] text-muted-foreground">{descripcion}</p>}
      </div>
      {cta}
    </Card>
  );
}
