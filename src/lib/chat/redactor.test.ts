// ============================================================
// [CHAT-B1] El falso existe para PONER CONTROLES EN ROJO, no para imitar a un
// modelo. Estas pruebas fijan que cada modo produce de verdad el veredicto que
// dice producir — una guarda cuyo control positivo no se puede ejercer es una
// guarda vacua, y esta casa ya contó seis ejemplares de P19.
// ============================================================
import { describe, it, expect } from 'vitest';
import { armarEntrega, type Entrega } from './entrega';
import { verificarRedaccion } from './verificar-redaccion';
import {
  redactorFalso,
  interpretarSalida,
  promptDeRedaccion,
  MAX_TOKENS_REDACCION,
  type RegistroFalso,
  type ModoFalso,
} from './redactor';

const entregaDe = (textos: string[], totales?: number): Entrega => {
  const r = armarEntrega({
    ruta: '20_Seguridad/ficha.md',
    familia: 'SERIES11 FLOOR',
    titulo: 'Antena Series11',
    fuentePdf: 'series11.pdf',
    trozos: textos.map((t, i) => ({ orden: i, rutaSeccion: `S${i}`, texto: t })),
    trozosTotales: totales ?? textos.length,
  });
  if (r.tipo !== 'entrega') throw new Error('el fixture tiene que entregar');
  return r.entrega;
};

const pedir = (e: Entrega) => ({ pregunta: '¿cuánto pesa?', entrega: e, hilo: [] });

describe('[CHAT-B1] interpretarSalida valida la FORMA, no el contenido', () => {
  it('acepta una respuesta bien formada', () => {
    const s = interpretarSalida({ tipo: 'respuesta', frases: [{ texto: 'x', orden: 0, cita: 'algo' }] });
    expect(s?.tipo).toBe('respuesta');
  });

  it('acepta `no_esta`', () => {
    expect(interpretarSalida({ tipo: 'no_esta' })?.tipo).toBe('no_esta');
  });

  it('un JSON con datos INVENTADOS es FORMALMENTE válido — separar las dos cosas es el punto', () => {
    const s = interpretarSalida({
      tipo: 'respuesta',
      frases: [{ texto: 'Pesa 999 kg', orden: 0, cita: 'algo' }],
    });
    expect(s).not.toBeNull();
  });

  it('devuelve null ante basura: texto suelto, forma ajena, ancla incompleta', () => {
    expect(interpretarSalida('no soy json')).toBeNull();
    expect(interpretarSalida({ tipo: 'otra_cosa' })).toBeNull();
    expect(interpretarSalida({ tipo: 'respuesta', frases: [{ texto: 'x', orden: 0 }] })).toBeNull();
  });
});

describe('[CHAT-B1] cada modo del falso produce SU veredicto', () => {
  const casos: { modo: ModoFalso; espera: string }[] = [
    { modo: 'fiel', espera: 'limpia' },
    { modo: 'no_esta', espera: 'no_esta' },
    { modo: 'dato_inventado', espera: 'sucia' },
    { modo: 'dato_de_otra_seccion', espera: 'sucia' },
    { modo: 'ancla_ajena', espera: 'sucia' },
    { modo: 'cita_inventada', espera: 'sucia' },
  ];

  for (const c of casos) {
    it(`«${c.modo}» ⇒ ${c.espera}`, async () => {
      const e = entregaDe(['Montaje: 4 tornillos.', 'Peso: 3.2 kg.']);
      const { crudo } = await redactorFalso(c.modo).redactar(pedir(e));
      const salida = interpretarSalida(crudo);
      expect(salida).not.toBeNull();
      expect(verificarRedaccion(e, salida!).tipo).toBe(c.espera);
    });
  }

  it('«ilegible» no pasa ni la forma', () => {
    return redactorFalso('ilegible')
      .redactar(pedir(entregaDe(['x'])))
      .then(({ crudo }) => expect(interpretarSalida(crudo)).toBeNull());
  });
});

describe('[CHAT-B1] el falso REGISTRA lo que cruzó el perímetro', () => {
  it('una prueba puede afirmar QUÉ recibió el modelo, que es el gate de fondo', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    const e = entregaDe(['Peso: 3.2 kg.']);
    await redactorFalso('fiel', { registro }).redactar(pedir(e));

    expect(registro.peticiones).toHaveLength(1);
    expect(registro.peticiones[0].entrega.ruta).toBe('20_Seguridad/ficha.md');
    expect(registro.peticiones[0].entrega.trozos.map((t) => t.texto)).toEqual(['Peso: 3.2 kg.']);
  });
});

describe('[CHAT-B1] el prompt', () => {
  it('con camino completo DICE que no falta ninguna sección', () => {
    const p = promptDeRedaccion(entregaDe(['a', 'b']));
    expect(p).toContain('No falta ninguna');
    expect(p).not.toContain('NO viste');
  });

  it('con camino parcial DICE cuántas no vio — es el gate 2.4 dentro del prompt', () => {
    const p = promptDeRedaccion(entregaDe(['a'], 25));
    expect(p).toContain('te entrego 1 de 25 secciones');
    expect(p).toContain('24 que NO viste');
  });

  it('en camino parcial, el «no está» apunta a las secciones consultadas, no al documento', () => {
    expect(promptDeRedaccion(entregaDe(['a'], 25))).toContain('secciones sin consultar');
  });

  it('rotula cada sección con su orden: es el ancla que el modelo va a citar', () => {
    expect(promptDeRedaccion(entregaDe(['contenido']))).toContain('[0] S0\ncontenido');
  });

  it('le prohíbe enumerar y escribir cifras en letra: las dos muerden la contención', () => {
    const p = promptDeRedaccion(entregaDe(['a']));
    expect(p).toContain('No enumeres');
    expect(p).toContain('cifras en letra');
  });

  it('el techo de salida existe — no había NINGUNO en el repo antes de este bloque', () => {
    expect(MAX_TOKENS_REDACCION).toBeGreaterThan(0);
  });
});
