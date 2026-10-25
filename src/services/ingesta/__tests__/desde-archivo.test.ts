// ============================================================
// [RECEPCION] O1/O5/O6 · `construirBodyDesdeArchivo` — el camino nuevo,
// probado sin HTTP.
//
// El aserto que importa (Gate 2): el body que sale de aquí es IGUAL al que
// arma el camino viejo (`leerWorkbookXlsx` + `construirDatasets`, que es
// exactamente lo que hace `scripts/ingesta-mensual.mjs`). No "equivalente"
// ni "con las mismas cifras": igual con `toEqual`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  construirBodyDesdeArchivo,
  extraerBytesDelCuerpo,
  ArchivoIlegibleError,
} from '../desde-archivo';
import { leerWorkbookXlsx } from '../io';
import { construirDatasets, DatasetsStockFaltantesError } from '../motor';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';
import { libroStockVivo, libroAduanaVivo, libroStockJulio } from './libros-muestra';

const CAPTURED_AT = '2026-07-30T12:00:00.000Z';
const stockVivo = libroStockVivo();
const aduanaVivo = libroAduanaVivo();
const stockJulio = libroStockJulio();
const hayLibros = stockVivo !== null && aduanaVivo !== null;

describe('extraerBytesDelCuerpo — las dos formas en que puede llegar el archivo', () => {
  const xlsxFalso = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

  it('binario: el .xlsx tal cual', () => {
    const r = extraerBytesDelCuerpo(xlsxFalso);
    expect(r.forma).toBe('binario');
    expect(r.bytes).toEqual(xlsxFalso);
  });

  it('sobre base64 de Power Automate: {"$content-type", "$content"}', () => {
    const sobre = JSON.stringify({
      '$content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      $content: Buffer.from(xlsxFalso).toString('base64'),
    });
    const r = extraerBytesDelCuerpo(new TextEncoder().encode(sobre));
    expect(r.forma).toBe('sobre_base64');
    expect(r.bytes).toEqual(xlsxFalso);
  });

  it('sobre con espacios/salto de línea delante: se tolera', () => {
    const sobre = '\n  ' + JSON.stringify({ $content: Buffer.from(xlsxFalso).toString('base64') });
    expect(extraerBytesDelCuerpo(new TextEncoder().encode(sobre)).forma).toBe('sobre_base64');
  });

  // Un paso de PA que devuelve 200 pero sin archivo es el modo de falla
  // MÁS probable de este camino, y el más peligroso: produce un libro
  // vacío que se leería como "mes sin novedades".
  it('sobre con "$content" ausente → ArchivoIlegibleError', () => {
    const sobre = JSON.stringify({ '$content-type': 'application/octet-stream' });
    expect(() => extraerBytesDelCuerpo(new TextEncoder().encode(sobre))).toThrow(ArchivoIlegibleError);
  });

  it('sobre con "$content" vacío → ArchivoIlegibleError', () => {
    const sobre = JSON.stringify({ $content: '   ' });
    expect(() => extraerBytesDelCuerpo(new TextEncoder().encode(sobre))).toThrow(ArchivoIlegibleError);
  });

  it('sobre cuyo "$content" decodifica a algo que no es un .xlsx → ArchivoIlegibleError', () => {
    const sobre = JSON.stringify({ $content: Buffer.from('no soy un zip').toString('base64') });
    expect(() => extraerBytesDelCuerpo(new TextEncoder().encode(sobre))).toThrow(ArchivoIlegibleError);
  });

  it('JSON mal formado → ArchivoIlegibleError', () => {
    expect(() => extraerBytesDelCuerpo(new TextEncoder().encode('{"$content": '))).toThrow(ArchivoIlegibleError);
  });

  it('cuerpo vacío → ArchivoIlegibleError', () => {
    expect(() => extraerBytesDelCuerpo(new Uint8Array(0))).toThrow(ArchivoIlegibleError);
  });

  it('cuerpo que no es ni ZIP ni sobre → ArchivoIlegibleError', () => {
    expect(() => extraerBytesDelCuerpo(new TextEncoder().encode('a,b,c\n1,2,3'))).toThrow(ArchivoIlegibleError);
  });
});

