// ============================================================
// [CHAT-B2] Lo que estas pruebas cuidan NO es que «hola» se reconozca —eso es
// fácil—: es que **una pregunta que empieza saludando siga siendo una
// pregunta**. El costo de un falso positivo aquí es alto y silencioso: se
// pierde la pregunta y el usuario ve un saludo sin venir a cuento.
//
// Por eso la regla es «TODAS las palabras son sociales» y no `includes('hola')`,
// que habría sido más corto y habría roto el caso normal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { tipoSocialDe } from './social';

describe('[CHAT-B2] lo que SÍ es social', () => {
  const casos: [string, string][] = [
    ['Hola', 'saludo'],
    ['hola!', 'saludo'],
    ['HOLA', 'saludo'],
    ['buenos días', 'saludo'],
    ['Buenas tardes', 'saludo'],
    ['¿qué tal?', 'saludo'],
    ['hey', 'saludo'],
    ['hola asistente', 'saludo'],
    ['gracias', 'acuse'],
    ['muchas gracias', 'acuse'],
    ['ok', 'acuse'],
    ['perfecto, gracias', 'acuse'],
    ['adiós', 'despedida'],
    ['hasta luego', 'despedida'],
    ['nos vemos', 'despedida'],
  ];
  for (const [entrada, espera] of casos) {
    it(`«${entrada}» ⇒ ${espera}`, () => {
      expect(tipoSocialDe(entrada)).toBe(espera);
    });
  }

  it('los acentos no deciden: «adios» y «adiós» son lo mismo', () => {
    expect(tipoSocialDe('adios')).toBe(tipoSocialDe('adiós'));
  });
});

describe('[CHAT-B2] EL CASO QUE JUSTIFICA LA REGLA · una pregunta no es un saludo', () => {
  const preguntas = [
    'hola, ¿cuánto hay de KYA2490?',
    'buenos días, ¿qué hay en aduana?',
    'gracias, ahora dime la ficha del SUJ500-F',
    '¿qué es el desactivador RF?',
    '¿a qué frecuencia trabaja?',
    '¿qué SKUs están sobre-reservados?',
    '¿cuál es bueno para tiendas grandes?',
  ];
  for (const q of preguntas) {
    it(`«${q}» NO es social`, () => {
      expect(tipoSocialDe(q)).toBeNull();
    });
  }
});

describe('[CHAT-B2] los bordes', () => {
  it('vacío y nulo no son sociales', () => {
    expect(tipoSocialDe('')).toBeNull();
    expect(tipoSocialDe(null)).toBeNull();
    expect(tipoSocialDe('   ')).toBeNull();
  });

  it('más de cinco palabras no es un saludo, aunque todas suenen sociales', () => {
    // Un saludo es corto POR DEFINICIÓN. Más allá casi siempre hay una pregunta
    // escondida, y perderla cuesta más que no saludar.
    expect(tipoSocialDe('hola buenas tardes buenos días hola hola')).toBeNull();
  });

  it('«qué» a secas NO es un saludo: es el arranque de casi toda pregunta', () => {
    expect(tipoSocialDe('qué')).toBeNull();
  });

  it('«asistente» a secas tampoco: es nombrar al asistente, no saludarlo', () => {
    expect(tipoSocialDe('asistente')).toBeNull();
  });
});
