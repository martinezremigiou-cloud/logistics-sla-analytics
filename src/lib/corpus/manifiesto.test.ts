// ============================================================
// [INV-B11] El diff del manifiesto — y sobre todo, las BAJAS.
//
// La mitad de este archivo prueba que las bajas se detectan. La otra mitad
// prueba que **NO se aplican cuando el manifiesto huele a roto**, que es la
// parte que un indexador normal no tiene y que aquí puede borrar el corpus.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  diffManifiesto,
  esBorradoMasivo,
  fraccionBorrada,
  resumirDiff,
  UMBRAL_BORRADO_MASIVO,
  type EntradaManifiesto,
} from './manifiesto';

const e = (ruta: string, hash: string): EntradaManifiesto => ({ ruta, hash });

const INDICE: EntradaManifiesto[] = [
  e('20_Seguridad/Series2.md', 'aaa'),
  e('20_Seguridad/Clips.md', 'bbb'),
  e('20_Seguridad/Boton-Asistencia.md', 'ccc'),
];

describe('[INV-B11] diffManifiesto · los tres movimientos', () => {
  it('lo que no estaba es ALTA', () => {
    const d = diffManifiesto([...INDICE, e('nueva.md', 'ddd')], INDICE);
    expect(d.altas).toEqual([e('nueva.md', 'ddd')]);
    expect(d.cambios).toHaveLength(0);
    expect(d.bajas).toHaveLength(0);
  });

  it('mismo nombre y otro hash es CAMBIO, no alta+baja', () => {
    const d = diffManifiesto(
      [e('20_Seguridad/Series2.md', 'ZZZ'), INDICE[1]!, INDICE[2]!],
      INDICE,
    );
    expect(d.cambios).toEqual([
      { ruta: '20_Seguridad/Series2.md', hashViejo: 'aaa', hashNuevo: 'ZZZ' },
    ]);
    expect(d.altas).toHaveLength(0);
    expect(d.bajas).toHaveLength(0);
  });

  // ============================================================
  // ★ LA PRUEBA QUE JUSTIFICA EL ARCHIVO. Nadie avisa de una baja: el archivo
  // simplemente deja de aparecer. Sin esto el índice sigue contestando desde un
  // documento que ya no existe, y **nada se pone rojo**.
  // ============================================================
  it('lo que estaba y ya no viene es BAJA — la ausencia ES la señal', () => {
    const d = diffManifiesto([INDICE[0]!, INDICE[2]!], INDICE);
    expect(d.bajas).toEqual([e('20_Seguridad/Clips.md', 'bbb')]);
    expect(d.altas).toHaveLength(0);
    expect(d.cambios).toHaveLength(0);
  });

  it('un archivo movido de carpeta es baja + alta, y está bien que lo sea', () => {
    // La ruta ES la identidad. Adivinar que «es el mismo, movido» exigiría
    // comparar contenidos y acertar; equivocarse deja dos copias o pierde una.
    const d = diffManifiesto(
      [e('otra/Series2.md', 'aaa'), INDICE[1]!, INDICE[2]!],
      INDICE,
    );
    expect(d.altas).toEqual([e('otra/Series2.md', 'aaa')]);
    expect(d.bajas).toEqual([e('20_Seguridad/Series2.md', 'aaa')]);
  });

  it('sin cambios: todo cae en `sinCambio` y los tres movimientos van vacíos', () => {
    const d = diffManifiesto(INDICE, INDICE);
    expect(d.sinCambio).toBe(3);
    expect(d.altas.length + d.cambios.length + d.bajas.length).toBe(0);
  });

  it('un índice vacío convierte todo el manifiesto en altas — la primera corrida', () => {
    const d = diffManifiesto(INDICE, []);
    expect(d.altas).toHaveLength(3);
    expect(d.bajas).toHaveLength(0);
  });

  it('el orden de salida es estable, para que dos corridas se puedan comparar', () => {
    const desordenado = [...INDICE].reverse();
    expect(diffManifiesto([], desordenado).bajas.map((b) => b.ruta)).toEqual(
      diffManifiesto([], INDICE).bajas.map((b) => b.ruta),
    );
  });
});

describe('[INV-B11] esBorradoMasivo · el manifiesto truncado NO borra el corpus', () => {
  // ============================================================
  // «Lo que no está, se borra» es correcto Y peligroso: un manifiesto a medias
  // borra el índice. Y a medias no es hipotético — es lo que devuelve un token
  // vencido, un `catch` mudo o una respuesta cortada.
  //
  // Es B10-3 con las consecuencias al revés: allí no pasaba nada y parecía que
  // sí; aquí pasa todo y parece normal.
  // ============================================================
  it('un manifiesto VACÍO con índice lleno se detiene SIEMPRE, aunque el umbral no aplicara', () => {
    const d = diffManifiesto([], INDICE);
    const v = esBorradoMasivo(d, INDICE.length, true);
    expect(v.masivo).toBe(true);
    expect(v.motivo).toContain('lectura fallida');
  });

  it('borrar más del umbral se detiene y DICE cuánto', () => {
    const d = diffManifiesto([INDICE[0]!], INDICE); // borra 2 de 3 = 66 %
    const v = esBorradoMasivo(d, INDICE.length, false);
    expect(v.masivo).toBe(true);
    expect(v.fraccion).toBeCloseTo(2 / 3, 5);
    expect(v.motivo).toContain('66.7 %');
  });

  // El control positivo. Sin él, un `esBorradoMasivo` que devolviera `true`
  // siempre pondría verdes las dos de arriba y **la sync nunca borraría nada**
  // — el corpus quedaría creciendo para siempre y en silencio (P19).
  it('control positivo · una baja normal SÍ pasa: el corpus borra información vieja a diario', () => {
    const d = diffManifiesto([INDICE[0]!, INDICE[1]!], INDICE); // 1 de 3 = 33 %...
    const v = esBorradoMasivo(d, INDICE.length, false, 0.5);
    expect(v.masivo).toBe(false);
    expect(v.motivo).toBe('');
  });

  it('un índice VACÍO no puede sufrir borrado masivo: no hay nada que perder', () => {
    const v = esBorradoMasivo(diffManifiesto([], []), 0, true);
    expect(v.masivo).toBe(false);
    expect(fraccionBorrada(diffManifiesto([], []), 0)).toBe(0);
  });

  it('el umbral es un PARÁMETRO, no una constante escondida', () => {
    const d = diffManifiesto([INDICE[0]!, INDICE[1]!], INDICE); // 33 %
    expect(esBorradoMasivo(d, INDICE.length, false, 0.5).masivo).toBe(false);
    expect(esBorradoMasivo(d, INDICE.length, false, 0.1).masivo).toBe(true);
    expect(UMBRAL_BORRADO_MASIVO).toBe(0.3);
  });
});

describe('[INV-B11] resumirDiff', () => {
  it('la línea del registro lleva los CUATRO números, no solo lo que cambió', () => {
    const d = diffManifiesto([INDICE[0]!, e('nueva.md', 'x'), e(INDICE[1]!.ruta, 'OTRO')], INDICE);
    const linea = resumirDiff(d);
    expect(linea).toContain('1 altas');
    expect(linea).toContain('1 cambios');
    expect(linea).toContain('1 bajas');
    expect(linea).toContain('1 sin cambio');
  });
});
