import { Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { NOMBRE_PRODUCTO } from "@/config/producto";

// [INV-B7B] O12 · Modo mantenimiento — pantalla de destino.
//
// Ruta de nivel superior (`src/app/mantenimiento/page.tsx`), a
// propósito FUERA del route group `(app)`: no depende de sesión ni de
// `AppShell` (sidebar/topbar), para que `src/middleware.ts` pueda
// reescribir aquí incluso a usuarios sin sesión, o cuando la lectura
// de `perfiles` falla. Server component estático, sin fetch — nada
// que pueda fallar mientras el resto del portal está en mantenimiento.
//
// Diseñada, no encendida: sin `MANTENIMIENTO=1` en el entorno, nada
// reescribe hacia aquí y esta pantalla es inalcanzable salvo
// navegación directa a /mantenimiento (ver `src/middleware.ts`).
export default function MantenimientoPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-app px-6">
      <Card className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-ink-muted3 bg-surface px-8 py-12 text-center">
        <span className="flex h-[52px] w-[52px] items-center justify-center rounded-[13px] bg-warn-bg text-warn">
          <Wrench className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-ink">Mantenimiento en curso</p>
          <p className="text-[13px] text-muted-foreground">
            Estamos actualizando {NOMBRE_PRODUCTO}. El portal vuelve a estar disponible en unos minutos.
          </p>
        </div>
      </Card>
    </div>
  );
}
