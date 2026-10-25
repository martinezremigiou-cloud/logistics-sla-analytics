// ============================================================
// Bloque 4 · F3 Catálogo · formato.ts  (100% PURO)
// Helpers de formato es-MX compartidos por las vistas del catálogo
// (y reutilizables por fases futuras: Ficha SKU, El Cruce, etc.).
// ============================================================

/**
 * [MVP-CIERRE · F6] UNA SOLA VERDAD TEMPORAL: todo lo que se le muestra a
 * un humano se renderiza en la zona del negocio, no en la del runtime.
 *
 * El problema medido: el Dashboard decía un "corte" de un día y el badge de
 * frescura el día anterior — el MISMO dato. Dos causas distintas:
 *
 *   · el Dashboard pasaba un TIMESTAMP a `formatoFecha`, que está hecho
 *     para valores date-only y pinea UTC: un corte de las 20:00 CDMX es
 *     02:00 UTC del día siguiente, así que se pintaba un día adelante.
 *   · el badge tenía su PROPIO `Intl.DateTimeFormat` sin `timeZone`, o sea
 *     la zona del runtime: en un navegador en México daba el día correcto (por
 *     accidente) y en un servidor UTC habría dado un día adelante.
 *
 * Cualquier superficie que pinte una fecha a partir de las 18:00 México
 * queda un día adelante si se renderiza en UTC. Por eso la zona se declara
 * aquí una vez y se usa en todos los helpers, en vez de depender de dónde
 * corra el código.
 *
 * NOTA sobre `formatoFecha`: sigue pineado a UTC A PROPÓSITO, y no es una
 * excepción a esta regla — es la misma regla aplicada a otro tipo de dato.
 * Sus valores son date-only (`YYYY-MM-DD`, sin hora): `new Date('2026-07-12')`
 * es medianoche UTC, y renderizarlo en México lo correría un día HACIA
 * ATRÁS. Un valor sin hora no tiene zona; pinear UTC es lo que lo deja
 * intacto.
 */
export const ZONA_MEXICO = 'America/Mexico_City';

/** Formatea un entero/decimal con separador de miles es-MX (1234567 → "1,234,567"). */
export function formatoNumero(n: number): string {
  return new Intl.NumberFormat('es-MX').format(n);
}

/**
 * Formatea una fecha ISO en es-MX ("12 jul 2026"). `null` → "—".
 *
 * Los callers de este helper (`eta`, `fecha_disponibilidad`,
 * `reservas.fecha`, etc.) son SIEMPRE date-only `YYYY-MM-DD` — `new
 * Date('YYYY-MM-DD')` los interpreta como medianoche UTC. Sin
 * `timeZone: 'UTC'` aquí, `Intl.DateTimeFormat` renderiza en la zona
 * local del runtime (UTC-6 en México), lo que corre el día mostrado un
 * día hacia atrás (off-by-one). `formatoFechaHora` NO usa este fix:
 * recibe timestamps reales (con hora), donde el render en zona local
 * SÍ es el comportamiento correcto.
 */
export function formatoFecha(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

/**
 * Fecha + hora de un TIMESTAMP real, en es-MX y zona México
 * ("12 jul 2026, 09:30 a.m."). `null` → "—".
 *
 * (F6) Antes no declaraba `timeZone` y renderizaba en la zona del runtime:
 * el mismo timestamp se veía distinto en el servidor (UTC en Vercel) y en
 * un navegador en México. Ahora la zona es del DATO mostrado, no de dónde
 * corra el render.
 */
export function formatoFechaHora(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA_MEXICO,
  }).format(new Date(iso));
}

/**
 * (F6) Solo el DÍA de un TIMESTAMP real, en zona México ("12 jul 2026").
 *
 * Existe porque faltaba: `formatoFecha` es para date-only (pinea UTC) y
 * `formatoFechaHora` trae la hora. El Dashboard quiere "el día del corte" a
 * partir de un `created_at`, y al no haber helper para eso usaba el de
 * date-only — que es exactamente de dónde salía el día adelantado.
 */
export function formatoFechaDeTimestamp(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: ZONA_MEXICO,
  }).format(new Date(iso));
}

/**
 * (F6) Día + hora SIN año, en zona México ("31 jul, 02:02 p.m.") — para el
 * indicador de frescura, donde el año es ruido.
 *
 * Vive aquí y no en el componente: tener un `Intl.DateTimeFormat` suelto en
 * `freshness-indicator.tsx` fue la mitad de la divergencia de F6. Una sola
 * verdad temporal exige una sola casa.
 */
export function formatoFechaHoraCorta(iso: string | null): string {
  if (iso === null) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA_MEXICO,
  }).format(new Date(iso));
}

/**
 * Formatea un periodo `'YYYY-MM'` en es-MX corto ("abr 2026"). Promovido
 * desde `components/dashboard/dashboard-formato.ts` (fix M7, ronda 2 de
 * revisor-codigo): originalmente exclusivo del Dashboard (Bloque 6, F3),
 * pero `components/snapshots/**` (Bloque 7-A) también lo necesita —
 * importarlo cruzando de `snapshots/` a `dashboard/` era un acoplamiento
 * entre features. Vive aquí junto a `formatoFecha`/`formatoFechaHora`
 * (mismo criterio: helper de formato puro, sin JSX, compartido entre
 * features).
 *
 * Construye la fecha con `Date.UTC` + `timeZone: 'UTC'` (mismo motivo que
 * `formatoFecha`: evitar el off-by-one de zona horaria que movería el mes
 * mostrado si el runtime no está en UTC).
 */
export function formatoPeriodoCorto(periodo: string): string {
  const [anioStr, mesStr] = periodo.split('-');
  const anio = Number(anioStr);
  const mesIndex = Number(mesStr) - 1;
  // (F6) UTC deliberado, misma razón que `formatoFecha`: aquí el dato es
  // un periodo `YYYY-MM` sin hora ni zona. Pinearlo a México lo correría al
  // mes anterior.
  const fecha = new Date(Date.UTC(anio, mesIndex, 1));
  return new Intl.DateTimeFormat('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(fecha);
}
