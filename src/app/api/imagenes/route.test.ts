import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { User } from '@supabase/supabase-js';
import type { SubirImagenResult } from '@/services/imagenes.service';
import type { Rol } from '@/types/enums';

// `server-only` lanza fuera del pipeline de webpack de Next; en Vitest se
// neutraliza (igual que hace Next en Server Components reales).
vi.mock('server-only', () => ({}));

const subirImagenMock = vi.fn();

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

vi.mock('@/services/imagenes.service', () => ({
  subirImagen: (...args: unknown[]) => subirImagenMock(...args),
}));

vi.mock('@/lib/supabase/session', () => ({
  createSupabaseSessionClient: () => createSupabaseSessionClientMock(),
}));

/** Magic bytes reales de PNG + relleno para superar cualquier chequeo trivial de tamaño. */
/** `new Uint8Array(array)` tipa el `.buffer` como `ArrayBufferLike` (incluye `SharedArrayBuffer`); `File`/`Blob` exigen `ArrayBuffer` estricto — se arma explícito para evitar el cast. */
function bytesFrom(valores: number[]): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(valores.length);
  const vista = new Uint8Array(buffer);
  vista.set(valores);
  return vista;
}

const PNG_BYTES = bytesFrom([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(20).fill(0)]);

/**
 * Stub de `Request` con SOLO `formData()` + lo mínimo que ahora también
 * consume `requireSameOrigin` (`method`/`url`/`headers`) — antes SOLO
 * `formData()` (lo único que el route leía de `req`). Evita el
 * roundtrip real de serializar un body multipart y volver a parsearlo
 * vía `new Request(url,{body:FormData})` + `req.formData()`: en este
 * entorno (Vitest+jsdom) ese roundtrip cuelga de forma indefinida
 * cuando el `FormData` incluye un `File` (interacción conocida entre el
 * `Request` compat de jsdom y el `FormData`/`File` de jsdom al
 * re-serializar/parsear el stream real). `File.arrayBuffer()`/
 * `FormData.get()` en sí SÍ funcionan bien — por eso se usan directo,
 * sin pasar por esa tubería. `headers` default a un origin de la
 * allowlist (INV-B7B·C, O8); los tests de Origin ausente/cruzado pasan
 * su propio `headers`.
 */
function formReq(
  fields: { sku?: string; archivo?: { bytes: Uint8Array<ArrayBuffer>; type: string } | null },
  headers: Record<string, string> = { origin: 'http://localhost:3000' },
): Request {
  const form = new FormData();
  if (fields.sku !== undefined) form.set('sku', fields.sku);
  if (fields.archivo) {
    const file = new File([fields.archivo.bytes], 'imagen', { type: fields.archivo.type });
    form.set('archivo', file);
  }
  return {
    method: 'POST',
    url: 'http://localhost/api/imagenes',
    headers: new Headers(headers),
    formData: () => Promise.resolve(form),
  } as unknown as Request;
}

function reqFormDataRota(headers: Record<string, string> = { origin: 'http://localhost:3000' }): Request {
  return {
    method: 'POST',
    url: 'http://localhost/api/imagenes',
    headers: new Headers(headers),
    formData: () => Promise.reject(new Error('multipart boundary inválido')),
  } as unknown as Request;
}

