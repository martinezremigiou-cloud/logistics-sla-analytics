// ============================================================
// [CAT-B1 · Tramo A] LOS DOS GATES DEL ESPEJO DE CINCO NIVELES
//
// El archivo de inventario trae CINCO niveles en su fila 4:
//   ITEM · CLIENTE · TECNOLOGIA · MARCA · FAMILIA · PRODUCTO · CLASE · DESCRIPCION
// y el parser reconocía seis de esas ocho columnas: ni TECNOLOGIA ni PRODUCTO.
// Ninguna de las dos estaba en `CAMPOS_VISIBLES_OPCIONALES`, así que se
// descartaban EN SILENCIO — sin rastro de cuarentena, sin log, sin nada.
//
// ------------------------------------------------------------
// POR QUÉ SON DOS PRUEBAS Y NO UNA (CAT-B1 · CP-1 §4.4)
// ------------------------------------------------------------
// Contestan preguntas distintas y tienen SUJETOS distintos. Confundirlas es
// el error de fondo: una prueba con dos sujetos no puede decir cuál falló.
//
//   A-1 · REGRESIÓN    ¿el parser sabe leer las 5 columnas?
//                      Sujeto: el grid de muestra congelado, versionado en git.
//                      Lleva las cifras del fixture. Corre SIEMPRE.
//
//   A-2 · LIBRO DE MUESTRA ¿el libro de ESTE mes las trae?
//                      Sujeto: el .xlsx de muestra, fuera de git (`muestra/`).
//                      NO lleva cifras: en producción cambian cada mes y un
//                      número tecleado aquí caduca en 30 días. Su testigo es
//                      el HEADER.
//
// ------------------------------------------------------------
// EL SUJETO DE A-1
// ------------------------------------------------------------
// `fixtures/muestra/inventario-5niveles.grid.json` es el grid de muestra
// congelado a texto, no una reducción a mano (una reducción prueba lo que yo
// entendí del archivo, no el archivo). Lo emite el generador de datos de
// muestra (`scripts/generar-datos-muestra.mjs`) con la MISMA transformación
// que usa `hojaAGrid` en `parse.inventario.test.ts` — `sheet_to_json(header:1,
// raw:true, defval:null)` — para que fixture y .xlsx no puedan divergir por
// culpa del lector. El encabezado va en el índice 3 (fila física 4).
//
// ------------------------------------------------------------
// ⚠ A-2 NO HACE `describe.skip`, Y ES DELIBERADO — `LA-VARA-AUSENTE-ES-ROJA`
// ------------------------------------------------------------
// El repo tiene la convención contraria (`libros-muestra.ts` la manda por
// escrito, y hay ~10 sitios que la siguen): sin archivo, `describe.skip`. Esa
// convención NO se toca en este bloque — es alcance ajeno, y queda anotada
// como limitación conocida.
//
// Pero para ESTE gate no sirve, porque ya falló una vez con esta forma exacta:
// «el guardián se saltaba sin sujeto; el sujeto vivía fuera de git». Un gate que se salta SALE VERDE, y un
// verde falso es peor que un rojo. Si el libro de muestra no está, A-2 se pone ROJO
// CON NOMBRE y dice qué falta.
//
// ⚠ Y NO se resuelve por mtime ni por fragmento de nombre. `libroStockVivo()`
// (`libros-muestra.ts`) elige el más reciente de `muestra/` cuyo nombre
// contenga «inventario-unificado» — y un libro de 5 niveles que lo CONTUVIERA
// lo volvería el libro vigente de TODA la suite, en silencio, por ser el más
// nuevo. Por eso vive en su propia carpeta (`muestra/libro-5niveles/`)
// y aquí se exige que haya EXACTAMENTE UNO: si hay dos, el test para y pide
// que se declare cuál, en vez de adivinar (elegir por mtime es una limitación conocida).
// ============================================================
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { parseInventario } from '../parse.inventario';
import { real5Niveles } from './helpers';
import { MUESTRA } from './constantes-muestra';
import type { Cell, Grid } from '../types';

// ============================================================
// A-1 · REGRESIÓN — sujeto versionado, corre siempre, lleva las cifras.
// Las cifras salen del MODELO del generador (`MUESTRA.cinco`, por construcción),
// no se teclean aquí.
// ============================================================
const CINCO = MUESTRA.cinco;

