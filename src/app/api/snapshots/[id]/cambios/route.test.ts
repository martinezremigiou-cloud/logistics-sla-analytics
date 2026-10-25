import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CambiosPage } from '@/types';
import type { User } from '@supabase/supabase-js';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const getSnapshotCambiosMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'kam@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;

/** Fake db de sesión: `auth.getUser()` configurable por test (default: sesión válida — sin gate admin). */
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
  getSnapshotCambios: (...args: unknown[]) => getSnapshotCambiosMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

/** UUID válido de fixture. */
const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function fakeCambiosPage(overrides: Partial<CambiosPage> = {}): CambiosPage {
  return {
    snapshot: {
      id: ID,
      fuente: 'aduana',
      periodo: '2026-07',
      archivo: 'aduana.xlsx',
      filas: 214,
      hash: 'hash1234567890abcdef',
      created_at: '2026-07-20T08:00:00.000Z',
      created_by: 'bridge',
      vigente: true,
      detectado_en: '2026-07-20T10:00:00.000Z',
    },
    resumen: { total: 131, altas: 72, bajas: 35, modificaciones: 24 },
    items: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    ...overrides,
  };
}

function getReq(id: string, qs = ''): Request {
  return new Request(`http://localhost/api/snapshots/${id}/cambios${qs}`);
}

function params(id: string) {
  return { params: { id } };
}

describe('GET /api/snapshots/[id]/cambios', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getSnapshotCambiosMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    throwOnCreateClient = false;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path: delega en getSnapshotCambios con el cliente de sesión, el id y la query parseada', async () => {
    const fakeResult = fakeCambiosPage();
    getSnapshotCambiosMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(getReq(ID, '?entidad=embarque&tipo=MODIFICACION'), params(ID));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(getSnapshotCambiosMock).toHaveBeenCalledTimes(1);
    expect(getSnapshotCambiosMock).toHaveBeenCalledWith(
      fakeDb,
      ID,
      expect.objectContaining({ entidad: 'embarque', tipo: 'MODIFICACION', page: 1, pageSize: 50 }),
    );
  });

  it('sin sesión (anon) → 401 unauthorized, no valida id ni llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(getReq(ID), params(ID));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(getSnapshotCambiosMock).not.toHaveBeenCalled();
  });

  it('id NO es UUID → 400 invalid_query (a diferencia de /api/pendientes/[id], que usa 404 ahí)', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('no-soy-uuid'), params('no-soy-uuid'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(getSnapshotCambiosMock).not.toHaveBeenCalled();
  });

  it('id UUID bien formado pero snapshot inexistente (service regresa null) → 404 snapshot_no_encontrado', async () => {
    getSnapshotCambiosMock.mockResolvedValueOnce(null);

    const { GET } = await import('./route');
    const res = await GET(getReq(ID), params(ID));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'snapshot_no_encontrado', message: 'El snapshot no existe.' });
  });

  it('query inválida (tipo fuera del enum) → 400 invalid_query, no llama al service', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq(ID, '?tipo=BORRADO'), params(ID));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(getSnapshotCambiosMock).not.toHaveBeenCalled();
  });

  it('pageSize por encima del máximo (200) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq(ID, '?pageSize=201'), params(ID));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(getSnapshotCambiosMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    getSnapshotCambiosMock.mockRejectedValueOnce(new Error('relation "cambios" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET(getReq(ID), params(ID));

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
    const res = await GET(getReq(ID), params(ID));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
    expect(getSnapshotCambiosMock).not.toHaveBeenCalled();
  });
});
