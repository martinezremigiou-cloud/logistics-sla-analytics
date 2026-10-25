import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PendientesResponse } from '@/types';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listPendientesMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'user@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/** Fake db de sesión: `auth.getUser()` y el rol de `perfiles` configurables por test (default: admin). */
const fakeDb = {
  __fakeDb: true,
  auth: {
    getUser: () => Promise.resolve({ data: { user: sessionUser }, error: sessionError }),
  },
  from: (table: string) => {
    if (table !== 'perfiles') throw new Error(`tabla inesperada en el fake db: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: perfilRol ? { rol: perfilRol } : null, error: null }),
        }),
      }),
    };
  },
};

const createSupabaseSessionClientMock = vi.fn(() => fakeDb);

vi.mock('@/services/pendientes.service', () => ({
  listPendientes: (...args: unknown[]) => listPendientesMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function fakeResponse(overrides: Partial<PendientesResponse> = {}): PendientesResponse {
  return {
    pendientes: [],
    derivados: { descuadres: [], drift: null, puentes: null },
    conteos: { abiertos: 0, por_tipo: {} },
    tecnologias: [],
    ...overrides,
  };
}

describe('GET /api/pendientes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listPendientesMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listPendientesMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service (la lista es admin-only)', async () => {
    perfilRol = 'kam';

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(listPendientesMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(listPendientesMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(listPendientesMock).not.toHaveBeenCalled();
  });

  it('admin → 200, delega en el service con el cliente de sesión', async () => {
    const fakeResult = fakeResponse({ conteos: { abiertos: 3, por_tipo: { kam_desconocido: 3 } } });
    listPendientesMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listPendientesMock).toHaveBeenCalledWith(fakeDb);
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listPendientesMock.mockRejectedValueOnce(new Error('relation "pendientes_datos" violates constraint boom secreto'));

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
});
