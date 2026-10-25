// ============================================================
// [INV-B8] proyecto-hero.tsx — encabezado de `/proyectos/[id]` (100%
// presentacional).
//
// BARRA SUPERIOR DE ACENTO: es una franja aparte (`bg-brand`, primer hijo),
// no un `border-t-*` combinado con el `border` del contenedor — dos clases
// de Tailwind que tocan la MISMA propiedad longhand (`border-top-width` /
// `border-top-color`) dependen del orden en que Tailwind las genera en la
// hoja final, que este archivo no controla. Una franja aparte, recortada
// por `overflow-hidden` del contenedor, da el mismo resultado visual sin
// apostar a ese orden. Es un acento FIJO (marca), no por `tipo`: el DTO no
// trae ningún campo de color de proyecto (a diferencia de `colorSkuInfo`
// para SKUs) — inventar una paleta por `tipo` aquí sería un contrato que
// nadie pidió.
//
// SIN "Responsable": mismo motivo que `proyecto-card.tsx` — el DTO no lo
// trae. Ver la nota de la entrega a QA.
//
// [2.0.1-C · F-5 B1] LOS BOTONES DE EXPORTAR YA NO VIVEN AQUÍ. Se mudaron al
// panel de la pestaña Documento (`proyecto-documento-previa.tsx`), que es
// donde vive el `Blob` que «Descargar este PDF» reutiliza sin un segundo GET
// (D-3). Dejarlos duplicados aquí Y allá habría puesto dos caminos al mismo
// PDF en el mismo proyecto.
// ============================================================
import { formatoFecha, formatoNumero } from "@/lib/formato";
import { ChipTipo, ChipIntencion } from "./proyecto-chips";
import type { ProyectoDetalle } from "@/types/proyectos";

export function ProyectoHero({ detalle }: { detalle: ProyectoDetalle }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div aria-hidden="true" className="h-1 bg-brand" />

      <div className="flex flex-col gap-4 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11.5px] text-ink-muted">{detalle.folio}</span>
            {detalle.tipo && <ChipTipo>{detalle.tipo}</ChipTipo>}
            {detalle.intencion && <ChipIntencion>{detalle.intencion}</ChipIntencion>}
          </div>

          <h1 className="mt-2 text-2xl font-bold tracking-tight text-ink">{detalle.titulo}</h1>

          {detalle.descripcion && <p className="mt-1 max-w-[560px] text-[13.5px] leading-relaxed text-ink-2">{detalle.descripcion}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-4 text-[12px] text-ink-muted">
            {/*
              El responsable es el DUEÑO del proyecto (`perfiles.email` vía el
              embed del servicio), no la sesión que está mirando: un admin ve
              proyectos de varios KAM y pintar su propio correo sería falso.
              `null` solo ocurre si la cuenta se borró y el proyecto quedó
              huérfano — ahí se dice, en vez de dejar la línea coja.
            */}
            <span>
              Responsable ·{" "}
              <strong className="font-semibold text-ink-2">
                {detalle.responsable ?? "sin responsable (cuenta dada de baja)"}
              </strong>
            </span>
            <span>
              Fecha · <strong className="font-semibold text-ink-2">{formatoFecha(detalle.fecha)}</strong>
            </span>
            <span className="font-mono font-semibold text-ink">
              {detalle.skus} SKUs · {formatoNumero(detalle.piezas)} pz
            </span>
          </div>
        </div>

        {detalle.notas && (
          <div className="flex items-start gap-2 rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[12.5px] text-warn">
            <span aria-hidden="true">📌</span>
            <span>{detalle.notas}</span>
          </div>
        )}
      </div>
    </div>
  );
}