describe('[CAT-B1·A-1] el parser lee los CINCO niveles del grid de muestra congelado', () => {
  const { productos, cuarentena } = parseInventario(real5Niveles());

  it('el denominador es el total de SKUs — sin él, ningún porcentaje de abajo significa nada', () => {
    expect(productos).toHaveLength(CINCO.productos);
    expect(new Set(productos.map((p) => p.sku)).size).toBe(CINCO.productos);
  });

  it('casi todos traen TECNOLOGIA (la columna que HOY sólo servía la capa interpretativa, nunca la fuente)', () => {
    expect(productos.filter((p) => p.tecnologia !== null)).toHaveLength(CINCO.conTecnologia);
  });

  it('una mayoría trae PRODUCTO (la columna que HOY no sirve NADIE: ni tabla, ni campo)', () => {
    expect(productos.filter((p) => p.producto !== null)).toHaveLength(CINCO.conProducto);
  });

  it('las que traen PRODUCTO son TECNOLOGIA=BRAND1, sin una sola excepción — es lo que hace a PRODUCTO una rama de BRAND1 y no un 4.º nivel global', () => {
    const conProducto = productos.filter((p) => p.producto !== null);
    expect(CINCO.invarianteProductoImplicaTecnologia).toBe(true); // el generador lo garantiza por construcción
    expect(conProducto.every((p) => p.tecnologia === CINCO.tecnologiaConProducto)).toBe(true);
    expect(new Set(conProducto.map((p) => p.tecnologia))).toEqual(new Set([CINCO.tecnologiaConProducto]));
  });

  it(`${CINCO.testigo.sku} es el caso testigo de D-1: la v2 guardaba el PRODUCTO en el casillero de la FAMILIA porque no había casillero de producto`, () => {
    const p = productos.find((x) => x.sku === CINCO.testigo.sku);
    expect(p).toBeDefined();
    expect(CINCO.testigo.familia).not.toBe(CINCO.testigo.producto); // el sentido de la prueba: familia y producto son distintos
    expect(p?.familia).toBe(CINCO.testigo.familia);
    expect(p?.producto).toBe(CINCO.testigo.producto); // ← esto es lo que la capa interpretativa guardaba en el casillero de la FAMILIA
    expect(p?.tecnologia).toBe(CINCO.testigo.tecnologia);
  });

  it('`null` es un valor legítimo, no un fallo de lectura: las sin tecnología y las sin producto NO generan cuarentena de fila', () => {
    // `=== null` estricto a propósito: si el parser devolviera `undefined` o `''`
    // en vez de `null`, el diff del ETL vería `null !== ''` y emitiría una
    // MODIFICACIÓN falsa por corrida sobre estas mismas filas, para siempre.
    expect(productos.filter((p) => p.tecnologia === null)).toHaveLength(CINCO.sinTecnologia);
    expect(productos.filter((p) => p.producto === null)).toHaveLength(CINCO.sinProducto);
    expect(cuarentena.filter((c) => c.sku !== null)).toEqual([]);
  });

  it('este archivo SÍ trae las dos columnas ⇒ cero rastro `columna_ausente_` de tecnología y producto', () => {
    const motivos = cuarentena.map((c) => c.motivo);
    expect(motivos).not.toContain('columna_ausente_tecnologia');
    expect(motivos).not.toContain('columna_ausente_producto');
  });
});

// ============================================================
// A-1·CP · CONTROL POSITIVO — el gate tiene que saber MORDER.
// Un verde que nunca se puso rojo no prueba nada: prueba que se ejecutó.
// Se borra la columna PRODUCTO del grid y se exige UN item a nivel de HOJA
// (`sku: null`), no una por cada fila.
// ============================================================
describe('[CAT-B1·A-1·CP] control positivo: borrar la columna PRODUCTO deja rastro — y UNO SOLO', () => {
  /** Devuelve el grid sin la columna cuyo encabezado sea `titulo` (fila física 4 = índice 3). */
  function sinColumna(grid: Grid, titulo: string): Grid {
    const header = grid[3] ?? [];
    const i = header.findIndex((c) => String(c ?? '').trim().toUpperCase() === titulo);
    if (i < 0) throw new Error(`el control positivo no encontró la columna ${titulo} — sujeto equivocado`);
    return grid.map((fila) => {
      const copia = [...(fila ?? [])];
      copia.splice(i, 1);
      return copia as Cell[];
    });
  }

  const { productos, cuarentena } = parseInventario(sinColumna(real5Niveles(), 'PRODUCTO'));

  it('sin la columna, el rastro aparece — si esto sale verde SIN el control, el gate no mide nada', () => {
    expect(cuarentena.map((c) => c.motivo)).toContain('columna_ausente_producto');
  });

  it('UN item a nivel de HOJA (sku null, sin fila), no un renglón idéntico de ruido por fila', () => {
    const items = cuarentena.filter((c) => c.motivo === 'columna_ausente_producto');
    expect(items).toHaveLength(1);
    expect(items[0]?.sku).toBeNull();
    expect(items[0]?.origen).toEqual({ hoja: 'Inventario' });
  });

  it('un rastro NO es un bloqueo: los productos se siguen parseando, y TECNOLOGIA sigue llegando', () => {
    expect(productos).toHaveLength(CINCO.productos);
    expect(productos.every((p) => p.producto === null)).toBe(true);
    expect(productos.filter((p) => p.tecnologia !== null)).toHaveLength(CINCO.conTecnologia);
  });
});

