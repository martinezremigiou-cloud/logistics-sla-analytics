import Link from "next/link";
import { Database, Layers, Truck, Workflow, GitBranch, Clock, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface AccesoRapido {
  label: string;
  href: string;
  icon: LucideIcon;
  tintClass: string;
}

/**
 * Los destinos. **Seis desde C-DASH·12, y los dos últimos no son un añadido: son una
 * reparación.**
 *
 * Al retirar Alertas (C-DASH·11) se midió, con un grep por el repo entero, que esa
 * tarjeta era el **único** sitio que emitía `/catalogo?divergencia=1` y
 * `/embarques?retrasado=1`. Los dos filtros siguen VIVOS —los leen
 * `catalogo-view.tsx:98` y `cruce-view.tsx:41`, cada uno con su chip— así que lo que
 * se perdió al retirar la tarjeta no fue la función: fue el clic. El bloque autorizó
 * exactamente esto: *«los `href` que sean el único acceso a una vista se preservan en
 * Accesos rápidos o se declara que se pierden»*.
 *
 * **Y lo que NO vuelve son los CONTEOS.** Se retiró Alertas porque *«no nos
 * sirve»*; devolver aquí el conteo de familias divergentes y el de descuadres sería
 * reconstruir esa tarjeta con otro nombre, y eso no es una decisión de la cadena.
 * Aquí hay PUERTAS, no avisos — el componente sigue sin recibir props, que es la
 * forma de que no pueda pintar una cifra aunque alguien quiera. La deuda
 * `DOS-CONTEOS-GLOBALES-SIN-SUPERFICIE` sigue abierta con su disparador.
 *
 * **El copy de los dos nuevos nombra el HECHO, no la capa** — la misma regla que
 * 2.0.1-A·D3 aplicó al retirar «clasificación v2» de la vista de un KAM: quien lee
 * «Familias distintas al archivo» no necesita saber que existe una `clasificacion_v2`.
 */
export const ACCESOS: AccesoRapido[] = [
  { label: "Embarques", href: "/embarques", icon: Workflow, tintClass: "bg-info-bg text-info" },
  { label: "Histórico de embarques", href: "/embarques/historico", icon: Truck, tintClass: "bg-warn-bg text-warn" },
  { label: "Catálogo", href: "/catalogo", icon: Layers, tintClass: "bg-success-bg text-success" },
  { label: "Snapshots", href: "/snapshots", icon: Database, tintClass: "bg-surface-3 text-ink-2" },
  { label: "Familias distintas al archivo", href: "/catalogo?divergencia=1", icon: GitBranch, tintClass: "bg-warn-bg text-warn" },
  { label: "Embarques retrasados", href: "/embarques?retrasado=1", icon: Clock, tintClass: "bg-warn-bg text-warn" },
];

/**
 * "Accesos rápidos" — sin "Inventario por marca" del blueprint (esa card no
 * tiene respaldo en el contrato ratificado de B6; el ángulo por marca ya lo
 * cubre el radar de arriba, ver comentario en `dashboard-view.tsx`).
 *
 * ## La rejilla, y por qué no dice «4»
 *
 * El mockup pedía **los 4 en línea**, y con la fila entera —que es lo que D-1
 * desbloqueó— por fin caben. Pero `grid-cols-4` volvería a fijar el ancho de la
 * casilla, y el ancho de esta columna **cambia con el viewport**: MEDIDO el 15-sep,
 * **387 px a 768 y 888 a 1280**. Cuatro columnas fijas a 387 dejan 87 px por casilla
 * y el rótulo se rompe.
 *
 * Se declara el **ancho mínimo de una casilla** y la rejilla deduce cuántas caben.
 *
 * **El 168 sale de una medición que corrigió a mi aritmética.** Calculé 176 sobre los
 * 888 px de la columna y salió mal: la rejilla no mide la columna, mide la columna
 * **menos el `p-[18px]` de esta tarjeta** — MEDIDO, **349 px a 768 y 850 a 1280**, no
 * 387 y 888. Con 176 la tarjeta caía a **una sola columna a 768**, con seis casillas
 * apiladas. Con 168, medido en el navegador:
 *
 *     390 → 1 col  ·  640 → 3  ·  768 → 2  ·  1024 → 3  ·  1280 → 4  ·  1704 → 6
 *
 * **Y el 4 de 1280 no está codificado: emerge.** La primera fila queda con los cuatro
 * destinos ratificados —los «4 en línea» que pedía el mockup— y las dos puertas
 * reparadas debajo, que es además el orden honesto: primero lo que siempre estuvo,
 * después lo que se repuso.
 *
 * ## El alto de la casilla es D-8, y ya está resuelto
 *
 * El 36 px del mockup se cayó como conflicto; **el criterio que se mantiene es
 * ergonómico: ~44 px, por WCAG 2.5.5 (Target Size) y por la medición de los ~58 de
 * hoy**. Aquí salen de `p-3` + un ícono de `h-8` que es `shrink-0` — 12 + 32 + 12 =
 * **56**, y el rótulo no puede achicarlo. Si envuelve a dos líneas, crece; nunca
 * encoge.
 */
export function DashboardAccesosRapidosCard() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <h2 className="mb-3.5 text-[14.5px] font-semibold text-ink">Accesos rápidos</h2>
      <div data-accesos="" className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(168px,1fr))]">
        {ACCESOS.map((acceso) => {
          const Icon = acceso.icon;
          return (
            <Link
              key={acceso.href}
              href={acceso.href}
              className="flex items-center gap-2.5 rounded-[11px] border border-line bg-surface-input p-3 outline-none transition-colors hover:border-brand hover:bg-surface focus-visible:ring-2 focus-visible:ring-brand"
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]", acceso.tintClass)}>
                <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.8} />
              </span>
              <span className="text-[12.5px] font-semibold leading-tight text-ink-2">{acceso.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
