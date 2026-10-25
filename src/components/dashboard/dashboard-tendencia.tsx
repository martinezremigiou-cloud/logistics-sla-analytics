"use client";

import { TrendingUp } from "lucide-react";
import { formatoNumero, formatoPeriodoCorto } from "@/lib/formato";
import type { TendenciaPunto } from "@/types/api";
import { dominioDe, escalaLineal } from "./escala";

export interface DashboardTendenciaProps {
  /** Serie de `Σ stock del snapshot vigente de cada periodo` (`dashboard.service.ts`). **Un punto por MES**, no por corte: `vigentePorPeriodo` colapsa todos los snapshots de un mes a uno, y `cortes` dice cuántos resumió. */
  tendencia: TendenciaPunto[];
}

/**
 * [DASH-F · D-1] EL ALTO DEL ÁREA DE BARRAS, **DECLARADO**.
 *
 * No es `flex-1`, y la razón está pagada en este mismo repo: el primer defecto
 * del arco DASH-E fue un `flex-1` que fija `flex-basis: 0` sobre el eje LARGO, y
 * el eje largo cambiaba con el ancho — el riel salió de 64 × 1710 px. La casa
 * cerró ese caso con un ALTO DECLARADO, y esto es lo mismo un piso más arriba.
 *
 * El número sale de una medición, no de un gusto. Medido el 17-sep-2026 a
 * 1280 × 900 sobre el servido: la tarjeta la estira el RADAR —intrínseco 487 px
 * contra los 265,5 px de ésta— y sobraban **240,5 px** por debajo del último
 * renglón, que son 3,0 × la gráfica de 80 px. 288 es lo que cabe sin que esta
 * tarjeta le pase por encima al radar y le mude el hueco a la vecina.
 */
export const ALTO_PISTA = 288;

/**
 * Lo que ocupa la cifra que va ENCIMA de cada barra: su renglón de 10 px sin
 * interlínea, más los 4 px de separación con la barra.
 *
 * Existe como constante porque su ausencia costó un defecto real, y de los que
 * ninguna prueba de este repo podía ver. La primera versión daba a las barras la
 * pista ENTERA (288) y ponía la cifra en la misma columna flex: la columna
 * pedía 10 + 4 + 288 = 302 px de 288, y **flex encogió la barra** — pero solo la
 * MÁS ALTA, que es la única que desbordaba. Medido en el servido: 274,5 px donde
 * la función pura decía 288, mientras las otras tres quedaban intactas. La razón
 * entre la mayor y las demás pasó de la del dato a una menor. O sea: la
 * gráfica mentía exactamente en la proporción que una barra existe para afirmar.
 *
 * Y la guarda unitaria NO podía cazarlo: en jsdom no hay layout, así que
 * `style.height` devuelve lo que el componente escribió, no lo que el navegador
 * pinta — medir el atributo en vez de la caja (P27). Lo cazó el grado (c). Lo
 * que baja el caso a grado (a) es la invariante de abajo.
 */
export const ALTO_CIFRA = 14;

/** El alto disponible para la barra misma. La invariante que lo justifica vive en las pruebas. */
export const ALTO_BARRAS = ALTO_PISTA - ALTO_CIFRA;

/**
 * Una barra de valor > 0 nunca desaparece del todo: se le garantiza este mínimo.
 * **No es cosmético y no miente sobre la proporción**: separa «hay poco» de «no
 * hay nada», que son dos afirmaciones distintas sobre el dato. Un valor de CERO
 * sí se dibuja en cero, porque ahí las dos afirmaciones coinciden.
 */
export const MIN_BARRA_VISIBLE = 2;

/** Ancho útil de la gráfica en el viewport más angosto que se soporta (390 px). Medido en QA. */
export const ANCHO_CHART_ANGOSTO = 320;

/** La separación entre barras, en píxeles. Vive aquí porque el cálculo de la ranura la necesita. */
export const HUECO_ENTRE_BARRAS = 6;

