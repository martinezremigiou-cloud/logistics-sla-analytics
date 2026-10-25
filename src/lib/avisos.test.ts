import { describe, it, expect } from 'vitest';
import {
  cantidadDeValor,
  derivarAvisos,
  derivarPulso,
  fuentesCalladas,
  DIAS_CALLADA,
  DIAS_OTRA_VIVA,
  type CambioCrudo,
  type SeguimientoLectura,
  type CifrasAhora,
} from './avisos';

/** Fila de `cambios` con la forma REAL medida contra la base. */
function cambio(over: Partial<CambioCrudo> = {}): CambioCrudo {
  return {
    entidad: 'stock',
    campo: 'cantidad',
    tipo: 'MODIFICACION',
    sku: 'SUJ500-F',
    valor_anterior: '10',
    valor_nuevo: '15',
    detectado_en: '2026-08-14T16:00:00.000Z',
    snapshot_id: 's1',
    ...over,
  };
}

function sigue(over: Partial<SeguimientoLectura> = {}): SeguimientoLectura {
  return {
    perfil_id: 'kam-a',
    sku: 'SUJ500-F',
    av_estatus: false,
    av_disponible: false,
    av_reservado: false,
    av_llegada: true,
    ...over,
  };
}

const cifras = (pares: Record<string, CifrasAhora>) => new Map(Object.entries(pares));

// ============================================================
// El parser. Dos formas conviven en la misma columna `text` y las dos salen
// del ETL — no son hipótesis, están copiadas de la base.
// ============================================================
describe('[INV-B9] cantidadDeValor', () => {
  it('lee el número pelado de una MODIFICACIÓN', () => {
    expect(cantidadDeValor('10')).toBe(10);
    expect(cantidadDeValor('0')).toBe(0);
  });

  it('lee el JSON de una ALTA/BAJA', () => {
    expect(cantidadDeValor('{"cantidad":1}')).toBe(1);
    expect(cantidadDeValor('{"cantidad":12}')).toBe(12);
  });

  it('`null` vale 0: en un ALTA no había nada antes, en una BAJA no queda nada después', () => {
    expect(cantidadDeValor(null)).toBe(0);
    expect(cantidadDeValor('')).toBe(0);
  });

  it('una fila rara devuelve 0 y NO lanza: no puede tumbar el aviso de los otros SKU', () => {
    expect(cantidadDeValor('{no es json')).toBe(0);
    expect(cantidadDeValor('En Aduana')).toBe(0);
    expect(cantidadDeValor('{"otra_cosa":5}')).toBe(0);
  });
});