describe('POST /api/imagenes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    subirImagenMock.mockReset();
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
    const req = formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }, {});

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(createSupabaseSessionClientMock).not.toHaveBeenCalled();
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('Origin de otro dominio (O8) → 403 forbidden_origin, no llama al service', async () => {
    const req = formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }, { origin: 'https://evil.com' });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden_origin', message: 'Origen no permitido para esta operación.' });
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('sin sesión (anon) → 401, no llama al service', async () => {
    sessionUser = null;

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(401);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('rol kam → 403 forbidden, no llama al service', async () => {
    perfilRol = 'kam';

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(403);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('rol visitante → 403 forbidden, no llama al service (Bloque 7-A: visitante es tan de-solo-lectura como kam)', async () => {
    perfilRol = 'visitante';

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(403);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('rol soporte → 403 forbidden, no llama al service (no escribe DATO COMPARTIDO)', async () => {
    perfilRol = 'soporte';

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(403);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('multipart roto (formData() rechaza) → 400 invalid_body, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(reqFormDataRota());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('sin archivo → 400 invalid_body, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_body');
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('sku inválido (vacío) → 400 invalid_body con issues, no llama al service', async () => {
    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: '   ', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
    expect(Array.isArray(json.issues)).toBe(true);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('jpeg declarado con bytes de PNG → 400 invalid_body (contenido no coincide con el tipo)', async () => {
    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/jpeg' } }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_body',
      message: 'Formato no válido. Usa PNG, JPG o WEBP (máx. 2 MB).',
    });
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('archivo > 2MB → 413 payload_too_large, no llama al service', async () => {
    const grande = new Uint8Array(2_097_153);
    grande.set(PNG_BYTES);

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: grande, type: 'image/png' } }));

    expect(res.status).toBe(413);
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('admin + PNG válido (magic bytes reales) → 200, y la IDENTIDAD ya no viaja al service ([MVP-2] A: la fija la RPC desde el JWT)', async () => {
    const resultado: SubirImagenResult = { tipo: 'ok', resultado: { sku: 'A-1', imagen_url: 'https://cdn/x.png' } };
    subirImagenMock.mockResolvedValueOnce(resultado);

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'a-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sku: 'A-1', imagen_url: 'https://cdn/x.png' });
    expect(subirImagenMock).toHaveBeenCalledTimes(1);
    const args = subirImagenMock.mock.calls[0] as [unknown, { sku: string; contentType: string }];
    expect(args[0]).toBe(fakeDb);
    expect(args[1].sku).toBe('A-1');
    expect(args[1].contentType).toBe('image/png');
    // El correo del admin ya NO se calcula en el route ni se pasa: `aplicar_metadata`
    // (0017) lo saca de `auth.jwt()`. Que no haya un 3er argumento es la aserción.
    expect(args).toHaveLength(2);
    expect(JSON.stringify(args[1])).not.toContain('admin@example.com');
  });

  it('sku inexistente → 404 sku_no_encontrado', async () => {
    subirImagenMock.mockResolvedValueOnce({ tipo: 'sku_no_encontrado' } satisfies SubirImagenResult);

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'NOEXISTE', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('sku_no_encontrado');
    expect(typeof json.message).toBe('string');
  });

  it('error genérico del service → 500 internal_error sin filtrar el mensaje interno', async () => {
    subirImagenMock.mockRejectedValueOnce(new Error('storage boom secreto'));

    const { POST } = await import('./route');
    const res = await POST(formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });
    expect(JSON.stringify(json)).not.toContain('secreto');
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

/**
 * [INV-B7B] A3 (auditoría de seguridad) — el rechazo por `Content-Length`
 * debe pasar ANTES de materializar (`req.formData()`), no después.
 * `formData` se espía con `vi.fn()` para probar directamente que ni
 * siquiera se invoca cuando la pre-cota dispara.
 */
describe('POST /api/imagenes — Content-Length antes de materializar (A3)', () => {
  beforeEach(() => {
    subirImagenMock.mockReset();
    sessionUser = FAKE_USER;
    sessionError = null;
    perfilRol = 'admin';
  });

  function reqConContentLength(contentLength: string): { req: Request; formDataSpy: ReturnType<typeof vi.fn> } {
    const formDataSpy = vi.fn(() => Promise.resolve(new FormData()));
    const req = {
      method: 'POST',
      url: 'http://localhost/api/imagenes',
      headers: new Headers({ origin: 'http://localhost:3000', 'content-length': contentLength }),
      formData: formDataSpy,
    } as unknown as Request;
    return { req, formDataSpy };
  }

  it('Content-Length declarado (10 MB, muy por encima del tope) → 413 payload_too_large SIN llamar a formData() ni al service', async () => {
    const { req, formDataSpy } = reqConContentLength('10000000');

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(subirImagenMock).not.toHaveBeenCalled();
  });

  it('Content-Length dentro del tope no bloquea: sigue el flujo normal hasta 200', async () => {
    const resultado: SubirImagenResult = { tipo: 'ok', resultado: { sku: 'A-1', imagen_url: 'https://cdn/x.png' } };
    subirImagenMock.mockResolvedValueOnce(resultado);

    const req = formReq(
      { sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } },
      { origin: 'http://localhost:3000', 'content-length': String(PNG_BYTES.byteLength) },
    );

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(subirImagenMock).toHaveBeenCalledTimes(1);
  });

  it('Content-Length AUSENTE (equivalente real: Transfer-Encoding chunked) → la pre-cota NO dispara (best-effort documentado); sigue el flujo normal hasta 200', async () => {
    const resultado: SubirImagenResult = { tipo: 'ok', resultado: { sku: 'A-1', imagen_url: 'https://cdn/x.png' } };
    subirImagenMock.mockResolvedValueOnce(resultado);

    const req = formReq({ sku: 'A-1', archivo: { bytes: PNG_BYTES, type: 'image/png' } });

    const { POST } = await import('./route');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(subirImagenMock).toHaveBeenCalledTimes(1);
  });
});
