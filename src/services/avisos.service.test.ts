// ============================================================
// [INV-B9.1] avisos.service.test.ts — las ESCRITURAS del seguimiento.
//
// Lo que se prueba aquí es una sola clase de falla, y es la que da nombre al
// bloque: **un apagado silencioso**. Tanto `av_correo` como `boletin_correo`
// son campos que un PATCH puede pisar sin querer, porque las dos escrituras son
// upserts que arman la fila completa. Si el campo ausente se resolviera a
// `false` en vez de conservarse, tocar los avisos de un SKU desde otra
// superficie apagaría su correo sin decir nada — y el usuario se enteraría por
// el correo que NO llegó, que es la peor manera de enterarse.
//
// El fake reproduce las CADENAS REALES de PostgREST, no una versión cómoda: si
// el servicio cambiara de forma de llamar, esto deja de resolver.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  guardarPreferencias,
  leerPreferencias,
  seguirSku,
  PREFERENCIAS_POR_OMISION,
  AvisoError,
} from './avisos.service';

type Fila = Record<string, unknown>;

/**
 * Fake de `preferencias_notificacion`. Soporta las dos cadenas que usa el
 * servicio: `select().maybeSingle()` para leer y `upsert().select().single()`
 * para escribir. Devuelve lo escrito, como hace PostgREST con `.select()`.
 */
function fakePrefs(actual: Fila | null) {
  const upserts: Fila[] = [];
  const db = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn(async () => ({ data: actual, error: null })),
      })),
      upsert: vi.fn((fila: Fila) => {
        upserts.push(fila);
        return {
          select: vi.fn(() => ({ single: vi.fn(async () => ({ data: fila, error: null })) })),
        };
      }),
    })),
  } as unknown as SupabaseClient;
  return { db, upserts };
}

const PREFS_GUARDADAS: Fila = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
  preguntar_por_sku: false,
  visto_hasta: null,
  boletin_correo: true,
};

const AHORA = new Date('2026-08-17T10:00:00.000Z');

describe('[INV-B9] leerPreferencias', () => {
  it('sin fila devuelve los valores por omisión: la fila nace perezosa', async () => {
    const { db } = fakePrefs(null);
    expect(await leerPreferencias(db)).toEqual(PREFERENCIAS_POR_OMISION);
  });

  // El boletín le llega a TODOS por decisión de producto; quien lo sienta ruidoso lo
  // apaga. Un default apagado invertiría la decisión sin discutirla.
  it('el boletín nace ENCENDIDO en los valores por omisión', () => {
    expect(PREFERENCIAS_POR_OMISION.boletin_correo).toBe(true);
  });
});

describe('[INV-B9.1] guardarPreferencias · el campo ausente se CONSERVA', () => {
  it('un PATCH que solo toca un aviso NO apaga el boletín', async () => {
    const { db, upserts } = fakePrefs(PREFS_GUARDADAS);
    await guardarPreferencias(db, 'perfil-1', { av_estatus: true }, AHORA);

    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.av_estatus).toBe(true);
    expect(upserts[0]!.boletin_correo).toBe(true);
  });

  it('y tampoco lo ENCIENDE si el usuario ya lo había apagado', async () => {
    const { db, upserts } = fakePrefs({ ...PREFS_GUARDADAS, boletin_correo: false });
    await guardarPreferencias(db, 'perfil-1', { preguntar_por_sku: true }, AHORA);
    expect(upserts[0]!.boletin_correo).toBe(false);
  });

  it('cuando el PATCH sí lo menciona, manda lo que dice', async () => {
    const { db, upserts } = fakePrefs(PREFS_GUARDADAS);
    await guardarPreferencias(db, 'perfil-1', { boletin_correo: false }, AHORA);
    expect(upserts[0]!.boletin_correo).toBe(false);
    // Y no arrastra nada más: los avisos siguen como estaban.
    expect(upserts[0]!.av_llegada).toBe(true);
    expect(upserts[0]!.preguntar_por_sku).toBe(false);
  });

  // ============================================================
  // LA MARCA DE AGUA LA ESTAMPA EL SERVIDOR. Si el cliente propusiera el
  // instante, podría silenciarse con una marca en el futuro — misma regla que
  // en el volcado de B8.2 hizo que la suma la hiciera el servidor.
  // ============================================================
  it('`marcar_visto` estampa la hora del SERVIDOR', async () => {
    const { db, upserts } = fakePrefs(PREFS_GUARDADAS);
    await guardarPreferencias(db, 'perfil-1', { marcar_visto: true }, AHORA);
    expect(upserts[0]!.visto_hasta).toBe(AHORA.toISOString());
  });

  it('sin `marcar_visto` la marca no se mueve: guardar un aviso no es haber leído', async () => {
    const previa = '2026-08-01T00:00:00.000Z';
    const { db, upserts } = fakePrefs({ ...PREFS_GUARDADAS, visto_hasta: previa });
    await guardarPreferencias(db, 'perfil-1', { av_disponible: true }, AHORA);
    expect(upserts[0]!.visto_hasta).toBe(previa);
  });

  it('`marcar_visto` no viaja a la base: no es una columna', async () => {
    const { db, upserts } = fakePrefs(PREFS_GUARDADAS);
    await guardarPreferencias(db, 'perfil-1', { marcar_visto: true }, AHORA);
    expect(upserts[0]).not.toHaveProperty('marcar_visto');
  });
});

