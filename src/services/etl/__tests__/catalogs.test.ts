import { describe, it, expect } from 'vitest';
import { resolveMarca, resolveFamilia, resolveAlmacen, resolveKam, resolveEstatus } from '../catalogs';
import { normalizeAliasKey } from '../normalize';
import { makeCatalogIndex } from './helpers';

const idx = makeCatalogIndex();

describe('resolveMarca', () => {
  it('marca conocida por nombre', () => expect(resolveMarca('SERIES5', idx).marca_id).toBeDefined());
  it('alias brand1 (minúsculas)', () => expect(resolveMarca('brand1', idx).marca_id).toBeDefined());
  it("alias 'BRAND 6' → BRAND6", () =>
    expect(resolveMarca('BRAND 6', idx).marca_id).toBe(idx.marcaByNombre.get('BRAND6')));
  it('marca nueva (BRAND5) → nueva', () => expect(resolveMarca('BRAND5', idx)).toEqual({ nueva: 'BRAND5' }));
  it('marca nueva (BRAND9)', () => expect(resolveMarca('BRAND9', idx).nueva).toBe('BRAND9'));
  it('vacía → {}', () => expect(resolveMarca('  ', idx)).toEqual({}));
});

describe('resolveFamilia', () => {
  it('familia nueva → nueva (catálogo vacío)', () =>
    expect(resolveFamilia('SERIES11', idx)).toEqual({ nueva: 'SERIES11' }));
  it('null → null', () => expect(resolveFamilia(null, idx)).toBeNull());

  // ([MVP-2] C) El alias, con pares de errata como los del catálogo real.
  describe('alias de familia', () => {
    function idxConAlias() {
      const i = makeCatalogIndex();
      i.familiaByNombre.set('SERIES 2', 'fam-series2');
      i.familiaByNombre.set('SERIES2', 'fam-errata');
      i.familiaAlias.set(normalizeAliasKey('SERIES2'), 'fam-series2');
      return i;
    }

    it('el alias GANA sobre el nombre propio: SERIES2 resuelve al id de SERIES 2, no al suyo', () => {
      // Es la razón de ser del orden en `resolveFamilia`. Si se consultara
      // primero `familiaByNombre`, 'SERIES2' encontraría su PROPIA fila
      // ('fam-errata') y la fusión no serviría de nada.
      expect(resolveFamilia('SERIES2', idxConAlias())).toEqual({ familia_id: 'fam-series2' });
    });

    it('el alias es tolerante a caja y espacios (misma clave que marca_alias)', () => {
      const i = idxConAlias();
      expect(resolveFamilia('series2', i)).toEqual({ familia_id: 'fam-series2' });
      expect(resolveFamilia('  Series2  ', i)).toEqual({ familia_id: 'fam-series2' });
    });

    it('con alias, el nombre malo NUNCA sale como `nueva` — que es lo que impide que ingest_snapshot recree la fila', () => {
      const i = makeCatalogIndex();
      i.familiaByNombre.set('SERIES 2', 'fam-series2');
      i.familiaAlias.set(normalizeAliasKey('SERIES2'), 'fam-series2');
      expect(resolveFamilia('SERIES2', i)).toEqual({ familia_id: 'fam-series2' });
    });

    it('LÍMITE DECLARADO: la clave es la CELDA COMPLETA, no el átomo — un compuesto con la misma errata NO queda cubierto', () => {
      // Una parte de las filas del catálogo son compuestas. `SERIES2 26 / SERIES2 38`
      // es una fila propia y necesita su propio alias: la UI de fusión lo
      // declara antes de confirmar. Atomizar sería rediseñar el modelo de
      // familias, fuera de alcance por decisión de producto.
      const i = idxConAlias();
      expect(resolveFamilia('SERIES2 26 / SERIES2 38', i)).toEqual({ nueva: 'SERIES2 26 / SERIES2 38' });
    });

    it('sin alias (0018 sin aplicar) se comporta EXACTAMENTE como antes: degrada a la conducta previa', () => {
      const i = makeCatalogIndex();
      i.familiaByNombre.set('SERIES 2', 'fam-series2');
      expect(resolveFamilia('SERIES2', i)).toEqual({ nueva: 'SERIES2' });
      expect(resolveFamilia('SERIES 2', i)).toEqual({ familia_id: 'fam-series2' });
    });
  });
});

describe('resolveAlmacen / resolveKam / resolveEstatus', () => {
  it('almacén WEST', () => expect(resolveAlmacen('WEST', idx)).toBeDefined());
  it('kam por caja distinta: LAURA → id', () => expect(resolveKam('LAURA', idx)).toBeDefined());
  it('kam desconocido → null', () => expect(resolveKam('ZZZ', idx)).toBeNull());
  it('kam por alias normalizado con acentos (M1): ANDRÉS/andres/Andres → mismo id', () => {
    const idxAcc = makeCatalogIndex();
    idxAcc.kamByNombre.set(normalizeAliasKey('Andrés'), 'kam-acc');
    expect(resolveKam('ANDRÉS', idxAcc)).toBe('kam-acc');
    expect(resolveKam('andres', idxAcc)).toBe('kam-acc');
    expect(resolveKam('Andres', idxAcc)).toBe('kam-acc');
  });
  it('estatus con acentos/caja: "En Preparación" → 2', () =>
    expect(resolveEstatus('En Preparación', idx)).toBe(2));
  it('estatus errata "En Trasito Aéreo" → 5', () =>
    expect(resolveEstatus('En Trasito Aéreo', idx)).toBe(5));
  it('estatus "En Aduana" → 7', () => expect(resolveEstatus('En Aduana', idx)).toBe(7));
  it('estatus "Producto Disponible" → 11', () =>
    expect(resolveEstatus('Producto Disponible', idx)).toBe(11));
  it('estatus desconocido → null', () => expect(resolveEstatus('Perdido', idx)).toBeNull());
});