describe('[INV-B9] derivarAvisos · las cuatro señales', () => {
  it('estatus: el salto de etapa, con sus dos nombres', () => {
    const a = derivarAvisos(
      [sigue({ av_estatus: true })],
      [cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'En Aduana', valor_nuevo: 'En Almacén North' })],
      cifras({}),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'estatus', sku: 'SUJ500-F', de: 'En Aduana', a: 'En Almacén North' });
  });

  it('reservado sale de `producto.resv`, que es lo que derivarSku llama reservado', () => {
    const a = derivarAvisos(
      [sigue({ av_reservado: true, av_llegada: false })],
      [cambio({ entidad: 'producto', campo: 'resv', valor_anterior: '19', valor_nuevo: '15' })],
      cifras({ 'SUJ500-F': { disponible: 100, reservado: 15 } }),
    );
    expect(a.map((x) => x.tipo)).toEqual(['reservado']);
    expect(a[0]).toMatchObject({ de: '19', a: '15' });
  });

  // ============================================================
  // BP-9: las reservas sin fecha se rellenan con `${periodo}-01`, así que cada
  // cambio de mes rota TODAS de clave a la vez — un lote de cambios de ruido
  // determinista. Si esta prueba se pusiera verde con avisos, la campana
  // dispararía una falsa alarma masiva el día 1 de cada mes, para siempre.
  // ============================================================
  it('la tabla `reservas` NO produce ni un aviso, por muchas filas que traiga', () => {
    const ruido = Array.from({ length: 300 }, (_, i) =>
      cambio({ entidad: 'reserva', campo: '*', tipo: i % 2 ? 'ALTA' : 'BAJA', valor_anterior: '{"cantidad":5}', valor_nuevo: null }),
    );
    const a = derivarAvisos(
      [sigue({ av_estatus: true, av_disponible: true, av_reservado: true, av_llegada: true })],
      ruido,
      cifras({ 'SUJ500-F': { disponible: 100, reservado: 0 } }),
    );
    expect(a).toEqual([]);
  });

  it('disponible: reconstruye el antes restando el delta, sin derivar ninguna cifra', () => {
    // Δtotal = +5 (10 → 15). Δresv = 0. Δdisponible = +5. Hoy hay 25 → antes 20.
    const a = derivarAvisos(
      [sigue({ av_disponible: true, av_llegada: false })],
      [cambio()],
      cifras({ 'SUJ500-F': { disponible: 25, reservado: 0 } }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'disponible', de: '20', a: '25' });
  });

  it('Δdisponible = Δtotal − Δreservado, que es lo que dice derivarSku', () => {
    const a = derivarAvisos(
      [sigue({ av_disponible: true, av_llegada: false })],
      [
        cambio({ valor_anterior: '10', valor_nuevo: '30' }), // Δtotal = +20
        cambio({ entidad: 'producto', campo: 'resv', valor_anterior: '0', valor_nuevo: '8' }), // Δresv = +8
      ],
      cifras({ 'SUJ500-F': { disponible: 12, reservado: 8 } }),
    );
    // Δdisponible = 20 − 8 = 12 · hoy 12 → antes 0
    expect(a[0]).toMatchObject({ tipo: 'disponible', de: '0', a: '12' });
  });

  it('llegada: de ≤0 a >0, y es el DEFAULT del producto', () => {
    const a = derivarAvisos(
      [sigue()],
      [cambio({ tipo: 'ALTA', campo: '*', valor_anterior: null, valor_nuevo: '{"cantidad":40}' })],
      cifras({ 'SUJ500-F': { disponible: 40, reservado: 0 } }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ tipo: 'llegada', de: '0', a: '40' });
  });

  it('un disponible que sube pero seguía habiendo NO es una llegada', () => {
    const a = derivarAvisos(
      [sigue()],
      [cambio({ valor_anterior: '10', valor_nuevo: '15' })],
      cifras({ 'SUJ500-F': { disponible: 15, reservado: 0 } }),
    );
    expect(a).toEqual([]);
  });

  it('salir de sobre-reservado (negativo → positivo) SÍ es una llegada', () => {
    const a = derivarAvisos(
      [sigue()],
      [cambio({ valor_anterior: '0', valor_nuevo: '1840' })],
      cifras({ 'SUJ500-F': { disponible: 565, reservado: 1275 } }),
    );
    expect(a[0]).toMatchObject({ tipo: 'llegada', de: '-1275', a: '565' });
  });

  // ============================================================
  // Un SKU que llegó cambió su disponible: son UN hecho. Dos renglones serían
  // contarlo dos veces.
  // ============================================================
  it('`llegada` manda sobre `disponible`: nunca salen los dos por el mismo hecho', () => {
    const a = derivarAvisos(
      [sigue({ av_disponible: true, av_llegada: true })],
      [cambio({ valor_anterior: '0', valor_nuevo: '40' })],
      cifras({ 'SUJ500-F': { disponible: 40, reservado: 0 } }),
    );
    expect(a.map((x) => x.tipo)).toEqual(['llegada']);
  });

  it('quien NO pidió llegada pero sí disponible, recibe disponible', () => {
    const a = derivarAvisos(
      [sigue({ av_disponible: true, av_llegada: false })],
      [cambio({ valor_anterior: '0', valor_nuevo: '40' })],
      cifras({ 'SUJ500-F': { disponible: 40, reservado: 0 } }),
    );
    expect(a.map((x) => x.tipo)).toEqual(['disponible']);
  });

  it('solo avisa lo que esa persona pidió: los booleanos son un filtro, no un adorno', () => {
    const cambios = [
      cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'A', valor_nuevo: 'B' }),
      cambio({ entidad: 'producto', campo: 'resv', valor_anterior: '5', valor_nuevo: '9' }),
      cambio({ valor_anterior: '10', valor_nuevo: '20' }),
    ];
    const cif = cifras({ 'SUJ500-F': { disponible: 11, reservado: 9 } });
    expect(derivarAvisos([sigue({ av_llegada: false })], cambios, cif)).toEqual([]);
    expect(derivarAvisos([sigue({ av_estatus: true, av_llegada: false })], cambios, cif).map((x) => x.tipo)).toEqual(['estatus']);
  });

  it('un SKU sin cifras de hoy no inventa un disponible, pero sí conserva estatus y reservado', () => {
    const a = derivarAvisos(
      [sigue({ av_estatus: true, av_disponible: true, av_reservado: true })],
      [
        cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'A', valor_nuevo: 'B' }),
        cambio({ entidad: 'producto', campo: 'resv', valor_anterior: '5', valor_nuevo: '9' }),
        cambio(),
      ],
      cifras({}),
    );
    expect(a.map((x) => x.tipo).sort()).toEqual(['estatus', 'reservado']);
  });

  it('los cambios de OTRO SKU no se cruzan', () => {
    const a = derivarAvisos(
      [sigue()],
      [cambio({ sku: 'OTRO-1', tipo: 'ALTA', campo: '*', valor_anterior: null, valor_nuevo: '{"cantidad":9}' })],
      cifras({ 'OTRO-1': { disponible: 9, reservado: 0 } }),
    );
    expect(a).toEqual([]);
  });

  it('cada quien recibe lo suyo: dos perfiles siguiendo el mismo SKU con distinta pregunta', () => {
    const a = derivarAvisos(
      [
        sigue({ perfil_id: 'kam-a', av_llegada: true }),
        sigue({ perfil_id: 'kam-b', av_llegada: false, av_reservado: true }),
      ],
      [
        cambio({ tipo: 'ALTA', campo: '*', valor_anterior: null, valor_nuevo: '{"cantidad":40}' }),
        cambio({ entidad: 'producto', campo: 'resv', valor_anterior: '0', valor_nuevo: '3' }),
      ],
      cifras({ 'SUJ500-F': { disponible: 37, reservado: 3 } }),
    );
    expect(a.filter((x) => x.perfil_id === 'kam-a').map((x) => x.tipo)).toEqual(['llegada']);
    expect(a.filter((x) => x.perfil_id === 'kam-b').map((x) => x.tipo)).toEqual(['reservado']);
  });
});

