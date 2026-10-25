import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SnapshotsPage } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listSnapshotsMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'kam@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;

/** Fake db de sesión: `auth.getUser()` configurable por test (default: sesión válida — sin gate admin, la RLS es USING(true)). */
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

vi.mock('@/services/snapshots.service', () => ({
  listSnapshots: (...args: unknown[]) => listSnapshotsMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function fakeSnapshotsPage(overrides: Partial<SnapshotsPage> = {}): SnapshotsPage {
  return {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
    vigentes: { stock: null, aduana: null },
    ...overrides,
  };
}

function getReq(qs = ''): Request {
  return new Request(`http://localhost/api/snapshots${qs}`);
}

describe('GET /api/snapshots', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listSnapshotsMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    throwOnCreateClient = false;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path: delega en listSnapshots con el cliente de sesión y la query parseada (defaults incl.)', async () => {
    const fakeResult = fakeSnapshotsPage();
    listSnapshotsMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listSnapshotsMock).toHaveBeenCalledTimes(1);
    expect(listSnapshotsMock).toHaveBeenCalledWith(fakeDb, { page: 1, pageSize: 20 });
  });

  it('con fuente/periodo/page/pageSize: los pasa parseados al service', async () => {
    listSnapshotsMock.mockResolvedValueOnce(fakeSnapshotsPage());

    const { GET } = await import('./route');
    await GET(getReq('?fuente=aduana&periodo=2026-07&page=2&pageSize=50'));

    expect(listSnapshotsMock).toHaveBeenCalledWith(fakeDb, { fuente: 'aduana', periodo: '2026-07', page: 2, pageSize: 50 });
  });

  it('NO requiere rol admin: cualquier sesión válida basta (no hay gate de perfil)', async () => {
    listSnapshotsMock.mockResolvedValueOnce(fakeSnapshotsPage());
    const { GET } = await import('./route');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listSnapshotsMock).not.toHaveBeenCalled();
  });

  it('fuente fuera del enum → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?fuente=no-existe'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(listSnapshotsMock).not.toHaveBeenCalled();
  });

  it('periodo con formato inválido → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?periodo=julio-2026'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listSnapshotsMock).not.toHaveBeenCalled();
  });

  it('pageSize por encima del máximo (100) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?pageSize=101'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listSnapshotsMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listSnapshotsMock.mockRejectedValueOnce(new Error('relation "snapshots" violates constraint boom secreto'));

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
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(listSnapshotsMock).not.toHaveBeenCalled();
  });
});
