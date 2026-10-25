// ============================================================
// [RECEPCION] Gate 3 · seguridad de la puerta nueva, + contrato de entrada.
//
// `desde-archivo` NO se sustituye por un doble: se envuelve para poder
// afirmar SI fue llamado, pero por dentro corre el código real. Un mock
// completo dejaría sin probar justo lo que importa (que un .xlsx corrupto
// no reviente, que la compuerta de datasets dispare) — probaría el mock.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { libroStockVivo, libroAduanaVivo } from '@/services/ingesta/__tests__/libros-muestra';
import { UniversoReducidoError } from '@/services/etl/errors';

vi.mock('server-only', () => ({}));

const runEtlMock = vi.fn();
const createSupabaseServerClientMock = vi.fn(() => ({ __fakeDb: true }));
const construirSpy = vi.fn();

vi.mock('@/services/etl.service', () => ({
  runEtl: (...args: unknown[]) => runEtlMock(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

vi.mock('@/services/ingesta/desde-archivo', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/ingesta/desde-archivo')>();
  return {
    ...real,
    construirBodyDesdeArchivo: (...args: Parameters<typeof real.construirBodyDesdeArchivo>) => {
      construirSpy(...args);
      return real.construirBodyDesdeArchivo(...args);
    },
  };
});

const INGEST_SECRET = process.env.INGEST_SECRET as string; // una sola fuente: lo fija vitest.config.ts (test.env)
const BASE = 'http://localhost/api/refresh/archivo';

const XLSX_FALSO = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);

function post(
  cuerpo: Uint8Array | string,
  opts: { source?: string; headers?: Record<string, string> } = {},
) {
  const url = opts.source === undefined ? `${BASE}?source=stock` : opts.source === '' ? BASE : `${BASE}?source=${opts.source}`;
  // `readFileSync` devuelve `Buffer`, que TS tipa como `Uint8Array<ArrayBufferLike>`
  // y no encaja en `BodyInit`. Se recopia a un `Uint8Array<ArrayBuffer>` en vez de
  // castear: el cast escondería el problema, la copia lo resuelve.
  const body: BodyInit = typeof cuerpo === 'string' ? cuerpo : new Uint8Array(cuerpo);
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...opts.headers },
    body,
  });
}

const conSecreto = { 'x-ingest-secret': INGEST_SECRET };

