import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

type ServerClientOptions = {
  auth: { persistSession: boolean; autoRefreshToken: boolean };
  global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
};

const createClientMock = vi.fn<
  (url: string, key: string, options: ServerClientOptions) => { __fakeSupabase: boolean }
>(() => ({ __fakeSupabase: true }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, options: ServerClientOptions) =>
    createClientMock(url, key, options),
}));

import { createSupabaseServerClient } from './server';

describe('createSupabaseServerClient', () => {
  beforeEach(() => {
    createClientMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('llama a createClient con la URL y la service key de env, y auth intacto', () => {
    createSupabaseServerClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    const [url, key, options] = createClientMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:54321');
    expect(key).toBe('sb_secret_test');
    expect(options.auth).toEqual({ persistSession: false, autoRefreshToken: false });
  });

  it('contrato del fix: global.fetch fuerza cache:"no-store" y preserva el resto de init', async () => {
    createSupabaseServerClient();
    const [, , options] = createClientMock.mock.calls[0];

    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await options.global.fetch('https://x.test/rest/v1/snapshots', { headers: { a: 'b' } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInput).toBe('https://x.test/rest/v1/snapshots');
    expect(calledInit!.cache).toBe('no-store');
    expect(calledInit!.headers).toEqual({ a: 'b' });
  });

  it('sin init (undefined) también manda cache:"no-store"', async () => {
    createSupabaseServerClient();
    const [, , options] = createClientMock.mock.calls[0];

    const fetchSpy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null),
    );
    vi.stubGlobal('fetch', fetchSpy);

    await options.global.fetch('https://x.test/rest/v1/snapshots');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchSpy.mock.calls[0];
    expect(calledInit!.cache).toBe('no-store');
  });
});
