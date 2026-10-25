// ============================================================
// Pruebas del GENERADOR de datos de muestra (`scripts/generar-datos-muestra.mjs`).
//
// Los datos de ejemplo no tienen valor si dejan de ser reproducibles o si el manifiesto de
// constantes que las demás pruebas importan se desfasa del generador. Aquí se fijan cuatro cosas:
//   1. Los JSON y el manifiesto VERSIONADOS son exactamente lo que el generador emite hoy.
//   2. El generador es determinista (misma semilla → mismos bytes, también en los .xlsx).
//   3. Los .xlsx de `muestra/` llevan metadatos neutros y la estructura que las pruebas esperan.
//   4. La FORMA de los fixtures conserva las rarezas que los parsers manejan a propósito.
// Las cifras se leen del manifiesto (`MUESTRA`); aquí solo se comprueban invariantes entre ellas.
// ============================================================
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { construirMuestra, verificarVersionados } from '../../../../scripts/generar-datos-muestra.mjs';
import { bytesDeLibro } from '../../../../scripts/datos-muestra/escritura.mjs';
import { MUESTRA } from './constantes-muestra';
import { realInventario, realWest, realReserva, realEmbarques, real5Niveles } from './helpers';

const RAIZ = process.cwd();
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

describe('generador de datos de muestra — reproducibilidad', () => {
  it('los JSON y el manifiesto versionados coinciden con lo que el generador emite hoy (si falla: npm run datos:muestra)', () => {
    expect(verificarVersionados({ raiz: RAIZ })).toEqual([]);
  });

  it('determinista: dos construcciones dan los mismos JSON, el mismo manifiesto y los mismos bytes de cada .xlsx', () => {
    const a = construirMuestra();
    const b = construirMuestra();
    expect(b.json).toEqual(a.json);
    expect(b.constantes).toEqual(a.constantes);
    expect(a.libros.map((l: { ruta: string }) => l.ruta)).toEqual(Object.values(MUESTRA.libros));
    for (let i = 0; i < a.libros.length; i++) {
      expect(sha(bytesDeLibro(b.libros[i]))).toBe(sha(bytesDeLibro(a.libros[i])));
    }
  });

  it('la semilla del manifiesto es la del generador y todos los datos caen en el año de ejemplo', () => {
    expect(MUESTRA.semilla).toBe(construirMuestra().constantes.semilla);
    const fechas = JSON.stringify(realEmbarques()).match(/\d{4}-\d{2}-\d{2}T00:00:00/g) ?? [];
    expect(fechas.length).toBeGreaterThan(0);
    expect(fechas.every((f) => f.startsWith(`${MUESTRA.anio}-`))).toBe(true);
  });
});

