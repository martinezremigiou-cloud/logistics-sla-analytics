// ============================================================
// [INV-B11] O4 · la negativa explícita, y su CONTROL POSITIVO.
//
// La prueba que se pidió por nombre está en el primer `describe`:
//
//     «Una prueba que vacía el índice y afirma que la respuesta NO es
//      "no tengo ficha".»
//
// Sin ella, los tres caminos podrían estar cableados al mismo mensaje **y todas
// las demás pruebas seguirían verdes**. Es el troceador que no troceaba, un
// frente más adelante.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recuperarFicha, mensajeDe, causaNuestra, type ResultadoFicha } from './corpus-consulta.service';

// ------------------------------------------------------------
// Un doble que imita el encadenamiento de PostgREST lo justo.
// ------------------------------------------------------------
interface Estado {
  trozosTotal: number;
  productos: { sku: string; familia_id: string | null }[];
  familias: { id: string; nombre: string }[];
  puentes: { familia_id: string; ficha_ruta: string | null; revisado_en: string | null; notas: string | null }[];
  documentos: { ruta: string; titulo: string | null; fuente_pdf: string | null; commit_sha: string }[];
  trozos: { ruta: string; orden: number; ruta_seccion: string; texto: string; tiene_tabla: boolean }[];
  /** Tabla que debe fallar, para probar el camino 2. */
  falla: string | null;
}

let e: Estado;

function fakeDb(): SupabaseClient {
  const api = {
    from(tabla: string) {
      const filtros: Record<string, unknown> = {};
      const fallo = { data: null, error: { message: 'se cayó la red' }, count: null };

      const filtrar = (): unknown[] => {
        const clave = Object.keys(filtros)[0];
        const valor = filtros[clave!];
        const fuente =
          tabla === 'productos' ? e.productos
          : tabla === 'familias' ? e.familias
          : tabla === 'corpus_familia_ficha' ? e.puentes
          : tabla === 'corpus_documentos' ? e.documentos
          : tabla === 'corpus_trozos' ? e.trozos
          : [];
        if (!clave) return fuente as unknown[];
        return (fuente as Record<string, unknown>[]).filter((f) => f[clave] === valor);
      };

      const constructor = {
        select(_c?: string, opciones?: { count?: string; head?: boolean }) {
          if (opciones?.head) {
            if (e.falla === tabla) return Promise.resolve(fallo);
            return Promise.resolve({ data: null, error: null, count: e.trozosTotal });
          }
          return constructor;
        },
        eq(col: string, valor: unknown) {
          filtros[col] = valor;
          return constructor;
        },
        order() {
          return Promise.resolve(
            e.falla === tabla ? fallo : { data: filtrar(), error: null },
          );
        },
        maybeSingle() {
          if (e.falla === tabla) return Promise.resolve(fallo);
          const r = filtrar();
          return Promise.resolve({ data: r[0] ?? null, error: null });
        },
      };
      return constructor;
    },
  };
  return api as unknown as SupabaseClient;
}

const CORPUS_SANO: Estado = {
  trozosTotal: 271,
  productos: [{ sku: 'KL2722', familia_id: 'fam-1' }],
  familias: [{ id: 'fam-1', nombre: 'CANDADOS' }],
  puentes: [{ familia_id: 'fam-1', ficha_ruta: 'a/Series2.md', revisado_en: null, notas: null }],
  documentos: [{ ruta: 'a/Series2.md', titulo: 'Series2', fuente_pdf: 'Mkt/Series2.pdf', commit_sha: 'local-sin-git' }],
  trozos: [{ ruta: 'a/Series2.md', orden: 0, ruta_seccion: 'Series2', texto: 'Cable de 28"', tiene_tabla: false }],
  falla: null,
};

beforeEach(() => {
  e = structuredClone(CORPUS_SANO);
});

// ------------------------------------------------------------

