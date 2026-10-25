import { Fragment } from "react";
import { Users } from "lucide-react";
import { formatoNumero } from "@/lib/formato";
import type { DashboardReservasKam } from "@/types/api";

export interface DashboardReservasKamProps {
  /**
   * Ya ordenado y con el bucket `kam:null` garantizado por `dashboard.service.ts`
   * cuando existen reservas sin KAM — **y con su denominador**.
   *
   * Recibe el OBJETO y no el arreglo a propósito, igual que el radar: pegado al dato,
   * `total_kams` y `total_piezas` no se pueden perder en el camino.
   */
  reservas: DashboardReservasKam;
}

/**
 * El tono del cúmulo: **seis pasos de un verde, y es decisión de producto firmada**
 * (17-sep-2026, DASH-F · D-2). Su motivo: el morado no comparte con ningún otro
 * componente del sistema.
 *
 * **El riesgo se dijo antes de firmar y se decidió con él sobre la mesa:** el
 * sistema ya tiene un verde con significado —`--mx-graf-jade`, «Disponible» en el
 * Pipeline, **en la misma pantalla**—. Por eso la rampa no se eligió a ojo: se
 * derivó exigiendo, entre otras cosas, que **ningún paso quede más cerca de otro
 * significado de la pantalla de lo que están entre sí los dos tonos más parecidos
 * del riel**, que ya se aceptaron como distinguibles. Ese umbral y los otros cinco
 * criterios, con sus cifras medidas, viven en `globals.css` junto a los tokens.
 *
 * Y la separación **no se midió solo contra jade**: se nombró «Disponible»
 * porque es el que vino a la cabeza, pero la condición real es que una burbuja
 * no se lea como NINGÚN otro significado — así que se midió también contra el
 * ámbar del faltante, el verde de estado y los seis tonos del riel.
 *
 * La rampa `--mx-graf-violeta-1..6` queda declarada en `globals.css` y **sin uso**.
 * Su retiro es deuda con disparador: quitar doce tokens de un archivo compartido
 * mientras tres frentes comitean es arriesgar un rojo ajeno por limpieza.
 */
export const RAMPA_RESERVAS = [
  "--mx-graf-verde-1",
  "--mx-graf-verde-2",
  "--mx-graf-verde-3",
  "--mx-graf-verde-4",
  "--mx-graf-verde-5",
  "--mx-graf-verde-6",
] as const;

/**
 * El bucket «Sin KAM» **no toma paso de la rampa, y no es un descuido**.
 *
 * La rampa codifica el RANGO entre KAM. «Sin KAM» no es un KAM peor ni mejor: es la
 * AUSENCIA de uno. Darle un paso diría que está ranqueado. Va en neutro —
 * `--mx-muted`, **4,76:1 contra la superficie de la tarjeta**, frente al **1,36:1**
 * del `--mx-muted-3` que usaba la barra anterior (M-7a, cerrado sin token nuevo).
 */
export const TONO_SIN_KAM = "--mx-muted";

/**
 * El tono de un ítem: su paso de rampa por posición, o el neutro si es el bucket nulo.
 *
 * `items` viene ordenado por piezas DESC del servicio, así que **el índice ES el
 * rango**. Nunca puede haber más de 6 KAM con nombre —`slice(0, 6)` lo garantiza—,
 * así que la rampa no se queda corta; el 7.º ítem posible es el bucket nulo, que no
 * usa rampa.
 */
export function tonoDeRango(indice: number, esBucketNulo: boolean): string {
  if (esBucketNulo) return TONO_SIN_KAM;
  return RAMPA_RESERVAS[Math.min(indice, RAMPA_RESERVAS.length - 1)];
}

/**
 * La tinta de la cifra que va DENTRO de la burbuja, por paso.
 *
 * Los cinco primeros pasos llevan tinta de superficie; **el sexto la voltea** a
 * `--mx-text`. No es una preferencia: es lo que la derivación midió — a partir de ahí
 * el relleno es demasiado claro (en tema claro) o demasiado oscuro (en oscuro) para
 * que la tinta de superficie alcance 4,5:1. **Y el volteo ocurre en el mismo paso en
 * los dos temas**, así que no hace falta ninguna variante `dark:`.
 */
export function tintaDelPaso(indice: number): string {
  return indice >= RAMPA_RESERVAS.length - 1 ? "--mx-text" : "--mx-surface";
}

