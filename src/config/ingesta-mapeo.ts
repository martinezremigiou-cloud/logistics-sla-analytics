// ============================================================
// src/config/ingesta-mapeo.ts
// Config DATA-DRIVEN del mapeo mensual de ingesta: hoja de Excel real
// → dataset del contrato B2 (`/api/refresh`) + normalización de
// headers. Este archivo es el CONTRATO OPERATIVO que se edita cuando
// los dueños del proceso renombran hojas/columnas en los archivos
// fuente (Inventario/Reserva/WEST/Embarques) — NO requiere tocar el
// motor (`src/services/ingesta/motor.ts`) ni los parsers del ETL
// (`src/services/etl/parse.*.ts`, que quedan siempre intactos).
//
// Cómo lo consume el motor (ver motor.ts):
//  - `stock.inventario/west/reserva.nombres`: nombres de hoja
//    aceptados para cada dataset del body
//    `{source:'stock', datasets:{inventario,west,reserva}}`. Se
//    comparan NORMALIZADOS (trim + minúsculas + colapso de espacios +
//    sin acentos, vía `normalizeAliasKey` del ETL) — cubre variantes
//    como ' HISTORIAL DEMO' (espacio inicial) o mayúsculas/espacios
//    dobles. Un renombre real de hoja (p.ej. 'WEST' vs 'INV_WEST' vs
//    'INV WEST') se cubre listando TODOS los nombres conocidos
//    explícitamente — no por heurística de substring/underscore.
//  - `stock.excluidas` / `aduana.excluidas`: hojas que existen en el
//    archivo pero NUNCA se ingieren (con motivo, para el reporte).
//  - `stock.pendientes` / `aduana.pendientes`: hojas que existen pero
//    requieren una decisión de negocio antes de incluirse en el body.
//    El reporte `--dry` las lista explícitamente; el motor JAMÁS las
//    mete al body (aunque el parser igual las ignoraría por su cuenta
//    en el caso de embarques — ver nota en `aduana.pendientes` abajo).
//  - `aduana` NO lista nombres para el dataset 'embarques': CUALQUIER
//    hoja que no esté excluida/pendiente se asigna ahí (catch-all),
//    igual criterio que `parse.embarques.ts` (que solo excluye vía su
//    `SKIP_SHEETS` hardcodeado) — así una hoja de proveedor nueva
//    (p.ej. 'PARTNER9', que apareció en julio 2026) se mapea sola, sin
//    tocar este archivo.
//  - `aliasesHeader`: por dataset, `{ aliases, tokensHeader }`.
//    `aliases`: celda real (normalizada) → texto CANÓNICO que el
//    parser correspondiente ya reconoce (ver `COLS` en cada
//    `parse.<dataset>.ts` para los nombres canónicos exactos y su
//    tolerancia actual). El motor PRE-NORMALIZA el grid (renombra la
//    celda de encabezado antes de parsear); el parser del ETL en sí
//    queda intacto.
//    `tokensHeader`: los MISMOS tokens que el parser real exige a
//    `detectHeaderRow` (ver `parse.<dataset>.ts`) para anclar la fila
//    de encabezado. Antes (bug B-3) `aplicarAliasesHeader` anclaba
//    SIEMPRE con `['item']` a secas — más débil que el parser real —
//    así que una celda 'item' suelta ANTES del header real (p.ej. en
//    un banner o leyenda) podía hacer que el alias se aplicara a la
//    fila EQUIVOCADA. Parametrizado por dataset para que el ancla del
//    motor sea SIEMPRE igual de estricta que la del parser real.
// ============================================================

/** Hoja(s) que existen en el archivo pero NUNCA se ingieren. */
export interface HojaExcluida {
  /** Nombres de hoja aceptados (se comparan normalizados). */
  nombres: string[];
  /** Por qué se excluye — aparece tal cual en el reporte `--dry`. */
  motivo: string;
}

/** Hoja(s) que existen pero requieren una decisión de negocio. */
export interface HojaPendiente {
  nombres: string[];
  motivo: string;
}

