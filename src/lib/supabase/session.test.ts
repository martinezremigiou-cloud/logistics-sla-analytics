import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

type CookieToSet = { name: string; value: string; options: Record<string, unknown> };
type SessionClientOptions = {
  cookies: {
    getAll: () => { name: string; value: string }[];
    setAll: (cookiesToSet: CookieToSet[]) => void;
  };
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
};

const createServerClientMock = vi.fn<
  (url: string, key: string, options: SessionClientOptions) => { __fakeSupabase: boolean }
>(() => ({ __fakeSupabase: true }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (url: string, key: string, options: SessionClientOptions) =>
    createServerClientMock(url, key, options),
}));

const getAllMock = vi.fn(() => [{ name: 'sb-access-token', value: 'abc' }]);
const setMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => ({ getAll: getAllMock, set: setMock }),
}));

import { createSupabaseSessionClient } from './session';

describe('createSupabaseSessionClient', () => {
  beforeEach(() => {
    createServerClientMock.mockClear();
    getAllMock.mockClear();
    setMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('llama a createServerClient con la URL y la anon key de env', () => {
    createSupabaseSessionClient();

    expect(createServerClientMock).toHaveBeenCalledTimes(1);
    const [url, key] = createServerClientMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:54321');
    expect(key).toBe('sb_publishable_test');
  });

  it('cookies.getAll delega en cookies() de next/headers', () => {
    createSupabaseSessionClient();
    const [, , options] = createServerClientMock.mock.calls[0];

    const result = options.cookies.getAll();

    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ name: 'sb-access-token', value: 'abc' }]);
  });

  it('cookies.setAll escribe cada cookie vía cookieStore.set', () => {
    createSupabaseSessionClient();
    const [, , options] = createServerClientMock.mock.calls[0];

    options.cookies.setAll([
      { name: 'a', value: '1', options: { path: '/' } },
      { name: 'b', value: '2', options: {} },
    ]);

    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenNthCalledWith(1, 'a', '1', { path: '/' });
    expect(setMock).toHaveBeenNthCalledWith(2, 'b', '2', {});
  });

  it('cookies.setAll no lanza aunque cookieStore.set falle (Server Component de solo lectura)', () => {
    setMock.mockImplementationOnce(() => {
      throw new Error('Cookies can only be modified in a Server Action or Route Handler');
    });
    createSupabaseSessionClient();
    const [, , options] = createServerClientMock.mock.calls[0];

    expect(() => options.cookies.setAll([{ name: 'a', value: '1', options: {} }])).not.toThrow();
  });

  it('contrato del fix: global.fetch fuerza cache:"no-store" y preserva el resto de init', async () => {
    createSupabaseSessionClient();
    const [, , options] = createServerClientMock.mock.calls[0];

    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await options.global.fetch('https://x.test/rest/v1/perfiles', { headers: { a: 'b' } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInput).toBe('https://x.test/rest/v1/perfiles');
    expect(calledInit!.cache).toBe('no-store');
    expect(calledInit!.headers).toEqual({ a: 'b' });
  });

  it('sin init (undefined) también manda cache:"no-store"', async () => {
    createSupabaseSessionClient();
    const [, , options] = createServerClientMock.mock.calls[0];

    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await options.global.fetch('https://x.test/rest/v1/perfiles');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInit!.cache).toBe('no-store');
  });
});