describe('libros .xlsx de muestra (los genera el globalSetup de vitest en `muestra/`)', () => {
  const ruta = (rel: string) => join(RAIZ, rel);

  it('existen los cuatro libros, y la carpeta del libro de 5 niveles trae EXACTAMENTE uno', () => {
    for (const rel of [MUESTRA.libros.unificado, MUESTRA.libros.julio, MUESTRA.libros.aduana, MUESTRA.libros.cinco]) {
      expect(existsSync(ruta(rel)), rel).toBe(true);
    }
    const dir = join(RAIZ, 'muestra', 'libro-5niveles');
    expect(readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.xlsx'))).toHaveLength(1);
  });

  it('metadatos NEUTROS: sin autor ni empresa reales, fechas de creación y modificación fijas', () => {
    for (const rel of Object.values(MUESTRA.libros)) {
      const wb = XLSX.readFile(ruta(rel), { cellDates: false });
      expect(wb.Props?.Author, rel).toBe('Demo');
      expect(wb.Props?.LastAuthor, rel).toBe('Demo');
      expect(wb.Props?.Company, rel).toBe('Demo'); // (Application lo fija la librería xlsx: no identifica a nadie)
      expect(wb.Props?.CreatedDate?.toISOString(), rel).toBe('2031-01-15T12:00:00.000Z');
      expect(wb.Props?.ModifiedDate?.toISOString(), rel).toBe('2031-01-15T12:00:00.000Z');
    }
  });

  it('hojas y orden: julio (Inventario/Reserva/Compras/WEST), unificado (con «INV WEST» con ESPACIO), aduana (10 hojas, ` HISTORIAL …` con espacio inicial)', () => {
    const nombres = (rel: string) => XLSX.readFile(ruta(rel)).SheetNames;
    expect(nombres(MUESTRA.libros.julio)).toEqual(MUESTRA.julio.hojasStock);
    expect(nombres(MUESTRA.libros.unificado)).toEqual(MUESTRA.unificado.hojasStock);
    expect(nombres(MUESTRA.libros.aduana)).toEqual(MUESTRA.julio.hojasAduana);
    expect(nombres(MUESTRA.libros.aduana)).toHaveLength(MUESTRA.julio.aduana.hojasTotales);
    expect(nombres(MUESTRA.libros.aduana).some((n) => n.startsWith(' ') && n.includes('HISTORIAL'))).toBe(true);
    expect(nombres(MUESTRA.libros.cinco)).toEqual(['Inventario']);
  });

  it('las tres hojas WEST se llaman distinto (WEST · INV_WEST · INV WEST) y normalizan a TRES claves distintas', () => {
    const claves = ['WEST', 'INV_WEST', 'INV WEST'].map((n) => n.replace(/\s+/g, ' ').toLowerCase());
    expect(new Set(claves).size).toBe(3);
  });

  it('el libro de 5 niveles trae el MISMO grid que el fixture JSON de 5 niveles (fixture y archivo no pueden divergir)', () => {
    const wb = XLSX.readFile(ruta(MUESTRA.libros.cinco), { cellDates: false });
    const grid = XLSX.utils.sheet_to_json(wb.Sheets['Inventario'], { header: 1, raw: true, defval: null });
    expect(grid).toEqual(real5Niveles());
  });
});

describe('cifras del manifiesto — invariantes por construcción', () => {
  for (const era of ['abril', 'julio', 'unificado'] as const) {
    const c = MUESTRA[era];
    it(`${era}: productos reconciliados = productos + nuevos · stock reconciliado = stock + west · matched + nuevos = filas west`, () => {
      expect(c.productosReconciliados).toBe(c.productosInventario + c.westNuevos);
      expect(c.stockReconciliado).toBe(c.stockInventario + c.westRows);
      expect(c.westMatched + c.westNuevos).toBe(c.westRows);
      expect(c.diagStock).toBe(0);
    });
  }

  it('julio: la cuarentena anticipada es la suma de sus partes y hay al menos una celda con cliente vacío', () => {
    expect(MUESTRA.julio.reservasClienteVacio).toBe(1);
    expect(MUESTRA.julio.reservasMalformadas).toBeGreaterThan(0);
    expect(MUESTRA.julio.reservasSinProducto).toBe(0);
  });

  it('aduana: Σ por hoja = total · activos + históricos = total · hay SKU de embarque fuera del universo (cuarentena referencial)', () => {
    for (const a of [MUESTRA.abril.embarques, MUESTRA.julio.aduana]) {
      expect(a.porHoja.reduce((s, h) => s + h.total, 0)).toBe(a.total);
      expect(a.activos + a.historiales).toBe(a.total);
      expect(a.fuera).toBeGreaterThan(0);
    }
  });

  it('cinco niveles: producto implica UNA tecnología y el SKU testigo tiene familia ≠ producto', () => {
    expect(MUESTRA.cinco.invarianteProductoImplicaTecnologia).toBe(true);
    expect(MUESTRA.cinco.testigo.familia).not.toBe(MUESTRA.cinco.testigo.producto);
    expect(MUESTRA.cinco.conTecnologia + MUESTRA.cinco.sinTecnologia).toBe(MUESTRA.cinco.productos);
    expect(MUESTRA.cinco.conProducto + MUESTRA.cinco.sinProducto).toBe(MUESTRA.cinco.productos);
  });
});

describe('forma de los fixtures de abril — las rarezas estructurales siguen ahí', () => {
  it('inventario: banner STOCK en la fila 2, encabezado en la fila 4, gutter en la col A, texto mostrado, TOTAL = Σ bodegas, SOUTH siempre vacía', () => {
    const g = realInventario();
    expect(g).toHaveLength(MUESTRA.abril.inventarioFilas);
    expect(g[1].includes('STOCK')).toBe(true);
    expect(g[3]).toEqual([null, 'ITEM', 'CLIENTE', 'MARCA', 'FAMILIA', 'CLASS', 'DESCR', 'NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'TOTAL', 'RESV', 'QTY']);
    const datos = g.slice(4);
    expect(datos.every((f) => f[0] === null)).toBe(true);
    expect(datos.every((f) => f.every((c) => c === null || typeof c === 'string'))).toBe(true);
    expect(datos.every((f) => f[8] === null)).toBe(true);
    for (const f of datos) {
      const bodegas = [7, 8, 9, 10, 11].reduce((s, i) => s + Number(f[i] ?? 0), 0);
      expect(Number(f[12])).toBe(bodegas);
    }
  });

  it('inventario: rarezas que el parser maneja — SKU en minúscula, marca en minúscula, marca = bodega externa, clases fuera de A/B/C, familia y descripción vacías', () => {
    const datos = realInventario().slice(4) as (string | null)[][];
    expect(datos.filter((f) => f[1] !== f[1]!.toUpperCase())).toHaveLength(2);
    expect(datos.some((f) => f[3] === 'brand1')).toBe(true);
    expect(datos.filter((f) => f[3] === 'WEST')).toHaveLength(MUESTRA.abril.marcaBodega);
    expect(datos.some((f) => f[5] !== null && !['A', 'B', 'C'].includes(f[5]!))).toBe(true);
    expect(datos.some((f) => f[4] === null)).toBe(true);
    expect(datos.some((f) => f[6] === null)).toBe(true);
    expect(datos.some((f) => f[14] !== null && /^\d{1,3}(\.\d{3})+$/.test(f[14]!))).toBe(true); // formato de miles en QTY
  });

  it('west: dos filas de preámbulo vacías, banner en la fila 3, encabezado en la fila 4, FISICO en locale europeo como texto, una descripción vacía', () => {
    const g = realWest();
    expect(g.slice(0, 2).every((f) => f.every((c) => c === null))).toBe(true);
    expect(g[2][0]).toBe('INVENTARIO WEST');
    expect(g[3]).toEqual(['ITEM', 'PROV', 'DESCRIPCION', 'FISICO']);
    const datos = g.slice(4) as (string | null)[][];
    expect(datos.every((f) => /^\d{1,3}(\.\d{3})*,\d{2}$/.test(f[3]!))).toBe(true);
    expect(datos.some((f) => f[2] === null)).toBe(true);
    expect(datos.some((f) => f[1] === 'BRAND 6')).toBe(true); // marca de dos palabras
  });

  it('reserva: razón social en f1, KAM en f5, fechas en f7 (una de año de 3 dígitos, una sin formato de fecha, una vacía con cantidad), cliente en f9 con ITEM en la col A', () => {
    const g = realReserva();
    expect(g[0][0]).toBe('DEMO COMERCIAL S DE RL DE CV');
    expect(g[8][0]).toBe('ITEM');
    expect(g[6][0]).toBe('STOCK MEXICO');
    expect(g[6].some((c) => typeof c === 'string' && /^\d{2} [a-z]{3} \d{3}$/.test(c))).toBe(true);
    expect(g[6].includes('MARZO')).toBe(true);
    expect(g[4].some((c) => c === 'NADIA')).toBe(true); // un KAM que NO está sembrado en el catálogo de las pruebas
    expect(g.every((f) => f.length === g[0].length)).toBe(true);
    const skus = g.slice(9).map((f) => f[0]);
    expect(new Set(skus).size).toBeLessThan(skus.length); // SKU repetidos en filas
  });

  it('embarques: 9 hojas; la índice 1 tiene ESTATUS; OC ABIERTAS sin ESTATUS; GARANTIAS con STATUS; REFERENCIA duplicada en la hoja WEST; historial con banner y espacio inicial', () => {
    const h = realEmbarques();
    expect(h).toHaveLength(9);
    expect(h[MUESTRA.abril.embarques.indiceHojaConEstatus].grid[0]).toContain('ESTATUS');
    expect(h.find((x) => x.hoja === 'OC ABIERTAS')!.grid[0]).not.toContain('ESTATUS');
    expect(h.find((x) => x.hoja === 'GARANTIAS')!.grid[0]).toContain('STATUS');
    const west = h.find((x) => x.hoja === 'WEST')!.grid[0];
    expect(west.filter((c) => c === 'REFERENCIA')).toHaveLength(2);
    const hist = h.find((x) => x.hoja.startsWith(' HISTORIAL'))!;
    expect(hist.grid[0].includes('ALMACEN DE INGRESO')).toBe(true);
    expect(hist.grid[1]).toContain('ESTATUS');
  });
});
