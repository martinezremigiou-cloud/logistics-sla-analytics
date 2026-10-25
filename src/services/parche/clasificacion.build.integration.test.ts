// ============================================================
// B-PARCHE · F2 · clasificacion.build.integration.test.ts
// Parsea el libro de MUESTRA (`muestra/clasificacion-parche.xlsx`, hojas
// Inventario + INV WEST) y el fixture de productos vivos
// (`__fixtures__/productos-vivos-muestra.json`). Ambos son INVENTADOS y los
// emite `scripts/generar-datos-muestra.mjs` (semilla fija; el libro lo
// escribe el globalSetup de vitest antes de recolectar las pruebas).
//
// Las cifras que se aseveran NO se teclean aquí ni salen del builder: las
// calcula el generador POR CONSTRUCCIÓN, contando desde su modelo, y las
// publica en `__fixtures__/constantes-parche.json` (versionado; la prueba
// `etl/__tests__/datos-muestra.test.ts` falla si deja de coincidir con el
// generador). Cada aserción conserva lo que afirmaba contra el diagnóstico
// canónico: geometría, unión/overlap, altas/bajas, cuarentena, diffs contra
// vivo, catálogos nuevos y colisiones. Cualquier desviación es una señal real
// de regresión del builder.
//
// Catálogos vivos (`marcasVivas`/`familiasVivas`/`aliasVivos`): también salen
// del manifiesto (misma fuente que el fixture de productos), de modo que el
// contexto y los datos no pueden divergir.
// ============================================================
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import type { Cell, Grid } from '@/services/etl/types';
import { detectHeaderRow, resolveColumns } from '@/services/etl/grid';
import { normalizeSku, normalizeMarcaNombre } from '@/services/etl/normalize';
import { embedName } from '@/lib/supabase/embed';
import { buildClasificacionV2, type ParcheContexto, type FuenteActualProducto } from './clasificacion.build';
import productosVivosRaw from './__fixtures__/productos-vivos-muestra.json';
import constantes from './__fixtures__/constantes-parche.json';

const MUESTRA = constantes;
const XLSX_PATH = join(process.cwd(), ...MUESTRA.libro.split('/'));

// ------------------------------------------------------------
// Helper LOCAL (solo de este test): libro de muestra → { inventario, west }
// como Grid puro (Cell[][]) — mismo shape que produce el bridge.
// ------------------------------------------------------------
function xlsxAGrids(path: string): { inventario: Grid; west: Grid } {
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheetToGrid = (nombreHoja: string): Grid => {
    const hoja = wb.Sheets[nombreHoja];
    if (!hoja) throw new Error(`hoja no encontrada en el xlsx: ${nombreHoja}`);
    return XLSX.utils.sheet_to_json<Cell[]>(hoja, { header: 1, raw: true, defval: null });
  };
  return {
    inventario: sheetToGrid(MUESTRA.hojas[0]),
    west: sheetToGrid(MUESTRA.hojas[1]),
  };
}

/** Cuenta filas "útiles" (ITEM no vacío) después del encabezado — sanity check independiente del builder. */
function contarFilasUtiles(grid: Grid): number {
  const headerRow = detectHeaderRow(grid, ['item']);
  if (headerRow < 0) return 0;
  const col = resolveColumns(grid[headerRow], { sku: ['item'] });
  if (col.sku === undefined) return 0;
  let count = 0;
  for (let r = headerRow + 1; r < grid.length; r++) {
    if (normalizeSku(grid[r]?.[col.sku]) !== null) count++;
  }
  return count;
}

/** Set de SKUs únicos (ITEM normalizado) de una hoja — mismo criterio que `contarFilasUtiles`. */
function skusUnicos(grid: Grid): Set<string> {
  const headerRow = detectHeaderRow(grid, ['item']);
  if (headerRow < 0) return new Set();
  const col = resolveColumns(grid[headerRow], { sku: ['item'] });
  if (col.sku === undefined) return new Set();
  const out = new Set<string>();
  for (let r = headerRow + 1; r < grid.length; r++) {
    const sku = normalizeSku(grid[r]?.[col.sku]);
    if (sku !== null) out.add(sku);
  }
  return out;
}

// ------------------------------------------------------------
// Fixture de vivos (shape crudo de `fetchAllRows` sobre `productos`).
// ------------------------------------------------------------
interface ProductoVivoFixture {
  sku: string;
  class: string | null;
  descr_origen: string | null;
  marcas: { nombre: string } | null;
  familias: { nombre: string } | null;
}
const productosVivos = productosVivosRaw as ProductoVivoFixture[];

