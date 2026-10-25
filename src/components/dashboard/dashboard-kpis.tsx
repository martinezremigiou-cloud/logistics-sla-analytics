import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Boxes, ClipboardList, Minus, PackageCheck, Ship, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatoNumero, formatoPeriodoCorto } from "@/lib/formato";
import { SIN_TECNOLOGIA } from "@/lib/clasificacion";
import { MUESTRA_CLASIFICACION_V2, MUESTRA_PREGUNTAS_POR_RESOLVER } from "@/lib/roles";
import type { DashboardKpis as DashboardKpisContrato, KpiDelta } from "@/types/api";
import type { Rol } from "@/types/enums";

export interface DashboardKpisProps {
  kpis: DashboardKpisContrato;
  rol: Rol;
}

/** Chip de delta — SIEMPRE tono neutro/info (nunca verde/rojo): es dirección informativa frente a un periodo base, no un juicio de "bueno/malo". Único KPI con delta no-nulo en v1 (política "solo honestos" de dashboard.service.ts). `pct` (INFO-pct, ronda post-revisión de B6) se pinta entre paréntesis solo cuando no es `null` (base=0 → sin porcentaje honesto). */
function DeltaChip({ delta }: { delta: KpiDelta }) {
  const Icon: LucideIcon = delta.direccion === "sube" ? ArrowUp : delta.direccion === "baja" ? ArrowDown : Minus;
  const signo = delta.direccion === "sube" ? "+" : delta.direccion === "baja" ? "−" : "";
  return (
    // Sin `whitespace-nowrap`: este chip es el elemento más largo de la tarjeta
    // —signo, cifra, porcentaje y periodo base— y era el único que no podía partir
    // línea. A poco ancho eso no lo encogía a él: empujaba fuera a la CIFRA, que es
    // lo único que la tarjeta promete. La política es al revés: si no cabe, la
    // tarjeta crece en alto; la cifra nunca se trunca.
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[7px] bg-info-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-info">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {signo}
      {formatoNumero(Math.abs(delta.valor))}
      {delta.pct !== null && ` (${signo}${Math.abs(delta.pct).toFixed(1)}%)`}
      {" vs "}
      {formatoPeriodoCorto(delta.periodo_base)}
    </span>
  );
}

/**
 * `sin_tecnologia.valor - sin_v2.valor`, recortado a 0. NACIÓ para el resto
 * de la desambiguación de `SubClasificacion` (SKUs con fila en
 * `clasificacion_v2` pero sin tecnología poblada). Hoy NO ALIMENTA NINGÚN
 * render: su único consumidor es su propia prueba (`dashboard-kpis.test.tsx`).
 *
 * Historia, en pasado porque ya no describe el código de al lado:
 *   · En la ronda de revisión INV-B7B (punto B) se sacó del render porque la
 *     resta DEPENDÍA de una invariante que vivía en OTRO módulo: `sin_v2` ⊆
 *     `sin_tecnologia`, mientras las dos cifras contaban la misma capa v2 en
 *     `dashboard.service.ts`. Si esa invariante se rompía ahí, el componente
 *     habría pintado un número NEGATIVO; de ahí el `Math.max` (y no un `if`)
 *     y la prueba aislada del recorte.
 *   · En CAT-ITER-1 · O-2b ESA INVARIANTE QUEDÓ DEROGADA, por decisión y no
 *     por defecto: `sin_tecnologia` pasó a contar la BANDEJA de pendientes, y
 *     la contención se rompe para una parte de los sin fila v2 (ver el comentario
 *     «[CAT-ITER-1 · O-2b] EL UNIVERSO DE ESTE KPI SE ACORDO» en
 *     `dashboard.service.ts`, y el `it.skip` «[RETIRADO · O-2b] invariante
 *     sin_v2 ⊆ sin_tecnologia — DEROGADO…» en `dashboard.service.test.ts`).
 *     Restar dos conjuntos que se solapan en parte da un número sin población
 *     detrás, así que O-2b la sacó del párrafo de desambiguación.
 *   · En FIX-B1 · T3 ese párrafo se retiró entero.
 *
 * Este comentario tuvo dos frases falsas (P35), y se dicen para que no
 * vuelvan: afirmaba la invariante en PRESENTE cuando ya estaba derogada, y
 * mandaba a «ver el motivo abajo» para explicar por qué no se borra — un
 * motivo que vivía en un comentario DENTRO de `SubClasificacion` y que
 * FIX-B1 · T3 se llevó con el párrafo.
 *
 * EL MOTIVO, puesto aquí donde el render ya no se lo puede llevar: NO SE
 * BORRA porque lo que caducó es su USO, no su aritmética
 * (la decisión que la dejó sin uso no cambia la resta).
 * Y si esa tercera población vuelve a hacer falta, lo que se escribe NO es
 * esta resta: es una cuenta DIRECTA en `dashboard.service.ts`, en el mismo
 * recorrido que `sin_v2`, como pide la limitación `B7B-10` de
 * `docs/known-limitations.md` — que se anotó así cuando la invariante todavía
 * se sostenía, y con más razón ahora que no.
 */
