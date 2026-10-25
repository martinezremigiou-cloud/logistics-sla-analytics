import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { SetColorResult } from '@/services/color.service';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const setColorMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'admin@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

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

vi.mock('@/services/color.service', () => ({
  setColor: (...args: unknown[]) => setColorMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function putReq(body: unknown): Request {
  return new Request('http://localhost/api/color', {
    method: 'PUT',
    // origin de la allowlist por defecto (INV-B7B·C, O8) — así el resto de la
    // suite (gates existentes: sesión/rol/body/validación) sigue ejercitando
    // el mismo camino de antes; los casos de Origin viven en tests dedicados.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

const validBody = { sku: 'a-1', color: 'azul' };

describe('PUT /api/color', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setColorMock.mockReset();
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
    const req = new Request('http://localhost/api/color', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = new Request('http://localhost/api/color', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service', async () => {
    const req = new Request('http://localhost/api/color', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', 'content-length': String(20_000_000) },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(413);
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body', async () => {
    const req = new Request('http://localhost/api/color', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('color inválido (fuera del enum) → 400 invalid_body con issues', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', color: 'dorado' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(setColorMock).not.toHaveBeenCalled();
  });

  it('sku no encontrado → 404 sku_no_encontrado', async () => {
    setColorMock.mockResolvedValueOnce({ tipo: 'sku_no_encontrado' } satisfies SetColorResult);

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('sku_no_encontrado');
    expect(typeof json.message).toBe('string');
  });

  it('200 happy path: normaliza el sku (trim+UPPER), y la IDENTIDAD ya no viaja al service ([MVP-2] A: la fija la RPC desde el JWT)', async () => {
    const resultado: SetColorResult = { tipo: 'ok', resultado: { sku: 'A-1', color: 'azul' } };
    setColorMock.mockResolvedValueOnce(resultado);

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sku: 'A-1', color: 'azul' });
    // El correo del admin ya NO se calcula en el route ni se pasa: `aplicar_metadata`
    // (0017) lo saca de `auth.jwt()`. Que no haya un 3er argumento es la aserción.
    expect(setColorMock).toHaveBeenCalledWith(fakeDb, { sku: 'A-1', color: 'azul' });
    expect(setColorMock.mock.calls[0]).toHaveLength(2);
  });

  it('200: color null (quitar color) es un body válido', async () => {
    const resultado: SetColorResult = { tipo: 'ok', resultado: { sku: 'A-1', color: null } };
    setColorMock.mockResolvedValueOnce(resultado);

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'a-1', color: null }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sku: 'A-1', color: null });
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    setColorMock.mockRejectedValueOnce(new Error('constraint boom secreto'));

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
