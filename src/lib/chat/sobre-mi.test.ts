// ============================================================
// [CHAT-B3] B3-6 · el Asistente sabe de sí mismo, y con cifras CONSULTADAS.
//
// El rojo de partida, medido en QA manual: «¿qué puedes hacer?» y
// «¿sabes de fichas técnicas?» devolvían el MISMO cuerpo, byte a byte. Y
// «¿de qué marcas sabes?» —que tiene respuesta exacta— devolvía un menú.
//
// El gate que de verdad importa es el 2: **la cifra tiene que venir de una
// consulta**. Un literal disfrazado pasa cualquier prueba que compare texto, y
// sólo se delata cuando el corpus cambia y la respuesta no. Por eso aquí se
// varía el dato de entrada y se exige que la salida lo siga.
// ============================================================
import { describe, it, expect } from 'vitest';
import { tipoSobreMiDe, respuestaSobreMi } from './sobre-mi';
import { QUIEN_SOY, AYUDA_CLARO } from './voz';
import type { LoQueSe } from '@/services/sobre-mi.service';

const SE: LoQueSe = {
  fichas: 137,
  marcas: [
    { nombre: 'brand1', fichas: 71 },
    { nombre: 'Series5', fichas: 26 },
    { nombre: 'Brand2', fichas: 9 },
  ],
};

describe('[CHAT-B3] GATE 1 · dos preguntas distintas NO reciben el mismo cuerpo', () => {
  it('«¿sabes de fichas técnicas?» y «¿de qué marcas sabes?» dan respuestas DISTINTAS', () => {
    // Hoy eran idénticas byte a byte: ése era el rojo de partida.
    const a = respuestaSobreMi(tipoSobreMiDe('¿sabes de fichas técnicas?')!, SE);
    const b = respuestaSobreMi(tipoSobreMiDe('¿de qué marcas sabes?')!, SE);
    expect(a).not.toBe(b);
  });

  it('y ninguna de las dos es la lista de capacidades', () => {
    for (const q of ['¿sabes de fichas técnicas?', '¿de qué marcas sabes?']) {
      const r = respuestaSobreMi(tipoSobreMiDe(q)!, SE);
      expect(r).not.toContain('sé hacer');
      expect(r.split('\n').length).toBeLessThan(4);
    }
  });
});

describe('[CHAT-B3] GATE 2 · la cifra sale de una CONSULTA, no de un literal', () => {
  it('⭐ CONTROL POSITIVO · si cambia el corpus, cambia la respuesta', () => {
    // Éste es EL gate. Un literal disfrazado pasa cualquier comparación de texto
    // y sólo se delata cuando el dato de abajo cambia. Aquí se cambia a mano.
    const conMas: LoQueSe = {
      fichas: 574,
      marcas: [...SE.marcas, { nombre: 'MarcaNueva', fichas: 437 }],
    };
    const antes = respuestaSobreMi('sabes', SE);
    const despues = respuestaSobreMi('sabes', conMas);

    expect(antes).toContain('137');
    expect(despues).toContain('574');
    expect(despues).toContain('MarcaNueva');
    expect(antes).not.toContain('MarcaNueva');
  });

  it('las marcas se nombran, no se cuentan y ya', () => {
    const r = respuestaSobreMi('marcas', SE);
    for (const m of SE.marcas) expect(r).toContain(m.nombre);
  });

  it('un corpus VACÍO se dice, no se maquilla', () => {
    // Cero es un valor. «Tengo muchas» sobre cero documentos sería inventar.
    const vacio: LoQueSe = { fichas: 0, marcas: [] };
    expect(respuestaSobreMi('cuantas', vacio)).toContain('no tengo');
    expect(respuestaSobreMi('marcas', vacio)).toContain('no tengo');
    expect(respuestaSobreMi('sabes', vacio)).toContain('no puedo contestarte');
  });
});

describe('[CHAT-B3] GATE 3 · «¿cuántas fichas tienes?» devuelve un NÚMERO', () => {
  it('no una ficha al azar', () => {
    const r = respuestaSobreMi(tipoSobreMiDe('¿cuántas fichas tienes?')!, SE);
    expect(r).toMatch(/\b137\b/);
  });
});

describe('[CHAT-B3] GATE 4 · «¿tú qué eres?» contesta desde §1 del SOUL', () => {
  it('con el texto de `voz.ts`, importado y no tecleado', () => {
    expect(respuestaSobreMi(tipoSobreMiDe('¿tú qué eres?')!, SE)).toBe(QUIEN_SOY);
  });

  it('en dos frases, y SIN la lista', () => {
    expect(QUIEN_SOY.split('. ').length).toBeLessThanOrEqual(3);
    expect(QUIEN_SOY).not.toContain('sé hacer');
  });

  it('las tres formas de preguntarlo llegan al mismo sitio', () => {
    for (const q of ['¿tú qué eres?', '¿quién eres?', '¿qué es el Asistente?']) {
      expect(tipoSobreMiDe(q)).toBe('quien_eres');
    }
  });
});

describe('[CHAT-B3] GATE 5 · una pregunta de sí/no se contesta con sí o no PRIMERO', () => {
  it('«¿sabes de fichas técnicas?» empieza con «Sí»', () => {
    expect(respuestaSobreMi('sabes', SE).startsWith('Sí')).toBe(true);
  });

  it('«¿me puedes ayudar con un producto?» ⇒ «Claro. ¿Cuál?» y nada más', () => {
    expect(respuestaSobreMi(tipoSobreMiDe('¿me puedes ayudar con un producto?')!, SE)).toBe(AYUDA_CLARO);
    expect(AYUDA_CLARO.length).toBeLessThan(30);
  });
});

describe('[CHAT-B3] el reconocedor NO se traga preguntas de producto', () => {
  // Equivocarse aquí cuesta caro y en silencio: una pregunta de producto tragada
  // como meta se contesta con una presentación en vez de con su ficha.
  const deProducto = [
    '¿qué es el CLIP 3.0?',
    '¿cuánto hay de KYA2490?',
    '¿qué es el desactivador RF?',
    '¿a qué frecuencia trabaja?',
    '¿qué SKUs están sobre-reservados?',
    '¿cuándo llega el SUJ500-F?',
    '¿qué familias tiene el KL2722?',
  ];
  for (const q of deProducto) {
    it(`«${q}» NO es sobre el Asistente`, () => {
      expect(tipoSobreMiDe(q)).toBeNull();
    });
  }

  it('«¿sabes cuántas fichas tienes?» es el NÚMERO, no el sí — el orden importa', () => {
    expect(tipoSobreMiDe('¿sabes cuántas fichas tienes?')).toBe('cuantas');
  });

  it('vacío y nulo no son nada', () => {
    expect(tipoSobreMiDe('')).toBeNull();
    expect(tipoSobreMiDe(null)).toBeNull();
  });
});
