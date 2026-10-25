// ============================================================
// [INV-B10] Las tarjetas. La prueba que el DoD llama «el modelo no inventa
// números» — que en este diseño cambia de forma.
//
// El brief la planteaba así: dado un dato conocido, la respuesta lo contiene
// exacto; con el dato ausente, no lo escribe. Con el modelo redactando, eso es
// lo mejor que se puede probar.
//
// Aquí el modelo **no ve ningún número**, así que la prueba equivalente es más
// fuerte y más simple: **la tarjeta transporta las cifras de `derivarSku` sin
// tocarlas, y cuando no hay dato lo dice en palabras en vez de poner un cero
// que parezca una medición.**
//
// Un `0` y un «no hay nada en camino» no son lo mismo, y la diferencia importa:
// la mayoría de las 11 etapas del pipeline están vacías en cualquier momento dado, así
// que el vacío es el caso NORMAL de este dominio, no el borde.
// ============================================================
import { describe, it, expect } from 'vitest';
import { separarFamilias } from '@/lib/familias';
import {
  tarjetaLlegada,
  tarjetaDisponibilidad,
  tarjetaClasificacion,
  tarjetaPipeline,
  tarjetaSobreReservados,
  tarjetaBusqueda,
  textoDeCorte,
  TOPE_LISTA,
  type Tarjeta,
} from './tarjeta';
import type { CatalogoItem, CatalogoPage, EmbarqueItem, EmbarquesResponse, SkuDetalle } from '@/types/api';

const CORTE_STOCK = '2026-03-14T18:00:00.000Z';
const CORTE_ADUANA = '2026-08-18T18:00:07.055Z';

function detalle(over: Partial<SkuDetalle> = {}): SkuDetalle {
  const familia_efectiva = over.familia_efectiva === undefined ? 'CANDADOS' : over.familia_efectiva;
  return {
    sku: 'SUJ500-F',
    marca: 'BRAND1',
    // [VERT-B2] Añadido A MANO, y por eso lleva nota: este fixture cierra con
    // `as SkuDetalle` sobre un objeto que además hace `...over`, y esa
    // combinación deja pasar la propiedad faltante — `tsc` NO lo denunció,
    // mientras que el `as SkuDetalle` SIN spread de
    // `evidencia-visual-chat.test.tsx` sí se puso rojo. La promesa de «el campo
    // requerido enumera a cada consumidor» tiene exactamente este hueco.
    marca_excluida: false,
    familia_efectiva,
    familias_efectivas: separarFamilias(familia_efectiva),
    descr_efectiva: 'LHZ 72 Angled',
    original: { familia: 'CANDADOS', descr: 'LHZ 72 Angled' },
    stock: [{ almacen: 'NORTH', cantidad: 1574 }],
    total: 2037,
    reservado: 463,
    disponible: 1574,
    sobre_reservado: false,
    reserva_descuadre: false,
    reservas: [],
    embarques: [],
    piezas_en_camino: 0,
    piezas_historial: 0,
    imagen_url: null,
    snapshot: { stock: null, aduana: null },
    decidido_en_bandeja: { marca: false },
    ...over,
  } as SkuDetalle;
}

function embarque(over: Partial<EmbarqueItem> = {}): EmbarqueItem {
  return {
    id: 'e1',
    sku: 'SUJ500-F',
    oc_po: null,
    proveedor: null,
    referencia: null,
    factura: null,
    pais_origen: null,
    piezas: 1380,
    fw: null,
    tipo_importacion: null,
    fecha_recoleccion: null,
    etd: null,
    eta: '2026-09-09',
    fecha_llegada: null,
    fecha_disponibilidad: null,
    estatus: 'En Aduana',
    estatus_orden: 4,
    proyecto: null,
    observaciones: null,
    is_historial: false,
    retrasado: false,
    ...over,
  } as EmbarqueItem;
}

/** Todo el texto de una tarjeta, para preguntarle si un número aparece o no. */
function texto(t: Tarjeta): string {
  return [
    t.titulo,
    ...t.datos.map((d) => `${d.etiqueta} ${d.valor}`),
    ...t.lista.map((l) => `${l.principal} ${l.secundario}`),
    t.nota ?? '',
  ].join(' | ');
}

