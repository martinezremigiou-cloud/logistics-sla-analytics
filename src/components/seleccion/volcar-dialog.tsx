"use client";

// ============================================================
// [INV-B8.2] volcar-dialog.tsx — de la Selección a un proyecto.
//
// TRES PASOS Y NO UNO: elegir destino → VER qué va a pasar → confirmar. El paso
// del medio es el «and say» del sum-and-say aprobado: el usuario armó
// la Selección recorriendo el catálogo, sin ver el proyecto, así que al volcar
// tiene derecho a saber cuáles SKUs son nuevos y cuáles ya estaban y van a
// sumar. Sin esa vista, «volcar» sería un botón que cambia cifras que nadie
// enseñó.
//
// ESTE DIÁLOGO NO CREA PROYECTOS. El camino «proyecto nuevo» delega en
// `NuevoProyectoDialog`, que ya existía, y con el id que devuelve entra al
// MISMO camino que un proyecto existente. No es reutilización por ahorro: es lo
// que hace que el volcado tenga una sola semántica y que el reintento sea
// idempotente siempre (ver la cabecera de la ruta `partidas/volcado`).
//
// LA SELECCIÓN SE VACÍA SOLO SI TODO ENTRÓ. Con conflictos o SKUs desconocidos
// se conserva, porque el usuario todavía tiene algo que hacer con ella — y
// reintentar es seguro: el servidor detecta lo ya aplicado y no lo vuelve a
// sumar. Vaciarla «porque la llamada respondió 200» habría perdido el trabajo
// justo en el caso en que hace falta.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NuevoProyectoDialog } from "@/components/proyectos/nuevo-proyecto-dialog";
import { volcarSeleccionFetch } from "@/components/proyectos/partidas-api";
import { useApi } from "@/lib/hooks/use-api";
import { formatoNumero } from "@/lib/formato";
import { planDeVolcado, resumenDePlan, cargaDeVolcado, type RenglonPlan, type ResumenPlan } from "@/lib/volcado-plan";
import type { ItemSeleccion } from "@/lib/seleccion";
import type { ProyectoResumen, ProyectosResponse, ProyectoDetalle, ResultadoVolcado } from "@/types/proyectos";

interface VolcarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemSeleccion[];
  /** Se invoca SOLO cuando el volcado entró completo. El caller decide qué hacer con la Selección. */
  onVolcadoCompleto: () => void;
}

