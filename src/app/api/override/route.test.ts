import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { OverrideResult } from '@/types/api';
import type { User } from '@supabase/supabase-js';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const setOverrideMock = vi.fn();

const FAKE_USER = { id: 'user-1', email: 'user@example.com' } as User;
let sessionUser: User | null = FAKE_USER;
let sessionError: { message: string } | null = null;
let perfilRol: Rol | null = 'admin';

/**
 * Fake db de sesión: `auth.getUser()` y el rol de `perfiles` son
 * configurables por test. Default: sesión válida con rol admin (para
 * no repetir el gate en cada caso de negocio existente).
 */
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

vi.mock('@/services/override.service', () => ({
  setOverride: (...args: unknown[]) => setOverrideMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

function putReq(body: unknown): Request {
  return new Request('http://localhost/api/override', {
    method: 'PUT',
    // origin de la allowlist por defecto (INV-B7B·C, O8); los casos de
    // Origin ausente/cruzado viven en tests dedicados, con su propia request.
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
  });
}

const validBody = { sku: 'a-1', campo: 'descripcion', valor: 'Nueva descripción' };

describe('PUT /api/override', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setOverrideMock.mockReset();
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
    const req = new Request('http://localhost/api/override', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = new Request('http://localhost/api/override', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'https://evil.com' },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('Content-Length excesivo → 413 payload_too_large, no llama al service (antes de parsear el body)', async () => {
    const req = new Request('http://localhost/api/override', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'content-length': String(20_000_000),
      },
      body: JSON.stringify(validBody),
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('json roto → 400 invalid_body, no llama al service', async () => {
    const req = new Request('http://localhost/api/override', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: '{esto no es json',
    });

    const { PUT } = await import('./route');
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('campo inválido (fuera del enum) → 400 invalid_body con issues, no llama al service', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'marca', valor: 'X' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.length).toBeGreaterThan(0);
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('valor vacío → 400 invalid_body con issues', async () => {
    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'descripcion', valor: '   ' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(setOverrideMock).not.toHaveBeenCalled();
  });

  it('sku no encontrado → 404 sku_no_encontrado', async () => {
    setOverrideMock.mockResolvedValueOnce({ tipo: 'sku_no_encontrado' });

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('sku_no_encontrado');
    expect(typeof json.message).toBe('string');
  });

  it('familia inválida/inactiva → 400 valor_familia_invalido, mensaje referencia POST /api/familias', async () => {
    setOverrideMock.mockResolvedValueOnce({ tipo: 'familia_invalida', nombre: 'NoExiste' });

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'familia', valor: 'NoExiste' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('valor_familia_invalido');
    expect(json.message).toContain('NoExiste');
    expect(json.message).toContain('POST /api/familias');
  });

  it('200 happy path: normaliza el sku (trim+UPPER) y regresa el shape exacto del service', async () => {
    const resultado: OverrideResult = {
      sku: 'A-1',
      campo: 'descripcion',
      valor_efectivo: 'Nueva descripción',
      familia_efectiva: 'CANDADOS',
      descr_efectiva: 'Nueva descripción',
      tecnologia_efectiva: null,
    };
    setOverrideMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(setOverrideMock).toHaveBeenCalledWith(fakeDb, {
      sku: 'A-1',
      campo: 'descripcion',
      valor: 'Nueva descripción',
    });
  });

  it('valor null (revertir): pasa la validación zod y llega al service con valor:null; 200', async () => {
    const resultado: OverrideResult = {
      sku: 'A-1',
      campo: 'descripcion',
      valor_efectivo: 'Descr origen',
      familia_efectiva: 'CANDADOS',
      descr_efectiva: 'Descr origen',
      tecnologia_efectiva: null,
    };
    setOverrideMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'a-1', campo: 'descripcion', valor: null }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(setOverrideMock).toHaveBeenCalledWith(fakeDb, { sku: 'A-1', campo: 'descripcion', valor: null });
  });

  it('service regresa { tipo: "forbidden" } (RPC 42501, TOCTOU) → 403 forbidden, no 500', async () => {
    setOverrideMock.mockResolvedValueOnce({ tipo: 'forbidden' });

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', message: 'Tu rol no permite esta acción.' });
  });

  it('[FIX-B1] campo="tecnologia" válido en el enum → llega al service', async () => {
    const resultado: OverrideResult = {
      sku: 'A-1',
      campo: 'tecnologia',
      valor_efectivo: 'EAS',
      familia_efectiva: null,
      descr_efectiva: null,
      tecnologia_efectiva: 'EAS',
    };
    setOverrideMock.mockResolvedValueOnce({ tipo: 'ok', resultado });

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'tecnologia', valor: 'EAS' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(resultado);
    expect(setOverrideMock).toHaveBeenCalledWith(fakeDb, { sku: 'A-1', campo: 'tecnologia', valor: 'EAS' });
  });

  it('[FIX-B1] service regresa { tipo: "excel_manda" } → 409 excel_manda, mensaje llano', async () => {
    setOverrideMock.mockResolvedValueOnce({ tipo: 'excel_manda' });

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'tecnologia', valor: 'EAS' }));

    expect(res.status).toBe(409);
    // [FIX-B1 · verificación] Texto EXACTO: la ficha lo muestra tal cual en
    // un toast, así que el copy es contrato de pantalla, no un detalle.
    expect(await res.json()).toEqual({
      error: 'excel_manda',
      message: 'Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.',
    });
  });

  it('[FIX-B1] service regresa { tipo: "tecnologia_no_seleccionable" } → 409, mensaje referencia el valor rechazado', async () => {
    setOverrideMock.mockResolvedValueOnce({ tipo: 'tecnologia_no_seleccionable', valor: 'ROBOTICA' });

    const { PUT } = await import('./route');
    const res = await PUT(putReq({ sku: 'A-1', campo: 'tecnologia', valor: 'ROBOTICA' }));

    expect(res.status).toBe(409);
    // Texto EXACTO, mismo motivo que el de arriba: la ficha lo pinta tal cual.
    expect(await res.json()).toEqual({
      error: 'tecnologia_no_seleccionable',
      message: '"ROBOTICA" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.',
    });
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    setOverrideMock.mockRejectedValueOnce(new Error('relation "productos_override" violates constraint boom secreto'));

    const { PUT } = await import('./route');
    const res = await PUT(putReq(validBody));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
