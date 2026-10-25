// ============================================================
// [INV-B11] O6 · «UNA PRUEBA DE QUE EL COPY SALE DE UNA FUENTE».
//
// Se pidió con esas palabras, y la parte que importa es la segunda:
// *«no repetido en tres componentes»*. Un texto duplicado no falla nunca — falla
// el día que alguien cambia uno de los tres y los otros dos siguen diciendo lo
// de antes. Eso no se ve en pantalla: se ve en dos pantallas distintas, meses
// después, y nadie sabe cuál es la buena.
//
// ────────────────────────────────────────────────────────────
// CÓMO SE COMPRUEBA, Y QUÉ NO PUEDE COMPROBAR.
//
// Leyendo el TEXTO FUENTE de cada componente, con el mismo molde que la guarda
// de tokens de color de B10 y la de flotantes de O6: se busca el literal dentro
// del archivo. Si aparece, es que alguien lo horneó en vez de importarlo.
//
// LÍMITE DECLARADO: esto no ve un texto **parecido**. Si alguien escribiera
// «Hola, soy el Asistente. ¿En qué puedo ayudarte?» en un componente, esta guarda no lo
// vería — y sería la misma divergencia. Lo que cubre es la copia literal, que
// es la forma en que esto pasa de verdad: copiar y pegar.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOMBRE,
  SALUDO_PANEL,
  SALUDO_CONTEXTUAL,
  ZERO_STATE,
  NO_SE,
  escalada,
  PERSONALIDAD,
  ACUSE,
  DESPEDIDA,
  MARCADOR_ENTRADA,
} from './voz';
import { CONTACTOS } from '@/lib/contactos';

const fuente = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Las superficies donde vive la voz del Asistente. */
const SUPERFICIES = [
  'src/components/chat/burbuja-chat.tsx',
  'src/components/chat/saludo-contextual.tsx',
  'src/components/chat/escalada-chat.tsx',
  'src/services/chat.service.ts',
];