/**
 * [DASH-F · D-3] El ANCHO de la barra de la leyenda, en PORCENTAJE de su pista.
 *
 * El denominador es el MAYOR de la serie, no el total: la barra contesta «¿cuánto
 * tiene éste comparado con el que más tiene?», que es la pregunta que el ojo hace
 * mirando una lista ordenada. Con el total, todas las barras se aplastarían contra
 * el borde izquierdo — el mayor suele ser una fracción grande del total.
 */
export function anchoDeBarra(piezas: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, (piezas / max) * 100);
}

/**
 * El MÍNIMO VISUAL, en píxeles, para que una barra de valor > 0 no desaparezca.
 *
 * Declarado y no negociado: una serie típica va de decenas de miles a poco más de mil, un factor de
 * **~40×**, así que el menor mide ~2,5 % de la pista. **No se estira la escala
 * para que se vea** —eso sería mentir sobre la proporción, que es justo lo que una
 * barra existe para afirmar—: se le garantiza un mínimo y se dice cuál es.
 *
 * Medido con datos reales: **este mínimo no llega a actuar**. La
 * pista más angosta que se midió son ~190 px a 390 de viewport, y el 2,5 % de eso
 * son ~4,8 px, por encima del mínimo. Está para el día que la dispersión crezca.
 */
export const MIN_BARRA_LEYENDA = 2;

/** Tamaño de la cifra dentro de la burbuja, en unidades del `viewBox`. */
const TAM_CIFRA = 11;

/**
 * ¿Cabe la cifra DENTRO de la burbuja?
 *
 * Aritmética, no ojo: una cifra monoespaciada de `n` caracteres a tamaño `T` mide
 * ≈ `n · 0,62 · T` de ancho, y dentro de un círculo de radio `r` la cuerda utilizable
 * a la altura del texto es ≈ `1,7 · r`. De ahí sale **`r ≥ n · 4,01`**.
 *
 * Con el reparto real eso deja la cifra dentro de las cuatro mayores y fuera de las
 * dos chicas — y **las seis siguen escritas en la leyenda**, que es donde vive la
 * magnitud completa. La burbuja carga el ranking; la etiqueta, el número.
 */
export function cabeLaCifra(radio: number, caracteres: number): boolean {
  return caracteres * 0.62 * TAM_CIFRA <= 1.7 * radio;
}

export interface Burbuja {
  cx: number;
  cy: number;
  r: number;
}

/**
 * El radio de una burbuja: **ÁREA proporcional a las piezas**, o sea radio
 * proporcional a la RAÍZ.
 *
 * **Es la decisión entera del carril.** El error clásico de la burbuja es poner el
 * RADIO proporcional al valor: eso hace que el área crezca con el cuadrado y exagere
 * el rango en vez de comprimirlo. Con un reparto disperso —~40× entre el mayor y el
 * menor— la codificación correcta lo deja en **√40 ≈ 6,3×**, y por eso el menor
 * (~1 % del total) sale **visible sin ningún piso**: ~9,8 px de radio.
 *
 * Y ahí está el cambio respecto de las barras: la barra necesitaba
 * `Math.max(5, …)` para que el más chico se viera, y ese piso lo **exageraba ~2×**.
 * **La burbuja no necesita mentir para que se vea el más chico.**
 *
 * **Cero piezas → radio CERO.** Un mínimo le inventaría una magnitud; el KAM se
 * nombra en la leyenda con su cero, que es «cero visible, no fabricado» aplicado al
 * área.
 */
export function radioDeBurbuja(piezas: number, maxPiezas: number, radioMax: number): number {
  if (piezas <= 0 || maxPiezas <= 0) return 0;
  return radioMax * Math.sqrt(piezas / maxPiezas);
}

/**
 * Coloca las burbujas en cúmulo: la mayor en el centro y las demás **tangentes a
 * ella**, repartidas por el ángulo que cada una ocupa.
 *
 * Una burbuja de radio `r` tangente a otra de radio `R` abarca un semiángulo de
 * `asin(r / (R + r))` visto desde el centro. Avanzando el ángulo por la suma de los
 * semiángulos de cada par consecutivo, **dos vecinas nunca se solapan** — no es una
 * separación elegida a ojo, es la condición geométrica exacta.
 *
 * `empaquetar` es PURA y determinista: la misma entrada da la misma salida, porque un
 * cúmulo que se mueve entre renders afirmaría que el dato cambió.
 *
 * **La posición NO significa nada**, y eso hay que decirlo: es empaquetado, no
 * dispersión. Un scatter con dos ejes reales es otro chart y otra pregunta —queda
 * nombrado como `RESERVAS-CONCENTRACION-VS-DISPERSION` y no se cuela como estilo.
 */