/**
 * [DASH-F · D-6] EL TOPE DE ANCHO DE UNA BARRA, firmado el 17-sep-2026.
 *
 * **El defecto: el ancho no tenía tope.** La pista se reparte entre los puntos que
 * haya —`ancho = (pista − huecos) / n`— así que con pocos puntos las barras engordan
 * sin límite. Medido en el servido el 17-sep con `n = 4`: la barra ocupaba el
 * **100 %** de su ranura en las cuatro anchuras (118,1 px de 118,1 a 1280; 75,5 de
 * 75,5 a 390). La convención en gráficas de barras es 60-70 % de la banda; el resto
 * es aire.
 *
 * **Y el absurdo que esto permite está a un dato de distancia:** con un solo periodo
 * la barra mediría la pista entera —490 px de ancho por 274 de alto a 1280—, un
 * rectángulo casi cuadrado. Nadie lo ha visto porque nunca ha habido un solo
 * periodo en el historial; es el control positivo de su propia guarda, ya escrito
 * por el dato.
 *
 * **EL TOPE CADUCA SOLO, y su fecha NO es un número fijo.** Deja de actuar cuando la
 * ranura natural ya cabe por debajo de él, o sea cuando
 * `n ≥ (pista + hueco) / (TOPE + hueco)`. Medido: a 1280 (pista 490,3) eso es
 * **n ≥ 8**; a 390 (pista 320), **n ≥ 5**. *El spec del bloque decía «desde el
 * séptimo», y ése es el número de OTRA pista —457 px—: los píxeles entre dos
 * navegadores no se comparan, solo las proporciones.* Desde ahí el componente se
 * comporta como si el tope no existiera, y **no hay nada que mantener**.
 */
export const TOPE_ANCHO_BARRA = 60;

/** El nivel de un periodo dentro de la serie. Tres, y ninguno es una predicción. */
export type NivelTendencia = "pico" | "medio" | "valle";

/**
 * [DASH-F · D-7b] ¿Hay algo que categorizar?
 *
 * **Con un solo periodo, o con todos los valores iguales, el máximo y el mínimo son el
 * mismo punto** — y decir «todos son el pico» no informa de nada. En ese caso la
 * tarjeta no categoriza y **la referencia de color no se pinta**: una leyenda que
 * explica una distinción que no existe es ruido con aspecto de dato.
 */
export function hayCategorias(valores: number[]): boolean {
  if (valores.length < 2) return false;
  return Math.max(...valores) > Math.min(...valores);
}

/**
 * [DASH-F · D-7b] ¿Este periodo es el PICO, el VALLE, o ninguno de los dos?
 *
 * **La regla es ORDINAL, no estadística, y el cambio se pidió mirando.** La
 * versión anterior clasificaba por desvío respecto a la mediana, que contesta *«¿este
 * mes se aparta de lo normal?»*. Lo que se preguntaba es otra cosa: *«¿cuál es el más
 * bajo?»*. **La implementación no estaba mal escrita: medía otra pregunta.**
 *
 * Y el defecto que eso producía era visible y medible: con una serie de ejemplo la
 * dispersión de los tres últimos meses es **0,06 %**, así que cualquier banda razonable
 * se los tragaba a los tres. **El color de valle existía en la leyenda y ningún periodo
 * lo recibía.**
 *
 * **EL EMPATE SE RESUELVE POR CONSTRUCCIÓN, y no por suerte.** Agosto y septiembre
 * valen 639 600 exactos: los dos SON el mínimo, luego los dos son valle. Una regla por
 * POSICIÓN —«el último es el valle»— pintaría uno de cada color con el mismo número
 * debajo. El empate ya aparece en los datos reales; no hay que fabricarlo para probarlo.
 *
 * **EL COSTO, dicho:** con mín/máx puro la tarjeta marca extremos aunque la diferencia
 * sea de 400 piezas. Es aceptable porque pico y valle pasan a ser **hechos ordinales**
 —cuál es el mayor, cuál el menor— y no afirmaciones de magnitud: **la magnitud ya la
 * dicen la altura de la barra y la cifra escrita encima**. No se añade un umbral mínimo
 * de diferencia sin que se pida; sería volver a la regla que se acaba de retirar.
 */
