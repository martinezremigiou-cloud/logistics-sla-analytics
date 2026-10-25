import { formatoFechaHora } from "@/lib/formato";
import { SnapshotVigenteBadge } from "@/components/shared/snapshot-vigente-badge";
import type { SkuSnapshotInfo } from "@/types/api";

export interface DashboardHeaderProps {
  /** Prefijo de email (antes de `@`) — `SesionUsuario` no trae un campo de nombre propio. */
  nombre: string;
  /** `null` mientras carga/error/cold-start: la línea de corte y el pill de frescura se omiten (no hay nada honesto que mostrar todavía). */
  snapshotStock: SkuSnapshotInfo | null;
  /**
   * [FIX-B1 · T3] `null` cuando aún no hay ingesta de aduana — la cláusula
   * "Embarques al …" se omite entera (no se inventa una fecha para un corte
   * que no existe). Independiente de `snapshotStock`: no se apaga ni se
   * enciende junto con él.
   */
  snapshotAduana: SkuSnapshotInfo | null;
}

/**
 * Header de `/` — SIEMPRE montado (eyebrow + saludo dependen solo de la
 * sesión, no del fetch de `/api/dashboard`): así el saludo aparece de
 * inmediato, sin esperar loading/error. La línea de corte + el pill de
 * frescura sí dependen de `snapshotStock` y se omiten mientras es `null`.
 *
 * [FIX-B1 · T3] LA LÍNEA CAMBIÓ DE FORMA, no sólo de texto. Decía
 * "Stock {periodo} · corte {fecha}" — un lector tenía que saber que "Stock"
 * es la fuente de INVENTARIO y adivinar que "aduana" (en otra tarjeta) era
 * la fuente de EMBARQUES, sin que el header lo dijera. Ahora dice
 * "Inventario al {fecha y hora} · Embarques al {fecha y hora}", con las DOS
 * fuentes nombradas por lo que SON, no por la tabla de la que salen —y con
 * hora, no sólo día: `formatoFechaHora` (no `formatoFechaDeTimestamp`) es
 * deliberado, para que "al mediodía" y "a las 11 de la noche" del mismo día
 * no se vean idénticos. `periodoActual` se retiró del componente: no
 * aportaba nada que la fecha del corte no dijera ya, y era el único motivo
 * por el que el header necesitaba `DashboardResponse.periodos` (`types/
 * api.ts` — no `DashboardQuery`, que es el schema de la QUERY STRING de
 * `GET /api/dashboard`, no de su respuesta).
 *
 * Pill de frescura: réplica del estilo de `FreshnessIndicator` (B4) en vez
 * de importarlo — ese componente hace su PROPIO fetch a `/api/health`, y el
 * Dashboard ya trae el snapshot vigente en la misma respuesta de
 * `/api/dashboard`; duplicar el fetch solo para un pill sería un segundo
 * roundtrip redundante. `FreshnessIndicator` sigue viviendo en el Topbar
 * (siempre visible) como el indicador global persistente. El pill en sí
 * es `<SnapshotVigenteBadge>` (`@/components/shared`, fix M6, ronda 2 de
 * revisor-codigo): este archivo era el ORIGINAL de ese markup — ahora las
 * 3 copias (aquí + `SnapshotFila` + `SnapshotIdentidadHeader`) consumen la
 * misma fuente.
 */
export function DashboardHeader({ nombre, snapshotStock, snapshotAduana }: DashboardHeaderProps) {
  return (
    <header className="flex flex-col gap-1.5">
      <span className="text-[12px] font-semibold uppercase tracking-[0.05em] text-brand">Resumen operativo</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink">Hola, {nombre}</h1>
          {snapshotStock && (
            <p className="text-[13.5px] text-muted-foreground">
              Inventario al {formatoFechaHora(snapshotStock.created_at)}
              {snapshotAduana && ` · Embarques al ${formatoFechaHora(snapshotAduana.created_at)}`}
            </p>
          )}
        </div>
        {snapshotStock && <SnapshotVigenteBadge />}
      </div>
    </header>
  );
}
