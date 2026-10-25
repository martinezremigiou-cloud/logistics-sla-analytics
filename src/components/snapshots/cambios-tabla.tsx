import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ENTIDAD_LABELS, TIPO_LABELS } from "./snapshots-formato";
import type { CambioItem } from "@/types/api";

export interface CambiosTablaProps {
  items: CambioItem[];
  /** Marca `aria-busy` en el `<table>` durante un refetch (chrome persistente) — mismo criterio que `config-usuarios.tsx`. */
  loading?: boolean;
}

const TH_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-muted-foreground";

const TIPO_CLASSES: Record<CambioItem["tipo"], string> = {
  ALTA: "bg-success-bg text-success",
  // BAJA nunca es "danger"/rojo (regla del sistema, ver estatus-pill.tsx).
  BAJA: "bg-warn-bg text-warn",
  MODIFICACION: "bg-info-bg text-info",
};

/**
 * Tabla de cambios de un snapshot (molde `ficha-reservas.tsx`:
 * `overflow-x-auto rounded-[10px] border border-line-soft`, TH uppercase
 * muted, mono a la derecha/donde aplique, "—" para nulos).
 *
 * Columna "Valor anterior → nuevo" combinada (no dos columnas separadas,
 * ver spec): con `valor_anterior: null` se lee "— → X" (ALTA); con
 * `valor_nuevo: null` se lee "X → —" (BAJA) — auto-explicativo sin
 * necesidad de mirar la columna Tipo.
 */
export function CambiosTabla({ items, loading = false }: CambiosTablaProps) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line-soft">
      <Table aria-busy={loading}>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <TableHead className={TH_CLASS}>Entidad</TableHead>
            <TableHead className={TH_CLASS}>Clave</TableHead>
            <TableHead className={TH_CLASS}>Campo</TableHead>
            <TableHead className={TH_CLASS}>Valor anterior → nuevo</TableHead>
            <TableHead className={TH_CLASS}>Tipo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="border-line-soft">
              <TableCell className="text-[12.5px] text-ink-2">{ENTIDAD_LABELS[item.entidad]}</TableCell>
              <TableCell className="font-mono text-[12.5px] font-semibold text-ink">
                {item.sku !== null ? (
                  <Link href={`/catalogo/${encodeURIComponent(item.sku)}`} className="hover:text-brand">
                    {item.clave}
                  </Link>
                ) : (
                  item.clave
                )}
              </TableCell>
              <TableCell className="font-mono text-[12px] text-ink-2">{item.campo}</TableCell>
              <TableCell className="font-mono text-[12px] text-ink-2">
                <span className={item.valor_anterior === null ? "text-ink-muted" : undefined}>{item.valor_anterior ?? "—"}</span>
                <span className="mx-1.5 text-ink-muted" aria-hidden="true">
                  →
                </span>
                <span className={item.valor_nuevo === null ? "text-ink-muted" : undefined}>{item.valor_nuevo ?? "—"}</span>
              </TableCell>
              <TableCell>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                    TIPO_CLASSES[item.tipo],
                  )}
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  {TIPO_LABELS[item.tipo]}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
