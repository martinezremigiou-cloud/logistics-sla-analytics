import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DashboardResponse } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const getDashboardMock = vi.fn();

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

vi.mock('@/services/dashboard.service', () => ({
  getDashboard: (...args: unknown[]) => getDashboardMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function req(query = '') {
  return new Request(`http://localhost/api/dashboard${query}`);
}

function fakeDashboard(overrides: Partial<DashboardResponse> = {}): DashboardResponse {
  return {
    snapshot: { stock: null, aduana: null },
    periodos: { actual: null, anterior: null },
    kpis: {
      catalogo_total: { valor: 0, delta: null },
      piezas_disponibles: { valor: 0, delta: null },
      piezas_disponibles_neto: { valor: 0, delta: null },
      piezas_sobre_reservadas: { valor: 0, delta: null },
      skus_disponibles: { valor: 0, delta: null },
      sobre_reservados: { valor: 0, delta: null },
      piezas_en_camino: { valor: 0, delta: null },
      retrasados: { valor: 0, delta: null },
      sin_v2: { valor: 0, delta: null },
      sin_tecnologia: { valor: 0, delta: null },
      productos_sin_tecnologia: { valor: 0, delta: null },
      pendientes: { valor: 0, delta: null },
    },
    heatmap: {
      eje_y: 'marca',
      eje_x: 'almacen',
      filas: [],
      columnas: ['NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'WEST'],
      celdas: [],
      max: 0,
      tecnologia_activa: null,
      tecnologias: [],
      total_marcas: 0,
    },
    radar: { series: [], total_marcas: 0 },
    top_sobre_reservados: [],
    reservas_por_kam: { items: [], total_piezas: 0, total_kams: 0 },
    pipeline: [],
    // Literal, no derivado: este archivo mockea el servicio entero — la frontera del
    // test es la delegación de la ruta, no el agrupamiento (que se prueba en su propio suite).
    pipeline_grupos: [],
    tendencia: [],
    alertas: [],
    ...overrides,
  };
}

describe('GET /api/dashboard', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getDashboardMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path sin query: delega en getDashboard con el cliente de sesión y query vacío', async () => {
    const fakeResult = fakeDashboard();
    getDashboardMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(getDashboardMock).toHaveBeenCalledTimes(1);
    expect(getDashboardMock).toHaveBeenCalledWith(fakeDb, {});
    expect(createSupabaseSessionClientMock).toHaveBeenCalledTimes(1);
  });

  it('(INV-TAXO F4) ?tecnologia=RFID se parsea y se reenvía a getDashboard', async () => {
    const fakeResult = fakeDashboard({ heatmap: { ...fakeDashboard().heatmap, tecnologia_activa: 'RFID' } });
    getDashboardMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req('?tecnologia=RFID'));

    expect(res.status).toBe(200);
    expect(getDashboardMock).toHaveBeenCalledWith(fakeDb, { tecnologia: 'RFID' });
  });

  it('?tecnologia=__sin_tecnologia__ (sentinel) se parsea y se reenvía tal cual', async () => {
    getDashboardMock.mockResolvedValueOnce(fakeDashboard());

    const { GET } = await import('./route');
    const res = await GET(req('?tecnologia=__sin_tecnologia__'));

    expect(res.status).toBe(200);
    expect(getDashboardMock).toHaveBeenCalledWith(fakeDb, { tecnologia: '__sin_tecnologia__' });
  });

  it('?tecnologia= vacío (tras trim) → 400 invalid_query, no llama al service', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?tecnologia='));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(getDashboardMock).not.toHaveBeenCalled();
  });

  it('(INV-TAXO) ?tecnologia= con 500 caracteres exactos (límite) → 200, se reenvía tal cual', async () => {
    const tecnologia500 = 'A'.repeat(500);
    getDashboardMock.mockResolvedValueOnce(fakeDashboard());

    const { GET } = await import('./route');
    const res = await GET(req(`?tecnologia=${tecnologia500}`));

    expect(res.status).toBe(200);
    expect(getDashboardMock).toHaveBeenCalledWith(fakeDb, { tecnologia: tecnologia500 });
  });

  it('(INV-TAXO) ?tecnologia= con 501 caracteres (excede el máximo 500) → 400 invalid_query', async () => {
    const tecnologia501 = 'A'.repeat(501);

    const { GET } = await import('./route');
    const res = await GET(req(`?tecnologia=${tecnologia501}`));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(getDashboardMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    getDashboardMock.mockRejectedValueOnce(new Error('relation "productos" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET(req());

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
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(getDashboardMock).not.toHaveBeenCalled();
  });
});
