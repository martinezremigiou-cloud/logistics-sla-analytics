import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { UsuarioItem, CrearUsuarioResult } from '@/services/usuarios.service';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const listarUsuariosMock = vi.fn();
const crearUsuarioMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/** Fake db de sesión: `auth.getUser()` y el rol de `perfiles` configurables por test. */
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
let throwOnCreateSessionClient = false;
const createSupabaseSessionClientMock = vi.fn(() => {
  if (throwOnCreateSessionClient) throw new Error('env faltante secreta boom');
  return fakeSessionDb;
});
const createSupabaseServerClientMock = vi.fn(() => fakeAdmin);

vi.mock('@/services/usuarios.service', () => ({
  listarUsuarios: (...args: unknown[]) => listarUsuariosMock(...args),
  crearUsuario: (...args: unknown[]) => crearUsuarioMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => createSupabaseServerClientMock(),
}));

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/usuarios', {
    method: 'POST',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...headers },
    body: JSON.stringify(body),
  });
}

describe('/api/usuarios', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    listarUsuariosMock.mockReset();
    crearUsuarioMock.mockReset();
    createSupabaseSessionClientMock.mockClear();
    createSupabaseServerClientMock.mockClear();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
    throwOnCreateSessionClient = false;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('GET', () => {
    it('sin sesión (anon) → 401, no llama al service ni construye el cliente service_role', async () => {
      sessionUser = null;

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
      expect(listarUsuariosMock).not.toHaveBeenCalled();
      expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    });

    it('rol kam → 403 forbidden, no llama al service', async () => {
      perfilRol = 'kam';

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
      expect(listarUsuariosMock).not.toHaveBeenCalled();
    });

    it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
      perfilRol = 'visitante';

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
      expect(listarUsuariosMock).not.toHaveBeenCalled();
    });

    it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
      perfilRol = 'soporte';

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
      expect(listarUsuariosMock).not.toHaveBeenCalled();
    });

    it('admin → 200 con { items }, delega en el service con el cliente service_role', async () => {
      const items: UsuarioItem[] = [{ id: 'u-1', email: 'a@example.com', rol: 'admin', suspendido: false }];
      listarUsuariosMock.mockResolvedValueOnce(items);

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items });
      expect(listarUsuariosMock).toHaveBeenCalledWith(fakeAdmin);
    });

    it('error del service → 500 internal_error sin filtrar el mensaje interno', async () => {
      listarUsuariosMock.mockRejectedValueOnce(new Error('gotrue caído secreto'));

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: 'internal_error' });
      expect(JSON.stringify(json)).not.toContain('secreto');
    });

    it('createSupabaseSessionClient lanza (p.ej. env faltante) → 500 internal_error JSON, no un 500 no-JSON (fix H6, mismo patrón que /api/snapshots)', async () => {
      throwOnCreateSessionClient = true;

      const { GET } = await import('./route');
      const res = await GET();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'internal_error' });
      expect(listarUsuariosMock).not.toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    const validBody = { email: 'nuevo@example.com', rol: 'kam' };

    it('sin header Origin (O8) → 403 forbidden_origin, no construye ningún cliente ni llama al service', async () => {
      const req = new Request('http://localhost/api/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody),
      });

      const { POST } = await import('./route');
      const res = await POST(req);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
      expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
      expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
      const req = postReq(validBody, { origin: 'https://evil.com' });

      const { POST } = await import('./route');
      const res = await POST(req);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('sin sesión (anon) → 401, no llama al service', async () => {
      sessionUser = null;

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(401);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('rol kam → 403 forbidden, no llama al service', async () => {
      perfilRol = 'kam';

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(403);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
      perfilRol = 'visitante';

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(403);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
      perfilRol = 'soporte';

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(403);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
      const req = new Request('http://localhost/api/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'content-length': String(20_000_000) },
        body: JSON.stringify(validBody),
      });

      const { POST } = await import('./route');
      const res = await POST(req);

      expect(res.status).toBe(413);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('json roto → 400 invalid_body', async () => {
      const req = new Request('http://localhost/api/usuarios', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
        body: '{esto no es json',
      });

      const { POST } = await import('./route');
      const res = await POST(req);

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_body');
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('email inválido → 400 invalid_body con issues', async () => {
      const { POST } = await import('./route');
      const res = await POST(postReq({ email: 'no-es-un-correo' }));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid_body');
      expect(Array.isArray(json.issues)).toBe(true);
      expect(json.issues.length).toBeGreaterThan(0);
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });

    it('rol default "kam" cuando se omite', async () => {
      crearUsuarioMock.mockResolvedValueOnce({
        ok: true,
        usuario: { id: 'nuevo-1', email: 'nuevo@example.com', rol: 'kam' },
        password_temporal: 'clave-temporal-demo',
      } satisfies CrearUsuarioResult);

      const { POST } = await import('./route');
      await POST(postReq({ email: 'nuevo@example.com' }));

      expect(crearUsuarioMock).toHaveBeenCalledWith(fakeAdmin, { email: 'nuevo@example.com', rol: 'kam' });
    });

    it('201 happy path: regresa usuario + password_temporal (se muestra UNA vez)', async () => {
      const result: CrearUsuarioResult = {
        ok: true,
        usuario: { id: 'nuevo-1', email: 'nuevo@example.com', rol: 'kam' },
        password_temporal: 'clave-temporal-demo',
      };
      crearUsuarioMock.mockResolvedValueOnce(result);

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        usuario: { id: 'nuevo-1', email: 'nuevo@example.com', rol: 'kam' },
        password_temporal: 'clave-temporal-demo',
      });
      expect(crearUsuarioMock).toHaveBeenCalledWith(fakeAdmin, { email: 'nuevo@example.com', rol: 'kam' });
    });

    it('201 happy path con rol:"visitante": regresa usuario + password_temporal (Bloque 7-A)', async () => {
      const result: CrearUsuarioResult = {
        ok: true,
        usuario: { id: 'nuevo-4', email: 'visitante-nuevo@example.com', rol: 'visitante' },
        password_temporal: 'clave-temporal-demo',
      };
      crearUsuarioMock.mockResolvedValueOnce(result);

      const { POST } = await import('./route');
      const res = await POST(postReq({ email: 'visitante-nuevo@example.com', rol: 'visitante' }));

      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({
        usuario: { id: 'nuevo-4', email: 'visitante-nuevo@example.com', rol: 'visitante' },
        password_temporal: 'clave-temporal-demo',
      });
      expect(crearUsuarioMock).toHaveBeenCalledWith(fakeAdmin, { email: 'visitante-nuevo@example.com', rol: 'visitante' });
    });

    it('correo duplicado → 409 usuario_duplicado, sin filtrar detalle de GoTrue', async () => {
      crearUsuarioMock.mockResolvedValueOnce({ ok: false, motivo: 'duplicado' } satisfies CrearUsuarioResult);

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: 'usuario_duplicado',
        message: 'Ya existe un usuario con ese correo.',
      });
    });

    it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
      crearUsuarioMock.mockRejectedValueOnce(new Error('auth.admin.createUser: boom secreto'));

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json).toEqual({ error: 'internal_error' });
      expect(JSON.stringify(json)).not.toContain('secreto');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('createSupabaseSessionClient lanza (p.ej. env faltante) → 500 internal_error JSON, no un 500 no-JSON (fix H6, mismo patrón que /api/snapshots)', async () => {
      throwOnCreateSessionClient = true;

      const { POST } = await import('./route');
      const res = await POST(postReq(validBody));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'internal_error' });
      expect(crearUsuarioMock).not.toHaveBeenCalled();
    });
  });
});
