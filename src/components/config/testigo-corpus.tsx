"use client";

// ============================================================
// [INV-B11] O7 · EL TESTIGO DE FRESCURA, en pantalla.
//
// El brief lo pidió así: *«Corpus indexado: N documentos · última
// actualización …»*, y va en **«Acerca de la app»** porque es donde ya se
// explica de dónde salen los datos y que la fecha de corte no es tiempo real.
// Un testigo de frescura lejos de esa explicación se lee como una cifra suelta.
//
// TODO LO QUE DECIDE VIVE FUERA. Este componente pide, espera y pinta; qué
// significan los dos instantes lo decide `src/lib/corpus/frescura.ts`, que es
// puro y está probado sin base — porque ahí es donde se distinguen los dos
// silencios («no corrió» contra «corrió y no había nada»), y eso es lo que
// tiene que poder probarse.
//
// LOS TRES ESTADOS DE CARGA SE DICEN, y ninguno se calla:
//
//   cargando   una raya en gris, no un hueco que parece que no hay corpus
//   fallo      se dice que no se pudo leer — NO se pinta «0 documentos», que
//              sería inventar un hecho a partir de un error (P12)
//   listo      la frase
// ============================================================
import { useEffect, useState } from "react";
import { AlertTriangle, Database } from "lucide-react";
import { estadoDe, textoDe, pideAtencion, type DatosFrescura } from "@/lib/corpus/frescura";

type Estado = { fase: "cargando" } | { fase: "fallo" } | { fase: "listo"; datos: DatosFrescura };

export function TestigoCorpus({
  /** Sembrado para la evidencia visual y las pruebas. No es superficie de producción. */
  inicial,
}: {
  inicial?: Estado;
} = {}) {
  const [estado, setEstado] = useState<Estado>(inicial ?? { fase: "cargando" });

  useEffect(() => {
    if (inicial) return; // sembrado: manda quien sembró
    let vivo = true;
    fetch("/api/corpus/frescura")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: DatosFrescura) => vivo && setEstado({ fase: "listo", datos: d }))
      .catch(() => vivo && setEstado({ fase: "fallo" }));
    return () => {
      vivo = false;
    };
  }, [inicial]);

  if (estado.fase === "cargando") {
    return <p className="text-[12px] text-ink-muted">Consultando el estado de la documentación…</p>;
  }

  if (estado.fase === "fallo") {
    // NO se pinta «0 documentos». Un fallo de lectura no es un corpus vacío, y
    // convertir uno en otro es exactamente el lector tolerante de P12.
    return <p className="text-[12px] text-ink-muted">No se pudo consultar el estado de la documentación.</p>;
  }

  const e = estadoDe(estado.datos);
  const alerta = pideAtencion(e);

  return (
    <p
      className={
        alerta
          ? "flex items-start gap-1.5 rounded-md bg-warn-bg px-2.5 py-1.5 text-[12px] leading-snug text-warn"
          : "flex items-start gap-1.5 text-[12px] leading-snug text-ink-2"
      }
    >
      {alerta ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      )}
      <span className="min-w-0">{textoDe(e, new Date())}</span>
    </p>
  );
}
