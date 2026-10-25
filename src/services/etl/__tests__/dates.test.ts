import { describe, it, expect } from 'vitest';
import { parseFecha } from '../dates';

describe('parseFecha', () => {
  it('español dd-mmm-yy → ISO', () => expect(parseFecha('23-abr-26')).toBe('2026-04-23'));
  it('español con espacios dd mmm yy', () => expect(parseFecha('19 mar 26')).toBe('2026-03-19'));
  it('mes enero', () => expect(parseFecha('27-ene-26')).toBe('2026-01-27'));
  it('mes diciembre', () => expect(parseFecha('05-dic-25')).toBe('2025-12-05'));
  it('malformado 19 mar 264 → null', () => expect(parseFecha('19 mar 264')).toBeNull());
  it('ISO YYYY-MM-DD', () => expect(parseFecha('2026-04-23')).toBe('2026-04-23'));
  it('ISO con hora', () => expect(parseFecha('2026-03-27T00:00:00')).toBe('2026-03-27'));
  it('Date → ISO (UTC)', () =>
    expect(parseFecha(new Date(Date.UTC(2026, 5, 17)))).toBe('2026-06-17'));
  it('serial Excel 46112 (approx) es válido', () => {
    const r = parseFecha(46000);
    expect(r).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('dd/mm/yyyy', () => expect(parseFecha('27/03/2026')).toBe('2026-03-27'));
  it('mes inválido → null', () => expect(parseFecha('10-xyz-26')).toBeNull());
  it('vacío → null', () => expect(parseFecha('')).toBeNull());
  it('null → null', () => expect(parseFecha(null)).toBeNull());
  it('día fuera de rango → null', () => expect(parseFecha('32-ene-26')).toBeNull());
});
