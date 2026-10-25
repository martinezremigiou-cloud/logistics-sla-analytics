import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiError, internalError, type ApiErrorCode } from './errors';

/** Mapeo código→status esperado (espejo del contrato O7). */
const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  config_error: 500,
  unauthorized: 401,
  forbidden: 403,
  forbidden_origin: 403,
  invalid_query: 400,
  invalid_body: 400,
  payload_too_large: 413,
  sku_no_encontrado: 404,
  familia_no_encontrada: 404,
  familia_duplicada: 409,
  valor_familia_invalido: 400,
  // [FIX-B1] `PUT /api/override` con `campo='tecnologia'`: conflicto de
  // estado (el Excel ya trae el dato, o el valor no es seleccionable), no
  // validación de entrada — mismo criterio que `partida_duplicada`.
  excel_manda: 409,
  tecnologia_no_seleccionable: 409,
  fusion_invalida: 400,
  usuario_duplicado: 409,
  pendiente_no_encontrado: 404,
  pendiente_invalido: 400,
  snapshot_no_encontrado: 404,
  // [INV-B8] Proyectos.
  proyecto_no_encontrado: 404,
  partida_duplicada: 409,
  proyecto_lleno: 409,
  perfil_no_encontrado: 404,
  // [INV-B9] Seguir SKUs. 409 y no 400: el cuerpo es válido, lo que está lleno
  // es el estado — mismo criterio que `proyecto_lleno`.
  demasiados_seguimientos: 409,
  no_disponible: 503,
  universo_reducido: 409,
  // [INV-B10] El techo del chat. Es el UNICO 429 del portal: `/api/chat` es la
  // primera ruta que cuesta dinero por llamada.
  tope_alcanzado: 429,
  internal_error: 500,
};

describe('apiError', () => {
  it.each(Object.entries(STATUS_BY_CODE))('%s → status %i', async (code, status) => {
    const res = apiError(code as ApiErrorCode);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: code });
  });

  it('shape exacto: solo "error" cuando no se pasan message/issues', async () => {
    const res = apiError('sku_no_encontrado');
    const json = await res.json();
    expect(json).toEqual({ error: 'sku_no_encontrado' });
    expect(Object.keys(json)).toEqual(['error']);
  });

  it('incluye message cuando se provee (es-MX, seguro)', async () => {
    const res = apiError('invalid_body', { message: 'El cuerpo de la petición es inválido.' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'invalid_body',
      message: 'El cuerpo de la petición es inválido.',
    });
  });

  it('incluye issues cuando se provee (validación zod)', async () => {
    const issues = [{ path: ['sku'], message: 'requerido' }];
    const res = apiError('invalid_query', { issues });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_query', issues });
  });

  it('incluye message e issues juntos cuando ambos se proveen', async () => {
    const issues = [{ path: ['familia'], message: 'inválido' }];
    const res = apiError('valor_familia_invalido', { message: 'Valor de familia inválido.', issues });
    expect(await res.json()).toEqual({
      error: 'valor_familia_invalido',
      message: 'Valor de familia inválido.',
      issues,
    });
  });
});

describe('internalError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loggea server-side y regresa 500 internal_error sin filtrar el mensaje interno', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const internal = new Error('constraint "productos_sku_key" violates unique constraint boom');

    const res = internalError('api/algo', internal);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'internal_error' });

    const raw = JSON.stringify(json);
    expect(raw).not.toContain('constraint');
    expect(raw).not.toContain('productos_sku_key');

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith('[api/algo] internal_error', internal);
  });
});