// ============================================================
// EL INVARIANTE DEL GRANO — «un resumen por carga, no un evento por cambio».
// ============================================================
describe('[INV-B9] el resumen: un renglón por SKU y por tipo', () => {
  it('un SKU que avanzó TRES etapas produce UNA línea, de la primera a la última', () => {
    const a = derivarAvisos(
      [sigue({ av_estatus: true, av_llegada: false })],
      [
        cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'Producto Solicitado', valor_nuevo: 'En Preparación', detectado_en: '2026-08-12T17:00:00.000Z' }),
        cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'En Preparación', valor_nuevo: 'En Recolección', detectado_en: '2026-08-13T17:00:00.000Z' }),
        cambio({ entidad: 'embarque', campo: 'estatus', valor_anterior: 'En Recolección', valor_nuevo: 'En Almacén FW', detectado_en: '2026-08-14T17:00:00.000Z' }),
      ],
      cifras({}),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ de: 'Producto Solicitado', a: 'En Almacén FW' });
    // Y se sella con el instante MÁS RECIENTE, no con el primero.
    expect(a[0].detectado_en).toBe('2026-08-14T17:00:00.000Z');
  });

  it('catorce filas de cinco cargas siguen siendo UN renglón con el neto', () => {
    const muchas = Array.from({ length: 14 }, (_, i) =>
      cambio({ valor_anterior: String(i), valor_nuevo: String(i + 1), detectado_en: `2026-08-1${i % 5}T17:00:00.000Z`, snapshot_id: `s${i % 5}` }),
    );
    const a = derivarAvisos(
      [sigue({ av_disponible: true, av_llegada: false })],
      muchas,
      cifras({ 'SUJ500-F': { disponible: 14, reservado: 0 } }),
    );
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ de: '0', a: '14' }); // Δ = 14 filas × +1
  });

  it('con el DEFAULT del producto, 30 SKU seguidos dan a lo sumo 30 renglones — uno por SKU, nunca uno por cambio', () => {
    const seguidos = Array.from({ length: 30 }, (_, i) => sigue({ sku: `SKU-${i}` }));
    // 20 filas de bitácora por SKU: 600 filas en total.
    const cambios = seguidos.flatMap((s) =>
      Array.from({ length: 20 }, (_, j) =>
        cambio({ sku: s.sku, valor_anterior: String(j), valor_nuevo: String(j + 1), detectado_en: `2026-08-14T1${j % 10}:00:00.000Z` }),
      ),
    );
    const cif = new Map(seguidos.map((s) => [s.sku, { disponible: 20, reservado: 0 }]));
    const a = derivarAvisos(seguidos, cambios, cif);
    expect(cambios).toHaveLength(600);
    expect(a).toHaveLength(30);
    expect(new Set(a.map((x) => x.sku)).size).toBe(30);
  });
});

