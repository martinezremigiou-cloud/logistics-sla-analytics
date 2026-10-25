import { describe, it, expect } from 'vitest';
import {
  SELECCION_VACIA,
  MAX_SELECCION,
  claveDeSeleccion,
  normalizarSku,
  tiene,
  cantidadDe,
  totalPiezas,
  agregar,
  quitar,
  alternar,
  fijarCantidad,
  vaciar,
  leerSeleccion,
  escribirSeleccion,
  type AlmacenLocal,
  type Seleccion,
} from './seleccion';

/** `localStorage` de mentiras, con la misma forma. Sin globales ni jsdom: el módulo recibe el almacén. */
function almacen(inicial: Record<string, string> = {}): AlmacenLocal & { datos: Record<string, string> } {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k: string) => (k in datos ? datos[k] : null),
    setItem: (k: string, v: string) => {
      datos[k] = v;
    },
    removeItem: (k: string) => {
      delete datos[k];
    },
  };
}

const KAM_A = '00000000-0000-4000-8000-00000000000a';
const KAM_B = '00000000-0000-4000-8000-00000000000b';

describe('normalizarSku', () => {
  it('trim + UPPER, mismo criterio que el ETL y el schema de partidas', () => {
    expect(normalizarSku('  suj500-f ')).toBe('SUJ500-F');
  });

  it('los SKU reales con barra y con espacio se conservan tal cual', () => {
    expect(normalizarSku('WN947-X-N/BPU51-H14')).toBe('WN947-X-N/BPU51-H14');
    expect(normalizarSku('YBY016 W')).toBe('YBY016 W');
  });
});

describe('operaciones puras de la Selección', () => {
  it('agregar es IDEMPOTENTE: el botón del catálogo es un interruptor, no un contador', () => {
    const una = agregar(SELECCION_VACIA, 'SUJ500-F', 40);
    const otra = agregar(una, 'SUJ500-F', 999);
    expect(otra).toBe(una); // misma referencia: no cambió nada
    expect(cantidadDe(otra, 'SUJ500-F')).toBe(40);
  });

  it('agregar normaliza, así que suj500-f NO crea un segundo renglón', () => {
    const s = agregar(agregar(SELECCION_VACIA, 'SUJ500-F'), 'suj500-f');
    expect(s.items).toHaveLength(1);
  });

  it('alternar agrega y quita', () => {
    const s1 = alternar(SELECCION_VACIA, 'A-1');
    expect(tiene(s1, 'A-1')).toBe(true);
    expect(tiene(alternar(s1, 'A-1'), 'A-1')).toBe(false);
  });

  it('fijarCantidad con 0 o negativo QUITA el renglón: es lo que el usuario quiso decir', () => {
    const s = agregar(SELECCION_VACIA, 'A-1', 5);
    expect(fijarCantidad(s, 'A-1', 0).items).toHaveLength(0);
    expect(fijarCantidad(s, 'A-1', -3).items).toHaveLength(0);
  });

  it('las cantidades se sanean: NaN, decimales y negativos no envenenan el estado', () => {
    expect(cantidadDe(agregar(SELECCION_VACIA, 'A-1', NaN), 'A-1')).toBe(1);
    expect(cantidadDe(agregar(SELECCION_VACIA, 'A-2', 3.7), 'A-2')).toBe(3);
    expect(cantidadDe(agregar(SELECCION_VACIA, 'A-3', -5), 'A-3')).toBe(1);
  });

  it('el tope es espejo de MAX_PARTIDAS: volcar no puede crear un proyecto que la base rechace', () => {
    let s: Seleccion = SELECCION_VACIA;
    for (let i = 0; i < MAX_SELECCION + 20; i++) s = agregar(s, `SKU-${i}`);
    expect(s.items).toHaveLength(MAX_SELECCION);
  });

  it('fijarCantidad y quitar sobre un SKU ausente no hacen nada', () => {
    expect(fijarCantidad(SELECCION_VACIA, 'X', 5)).toBe(SELECCION_VACIA);
    expect(quitar(SELECCION_VACIA, 'X')).toBe(SELECCION_VACIA);
  });

  it('totalPiezas suma las cantidades, no los renglones', () => {
    const s = agregar(agregar(SELECCION_VACIA, 'A-1', 40), 'A-2', 80);
    expect(totalPiezas(s)).toBe(120);
    expect(s.items).toHaveLength(2);
  });
});

