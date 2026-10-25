// ============================================================
// Bloque 7-A · Libro Mayor · embarques-tabla.tsx
// Molde: src/components/catalogo/catalogo-tabla.tsx (mismo wrapper
// overflow-x-auto + <Table>, mismo patrón de Link con focus-visible ring
// en la ÚNICA celda enfocable). `ICONO_POR_ORDEN` reusado de
// src/components/cruce/pipeline-aduana.tsx (exportado ahí para esto —
// mismo criterio que dashboard-pipeline.tsx). Chips de Retraso/Histórico:
// mismas clases que `CHIP_RETRASO` de src/components/ficha/ficha-embarques.tsx
// (tono warn, NUNCA danger — regla de estatus-pill.tsx:19).
// ============================================================
import Link from "next/link";
import { Plane, Ship, Truck, Package, FileText, type LucideIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ICONO_POR_ORDEN } from "@/components/cruce/pipeline-aduana";
import { formatoFecha, formatoNumero } from "@/lib/formato";
import type { EmbarqueItem } from "@/types/api";

interface EmbarquesTablaProps {
  items: EmbarqueItem[];
  /** Refleja el fetch en vuelo durante un refetch (chrome persistente) — la tabla NO se desmonta, solo se marca `aria-busy`. */
  ariaBusy: boolean;
}

const CHIP_RETRASO =
  "inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full bg-warn-bg px-2.5 py-0.5 text-[11px] font-semibold text-warn";
const CHIP_HISTORICO =
  "inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full bg-surface-3 px-2.5 py-0.5 text-[11px] font-semibold text-ink-muted";

/**
 * Heurística de ícono por `tipo_importacion` (texto libre del Excel, SIN
 * enum fijo en el contrato — ver `parse.embarques.ts:37`, columna origen
 * "tipo de importacion"): substring case-insensitive sobre alias comunes de
 * aéreo/marítimo/terrestre. Es puramente de DISPLAY — nunca se usa para
 * filtrar ni se reinterpreta el dato; un valor que no matchea ningún alias
 * (o `null`) cae al ícono genérico, sin inventar un tipo.
 */
function iconoTipoImportacion(tipo: string | null): LucideIcon {
  if (tipo === null) return Package;
  const t = tipo.toUpperCase();
  if (t.includes("AER") || t.includes("AIR")) return Plane;
  if (t.includes("MAR")) return Ship;
  if (t.includes("TERR") || t.includes("TIERRA")) return Truck;
  return Package;
}

/** Tabla server-driven del Libro Mayor: renderiza tal cual la página actual recibida (sin paginar/ordenar/filtrar aquí). */
export function EmbarquesTabla({ items, ariaBusy }: EmbarquesTablaProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <Table aria-busy={ariaBusy}>
        <TableHeader>
          <TableRow className="border-line-soft hover:bg-transparent">
            <TableHead scope="col" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Embarque
            </TableHead>
            <TableHead scope="col" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Estatus
            </TableHead>
            <TableHead scope="col" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Piezas
            </TableHead>
            <TableHead
              scope="col"
              className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:table-cell"
            >
              Referencia / Factura
            </TableHead>
            <TableHead
              scope="col"
              className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:table-cell"
            >
              País
            </TableHead>
            <TableHead
              scope="col"
              className="hidden text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:table-cell"
            >
              Tipo
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const IconoEstatus = ICONO_POR_ORDEN[item.estatus_orden] ?? FileText;
            const IconoTipo = iconoTipoImportacion(item.tipo_importacion);
            const lineaFecha = item.is_historial
              ? `Recibido ${formatoFecha(item.fecha_disponibilidad)}`
              : `ETA ${formatoFecha(item.eta)}`;

            return (
              <TableRow key={item.id} className="border-line-soft">
                <TableCell className="align-top">
                  {/* Único elemento enfocable de la fila — PROHIBIDO onClick en el <tr> (inaccesible). */}
                  <Link
                    href={`/catalogo/${encodeURIComponent(item.sku)}`}
                    className="inline-flex rounded-sm font-mono text-[12.5px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                  >
                    {item.sku}
                  </Link>
                  <div className="mt-0.5 text-[11px] text-ink-muted">{item.oc_po ?? "—"}</div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2"
                    >
                      <IconoEstatus className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    </span>
                    <span className="text-[12.5px] text-ink-2">{item.estatus || "—"}</span>
                    {item.retrasado && <span className={CHIP_RETRASO}>Retraso</span>}
                    {item.is_historial && <span className={CHIP_HISTORICO}>Histórico</span>}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="font-mono text-[13px] font-semibold text-ink">
                    {item.piezas === null ? "—" : formatoNumero(item.piezas)}
                  </div>
                  <div className="text-[11px] text-ink-muted">{lineaFecha}</div>
                </TableCell>
                <TableCell className="hidden align-top md:table-cell">
                  <div className="text-[12.5px] text-ink-2">Ref: {item.referencia ?? "—"}</div>
                  <div className="text-[11px] text-ink-muted">Fact: {item.factura ?? "—"}</div>
                </TableCell>
                <TableCell className="hidden align-top text-[12.5px] text-ink-2 md:table-cell">
                  {item.pais_origen ?? "—"}
                </TableCell>
                <TableCell className="hidden align-top md:table-cell">
                  <div className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
                    <IconoTipo className="h-[15px] w-[15px] shrink-0 text-ink-muted" aria-hidden="true" />
                    {item.tipo_importacion ?? "—"}
                  </div>
                  <div className="text-[11px] text-ink-muted">{item.fw ?? "—"}</div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
