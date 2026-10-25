// ============================================================
// Bloque 2 · ETL · parse.west.ts  (PURO)
// Grid de la hoja WEST (nombre de hoja varía por era — ver
// `src/config/ingesta-mapeo.ts#stock.west.nombres` — el motor ya
// entrega aquí un `Grid` suelto, sin nombre de hoja) → { rows,
// cuarentena }. FISICO en locale europeo ('3,00' → 3, '13.472,00' →
// 13472). Header localizado por CONTENIDO, no por posición: abril 2026
// trae banner 'INVENTARIO WEST' en fila 3 + header en fila 4; julio
// 2026 y la instantánea del unificado ya versionada en el repo (mayo
// 2026) NO traen banner (header en fila 1) — pero el archivo VIVO del
// unificado sí trae preámbulo, con header en fila 4 (bloque INV-B8,
// Punto 2, sin archivo real para probarlo): la localización por
// contenido (`detectHeaderRow`) es A PROPÓSITO indiferente a en qué
// fila caiga el header, ver el describe "Punto 2" en el test de este
// archivo (fixture sintético que reproduce esa forma).
// Columnas por era (bloque INV-B8/A3-A4/A7):
//   abril/julio: ITEM · PROV · DESCRIPCION|DESC · FISICO
//   unificado (mayo 2026, fuente mensual desde ahora): ITEM ·
//     TECNOLOGIA · MARCA · FAMILIA · CLASE · DESCRIP · FISICO (SIN
//     columna PROV — MARCA se lee como su respaldo, A7, ver COLS.prov)
// 'item'/'fisico' son los únicos tokens comunes a las 3 eras — PROV ya
// NO se exige para anclar el header, pero SIGUE leyéndose cuando
// existe (directo, o vía el respaldo MARCA de A7).
// WEST es ALMACÉN, no marca: PROV (o su respaldo MARCA) se usa como
// marca solo para los SKU nuevos (los que no existen en Inventario) en
// reconcile.ts.
// ============================================================
import type { Grid, WestCanon, QuarantineItem } from './types';
import { detectHeaderRow, resolveColumns, type ColumnSpec } from './grid';
import { normalizeSku, cellText } from './normalize';
import { toIntNonNeg } from './numbers';

const HOJA = 'INV_WEST';

const COLS: ColumnSpec = {
  sku: ['item'],
  // Campo canónico 'prov': alimenta la MARCA del producto NUEVO (el
  // SKU de WEST que no existe en Inventario) en `reconcile.ts:51`
  // (`normalizeMarcaNombre(row.prov)`) — WEST es ALMACÉN, no marca.
  // Se llama 'prov' por el encabezado de julio 2026 ('PROV'), la
  // primera era integrada. El archivo vigente (unificado, fuente
  // mensual desde ahora) trae el MISMO dato de negocio bajo el
  // encabezado 'MARCA' en vez de 'PROV' (bloque INV-B8/A7) — 'marca'
  // se lista aquí COMO RESPALDO de 'prov' A PROPÓSITO, no por
  // inferencia: los 2 alias documentan 2 archivos reales con 2
  // encabezados distintos para el mismo dato. Ninguna era conocida
  // trae AMBAS columnas a la vez; si alguna vez lo hiciera, gana la
  // que aparezca más a la izquierda (`resolveColumns`, primera
  // coincidencia). NO quitar ninguno de los 2 alias sin releer este
  // comentario Y `reconcile.ts` — julio/abril siguen dependiendo de
  // 'prov' directo, el unificado depende de 'marca' como respaldo.
  prov: ['prov', 'proveedor', 'marca'],
  // 'descripcion' (abril), 'descr'/'desc' vía alias del config (julio) y
  // 'descrip' (unificado mayo 2026) son el MISMO campo por era
  // (bloque INV-B8/A4). NO quitar 'descr': el alias DESC→DESCRIPCION de
  // `ingesta-mapeo.ts` sigue existiendo para julio (parser no reconoce
  // 'desc' a secas), así que 'descr' se conserva por si algún archivo
  // llega ya renombrado a 'DESCR' sin pasar por ese alias.
  descr: ['descripcion', 'descr', 'descrip'],
  fisico: ['fisico', 'físico'],
  // [FIX-B1·T4] MISMOS alias que `parse.inventario.ts#COLS` para el
  // mismo dato de negocio — 'class'/'clase' conviven por la misma razón
  // de era (julio/abril dicen 'CLASS', el unificado dice 'CLASE').
  // Solo el unificado (mayo 2026 en adelante) trae estas 3 columnas en
  // `INV WEST`; abril/julio no las traen y degradan a `null` con su
  // propio rastro de columna ausente (ver `CAMPOS_VISIBLES_OPCIONALES`).
  tecnologia: ['tecnologia'],
  familia: ['familia'],
  class: ['class', 'clase'],
};

