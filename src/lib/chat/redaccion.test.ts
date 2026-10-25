// ============================================================
// [CHAT-B1] Lo que estas pruebas fijan, y que es lo que vuelve el bloque
// desplegable: **la redacción NUNCA tumba la respuesta base**. Hoy el usuario
// recibe la ficha entera; pase lo que pase aquí, la sigue recibiendo. Una mejora
// que puede romper lo que mejora no es una mejora.
//
// Y fijan que el REGISTRO se escribe en los siete estados, incluido el caro: una
// redacción que se pagó y se descartó deja su `uso` puesto. Dejarla en ceros
// habría hecho que el modo de fallo más caro fuera el único sin rastro en la
// factura.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { redactorFalso, type Redactor, type RegistroFalso } from './redactor';
import {
  redactar,
  registroVacio,
  respuestaDesde,
  mensajeNoEsta,
  MINIMO_PARA_INTENTAR_MS,
  type EstadoRedaccion,
} from './redaccion';
import { armarEntrega, type Entrega } from './entrega';
import { verificarRedaccion } from './verificar-redaccion';

const entrada = (over: Partial<Parameters<typeof redactar>[0]> = {}) => ({
  ruta: '20_Seguridad/ficha.md',
  familia: 'SERIES11 FLOOR',
  titulo: 'Antena Series11',
  fuentePdf: 'series11.pdf',
  trozos: [
    { orden: 0, rutaSeccion: 'Montaje', texto: 'Montaje: requiere 4 tornillos.' },
    { orden: 1, rutaSeccion: 'Peso', texto: 'Peso del equipo: 3.2 kg.' },
  ],
  trozosTotales: 2,
  ...over,
});

const pedido = (redactor: Redactor | null, over: Record<string, unknown> = {}) => ({
  redactor,
  pregunta: '¿cuánto pesa?',
  hilo: [],
  limite: null,
  registro: registroVacio(),
  ...over,
});

describe('[CHAT-B1] el estado queda registrado en los siete casos', () => {
  const casos: { modo: Parameters<typeof redactorFalso>[0]; estado: EstadoRedaccion; prosa: boolean }[] = [
    { modo: 'fiel', estado: 'limpia', prosa: true },
    { modo: 'no_esta', estado: 'no_esta', prosa: false },
    { modo: 'dato_inventado', estado: 'sucia', prosa: false },
    { modo: 'dato_de_otra_seccion', estado: 'sucia', prosa: false },
    { modo: 'ancla_ajena', estado: 'sucia', prosa: false },
    { modo: 'cita_inventada', estado: 'sucia', prosa: false },
    { modo: 'ilegible', estado: 'ilegible', prosa: false },
  ];

  for (const c of casos) {
    it(`«${c.modo}» ⇒ estado ${c.estado}`, async () => {
      const p = pedido(redactorFalso(c.modo));
      const r = await redactar(entrada(), p);
      expect(p.registro.estado).toBe(c.estado);
      expect(r.tipo === 'respuesta').toBe(c.prosa);
    });
  }

  it('sin redactor ⇒ `sin_intento`, y nada se intentó', async () => {
    const p = pedido(null);
    expect((await redactar(entrada(), p)).tipo).toBe('sin_prosa');
    expect(p.registro.estado).toBe('sin_intento');
    expect(p.registro.modelo).toBeNull();
  });
});

describe('[CHAT-B1] el perímetro se CUENTA, no se calla', () => {
  it('un documento de `10_Cuentas` no llega al modelo y deja su estado', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    const p = pedido(redactorFalso('fiel', { registro }));
    const r = await redactar(entrada({ ruta: '10_Cuentas/ACME.md' }), p);

    expect(r.tipo).toBe('sin_prosa');
    expect(p.registro.estado).toBe('fuera_del_perimetro');
    // EL GATE DE FONDO: no es que no se pinte, es que NO CRUZÓ.
    expect(registro.peticiones).toHaveLength(0);
  });

  it('`00_Indice` y `80_Registro` tampoco cruzan', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    for (const ruta of ['00_Indice/mapa.md', '80_Registro/ADR-001.md']) {
      await redactar(entrada({ ruta }), pedido(redactorFalso('fiel', { registro })));
    }
    expect(registro.peticiones).toHaveLength(0);
  });
});

describe('[CHAT-B1] lo que cruza el perímetro, afirmado', () => {
  it('al modelo le llega la ficha y NADA de inventario', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    await redactar(entrada(), pedido(redactorFalso('fiel', { registro })));

    expect(registro.peticiones).toHaveLength(1);
    const e = registro.peticiones[0].entrega;
    expect(e.trozos.map((t) => t.texto)).toEqual([
      'Montaje: requiere 4 tornillos.',
      'Peso del equipo: 3.2 kg.',
    ]);
    // La Entrega no tiene dónde poner una cifra de inventario: no hay campo.
    expect(Object.keys(e).sort()).toEqual(
      ['bytes', 'camino', 'familia', 'fuentePdf', 'ruta', 'titulo', 'trozos', 'trozosTotales'].sort(),
    );
  });

  it('la pregunta del KAM viaja; el hilo también', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    await redactar(
      entrada(),
      pedido(redactorFalso('fiel', { registro }), {
        pregunta: '¿y la otra?',
        hilo: [{ quien: 'usuario', texto: 'háblame del Series11' }],
      }),
    );
    expect(registro.peticiones[0].pregunta).toBe('¿y la otra?');
    expect(registro.peticiones[0].hilo).toHaveLength(1);
  });
});

