import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ResolverPendienteResult } from '@/types';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const resolverPendienteMock = vi.fn();

const FAKE_USER = { id: 'admin-1', email: 'admin@example.com' } as User;
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
  resolverPendiente: (...args: unknown[]) => resolverPendienteMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

/** UUID válido de fixture (fix M1: `params.id` ahora se valida como UUID antes de llamar al service). */
const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/pendientes/${ID}`, {
    method: 'POST',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

const PARAMS = { params: { id: ID } };

describe('POST /api/pendientes/[id]', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resolverPendienteMock.mockReset();
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
    const req = new Request(`http://localhost/api/pendientes/${ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'confirmar' }),
    });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = postReq({ accion: 'confirmar' }, { origin: 'https://evil.com' });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('id no es UUID → 404 pendiente_no_encontrado, no llama al service (fix M1)', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), { params: { id: 'no-soy-uuid' } });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pendiente_no_encontrado', message: 'El pendiente no existe.' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = postReq({ accion: 'confirmar' }, { 'content-length': String(20_000_000) });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body, no llama al service', async () => {
    const req = new Request(`http://localhost/api/pendientes/${ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { POST } = await import('./route');
    const res = await POST(req, PARAMS);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('accion fuera del enum → 400 invalid_body con issues, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'borrar' }), PARAMS);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('descartar sin motivo → 400 invalid_body (el zod lo exige, sin ir a la BD)', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'descartar' }), PARAMS);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('descartar con motivo vacío/blanco → 400 invalid_body', async () => {
    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'descartar', motivo: '   ' }), PARAMS);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(resolverPendienteMock).not.toHaveBeenCalled();
  });

  it('confirmar sin motivo ni valor: pasa la validación (ambos opcionales), llega al service', async () => {
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'ok', resultado: { estado: 'resuelto', actor: 'admin@example.com' } });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(200);
    expect(resolverPendienteMock).toHaveBeenCalledWith(fakeDb, ID, { accion: 'confirmar' });
  });

  it('200 happy path (confirmar con valor): regresa el resultado tal cual', async () => {
    const resultado: ResolverPendienteResult = { estado: 'resuelto', actor: 'admin@example.com', ref: { kam_id: 'kam-9' } };
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar', valor: 'NADIA' }), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(resolverPendienteMock).toHaveBeenCalledWith(fakeDb, ID, { accion: 'confirmar', valor: 'NADIA' });
  });

  it('200 happy path (descartar con motivo): regresa el resultado tal cual', async () => {
    const resultado: ResolverPendienteResult = { estado: 'descartado', actor: 'admin@example.com' };
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'descartar', motivo: 'Duplicado' }), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(resolverPendienteMock).toHaveBeenCalledWith(fakeDb, ID, { accion: 'descartar', motivo: 'Duplicado' });
  });

  it('service regresa {tipo:"forbidden"} (RPC 42501, TOCTOU) → 403 forbidden, no 500', async () => {
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'forbidden' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
  });

  it('service regresa {tipo:"no_encontrado"} (RPC P0002) → 404 pendiente_no_encontrado', async () => {
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'no_encontrado' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'pendiente_no_encontrado', message: 'El pendiente no existe.' });
  });

  it('service regresa {tipo:"invalido"} (RPC 22023, p.ej. ya resuelto) → 400 pendiente_invalido con el mensaje curado', async () => {
    resolverPendienteMock.mockResolvedValueOnce({ tipo: 'invalido', message: 'pendiente ya resuelto/descartado' });

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'pendiente_invalido', message: 'pendiente ya resuelto/descartado' });
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    resolverPendienteMock.mockRejectedValueOnce(new Error('relation "pendientes_datos" violates constraint boom secreto'));

    const { POST } = await import('./route');
    const res = await POST(postReq({ accion: 'confirmar' }), PARAMS);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