function construirContexto(): ParcheContexto {
  const existingSkus = new Set<string>();
  const fuenteActual = new Map<string, FuenteActualProducto>();

  for (const p of productosVivos) {
    const sku = normalizeSku(p.sku);
    if (sku === null) continue;
    existingSkus.add(sku);
    fuenteActual.set(sku, {
      marca: embedName(p.marcas),
      familia: embedName(p.familias),
      clase: p.class,
      descr: p.descr_origen,
    });
  }

  const familiasVivas = new Set(
    MUESTRA.vivas.familias.map(normalizeMarcaNombre).filter((v): v is string => v !== null),
  );
  const marcasVivas = new Set(
    MUESTRA.vivas.marcas.map(normalizeMarcaNombre).filter((v): v is string => v !== null),
  );
  const aliasVivos = new Map<string, string>(Object.entries(MUESTRA.vivas.alias));

  return { existingSkus, fuenteActual, familiasVivas, marcasVivas, aliasVivos };
}

describe('buildClasificacionV2 — integración contra el libro de muestra + productos vivos de ejemplo', () => {
  const { inventario, west } = xlsxAGrids(XLSX_PATH);
  const contexto = construirContexto();

  it('geometría de origen: filas útiles en Inventario y en WEST según el modelo (sanity check independiente del builder)', () => {
    expect(contarFilasUtiles(inventario)).toBe(MUESTRA.filasInventario);
    expect(contarFilasUtiles(west)).toBe(MUESTRA.filasWest);
  });

  it('únicos y overlap (SKU en ambas hojas) — cálculo independiente del builder', () => {
    const invSkus = skusUnicos(inventario);
    const desSkus = skusUnicos(west);
    const union = new Set<string>([...Array.from(invSkus), ...Array.from(desSkus)]);
    const overlap = Array.from(invSkus).filter((s) => desSkus.has(s));
    expect(union.size).toBe(MUESTRA.unionSkus);
    expect(overlap.length).toBe(MUESTRA.overlap);
  });

  it('vivos: los productos del fixture son los del modelo', () => {
    expect(productosVivos.length).toBe(MUESTRA.vivos);
    expect(contexto.existingSkus.size).toBe(MUESTRA.vivos);
  });

  const result = buildClasificacionV2({ inventario, west }, contexto);

  it('en-ambos (aplicables.filas) = unión − soloNuevo; soloViejo = vivos − en-ambos', () => {
    expect(result.reporte.aplicables.filas).toBe(MUESTRA.enAmbos);
    expect(result.filas).toHaveLength(MUESTRA.enAmbos);
    expect(result.reporte.omitidos.soloNuevo.total).toBe(MUESTRA.soloNuevo.total);
    expect(result.reporte.omitidos.soloViejo.total).toBe(MUESTRA.soloViejo.total);
    // en-ambos + soloNuevo = unión del archivo · en-ambos + soloViejo = vivos
    expect(result.reporte.aplicables.filas + result.reporte.omitidos.soloNuevo.total).toBe(MUESTRA.unionSkus);
    expect(result.reporte.aplicables.filas + result.reporte.omitidos.soloViejo.total).toBe(MUESTRA.vivos);
  });

  it('omitidos.soloNuevo: los SKUs exactos del archivo sin match en vivos', () => {
    expect(result.reporte.omitidos.soloNuevo.skus).toEqual([...MUESTRA.soloNuevo.skus].sort());
  });

  it('omitidos.soloViejo: el total del modelo, con un SKU común y los 2 "basura"', () => {
    expect(result.reporte.omitidos.soloViejo.total).toBe(MUESTRA.soloViejo.total);
    expect(result.reporte.omitidos.soloViejo.skus).toEqual(MUESTRA.soloViejo.skus);
    const comun = MUESTRA.soloViejo.skus.find((s) => !MUESTRA.soloViejo.basura.includes(s))!;
    expect(result.reporte.omitidos.soloViejo.skus).toContain(comun);
    for (const b of MUESTRA.soloViejo.basura) expect(result.reporte.omitidos.soloViejo.skus).toContain(b);
  });

  it('cuarentena.skusBasura: los SKUs vivos de soloViejo con espacios internos (informativo)', () => {
    expect(MUESTRA.soloViejo.basura).toHaveLength(2);
    expect(result.reporte.cuarentena.skusBasura).toEqual([...MUESTRA.soloViejo.basura].sort());
  });

  it('cuarentena.duplicadosIntraArchivo: vacío (el libro de muestra no trae duplicados intra-hoja)', () => {
    expect(MUESTRA.duplicadosIntraArchivo).toBe(0);
    expect(result.reporte.cuarentena.duplicadosIntraArchivo).toEqual([]);
  });

  it('Cross-ref WEST: sin resolver (marca=WEST en Inventario sin contraparte en la hoja WEST) y resueltos por cruce', () => {
    expect(result.reporte.cuarentena.westNoResueltos.total).toBe(MUESTRA.westNoResueltos.total);
    expect(result.reporte.cuarentena.westNoResueltos.skus).toEqual([...MUESTRA.westNoResueltos.skus].sort());
    // 'WEST' JAMÁS se escribe como marca_v2, ni en los resueltos ni en los cuarentenados.
    expect(result.filas.some((f) => f.marca_v2 === 'WEST')).toBe(false);
    // los cuarentenados salen con marca_v2 = null; los resueltos, con la marca real de la hoja WEST
    for (const sku of MUESTRA.westNoResueltos.skus) {
      expect(result.filas.find((f) => f.sku === sku)?.marca_v2, sku).toBeNull();
    }
    const { cruzadoResueltoA, cruzadoResueltoB } = MUESTRA.testigos;
    for (const t of [cruzadoResueltoA, cruzadoResueltoB]) {
      expect(MUESTRA.westResueltos.skus).toContain(t.sku);
      expect(result.filas.find((f) => f.sku === t.sku)?.marca_v2, t.sku).toBe(t.marcaV2);
    }
  });

  it('aplicables.porCampo: escribiria (descr, clase, tecnologia, marca, familia) = filas con candidato no vacío del modelo', () => {
    const e = MUESTRA.escribiria;
    expect(result.reporte.aplicables.porCampo.descr.escribiria).toBe(e.descr);
    expect(result.reporte.aplicables.porCampo.clase.escribiria).toBe(e.clase);
    expect(result.reporte.aplicables.porCampo.tecnologia.escribiria).toBe(e.tecnologia);
    expect(result.reporte.aplicables.porCampo.marca.escribiria).toBe(e.marca);
    expect(result.reporte.aplicables.porCampo.familia.escribiria).toBe(e.familia);
  });

  it('aplicables.porCampo: difiereDelVivo (familia, clase, marca) — contados al fabricar cada valor vivo, EXACTOS', () => {
    expect(result.reporte.aplicables.porCampo.familia.difiereDelVivo).toBe(MUESTRA.difiere.familia);
    expect(result.reporte.aplicables.porCampo.clase.difiereDelVivo).toBe(MUESTRA.difiere.clase);
    expect(result.reporte.aplicables.porCampo.marca.difiereDelVivo).toBe(MUESTRA.difiere.marca);
  });

  it('descr.difiereDelVivo: regla trim-only case-sensible → el valor del modelo (EXACTO y canónico de este builder)', () => {
    // Cada valor vivo se fabrica con un modo de efecto conocido: igual/espacios
    // (no difieren: la comparación recorta SIN colapsar espacios internos),
    // otra caja (difiere: descr es case-sensible), otro texto o nulo (difieren).
    // El generador cuenta cuántos difieren al fabricarlos.
    expect(result.reporte.aplicables.porCampo.descr.difiereDelVivo).toBe(MUESTRA.difiere.descr);
  });

  it('marca: desglose de los difiereDelVivo — placeholders WEST (resueltos + cuarentena) + el resto no-WEST', () => {
    // Los placeholders 'WEST' de Inventario JAMÁS coinciden con el vivo
    // (siempre "difieren"): los resueltos por cruce y los de cuarentena.
    // El resto son diffs de marca ajenos al placeholder (marca viva distinta,
    // nula o el alias de dos palabras frente a su canónica).
    // NO todos se aplican: los de cuarentena se cuentan en el reporte pero no se escriben.
    const placeholders = MUESTRA.westNoResueltos.total + MUESTRA.westResueltos.total;
    expect(MUESTRA.marcaDifierePlaceholders).toBe(placeholders);
    expect(result.reporte.cuarentena.westNoResueltos.total + MUESTRA.westResueltos.total).toBe(placeholders);
    expect(MUESTRA.difiere.marca).toBeGreaterThan(placeholders);
    expect(result.reporte.aplicables.porCampo.marca.difiereDelVivo).toBe(MUESTRA.difiere.marca);
  });

  it('catálogos nuevos: tecnologías, marcas (incluidas las que solo aparecen en WEST) y familias nuevas = las del modelo', () => {
    expect(result.reporte.catalogos.tecnologiasNuevas).toBe(MUESTRA.catalogos.tecnologiasNuevas.length);
    expect([...result.catalogosNuevos.tecnologiasNuevas].sort()).toEqual([...MUESTRA.catalogos.tecnologiasNuevas].sort());

    expect(result.reporte.catalogos.marcasNuevas).toBe(MUESTRA.catalogos.marcasNuevas.length);
    expect([...result.catalogosNuevos.marcasNuevas].sort()).toEqual([...MUESTRA.catalogos.marcasNuevas].sort());
    // la marca nueva que solo trae la hoja WEST se siembra aunque Inventario gane la precedencia de ese SKU
    const { marcaNuevaSoloWest, variantesDeCaja } = MUESTRA.testigos;
    expect(result.catalogosNuevos.marcasNuevas).toContain(marcaNuevaSoloWest.marcaNueva);
    expect(result.filas.find((f) => f.sku === marcaNuevaSoloWest.sku)?.marca_v2).toBe(marcaNuevaSoloWest.marcaV2);
    // la misma marca nueva en dos cajas (Inventario/WEST) NO colisiona: se siembra UNA vez
    expect(result.catalogosNuevos.marcasNuevas.filter((m) => m === variantesDeCaja.marcaV2)).toHaveLength(1);

    // candidatas nuevas por canónico, menos las colisiones de normalización
    // (espacio doble vs simple) retenidas de la siembra de catálogo.
    expect(result.reporte.catalogos.familiasNuevas).toBe(MUESTRA.catalogos.familiasNuevas);

    expect(result.reporte.catalogos.aliasNuevos).toBe(0);
    expect(result.catalogosNuevos.marcaAliasNuevos).toEqual([]);
  });

  it('cuarentena.colisionesNormalizacion: las colisiones de familia del modelo (espacio doble vs simple, NO auto-fusionadas)', () => {
    expect(result.reporte.cuarentena.colisionesNormalizacion).toHaveLength(MUESTRA.catalogos.colisionesFamilia.length);
    const canonicos = result.reporte.cuarentena.colisionesNormalizacion.map((c) => c.canonico).sort();
    expect(canonicos).toEqual([...MUESTRA.catalogos.colisionesFamilia].sort());
    expect(result.reporte.cuarentena.colisionesNormalizacion.every((c) => c.campo === 'familia')).toBe(true);
    // el valor SIGUE escribiéndose (determinista) para los skus afectados,
    // pero el canónico no se siembra en `familiasNuevas` (ver test de catálogos).
    for (const c of result.reporte.cuarentena.colisionesNormalizacion) {
      for (const sku of c.skus) {
        const filaSku = result.filas.find((f) => f.sku === sku);
        expect(filaSku?.familia_v2).toBe(c.canonico);
      }
    }
  });

  it('precedencia por campo: Inventario gana si aporta valor; WEST solo rellena los huecos (SKU testigo del modelo)', () => {
    const { doradoOverlap, marcaVaciaEnInventario, huecosFamiliaClase, huecosDescrClase } = MUESTRA.testigos;
    const fila = (sku: string) => result.filas.find((f) => f.sku === sku);
    // overlap con todos los campos en Inventario: gana Inventario (no la hoja WEST)
    expect(fila(doradoOverlap.sku)).toMatchObject({
      marca_v2: doradoOverlap.marcaV2,
      familia_v2: doradoOverlap.familiaV2,
      clase_v2: doradoOverlap.claseV2,
    });
    expect(fila(marcaVaciaEnInventario.sku)?.marca_v2).toBe(marcaVaciaEnInventario.marcaV2);
    expect(fila(huecosFamiliaClase.sku)).toMatchObject({
      familia_v2: huecosFamiliaClase.familiaV2,
      clase_v2: huecosFamiliaClase.claseV2,
    });
    expect(fila(huecosDescrClase.sku)).toMatchObject({
      descr_v2: huecosDescrClase.descrV2,
      clase_v2: huecosDescrClase.claseV2,
    });
  });

  it('cada fila emitida tiene sku no-vacío y forma canónica ETL (marca/familia/clase/tecnologia en UPPER; descr con casing preservado)', () => {
    for (const f of result.filas) {
      expect(f.sku.length).toBeGreaterThan(0);
      if (f.marca_v2 !== null) expect(f.marca_v2).toBe(f.marca_v2.toUpperCase());
      if (f.familia_v2 !== null) expect(f.familia_v2).toBe(f.familia_v2.toUpperCase());
      if (f.clase_v2 !== null) expect(f.clase_v2).toBe(f.clase_v2.toUpperCase());
      if (f.tecnologia !== null) expect(f.tecnologia).toBe(f.tecnologia.toUpperCase());
    }
  });
});
