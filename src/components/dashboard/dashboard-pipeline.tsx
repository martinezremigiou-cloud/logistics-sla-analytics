import { Fragment } from "react";
import Link from "next/link";
import { FileText, Truck } from "lucide-react";
import { formatoNumero } from "@/lib/formato";
import { ICONO_POR_ORDEN } from "@/components/cruce/pipeline-aduana";
import type { DashboardPipelineEtapa, DashboardPipelineGrupo } from "@/types/api";

export interface DashboardRielEmbarquesProps {
  /** El catálogo completo de etapas, orden ASC. Hoy 11; nada aquí codifica ese número. */
  pipeline: DashboardPipelineEtapa[];
  /**
   * Los grupos, tal como los deriva `agruparPipeline` en el servicio. OBLIGATORIA
   * a propósito: dejarla opcional dejaría al componente capaz de dibujar medio riel
   * en silencio (P24). Siendo obligatoria, `tsc` enumera cada sitio que lo monta.
   */
  grupos: DashboardPipelineGrupo[];
}

/**
 * Qué etapa presta su ícono al grupo: **la que más carga lleva**, porque el ícono
 * habla por el grupo entero y tiene que representar lo que el grupo realmente está
 * haciendo. Si todas están en cero —el caso de varios grupos en el snapshot
 * pinneado— presta el ícono la **primera** del grupo, que es la única elección que
 * no afirma nada. Empate ⇒ gana el `orden` menor, para que el dibujo no dependa del
 * orden de iteración.
 *
 * **Devuelve `number | undefined`, y la firma lo dice.** Un grupo canónico cuyas
 * etapas no estén en el catálogo se queda con `ordenes` vacío, y ahí no hay etapa
 * que preste nada. Declararlo `number` y devolver `undefined` de todas formas
 * dejaba el hueco tapado por un `?? FileText` escrito para OTRA cosa —el orden sin
 * ícono en el mapa—: el resultado correcto por la razón equivocada (P25), y `tsc`
 * sin ver nada. Con la firma honesta, quien llama tiene que decidir.
 */
export function ordenDelIcono(grupo: DashboardPipelineGrupo, pipeline: DashboardPipelineEtapa[]): number | undefined {
  if (grupo.ordenes.length === 0) return undefined;
  const activosDe = new Map(pipeline.map((e) => [e.orden, e.activos]));
  let elegido = grupo.ordenes[0];
  let mejor = 0;
  for (const orden of grupo.ordenes) {
    const activos = activosDe.get(orden) ?? 0;
    if (activos > mejor) {
      mejor = activos;
      elegido = orden;
    }
  }
  return elegido;
}

/**
 * El tono de cada grupo. Autorizado el 13-sep-2026, y cada entrada tiene
 * detrás una medición, no un gusto.
 *
 * **Va como `var()` en un estilo en línea y no como clase de Tailwind**, por la
 * misma razón que `RADAR_COLORES`: el JIT de Tailwind no genera clases construidas
 * en tiempo de ejecución, y una `var()` ya se invierte sola con el tema — que es
 * exactamente lo que estos seis tonos hacen.
 *
 * **Tres se reusan y tres son nuevos.** `--mx-graf-pizarra` porque ningún token del
 * tema tenía el valor de Aduana · `--mx-graf-petroleo` porque el de Almacenes solo
 * existía como `--mx-tag-turquesa` y `globals.css` prohíbe por escrito reusar esa
 * familia para gráfica · `--mx-graf-jade` porque `--mx-good` da **4,33 : 1** con
 * tinta blanca y reprueba texto normal, y no se puede oscurecer en sitio: alimenta
 * `success` (68 usos) y la 3.ª serie del radar.
 *
 * **El de reserva es inalcanzable por prueba, no por suerte.** Un grupo canónico sin
 * tono se vería IDÉNTICO a «Tránsito terrestre» — un grupo disfrazado de otro, peor
 * que un grupo sin color. Lo impide el control positivo de
 * `dashboard-pipeline.test.tsx`, que exige que los tonos pintados sean todos
 * distintos y ninguno vacío.
 */