(hayLibros ? describe : describe.skip)(
  'construirBodyDesdeArchivo — GATE 2: el camino nuevo produce el MISMO body que el viejo (requiere los .xlsx de muestra en `muestra/`)',
  () => {
    const casos = [
      ['STOCK vivo (unificado)', stockVivo, 'stock'],
      ['ADUANA vivo (embarques)', aduanaVivo, 'aduana'],
      ['STOCK julio (histórico)', stockJulio, 'stock'],
    ].filter(([, ruta]) => ruta !== null) as [string, string, 'stock' | 'aduana'][];

    for (const [etiqueta, ruta, source] of casos) {
      it(`${etiqueta}: body idéntico al del camino viejo`, () => {
        const nombre = basename(ruta);

        // Camino VIEJO, tal cual lo hace `scripts/ingesta-mensual.mjs` — es
        // una COPIA a mano de esa llamada; si el CLI cambia cómo llama a
        // `construirDatasets`, esta línea se actualiza con él (patrón
        // medido en este bloque: la 3ª reimplementación que se desincronizó
        // en silencio).
        const libro = leerWorkbookXlsx(ruta, nombre);
        const vacio = { nombreArchivo: nombre, hojas: [] };
        const viejo = construirDatasets(
          source === 'stock' ? { stock: libro, aduana: vacio } : { stock: vacio, aduana: libro },
          ingestaMapeoConfig,
          { capturedAt: CAPTURED_AT, stockOmitido: source === 'aduana' },
        );
        const bodyViejo = source === 'stock' ? viejo.bodyStock : viejo.bodyAduana;

        // Camino NUEVO: los mismos bytes, pero por memoria.
        const nuevo = construirBodyDesdeArchivo(readFileSync(ruta), {
          source,
          nombreArchivo: nombre,
          capturedAt: CAPTURED_AT,
        });

        expect(nuevo.body).toEqual(bodyViejo);
        expect(nuevo.reporte).toEqual(viejo.reporte);
      });
    }

    it('acepta el archivo envuelto en el sobre base64 de Power Automate, con el mismo resultado', () => {
      const nombre = basename(stockVivo!);
      const bytes = readFileSync(stockVivo!);
      const sobre = new TextEncoder().encode(
        JSON.stringify({ $content: bytes.toString('base64') }),
      );

      const directo = construirBodyDesdeArchivo(bytes, { source: 'stock', nombreArchivo: nombre, capturedAt: CAPTURED_AT });
      const envuelto = construirBodyDesdeArchivo(sobre, { source: 'stock', nombreArchivo: nombre, capturedAt: CAPTURED_AT });

      expect(envuelto.forma).toBe('sobre_base64');
      expect(directo.forma).toBe('binario');
      expect(envuelto.body).toEqual(directo.body);
    });

    it('reporta el tramo de lectura medido (O4), no estimado', () => {
      const r = construirBodyDesdeArchivo(readFileSync(stockVivo!), {
        source: 'stock',
        nombreArchivo: basename(stockVivo!),
        capturedAt: CAPTURED_AT,
      });
      expect(r.msLectura).toBeGreaterThan(0);
      expect(r.msMapeo).toBeGreaterThanOrEqual(0);
      expect(r.hojas.length).toBeGreaterThan(0);
    });
  },
);

(hayLibros ? describe : describe.skip)(
  'construirBodyDesdeArchivo — O5: la compuerta de datasets obligatorios aplica por esta puerta',
  () => {
    it('el libro de ADUANA mandado como source=stock → DatasetsStockFaltantesError', () => {
      // El libro de embarques no trae Inventario/Reserva/INV WEST. Es el
      // error de configuración más plausible en Power Automate: cablear el
      // archivo equivocado al paso equivocado. NO puede terminar en 200.
      expect(() =>
        construirBodyDesdeArchivo(readFileSync(aduanaVivo!), {
          source: 'stock',
          nombreArchivo: basename(aduanaVivo!),
          capturedAt: CAPTURED_AT,
        }),
      ).toThrow(DatasetsStockFaltantesError);
    });

    // Faltan DOS, no tres, y la razón vale documentarla: el libro de
    // embarques trae una pestaña llamada `WEST`, que colisiona con uno de
    // los nombres que `ingesta-mapeo.ts` acepta para el dataset `west` de
    // STOCK (`['WEST', 'INV_WEST', 'INV WEST']`). O sea que al mandar el
    // archivo equivocado, una de las tres hojas obligatorias SÍ encuentra
    // candidata — por nombre, con contenido que no tiene nada que ver.
    // El gate sigue disparando porque las otras dos no aparecen; si algún
    // día se relajara a "basta con que alguna hoja se asigne", este caso
    // pasaría en verde con datos de embarques metidos en el inventario.
    it('el error nombra los datasets que faltaron (2 de 3: la pestaña WEST del libro de embarques colisiona por nombre)', () => {
      try {
        construirBodyDesdeArchivo(readFileSync(aduanaVivo!), {
          source: 'stock',
          nombreArchivo: basename(aduanaVivo!),
          capturedAt: CAPTURED_AT,
        });
        expect.unreachable('debió lanzar');
      } catch (e) {
        expect(e).toBeInstanceOf(DatasetsStockFaltantesError);
        expect([...(e as DatasetsStockFaltantesError).faltantes].sort()).toEqual(['inventario', 'reserva']);
      }
    });
  },
);

describe('construirBodyDesdeArchivo — archivo ilegible', () => {
  it('bytes que no son un libro → ArchivoIlegibleError (no un error crudo de la librería)', () => {
    expect(() =>
      construirBodyDesdeArchivo(new TextEncoder().encode('a,b,c\n1,2,3'), {
        source: 'stock',
        nombreArchivo: 'x.xlsx',
        capturedAt: CAPTURED_AT,
      }),
    ).toThrow(ArchivoIlegibleError);
  });

  it('ZIP con firma válida pero roto → ArchivoIlegibleError, con la causa preservada para el log', () => {
    const zipRoto = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9]);
    try {
      construirBodyDesdeArchivo(zipRoto, { source: 'stock', nombreArchivo: 'x.xlsx', capturedAt: CAPTURED_AT });
      expect.unreachable('debió lanzar');
    } catch (e) {
      expect(e).toBeInstanceOf(ArchivoIlegibleError);
      // La causa original queda disponible para el log del servidor…
      expect((e as ArchivoIlegibleError).causa).toBeDefined();
      // …pero el mensaje que sí puede viajar al cliente no filtra internals.
      expect((e as ArchivoIlegibleError).message).not.toMatch(/ZIP Compression|zip\.js|node_modules/i);
    }
  });
});
