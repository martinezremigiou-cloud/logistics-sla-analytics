"use client";

import { AlertTriangle, EyeOff, ShieldCheck } from "lucide-react";
import { useApi } from "@/lib/hooks/use-api";
import { EstadoError } from "@/components/shared/estado-carga";
import { Skeleton } from "@/components/ui/skeleton";
import { formatoFechaHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { autoriaIncompleta, pideAtencion, type EstadoGobierno } from "@/lib/marcas/gobierno";

/**
 * [VERT-B2] Gobierno de la regla de exclusión del catálogo.
 *
 * Dos cosas, y las dos existen porque la 0039 declaró que no podía cubrirlas
 * desde donde estaba (su `RAISE NOTICE` final):
 *
 *   1. QUIÉN excluyó qué, cuándo y por qué. El dato lo vuelve obligatorio un
 *      CHECK desde la migración; hasta este panel no lo leía ninguna pantalla.
 *   2. LA ALARMA de marca nueva. El ETL da de alta marcas SOLO y
 *      `resolver_pendiente` también: el universo del catálogo puede crecer sin
 *      que nadie lo decida, y con una regla definida POR MARCA eso es lo que
 *      hay que vigilar.
 *
 * ESTE PANEL NO ESCRIBE, y es una decisión con su razón: encender o apagar la
 * regla con autoría de verdad pide una RPC que saque el actor del JWT (el molde
 * de `aplicar_override`/`aplicar_metadata`), no un UPDATE cuyo `excluida_por`
 * teclee el cliente. Eso es una migración nueva y va con firma aparte. Mientras
 * tanto la regla se cambia donde ya se cambiaba, y aquí SE VE.
 *
 * TODO LO QUE DECIDE VIVE FUERA, en `@/lib/marcas/gobierno` — puro y probado
 * sin base, incluido el cotejo del centinela contra la propia migración. Aquí
 * sólo se pinta.
 */
/**
 * ¿La respuesta tiene la forma que este panel sabe leer?
 *
 * ⚠ NO es un lector tolerante (P12): no rellena huecos ni inventa ceros. Es lo
 * contrario — separa «no se pudo leer» de «no hay nada», que en esta pantalla
 * son estados opuestos: «ninguna marca excluida» y «no sé qué hay excluido» se
 * verían igual si un payload raro se leyera como vacío.
 *
 * Y existe porque una prueba lo encontró: sin esto, un cuerpo inesperado hacía
 * que el componente LANZARA y se llevara la pestaña entera. Una pantalla de
 * gobierno que desaparece es peor que una que dice que no pudo mirar.
 */
function tieneFormaDeEstado(d: unknown): d is EstadoGobierno {
  if (d === null || typeof d !== "object") return false;
  const e = d as Partial<EstadoGobierno>;
  return Array.isArray(e.excluidas) && Array.isArray(e.sinDecidir) && typeof e.total === "number";
}

export function ConfigMarcas() {
  const { data: crudo, error, loading, refetch } = useApi<unknown>("/api/marcas");
  const data = tieneFormaDeEstado(crudo) ? crudo : null;
  const formaRara = crudo !== null && data === null;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[13.5px] font-semibold text-ink">Marcas excluidas del catálogo</h2>
        <p className="text-[12px] leading-snug text-ink-2">
          La exclusión es un <strong className="font-semibold text-ink">dato</strong>, no código: el inventario entra
          completo por la ingesta y sigue en la base — lo que se excluye es la vista del catálogo, y se enciende o se
          apaga sin desplegar.
        </p>
      </div>

      {/* GATE ANTI-REMOUNT, forma canónica de la casa: el error sólo sustituye
          al contenido cuando NO hay dato previo; un refetch fallido no desmonta
          lo que ya se está leyendo. */}
      {loading && !data && !formaRara && <Skeleton className="h-32 w-full" />}
      {error && !data && <EstadoError mensaje={error.message} onRetry={refetch} />}
      {formaRara && !error && (
        <EstadoError
          mensaje="La respuesta de /api/marcas no tiene la forma esperada. No se puede decir qué hay excluido — y eso NO es lo mismo que «no hay nada excluido»."
          onRetry={refetch}
        />
      )}

      {data && (
        <div className="flex flex-col gap-4" aria-busy={loading}>
          <PanelExcluidas estado={data} />
          <PanelAlarma estado={data} />
        </div>
      )}
    </div>
  );
}

function PanelExcluidas({ estado }: { estado: EstadoGobierno }) {
  if (estado.excluidas.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-2">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        {/* El denominador SIEMPRE a la vista: «ninguna excluida» sin decir de
            cuántas es una afirmación sin universo. */}
        <span>
          Ninguna marca está excluida. El catálogo muestra las {estado.total} marcas del vocabulario.
        </span>
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {estado.excluidas.map((m) => (
        <li key={m.nombre} className="flex flex-col gap-1 rounded-[10px] bg-surface-3 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <EyeOff className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="font-mono text-[12.5px] font-semibold text-ink">{m.nombre}</span>
            <span className="text-[11.5px] text-ink-muted">
              {/* Se distingue una decisión HUMANA de un hueco: si el CHECK está
                  puesto, una excluida NUNCA puede venir sin autoría — así que un
                  «—» aquí no sería un campo vacío, sería un síntoma, y se dice. */}
              {autoriaIncompleta(m) ? (
                <span className="font-semibold text-warn">
                  sin autoría registrada — la restricción de la base lo vuelve imposible, revísalo
                </span>
              ) : (
                <>
                  {m.por} · {formatoFechaHora(m.en)}
                </>
              )}
            </span>
          </div>
          {m.motivo && <p className="text-[12px] leading-snug text-ink-2">{m.motivo}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * LA ALARMA. Suena cuando una marca nació DESPUÉS de la regla y nadie ha
 * decidido nada sobre ella.
 *
 * Nace en CERO por construcción —la 0039 le puso un centinela a las marcas que
 * ya existían, porque «una alarma que suena siempre es una alarma apagada»— y
 * eso está probado en `gobierno.test.ts`.
 */
function PanelAlarma({ estado }: { estado: EstadoGobierno }) {
  const alerta = pideAtencion(estado);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[12.5px] font-semibold text-ink">Marcas nuevas sin decisión</h3>
        <span
          aria-label={`${estado.sinDecidir.length} marcas nuevas sin decisión`}
          className={cn(
            "inline-flex h-6 min-w-[24px] items-center justify-center rounded-full px-2 font-mono text-[12px] font-bold",
            alerta ? "bg-warn-bg text-warn" : "bg-surface-3 text-ink-muted",
          )}
        >
          {estado.sinDecidir.length}
        </span>
      </div>

      <p
        className={cn(
          "flex items-start gap-1.5 text-[12px] leading-snug",
          alerta ? "rounded-md bg-warn-bg px-2.5 py-1.5 text-warn" : "text-ink-2",
        )}
      >
        {alerta ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
        )}
        <span>
          {alerta
            ? "Entraron solas por la ingesta y nadie ha decidido si se listan o no. Mientras tanto SÍ se listan, por omisión."
            : "Ninguna. Una marca nueva entra sola en la ingesta, sin avisar a nadie: esta cuenta es lo que lo hace visible."}
        </span>
      </p>

      {estado.sinDecidir.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {estado.sinDecidir.map((m) => (
            <li
              key={m.nombre}
              className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-2.5 py-1 text-[11.5px] font-semibold text-warn"
            >
              <span className="font-mono">{m.nombre}</span>
              <span className="font-normal">{formatoFechaHora(m.creadaEn)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
