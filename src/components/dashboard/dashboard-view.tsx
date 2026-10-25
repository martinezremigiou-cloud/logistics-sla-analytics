"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks/use-api";
import { useSesion } from "@/components/providers/session-provider";
import { EstadoError, EstadoVacio } from "@/components/shared/estado-carga";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "./dashboard-header";
import { DashboardKpis } from "./dashboard-kpis";
import { DashboardHeatmapCard } from "./dashboard-heatmap";
import { DashboardRadarCard } from "./dashboard-radar";
import { DashboardTendenciaCard } from "./dashboard-tendencia";
import { DashboardRielEmbarques } from "./dashboard-pipeline";
import { DashboardReservasKamCard } from "./dashboard-reservas-kam";
import { DashboardTopSobreReservadosCard } from "./dashboard-top-sobre-reservados";
import { DashboardAccesosRapidosCard } from "./dashboard-accesos-rapidos";
import { DashboardSkeleton } from "./dashboard-skeleton";
import type { DashboardResponse } from "@/types/api";

/**
 * El encuadre: RIEL | CONTENIDO. [DASH-E · E-0]
 *
 * **72 px de pista y no 64**, que es lo que mide el bloque del riel: su anillo de
 * foco sobresale 4 px por lado (`ring-offset-2` + `ring-2`), y con la pista a 64 el
 * foco se recortaría contra el contenido. El número sale de esa suma, no de la
 * maqueta — el mockup no aporta medidas.
 *
 * **El corte es `lg` (1024) desde C-DASH·13, y antes era `md`.** El cambio se firmó
 * sobre una medición, y la razón vieja hay que corregirla en vez de borrarla,
 * porque decía lo contrario de lo que hoy hace este archivo:
 *
 * > *«El corte es `md` (768), el mismo con el que `app-shell.tsx:118` esconde el
 * > sidebar. Reusar ese corte es lo que evita el estado en el que el riel se acuesta
 * > mientras el sidebar sigue robando 230 px.»*
 *
 * **Ese razonamiento estaba invertido.** Con el corte en `md`, a 768 el riel se pone
 * en COLUMNA y el sidebar sigue robando sus 230 px, así que la columna de contenido
 * se queda con **387 px** — MEDIDO — y el mapa de calor entero se dibuja en 387 × 640.
 * Lo que había que evitar no era el riel acostado: era la columna estrangulada.
 *
 * **Medido moviendo el corte de verdad** (este archivo más las clases del riel),
 * construyendo y restaurando, no simulándolo:
 *
 * ```
 *   768    columna 387 → 489 px (+26 %)   y la columna se acorta 3 627 → 3 490
 *   900    columna 510 → 612 px (+20 %)
 *   1024   sin cambio: ahí el riel ya estaba al lado
 * ```
 *
 * **Y el costo, dicho:** acostado a 768 el riel tiene 489 px de caja y **se le salía
 * uno de los seis bloques**. Lo tapa la misma decisión que arregló los tres que se
 * perdían a 390 — el riel acostado va en **dos filas de tres** (`lg:hidden` sobre el
 * salto, en `dashboard-pipeline.tsx`), y 3 × 64 + 2 × 16 = 224 caben de sobra en 489.
 * **Una decisión, dos problemas.**
 */
const ENCUADRE = "grid grid-cols-1 gap-[22px] lg:grid-cols-[72px_1fr] lg:gap-x-[30px]";

/**
 * Las dos rejillas asimétricas del contenido. **Declaran su quiebre a mano**, y es
 * la diferencia que importa: `auto-fit` colapsa solo, una proporción fija NO lo
 * hereda. Sin el `grid-cols-1` de base, estas dos columnas se aplastarían en un
 * teléfono y hoy nada lo cazaría (M-11).
 */
const GRID_PERFIL = "grid grid-cols-1 gap-[22px] lg:grid-cols-[1fr_1.66fr]";
const GRID_RESERVAS = "grid grid-cols-1 gap-[22px] lg:grid-cols-[1.43fr_1fr]";

/**
 * Isla client de `/` (Dashboard analítico). UNA sola fuente de datos
 * (`GET /api/dashboard`); el header (eyebrow + saludo) depende solo de la
 * sesión y queda SIEMPRE montado — ver docstring de `DashboardHeader`. El
 * resto de la página (`cuerpo`) intercambia skeleton/error/vacío/real según
 * el estado de `useApi` (mismo espíritu C3 de `catalogo-view.tsx`, adaptado:
 * aquí no hay filtros que preservar, solo el saludo es independiente del
 * fetch).
 *
 * GATE ANTI-REMOUNT (ronda de revisión INV-B7B, docs/engineering/failure-patterns.md
 * (P3)): `error`/`!data` se resuelven ANTES que `loading` a secas —`useApi`
 * conserva `data` durante TODO el refetch (`loading=true` sin vaciarlo, ver
 * `use-api.ts:39`), así que la rama final de abajo nunca vuelve a mirar
 * `loading` para decidir SI pinta el cuerpo real, solo para marcarlo
 * `aria-busy` (mismo patrón que `CatalogoView`/`ConfigUsuarios`, ya
 * corregido ahí en su momento). Antes, `if (loading) cuerpo =
 * <DashboardSkeleton/>` a secas desmontaba TODO el cuerpo —KPIs, heatmap,
 * radar, pipeline, alertas— en cualquier refetch con datos ya en mano,
 * perdiendo scroll/foco de la página completa. Candado de regresión (test
 * de mutación) en `dashboard-view.antiremount.test.tsx`.
 *
 * Nota deliberada (spec F3): NO se pinta "Inventario por marca" del
 * blueprint — no tiene respaldo en `DashboardResponse`; el ángulo por marca
 * ya lo cubre el radar "Perfil por marca". Tampoco se pinta el selector
 * "4 sem/8 sem/12 sem" (solo hay pocos periodos reales hoy) ni un delta en la
 * card de Tendencia (política "solo honestos": el único KPI con delta real
 * es `piezas_en_camino`).
 */
