import { describe, it, expect } from 'vitest';
import { SIN_TECNOLOGIA, mapearV2 } from './clasificacion';
import type { ClasificacionV2Lectura } from '@/services/derivaciones';

function v2Fila(overrides: Partial<ClasificacionV2Lectura> = {}): ClasificacionV2Lectura {
  return {
    sku: 'A-1',
    tecnologia: 'RFID',
    marca_v2: 'MARCA V2',
    familia_v2: 'FAMILIA V2',
    clase_v2: 'CLASE V2',
    descr_v2: 'Descr V2',
    ...overrides,
  };
}

describe('SIN_TECNOLOGIA', () => {
  it('es un valor reservado no vacío', () => {
    expect(typeof SIN_TECNOLOGIA).toBe('string');
    expect(SIN_TECNOLOGIA.length).toBeGreaterThan(0);
  });
});

describe('mapearV2', () => {
  it('sin filas → Map vacío', () => {
    const map = mapearV2([]);
    expect(map.size).toBe(0);
  });

  it('indexa por sku: 1 fila → 1 entrada recuperable', () => {
    const fila = v2Fila({ sku: 'A-1' });
    const map = mapearV2([fila]);
    expect(map.get('A-1')).toEqual(fila);
    expect(map.get('B-2')).toBeUndefined();
  });

  it('múltiples filas de distintos skus → todas indexadas', () => {
    const a = v2Fila({ sku: 'A-1', tecnologia: 'RFID' });
    const b = v2Fila({ sku: 'B-2', tecnologia: 'EAS' });
    const map = mapearV2([a, b]);
    expect(map.get('A-1')).toEqual(a);
    expect(map.get('B-2')).toEqual(b);
    expect(map.size).toBe(2);
  });

  it('sku duplicado (defensivo): gana la última fila del arreglo', () => {
    const vieja = v2Fila({ sku: 'A-1', descr_v2: 'VIEJA' });
    const nueva = v2Fila({ sku: 'A-1', descr_v2: 'NUEVA' });
    const map = mapearV2([vieja, nueva]);
    expect(map.get('A-1')?.descr_v2).toBe('NUEVA');
    expect(map.size).toBe(1);
  });
});
