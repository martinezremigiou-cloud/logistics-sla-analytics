// ============================================================
// [2.0.1-A · D2] drift-familias.test.ts
//
// El prototipo de O3 ya traía un fixture con los cuatro eventos plantados y sus
// cinco aserciones. Al pasar de investigación a producto se le añade lo que le
// faltaba: **controles negativos SEPARADOS, uno por cláusula**. El fixture
// original tenía un solo caso negativo que fallaba TRES cláusulas a la vez
// (movimiento suelto: no llega al umbral, su origen no se vacía y su destino no
// es alta) — con eso, quitar cualquiera de las tres seguía dando verde. Un
// control sobredeterminado no prueba lo que parece probar: es P19 con otro
// traje, y aquí se parte en tres.
// ============================================================
import { describe, it, expect } from 'vitest';
import { UMBRAL_BLOQUE, analizarCorrida, puentesSinCamino, type EntradaCorrida } from './drift-familias';

/** El caso completo: renombre probable con ficha que debería seguir a sus SKU. */
function entradaBase(overrides: Partial<EntradaCorrida> = {}): EntradaCorrida {
  return {
    cambiosFamilia: [
      { sku: 'S1', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
      { sku: 'S2', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
      { sku: 'S3', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
      { sku: 'S4', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
    ],
    familiasNuevas: new Set(['NUEVA-X']),
    conteoVigente: new Map([
      ['VIEJA-P', 0],
      ['NUEVA-X', 4],
    ]),
    puentes: new Map([['VIEJA-P', 'fichas/vieja-p.md']]),
    ...overrides,
  };
}

describe('[2.0.1-A · D2] analizarCorrida — los cuatro eventos de una re-ramificación', () => {
  it('alta, vaciada CON PUENTE, renombre probable y propuesta de ficha: los cuatro, con sus números', () => {
    const r = analizarCorrida(entradaBase());
    expect(r.altas).toEqual(['NUEVA-X']);
    expect(r.vaciadas).toEqual([{ nombre: 'VIEJA-P', teniaPuente: true }]);
    expect(r.movimientos).toEqual([{ de: 'VIEJA-P', a: 'NUEVA-X', n: 4 }]);
    expect(r.renombresProbables).toEqual([{ de: 'VIEJA-P', a: 'NUEVA-X', n: 4 }]);
    expect(r.propuestasPuente).toEqual([{ de: 'VIEJA-P', a: 'NUEVA-X', n: 4, ficha: 'fichas/vieja-p.md' }]);
  });

  // ============================================================
  // LOS TRES CONTROLES NEGATIVOS, cada uno fallando UNA SOLA cláusula. Es lo
  // que el fixture del prototipo no tenía: si el negativo falla tres a la vez,
  // quitar cualquiera de las tres condiciones lo deja pasando igual.
  // ============================================================
  it('SOLO falla el umbral: 2 SKU juntos, origen vaciado y destino recién nacido → NO es renombre probable', () => {
    const r = analizarCorrida(
      entradaBase({
        cambiosFamilia: [
          { sku: 'S1', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
          { sku: 'S2', valor_anterior: 'VIEJA-P', valor_nuevo: 'NUEVA-X' },
        ],
      }),
    );
    expect(r.movimientos).toEqual([{ de: 'VIEJA-P', a: 'NUEVA-X', n: 2 }]);
    expect(2).toBeLessThan(UMBRAL_BLOQUE); // la única condición que falla
    expect(r.renombresProbables).toEqual([]);
    expect(r.propuestasPuente).toEqual([]); // la propuesta comparte el umbral
    expect(r.vaciadas).toEqual([{ nombre: 'VIEJA-P', teniaPuente: true }]); // lo demás SÍ se detecta
  });

  it('SOLO falla el vaciado: 4 SKU juntos hacia una familia nueva, pero el origen conserva SKUs → no es renombre (sí propuesta)', () => {
    const r = analizarCorrida(
      entradaBase({ conteoVigente: new Map([['VIEJA-P', 5], ['NUEVA-X', 4]]) }),
    );
    expect(r.vaciadas).toEqual([]);
    expect(r.renombresProbables).toEqual([]);
    // La propuesta de ficha NO exige vaciado: que una familia con ficha ceda un
    // bloque a otra sin ficha ya es motivo para preguntarle a un humano.
    expect(r.propuestasPuente).toHaveLength(1);
  });

  it('SOLO falla el alta: 4 SKU juntos desde un origen vaciado hacia una familia PREEXISTENTE → no es renombre', () => {
    const r = analizarCorrida(entradaBase({ familiasNuevas: new Set() }));
    expect(r.altas).toEqual([]);
    expect(r.renombresProbables).toEqual([]);
    expect(r.vaciadas).toEqual([{ nombre: 'VIEJA-P', teniaPuente: true }]);
  });

  it('una familia vaciada SIN puente se reporta igual, pero declarando que no había ficha que seguir', () => {
    const r = analizarCorrida(entradaBase({ puentes: new Map() }));
    expect(r.vaciadas).toEqual([{ nombre: 'VIEJA-P', teniaPuente: false }]);
    expect(r.propuestasPuente).toEqual([]);
  });

  it('ignora el ruido: cambios sin origen, sin destino o de una familia a sí misma', () => {
    const r = analizarCorrida(
      entradaBase({
        cambiosFamilia: [
          { sku: 'S1', valor_anterior: null, valor_nuevo: 'NUEVA-X' },
          { sku: 'S2', valor_anterior: 'VIEJA-P', valor_nuevo: null },
          { sku: 'S3', valor_anterior: 'IGUAL', valor_nuevo: 'IGUAL' },
        ],
      }),
    );
    expect(r.movimientos).toEqual([]);
    expect(r.renombresProbables).toEqual([]);
  });

  it('sin cambios: reporte vacío, y eso es un HECHO medido, no un no-medido', () => {
    const r = analizarCorrida(entradaBase({ cambiosFamilia: [], familiasNuevas: new Set() }));
    expect(r.movimientos).toEqual([]);
    expect(r.vaciadas).toEqual([]);
    expect(r.altas).toEqual([]);
  });
});

describe('[2.0.1-A · D2] puentesSinCamino — el titular es DOCUMENTOS, no filas (P27)', () => {
  it('cuenta los documentos ALCANZABLES por SKU, que es la pregunta que un humano hace', () => {
    const t = puentesSinCamino({
      puentes: new Map([
        ['VIVA-1', 'fichas/a.md'],
        ['VIVA-2', 'fichas/a.md'], // dos familias, UNA ficha: el documento se cuenta una vez
        ['MUERTA-1', 'fichas/b.md'],
        ['MUERTA-2', 'fichas/c.md'],
      ]),
      familiasConSkuVigente: new Set(['VIVA-1', 'VIVA-2', 'OTRA-SIN-PUENTE']),
    });
    expect(t.filasTotales).toBe(4);
    expect(t.filasSinCamino).toBe(2);
    // Y aquí está la diferencia que P27 nombra: 2 filas vivas, pero UN solo
    // documento alcanzable. Contar filas habría dicho 2.
    expect(t.documentosAlcanzablesPorSku).toBe(1);
    expect(t.sinCamino).toEqual(['MUERTA-1', 'MUERTA-2']);
  });

  it('el caso sano: todas las familias puenteadas tienen SKU → nada sin camino', () => {
    const t = puentesSinCamino({
      puentes: new Map([['VIVA', 'fichas/a.md']]),
      familiasConSkuVigente: new Set(['VIVA']),
    });
    expect(t.filasSinCamino).toBe(0);
    expect(t.documentosAlcanzablesPorSku).toBe(1);
    expect(t.sinCamino).toEqual([]);
  });

  it('el caso que este bloque vio de verdad: casi todo el puente sin camino', () => {
    // Forma de lo medido: casi todas las filas sin camino, solo unas pocas vivas.
    const puentes = new Map<string, string>();
    for (let i = 0; i < 33; i++) puentes.set(`F${i}`, `fichas/f${i}.md`);
    const t = puentesSinCamino({ puentes, familiasConSkuVigente: new Set(['F0', 'F1', 'F2', 'F3']) });
    expect(t.filasSinCamino).toBe(29);
    expect(t.documentosAlcanzablesPorSku).toBe(4);
  });
});
