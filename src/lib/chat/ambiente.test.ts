// ============================================================
// [INV-B11] O6 · EL AMBIENTE, probado sin base y sin navegador.
//
// Que estas reglas sean puras es la decisión, no el efecto secundario: **la
// parte delicada del ambiente no es leer una ruta, es NO pasarse** — rellenar
// solo donde nadie dijo nada, y no aportar SKU desde una pantalla que no lo
// tiene. Eso es una regla, y una regla se prueba sin infraestructura.
// ============================================================
import { describe, it, expect } from 'vitest';
import { skuDelAmbiente, admiteAmbiente, notaDeAmbiente } from './ambiente';

describe('[INV-B11] el SKU que implica una ruta', () => {
  it('la ficha de un SKU SÍ aporta contexto', () => {
    expect(skuDelAmbiente({ ruta: '/catalogo/KYA2490' })).toBe('KYA2490');
    expect(skuDelAmbiente({ ruta: '/catalogo/KYA2490/' })).toBe('KYA2490');
    // Normalizado, como lo hace `resolverSku` con lo que teclea el usuario.
    expect(skuDelAmbiente({ ruta: '/catalogo/kya2490' })).toBe('KYA2490');
  });

  it('la query y el hash no son parte del SKU', () => {
    expect(skuDelAmbiente({ ruta: '/catalogo/KYA2490?tab=stock' })).toBe('KYA2490');
    expect(skuDelAmbiente({ ruta: '/catalogo/KYA2490#imagen' })).toBe('KYA2490');
  });

  it('un SKU con caracteres codificados se decodifica', () => {
    // El catálogo tiene SKU con espacios: `DN-HN73 BOTTLE TAG 58KHZ`.
    expect(skuDelAmbiente({ ruta: '/catalogo/DN-HN73%20BOTTLE%20TAG%2058KHZ' })).toBe('DN-HN73 BOTTLE TAG 58KHZ');
  });

  it('NINGUNA lista aporta contexto: una lista no es un contexto', () => {
    // Es la mitad que impide que esto invente. En `/catalogo` hay cientos de
    // renglones y ninguno es «el» SKU; elegir uno sería adivinar, que es
    // exactamente lo que el bloque prohíbe.
    for (const ruta of ['/catalogo', '/catalogo/', '/', '/cruce', '/proyectos', '/embarques', '/snapshots', '/config']) {
      expect(skuDelAmbiente({ ruta }), `«${ruta}» aportó un SKU y no debería`).toBeNull();
    }
  });

  it('rutas rotas o ausentes no aportan y no lanzan', () => {
    expect(skuDelAmbiente(null)).toBeNull();
    expect(skuDelAmbiente(undefined)).toBeNull();
    expect(skuDelAmbiente({ ruta: '' })).toBeNull();
    expect(skuDelAmbiente({ ruta: '/catalogo/   ' })).toBeNull();
    // Un `%` mal formado hace lanzar a `decodeURIComponent`. Una ruta rota es
    // «no hay contexto», no un 500.
    expect(skuDelAmbiente({ ruta: '/catalogo/%E0%A4%A' })).toBeNull();
    expect(skuDelAmbiente({ ruta: '/catalogo/KYA2490/extra' })).toBeNull();
  });

  it('CONTROL POSITIVO · el extractor NO devuelve null siempre', () => {
    // Sin esto, un `skuDelAmbiente` roto —que devolviera `null` sin mirar—
    // pondría en verde todas las pruebas de «no aporta» de arriba, que son la
    // mayoría. Es el troceador que no troceaba, en una regla de rutas.
    expect(skuDelAmbiente({ ruta: '/catalogo/KL2722' })).toBe('KL2722');
  });
});

describe('[INV-B11] el ambiente RELLENA un hueco; nunca corrige a nadie', () => {
  it('con la pregunta sin SKU y sin término, el ambiente puede decidir', () => {
    expect(admiteAmbiente({ tipo: 'intencion', sku: null, termino: null })).toBe(true);
  });

  it('si el usuario escribió un SKU, ÉSE manda', () => {
    expect(admiteAmbiente({ tipo: 'intencion', sku: 'SUJ500-F', termino: null })).toBe(false);
  });

  it('si el usuario dijo un nombre, ÉSE manda', () => {
    // La línea que separa «ayudar» de «cambiarle la pregunta a la gente»:
    // alguien en la ficha de KYA2490 que pregunta por los CLIPS está
    // preguntando por los CLIPS.
    expect(admiteAmbiente({ tipo: 'intencion', sku: null, termino: 'CLIPS' })).toBe(false);
  });

  it('lo que NO es una intención no se completa: no hay qué completar', () => {
    expect(admiteAmbiente({ tipo: 'no_soportado', sku: null, termino: null })).toBe(false);
    expect(admiteAmbiente({ tipo: 'no_soportado', sku: 'KL2722', termino: null })).toBe(false);
  });
});

describe('[INV-B11] cuando el ambiente decide, la respuesta lo DICE', () => {
  it('la nota nombra el SKU y explica de dónde salió', () => {
    // No estaba en el brief y hace falta: un número exacto sobre un SKU que
    // nadie nombró, sin avisar, es la misma clase de daño que adivinar entre
    // decenas de candidatos — solo que más convincente, porque acertó.
    const nota = notaDeAmbiente('KYA2490');
    expect(nota).toContain('KYA2490');
    expect(nota).toMatch(/tienes abierta|abierta/);
  });
});
