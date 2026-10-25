import { describe, it, expect } from 'vitest';
import { DETECTORES, revisarLote, hayParada, motivoParada } from './secretos';

// Un cebo de relleno INVENTADO, con la forma de los secretos que el detector busca.
// Cada caso se arma por FRAGMENTOS para que ninguno tenga forma de llave en disco
// (los escáneres de secretos leerían este archivo como una fuga); en memoria
// son idénticos a los de siempre.
const CEBO = [
  ['api_key = sk-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH1234'].join(''),
  ['token: ', ['eyJhbGci', 'OiJIUzI1NiJ9'].join(''), '.', ['eyJzdWIi', 'OiIxMjM0NTY3ODkwIn0'].join('')].join(''),
  ['AKIA', 'IOSFODNN7EXAMPLE'].join(''),
  ['ghp_', 'a'.repeat(36)].join(''),
].join('\n');

const FICHA_LIMPIA = [
  '# Series2',
  '',
  'Display seguro de Brand1. Cable de 28", alarma de 88 dB.',
  '',
  '| Modelo | Cable |',
  '|--------|-------|',
  '| Veb08 | 28" |',
].join('\n');

describe('[INV-B11] los detectores que PARAN', () => {
  it('cazan el cebo — control positivo, porque un 0 sin él es P19', () => {
    const h = revisarLote([{ ruta: 'cebo.md', texto: CEBO }]);
    const paran = h.filter((x) => x.para).map((x) => x.detector);
    expect(paran).toContain('sk- de OpenAI');
    expect(paran).toContain('JWT (eyJ...)');
    expect(paran).toContain('AWS AKIA');
    expect(paran).toContain('GitHub ghp_');
    expect(hayParada(h)).toBe(true);
  });

  it('una ficha de producto normal NO para', () => {
    expect(hayParada(revisarLote([{ ruta: 'Series2.md', texto: FICHA_LIMPIA }]))).toBe(false);
  });

  // ============================================================
  // El falso positivo MEDIDO, convertido en prueba. `Vitrina-Conectada.md` habla de
  // tokens legítimamente y la palabra suelta casaría. Si alguien promoviera ese
  // detector a `para: true`, esta prueba se pone roja y explica por qué.
  // ============================================================
  it('la PALABRA sola avisa pero NO para: pararía sobre documentación correcta', () => {
    const texto = 'El sistema conectado usa un token de sesión para autenticar el display.';
    const h = revisarLote([{ ruta: 'Vitrina-Conectada.md', texto }]);
    expect(h.some((x) => x.detector === 'la PALABRA sola')).toBe(true);
    expect(hayParada(h)).toBe(false);
  });

  it('una RUTA larga no se confunde con base64 al punto de parar', () => {
    const texto = 'Ver `Biblioteca/1. Brand1/2. Series 41/Series2/Series_30.pdf`';
    expect(hayParada(revisarLote([{ ruta: 'x.md', texto }]))).toBe(false);
  });
});

describe('[INV-B11] revisarLote · la firma es la guarda', () => {
  // ============================================================
  // Si esto recibiera UN archivo, el llamador escribiría el bucle natural
  // —revisar, mandar, revisar, mandar— y ese bucle manda los N−1 primeros
  // ANTES de descubrir el secreto del N-ésimo. Recibiendo el lote entero no
  // hay forma de llamarlo tarde.
  // ============================================================
  it('encuentra el secreto aunque esté en el ÚLTIMO archivo del lote', () => {
    const lote = [
      { ruta: 'a.md', texto: FICHA_LIMPIA },
      { ruta: 'b.md', texto: FICHA_LIMPIA },
      { ruta: 'z.md', texto: CEBO },
    ];
    const h = revisarLote(lote);
    expect(hayParada(h)).toBe(true);
    expect(h.filter((x) => x.para).every((x) => x.ruta === 'z.md')).toBe(true);
  });

  it('un lote vacío no para nada', () => {
    expect(hayParada(revisarLote([]))).toBe(false);
    expect(motivoParada([])).toBe('');
  });
});

describe('[INV-B11] motivoParada · nombra el archivo, NUNCA el contenido', () => {
  // ============================================================
  // Un motivo que citara lo que casó metería el secreto en la base Y en los
  // logs — justo de lo que este archivo protege. La regla #8 del proyecto
  // aplica también al mensaje de error.
  // ============================================================
  it('el motivo lleva ruta y detector, y NO el texto que casó', () => {
    const m = motivoParada(revisarLote([{ ruta: 'cebo.md', texto: CEBO }]));
    expect(m).toContain('cebo.md');
    expect(m).toContain('sk- de OpenAI');
    expect(m).toContain('ANTES de mandar nada');
    // Lo que NO puede aparecer:
    expect(m).not.toContain('sk-AAAA');
    expect(m).not.toContain('AKIA' + 'IOSFODNN7EXAMPLE');
    expect(m).not.toContain('ghp_aaaa');
    expect(m).not.toContain('eyJhbGci');
  });
});

describe('[INV-B11] el catálogo de detectores', () => {
  it('cada detector declara QUÉ SE MIDIÓ, no solo qué busca', () => {
    for (const d of DETECTORES) {
      expect(d.medicion.length, `«${d.nombre}» sin medición declarada`).toBeGreaterThan(10);
    }
  });

  it('hay al menos uno que para y al menos uno que no: si todos pararan sería un muro', () => {
    expect(DETECTORES.some((d) => d.para)).toBe(true);
    expect(DETECTORES.some((d) => !d.para)).toBe(true);
  });
});