describe('[INV-B11] ★ el control positivo que se pidió por nombre', () => {
  it('con el índice VACÍO la respuesta NO es «no tengo ficha»', async () => {
    e.trozosTotal = 0;
    const r = await recuperarFicha(fakeDb(), 'KL2722');

    // La aserción central va primero, y nombra el daño: culpar al corpus de un
    // pendiente nuestro.
    expect(r.tipo, 'un pendiente NUESTRO se disfrazó de «ese producto no está documentado»').not.toBe('sin_puente');
    expect(r.tipo).not.toBe('sin_ficha_confirmado');
    expect(r.tipo).toBe('corpus_vacio');
    expect(mensajeDe(r)).toContain('pendiente nuestro');
  });

  // ============================================================
  // ESTA PRUEBA EMPEZÓ SIENDO MÁS DÉBIL DE LO QUE PARECÍA, y vale contarlo.
  //
  // Comparaba las cadenas de los tres mensajes y exigía que fueran distintas.
  // Al sabotear —poner «No tengo ficha de este producto» como mensaje de
  // `fallo_consulta`— **la prueba pasó**: las cadenas seguían siendo tres
  // distintas. Cazaba la repetición literal y no el colapso de significado,
  // que es el daño real.
  //
  // Así que la distinción dejó de vivir en la redacción: `causaNuestra` la
  // vuelve un DATO, y la prueba comprueba una propiedad.
  // ============================================================
  it('un fallo NUESTRO nunca se presenta como un hecho del catálogo', () => {
    const nuestros: ResultadoFicha[] = [
      { tipo: 'corpus_vacio' },
      { tipo: 'fallo_consulta', detalle: 'x' },
      { tipo: 'puente_colgante', sku: 'A', familia: 'F', ruta: 'r.md' },
      { tipo: 'sin_puente', sku: 'A', familia: 'F' },
    ];
    const delCatalogo: ResultadoFicha[] = [
      { tipo: 'sku_desconocido', sku: 'A' },
      { tipo: 'sin_familia', sku: 'A' },
      { tipo: 'sin_ficha_confirmado', sku: 'A', familia: 'F', notas: null },
    ];

    for (const r of nuestros) expect(causaNuestra(r), `«${r.tipo}» no se declara como falla nuestra`).toBe(true);
    for (const r of delCatalogo) expect(causaNuestra(r), `«${r.tipo}» se declara nuestra y no lo es`).toBe(false);

    // Y ninguna de las nuestras puede decir literalmente lo mismo que una del
    // catálogo: si lo dijera, tenerlas separadas por dentro no serviría de nada.
    const textosCatalogo = new Set(delCatalogo.map(mensajeDe));
    for (const r of nuestros) {
      expect(textosCatalogo.has(mensajeDe(r)), `«${r.tipo}» dice lo mismo que un hecho del catálogo`).toBe(false);
    }
  });

  // Control positivo del control positivo: con el corpus sano SÍ se llega a la
  // ficha. Sin esto, un `recuperarFicha` que devolviera `corpus_vacio` siempre
  // pondría verdes las dos de arriba (P19).
  it('control positivo · con el corpus sano SÍ devuelve la ficha', async () => {
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo).toBe('ficha');
  });
});

describe('[INV-B11] el ORDEN: nunca se dice «no tengo ficha» sin pasar por 1 y 2', () => {
  it('índice vacío gana sobre SKU inexistente', async () => {
    e.trozosTotal = 0;
    e.productos = [];
    // Las dos condiciones son ciertas. La que se reporta tiene que ser la
    // NUESTRA: decir «no existe ese SKU» ocultaría que el corpus no está.
    expect((await recuperarFicha(fakeDb(), 'NO-EXISTE')).tipo).toBe('corpus_vacio');
  });

  it('un fallo de consulta NO se degrada a «no tengo ficha»', async () => {
    e.falla = 'productos';
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo).toBe('fallo_consulta');
    expect(mensajeDe(r)).toContain('No pude consultar');
  });

  it('un fallo al CONTAR el índice tampoco lo hace', async () => {
    e.falla = 'corpus_trozos';
    expect((await recuperarFicha(fakeDb(), 'KL2722')).tipo).toBe('fallo_consulta');
  });
});

describe('[INV-B11] los huecos, cada uno con su dueño', () => {
  it('SKU que no existe', async () => {
    e.productos = [];
    expect((await recuperarFicha(fakeDb(), 'ZZZ')).tipo).toBe('sku_desconocido');
  });

  it('SKU sin familia — es calidad del Excel', async () => {
    e.productos = [{ sku: 'KL2722', familia_id: null }];
    expect((await recuperarFicha(fakeDb(), 'KL2722')).tipo).toBe('sin_familia');
  });

  // ============================================================
  // «Nadie lo ha mirado» y «un humano confirmó que no hay» dicen lo mismo al
  // usuario si se colapsan, **y son de dueños distintos**: el primero es un
  // pendiente nuestro, el segundo un hecho del catálogo. Sin la diferencia, la
  // cobertura del puente no se puede medir.
  // ============================================================
  it('sin renglón en el puente = hueco NUESTRO, y el mensaje lo dice', async () => {
    e.puentes = [];
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo).toBe('sin_puente');
    expect(mensajeDe(r)).toContain('pendiente nuestro');
  });

  it('renglón revisado SIN ruta = un humano confirmó que no hay ficha', async () => {
    e.puentes = [{ familia_id: 'fam-1', ficha_ruta: null, revisado_en: '2026-08-21', notas: 'No hay ficha' }];
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo).toBe('sin_ficha_confirmado');
    expect(mensajeDe(r)).not.toContain('pendiente nuestro');
  });
});