// ============================================================
// EL INVARIANTE 2 — el que se rompe callado
// ============================================================
describe('[INV-B8.2] la Selección NO sobrevive a un cambio de sesión', () => {
  it('la clave lleva la cuenta dentro: dos sesiones no comparten almacén', () => {
    expect(claveDeSeleccion(KAM_A)).not.toBe(claveDeSeleccion(KAM_B));
    expect(claveDeSeleccion(KAM_A)).toContain(KAM_A);
  });

  it('el KAM B NO hereda la Selección del KAM A en el mismo navegador', () => {
    const store = almacen();
    escribirSeleccion(store, KAM_A, agregar(agregar(SELECCION_VACIA, 'SUJ500-F', 40), 'JE016-YD', 80));

    // Mismo navegador, mismo almacén, otra sesión.
    expect(leerSeleccion(store, KAM_B)).toEqual(SELECCION_VACIA);

    // Y la del KAM A sigue intacta: no se trata de borrar, sino de AISLAR.
    expect(leerSeleccion(store, KAM_A).items).toHaveLength(2);
  });

  it('el aislamiento NO depende de que dispare ningún evento de cierre de sesión', () => {
    // El peor caso: nadie cerró sesión, la pestaña murió y otro usuario entró.
    // No hubo evento que escuchar, y aun así no hereda nada.
    const store = almacen();
    escribirSeleccion(store, KAM_A, agregar(SELECCION_VACIA, 'SECRETO-1', 5));
    const claves = Object.keys(store.datos);

    expect(claves).toHaveLength(1);
    expect(claves[0]).toContain(KAM_A);
    expect(leerSeleccion(store, KAM_B).items).toEqual([]);
  });
});

describe('[INV-B8.2] el almacén es hostil: se lee con desconfianza', () => {
  it('JSON corrupto → Selección vacía, nunca lanza', () => {
    const store = almacen({ [claveDeSeleccion(KAM_A)]: '{no es json' });
    expect(leerSeleccion(store, KAM_A)).toEqual(SELECCION_VACIA);
  });

  it('forma inesperada → Selección vacía', () => {
    for (const basura of ['null', '[]', '{"items":"no es arreglo"}', '"texto"', '42']) {
      const store = almacen({ [claveDeSeleccion(KAM_A)]: basura });
      expect(leerSeleccion(store, KAM_A), `no aguantó ${basura}`).toEqual(SELECCION_VACIA);
    }
  });

  it('los renglones inválidos se DESCARTAN uno por uno, sin tirar los buenos', () => {
    const store = almacen({
      [claveDeSeleccion(KAM_A)]: JSON.stringify({
        items: [
          { sku: 'BUENO-1', cantidad: 5 },
          { sku: '', cantidad: 3 },
          { sku: 'MALO-2', cantidad: 0 },
          { sku: 'MALO-3', cantidad: 'muchas' },
          { sku: 'BUENO-1', cantidad: 9 },
          null,
          { sku: 'BUENO-2', cantidad: 2 },
        ],
      }),
    });
    const s = leerSeleccion(store, KAM_A);
    expect(s.items.map((i) => i.sku)).toEqual(['BUENO-1', 'BUENO-2']);
    expect(cantidadDe(s, 'BUENO-1')).toBe(5); // gana el primero, no el duplicado
  });

  it('un almacén que LANZA al leer (Safari privado, políticas corporativas) no tumba la vista', () => {
    const hostil: AlmacenLocal = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(() => leerSeleccion(hostil, KAM_A)).not.toThrow();
    expect(leerSeleccion(hostil, KAM_A)).toEqual(SELECCION_VACIA);
    expect(() => escribirSeleccion(hostil, KAM_A, agregar(SELECCION_VACIA, 'A-1'))).not.toThrow();
  });

  it('vaciar BORRA la clave en vez de dejar basura', () => {
    const store = almacen();
    escribirSeleccion(store, KAM_A, agregar(SELECCION_VACIA, 'A-1'));
    expect(Object.keys(store.datos)).toHaveLength(1);
    escribirSeleccion(store, KAM_A, vaciar());
    expect(Object.keys(store.datos)).toHaveLength(0);
  });

  it('ida y vuelta: lo que se escribe es lo que se lee', () => {
    const store = almacen();
    const s = agregar(agregar(SELECCION_VACIA, 'WN947-X-N/BPU51-H14', 12), 'YBY016 W', 7);
    escribirSeleccion(store, KAM_A, s);
    expect(leerSeleccion(store, KAM_A)).toEqual(s);
  });
});
