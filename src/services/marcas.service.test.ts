import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { listarMarcasGobierno } from './marcas.service';

interface Llamada {
  tabla: string;
  select: string;
  order: [string, { ascending: boolean }] | null;
}

function fakeDb(resp: { data: unknown; error: unknown }) {
  const llamadas: Llamada[] = [];
  const db = {
    from(tabla: string) {
      return {
        select(select: string) {
          const info: Llamada = { tabla, select, order: null };
          return {
            order(col: string, opts: { ascending: boolean }) {
              info.order = [col, opts];
              llamadas.push(info);
              return Promise.resolve(resp);
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, llamadas };
}

describe('listarMarcasGobierno', () => {
  const FILA = {
    nombre: 'VERTICAL',
    excluida_del_catalogo: true,
    excluida_motivo: 'no se cotiza desde el portal',
    excluida_por: 'PO · Ivan Ruiz · via VERT-B2',
    excluida_en: '2026-09-21T21:57:54.000Z',
    creada_en: '2026-01-01T00:00:00.000Z',
  };

  // ⚠ LA CADENA DEL SELECT, PINNEADA POR SU TEXTO EXACTO — cuarta de la casa,
  // junto a las de inventory, dashboard y sku. Aquí la columna que no puede
  // caerse es `creada_en`: sin ella `esPosteriorALaRegla` recibe null, cuenta
  // como ANTERIOR, y la ALARMA DE MARCA NUEVA se apaga EN SILENCIO — con el
  // panel en verde diciendo «ninguna».
  it('pide EXACTAMENTE las seis columnas del gobierno, y con orden total', async () => {
    const { db, llamadas } = fakeDb({ data: [], error: null });
    await listarMarcasGobierno(db);

    expect(llamadas[0].tabla).toBe('marcas');
    expect(llamadas[0].select).toBe(
      'nombre,excluida_del_catalogo,excluida_motivo,excluida_por,excluida_en,creada_en',
    );
    expect(llamadas[0].order).toEqual(['nombre', { ascending: true }]);
  });

  it('mapea la fila cruda al modelo del gobierno', async () => {
    const { db } = fakeDb({ data: [FILA], error: null });
    const out = await listarMarcasGobierno(db);

    expect(out).toEqual([
      {
        nombre: 'VERTICAL',
        excluida: true,
        motivo: 'no se cotiza desde el portal',
        por: 'PO · Ivan Ruiz · via VERT-B2',
        en: '2026-09-21T21:57:54.000Z',
        creadaEn: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  // Mismo criterio estricto que `embedExcluida`: qué marca desaparece del
  // catálogo no lo decide una coerción.
  it.each([
    ['null', null],
    ['la cadena "true"', 'true'],
    ['1', 1],
  ])('excluida_del_catalogo = %s → false, sin coerción', async (_rotulo, valor) => {
    const { db } = fakeDb({ data: [{ ...FILA, excluida_del_catalogo: valor }], error: null });
    const out = await listarMarcasGobierno(db);
    expect(out[0].excluida).toBe(false);
  });

  it('data null → [] (no revienta, y no inventa filas)', async () => {
    const { db } = fakeDb({ data: null, error: null });
    await expect(listarMarcasGobierno(db)).resolves.toEqual([]);
  });

  // Un fallo de lectura NO puede salir como «no hay marcas excluidas»: esa es
  // la diferencia entre «no hay nada» y «no se pudo mirar», y el panel pinta
  // cosas muy distintas según cuál sea.
  it('error del cliente → LANZA, nunca devuelve una lista vacía', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'permission denied for table marcas' } });
    await expect(listarMarcasGobierno(db)).rejects.toThrow(/marcas: permission denied/);
  });
});