export function empaquetar(radios: number[]): Burbuja[] {
  const vivos = radios.filter((r) => r > 0);
  if (vivos.length === 0) return radios.map((r) => ({ cx: 0, cy: 0, r }));

  const [R, ...satelites] = vivos;
  const out: Burbuja[] = [{ cx: 0, cy: 0, r: R }];

  let angulo = 0;
  let previo = 0;
  for (const r of satelites) {
    const semi = Math.asin(r / (R + r));
    angulo += previo + semi;
    previo = semi;
    out.push({ cx: (R + r) * Math.cos(angulo), cy: (R + r) * Math.sin(angulo), r });
  }

  // Los radios 0 van al final, sin sitio propio: no dibujan nada, así que tampoco
  // pueden desplazar a las demás ni reservar hueco.
  for (const r of radios.filter((x) => x <= 0)) out.push({ cx: 0, cy: 0, r });
  return out;
}

/**
 * El rótulo del universo, **derivado del campo y nunca escrito literal**.
 *
 * MEDIDO sobre un corte real: el chart pinta casi todos los KAM y casi todas las piezas
 * — casi la totalidad. Lo que falta es un KAM entero, con muy pocas piezas, que hoy
 * **nadie puede nombrar porque el dato no viajaba**.
 *
 * **El valor de esta línea no está en la fracción mínima de hoy: está en el día que no lo
 * sea.** Y como se deriva, el día que `total_kams === items.length` **se simplifica
 * sola** — no se apaga a mano, que es como se quedan encendidas las frases falsas.
 */
export function rotuloDelUniverso(reservas: DashboardReservasKam): string | null {
  const { items, total_kams, total_piezas } = reservas;
  if (items.length === 0 || total_kams === 0) return null;

  const pintadas = items.reduce((a, i) => a + i.piezas, 0);
  if (total_kams === items.length && total_piezas === pintadas) {
    return `${total_kams} KAM · ${formatoNumero(total_piezas)} piezas`;
  }
  return `${items.length} de ${total_kams} KAM · ${formatoNumero(pintadas)} de ${formatoNumero(total_piezas)} piezas`;
}

const RADIO_MAX = 62;
const MARGEN = 4;

/**
 * "Reservas por KAM" — **cúmulo de burbujas**, área ∝ piezas. [DASH-E · E-6]
 *
 * Sustituye a las barras horizontales, y el motivo es una cifra: con `Math.max(5, …)`
 * la barra del KAM más chico se pintaba al 5 % contra un ~2,5 % real — **exagerada
 * ~2×**. *El piso que protege la visibilidad miente sobre la magnitud.* El área
 * proporcional comprime el rango ~40× en ~6,3× y **el más chico se ve sin piso**.
 *
 * **Lo que la burbuja hace mal, dicho aquí para que nadie lo descubra a golpes:** el
 * ojo humano subestima el área — un círculo con 4× el área no se percibe 4× mayor.
 * **La burbuja carga el RANKING; la etiqueta carga la MAGNITUD**, y por eso la cifra
 * de cada KAM va escrita y no es opcional. Sin ella el chart cambiaría una mentira
 * por otra.
 *
 * El `viewBox` se calcula de la caja real del cúmulo, así que la tarjeta no impone un
 * alto: el dibujo escala al ancho que le den (473,6 px a 1280 con el sidebar
 * expandido · 609,0 colapsado) sin recortar ninguna burbuja.
 */
