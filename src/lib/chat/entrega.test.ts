// ============================================================
// [CHAT-B1] Lo que estas pruebas cuidan es el PERÍMETRO, y el perímetro tiene
// un hecho medido: **una parte del corpus no es documentación de producto**, y
// una porción de ella son datos de cuentas (`10_Cuentas`). La decisión firmada
// de INV-B10 (ver `docs/decisions/0009-grounded-assistant-persona-contract.md`)
// dice que eso no sale hacia un tercero.
//
// La marca nominal de `Entrega` NO se prueba aquí y no es un olvido: se prueba
// en `tsc`. Un objeto literal con la forma de `Entrega` **no compila**, así que
// una prueba en tiempo de ejecución no podría ni escribirla.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  armarEntrega,
  dentroDelPerimetro,
  seccionesOmitidas,
  textoDeTrozo,
  PRESUPUESTO_ENTREGA_BYTES,
} from './entrega';

const trozo = (orden: number, texto: string, seccion = `S${orden}`) => ({
  orden,
  rutaSeccion: seccion,
  texto,
});

const base = {
  ruta: '20_Seguridad/Antena-EAS-Series11.md',
  familia: 'SERIES11 FLOOR',
  titulo: 'Antena EAS Series11',
  fuentePdf: 'series11.pdf',
};

describe('[CHAT-B1] el perímetro', () => {
  it('deja pasar la carpeta de documentación de producto', () => {
    expect(dentroDelPerimetro('20_Seguridad/x.md')).toBe(true);
  });

  it('RECHAZA `10_Cuentas` — los trozos que la decisión de producto deja fuera', () => {
    expect(dentroDelPerimetro('10_Cuentas/Cliente-ACME.md')).toBe(false);
  });

  it('rechaza también `00_Indice` y `80_Registro`', () => {
    expect(dentroDelPerimetro('00_Indice/mapa.md')).toBe(false);
    expect(dentroDelPerimetro('80_Registro/ADR-001.md')).toBe(false);
  });

  it('es LISTA BLANCA: una carpeta nueva del vault nace FUERA', () => {
    expect(dentroDelPerimetro('90_Carpeta-Que-No-Existia/x.md')).toBe(false);
  });

  it('no se cuela por un prefijo parecido', () => {
    expect(dentroDelPerimetro('20_Seguridad-Privado/x.md')).toBe(false);
  });

  it('armarEntrega DEVUELVE EL CASO, no un null mudo: se puede contar', () => {
    const r = armarEntrega({ ...base, ruta: '10_Cuentas/ACME.md', trozos: [trozo(0, 'hola')] });
    expect(r.tipo).toBe('fuera_del_perimetro');
  });
});

describe('[CHAT-B1] `camino` se DERIVA, no se declara', () => {
  it('completo cuando viajan todos los trozos del documento', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'a'), trozo(1, 'b')], trozosTotales: 2 });
    expect(r.tipo).toBe('entrega');
    if (r.tipo !== 'entrega') return;
    expect(r.entrega.camino).toBe('completo');
    expect(seccionesOmitidas(r.entrega)).toBe(0);
  });

  it('parcial cuando el documento tiene más de los que viajan', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'a')], trozosTotales: 25 });
    expect(r.tipo).toBe('entrega');
    if (r.tipo !== 'entrega') return;
    expect(r.entrega.camino).toBe('parcial');
    expect(seccionesOmitidas(r.entrega)).toBe(24);
  });

  it('`trozosTotales` nunca queda por debajo de lo que entra: `camino` no miente al revés', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'a'), trozo(1, 'b')], trozosTotales: 1 });
    if (r.tipo !== 'entrega') throw new Error('debía entregar');
    expect(r.entrega.trozosTotales).toBe(2);
    expect(r.entrega.camino).toBe('completo');
  });
});

describe('[CHAT-B1] el presupuesto', () => {
  it('el documento de UN trozo más grande medido cabe entero', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'x'.repeat(6_075))], trozosTotales: 1 });
    if (r.tipo !== 'entrega') throw new Error('debía entregar');
    expect(r.entrega.camino).toBe('completo');
    expect(r.entrega.bytes).toBe(6_075);
  });

  it('un trozo que NO cabe se omite ENTERO: no se parte a media tabla', () => {
    const r = armarEntrega({
      ...base,
      trozos: [trozo(0, 'a'.repeat(100)), trozo(1, 'b'.repeat(PRESUPUESTO_ENTREGA_BYTES))],
      trozosTotales: 2,
    });
    if (r.tipo !== 'entrega') throw new Error('debía entregar');
    expect(r.entrega.trozos).toHaveLength(1);
    expect(r.entrega.trozos[0].texto).toHaveLength(100);
    expect(r.entrega.camino).toBe('parcial');
  });

  it('si NI UNO cabe, no entrega un documento vacío con aire de completo', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'z'.repeat(99_999))], trozosTotales: 1 });
    expect(r.tipo).toBe('sin_texto');
  });

  it('cuenta bytes UTF-8, no caracteres: los acentos pesan', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, 'ñ')], trozosTotales: 1 });
    if (r.tipo !== 'entrega') throw new Error('debía entregar');
    expect(r.entrega.bytes).toBe(2);
  });
});

describe('[CHAT-B1] trozos sin texto', () => {
  it('un documento con trozos vacíos es `sin_texto`, no una entrega en blanco', () => {
    const r = armarEntrega({ ...base, trozos: [trozo(0, '   ')], trozosTotales: 1 });
    expect(r.tipo).toBe('sin_texto');
  });
});

describe('[CHAT-B1] textoDeTrozo', () => {
  it('rotula con el orden entre corchetes: es el ancla que el modelo va a citar', () => {
    expect(textoDeTrozo(trozo(3, 'contenido', 'Specs/Peso'))).toBe('[3] Specs/Peso\ncontenido');
  });
});
