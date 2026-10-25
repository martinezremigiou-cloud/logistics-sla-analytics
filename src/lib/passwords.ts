// ============================================================
// Bloque 5 · lib · passwords.ts  (PURO)
// Contraseña temporal para altas/reset de usuarios (Admin API,
// `usuarios.service.ts`). Se muestra UNA vez en la respuesta HTTP y
// JAMÁS se loggea server-side.
// ============================================================
import { randomBytes } from 'crypto';

/** Longitud final de la contraseña temporal. */
const LONGITUD = 14;

/**
 * Caracteres visualmente ambiguos en fuentes comunes, excluidos para
 * reducir errores al transcribir la contraseña a mano (p.ej. leerla en
 * pantalla y teclearla en otro dispositivo): `0` (cero) vs `O`/`o`
 * (letra o); `1` (uno) vs `l` (ele minúscula) vs `I` (i mayúscula).
 */
const AMBIGUOS = /[0Oo1lI]/g;

/**
 * `crypto.randomBytes` codificados en base64url (alfabeto URL-safe:
 * `A-Z a-z 0-9 - _`), filtrando los caracteres ambiguos y recortando a
 * `LONGITUD`. Se piden 36 bytes (48 caracteres base64url sin padding)
 * a propósito: incluso descontando el ~9% esperado de caracteres
 * ambiguos (6 de 64 símbolos posibles), sobran de sobra para cortar a
 * 14 sin repetir la llamada; el fallback recursivo de abajo cubre el
 * caso — estadísticamente inalcanzable — en que el filtrado deje menos
 * de 14 caracteres.
 */
export function generarContrasenaTemporal(): string {
  const cruda = randomBytes(36).toString('base64url').replace(AMBIGUOS, '');
  if (cruda.length < LONGITUD) {
    return generarContrasenaTemporal();
  }
  return cruda.slice(0, LONGITUD);
}
