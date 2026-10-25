// ============================================================
// [INV-B8] Tests de src/schemas/refresh.schema.ts — O2 vía Power
// Automate: PA arma el JSON directo del Excel y postea a
// `/api/refresh` SIN pasar por `construirDatasets` (el gate
// bloqueante del CLI, ver motor.ts). Este archivo prueba:
//   (a) cada dataset de stock vacío por separado se rechaza, con un
//       mensaje que identifica CUÁL vino vacío;
//   (b) los tres con datos → pasa;
//   (c) la carga legacy `embarques` (source:'embarques', body `rows`)
//       no se tocó — sigue aceptándose igual, vacía o no;
//   (d) la PREMISA que hace segura la decisión ("un grid real siempre
//       trae al menos su fila de cabecera") se sostiene contra los 3
//       formatos conocidos (libros de muestra): unificado (mayo 2026, vigente),
//       julio 2026 (histórico) y abril 2026 (histórico, fixtures
//       congelados) — el body se arma EXACTAMENTE como lo arma el CLI
//       (`scripts/ingesta-mensual.mjs`): `leerWorkbookXlsx` +
//       `construirDatasets` con el config real.
// ============================================================
import { describe, it, expect } from 'vitest';
import { libroStockVivo, libroStockJulio } from '@/services/ingesta/__tests__/libros-muestra';
import { RefreshBody } from './refresh.schema';
import { construirDatasets, type WorkbookGrids, type BodyStock } from '@/services/ingesta/motor';
import { leerWorkbookXlsx, cargarReferenciaAbril } from '@/services/ingesta/io';
import { ingestaMapeoConfig } from '@/config/ingesta-mapeo';

const CAPTURED_AT = '2026-07-01T00:00:00.000Z';

function stockBody(
  overrides: Partial<{ inventario: unknown[]; west: unknown[]; reserva: unknown[] }> = {},
) {
  return {
    source: 'stock' as const,
    capturedAt: CAPTURED_AT,
    archivo: 'stock.xlsx',
    datasets: {
      inventario: overrides.inventario ?? [['SKU', 'TOTAL'], ['A-1', 5]],
      west: overrides.west ?? [['SKU', 'FISICO'], ['A-1', 1]],
      reserva: overrides.reserva ?? [['SKU', 'CLIENTE'], ['A-1', 'X']],
    },
  };
}

function issueDe(parsed: ReturnType<typeof RefreshBody.safeParse>, ruta: string) {
  if (parsed.success) return undefined;
  return parsed.error.issues.find((i) => i.path.join('.') === ruta);
}

describe('RefreshBody — stock: dataset vacío (INV-B8, O2 vía Power Automate)', () => {
  it('inventario=[] → rechazado, con mensaje que identifica el dataset "inventario"', () => {
    const parsed = RefreshBody.safeParse(stockBody({ inventario: [] }));
    expect(parsed.success).toBe(false);
    const issue = issueDe(parsed, 'datasets.inventario');
    expect(issue?.message).toContain('dataset "inventario" vacío');
  });

  it('west=[] → rechazado, con mensaje que identifica el dataset "west"', () => {
    const parsed = RefreshBody.safeParse(stockBody({ west: [] }));
    expect(parsed.success).toBe(false);
    const issue = issueDe(parsed, 'datasets.west');
    expect(issue?.message).toContain('dataset "west" vacío');
  });

  it('reserva=[] → rechazado, con mensaje que identifica el dataset "reserva"', () => {
    const parsed = RefreshBody.safeParse(stockBody({ reserva: [] }));
    expect(parsed.success).toBe(false);
    const issue = issueDe(parsed, 'datasets.reserva');
    expect(issue?.message).toContain('dataset "reserva" vacío');
  });

  it('los tres datasets con ≥1 fila → pasa', () => {
    const parsed = RefreshBody.safeParse(stockBody());
    expect(parsed.success).toBe(true);
  });
});

