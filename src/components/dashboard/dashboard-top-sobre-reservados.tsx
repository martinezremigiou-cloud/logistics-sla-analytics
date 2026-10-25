import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { formatoNumero } from "@/lib/formato";
import type { RankingItem } from "@/types/api";

export interface DashboardTopSobreReservadosProps {
  /** Top-10 por `disponible` ASC (más negativo primero) — TODOS los items ya vienen con `disponible < 0` (`buildTopSobreReservados`). */
  items: RankingItem[];
  /**
   * [DASH-F · D-4] **Cuántos SKU sobre-reservados hay en TODO el vigente**, no en
   * esta lista.
   *
   * Viaja aparte porque NO se puede derivar de `items`: esta tarjeta recibe el top
   * 10 y el universo es otro número —en un corte real, bastante mayor que
   * 10—. Sale de
   * `kpis.sobre_reservados.valor`, que viene en la misma respuesta.
   */
  universo: number;
}

/**
 * Las piezas que faltan, **sumadas sobre los ítems LISTADOS**.
 *
 * `disponible` es negativo por construcción en esta lista, así que el faltante es
 * su opuesto. El `Math.max(0, …)` no es paranoia decorativa: si algún día entrara
 * un ítem con `disponible >= 0`, restarlo del total diría que ese SKU *aporta*
 * piezas al faltante, que es lo contrario de lo que pasa.
 */
export function faltanteListado(items: RankingItem[]): number {
  return items.reduce((suma, i) => suma + Math.max(0, -i.disponible), 0);
}

/**
 * [DASH-F · D-4] El subtítulo de totales pedido — **con sus DOS
 * poblaciones nombradas, porque son dos.**
 *
 * Se pidió «las cantidades totales sobre-reservadas». La tarjeta puede contestar
 * media pregunta con exactitud y la otra media solo sobre lo que tiene:
 *
 *   · **cuántos SKU** — sí se sabe del universo entero: viene del KPI.
 *   · **cuántas piezas** — solo se pueden sumar las de los ítems LISTADOS. La suma
 *     del universo completo **no viaja en la respuesta**, y no se inventa.
 *
 * Por eso el texto dice explícitamente sobre qué población va cada cifra. Es la
 * regla #3 de la casa —nombrar el denominador— y se fijó como gate de
 * este punto: *nunca una cifra sin decir sobre qué población*.
 *
 * Cuando el universo no excede a lo listado, la lista ES el universo y la fracción
 * sobra: decir «10 de 10» invita a buscar un recorte que no existe.
 */
export function subtituloDeTotales(items: RankingItem[], universo: number): string | null {
  if (items.length === 0) return null;
  const piezas = formatoNumero(faltanteListado(items));
  if (universo > items.length) {
    return `${formatoNumero(items.length)} de ${formatoNumero(universo)} SKU · faltan ${piezas} piezas en estos ${formatoNumero(items.length)}`;
  }
  return `${formatoNumero(items.length)} SKU · faltan ${piezas} piezas`;
}

/**
 * "Top sobre-reservados" — reinterpretación del slot "Top SKUs en riesgo"
 * del blueprint (la card de predicción ML original es B10, fuera de
 * alcance aquí). `disponible` SIEMPRE en tono warn (nunca rojo/danger,
 * regla de la casa — ver `estatus-pill.tsx`).
 *
 * ---
 *
 * [DASH-F · D-4] **ES UNA TABLA, y el cambio de elemento ES el arreglo.**
 *
 * Se vio mirando: `5,900 / 4,520` se lee por convención como *parte sobre
 * todo*, y aquí **el mayor va primero**, así que la forma contradice la lectura
 * habitual y el ojo tiene que descubrir el orden. Peor: las tres cifras del renglón
 * —el faltante, el reservado y el total— **no decían ninguna qué eran**. Queda con
 * nombre: `PAR-SIN-ETIQUETA-SE-LEE-COMO-PARTE-SOBRE-TODO`.
 *
 * Se eligió conservar las cifras y etiquetarlas UNA VEZ arriba. En cuanto hay
 * encabezados de columna, el elemento correcto es `<table>`, y no por purismo:
 *
 *   · Las columnas se alinean **por construcción**. Con una lista de `flex` cada
 *     renglón negocia su propio reparto, así que «el encabezado alineado a las
 *     columnas reales» sería una coincidencia que hay que ir a medir. Aquí no puede
 *     desalinearse.
 *   · `<th scope="col">` hace que un lector de pantalla anuncie **«Reservado:
 *     5 900»** en vez de un número suelto. La pregunta acordada —*«¿se
 *     entiende qué es cada número sin preguntarlo?»*— también se la hace quien no
 *     ve la tabla, y para ése el encabezado visual no existe.
 *
 * `table-fixed` es lo que permite truncar dentro de una celda: sin ancho definido,
 * una celda crece con su contenido y `truncate` no tiene contra qué recortar.
 */
