"use client";

// ============================================================
// [INV-B8.2] boton-seleccion.tsx — el interruptor de un SKU.
//
// UNA SOLA PIEZA PARA TRES SITIOS: la tabla del catálogo, el grid del catálogo
// y la ficha del SKU. El brief pide el mismo estado por fila en los tres, y
// tener tres botones distintos es tener tres estados que pueden divergir — que
// es exactamente lo que le pasó a `sobre_reservado` en este repo (re-derivado
// en cuatro sitios, con semántica distinta en uno).
//
// DOS ESTADOS, NO UN CONTADOR. `+ Proyecto` cuando el SKU no está en la
// Selección, `En Selección` cuando sí. Volver a pulsarlo lo QUITA. La cantidad
// no se toca aquí: se edita en el panel flotante, que es donde el usuario la
// está mirando. Ver `agregar` en `src/lib/seleccion.ts` — es idempotente por
// esta misma razón.
//
// SIN PROVIDER NO SE PINTA. Usa `useSeleccionOpcional()`, así que un catálogo
// montado sin `SeleccionProvider` —en un test, o si algún día alguien renderiza
// la tabla fuera de `(app)`— degrada a "no hay botón" en vez de tumbar la
// página.
// ============================================================
import { Check, Plus } from "lucide-react";
import { useSeleccionOpcional } from "@/components/providers/seleccion-provider";
import { cn } from "@/lib/utils";

interface BotonSeleccionProps {
  sku: string;
  /** `compacto` para la tabla (solo icono + texto corto); `completo` para la ficha. */
  variante?: "compacto" | "completo";
  className?: string;
}

export function BotonSeleccion({ sku, variante = "compacto", className }: BotonSeleccionProps) {
  const seleccion = useSeleccionOpcional();
  if (!seleccion) return null;

  const dentro = seleccion.tiene(sku);
  const etiqueta = dentro
    ? variante === "completo"
      ? "En Selección"
      : "En Selección"
    : variante === "completo"
      ? "+ En proyecto"
      : "+ Proyecto";

  return (
    <button
      type="button"
      // `aria-pressed` y no un `aria-label` que cambie: un lector de pantalla
      // anuncia el estado del interruptor sin que el nombre del botón se mueva
      // bajo el foco.
      aria-pressed={dentro}
      aria-label={dentro ? `Quitar ${sku} de la Selección` : `Agregar ${sku} a la Selección`}
      onClick={(e) => {
        // La fila de la tabla lleva un <Link> al SKU: sin esto, marcar un SKU
        // navegaría a su ficha.
        e.preventDefault();
        e.stopPropagation();
        seleccion.alternar(sku);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-[11.5px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        dentro
          ? "border-success bg-success-bg text-success"
          : "border-line bg-surface text-ink-2 hover:border-brand hover:text-brand",
        className,
      )}
    >
      {dentro ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
      {etiqueta}
    </button>
  );
}