export function DashboardView() {
  const sesion = useSesion();
  const { data, error, loading, refetch } = useApi<DashboardResponse>("/api/dashboard");

  const nombre = sesion.email.split("@")[0] || sesion.email;

  let cuerpo: ReactNode;

  if (error && !data) {
    cuerpo = <EstadoError mensaje={error.message} onRetry={refetch} />;
  } else if (!data) {
    // `loading && !data` (carga inicial) o defensivo (sin loading/error, `useApi` siempre trae `data`) — mismo esqueleto en ambos casos.
    cuerpo = <DashboardSkeleton />;
  } else if (data.snapshot.stock === null) {
    cuerpo = (
      <EstadoVacio
        titulo="Aún no hay datos de inventario cargados"
        descripcion="Cuando corra la primera ingesta, el panel aparecerá aquí."
        cta={
          <Button variant="outline" asChild>
            <Link href="/snapshots">Ir a Snapshots</Link>
          </Button>
        }
      />
    );
  } else {
    const d = data;
    cuerpo = (
      // `aria-busy` sube al TABLERO, no se queda en la columna de contenido: al
      // sacar el riel a su propia columna, dejarlo donde estaba lo habría dejado
      // fuera, y un refetch marcaría ocupado el tablero MENOS el riel (P24, la
      // media función). El candado anti-remount sigue funcionando igual: busca por
      // `closest("[aria-busy]")`, no por un nodo concreto.
      <div data-encuadre="tablero" className={ENCUADRE} aria-busy={loading}>
        {/* El riel va PRIMERO en el DOM: bajo `md` la rejilla cae a una columna y
            el orden del documento es el orden de lectura. Acostado arriba es donde
            un riel de proceso se lee sin estorbar al resto. */}
        <DashboardRielEmbarques pipeline={d.pipeline} grupos={d.pipeline_grupos} />

        <div data-encuadre="contenido" className="flex min-w-0 flex-col gap-[22px]">
          <DashboardKpis kpis={d.kpis} rol={sesion.rol} />

          {/* El mapa de calor pasa a ANCHO COMPLETO: es la única sección con dos
              ejes categóricos y un tope de 6 almacenes, así que compartir fila la
              obligaba a comprimir columnas que ya venían justas. */}
          <DashboardHeatmapCard heatmap={d.heatmap} />

          <div className={GRID_PERFIL}>
            <DashboardRadarCard radar={d.radar} />
            <DashboardTendenciaCard tendencia={d.tendencia} />
          </div>

          <div className={GRID_RESERVAS}>
            <DashboardReservasKamCard reservas={d.reservas_por_kam} />
            <DashboardTopSobreReservadosCard items={d.top_sobre_reservados} universo={d.kpis.sobre_reservados.valor} />
          </div>

          {/* [C-DASH·11] «Alertas» se retira por decision de producto, dada dos veces, y
              Accesos rapidos toma la fila entera — que es lo que desbloquea E-7.
              ANTES DE RETIRAR SE MIDIO donde queda cada uno de los seis, contra un
              corte real:

                sobre_reservado   conteo y puerta SOBREVIVEN  (KPI + tarjeta Top)
                sin_v2            conteo y puerta SOBREVIVEN  (KPI, mismo gate de rol)
                pendientes        conteo y puerta SOBREVIVEN  (KPI de pendientes)
                retrasado         el CONTEO sobrevive en el sub del KPI de piezas
                                  en camino; la PUERTA se pierde
                descuadre         el conteo se PIERDE; la puerta sobrevive (mismo
                                  href que pendientes)
                familia_movida    pierde las DOS. Es el mayor de los seis.

              O sea que la premisa «para eso tenemos la campana» es falsa —los dos
              conjuntos son disjuntos— pero el resultado es mejor que esa premisa:
              quien cubre a cuatro de los seis son los KPI de ESTA misma pantalla.
              Lo que se pierde de verdad esta en la deuda `DOS-FILTROS-VIVOS-SIN-PUERTA`
              y en `DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE`, y lo afirma una prueba. */}
          <DashboardAccesosRapidosCard />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-[22px]">
      <DashboardHeader nombre={nombre} snapshotStock={data?.snapshot.stock ?? null} snapshotAduana={data?.snapshot.aduana ?? null} />
      {cuerpo}
    </div>
  );
}
