import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CruceResponse } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const getCruceMock = vi.fn();

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

vi.mock('@/services/cruce.service', () => ({
  getCruce: (...args: unknown[]) => getCruceMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function fakeCruce(overrides: Partial<CruceResponse> = {}): CruceResponse {
  return {
    snapshot: null,
    resumen: { embarques_activos: 0, piezas_activas: 0, embarques_historial: 0, piezas_historial: 0 },
    etapas: [],
    skus_activos: [],
    ...overrides,
  };
}

describe('GET /api/cruce', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getCruceMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path: delega en getCruce con el cliente de sesión', async () => {
    const fakeResult = fakeCruce();
    getCruceMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(getCruceMock).toHaveBeenCalledTimes(1);
    expect(getCruceMock).toHaveBeenCalledWith(fakeDb);
    expect(createSupabaseSessionClientMock).toHaveBeenCalledTimes(1);
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    getCruceMock.mockRejectedValueOnce(new Error('relation "embarques" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET();

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
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(getCruceMock).not.toHaveBeenCalled();
  });
});
