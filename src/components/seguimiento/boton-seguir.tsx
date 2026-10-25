"use client";

// ============================================================
// [INV-B9.1] boton-seguir.tsx — el interruptor de seguimiento de un SKU.
//
// VA JUNTO AL DE SELECCIÓN Y REUSA SU PATRÓN, que es lo que pidió el brief: un
// solo componente para la tabla, el grid y la ficha, con `aria-pressed` y con
// `preventDefault`+`stopPropagation` porque la fila del catálogo es un
// `<Link>`. Tres botones serían tres estados que pueden divergir — el problema
// que `sobre_reservado` ya tuvo en este repo, re-derivado en cuatro sitios.
//
// SON DOS COSAS DISTINTAS Y SE VEN DISTINTAS. La Selección es un borrador para
// volcar a un proyecto; seguir es pedir que te avisen. Comparten patrón, no
// significado: por eso éste lleva campana y el otro lleva un más.
//
// CUÁNDO PREGUNTA Y CUÁNDO NO. Si el perfil tiene `preguntar_por_sku` en
// `false` —el default, «usar esto para los siguientes»— seguir es un solo
// clic y aplica las preferencias. Solo abre la ventana quien pidió que le
// preguntaran.
//
// ────────────────────────────────────────────────────────────
// [INV-B9.1] CÓMO SE ENCIENDE EL CORREO DE UN SKU QUE YA SE SIGUE.
//
// El interruptor de correo vive dentro de la ventana de preferencias, como
// se pidió. Pero con el default —`preguntar_por_sku: false`— esa ventana no
// se abre nunca, así que **quedaría sin camino para encenderlo**. Ese hueco
// venía de B9 y este bloque lo hace visible.
//
// Se resuelve con el gesto MÍNIMO: en la ficha —y SOLO en la ficha— aparece un
// segundo control, «Avisos», cuando el SKU ya se sigue. Abre la misma ventana,
// ya rellenada, en modo edición.
//
// Y no aparece en la tabla ni en el grid a propósito: un segundo botón por
// renglón, sobre 50 filas y junto al de Selección, cuesta densidad para una
// acción que casi nadie repite. La ficha es donde uno decide en serio — es el
// mismo argumento con el que INV-B8.2 puso ahí el botón de Selección.
// ============================================================
import { useState } from "react";
import { Bell, BellRing, SlidersHorizontal } from "lucide-react";
import { useSeguimientoOpcional } from "@/components/providers/seguimiento-provider";
import { VentanaAvisos } from "./ventana-avisos";
import { cn } from "@/lib/utils";
import type { AvisosSku } from "@/types/avisos";

interface BotonSeguirProps {
  sku: string;
  /** `compacto` para la tabla y el grid; `completo` para la ficha. */
  variante?: "compacto" | "completo";
  className?: string;
}

export function BotonSeguir({ sku, variante = "compacto", className }: BotonSeguirProps) {
  const seguimiento = useSeguimientoOpcional();
  const [ventana, setVentana] = useState<"cerrada" | "alta" | "edicion">("cerrada");

  if (!seguimiento) return null;

  const sigue = seguimiento.sigue(sku);
  const estado = seguimiento.avisosDe(sku);
  const etiqueta = sigue ? "Siguiendo" : variante === "completo" ? "Avisarme" : "Seguir";

  const inicial: AvisosSku =
    ventana === "edicion" && estado
      ? estado
      : {
          av_estatus: seguimiento.preferencias.av_estatus,
          av_disponible: seguimiento.preferencias.av_disponible,
          av_reservado: seguimiento.preferencias.av_reservado,
          av_llegada: seguimiento.preferencias.av_llegada,
        };

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          aria-pressed={sigue}
          aria-label={sigue ? `Dejar de seguir ${sku}` : `Seguir ${sku} para recibir avisos`}
          // Sin esto, marcar un SKU navegaría a su ficha: la fila lleva un <Link>.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (sigue) {
              void seguimiento.dejarDeSeguir(sku);
            } else if (seguimiento.preferencias.preguntar_por_sku) {
              setVentana("alta");
            } else {
              void seguimiento.seguir(sku);
            }
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
            sigue
              ? "border-brand bg-brand-50 text-brand"
              : "border-line bg-surface text-ink-2 hover:border-brand hover:text-brand",
            className,
          )}
        >
          {sigue ? (
            <BellRing className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {etiqueta}
          {/* Que el correo esté encendido se ve sin abrir nada: un punto. */}
          {sigue && estado?.av_correo && (
            <span
              aria-label="con aviso por correo"
              className="ml-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
            />
          )}
        </button>

        {sigue && variante === "completo" && (
          <button
            type="button"
            aria-label={`Editar los avisos de ${sku}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setVentana("edicion");
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface px-2 py-2 text-[11.5px] font-semibold text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Avisos
          </button>
        )}
      </span>

      {/* Se monta solo cuando hace falta: un diálogo de radix vivo en cada fila
          de una tabla de 50 SKU sería 50 diálogos montados. */}
      {ventana !== "cerrada" && (
        <VentanaAvisos
          sku={sku}
          open
          onOpenChange={(v) => !v && setVentana("cerrada")}
          inicial={inicial}
          correoInicial={ventana === "edicion" ? (estado?.av_correo ?? false) : false}
          textoConfirmar={ventana === "edicion" ? "Guardar" : undefined}
          // Al EDITAR no se tocan las preferencias generales —quien afina un SKU
          // no está declarando un default para los siguientes— y por eso el
          // interruptor tampoco se PINTA: un control que no hace nada es P7.
          mostrarUsarSiempre={ventana === "alta"}
          onConfirmar={async (avisos, avCorreo, usarParaLosSiguientes) => {
            const ok = await seguimiento.seguir(sku, avisos, avCorreo);
            if (ok && usarParaLosSiguientes && ventana === "alta") {
              await seguimiento.guardarPreferencias({ ...avisos, preguntar_por_sku: false });
            }
            return ok;
          }}
        />
      )}
    </>
  );
}
