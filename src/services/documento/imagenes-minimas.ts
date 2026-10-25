// ============================================================
// imagenes-minimas.ts — bytes MÍNIMOS VÁLIDOS de un PNG y de un WEBP, generados
// en código, y un `fetch` simulado que los sirve según la extensión de la URL.
//
// Existe para que las pruebas del documento NO usen la red ni imágenes de
// archivo: lo que importa del `fetch` es (1) que `.png` llegue como un PNG que
// pdfkit pueda incrustar y (2) que `.webp` llegue como WEBP, formato que el PDF
// no puede incrustar y degrada por formato (nunca llega a pedirse, pero si
// alguien lo pidiera, los bytes serían un WEBP válido y no un PNG disfrazado).
//
// Solo lo importan pruebas. Sin dependencias externas: `zlib` de Node.
// ============================================================
import { deflateSync } from 'node:zlib';

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloquePng(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.writeUInt32BE(datos.length, 0);
  cabecera.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(tipo, 'ascii'), datos])), 0);
  return Buffer.concat([cabecera, datos, crc]);
}

/** PNG válido de `ancho`×`alto`, RGB de 8 bits, un gris plano, sin metadatos. */
export function pngMinimo(ancho = 1, alto = 1): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB
  const fila = Buffer.concat([Buffer.from([0]), Buffer.alloc(ancho * 3, 0xc8)]); // filtro 0 + píxeles
  const crudo = Buffer.concat(Array.from({ length: alto }, () => fila));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloquePng('IHDR', ihdr),
    bloquePng('IDAT', deflateSync(crudo)),
    bloquePng('IEND', Buffer.alloc(0)),
  ]);
}

/** WEBP válido de 1×1 (VP8L, sin pérdida): contenedor RIFF armado a mano. */
export function webpMinimo(): Buffer {
  const vp8l = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07]);
  const relleno = vp8l.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0); // los bloques RIFF se alinean a par
  const bloque = Buffer.alloc(8);
  bloque.write('VP8L', 0, 'ascii');
  bloque.writeUInt32LE(vp8l.length, 4);
  const cuerpo = Buffer.concat([Buffer.from('WEBP', 'ascii'), bloque, vp8l, relleno]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 'ascii');
  riff.writeUInt32LE(cuerpo.length, 4);
  return Buffer.concat([riff, cuerpo]);
}

/**
 * `fetch` simulado: sirve un PNG para `.png`, un WEBP para `.webp`, y 404 para
 * cualquier otra cosa. Registra las URL pedidas para que una prueba pueda
 * afirmar qué se descargó (y que nada salió a la red).
 */
export function fetchDeImagenes(): { fetch: typeof fetch; pedidas: string[] } {
  const pedidas: string[] = [];
  const png = pngMinimo(4, 3);
  const webp = webpMinimo();
  const simulado = (async (entrada: RequestInfo | URL) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    pedidas.push(url);
    const ext = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase();
    const cuerpo = ext === 'png' ? png : ext === 'webp' ? webp : null;
    if (!cuerpo) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => cuerpo.buffer.slice(cuerpo.byteOffset, cuerpo.byteOffset + cuerpo.byteLength),
    } as unknown as Response;
  }) as typeof fetch;
  return { fetch: simulado, pedidas };
}
