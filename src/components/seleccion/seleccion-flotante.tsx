"use client";

// ============================================================
// [INV-B8.2] seleccion-flotante.tsx — el cableado del panel.
//
// Ocho líneas de lógica, y a propósito: todo lo que se puede probar sin React
// está en `src/lib/seleccion.ts`, y todo lo que se puede ver sin contexto está
// en `panel-seleccion.tsx`. Aquí solo se juntan.
//
// SE MONTA EN `app-shell.tsx`, no en cada página. Es lo que hace que la
// Selección **sobreviva a la navegación** (invariante 1): el shell del route
// group `(app)` es el único nivel que no se remonta al cambiar de pantalla.
//
// ────────────────────────────────────────────────────────────
// [INV-B11] O6 · AHORA SE PINTA EN DOS SITIOS, Y EL DIÁLOGO SIGUE SIENDO UNO.
//
// La regla espacial —*izquierda es lo tuyo, derecha es el asistente*— pone el
// panel en el pie del sidebar cuando hay sidebar, y como píldora flotante
// cuando no lo hay. Son dos puntos de render.
//
// **Pero `VolcarDialog` sigue montándose UNA sola vez**, aquí. Montarlo en cada
// sitio dejaría dos `Dialog` de radix vivos y dos `useApi` de proyectos, y
// abrir uno no cerraría el otro. Por eso `volcando` subió al contexto: no por
// gusto de compartir estado, sino porque **se cumplió la condición que su
// propio comentario declaraba** — «hace falta desde fuera».
// ============================================================
import { cn } from "@/lib/utils";
import { useSeleccion } from "@/components/providers/seleccion-provider";
import { PanelSeleccion, type AnclajeSeleccion } from "./panel-seleccion";
import { VolcarDialog } from "./volcar-dialog";

export function SeleccionFlotante({
  anclaje = "flotante",
  /**
   * Si este punto de render monta el diálogo.
   *
   * `false` en el sidebar: su panel abre el MISMO diálogo, que vive en el punto
   * flotante. Sin esto habría dos.
   */
  conDialogo = true,
  /** Clases del envoltorio, para que el llamador decida a qué anchos aparece. */
  className,
}: {
  anclaje?: AnclajeSeleccion;
  conDialogo?: boolean;
  className?: string;
} = {}) {
  const seleccion = useSeleccion();

  // `hidratada` evita el parpadeo: el primer render (servidor y cliente) tiene
  // la Selección vacía porque `localStorage` se lee en un efecto. Sin esta
  // guarda la píldora aparecería medio segundo después de cargar la página,
  // saltando encima del contenido.
  if (!seleccion.hidratada) return null;

  const panel = (
    <PanelSeleccion
      anclaje={anclaje}
      items={seleccion.seleccion.items}
      abierto={seleccion.panelAbierto}
      onAlternarAbierto={() => seleccion.setPanelAbierto(!seleccion.panelAbierto)}
      onFijarCantidad={seleccion.fijarCantidad}
      onQuitar={seleccion.quitar}
      onVaciar={seleccion.vaciar}
      onVolcar={() => seleccion.setVolcando(true)}
    />
  );

  return (
    <>
      {/* El envoltorio solo existe si el llamador pidió clases: sin él, un
          `<div>` de más rompería el flujo del pie del sidebar.

          `min-h-0` NO es decoración y no lo decide el llamador. En el riel este
          `<div>` es un ítem de flex, y un ítem de flex sin `min-h-0` **no baja
          de la altura de su contenido**: medido, computaba 1 160 px dentro de
          un riel de 550, aplastando el `<nav>` a 0 px. Va aquí y no en el
          `className` de quien monta porque es una necesidad de este envoltorio,
          no una decisión de estilo de la pantalla que lo usa. */}
      {className ? <div className={cn("min-h-0", className)}>{panel}</div> : panel}
      {/*
        El diálogo se monta solo cuando hace falta. Montarlo siempre dispararía
        su `useApi` de proyectos en cuanto `open` fuera true, sí — pero también
        dejaría un `<Dialog>` de radix vivo en TODAS las pantallas de la app
        por el mero hecho de haber marcado un SKU.
      */}
      {conDialogo && seleccion.volcando && (
        <VolcarDialog
          open={seleccion.volcando}
          onOpenChange={seleccion.setVolcando}
          items={seleccion.seleccion.items}
          onVolcadoCompleto={seleccion.vaciar}
        />
      )}
    </>
  );
}
