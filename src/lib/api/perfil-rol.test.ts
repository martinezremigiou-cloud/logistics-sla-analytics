import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { leerRolPerfil } from './perfil-rol';

/** Fake db mínimo: `from('perfiles').select('rol').eq('id', userId).maybeSingle()`. */
function makeFakeDb(resultado: { data: { rol: string } | null; error: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(resultado);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const db = { from } as unknown as SupabaseClient;
  return { db, from, select, eq, maybeSingle };
}

describe('leerRolPerfil', () => {
  it('perfil existente → { rol, error: null }', async () => {
    const { db } = makeFakeDb({ data: { rol: 'admin' }, error: null });

    const resultado = await leerRolPerfil(db, 'u1');

    expect(resultado).toEqual({ rol: 'admin', error: null });
  });

  it('arma la query exacta: from(perfiles).select(rol).eq(id, userId).maybeSingle()', async () => {
    const { db, from, select, eq, maybeSingle } = makeFakeDb({ data: { rol: 'kam' }, error: null });

    await leerRolPerfil(db, 'u2');

    expect(from).toHaveBeenCalledWith('perfiles');
    expect(select).toHaveBeenCalledWith('rol');
    expect(eq).toHaveBeenCalledWith('id', 'u2');
    expect(maybeSingle).toHaveBeenCalled();
  });

  it('perfil inexistente (data: null, sin error) → { rol: null, error: null }', async () => {
    const { db } = makeFakeDb({ data: null, error: null });

    const resultado = await leerRolPerfil(db, 'u3');

    expect(resultado).toEqual({ rol: null, error: null });
  });

  it('error real de lectura (PostgREST/red caído) → { rol: null, error } — el error se PROPAGA, nunca se descarta en silencio dentro del helper', async () => {
    const { db } = makeFakeDb({ data: null, error: { message: 'conexión perdida' } });

    const resultado = await leerRolPerfil(db, 'u4');

    expect(resultado).toEqual({ rol: null, error: { message: 'conexión perdida' } });
  });
});