describe('POST /api/refresh/archivo', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runEtlMock.mockReset();
    construirSpy.mockReset();
    createSupabaseServerClientMock.mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  // ---------------------------------------------------------------- G3.1
  describe('G3.1 · rechaza sin el secreto correcto', () => {
    it('sin header x-ingest-secret → 401 y NO abre el archivo', async () => {
      const { POST } = await import('./route');
      const res = await POST(post(XLSX_FALSO));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(construirSpy).not.toHaveBeenCalled();
      expect(runEtlMock).not.toHaveBeenCalled();
    });

    it('con secreto equivocado → 401', async () => {
      const { POST } = await import('./route');
      const res = await POST(post(XLSX_FALSO, { headers: { 'x-ingest-secret': 'otro-secreto-cualquiera' } }));
      expect(res.status).toBe(401);
      expect(construirSpy).not.toHaveBeenCalled();
    });

    it('con secreto de la longitud correcta pero distinto → 401 (comparación por digest, no por largo)', async () => {
      const { POST } = await import('./route');
      const mismoLargo = 'x'.repeat(INGEST_SECRET.length);
      const res = await POST(post(XLSX_FALSO, { headers: { 'x-ingest-secret': mismoLargo } }));
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------- G3.2
  describe('G3.2 · rechaza cuerpos mayores al tope ANTES de abrirlos', () => {
    it('content-length declarado por encima del tope → 413 sin abrir el archivo', async () => {
      const { POST } = await import('./route');
      const res = await POST(
        post(XLSX_FALSO, { headers: { ...conSecreto, 'content-length': '99000000' } }),
      );
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'payload_too_large' });
      // Lo esencial del punto: NO se materializó ni se parseó nada.
      expect(construirSpy).not.toHaveBeenCalled();
      expect(runEtlMock).not.toHaveBeenCalled();
    });

    it('cuerpo real por encima del tope aunque el content-length mienta → 413', async () => {
      // Segunda cota, con los bytes ya en mano: cubre header ausente,
      // mentiroso o `Transfer-Encoding: chunked`.
      const { POST } = await import('./route');
      const enorme = new Uint8Array(15_000_001);
      enorme.set([0x50, 0x4b, 0x03, 0x04]);
      const res = await POST(post(enorme, { headers: conSecreto }));
      expect(res.status).toBe(413);
      expect(construirSpy).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- G3.3
  describe('G3.3 · un archivo corrupto no revienta', () => {
    const basuras: [string, Uint8Array | string][] = [
      ['texto plano', 'no soy un excel'],
      ['CSV', 'a,b,c\n1,2,3'],
      ['HTML de una página de error', '<html><body>500</body></html>'],
      ['cuerpo vacío', new Uint8Array(0)],
      ['ZIP con firma válida pero roto', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9])],
      ['sobre de PA sin $content', JSON.stringify({ '$content-type': 'application/octet-stream' })],
      ['sobre de PA con $content que no es un xlsx', JSON.stringify({ $content: Buffer.from('nope').toString('base64') })],
    ];

    for (const [etiqueta, cuerpo] of basuras) {
      it(`${etiqueta} → 400 controlado, nunca 500, y sin llamar al ETL`, async () => {
        const { POST } = await import('./route');
        const res = await POST(post(cuerpo, { headers: conSecreto }));
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toBe('invalid_body');
        expect(typeof json.message).toBe('string');
        expect(runEtlMock).not.toHaveBeenCalled();
      });
    }
  });

  // ---------------------------------------------------------------- G3.4
  describe('G3.4 · no filtra el secreto ni internals', () => {
    it('ninguna respuesta de error contiene el secreto, rutas del servidor ni rastros de la librería', async () => {
      const { POST } = await import('./route');
      const peticiones = [
        post(XLSX_FALSO),
        post(XLSX_FALSO, { headers: { 'x-ingest-secret': 'malo' } }),
        post('a,b,c', { headers: conSecreto }),
        post(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9]), { headers: conSecreto }),
        post(XLSX_FALSO, { headers: conSecreto, ...{} }),
        post(XLSX_FALSO, { source: 'inventado', headers: conSecreto }),
      ];
      for (const req of peticiones) {
        const res = await POST(req);
        const texto = JSON.stringify(await res.json());
        expect(texto).not.toContain(INGEST_SECRET);
        expect(texto).not.toMatch(/node_modules|[A-Za-z]:\\|\/home\/|at Object\.|\.ts:\d+/);
        expect(texto).not.toMatch(/ZIP Compression|sheetjs|xlsx\.js/i);
      }
    });

    it('el error crudo de la librería se registra en el servidor pero NO viaja al cliente', async () => {
      const { POST } = await import('./route');
      const res = await POST(
        post(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0, 9, 9, 9]), { headers: conSecreto }),
      );
      expect(res.status).toBe(400);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(JSON.stringify(await res.json())).not.toMatch(/Unsupported ZIP/i);
    });
  });

  // ---------------------------------------------------------------- contrato
  describe('parámetro source', () => {
    it('sin ?source → 400 invalid_query con instrucción accionable', async () => {
      const { POST } = await import('./route');
      const res = await POST(post(XLSX_FALSO, { source: '', headers: conSecreto }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_query');
      expect(json.message).toMatch(/source/);
    });

    it('?source con un valor inventado → 400 invalid_query', async () => {
      const { POST } = await import('./route');
      const res = await POST(post(XLSX_FALSO, { source: 'inventado', headers: conSecreto }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_query');
    });
  });
});

// ---------------------------------------------------------------- G3.5 + feliz
const stockVivo = libroStockVivo();
const aduanaVivo = libroAduanaVivo();
const hayLibros = stockVivo !== null && aduanaVivo !== null;

(hayLibros ? describe : describe.skip)(
  'POST /api/refresh/archivo — con los .xlsx de MUESTRA (requiere `muestra/`, ver scripts/generar-datos-muestra.mjs)',
  () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      runEtlMock.mockReset();
      construirSpy.mockReset();
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      consoleInfoSpy.mockRestore();
    });

    it('archivo de STOCK binario → 200 y el ETL recibe el job con los 3 datasets', async () => {
      const { POST } = await import('./route');
      runEtlMock.mockResolvedValue({ ok: true, sinCambios: true });
      const res = await POST(post(readFileSync(stockVivo!), { source: 'stock', headers: conSecreto }));
      expect(res.status).toBe(200);
      expect(runEtlMock).toHaveBeenCalledTimes(1);
      const job = runEtlMock.mock.calls[0][0];
      expect(job.source).toBe('stock');
      expect(job.inventario.length).toBeGreaterThan(0);
      expect(job.west.length).toBeGreaterThan(0);
      expect(job.reserva.length).toBeGreaterThan(0);
    });

    it('archivo de ADUANA binario → 200 y el ETL recibe las hojas de embarques', async () => {
      const { POST } = await import('./route');
      runEtlMock.mockResolvedValue({ ok: true, sinCambios: true });
      const res = await POST(post(readFileSync(aduanaVivo!), { source: 'aduana', headers: conSecreto }));
      expect(res.status).toBe(200);
      const job = runEtlMock.mock.calls[0][0];
      expect(job.source).toBe('aduana');
      expect(job.embarques.length).toBeGreaterThan(0);
    });

    it('el MISMO archivo en el sobre base64 de Power Automate → job idéntico al binario', async () => {
      const { POST } = await import('./route');
      runEtlMock.mockResolvedValue({ ok: true, sinCambios: true });

      const bytes = readFileSync(stockVivo!);
      await POST(post(bytes, { source: 'stock', headers: conSecreto }));
      const jobBinario = runEtlMock.mock.calls[0][0];

      runEtlMock.mockReset();
      runEtlMock.mockResolvedValue({ ok: true, sinCambios: true });
      const sobre = JSON.stringify({
        '$content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        $content: bytes.toString('base64'),
      });
      await POST(post(sobre, { source: 'stock', headers: conSecreto }));
      const jobSobre = runEtlMock.mock.calls[0][0];

      // `capturedAt` lo genera el servidor en cada llamada: se compara todo
      // lo demás, que es lo que sale del archivo.
      const sinFecha = (job: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(job).filter(([k]) => k !== 'capturedAt'));
      expect(sinFecha(jobSobre)).toEqual(sinFecha(jobBinario));
    });

    // G3.6 — la SEGUNDA mitad de la compuerta de INV-B8. Este caso nació de
    // la auditoría adversarial del bloque: la primera versión de la ruta lo
    // dejaba pasar entero y `runEtl` habría persistido un vaciado de catálogo
    // devolviendo 200. Las 3 hojas SE ASIGNAN (nombres correctos), así que el
    // gate del motor NO dispara; y `runEtl.ts:114` usa `!job.inventario`, que
    // con `[]` da `false`. Lo único que lo corta es el `.min(1)` del schema.
    it('G3.6 · .xlsx con las 3 hojas bien nombradas pero VACÍAS → 400, y el ETL no se llama', async () => {
      const { POST } = await import('./route');
      const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));

      const wb = XLSX.utils.book_new();
      for (const nombre of ['Inventario', 'Reserva', 'INV WEST']) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), nombre);
      }
      const bytes = new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

      const res = await POST(post(bytes, { source: 'stock', headers: conSecreto }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_body');
      // El mensaje nombra CUÁL dataset vino vacío — diagnosticable desde PA.
      expect(JSON.stringify(json.issues)).toMatch(/inventario/);
      expect(runEtlMock).not.toHaveBeenCalled();
    });

    // G3.5 — la compuerta de INV-B8, por esta puerta.
    it('G3.5 · el libro de ADUANA mandado como source=stock → 400, NUNCA 200', async () => {
      const { POST } = await import('./route');
      const res = await POST(post(readFileSync(aduanaVivo!), { source: 'stock', headers: conSecreto }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_body');
      expect(json.message).toMatch(/dataset/i);
      expect(runEtlMock).not.toHaveBeenCalled();

      // Decisión de producto sobre el hallazgo E de la auditoría: el mensaje
      // CONSERVA el nombre del dataset —sin él el 400 es inaccionable para
      // quien opera Power Automate— y QUITA la ruta del archivo de
      // configuración y el volcado del ruleset de exclusiones.
      expect(json.message).toMatch(/inventario/);
      expect(json.message).toMatch(/reserva/);
      expect(json.message).not.toMatch(/ingesta-mapeo|src\/config|src\\config/);
      expect(json.message).not.toMatch(/excluida A PROPÓSITO|NO RECONOCIDA|pendiente de decisión/);
      // Tampoco los nombres de las pestañas que el llamador subió, que en
      // el volcado viejo viajaban de regreso uno por uno.
      expect(json.message).not.toMatch(/HISTORIAL|GARANTIAS|OC ABIERTAS/);
    });
  },
);

