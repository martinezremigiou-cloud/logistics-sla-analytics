import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { subirImagen } from './imagenes.service';
import { rutaImagen, variantesImagen } from '@/lib/imagenes';

type Resp = { data: unknown; error: { message: string } | null };

/**
 * [MVP-2] A · Igual que en `color.service.test.ts`, el fake REVIENTA si
 * alguien vuelve a tocar `productos_metadata` directamente: ese upsert es
 * el bug (tabla de lista blanca + `RETURNING *` de PostgREST → 42501 →
 * 500). Un mock permisivo dejaría pasar la regresión en verde.
 */
function makeFakeDb(opts: {
  productoResp?: Resp;
  removeResp?: Resp;
  uploadResp?: Resp;
  rpcResp?: Resp;
  publicUrl?: string;
} = {}) {
  const productoResp: Resp = opts.productoResp ?? { data: { sku: 'A-1' }, error: null };
  const removeResp: Resp = opts.removeResp ?? { data: [], error: null };
  const uploadResp: Resp = opts.uploadResp ?? { data: { id: 'x', path: 'p', fullPath: 'producto-imagenes/p' }, error: null };
  const rpcResp: Resp = opts.rpcResp ?? { data: null, error: null };
  const publicUrl = opts.publicUrl ?? 'http://127.0.0.1:54321/storage/v1/object/public/producto-imagenes/x.png';

  const eqCalls: [string, unknown][] = [];
  const removeCalls: string[][] = [];
  const uploadCalls: { path: string; body: unknown; opts: unknown }[] = [];
  const getPublicUrlCalls: string[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  const storageBucket = {
    remove: vi.fn((paths: string[]) => {
      removeCalls.push(paths);
      return Promise.resolve(removeResp);
    }),
    upload: vi.fn((path: string, body: unknown, uploadOpts: unknown) => {
      uploadCalls.push({ path, body, opts: uploadOpts });
      return Promise.resolve(uploadResp);
    }),
    getPublicUrl: vi.fn((path: string) => {
      getPublicUrlCalls.push(path);
      return { data: { publicUrl } };
    }),
  };

  const db = {
    storage: { from: vi.fn((bucket: string) => (bucket === 'producto-imagenes' ? storageBucket : (() => { throw new Error('bucket inesperado: ' + bucket); })())) },
    from: vi.fn((table: string) => {
      if (table === 'productos') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn((col: string, val: unknown) => {
              eqCalls.push([col, val]);
              return { maybeSingle: vi.fn(() => Promise.resolve(productoResp)) };
            }),
          })),
        };
      }
      throw new Error(
        `escritura/lectura DIRECTA a "${table}" desde imagenes.service: prohibido para tablas de lista blanca — va por la RPC aplicar_metadata (0017)`,
      );
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResp);
    }),
  };

  return { db: db as unknown as SupabaseClient, eqCalls, removeCalls, uploadCalls, getPublicUrlCalls, rpcCalls, publicUrl };
}

const bufferFake = new ArrayBuffer(10);