export function conFilaSinTecnologia(kpis: DashboardKpisContrato): number {
  return Math.max(0, kpis.sin_tecnologia.valor - kpis.sin_v2.valor);
}

/**
 * Sub de "SKUs en catálogo". Dos señales INDEPENDIENTES, cada una con su
 * propio permiso, y ninguna de las dos se suma con la otra:
 *
 *   - `sin_v2` ("sin fila en clasificación v2"): vocabulario técnico de la
 *     capa v2 — decisión de producto [MVP-2 · frente E], Admin lo conserva y
 *     KAM/Visitante/Soporte dejan de verlo (`MUESTRA_CLASIFICACION_V2`).
 *   - Las "preguntas de tecnología por resolver" (`MUESTRA_PREGUNTAS_POR_RESOLVER`,
 *     `@/lib/roles`): DOS renglones nuevos [FIX-B1 · T3].
 *
 * 🔴 POR QUÉ ESTOS DOS RENGLONES SON ADMIN-ONLY Y NO SÓLO "SIN LINK PARA
 * KAM" COMO ANTES: la vieja versión de esta tarjeta le mostraba a TODOS los
 * roles un enlace "{sin_tecnologia} sin tecnología asignada" — y
 * `sin_tecnologia` sale de la RPC `contar_pendientes()` (0009), que sólo
 * cuenta para `admin` (dato del eje 1, `is_admin()`). Un KAM veía siempre
 * "0 sin tecnología asignada", que no es el universo vacío (P17): es un 0
 * FABRICADO por el permiso, servido como si fuera el dato real. La
 * corrección no es calcular una cifra alternativa para KAM — es ocultar la
 * superficie entera donde la RPC no le cuenta la verdad, tal como decide
 * `MUESTRA_PREGUNTAS_POR_RESOLVER`.
 *
 * Los DOS renglones, cuando se muestran:
 *   - "{productos_sin_tecnologia} productos sin tecnología →", con
 *     `contarSinTecnologia` (`derivaciones.ts`) — la MISMA función que
 *     `CatalogoFacetas.sin_tecnologia`, así que esta cifra SÍ es honesta
 *     para cualquier rol que la vea (no depende de la RPC).
 *   - "{sin_tecnologia} preguntas de tecnología por resolver →", la bandeja
 *     de pendientes abiertos de tipo `sku_sin_tecnologia` — trabajo por
 *     HACER, no productos. Antes se llamaba (mal) "sin tecnología
 *     asignada", nombre que un KAM leía como si describiera productos y no
 *     una cola de trabajo administrativo.
 *
 * Ningún número se hardcodea: las tres salen de `kpis` vía `formatoNumero`
 * (patrones P2/P7, `docs/engineering/failure-patterns.md`).
 */
function SubClasificacion({ kpis, rol }: { kpis: DashboardKpisContrato; rol: Rol }) {
  const muestraV2 = MUESTRA_CLASIFICACION_V2[rol];
  const muestraPreguntas = MUESTRA_PREGUNTAS_POR_RESOLVER[rol];
  const claseLink = "block rounded-sm text-info outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand";

  if (!muestraV2 && !muestraPreguntas) return null;

  return (
    <div className="flex flex-col gap-1">
      {muestraV2 && (
        <Link href="/catalogo?sinV2=1" className={claseLink}>
          {formatoNumero(kpis.sin_v2.valor)} sin fila en clasificación v2
        </Link>
      )}
      {muestraPreguntas && (
        <>
          {/* Mismo sentinel que consume `/catalogo` de verdad (lib/clasificacion.ts) — nunca un query param nuevo. */}
          <Link href={`/catalogo?tecnologia=${SIN_TECNOLOGIA}`} className={claseLink}>
            {formatoNumero(kpis.productos_sin_tecnologia.valor)} productos sin tecnología →
          </Link>
          <Link href="/config?tab=pendientes" className={claseLink}>
            {formatoNumero(kpis.sin_tecnologia.valor)} preguntas de tecnología por resolver →
          </Link>
        </>
      )}
    </div>
  );
}

/**
 * Sub de "Piezas disponibles" (MVP-CIERRE · F5). Mismo molde que
 * `SubClasificacion`: dos conceptos confundibles, cada uno rotulado, y una
 * línea que desambigua en vez de dejar que el lector los sume o los reste
 * de cabeza.
 *
 * QUÉ ARREGLA. La tarjeta decía "N piezas disponibles · M SKU con
 * existencia": el conteo usaba un denominador (`disponible > 0`) y la suma
 * usaba otro (el NETO, con los sobre-reservados restando). No estaba mal
 * calculado — **contaba una cosa y sumaba otra**. Y los sobre-reservados,
 * que son un dato de negocio y no ruido, no tenían superficie en ningún
 * lado de la tarjeta.
 *
 * Ahora los dos números grandes comparten denominador (positivos), el neto
 * sigue disponible pero ROTULADO como lo que es, y los sobre-reservados
 * tienen su enlace. Ningún número se hardcodea: los cuatro salen de `kpis`
 * (patrón P2).
 *
 * Se ocultan las dos líneas extra cuando no hay sobre-reservados: ahí el
 * neto y el disponible son idénticos y repetirlos sería ruido que sugiere
 * una distinción inexistente.
 */
