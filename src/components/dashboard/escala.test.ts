// ============================================================
// [DASH-D · D-1] escala.test.ts — que el dominio no se pueda volver a omitir.
//
// Las dos gráficas a mano del dashboard normalizan cada una por su cuenta, y
// las dos tienen el mismo defecto de fondo: **usan un MÁXIMO suelto en vez de
// un DOMINIO**, así que no pueden expresar dos casos que sí ocurren.
//
// LOS DOS MUTANTES QUE ESTA PRUEBA TIENE QUE MATAR, escritos antes de existir
// el módulo (si alguien los reintroduce, esto se pone rojo):
//
//   M1 · `const rango = max - min || 1`   (dashboard-tendencia.tsx:24)
//        Con una serie PLANA, `max - min` es 0, el `|| 1` mete un 1 falso, y
//        `(v - min) / 1` da 0 para todos los puntos → la línea entera se dibuja
//        contra el PISO. Una serie sin variación queda afirmando «éste es el
//        mínimo», que es una afirmación sobre el dato que el dato no hizo.
//
//   M2 · `Math.max(0.04, valor / maxPorEje[i])`   (dashboard-radar.tsx:86)
//        Un valor NEGATIVO da una fracción negativa y el `Math.max` lo sube al
//        piso; un CERO da 0 y el `Math.max` lo sube AL MISMO PISO. Negativo y
//        cero terminan en el mismo punto exacto del polígono. El signo del
//        escalar deja de existir en la geometría.
//
// EL ANTÍDOTO ES ESTRUCTURAL, no una corrección puntual (P25, el único que la
// casa reconoce como bueno): la firma **exige un `Dominio`**, así que no se
// puede escalar sin haber nombrado antes contra qué. Es la regla #3 de la casa
// —nombrar el denominador— puesta donde no se puede olvidar.
//
// LO QUE NO VE, dicho: que el SVG resultante se PINTE bien. Eso es geometría
// de navegador y ninguna prueba de jsdom puede verlo (`vitest.setup.ts:52`).
// Esto vigila la aritmética, que es lo que estaba mal.
// ============================================================
import { describe, it, expect } from 'vitest';
import { dominioDe, escalaLineal, escalaRadial } from './escala';

describe('dominioDe', () => {
  it('con una serie PLANA devuelve un dominio no degenerado (mata M1 en su origen)', () => {
    const d = dominioDe([24850, 24850, 24850]);

    expect(d.max).toBeGreaterThan(d.min);
  });

  it('con valores distintos toma el mínimo y el máximo reales', () => {
    expect(dominioDe([300, -50, 1200])).toEqual({ min: -50, max: 1200 });
  });

  it('`incluirCero` es EXPLÍCITO: quien no lo pide, no lo tiene', () => {
    expect(dominioDe([300, 1200])).toEqual({ min: 300, max: 1200 });
    expect(dominioDe([300, 1200], { incluirCero: true })).toEqual({ min: 0, max: 1200 });
  });
});

describe('escalaLineal', () => {
  it('mapea el mínimo del dominio a pxMin y el máximo a pxMax', () => {
    const y = escalaLineal({ min: 0, max: 100 }, 98, 12);

    expect(y(0)).toBe(98);
    expect(y(100)).toBe(12);
  });

  it('una serie PLANA cae al CENTRO, no al piso — M1', () => {
    // Con `max - min || 1`, los tres puntos dan (v-min)/1 = 0 y aterrizan en 98
    // (el piso del área dibujable). Una serie que no varía no está en su mínimo.
    const y = escalaLineal(dominioDe([24850, 24850, 24850]), 98, 12);

    expect(y(24850)).toBe(55);
  });
});

describe('escalaRadial', () => {
  it('un valor NEGATIVO y un CERO NO caen en el mismo radio — M2', () => {
    // Con `Math.max(0.04, v / max)` los dos se aplastan contra 0.04 y el
    // polígono dibuja lo mismo para «faltan 500 piezas» y «no hay ninguna».
    const t = escalaRadial({ min: -500, max: 1000 }, 0.04);

    expect(t(0)).toBeGreaterThan(t(-500));
  });

  it('el mínimo del dominio se dibuja en el piso visible, no en su fracción cruda', () => {
    // El dominio lleva un mínimo POSITIVO a propósito, y esa es toda la prueba.
    // La primera versión usaba `{min: -500}`, donde `Math.max(0.04, -0.5)` y la
    // fórmula correcta dan 0.04 LOS DOS: pasaba en verde con el mutante puesto.
    // Era P25 dentro de la prueba escrita para cazar P25 — un caso que no
    // separa las dos implementaciones no está probando ninguna.
    // Con `{min: 200, max: 1000}` el mutante devuelve su fracción cruda (0.2) y
    // la fórmula correcta devuelve el piso (0.04), porque 200 ES el mínimo.
    const t = escalaRadial({ min: 200, max: 1000 }, 0.04);

    expect(t(200)).toBe(0.04);
  });

  it('el máximo del dominio llega al borde exterior', () => {
    const t = escalaRadial({ min: 0, max: 1000 }, 0.04);

    expect(t(1000)).toBe(1);
  });
});