describe('subirImagen', () => {
  it('sku no encontrado → {tipo:"sku_no_encontrado"}, no toca Storage ni la RPC', async () => {
    const { db, removeCalls, uploadCalls, rpcCalls } = makeFakeDb({ productoResp: { data: null, error: null } });

    const result = await subirImagen(db, { sku: 'NOEXISTE', buffer: bufferFake, contentType: 'image/png' });

    expect(result).toEqual({ tipo: 'sku_no_encontrado' });
    expect(removeCalls).toHaveLength(0);
    expect(uploadCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
  });

  it('ok: limpia variantes, sube al path esperado, y escribe imagen_url por la RPC aplicar_metadata', async () => {
    const { db, eqCalls, removeCalls, uploadCalls, getPublicUrlCalls, rpcCalls, publicUrl } = makeFakeDb();

    const result = await subirImagen(db, { sku: 'a-1', buffer: bufferFake, contentType: 'image/png' });

    expect(eqCalls).toEqual([['sku', 'a-1']]);

    const pathEsperado = rutaImagen('a-1', 'png');
    // [MVP-2, hallazgo A6] La limpieza EXCLUYE la extensión recién escrita.
    // Antes borraba las 3 (incluida ésta) y lo hacía ANTES del upload: si el
    // upload fallaba, la imagen anterior ya no existía y `imagen_url` seguía
    // apuntando a la ruta borrada — pérdida de dato, no huérfano.
    expect(removeCalls).toEqual([variantesImagen('a-1').filter((v) => v !== pathEsperado)]);
    expect(removeCalls[0]).not.toContain(pathEsperado);
    expect(uploadCalls).toEqual([{ path: pathEsperado, body: bufferFake, opts: { contentType: 'image/png', upsert: true } }]);
    expect(getPublicUrlCalls).toEqual([pathEsperado]);
    expect(rpcCalls).toEqual([
      { fn: 'aplicar_metadata', args: { p_sku: 'a-1', p_campo: 'imagen_url', p_valor: publicUrl } },
    ]);
    expect(result).toEqual({ tipo: 'ok', resultado: { sku: 'a-1', imagen_url: publicUrl } });
  });

  it('`updated_by` NO viaja desde JS: lo fija la RPC desde el JWT', async () => {
    const { db, rpcCalls } = makeFakeDb();

    await subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/png' });

    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('updated_by');
  });

  it('resuelve la extensión correcta para jpeg y webp', async () => {
    const { db: dbJpeg, uploadCalls: uploadJpeg } = makeFakeDb();
    await subirImagen(dbJpeg, { sku: 'A-1', buffer: bufferFake, contentType: 'image/jpeg' });
    expect(uploadJpeg[0].path).toBe(rutaImagen('A-1', 'jpg'));

    const { db: dbWebp, uploadCalls: uploadWebp } = makeFakeDb();
    await subirImagen(dbWebp, { sku: 'A-1', buffer: bufferFake, contentType: 'image/webp' });
    expect(uploadWebp[0].path).toBe(rutaImagen('A-1', 'webp'));
  });

  it('remove() con error no interrumpe el flujo (idempotente, se ignora)', async () => {
    const { db, uploadCalls, rpcCalls } = makeFakeDb({ removeResp: { data: null, error: { message: 'not found' } } });

    const result = await subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/png' });

    expect(result.tipo).toBe('ok');
    expect(uploadCalls).toHaveLength(1);
    expect(rpcCalls).toHaveLength(1);
  });

  it('error en productos (lookup) → lanza', async () => {
    const { db } = makeFakeDb({ productoResp: { data: null, error: { message: 'constraint boom secreto' } } });

    await expect(
      subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/png' }),
    ).rejects.toThrow(/constraint boom secreto/);
  });

  it('error en upload → lanza, no llega a getPublicUrl ni a la RPC, y NO BORRÓ NADA (la imagen anterior sobrevive)', async () => {
    const { db, getPublicUrlCalls, rpcCalls, removeCalls } = makeFakeDb({
      uploadResp: { data: null, error: { message: 'storage boom secreto' } },
    });

    await expect(
      subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/png' }),
    ).rejects.toThrow(/storage boom secreto/);
    expect(getPublicUrlCalls).toHaveLength(0);
    expect(rpcCalls).toHaveLength(0);
    // La aserción que da sentido al frente A6: con el orden viejo (remove
    // ANTES del upload) esto valía 1 y la imagen previa ya estaba destruida.
    expect(removeCalls).toHaveLength(0);
  });

  it('error en la RPC → lanza. NOTA: el objeto YA se subió a Storage — la ruta no es atómica (deuda declarada en la cabecera del servicio)', async () => {
    const { db, uploadCalls } = makeFakeDb({ rpcResp: { data: null, error: { message: 'constraint boom secreto' } } });

    await expect(
      subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/png' }),
    ).rejects.toThrow(/constraint boom secreto/);
    // Esto NO es un descuido del test: documenta el hueco medido en vivo
    // durante la corrida roja de una prueba de humo contra la ruta (500 en la
    // ruta, objeto presente en el bucket).
    expect(uploadCalls).toHaveLength(1);
  });

  it('contentType no soportado (defensivo — el route ya debió validarlo) → lanza', async () => {
    const { db } = makeFakeDb();

    await expect(
      subirImagen(db, { sku: 'A-1', buffer: bufferFake, contentType: 'image/gif' }),
    ).rejects.toThrow(/contentType no soportado/);
  });
});