export function nivelDeBarra(indice: number, valores: number[]): NivelTendencia {
  if (!hayCategorias(valores)) return "medio";
  const v = valores[indice];
  if (v === Math.max(...valores)) return "pico";
  if (v === Math.min(...valores)) return "valle";
  return "medio";
}

/**
 * El tono de una barra por su nivel.
 *
 * **El MEDIO conserva el acento que el tablero ya pintaba** —el azul que ya se
 * reconoce— y no estrena token. El PICO es un azul más fuerte; el VALLE, un GRIS.
 *
 * **El gris no es una preferencia: es lo que queda cuando se descartan los demás
 * midiendo.** El naranja que se ofrecía ya significa «sobre-reservado» en la tarjeta
 * de al lado, y el verde es identidad de KAM y «Disponible» en el riel. Además el gris
 * es **neutro en valencia**, que aquí hace falta: nadie ha decidido si mucho stock es
 * bueno o es capital parado, así que el color no debe decirlo.
 *
 * El énfasis se invierte con el tema, igual que las rampas: el pico es el de MÁS
 * contraste contra la tarjeta y el valle el de menos.
 */
export function tonoDeNivel(n: NivelTendencia): string {
  if (n === "pico") return "--mx-graf-azul-pico";
  if (n === "valle") return "--mx-graf-gris-valle";
  return "--mx-accent";
}

/** Los tres niveles, en el orden en que se leen: de más a menos. */
export const NIVELES: readonly NivelTendencia[] = ["pico", "medio", "valle"] as const;

/** El rótulo de cada nivel en la referencia de color. */
export function rotuloDeNivel(n: NivelTendencia): string {
  return n === "pico" ? "Pico" : n === "valle" ? "Valle" : "Medio";
}
/** Lo que ocupa `«abr 2026»` a 10 px en la fuente mono, con su respiro. */
export const ANCHO_MINIMO_ROTULO = 44;

/**
 * [DASH-F · D-1] LAS BARRAS, EN PÍXELES, DESDE CERO.
 *
 * **La escala incluye el cero a propósito, y eso cambia lo que la tarjeta
 * afirma.** La línea que había aquí usaba `dominioDe(valores)` SIN cero: se
 * normalizaba entre el mínimo y el máximo de la propia serie, así que una
 * variación del 9 % ocupaba todo el alto del dibujo y se leía como un desplome.
 * Una barra no puede hacer eso: su longitud ES la magnitud, y una barra que
 * arranca en un piso ≠ 0 es el ejemplar clásico de gráfica que miente.
 *
 * El costo hay que decirlo porque es real y se ve: con una serie de ejemplo —700 000 · 640 000 · 639 600 · 639 600— las tres últimas barras
 * difieren en **0,2 px sobre 288**. A ojo son la misma barra. Eso NO es un
 * defecto del dibujo: el stock no se movió de julio a septiembre, y la línea lo
 * estaba dramatizando. Lo que el aplanamiento cuesta se paga con la cifra
 * escrita encima de cada barra, no torciendo la escala.
 *
 * No hay una quinta implementación de nada: el dominio y el mapeo son los de
 * `escala.ts`, que es donde vive el denominador.
 */
export function construirBarras(valores: number[], alto: number): number[] {
  if (valores.length === 0) return [];
  const px = escalaLineal(dominioDe(valores, { incluirCero: true }), 0, alto);
  return valores.map((v) => {
    const h = px(v);
    if (v > 0) return Math.max(MIN_BARRA_VISIBLE, h);
    return Math.max(0, h);
  });
}

/**
 * Cada cuántos periodos se rotula, para que dos rótulos NO se solapen nunca.
 *
 * Se deriva del ancho más ANGOSTO que se soporta, no del que toca hoy: el
 * componente no sabe a qué ancho lo van a pintar, así que un paso calculado
 * contra 1280 dejaría el caso de 390 sin cubrir — «medir las orillas no es medir
 * la banda» aplicado a un eje que aquí sí es discreto.
 */