describe('[CHAT-B1] la factura no se pierde', () => {
  it('una redacción SUCIA se pagó, y su uso queda anotado', async () => {
    const p = pedido(redactorFalso('dato_inventado', { uso: { entrada: 3_111, salida: 77 } }));
    await redactar(entrada(), p);
    expect(p.registro.estado).toBe('sucia');
    expect(p.registro.uso).toEqual({ entrada: 3_111, salida: 77 });
  });

  it('el modelo queda anotado aunque la salida sea ilegible', async () => {
    const p = pedido(redactorFalso('ilegible', { nombre: 'proveedor/modelo-x' }));
    await redactar(entrada(), p);
    expect(p.registro.modelo).toBe('proveedor/modelo-x');
  });

  it('los motivos del descarte quedan, para el reporte — nunca para pantalla', async () => {
    const p = pedido(redactorFalso('dato_inventado'));
    await redactar(entrada(), p);
    expect(p.registro.motivos.join()).toContain('dato_no_anclado');
  });
});

describe('[CHAT-B1] NUNCA lanza: la respuesta base no se puede tumbar', () => {
  it('un redactor que revienta deja `fallo` y cae al verbatim', async () => {
    const roto: Redactor = {
      nombre: 'roto',
      redactar: async () => {
        throw new Error('se cayó la red');
      },
    };
    const p = pedido(roto);
    const r = await redactar(entrada(), p);
    expect(r.tipo).toBe('sin_prosa');
    expect(p.registro.estado).toBe('fallo');
  });
});

describe('[CHAT-B1] el tiempo es un presupuesto compartido', () => {
  it('sin presupuesto suficiente NI SE INTENTA: una llamada que nace muerta cuesta igual', async () => {
    const registro: RegistroFalso = { peticiones: [] };
    const ahora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(ahora);
    try {
      const p = pedido(redactorFalso('fiel', { registro }), { limite: ahora + MINIMO_PARA_INTENTAR_MS - 1 });
      const r = await redactar(entrada(), p);
      expect(r.tipo).toBe('sin_prosa');
      expect(p.registro.estado).toBe('sin_tiempo');
      expect(registro.peticiones).toHaveLength(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('con presupuesto de sobra, sí lo intenta', async () => {
    const p = pedido(redactorFalso('fiel'), { limite: Date.now() + 60_000 });
    expect((await redactar(entrada(), p)).tipo).toBe('respuesta');
  });
});

describe('[CHAT-B1] `no_esta` NO funde los dos casos (P17 en miniatura)', () => {
  const entregaDe = (n: number, totales: number): Entrega => {
    const r = armarEntrega({
      ruta: '20_Seguridad/f.md',
      familia: 'F',
      titulo: null,
      fuentePdf: null,
      trozos: Array.from({ length: n }, (_, i) => ({ orden: i, rutaSeccion: `S${i}`, texto: 'x' })),
      trozosTotales: totales,
    });
    if (r.tipo !== 'entrega') throw new Error('fixture');
    return r.entrega;
  };

  it('camino completo dice «no está en la ficha»', () => {
    expect(mensajeNoEsta(entregaDe(2, 2))).toContain('no está en la ficha');
  });

  it('camino parcial NO puede decir eso: dice qué consultó y qué quedó fuera', () => {
    const m = mensajeNoEsta(entregaDe(6, 25));
    expect(m).not.toContain('no está en la ficha');
    expect(m).toContain('6 secciones que consulté');
    expect(m).toContain('19 sin revisar');
  });
});

describe('[CHAT-B1] respuestaDesde es el ÚNICO constructor', () => {
  it('sin veredicto limpio devuelve null — pintar prosa sin verificar no compila por otro lado', () => {
    const r = armarEntrega({
      ruta: '20_Seguridad/f.md',
      familia: 'F',
      titulo: null,
      fuentePdf: null,
      trozos: [{ orden: 0, rutaSeccion: 'S', texto: 'Peso: 3.2 kg.' }],
      trozosTotales: 1,
    });
    if (r.tipo !== 'entrega') throw new Error('fixture');
    const sucio = verificarRedaccion(r.entrega, {
      tipo: 'respuesta',
      frases: [{ texto: 'Pesa 999 kg.', orden: 0, cita: 'Peso: 3.2 kg.' }],
    });
    expect(respuestaDesde(r.entrega, sucio)).toBeNull();
  });

  it('la cita sale de la ENTREGA, no se arma aparte', async () => {
    const p = pedido(redactorFalso('fiel'));
    const r = await redactar(entrada(), p);
    if (r.tipo !== 'respuesta') throw new Error('debía redactar');
    expect(r.respuesta.ruta).toBe('20_Seguridad/ficha.md');
    expect(r.respuesta.fuentePdf).toBe('series11.pdf');
    expect(r.respuesta.camino).toBe('completo');
    expect(r.respuesta.seccionesLeidas).toBe(2);
  });
});
