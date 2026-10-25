import { describe, it, expect } from 'vitest';
import { formatoNumero, formatoFecha, formatoFechaHora, formatoPeriodoCorto } from './formato';

describe('formatoNumero', () => {
  it('agrupa miles con separador es-MX', () => {
    expect(formatoNumero(1234567)).toBe('1,234,567');
  });

  it('formatea cero', () => {
    expect(formatoNumero(0)).toBe('0');
  });

  it('formatea negativos', () => {
    expect(formatoNumero(-42)).toBe('-42');
  });
});

describe('formatoFecha', () => {
  it('formatea una fecha ISO en es-MX (día mes año)', () => {
    expect(formatoFecha('2026-07-12T15:30:00.000Z')).toBe('12 jul 2026');
  });

  // C1 (regresión): los campos reales que alimentan este helper (eta,
  // fecha_disponibilidad, reservas.fecha) son date-only 'YYYY-MM-DD', no
  // timestamps. `new Date('YYYY-MM-DD')` = medianoche UTC; sin
  // `timeZone: 'UTC'` en formatoFecha, el runtime en UTC-6 (México) lo
  // rendería como el día ANTERIOR (off-by-one). Blinda el fix.
  it('date-only "YYYY-MM-DD": no corre un día hacia atrás en zonas UTC-6', () => {
    expect(formatoFecha('2026-07-12')).toBe('12 jul 2026');
  });

  it('date-only, caso de frontera (fin/inicio de año)', () => {
    expect(formatoFecha('2026-01-01')).toBe('01 ene 2026');
  });

  it('null → "—"', () => {
    expect(formatoFecha(null)).toBe('—');
  });
});

describe('formatoFechaHora', () => {
  it('formatea fecha y hora ISO en es-MX', () => {
    expect(formatoFechaHora('2026-07-12T15:30:00.000Z')).toBe('12 jul 2026, 09:30 a.m.');
  });

  it('null → "—"', () => {
    expect(formatoFechaHora(null)).toBe('—');
  });
});

// Promovido desde `components/dashboard/dashboard-formato.test.ts` (fix M7,
// ronda 2 de revisor-codigo): ver doc-comment de `formatoPeriodoCorto`.
describe('formatoPeriodoCorto', () => {
  it("'2026-04' → 'abr 2026'", () => {
    expect(formatoPeriodoCorto('2026-04')).toBe('abr 2026');
  });

  it("'2026-07' → 'jul 2026'", () => {
    expect(formatoPeriodoCorto('2026-07')).toBe('jul 2026');
  });

  it("'2026-01' → 'ene 2026' (sin off-by-one de zona horaria)", () => {
    expect(formatoPeriodoCorto('2026-01')).toBe('ene 2026');
  });

  it("'2026-12' → 'dic 2026'", () => {
    expect(formatoPeriodoCorto('2026-12')).toBe('dic 2026');
  });
});
