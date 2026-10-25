// ============================================================
// Bloque 2 · ETL · parse.inventario.ts  (PURO)
// Grid de la hoja 'Inventario' → { productos, stock, cuarentena }.
// Geometría real: banner 'STOCK' en fila 2, encabezado en fila 4,
// gutter en col A. Header localizado por contenido (tolerante).
// ============================================================
import type {
  Grid,
  ProductoCanon,
  StockCanon,
  QuarantineItem,
  ClaveAlmacen,
} from './types';
import { detectHeaderRow, resolveColumns, type ColumnSpec } from './grid';
import { normalizeSku, cellText } from './normalize';
import { toIntNonNeg } from './numbers';

const HOJA = 'Inventario';

const COLS: ColumnSpec = {
  sku: ['item'],
  cliente: ['cliente'],
  // [CAT-B1·A] TECNOLOGIA y PRODUCTO existen en la fila 4 del unificado desde
  // mayo 2026 y el parser NO las reconocia: se descartaban en silencio. Son
  // OPCIONALES POR ERA — julio/abril 2026 no traen ninguna de las dos, y los
  // unificados de mayo no traen PRODUCTO — por eso NO entran en el ancla del
  // header (`detectHeaderRow` abajo, que sigue siendo ['item','marca','total',
  // 'resv']): meterlas ahi volveria ilegibles los archivos historicos.
  tecnologia: ['tecnologia'],
  producto: ['producto'],
  marca: ['marca'],
  familia: ['familia'],
  // 'class' (julio/abril 2026) y 'clase' (unificado mayo 2026) son el
  // MISMO campo de negocio con distinta ortografía por era — ambos
  // alias deben resolver a la misma columna lógica (bloque INV-B8/A1).
  class: ['class', 'clase'],
  descr: ['descr', 'descripcion'],
  north: ['north'],
  south: ['south'],
  east: ['east'],
  tran: ['tran'],
  bo: ['bo'],
  total: ['total'],
  resv: ['resv'],
};

const ALMACENES: { field: string; clave: ClaveAlmacen }[] = [
  { field: 'north', clave: 'NORTH' },
  { field: 'south', clave: 'SOUTH' },
  { field: 'east', clave: 'EAST' },
  { field: 'tran', clave: 'TRAN' },
  { field: 'bo', clave: 'BO' },
];

// ------------------------------------------------------------
// A5 (bloque INV-B8): campos OPCIONALES que alimentan valores VISIBLES
// del producto (familia/clase/descripción/cliente) — si su columna no
// aparece en el archivo fuente, HOY degradan en silencio a `null`
// fila-por-fila (ver `col.xxx !== undefined ? ... : null` abajo). Sin
// rastro, un renombre/eliminación de columna aguas arriba es
// indistinguible de "el dato real es null". Medido en su momento: ANTES del fix A1
// de este mismo bloque, la pérdida de la columna CLASE del unificado
// (parser solo reconocía 'class') quedó casi invisible en pantalla:
// existe una capa de interpretación POSTERIOR — deliberadamente ajena
// a este ETL, ver `convivencia.o5.test.ts`, que vigila que este
// directorio no la nombre ni siquiera en prosa — que cuando tiene su
// propia respuesta para un campo, esa respuesta gana sobre la de la
// fuente; casi todos los SKU afectados sí tenían respuesta ahí, así
// que el `null` de la fuente no llegaba a notarse. Detalle completo:
// patrón de falla en `docs/engineering/failure-patterns.md` (P11).
//
// Nivel elegido: DIAGNÓSTICO, vía el canal de cuarentena YA existente
// (`QuarantineItem`, sin tocar `types.ts`) — UN item por columna
// ausente, a nivel de HOJA (`sku: null`, sin `fila`: no es un problema
// de una fila, es de la hoja completa), NUNCA uno por fila (cientos de
// filas ⇒ cientos de renglones de ruido idéntico) y NUNCA bloquea el parseo:
// abril/julio no traen todas las columnas del unificado y deben seguir
// siendo legibles — "un rastro no es un bloqueo". `marca` no está
// aquí: ya es obligatoria para anclar el header (`detectHeaderRow`
// arriba) y ya cuarentena fila-por-fila si la CELDA viene vacía
// ('producto_sin_marca'); eso es un problema distinto de "la COLUMNA
// entera no existe". `resv`/`total` tampoco: son parte del ancla
// obligatoria del header, no degradan en silencio (su ausencia ya
// impide detectar el header en absoluto).
// ------------------------------------------------------------
const CAMPOS_VISIBLES_OPCIONALES: {
  campo: 'tecnologia' | 'producto' | 'familia' | 'class' | 'descr' | 'cliente';
  motivo: string;
}[] = [
  // [CAT-B1·A] Sin estas dos lineas repetiriamos el defecto que este bloque
  // existe para cerrar: una columna que desaparece aguas arriba y nadie se
  // entera. Consecuencia ACEPTADA y dicha: los archivos de abril/julio (y los
  // unificados sin PRODUCTO) emiten su rastro en cada corrida — «un rastro no
  // es un bloqueo», mismo criterio que las cuatro de abajo.
  { campo: 'tecnologia', motivo: 'columna_ausente_tecnologia' },
  { campo: 'producto', motivo: 'columna_ausente_producto' },
  { campo: 'familia', motivo: 'columna_ausente_familia' },
  { campo: 'class', motivo: 'columna_ausente_clase' },
  { campo: 'descr', motivo: 'columna_ausente_descripcion' },
  { campo: 'cliente', motivo: 'columna_ausente_cliente' },
];

