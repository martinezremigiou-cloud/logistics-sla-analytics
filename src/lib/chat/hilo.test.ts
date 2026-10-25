// ============================================================
// [CHAT-B1] Los dos techos miden cosas distintas, y estas pruebas lo fijan:
// seis turnos cortos pasan el de bytes y topan el de turnos; dos turnos largos
// pasan el de turnos y topan el de bytes. Con un solo techo, la mitad de los
// casos de abajo entraría sin que nada los parara.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  recortarHilo,
  hiloExcede,
  bytesDelHilo,
  textoDelHilo,
  TOPE_TURNOS_HILO,
  TOPE_BYTES_HILO,
  MAX_TURNO_HILO,
  type Turno,
} from './hilo';

const t = (texto: string, quien: Turno['quien'] = 'usuario'): Turno => ({ quien, texto });
const nTurnos = (n: number, texto = 'x') => Array.from({ length: n }, (_, i) => t(texto + i));

describe('[CHAT-B1] los DOS techos, y que hacen falta los dos', () => {
  it('seis turnos cortos pasan el de bytes y el séptimo topa el de TURNOS', () => {
    expect(hiloExcede(nTurnos(TOPE_TURNOS_HILO))).toBeNull();
    expect(hiloExcede(nTurnos(TOPE_TURNOS_HILO + 1))).toBe('turnos');
  });

  it('DOS turnos largos pasan el de turnos y topan el de BYTES', () => {
    // [CHAT-B3] Los dos CABEN por separado (1 100 < MAX_TURNO_HILO) y juntos no.
    // Antes esta prueba usaba turnos de 1 500, que desde B3 topan ANTES por el
    // techo nuevo — y entonces medía `turno_largo`, no `bytes`.
    const mitadLarga = Math.floor(TOPE_BYTES_HILO / 2) + 100; // cabe solo, no en par
    const largos = [t('a'.repeat(mitadLarga)), t('b'.repeat(mitadLarga))];
    expect(largos.length).toBeLessThanOrEqual(TOPE_TURNOS_HILO);
    expect(largos.every((x) => x.texto.length <= MAX_TURNO_HILO)).toBe(true);
    expect(hiloExcede(largos)).toBe('bytes');
  });

  it('[CHAT-B3] el TERCER techo: un turno que por sí solo se pasa', () => {
    // Faltaba, y su ausencia era el defecto: `hiloExcede` decía «no excede» sobre
    // un hilo que la ruta iba a rechazar. Dos topes del mismo hecho sin nada que
    // los comparara.
    expect(hiloExcede([t('z'.repeat(MAX_TURNO_HILO + 1))])).toBe('turno_largo');
    expect(hiloExcede([t('z'.repeat(MAX_TURNO_HILO))])).toBeNull();
  });

  it('dice CUÁL techo se pasó, no un booleano: «llegaste al tope» sin más manda a adivinar', () => {
    expect(hiloExcede(nTurnos(20))).toBe('turnos');
    expect(hiloExcede([t('z'.repeat(MAX_TURNO_HILO + 1))])).toBe('turno_largo');
    const m = Math.floor(TOPE_BYTES_HILO / 2) + 100;
    expect(hiloExcede([t('a'.repeat(m)), t('b'.repeat(m))])).toBe('bytes');
  });

  it('un hilo vacío no excede nada', () => {
    expect(hiloExcede([])).toBeNull();
  });
});

describe('[CHAT-B1] el recorte conserva LO RECIENTE', () => {
  it('se queda con los últimos turnos, no con los primeros', () => {
    const r = recortarHilo(nTurnos(10));
    expect(r).toHaveLength(TOPE_TURNOS_HILO);
    expect(r[r.length - 1].texto).toBe('x9');
    expect(r[0].texto).toBe('x4');
  });

  it('el recorte por bytes también conserva lo reciente', () => {
    // [CHAT-B3] Los dos turnos caben POR SEPARADO y no juntos, que es lo que
    // hace que el recorte por bytes muerda. Antes se usaba un turno de 2 000 que
    // desde B3 se RECORTA a 1 200 y entonces cabía — la prueba medía otra cosa.
    const m = Math.floor(TOPE_BYTES_HILO / 2) + 100;
    const r = recortarHilo([t('v'.repeat(m)), t('n'.repeat(m))]);
    expect(r).toHaveLength(1);
    expect(r[0].texto.startsWith('n')).toBe(true);
  });

  it('🔴 CAMBIO DE CONTRATO EN B3 · un turno largo se RECORTA, ya no se omite', () => {
    // En B1 un turno que se pasaba del techo se descartaba entero. Eso dejaba la
    // conversación sin contexto justo cuando el Asistente había contestado algo largo —y,
    // peor, la ruta lo rechazaba antes con un 400 del que no se salía.
    //
    // Desde B3 se recorta a `MAX_TURNO_HILO`. Recortar a media frase es correcto:
    // el hilo existe para que un pronombre tenga referente, no para releer la
    // respuesta, y el SUJETO viaja aparte en el `referente`.
    const r = recortarHilo([t('z'.repeat(9_000))]);
    expect(r).toHaveLength(1);
    expect(r[0].texto).toHaveLength(MAX_TURNO_HILO);
  });

  it('y lo recortado SIEMPRE pasa los tres techos', () => {
    expect(hiloExcede(recortarHilo([t('z'.repeat(9_000))]))).toBeNull();
    expect(hiloExcede(recortarHilo(nTurnos(50, 'palabra')))).toBeNull();
  });

  it('lo recortado SIEMPRE pasa los dos techos — el recorte no puede dejar algo inválido', () => {
    expect(hiloExcede(recortarHilo(nTurnos(50, 'palabra')))).toBeNull();
    expect(hiloExcede(recortarHilo([t('a'.repeat(5_000)), t('b'.repeat(5_000))]))).toBeNull();
  });

  it('bytes UTF-8, no caracteres', () => {
    expect(bytesDelHilo([t('ñ')])).toBe(2);
  });
});

describe('[CHAT-B1] el texto que va al prompt', () => {
  it('un hilo vacío no deja un rótulo huérfano', () => {
    expect(textoDelHilo([])).toBe('');
  });

  it('distingue quién dijo qué: sin eso un pronombre no tiene a qué apuntar', () => {
    const s = textoDelHilo([t('¿y la otra?'), t('La otra es la RF85.', 'asistente')]);
    expect(s).toContain('Preguntó: ¿y la otra?');
    expect(s).toContain('Contestaste: La otra es la RF85.');
  });
});
