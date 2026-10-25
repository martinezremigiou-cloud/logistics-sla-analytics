// ============================================================
// [INV-B8 · rehecha en 2.0.1-B · S-1] proyecto-card.tsx — la tarjeta del XUI.
//
// EL "RESPONSABLE" SÍ EXISTE, Y VIENE DEL SERVIDOR — no de la sesión.
//
// `ProyectoResumen.responsable` (`src/types/proyectos.ts:38`) lo resuelve el
// embed `perfiles(email)` de `COLS_PROYECTO` (`proyectos.service.ts:61`,
// mapeado en `:412`). Es el dueño de la fila, no quien la está mirando: un
// admin ve proyectos de varios KAM (`proyectos_select_own_or_admin` le enseña
// los ajenos) y cada tarjeta nombra al suyo. Sin propietario queda `null` y se
// pinta «—», que es la verdad y no un hueco.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-B · S-1] QUÉ CAMBIÓ Y POR QUÉ, porque la versión anterior de esta
// tarjeta era el CONTENEDOR y no la TARJETA.
//
// La pasarela aterrizó primero y dejó dentro la tarjeta de antes: cinco de los
// quince elementos de la §3 de la especificación. Faltaban justo los que dan
// identidad —portada, tinte, símbolo, folio sobre la portada, borde activo,
// «inventario del …»— y el resultado fue el peor intermedio: **el layout cambió
// y el contenido no.**
//
// La recomposición de campos entra AQUÍ y no después, porque es la que arregla
// de paso los dos defectos de composición que midió el QA:
//
//   · La línea de métricas ENVOLVÍA a dos renglones («0 SKU · 0 / pz»). Ahora
//     es `whitespace-nowrap` y ya no comparte renglón con el correo del
//     responsable, que era lo que la empujaba.
//   · Las tarjetas tenían ALTOS DISTINTOS. La causa no era el contenido: el
//     `<li>` de la pasarela ya fijaba la medida y esta tarjeta no la tomaba
//     (`flex flex-col` sin `h-full`), así que crecía por encima de su caja.
//
// `tipo` SALE de la tarjeta —la §3 no lo lista— y sigue en `proyecto-hero`.
//
// ────────────────────────────────────────────────────────────
// LA BANDA DEL HUÉRFANO VA SUPERPUESTA, y es una decisión con número detrás.
//
// En la pasarela todas las tarjetas comparten renglón, así que una que crezca
// estira a las demás y el esqueleto vuelve a no coincidir. Poner la banda en el
// flujo obligaba a reservar ~50 px en las NUEVE tarjetas para que una los usara.
// Superpuesta (`absolute inset-x-0 bottom-0`, fuera del `<Link>` porque un
// `<button>` dentro de un ancla es HTML inválido) el alto es idéntico para
// todas, tape lo que tape. Lo que tapa es la línea de «inventario del …», que en
// un proyecto que nadie puede editar es lo menos urgente de la tarjeta.
//
// SIN LÁPIZ: ausente POR DECISIÓN, no por olvido. Sin las columnas `color` y
// `simbolo` por proyecto (S-2) el botón no tendría nada que editar.
// ============================================================
import Link from "next/link";
import { formatoFecha, formatoFechaDeTimestamp, formatoNumero } from "@/lib/formato";
import { ChipIntencionAcento } from "./proyecto-chips";
import { COLOR_PROYECTO } from "./apariencia-proyecto";
import { PortadaTarjeta } from "./portada-proyecto";
import type { ProyectoResumen } from "@/types/proyectos";

/** La sombra de la tarjeta activa, de la maqueta. Literal entero: Tailwind escanea TEXTO. */
const SOMBRA_ACTIVA = "shadow-[0_12px_28px_rgba(15,23,42,.14)]";

