import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listTecnologiasSeleccionables } from './tecnologias.service';

type Resp = { data: unknown; error: { message: string; code?: string } | null };

function makeFakeDb(rpcResponse: Resp) {
  const rpc = vi.fn(() => Promise.resolve(rpcResponse));
  const db = { rpc };
  return { db: db as unknown as SupabaseClient, rpc };
}

describe('listTecnologiasSeleccionables', () => {
  it('RETURNS SETOF text: cada fila ya es el string', async () => {
    const { db, rpc } = makeFakeDb({ data: ['EAS', 'BRAND2', 'BRAND1'], error: null });
    const result = await listTecnologiasSeleccionables(db);
    expect(result).toEqual(['EAS', 'BRAND2', 'BRAND1']);
    expect(rpc).toHaveBeenCalledWith('tecnologias_seleccionables');
  });

  it('RETURNS TABLE(tecnologia text): cada fila es { tecnologia: string }', async () => {
    const { db } = makeFakeDb({ data: [{ tecnologia: 'EAS' }, { tecnologia: 'BRAND2' }], error: null });
    const result = await listTecnologiasSeleccionables(db);
    expect(result).toEqual(['EAS', 'BRAND2']);
  });

  it('data null → []', async () => {
    const { db } = makeFakeDb({ data: null, error: null });
    expect(await listTecnologiasSeleccionables(db)).toEqual([]);
  });

  it('filtra strings vacíos (trim)', async () => {
    const { db } = makeFakeDb({ data: ['EAS', '  ', ''], error: null });
    expect(await listTecnologiasSeleccionables(db)).toEqual(['EAS']);
  });

  // [FIX-B1 · revisión] YA NO degrada a `[]`: un selector vacío SIN error es
  // indistinguible de «hoy no hay tecnologías seleccionables» (universo real
  // y legítimo, ver la RPC en 0044) — P12, lector tolerante. La ruta
  // (`app/api/tecnologias/route.ts`) atrapa esto y responde 500.
  it('RPC ausente (PGRST202, migración 0044 sin aplicar) → lanza, YA NO degrada a []', async () => {
    const { db } = makeFakeDb({ data: null, error: { message: 'not found', code: 'PGRST202' } });
    await expect(listTecnologiasSeleccionables(db)).rejects.toThrow(/tecnologias_seleccionables/);
  });

  it('error genuino → lanza', async () => {
    const { db } = makeFakeDb({ data: null, error: { message: 'boom secreto' } });
    await expect(listTecnologiasSeleccionables(db)).rejects.toThrow(/boom secreto/);
  });

  // [FIX-B1 · revisión] Antes: una fila con forma desconocida se volvía ''
  // y se descartaba en silencio (`.filter((n) => n !== '')`) — si la RPC
  // cambiara de forma, el admin veía un selector vacío sin ningún error.
  it('fila con forma desconocida (ni string ni { tecnologia }) → lanza, YA NO la descarta en silencio', async () => {
    const { db } = makeFakeDb({ data: ['EAS', 42, 'BRAND1'], error: null });
    await expect(listTecnologiasSeleccionables(db)).rejects.toThrow(/forma desconocida/);
  });

  it('fila null en el arreglo → lanza (misma regla: forma desconocida)', async () => {
    const { db } = makeFakeDb({ data: [null], error: null });
    await expect(listTecnologiasSeleccionables(db)).rejects.toThrow(/forma desconocida/);
  });
});