describe('[INV-B11] el puente colgante', () => {
  // ============================================================
  // Existe porque `ficha_ruta` NO lleva clave foránea, y eso fue una decisión
  // (0031). Con `ON DELETE SET NULL` esto se habría vuelto un «no tengo ficha»
  // impecable, y el problema real —que la ficha desapareció del corpus— sería
  // invisible. Dos causas, una salida: el patrón que este proyecto lleva tres
  // bloques cazando.
  // ============================================================
  it('apunta a una ficha que ya no está → estado PROPIO, no «no tengo ficha»', async () => {
    e.documentos = [];
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo).toBe('puente_colgante');
    expect(r.tipo).not.toBe('sin_ficha_confirmado');
    expect(mensajeDe(r)).toContain('ya no está');
  });

  it('apunta a un documento EXCLUIDO (0 trozos) → también colgante', async () => {
    // Está en el índice, pero fue excluido por las tres reglas: apunta a algo
    // que no puede contestar. Es un error de mapeo, no una ficha vacía.
    e.trozos = [];
    expect((await recuperarFicha(fakeDb(), 'KL2722')).tipo).toBe('puente_colgante');
  });
});

describe('[INV-B11] la ficha, y su procedencia', () => {
  it('trae `fuente_pdf` y el mensaje la cita', async () => {
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    if (r.tipo !== 'ficha') throw new Error('esperaba ficha');
    expect(r.fuentePdf).toBe('Mkt/Series2.pdf');
    expect(mensajeDe(r)).toContain('Mkt/Series2.pdf');
  });

  // ============================================================
  // Medido: alguna ficha no declara `fuente_pdf`. Omitir la cita en
  // silencio se lee como «no hay nada que citar»; decir «sin PDF de origen» es
  // la verdad y se puede accionar.
  // ============================================================
  it('SIN `fuente_pdf` lo DICE, no omite la cita', async () => {
    e.documentos = [{ ruta: 'a/Series2.md', titulo: 'Series2', fuente_pdf: null, commit_sha: 'local-sin-git' }];
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    if (r.tipo !== 'ficha') throw new Error('esperaba ficha');
    expect(r.fuentePdf).toBeNull();
    expect(mensajeDe(r)).toContain('sin PDF de origen');
  });

  it('dice si el puente fue REVISADO o es una propuesta automática', async () => {
    const sinRevisar = await recuperarFicha(fakeDb(), 'KL2722');
    expect(sinRevisar.tipo === 'ficha' && sinRevisar.revisada).toBe(false);

    e.puentes = [{ familia_id: 'fam-1', ficha_ruta: 'a/Series2.md', revisado_en: '2026-08-21', notas: null }];
    const revisada = await recuperarFicha(fakeDb(), 'KL2722');
    expect(revisada.tipo === 'ficha' && revisada.revisada).toBe(true);
  });

  it('el `commit_sha` viaja hasta el resultado', async () => {
    const r = await recuperarFicha(fakeDb(), 'KL2722');
    expect(r.tipo === 'ficha' && r.commitSha).toBe('local-sin-git');
  });

  it('el SKU se normaliza como en el resto del portal', async () => {
    expect((await recuperarFicha(fakeDb(), '  kl2722 ')).tipo).toBe('ficha');
  });
});

describe('[INV-B11] mensajeDe · todo estado tiene mensaje', () => {
  it('ninguna variante se queda sin texto', () => {
    const todos: ResultadoFicha[] = [
      { tipo: 'corpus_vacio' },
      { tipo: 'fallo_consulta', detalle: 'x' },
      { tipo: 'puente_colgante', sku: 'A', familia: 'F', ruta: 'r.md' },
      { tipo: 'sku_desconocido', sku: 'A' },
      { tipo: 'sin_familia', sku: 'A' },
      { tipo: 'sin_puente', sku: 'A', familia: 'F' },
      { tipo: 'sin_ficha_confirmado', sku: 'A', familia: 'F', notas: null },
      {
        tipo: 'ficha', sku: 'A', familia: 'F', ruta: 'r.md', titulo: 'T',
        fuentePdf: null, commitSha: 'x', revisada: false, trozos: [],
      },
    ];
    for (const r of todos) expect(mensajeDe(r).length, `«${r.tipo}» sin mensaje`).toBeGreaterThan(10);
  });
});
