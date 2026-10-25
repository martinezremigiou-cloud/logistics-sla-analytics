// ============================================================
// [INV-B8] proyecto-chips.tsx — los dos chips de clasificación de un
// proyecto (`tipo`, `intencion`), compartidos por la tarjeta de la lista
// (`proyecto-card.tsx`) y el encabezado del detalle (`proyecto-hero.tsx`)
// para que no diverjan en estilo. `tipo` en tono neutro (mismo look que
// `CHIP_NEUTRO` de `ficha-header.tsx`); `intencion` en tono info — la
// única forma de distinguir los dos ejes de un vistazo.
// ============================================================
import type { ReactNode } from "react";
import { COLOR_PROYECTO, TINTE_PROYECTO } from "./apariencia-proyecto";

interface ChipProps {
  children: ReactNode;
}

export function ChipTipo({ children }: ChipProps) {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-md bg-surface-3 px-2 py-0.5 text-[10.5px] font-semibold text-ink-2">
      {children}
    </span>
  );
}

export function ChipIntencion({ children }: ChipProps) {
  return (
    <span className="inline-flex w-fit items-center whitespace-nowrap rounded-md bg-info-bg px-2 py-0.5 text-[10.5px] font-semibold text-info">
      {children}
    </span>
  );
}

/**
 * [2.0.1-B · S-1] La misma intención, teñida con el ACENTO DEL PROYECTO.
 *
 * Vive aquí y no en la tarjeta por la razón por la que existe este archivo: dos
 * pantallas pintando el mismo chip con dos estilos es cómo empiezan a divergir.
 * `ChipIntencion` (tono info) sigue siendo el del `proyecto-hero`, donde no hay
 * portada que dé el acento; ésta es la de la tarjeta, donde sí la hay y el chip
 * tiene que pertenecer a la misma familia de color que la ilustración.
 */
export function ChipIntencionAcento({ children }: ChipProps) {
  return (
    <span
      className="inline-flex w-fit items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[10.5px] font-semibold"
      style={{ color: COLOR_PROYECTO, background: TINTE_PROYECTO }}
    >
      {children}
    </span>
  );
}
