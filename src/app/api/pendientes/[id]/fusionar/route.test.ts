import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ResolverFamiliaNuevaResult } from '@/types';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const resolverFamiliaNuevaMock = vi.fn();

const FAKE_USER = { id: 'admin-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/** Fake db de sesión: `auth.getUser()` y el rol de `perfiles` configurables por test (default: admin). Mismo molde que `[id]/route.test.ts`. */
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
  resolverFamiliaNueva: (...args: unknown[]) => resolverFamiliaNuevaMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

/** UUID válido de fixture (mismo criterio que `[id]/route.test.ts`: `params.id` se valida como UUID antes de llamar al service). */
const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/pendientes/${ID}/fusionar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: { id: ID } };

describe('POST /api/pendientes/[id]/fusionar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolverFamiliaNuevaMock.mockReset();
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
    const req = new Request(`http://localhost/api/pendientes/${ID}/fusionar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ destino: 'SERIES 2 41', skusEsperados: 0 }),
    });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }, { origin: 'https://evil.com' });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(403);
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('id no es UUID → 404 pendiente_no_encontrado, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), { params: { id: 'no-soy-uuid' } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pendiente_no_encontrado', message: 'El pendiente no existe.' });
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }, { 'content-length': String(20_000_000) });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(413);
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body, no llama al service', async () => {
    const req = new Request(`http://localhost/api/pendientes/${ID}/fusionar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('destino vacío → 400 invalid_body con issues, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: '   ', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('sin destino en el body → 400 invalid_body, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({}), PARAMS);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(resolverFamiliaNuevaMock).not.toHaveBeenCalled();
  });

  it('200 happy path sin motivo: llega al service con motivo undefined, regresa {fusion} tal cual', async () => {
    const resultado: ResolverFamiliaNuevaResult = {
      fusion: { alias: 'SERIES 2 70', destino: 'SERIES 2 41', absorbida_existia: true, skus_que_migraran: 3 },
    };
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(resolverFamiliaNuevaMock).toHaveBeenCalledWith(fakeDb, ID, { destino: 'SERIES 2 41', skusEsperados: 0 });
  });

  it('200 happy path con motivo: el motivo viaja tal cual al service', async () => {
    const resultado: ResolverFamiliaNuevaResult = {
      fusion: { alias: 'SERIES 2 70', destino: 'SERIES 2 41', absorbida_existia: false, skus_que_migraran: 0 },
    };
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', motivo: 'Fusionada con «SERIES 2 41».', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(200);
    expect(resolverFamiliaNuevaMock).toHaveBeenCalledWith(fakeDb, ID, {
      destino: 'SERIES 2 41',
      motivo: 'Fusionada con «SERIES 2 41».',
      skusEsperados: 0,
    });
  });

  it('service regresa {tipo:"forbidden"} (RPC 42501, TOCTOU) → 403 forbidden, no 500', async () => {
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'forbidden' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
  });

  it('service regresa {tipo:"no_encontrado"} (RPC P0002) → 404 pendiente_no_encontrado', async () => {
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'no_encontrado' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pendiente_no_encontrado', message: 'El pendiente no existe.' });
  });

  it('service regresa {tipo:"invalido"} (RPC 22023) → 400 pendiente_invalido con el mensaje curado', async () => {
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'invalido', message: 'la familia destino "X" esta inactiva' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'X', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'pendiente_invalido', message: 'la familia destino "X" esta inactiva' });
  });

  it('service regresa {tipo:"no_disponible"} (0019 sin aplicar) → 503 no_disponible, no 500', async () => {
    resolverFamiliaNuevaMock.mockResolvedValueOnce({ tipo: 'no_disponible' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe('no_disponible');
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    resolverFamiliaNuevaMock.mockRejectedValueOnce(new Error('relation "pendientes_datos" violates constraint boom secreto'));

    const { POST } = await import('./route');
    const res = await POST(postReq({ destino: 'SERIES 2 41', skusEsperados: 0 }), PARAMS);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
