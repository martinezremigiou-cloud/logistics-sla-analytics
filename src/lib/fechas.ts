// ============================================================
// Bloque 4 · fechas.ts  (100% PURO, server-safe)
// Derivadores de fecha en zona México para valores de NEGOCIO —no texto de
// pantalla—, compartidos por las fronteras impuras de servicios
// (cruce.service.ts, sku.service.ts, etl/runEtl.ts):
//   · `hoyMexico()`        → 'YYYY-MM-DD' de hoy, para comparar contra `eta`.
//   · `periodoDeCaptura()` → 'YYYY-MM' del corte, a partir de un instante.
//
// Esta es una de las dos CASAS autorizadas para construir un formateador de
// fecha (`una-sola-verdad-temporal.test.ts`, alambre-trampa de F6). La otra
// es `lib/formato.ts`, que es la del texto que ve un humano. La regla que
// ambas cumplen: la zona la fija el DATO y se declara explícitamente, nunca
// se hereda de dónde corra el proceso.
//
// [REPRODUCIBILIDAD · G4] La zona se IMPORTA de `formato.ts` en vez de
// reescribir el literal: había dos `'America/Mexico_City'` sueltos en el
// repo y ese es, exactamente, el germen de la divergencia que F6 vino a
// cerrar. Ahora hay una constante y dos casas que la usan.
// ============================================================
import { ZONA_MEXICO } from './formato';

/**
 * Formateador de fecha CIVIL de México en orden ISO (`YYYY-MM-DD`).
 *
 * `en-CA` es un atajo estable de `Intl` para obtener directamente ese
 * formato sin reordenar day/month/year a mano. Se construye UNA vez:
 * `Intl.DateTimeFormat` es caro y estos helpers corren por petición.
 */
const FECHA_CIVIL_MX = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_MEXICO });

/**
 * Fecha de HOY ('YYYY-MM-DD') en la zona horaria de México
 * (`America/Mexico_City`), NO en UTC ni en la zona local del proceso.
 *
 * Por qué importa: `new Date().toISOString().slice(0, 10)` usa UTC. Un
 * embarque con `eta` = hoy en México NO debe marcarse `retrasado` hasta
 * pasada la medianoche en México — pero hoy, con México 6h detrás de UTC,
 * esa medianoche llega 6h ANTES (a las 18:00 México del día previo), así que
 * entre las 18:00 y las 23:59 (hora México) un servidor en UTC ya "ve" el
 * día siguiente y marcaría retrasos que, para el usuario en México, todavía
 * no ocurren.
 *
 * Ese "6h" describe el desfase de HOY, y no es la razón por la que esto
 * funciona: México tuvo horario de verano hasta oct-2022 y el desfase era de
 * 5h media parte del año. Lo que hace correcto al helper es declarar la ZONA
 * IANA, que conoce cada cambio de regla histórico —medido:
 * `2021-08-01T05:30:00Z` cae en `2021-08-01` en México (UTC-5), no en
 * julio—, no restar un número fijo de horas. Es la misma propiedad que hace
 * que `AT TIME ZONE 'America/Mexico_City'` en SQL dé el mismo resultado que
 * `Intl` aquí: ambos consultan la misma base de datos de zonas.
 */
export function hoyMexico(): string {
  return FECHA_CIVIL_MX.format(new Date());
}

/**
 * [REPRODUCIBILIDAD · G4] Periodo `'YYYY-MM'` de un corte de ingesta: el mes
 * que de verdad era EN MÉXICO en el instante `capturedAt`. PURA — no
 * consulta el reloj, solo su argumento.
 *
 * Es el mismo corrimiento que documenta `hoyMexico`, aplicado a un instante
 * que llega de fuera en vez de al de ahora. La cadena que lo hacía visible:
 *
 *   src/app/api/refresh/archivo/route.ts  capturedAt: new Date().toISOString()
 *   src/services/etl/runEtl.ts (antes)    periodo = capturedAt.slice(0, 7)
 *
 * Recortar el ISO recorta UTC. A partir de las 18:00 CDMX el instante ya
 * cayó en el día UTC siguiente, y si es el último día del mes, en el MES
 * siguiente: dos ingestas reales de un fin de mes, hechas pasadas las 18:00 CDMX, quedaron
 * selladas como `2026-08`. Las corrige la migración 0023.
 *
 * TIENE TRES RAMAS, no dos, y la tercera NO se comporta como la
 * implementación anterior. Decirlo importa porque la que difiere es la que
 * falla en silencio:
 *   1. `''`, `null` o `undefined` → `''`. Igual que antes.
 *   2. texto que V8 no puede parsear (`'no-es-fecha'`, `'x'`,
 *      `'2026-13-99T00:00:00Z'`) → el recorte crudo `slice(0, 7)`, igual que
 *      antes. Nunca lanza; `Intl.format` sobre un `Invalid Date` sí lo haría.
 *   3. ⚠ texto que V8 SÍ parsea pero que no es ISO. Aquí la versión anterior
 *      devolvía basura visible y esta FABRICA UN PERIODO CREÍBLE. Medido:
 *        `'0'`            antes `'0'`        ahora `'2000-01'`
 *        `'2026'`         antes `'2026'`     ahora `'2025-12'`  (!)
 *        `'Dec 25, 2026'` antes `'Dec 25,'`  ahora `'2026-12'`
 *      Un `'2026'` suelto sale como diciembre del año ANTERIOR, porque V8 lo
 *      lee como medianoche UTC del 1-ene y en México eso todavía es el 31 de
 *      diciembre. Ese valor se estamparía en `snapshots.periodo` y en el
 *      relleno `${periodo}-01` de las reservas sin fecha, y nadie lo notaría:
 *      tiene la forma correcta.
 *
 * HOY ES LATENTE, no vivo: la única entrada de producción es
 * `RefreshBody.capturedAt`, con `z.string().datetime()`, que exige RFC 3339 y
 * rechaza las tres formas de arriba antes de llegar aquí. La guarda de forma
 * vive AHÍ, no aquí — y si algún día se añade un llamador que no pase por ese
 * schema, esta rama es la que hay que cerrar primero.
 */
export function periodoDeCaptura(capturedAt: string | null | undefined): string {
  if (!capturedAt) return '';
  const instante = new Date(capturedAt);
  if (Number.isNaN(instante.getTime())) return capturedAt.slice(0, 7);
  return FECHA_CIVIL_MX.format(instante).slice(0, 7);
}
