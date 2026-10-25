"use client";

// ============================================================
// [INV-B11] O6-adenda · EL SALUDO CONTEXTUAL.
//
// Una línea, junto a la burbuja cerrada, la primera vez que alguien entra al
// catálogo en su sesión. Copy aprobado el 2026-08-21.
//
// ────────────────────────────────────────────────────────────
// LA REGLA IMPORTA MÁS QUE EL TEXTO, y se fijó así:
//
//     > Una vez por sesión, y no negociable. Un aviso que aparece cada vez que
//     > entras al catálogo es ruido en una semana — y ya sabemos cómo termina
//     > lo que se aprende a ignorar.
//
// Las tres condiciones, y cómo se cumple cada una:
//
//   una vez por sesión   `sessionStorage`, no `localStorage`. La razón es la de
//                        B10-7: `localStorage` es **por navegador, no por
//                        cuenta**, así que en una máquina compartida el segundo
//                        KAM no vería nunca el saludo porque el primero ya lo
//                        cerró. `sessionStorage` muere con la pestaña, que es
//                        exactamente lo que «por sesión» significa aquí.
//   descartable          una ✕ propia, y abrir el chat también lo cierra: si
//                        ya estás hablando con él, el saludo cumplió.
//   nunca bloqueante     no es un diálogo, no lleva `role="alertdialog"` y no
//                        toma el foco al montarse. `role="status"` lo anuncia a
//                        un lector de pantalla **sin mover el foco de nadie**.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-A] LA CORRECCIÓN, porque esta cabecera afirmaba algo FALSO.
//
// Decía: *«no cubre la burbuja — se para ENCIMA de ella»*, y de ahí se leía
// «no bloquea nada». Cierto para la burbuja; **falso para la píldora de la
// Selección**. Medido el 2026-08-26 a 390 px con `document.elementFromPoint`
// sobre el centro exacto de la píldora: devolvía **este** `<div>`, no la
// píldora. Con el saludo visible, el tap no llegaba — y la píldora es el único
// camino al trabajo que el usuario venía arrastrando.
//
// Era una afirmación de diseño que nadie midió, sobreviviendo firmada dentro
// de un comentario que la volvía creíble (P25-11: la declaración no es el
// efecto). El arreglo se pidió de forma explícita: **un comentario falso
// verificado es peor que ninguno.**
//
// Qué cambió, y por qué el defecto ya no puede volver:
//   · Este componente PERDIÓ su anclaje propio. No dice dónde se para: es un
//     hijo en flujo del contenedor de la zona del asistente
//     (`burbuja-chat.tsx`), apilado sobre la burbuja. Su piso es el techo de
//     ella **por construcción** — antes era la resta `bottom-20 = h-12 +
//     bottom-5`, hecha a mano y desincronizada en cuanto el botón se movió.
//   · Y contra la píldora no se reparte espacio, se cede: bajo `md`, con
//     Selección viva, el saludo **se aparta** (regla 5 del carril, aplicada por
//     CSS desde `globals.css` con el atributo que publica el shell — este
//     archivo sigue sin saber que la Selección existe). No consume el testigo:
//     estar apartado no es haber saludado.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ NO LEE `sessionStorage` DURANTE EL RENDER. Igual que la Selección:
// el servidor no tiene `sessionStorage`, y leerlo al renderizar produce un
// desajuste de hidratación. Se lee en un efecto, y por eso el saludo aparece
// un instante después de cargar — que además es lo correcto: entrar a una
// pantalla y que algo salte en el mismo frame se lee como un error.
// ============================================================
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { SALUDO_CONTEXTUAL } from "@/lib/chat/voz";

/** La clave del testigo. Con prefijo del proyecto, como el resto del repo. */
export const CLAVE_SALUDO = "mx-saludo-chat";

/**
 * El copy, aprobado. Una sola línea y sin signos de admiración.
 *
 * **Vive en `voz.ts` y aquí solo se re-exporta.** Este archivo es dueño de la
 * REGLA —una vez por sesión, descartable, nunca bloqueante— y no del TEXTO: la
 * voz del Asistente se escribe en un solo sitio y `voz.test.ts` lo vigila.
 */
export const TEXTO_SALUDO = SALUDO_CONTEXTUAL;

/**
 * Dónde aparece. **El catálogo entero**, ficha incluida: es donde alguien está
 * mirando un producto y se le ocurre la pregunta. Fuera de ahí no sale.
 */
export function esRutaDeSaludo(pathname: string | null): boolean {
  return pathname === "/catalogo" || (pathname?.startsWith("/catalogo/") ?? false);
}

export function SaludoContextual({
  onAbrirChat,
  /** Sembrado para la evidencia visual y las pruebas. No es superficie de producción. */
  inicialVisible,
}: {
  onAbrirChat: () => void;
  inicialVisible?: boolean;
}) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(inicialVisible ?? false);

  useEffect(() => {
    if (inicialVisible !== undefined) return; // sembrado: manda quien sembró
    if (typeof window === "undefined") return;
    if (!esRutaDeSaludo(pathname)) return;
    // Se comprueba EN CADA cambio de ruta y no solo al montar: la burbuja vive
    // en el shell de `(app)`, así que entrar al catálogo desde el dashboard no
    // vuelve a montarla. Sin esto, quien no aterriza directo en el catálogo no
    // vería el saludo nunca.
    try {
      if (window.sessionStorage.getItem(CLAVE_SALUDO) === "visto") return;
    } catch {
      // Almacenamiento bloqueado (modo privado estricto). Se prefiere NO
      // saludar antes que saludar en cada navegación sin poder recordarlo.
      return;
    }
    setVisible(true);
  }, [pathname, inicialVisible]);

  function cerrar() {
    setVisible(false);
    try {
      window.sessionStorage.setItem(CLAVE_SALUDO, "visto");
    } catch {
      // Si no se puede escribir, ya no se muestra en este montaje y basta.
    }
  }

  if (!visible) return null;

  return (
    <div
      role="status"
      // [2.0.1-A] SIN ANCLAJE PROPIO: la posición la pone el contenedor de la
      // zona del asistente, que es quien conoce su piso en el carril. Aquí solo
      // vive la tarjeta. `data-carril-piso` es lo que permite que la regla 5
      // (con Selección, el saludo se aparta) se aplique desde el CSS del carril
      // sin que este archivo importe nada de la Selección.
      data-carril-piso="saludo"
      className="pointer-events-auto flex max-w-[min(20rem,calc(100vw-2.5rem))] items-start gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg"
    >
      <button
        type="button"
        onClick={() => {
          cerrar();
          onAbrirChat();
        }}
        className="min-w-0 text-left text-[12px] leading-snug text-ink outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
      >
        {TEXTO_SALUDO}
      </button>
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar el saludo"
        className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-ink-muted outline-none transition-colors hover:bg-surface-3 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
