// ============================================================
// Bloque 3 · API · errors.ts  (PURO)
// Contrato uniforme de error (O7) para todas las rutas /api/*.
// Un solo shape de respuesta, un solo mapeo código→status HTTP.
// Las rutas y servicios NUNCA arman NextResponse de error a mano:
// pasan siempre por `apiError` / `internalError`.
// ============================================================
import { NextResponse } from 'next/server';

export type ApiErrorCode =
  | 'config_error'
  | 'unauthorized'
  | 'forbidden'
  | 'forbidden_origin'
  | 'invalid_query'
  | 'invalid_body'
  | 'payload_too_large'
  | 'sku_no_encontrado'
  | 'familia_no_encontrada'
  | 'familia_duplicada'
  | 'valor_familia_invalido'
  /**
   * [FIX-B1] `PUT /api/override` con `campo='tecnologia'` cuando
   * `productos.tecnologia` ya trae un valor para ese SKU — el Excel manda,
   * el portal no puede sobrescribirla mientras el archivo la traiga.
   */
  | 'excel_manda'
  /** [FIX-B1] `PUT /api/override` con `campo='tecnologia'` y un valor fuera de `tecnologias_seleccionables()`. */
  | 'tecnologia_no_seleccionable'
  | 'fusion_invalida'
  | 'usuario_duplicado'
  | 'pendiente_no_encontrado'
  | 'pendiente_invalido'
  | 'snapshot_no_encontrado'
  // [INV-B8] Proyectos. 'proyecto_no_encontrado' cubre TAMBIEN el caso 'existe
  // pero no es tuyo': la RLS no distingue esos dos, y distinguirlos en la capa
  // de arriba ya seria filtrar que el recurso existe.
  | 'proyecto_no_encontrado'
  | 'partida_duplicada'
  | 'proyecto_lleno'
  | 'perfil_no_encontrado'
  // [INV-B9] Seguir SKUs. El tope existe porque la lista viaja en un `.in()`
  // de PostgREST, que va en la URL — mismo motivo que `proyecto_lleno`.
  | 'demasiados_seguimientos'
  | 'no_disponible'
  // [REPRODUCIBILIDAD · S7-A] la guarda de universo entrante
  // (`UniversoReducidoError`, src/services/etl/errors.ts) rechazó un
  // snapshot cuyo universo se derrumbó contra el vigente — accionable
  // (forzar con las tres cabeceras, o revisar el archivo), NUNCA 500.
  | 'universo_reducido'
  /**
   * [INV-B10] Techo del chat alcanzado. Es el ÚNICO 429 del portal, y existe
   * porque `/api/chat` es la primera ruta que cuesta dinero por llamada: hasta
   * ahora, un usuario dándole mil veces a un botón solo gastaba CPU.
   */
  | 'tope_alcanzado'
  | 'internal_error';

/** Shape de respuesta de error uniforme. `issues` solo aplica a validación zod. */
export interface ApiErrorBody {
  error: ApiErrorCode;
  message?: string;
  issues?: unknown[];
}

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
  // [FIX-B1] 409, no 400: no es que el valor esté MAL FORMADO, es que
  // CONFLICTA con lo que el Excel ya trae (o con la lista permitida) —
  // mismo criterio que `partida_duplicada`/`proyecto_lleno` (conflicto de
  // estado, no de validación de entrada).
  excel_manda: 409,
  tecnologia_no_seleccionable: 409,
  // (C, [MVP-2]) 22023 de `fusionar_familia` (0018): alias/destino vacíos,
  // el mismo nombre, o el destino inactivo — validación de negocio del
  // RPC, mensaje ya curado y seguro de mostrar (ver `familias.service.ts`).
  fusion_invalida: 400,
  usuario_duplicado: 409,
  pendiente_no_encontrado: 404,
  pendiente_invalido: 400,
  snapshot_no_encontrado: 404,
  proyecto_no_encontrado: 404,
  partida_duplicada: 409,
  proyecto_lleno: 409,
  perfil_no_encontrado: 404,
  demasiados_seguimientos: 409,
  no_disponible: 503,
  universo_reducido: 409,
  tope_alcanzado: 429,
  internal_error: 500,
};

export interface ApiErrorOptions {
  /** Mensaje es-MX seguro para el cliente (NUNCA internals de PG ni secretos). */
  message?: string;
  /** Detalle de validación zod (parsed.error.issues); solo para invalid_query/invalid_body. */
  issues?: unknown[];
}

/** Respuesta de error uniforme: status HTTP mapeado por `code` (contrato O7). */
export function apiError(code: ApiErrorCode, opts: ApiErrorOptions = {}): NextResponse {
  const body: ApiErrorBody = { error: code };
  if (opts.message !== undefined) body.message = opts.message;
  if (opts.issues !== undefined) body.issues = opts.issues;
  return NextResponse.json(body, { status: STATUS_BY_CODE[code] });
}

/**
 * Catch-all para errores no anticipados (p.ej. Postgres/PostgREST, que
 * pueden filtrar nombres de columna/constraint). Loggea el detalle
 * completo server-side y regresa siempre un 500 `internal_error`
 * genérico al cliente — único punto de la ruta donde se registra el
 * error crudo, para que nunca se filtre por accidente en el body.
 */
export function internalError(scope: string, e: unknown): NextResponse {
  console.error(`[${scope}] internal_error`, e);
  return apiError('internal_error');
}
