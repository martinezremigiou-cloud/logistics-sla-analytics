// ============================================================
// [2.0.1-B · S-1] proyecto-zoom.tsx — la VISTA AMPLIADA bajo la pasarela.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ VA EN EL MISMO ENTREGABLE QUE EL CARRIL, y no después.
//
// El carril sin el zoom **empeora la queja que existe para arreglar**. Medido
// por el QA a 966 px de alto: varios proyectos en una fila horizontal dejaron
// ~590 px de vacío bajo el carril — más hueco vertical que las dos filas de
// rejilla que sustituyó. El 57 % subió, no bajó. Yo lo sabía cuando entregué el
// carril («el Zoom es lo que rellena el alto») y lo dejé como «lo que sigue» en
// vez de sacarlo como advertencia. **El zoom es lo que hace que el carril valga
// la pena; sin él es una regresión visible.**
//
// ────────────────────────────────────────────────────────────
// QUÉ SUJETO AMPLÍA: EL ANCLA DEL CARRIL, NO UN CLIC.
//
// La maqueta abre el zoom al TOCAR una tarjeta. Aquí no se puede sin romper algo
// peor: la tarjeta ya ES un `<Link>` entero, y meterle un segundo objetivo
// pulsable encima obliga o a anidar interactivos (HTML inválido) o a quitarle al
// título su navegación. Así que el sujeto se DERIVA del desplazamiento: la
// tarjeta pegada al inicio del carril es la que se amplía, y las flechas de
// 44×44 que ya existen son el control. Se gana además que el zoom nunca esté
// vacío: siempre hay una tarjeta anclada.
//
// ────────────────────────────────────────────────────────────
// LO QUE NO TRAE, declarado para que nadie lo lea como olvido:
//
//   · **El editor de apariencia** (6 colores y 7 símbolos). Es el lápiz, y el
//     lápiz es S-2 por decisión de producto: sin las columnas `color`/`simbolo` por
//     proyecto no tendría qué guardar. **No se anuncia un panel «Apariencia»
//     que llegará después** (P7): la columna de 330 px que sigue se llena con
//     lo que YA existe.
//   · **«Revisar y exportar»**. La maqueta lo lleva a la pestaña Documento del
//     detalle, y esa pestaña **no es direccionable por URL hoy**
//     (`proyecto-detalle-view.tsx` no lee `useSearchParams`). Un botón que
//     nombra un destino que no existe es exactamente el error del estado vacío
//     que ya se corrigió una vez en este bloque. Queda «Abrir el proyecto»,
//     que sí lleva a donde dice.
//
// ────────────────────────────────────────────────────────────
// [2.0.1-C · F-4] LA COLUMNA DE 330 PX, RESERVADA — DECISIÓN DE PRODUCTO.
//
// Medido: `PortadaZoom` es `viewBox 0 0 760 280` con `h-auto w-full` y SIN
// TOPE — su alto es `0.368 × ancho`. Sin editor, la portada se comía esa
// columna: 513 px de 794 (65 %). La maqueta pide «el editor en una columna de
// 330 px al costado; en anchos angostos cae abajo» — y eso es exactamente lo
// que hace un `flex-wrap` sin editor: la columna se llena con lo que ya
// existe (Inventario vigente + Abrir el proyecto) y el hueco que antes se
// comía la portada queda reservado, no regalado.
//
// SIN MEDIA QUERY ESCRITA A MANO: el quiebre nace de que las dos ramas no
// caben (`flex-[1_1_480px]` + `flex-[1_1_330px]` con `flex-wrap`), igual que
// en la maqueta.
//
// LA ESCALA SUBIÓ UN ESCALÓN, sin tokens nuevos: la queja era «valores
// muy pequeños», y con la portada acotada hay sitio. Cada tamaño que cambió
// toma el SIGUIENTE que ya existía en ESTE archivo (9.5→11, 12.5→13, 15→21) —
// cero hexadecimales, cero tamaños inventados.
//
// ────────────────────────────────────────────────────────────
// [revisor-codigo ALTO] LA REGIÓN ENVUELVE LAS DOS RAMAS, NO SOLO LA
// IZQUIERDA.
//
// La primera versión dejaba `aria-label="Vista ampliada de …"` en la rama de
// portada+datos, y la columna de 330 px quedaba AFUERA del landmark. Quien
// navega por regiones entraba a «Vista ampliada de PRJ-001», la recorría
// entera, y «Abrir el proyecto» —la acción principal de la vista— no estaba
// ahí adentro; afuera era un `link` llamado solo «Abrir el proyecto», sin
// folio, en una pantalla con nueve tarjetas que también son enlaces (WCAG
// 2.4.4: un nombre de enlace tiene que bastar por sí solo fuera de contexto).
//
// La decisión de producto fue sobre el CONTENIDO de la columna —qué va en ella—,
// nunca sobre que quedara fuera de la región nombrada. Por eso el
// `aria-label` vive en el contenedor EXTERNO: las dos ramas son una sola
// región para quien navega por landmarks, aunque sigan siendo dos cajas
// visuales para quien mira.
// ============================================================
import Link from "next/link";
import { formatoFecha, formatoFechaDeTimestamp, formatoNumero } from "@/lib/formato";
import { COLOR_PROYECTO } from "./apariencia-proyecto";
import { PortadaZoom } from "./portada-proyecto";
import type { ProyectoResumen } from "@/types/proyectos";

export interface ProyectoZoomProps {
  proyecto: ProyectoResumen;
  /** `created_at` del snapshot pinneado. Global para toda la lista, no del proyecto. */
  inventarioEn?: string | null;
}

