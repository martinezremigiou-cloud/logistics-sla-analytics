import { describe, it, expect, vi } from 'vitest';
import { fetchAllRows, comoRespuesta } from './fetch-all';

type Row = { id: number };

/** Genera `n` filas sintéticas con ids consecutivos desde `start`. */
function rows(start: number, n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: start + i }));
}

describe('fetchAllRows', () => {
  it('acumula 2.5 páginas: se detiene en la primera página corta', async () => {
    // 25 filas totales con pageSize=10 → páginas de 10, 10, 5.
    const build = vi.fn((from: number) => {
      if (from === 0) return Promise.resolve({ data: rows(0, 10), error: null });
      if (from === 10) return Promise.resolve({ data: rows(10, 10), error: null });
      if (from === 20) return Promise.resolve({ data: rows(20, 5), error: null });
      throw new Error('no debería pedirse una 4a página');
    });

    const result = await fetchAllRows(build, 10);

    expect(result).toHaveLength(25);
    expect(result[0]).toEqual({ id: 0 });
    expect(result[24]).toEqual({ id: 24 });
    expect(build).toHaveBeenCalledTimes(3);
    expect(build.mock.calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
  });

  it('página exacta seguida de página vacía: un round-trip extra para confirmar el fin', async () => {
    // 10 filas exactas con pageSize=10 → 1a página llena (10), 2a vacía (0<10) → para.
    const build = vi.fn((from: number) => {
      if (from === 0) return Promise.resolve({ data: rows(0, 10), error: null });
      return Promise.resolve({ data: [], error: null });
    });

    const result = await fetchAllRows(build, 10);

    expect(result).toHaveLength(10);
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('conjunto vacío: primera página ya viene corta (0 filas) → sin iterar más', async () => {
    const build = vi.fn(() => Promise.resolve({ data: [], error: null }));

    const result = await fetchAllRows(build, 10);

    expect(result).toEqual([]);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('data null (defensivo) se trata como página vacía', async () => {
    const build = vi.fn(() => Promise.resolve({ data: null, error: null }));

    const result = await fetchAllRows(build, 10);

    expect(result).toEqual([]);
  });

  it('error a media paginación: lanza y NO pide una página más', async () => {
    const build = vi.fn((from: number) => {
      if (from === 0) return Promise.resolve({ data: rows(0, 10), error: null });
      return Promise.resolve({ data: null, error: { message: 'conexión perdida a media paginación' } });
    });

    await expect(fetchAllRows(build, 10)).rejects.toThrow('conexión perdida a media paginación');
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('error en la primera página: lanza de inmediato', async () => {
    const build = vi.fn(() => Promise.resolve({ data: null, error: { message: 'sin permisos' } }));

    await expect(fetchAllRows(build, 10)).rejects.toThrow('sin permisos');
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('pageSize por default (1000): primera página corta pide el rango [0, 999]', async () => {
    const build = vi.fn(() => Promise.resolve({ data: rows(0, 3), error: null }));

    const result = await fetchAllRows(build);

    expect(result).toHaveLength(3);
    expect(build).toHaveBeenCalledWith(0, 999);
  });

  it('[FIX-B2] pageSize más ancho que el tope de PostgREST (o inválido): rechaza SIN pedir nada', async () => {
    // Con pageSize 5 000, PostgREST devolvería 1 000 filas, `1000 < 5000` y el
    // bucle pararía creyendo que no hay más: el corte silencioso que este
    // helper existe para evitar. Se rechaza antes de la primera consulta.
    for (const malo of [1001, 5000, 0, -1, 2.5]) {
      const build = vi.fn(() => Promise.resolve({ data: rows(0, 3), error: null }));
      await expect(fetchAllRows(build, malo)).rejects.toThrow(/pageSize .* fuera de \[1, 1000\]/);
      expect(build).not.toHaveBeenCalled();
    }
    // El tope exacto sí se permite.
    const bueno = vi.fn(() => Promise.resolve({ data: rows(0, 3), error: null }));
    await expect(fetchAllRows(bueno, 1000)).resolves.toHaveLength(3);
  });
});

describe('[FIX-B2] comoRespuesta', () => {
  it('lectura completa → `{ data: filas, error: null }`', async () => {
    const build = vi.fn((from: number) => Promise.resolve({ data: from === 0 ? rows(0, 10) : rows(10, 5), error: null }));

    expect(await comoRespuesta(fetchAllRows(build, 10))).toEqual({ data: rows(0, 15), error: null });
  });

  it('error a media paginación → `{ data: null, error: { message } }` con el MISMO mensaje, sin rechazar', async () => {
    const build = vi.fn((from: number) =>
      from === 0
        ? Promise.resolve({ data: rows(0, 10), error: null })
        : Promise.resolve({ data: null, error: { message: 'conexión perdida a media paginación' } }),
    );

    expect(await comoRespuesta(fetchAllRows(build, 10))).toEqual({
      data: null,
      error: { message: 'conexión perdida a media paginación' },
    });
  });
});