describe('[INV-B11] la voz del Asistente sale de UNA fuente', () => {
  it('ningún componente hornea un texto de la voz: todos lo importan', () => {
    // `escalada(...)` no se compara entero porque lleva un nombre dentro; se
    // compara su parte fija, que es la que se copiaría.
    // [CHAT-B2] Los tres nuevos entran a la MISMA guarda. Copy fijo que no está
    // en esta lista es copy que puede duplicarse sin que nada se ponga rojo —
    // que es exactamente el defecto que este archivo existe para impedir.
    const literales = [
      SALUDO_PANEL,
      SALUDO_CONTEXTUAL,
      ZERO_STATE,
      NO_SE,
      'Para esto, escríbele a',
      ACUSE,
      DESPEDIDA,
      MARCADOR_ENTRADA,
    ];

    for (const archivo of SUPERFICIES) {
      const texto = fuente(archivo);
      for (const literal of literales) {
        expect(
          texto.includes(literal),
          `«${archivo}» hornea «${literal}» en vez de importarlo de voz.ts`,
        ).toBe(false);
      }
    }
  });

  it('CONTROL POSITIVO · el lector SÍ encuentra un literal cuando está', () => {
    // Sin esto, un `fuente()` roto —que devolviera cadena vacía— pondría la de
    // arriba en verde para siempre y la guarda no miraría nada. Es el troceador
    // que no troceaba, en una guarda de copy.
    const voz = fuente('src/lib/chat/voz.ts');
    expect(voz).toContain(SALUDO_CONTEXTUAL);
    expect(voz).toContain(NO_SE);
    expect(voz.length).toBeGreaterThan(500);
  });

  it('las superficies IMPORTAN de `voz.ts`: no basta con que no lo horneen', () => {
    // El complemento de la primera. Un componente que hubiera BORRADO el texto
    // sin poner nada en su lugar pasaría aquella con nota perfecta.
    for (const archivo of SUPERFICIES) {
      expect(fuente(archivo), `«${archivo}» dejó de leer la voz de un sitio común`).toMatch(
        /from ["'](@\/lib\/chat\/voz|\.\/voz|@\/lib\/chat\/voz)["']/,
      );
    }
  });
});

describe('[INV-B11] el Asistente · lo que la voz garantiza y lo que no', () => {
  it('el nombre se compone, no se teclea', () => {
    expect(SALUDO_PANEL).toContain(NOMBRE);
    expect(PERSONALIDAD.join(' ')).toContain(NOMBRE);
    // Y el saludo es el aprobado, literal.
    expect(SALUDO_PANEL).toBe('Hola, soy el Asistente. ¿En qué te ayudo?');
  });

  it('la escalada compone el nombre del contacto y no hornea a nadie', () => {
    expect(escalada(CONTACTOS.producto.nombre)).toContain('Hugo Lara');
    expect(escalada(CONTACTOS.inventario.nombre)).toContain('Paula Soto');
    // El control del molde: la parte fija es la misma en los dos.
    expect(escalada('X')).toBe('Para esto, escríbele a X:');
  });

  it('la personalidad NO promete redactar: el Asistente no genera prosa hoy', () => {
    // Es el límite acordado. Una personalidad que dijera «explica»,
    // «resume» o «redacta» le pediría al clasificador algo que su salida —un
    // JSON— no puede hacer, y el día que alguien lea el prompt creería que sí.
    const texto = PERSONALIDAD.join(' ').toLowerCase();
    for (const verbo of ['redacta', 'resume', 'explica con tus palabras', 'escribe un párrafo']) {
      expect(texto, `la personalidad promete «${verbo}», y el Asistente no redacta`).not.toContain(verbo);
    }
    // Lo que SÍ tiene que decir: que no inventa.
    expect(texto).toContain('nunca inventas');
  });
});

// ============================================================
// [CHAT-B3] B3-3 · CERRAR LA FORMA, NO EL CASO.
//
// En QA manual se encontró que `burbuja-chat.tsx` tecleaba «Esto sí sé
// hacerlo:» mientras `voz.ts` define `ZERO_STATE = 'Esto es lo que sé hacer:'`.
// **Dos textos, el mismo trabajo, y el archivo que dice «LA VOZ DEL ASISTENTE, EN UN
// SOLO SITIO» tenía dos.**
//
// Y la guarda de arriba NO PUDO cazarlo — su límite está declarado desde que se
// escribió: caza el literal, no el texto PARECIDO. **Cambiar una palabra esquiva
// al guardia.**
//
// Así que esto no busca ese literal: busca la FORMA. Un encabezado de lista es
// una frase corta que empieza en mayúscula y termina en dos puntos, y en estos
// componentes no debería existir ninguno escrito a mano.
//
// ⚠️ LO QUE ESTE BARRIDO **NO** PUEDE CAZAR, declarado como manda la casa:
//   · un encabezado construido por concatenación o interpolación
//   · uno que no termine en dos puntos («Esto sí sé hacer» a secas)
//   · uno en un componente que no esté en `SUPERFICIES`
// Es una red más ancha que la de arriba, no una red completa.
// ============================================================
describe('[CHAT-B3] ningún encabezado de lista se teclea en un componente del chat', () => {
  /** Una frase corta, capitalizada, que termina en dos puntos: la forma de un rótulo. */
  const encabezados = (texto: string): string[] => {
    const re = /["'`][ ]*([A-ZÁÉÍÓÚÑ][^"'`\n]{4,60}:)[ ]*["'`]/g;
    // Lo que SÍ puede llevar dos puntos sin ser un rótulo de lista. Se enumeran
    // con nombre en vez de aflojar el patrón: una excepción con nombre no se
    // desvía sola, un patrón flojo sí.
    const permitidos = [/^https?:$/i, /^\d+:$/];
    return Array.from(texto.matchAll(re))
      .map((m) => m[1])
      .filter((h) => !permitidos.some((p) => p.test(h)));
  };

  for (const archivo of SUPERFICIES) {
    it(`«${archivo}» no hornea ningún rótulo de lista`, () => {
      const hallados = encabezados(fuente(archivo));
      expect(hallados, `rótulos tecleados en ${archivo}: ${hallados.join(' · ')}`).toEqual([]);
    });
  }

  it('⭐ CONTROL POSITIVO · el barrido SÍ encuentra uno cuando está', () => {
    // Sin esto, el verde de arriba sería compatible con un patrón que no casa
    // nada — la guarda vacua de siempre.
    expect(encabezados('const x = "Esto sí sé hacerlo:";')).toEqual(['Esto sí sé hacerlo:']);
  });

  it('y el que SÍ está permitido es el importado, sin comillas', () => {
    expect(fuente('src/components/chat/burbuja-chat.tsx')).toContain('{ZERO_STATE}');
  });
});
