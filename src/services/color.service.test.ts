import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setColor } from './color.service';
import type { ColorBody } from '@/schemas/color.schema';

type Resp = { data: unknown; error: { message: string } | null };

/**
 * [MVP-2] A · El fake REVIENTA si alguien vuelve a tocar
 * `productos_metadata` directamente.
 *
 * No es celo: ese upsert directo es el bug. `productos_metadata` es tabla
 * de LISTA BLANCA desde `0012_b7b_hardening` y PostgREST arma la escritura
 * con `RETURNING *` se encadene `.select()` o no → 42501 → 500. Un mock
 * permisivo dejaría pasar la regresión en verde, que es exactamente cómo
 * el bug llegó a producción la primera vez.
 */
function makeFakeDb(opts: { productoResp?: Resp; rpcResp?: Resp } = {}) {
  const productoResp: Resp = opts.productoResp ?? { data: { sku: 'A-1' }, error: null };
  const rpcResp: Resp = opts.rpcResp ?? { data: null, error: null };

  const eqCalls: [string, unknown][] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];

  const db = {
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
        `escritura/lectura DIRECTA a "${table}" desde color.service: prohibido para tablas de lista blanca — va por la RPC aplicar_metadata (0017)`,
      );
    }),
    rpc: vi.fn((fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(rpcResp);
    }),
  };

  return { db: db as unknown as SupabaseClient, eqCalls, rpcCalls };
}

const input = (color: ColorBody['color']): ColorBody => ({ sku: 'A-1', color });

describe('setColor', () => {
  it('sku no encontrado → {tipo:"sku_no_encontrado"}, sin llamar a la RPC', async () => {
    const { db, rpcCalls } = makeFakeDb({ productoResp: { data: null, error: null } });

    const result = await setColor(db, input('azul'));

    expect(result).toEqual({ tipo: 'sku_no_encontrado' });
    expect(rpcCalls).toHaveLength(0);
  });

  it('ok: asigna color por la RPC aplicar_metadata, NO por un upsert directo', async () => {
    const { db, rpcCalls, eqCalls } = makeFakeDb();

    const result = await setColor(db, input('turquesa'));

    expect(result).toEqual({ tipo: 'ok', resultado: { sku: 'A-1', color: 'turquesa' } });
    expect(eqCalls).toEqual([['sku', 'A-1']]);
    expect(rpcCalls).toEqual([
      { fn: 'aplicar_metadata', args: { p_sku: 'A-1', p_campo: 'color', p_valor: 'turquesa' } },
    ]);
  });

  it('`updated_by` NO viaja desde JS: lo fija la RPC desde el JWT', async () => {
    const { db, rpcCalls } = makeFakeDb();

    await setColor(db, input('rojo'));

    // Mandar la identidad desde el cliente fue el patrón que este bloque
    // retiró: la firma de `setColor` ya ni siquiera recibe un actor.
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('updated_by');
    expect(JSON.stringify(rpcCalls[0].args)).not.toContain('@');
  });

  it('ok: color null (quitar el color asignado) se manda tal cual', async () => {
    const { db, rpcCalls } = makeFakeDb();

    const result = await setColor(db, input(null));

    expect(result).toEqual({ tipo: 'ok', resultado: { sku: 'A-1', color: null } });
    expect(rpcCalls[0].args).toEqual({ p_sku: 'A-1', p_campo: 'color', p_valor: null });
  });

  it('error al buscar el producto → lanza (el route responde 500 sin fuga)', async () => {
    const { db } = makeFakeDb({ productoResp: { data: null, error: { message: 'constraint boom secreto' } } });

    await expect(setColor(db, input('rojo'))).rejects.toThrow(/constraint boom secreto/);
  });

  it('error en la RPC → lanza', async () => {
    const { db } = makeFakeDb({ rpcResp: { data: null, error: { message: 'constraint boom secreto' } } });

    await expect(setColor(db, input('rojo'))).rejects.toThrow(/constraint boom secreto/);
  });
});
