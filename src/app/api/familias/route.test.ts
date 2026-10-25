import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FamiliaItem } from '@/services/familias.service';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listFamiliasMock = vi.fn();
const createFamiliaMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'user@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/**
 * Fake db de sesión: `auth.getUser()` y el rol de `perfiles` son
 * configurables por test. Default: sesión válida con rol admin (para
 * no repetir el gate en cada caso de negocio existente).
 */
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

vi.mock('@/services/familias.service', () => ({
  listFamilias: (...args: unknown[]) => listFamiliasMock(...args),
  createFamilia: (...args: unknown[]) => createFamiliaMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function getReq(query = ''): Request {
  return new Request(`http://localhost/api/familias${query}`);
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/familias', {
    method: 'POST',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/familias', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listFamiliasMock.mockReset();
    createFamiliaMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 sin query: incluirInactivas=false por default', async () => {
    const fakeResult = { items: [{ id: 'f-1', nombre: 'CANDADOS', activo: true }] };
    listFamiliasMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listFamiliasMock).toHaveBeenCalledWith(fakeDb, false);
  });

  it('?incluirInactivas=true trae todas (activas e inactivas)', async () => {
    const fakeResult = { items: [{ id: 'f-1', nombre: 'CANDADOS', activo: true }, { id: 'f-2', nombre: 'BAJA', activo: false }] };
    listFamiliasMock.mockResolvedValueOnce(fakeResult);

    const { GET } = await import('./route');
    const res = await GET(getReq('?incluirInactivas=true'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(listFamiliasMock).toHaveBeenCalledWith(fakeDb, true);
  });

  it('valor raro en incluirInactivas → 400 invalid_query, no llama al service', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?incluirInactivas=quizas'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_query');
    expect(listFamiliasMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    listFamiliasMock.mockRejectedValueOnce(new Error('relation "familias" violates constraint boom secreto'));

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

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(listFamiliasMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/familias', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listFamiliasMock.mockReset();
    createFamiliaMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin header Origin (O8) → 403 forbidden_origin, no construye el cliente de sesión ni llama al service', async () => {
    const req = new Request('http://localhost/api/familias', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'CANDADOS' }),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = new Request('http://localhost/api/familias', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
      body: JSON.stringify({ nombre: 'CANDADOS' }),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service (antes de parsear el body)', async () => {
    const req = new Request('http://localhost/api/familias', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'content-length': String(20_000_000),
      },
      body: JSON.stringify({ nombre: 'CANDADOS' }),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body', async () => {
    const req = new Request('http://localhost/api/familias', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('nombre vacío → 400 invalid_body con issues', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: '   ' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(createFamiliaMock).not.toHaveBeenCalled();
  });

  it('sesión admin + nombre válido → 201 con la familia creada, reactivada:false', async () => {
    const familia: FamiliaItem = { id: 'f-1', nombre: 'CARGADORES', activo: true };
    createFamiliaMock.mockResolvedValueOnce({ ok: true, familia, origen: 'creada' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CARGADORES' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...familia, reactivada: false, aliasVivo: false });
    expect(createFamiliaMock).toHaveBeenCalledWith(fakeDb, 'CARGADORES');
  });

  it('sesión admin + nombre de familia INACTIVA existente → 201 con reactivada:true (D, MVP-2)', async () => {
    const familia: FamiliaItem = { id: 'f-2', nombre: 'BLISTER', activo: true };
    createFamiliaMock.mockResolvedValueOnce({ ok: true, familia, origen: 'reactivada', aliasVivo: false });

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'blister' }));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...familia, reactivada: true, aliasVivo: false });
  });

  it('duplicada (precheck del service) → 409 familia_duplicada', async () => {
    createFamiliaMock.mockResolvedValueOnce({ ok: false, motivo: 'duplicada' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe('familia_duplicada');
    expect(typeof json.message).toBe('string');
  });

  it('duplicada por carrera 23505 (mapeada en el service al mismo shape) → 409 sin fuga del mensaje PG', async () => {
    // El service ya colapsa el 23505 a { ok:false, motivo:'duplicada' } (cubierto en
    // familias.service.test.ts); a la ruta le resulta indistinguible del precheck.
    createFamiliaMock.mockResolvedValueOnce({ ok: false, motivo: 'duplicada' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(409);
    const json = await res.json();
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('familias_nombre_unique');
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    createFamiliaMock.mockRejectedValueOnce(new Error('relation "familias" violates constraint boom secreto'));

    const { POST } = await import('./route');
    const res = await POST(postReq({ nombre: 'CANDADOS' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
