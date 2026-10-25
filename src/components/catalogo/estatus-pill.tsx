import type { BadgeCatalogo } from "@/types/api";
import { cn } from "@/lib/utils";
// [INV-B8] La regla se mudó a `src/lib/estatus.ts` para que el generador de
// documentos (servidor) pueda usarla sin que un servicio importe de
// `components/`. Ver la cabecera de ese archivo.
import { resolverEstatus, type Tono } from "@/lib/estatus";

interface EstatusPillProps {
  badges: BadgeCatalogo[];
  disponible: number;
  className?: string;
}

const TONO_CLASSES: Record<Tono, string> = {
  warn: "bg-warn-bg text-warn",
  neutral: "bg-surface-3 text-ink-muted",
  info: "bg-info-bg text-info",
  success: "bg-success-bg text-success",
};

/** Pill de estatus (dot + label) para la tabla y el grid del catálogo. */
export function EstatusPill({ badges, disponible, className }: EstatusPillProps) {
  const { label, tono } = resolverEstatus(badges, disponible);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
        TONO_CLASSES[tono],
        className,
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
