import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EmbarquesResponse } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listEmbarquesMock = vi.fn();

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

let throwOnCreateClient = false;
const createSupabaseSessionClientMock = vi.fn(() => {
  if (throwOnCreateClient) throw new Error('env faltante secreta boom');
  return fakeDb;
});

vi.mock('@/services/embarques.service', () => ({
  listEmbarques: (...args: unknown[]) => listEmbarquesMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function fakeEmbarquesResponse(overrides: Partial<EmbarquesResponse> = {}): EmbarquesResponse {
  return {
    snapshot: null,
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    resumen: { embarques: 0, piezas: 0, activos: 0, historial: 0, piezas_activas: 0, retrasados: 0 },
    facetas: { estatus: [], paises: [], ambito: { todos: 0, activos: 0, historial: 0 } },
    ...overrides,
  };
}

function getReq(qs = ''): Request {
  return new Request(`http://localhost/api/embarques${qs}`);
}

describe('GET /api/embarques', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listEmbarquesMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    throwOnCreateClient = false;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path: delega en listEmbarques con el cliente de sesión y la query parseada', async () => {
    const fakeResult = fakeEmbarquesResponse();
    listEmbarquesMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(getReq('?ambito=activos&pageSize=25'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listEmbarquesMock).toHaveBeenCalledTimes(1);
    expect(listEmbarquesMock).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ ambito: 'activos', pageSize: 25, page: 1, orden: 'eta', dir: 'desc' }),
    );
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });

  it('query inválida (estatus fuera de 1..11) → 400 invalid_query con issues, no llama al service', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?estatus=99'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });

  it('rango invertido (desde > hasta) → 400 invalid_query con issue rango_invertido, nunca cero-resultados en silencio', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?desde=2026-08-10&hasta=2026-08-01'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(json.issues.some((i: { message?: string }) => i.message === 'rango_invertido')).toBe(true);
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });

  it('fecha sintácticamente inválida (2026-02-30) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?desde=2026-02-30'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });

  it('ambito fuera del enum → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?ambito=inexistente'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listEmbarquesMock.mockRejectedValueOnce(new Error('relation "embarques" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('createSupabaseSessionClient lanza (p.ej. env faltante) → 500 internal_error JSON, no un 500 no-JSON (fix FIX-RESET)', async () => {
    throwOnCreateClient = true;

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(listEmbarquesMock).not.toHaveBeenCalled();
  });
});
