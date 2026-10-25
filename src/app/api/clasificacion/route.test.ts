import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que /api/familias, /api/override).
vi.mock('server-only', () => ({}));

const aplicarClasificacionMock = vi.fn();
vi.mock('@/services/clasificacion.service', () => ({
  aplicarClasificacion: (...args: unknown[]) => aplicarClasificacionMock(...args),
}));

const FAKE_USER = { id: 'user-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let perfilRol: Rol | null = 'admin';

/** Fake db de sesión: `auth.getUser()` + rol de `perfiles`, configurables por test. */
function fakeDb() {
  return {
    __fakeDb: true,
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: sessionUser },
          error: sessionUser ? null : { message: 'no autenticado' },
        }),
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
}

const createSupabaseSessionClientMock = vi.fn(() => fakeDb());
vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

const createClientMock = vi.fn((...args: unknown[]) => {
  void args; // firma con rest-param a propósito: ver `createClient: (...args) => createClientMock(...args)` abajo
  return fakeDb();
});
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return { ...actual, createClient: (...args: unknown[]) => createClientMock(...args) };
});

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    fuente_version: '260713-v1',
    dryRun: true,
    hojas: { inventario: [['ITEM']], west: [['ITEM']] },
    ...overrides,
  };
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/clasificacion', {
    method: 'POST',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/clasificacion', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    aplicarClasificacionMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    createClientMock.mockClear();
    sessionUser = FAKE_USER;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin header Origin (O8) → 403 forbidden_origin, no construye ningún cliente ni llama al service', async () => {
    const req = new Request('http://localhost/api/clasificacion', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody()),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = new Request('http://localhost/api/clasificacion', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
      body: JSON.stringify(validBody()),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401 unauthorized, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody()));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody()));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody()));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody()));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('forbidden');
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('admin + dryRun → 200 con el reporte (service mockeado)', async () => {
    const fakeResult = { reporte: { aplicables: { filas: 1 } }, dryRun: true };
    aplicarClasificacionMock.mockResolvedValueOnce(fakeResult);

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody({ dryRun: true })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(fakeResult);
    expect(aplicarClasificacionMock).toHaveBeenCalledTimes(1);
    const [, parsedPayload] = aplicarClasificacionMock.mock.calls[0];
    expect(parsedPayload.dryRun).toBe(true);
    expect(parsedPayload.fuente_version).toBe('260713-v1');
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = new Request('http://localhost/api/clasificacion', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'content-length': String(20_000_000) },
      body: JSON.stringify(validBody()),
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body', async () => {
    const req = new Request('http://localhost/api/clasificacion', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('fuente_version vacía → 400 invalid_body con issues', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq(validBody({ fuente_version: '   ' })));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(aplicarClasificacionMock).not.toHaveBeenCalled();
  });

  it('sin header Authorization: usa el cliente de sesión (cookies), no createClient', async () => {
    aplicarClasificacionMock.mockResolvedValueOnce({ reporte: {}, dryRun: true });

    const { POST } = await import('./route');
    await POST(postReq(validBody()));

    expect(createSupabaseSessionClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('con header Authorization: Bearer: construye el cliente anon+header (script one-off), no el de sesión', async () => {
    aplicarClasificacionMock.mockResolvedValueOnce({ reporte: {}, dryRun: true });

    const { POST } = await import('./route');
    await POST(postReq(validBody(), { Authorization: 'Bearer un-jwt-de-prueba' }));

    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: 'Bearer un-jwt-de-prueba' } }, auth: { persistSession: false } },
    );
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
  });

  it('error del service (p.ej. de la RPC) → 500 internal_error sin filtrar el mensaje interno', async () => {
    aplicarClasificacionMock.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "boom_secreto"'),
    );

    const { POST } = await import('./route');
    const res = await POST(postReq(validBody({ dryRun: false })));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('boom_secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