// ============================================================
// LAS CIFRAS SE TRANSPORTAN, NO SE RECALCULAN.
// ============================================================
describe('[INV-B10] la tarjeta lleva las cifras EXACTAS de derivarSku', () => {
  it('disponibilidad pone los tres números tal cual, con separador es-MX', () => {
    const t = tarjetaDisponibilidad(detalle(), CORTE_STOCK);
    const s = texto(t);
    expect(s).toContain('1,574'); // disponible
    expect(s).toContain('2,037'); // total
    expect(s).toContain('463'); // reservado
  });

  it('no recalcula: si el reservado NO cuadra con la suma de reservas, manda el del producto', () => {
    // `reservado` es `productos.resv`, NUNCA la suma de la tabla `reservas`
    // (derivaciones.ts:238). Una tarjeta que sumara la lista daría otro número.
    const t = tarjetaDisponibilidad(
      detalle({
        reservado: 463,
        reserva_descuadre: true,
        reservas: [
          { kam: 'H. Lara', cliente: 'RETAILER9', cantidad: 100, motivo: null, fecha: '2026-08-01' },
          { kam: null, cliente: 'RETAILER42', cantidad: 50, motivo: null, fecha: '2026-08-02' },
        ],
      }),
      CORTE_STOCK,
    );
    expect(texto(t)).toContain('463');
    // Y lo DICE, en vez de esconder el descuadre.
    expect(t.nota).toMatch(/no cuadra/i);
  });

  it('el número que contesta la pregunta va marcado, para que no se pierda entre los otros', () => {
    const t = tarjetaDisponibilidad(detalle(), CORTE_STOCK);
    const enfatizados = t.datos.filter((d) => d.enfasis);
    expect(enfatizados).toHaveLength(1);
    expect(enfatizados[0]!.etiqueta).toBe('Disponible');
  });

  it('llegada suma piezas desde `piezas_en_camino`, que ya lo derivó el servicio', () => {
    const t = tarjetaLlegada(detalle({ piezas_en_camino: 1380, embarques: [embarque()] }), CORTE_ADUANA);
    expect(texto(t)).toContain('1,380');
  });
});

// ============================================================
// EL VACÍO SE DICE EN PALABRAS, NO CON UN CERO.
// Un `0` parece una medición; «no hay nada en camino» es lo que pasó.
// ============================================================
describe('[INV-B10] cuando no hay dato, lo dice', () => {
  it('un SKU sin nada en camino recibe una frase, no un cero suelto', () => {
    const t = tarjetaLlegada(detalle({ embarques: [], piezas_en_camino: 0 }), CORTE_ADUANA);
    expect(t.lista).toHaveLength(0);
    expect(t.nota).toMatch(/no hay nada en camino/i);
  });

  it('un SKU sin reservas lo dice, en vez de dejar la lista muda', () => {
    const t = tarjetaDisponibilidad(detalle({ reservas: [] }), CORTE_STOCK);
    expect(t.nota).toMatch(/nadie tiene reservas/i);
  });

  it('una búsqueda sin coincidencias nombra el término y no inventa un SKU parecido', () => {
    const page: CatalogoPage = { items: [], page: 1, pageSize: 50, total: 0, totalPages: 0, facetas: {} as never, excluidos: { total: 0, marcas: [] } };
    const t = tarjetaBusqueda(page, 'LHZ 72', CORTE_STOCK);
    expect(t.lista).toHaveLength(0);
    expect(t.nota).toContain('LHZ 72');
    expect(t.nota).toMatch(/no hay ning/i);
  });

  it('un SKU sin clase ni tecnología pinta «—», no adivina', () => {
    const t = tarjetaClasificacion(detalle({ clase: null, tecnologia: null }), CORTE_STOCK);
    const valores = t.datos.map((d) => d.valor);
    expect(valores).toContain('—');
    expect(texto(t)).not.toMatch(/null|undefined/);
  });

  it('ninguna tarjeta escribe `null` ni `undefined` en su texto', () => {
    const tarjetas = [
      tarjetaLlegada(detalle({ embarques: [embarque({ piezas: null, eta: null })], piezas_en_camino: 0 }), null),
      tarjetaDisponibilidad(detalle({ reservas: [{ kam: null, cliente: 'X', cantidad: 1, motivo: null, fecha: 'd' }] }), null),
      tarjetaClasificacion(detalle({ familia_efectiva: null, descr_efectiva: null }), null),
    ];
    for (const t of tarjetas) {
      expect(texto(t), t.titulo).not.toMatch(/\bnull\b|\bundefined\b/);
    }
  });
});

// ============================================================
// LA PROCEDENCIA. Regla #1 y #3 aplicadas a una conversación: una cifra de
// inventario sin su corte es una cifra sin denominador.
// ============================================================
describe('[INV-B10] toda tarjeta dice de dónde salió', () => {
  it('las de stock llevan el corte de stock; las de aduana, el de aduana', () => {
    expect(tarjetaDisponibilidad(detalle(), CORTE_STOCK).cortes).toEqual([{ fuente: 'stock', cuando: CORTE_STOCK }]);
    expect(tarjetaLlegada(detalle(), CORTE_ADUANA).cortes).toEqual([{ fuente: 'aduana', cuando: CORTE_ADUANA }]);
  });

  it('toda tarjeta declara su fuente con la forma `{tag, code}` de la maqueta', () => {
    const t = tarjetaDisponibilidad(detalle(), CORTE_STOCK);
    expect(t.fuentes).toHaveLength(1);
    expect(t.fuentes[0]).toEqual({ tag: 'Inventario en vivo', code: 'SUJ500-F' });
  });

  it('sin snapshot no se inventa una fecha: la lista de cortes queda vacía', () => {
    expect(tarjetaDisponibilidad(detalle(), null).cortes).toEqual([]);
  });

  // El corte es un TIMESTAMP, así que se renderiza en zona México y no en la
  // del runtime — la lección de F6, que puso «31-jul» donde iba «30-jul».
  it('el corte se pinta como día en zona México', () => {
    expect(textoDeCorte({ fuente: 'stock', cuando: CORTE_STOCK })).toMatch(/Stock · corte 14 mar 2026/);
  });
});

