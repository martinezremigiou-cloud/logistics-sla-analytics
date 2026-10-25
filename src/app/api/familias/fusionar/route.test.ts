import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FusionFamiliaResultado, FusionPreviewResponse } from '@/types';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const previsualizarFusionMock = vi.fn();
const fusionarFamiliaMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/** Fake db de sesión: mismo molde que `familias/route.test.ts` (default: admin, para no repetir el gate en cada caso de negocio). */
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
  previsualizarFusion: (...args: unknown[]) => previsualizarFusionMock(...args),
  fusionarFamilia: (...args: unknown[]) => fusionarFamiliaMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function getReq(query = ''): Request {
  return new Request(`http://localhost/api/familias/fusionar${query}`);
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/familias/fusionar', {
    method: 'POST',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

describe('GET /api/familias/fusionar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    previsualizarFusionMock.mockReset();
    fusionarFamiliaMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('200 con ?alias=: regresa el preview tal cual', async () => {
    const preview: FusionPreviewResponse = { alias: 'SERIES2', cubre: 1, skus_directos: 8, no_cubre: [] };
    previsualizarFusionMock.mockResolvedValueOnce(preview);

    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=SERIES2'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(preview);
    expect(previsualizarFusionMock).toHaveBeenCalledWith(fakeDb, 'SERIES2');
  });

  it('sin ?alias= → 400 invalid_query, no llama al service', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(previsualizarFusionMock).not.toHaveBeenCalled();
  });

  it('?alias= vacío/en blanco → 400 invalid_query', async () => {
    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=%20%20'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_query');
    expect(previsualizarFusionMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=SERIES2'));

    expect(res.status).toBe(401);
    expect(previsualizarFusionMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=SERIES2'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(previsualizarFusionMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=SERIES2'));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(previsualizarFusionMock).not.toHaveBeenCalled();
  });

  it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    previsualizarFusionMock.mockRejectedValueOnce(new Error('relation "familias" violates constraint boom secreto'));

    const { GET } = await import('./route');
    const res = await GET(getReq('?alias=SERIES2'));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

describe('POST /api/familias/fusionar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    previsualizarFusionMock.mockReset();
    fusionarFamiliaMock.mockReset();
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
    const req = new Request('http://localhost/api/familias/fusionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }, { origin: 'https://evil.com' });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(401);
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }, { 'content-length': String(20_000_000) });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body, no llama al service', async () => {
    const req = new Request('http://localhost/api/familias/fusionar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('alias/destino vacíos → 400 invalid_body con issues, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: '  ', destino: '' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(fusionarFamiliaMock).not.toHaveBeenCalled();
  });

  it('200 happy path: regresa el resultado de la RPC tal cual', async () => {
    const resultado: FusionFamiliaResultado = { alias: 'SERIES2', destino: 'SERIES 2', absorbida_existia: true, skus_que_migraran: 8 };
    fusionarFamiliaMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(fusionarFamiliaMock).toHaveBeenCalledWith(fakeDb, 'SERIES2', 'SERIES 2', 0);
  });

  it('service regresa {tipo:"forbidden"} (RPC 42501, TOCTOU) → 403 forbidden, no 500', async () => {
    fusionarFamiliaMock.mockResolvedValueOnce({ tipo: 'forbidden' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
  });

  it('service regresa {tipo:"no_encontrada"} (RPC P0002, destino inexistente) → 404 familia_no_encontrada', async () => {
    fusionarFamiliaMock.mockResolvedValueOnce({ tipo: 'no_encontrada', message: 'la familia destino "X" no existe en el catalogo' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'X', skusEsperados: 0 }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'familia_no_encontrada', message: 'la familia destino "X" no existe en el catalogo' });
  });

  it('service regresa {tipo:"invalido"} (RPC 22023, p.ej. destino inactivo) → 400 fusion_invalida con el mensaje curado', async () => {
    fusionarFamiliaMock.mockResolvedValueOnce({ tipo: 'invalido', message: 'la familia destino "X" esta inactiva' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'X', skusEsperados: 0 }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'fusion_invalida', message: 'la familia destino "X" esta inactiva' });
  });

  it('service regresa {tipo:"no_disponible"} (0018 sin aplicar) → 503 no_disponible, no 500', async () => {
    fusionarFamiliaMock.mockResolvedValueOnce({ tipo: 'no_disponible' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('no_disponible');
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    fusionarFamiliaMock.mockRejectedValueOnce(new Error('relation "familias" violates constraint boom secreto'));

    const { POST } = await import('./route');
    const res = await POST(postReq({ alias: 'SERIES2', destino: 'SERIES 2', skusEsperados: 0 }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
