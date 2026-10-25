import { describe, it, expect } from 'vitest';
import { volcarSeleccionSchema, MAX_PARTIDAS, MAX_CANTIDAD } from './proyectos.schema';

// ============================================================
// El contrato del volcado, comprobado en la SUITE.
//
// Un arnés de seguridad contra el servicio real ya lo ejercitaba con salida literal, pero ese
// arnés necesitaba `.env.local`, cuentas efímeras y Postgres real: no corre en
// cada `npm test`. Esta parte —la que no necesita base— sí tiene que correr
// siempre, porque es la que impide que alguien afloje el contrato sin enterarse.
// ============================================================

const item = (over: Record<string, unknown> = {}) => ({ sku: 'SUJ500-F', cantidad: 40, cantidadVista: 0, ...over });

describe('[INV-B8.2] volcarSeleccionSchema', () => {
  it('acepta un volcado bien formado y normaliza el SKU', () => {
    const r = volcarSeleccionSchema.safeParse({ items: [item({ sku: '  suj500-f ' })] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.items[0].sku).toBe('SUJ500-F');
  });

  it.each([
    ['cantidad 0', { cantidad: 0 }],
    ['cantidad negativa', { cantidad: -5 }],
    ['cantidad decimal', { cantidad: 2.5 }],
    ['cantidad por encima del tope', { cantidad: MAX_CANTIDAD + 1 }],
    ['cantidadVista negativa', { cantidadVista: -1 }],
    ['cantidadVista decimal', { cantidadVista: 0.5 }],
    ['sku vacío', { sku: '   ' }],
  ])('rechaza %s', (_etiqueta, over) => {
    expect(volcarSeleccionSchema.safeParse({ items: [item(over)] }).success).toBe(false);
  });

  it('`cantidadVista` SÍ admite 0 — es el caso normal: el SKU no estaba en el proyecto', () => {
    expect(volcarSeleccionSchema.safeParse({ items: [item({ cantidadVista: 0 })] }).success).toBe(true);
  });

  it('rechaza el mismo SKU dos veces, aunque venga con otra capitalización', () => {
    const r = volcarSeleccionSchema.safeParse({
      items: [item(), item({ sku: 'suj500-f', cantidad: 9 })],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      // El mensaje nombra el SKU: un "duplicado" a secas obligaría a buscarlo.
      expect(r.error.issues.some((i) => i.message.includes('SUJ500-F'))).toBe(true);
      expect(r.error.issues.some((i) => i.path.join('.') === 'items.1.sku')).toBe(true);
    }
  });

  it('rechaza un volcado vacío: un POST sin renglones es un error del llamador, no un no-op', () => {
    expect(volcarSeleccionSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it(`rechaza más de ${MAX_PARTIDAS} renglones — espejo del tope de la Selección`, () => {
    const muchos = Array.from({ length: MAX_PARTIDAS + 1 }, (_, i) => item({ sku: `X-${i}` }));
    expect(volcarSeleccionSchema.safeParse({ items: muchos }).success).toBe(false);
    expect(volcarSeleccionSchema.safeParse({ items: muchos.slice(0, MAX_PARTIDAS) }).success).toBe(true);
  });

  it('ignora campos de más: un `proyecto_id` colado en el renglón no llega al servicio', () => {
    const r = volcarSeleccionSchema.safeParse({
      items: [{ ...item(), proyecto_id: '11111111-1111-1111-1111-111111111111', cantidadFinal: 999_999 }],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(Object.keys(r.data.items[0]).sort()).toEqual(['cantidad', 'cantidadVista', 'sku']);
    }
  });

  it('rechaza un cuerpo sin `items`', () => {
    expect(volcarSeleccionSchema.safeParse({}).success).toBe(false);
    expect(volcarSeleccionSchema.safeParse({ items: 'SUJ500-F' }).success).toBe(false);
  });
});
