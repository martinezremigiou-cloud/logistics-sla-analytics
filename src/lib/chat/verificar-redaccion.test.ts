// ============================================================
// [CHAT-B1] La prueba que justifica el diseño entero es
// «EL DATO CORRECTO DE LA SECCIÓN EQUIVOCADA».
//
// Contra «el número aparece en algún sitio del documento» esa respuesta sale
// LIMPIA — y es el error más probable de un modelo que lee una ficha con
// secciones parecidas. Es lo que obliga a que el modelo devuelva frases con su
// CITA en vez de prosa, y lo que hace que esta guarda compruebe lo que dice
// comprobar en vez de dar permiso para cerrar (P25).
//
// El ancla es una CITA COPIADA y no un rango de índices, y eso se decidió
// MIDIENDO: con índices, `deepseek-flash` quemaba 4 000 tokens de razonamiento y
// devolvía contenido vacío. Con la cita, todas. Y de paso el ancla quedó más
// fuerte: una subcadena o está literalmente o no está — el off-by-one de un
// rango deja de ser expresable.
// ============================================================
import { describe, it, expect } from 'vitest';
import { armarEntrega, type Entrega } from './entrega';
import {
  verificarRedaccion,
  datosDurosDe,
  normalizarDato,
  seccionesQueSiTrae,
  type SalidaRedactor,
} from './verificar-redaccion';

const entregaDe = (textos: string[], extra: Partial<{ familia: string; titulo: string }> = {}): Entrega => {
  const r = armarEntrega({
    ruta: '20_Seguridad/ficha.md',
    familia: extra.familia ?? 'SERIES11 FLOOR',
    titulo: extra.titulo ?? 'Antena Series11',
    fuentePdf: null,
    trozos: textos.map((t, i) => ({ orden: i, rutaSeccion: `S${i}`, texto: t })),
    trozosTotales: textos.length,
  });
  if (r.tipo !== 'entrega') throw new Error('el fixture tiene que entregar: ' + r.tipo);
  return r.entrega;
};

const respuesta = (frases: { texto: string; orden: number; cita: string }[]): SalidaRedactor => ({
  tipo: 'respuesta',
  frases,
});

describe('[CHAT-B1] EL CASO QUE JUSTIFICA EL ANCLAJE', () => {
  const e = entregaDe(['Montaje: requiere 4 tornillos.', 'Peso del equipo: 3.2 kg.']);

  it('el dato correcto de la sección EQUIVOCADA sale SUCIA', () => {
    // «3.2» SÍ está en el documento —en el trozo 1— pero la frase cita el 0.
    const v = verificarRedaccion(
      e,
      respuesta([{ texto: 'Pesa 3.2 kg.', orden: 0, cita: 'Montaje: requiere 4 tornillos.' }]),
    );
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos[0]).toMatchObject({ clase: 'dato_no_anclado', dato: '3.2' });
  });

  it('el MISMO dato citando SU sección sale limpia', () => {
    const v = verificarRedaccion(
      e,
      respuesta([{ texto: 'Pesa 3.2 kg.', orden: 1, cita: 'Peso del equipo: 3.2 kg.' }]),
    );
    expect(v.tipo).toBe('limpia');
    if (v.tipo !== 'limpia') return;
    expect(v.datosComprobados).toBe(1);
  });

  it('citar dos palabras para escaparse no es una escapatoria', () => {
    const v = verificarRedaccion(e, respuesta([{ texto: 'Pesa 3.2 kg.', orden: 1, cita: 'Peso del' }]));
    expect(v.tipo).toBe('sucia');
  });
});

describe('[CHAT-B1] la cita tiene que ser LITERAL', () => {
  const e = entregaDe(['Peso del equipo: 3.2 kg.']);

  it('una cita PARAFRASEADA no pasa, aunque diga lo mismo', () => {
    const v = verificarRedaccion(e, respuesta([{ texto: 'Pesa 3.2 kg.', orden: 0, cita: 'El peso es de 3.2 kg' }]));
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos[0].clase).toBe('cita_inventada');
  });

  it('una cita vacía no pasa', () => {
    const v = verificarRedaccion(e, respuesta([{ texto: 'x', orden: 0, cita: '   ' }]));
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos[0].clase).toBe('cita_inventada');
  });

  it('un `orden` EQUIVOCADO con la cita exacta SÍ pasa — la cita es la evidencia', () => {
    // Medido el 21-sep contra la API real: `deepseek-flash` devolvió `orden: 1`
    // sobre una sección rotulada `[0]`. Si el número tuviera que casar, esa
    // respuesta —con su cita exacta y su dato correcto— se habría rechazado.
    // Exigir las dos cosas añade falsos rechazos y no añade ninguna garantía:
    // lo que no se puede fingir es que la cita esté literalmente en lo entregado.
    const v = verificarRedaccion(e, respuesta([{ texto: 'Pesa 3.2 kg.', orden: 77, cita: 'Peso del equipo: 3.2 kg.' }]));
    expect(v.tipo).toBe('limpia');
  });

  it('pero una cita que no está en NADA de lo entregado sigue sin pasar', () => {
    const v = verificarRedaccion(e, respuesta([{ texto: 'x', orden: 0, cita: 'ESTO NO ESTA EN NINGUN TROZO' }]));
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos[0].clase).toBe('cita_inventada');
  });

  it('y el dato sigue teniendo que estar EN SU CITA, aunque el orden sea otro', () => {
    const dos = entregaDe(['Montaje: 4 tornillos.', 'Peso: 3.2 kg.']);
    const v = verificarRedaccion(dos, respuesta([{ texto: 'Pesa 3.2 kg.', orden: 1, cita: 'Montaje: 4 tornillos.' }]));
    expect(v.tipo).toBe('sucia');
  });

  it('una subcadena EXACTA sí pasa, aunque sea del medio del trozo', () => {
    const v = verificarRedaccion(e, respuesta([{ texto: 'Pesa 3.2 kg.', orden: 0, cita: 'equipo: 3.2 kg' }]));
    expect(v.tipo).toBe('limpia');
  });
});