// ============================================================
// [REPRODUCIBILIDAD · S7-A] Guarda de universo reducido — nivel RUTA.
// El mecanismo de la guarda (rechazo, borde, forzado, lo que NO caza)
// vive y se prueba en
// `src/services/etl/__tests__/guarda-universo-reducido.test.ts`. Aquí
// SOLO el cableado HTTP de ESTA puerta: lectura de las tres cabeceras
// (`src/lib/api/forzar-universo.ts`, con su propio test unitario) y el
// mapeo de `UniversoReducidoError` a 409 `universo_reducido`. `runEtl`
// sigue mockeado (no se re-implementa el pipeline aquí); el .xlsx es
// SINTÉTICO y mínimo (no depende de los libros de `muestra/`) porque una vez
// que `runEtl` está mockeado, el contenido de las hojas ya no importa —
// solo que pase `RefreshBody.safeParse` (aduana no exige mínimo de filas
// por hoja, a diferencia de `inventario`).
// ============================================================
describe('POST /api/refresh/archivo — guarda de universo reducido (S7-A, nivel ruta)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runEtlMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  async function xlsxAduanaMinimo(): Promise<Uint8Array> {
    const XLSX = (await import('xlsx')).default ?? (await import('xlsx'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['ITEM', 'ESTATUS'], ['SKU-1', 'En Aduana']]),
      'ACTIVOS',
    );
    return new Uint8Array(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  const errorUniversoReducido = () =>
    new UniversoReducidoError({ fuente: 'aduana', filasPrevias: 100, filasEntrantes: 10, umbral: 0.5 });

  it('UniversoReducidoError sin ninguna cabecera de forzado → 409 universo_reducido con el mensaje completo (nunca 500)', async () => {
    runEtlMock.mockRejectedValueOnce(errorUniversoReducido());
    const { POST } = await import('./route');
    const bytes = await xlsxAduanaMinimo();
    const res = await POST(post(bytes, { source: 'aduana', headers: conSecreto }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('universo_reducido');
    expect(json.message).toContain('100 previas');
    expect(json.message).toContain('10 filas');
    expect(json.message).toMatch(/x-forzar-universo-reducido/);
  });

  it('7. forzado incompleto (dos de las tres cabeceras: falta x-forzar-por) → SIGUE rechazando, y el mensaje nombra la cabecera que falta', async () => {
    runEtlMock.mockRejectedValueOnce(errorUniversoReducido());
    const { POST } = await import('./route');
    const bytes = await xlsxAduanaMinimo();
    const res = await POST(
      post(bytes, {
        source: 'aduana',
        headers: {
          ...conSecreto,
          'x-forzar-universo-reducido': 'si',
          'x-forzar-motivo': 'Demo dio de baja toda la línea este mes.',
          // falta x-forzar-por a propósito
        },
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('universo_reducido');
    expect(json.message).toMatch(/x-forzar-por/);
    expect(json.message).toMatch(/incompleto/i);
  });

  it('las tres cabeceras completas y válidas → runEtl recibe deps.forzado (nunca por env ni valor por defecto)', async () => {
    runEtlMock.mockResolvedValueOnce({ ok: true, sinCambios: true, universoForzado: true });
    const { POST } = await import('./route');
    const bytes = await xlsxAduanaMinimo();
    const motivo = 'Demo dio de baja toda la línea este mes; vaciado legítimo.';
    const res = await POST(
      post(bytes, {
        source: 'aduana',
        headers: {
          ...conSecreto,
          'x-forzar-universo-reducido': 'si',
          'x-forzar-motivo': motivo,
          'x-forzar-por': 'hugo@example.com',
        },
      }),
    );
    expect(res.status).toBe(200);
    const [, deps] = runEtlMock.mock.calls[0];
    expect(deps.forzado).toEqual({ por: 'hugo@example.com', motivo });
  });

  it('sin ninguna cabecera de forzado → runEtl recibe deps.forzado===undefined', async () => {
    runEtlMock.mockResolvedValueOnce({ ok: true, sinCambios: true, universoForzado: false });
    const { POST } = await import('./route');
    const bytes = await xlsxAduanaMinimo();
    await POST(post(bytes, { source: 'aduana', headers: conSecreto }));
    const [, deps] = runEtlMock.mock.calls[0];
    expect(deps.forzado).toBeUndefined();
  });
});
