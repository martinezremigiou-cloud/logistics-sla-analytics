"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { formatoFechaHoraCorta } from "@/lib/formato";

// Tipos locales mínimos (espejo de HealthResponse) — se evita importar de
// src/services/** / src/types/api.ts a propósito: esos archivos los está
// tocando otra fase EN PARALELO.
interface HealthFuenteLocal {
  created_at: string;
}
interface HealthResponseLocal {
  estado: "ok" | "degradado";
  fuentes: { stock: HealthFuenteLocal | null; aduana: HealthFuenteLocal | null };
}

type EstadoIndicador =
  | { fase: "cargando" }
  | { fase: "error" }
  | { fase: "listo"; texto: string; tono: "ok" | "degradado" };

/**
 * (MVP-CIERRE F6) Delega en el helper compartido, pineado a zona México.
 *
 * Antes construía su PROPIO `Intl.DateTimeFormat` sin `timeZone`: renderizaba
 * en la zona del runtime, así que el mismo corte se veía un día aquí y el siguiente
 * en el Dashboard (que además usaba el helper equivocado). Un formateador
 * suelto por componente es justo lo que hace imposible tener una sola verdad
 * temporal.
 *
 * Se conserva el `try/catch`: este texto lo alimenta `/api/health` y un ISO
 * malformado no debe tumbar el indicador del shell.
 */
function formatearFecha(iso: string): string {
  try {
    return formatoFechaHoraCorta(iso);
  } catch {
    return iso;
  }
}

export function FreshnessIndicator() {
  const [estado, setEstado] = useState<EstadoIndicador>({ fase: "cargando" });

  useEffect(() => {
    const controller = new AbortController();

    async function cargar() {
      try {
        const res = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
        if (!res.ok) {
          setEstado({ fase: "error" });
          return;
        }
        const body = (await res.json()) as HealthResponseLocal;
        const creado = body.fuentes.stock?.created_at;
        setEstado({
          fase: "listo",
          texto: creado ? `Datos al ${formatearFecha(creado)}` : "Sin snapshot de stock",
          tono: body.estado,
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setEstado({ fase: "error" });
      }
    }

    cargar();
    return () => controller.abort();
  }, []);

  const pillClass = "inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-input px-3 py-1.5 text-[12.5px] text-ink-2";

  if (estado.fase === "cargando") {
    return (
      <span role="status" aria-live="polite" className={cn(pillClass, "text-ink-muted")}>
        Consultando frescura…
      </span>
    );
  }

  if (estado.fase === "error") {
    return (
      <span role="status" aria-live="polite" className={cn(pillClass, "text-ink-muted")}>
        Sin conexión a datos
      </span>
    );
  }

  return (
    <span role="status" aria-live="polite" className={pillClass}>
      <span aria-hidden="true" className={cn("h-[7px] w-[7px] shrink-0 rounded-full", estado.tono === "ok" ? "bg-success" : "bg-warn")} />
      {estado.texto}
    </span>
  );
}
