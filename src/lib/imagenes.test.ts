import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';
import { MAX_IMAGEN_BYTES, TIPOS_IMAGEN, validarImagen, rutaImagen, variantesImagen } from './imagenes';

function bufferConPrefijo(prefijo: number[], tamano = 100): Uint8Array {
  const bytes = new Uint8Array(Math.max(tamano, prefijo.length));
  prefijo.forEach((b, i) => {
    bytes[i] = b;
  });
  return bytes;
}

function bufferPng(tamano = 100): Uint8Array {
  return bufferConPrefijo([0x89, 0x50, 0x4e, 0x47], tamano);
}

function bufferJpeg(tamano = 100): Uint8Array {
  return bufferConPrefijo([0xff, 0xd8, 0xff], tamano);
}

function bufferWebp(tamano = 100): Uint8Array {
  const bytes = new Uint8Array(Math.max(tamano, 12));
  [0x52, 0x49, 0x46, 0x46].forEach((b, i) => {
    bytes[i] = b;
  });
  [0x57, 0x45, 0x42, 0x50].forEach((b, i) => {
    bytes[8 + i] = b;
  });
  return bytes;
}

describe('validarImagen', () => {
  it('PNG válido (magic bytes reales + tipo declarado) → ok, ext "png"', () => {
    expect(validarImagen(bufferPng(), 'image/png')).toEqual({ ok: true, ext: 'png' });
  });

  it('JPEG válido → ok, ext "jpg"', () => {
    expect(validarImagen(bufferJpeg(), 'image/jpeg')).toEqual({ ok: true, ext: 'jpg' });
  });

  it('WEBP válido (RIFF....WEBP) → ok, ext "webp"', () => {
    expect(validarImagen(bufferWebp(), 'image/webp')).toEqual({ ok: true, ext: 'webp' });
  });

  it('acepta ArrayBuffer además de Uint8Array', () => {
    const bytes = bufferPng();
    const arrayBuffer = new ArrayBuffer(bytes.length);
    new Uint8Array(arrayBuffer).set(bytes);
    expect(validarImagen(arrayBuffer, 'image/png')).toEqual({ ok: true, ext: 'png' });
  });

  it('tamaño real > MAX_IMAGEN_BYTES → motivo "tamano" (aunque el contenido sea válido)', () => {
    const grande = bufferPng(MAX_IMAGEN_BYTES + 1);
    expect(validarImagen(grande, 'image/png')).toEqual({ ok: false, motivo: 'tamano' });
  });

  it('tamaño exactamente igual al máximo → no es "tamano" (no estrictamente mayor)', () => {
    const limite = bufferPng(MAX_IMAGEN_BYTES);
    expect(validarImagen(limite, 'image/png')).toEqual({ ok: true, ext: 'png' });
  });

  it('tipo declarado fuera de TIPOS_IMAGEN → motivo "tipo"', () => {
    expect(validarImagen(bufferPng(), 'image/gif')).toEqual({ ok: false, motivo: 'tipo' });
  });

  it('tipo declarado "image/png" pero contenido real es JPEG → motivo "contenido"', () => {
    expect(validarImagen(bufferJpeg(), 'image/png')).toEqual({ ok: false, motivo: 'contenido' });
  });

  it('WEBP con RIFF correcto pero fourCC distinto de "WEBP" en offset 8 → motivo "contenido"', () => {
    const bytes = bufferWebp();
    bytes[8] = 0x00; // corrompe el fourCC
    expect(validarImagen(bytes, 'image/webp')).toEqual({ ok: false, motivo: 'contenido' });
  });

  it('buffer vacío/corto (sin bytes suficientes para el magic) → motivo "contenido", sin lanzar', () => {
    expect(validarImagen(new Uint8Array(0), 'image/png')).toEqual({ ok: false, motivo: 'contenido' });
    expect(validarImagen(new Uint8Array([0x89, 0x50]), 'image/png')).toEqual({ ok: false, motivo: 'contenido' });
  });

  it('el contrato de TIPOS_IMAGEN mapea exactamente a los 3 formatos soportados', () => {
    expect(TIPOS_IMAGEN).toEqual({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' });
  });
});

describe('rutaImagen', () => {
  it('sha256 hex (32 chars) del sku normalizado (trim+UPPER) + "." + ext', () => {
    const esperado = createHash('sha256').update('A-1').digest('hex').slice(0, 32);
    expect(rutaImagen('a-1', 'png')).toBe(`${esperado}.png`);
  });

  it('normaliza trim+UPPER: mismo path para variantes de casing/espacios', () => {
    expect(rutaImagen('  a-1  ', 'jpg')).toBe(rutaImagen('A-1', 'jpg'));
  });

  it.each(['WN947-X-N/BPU51-H14', 'YBY016 W'])(
    'SKU con "/" o espacios (%s) produce un path seguro (solo hex + extensión)',
    (sku) => {
      const path = rutaImagen(sku, 'webp');
      expect(path).toMatch(/^[0-9a-f]{32}\.webp$/);
    },
  );

  it('SKUs distintos producen paths distintos', () => {
    expect(rutaImagen('SKU-A', 'png')).not.toBe(rutaImagen('SKU-B', 'png'));
  });
});

describe('variantesImagen', () => {
  it('regresa las 3 rutas posibles (png/jpg/webp) para el mismo SKU, mismo hash', () => {
    const variantes = variantesImagen('WN947-X-N/BPU51-H14');
    expect(variantes).toHaveLength(3);
    expect(variantes.sort()).toEqual(
      [rutaImagen('WN947-X-N/BPU51-H14', 'png'), rutaImagen('WN947-X-N/BPU51-H14', 'jpg'), rutaImagen('WN947-X-N/BPU51-H14', 'webp')].sort(),
    );
  });
});
