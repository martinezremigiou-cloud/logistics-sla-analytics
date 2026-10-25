// ============================================================
// src/config/ingesta-mapeo.test.ts
// Pruebas del CONTRATO OPERATIVO de mapeo de ingesta (bloque INV-B8,
// carril A: A2/A3/A4). Corren contra los libros de muestra en
// `muestra/` (formato de julio 2026 y el UNIFICADO de mayo 2026, la
// fuente mensual vigente — ver comentario de ERA en `ingesta-mapeo.ts`)
// que genera `scripts/generar-datos-muestra.mjs`, en vez de una copia
// sintética que pueda envejecer sin avisar. Si
// alguno de los 2 .xlsx no está presente en el checkout, esa porción
// se salta (no falla) — mismo criterio de guarda que
// `src/services/ingesta/__tests__/motor.test.ts`.
//
// NO se importa nada de `motor.ts`/`preflight.ts` a propósito (fuera
// de alcance de este bloque/carril): estas pruebas verifican el CONFIG
// en sí (los datos), no su consumo por el motor.
// ============================================================
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { ingestaMapeoConfig } from './ingesta-mapeo';
import { normalizeAliasKey } from '@/services/etl/normalize';
import { detectHeaderRow, resolveColumns } from '@/services/etl/grid';
import type { Cell, Grid } from '@/services/etl/types';
import { libroStockJulio, libroStockVivo } from '@/services/ingesta/__tests__/libros-muestra';

const ARCHIVO_JULIO = libroStockJulio();
const ARCHIVO_UNIFICADO = libroStockVivo();
const hayJulio = ARCHIVO_JULIO !== null;
const hayUnificado = ARCHIVO_UNIFICADO !== null;

/** Nombres de hoja de un workbook. Helper LOCAL (solo de este archivo de test). */
function nombresDeHojas(path: string): string[] {
  return XLSX.readFile(path, { cellDates: false }).SheetNames;
}

/** Hoja de libro → Grid. Mismo criterio que el helper local de `clasificacion.build.integration.test.ts`. */
function hojaAGrid(path: string, hoja: string): Grid {
  const wb = XLSX.readFile(path, { cellDates: false });
  const sheet = wb.Sheets[hoja];
  if (!sheet) throw new Error(`hoja no encontrada en ${path}: ${hoja}`);
  return XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null });
}

describe('ingestaMapeoConfig.stock.west.nombres — A2', () => {
  it('los 3 nombres conocidos normalizan a 3 claves DISTINTAS (por eso no bastan 2)', () => {
    const normalizados = ingestaMapeoConfig.stock.west.nombres.map(normalizeAliasKey);
    expect(normalizados).toEqual(['west', 'inv_west', 'inv west']);
    expect(new Set(normalizados).size).toBe(ingestaMapeoConfig.stock.west.nombres.length);
  });

  it("conserva 'INV_WEST' (abril 2026, histórico — sin .xlsx fuente en el repo, pero debe seguir reconociéndose)", () => {
    expect(ingestaMapeoConfig.stock.west.nombres).toContain('INV_WEST');
  });

  (hayJulio ? it : it.skip)("cubre la hoja de julio 2026 ('WEST')", () => {
    const nombresReales = nombresDeHojas(ARCHIVO_JULIO!);
    expect(nombresReales).toContain('WEST');
    const normalizadosConfig = ingestaMapeoConfig.stock.west.nombres.map(normalizeAliasKey);
    expect(normalizadosConfig).toContain(normalizeAliasKey('WEST'));
  });

  (hayUnificado ? it : it.skip)("cubre la hoja real del unificado mayo 2026 ('INV WEST', CON espacio)", () => {
    const nombresReales = nombresDeHojas(ARCHIVO_UNIFICADO!);
    expect(nombresReales).toContain('INV WEST');
    const normalizadosConfig = ingestaMapeoConfig.stock.west.nombres.map(normalizeAliasKey);
    expect(normalizadosConfig).toContain(normalizeAliasKey('INV WEST'));
  });
});

describe('ingestaMapeoConfig.aliasesHeader.west — A3/A4', () => {
  it("tokensHeader ya NO exige 'prov' (solo 'item'/'fisico', comunes a las 3 eras)", () => {
    expect(ingestaMapeoConfig.aliasesHeader.west.tokensHeader).toEqual(['item', 'fisico']);
  });

  it("conserva el alias DESC->DESCRIPCION (julio 2026; el parser no reconoce 'desc' a secas)", () => {
    expect(ingestaMapeoConfig.aliasesHeader.west.aliases).toEqual({ DESC: 'DESCRIPCION' });
  });

  (hayUnificado ? it : it.skip)(
    'regresión (A3): el ancla VIEJA (item+prov+fisico) NO detecta el header real del unificado (sigue sin ' +
      'columna PROV, sin importar en qué fila caiga) — la NUEVA (tokensHeader del config) SÍ lo encuentra, y ' +
      'desde ahí resuelven las columnas que importan (item/fisico para anclar, marca/descrip como datos, A7/A4). ' +
      'A PROPÓSITO no se afirma EN QUÉ fila cae el header: esa fila es un accidente de esta copia del .xlsx (fila ' +
      '1 aquí, fila 4 en el archivo vivo — ver "Punto 2" en parse.west.test.ts); lo que importa es que se ' +
      'encuentre y que las columnas resuelvan, no la coordenada',
    () => {
      const grid = hojaAGrid(ARCHIVO_UNIFICADO!, 'INV WEST');
      expect(detectHeaderRow(grid, ['item', 'prov', 'fisico'])).toBe(-1);

      const headerRow = detectHeaderRow(grid, ingestaMapeoConfig.aliasesHeader.west.tokensHeader);
      expect(headerRow).toBeGreaterThanOrEqual(0); // SE ENCUENTRA — la fila concreta no se afirma

      const col = resolveColumns(grid[headerRow], {
        item: ['item'],
        fisico: ['fisico'],
        marca: ['marca'], // A7: respaldo de 'prov' (alimenta la marca del NUEVO en reconcile.ts)
        descrip: ['descrip'], // A4: forma nativa que ya reconoce parse.west.ts
      });
      expect(col.item).toBeDefined();
      expect(col.fisico).toBeDefined();
      expect(col.marca).toBeDefined();
      expect(col.descrip).toBeDefined();
    },
  );

  (hayJulio ? it : it.skip)('tokensHeader del config ancla la fila de encabezado real de julio (que SÍ trae prov)', () => {
    const grid = hojaAGrid(ARCHIVO_JULIO!, 'WEST');
    expect(detectHeaderRow(grid, ingestaMapeoConfig.aliasesHeader.west.tokensHeader)).toBe(0);
  });
});
