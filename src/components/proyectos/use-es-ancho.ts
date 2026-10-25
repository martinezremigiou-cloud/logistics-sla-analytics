"use client";

// ============================================================
// [2.0.1-B · S-1] use-es-ancho.ts — la rama pasarela/lista se decide en REACT,
// no con clases.
//
// POR QUÉ NO SON DOS ÁRBOLES CON `hidden md:block`. La pasarela y la lista no
// son la misma pantalla con otro aspecto: la pasarela monta un carril con
// `overflow-x`, escuchas de scroll y dos botones. Renderizar las dos y esconder
// una con CSS dejaría en el DOM —y en el orden de tabulación— controles que
// nadie ve, que es exactamente el defecto que 2.0.1-A cazó en el sidebar
// colapsado (`inert` en `app-shell.tsx`). Una sola rama vive a la vez.
//
// EL PUNTO DE CORTE ES 768 porque es donde `BottomNav` desaparece y donde se
// puso la frontera: bajo `md` nunca se vio vacío y un carril para barrer N
// proyectos es más lento que una lista.
//
// SSR: arranca en `true` (la rama ancha), que es lo que pinta el servidor. El
// valor real llega en el primer efecto. Si arrancara en `false`, un escritorio
// vería la lista vertical un instante antes de saltar al carril.
// ============================================================
import { useEffect, useState } from "react";

/** Espejo de `md` en Tailwind. Un solo número, y aquí. */
export const CORTE_PASARELA = "(min-width: 768px)";

export function useEsAncho(): boolean {
  const [ancho, setAncho] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia(CORTE_PASARELA);
    const aplicar = () => setAncho(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, []);

  return ancho;
}
