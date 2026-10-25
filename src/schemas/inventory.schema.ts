// ============================================================
// Bloque 3 · Contrato de entrada de GET /api/inventory (zod).
// Se conserva el nombre exportado histórico (`inventoryQuerySchema`
// / `InventoryQuery`): hay imports existentes al path.
//
// Bloque 6 (F1 · O1, drill-down ADITIVO desde las alertas del
// dashboard): `badge`/`sinV2` son OPCIONALES — ausentes, el
// comportamiento es IDÉNTICO al pre-B6 (ver inventory.service.test.ts,
// "sin params → respuesta idéntica"). `sinV2` acepta '1'/'true' (el
// href literal de la alerta `sin_v2` del dashboard es
// '/catalogo?sinV2=1') y '0'/'false' explícitos; cualquier otro valor
// es 400 invalid_query (mismo rigor que `almacen`, no una coerción
// laxa tipo `Boolean(string)`).
// ============================================================
import { z } from 'zod';
import { CLAVES_ESTATUS } from '@/lib/estatus';

// (INV-TAXO, cierre de auditoría) Cota de longitud para los params de
// texto libre de lectura — antes asimétrico contra el resto del
// proyecto (escritura ya acota: `pendientes.schema.ts` `valor` usa el
// mismo .max(500)). Medido contra el catálogo real (probe de solo
// lectura, no commiteado): la celda compuesta de `familia` más larga
// tiene unos cientos de caracteres (muchas familias separadas por '/', ver
// `src/lib/familias.ts`) y la `descripcion` más larga (contra la que
// también matchea `q`) es del mismo orden — 500 cubre ambas con margen sin
// acercarse al rango (miles de caracteres) que de verdad importaría
// para abuso/DoS.
const MAX_FILTRO_TEXTO = 500;

export const inventoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
  marca: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
  /**
   * (INV-TAXO F3) Forma SIN cambio, pero cambia la SEMÁNTICA: de
   * igualdad exacta sobre el `familia` crudo a PERTENENCIA (multi-valor)
   * vía `contieneFamilia` (`src/lib/familias.ts`) sobre `familias` —
   * cierra el caso real `SERIES 12` (antes solo igualdad
   * exacta encontraba los que NO comparten celda con otra familia).
   */
  familia: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
  /** Igualdad case-insensitive sobre la tecnología EFECTIVA (B-PARCHE F3); `SIN_TECNOLOGIA` (lib/clasificacion.ts) filtra items sin tecnología. */
  tecnologia: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
  /**
   * [CAT-B1 · Tramo C] ÚLTIMO nivel de la cascada (tecnologia ∩ marca ∩
   * familia). Misma forma que `familia` — y misma SEMÁNTICA: PERTENENCIA
   * (multi-valor vía `contieneFamilia`, `src/lib/familias.ts`), nunca
   * igualdad exacta.
   */
  producto: z.string().trim().min(1).max(MAX_FILTRO_TEXTO).optional(),
  almacen: z.enum(['NORTH', 'SOUTH', 'EAST', 'TRAN', 'BO', 'WEST']).optional(),
  /** Drill-down desde la alerta `sobre_reservado`/`sin_v2` del dashboard (B6): solo items con este badge. */
  badge: z.enum(['sobre_reservado', 'sin_familia', 'stock_cero']).optional(),
  /**
   * [2.0.1-A] Filtro por estatus RESUELTO (`resolverEstatus`, precedencia
   * incluida) — NO es `badge`, que mira presencia sin precedencia: un SKU
   * con `total=0` y `resv>0` trae los dos badges, su estatus es
   * `sobre_reservado`, y `?estatus=sin_stock` NO lo incluye mientras
   * `?badge=stock_cero` sí. Las claves válidas se DERIVAN de la taxonomía
   * (`CLAVES_ESTATUS`): un estatus nuevo entra aquí solo, sin editar esta
   * lista a mano.
   */
  estatus: z.enum(CLAVES_ESTATUS).optional(),
  /**
   * [2.0.1-A · D3] Drill-down desde la alerta «Familia distinta a la del
   * archivo»: solo los SKU donde la capa v2 muestra una familia que la fuente
   * ya abandonó. Mismo molde estricto que `sinV2` (`'1'|'true'|'0'|'false'`,
   * nunca una coerción laxa): cualquier otro valor es 400.
   */
  divergencia: z
    .enum(['1', 'true', '0', 'false'])
    .default('false')
    .transform((v) => v === '1' || v === 'true'),
  /** Drill-down desde la alerta `sin_v2` del dashboard (B6): solo items SIN fila en `clasificacion_v2`. */
  sinV2: z
    .enum(['1', 'true', '0', 'false'])
    .default('false')
    .transform((v) => v === '1' || v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
