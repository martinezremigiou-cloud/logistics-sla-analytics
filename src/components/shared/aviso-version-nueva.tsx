"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NOMBRE_PRODUCTO } from "@/config/producto";

interface VersionResponse {
  deploymentId: string;
  skewProtection: boolean;
}

/**
 * [INV-B7B] O12 · Skew protection — el aviso.
 *
 * Consulta `/api/version` SOLO cuando la pestaña vuelve a estar
 * visible (`visibilitychange`, nunca polling agresivo — ni
 * `setInterval` ni fetch al montar) y compara `deploymentId` (lo que
 * el servidor sirve AHORA, en runtime) contra
 * `process.env.NEXT_PUBLIC_DEPLOY_ID` (lo que quedó HORNEADO en este
 * bundle del navegador desde que cargó la página, ver
 * `next.config.mjs`). Si difieren, el servidor ya avanzó a un
 * deployment más nuevo que el que esta pestaña tiene cargado.
 *
 * El banner es PERSISTENTE y la recarga es SIEMPRE manual (clic del
 * usuario) — jamás automática. Recargar solo le arrancaría al usuario
 * lo que estaba escribiendo o viendo en ese momento: es exactamente
 * el bug que costó FIX-RESET (ver `docs/engineering/failure-patterns.md` (P3) —
 * "estado que cambia entre dos lecturas"). Una vez detectada la
 * versión nueva, se deja de consultar (no hay nada más que preguntar
 * hasta que el usuario recargue).
 *
 * Degradación (P4, silencio + log): si `/api/version` falla (red,
 * 5xx, JSON roto) NUNCA se muestra el banner por un falso positivo —
 * solo `console.warn`, la navegación normal sigue intacta. En
 * desarrollo ambos lados del contrato valen 'dev' (ver
 * `next.config.mjs` y `/api/version`) ⇒ el aviso nunca dispara ahí,
 * por diseño.
 *
 * Guardarraíl (ronda 2, punto D) — SUPUESTO NO CONFIRMADO, documentado
 * como tal: se asume que `VERCEL_DEPLOYMENT_ID` existe en el entorno de
 * BUILD de este proyecto en Vercel (de ahí sale `NEXT_PUBLIC_DEPLOY_ID`,
 * horneado por `next.config.mjs`). Si esa variable faltara SOLO en
 * build (y sí existiera en runtime, que es de donde lee `/api/version`),
 * `idHorneado` quedaría fijo en `'dev'` para SIEMPRE en producción,
 * mientras `deploymentId` sí cambiaría con cada deployment real — la
 * comparación de abajo nunca volvería a coincidir, y el banner "hay una
 * versión nueva" se quedaría pegado en pantalla PERMANENTEMENTE. Un
 * aviso que nunca se va es peor que no tener aviso: por eso `'dev'`
 * nunca compara, pase lo que pase del lado del servidor.
 */
export function AvisoVersionNueva() {
  const [hayVersionNueva, setHayVersionNueva] = useState(false);
  // Evita seguir consultando una vez que ya se detectó el desfase: no hay
  // nada más que preguntar hasta que el usuario recargue (no es un ref de
  // render, es un candado de "ya no vuelvas a hacer fetch").
  const yaDetectadaRef = useRef(false);

  useEffect(() => {
    async function verificar() {
      if (yaDetectadaRef.current) return;

      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return; // degradación silenciosa (P4): un 5xx no es un bug de la app

        const body = (await res.json()) as VersionResponse;
        const idHorneado = process.env.NEXT_PUBLIC_DEPLOY_ID ?? "dev";

        // Guardarraíl (ver el comentario del componente, arriba): 'dev'
        // nunca compara. Sin esto, si `NEXT_PUBLIC_DEPLOY_ID` quedara en
        // 'dev' por falta de `VERCEL_DEPLOYMENT_ID` en tiempo de build
        // (supuesto no confirmado), el banner se mostraría para siempre
        // en producción en cuanto `deploymentId` trajera cualquier id real.
        if (idHorneado === "dev") return;

        if (body.deploymentId !== idHorneado) {
          yaDetectadaRef.current = true;
          setHayVersionNueva(true);
        }
      } catch (e) {
        // Fallo de red u otro imprevisto: silencio + warn (P4, degradación
        // declarada) — nunca debe romper la navegación normal del usuario.
        console.warn("[aviso-version-nueva] no se pudo verificar la versión", e);
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void verificar();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  if (!hayVersionNueva) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-b border-line bg-brand px-4 py-2.5 text-center text-[13px] font-medium text-white"
    >
      <span>Hay una versión nueva de {NOMBRE_PRODUCTO}.</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-7 gap-1.5 px-3 text-[12.5px]"
        onClick={() => window.location.reload()}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Recargar
      </Button>
    </div>
  );
}