export function parseInventario(grid: Grid): {
  productos: ProductoCanon[];
  stock: StockCanon[];
  cuarentena: QuarantineItem[];
} {
  const productos: ProductoCanon[] = [];
  const stock: StockCanon[] = [];
  const cuarentena: QuarantineItem[] = [];

  const headerRow = detectHeaderRow(grid, ['item', 'marca', 'total', 'resv']);
  if (headerRow < 0) return { productos, stock, cuarentena };
  const col = resolveColumns(grid[headerRow], COLS);
  if (col.sku === undefined || col.marca === undefined) {
    return { productos, stock, cuarentena };
  }

  // A5: rastro de diagnóstico (no bloquea) por cada columna VISIBLE
  // opcional ausente — ver comentario de `CAMPOS_VISIBLES_OPCIONALES`.
  const columnasAusentes: string[] = [];
  for (const { campo, motivo } of CAMPOS_VISIBLES_OPCIONALES) {
    if (col[campo] === undefined) {
      columnasAusentes.push(campo);
      cuarentena.push({
        entidad: 'producto',
        clave: `columna_ausente:${campo}`,
        sku: null,
        motivo,
        origen: { hoja: HOJA },
        detalle: { campo, aliasesEsperados: COLS[campo] },
      });
    }
  }
  // F3 (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`, P11): el item de
  // cuarentena de arriba queda enterrado en `result.cuarentena` y en
  // `cambios` — nadie se entera sin ir a buscarlo (medido: ninguna llamada a
  // console.error/warn en todo `src/services/etl` y
  // `src/services/ingesta`). Mínimo pedido por el bloque: el conteo de
  // columnas ausentes por dataset SÍ debe aparecer en los logs de
  // Vercel — canal COMPLEMENTARIO al de arriba, no un reemplazo: este
  // vive ~1h (runtime log de Vercel Hobby), el de `cuarentena` ya viaja
  // en la respuesta HTTP que Power Automate retiene 28 días.
  if (columnasAusentes.length > 0) {
    console.error(
      `[parse.inventario] ${HOJA}: ${columnasAusentes.length} columna(s) visible(s) opcional(es) ` +
        `ausente(s) (${columnasAusentes.join(', ')}) — no se leerán de esta hoja para ningún renglón.`,
    );
  }

  const seen = new Set<string>();

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sku = normalizeSku(row[col.sku]);
    if (sku === null) continue; // fila-basura estructural (leyenda / vacía)
    if (sku === 'TOTALES' || sku === 'TOTAL') continue; // fila de totales

    const marca = cellText(row[col.marca]);
    if (marca === null) {
      cuarentena.push({
        entidad: 'producto',
        clave: sku,
        sku,
        motivo: 'producto_sin_marca',
        origen: { hoja: HOJA, fila: r + 1 },
      });
      continue;
    }
    // Nota: 'WEST' aparece en la columna MARCA en algunos renglones (WEST es
    // ALMACÉN, no marca). El producto SÍ se conserva; la regla "WEST no es
    // marca" se aplica al resolver (runEtl): NO se crea la marca 'WEST', se reasigna al catch-all 'NACIONAL'.

    if (seen.has(sku)) {
      cuarentena.push({
        entidad: 'producto',
        clave: sku,
        sku,
        motivo: 'sku_duplicado_en_inventario',
        origen: { hoja: HOJA, fila: r + 1 },
      });
      continue;
    }
    seen.add(sku);

    productos.push({
      sku,
      marca,
      tecnologia: col.tecnologia !== undefined ? cellText(row[col.tecnologia]) : null,
      producto: col.producto !== undefined ? cellText(row[col.producto]) : null,
      familia: col.familia !== undefined ? cellText(row[col.familia]) : null,
      class: col.class !== undefined ? cellText(row[col.class]) : null,
      descr: col.descr !== undefined ? cellText(row[col.descr]) : null,
      cliente: col.cliente !== undefined ? cellText(row[col.cliente]) : null,
      resv: col.resv !== undefined ? toIntNonNeg(row[col.resv]) : 0,
      totalFuente: col.total !== undefined ? toIntNonNeg(row[col.total]) : 0,
    });

    for (const { field, clave } of ALMACENES) {
      if (col[field] === undefined) continue;
      const cantidad = toIntNonNeg(row[col[field]]);
      if (cantidad > 0) stock.push({ sku, almacen: clave, cantidad });
    }
  }

  return { productos, stock, cuarentena };
}
