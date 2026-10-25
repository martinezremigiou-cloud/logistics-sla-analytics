// ============================================================
// [RECEPCION] O2/O6 · `leerWorkbookDesdeBuffer` vs `leerWorkbookXlsx`.
//
// Esta suite ES el Gate 2 al nivel más bajo posible: si la conversión
// libro→grids diverge entre disco y memoria, TODO lo de arriba (mapeo,
// ETL, cifras) diverge también. Y al revés: probada la igualdad aquí, la
// igualdad de las cifras finales se sigue, porque de este punto en
// adelante los dos caminos ejecutan exactamente el mismo código.
//
// Se compara con igualdad ESTRUCTURAL PROFUNDA sobre los libros de muestra
// completos —no una muestra, no unos conteos— porque un `raw:false` de
// más convertiría números a texto sin cambiar ni una sola longitud de
// arreglo: contar filas no habría detectado nada.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import * as XLSX from 'xlsx';
import { leerWorkbookXlsx, leerWorkbookDesdeBuffer } from '../io';
import { libroStockVivo, libroAduanaVivo, libroStockJulio } from './libros-muestra';

const stockVivo = libroStockVivo();
const aduanaVivo = libroAduanaVivo();
const stockJulio = libroStockJulio();
const hayLibros = stockVivo !== null && aduanaVivo !== null;

(hayLibros ? describe : describe.skip)(
  'leerWorkbookDesdeBuffer — equivalencia con la lectura desde disco (requiere los .xlsx de muestra en `muestra/`)',
  () => {
    const casos = [
      ['STOCK vivo (formato unificado)', stockVivo],
      ['ADUANA vivo (embarques)', aduanaVivo],
      ['STOCK julio (formato histórico)', stockJulio],
    ].filter(([, ruta]) => ruta !== null) as [string, string][];

    for (const [etiqueta, ruta] of casos) {
      it(`${etiqueta}: memoria y disco producen grids IDÉNTICOS`, () => {
        const nombre = basename(ruta);
        const desdeDisco = leerWorkbookXlsx(ruta, nombre);
        const desdeMemoria = leerWorkbookDesdeBuffer(readFileSync(ruta), nombre);

        // Igualdad profunda del objeto COMPLETO: nombres de hoja, orden,
        // número de filas, número de columnas y el valor y TIPO de cada
        // celda. `toEqual` distingue 5 de '5' y null de '' — que es
        // justo lo que un cambio de opciones de conversión rompería.
        expect(desdeMemoria).toEqual(desdeDisco);
      });
    }

    it('acepta ArrayBuffer además de Uint8Array (lo que devuelve req.arrayBuffer())', () => {
      const nombre = basename(stockVivo!);
      const buf = readFileSync(stockVivo!);
      // Copia exacta a un ArrayBuffer suelto: es el tipo que entrega
      // `Request.arrayBuffer()` en el route handler.
      const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      expect(leerWorkbookDesdeBuffer(arrayBuffer, nombre)).toEqual(
        leerWorkbookDesdeBuffer(buf, nombre),
      );
    });

    it('un .xlsx de muestra trae al menos una hoja (premisa del gate de hojas vacías)', () => {
      expect(leerWorkbookDesdeBuffer(readFileSync(stockVivo!), 'x.xlsx').hojas.length).toBeGreaterThan(0);
    });
  },
);

// Estas entradas NO lanzan por sí solas en `xlsx@0.18.5`: la librería
// autodetecta formato y cae a CSV/texto, devolviendo una hoja `Sheet1` con
// contenido plausible en vez de un error (medido, ver la docstring de
// `leerWorkbookDesdeBuffer`). Lo que las corta es la guarda de firma ZIP.
// Si alguien la quita "porque parece redundante", esta suite se pone roja.
describe('leerWorkbookDesdeBuffer — entradas que NO son un libro (guarda de firma ZIP)', () => {
  const noLibros: [string, Uint8Array][] = [
    ['búfer vacío', new Uint8Array(0)],
    ['bytes basura', new Uint8Array([1, 2, 3, 4, 5])],
    ['texto plano', new TextEncoder().encode('hola, no soy un excel')],
    ['CSV', new TextEncoder().encode('a,b,c\n1,2,3')],
    ['HTML de una página de error', new TextEncoder().encode('<html><body>500</body></html>')],
    ['firma ZIP truncada', new Uint8Array([0x50, 0x4b, 0x03])],
  ];

  for (const [etiqueta, bytes] of noLibros) {
    it(`${etiqueta} → lanza (NO se convierte en un libro con "Sheet1")`, () => {
      expect(() => leerWorkbookDesdeBuffer(bytes, 'no-es-libro.xlsx')).toThrow();
    });
  }

  it('firma ZIP válida pero contenido roto → también lanza', () => {
    const zipRoto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9]);
    expect(() => leerWorkbookDesdeBuffer(zipRoto, 'roto.xlsx')).toThrow();
  });
});

// Un .xlsx PERFECTAMENTE VÁLIDO puede ser un arma: `sheet_to_json`
// dimensiona el grid según el `<dimension ref>` que declara el XML de la
// hoja, y ese XML lo controla quien manda el archivo. Ni el tope de 15 MB
// (la entrada son ~16 KB) ni la guarda de firma ZIP (el archivo ES un ZIP)
// ni `maxDuration` (acota el reloj, no la memoria) lo detienen.
// Hallado por la auditoría adversarial de [RECEPCION].
describe('leerWorkbookDesdeBuffer — amplificación por <dimension> inflada', () => {
  /** ~16 KB de archivo que declaran 3,276,800 celdas (16,384 columnas × 200 filas). */
  function libroConDimensionInflada(ref: string): Uint8Array {
    const ws = XLSX.utils.aoa_to_sheet([['a']]);
    ws['!ref'] = ref;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  it('un archivo diminuto que declara 3.2 M de celdas → lanza ANTES de asignar el grid', () => {
    const bytes = libroConDimensionInflada('A1:XFD200');
    // Precondición del caso: es chico y es un ZIP válido — o sea, pasa las
    // otras dos barreras sin despeinarse.
    expect(bytes.byteLength).toBeLessThan(100_000);
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const t0 = performance.now();
    expect(() => leerWorkbookDesdeBuffer(bytes, 'bomba.xlsx')).toThrow(/demasiadas celdas/i);
    // Rechazo barato: si el corte llegara DESPUÉS de `sheet_to_json`, esto
    // tardaría segundos y habría asignado ~115 MB antes de fallar.
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it('el mensaje dice cuántas filas y columnas declara la hoja culpable', () => {
    expect(() => leerWorkbookDesdeBuffer(libroConDimensionInflada('A1:XFD200'), 'bomba.xlsx')).toThrow(
      /Inventario/,
    );
  });

  it('los libros de muestra pasan el presupuesto con holgura', () => {
    // El contraste que evita que el cerrojo se vuelva un estorbo: el libro
    // más grande que espera este proyecto queda muy por debajo del tope.
    for (const ruta of [stockVivo, aduanaVivo, stockJulio].filter(Boolean) as string[]) {
      expect(() => leerWorkbookDesdeBuffer(readFileSync(ruta), basename(ruta))).not.toThrow();
    }
  });
});