export function DashboardTopSobreReservadosCard({ items, universo }: DashboardTopSobreReservadosProps) {
  const subtitulo = subtituloDeTotales(items, universo);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {/*
        [DASH-F · D-4] EL SUBTÍTULO VA EN SU PROPIO RENGLÓN, y el motivo es una medición.
        Puesto al lado del título compartía ancho con «Ver catálogo →», y a 1280 esta
        tarjeta mide 356 px —es más angosta que a 390, porque su fila le da 1fr contra
        1,43fr de la vecina—: al subtítulo le quedaban ~197 px para un texto de ~250 y
        partía en dos líneas. Medido, esa segunda línea costaba 36,3 px de cabecera en
        vez de los ~19 de una. A ancho completo cabe en una.
      */}
      <div className="border-b border-line-soft px-[18px] py-[15px]">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={1.8} aria-hidden="true" />
          <h2 className="min-w-0 truncate text-[14.5px] font-semibold text-ink">Top sobre-reservados</h2>
          <Link
            href="/catalogo?badge=sobre_reservado"
            className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-sm text-[11.5px] font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
          >
            Ver catálogo →
          </Link>
        </div>
        {subtitulo && <p className="mt-1 text-[11.5px] text-ink-muted">{subtitulo}</p>}
      </div>

      {items.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[12.5px] text-muted-foreground">Sin SKUs sobre-reservados — todo en orden.</p>
      ) : (
        <table className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-[92px] border-b border-line-soft py-2 pl-[18px] pr-2 text-[10.5px] font-semibold text-ink-muted"
              >
                Faltante
              </th>
              <th scope="col" className="border-b border-line-soft py-2 text-[10.5px] font-semibold text-ink-muted">
                SKU
              </th>
              <th
                scope="col"
                className="w-[124px] border-b border-line-soft py-2 pl-2 pr-[18px] text-right text-[10.5px] font-semibold text-ink-muted"
              >
                Reservado / Total
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              // El borde va en la FILA: `last:border-b-0` sobre un <td> pregunta si esa
              // CELDA es la ultima de su renglon —la primera nunca lo es—, asi que la
              // ultima fila conservaba su linea contra el borde redondeado de la tarjeta.
              <tr key={item.sku} className="border-b border-line-soft last:border-b-0">
                <td className="py-3 pl-[18px] pr-2 align-middle">
                  <span className="inline-flex min-w-[52px] justify-center rounded-[7px] bg-warn-bg px-2 py-1 font-mono text-[12.5px] font-bold text-warn">
                    {formatoNumero(item.disponible)}
                  </span>
                </td>
                <td className="overflow-hidden py-3 align-middle">
                  <Link
                    href={`/catalogo/${encodeURIComponent(item.sku)}`}
                    className="block truncate rounded-sm font-mono text-[12.5px] font-bold text-ink outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    {item.sku}
                  </Link>
                  <p className="truncate text-[11.5px] text-ink-muted">{item.descripcion ?? "—"}</p>
                </td>
                {/*
                  [DASH-F · D-4c] Las dos cifras dejan de estar planas. El RESERVADO
                  es el que excede —es el sujeto del renglón— y lleva la tinta fuerte;
                  el total queda de referencia, apagado. La jerarquía la dan tinta y
                  peso, NO tamaño: el chip ámbar sigue siendo 12,5 px en negrita sobre
                  un relleno, contra 11 px aquí, así que sigue siendo lo que más salta.
                */}
                <td className="whitespace-nowrap py-3 pl-2 pr-[18px] text-right align-middle font-mono text-[11px]">
                  <span data-reservado="" className="font-semibold text-ink-2">
                    {formatoNumero(item.reservado)}
                  </span>
                  <span className="text-ink-muted"> / </span>
                  <span data-total="" className="text-ink-muted">
                    {formatoNumero(item.total)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
