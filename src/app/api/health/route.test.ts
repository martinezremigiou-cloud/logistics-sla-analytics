import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { HealthResponse } from '@/services/health.service';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const getHealthMock = vi.fn();

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

vi.mock('@/services/health.service', () => ({
  getHealth: (...args: unknown[]) => getHealthMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

describe('GET /api/health', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getHealthMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 con estado ok cuando ambas fuentes tienen snapshot vigente', async () => {
    const fakeResult: HealthResponse = {
      estado: 'ok',
      fuentes: {
        stock: { snapshotId: 'snap-1', created_at: '2026-07-10T00:00:00.000Z', filas: 120, archivo: 'stock.xlsx' },
        aduana: { snapshotId: 'snap-2', created_at: '2026-07-09T00:00:00.000Z', filas: 40, archivo: 'aduana.xlsx' },
      },
    };
    getHealthMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(getHealthMock).toHaveBeenCalledTimes(1);
    expect(createSupabaseSessionClientMock).toHaveBeenCalledTimes(1);
  });

  it('200 con estado degradado cuando falta una fuente', async () => {
    const fakeResult: HealthResponse = {
      estado: 'degradado',
      fuentes: { stock: null, aduana: null },
    };
    getHealthMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
  });

  it('503 no_disponible cuando el service lanza, sin filtrar el mensaje interno', async () => {
    getHealthMock.mockRejectedValueOnce(
      new Error('relation "snapshots" violates constraint boom secreto'),
    );

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('no_disponible');
    expect(typeof json.message).toBe('string');

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
    expect(getHealthMock).not.toHaveBeenCalled();
  });
});
