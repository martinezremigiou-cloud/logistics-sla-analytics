// ============================================================
// [2.0.1-B · S-1] portada-proyecto.tsx — la ilustración de la tarjeta y la del
// zoom. **Puramente decorativa: `aria-hidden`.**
//
// ────────────────────────────────────────────────────────────
// POR QUÉ SON DOS SVG LITERALES Y NO UNO ESCALADO.
//
// `380×140` y `760×280` son exactamente 2×, y la tentación es evidente: un solo
// SVG con `viewBox` variable. **No lo son por dentro.** El expediente de la
// tarjeta arranca en `translate(24,20)` y el del zoom en `translate(52,38)`;
// 24×2 = 48, no 52. La maqueta ajustó a mano una docena de números, y
// «simplificar» a un escalado cambiaría el dibujo aprobado sin que nadie lo
// pidiera. Se copian los dos tal cual salieron de la maqueta
// viva (la que la especificación marca como referencia principal; la
// «definitiva» difiere y NO es la buena).
//
// ────────────────────────────────────────────────────────────
// EL TINTE VA CON `fill-opacity`, NO CON UN COLOR MEZCLADO.
//
// La maqueta compone el tinte concatenando alfa al hex (`color + '1F'`). Con un
// token CSS eso no se puede: `var(--x) + '1F'` no existe. En SVG no hace falta —
// `fill-opacity` da el mismo resultado sin inventar un color— y este repo no
// tiene un solo `color-mix` hoy, así que introducirlo aquí sería estrenar una
// técnica en el sitio donde menos se puede verificar.
// ============================================================
import { COLOR_PROYECTO, simboloDe } from "./apariencia-proyecto";

interface PortadaProps {
  /** El identificador del símbolo. Hoy siempre el de por defecto; en S-2, el de la columna. */
  simbolo?: string | null;
}

interface PortadaTarjetaProps extends PortadaProps {
  /**
   * Recorta la portada a una banda de 72 px en vez de dejar que el alto siga al
   * ancho. **Es lo que permite que la tarjeta tenga alto FIJO donde el ancho no
   * lo es.**
   *
   * En la pasarela la tarjeta mide 320 px de ancho, así que la portada mide
   * siempre 140 × 320/380 ≈ 118 px y el alto de la tarjeta se puede fijar. En la
   * lista vertical la tarjeta es `w-full`: la portada crecería con la pantalla y
   * el alto de la tarjeta dejaría de ser un número — con lo que su esqueleto no
   * podría igualarlo y volvería el salto de la carga, que es el defecto que S-1
   * vino a matar. `slice` recorta en vez de escalar, y el dibujo tiene su
   * interés en el centro.
   */
  compacta?: boolean;
}

/** La portada de la tarjeta de la pasarela y de la lista. `viewBox 0 0 380 140`. */
export function PortadaTarjeta({ simbolo, compacta = false }: PortadaTarjetaProps) {
  const trazo = simboloDe(simbolo);
  return (
    <svg
      viewBox="0 0 380 140"
      aria-hidden="true"
      preserveAspectRatio={compacta ? "xMidYMid slice" : undefined}
      className={compacta ? "block h-[72px] w-full" : "block h-auto w-full"}
    >
      <rect width="380" height="140" fill={COLOR_PROYECTO} fillOpacity="0.12" />
      <path d="M0 140 L122 0 M44 140 L166 0 M88 140 L210 0" stroke={COLOR_PROYECTO} strokeOpacity="0.09" strokeWidth="16" />
      <g transform="translate(24,20)">
        <rect x="0" y="0" width="70" height="98" rx="4" fill="var(--mx-surface)" stroke={COLOR_PROYECTO} strokeOpacity="0.34" />
        <path d="M53 0 h17 v17 z" fill={COLOR_PROYECTO} fillOpacity="0.18" />
        <rect x="11" y="28" width="48" height="4.5" rx="2.25" fill={COLOR_PROYECTO} fillOpacity="0.22" />
        <rect x="11" y="42" width="34" height="4.5" rx="2.25" fill={COLOR_PROYECTO} fillOpacity="0.22" />
        <rect x="11" y="56" width="44" height="4.5" rx="2.25" fill={COLOR_PROYECTO} fillOpacity="0.22" />
        <rect x="11" y="70" width="26" height="4.5" rx="2.25" fill={COLOR_PROYECTO} fillOpacity="0.22" />
      </g>
      <g transform="translate(262,28)">
        <circle cx="41" cy="41" r="41" fill={COLOR_PROYECTO} fillOpacity="0.13" />
        <g
          transform="translate(19,19) scale(1.85)"
          fill="none"
          stroke={COLOR_PROYECTO}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={trazo.d} />
        </g>
      </g>
    </svg>
  );
}

/** La portada del zoom. `viewBox 0 0 760 280`, con sus propios números. */
export function PortadaZoom({ simbolo }: PortadaProps) {
  const trazo = simboloDe(simbolo);
  return (
    <svg viewBox="0 0 760 280" aria-hidden="true" className="block h-auto w-full">
      <rect width="760" height="280" fill={COLOR_PROYECTO} fillOpacity="0.12" />
      <path d="M0 280 L244 0 M88 280 L332 0 M176 280 L420 0" stroke={COLOR_PROYECTO} strokeOpacity="0.09" strokeWidth="30" />
      <g transform="translate(52,38)">
        <rect x="0" y="0" width="146" height="200" rx="7" fill="var(--mx-surface)" stroke={COLOR_PROYECTO} strokeOpacity="0.34" />
        <path d="M110 0 h36 v36 z" fill={COLOR_PROYECTO} fillOpacity="0.18" />
        <rect x="22" y="56" width="84" height="8" rx="4" fill={COLOR_PROYECTO} fillOpacity="0.85" />
        <rect x="22" y="80" width="100" height="6" rx="3" fill={COLOR_PROYECTO} fillOpacity="0.2" />
        <rect x="22" y="96" width="72" height="6" rx="3" fill={COLOR_PROYECTO} fillOpacity="0.2" />
        <rect x="22" y="112" width="92" height="6" rx="3" fill={COLOR_PROYECTO} fillOpacity="0.2" />
        <rect x="22" y="142" width="100" height="6" rx="3" fill={COLOR_PROYECTO} fillOpacity="0.14" />
        <rect x="0" y="186" width="146" height="14" fill={COLOR_PROYECTO} fillOpacity="0.9" />
      </g>
      <g transform="translate(506,50)">
        <circle cx="90" cy="90" r="90" fill={COLOR_PROYECTO} fillOpacity="0.12" />
        <g
          transform="translate(42,42) scale(4)"
          fill="none"
          stroke={COLOR_PROYECTO}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={trazo.d} />
        </g>
      </g>
    </svg>
  );
}
