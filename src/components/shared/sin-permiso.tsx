import Link from "next/link";
import { Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ETIQUETA_ROL } from "@/lib/roles";
import type { Rol } from "@/types/enums";

interface SinPermisoProps {
  rolActual: Rol;
}

/** Estado "sin permiso" reutilizable para secciones exclusivas de admin (dentro del shell, no reemplaza el layout). */
export function SinPermiso({ rolActual }: SinPermisoProps) {
  return (
    <Card className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface py-[54px] text-center">
      <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-warn-bg text-warn">
        <Lock className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-semibold text-ink">Sin permiso</p>
        <p className="text-[13px] text-muted-foreground">
          Esta sección es exclusiva del perfil Admin. Tu sesión actual es {ETIQUETA_ROL[rolActual]}.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/">Volver al Dashboard</Link>
      </Button>
    </Card>
  );
}