export function DashboardReservasKamCard({ reservas }: DashboardReservasKamProps) {
  const items = reservas.items;
  const max = Math.max(0, ...items.map((r) => r.piezas));
  const burbujas = empaquetar(items.map((r) => radioDeBurbuja(r.piezas, max, RADIO_MAX)));
  const rotulo = rotuloDelUniverso(reservas);

  // La caja real del cúmulo: sin esto habría que adivinar un `viewBox` y una burbuja
  // podría quedar cortada por el borde sin que nada fallara.
  const vivas = burbujas.filter((b) => b.r > 0);
  const minX = Math.min(...vivas.map((b) => b.cx - b.r), 0) - MARGEN;
  const maxX = Math.max(...vivas.map((b) => b.cx + b.r), 0) + MARGEN;
  const minY = Math.min(...vivas.map((b) => b.cy - b.r), 0) - MARGEN;
  const maxY = Math.max(...vivas.map((b) => b.cy + b.r), 0) + MARGEN;

  return (
    <div className="rounded-2xl border border-line bg-surface p-[18px]">
      <div className="mb-1 flex items-center gap-2.5">
        <Users className="h-[18px] w-[18px]" style={{ color: `var(${RAMPA_RESERVAS[3]})` }} strokeWidth={1.8} aria-hidden="true" />
        <h2 className="text-[14.5px] font-semibold text-ink">Reservas por KAM</h2>
        <span className="ml-auto text-[11.5px] text-ink-muted">piezas reservadas</span>
      </div>

      {rotulo && <p className="mb-2 text-[11px] text-ink-muted">{rotulo}</p>}

      {items.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">Sin reservas registradas.</p>
      ) : (
        <>
          <svg
            viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
            className="block h-auto w-full"
            role="img"
            aria-label={`Reservas por KAM: ${items.map((i) => `${i.kam ?? "sin KAM"} ${formatoNumero(i.piezas)}`).join(", ")}`}
          >
            {burbujas.map((b, i) => {
              if (b.r <= 0) return null;
              const item = items[i];
              const cifra = formatoNumero(item.piezas);
              const tono = tonoDeRango(i, item.kam === null);
              return (
                <g key={item.kam ?? `b-${i}`}>
                  <circle cx={b.cx} cy={b.cy} r={b.r} style={{ fill: `var(${tono})` }} />
                  {cabeLaCifra(b.r, cifra.length) && (
                    <text
                      x={b.cx}
                      y={b.cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={TAM_CIFRA}
                      fontWeight={700}
                      style={{ fill: `var(${item.kam === null ? "--mx-surface" : tintaDelPaso(i)})` }}
                      aria-hidden="true"
                    >
                      {cifra}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* La MAGNITUD vive aquí, no en el área: el ojo subestima el área y la
              etiqueta es la contramedida estándar. Un KAM en cero no dibuja círculo
              y aun así aparece con su cifra — nombrado, no fabricado. */}
          {/*
            [DASH-F · D-3] ES UNA REJILLA, Y NO ES UN DETALLE DE IMPLEMENTACIÓN.

            Antes cada renglón era su propio `flex` con el nombre en `flex-1`. Con una
            barra dentro, eso **rompe la comparación**: la pista de la barra mediría lo
            que sobra DESPUÉS del nombre, así que un KAM de nombre largo tendría una
            pista más corta y su barra no sería comparable con la del vecino. Dos barras
            que no comparten escala no son una gráfica.

            Con `grid`, las cuatro columnas las negocian TODOS los renglones a la vez:
            el nombre toma el ancho del más largo y la pista de la barra es idéntica en
            los seis. `minmax(0, 1fr)` en la columna de la barra hace además que, cuando
            no quepa, se encoja hasta desaparecer ANTES de aplastar el nombre o la
            cifra — que es la condición pedida, sin un solo punto de corte.

            NO LLEVA CARRIL DE FONDO, a propósito: la barra de arriba ocupa siempre la
            columna entera, así que ella ES la referencia de la escala. Un carril añade
            seis rieles grises para decir lo que el primer renglón ya dice.
          */}
          <div
            data-leyenda-kam=""
            className="mt-3 grid grid-cols-[auto_minmax(0,max-content)_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5"
          >
            {items.map((r, indice) => {
              const tono = tonoDeRango(indice, r.kam === null);
              const nombre = r.kam ?? "Sin KAM (directo a cliente)";
              return (
                <Fragment key={r.kam ?? "__sin_kam__"}>
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: `var(${tono})` }}
                  />
                  <span className="min-w-0 truncate text-[12px] font-semibold text-ink-2" title={nombre}>
                    {nombre}
                  </span>
                  {/*
                    La barra dice la MAGNITUD relativa al mayor. Comparte el paso de
                    rampa con su burbuja, así que leyenda y cúmulo afirman lo mismo con
                    el mismo color. `aria-hidden` porque la cifra exacta ya viaja al
                    lado: para un lector de pantalla la barra sería ruido, no dato.
                  */}
                  <span
                    data-barra-kam=""
                    aria-hidden="true"
                    className="h-2 justify-self-start rounded-full"
                    style={{
                      width: `${anchoDeBarra(r.piezas, max)}%`,
                      minWidth: r.piezas > 0 ? `${MIN_BARRA_LEYENDA}px` : 0,
                      backgroundColor: `var(${tono})`,
                    }}
                  />
                  <span className="shrink-0 text-[12px] font-mono font-semibold tabular-nums text-ink">
                    {formatoNumero(r.piezas)}
                  </span>
                </Fragment>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