// ============================================================
// NO TRUNCAR CALLADO — la misma regla del correo de B9.1.
// ============================================================
describe('[INV-B10] las listas se acotan y lo declaran', () => {
  const muchas = Array.from({ length: TOPE_LISTA + 7 }, (_, i) => ({
    kam: `KAM ${i}`,
    cliente: `CLIENTE ${i}`,
    cantidad: i + 1,
    motivo: null,
    fecha: '2026-08-01',
  }));

  it('corta en el tope y dice cuántas había en total', () => {
    const t = tarjetaDisponibilidad(detalle({ reservas: muchas }), CORTE_STOCK);
    expect(t.lista).toHaveLength(TOPE_LISTA);
    expect(t.nota).toContain(String(TOPE_LISTA + 7));
  });

  it('con pocas, no inventa un aviso de corte', () => {
    const t = tarjetaDisponibilidad(detalle({ reservas: muchas.slice(0, 3) }), CORTE_STOCK);
    expect(t.lista).toHaveLength(3);
    expect(t.nota ?? '').not.toMatch(/Se muestran/);
  });
});

// ============================================================
// LAS TRES QUE NO NECESITAN SKU — las que la maqueta pedía y el brief no traía.
// ============================================================
describe('[INV-B10] las intenciones sin SKU', () => {
  const resp = (over: Partial<EmbarquesResponse> = {}): EmbarquesResponse =>
    ({
      snapshot: { id: 's', created_at: CORTE_ADUANA, filas: null, archivo: null },
      items: [embarque()],
      page: 1,
      pageSize: 50,
      total: 1,
      totalPages: 1,
      resumen: { embarques: 1, piezas: 1380, activos: 1, historial: 0, piezas_activas: 1380, retrasados: 0 },
      facetas: {} as never,
      ...over,
    }) as EmbarquesResponse;

  it('pipeline reporta activos, piezas y retrasados desde el resumen del servicio', () => {
    const t = tarjetaPipeline(resp());
    const s = texto(t);
    expect(s).toContain('1,380');
    expect(t.cortes).toEqual([{ fuente: 'aduana', cuando: CORTE_ADUANA }]);
  });

  it('pipeline vacío lo dice: la mayoría de las 11 etapas están vacías en cualquier momento', () => {
    const t = tarjetaPipeline(
      resp({ items: [], total: 0, resumen: { embarques: 0, piezas: 0, activos: 0, historial: 0, piezas_activas: 0, retrasados: 0 } }),
    );
    expect(t.nota).toMatch(/no hay nada activo/i);
  });

  const item = (over: Partial<CatalogoItem> = {}): CatalogoItem =>
    ({
      sku: 'SPA929-G',
      marca: 'BRAND1',
      familia: null,
      familias: [],
      descripcion: 'Base',
      total: 0,
      reservado: 8,
      disponible: -8,
      badges: [],
      color: null,
      imagen_url: null,
      tecnologia: null,
      ...over,
    }) as CatalogoItem;

  it('sobre-reservados enumera con su disponible negativo', () => {
    const page = { items: [item()], page: 1, pageSize: 50, total: 1, totalPages: 1, facetas: {} as never, excluidos: { total: 0, marcas: [] } };
    const t = tarjetaSobreReservados(page, CORTE_STOCK);
    expect(texto(t)).toContain('SPA929-G');
    expect(texto(t)).toContain('-8');
  });

  // Medido por `listInventory`, la funcion que de verdad corre: un termino da muchos SKU,
  // unos pocos o ninguno. Casi nunca es 1-a-1.
  it('la búsqueda ENUMERA y no elige: elegir por el usuario sería adivinar', () => {
    const items = ['FXT2356', 'RCR3928', 'DNU2085'].map((sku) => item({ sku }));
    const page = { items, page: 1, pageSize: 50, total: 3, totalPages: 1, facetas: {} as never, excluidos: { total: 0, marcas: [] } };
    const t = tarjetaBusqueda(page, 'CLIPS', CORTE_STOCK);
    expect(t.lista).toHaveLength(3);
    expect(t.titulo).toContain('CLIPS');
  });
});