export interface IngestaMapeoConfig {
  stock: {
    inventario: { nombres: string[] };
    west: { nombres: string[] };
    reserva: { nombres: string[] };
    excluidas: HojaExcluida[];
    pendientes: HojaPendiente[];
  };
  aduana: {
    // Sin lista de nombres para 'embarques': ver nota de catch-all arriba.
    excluidas: HojaExcluida[];
    pendientes: HojaPendiente[];
  };
  /** Por dataset: alias de header + tokens que anclan la fila de encabezado. */
  aliasesHeader: {
    inventario: HeaderAliasesDataset;
    west: HeaderAliasesDataset;
    reserva: HeaderAliasesDataset;
    embarques: HeaderAliasesDataset;
  };
}

/** Alias de header + ancla de fila para UN dataset (ver nota `aliasesHeader` arriba). */
export interface HeaderAliasesDataset {
  /** Header real normalizado → header canónico a escribir. */
  aliases: Record<string, string>;
  /**
   * Tokens requeridos para anclar la fila de encabezado real (idénticos
   * a los que el parser real (`parse.<dataset>.ts`) exige a
   * `detectHeaderRow`). Si `aliases` está vacío, `aplicarAliasesHeader`
   * (motor.ts) nunca los usa (fast path).
   */
  tokensHeader: string[];
}

