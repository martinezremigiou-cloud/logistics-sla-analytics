import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOKENS, PROCEDENCIA, type RolDeColor } from './tokens';

// ============================================================
// [INV-B8.2] B81-2 — la deuda que cierra este archivo.
//
// Los generadores de documentos NO pueden leer CSS: corren en servidor, sin
// navegador y sin Tailwind. El valor tiene que estar duplicado en algún lado, y
// el bloque INV-B8.1 resolvió la mitad del problema —que la duplicación viva en
// UN archivo (`tokens.ts`) y no dispersa en literales—. La otra mitad quedó
// abierta: **nada comprobaba que ese archivo siguiera coincidiendo con
// `globals.css`.** Cambiar la marca en el CSS dejaba el documento atrás sin que
// nada gritara, y el comentario de procedencia de `tokens.ts` pasaba de
// documentación a afirmación falsa.
//
// La deuda estimaba que cerrarlo exigía un paso de build. No hacía falta: se
// parsea el CSS FUENTE (no el compilado) y se compara. Corre en cada `npm test`.
//
// SE COMPARA CONTRA `:root`, NO CONTRA `.dark`, y es una decisión: los
// documentos se imprimen en papel. Si se comparara contra el bloque oscuro,
// `--mx-navy-ink` sería `#9CC1F0` y la prueba exigiría un azul claro sobre
// papel blanco.
// ============================================================

/**
 * Las custom properties `--mx-*` del bloque `:root` de `globals.css`.
 *
 * El corte del bloque es literal —de `:root {` al primer `}`— y eso es válido
 * porque ese bloque no tiene llaves anidadas. Si algún día las tuviera, la
 * prueba de abajo que cuenta los tokens leídos se pondría roja antes de que
 * este parser empezara a mentir.
 */
function tokensDeRoot(): Map<string, string> {
  const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
  const inicio = css.indexOf(':root {');
  if (inicio === -1) throw new Error('No se encontró el bloque `:root` en globals.css.');
  const fin = css.indexOf('}', inicio);
  if (fin === -1) throw new Error('El bloque `:root` de globals.css no cierra.');

  const bloque = css.slice(inicio, fin);
  const encontrados = new Map<string, string>();
  // `exec` en bucle y no `matchAll`: el `target` de este tsconfig no permite
  // iterar el resultado de `matchAll` sin `downlevelIteration`, y vitest —que
  // transpila con esbuild— lo dejaría pasar en verde mientras `tsc` falla.
  const re = /(--mx-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bloque)) !== null) {
    encontrados.set(m[1], m[2].trim());
  }
  return encontrados;
}

describe('[INV-B8.2 · B81-2] los tokens del documento siguen a globals.css', () => {
  const root = tokensDeRoot();

  it('el parser encontró el bloque de verdad, no una lista vacía', () => {
    // Sin esta afirmación, un `globals.css` renombrado o un `:root` movido
    // dejaría un mapa vacío y TODAS las comprobaciones de abajo pasarían por
    // vacuidad — el patrón P17 del repo, aplicado a su propia guarda.
    expect(root.size, 'el bloque `:root` no trajo tokens `--mx-*`').toBeGreaterThan(20);
    expect(root.get('--mx-surface')).toBe('#FFFFFF');
  });

  it.each(Object.keys(TOKENS) as RolDeColor[])(
    'TOKENS.%s vale lo mismo que su custom property',
    (rol) => {
      const propiedad = PROCEDENCIA[rol];
      const enCss = root.get(propiedad);
      expect(enCss, `globals.css no define ${propiedad} en :root`).toBeDefined();
      // Comparación insensible a mayúsculas: `#FFFFFF` y `#ffffff` son el mismo
      // color, y fallar por eso sería ruido.
      expect(TOKENS[rol].toUpperCase(), `${rol} (${propiedad}) se desincronizó`).toBe(enCss!.toUpperCase());
    },
  );

  it('cada token declara su procedencia: no hay ninguno huérfano', () => {
    // Un token nuevo sin entrada en PROCEDENCIA se colaría sin comparar nada, y
    // la deuda volvería a abrirse por la puerta de atrás. El tipo
    // `Record<RolDeColor, string>` ya lo obliga en compilación; esto lo afirma
    // también en ejecución, para el día que alguien relaje el tipo.
    expect(Object.keys(PROCEDENCIA).sort()).toEqual(Object.keys(TOKENS).sort());
  });

  it('el navy del documento es el MISMO que el de la marca en tailwind.config', () => {
    // La cabecera de `tokens.ts` afirma dos procedencias para este valor
    // (`navy.700` y `--mx-navy-ink`). La segunda ya se comprueba arriba; ésta
    // es la primera, y las dos juntas son lo que garantiza que el documento y
    // la aplicación pinten el mismo azul.
    const config = readFileSync(join(process.cwd(), 'tailwind.config.ts'), 'utf8');
    const navy700 = /navy:\s*\{[^}]*700:\s*"(#[0-9A-Fa-f]{6})"/.exec(config);
    expect(navy700, 'no se encontró navy.700 en tailwind.config.ts').not.toBeNull();
    expect(TOKENS.navy.toUpperCase()).toBe(navy700![1].toUpperCase());
  });
});
