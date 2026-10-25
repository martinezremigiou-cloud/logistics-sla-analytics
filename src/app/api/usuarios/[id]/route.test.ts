import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { ActualizarUsuarioResult } from '@/services/usuarios.service';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const actualizarUsuarioMock = vi.fn();

const FAKE_ADMIN_USER = { id: 'admin-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_ADMIN_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

const fakeSessionDb = {
  __fakeSessionDb: true,
  auth: {
    getUser: () => Promise.resolve({ data: { user: sessionUser }, error: sessionError }),
  },
  from: (table: string) => {
    if (table !== 'perfiles') throw new Error(`tabla inesperada en el fake db de sesión: ${table}`);
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: perfilRol ? { rol: perfilRol } : null, error: null }),
        }),
      }),
    };
  },
};

const fakeAdmin = { __fakeAdmin: true };
const createSupabaseSessionClientMock = vi.fn(() => fakeSessionDb);
const createSupabaseServerClientMock = vi.fn(() => fakeAdmin);

vi.mock('@/services/usuarios.service', () => ({
  actualizarUsuario: (...args: unknown[]) => actualizarUsuarioMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

function patchReq(body: unknown): Request {
  return new Request('http://localhost/api/usuarios/otro-id', {
    method: 'PATCH',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/usuarios/[id]', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    actualizarUsuarioMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    createSupabaseServerClientMock.mockClear();
    sessionUser = FAKE_ADMIN_USER;
    sessionError = null;
    perfilRol = 'admin';
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('sin header Origin (O8) → 403 forbidden_origin, no construye ningún cliente ni llama al service', async () => {
    const req = new Request('http://localhost/api/usuarios/otro-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accion: 'suspender' }),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(req, { params: { id: 'otro-id' } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = new Request('http://localhost/api/usuarios/otro-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
      body: JSON.stringify({ accion: 'suspender' }),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(req, { params: { id: 'otro-id' } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(401);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(403);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(403);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(403);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('auto-modificación (params.id === el propio actor) → 403 forbidden, no llama al service', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'admin-1' } });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'forbidden',
      message: 'No puedes modificar tu propia cuenta desde aquí.',
    });
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = new Request('http://localhost/api/usuarios/otro-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'content-length': String(20_000_000) },
      body: JSON.stringify({ accion: 'suspender' }),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(req, { params: { id: 'otro-id' } });

    expect(res.status).toBe(413);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body', async () => {
    const req = new Request('http://localhost/api/usuarios/otro-id', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(req, { params: { id: 'otro-id' } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('accion fuera del enum → 400 invalid_body con issues', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'borrar' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('accion "rol" sin el campo rol → 400 invalid_body', async () => {
    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'rol' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('200 happy path (rol): delega en el service con el cliente service_role', async () => {
    const result: ActualizarUsuarioResult = {
      usuario: { id: 'otro-id', email: 'otro@example.com', rol: 'admin', suspendido: false },
    };
    actualizarUsuarioMock.mockResolvedValueOnce(result);

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'rol', rol: 'admin' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(actualizarUsuarioMock).toHaveBeenCalledWith(fakeAdmin, 'otro-id', { accion: 'rol', rol: 'admin' });
  });

  it('200 happy path (cambio de rol a visitante, Bloque 7-A): delega en el service con el cliente service_role', async () => {
    const result: ActualizarUsuarioResult = {
      usuario: { id: 'otro-id', email: 'otro@example.com', rol: 'visitante', suspendido: false },
    };
    actualizarUsuarioMock.mockResolvedValueOnce(result);

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'rol', rol: 'visitante' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
    expect(actualizarUsuarioMock).toHaveBeenCalledWith(fakeAdmin, 'otro-id', { accion: 'rol', rol: 'visitante' });
  });

  it('200 happy path (reset_password): regresa password_temporal en el body', async () => {
    const result: ActualizarUsuarioResult = {
      usuario: { id: 'otro-id', email: 'otro@example.com', rol: 'kam', suspendido: false },
      password_temporal: 'NUEVA_TEMP_0001',
    };
    actualizarUsuarioMock.mockResolvedValueOnce(result);

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'reset_password' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    actualizarUsuarioMock.mockRejectedValueOnce(new Error('auth.admin.updateUserById: boom secreto'));

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it('FIX6: createSupabaseSessionClient lanza (config faltante) → 500 internal_error, NUNCA un 500 no-JSON', async () => {
    createSupabaseSessionClientMock.mockImplementationOnce(() => {
      throw new Error('falta configuración del servidor (secreto)');
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('secreto');
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });

  it('FIX6: createSupabaseServerClient lanza (config faltante) tras pasar el gate → 500 internal_error', async () => {
    createSupabaseServerClientMock.mockImplementationOnce(() => {
      throw new Error('falta configuración del servidor (secreto)');
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(patchReq({ accion: 'suspender' }), { params: { id: 'otro-id' } });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('secreto');
    expect(actualizarUsuarioMock).not.toHaveBeenCalled();
  });
});
