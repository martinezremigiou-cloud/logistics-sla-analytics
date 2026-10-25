import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkuDetalle } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const getSkuDetalleMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'kam@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;

/** Fake db de sesión: `auth.getUser()` configurable por test (default: sesión válida). */
const fakeDb = {
  __fakeDb: true,
  auth: {
    getUser: () => Promise.resolve({ data: { user: sessionUser }, error: sessionError }),
  },
};

const createSupabaseSessionClientMock = vi.fn(() => fakeDb);

vi.mock('@/services/sku.service', () => ({
  getSkuDetalle: (...args: unknown[]) => getSkuDetalleMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function fakeDetalle(overrides: Partial<SkuDetalle> = {}): SkuDetalle {
  return {
    sku: 'A-1',
    marca: 'BRAND1',
    marca_excluida: false,
    familia_efectiva: 'CANDADOS',
    familias_efectivas: ['CANDADOS'],
    descr_efectiva: 'Descripción',
    original: { familia: 'CANDADOS', descr: 'Descripción' },
    stock: [{ almacen: 'NORTH', cantidad: 10 }],
    total: 10,
    reservado: 0,
    disponible: 10,
    sobre_reservado: false,
    reserva_descuadre: false,
    reservas: [],
    embarques: [],
    piezas_en_camino: 0,
    piezas_historial: 0,
    imagen_url: null,
    // (R2-4/C1) 'BRAND1' de este fixture viene del archivo mensual/v2, NO de
    // un pendiente resuelto en la bandeja — `false` es el valor correcto
    // para este SKU, no relleno mecánico. Ver el test dedicado más abajo
    // para el caso `true` (marca decidida en la bandeja de pendientes).
    decidido_en_bandeja: { marca: false },
    snapshot: { stock: null, aduana: null },
    ...overrides,
  };
}

describe('GET /api/sku/[sku]', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSkuDetalleMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path: normaliza el param (trim+UPPER) y delega en getSkuDetalle', async () => {
    const fakeResult = fakeDetalle();
    getSkuDetalleMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/a-1'), { params: { sku: ' a-1 ' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(getSkuDetalleMock).toHaveBeenCalledTimes(1);
    const [db, skuArg] = getSkuDetalleMock.mock.calls[0];
    expect(db).toBe(fakeDb);
    expect(skuArg).toBe('A-1');
  });

  it('200: decidido_en_bandeja.marca=true (marca resuelta en la bandeja de pendientes) viaja intacto — el route no transforma el payload del service', async () => {
    const fakeResult = fakeDetalle({ marca: 'BRAND6', decidido_en_bandeja: { marca: true } });
    getSkuDetalleMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/a-1'), { params: { sku: ' a-1 ' } });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decidido_en_bandeja).toEqual({ marca: true });
    expect(json).toEqual(fakeResult);
  });

  it('404 sku_no_encontrado (shape uniforme) cuando el service regresa null', async () => {
    getSkuDetalleMock.mockResolvedValueOnce(null);

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/NOEXISTE'), { params: { sku: 'NOEXISTE' } });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('sku_no_encontrado');
    expect(typeof json.message).toBe('string');
  });

  it('param vacío → 400 invalid_query (no se llama al service)', async () => {
    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/%20'), { params: { sku: '   ' } });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(getSkuDetalleMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    getSkuDetalleMock.mockRejectedValueOnce(new Error('relation "productos" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/A-1'), { params: { sku: 'A-1' } });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });

    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(new Request('http://localhost/api/sku/A-1'), { params: { sku: 'A-1' } });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(getSkuDetalleMock).not.toHaveBeenCalled();
  });
});
