// ============================================================
// [REPRODUCIBILIDAD · S7-A] Escape hatch del forzado de universo
// reducido — compartido por las DOS puertas de ingesta (mismo patrón
// que `ingest-auth.ts`: una sola primitiva, no dos copias que puedan
// desincronizarse).
//
// Tres cabeceras HTTP, las TRES obligatorias JUNTAS (Enmienda 2):
//   - x-forzar-universo-reducido: si
//   - x-forzar-motivo: <texto, 12..300 caracteres>
//   - x-forzar-por: <identificador, 3..120 caracteres>
// Prohibido: variable de entorno, valor por defecto, o cualquier forma
// de forzado que no venga en la petición — por eso esta función SOLO
// lee `req.headers`, nunca `process.env`.
//
// Nota de honestidad: las dos rutas de ingesta autentican con
// INGEST_SECRET compartido (`ingestaAutorizada`), no con sesión de
// usuario. `x-forzar-por` es una identidad AUTO-DECLARADA, NO
// AUTENTICADA: cualquiera con el secreto de ingesta puede escribir
// cualquier texto ahí. Sirve para dejar rastro operativo (quién dice
// haber forzado y por qué), no como control de acceso.
// ============================================================
import type { ForzadoUniverso } from '@/services/etl/types';

const CABECERA_FLAG = 'x-forzar-universo-reducido';
const CABECERA_MOTIVO = 'x-forzar-motivo';
const CABECERA_POR = 'x-forzar-por';

const MOTIVO_MIN = 12;
const MOTIVO_MAX = 300;
const POR_MIN = 3;
const POR_MAX = 120;

export interface LecturaForzado {
  /** Completo y válido: listo para pasar como `EtlDeps.forzado`. */
  forzado: ForzadoUniverso | null;
  /**
   * `null` si no hubo NINGÚN intento de forzar (las tres cabeceras
   * ausentes) o si el intento fue completo y válido. Si hubo un intento
   * INCOMPLETO o inválido (al menos una cabecera presente pero el trío
   * no cierra), aquí va qué cabecera falta o es inválida — en es-MX,
   * listo para anexar al mensaje de `UniversoReducidoError` si la
   * guarda rechaza (Enmienda 2(b): "el mensaje dice CUÁL falta").
   */
  intentoInvalido: string | null;
}

/** Lee y valida las tres cabeceras del escape hatch desde una `Request` HTTP. */
export function leerForzadoUniversoReducido(req: Request): LecturaForzado {
  const flag = req.headers.get(CABECERA_FLAG);
  const motivo = req.headers.get(CABECERA_MOTIVO);
  const por = req.headers.get(CABECERA_POR);

  const huboIntento = flag !== null || motivo !== null || por !== null;
  if (!huboIntento) return { forzado: null, intentoInvalido: null };

  if (flag !== 'si') {
    return {
      forzado: null,
      intentoInvalido: `falta o es inválida la cabecera "${CABECERA_FLAG}" (debe venir exactamente como "si")`,
    };
  }
  if (motivo === null || motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
    return {
      forzado: null,
      intentoInvalido: `falta o es inválida la cabecera "${CABECERA_MOTIVO}" (${MOTIVO_MIN}..${MOTIVO_MAX} caracteres)`,
    };
  }
  if (por === null || por.length < POR_MIN || por.length > POR_MAX) {
    return {
      forzado: null,
      intentoInvalido: `falta o es inválida la cabecera "${CABECERA_POR}" (${POR_MIN}..${POR_MAX} caracteres)`,
    };
  }

  return { forzado: { por, motivo }, intentoInvalido: null };
}
