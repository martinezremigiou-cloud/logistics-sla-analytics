import { Skeleton } from "@/components/ui/skeleton";
import { ANCLAJE_TARJETA, CARRIL_PASARELA, DIMENSIONES_TARJETA, DIMENSIONES_TARJETA_LISTA, REJILLA_LISTA } from "./geometria-lista";

/**
 * Loading state de la carga INICIAL de `/proyectos`.
 *
 * [2.0.1-B · S-1] TOMA LA MISMA FORMA QUE VA A RESOLVER, y recibe el ancho por
 * prop en vez de adivinarlo: la vista ya sabe en qué rama está, y que el
 * esqueleto lo dedujera por su cuenta sería una segunda decisión que puede
 * discrepar de la primera.
 *
 * Los tamaños salen de `geometria-lista.ts` —los MISMOS que consume la
 * pasarela— para que el salto al resolver sea **cero por construcción** y no por
 * acordarse de igualar dos números. Antes de S-1 el esqueleto pintaba 150 px
 * contra los 196 medidos de la tarjeta: 46 px de brinco que ninguna prueba podía
 * ver, porque solo existe durante la transición.
 *
 * ────────────────────────────────────────────────────────────
 * [S-1] NO HAY HUECO PARA EL ZOOM, y es una decisión, no un olvido.
 *
 * El zoom llegó con esta entrega y vive DEBAJO del carril, o sea al final de la
 * pantalla: cuando aparece no empuja nada, porque no hay nada debajo. Un
 * marcador de posición para él tendría que declarar un alto —y el alto del zoom
 * depende del ancho (portada `760×280` a `width:100%`) y del título—, así que
 * sería un número inventado. **Reservar mal es peor que no reservar: crearía el
 * salto que este archivo existe para impedir**, y encima uno que sí se ve, en
 * vez de sólo dejar que la página crezca por abajo.
 */
export function ProyectosSkeleton({ ancho = true }: { ancho?: boolean }) {
  if (!ancho) {
    return (
      <div role="status" aria-label="Cargando proyectos…" className="flex flex-col gap-3.5">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className={`${DIMENSIONES_TARJETA_LISTA} rounded-[15px]`} />
        ))}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Cargando proyectos…" className={`${CARRIL_PASARELA} rounded-2xl bg-[var(--mx-track)] p-3`}>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className={`${ANCLAJE_TARJETA} ${DIMENSIONES_TARJETA} rounded-[15px]`} />
      ))}
    </div>
  );
}

/**
 * La rejilla vieja sigue exportada porque `evidencia-visual.test.tsx` retrata la
 * pantalla de INV-B8.2 y ese retrato no debe cambiar de forma por un rediseño
 * posterior: es evidencia de un bloque cerrado, no una vista viva.
 */
export const REJILLA_HISTORICA = REJILLA_LISTA;
