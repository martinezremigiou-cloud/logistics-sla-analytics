import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CatalogoPage, CatalogoFacetas } from '@/types';
import type { User } from '@supabase/supabase-js';

/** Este archivo solo ejercita el gate de la ruta (query/auth/errores); el contenido de facetas es irrelevante aquí. */
const FACETAS_VACIAS: CatalogoFacetas = {
  tecnologias: [],
  marcas: [],
  familias: [],
  productos: [],
  almacenes: [],
  sin_familia: 0,
  sin_tecnologia: 0,
};

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listInventoryMock = vi.fn();

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

vi.mock('@/services/inventory.service', () => ({
  listInventory: (...args: unknown[]) => listInventoryMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function req(query = '') {
  return new Request(`http://localhost/api/inventory${query}`);
}

describe('GET /api/inventory', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listInventoryMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 happy path sin query params: aplica defaults page=1 pageSize=50', async () => {
    const fakeResult: CatalogoPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } };
    listInventoryMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listInventoryMock).toHaveBeenCalledTimes(1);
    const [db, parsedQuery] = listInventoryMock.mock.calls[0];
    expect(db).toBe(fakeDb);
    // `sinV2` siempre boolean tras zod (default 'false' → transform, B6 · O1).
    expect(parsedQuery).toEqual({ page: 1, pageSize: 50, sinV2: false, divergencia: false });
  });

  it('200 happy path con todos los filtros: se parsean y coercionan correctamente', async () => {
    const fakeResult: CatalogoPage = { items: [], page: 2, pageSize: 25, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } };
    listInventoryMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(
      req('?q=candado&marca=brand1&familia=candados&almacen=WEST&page=2&pageSize=25'),
    );

    expect(res.status).toBe(200);
    const [, parsedQuery] = listInventoryMock.mock.calls[0];
    expect(parsedQuery).toEqual({
      q: 'candado',
      marca: 'brand1',
      familia: 'candados',
      almacen: 'WEST',
      page: 2,
      pageSize: 25,
      sinV2: false,
      divergencia: false,
    });
  });

  it('B6 (F1 · O1): ?badge=sobre_reservado y ?sinV2=1 se parsean como drill-down del dashboard', async () => {
    const fakeResult: CatalogoPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } };
    listInventoryMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req('?badge=sobre_reservado&sinV2=1'));

    expect(res.status).toBe(200);
    const [, parsedQuery] = listInventoryMock.mock.calls[0];
    expect(parsedQuery).toEqual({ page: 1, pageSize: 50, badge: 'sobre_reservado', sinV2: true, divergencia: false });
  });

  it('?badge=xyz (fuera del enum) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?badge=xyz'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  // [2.0.1-A · revisión M4] Los gemelos de `badge`, para el param nuevo: el
  // paso «query string → listInventory» es la frontera donde se esconde P24.
  it('[2.0.1-A] ?estatus=sin_stock se parsea y llega a listInventory', async () => {
    const fakeResult: CatalogoPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } };
    listInventoryMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req('?estatus=sin_stock'));

    expect(res.status).toBe(200);
    const [, parsedQuery] = listInventoryMock.mock.calls[0];
    expect(parsedQuery).toEqual({ page: 1, pageSize: 50, estatus: 'sin_stock', sinV2: false, divergencia: false });
  });

  it('[2.0.1-A] ?estatus=xyz (fuera de la taxonomía) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?estatus=xyz'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('?sinV2=si (fuera de 1/true/0/false) → 400 invalid_query (sin coerción laxa)', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?sinV2=si'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('?almacen=BODEGA (fuera del enum) → 400 invalid_query con issues', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?almacen=BODEGA'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('?page=0 → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?page=0'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('?pageSize=500 (excede el máximo 200) → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(req('?pageSize=500'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('(INV-TAXO) ?familia= con 500 caracteres exactos (límite) → 200, se parsea y reenvía tal cual', async () => {
    const familia500 = 'A'.repeat(500);
    const fakeResult: CatalogoPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, facetas: FACETAS_VACIAS, excluidos: { total: 0, marcas: [] } };
    listInventoryMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(req(`?familia=${familia500}`));

    expect(res.status).toBe(200);
    const [, parsedQuery] = listInventoryMock.mock.calls[0];
    expect(parsedQuery.familia).toBe(familia500);
  });

  it('(INV-TAXO) ?familia= con 501 caracteres (excede el máximo 500) → 400 invalid_query', async () => {
    const familia501 = 'A'.repeat(501);

    const { GET } = await import('./route');
    const res = await GET(req(`?familia=${familia501}`));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(listInventoryMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listInventoryMock.mockRejectedValueOnce(
      new Error('relation "productos" violates constraint boom secreto'),
    );

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
    expect(listInventoryMock).not.toHaveBeenCalled();
  });
});
