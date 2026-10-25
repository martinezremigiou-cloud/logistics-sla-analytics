// ============================================================
// [REPRODUCIBILIDAD · S7-A] leerForzadoUniversoReducido — unidad pura,
// sin tocar rutas: cubre las combinaciones de las tres cabeceras del
// escape hatch (Enmienda 2) independientemente de cuál ruta las
// consuma.
// ============================================================
import { describe, it, expect } from 'vitest';
import { leerForzadoUniversoReducido } from './forzar-universo';

const MOTIVO_VALIDO = 'Demo dio de baja la línea completa este mes.'; // 49 chars, dentro de 12..300
const POR_VALIDO = 'hugo@example.com'; // 18 chars, dentro de 3..120

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/refresh', { headers });
}

describe('leerForzadoUniversoReducido', () => {
  it('sin ninguna de las tres cabeceras → forzado null, intentoInvalido null (no hubo intento)', () => {
    const out = leerForzadoUniversoReducido(req({}));
    expect(out).toEqual({ forzado: null, intentoInvalido: null });
  });

  it('las tres cabeceras completas y válidas → forzado armado con por/motivo', () => {
    const out = leerForzadoUniversoReducido(
      req({
        'x-forzar-universo-reducido': 'si',
        'x-forzar-motivo': MOTIVO_VALIDO,
        'x-forzar-por': POR_VALIDO,
      }),
    );
    expect(out).toEqual({ forzado: { por: POR_VALIDO, motivo: MOTIVO_VALIDO }, intentoInvalido: null });
  });

  it('falta x-forzar-universo-reducido (las otras dos presentes) → intentoInvalido nombra esa cabecera', () => {
    const out = leerForzadoUniversoReducido(
      req({ 'x-forzar-motivo': MOTIVO_VALIDO, 'x-forzar-por': POR_VALIDO }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-universo-reducido/);
  });

  it('x-forzar-universo-reducido con un valor distinto de "si" → inválida, se trata igual que ausente', () => {
    const out = leerForzadoUniversoReducido(
      req({
        'x-forzar-universo-reducido': 'yes',
        'x-forzar-motivo': MOTIVO_VALIDO,
        'x-forzar-por': POR_VALIDO,
      }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-universo-reducido/);
  });

  it('falta x-forzar-motivo → intentoInvalido nombra esa cabecera', () => {
    const out = leerForzadoUniversoReducido(
      req({ 'x-forzar-universo-reducido': 'si', 'x-forzar-por': POR_VALIDO }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-motivo/);
  });

  it('x-forzar-motivo demasiado corto (< 12 caracteres) → inválida', () => {
    const out = leerForzadoUniversoReducido(
      req({ 'x-forzar-universo-reducido': 'si', 'x-forzar-motivo': 'muy corto', 'x-forzar-por': POR_VALIDO }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-motivo/);
  });

  it('x-forzar-motivo demasiado largo (> 300 caracteres) → inválida', () => {
    const out = leerForzadoUniversoReducido(
      req({
        'x-forzar-universo-reducido': 'si',
        'x-forzar-motivo': 'x'.repeat(301),
        'x-forzar-por': POR_VALIDO,
      }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-motivo/);
  });

  it('falta x-forzar-por → intentoInvalido nombra esa cabecera', () => {
    const out = leerForzadoUniversoReducido(
      req({ 'x-forzar-universo-reducido': 'si', 'x-forzar-motivo': MOTIVO_VALIDO }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-por/);
  });

  it('x-forzar-por demasiado corto (< 3 caracteres) → inválida', () => {
    const out = leerForzadoUniversoReducido(
      req({ 'x-forzar-universo-reducido': 'si', 'x-forzar-motivo': MOTIVO_VALIDO, 'x-forzar-por': 'ab' }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-por/);
  });

  it('x-forzar-por demasiado largo (> 120 caracteres) → inválida', () => {
    const out = leerForzadoUniversoReducido(
      req({
        'x-forzar-universo-reducido': 'si',
        'x-forzar-motivo': MOTIVO_VALIDO,
        'x-forzar-por': 'p'.repeat(121),
      }),
    );
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).toMatch(/x-forzar-por/);
  });

  it('solo UNA de las tres presente (las otras dos ausentes) → sigue siendo intento incompleto, no forzado', () => {
    const out = leerForzadoUniversoReducido(req({ 'x-forzar-por': POR_VALIDO }));
    expect(out.forzado).toBeNull();
    expect(out.intentoInvalido).not.toBeNull();
  });
});
