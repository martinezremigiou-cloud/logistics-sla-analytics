"use client";

// ============================================================
// [INV-B8 → 2.0.1-C] proyecto-exportar-botones.tsx — "Exportar Excel" de la
// pestaña Documento de `/proyectos/[id]`.
//
// Botón, NO ancla: ver la cabecera de `descargar-documento.ts` (que a su vez
// cita la del propio `route.ts` del servidor) para el porqué — un `<a href>`
// desnudo no puede distinguir un 200 binario de un 404/403 JSON.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-C · F-5] EL BOTÓN DE PDF SE FUE, y no es un recorte: es D-3.
//
// Este archivo vivía en el hero y exportaba Excel Y PDF, los dos con un
// `fetch` fresco. Con la previa mostrando el PDF real (F-6) y bajándolo sin
// un segundo GET (D-3, `proyecto-documento-previa.tsx`), dejar AQUÍ un
// «Exportar PDF» habría puesto DOS caminos al PDF en la misma pantalla — uno
// fresco y otro mostrado, que pueden diferir en el minuto de generación — y
// eso es exactamente lo que este repo gasta su presupuesto en evitar. La
// regla que quedó: en el panel de Documento hay UN solo camino al PDF, y es
// el mostrado. Excel no tiene ese conflicto — no hay «Excel mostrado» en
// ninguna parte — así que sigue siendo un `fetch` fresco bajo demanda, y
// sigue viviendo aquí en vez de escribirse a mano en la previa.
//
// Antes tomaba `formato: "xlsx" | "pdf"`; ahora solo existe el camino xlsx, y
// se quitó el parámetro en vez de dejarlo con una sola rama viva — un prop
// que solo admite un valor es peor que no tener prop.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-B · S-4] «Exportar Excel de {título}», no «Exportar {título} a Excel».
//
// El rótulo VISIBLE tiene que estar contenido en el nombre accesible (WCAG
// 2.5.3): si no, quien maneja el portal por voz lee «Exportar Excel» en la
// pantalla, lo dice, y no pasa nada — el control se llama otra cosa. Con el
// título al final, el rótulo queda como prefijo contiguo y el título sigue
// desambiguando entre proyectos.
// ============================================================
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { descargarDocumentoProyecto } from "./descargar-documento";

export interface ProyectoExportarBotonesProps {
  proyectoId: string;
  folio: string;
  titulo: string;
}

export function ProyectoExportarBotones({ proyectoId, folio, titulo }: ProyectoExportarBotonesProps) {
  const [generando, setGenerando] = useState(false);

  async function exportar() {
    setGenerando(true);
    try {
      const resultado = await descargarDocumentoProyecto(proyectoId, "xlsx", `${folio}.xlsx`);
      if (!resultado.ok) toast.error(resultado.mensaje);
    } finally {
      setGenerando(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full justify-center"
      onClick={() => void exportar()}
      disabled={generando}
      aria-label={`Exportar Excel de ${titulo}`}
    >
      <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
      {generando ? "Generando…" : "Exportar Excel"}
    </Button>
  );
}
