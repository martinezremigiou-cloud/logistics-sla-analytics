// ============================================================
// [2.0.1-B · S-1] apariencia-proyecto.test.ts — las dos mitades de la
// apariencia por defecto: el VOCABULARIO de símbolos y el COLOR que gira con el
// tema.
//
// La segunda mitad es la que menos se ve venir. El acento del proyecto existe en
// TRES sitios que no se pueden unir —`:root`, `.dark` y el `--mx-tag-azul` del
// que sale— y el tinte es ese mismo hex con un alfa pegado. Que sean copias no
// las exime de coincidir: aquí se comparan, igual que `carril.ts` contra
// `globals.css`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '@/lib/guardas/codigo-fuente';
import { bloqueDe, tokensDe } from '@/lib/guardas/css-tokens';
import { SIMBOLOS, SIMBOLO_POR_DEFECTO, COLOR_PROYECTO, TINTE_PROYECTO, simboloDe } from './apariencia-proyecto';

// `sinComentarios` por la misma razón que en `globals-tema.test.ts`: un
// selector citado en un comentario le roba el bloque al de verdad.
const css = sinComentarios(readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8'));
const claro = tokensDe(bloqueDe(css, ':root'));
const oscuro = tokensDe(bloqueDe(css, '.dark'));

describe('[2.0.1-B · S-1] el vocabulario de símbolos', () => {
  it('son los SIETE de la §4, con identificadores únicos y trazo no vacío', () => {
    expect(SIMBOLOS).toHaveLength(7);
    expect(new Set(SIMBOLOS.map((s) => s.id)).size).toBe(7);
    for (const s of SIMBOLOS) {
      expect(s.d.length, `el símbolo «${s.id}» no tiene trazo`).toBeGreaterThan(10);
      expect(s.nombre.length, `el símbolo «${s.id}» no tiene nombre`).toBeGreaterThan(0);
    }
  });

  it('el símbolo POR DEFECTO está en la lista — si no, `simboloDe` reventaría en producción', () => {
    // La constante y la lista son dos cosas que pueden divergir, y la
    // consecuencia de que diverjan no es una tarjeta fea: es un `throw` en el
    // render de TODAS las tarjetas. Se ancla aquí.
    expect(SIMBOLOS.map((s) => s.id)).toContain(SIMBOLO_POR_DEFECTO);
    expect(() => simboloDe(null)).not.toThrow();
  });

  it('`simboloDe` resuelve el conocido y CAE al de por defecto con lo desconocido', () => {
    // La segunda mitad es la que importa: cuando llegue la columna de S-2
    // vendrá en `NULL` para las filas que ya existen, y una tarjeta sin
    // portada es peor que una con la portada genérica.
    expect(simboloDe('antena').id).toBe('antena');
    expect(simboloDe(null).id).toBe(SIMBOLO_POR_DEFECTO);
    expect(simboloDe(undefined).id).toBe(SIMBOLO_POR_DEFECTO);
    expect(simboloDe('un-simbolo-que-no-existe').id).toBe(SIMBOLO_POR_DEFECTO);
  });
});

describe('[2.0.1-B · S-1] el acento del proyecto gira con el tema', () => {
  it('el módulo usa TOKENS y no hex: un hex clavado no tendría valor para oscuro', () => {
    // La propiedad de `globals-tema.test.ts` aplicada al sitio donde estuvo a
    // punto de romperse: la maqueta trae seis hex fijos y copiarlos aquí habría
    // dejado el acento congelado en su valor claro sobre el fondo oscuro, sin
    // que ninguna guarda pudiera verlo — porque el hex no estaría en el CSS.
    expect(COLOR_PROYECTO).toBe('var(--mx-proyecto-acento)');
    expect(TINTE_PROYECTO).toBe('var(--mx-proyecto-tinte)');
  });

  it('el acento ES el `--mx-tag-azul` del vocabulario, en los DOS temas', () => {
    // No «se parece»: es el mismo valor. Si alguien cambia la paleta de la casa
    // y se olvida de esto, aquí se entera.
    expect(claro['--mx-proyecto-acento']).toBe(claro['--mx-tag-azul']);
    expect(oscuro['--mx-proyecto-acento']).toBe(oscuro['--mx-tag-azul']);
  });

  it('el tinte es el acento + `1F` (12 %), en los DOS temas', () => {
    // `1F` = 31/255 = 12,16 %, el alfa de la maqueta. Es el tinte de fondo de la
    // §3, y se comprueba derivándolo en vez de escribiéndolo dos veces.
    for (const [tema, tokens] of [['claro', claro], ['oscuro', oscuro]] as const) {
      const acento = tokens['--mx-proyecto-acento'];
      expect(acento, `--mx-proyecto-acento falta en ${tema}`).toBeDefined();
      expect(tokens['--mx-proyecto-tinte'], `el tinte de ${tema} no es el acento al 12 %`).toBe(`${acento}1F`);
    }
  });

  it('control positivo · los lectores leen el CSS de verdad', () => {
    // Sin esto, dos mapas vacíos pondrían verdes las tres de arriba
    // comparando `undefined` con `undefined` (P17 sobre la propia guarda).
    expect(claro['--mx-proyecto-acento']).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(oscuro['--mx-proyecto-acento']).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(claro['--mx-proyecto-acento']).not.toBe(oscuro['--mx-proyecto-acento']);
    expect(claro['--mx-token-que-no-existe']).toBeUndefined();
  });
});