/**
 * Un par etiqueta/valor de la rejilla de identidad.
 *
 * [F-3] `min-w-0` en el contenedor: en CSS Grid el mínimo por omisión de un
 * ítem es `auto` (su contenido intrínseco), así que un correo sin espacios
 * —`coordinador.compras.mx@example.com`— fuerza el ancho de su columna aunque
 * la pista declare `minmax(140px,1fr)`. `minmax` no protege contra eso;
 * `min-w-0` sí, porque le permite al ítem encogerse por debajo de su
 * contenido para que `truncate` tenga margen donde actuar.
 *
 * `truncar`/`titulo` son opt-in: solo «Responsable» los usa. Fecha, Partidas
 * y Piezas son siempre cortas. [F-4] «Inventario vigente» dejó de compartir
 * rejilla con las demás —vive sola en la columna de 330 px—, así que ya no
 * hace falta un `col-span-full` que la abarcara: el prop `ancho` se retiró
 * con ella en vez de quedar como una rama que nadie llama.
 */
function Dato({
  etiqueta,
  children,
  mono = false,
  truncar = false,
  titulo,
}: {
  etiqueta: string;
  children: React.ReactNode;
  mono?: boolean;
  truncar?: boolean;
  /** `title` nativo del div del VALOR — el texto íntegro cuando `truncar` lo recorta. */
  titulo?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted2">{etiqueta}</div>
      <div
        className={`${mono ? "mt-0.5 font-mono text-[21px] font-semibold" : "mt-[3px] text-[13px] font-semibold text-ink-2"}${truncar ? " truncate" : ""}`}
        style={mono ? { color: "var(--mx-navy-ink)" } : undefined}
        title={titulo}
      >
        {children}
      </div>
    </div>
  );
}

export function ProyectoZoom({ proyecto, inventarioEn }: ProyectoZoomProps) {
  return (
    <section
      aria-label={`Vista ampliada de ${proyecto.folio}`}
      className="flex flex-wrap items-start gap-3.5"
    >
      <div className="min-w-[320px] flex-[1_1_480px] overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-5 py-3">
          <span className="text-[13.5px] font-semibold text-ink">Vista ampliada</span>
          <span className="text-[11.5px] text-ink-muted">la tarjeta anclada en la pasarela</span>
        </div>

        <div className="relative">
          <PortadaZoom />
          <div className="absolute left-5 top-4 flex items-center gap-2.5">
            <span className="rounded-[7px] bg-surface px-2.5 py-1 font-mono text-[13px] font-semibold" style={{ color: COLOR_PROYECTO }}>
              {proyecto.folio}
            </span>
            {proyecto.intencion && (
              <span className="rounded-[7px] bg-surface px-2.5 py-1 text-[11px] font-semibold" style={{ color: COLOR_PROYECTO }}>
                {proyecto.intencion}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3.5 px-5 pb-5 pt-4">
          <h2 className="text-[21px] font-bold leading-tight tracking-tight text-ink">{proyecto.titulo}</h2>

          {/*
            [F-3] `min-w-0` en cada `Dato` es lo que le da a `truncate` un
            límite del que encogerse: sin él, en Grid el mínimo por omisión de
            un ítem es su contenido intrínseco, y un correo sin espacios
            fuerza el ancho de su columna aunque `minmax(140px,1fr)` diga otra
            cosa. Solo «Responsable» trunca: Fecha/Partidas/Piezas siempre son
            cortas.
          */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-[18px] gap-y-3 border-t border-line-soft pt-3.5">
            <Dato etiqueta="Responsable" truncar titulo={proyecto.responsable ?? undefined}>
              {proyecto.responsable ?? "—"}
            </Dato>
            <Dato etiqueta="Fecha del proyecto">{formatoFecha(proyecto.fecha)}</Dato>
            <Dato etiqueta="Partidas" mono>
              {proyecto.skus} SKU
            </Dato>
            <Dato etiqueta="Piezas" mono>
              {formatoNumero(proyecto.piezas)} pz
            </Dato>
          </div>
        </div>
      </div>

      {/*
        [F-4] La columna de 330 px, RESERVADA — decisión de producto. Antes la
        portada sin tope se comía este espacio (65 % de 794 px, medido). Se
        llena con lo que YA existe en el componente: «Inventario vigente»
        —mudado desde la celda `ancho` de la rejilla, donde ahora lee como
        nota al margen— y «Abrir el proyecto». **NO** un panel «Apariencia»
        con promesa de editor futuro: sería P7, la misma trampa que este repo
        ya decidió no tender con la pestaña «Actividad».
      */}
      <div className="flex min-w-[240px] flex-[1_1_330px] flex-col gap-3.5 rounded-2xl border border-line bg-surface p-4">
        {/*
          La fecha del inventario solo se pinta si existe. Sin snapshot no hay
          de qué fecha hablar, y la frase que la acompaña —«es la fecha que
          imprimirá el documento»— sería falsa: sería la fecha que NO
          imprimiría nada.
        */}
        {inventarioEn && (
          <Dato etiqueta="Inventario vigente">
            <span className="font-normal text-ink-3">
              {formatoFechaDeTimestamp(inventarioEn)} · es la fecha que imprimirá el documento
            </span>
          </Dato>
        )}
        <Link
          href={`/proyectos/${encodeURIComponent(proyecto.id)}`}
          className="inline-flex items-center justify-center rounded-[10px] bg-brand px-4 py-2.5 text-[13px] font-semibold text-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Abrir el proyecto
        </Link>
      </div>
    </section>
  );
}
