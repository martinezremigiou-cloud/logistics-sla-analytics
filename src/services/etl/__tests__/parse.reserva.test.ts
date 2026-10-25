import { describe, it, expect } from 'vitest';
import { parseReserva } from '../parse.reserva';
import { loadGrid, realReserva } from './helpers';
import { MUESTRA } from './constantes-muestra';
import type { Grid } from '../types';

describe('parseReserva (edge · depivot KAM×Cliente×fecha×motivo)', () => {
  const { reservas, cuarentena } = parseReserva(loadGrid('edge/reserva.edge.json'));

  const EDGE = MUESTRA.edge.reserva;
  it('depivota la celda válida (RETAILER64, 11, fecha dd-mmm-yy del fixture, Laura)', () => {
    const r = reservas.find((x) => x.cliente === EDGE.valida.cliente);
    expect(r).toMatchObject({
      sku: EDGE.sku,
      kam: EDGE.valida.kam,
      cliente: EDGE.valida.cliente,
      cantidad: EDGE.valida.cantidad,
      motivo: EDGE.valida.motivo,
      fecha: EDGE.valida.fecha,
    });
  });
  it('col B (total-fuente 468) IGNORADA', () => {
    expect(reservas.find((r) => r.cantidad === EDGE.totalFuenteIgnorado)).toBeUndefined();
  });
  it('fecha malformada "19 mar 264" → cuarentena', () => {
    expect(cuarentena.find((c) => c.motivo === 'reserva_fecha_malformada')).toBeDefined();
  });
  it('cliente vacío con qty → cuarentena', () => {
    expect(cuarentena.find((c) => c.motivo === 'reserva_cliente_vacio')).toBeDefined();
  });
  it('fila con ITEM vacío (leyenda) y TOTALES saltadas', () => {
    expect(reservas.every((r) => r.sku === 'SKU-1')).toBe(true);
  });
});

describe('parseReserva (fixture de muestra)', () => {
  const { reservas, cuarentena } = parseReserva(realReserva());
  it('produce reservas des-pivoteadas (cantidad por construcción del generador)', () => expect(reservas.length).toBe(MUESTRA.abril.reservas));
  it('las celdas con fecha malformada van a cuarentena (conteo por construcción)', () => {
    expect(cuarentena.filter((c) => c.motivo === 'reserva_fecha_malformada')).toHaveLength(MUESTRA.abril.reservasMalformadas);
  });
  it('todas con cantidad > 0 y cliente no vacío', () => {
    expect(reservas.every((r) => r.cantidad > 0 && r.cliente.length > 0)).toBe(true);
  });
  it('KAMs de ejemplo aparecen (LAURA/LUCAS, sembrados) y son EXACTAMENTE los del modelo', () => {
    const kams = new Set(reservas.map((r) => (r.kam ?? '').toUpperCase()).filter((k) => k !== ''));
    expect(kams.has('LAURA')).toBe(true);
    expect(kams.has('LUCAS')).toBe(true);
    expect(Array.from(kams).sort()).toEqual(MUESTRA.abril.kamsConReserva);
  });
});

// Fix A (columna fantasma 'TOTALES', hallazgo QA en BD viva): la hoja
// Reserva es un PIVOTE (filas=SKU, columnas=cliente). El
// parser ya filtraba la FILA de totales (sku === 'TOTALES'/'TOTAL', arriba)
// pero NO la COLUMNA: el libro de julio trae una columna-cliente 'TOTALES'
// (suma por fila) que se ingería como cliente real -> reservas fantasma
// (cantidad == productos.resv exacto) y reserva_descuadre=true
// artificiales (Sigma inflada x2), visibles en fichas como cliente 'TOTALES'.
describe('parseReserva — columna-resumen TOTALES del pivote (fix A)', () => {
  // RETAILER64 (col C) y RETAILER 56 (col D) son reservas reales; la columna
  // 'TOTALES' (col E) es la suma por fila (7 + 15 = 22) — NUNCA un cliente.
  function gridConColumnaTotales(headerColumnaResumen: string): Grid {
    return [
      ['DEMO COMERCIAL S DE RL DE CV'],
      [],
      [],
      [],
      [null, null, 'Laura', 'Lucas', 'Laura'],
      [],
      ['STOCK MEXICO', null, '23-abr-26', '23-abr-26', '23-abr-26'],
      [null, null, 'pedido A', 'pedido B', 'pedido A'],
      ['ITEM', null, 'RETAILER64', 'RETAILER 56', headerColumnaResumen],
      ['SKU-1', '22', '7', '15', '22'],
    ];
  }

  it('[BUG reproducido] columna TOTALES: ni reserva fantasma ni cuarentena; las reservas reales de las demás columnas quedan intactas', () => {
    // Este test documenta el bug tal cual estaba: contra el parser SIN el
    // fix, `fantasma` existe (cliente 'TOTALES', cantidad 22 = 7+15) y el
    // test FALLA. En cuanto se aplica el fix, pasa.
    const { reservas, cuarentena } = parseReserva(gridConColumnaTotales('TOTALES'));

    const fantasma = reservas.find((r) => r.cliente === 'TOTALES');
    expect(fantasma).toBeUndefined();
    expect(reservas.find((r) => r.cantidad === 22)).toBeUndefined();
    expect(cuarentena).toHaveLength(0); // se salta ANTES de cualquier chequeo de cuarentena

    expect(reservas).toHaveLength(2);
    expect(reservas.find((r) => r.cliente === 'RETAILER64')).toMatchObject({
      sku: 'SKU-1', kam: 'Laura', cliente: 'RETAILER64', cantidad: 7, motivo: 'pedido A', fecha: '2026-04-23',
    });
    expect(reservas.find((r) => r.cliente === 'RETAILER 56')).toMatchObject({
      sku: 'SKU-1', kam: 'Lucas', cliente: 'RETAILER 56', cantidad: 15, motivo: 'pedido B', fecha: '2026-04-23',
    });
  });

  it.each(['Totales', ' TOTAL ', 'total', ' totales '])(
    'variante de caja/espacios en el header de columna "%s" también se excluye',
    (variante) => {
      const { reservas } = parseReserva(gridConColumnaTotales(variante));
      expect(reservas).toHaveLength(2);
      expect(reservas.some((r) => ['TOTALES', 'TOTAL'].includes(r.cliente.trim().toUpperCase()))).toBe(false);
    },
  );

  it('regresión: la FILA TOTALES sigue filtrada (filtro original intacto)', () => {
    const base = gridConColumnaTotales('TOTALES');
    const gridSoloFilaTotales: Grid = [...base.slice(0, 9), ['TOTALES', '999', '2', '3', '5']];
    const { reservas } = parseReserva(gridSoloFilaTotales);
    expect(reservas).toHaveLength(0); // única fila de datos ERA la fila TOTALES -> nada que depivotar
  });

  it('regresión: fila SKU real + fila TOTALES + columna TOTALES, las 3 reglas conviven en el mismo archivo', () => {
    const base = gridConColumnaTotales('TOTALES');
    const gridCompleto: Grid = [...base, ['TOTALES', '999', '2', '3', '5']];
    const { reservas } = parseReserva(gridCompleto);
    expect(reservas).toHaveLength(2);
    expect(reservas.every((r) => r.sku === 'SKU-1')).toBe(true);
    expect(reservas.some((r) => r.cliente === 'TOTALES')).toBe(false);
  });
});
