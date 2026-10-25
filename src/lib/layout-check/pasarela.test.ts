// ============================================================
// [2.0.1-B · S · AB-5] EL CONTROL POSITIVO DE LA RAMA DE LA PASARELA.
//
// Va aquí y no «cuando haya pasarela» por la condición acordada: el
// mecanismo aterrizó antes que su sujeto, así que su control positivo tiene que
// aterrizar con la declaración — no depender de que alguien se acuerde.
//
// Lo que estas pruebas SÍ demuestran: que la decisión de medir o no medir cae
// del lado correcto en los tres estados posibles, y que **el verde hay que
// ganárselo**.
//
// Lo que NO demuestran, dicho una vez: que el arnés lea bien la página. Que
// `hayControl` valga lo que debe valer solo lo puede decir una corrida en
// navegador sobre una ruta con pasarela de verdad.
//
// [S-1] `RUTAS_CON_PASARELA` YA NO ESTÁ VACÍA (`/proyectos`), y el gate ya corrió
// con ella: **EXIT=0 · todos los casos medidos · 0 sin medir**, con los cuatro
// casos de `pasarela-avanzada` (768 · 1280 · 1536 · 1704) medidos de verdad. Un
// `EXIT=0` posterior a esa declaración SÍ dice algo sobre la pasarela.
//
// Lo que sigue valiendo es la fecha: una corrida ANTERIOR a la declaración no la
// midió porque el caso no existía, y citarla sería evidencia de otra cosa.
//
// La mitad que ninguna prueba de este archivo puede cubrir —si el control se
// puede pulsar, que es geometría— sigue siendo del navegador; la que sí, está en
// `rutas-con-pasarela.test.tsx`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { decidirPasarela, ATRIBUTO_AVANZAR } from './pasarela';

describe('[2.0.1-B · AB-5] una pasarela declarada que no se puede desplazar NO sale verde', () => {
  it('sin control visible → SIN MEDIR, y el motivo acusa la declaración', () => {
    const d = decidirPasarela({ hayControl: false, deshabilitado: false });
    expect(d.medir).toBe(false);
    // El motivo tiene que señalar la DECLARACIÓN, no la pantalla: el caso solo
    // existe porque alguien puso la ruta en `RUTAS_CON_PASARELA`.
    expect(d.motivo).toContain('RUTAS_CON_PASARELA');
    expect(d.motivo).toContain(ATRIBUTO_AVANZAR);
  });

  it('con el control deshabilitado → SIN MEDIR, y por su propia razón', () => {
    const d = decidirPasarela({ hayControl: true, deshabilitado: true });
    expect(d.medir).toBe(false);
    expect(d.motivo).toContain('deshabilitado');
    // No comparte motivo con el caso de arriba: son dos fallos distintos y el
    // log tiene que poder distinguirlos.
    expect(d.motivo).not.toContain('no se encontró');
  });

  it('con control presente y pulsable → se mide, y sin motivo', () => {
    const d = decidirPasarela({ hayControl: true, deshabilitado: false });
    expect(d.medir).toBe(true);
    expect(d.motivo).toBeNull();
  });

  it('control positivo · NINGUNA entrada devuelve «medir» por omisión', () => {
    // El troceador que no troceaba, en su forma más peligrosa: una decisión que
    // devolviera siempre `medir: true` pasaría las dos primeras pruebas si
    // éstas solo miraran el motivo. Se barre el espacio COMPLETO —cuatro
    // combinaciones— y se exige que exactamente una mida.
    const todas = [
      { hayControl: false, deshabilitado: false },
      { hayControl: false, deshabilitado: true },
      { hayControl: true, deshabilitado: true },
      { hayControl: true, deshabilitado: false },
    ];
    const miden = todas.filter((e) => decidirPasarela(e).medir);
    expect(miden).toEqual([{ hayControl: true, deshabilitado: false }]);
    // Y toda la que no mide trae motivo: un SIN MEDIR mudo no sirve de nada.
    for (const e of todas) {
      const d = decidirPasarela(e);
      if (!d.medir) expect(d.motivo, JSON.stringify(e)).toBeTruthy();
    }
  });
});
