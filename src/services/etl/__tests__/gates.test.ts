import { describe, it, expect } from 'vitest';
import { runGates, checkReferential } from '../gates';
import type { ProductoCanon, StockCanon, ReservaCanon } from '../types';

const prod = (sku: string, resv: number, totalFuente: number): ProductoCanon => ({
  sku, marca: 'X', tecnologia: null, producto: null, familia: null, class: null, descr: null, cliente: null, resv, totalFuente,
});

describe('runGates (Σstock==TOTAL sin WEST · Σreservas==resv)', () => {
  it('stock cuadra (excluyendo WEST) → sin DIAG de stock', () => {
    const productos = [prod('A', 0, 25)];
    const stock: StockCanon[] = [
      { sku: 'A', almacen: 'NORTH', cantidad: 10 },
      { sku: 'A', almacen: 'TRAN', cantidad: 15 },
      { sku: 'A', almacen: 'WEST', cantidad: 999 }, // EXCLUIDO de la igualdad
    ];
    const { diag } = runGates(productos, stock, []);
    expect(diag.find((d) => d.tipo === 'SUMA_STOCK')).toBeUndefined();
  });
  it('Σstock ≠ TOTAL → DiagItem SUMA_STOCK (data NO se descarta)', () => {
    const productos = [prod('A', 0, 30)];
    const stock: StockCanon[] = [{ sku: 'A', almacen: 'NORTH', cantidad: 25 }];
    const { diag } = runGates(productos, stock, []);
    const d = diag.find((x) => x.tipo === 'SUMA_STOCK')!;
    expect(d).toMatchObject({ sku: 'A', esperado: 30, obtenido: 25, delta: -5 });
  });
  it('Σreservas ≠ resv → DiagItem SUMA_RESERVAS', () => {
    const productos = [prod('A', 10, 0)];
    const reservas: ReservaCanon[] = [{ sku: 'A', kam: null, cliente: 'C', cantidad: 8, motivo: null, fecha: '2026-01-01' }];
    const { diag } = runGates(productos, [], reservas);
    expect(diag.find((d) => d.tipo === 'SUMA_RESERVAS')).toMatchObject({ esperado: 10, obtenido: 8, delta: -2 });
  });
  it('gates NUNCA produce cuarentena', () => {
    const { cuarentena } = runGates([prod('A', 5, 5)], [], []);
    expect(cuarentena).toHaveLength(0);
  });
});

describe('checkReferential (sku sin producto → cuarentena)', () => {
  const valid = new Set(['A', 'B']);
  it('reserva con sku conocido pasa; desconocido → cuarentena', () => {
    const { ok, cuarentena } = checkReferential(
      [{ sku: 'A', x: 1 }, { sku: 'Z', x: 2 }],
      valid,
      'reserva',
    );
    expect(ok).toHaveLength(1);
    expect(cuarentena[0]).toMatchObject({ sku: 'Z', motivo: 'reserva_sku_sin_producto' });
  });
  it('embarque con sku desconocido → cuarentena embarque', () => {
    const { cuarentena } = checkReferential([{ sku: 'Q' }], valid, 'embarque');
    expect(cuarentena[0].motivo).toBe('embarque_sku_sin_producto');
  });
});
