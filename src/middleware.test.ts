import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

type FakeUser = { id: string; email?: string } | null;

const getUserMock = vi.fn<() => Promise<{ data: { user: FakeUser } }>>();

// Cadena `.from('perfiles').select('rol').eq('id', userId).maybeSingle()` —
// SOLO la usa la rama de mantenimiento (O12) para resolver `esAdmin`; el
// resto de tests (sin MANTENIMIENTO=1) nunca la tocan, así que un default
// "sin datos" es inofensivo para ellos.
const maybeSingleMock = vi.fn<() => Promise<{ data: { rol: string } | null; error: { message: string } | null }>>();
const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type MiddlewareClientOptions = {
  cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (cookiesToSet: CookieToSet[]) => void;
  };
};

const createServerClientMock = vi.fn<
  (
    url: string,
    key: string,
    options: MiddlewareClientOptions,
  ) => { auth: { getUser: typeof getUserMock }; from: typeof fromMock }
>(() => ({ auth: { getUser: getUserMock }, from: fromMock }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (url: string, key: string, options: MiddlewareClientOptions) =>
    createServerClientMock(url, key, options),
}));

import { middleware, config } from './middleware';

function buildRequest(path: string) {
  return new NextRequest(new URL(path, 'https://x.test'));
}

describe('middleware', () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getUserMock.mockReset();
    fromMock.mockClear();
    selectMock.mockClear();
    eqMock.mockClear();
    maybeSingleMock.mockReset();
  });

  it('redirige a /login?next=<pathname> cuando no hay usuario en una página', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const res = await middleware(buildRequest('/catalogo'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://x.test/login?next=%2Fcatalogo');
  });

  it('deja pasar cuando hay usuario en una página', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1', email: 'kam@example.com' } } });

    const res = await middleware(buildRequest('/catalogo'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('/api/* sin usuario pasa sin redirect (el 401 lo emite el handler)', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null } });

    const res = await middleware(buildRequest('/api/inventory'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('/api/* con usuario también pasa sin redirect', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });

    const res = await middleware(buildRequest('/api/inventory'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('getUser() lanza en una página → se trata como sin-usuario (redirige a /login)', async () => {
    getUserMock.mockRejectedValueOnce(new Error('auth server caído'));

    const res = await middleware(buildRequest('/catalogo'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://x.test/login?next=%2Fcatalogo');
  });

  it('getUser() lanza en /api/* → pasa sin redirect (el handler responde 401)', async () => {
    getUserMock.mockRejectedValueOnce(new Error('auth server caído'));

    const res = await middleware(buildRequest('/api/inventory'));

    expect(res.headers.get('location')).toBeNull();
  });

  it('cookies.getAll del cliente delega en request.cookies.getAll', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const request = buildRequest('/catalogo');

    await middleware(request);

    const [, , options] = createServerClientMock.mock.calls[0];
    expect(options.cookies.getAll()).toEqual(request.cookies.getAll());
  });

  it('cookies.setAll no lanza y reescribe las cookies de la respuesta', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
    const request = buildRequest('/catalogo');

    await middleware(request);

    const [, , options] = createServerClientMock.mock.calls[0];
    expect(() =>
      options.cookies.setAll([{ name: 'sb-access-token', value: 'refreshed', options: { path: '/' } }]),
    ).not.toThrow();
  });

  describe('modo mantenimiento (O12)', () => {
    const CLAVE = 'MANTENIMIENTO' as const;
    let respaldo: string | undefined;

    beforeEach(() => {
      respaldo = process.env[CLAVE];
      delete process.env[CLAVE];
    });

    afterEach(() => {
      if (respaldo === undefined) delete process.env[CLAVE];
      else process.env[CLAVE] = respaldo;
    });

    it('SIN la variable: comportamiento byte a byte igual al de antes de O12 — nunca consulta perfiles ni reescribe', async () => {
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });

      const res = await middleware(buildRequest('/catalogo'));

      expect(fromMock).not.toHaveBeenCalled();
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
    });

    it('SIN la variable, en /api/*: tampoco consulta perfiles ni reescribe (rama muerta también aquí)', async () => {
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const res = await middleware(buildRequest('/api/dashboard'));

      expect(fromMock).not.toHaveBeenCalled();
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('MANTENIMIENTO=1 y SIN sesión en una página: rewrite a /mantenimiento (fail-closed, no pregunta rol)', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const res = await middleware(buildRequest('/catalogo'));

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://x.test/mantenimiento');
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('MANTENIMIENTO=1 y sesión con rol NO admin: rewrite a /mantenimiento', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
      maybeSingleMock.mockResolvedValueOnce({ data: { rol: 'kam' }, error: null });

      const res = await middleware(buildRequest('/catalogo'));

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://x.test/mantenimiento');
      expect(fromMock).toHaveBeenCalledWith('perfiles');
      expect(eqMock).toHaveBeenCalledWith('id', 'u1');
    });

    it('MANTENIMIENTO=1 y sesión con rol admin: pasa con normalidad (sin rewrite, sin redirect)', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
      maybeSingleMock.mockResolvedValueOnce({ data: { rol: 'admin' }, error: null });

      const res = await middleware(buildRequest('/catalogo'));

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
    });

    it('MANTENIMIENTO=1 y falla la lectura de perfiles (error): fail-closed → rewrite, no revienta', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'u1' } } });
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

      const res = await middleware(buildRequest('/catalogo'));

      expect(res.headers.get('x-middleware-rewrite')).toBe('https://x.test/mantenimiento');
    });

    it('MANTENIMIENTO=1 y falla la lectura de perfiles (error): SÍ se registra antes de caer a fail-closed (ronda 2, punto A — antes era fail-closed en silencio)', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'admin-atrapado' } } });
      const errorLectura = { message: 'boom' };
      maybeSingleMock.mockResolvedValueOnce({ data: null, error: errorLectura });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await middleware(buildRequest('/catalogo'));

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[middleware]'), errorLectura);
      consoleErrorSpy.mockRestore();
    });

    it('MANTENIMIENTO=1: /api/dashboard (NO exenta) responde 503 JSON `no_disponible` para un no-admin — ya NO reescribe HTML (ronda 2, punto C)', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const res = await middleware(buildRequest('/api/dashboard'));

      expect(res.status).toBe(503);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(await res.json()).toEqual({ error: 'no_disponible', message: expect.any(String) });
    });

    it('MANTENIMIENTO=1: /api/dashboard con sesión admin pasa con normalidad (sin 503, sin rewrite) — el JSON de mantenimiento solo aplica a no-admins', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
      maybeSingleMock.mockResolvedValueOnce({ data: { rol: 'admin' }, error: null });

      const res = await middleware(buildRequest('/api/dashboard'));

      expect(res.status).not.toBe(503);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
    });

    it('MANTENIMIENTO=1: /api/version queda exenta — pasa normal aunque no haya sesión, sin consultar rol', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const res = await middleware(buildRequest('/api/version'));

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(res.headers.get('location')).toBeNull();
      expect(fromMock).not.toHaveBeenCalled();
    });

    it('MANTENIMIENTO=1: /api/refresh también queda exenta (defensa redundante — ya está fuera del matcher)', async () => {
      process.env[CLAVE] = '1';
      getUserMock.mockResolvedValueOnce({ data: { user: null } });

      const res = await middleware(buildRequest('/api/refresh'));

      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      expect(fromMock).not.toHaveBeenCalled();
    });
  });

  describe('matcher', () => {
    // Next compila `config.matcher` a un regex anclado (^...$) en build time
    // (path-to-regexp); replicamos el anclaje aquí — sin él, `.test()` puede
    // dar falsos positivos por sub-matches (p.ej. la cola "/refresh" dentro
    // de "/api/refresh" sí matchearía sin anclar el inicio de cadena).
    const matcherRegex = new RegExp(`^${config.matcher[0]}$`);

    it.each([
      ['/login', false],
      ['/login/', false],
      ['/api/refresh', false],
      ['/api/refresh/', false],
      // Ronda 2, punto B: /api/version sale del matcher — ya no paga
      // `supabase.auth.getUser()` en cada `visibilitychange`.
      ['/api/version', false],
      ['/api/version/', false],
      ['/_next/static/chunk.js', false],
      ['/_next/image', false],
      ['/favicon.ico', false],
      ['/logo.svg', false],
      ['/catalogo', true],
      ['/api/inventory', true],
      ['/', true],
      // C4: ancladas por segmento — un prefijo desnudo ("login"/"api/refresh"/
      // "api/version") ya NO se traga rutas distintas que solo comparten el prefijo.
      ['/loginX', true],
      ['/api/refreshX', true],
      ['/api/versionX', true],
    ])('%s → matchea=%s', (path, expected) => {
      expect(matcherRegex.test(path)).toBe(expected);
    });
  });
});
