// ============================================================
// Bloque 2 · Contrato de entrada de /api/refresh (zod).
// Unión discriminada por `source`. Estructuralmente compatible
// con Cell/Grid de `@/services/etl/types` (sin importar de ahí:
// este archivo es la frontera de validación, no el pipeline).
// ============================================================
import { z } from 'zod';

/** Celda cruda tal como llega del bridge (Excel/Power Automate). */
const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** Matriz de celdas: el parser localiza header/columnas por contenido. */
const gridSchema = z.array(z.array(cellSchema));

/** Hoja nombrada (embarques es multi-hoja). */
const sheetGridSchema = z.object({
  hoja: z.string().min(1),
  grid: gridSchema,
});

// [INV-B8] O2 vía Power Automate. El gate bloqueante que impide un
// dataset de STOCK vacío por hoja no mapeada vive en
// `construirDatasets` (src/services/ingesta/motor.ts) — pero ese gate
// SOLO corre dentro del CLI (`ingesta-mensual.mjs`). Power Automate NO
// pasa por el motor: arma el JSON directo del Excel ("PA queda tonto,
// solo lee y envía" — ver `docs/ingestion.md`) y lo
// postea aquí. Sin este `.min(1)`, un dataset vacío por lectura
// fallida en PA (rango mal armado, tabla renombrada, hoja no
// encontrada) pasaba la validación y producía un snapshot que se lee
// como "mes sin novedades" — indistinguible de un mes real sin
// cambios.
//
// Por qué es SEGURO exigir ≥1 fila: estos datasets son grids CRUDOS
// con la fila de cabecera incluida (el parser del ETL localiza
// header/columnas por contenido más abajo, no aquí). Una hoja de
// Excel real SIEMPRE trae al menos su fila de cabecera — un arreglo
// vacío (`[]`) no puede significar "mes legítimo sin filas de datos":
// solo puede significar "no se leyó la hoja". Por construcción, esta
// validación nunca rechaza un archivo legítimo (verificado contra los
// 3 formatos reales conocidos — unificado/julio/abril — en
// refresh.schema.test.ts).
//
// Mismo mecanismo de error que ya usa el endpoint para cualquier
// violación de este schema: `safeParse` falla → `route.ts` responde
// 400 `{ error: 'invalid_body', issues }` — el mensaje de cada `.min`
// dice EXACTAMENTE qué dataset vino vacío, diagnosticable desde PA sin
// adivinar.
function datasetGridSchema(nombre: 'inventario' | 'west' | 'reserva') {
  return gridSchema.min(
    1,
    `dataset "${nombre}" vacío: la hoja no se leyó (un grid real siempre trae al menos su fila de cabecera) — revisa el origen en Power Automate`,
  );
}

/**
 * [MVP-CIERRE] `inventario` exige ≥2 filas: cabecera + al menos UN producto.
 *
 * El `.min(1)` de arriba atrapa `[]` ("la hoja no se leyó"), que es lo que
 * INV-B8 vino a cerrar. NO atrapa `[[cabecera]]` — una hoja LEÍDA con cero
 * filas de datos. Y eso pasaba entero: la auditoría adversarial de
 * MVP-CIERRE lo midió, `safeParse` daba `success: true`, `computeSnapshot`
 * producía 0 productos y una BAJA por cada SKU del catálogo vigente.
 *
 * Por qué SOLO `inventario` y no los tres: un mes sin filas de `west` o
 * sin `reserva` es un hecho de negocio posible, y rechazarlo convertiría un
 * mes tranquilo en un fallo de ingesta. Un mes con CERO productos en
 * `Inventario`, en cambio, no existe — sería el catálogo entero
 * desapareciendo, que es exactamente el daño contra el que se protege.
 *
 * Es la capa de ENTRADA del mismo problema que la migración 0015 corta del
 * lado de la bandeja. Dos capas a propósito: si una se relaja, la otra
 * sigue de pie (P13 — la protección no puede vivir en un solo lugar).
 */
const inventarioGridSchema = gridSchema.min(
  2,
  'dataset "inventario" vacío o sin filas de datos (solo la cabecera). Un mes con CERO productos ' +
    'no es un mes tranquilo — es el catálogo entero desapareciendo. Revisa el origen en Power Automate.',
);

const stockBodySchema = z.object({
  source: z.literal('stock'),
  capturedAt: z.string().datetime(),
  archivo: z.string().nullish(),
  datasets: z.object({
    inventario: inventarioGridSchema,
    west: datasetGridSchema('west'),
    reserva: datasetGridSchema('reserva'),
  }),
});

const aduanaBodySchema = z.object({
  source: z.literal('aduana'),
  capturedAt: z.string().datetime(),
  archivo: z.string().nullish(),
  datasets: z.object({
    embarques: z.array(sheetGridSchema).min(1),
  }),
});

// La carga de stock usa el body `datasets` (inventario+west+reserva juntos);
// no se admite una sola hoja de stock como legacy (D1: snapshot de stock
// exige las 3 hojas a la vez). La única carga legacy de una hoja coherente
// es 'embarques' (aduana).
const legacyBodySchema = z.object({
  source: z.literal('embarques'),
  capturedAt: z.string().datetime(),
  archivo: z.string().nullish(),
  rows: gridSchema,
});

/**
 * Schema y tipo comparten el mismo identificador a propósito (patrón
 * zod): `RefreshBody.safeParse(...)` en el route handler y `RefreshBody`
 * como tipo del parámetro de `toIngestJob`.
 */
export const RefreshBody = z.discriminatedUnion('source', [
  stockBodySchema,
  aduanaBodySchema,
  legacyBodySchema,
]);
export type RefreshBody = z.infer<typeof RefreshBody>;
