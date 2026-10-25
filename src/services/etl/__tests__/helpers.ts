// Utilidades de test compartidas: CatalogIndex sintético (espejo de
// los seeds 0003 + 0004) y cargador de fixtures de muestra/edge.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogIndex, PrevState, Grid, SheetGrid } from '../types';
import { normalizeAliasKey, normalizeMarcaNombre } from '../normalize';

/** CatalogIndex de prueba: marcas/kams/almacenes/estatus sembrados;
 *  familias VACÍAS (toda familia entrante es "nueva" → alta). */
export function makeCatalogIndex(overrides?: Partial<CatalogIndex>): CatalogIndex {
  const marcaByNombre = new Map<string, string>();
  const marcas = ['BRAND1', 'BRAND6', 'VERTICAL', 'EAS', 'CARGADOR', 'SERIES5', 'NACIONAL'];
  marcas.forEach((m, i) => marcaByNombre.set(normalizeMarcaNombre(m)!, `marca-${i + 1}`));

  const marcaAlias = new Map<string, string>();
  marcaAlias.set(normalizeAliasKey('brand1'), marcaByNombre.get('BRAND1')!);
  marcaAlias.set(normalizeAliasKey('BRAND 6'), marcaByNombre.get('BRAND6')!);

  const almacenByClave = new Map<string, string>();
  ['NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'WEST'].forEach((c, i) =>
    almacenByClave.set(c, `alm-${i + 1}`),
  );

  const kamByNombre = new Map<string, string>();
  ['Hugo', 'Julio', 'Elena', 'Sergio', 'Lucas', 'Laura', 'Diego'].forEach((k, i) =>
    kamByNombre.set(normalizeAliasKey(k), `kam-${i + 1}`),
  );

  const estatusAlias = new Map<string, number>();
  const pares: [string, number][] = [
    ['producto solicitado', 1], ['solicitado', 1], ['en preparacion', 2], ['preparacion', 2],
    ['en recoleccion', 3], ['recoleccion', 3], ['en almacen fw', 4], ['almacen fw', 4],
    ['en transito aereo', 5], ['transito aereo', 5], ['en trasito aereo', 5],
    ['en transito maritimo', 6], ['transito maritimo', 6], ['en aduana', 7], ['aduana', 7],
    ['en transito terrestre', 8], ['transito terrestre', 8], ['en almacen fiscal', 9], ['almacen fiscal', 9],
    ['en almacen north', 10], ['almacen north', 10], ['producto disponible', 11], ['disponible', 11],
  ];
  pares.forEach(([a, o]) => estatusAlias.set(normalizeAliasKey(a), o));

  return {
    marcaAlias,
    marcaByNombre,
    familiaAlias: new Map(),
    familiaByNombre: new Map(),
    almacenByClave,
    kamByNombre,
    estatusAlias,
    ...overrides,
  };
}

/** PrevState vacío (primera carga). */
export function emptyPrev(existingSkus: string[] = []): PrevState {
  return {
    snapshotId: null,
    hash: null,
    productos: [],
    stock: [],
    reservas: [],
    embarques: [],
    existingSkus: new Set(existingSkus),
  };
}

function fixturePath(rel: string): string {
  return join(process.cwd(), 'src/services/etl/__tests__/fixtures', rel);
}

export function loadGrid(rel: string): Grid {
  return JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as Grid;
}

export function loadSheets(rel: string): SheetGrid[] {
  return JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as SheetGrid[];
}

export const realInventario = () => loadGrid('muestra/inventario.grid.json');
/** Libro UNIFICADO con los CINCO niveles (ITEM·CLIENTE·TECNOLOGIA·MARCA·FAMILIA·PRODUCTO·CLASE·DESCRIPCION).
 *  Grid de muestra congelado — no una reducción a mano: misma transformación que `hojaAGrid`
 *  (sheet_to_json header:1 raw:true defval:null). Origen declarado en
 *  `parse.inventario.5niveles.test.ts`, que es quien lo usa. */
export const real5Niveles = () => loadGrid('muestra/inventario-5niveles.grid.json');
export const realWest = () => loadGrid('muestra/west.grid.json');
export const realReserva = () => loadGrid('muestra/reserva.grid.json');
export const realEmbarques = () => loadSheets('muestra/embarques.sheets.json');