describe('[INV-B9] derivarPulso', () => {
  it('el pulso es MOVIMIENTO: los saltos de etapa y las llegadas, no un inventario', () => {
    const p = derivarPulso(
      [
        cambio({ sku: 'A-1', entidad: 'embarque', campo: 'estatus', valor_anterior: 'En Aduana', valor_nuevo: 'En Almacén North' }),
        cambio({ sku: 'B-2', tipo: 'ALTA', campo: '*', valor_anterior: null, valor_nuevo: '{"cantidad":40}' }),
      ],
      [
        { sku: 'A-1', piezas: 100, etapa: 'Producto Solicitado' },
        { sku: 'C-3', piezas: 50, etapa: 'Producto Solicitado' },
      ],
      cifras({ 'B-2': { disponible: 40, reservado: 0 } }),
    );
    expect(p.movimientos).toEqual([{ sku: 'A-1', de: 'En Aduana', a: 'En Almacén North' }]);
    expect(p.llegadas).toEqual(['B-2']);
    expect(p.enCamino).toEqual({ skus: 2, piezas: 150, etapasOcupadas: 1 });
  });

  it('sin nada que reportar el pulso sale vacío, no inventado', () => {
    const p = derivarPulso([], [], cifras({}));
    expect(p.movimientos).toEqual([]);
    expect(p.llegadas).toEqual([]);
    expect(p.enCamino).toEqual({ skus: 0, piezas: 0, etapasOcupadas: 0 });
  });
});

// ============================================================
// LA LÍNEA DE ADMIN. El caso de prueba no es inventado: son las dos fechas
// reales de la historia de cargas.
// ============================================================
describe('[INV-B9] fuentesCalladas', () => {
  const ahora = new Date('2026-08-12T12:00:00.000Z');

  it('EL INCIDENTE REAL: stock lleva 7 días y aduana cargó ayer → avisa', () => {
    const r = fuentesCalladas(
      [
        { fuente: 'stock', ultima: '2026-08-05T03:06:00.000Z' },
        { fuente: 'aduana', ultima: '2026-08-11T17:00:00.000Z' },
      ],
      ahora,
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ fuente: 'stock', otra: 'aduana' });
    expect(r[0].dias).toBeGreaterThanOrEqual(DIAS_CALLADA);
  });

  it('EL HUECO LEGÍTIMO: las dos calladas 11 días → NO avisa', () => {
    // Un hueco de 11 días: ninguna de las dos cargó. Es un paro, no una falla.
    const r = fuentesCalladas(
      [
        { fuente: 'stock', ultima: '2026-07-19T22:23:00.000Z' },
        { fuente: 'aduana', ultima: '2026-07-19T19:41:00.000Z' },
      ],
      new Date('2026-07-30T12:00:00.000Z'),
    );
    expect(r).toEqual([]);
  });

  it('un umbral de 7 días habría PERDIDO el incidente: por eso es 5', () => {
    // En el incidente real el hueco no llegó a 8 días y la carga llegó antes de
    // cruzar 7 en el momento en que alguien miró. Con 5 se detecta.
    const el11 = new Date('2026-08-11T12:00:00.000Z');
    const cargas = [
      { fuente: 'stock', ultima: '2026-08-05T03:06:00.000Z' },
      { fuente: 'aduana', ultima: '2026-08-10T23:00:00.000Z' },
    ];
    expect(fuentesCalladas(cargas, el11)).toHaveLength(1);
    expect((el11.getTime() - new Date(cargas[0].ultima).getTime()) / 86_400_000).toBeLessThan(7);
  });

  it('todo al día → silencio', () => {
    const r = fuentesCalladas(
      [
        { fuente: 'stock', ultima: '2026-08-12T00:00:00.000Z' },
        { fuente: 'aduana', ultima: '2026-08-12T06:00:00.000Z' },
      ],
      ahora,
    );
    expect(r).toEqual([]);
  });

  it('una fuente que NUNCA cargó cuenta como callada si la otra está viva', () => {
    const r = fuentesCalladas(
      [
        { fuente: 'stock', ultima: null },
        { fuente: 'aduana', ultima: '2026-08-12T06:00:00.000Z' },
      ],
      ahora,
    );
    expect(r).toHaveLength(1);
    expect(r[0].fuente).toBe('stock');
  });

  it('la otra fuente tiene que estar VIVA, no solo menos vieja', () => {
    // stock 8 días, aduana 4: aduana pasa el umbral de "viva" (2 días)? No.
    const r = fuentesCalladas(
      [
        { fuente: 'stock', ultima: '2026-08-04T12:00:00.000Z' },
        { fuente: 'aduana', ultima: '2026-08-08T12:00:00.000Z' },
      ],
      ahora,
    );
    expect(DIAS_OTRA_VIVA).toBe(2);
    expect(r).toEqual([]);
  });
});
