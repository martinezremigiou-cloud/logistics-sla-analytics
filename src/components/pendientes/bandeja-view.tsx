"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError } from "@/components/shared/estado-carga";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PendienteFila } from "./pendiente-fila";
import { DerivadosDescuadres } from "./derivados-descuadres";
import { DerivadosDrift } from "./derivados-drift";
import type { EstadoPendiente, PendientesResponse } from "@/types/api";

type SubTab = EstadoPendiente;

const SUBTABS: { value: SubTab; label: string }[] = [
  { value: "abierto", label: "Abiertos" },
  { value: "resuelto", label: "Resueltos" },
  { value: "descartado", label: "Descartados" },
];

const VACIO_POR_SUBTAB: Record<SubTab, string> = {
  abierto: "Sin pendientes abiertos — todo en orden.",
  resuelto: "Aún no hay resueltos.",
  descartado: "Aún no hay descartados.",
};

function BandejaSkeleton() {
  return (
    <div role="status" aria-label="Cargando pendientes…">
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

/**
 * Vista `/config?tab=pendientes` (F4, admin-only — el gate vive en
 * `ConfigView`, este componente no revalida rol): bandeja de
 * `pendientes_datos` (0009) con sub-tabs Abiertos/Resueltos/Descartados
 * (filtro client-side sobre la MISMA respuesta) + sección DERIVADA de
 * descuadres (`DerivadosDescuadres`, computada al vuelo, no persistida).
 *
 * Degrada con gracia si 0009 aún no aplicó: `listPendientes` regresa
 * `pendientes:[]`/`conteos:{abiertos:0,...}` (ver `pendientes.service.ts`),
 * que cae naturalmente en los mismos estados vacíos de siempre — sin caso
 * especial aquí.
 *
 * Gate anti-remount (R3-3, docs/engineering/failure-patterns.md (P3)): resolver un
 * pendiente dispara `PendienteAcciones.onResuelto → refetch`, que pone
 * `loading=true` con `data` TODAVÍA poblado con la respuesta anterior (ver
 * `use-api.ts`). El gate previo, `{loading && <Skeleton/>}` +
 * `{!loading && !error && data && ...}`, desmontaba la tabla COMPLETA en
 * cada resolución exitosa — parpadeo real, no solo cosmético: perdía
 * cualquier sub-tab activa y foco en curso. Igual criterio que
 * `FichaView`/`FocoSku`: el esqueleto solo cuando todavía no llegó el
 * primer `data`; una vez hay `data`, la tabla se queda montada y solo
 * refleja el refetch en vuelo vía `aria-busy`.
 */
export function BandejaView() {
  const { data, error, loading, refetch } = useApi<PendientesResponse>("/api/pendientes");
  const [subTab, setSubTab] = useState<SubTab>("abierto");

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[13.5px] font-semibold text-ink">Pendientes de datos</h2>
          {data && (
            <span
              aria-label={`${data.conteos.abiertos} pendientes abiertos`}
              className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-warn-bg px-2 font-mono text-[12px] font-bold text-warn"
            >
              {data.conteos.abiertos}
            </span>
          )}
        </div>

        {loading && !data && <BandejaSkeleton />}
        {error && <EstadoError mensaje={error.message} onRetry={refetch} />}

        {data && (
          <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)} aria-busy={loading}>
            <TabsList>
              {SUBTABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {SUBTABS.map((t) => {
              const items = data.pendientes.filter((p) => p.estado === t.value);
              return (
                <TabsContent key={t.value} value={t.value} className="mt-3">
                  {items.length === 0 ? (
                    <p className="py-8 text-center text-[12.5px] text-muted-foreground">{VACIO_POR_SUBTAB[t.value]}</p>
                  ) : (
                    <div className="overflow-x-auto rounded-[10px] border border-line-soft">
                      <Table>
                        <TableHeader>
                          <TableRow className="border-line-soft hover:bg-transparent">
                            <TableHead className="w-[52px]">
                              <span className="sr-only">Tipo</span>
                            </TableHead>
                            <TableHead>Pendiente</TableHead>
                            <TableHead>{t.value === "abierto" ? "Acciones" : "Resolución"}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {items.map((p) => (
                            <PendienteFila key={p.id} pendiente={p} onResuelto={refetch} tecnologias={data.tecnologias ?? []} />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </Card>

      {data && <DerivadosDescuadres descuadres={data.derivados.descuadres} />}
      {/* [2.0.1-A · D2] El drift de familias y el testigo del puente, por el
          MISMO carril derivado que los descuadres: se recalculan solos y no
          tienen acciones — aquí no se resuelve nada, se VE. */}
      {data && <DerivadosDrift drift={data.derivados.drift} puentes={data.derivados.puentes} />}
    </div>
  );
}
