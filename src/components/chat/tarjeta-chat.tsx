"use client";

// ============================================================
// [INV-B10] tarjeta-chat.tsx — pinta una `Tarjeta`. 100% PRESENTACIONAL.
//
// No formatea ni un número: **todo llega ya formateado del servidor**, en
// es-MX y con su corte. Si este componente formateara, existiría una segunda
// aritmética de presentación y la respuesta del chat podría diferir de la
// ficha para el mismo SKU — que es el defecto que `derivarSku` existe para no
// tener.
//
// EL CORTE VA SIEMPRE, y abajo del todo pero visible. Es la regla #1 y la #3
// aplicadas a una conversación: **una cifra de inventario sin su corte es una
// cifra sin denominador**. En una ficha el corte se ve en la cabecera; en un
// chat, la respuesta se lee suelta y sin contexto tres días después.
// ============================================================
import Link from "next/link";
import { Database, Clock } from "lucide-react";
import { textoDeCorte, type Tarjeta } from "@/lib/chat/tarjeta";
import { parsear } from "@/lib/corpus/markdown";
import { MarkdownChat } from "./markdown-chat";
import { nombreLegible } from "@/lib/chat/voz";

export function TarjetaChat({ tarjeta }: { tarjeta: Tarjeta }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3.5 py-3">
      <div className="text-[13px] font-semibold leading-snug text-ink">{tarjeta.titulo}</div>

      {/* ────────────────────────────────────────────────────────────
          [CHAT-B4] B4-1 · EL AVISO, FUERA DEL `<details>` Y ANTES DE LA PROSA.

          🔴 ESTE ES EL ARREGLO, y su sitio en el archivo ES el arreglo: va
          arriba del `<details>` de abajo, no dentro.

          Medido en QA manual sobre `:3002`: con «¿qué es el CLIP 3.0?»
          la declaración del salto salía **TRUE en `innerHTML` y FALSE en
          `innerText`** — estaba en `nota`, y `nota` vive dentro del detalle que
          se pliega en cuanto hay prosa. El KAM leía un título con CLIP 3.0 y
          debajo las specs del 2.0, sin nada en pantalla que dijera que eran de
          otro producto.

          ⚠️ Si alguien mueve esto dentro del `<details>` «para que no duplique
          la nota», el defecto vuelve entero y la tarjeta seguirá siendo
          verdadera en el DOM. Por eso el gate se afirma en las DOS direcciones:
          presente en el contenedor, AUSENTE del `<details>`.
          ──────────────────────────────────────────────────────────── */}
      {tarjeta.aviso && (
        <p className="mt-2 rounded-md border border-warn bg-surface-3 px-2.5 py-1.5 text-[12px] font-semibold leading-snug text-ink">
          {tarjeta.aviso}
        </p>
      )}

      {/* [CHAT-B1] LA RESPUESTA, Y VA PRIMERO PORQUE ES LA RESPUESTA.
          Hasta este bloque el chat entregaba el documento y el usuario lo leía;
          esto es lo único que cambia de fondo. Si no hay prosa —siete razones
          posibles, todas contadas en `consumo_chat`— esta caja no existe y la
          tarjeta se ve exactamente como antes del bloque. */}
      {tarjeta.respuesta && (
        <div className="mt-2.5 rounded-md border border-brand bg-surface-3 px-2.5 py-2">
          {tarjeta.respuesta.frases.map((f, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-ink">
              {f}
            </p>
          ))}

          {/* [CHAT-B2] LA CITA: **UNA línea, con el nombre LEGIBLE**.
              La ruta técnica completa, el PDF y «Leí N de M» se pliegan al
              detalle — son ciertos y son del detalle (SOUL §7: no piensa en voz
              alta). Lo que no se pliega es que HAY cita: sin ella la respuesta
              no se puede comprobar, y una prosa incomprobable es PEOR que el
              verbatim que sustituye, porque suena más segura y dice menos de
              dónde salió. */}
          <p className="mt-1.5 border-t border-line-soft pt-1.5 text-[11px] leading-snug text-ink-muted">
            {tarjeta.respuesta.titulo ?? nombreLegible(tarjeta.respuesta.ruta)}
          </p>
        </div>
      )}

      {/* ────────────────────────────────────────────────────────────
          [CHAT-B2] EL ANDAMIAJE · SOUL §4 y §7.

          Con PROSA encima, todo esto se pliega: los datos, la lista de
          secciones, el verbatim, la nota y la franja de procedencia. Son
          ciertos y son del DETALLE — «Leí las 1 secciones», «Documentos 4»,
          «sin PDF de origen» y la ruta del vault son el estado interno del
          recuperador, no la respuesta. El KAM preguntó qué es un producto.

          🔴 SE PLIEGA, NO SE ELIMINA, y la razón no es estética:

            · el VERBATIM es la garantía de contención — la única forma de
              comprobar que la respuesta no inventó. La contención por cita
              cubre cifras y códigos, NO la paráfrasis; el contraste con el
              texto de origen es la contramedida, y es del lector.
            · el AVISO de que el puente familia–ficha no lo revisó un humano es
              la única señal de que el dato puede estar mal. Medido: ningún
              renglón está revisado, así que no es un borde — es el caso.

          Si alguien quita este `<details>` «porque duplica», las dos garantías
          desaparecen SIN QUE NINGUNA PRUEBA SE PONGA ROJA. Por eso el gate 4 se
          afirma en las DOS direcciones: presente en el DOM, ausente de la vista.

          SIN prosa se comporta exactamente como antes del bloque: abierto.
          ──────────────────────────────────────────────────────────── */}
      <details className="group mt-2.5" open={!tarjeta.respuesta}>
        {tarjeta.respuesta && (
          <summary className="cursor-pointer list-none text-[11.5px] font-semibold text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand">
            <span className="group-open:hidden">▸ ver detalle</span>
            <span className="hidden group-open:inline">▾ detalle</span>
          </summary>
        )}

      {/* Los datos, en dos columnas que no se rompen en 390 px: la etiqueta se
          encoge y el valor no, porque el valor es la respuesta. */}
      <dl className="mt-2 flex flex-col gap-1">
        {tarjeta.datos.map((d) => (
          <div key={d.etiqueta} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 truncate text-[12px] text-ink-muted">{d.etiqueta}</dt>
            <dd
              className={
                d.enfasis
                  ? "shrink-0 text-[14px] font-bold tabular-nums text-brand"
                  : "shrink-0 text-[12.5px] font-semibold tabular-nums text-ink"
              }
            >
              {d.valor}
            </dd>
          </div>
        ))}
      </dl>

      {tarjeta.lista.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
          {tarjeta.lista.map((l, i) => (
            <li key={`${l.principal}-${i}`} className="min-w-0">
              {/* Un SKU listado LLEVA A SU FICHA. El resto del portal ya lo hace
                  —el mapa de calor abre la marca en el catálogo— y una lista de
                  11 SKU sin clic obliga a copiarlos a mano. Solo enlazan los
                  renglones que DECLARAN ser un SKU: los de `llegada` llevan una
                  etapa y los de `disponibilidad` un cliente, y enlazar
                  `/catalogo/RETAILER9` sería peor que no enlazar. */}
              {l.sku ? (
                <Link
                  href={`/catalogo/${encodeURIComponent(l.sku)}`}
                  className="truncate font-mono text-[12px] font-semibold text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {l.principal}
                </Link>
              ) : (
                <div className="truncate font-mono text-[12px] font-semibold text-ink">{l.principal}</div>
              )}
              <div className="truncate text-[11.5px] leading-snug text-ink-muted">{l.secundario}</div>
            </li>
          ))}
        </ul>
      )}

      {/* [INV-B11] EL TEXTO DE LA FICHA.
          `max-h` con scroll propio porque una ficha llega a varios miles de tokens y sin
          eso empujaría la caja de texto fuera de la pantalla.

          SE RENDERIZA, y la decisión cambió con la medición: mostrarlo crudo
          hacía que una tabla de especificaciones se leyera como texto con
          barras — **menos parecida al documento que la renderizada**, no más.
          La verificabilidad la carga la CITA (los PDF de abajo), no los
          asteriscos.

          El parser no produce HTML y esto crea elementos de React: no hay
          `dangerouslySetInnerHTML` en el camino. */}
      {/* [CHAT-B1] CON PROSA ENCIMA, EL VERBATIM SE PLIEGA — PERO NO SE VA.
          Sigue SIEMPRE en el DOM, y eso no es un detalle de maquetación: la
          contención por anclaje declara explícitamente que NO cubre la
          paráfrasis —una afirmación sin números, anclada a un tramo que existe
          pero que dice otra cosa, pasa—, y la única contramedida real contra eso
          es que el texto de origen esté al lado para contrastarlo.

          ⚠️ Si alguien retira este `<details>` «porque duplica la respuesta», la
          garantía desaparece SIN QUE NINGUNA PRUEBA SE PONGA ROJA. Está dicho
          aquí y en `verificar-redaccion.ts`, que es donde se va a buscar.

          Sin prosa se comporta como antes del bloque: abierto. */}
      {/* [CHAT-B2] YA NO LLEVA SU PROPIO `<details>`: lo pliega el de arriba.
          Dos niveles de plegado habrían puesto el verbatim a DOS clics, y el
          verbatim es la garantía de contención — cuanto más lejos queda, menos
          se usa, y una garantía que nadie ejerce no es una garantía. */}
      {tarjeta.texto && (
        <div className="mt-2.5 max-h-64 overflow-y-auto rounded-md border border-line-soft bg-surface-3 px-2.5 py-2">
          <MarkdownChat bloques={parsear(tarjeta.texto)} />
        </div>
      )}

      {/* La nota lleva lo que NO cabe en un par etiqueta/valor y que sin
          embargo cambia la lectura: un sobre-reservado, un descuadre, o que la
          lista viene acotada. Nunca se calla ninguna de las tres. */}
      {tarjeta.nota && (
        <p className="mt-2.5 rounded-md bg-surface-3 px-2.5 py-1.5 text-[11.5px] leading-snug text-ink-2">
          {tarjeta.nota}
        </p>
      )}

      {/* [INV-B11] O6 · LA FRANJA DE PROCEDENCIA SOLO EXISTE SI HAY PROCEDENCIA.
          `capacidades` no lee la base, así que va con `fuentes` y `cortes`
          vacíos — y sin esta condición dejaría una raya horizontal con nada
          debajo, que se lee como «aquí falta algo». Una tarjeta que no consultó
          nada no tiene que aparentar que sí. */}
      {(tarjeta.fuentes.length > 0 || tarjeta.cortes.length > 0) && (
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft pt-2">
        {tarjeta.fuentes.map((f) => (
          <span key={f.code} className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
            <Database className="h-3 w-3" aria-hidden="true" />
            {f.tag} · <span className="font-mono font-normal">{f.code}</span>
          </span>
        ))}
        {tarjeta.cortes.map((c) => (
          <span key={c.fuente} className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {textoDeCorte(c)}
          </span>
        ))}
      </div>
      )}
      </details>
    </div>
  );
}
