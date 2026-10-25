"use client";

// ============================================================
// [INV-B9] campana.tsx — el icono del topbar y su cableado.
//
// EL BADGE Y EL PANEL CONTESTAN PREGUNTAS DISTINTAS, y por eso no se estorban:
//
//   badge  «¿qué hay NUEVO?»            → cuenta lo posterior a la marca de agua
//   panel  «¿qué pasó últimamente?»     → la ventana de 14 días, sin filtrar
//
// Abrir la campana mueve la marca —el badge se apaga— **y el panel sigue
// enseñando lo mismo**. Si el panel se filtrara por la marca, abrirlo lo
// dejaría en blanco en el mismo gesto: el usuario vería un «3», pulsaría, y no
// encontraría nada. Esa es la trampa que este reparto evita.
//
// SE REFRESCA AL VOLVER A LA PESTAÑA, sin polling. Es el mecanismo de
// `aviso-version-nueva.tsx`, el único precedente del repo, y hace falta por un
// hecho medido en la investigación 2.0: **sin esto, un número puesto en el
// badge queda CONGELADO desde que se monta `AppShell` hasta un reload
// completo** — porque `AppShell` no se remonta al navegar dentro de `(app)`.
//
// DEGRADACIÓN (P4): si `/api/campana` falla, la campana se pinta SIN badge y
// el panel lo dice. Nunca desaparece del topbar: un icono que se esfuma es
// indistinguible de un icono que nunca existió.
// ============================================================
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/hooks/use-api";
import { guardarPreferenciasFetch } from "@/components/seguimiento/seguimiento-api";
import { IconoCampana, PanelCampana } from "./panel-campana";
import type { CampanaResponse } from "@/types/avisos";

export function Campana() {
  const [abierta, setAbierta] = useState(false);
  const [nuevos, setNuevos] = useState(0);
  const { data, error, refetch } = useApi<CampanaResponse>("/api/campana");
  const contenedorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data) setNuevos(data.nuevos);
  }, [data]);

  // Volver a la pestaña vuelve a preguntar. Sin polling: la cadencia real de
  // cargas es de racimos —varias seguidas y luego silencio—, así
  // que un intervalo fijo sería ruido de red para nada.
  useEffect(() => {
    function alVolver() {
      if (document.visibilityState === "visible") refetch();
    }
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [refetch]);

  // Cerrar con Escape y con un clic fuera. Un panel que solo se cierra con su
  // propio botón atrapa a quien lo abrió sin querer.
  useEffect(() => {
    if (!abierta) return;
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierta(false);
    }
    function alClic(e: MouseEvent) {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierta(false);
    }
    document.addEventListener("keydown", alTeclear);
    document.addEventListener("mousedown", alClic);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.removeEventListener("mousedown", alClic);
    };
  }, [abierta]);

  function alternar() {
    const siguiente = !abierta;
    setAbierta(siguiente);
    if (siguiente && nuevos > 0) {
      // La marca de agua la estampa el SERVIDOR. El cliente solo pide moverla:
      // si propusiera el instante, podría silenciarse con una marca futura.
      setNuevos(0);
      void guardarPreferenciasFetch({ marcar_visto: true });
    }
  }

  return (
    <div className="relative" ref={contenedorRef}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierta}
        aria-haspopup="dialog"
        aria-label={nuevos > 0 ? `Avisos: ${nuevos} sin ver` : "Avisos"}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-ink-2 outline-none transition-colors hover:border-brand hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <IconoCampana nuevos={nuevos} />
      </button>

      {abierta && (
        <div
          role="dialog"
          aria-label="Avisos"
          className="absolute right-0 top-11 z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        >
          {data ? (
            <PanelCampana datos={data} />
          ) : (
            <p className="w-[min(92vw,384px)] px-3.5 py-4 text-[12.5px] text-ink-muted">
              {error ? "No se pudieron leer los avisos." : "Cargando avisos…"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
