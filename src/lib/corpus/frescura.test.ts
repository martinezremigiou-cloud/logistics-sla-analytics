// ============================================================
// [INV-B11] O7 · EL TESTIGO, probado donde se decide.
//
// Lo único que importa de esta pieza es que **NO COLAPSE LOS DOS SILENCIOS**:
//
//     «lleva 6 días sin correr»          ≠   «corrió anoche, sin novedad»
//
// Es la deuda B10-3 escrita como código. En la ingesta no se puede resolver
// —`snapshots` registra resultados, no intentos— y aquí sí, porque la `0030`
// escribe la fila al EMPEZAR. Estas pruebas son lo que impide que alguien
// «simplifique» las dos frases en una.
// ============================================================
import { describe, it, expect } from 'vitest';
import { estadoDe, textoDe, haceCuanto, pideAtencion, type DatosFrescura } from './frescura';

const AHORA = new Date('2026-08-23T12:00:00.000Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();

function datos(over: Partial<DatosFrescura> = {}): DatosFrescura {
  return {
    documentos: 184,
    trozos: 271,
    version: 'abc1234',
    ultimoCambio: hace(144), // 6 días
    ultimoIntento: hace(2),
    ultimoResultado: 'ok',
    motivo: null,
    ...over,
  };
}

describe('[INV-B11] los dos silencios NO son el mismo', () => {
  it('revisado DESPUÉS del último cambio ⇒ «sin novedad», y se dice', () => {
    const e = estadoDe(datos());
    expect(e.tipo).toBe('al_dia_sin_novedad');
    const t = textoDe(e, AHORA);
    expect(t).toContain('184 documentos');
    expect(t).toContain('hace 6 días');
    expect(t, 'no dijo que se revisó').toContain('hace 2 h');
    expect(t, 'la frase que distingue los dos silencios').toContain('sin novedad');
  });

  it('SIN registro de intentos ⇒ se dice que no se sabe, NO «al día»', () => {
    // Es la mitad que evita afirmar sin medición: decir «al día» sin haber
    // mirado nunca es exactamente lo que la regla #1 prohíbe.
    const e = estadoDe(datos({ ultimoIntento: null, ultimoResultado: null }));
    expect(e.tipo).toBe('sin_registro_de_intentos');
    const t = textoDe(e, AHORA);
    expect(t).toContain('No hay registro');
    expect(t, 'dijo «sin novedad» sin tener con qué saberlo').not.toContain('sin novedad');
  });

  it('las dos frases son DISTINTAS: si se colapsan, esto se pone rojo', () => {
    // El invariante entero, en una línea. Un refactor que unifique los textos
    // pasa las dos pruebas de arriba por separado y muere aquí.
    const conIntento = textoDe(estadoDe(datos()), AHORA);
    const sinIntento = textoDe(estadoDe(datos({ ultimoIntento: null, ultimoResultado: null })), AHORA);
    expect(conIntento).not.toBe(sinIntento);
  });
});

describe('[INV-B11] una guarda que se disparó NO se lee como un sistema al día', () => {
  it('`detenido` gana sobre las fechas, que se ven sanas', () => {
    // EL ORDEN ES LA DECISIÓN. Una corrida detenida por la guarda de borrado
    // masivo dejó el corpus como estaba, así que `ultimoCambio` se ve
    // perfectamente normal. Si el estado se decidiera por las fechas, **una
    // defensa que se disparó se leería como todo en orden**.
    const e = estadoDe(datos({ ultimoResultado: 'detenido', motivo: 'el manifiesto llegó vacío con 184 en el índice' }));
    expect(e.tipo).toBe('detenido');
    const t = textoDe(e, AHORA);
    expect(t).toContain('DETUVO');
    expect(t).toContain('manifiesto');
    expect(t, 'no dijo que los documentos siguen siendo los de antes').toContain('184');
    expect(pideAtencion(e)).toBe(true);
  });

  it('`error` también gana, y no se disfraza de «detenido»', () => {
    const e = estadoDe(datos({ ultimoResultado: 'error', motivo: 'no se pudo leer el árbol' }));
    expect(e.tipo).toBe('error');
    expect(textoDe(e, AHORA)).toContain('falló');
    expect(textoDe(e, AHORA), 'un error se leyó como una guarda haciendo su trabajo').not.toContain('DETUVO');
  });

  it('CONTROL POSITIVO · una corrida sana NO pide atención', () => {
    // Sin esto, un `pideAtencion` que devolviera `true` siempre pondría en
    // verde las dos de arriba y pintaría de alarma un sistema sano.
    expect(pideAtencion(estadoDe(datos()))).toBe(false);
    expect(pideAtencion(estadoDe(datos({ ultimoIntento: null, ultimoResultado: null })))).toBe(false);
  });
});

describe('[INV-B11] el corpus vacío no es un corpus viejo', () => {
  it('sin documentos se dice que no hay, no que está desactualizado', () => {
    const e = estadoDe(datos({ documentos: 0, ultimoCambio: null }));
    expect(e.tipo).toBe('vacio');
    expect(textoDe(e, AHORA)).toBe('Todavía no hay documentación indexada.');
    // Pide atención: un corpus vacío es un pendiente nuestro, no un estado.
    expect(pideAtencion(e)).toBe(true);
  });
});

describe('[INV-B11] `haceCuanto`', () => {
  it('escala de minutos a días sin decimales', () => {
    expect(haceCuanto(hace(0.001), AHORA)).toBe('hace un momento');
    expect(haceCuanto(hace(0.5), AHORA)).toBe('hace 30 min');
    expect(haceCuanto(hace(5), AHORA)).toBe('hace 5 h');
    expect(haceCuanto(hace(24), AHORA)).toBe('hace 1 día');
    expect(haceCuanto(hace(144), AHORA)).toBe('hace 6 días');
  });

  it('un instante FUTURO no dice «hace -3 h»', () => {
    // Pasa de verdad: los relojes del servidor y del navegador no coinciden, y
    // un «hace -3 h» en pantalla se lee como que el sistema está roto.
    expect(haceCuanto(new Date(AHORA.getTime() + 3_600_000).toISOString(), AHORA)).toBe('hace un momento');
  });

  it('una fecha ilegible no lanza', () => {
    expect(haceCuanto('no es una fecha', AHORA)).toBe('hace un momento');
  });
});