function SubDisponibles({ kpis }: { kpis: DashboardKpisContrato }) {
  const skus = kpis.skus_disponibles.valor;
  const sobreReservados = kpis.sobre_reservados.valor;
  const piezasSobre = Math.abs(kpis.piezas_sobre_reservadas.valor);
  const neto = kpis.piezas_disponibles_neto.valor;

  if (sobreReservados === 0) {
    return <>{formatoNumero(skus)} SKUs con disponible</>;
  }

  return (
    <>
      <div>{formatoNumero(skus)} SKUs con disponible</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
        {/* Mismo drill-down que ya consume la alerta homónima (dashboard.service.ts) — nunca un query param nuevo. */}
        <Link
          href="/catalogo?badge=sobre_reservado"
          className="rounded-sm text-info outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
        >
          {formatoNumero(sobreReservados)} SKUs sobre-reservados (−{formatoNumero(piezasSobre)} pz)
        </Link>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug">
        Un SKU sobre-reservado aporta cero, no un negativo: por eso no se restan arriba.
        Neto con sobre-reservas: {formatoNumero(neto)}.
      </p>
    </>
  );
}

interface KpiCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  iconClass: string;
  sub: ReactNode;
  delta?: KpiDelta | null;
}

function KpiCard({ label, value, icon: Icon, iconClass, sub, delta }: KpiCardProps) {
  return (
    <div className="rounded-[15px] border border-line bg-surface p-[18px] shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-ink-muted">{label}</span>
        <span className={cn("flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px]", iconClass)}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-3.5 flex flex-wrap items-end justify-between gap-2">
        <span className="font-mono text-[28px] font-bold leading-none tracking-tight text-ink">{formatoNumero(value)}</span>
        {delta && <DeltaChip delta={delta} />}
      </div>
      <div className="mt-1.5 text-[12.5px] font-medium text-ink-muted">{sub}</div>
    </div>
  );
}

/**
 * Fila de KPIs. **4 tarjetas para quien ve `MUESTRA_PREGUNTAS_POR_RESOLVER`
 * (hoy sólo `admin`), 3 para el resto** [FIX-B1 · T3]: la tarjeta
 * «Pendientes de datos» se OCULTA por rol —nunca se pinta en cero— porque su
 * cifra sale de una RPC que sólo cuenta para `admin` (ver `roles.ts`). El
 * grid `auto-fit` (como en el blueprint) reparte 3 o 4 columnas sin
 * ajuste manual; gap 22 px ratificado para todas las filas del Dashboard.
 *
 * Composición: **4 valores-cabecera** (`catalogo_total`, `piezas_disponibles`,
 * `piezas_en_camino` —el único con delta— y `pendientes`, esta última sólo si
 * el rol la ve) y el resto como «sub» de esas mismas tarjetas (`sin_v2` y las
 * dos preguntas de tecnología, las tres condicionadas por rol dentro de
 * `SubClasificacion`; `skus_disponibles`, `sobre_reservados`,
 * `piezas_sobre_reservadas`, `piezas_disponibles_neto`, `retrasados`).
 */
export function DashboardKpis({ kpis, rol }: DashboardKpisProps) {
  const muestraPreguntas = MUESTRA_PREGUNTAS_POR_RESOLVER[rol];
  return (
    <div className="grid gap-[22px] [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      <KpiCard
        label="SKUs en catálogo"
        value={kpis.catalogo_total.valor}
        icon={Boxes}
        iconClass="bg-info-bg text-info"
        sub={<SubClasificacion kpis={kpis} rol={rol} />}
      />
      <KpiCard
        label="Piezas disponibles"
        value={kpis.piezas_disponibles.valor}
        icon={PackageCheck}
        iconClass="bg-success-bg text-success"
        sub={<SubDisponibles kpis={kpis} />}
      />
      <KpiCard
        label="En camino"
        value={kpis.piezas_en_camino.valor}
        icon={Ship}
        iconClass="bg-warn-bg text-warn"
        sub={`${formatoNumero(kpis.retrasados.valor)} con retraso`}
        delta={kpis.piezas_en_camino.delta}
      />
      {muestraPreguntas && (
        <KpiCard
          label="Pendientes de datos"
          value={kpis.pendientes.valor}
          icon={ClipboardList}
          iconClass="bg-info-bg text-info"
          sub={
            <Link
              href="/config?tab=pendientes"
              className="rounded-sm text-info outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
            >
              Resolver en Configuración →
            </Link>
          }
        />
      )}
    </div>
  );
}