export function pasoRotulos(n: number, anchoUtil = ANCHO_CHART_ANGOSTO): number {
  if (n <= 1) return 1;
  const caben = Math.max(1, Math.floor(anchoUtil / ANCHO_MINIMO_ROTULO));
  return Math.max(1, Math.ceil(n / caben));
}

/** Cómo se rotula un punto: su periodo y **cuántos cortes resume**. [DASH-D · D-2] */
export function rotuloPunto(p: TendenciaPunto): string {
  return `${formatoPeriodoCorto(p.periodo)} · ${cortesDe(p)}`;
}

/** Solo la parte de cortes, que en la gráfica de barras viaja en su propio renglón. */
export function cortesDe(p: TendenciaPunto): string {
  return `${p.cortes} ${p.cortes === 1 ? "corte" : "cortes"}`;
}

/**
 * Variación del primer al último periodo. PURA.
 *
 * [DASH-D · D-2] Es la «estadística básica» que el dato sostiene con N=3, y no
 * hay ML que valga aquí: la serie es `{periodo, piezas}` sin una sola covariable.
 *
 * Devuelve `null` con base 0 **a propósito**: 0 → 100 no es «+100 %» ni «+∞ %».
 * Es la misma regla de «solo honestos» que ya gobierna el delta de
 * `piezas_en_camino` (`dashboard.service.ts`), aplicada aquí.
 *
 * [DASH-F · D-1] **Sigue siendo cierta con barras, y no por suerte**: el texto
 * nombra sus dos extremos («de abr 2026 a sep 2026»), así que afirma una
 * diferencia entre dos puntos y NO una tendencia monótona. Con la línea eso era
 * una sutileza; con barras, donde el ojo compara cada par, es la diferencia
 * entre un pie verdadero y uno que el dibujo desmiente.
 */
export function variacionSerie(puntos: TendenciaPunto[]): { texto: string } | null {
  if (puntos.length < 2) return null;
  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const desdeHasta = `de ${formatoPeriodoCorto(primero.periodo)} a ${formatoPeriodoCorto(ultimo.periodo)}`;

  if (primero.piezas === ultimo.piezas) return { texto: `Sin cambio ${desdeHasta}` };
  if (primero.piezas === 0) return null;

  const pct = ((ultimo.piezas - primero.piezas) / primero.piezas) * 100;
  const verbo = pct > 0 ? "Subió" : "Bajó";
  return { texto: `${verbo} ${Math.abs(pct).toFixed(1)} % ${desdeHasta}` };
}

/**
 * "Tendencia de stock": con ≥2 periodos dibuja una BARRA POR PERIODO, con su
 * cifra encima y su periodo + cortes debajo. Con <2 periodos, estado inline
 * honesto en vez de una gráfica de una sola barra. La nota "{n} periodos de
 * historial" viaja SIEMPRE, en ambas ramas: la UI no debe insinuar más historial
 * del que hay. Cada barra declara CUÁNTOS cortes resume — un punto de 1 corte y
 * uno de 9 no son el mismo punto, y la cadencia de la ingesta es en racimos.
 * Sin CTA/link: este widget no navega a nada en v1.
 *
 * [DASH-F · D-1] Era una polilínea de 80 px de alto con los extremos rotulados,
 * dentro de una tarjeta que el radar estiraba a 488 px. Los 240,5 px muertos de
 * abajo son los que ocupa ahora la gráfica. Lo que se GANA no es solo tamaño:
 * con una línea los periodos intermedios no tenían rótulo, y con 4 puntos de
 * cadencia irregular —abr, jul, ago, sep— una línea insinúa además una
 * continuidad entre ellos que el dato no tiene.
 *
 * **No hay SVG.** Las barras son cajas del documento, así que sus cifras y sus
 * periodos son TEXTO REAL: se seleccionan, se leen con un lector de pantalla y
 * no dependen de un `viewBox`. El SVG anterior además traía
 * `preserveAspectRatio="none"` — 400 × 110 estirado a 502 × 80 — o sea que el
 * dibujo se deformaba con el ancho.
 */