describe('[CHAT-B1] el dato inventado', () => {
  it('un número que no está en ningún sitio sale SUCIA', () => {
    const e = entregaDe(['Peso: 3.2 kg.']);
    const v = verificarRedaccion(e, respuesta([{ texto: 'Pesa 987654 kg.', orden: 0, cita: 'Peso: 3.2 kg.' }]));
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos.some((m) => m.clase === 'dato_no_anclado' && m.dato === '987654')).toBe(true);
  });

  it('UNA sola frase sucia ensucia la respuesta ENTERA', () => {
    const e = entregaDe(['Peso: 3.2 kg.']);
    const v = verificarRedaccion(
      e,
      respuesta([
        { texto: 'Pesa 3.2 kg.', orden: 0, cita: 'Peso: 3.2 kg.' },
        { texto: 'Mide 99 cm.', orden: 0, cita: 'Peso: 3.2 kg.' },
      ]),
    );
    expect(v.tipo).toBe('sucia');
  });
});

describe('[CHAT-B1] la normalización es es-MX, no es-ES', () => {
  it('la COMA es separador de millar: «2,376» y «2376» son el MISMO dato', () => {
    expect(normalizarDato('2,376')).toBe('2376');
  });

  it('el PUNTO es decimal y NO se toca: «2.376» NO es 2376', () => {
    expect(normalizarDato('2.376')).toBe('2.376');
    expect(normalizarDato('2.376')).not.toBe(normalizarDato('2,376'));
  });

  it('el trozo con formato es-MX casa con el modelo que escribe sin separador', () => {
    const e = entregaDe(['Capacidad: 2,376 piezas.']);
    const v = verificarRedaccion(
      e,
      respuesta([{ texto: 'Son 2376 piezas.', orden: 0, cita: 'Capacidad: 2,376 piezas.' }]),
    );
    expect(v.tipo).toBe('limpia');
  });

  it('y una invención de ×1000 NO se cuela por esa puerta', () => {
    const e = entregaDe(['Mide 2.376 metros.']);
    const v = verificarRedaccion(
      e,
      respuesta([{ texto: 'Mide 2376 metros.', orden: 0, cita: 'Mide 2.376 metros.' }]),
    );
    expect(v.tipo).toBe('sucia');
  });
});

describe('[CHAT-B1] qué cuenta como dato duro', () => {
  it('números, códigos con dígito y medidas', () => {
    expect(datosDurosDe('El PW03 pesa 3.2 kg')).toEqual(expect.arrayContaining(['PW03', '3.2']));
  });

  it('las palabras SIN dígitos no son datos duros — ahí vive el límite declarado', () => {
    expect(datosDurosDe('sirve para detectar etiquetas')).toEqual([]);
  });

  it('no distingue mayúsculas', () => {
    expect(normalizarDato('pw03')).toBe('PW03');
  });
});

describe('[CHAT-B1] el universo incluye la metadata que el prompt le enseñó', () => {
  it('nombrar la familia NO es inventar, aunque lleve dígitos', () => {
    const e = entregaDe(['Sirve para detectar.'], { familia: 'SERIES11 PW03' });
    const v = verificarRedaccion(
      e,
      respuesta([{ texto: 'El SERIES11 PW03 sirve para detectar.', orden: 0, cita: 'Sirve para detectar.' }]),
    );
    expect(v.tipo).toBe('limpia');
  });
});

describe('[CHAT-B1] `no_esta` y sus secciones', () => {
  it('«no está» es un veredicto propio, no un fallo', () => {
    const e = entregaDe(['x']);
    expect(verificarRedaccion(e, { tipo: 'no_esta' }).tipo).toBe('no_esta');
  });

  it('una respuesta SIN frases es sucia: no es lo mismo que decir que no está', () => {
    const e = entregaDe(['x']);
    const v = verificarRedaccion(e, { tipo: 'respuesta', frases: [] });
    expect(v.tipo).toBe('sucia');
    if (v.tipo !== 'sucia') return;
    expect(v.motivos[0].clase).toBe('sin_frases');
  });

  it('lo que SÍ trae la ficha lo escribe el SERVIDOR, desde los trozos entregados', () => {
    const e = entregaDe(['a', 'b']);
    expect(seccionesQueSiTrae(e)).toEqual(['S0', 'S1']);
  });
});