// ============================================================
// Fake de `seguimientos`. Reproduce las tres cadenas de `seguirSku`:
//   select('sku,av_correo').eq().maybeSingle()   ← ¿ya está?
//   select('sku', {count, head})                 ← el tope, awaited directo
//   upsert(fila, {onConflict})                   ← awaited directo
// ============================================================
function fakeSeguimientos(yaEsta: Fila | null, prefs: Fila | null = PREFS_GUARDADAS, total = 0) {
  const upserts: Fila[] = [];
  const db = {
    from: vi.fn((tabla: string) => {
      if (tabla === 'preferencias_notificacion') {
        return { select: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: prefs, error: null })) })) };
      }
      return {
        select: vi.fn((_cols: string, opciones?: { count?: string; head?: boolean }) => {
          if (opciones?.head) return Promise.resolve({ count: total, error: null });
          return { eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: yaEsta, error: null })) })) };
        }),
        upsert: vi.fn(async (fila: Fila) => {
          upserts.push(fila);
          return { error: null };
        }),
      };
    }),
  } as unknown as SupabaseClient;
  return { db, upserts };
}

const SOLO_LLEGADA = { av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true };

describe('[INV-B9.1] seguirSku · `av_correo` ausente se CONSERVA', () => {
  it('cambiar los avisos de un SKU NO le apaga el correo', async () => {
    const { db, upserts } = fakeSeguimientos({ sku: 'SUJ500-F', av_correo: true });
    await seguirSku(db, 'perfil-1', { sku: 'SUJ500-F', avisos: { ...SOLO_LLEGADA, av_estatus: true } }, 200);

    expect(upserts[0]!.av_estatus).toBe(true);
    expect(upserts[0]!.av_correo).toBe(true);
  });

  it('un seguimiento NUEVO nace con el correo apagado: el correo se pide', async () => {
    const { db, upserts } = fakeSeguimientos(null);
    await seguirSku(db, 'perfil-1', { sku: 'SUJ500-F' }, 200);
    expect(upserts[0]!.av_correo).toBe(false);
  });

  it('apagarlo explícitamente sí lo apaga', async () => {
    const { db, upserts } = fakeSeguimientos({ sku: 'SUJ500-F', av_correo: true });
    await seguirSku(db, 'perfil-1', { sku: 'SUJ500-F', av_correo: false }, 200);
    expect(upserts[0]!.av_correo).toBe(false);
  });

  it('sin `avisos` aplica las PREFERENCIAS del perfil, que es el camino normal', async () => {
    const { db, upserts } = fakeSeguimientos(null, { ...PREFS_GUARDADAS, av_reservado: true });
    await seguirSku(db, 'perfil-1', { sku: 'SUJ500-F' }, 200);
    expect(upserts[0]!.av_reservado).toBe(true);
    expect(upserts[0]!.av_llegada).toBe(true);
  });

  // Seguir un SKU sin querer saber nada de él es una fila sin sentido, y una
  // fila sin sentido acaba siendo un aviso que nadie sabe explicar.
  it('con los cuatro avisos apagados no escribe nada y lo dice por su nombre', async () => {
    const { db, upserts } = fakeSeguimientos(null);
    await expect(
      seguirSku(db, 'perfil-1', { sku: 'SUJ500-F', avisos: { ...SOLO_LLEGADA, av_llegada: false } }, 200),
    ).rejects.toThrow(AvisoError);
    expect(upserts).toHaveLength(0);
  });

  // El tope solo aplica a filas NUEVAS: cambiar los avisos de un SKU que ya se
  // sigue no hace crecer nada.
  it('en el tope, un SKU que YA se sigue se puede seguir editando', async () => {
    const { db, upserts } = fakeSeguimientos({ sku: 'SUJ500-F', av_correo: false }, PREFS_GUARDADAS, 200);
    await seguirSku(db, 'perfil-1', { sku: 'SUJ500-F', av_correo: true }, 200);
    expect(upserts[0]!.av_correo).toBe(true);
  });

  it('en el tope, uno NUEVO se rechaza', async () => {
    const { db, upserts } = fakeSeguimientos(null, PREFS_GUARDADAS, 200);
    await expect(seguirSku(db, 'perfil-1', { sku: 'OTRO-SKU' }, 200)).rejects.toThrow(AvisoError);
    expect(upserts).toHaveLength(0);
  });
});