export function DashboardTendenciaCard({ tendencia }: DashboardTendenciaProps) {
  const ultimo = tendencia.length > 0 ? tendencia[tendencia.length - 1] : null;
  const hayGrafica = tendencia.length >= 2;
  const piezas = tendencia.map((p) => p.piezas);
  const alturas = hayGrafica ? construirBarras(piezas, ALTO_BARRAS) : [];
  const paso = pasoRotulos(tendencia.length);
  const variacion = variacionSerie(tendencia);

  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-1.5 flex items-center gap-2.5">
        <TrendingUp className="h-[18px] w-[18px] text-brand" strokeWidth={1.8} aria-hidden="true" />
        <h2 className="text-[14.5px] font-semibold text-ink">Tendencia de stock</h2>
      </div>

      {ultimo ? (
        <div className="mb-2.5 flex items-baseline gap-2.5">
          <span className="font-mono text-[26px] font-bold tracking-tight text-ink">{formatoNumero(ultimo.piezas)}</span>
          <span className="text-[12px] font-semibold text-ink-muted">{formatoPeriodoCorto(ultimo.periodo)}</span>
        </div>
      ) : (
        <div className="mb-2.5 font-mono text-[26px] font-bold tracking-tight text-ink-muted">—</div>
      )}

      {hayGrafica ? (
        <div data-tendencia-barras="">
          {/* Las barras. `items-end` las asienta todas sobre la misma base, que es el cero. */}
          <div className="flex items-end gap-1.5" style={{ height: `${ALTO_PISTA}px` }}>
            {tendencia.map((p, i) => {
              // [DASH-F · D-7b] El nivel se decide UNA VEZ y de aquí leen el color, el
              // `data-nivel` y el `title`. Derivarlo tres veces serían tres verdades
              // sobre lo mismo esperando a divergir — así nacieron las cuatro
              // implementaciones de `piezas_en_camino` en este repo.
              const nivel = nivelDeBarra(i, piezas);
              return (
              <div key={p.periodo} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <span
                  className="shrink-0 truncate text-center font-mono text-[10px] leading-none text-ink-muted"
                  style={{ height: `${ALTO_CIFRA}px` }}
                  title={formatoNumero(p.piezas)}
                >
                  {formatoNumero(p.piezas)}
                </span>
                {/*
                  `shrink-0` no es defensivo por gusto: sin él, flex reparte el
                  desborde de la columna encogiendo LA BARRA, y el alto pintado
                  deja de ser el que la función pura calculó. Con él, un desborde
                  se ve como un desborde en vez de falsificar la proporción en
                  silencio.
                */}
                {/*
                  [DASH-F · D-6] `max-w` + `self-center`: el tope de ancho, y la barra
                  centrada en su ranura. `w-full` sigue puesto para que por debajo del
                  tope la barra siga llenando su banda — el tope es un MÁXIMO, no un
                  ancho fijo, y por eso deja de actuar solo en cuanto hay puntos de
                  sobra.

                  [DASH-F · D-5] SIN MODIFICADOR DE OPACIDAD, y no es cosmética.

                  Esto decía `bg-brand/85`, y `bg-brand` cuelga de `var(--mx-accent)`,
                  que es un color COMPLETO. Tailwind no puede inyectarle un alfa
                  —necesitaría los canales sueltos— así que **no emite la utilidad en
                  absoluto**: no queda una declaración inválida, queda NINGUNA. La caja
                  conservaba su alto, su ancho, su sitio y su tooltip, y salía
                  transparente. Se dijo dos veces antes de que nadie lo midiera.

                  Medido el 17-sep en el CSS generado: `.bg-brand\/85` **no existe**, y
                  `.bg-primary\/10` —que cuelga de `hsl(var(--primary))`, canales— sí.
                  Ésa es toda la diferencia.

                  Si alguna vez hace falta atenuarla, se hace con un TOKEN propio, no
                  con un modificador que sobre esta familia no aplica.
                */}
                <div
                  data-barra=""
                  data-nivel={nivel}
                  className="w-full shrink-0 self-center rounded-t-[3px]"
                  style={{
                    height: `${alturas[i].toFixed(1)}px`,
                    maxWidth: `${TOPE_ANCHO_BARRA}px`,
                    backgroundColor: `var(${tonoDeNivel(nivel)})`,
                  }}
                  title={`${formatoPeriodoCorto(p.periodo)}: ${formatoNumero(p.piezas)} piezas · ${cortesDe(p)}${
                    hayCategorias(piezas) ? ` · ${rotuloDeNivel(nivel).toLowerCase()}` : ""
                  }`}
                />
              </div>
              );
            })}
          </div>
          {/* Los rótulos, en su propia fila y con las MISMAS pistas que las barras. */}
          <div className="mt-1.5 flex gap-1.5">
            {tendencia.map((p, i) => (
              <div key={p.periodo} className="min-w-0 flex-1 text-center">
                {i % paso === 0 || i === tendencia.length - 1 ? (
                  <>
                    <span className="block truncate font-mono text-[10.5px] leading-tight text-ink-2">{formatoPeriodoCorto(p.periodo)}</span>
                    <span className="block truncate font-mono text-[10px] leading-tight text-ink-muted">{cortesDe(p)}</span>
                  </>
                ) : (
                  <span className="sr-only">{rotuloPunto(p)}</span>
                )}
              </div>
            ))}
          </div>

          {/*
            [DASH-F · D-7] LA REFERENCIA DE COLOR: pico, medio y valle.

            **Es una escala de NIVEL, no de dirección, y se corrigió mirando.**
            D-6 había entendido «tendencia al alza» como *subió respecto al mes
            anterior*, y lo que se pedía era otra cosa: en qué nivel está cada mes
            respecto al resto de la serie. Un mes puede haber bajado y seguir siendo un
            pico.

            **VALLE se nombra aunque hoy no aparezca ninguno.** Una referencia de color
            explica la escala completa; enseñar solo los niveles que hoy ocurren haría
            que la leyenda cambiara de forma con cada ingesta, y entonces no sería una
            referencia.

            Los recuadros van `aria-hidden` y el sentido viaja en el texto de al lado,
            que es lo que un lector de pantalla lee; y cada barra lleva además su nivel
            escrito en el `title`.
          */}
          {hayCategorias(piezas) && (
          <div data-leyenda-tendencia="" className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {NIVELES.map((n) => (
              <span key={n} className="inline-flex items-center gap-1.5 text-[10.5px] text-ink-2">
                <span
                  data-muestra={n}
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: `var(${tonoDeNivel(n)})` }}
                />
                {/*
                  El rótulo va en su PROPIO `<span>` y no suelto junto al recuadro: la
                  guarda de E-5 —«la tarjeta no puede decir más de lo que el dato
                  trae»— enumera los nodos de TEXTO sin hijos elemento, así que un
                  texto que comparte padre con el recuadro le sería invisible. Medido:
                  con el rótulo suelto, la guarda veía uno de los tres textos de esta
                  leyenda. Una guarda que no ve lo que se añade no puede impedir que se
                  añada de más.
                */}
                <span>{rotuloDeNivel(n)}</span>
              </span>
            ))}
            <span className="text-[10.5px] text-ink-muted">el mes más alto y el más bajo del historial mostrado</span>
          </div>
          )}
        </div>
      ) : (
        <p className="rounded-[9px] bg-surface-input px-3 py-2.5 text-[12.5px] text-ink-2">
          Aún no hay suficiente historial — vuelve tras la próxima ingesta.
        </p>
      )}

      {variacion && <p className="mt-2.5 text-[12px] font-medium text-ink-2">{variacion.texto}</p>}

      <p className="mt-1.5 text-[11.5px] text-ink-muted">
        {tendencia.length} {tendencia.length === 1 ? "periodo de historial" : "periodos de historial"}
      </p>
    </div>
  );
}
