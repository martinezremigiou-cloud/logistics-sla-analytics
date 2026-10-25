import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EtlResult } from '@/services/etl/types';
import { EtlContractError, UniversoReducidoError } from '@/services/etl/errors';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const runEtlMock = vi.fn();
const createSupabaseServerClientMock = vi.fn(() => ({ __fakeDb: true }));

vi.mock('@/services/etl.service', () => ({
  runEtl: (...args: unknown[]) => runEtlMock(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

const INGEST_SECRET = process.env.INGEST_SECRET as string; // una sola fuente: lo fija vitest.config.ts (test.env)
const ENDPOINT = 'http://localhost/api/refresh';

const stockBody = {
  source: 'stock',
  capturedAt: '2026-07-01T00:00:00.000Z',
  archivo: 'stock.xlsx',
  datasets: {
    // (MVP-CIERRE) `inventario` exige cabecera + ≥1 fila de datos: una hoja
    // solo-encabezado significa catálogo vacío, y eso ya no pasa la frontera.
    // Este fixture era solo-encabezado y por eso el happy path se puso rojo.
    inventario: [['SKU', 'TOTAL'], ['A-1', '10']],
    west: [['SKU', 'FISICO']],
    reserva: [['SKU', 'CLIENTE']],
  },
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/refresh', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runEtlMock.mockReset();
    createSupabaseServerClientMock.mockClear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin header x-ingest-secret → 401', async () => {
    const { POST } = await import('./route');
    const res = await POST(post(stockBody));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(runEtlMock).not.toHaveBeenCalled();
  });

  it('secreto incorrecto → 401', async () => {
    const { POST } = await import('./route');
    const res = await POST(post(stockBody, { 'x-ingest-secret': 'incorrecto-pero-largo' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(runEtlMock).not.toHaveBeenCalled();
  });

  it('body inválido → 400 con issues', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post({ source: 'stock' }, { 'x-ingest-secret': INGEST_SECRET }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(runEtlMock).not.toHaveBeenCalled();
  });

  it('[INV-B8] dataset de stock vacío (p.ej. "west":[]) → 400 invalid_body con mensaje que identifica el dataset — cierra O2 en la vía real de Power Automate (POST directo, sin pasar por construirDatasets)', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post(
        { ...stockBody, datasets: { ...stockBody.datasets, west: [] } },
        { 'x-ingest-secret': INGEST_SECRET },
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    const issue = json.issues.find((i: { path: string[] }) => i.path.join('.') === 'datasets.west');
    expect(issue?.message).toContain('dataset "west" vacío');
    expect(runEtlMock).not.toHaveBeenCalled();
  });

  it('legacy source inventario/west/reserva → 400 invalid_body (rechazado por el schema)', async () => {
    const { POST } = await import('./route');
    const res = await POST(
      post(
        { source: 'inventario', capturedAt: '2026-07-01T00:00:00.000Z', rows: [['A']] },
        { 'x-ingest-secret': INGEST_SECRET },
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(runEtlMock).not.toHaveBeenCalled();
  });

  it('legacy source embarques → 200 (sigue siendo válido, única hoja legacy coherente)', async () => {
    const fakeResult: EtlResult = {
      snapshotId: 'snap-legacy',
      sinCambios: false,
      source: 'embarques',
      conteos: { productos: 0, stock: 0, reservas: 0, embarques: 1, cambios: 1 },
      cuarentena: { total: 0, items: [] },
      resiliencia: { reintentos: 0, presupuestoAgotado: false, eventos: [] },
      diag: [],
      universoForzado: false,
    };
    runEtlMock.mockResolvedValueOnce(fakeResult);

    const { POST } = await import('./route');
    const res = await POST(
      post(
        { source: 'embarques', capturedAt: '2026-07-01T00:00:00.000Z', archivo: null, rows: [['OC', 'SKU']] },
        { 'x-ingest-secret': INGEST_SECRET },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    const [job] = runEtlMock.mock.calls[0];
    expect(job).toEqual({
      source: 'embarques',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: null,
      embarques: [{ hoja: 'MANUAL', grid: [['OC', 'SKU']] }],
    });
  });

  it('happy path stock → 200 y runEtl llamado con el IngestJob esperado', async () => {
    const fakeResult: EtlResult = {
      snapshotId: 'snap-1',
      sinCambios: false,
      source: 'stock',
      conteos: { productos: 1, stock: 1, reservas: 0, embarques: 0, cambios: 1 },
      cuarentena: { total: 0, items: [] },
      resiliencia: { reintentos: 0, presupuestoAgotado: false, eventos: [] },
      diag: [],
      universoForzado: false,
    };
    runEtlMock.mockResolvedValueOnce(fakeResult);

    const { POST } = await import('./route');
    const res = await POST(post(stockBody, { 'x-ingest-secret': INGEST_SECRET }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(runEtlMock).toHaveBeenCalledTimes(1);
    const [job, deps] = runEtlMock.mock.calls[0];
    expect(job).toEqual({
      source: 'stock',
      capturedAt: '2026-07-01T00:00:00.000Z',
      archivo: 'stock.xlsx',
      inventario: [['SKU', 'TOTAL'], ['A-1', '10']],
      west: [['SKU', 'FISICO']],
      reserva: [['SKU', 'CLIENTE']],
    });
    expect(deps.db).toEqual({ __fakeDb: true });
  });

  it('EtlContractError desde runEtl → 400 contract_error con el mensaje propio', async () => {
    runEtlMock.mockRejectedValueOnce(new EtlContractError('stock requiere inventario+west+reserva juntos'));

    const { POST } = await import('./route');
    const res = await POST(post(stockBody, { 'x-ingest-secret': INGEST_SECRET }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toEqual({
      error: 'contract_error',
      message: 'stock requiere inventario+west+reserva juntos',
    });
  });

  it('error genérico del ETL → 500 etl_failed sin filtrar el mensaje ni secretos', async () => {
    runEtlMock.mockRejectedValueOnce(new Error('column "constraint_x" violates foreign key boom'));

    const { POST } = await import('./route');
    const res = await POST(post(stockBody, { 'x-ingest-secret': INGEST_SECRET }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'etl_failed' });

    const raw = JSON.stringify(json);
    expect(raw).not.toContain(INGEST_SECRET);
    expect(raw).not.toContain('sb_secret_test');
    expect(raw).not.toContain('constraint_x');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large (antes de parsear el body)', async () => {
    const { POST } = await import('./route');
    const req = new Request(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ingest-secret': INGEST_SECRET,
        'content-length': String(20_000_000),
      },
      body: JSON.stringify(stockBody),
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(runEtlMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// [REPRODUCIBILIDAD · S7-A] Guarda de universo reducido — nivel RUTA.
// El mecanismo de la guarda (rechazo, borde, forzado, lo que NO caza)
// vive y se prueba en `src/services/etl/__tests__/guarda-universo-reducido.test.ts`.
// Aquí SOLO el cableado HTTP: lectura de las tres cabeceras
// (`src/lib/api/forzar-universo.ts`, con su propio test unitario) y el
// mapeo de `UniversoReducidoError` a 409 `universo_reducido`.
// ============================================================
describe('POST /api/refresh — guarda de universo reducido (S7-A, nivel ruta)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    runEtlMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  const errorUniversoReducido = () =>
    new UniversoReducidoError({ fuente: 'stock', filasPrevias: 100, filasEntrantes: 10, umbral: 0.5 });

  it('UniversoReducidoError sin ninguna cabecera de forzado → 409 universo_reducido con el mensaje completo (nunca 500)', async () => {
    runEtlMock.mockRejectedValueOnce(errorUniversoReducido());
    const { POST } = await import('./route');
    const res = await POST(post(stockBody, { 'x-ingest-secret': INGEST_SECRET }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('universo_reducido');
    expect(json.message).toContain('100 previas');
    expect(json.message).toContain('10 filas');
    expect(json.message).toMatch(/x-forzar-universo-reducido/);
  });

  it('7. forzado incompleto (dos de las tres cabeceras: falta x-forzar-motivo) → SIGUE rechazando, y el mensaje nombra la cabecera que falta', async () => {
    runEtlMock.mockRejectedValueOnce(errorUniversoReducido());
    const { POST } = await import('./route');
    const res = await POST(
      post(stockBody, {
        'x-ingest-secret': INGEST_SECRET,
        'x-forzar-universo-reducido': 'si',
        'x-forzar-por': 'hugo@example.com',
        // falta x-forzar-motivo a propósito
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('universo_reducido');
    expect(json.message).toMatch(/x-forzar-motivo/);
    expect(json.message).toMatch(/incompleto/i);
  });

  it('7b. forzado incompleto (una sola cabecera: solo x-forzar-por) → SIGUE rechazando, y el mensaje nombra x-forzar-universo-reducido', async () => {
    runEtlMock.mockRejectedValueOnce(errorUniversoReducido());
    const { POST } = await import('./route');
    const res = await POST(
      post(stockBody, {
        'x-ingest-secret': INGEST_SECRET,
        'x-forzar-por': 'hugo@example.com',
      }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toMatch(/x-forzar-universo-reducido/);
    expect(json.message).toMatch(/incompleto/i);
  });

  it('las tres cabeceras completas y válidas → runEtl recibe deps.forzado (nunca por env ni valor por defecto)', async () => {
    const fakeResult: EtlResult = {
      snapshotId: 'snap-forzado',
      sinCambios: false,
      source: 'stock',
      conteos: { productos: 0, stock: 0, reservas: 0, embarques: 0, cambios: 2 },
      cuarentena: { total: 0, items: [] },
      resiliencia: { reintentos: 0, presupuestoAgotado: false, eventos: [] },
      diag: [],
      universoForzado: true,
    };
    runEtlMock.mockResolvedValueOnce(fakeResult);
    const { POST } = await import('./route');
    const motivo = 'Demo dio de baja toda la línea este mes; vaciado legítimo.';
    const res = await POST(
      post(stockBody, {
        'x-ingest-secret': INGEST_SECRET,
        'x-forzar-universo-reducido': 'si',
        'x-forzar-motivo': motivo,
        'x-forzar-por': 'hugo@example.com',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    const [, deps] = runEtlMock.mock.calls[0];
    expect(deps.forzado).toEqual({ por: 'hugo@example.com', motivo });
  });

  it('sin ninguna cabecera de forzado → runEtl recibe deps.forzado===undefined', async () => {
    const fakeResult: EtlResult = {
      snapshotId: 'snap-1',
      sinCambios: true,
      source: 'stock',
      conteos: { productos: 0, stock: 0, reservas: 0, embarques: 0, cambios: 0 },
      cuarentena: { total: 0, items: [] },
      resiliencia: { reintentos: 0, presupuestoAgotado: false, eventos: [] },
      diag: [],
      universoForzado: false,
    };
    runEtlMock.mockResolvedValueOnce(fakeResult);
    const { POST } = await import('./route');
    await POST(post(stockBody, { 'x-ingest-secret': INGEST_SECRET }));
    const [, deps] = runEtlMock.mock.calls[0];
    expect(deps.forzado).toBeUndefined();
  });
});