export function VolcarDialog({ open, onOpenChange, items, onVolcadoCompleto }: VolcarDialogProps) {
  const [destino, setDestino] = useState<string | null>(null);
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoVolcado | null>(null);

  // `ProyectosResponse` y no `ProyectoResumen[]`: la ruta devuelve `{ items }`.
  // El genérico de `useApi` es una AFIRMACIÓN sobre la forma, no una
  // comprobación — declararlo mal compila igual y revienta en el navegador.
  const proyectos = useApi<ProyectosResponse>(open ? "/api/proyectos" : null);
  const listaProyectos = proyectos.data?.items ?? [];
  // El detalle se pide SIEMPRE, también para un proyecto recién creado: así hay
  // un solo camino y `cantidadVista` sale de la base en los dos casos, nunca de
  // suponer que un proyecto nuevo está vacío.
  const detalle = useApi<ProyectoDetalle>(open && destino ? `/api/proyectos/${encodeURIComponent(destino)}` : null);

  // Al cerrar se olvida todo. Sin esto, reabrir el diálogo enseñaría el
  // resultado del volcado anterior sobre una Selección que ya es otra.
  useEffect(() => {
    if (!open) {
      setDestino(null);
      setResultado(null);
      setEnviando(false);
    }
  }, [open]);

  const plan = useMemo(
    () => (detalle.data ? planDeVolcado(items, detalle.data.partidas) : []),
    [items, detalle.data],
  );
  const resumen = useMemo(() => resumenDePlan(plan), [plan]);

  async function confirmar() {
    if (!destino || plan.length === 0) return;
    setEnviando(true);
    try {
      const r = await volcarSeleccionFetch(destino, cargaDeVolcado(plan));
      if (!r) return; // `volcarSeleccionFetch` ya avisó del error.
      setResultado(r);
      if (r.conflictos.length === 0 && r.desconocidos.length === 0) onVolcadoCompleto();
    } finally {
      setEnviando(false);
    }
  }

  const proyectoElegido = listaProyectos.find((p) => p.id === destino) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Volcar la Selección</DialogTitle>
            {/*
              Con el resultado en pantalla la Selección ya se vació, así que
              contarla diría «0 SKU · 0 pz» encima de un volcado que sí ocurrió.
              El encabezado pasa a describir el destino.
            */}
            <DialogDescription>
              {resultado ? (
                <>Resultado del volcado{proyectoElegido ? ` en ${proyectoElegido.folio}` : ""}.</>
              ) : (
                <>
                  {formatoNumero(items.length)} SKU · {formatoNumero(items.reduce((s, i) => s + i.cantidad, 0))} pz
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {resultado ? (
            <ResultadoDelVolcado resultado={resultado} proyecto={proyectoElegido} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="volcar-destino">Proyecto destino</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="volcar-destino"
                    value={destino ?? ""}
                    onChange={(e) => setDestino(e.target.value || null)}
                    disabled={enviando || proyectos.loading}
                    className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface-input px-2.5 text-[13px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <option value="">
                      {proyectos.loading ? "Cargando proyectos…" : "Elige un proyecto…"}
                    </option>
                    {listaProyectos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.folio} · {p.titulo}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="outline" onClick={() => setNuevoAbierto(true)} disabled={enviando}>
                    Nuevo proyecto…
                  </Button>
                </div>
                {proyectos.error && (
                  <p className="text-[12px] text-danger">No se pudo cargar la lista de proyectos.</p>
                )}
              </div>

              {destino && detalle.loading && <p className="text-[12.5px] text-ink-muted">Leyendo el proyecto…</p>}
              {destino && detalle.error && (
                <p className="text-[12.5px] text-danger">
                  No se pudo leer el proyecto. Sin saber qué tiene, volcar podría sumar sobre cifras equivocadas.
                </p>
              )}

              {destino && detalle.data && <VistaPreviaVolcado plan={plan} resumen={resumen} />}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={enviando}>
              {resultado ? "Cerrar" : "Cancelar"}
            </Button>
            {!resultado && (
              <Button
                type="button"
                onClick={() => void confirmar()}
                disabled={enviando || !destino || !detalle.data || plan.length === 0}
              >
                {enviando ? "Volcando…" : `Volcar ${formatoNumero(plan.length || items.length)} SKU`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NuevoProyectoDialog
        open={nuevoAbierto}
        onOpenChange={setNuevoAbierto}
        onCreated={(p) => {
          setNuevoAbierto(false);
          setDestino(p.id);
          // La lista se recarga para que el proyecto recién creado aparezca en
          // el `<select>` con su folio — si no, el destino elegido no tendría
          // nombre que enseñar en el resultado.
          proyectos.refetch();
        }}
      />
    </>
  );
}

// ============================================================
// LAS DOS PIEZAS DE ABAJO SE EXPORTAN, y no por gusto de granularidad.
//
// Un `Dialog` de radix emite **CERO bytes** bajo `renderToStaticMarkup`: su
// portal no existe en el servidor. Medido, no supuesto — un marco de evidencia
// con el diálogo dentro habría salido literalmente vacío y la página se habría
// visto plausible, con su rótulo y su iframe en blanco.
//
// Sacándolas del envoltorio, la evidencia visual las renderiza directo y se
// puede juzgar la vista previa y el desglose. De paso quedan probables por
// separado, que es lo que ya son: dos componentes de props, sin fetch.
// ============================================================

/** La vista previa: qué SKU es nuevo, cuál suma, y con qué cifras. Es el «and say» del sum-and-say. */
export function VistaPreviaVolcado({ plan, resumen }: { plan: RenglonPlan[]; resumen: ResumenPlan }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-ink-2">
        {resumen.nuevos > 0 && <>{formatoNumero(resumen.nuevos)} SKU nuevo(s)</>}
        {resumen.nuevos > 0 && resumen.existentes > 0 && " · "}
        {resumen.existentes > 0 && (
          <>
            <strong className="font-semibold">{formatoNumero(resumen.existentes)} ya estaba(n)</strong> y van a sumar
          </>
        )}
      </p>
      <ul className="max-h-52 overflow-y-auto rounded-lg border border-line">
        {plan.map((r) => (
          <li
            key={r.sku}
            className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5 text-[12px] last:border-b-0"
          >
            <span className="min-w-0 truncate font-mono font-semibold text-ink" title={r.sku}>
              {r.sku}
            </span>
            {r.esNuevo ? (
              <span className="shrink-0 font-mono text-ink-muted">nuevo · {formatoNumero(r.cantidad)} pz</span>
            ) : (
              <span className="shrink-0 font-mono text-ink">
                {formatoNumero(r.cantidadVista)} + {formatoNumero(r.cantidad)} ={" "}
                <strong className="font-semibold">{formatoNumero(r.despues)}</strong>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * El desglose que devolvió el servidor. Se enseñan las CUATRO listas y no solo
 * un «listo»: el reintento detectado es información —le dice al usuario que su
 * volcado anterior sí había entrado— y el conflicto es una decisión pendiente.
 */
export function ResultadoDelVolcado({
  resultado,
  proyecto,
}: {
  resultado: ResultadoVolcado;
  proyecto: ProyectoResumen | null;
}) {
  const limpio = resultado.conflictos.length === 0 && resultado.desconocidos.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div
        className={
          limpio
            ? "flex items-start gap-2 rounded-lg border border-success bg-success-bg px-3 py-2.5"
            : "flex items-start gap-2 rounded-lg border border-warn bg-warn-bg px-3 py-2.5"
        }
      >
        {limpio ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        )}
        <div className="text-[12.5px] leading-snug">
          <p className={limpio ? "font-semibold text-success" : "font-semibold text-warn"}>
            {limpio ? "Volcado completo." : "Volcado parcial: quedaron renglones sin aplicar."}
          </p>
          <p className="text-ink-2">
            {formatoNumero(resultado.aplicadas.length)} aplicado(s)
            {resultado.sinCambio.length > 0 && <> · {formatoNumero(resultado.sinCambio.length)} ya estaba(n) así</>}
            {resultado.conflictos.length > 0 && <> · {formatoNumero(resultado.conflictos.length)} en conflicto</>}
            {resultado.desconocidos.length > 0 && (
              <> · {formatoNumero(resultado.desconocidos.length)} fuera del catálogo</>
            )}
          </p>
          {limpio && <p className="mt-1 text-ink-muted">La Selección se vació.</p>}
        </div>
      </div>

      {resultado.aplicadas.length > 0 && (
        <ListaResultado titulo="Aplicados">
          {resultado.aplicadas.map((a) => (
            <Renglon key={a.sku} sku={a.sku}>
              {a.antes === 0 ? (
                <>nuevo · {formatoNumero(a.despues)} pz</>
              ) : (
                <>
                  {formatoNumero(a.antes)} → <strong className="font-semibold">{formatoNumero(a.despues)}</strong>
                </>
              )}
            </Renglon>
          ))}
        </ListaResultado>
      )}

      {resultado.sinCambio.length > 0 && (
        <ListaResultado
          titulo="Ya estaban así"
          nota="Este volcado ya se había aplicado. No se sumó dos veces."
          icono={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {resultado.sinCambio.map((s) => (
            <Renglon key={s.sku} sku={s.sku}>
              {formatoNumero(s.cantidad)} pz
            </Renglon>
          ))}
        </ListaResultado>
      )}

      {resultado.conflictos.length > 0 && (
        <ListaResultado titulo="En conflicto" nota="No se tocaron. Vuelve a volcar para recalcular sobre lo que hay ahora.">
          {resultado.conflictos.map((c) => (
            <Renglon key={c.sku} sku={c.sku}>
              {c.motivo === "tope_cantidad" ? (
                <>rebasa el máximo de piezas</>
              ) : (
                <>
                  esperaba {formatoNumero(c.cantidadVista)}, hay {formatoNumero(c.cantidadActual)}
                </>
              )}
            </Renglon>
          ))}
        </ListaResultado>
      )}

      {resultado.desconocidos.length > 0 && (
        <ListaResultado titulo="Fuera del catálogo" nota="Estos SKUs no existen en productos y no se pueden agregar.">
          {resultado.desconocidos.map((sku) => (
            <Renglon key={sku} sku={sku}>
              —
            </Renglon>
          ))}
        </ListaResultado>
      )}

      {proyecto && (
        <Link
          href={`/proyectos/${encodeURIComponent(proyecto.id)}`}
          className="text-[12.5px] font-semibold text-brand underline-offset-2 hover:underline"
        >
          Ir a {proyecto.folio} · {proyecto.titulo}
        </Link>
      )}
    </div>
  );
}

function ListaResultado({
  titulo,
  nota,
  icono,
  children,
}: {
  titulo: string;
  nota?: string;
  icono?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
        {icono}
        {titulo}
      </p>
      {nota && <p className="text-[11.5px] leading-snug text-ink-muted">{nota}</p>}
      <ul className="max-h-40 overflow-y-auto rounded-lg border border-line">{children}</ul>
    </div>
  );
}

function Renglon({ sku, children }: { sku: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5 text-[12px] last:border-b-0">
      <span className="min-w-0 truncate font-mono font-semibold text-ink" title={sku}>
        {sku}
      </span>
      <span className="shrink-0 font-mono text-ink-muted">{children}</span>
    </li>
  );
}
