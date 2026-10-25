// ============================================================
// Bloque 5 · lib · imagenes.ts  (PURO)
// Validación de imágenes de producto (POST /api/imagenes) y cómputo
// determinista de la ruta de Storage. Sin efectos: no toca Storage ni
// la BD (eso vive en `imagenes.service.ts`).
// ============================================================
import { createHash } from 'crypto';

/** Espejo del `file_size_limit` del bucket `producto-imagenes` (0007_b5_storage.sql). */
export const MAX_IMAGEN_BYTES = 2_097_152;

/** Espejo del `allowed_mime_types` del bucket `producto-imagenes` (0007_b5_storage.sql). */
export const TIPOS_IMAGEN: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type ValidarImagenResult = { ok: true; ext: string } | { ok: false; motivo: 'tipo' | 'tamano' | 'contenido' };

const MAGIC_PNG = [0x89, 0x50, 0x4e, 0x47];
const MAGIC_JPEG = [0xff, 0xd8, 0xff];
const MAGIC_RIFF = [0x52, 0x49, 0x46, 0x46];
const MAGIC_WEBP = [0x57, 0x45, 0x42, 0x50];

function toBytes(buffer: ArrayBuffer | Uint8Array): Uint8Array {
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
}

/** `true` si `bytes` trae la secuencia `esperados` exactamente en `offset`. */
function tieneMagicBytes(bytes: Uint8Array, offset: number, esperados: number[]): boolean {
  if (bytes.length < offset + esperados.length) return false;
  return esperados.every((b, i) => bytes[offset + i] === b);
}

/** Firma binaria real de `bytes` según el mime `tipo` declarado (PNG/JPEG/WEBP). */
function coincideConTipo(bytes: Uint8Array, tipo: string): boolean {
  switch (tipo) {
    case 'image/png':
      return tieneMagicBytes(bytes, 0, MAGIC_PNG);
    case 'image/jpeg':
      return tieneMagicBytes(bytes, 0, MAGIC_JPEG);
    case 'image/webp':
      // RIFF....WEBP: el fourCC 'WEBP' vive en el offset 8 (tras 'RIFF' + 4 bytes de tamaño).
      return tieneMagicBytes(bytes, 0, MAGIC_RIFF) && tieneMagicBytes(bytes, 8, MAGIC_WEBP);
    default:
      return false;
  }
}

/**
 * Valida una imagen subida: tamaño real ≤ `MAX_IMAGEN_BYTES`, `tipoDeclarado`
 * dentro de `TIPOS_IMAGEN`, y los magic bytes reales del contenido coinciden
 * con ese tipo declarado (evita que un archivo renombrado con extensión/mime
 * falso pase la validación). Orden de chequeo: tamaño → tipo → contenido —
 * cada uno con su propio `motivo` para que el route mapee el HTTP status
 * correcto (413 solo para 'tamano'; 400 para 'tipo'/'contenido').
 */
export function validarImagen(buffer: ArrayBuffer | Uint8Array, tipoDeclarado: string): ValidarImagenResult {
  const bytes = toBytes(buffer);

  if (bytes.byteLength > MAX_IMAGEN_BYTES) {
    return { ok: false, motivo: 'tamano' };
  }

  const ext = TIPOS_IMAGEN[tipoDeclarado];
  if (!ext) {
    return { ok: false, motivo: 'tipo' };
  }

  if (!coincideConTipo(bytes, tipoDeclarado)) {
    return { ok: false, motivo: 'contenido' };
  }

  return { ok: true, ext };
}

/**
 * Ruta determinista de Storage para el SKU: sha256 hex del sku
 * normalizado (trim + UPPER, mismo criterio que `skuParamSchema`),
 * recortado a 32 caracteres, + `.ext`. Hashear el sku (en vez de
 * usarlo tal cual como nombre de archivo) evita cualquier problema de
 * caracteres inseguros en la ruta de Storage — SKUs reales incluyen
 * `/` y espacios (p.ej. `WN947-X-N/BPU51-H14`, `YBY016 W`), que un
 * path crudo interpretaría como separador de carpeta o requeriría
 * escapes.
 */
export function rutaImagen(sku: string, ext: string): string {
  const normalizado = sku.trim().toUpperCase();
  const hash = createHash('sha256').update(normalizado).digest('hex').slice(0, 32);
  return `${hash}.${ext}`;
}

/** Las 3 rutas posibles (una por extensión soportada) para un mismo SKU — usado para limpiar variantes previas antes de subir una nueva. */
export function variantesImagen(sku: string): string[] {
  return Object.values(TIPOS_IMAGEN).map((ext) => rutaImagen(sku, ext));
}