describe('RefreshBody — source: "embarques" (legacy) — fuera de alcance de esta decisión, no se tocó', () => {
  it('rows con contenido → sigue aceptándose', () => {
    const parsed = RefreshBody.safeParse({
      source: 'embarques',
      capturedAt: CAPTURED_AT,
      archivo: null,
      rows: [['OC', 'SKU'], ['1', 'A-1']],
    });
    expect(parsed.success).toBe(true);
  });

  it('rows=[] → sigue aceptándose (la decisión INV-B8 solo exige ≥1 fila a los 3 datasets de STOCK, no a esta carga legacy)', () => {
    const parsed = RefreshBody.safeParse({
      source: 'embarques',
      capturedAt: CAPTURED_AT,
      archivo: null,
      rows: [],
    });
    expect(parsed.success).toBe(true);
  });
});

// ============================================================
// Premisa (requisito 2 del bloque): "un grid real SIEMPRE trae su
// fila de cabecera" — si algún formato real produjera un dataset de
// stock vacío, el `.min(1)` de refresh.schema.ts rechazaría un
// archivo LEGÍTIMO y la decisión habría que revisarla.
//
// Los .xlsx de unificado/julio NO están versionados en git (fix M-1,
// ver motor.test.ts) — viven en `muestra/`, que llena
// `scripts/generar-datos-muestra.mjs`; en un clon fresco faltan por diseño,
// de ahí el `describe.skip` guardado con la existencia del libro. Abril usa
// los fixtures de muestra YA versionados (`cargarReferenciaAbril`), siempre
// presentes.
// ============================================================
const aduanaVacia: WorkbookGrids = { nombreArchivo: '(no aplica — este test solo mira STOCK)', hojas: [] };

function esperarStockNoVacio(etiqueta: string, obtenerBodyStock: () => BodyStock) {
  it(`${etiqueta}: inventario/west/reserva traen ≥1 fila (con cabecera)`, () => {
    const bodyStock = obtenerBodyStock();
    expect(bodyStock.datasets.inventario.length).toBeGreaterThanOrEqual(1);
    expect(bodyStock.datasets.west.length).toBeGreaterThanOrEqual(1);
    expect(bodyStock.datasets.reserva.length).toBeGreaterThanOrEqual(1);
  });

  it(`${etiqueta}: el body construido pasa RefreshBody.safeParse (el .min(1) no rechaza un archivo real)`, () => {
    const parsed = RefreshBody.safeParse(obtenerBodyStock());
    expect(parsed.success).toBe(true);
  });
}

const archivoUnificado = libroStockVivo();
(archivoUnificado !== null ? describe : describe.skip)(
  'Premisa grid-con-cabecera — formato UNIFICADO (mayo 2026, fuente mensual vigente)',
  () => {
    esperarStockNoVacio('unificado', () => {
      const stock = leerWorkbookXlsx(archivoUnificado!);
      return construirDatasets({ stock, aduana: aduanaVacia }, ingestaMapeoConfig, {
        capturedAt: CAPTURED_AT,
      }).bodyStock;
    });
  },
);

const archivoStockJulio = libroStockJulio();
(archivoStockJulio !== null ? describe : describe.skip)(
  'Premisa grid-con-cabecera — formato JULIO 2026 (histórico)',
  () => {
    esperarStockNoVacio('julio', () => {
      const stock = leerWorkbookXlsx(archivoStockJulio!);
      return construirDatasets({ stock, aduana: aduanaVacia }, ingestaMapeoConfig, {
        capturedAt: CAPTURED_AT,
      }).bodyStock;
    });
  },
);

describe('Premisa grid-con-cabecera — formato ABRIL 2026 (histórico, fixtures de muestra congelados)', () => {
  esperarStockNoVacio('abril', () => {
    const referencia = cargarReferenciaAbril();
    return construirDatasets(referencia, ingestaMapeoConfig, { capturedAt: CAPTURED_AT }).bodyStock;
  });
});
