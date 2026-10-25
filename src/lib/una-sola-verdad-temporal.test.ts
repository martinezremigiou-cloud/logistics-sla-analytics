// ============================================================
// [MVP-CIERRE] F6 · Alambre-trampa: una sola verdad temporal.
//
// POR QUÉ EXISTE. La divergencia de F6 —el Dashboard diciendo un "corte"
// de un día y el badge el día anterior, el MISMO dato— no vino de un cálculo mal
// hecho. Vino de que había DOS formateadores de fecha: los helpers de
// `lib/formato.ts` y un `Intl.DateTimeFormat` suelto dentro de
// `freshness-indicator.tsx`. Uno pineaba zona y el otro no.
//
// Arreglar los dos casos concretos no impide el tercero. Esto sí: cualquier
// formateo de fecha nuevo fuera de `lib/formato.ts` pone la suite roja.
//
// LÍMITE DECLARADO: es un alambre-trampa por texto, no análisis del árbol
// sintáctico (mismo criterio que `no-memoizacion.test.ts`). Caza la forma
// realista —construir un formateador donde se pinta— no a un evasor
// decidido.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatoFecha, formatoFechaHora, formatoFechaDeTimestamp, formatoFechaHoraCorta } from './formato';

const RAIZ_SRC = join(process.cwd(), 'src');

/**
 * Casas autorizadas para construir un formateador/derivador de fecha.
 *
 *  · `lib/formato.ts` — el texto que ve un humano. Todos sus helpers pinean
 *    zona explícitamente (`ZONA_MEXICO`, o UTC deliberado para date-only).
 *  · `lib/fechas.ts`  — `hoyMexico()`, que NO es texto de pantalla sino un
 *    valor de NEGOCIO (`YYYY-MM-DD` para comparar contra `eta`). También
 *    pinea `America/Mexico_City` explícitamente, que es justo lo que esta
 *    regla exige. El alambre-trampa lo cazó en su primera corrida y se
 *    clasificó como legítimo tras leerlo — no se ensanchó la regla para
 *    que dejara de molestar.
 *
 * Lo que la regla prohíbe es un formateador dentro de un COMPONENTE o un
 * SERVICIO, que es donde nace la divergencia: nadie lo revisa y nadie
 * recuerda pinearle la zona.
 */
const CASAS = [join('src', 'lib', 'formato.ts'), join('src', 'lib', 'fechas.ts')];

function archivosFuente(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosFuente(ruta, acc);
    else if (/\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acc.push(ruta);
  }
  return acc;
}

/** `Intl.DateTimeFormat(...)` o `.toLocaleDateString/String/TimeString(...)` sobre una fecha. */
const FORMATEA_FECHA = /new\s+Intl\.DateTimeFormat|\.toLocaleDateString\s*\(|\.toLocaleTimeString\s*\(/;

describe('F6 · el formateo de fechas vive en UN solo lugar', () => {
  it('ningún archivo fuera de lib/formato.ts construye su propio formateador de fecha', () => {
    const infractores: string[] = [];
    for (const ruta of archivosFuente(RAIZ_SRC)) {
      if (CASAS.some((casa) => ruta.endsWith(casa))) continue;
      readFileSync(ruta, 'utf8')
        .split(/\r?\n/)
        .forEach((linea, i) => {
          if (FORMATEA_FECHA.test(linea)) {
            infractores.push(`${ruta.replace(process.cwd(), '')}:${i + 1}  ${linea.trim().slice(0, 90)}`);
          }
        });
    }
    expect(
      infractores,
      'Un formateador de fecha fuera de `lib/formato.ts` es media verdad temporal: si no pinea ' +
        'zona, el mismo dato se ve distinto en el servidor (UTC) y en el navegador del usuario. ' +
        'Usa (o agrega) un helper en `lib/formato.ts`.',
    ).toEqual([]);
  });

  it('el detector RECONOCE las formas peligrosas (control positivo)', () => {
    expect(FORMATEA_FECHA.test('new Intl.DateTimeFormat("es-MX", {})')).toBe(true);
    expect(FORMATEA_FECHA.test('  return d.toLocaleDateString("es-MX");')).toBe(true);
    expect(FORMATEA_FECHA.test('  return d.toLocaleTimeString();')).toBe(true);
    // `toLocaleString` de NÚMEROS es legítimo y frecuente: no debe cazarse.
    expect(FORMATEA_FECHA.test("n.toLocaleString('es-MX')")).toBe(false);
  });
});

describe('F6 · la zona la fija el DATO, no el runtime', () => {
  // El caso exacto que produjo la divergencia: un corte de la tarde-noche
  // CDMX cae en el día UTC siguiente. Debe leerse el día local, siempre.
  const CORTE_20H02_CDMX = '2026-07-31T02:02:38.206875+00:00';

  it('un timestamp de las 20:02 CDMX se lee como 30 de julio, no 31', () => {
    expect(formatoFechaDeTimestamp(CORTE_20H02_CDMX)).toMatch(/30/);
    expect(formatoFechaDeTimestamp(CORTE_20H02_CDMX)).not.toMatch(/31/);
    expect(formatoFechaHora(CORTE_20H02_CDMX)).toMatch(/30/);
    expect(formatoFechaHoraCorta(CORTE_20H02_CDMX)).toMatch(/30/);
  });

  it('los tres helpers de timestamp coinciden en el DÍA — no puede haber dos verdades', () => {
    const dia = (s: string) => s.match(/\d{2}/)?.[0];
    expect(dia(formatoFechaHora(CORTE_20H02_CDMX))).toBe(dia(formatoFechaDeTimestamp(CORTE_20H02_CDMX)));
    expect(dia(formatoFechaHoraCorta(CORTE_20H02_CDMX))).toBe(dia(formatoFechaDeTimestamp(CORTE_20H02_CDMX)));
  });

  it('`formatoFecha` (date-only) sigue pineado a UTC, y eso es CORRECTO', () => {
    // Un `YYYY-MM-DD` no tiene hora ni zona. Renderizarlo en México lo
    // correría un día HACIA ATRÁS. No es una excepción a la regla: es la
    // misma regla sobre otro tipo de dato.
    expect(formatoFecha('2026-07-12')).toMatch(/12/);
    expect(formatoFecha('2026-01-01')).toMatch(/01 ene 2026|1 ene 2026/);
  });

  it('la zona es del dato aunque el runtime esté en otra parte', () => {
    // El runner está pineado a America/Mexico_City (vitest.config.ts), así
    // que este caso no puede probar el cambio de TZ del proceso. Lo que SÍ
    // prueba —y es lo que importa— es que el resultado no depende de la
    // zona local: se compara contra el valor calculado explícitamente para
    // México, no contra "lo que salga".
    const enMexico = new Intl.DateTimeFormat('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'America/Mexico_City',
    }).format(new Date(CORTE_20H02_CDMX));
    expect(formatoFechaDeTimestamp(CORTE_20H02_CDMX)).toBe(enMexico);
  });
});