// ------------------------------------------------------------
// A5 (bloque INV-B8): mismo mecanismo que `parse.inventario.ts` (ver su
// comentario completo para el razonamiento de nivel/alcance). Aquí:
// 'prov' (alimenta la marca de los SKU nuevos en reconcile.ts) y
// 'descr'. 'fisico' NO está en esta lista: ya es obligatoria — el gate
// existente (`col.fisico === undefined` abajo) corta el parseo
// completo si falta, no degrada en silencio. Con A3, 'prov' pasó de
// obligatoria-para-anclar-header a opcional — hoy (post A7) las 3 eras
// reales conocidas siempre traen PROV directo o su respaldo MARCA, así
// que 'columna_ausente_prov' se quedó sin caso REAL que lo dispare; se
// conserva para el día en que aparezca una era sin NINGUNO de los 2 —
// cubierto de forma sintética en `__tests__/parse.west.test.ts`
// (describe "sin PROV ni DESCR").
// ------------------------------------------------------------
// [FIX-B1·T4] 'tecnologia'/'familia'/'class' se suman a la lista con los
// MISMOS nombres de motivo que `parse.inventario.ts` (mismo dato de
// negocio, mismo canal de diagnóstico) — para que abril/julio (que no
// traen estas 3 columnas en `INV WEST`) dejen rastro en vez de perder
// el dato en silencio, igual que ya pasaba con 'prov'/'descr'.
const CAMPOS_VISIBLES_OPCIONALES: {
  campo: 'prov' | 'descr' | 'tecnologia' | 'familia' | 'class';
  motivo: string;
}[] = [
  { campo: 'prov', motivo: 'columna_ausente_prov' },
  { campo: 'descr', motivo: 'columna_ausente_descripcion' },
  { campo: 'tecnologia', motivo: 'columna_ausente_tecnologia' },
  { campo: 'familia', motivo: 'columna_ausente_familia' },
  { campo: 'class', motivo: 'columna_ausente_clase' },
];

export function parseWest(grid: Grid): {
  rows: WestCanon[];
  cuarentena: QuarantineItem[];
} {
  const rows: WestCanon[] = [];
  const cuarentena: QuarantineItem[] = [];

  // 'prov' YA NO se exige para anclar el header (bloque INV-B8/A3): el
  // unificado de mayo 2026 no la trae en 'INV WEST'. Cambiado aquí Y en
  // `ingesta-mapeo.ts#aliasesHeader.west.tokensHeader` a la vez — deben
  // quedar coherentes o preflight y este parser opinarán distinto sobre
  // el mismo archivo.
  const headerRow = detectHeaderRow(grid, ['item', 'fisico']);
  if (headerRow < 0) return { rows, cuarentena };
  const col = resolveColumns(grid[headerRow], COLS);
  if (col.sku === undefined || col.fisico === undefined) {
    return { rows, cuarentena };
  }

  // A5: rastro de diagnóstico (no bloquea) por cada columna VISIBLE
  // opcional ausente — ver comentario de `CAMPOS_VISIBLES_OPCIONALES`.
  const columnasAusentes: string[] = [];
  for (const { campo, motivo } of CAMPOS_VISIBLES_OPCIONALES) {
    if (col[campo] === undefined) {
      columnasAusentes.push(campo);
      cuarentena.push({
        entidad: 'stock',
        clave: `columna_ausente:${campo}`,
        sku: null,
        motivo,
        origen: { hoja: HOJA },
        detalle: { campo, aliasesEsperados: COLS[campo] },
      });
    }
  }
  // F3 (ver `docs/decisions/0003-empty-and-degraded-input-guards.md`, P11) — mismo
  // mecanismo que `parse.inventario.ts` (ver su comentario completo):
  // conteo de columnas ausentes por dataset a los logs de Vercel,
  // complementario al rastro que ya viaja en `cuarentena`.
  if (columnasAusentes.length > 0) {
    console.error(
      `[parse.west] ${HOJA}: ${columnasAusentes.length} columna(s) visible(s) opcional(es) ` +
        `ausente(s) (${columnasAusentes.join(', ')}) — no se leerán de esta hoja para ningún renglón.`,
    );
  }

  const seen = new Set<string>();

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sku = normalizeSku(row[col.sku]);
    if (sku === null) continue;
    if (sku === 'TOTALES' || sku === 'TOTAL') continue;
    if (seen.has(sku)) {
      cuarentena.push({
        entidad: 'stock',
        clave: `${sku}|WEST`,
        sku,
        motivo: 'sku_duplicado_en_west',
        origen: { hoja: HOJA, fila: r + 1 },
      });
      continue;
    }
    seen.add(sku);

    rows.push({
      sku,
      prov: (col.prov !== undefined ? cellText(row[col.prov]) : null) ?? '',
      tecnologia: col.tecnologia !== undefined ? cellText(row[col.tecnologia]) : null,
      familia: col.familia !== undefined ? cellText(row[col.familia]) : null,
      class: col.class !== undefined ? cellText(row[col.class]) : null,
      descr: col.descr !== undefined ? cellText(row[col.descr]) : null,
      fisico: toIntNonNeg(row[col.fisico]),
    });
  }

  return { rows, cuarentena };
}
