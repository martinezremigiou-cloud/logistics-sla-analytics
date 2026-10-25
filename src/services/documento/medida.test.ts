// ============================================================
// [2.0.1-B · S-5] medida.test.ts — la política de corte, probada.
//
// `medida.ts` no tenía pruebas propias: se ejercitaba de refilón desde el
// render. Ahora sí las tiene, porque S-5 le cambió una regla y la regla anterior
// costó tres defectos. Un cambio así no se apoya en una prueba
// indirecta.
//
// No hace falta pdfkit: `MedidorDeTexto` pide dos métodos y el módulo se
// declaró así a propósito. El medidor de aquí es monoespaciado —un carácter,
// una unidad— lo que vuelve cada aserción aritmética en vez de aproximada.
// ============================================================
import { describe, it, expect } from 'vitest';
import { fragmentosDe, envolverAlAncho, recortarAlAncho, SEPARADORES_DE_CORTE, ELIPSIS, type MedidorDeTexto } from './medida';

/** Medidor monoespaciado: ancho = número de caracteres. Hace las cuentas exactas. */
const medidor: MedidorDeTexto = {
  widthOfString: (t) => t.length,
  currentLineHeight: () => 10,
};

describe('[2.0.1-B · S-5] fragmentosDe · se corta DESPUÉS del separador, nunca antes', () => {
  it('todo fragmento salvo el último TERMINA en un separador', () => {
    // ────────────────────────────────────────────────────────────
    // LA CONDICIÓN DE PRODUCTO, y su razón: partido ANTES, `DRX2263` y
    // `/D-KZ58-28-CCZ` se leen como DOS SKU distintos — y el primero parece un
    // identificador completo y válido, que es un defecto peor que el que esta
    // política arregla. Terminar en el separador es la señal de continuación.
    // ────────────────────────────────────────────────────────────
    const fragmentos = fragmentosDe('DRX2263/D-KZ58-28-CCZ');
    expect(fragmentos).toEqual(['DRX2263/', 'D-', 'KZ58-', '28-', 'CCZ']);

    for (const f of fragmentos.slice(0, -1)) {
      expect(SEPARADORES_DE_CORTE.includes(f[f.length - 1]), `el fragmento «${f}» no termina en separador`).toBe(true);
    }
    // Y la otra mitad de la misma regla: NINGUNO empieza por separador.
    for (const f of fragmentos) {
      expect(SEPARADORES_DE_CORTE.includes(f[0]), `el fragmento «${f}» empieza por separador: se cortó ANTES`).toBe(false);
    }
  });

  it('reconstruye el token exacto: partir no puede perder ni añadir un carácter', () => {
    // Lo que impide que esta política borre datos. Se prueba sobre los dos
    // tokens reales que mandan los pisos, más los casos de orilla.
    for (const token of [
      'DRX2263/D-KZ58-28-CCZ',
      '3.2(O3),91.3(O0,3)HEYK,HBOCtNPK',
      'DK288-X-A/DKM37-B14',
      'SINSEPARADORES',
      '-',
      'termina-',
      '',
    ]) {
      expect(fragmentosDe(token).join(''), `«${token}» no se reconstruye`).toBe(token || token);
    }
  });

  it('un token SIN separadores vuelve entero — no se inventa un corte', () => {
    expect(fragmentosDe('DISPONIBLE')).toEqual(['DISPONIBLE']);
    expect(fragmentosDe('RESERVADO')).toEqual(['RESERVADO']);
  });

  it('el juego de separadores es el MÍNIMO SUFICIENTE, medido y no elegido a gusto', () => {
    // `;` y `.` no entran: sobre el fixture no ahorran un punto y en cambio
    // parten `9.7(G6)` en `9.` + `7(G6),`, que se lee peor. Un separador que no
    // ahorra nada solo empeora la lectura. Se afirma para que agregarlo tenga
    // que ser una decisión y no un descuido.
    expect(SEPARADORES_DE_CORTE).toBe('/-,');
    expect(fragmentosDe('9.7(G6),10.2')).toEqual(['9.7(G6),', '10.2']);
  });
});

describe('[2.0.1-B · S-5] envolverAlAncho prefiere el corte del texto al corte a ciegas', () => {
  it('parte por el separador antes que por carácter', () => {
    // 10 de ancho: `DRX2263/D-KZ58-28-CCZ` (21) no cabe. Antes se cortaba en el
    // carácter 10 (`DRX2263/D-`, que por casualidad termina en separador, y
    // luego `KZ58-28-CC` + `Z`, que NO). Ahora los cortes caen donde el texto
    // los ofrece.
    const lineas = envolverAlAncho(medidor, 'DRX2263/D-KZ58-28-CCZ', 10, 5);
    expect(lineas.join('')).toBe('DRX2263/D-KZ58-28-CCZ');
    for (const l of lineas.slice(0, -1)) {
      expect(SEPARADORES_DE_CORTE.includes(l[l.length - 1]), `la línea «${l}» no termina en separador`).toBe(true);
    }
  });

  it('y CAE al corte por carácter cuando ni un fragmento cabe — no desborda nunca', () => {
    // La red que ya existía sigue puesta. `KZ58-` mide 5; con ancho 3 ningún
    // fragmento entra, así que se corta por carácter en vez de desbordar. El
    // orden importa: primero lo bueno, después lo que salva.
    const lineas = envolverAlAncho(medidor, 'DRX2263/D-KZ58-28-CCZ', 3, 20);
    expect(lineas.every((l) => l.length <= 3)).toBe(true);
    expect(lineas.join('')).toBe('DRX2263/D-KZ58-28-CCZ');
  });

  it('una PALABRA del idioma sigue sin partirse cuando cabe — la regla de corte por palabra no se tocó', () => {
    // El invariante que costó tres defectos: «RESERVADO» no se parte si cabe.
    // Y tampoco se parte por puntuación, porque no tiene.
    expect(envolverAlAncho(medidor, 'RESERVADO', 12, 3)).toEqual(['RESERVADO']);
    expect(envolverAlAncho(medidor, 'RESERVADO DISPONIBLE', 12, 3)).toEqual(['RESERVADO', 'DISPONIBLE']);
  });

  it('control positivo · el medidor de esta prueba mide de verdad', () => {
    // Sin esto, un medidor que devolviera siempre 0 haría que todo «quepa» y
    // las cuatro de arriba pasarían sin partir nada (P19).
    expect(medidor.widthOfString('abc')).toBe(3);
    expect(envolverAlAncho(medidor, 'aaaa bbbb', 4, 2)).toEqual(['aaaa', 'bbbb']);
    expect(recortarAlAncho(medidor, 'aaaaaa', 4)).toContain(ELIPSIS);
  });
});