interface ProyectoCardProps {
  proyecto: ProyectoResumen;
  /**
   * [0025] Rescate de un proyecto HUÉRFANO. Solo llega definido cuando quien
   * mira es admin Y el proyecto no tiene responsable — es decir, cuando la
   * acción de verdad se puede ejecutar. Un botón que la mayoría no puede usar
   * es ruido en la pantalla de todos.
   */
  onReasignar?: () => void;
  /** La tarjeta anclada al inicio del carril: borde de 1.5 px con el acento y sombra. */
  activa?: boolean;
  /**
   * `created_at` del snapshot pinneado por `conVigenteStock`. **Es global, no
   * por proyecto** — la fecha del inventario con el que se leyó TODA la lista.
   * `null` mientras no hay snapshot: entonces la línea no se pinta, en vez de
   * inventar una fecha.
   */
  inventarioEn?: string | null;
  /** Recorta la portada a una banda fija en vez de dejarla crecer con el ancho. Ver `ProyectosView`. */
  portadaCompacta?: boolean;
}

export function ProyectoCard({ proyecto, onReasignar, activa = false, inventarioEn, portadaCompacta = false }: ProyectoCardProps) {
  return (
    <div
      className={`relative flex h-full flex-col overflow-hidden rounded-[15px] bg-surface transition-shadow ${
        activa ? `border-[1.5px] ${SOMBRA_ACTIVA}` : "border border-line"
      }`}
      style={activa ? { borderColor: COLOR_PROYECTO } : undefined}
    >
      <Link
        href={`/proyectos/${encodeURIComponent(proyecto.id)}`}
        className="flex h-full flex-col outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
      >
        <div className="relative shrink-0">
          <PortadaTarjeta compacta={portadaCompacta} />
          {/* El folio va SOBRE la portada, no encima del título: es la identidad
              legible del proyecto y la §3 lo pone ahí. */}
          <span
            className="absolute left-3.5 top-3 rounded-md bg-surface px-2 py-[3px] font-mono text-[11px] font-semibold"
            style={{ color: COLOR_PROYECTO }}
          >
            {proyecto.folio}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 pb-3.5 pt-3">
          {proyecto.intencion && <ChipIntencionAcento>{proyecto.intencion}</ChipIntencionAcento>}

          <p className="line-clamp-2 break-words text-[15.5px] font-semibold leading-snug text-ink" title={proyecto.titulo}>
            {proyecto.titulo}
          </p>

          {/* Dueño del proyecto, no la sesión — ver el comentario de `proyecto-hero.tsx`. */}
          <p className="truncate text-[11.5px] text-ink-muted" title={proyecto.responsable ?? undefined}>
            {proyecto.responsable ?? "—"}
          </p>

          {/*
            La línea de métricas, en su propio renglón y sin envolver. Antes
            compartía renglón con el correo del responsable y a 320 px eso
            partía «0 SKU · 0 / pz» en dos — el defecto que midió el QA. Ahora
            el correo tiene el renglón de arriba y aquí solo compiten la fecha
            y las cifras, las dos con `whitespace-nowrap`.
          */}
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-soft pt-2.5">
            <span className="whitespace-nowrap text-[11px] text-ink-muted">{formatoFecha(proyecto.fecha)}</span>
            <span className="whitespace-nowrap font-mono text-[11.5px] font-semibold" style={{ color: "var(--mx-navy-ink)" }}>
              {proyecto.skus} SKU · {formatoNumero(proyecto.piezas)} pz
            </span>
          </div>

          {inventarioEn && (
            <p className="flex items-center gap-1.5 text-[10.5px] text-ink-muted">
              <span aria-hidden="true" className="h-[5px] w-[5px] shrink-0 rounded-full bg-ink-muted" />
              inventario del {formatoFechaDeTimestamp(inventarioEn)}
            </p>
          )}
        </div>
      </Link>

      {/*
        Va FUERA del <Link> y no dentro: un <button> anidado en un ancla es
        HTML inválido y rompe la navegación por teclado. El aviso dice qué
        pasa, no solo que falta un dato — "sin responsable" a secas no
        explicaría por qué el proyecto no se puede editar.
      */}
      {onReasignar && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-warn-bg bg-warn-bg px-3 py-2">
          <span className="line-clamp-2 text-[11.5px] leading-snug text-warn" title="Sin responsable: su cuenta se dio de baja y nadie puede editarlo.">
            Sin responsable: su cuenta se dio de baja y nadie puede editarlo.
          </span>
          <button
            type="button"
            onClick={onReasignar}
            className="shrink-0 rounded-md border border-warn px-2 py-1 text-[11.5px] font-semibold text-warn outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand"
          >
            Reasignar
          </button>
        </div>
      )}
    </div>
  );
}