// ============================================================
// A-2 · LIBRO DE MUESTRA — ¿el libro de ESTE mes trae los cinco niveles?
// Sin cifras: su testigo es el HEADER. Sin skip: `LA-VARA-AUSENTE-ES-ROJA`.
// ============================================================
const DIR_VIVO = join(process.cwd(), 'muestra', 'libro-5niveles');

/** El libro de muestra de 5 niveles, elegido SIN mtime y SIN fragmento de nombre: tiene que haber exactamente uno. */
function libroDeMuestra(): { ruta: string; sha256: string } {
  if (!existsSync(DIR_VIVO)) {
    throw new Error(
      `[CAT-B1·A-2] LA-VARA-AUSENTE-ES-ROJA — no existe la carpeta del libro de muestra de 5 niveles: ${DIR_VIVO}. ` +
        `Este gate NO se salta (un guardián que se salta sin sujeto sale verde). ` +
        `Si el libro de muestra no se ha generado (scripts/generar-datos-muestra.mjs), ESTE rojo es el mensaje correcto.`,
    );
  }
  const libros = readdirSync(DIR_VIVO).filter((n) => n.toLowerCase().endsWith('.xlsx') && !n.startsWith('~$'));
  if (libros.length === 0) {
    throw new Error(`[CAT-B1·A-2] LA-VARA-AUSENTE-ES-ROJA — carpeta sin ningún .xlsx: ${DIR_VIVO}`);
  }
  if (libros.length > 1) {
    throw new Error(
      `[CAT-B1·A-2] AMBIGÜEDAD, y no se resuelve adivinando — hay ${libros.length} libros en ${DIR_VIVO}: ` +
        `${libros.join(' | ')}. Elegir por mtime es una limitación conocida. Declara cuál es el vigente.`,
    );
  }
  const ruta = join(DIR_VIVO, libros[0]!);
  return { ruta, sha256: createHash('sha256').update(readFileSync(ruta)).digest('hex') };
}

describe('[CAT-B1·A-2] el libro de muestra trae los cinco niveles', () => {
  it('el sujeto existe y queda DECLARADO por su sha256 — la evidencia dice contra qué archivo se midió', () => {
    const { ruta, sha256 } = libroDeMuestra();
    // No se afirma un sha fijo: el libro se reemplaza cada mes y un sha
    // tecleado aquí caduca igual que una cifra. Se IMPRIME para que el reporte
    // del bloque pueda nombrar el sujeto que midió.
    console.log(`[CAT-B1·A-2] sujeto: ${ruta.split(/[\\/]/).pop()}  sha256=${sha256}`);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('su hoja `Inventario` trae TECNOLOGIA y PRODUCTO en el encabezado', () => {
    const { ruta } = libroDeMuestra();
    const wb = XLSX.readFile(ruta, { cellDates: false });
    const hoja = wb.Sheets['Inventario'];
    expect(hoja, `el libro de muestra no tiene hoja 'Inventario': ${ruta}`).toBeDefined();
    const grid = XLSX.utils.sheet_to_json<Cell[]>(hoja!, { header: 1, raw: true, defval: null });
    const header = (grid[3] ?? []).map((c) => String(c ?? '').trim().toUpperCase());
    expect(header).toContain('TECNOLOGIA');
    expect(header).toContain('PRODUCTO');
  });

  it('el parser las lee del libro de muestra — el fixture de A-1 y el archivo no divergen en el HEADER', () => {
    const { ruta } = libroDeMuestra();
    const wb = XLSX.readFile(ruta, { cellDates: false });
    const grid = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets['Inventario']!, {
      header: 1,
      raw: true,
      defval: null,
    });
    const { productos, cuarentena } = parseInventario(grid);
    // `typeof === 'string'`, NO `!== null`: con el campo sin implementar el valor
    // es `undefined`, y `undefined !== null` es TRUE — la aserción saldría verde
    // sobre un parser que no lee nada. P25: el resultado correcto por la razón
    // equivocada sigue siendo un defecto.
    expect(productos.some((p) => typeof p.tecnologia === 'string')).toBe(true);
    expect(productos.some((p) => typeof p.producto === 'string')).toBe(true);
    expect(cuarentena.map((c) => c.motivo)).not.toContain('columna_ausente_producto');
  });
});
