import { FolderPlus } from "lucide-react";

// ============================================================
// [2.0.1-B · S-1] proyectos-vacio.tsx — el estado vacío de `/proyectos`, en la
// forma acordada (opción A).
//
// ────────────────────────────────────────────────────────────
// POR QUÉ NO ES `EstadoVacio` CON OTRO ASPECTO. El compartido
// (`components/shared/estado-carga.tsx`) lo usan ONCE pantallas: cambiarle la
// forma para arreglar una las cambia todas, y ninguna de las otras diez pidió
// nada. Aquí vive el marco de esta pantalla; el compartido sigue intacto.
//
// ────────────────────────────────────────────────────────────
// EL COPY ES EL DE HOY, Y ESO ES UNA CORRECCIÓN A LA PROPUESTA INICIAL.
//
// La propuesta inicial era «Arma el primero desde el historial de un SKU». Se
// rechazó con la razón medida: **los dos puntos de entrada reales son el botón
// «+ Nuevo proyecto» de esta misma pantalla (`proyectos-view.tsx`) y
// «Nuevo proyecto…» dentro del volcado (`volcar-dialog.tsx:140`)**. «Desde el
// historial de un SKU» no es ninguno de los dos: manda por un rodeo de tres
// pasos teniendo el botón al lado.
//
// > **El estado vacío es el copy de más riesgo de la aplicación: es lo primero
// > que lee quien todavía no sabe usarla.** Uno que nombra un camino inexistente
// > no es una imprecisión, es una instrucción falsa.
//
// Así que cambia la FORMA —que era el punto flojo— y no el texto, que ya era
// correcto. Si algún día se toca, se toca sabiendo cuáles son las dos entradas.
// ============================================================

export interface ProyectosVacioProps {
  /**
   * El MISMO botón del encabezado, no uno parecido: se le pasa el manejador que
   * ya existe. Dos caminos distintos hacia la misma acción es cómo empiezan a
   * divergir.
   */
  onNuevo: () => void;
}

export function ProyectosVacio({ onNuevo }: ProyectosVacioProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-soft bg-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-3 text-ink-muted">
        <FolderPlus className="h-6 w-6" strokeWidth={1.6} />
      </span>
      <p className="text-[17px] font-semibold text-ink">Aún no tienes proyectos.</p>
      <p className="max-w-[42ch] text-[13px] leading-snug text-ink-muted">Crea el primero con “+ Nuevo proyecto”.</p>
      <button
        type="button"
        onClick={onNuevo}
        className="mt-1 inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13.5px] font-semibold text-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        + Nuevo proyecto
      </button>
    </div>
  );
}