// ------------------------------------------------------------
// ERA de los archivos fuente (bloque INV-B8/A6). El UNIFICADO de mayo
// 2026 (libro unificado, en muestra: `inventario-unificado.xlsx`,
// hojas Inventario/Reserva/Compras/'INV WEST') es la FUENTE MENSUAL
// DESDE AHORA: es contra ESE archivo que este config debe calibrarse
// de aquí en adelante (nombres de hoja, headers). Julio 2026 (en muestra:
// `inventario-julio.xlsx`) y abril 2026 (congelado en
// `src/services/etl/__tests__/fixtures/muestra/*.grid.json`, ver
// `src/services/ingesta/io.ts#cargarReferenciaAbril`) son HISTÓRICO:
// ya no se reciben archivos con ese layout, pero los snapshots que ya
// se cargaron con ellos deben poder re-procesarse/auditarse, así que
// sus variantes de nombre/header (p.ej. 'INV_WEST', 'CLASS', 'DESC')
// se conservan aquí A PROPÓSITO junto a las del unificado — no se
// retiran solo porque dejaron de recibirse. Nadie debe calibrar este
// archivo contra julio/abril como si fueran el formato vigente.
// ------------------------------------------------------------
export const ingestaMapeoConfig: IngestaMapeoConfig = {
  stock: {
    inventario: { nombres: ['Inventario'] },
    west: {
      // mayo 2026 (unificado, fuente mensual desde ahora): la hoja se
      // llama 'INV WEST' (con ESPACIO). julio 2026: 'WEST'. abril
      // 2026: 'INV_WEST' (con GUION BAJO). Mismo dataset — hoja
      // renombrada en el archivo fuente entre eras. `normalizeAliasKey`
      // colapsa espacios pero NO convierte '_' en espacio (decisión
      // medida, ver bloque INV-B8/A2: tocarla arriesga el flap
      // ALTA/BAJA ya sufrido en INGESTA2, y su radio de uso son 17
      // archivos, no solo nombres de hoja), así que 'inv west' !=
      // 'inv_west' tras normalizar — los 3 nombres se listan a
      // propósito, no se infiere por substring/underscore.
      nombres: ['WEST', 'INV_WEST', 'INV WEST'],
    },
    reserva: { nombres: ['Reserva'] },
    excluidas: [
      {
        nombres: ['Compras'],
        motivo:
          'Hoja de compras (OCs a proveedor): no forma parte del contrato B2 ' +
          '(inventario/west/reserva). Fuera de alcance de esta ingesta.',
      },
    ],
    pendientes: [],
  },
  aduana: {
    excluidas: [
      {
        nombres: ['OC ABIERTAS'],
        motivo:
          'Control interno de OCs abiertas, no es una hoja de embarque (sin ' +
          'columna ESTATUS). parse.embarques.ts ya la salta vía su ' +
          'SKIP_SHEETS interno; se excluye aquí también para que este ' +
          'reporte sea honesto sobre qué hoja va a dónde.',
      },
    ],
    pendientes: [
      {
        nombres: ['GARANTIAS'],
        motivo:
          'Sin ratificar: header con "STATUS" (no "ESTATUS") y sin ' +
          'columna OC/PO — layout distinto al resto de hojas de embarque. ' +
          'Incluirla exigiría tocar parse.embarques.ts (estructura, no solo ' +
          'nombres), lo cual está fuera de alcance de este config. Hoy la ' +
          'hoja siempre está vacía (0 registros; verificado igual en abril y ' +
          'julio 2026 — solo trae la leyenda vertical de estatus). ' +
          'parse.embarques.ts ya la salta vía su SKIP_SHEETS interno.',
      },
    ],
  },
  aliasesHeader: {
    // tokensHeader = los mismos que detectHeaderRow exige en
    // parse.inventario.ts:53. Sin aliases hoy (fast path: nunca se usan).
    inventario: { aliases: {}, tokensHeader: ['item', 'marca', 'total', 'resv'] },
    // julio 2026: header 'DESC' (abril 2026: 'DESCRIPCION'; mayo 2026
    // unificado: 'DESCRIP' — esta última YA la acepta parseWest de forma
    // nativa, ver COLS en parse.west.ts, no necesita alias aquí). parseWest
    // acepta 'descripcion' | 'descr' | 'descrip' pero NO 'desc' — sin este
    // alias la columna se pierde por completo (medido: sin el alias ninguna
    // descripción de julio se capturaba, con él casi todas).
    // tokensHeader = los mismos que detectHeaderRow exige en
    // parse.west.ts:31 (ancla la fila de encabezado REAL, no cualquier
    // celda 'item' suelta que aparezca antes — ver fix B-3). 'prov' YA NO
    // es obligatorio (bloque INV-B8/A3): el unificado de mayo 2026 no trae
    // columna PROV en 'INV WEST' — pero sigue leyéndose cuando existe
    // (julio/abril la traen; ColumnSpec.prov de parse.west.ts ya la
    // mapea). 'item'/'fisico' son los únicos tokens comunes a las 3 eras.
    // Cambiado aquí Y en parse.west.ts:31 a la vez — si divergen,
    // preflight y el parser opinarían distinto sobre el mismo archivo.
    west: { aliases: { DESC: 'DESCRIPCION' }, tokensHeader: ['item', 'fisico'] },
    // parse.reserva.ts NO usa detectHeaderRow (ancla por su propio
    // findItemRow: columna A === 'item', no "cualquier celda de la
    // fila"). tokensHeader es best-effort para el día que se configure
    // un alias real aquí; hoy `aliases` está vacío → fast path, nunca se usa.
    reserva: { aliases: {}, tokensHeader: ['item'] },
    // Variantes de header observadas en julio 2026 en las hojas de
    // embarques (N° PO vs OC, PIEZAS vs TOTAL PIEZAS, FACTURA vs FACTURA
    // COMERCIAL, FECHA DE DISPONIBILIDAD vs FECHA ESTIMADA DE
    // DISPONIBILIDAD) YA están cubiertas por los alias nativos de
    // parse.embarques.ts (su `COLS`) — verificado hoja por hoja contra el
    // archivo real; hoy no se requiere pre-normalización aquí. Se deja el
    // dataset declarado (vacío) para cuando sí aparezca una variante nueva.
    // tokensHeader = los mismos que detectHeaderRow exige en
    // parse.embarques.ts:70.
    //
    // STOP&ASK documentado (NO resoluble por alias de nombre, es
    // estructura): la hoja 'WEST' del libro de EMBARQUES (distinta del
    // dataset `stock.west` de arriba) trae la columna 'REFERENCIA'
    // DUPLICADA (2 columnas con el mismo nombre exacto — igual en abril y
    // julio 2026, no es drift nuevo). `resolveColumns` (grid.ts) toma la
    // PRIMERA coincidencia por diseño, así que hoy no rompe nada — pero
    // un alias no puede distinguir "la 2ª columna llamada igual que la
    // 1ª"; si algún día la 2ª columna trae datos relevantes que la 1ª no
    // trae, hace falta tocar el parser (leer por POSICIÓN ahí, no por
    // nombre) o pedir que renombren una de las 2 en el Excel fuente. Hoy
    // la hoja no tiene registros de datos (0 filas con ITEM) en ninguna
    // de las 2 eras, así que no hay impacto medible — se deja constancia
    // aquí para cuando sí se llene.
    embarques: { aliases: {}, tokensHeader: ['item', 'estatus'] },
  },
};
