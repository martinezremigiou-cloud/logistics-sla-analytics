import { describe, it, expect, vi, afterEach } from 'vitest';
import { hoyMexico } from './fechas';

describe('hoyMexico', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Instante UTC de madrugada: en México (UTC-6) todavía es el día ANTERIOR.
  // Blinda por qué NO se puede usar `new Date().toISOString().slice(0,10)`
  // (ese naive UTC ya "ve" el día siguiente 6h antes de que llegue en México).
  it('a las 03:00 UTC, México todavía está en el día anterior (corrimiento de zona)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T03:00:00.000Z'));

    expect(hoyMexico()).toBe('2026-07-12');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-07-13'); // el naive UTC ya adelantó el día
  });

  it('bien entrada la tarde UTC (14:00 México), la fecha coincide con la de UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T20:00:00.000Z'));

    expect(hoyMexico()).toBe('2026-07-13');
  });

  it('formatea en YYYY-MM-DD (orden ISO, comparable lexicográficamente con `eta`)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-05T12:00:00.000Z'));

    expect(hoyMexico()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