const TONO_POR_GRUPO: Record<string, string> = {
  importacion: "--mx-navy-ink",
  transito_intl: "--mx-info",
  aduana: "--mx-graf-pizarra",
  transito_terrestre: "--mx-accent",
  almacenes: "--mx-graf-petroleo",
  disponible: "--mx-graf-jade",
};

/**
 * Un tramo del riel. Continuo SOLO si sus DOS puntas están vivas **y las dos tienen
 * una posición declarada en el flujo** — ver el docstring del riel.
 */
export function altoDelBloque(etapas: number): number {
  return Math.min(68 + etapas * 36, 260);
}

function Conector({ vivo, enSalto }: { vivo: boolean; enSalto: boolean }) {
  return (
    <span
      data-conector=""
      data-vivo={vivo ? "true" : "false"}
      aria-hidden="true"
      className={[
        // El trazo cambia de EJE con el ancho, así que no puede ser un gradiente en
        // línea: «hacia abajo» no se vuelve «hacia la derecha» con una media query.
        // Como `border-style` sí tiene variante responsiva, y sigue siendo el trazo.
        // Acostado (móvil primero): borde superior. En columna desde `lg`: izquierdo.
        "shrink-0 border-t-2 lg:border-t-0 lg:border-l-2",
        "mt-[59px] h-0 w-4 lg:mt-0 lg:h-4 lg:w-0", // 24 rótulo + 4 hueco + 32 medio bloque − 1
        vivo ? "border-solid border-brand" : "border-dashed border-ink-muted",
        // [C-DASH·13 · D-3] El tramo que cae en el salto de fila NO SE DIBUJA. Un
        // tramo afirma «esto se recorre»; dibujarlo de la punta de una fila al
        // principio de la siguiente afirmaría un recorrido que en esa dirección no
        // existe. Se pidió con todas sus letras: se resuelve NO dibujándolo,
        // no inventando un conector que mienta sobre el recorrido. Sigue en el DOM
        // —son cinco tramos, siempre— y en columna vuelve, porque ahí no hay fila que
        // partir. Cuelga de `lg`, el MISMO corte que el eje, y no de un umbral de
        // ancho: ahí sería P20, un umbral que no separa. MEDIDO: la caja del riel
        // acostado vale 599 px a 640 y 489 a 768 —se ENCOGE al crecer el viewport,
        // porque el sidebar aparece en `md` y se lleva 230 px— así que ningún número
        // separa «caben seis» de «no caben» a los dos lados del corte.
        enSalto ? "max-lg:hidden" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

/**
 * "Pipeline de embarques" — el riel de aduana, en columna de 64 px. [DASH-E · E-1]
 *
 * ## Qué codifica cada cosa, para que nada quede de adorno (P29)
 *
 * | Canal | Significa | De dónde sale |
 * |---|---|---|
 * | **Forma** | `estancia` = el producto ESTÁ ahí (rectángulo) · `traslado` = SE MUEVE (elipse) | la gramática que dictó Embarques el 9-sep, en `FormaGrupoPipeline` |
 * | **Alto** | cuántas ETAPAS abarca el grupo (el rectángulo se estira; la elipse va compacta) | `grupo.ordenes.length`, y ese número está escrito en el detalle del grupo |
 * | **Cifra** | embarques activos del grupo | `grupo.activos`, Σ del servicio — aquí no se vuelve a sumar |
 * | **Ícono** | la etapa con más carga del grupo | `ordenDelIcono`, sobre `ICONO_POR_ORDEN` (se **importa**, no se modifica) |
 * | **Encendido/apagado** | `activos > 0` o no | el cero se dibuja, no se esconde |
 * | **Conector** | ese tramo del riel está siendo recorrido | **sus dos puntas vivas**, y por eso es continuo |
 *
 * **El conector pide las DOS puntas a propósito, y cambia lo que dibujó el artefact
 * acordado** (ahí el tramo Importación→Tránsito salía continuo con la punta
 * de abajo en cero). Un tramo continuo afirma flujo; con una punta vacía no hay
 * flujo que afirmar, y dibujarlo sería una explicación plausible que nadie midió
 * (P28). Con el snapshot pinneado los 5 tramos salen punteados — el control
 * positivo de dos vivos adyacentes vive en la prueba, no en el dato de hoy.
 *
 * ## Lo que se perdía al agrupar, y ya no
 *
 * Colapsar 11 etapas en 6 grupos fundía «En Almacén Fiscal» con «En Almacén North»,
 * que es justo la que Embarques señaló. El detalle **se jerarquiza, no se pierde**:
 * cada grupo lleva su panel con sus etapas nombradas una por una, revelado con
 * `:hover` **y** con `:focus-within`, y atado al enlace por `aria-describedby` —
 * si solo respondiera al ratón, para quien navega con teclado el detalle no
 * existiría. Todo es CSS: sin estado, sin `use client`, sin riesgo de remount.
 *
 * ## Contraste, corregido sobre mi propio diseño
 *
 * El borde del bloque apagado **porta información** («este grupo existe y está en
 * cero»), así que WCAG 1.4.11 le pide 3:1. Va en `--mx-muted`: **4,76:1** en claro
 * y **5,62:1** en oscuro, contra `--mx-surface`. El `--mx-muted-3` que dibujé
 * primero da **1,48:1** — el mismo defecto que este bloque le señaló a «Sin KAM».
 * La pareja del bloque vivo es `bg-brand` + `text-surface`: **4,54:1** en claro y
 * **6,31:1** en oscuro, y **no necesita variante `dark:`** porque `--mx-surface` ya
 * se invierte (blanco ↔ casi negro) justo al revés que `--mx-accent`.
 *
 * **Y el rótulo no vive sobre una superficie: vive sobre el fondo de la app**,
 * porque el riel no tiene marco. Ahí `--mx-muted` da **4,40:1** y REPRUEBA los
 * 4,5:1 de texto normal — por eso el rótulo apagado va en `--mx-text-3` (7,00:1),
 * que sigue siendo más apagado que el `--mx-text-2` del vivo (9,56:1). Ese defecto
 * lo escribí yo en este mismo componente y lo cazó la medición, no la lectura.
 *
 * **Las cinco cifras de arriba no están copiadas: las recalcula
 * `riel-contraste.test.ts` desde los hex de `globals.css` en cada corrida.** Nació
 * porque «corregí» a mano un 5,62 correcto y escribí 5,48 — P29 aplicado a mí: una
 * cifra sin comando detrás, usada además para corregir una que estaba bien.
 *
 * ## La paleta, cerrada el 13-sep-2026
 *
 * Se autorizaron los tres tokens que faltaban y el riel deja de ser monocromo. Lo que
 * estuvo bloqueado queda escrito porque es la FORMA del problema y volverá: **de los
 * seis tonos firmados, tres no se podían pintar.**
 * 4 de los 6 tonos existen (`--mx-navy-ink`, `--mx-info`, `--mx-accent`,
 * `--mx-good`), pero el de Aduana **no existe** y el de Almacenes solo existe como
 * `--mx-tag-turquesa`, que `globals.css:49-51` prohíbe reusar por escrito («NUNCA
 * reusar --mx-tag-morado, que es semántico de color de SKU»). Los dos que faltan
 * viven en `src/app/globals.css`, que es **DE NADIE**. Hasta que se conceda, el
 * riel va monocromo: **media paleta sería peor que ninguna** (P24), y monocromo no
 * afirma nada falso — el grupo ya queda identificado por posición, rótulo, forma e
 * ícono.
 */
export function DashboardRielEmbarques({ pipeline, grupos }: DashboardRielEmbarquesProps) {
  const etapasPorOrden = new Map(pipeline.map((e) => [e.orden, e]));

  return (
    <nav
      aria-label="Pipeline de embarques"
      // [C-DASH·13] `relative` ACOSTADO, y es lo que arregla el recorte del panel
      // de detalle: así el panel se ancla AL RIEL en vez de a su grupo. Ver el
      // envoltorio de abajo, que deja de estar posicionado hasta `lg`.
      className="relative flex w-full shrink-0 flex-row flex-wrap items-start self-start lg:w-16 lg:flex-col lg:flex-nowrap lg:items-center"
    >
      {/*
        El `<h2>` «Pipeline de embarques» no cabe en 64 px y va a `sr-only` para que
        el documento conserve su estructura. Pero quitarle al usuario vidente el
        NOMBRE *y* la afordancia de enlace habría sido pagar dos veces por un
        problema de ancho: el riel sería la única de las 8 tarjetas del tablero sin
        título a la vista. El cintillo de abajo devuelve las dos cosas en el ancho
        que hay — «Embarques» es el nombre de cara al usuario,
        el mismo que el nav y el `<h1>` de la pantalla de destino.
      */}
      <h2 className="sr-only">Pipeline de embarques</h2>
      <Link
        href="/embarques"
        className="mr-3 mt-7 flex w-16 shrink-0 flex-col items-center gap-[3px] rounded-[8px] text-[10px] font-semibold text-ink-2 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app lg:mb-2 lg:mr-0 lg:mt-0"
      >
        <Truck className="h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={1.8} aria-hidden="true" />
        Embarques
      </Link>

      {grupos.map((g, i) => {
        const vivo = g.activos > 0;
        const elipse = g.forma === "traslado";
        const sinClasificar = g.forma === "sin_clasificar";
        // Dos huecos DISTINTOS, y por eso no comparten un solo `??`: el grupo puede
        // no tener etapa que preste ícono (`ordenes` vacío) o tenerla y que el mapa
        // no la conozca (un `orden` nuevo). El `FileText` es el mismo, la razón no.
        const ordenIcono = ordenDelIcono(g, pipeline);
        const Icon = (ordenIcono === undefined ? undefined : ICONO_POR_ORDEN[ordenIcono]) ?? FileText;
        const panelId = `riel-detalle-${g.clave}`;
        const etapas = g.ordenes.map((orden) => etapasPorOrden.get(orden)).filter((e): e is DashboardPipelineEtapa => e !== undefined);

        return (
          <Fragment key={g.clave}>
            {/*
              EL SALTO DE FILA ES EXPLÍCITO, y esa es la diferencia que importa.
              Con `flex-wrap` a secas, DÓNDE parte el riel depende del ancho del
              rótulo más largo —«Tránsito internacional» mide 100 px a 390 y 64 a
              640—, así que el corte caería en un sitio distinto en cada ancho y
              sería IMPOSIBLE saber qué tramo esconder. Declarado, el salto va
              siempre antes del cuarto grupo: 3 + 3.
              En columna desaparece, porque ahí no hay fila que partir.
            */}
            {i === 3 && <span data-salto="" aria-hidden="true" className="h-0 basis-full lg:hidden" />}
            {i > 0 && (
              <Conector
                enSalto={i === 3}
                vivo={
                  vivo &&
                  grupos[i - 1].activos > 0 &&
                  // Un grupo `sin_clasificar` no tiene POSICIÓN en el flujo: el
                  // servicio lo añade al final del arreglo, siempre, después de la
                  // etapa terminal, y una etapa nueva podría ser temprana. Un tramo
                  // continuo hacia él —o desde él— afirmaría un recorrido cuya
                  // existencia misma es una suposición. Es el mismo P28 que la regla
                  // de las dos puntas evita, y se me escapó justo en el único tramo
                  // que no venía del catálogo.
                  g.forma !== "sin_clasificar" &&
                  grupos[i - 1].forma !== "sin_clasificar"
                }
              />
            )}
            <div
              data-grupo={g.clave}
              // `lg:relative` y no `relative`: ACOSTADO el envoltorio NO puede ser el
              // ancestro posicionado, porque entonces el `left-0` del panel de detalle
              // se mide contra el GRUPO y el panel se sale de la pantalla — medido a
              // 390: el tercer grupo de cada fila arranca en x≈288 y el panel llegaba
              // a ≈526. En columna sí, que es donde el panel cuelga a 78 px del bloque.
              className="group flex min-w-16 shrink-0 grow-[var(--peso-riel,0)] flex-col items-center lg:relative lg:w-16 lg:min-w-0 lg:grow-0"
              // El alto no codifica piezas ni embarques: codifica cuántas etapas
              // abarca el grupo. La elipse no crece — su compacidad ES su gramática.
              style={
                {
                  // El peso viaja como VARIABLE y no como propiedad final, porque la
                  // propiedad SÍ tiene que cambiar con el eje: en FILA (bajo `md`)
                  // reparte el ANCHO del riel entre los grupos, que ahí es el eje
                  // largo; en COLUMNA no reparte nada, porque ahí el alto se DECLARA.
                  //
                  // Y NO bastaba con añadir `lg:grow-0` encima: un estilo EN LÍNEA
                  // gana a cualquier clase de Tailwind, incluidas las de media query.
                  // Mientras el valor viviera aquí, ningún `lg:` podía corregirlo — y
                  // la clase habría quedado puesta, la caja rota y una aserción sobre
                  // `className` VERDE. El `,0` del fallback es la decisión del lado
                  // seguro escrita, no una casualidad de la cascada.
                  "--peso-riel": String(elipse || sinClasificar ? 0 : g.ordenes.length),
                  // En COLUMNA el alto NO se distribuye: se DECLARA. Viaja como
                  // variable porque Tailwind no genera clases en tiempo de ejecucion,
                  // y la clase `lg:h-[var(--alto-riel)]` si es estatica.
                  "--alto-riel": `${altoDelBloque(g.ordenes.length)}px`,
                } as React.CSSProperties
              }
            >
              <span
                className={
                  vivo
                    ? "mb-1 flex min-h-[24px] items-end text-center text-[10px] font-semibold leading-[1.18] text-ink-2"
                    : // `--mx-text-3`, NO `--mx-muted`: el rótulo vive sobre el fondo de la app
                      // (el riel no tiene marco), y ahí `--mx-muted` da 4,40:1 — reprueba los
                      // 4,5:1 de texto normal. Medido, no razonado: `riel-contraste.test.ts`.
                      "mb-1 flex min-h-[24px] items-end text-center text-[10px] font-medium leading-[1.18] text-ink-3"
                }
              >
                {g.nombre}
              </span>

              <Link
                href="/embarques"
                // Este `aria-label` es el ÚNICO nombre accesible del bloque: dentro solo
                // hay un ícono `aria-hidden` y una cifra. «1 embarques activos» sería lo
                // único que ese usuario oye del grupo.
                aria-label={`${g.nombre}, ${vivo ? `${formatoNumero(g.activos)} ${g.activos === 1 ? "embarque activo" : "embarques activos"}` : "sin embarques activos"}`}
                aria-describedby={panelId}
                className={[
                  "flex w-16 flex-col items-center justify-center gap-[3px] border-[1.6px] outline-none",
                  // `ring-offset-surface-app` y no un `ring-offset-2` desnudo: Tailwind
                  // deja `--tw-ring-offset-color:#fff` por omisión, así que sin token el
                  // hueco se pinta BLANCO y en tema oscuro el anillo cae a 2,76:1 contra
                  // su propia aureola. Con el token: 4,19:1 en claro y 6,99:1 en oscuro.
                  "transition-shadow focus-visible:ring-2 focus-visible:ring-brand",
                  "focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app",
                  // Acostado, el bloque mide 64 de alto y crece a lo ANCHO; en columna
                  // mide 64 de ancho y su alto lo DECLARA `--alto-riel`. El canal
                  // «Alto = cuántas etapas» es en realidad «el eje largo», y desde
                  // C-DASH·10 el envoltorio sigue al eje porque hay DOS clases que lo
                  // dicen (`grow-[var(--peso-riel,0)]` y `lg:grow-0`), no porque una
                  // propiedad sin eje acierte: en columna nadie reparte alto.
                  // Sin `flex-1` en ninguna rama: era la clase que rompia los dos
                  // extremos a la vez. Acostado, el bloque llena el ancho de su
                  // envoltorio (que es quien reparte); en columna toma su alto
                  // declarado. Ningun eje depende ya del hueco que sobre.
                  elipse
                    ? "h-16 w-16 shrink-0 rounded-full"
                    : "h-16 w-full min-w-16 rounded-[11px] lg:w-16 lg:min-w-0 lg:h-[var(--alto-riel)]",
                  // El relleno ES la marca de «vivo dentro del flujo», y un grupo sin
                  // gramática no puede reclamarla: no se sabe si está en el flujo. Va
                  // siempre en hueco con borde punteado VISIBLE — antes el punteado iba
                  // sobre un borde `transparent`, así que con el grupo vivo el bloque
                  // salía idéntico a un `estancia` relleno. La marca existía justo
                  // cuando no importaba y desaparecía justo cuando sí.
                  sinClasificar
                    ? "border-dashed border-ink-muted bg-surface text-ink-2"
                    : vivo
                      ? "border-transparent text-surface" // el relleno va por `style`: es un `var()` por grupo
                      : "border-ink-muted bg-surface text-ink-muted",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={vivo && !sinClasificar ? { backgroundColor: `var(${TONO_POR_GRUPO[g.clave] ?? "--mx-accent"})` } : undefined}
              >
                <Icon className="h-[18px] w-[18px]" aria-hidden="true" strokeWidth={1.7} />
                <span className="font-mono text-[12.5px] font-bold tabular-nums">{formatoNumero(g.activos)}</span>
              </Link>

              <div
                id={panelId}
                className={[
                  // [C-DASH·13] ACOSTADO el panel cuelga del RIEL —su ancestro
                  // posicionado— y toma su ancho entero: `top: 100%` es el pie del
                  // riel, no el del grupo. Con `w-[238px]` colgando del grupo, el
                  // tercero de cada fila lo mandaba a ≈526 px sobre un viewport de
                  // 390, y `main` lo recortaba EN SILENCIO. Los seis se revelan de
                  // uno en uno (`:hover`/`:focus-within`), así que compartir sitio
                  // no los solapa.
                  "pointer-events-none invisible absolute left-0 top-[calc(100%+8px)] z-20 w-full rounded-[10px]",
                  "lg:left-[78px] lg:top-0 lg:w-[238px]",
                  "border border-line bg-surface px-3 py-[11px] opacity-0 shadow-lg",
                  "transition-[opacity,visibility] duration-150",
                  "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
                ].join(" ")}
              >
                <p className="mb-[7px] text-[11.5px] font-bold text-ink">
                  {etapas.length} {etapas.length === 1 ? "etapa" : "etapas"}
                </p>
                {etapas.map((e) => (
                  <span key={e.orden} className="flex items-center gap-2 py-[3px] text-[11px]">
                    <span className={e.activos > 0 ? "flex-1 truncate text-ink-2" : "flex-1 truncate text-ink-muted"}>{e.nombre}</span>
                    <span className={e.activos > 0 ? "font-mono font-bold tabular-nums text-ink" : "font-mono tabular-nums text-ink-muted"}>
                      {formatoNumero(e.activos)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </Fragment>
        );
      })}
    </nav>
  );
}
