// ============================================================
// Bloque 3 · API · derivaciones.ts  (100% PURO — sin imports de BD)
// Dominio de derivaciones compartido por O1 (`/api/inventory`) y O2
// (`/api/sku/[sku]`): totales, disponibilidad, descuadre de reservas,
// campos efectivos (override latest-active-wins) y badges.
//
// Decisiones ratificadas (STOP&ASK cerrado):
//   - reservado = productos.resv (valor de la fuente, NO Σreservas).
//   - disponible = total − reservado; sobre_reservado = disponible < 0.
//   - reserva_descuadre = resv !== Σ reservas.cantidad.
//   - total = Σ stock_por_almacen.cantidad (incluye WEST: es un
//     almacén más, sin tratamiento especial en este módulo).
//   - "Override activo" = fila con activo=true de mayor
//     (editado_en, id) — lectura defensiva latest-active-wins, por si
//     llegara a existir más de un override activo simultáneo para el
//     mismo (sku, campo) — el flujo normal de escritura desactiva el
//     anterior, pero este módulo no confía en esa invariante.
// ============================================================
import type { BadgeCatalogo, OrigenClasificacion, CampoOverride } from '@/types';
import { separarFamilias, sinFamilia } from '@/lib/familias';

export interface ProductoLectura {
  sku: string;
  marca: string;
  familia: string | null;
  descr_origen: string | null;
  cliente?: string | null;
  resv: number;
  /** Columna cruda `productos.class` (B-PARCHE F1). Opcional para no romper fixtures previos a F1. */
  clase?: string | null;
  /**
   * [INV-B8] `productos.snapshot_id` — la ingesta lo escribe en la MISMA
   * sentencia y la MISMA transacción que `resv`:
   *
   *   ON CONFLICT (sku) DO UPDATE SET …, resv=EXCLUDED.resv,
   *                                    snapshot_id=EXCLUDED.snapshot_id;
   *
   * (leído de la función DESPLEGADA, 0022). De ahí sale el
   * único hecho que hace posible fechar un número que no tiene historia:
   * `productos` es LATEST-WINS y `resv` no conserva sus valores previos,
   * pero SÍ conserva de qué corrida vino el valor actual. Ver
   * `fueraDelVigente`. Opcional para no romper fixtures anteriores a B8.
   */
  snapshot_id?: string | null;
  /**
   * [CAT-B1 · Tramo B] `productos.tecnologia` — columna CRUDA (migración
   * 0036), tal como viene en el archivo. Antes de D-1(a) `tecnologia` no
   * tenía capa fuente (`capaV2Solo`, SOLO `clasificacion_v2.tecnologia`);
   * con la v2 congelada, ÉSTA es la fuente.
   *
   * [FIX-B1] OBLIGATORIO (no opcional) a propósito, mismo antídoto P25 que
   * `familias_efectivas`/`marca_excluida` en `types/api.ts`: el DEFECTO
   * ALTO medido en este bloque era exactamente que varios lectores
   * (`sku.service.ts`, `dashboard.service.ts`, `proyectos.service.ts`) NO
   * pedían esta columna en su `select` y la ficha decía «Sin tecnología»
   * para TODO SKU. Con el campo requerido, `tsc` enumera cada sitio que
   * construye un `ProductoLectura` — los que de verdad no tienen el dato
   * a mano ponen `tecnologia: null` A LA VISTA, en vez de heredar un
   * `undefined` silencioso.
   */
  tecnologia: string | null;
  /**
   * [CAT-B1 · Tramo B] `productos.producto` — columna CRUDA (migración
   * 0036), el nivel "producto" del archivo de inventario. CAMPO NUEVO en
   * `ClasificacionResuelta`: no tiene capa v2 (nunca existió `producto_v2`)
   * ni capa manual (`productos_override.campo` solo admite
   * `'familia'|'descripcion'`, CHECK de 0001:284 — fuera de alcance de este
   * bloque tocarlo). Opcional por la misma razón que `tecnologia`.
   */
  producto?: string | null;
}

export interface StockLectura {
  sku: string;
  almacen: string;
  cantidad: number;
}

export interface ReservaLectura {
  sku: string;
  kam: string | null;
  cliente: string;
  cantidad: number;
  motivo: string | null;
  fecha: string;
}

export interface OverrideLectura {
  sku: string;
  /** [FIX-B1] `CampoOverride` (`@/types/enums`) — desde la migración de este bloque también puede ser `'tecnologia'` (regla «el Excel gana», ver `capaFuenteManual`). */
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  id: string;
  activo: boolean;
}

/** Fila de `clasificacion_v2` (B-PARCHE F1): capa interpretativa data-driven, 1:1 con `productos.sku`. Los 5 campos son nullable. */
export interface ClasificacionV2Lectura {
  sku: string;
  tecnologia: string | null;
  marca_v2: string | null;
  familia_v2: string | null;
  clase_v2: string | null;
  descr_v2: string | null;
  /**
   * Trazabilidad de la corrida de origen (R2-4, `sku.service.ts`):
   * `'pendiente:<tipo>'` (p. ej. `'pendiente:marca_ambigua'`) cuando el
   * valor lo escribió una persona al resolver un pendiente de la bandeja
   * (migración 0011), en vez del archivo mensual. Opcional: SOLO
   * `sku.service.ts` la selecciona de la BD (ver `decidido_en_bandeja`
   * de `SkuDetalle`) — `inventory.service.ts`/`dashboard.service.ts` no
   * la necesitan y no la piden en su `select`.
   */
  fuente_version?: string | null;
}

export interface Efectivas {
  familia_efectiva: string | null;
  descr_efectiva: string | null;
}

export interface DerivadoSku extends Efectivas {
  total: number;
  reservado: number;
  disponible: number;
  sobre_reservado: boolean;
  reserva_descuadre: boolean;
}

/**
 * Override activo de (sku, campo): entre las filas `activo=true` que
 * matchean, gana la de mayor `(editado_en, id)` — comparación de
 * string simple (mismo criterio de determinismo que el orden de
 * `/api/inventory`; los timestamps ISO 8601 comparan correctamente
 * como string). Sin match → null.
 */
export function overrideActivo(
  overrides: OverrideLectura[],
  sku: string,
  campo: CampoOverride,
): OverrideLectura | null {
  let ganador: OverrideLectura | null = null;
  for (const o of overrides) {
    if (o.sku !== sku || o.campo !== campo || !o.activo) continue;
    if (
      !ganador ||
      o.editado_en > ganador.editado_en ||
      (o.editado_en === ganador.editado_en && o.id > ganador.id)
    ) {
      ganador = o;
    }
  }
  return ganador;
}

// ============================================================
// Resolución de clasificación (D-1(a), CAT-B1 · Tramo B, ratificada el
// 17-sep): manual (override) > fuente (`productos`). `clasificacion_v2`
// SE CONGELA — pierde la precedencia que tenía en B-PARCHE F1, pero la
// tabla NO se toca (ni se borra, ni se deja de leer en otros puntos del
// sistema): sigue íntegra y legible, solo que ya nada aquí la consulta para
// decidir un valor. Por eso el parámetro `v2` de `resolverClasificacion`
// SIGUE en la firma (ver más abajo el porqué) aunque su contenido ya no
// participe de ningún resultado.
//
// EL CENSO QUE RESPALDA ESTO (un censo del archivo vigente contra la capa
// espejo): PIERDE = 0 en todos los campos dentro de ese universo. Fuera de él, la
// factura está dicha y aceptada (los SKU que la v2 conoce y el archivo ya no).
//
// [FIX-B1] `tecnologia` ROMPE la regla pareja de arriba, A PROPÓSITO: es la
// ÚNICA capa donde «el Excel gana» en vez de «el portal gana». Familia y
// descripción existen porque alguien del negocio los reclasifica a mano
// sobre un archivo que ya trae un valor (y ese valor manual debe pesar más);
// tecnología es la inversa — el archivo es la fuente autorizada cuando la
// trae, y la captura del portal solo llena el hueco mientras el Excel no
// dice nada. Por eso `tecnologia` NO usa `capaManualFuente`: usa
// `capaFuenteManual` (mismas dos capas, orden invertido), ver más abajo.
// ============================================================
export interface Origen {
  valor: string | null;
  origen: OrigenClasificacion | null;
}

export interface ClasificacionResuelta {
  descr: Origen;
  familia: Origen;
  marca: Origen;
  clase: Origen;
  tecnologia: Origen;
  /**
   * [CAT-B1 · Tramo B] CAMPO NUEVO: no existía en `ClasificacionResuelta`
   * antes de este bloque. `productos.producto` (migración 0036) no tiene
   * capa v2 (nunca existió `producto_v2`) ni capa manual propia (a
   * diferencia de `tecnologia` desde FIX-B1, `productos_override.campo` no
   * tiene un valor `'producto'`) — es `fuente` siempre, igual que
   * marca/clase.
   */
  producto: Origen;
}

/** manual (valor no-nulo) ?? fuente (capa por default, aun si su valor es null). Familia/descripción: EL PORTAL GANA. */
function capaManualFuente(manual: string | null | undefined, fuente: string | null | undefined): Origen {
  if (manual != null) return { valor: manual, origen: 'manual' };
  return { valor: fuente ?? null, origen: 'fuente' };
}

/** Solo fuente: sin capa manual ni v2. `origen` es SIEMPRE 'fuente', aun cuando el valor sea null (capa por default). */
function capaFuente(fuente: string | null | undefined): Origen {
  return { valor: fuente ?? null, origen: 'fuente' };
}

/**
 * [FIX-B1 · revisión] `true` si `valor` trae contenido tras recortar el
 * espacio en blanco. Antes `capaFuenteManual` sólo comprobaba `!= null`,
 * así que una celda del Excel con puros espacios ("   ") contaba como
 * "el Excel SÍ trae tecnología" en TypeScript mientras la base la trata
 * como AUSENTE (`btrim()`, migración 0044: `upper(btrim(p.tecnologia)) =
 * upper(btrim(t.nombre))` en `tecnologias_seleccionables()`, y
 * `btrim(coalesce(v_excel, '')) <> ''` en `aplicar_override`) — dos
 * criterios de "vacío" para el mismo dato.
 *
 * [C2 · corrección] Esta línea decía «MISMA regla de vacío que la SQL». No
 * es la misma: `.trim()` de JS quita el espacio en blanco que define
 * ECMAScript (WhiteSpace + LineTerminator: tabulador, saltos de línea, NBSP
 * U+00A0, U+FEFF, la categoría Zs…), y `btrim()` sin segundo argumento
 * quita SÓLO el espacio ASCII (U+0020). [C2 · ronda 2] Una versión anterior
 * de esta nota decía «TODO el espacio en blanco de Unicode»: tampoco. U+0085
 * (NEL) es espacio para Unicode y `.trim()` NO lo quita — medido con node:
 * `'\u0085'.trim() === ''` da `false`. Un valor como
 * "\t" o " " es VACÍO aquí y PRESENTE para la base.
 *
 * Por qué hoy las dos coinciden de todos modos: lo que la ingesta escribe en
 * `productos.tecnologia` pasa por `cellText` (`src/services/etl/normalize.ts`),
 * que ya recorta con este mismo `.trim()` de JS y convierte lo vacío en
 * `null` — ninguna celda llega a la base con blanco en las orillas por esa
 * vía, y sobre todo lo que la ingesta produce las dos reglas dan lo mismo.
 * La captura del portal tampoco lo trae: `override.schema.ts` valida con
 * `z.string().trim()`. La diferencia sigue viva para una escritura DIRECTA
 * a la base (SQL a mano, otra herramienta) que deje un blanco no-ASCII: ahí
 * TypeScript diría «sin tecnología» y la SQL «el Excel ya la trae».
 */
function textoPresente(valor: string | null | undefined): valor is string {
  return valor != null && valor.trim() !== '';
}

/**
 * [FIX-B1] fuente (con contenido) ?? manual (override activo, capa por
 * default). Tecnología: EL EXCEL GANA — la inversa exacta de
 * `capaManualFuente`. Existe porque el negocio quiere que la columna del
 * archivo mensual sea la autoridad en cuanto exista: si el Excel trae
 * tecnología, ni el RPC `aplicar_override` deja escribir un override nuevo
 * encima (SQLSTATE `MXEXL`, `override.service.ts`) NI esta función lo
 * dejaría ganar aunque lo encontrara — las dos guardas son redundantes a
 * propósito (defensa en profundidad, mismo criterio que `esForbidden`/
 * `is_admin()`). La captura del portal solo se ve cuando el Excel calla.
 *
 * [FIX-B1 · revisión] "con contenido" = `textoPresente` (arriba), no sólo
 * `!= null`: una celda en blanco del Excel se trata como AUSENTE, igual
 * que la SQL — si no, el override del portal quedaría atrapado detrás de
 * espacios en blanco que la base ya ignora.
 */
function capaFuenteManual(fuente: string | null | undefined, manual: string | null | undefined): Origen {
  if (textoPresente(fuente)) return { valor: fuente, origen: 'fuente' };
  if (textoPresente(manual)) return { valor: manual, origen: 'manual' };
  return { valor: null, origen: 'fuente' };
}

/**
 * Resuelve la clasificación, campo por campo — D-1(a): `clasificacion_v2`
 * CONGELADA, sin precedencia:
 *   - descr / familia = manual (override activo latest-wins) ?? fuente
 *     (EL PORTAL GANA, `capaManualFuente`).
 *   - marca / clase / producto = fuente siempre ('manual' reservado a
 *     futuro para marca/clase/producto — hoy ninguno tiene override — y
 *     'v2' YA NO SE EMITE NUNCA: queda en la unión `OrigenClasificacion`
 *     por compatibilidad de lectura de quien ya persistió/consume ese
 *     valor, no porque esta función lo produzca).
 *   - tecnologia = fuente (`productos.tecnologia`, migración 0036 CAT-B1)
 *     ?? manual (override activo latest-wins) — [FIX-B1] EL EXCEL GANA, la
 *     ÚNICA capa con el orden invertido (`capaFuenteManual`): ver el
 *     comentario de cabecera de esta sección y el de `capaFuenteManual`.
 * "??" = la capa superior gana solo si aporta un valor NO-nulo.
 *
 * ------------------------------------------------------------
 * POR QUÉ `_v2` SIGUE EN LA FIRMA AUNQUE EL CUERPO NO LA LEA
 * ------------------------------------------------------------
 * NO es compatibilidad posicional con los call-sites — esa razón se escribió
 * primero aquí y es la floja. La razón buena es que **sin este parámetro el
 * invariante de D-1(a) sería INDEMOSTRABLE**.
 *
 * El Gate B afirma: «recibe una fila v2 CON OTRO VALOR y aun así devuelve
 * `origen: 'fuente'`». Si la firma no admitiera una fila v2, ese test no
 * podría ni escribirse: quedaría reducido a no pasar nada, que es verde con
 * cualquier implementación. Quitar el parámetro habría vuelto inexpresable
 * «la v2 gana» — y de paso, inexpresable «la v2 NO gana», que es lo que hay
 * que probar. La guarda necesita poder sostener el sujeto que niega.
 *
 * ⚠ Y el `_` NO basta: `next build` corre `@typescript-eslint/no-unused-vars`,
 * que **no** exime el guion bajo en este repo (`.eslintrc.json` extiende
 * `next/typescript` sin `argsIgnorePattern`). `tsc --noEmit` salió 0 y
 * `next build` salió 1 sobre esta misma línea.
 *
 * EL MECANISMO ES LA POSICIÓN, NO LA CARPETA — y esta nota ya se escribió mal
 * dos veces, así que va medida:
 *   · La primera versión afirmaba que «el guion bajo exime y no duplica al
 *     lint». Falso.
 *   · La segunda lo corrigió diciendo que los `_param` supervivientes «viven
 *     todos en `*.test.ts`, que el build no lintea». **También falso.**
 * Lo medido: hay varios `_param` en código de producción que el build atraviesa
 * sin quejarse — en `app/api/proyectos/[id]/route.ts`, `app/api/sku/[sku]/route.ts`,
 * `lib/corpus/markdown.ts`, `lib/estatus.ts`, `lib/guardas/codigo-fuente.ts`
 * y `services/documento/pdf.ts`. **Todos, sin excepción, llevan un
 * parámetro USADO detrás.** Ésa es la regla real: `args: "after-used"`, el
 * default de `no-unused-vars`, sólo reporta el parámetro sin usar que va
 * DESPUÉS del último usado. `_v2` es el último de esta firma; por eso rompe.
 *
 * (Corregir una afirmación falsa con otra afirmación no medida deja el archivo
 * igual de mentiroso aunque el arreglo funcione: `LA-RAZON-TAMBIEN-SE-MIDE`.)
 */
export function resolverClasificacion(
  producto: ProductoLectura,
  overrides: OverrideLectura[],
  // El parámetro se conserva a propósito: es el SUJETO de la prueba negativa
  // del Gate B (ver el bloque de arriba). Sin él, «la v2 no gana» no se puede
  // afirmar. La exención va en UNA sola línea a propósito: `eslint-disable-next-line`
  // aplica a la línea inmediatamente siguiente, y con el comentario partido en
  // varias la directiva apuntaba a otro comentario — medido, el build seguía rojo.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _v2: ClasificacionV2Lectura | null | undefined,
): ClasificacionResuelta {
  const familiaOverride = overrideActivo(overrides, producto.sku, 'familia');
  const descrOverride = overrideActivo(overrides, producto.sku, 'descripcion');
  // [FIX-B1] Tecnología SÍ tiene override desde este bloque — pero resuelto
  // con `capaFuenteManual` (orden invertido, ver cabecera de la sección):
  // el Excel gana en cuanto trae un valor no-nulo, y la captura del portal
  // solo se ve cuando la columna del archivo está vacía.
  const tecnologiaOverride = overrideActivo(overrides, producto.sku, 'tecnologia');

  return {
    descr: capaManualFuente(descrOverride ? descrOverride.valor_editado : null, producto.descr_origen),
    familia: capaManualFuente(familiaOverride ? familiaOverride.valor_editado : null, producto.familia),
    marca: capaFuente(producto.marca),
    clase: capaFuente(producto.clase ?? null),
    tecnologia: capaFuenteManual(producto.tecnologia, tecnologiaOverride ? tecnologiaOverride.valor_editado : null),
    producto: capaFuente(producto.producto),
  };
}

/**
 * familia_efectiva / descr_efectiva: proyector delgado sobre
 * `resolverClasificacion`. RETRO-COMPATIBLE: con `v2` ausente (caso de hoy
 * en O1/O2, que todavía no arman la capa v2) se comporta EXACTAMENTE igual
 * que antes de B-PARCHE — override activo ?? valor de origen.
 */
export function efectivas(
  producto: ProductoLectura,
  overrides: OverrideLectura[],
  v2?: ClasificacionV2Lectura | null,
): Efectivas {
  const resuelto = resolverClasificacion(producto, overrides, v2);
  return {
    familia_efectiva: resuelto.familia.valor,
    descr_efectiva: resuelto.descr.valor,
  };
}

/** total = Σ stock_por_almacen.cantidad (incluye WEST, sin filtrar por sku: el caller ya agrupó). */
export function totalDe(stockRows: StockLectura[]): number {
  return stockRows.reduce((sum, r) => sum + r.cantidad, 0);
}

/** Deriva totales/disponibilidad/efectivas de un SKU a partir de sus filas ya filtradas. */
export function derivarSku(
  producto: ProductoLectura,
  stockRows: StockLectura[],
  reservasRows: ReservaLectura[],
  overrides: OverrideLectura[],
): DerivadoSku {
  const total = totalDe(stockRows);
  const reservado = producto.resv;
  const disponible = total - reservado;
  const sumaReservas = reservasRows.reduce((sum, r) => sum + r.cantidad, 0);

  return {
    total,
    reservado,
    disponible,
    sobre_reservado: disponible < 0,
    reserva_descuadre: reservado !== sumaReservas,
    ...efectivas(producto, overrides),
  };
}

/**
 * Badges en orden fijo: [sobre_reservado, sin_familia, stock_cero].
 * `sin_familia` vía `sinFamilia` (R2-1, `src/lib/familias.ts`) — único
 * predicado soportado, compartido con la faceta `sin_familia` de
 * `inventory.service.ts`: antes este badge comparaba `=== null` a secas,
 * que no detectaba `''`/`'   '`/`'/'` (sin átomos tras separar, pero no
 * `null`).
 */
export function badgesDe(d: DerivadoSku): BadgeCatalogo[] {
  const badges: BadgeCatalogo[] = [];
  if (d.sobre_reservado) badges.push('sobre_reservado');
  if (sinFamilia(d.familia_efectiva)) badges.push('sin_familia');
  if (d.total === 0) badges.push('stock_cero');
  return badges;
}

/**
 * [FIX-B1 · item 7] Cuenta ítems cuya tecnología EFECTIVA es `null` — UNA
 * sola aritmética para el catálogo (`inventory.service.ts`,
 * `facetas.sin_tecnologia`) y el tablero (`dashboard.service.ts`,
 * `kpis.productos_sin_tecnologia`), en vez de dos recorridos que puedan
 * divergir (mismo patrón que `descuadresDe`/`esRetrasado`: en cuanto una
 * cifra se define en dos sitios, los dos sitios divergen sin que ningún
 * test lo note).
 *
 * `items` recibe SOLO lo que cada caller ya considera "VISIBLE" —
 * `inventory.service.ts` filtra la exclusión de marca (VERT-B2) ANTES de
 * llegar aquí, y `dashboard.service.ts` construye sus `vistas` a partir de
 * `productosVisibles` con el mismo filtro — esta función no vuelve a
 * decidir qué es visible, solo cuenta.
 *
 * NO es el mismo universo que `DashboardKpis.sin_tecnologia` (congelado a
 * la bandeja de pendientes por decisión de producto en CAT-ITER-1 · O-2b, ver
 * `dashboard.service.ts`): ésa cuenta TRABAJO PENDIENTE de resolver, ésta
 * cuenta PRODUCTOS sin tecnología efectiva hoy. Son dos preguntas
 * distintas y conviven en `kpis` bajo nombres distintos.
 *
 * [FIX-B1 · revisión] Cuenta como "sin tecnología" tanto `null`/`undefined`
 * como una cadena en blanco (`textoPresente`, arriba) — equivalente a la
 * SQL (`btrim()`) sobre lo que produce la ingesta, NO en general: la
 * diferencia está dicha en `textoPresente`. `tecnologia` efectiva ya viene resuelta por
 * `resolverClasificacion`, pero el tipo de este parámetro es deliberadamente
 * más laxo (`{ tecnologia?: string | null }`) para que ambos callers puedan
 * pasar su propia forma de fila sin adaptarla primero.
 */
export function contarSinTecnologia(items: ReadonlyArray<{ tecnologia?: string | null }>): number {
  return items.reduce((n, it) => (textoPresente(it.tecnologia) ? n : n + 1), 0);
}

/**
 * `true` si un embarque está retrasado: tiene `eta` (comparación de
 * string simple, formato fecha ISO `YYYY-MM-DD`) estrictamente anterior a
 * `hoy` Y todavía no tiene `fecha_llegada`. Antes duplicada inline (misma
 * expresión exacta) en `cruce.service.ts` (`CruceEmbarqueItem.retrasado`)
 * y `dashboard.service.ts` (KPI `retrasados` + alerta) — consolidada aquí
 * para que ambos compartan UNA sola fuente del criterio.
 */
export function esRetrasado(eta: string | null, fecha_llegada: string | null, hoy: string): boolean {
  return eta !== null && fecha_llegada === null && eta < hoy;
}

// ============================================================
// [INV-B8] Dos predicados que el Módulo Proyectos necesita y que viven
// AQUÍ, no en `proyectos.service.ts`, por la misma razón que `esRetrasado`
// se consolidó aquí: en cuanto una cifra se define en dos sitios, los dos
// sitios divergen sin que ningún test lo note. `piezas_en_camino` es la
// prueba viva — 4 implementaciones sueltas y ninguna compartida.
// ============================================================

/**
 * `true` si la fila de `productos` NO viene del snapshot al que está
 * pinneada la lectura — es decir, el SKU ya no aparece en el archivo
 * vigente.
 *
 * POR QUÉ ESTE PREDICADO EXISTE. Sin él, un SKU que salió del Excel se
 * imprime con `total = 0` (no tiene filas de stock en el snapshot
 * pinneado) y `resolverEstatus` lo etiqueta **"Sin stock"**, que es
 * falso: no es que no haya stock, es que el SKU no está en el archivo.
 * Medido: hubo SKU en esa situación, todos con `resv=0`
 * y con fecha antigua. Un documento que sale hacia un cliente no puede
 * afirmar eso.
 *
 * POR QUÉ NO HACE FALTA NI MIGRACIÓN NI BANDERA. La columna ya viaja en
 * la fila que la lectura ya trae, y la escribe la ingesta junto a `resv`
 * (ver `ProductoLectura.snapshot_id`). Y como es DERIVADO y no
 * persistido, contesta sola la pregunta que ninguna de las opciones
 * evaluadas esquivaba: **si el SKU vuelve al Excel, esto
 * vuelve a `false` sin que nadie tenga que reabrir nada.**
 *
 * Devuelve `false` cuando no se puede saber (fila sin `snapshot_id`, o
 * lectura sin snapshot pinneado): no afirmar nada es preferible a
 * afirmar lo contrario.
 */
export function fueraDelVigente(
  producto: ProductoLectura,
  snapshotVigenteId: string | null | undefined,
): boolean {
  if (!producto.snapshot_id || !snapshotVigenteId) return false;
  return producto.snapshot_id !== snapshotVigenteId;
}

/**
 * Qué CAPA está ganando cuando la pantalla y el archivo no dicen lo mismo.
 * `'v2'` = la clasificación revisada; `'manual'` = un override de una persona.
 */
export type ClaseDivergencia = 'v2' | 'manual';

export interface DivergenciaFamilia {
  /** `null` cuando no hay dos verdades que reconciliar. */
  clase: ClaseDivergencia | null;
  /** Átomos de familia según el archivo de inventario (la fuente). */
  fuente: string[];
  /** Átomos que la pantalla está mostrando (la capa efectiva). */
  efectiva: string[];
}

/**
 * [2.0.1-A · D3] ¿La familia que se MUESTRA sigue siendo la que el archivo
 * declara?
 *
 * ────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE. El negocio está re-ramificando familias en el Excel, y la
 * capa `clasificacion_v2` —trabajo manual de clasificación— no se entera: gana
 * en pantalla y se queda con el nombre viejo. Medido: **cientos**
 * de SKU vigentes mostrando una familia que la fuente ya abandonó (`DMY5139-A`:
 * pantalla `CLIP 2.0`, archivo `OBSOLETO`). Nadie lo veía.
 *
 * **Este predicado NO decide quién gana.** Quién gana es lo que resuelve
 * `resolverClasificacion` — y desde D-1(a) (CAT-B1 · Tramo B) esa
 * precedencia es `manual > fuente`, sin `v2`. Lo que el sistema debe
 * garantizar es que **la divergencia deje de ser silenciosa** — el criterio
 * acordado: *«cuál gana es tuyo; que se VEA, es del sistema»*.
 *
 * ⚠ CONSECUENCIA DE D-1(a), MEDIDA Y NO "ARREGLADA" AQUÍ: con `v2` fuera de
 * la precedencia, `resuelto.familia.origen` de la cláusula (1) SOLO puede
 * ser `'manual'` o `'fuente'` — nunca `'v2'`. Como la cláusula (1) ya
 * descarta `'fuente'`, al llegar al `return` final el origen SIEMPRE es
 * `'manual'`: la rama `'v2'` de ese ternario queda INALCANZABLE. No es un
 * defecto de este bloque — es el reverso exacto de que la v2 ya no pueda
 * ganar—, pero el efecto corre aguas abajo: `ClaseDivergencia` sigue
 * declarando `'v2'` en su unión (no se borra: ver §"'v2' deja de emitirse"
 * en `OrigenClasificacion`) y los contadores que filtran por
 * `divergencia_familia === 'v2'` (`inventory.service.ts` — filtro
 * `?divergencia`, `dashboard.service.ts` — KPI `familiaMovida`) van a dar
 * SIEMPRE 0 desde este commit. Rediseñar esa alerta (D3) NO es parte de
 * D-1(a)/Tramo B — queda dicho para quien la retome, no decidido aquí.
 *
 * ────────────────────────────────────────────────────────────
 * LA REGLA, en cuatro cláusulas y EN ESTE ORDEN:
 *
 *   1. Si la capa que ganó ES la fuente → no hay dos verdades. `null`.
 *   2. Si el SKU ya no viene en el archivo vigente (`fueraDelVigente`) → `null`:
 *      no se puede comparar contra un archivo que ya no lo menciona. Mismo
 *      criterio que rige ahí — no afirmar lo que no se puede saber.
 *   3. Si la fuente no trae familia (`sinFamilia`: cubre `null`, `''`, `'  '`,
 *      `'/'`) → `null`. **Ausencia no es discrepancia**: que la v2 rellene un
 *      hueco es exactamente para lo que se hizo.
 *   4. Comparar por CONJUNTOS de átomos, case-insensitive — nunca strings.
 *      `'QZ8/H5980'` y `'QZ8 / H5980'` son el mismo concepto (regla 2 de
 *      `separarFamilias`), y ahí es justo donde una comparación burda de texto
 *      infla el número.
 *
 * EL OVERRIDE MANUAL DIVERGE, PERO EN OTRO CUBO. Se devuelve como `'manual'` y
 * los contadores lo excluyen: ese caso **ya no es silencioso** (tiene autor,
 * fecha, insignia «editado» y botón de revertir en la ficha) y se arregla de
 * otra forma —hablando con quien lo escribió, no re-revisando la v2—. Sumarlos
 * daría un número que no sirve para ninguna de las dos acciones.
 *
 * LÍMITE DECLARADO, y no se disfraza: **la cláusula 1 no es falsable por
 * valor**. Si el origen es `'fuente'`, la efectiva ES la fuente y cualquier
 * implementación devolvería `null` con o sin ella. Se queda porque corta
 * trabajo y porque hace que la función diga *«no hay dos capas»* en vez de
 * *«los valores coinciden»*, que no es lo mismo — pero ninguna prueba puede
 * ponerla en rojo sola, y eso se dice en vez de fingir cobertura.
 *
 * NO PERSISTE NADA. Es derivado en lectura, así que **baja solo** conforme
 * Hugo re-revisa. Una columna se quedaría marcando SKU ya reconciliados
 * hasta que alguien se acordara de limpiarla (P27: la fila que sobrevive al
 * arreglo).
 */
export function divergenciaFamilia(
  producto: ProductoLectura,
  overrides: OverrideLectura[],
  v2: ClasificacionV2Lectura | null | undefined,
  snapshotVigenteId: string | null | undefined,
): DivergenciaFamilia {
  const fuente = separarFamilias(producto.familia);
  const resuelto = resolverClasificacion(producto, overrides, v2);
  const efectiva = separarFamilias(resuelto.familia.valor);
  const sin: DivergenciaFamilia = { clase: null, fuente, efectiva };

  if (resuelto.familia.origen === 'fuente') return sin; // (1)
  if (fueraDelVigente(producto, snapshotVigenteId)) return sin; // (2)
  if (sinFamilia(producto.familia)) return sin; // (3)

  // (4) conjuntos, no cadenas.
  const norm = (xs: string[]) => new Set(xs.map((x) => x.toLocaleUpperCase('es-MX')));
  const a = norm(fuente);
  const b = norm(efectiva);
  let iguales = a.size === b.size;
  if (iguales) {
    for (const x of Array.from(a)) {
      if (!b.has(x)) {
        iguales = false;
        break;
      }
    }
  }
  if (iguales) return sin;

  return { clase: resuelto.familia.origen === 'manual' ? 'manual' : 'v2', fuente, efectiva };
}

/**
 * `true` si la partida de un proyecto está EN RIESGO: lo disponible no
 * alcanza para lo que el proyecto comprometió.
 *
 * NO ES UN UMBRAL INVENTADO, y conviene mostrar por qué: esta única
 * comparación SUBSUME los dos predicados que el catálogo ya usa, dado
 * que `cantidad >= 1` (garantizado por `CHECK (cantidad > 0)` en
 * `proyecto_partidas`):
 *
 *   · `sobre_reservado` ≡ `disponible < 0` ⟹ `disponible < 1 <= cantidad` ✔
 *   · `stock_cero`      ≡ `total = 0` ⟹ `disponible = −resv <= 0 < cantidad` ✔
 *
 * Escribir la disyunción completa (`sobre_reservado || stock_cero ||
 * disponible < cantidad`) daría exactamente el mismo resultado con dos
 * cláusulas que nunca pueden ser el motivo real. El barrido de
 * `derivaciones.test.ts` ("la disyuncion completa daria EXACTAMENTE lo
 * mismo") lo verifica sobre 6×7×7 combinaciones, en vez de dejarlo como
 * afirmación de comentario.
 *
 * PRECONDICIÓN, y su borde: `cantidad >= 1`. Lo garantizan el CHECK de la
 * tabla y `agregarPartidaSchema`. En `cantidad = 0` la equivalencia SÍ se
 * rompe (un SKU con `total=0, resv=0` da `disponible=0`, así que esto
 * devuelve `false` mientras `stock_cero` es `true`) — no se "arregla"
 * forzando el argumento, porque eso escondería un llamador que ya está
 * pasando algo que la base nunca aceptaría. El test lo deja escrito.
 *
 * `esRetrasado` queda DELIBERADAMENTE fuera. No por descuido: incluirlo
 * obligaría a cargar embarques por SKU, que es el mismo dato del que
 * cuelgan las varias implementaciones sueltas de `piezas_en_camino`. Meterlo
 * aquí sin consolidar antes esa suma es escribir otra más. Queda anotado en
 * `docs/known-limitations.md`.
 */
export function enRiesgo(derivado: Pick<DerivadoSku, 'disponible'>, cantidad: number): boolean {
  return derivado.disponible < cantidad;
}

// ============================================================
// Bloque 6 · descuadresDe (100% PURO)
// Lista de productos vigentes cuyo `resv` NO coincide con la Σ de sus
// `reservas.cantidad` (mismo snapshot) — MISMO criterio que
// `derivarSku(...).reserva_descuadre` (arriba), expuesto aquí a nivel
// de LISTA (no solo boolean por sku) para que dashboard.service.ts
// (alerta `descuadre_reservas`) y pendientes.service.ts (bloque
// DERIVADO de la bandeja) compartan UNA sola fuente de la aritmética
// en vez de duplicarla — ver PendientesResponse.derivados.descuadres.
// ============================================================
export interface Descuadre {
  sku: string;
  resv: number;
  suma_reservas: number;
}

/** Σ `reservas.cantidad` agrupada por sku, indexada por sku (helper de armado para `descuadresDe`). */
export function agruparReservasPorSku(reservas: ReservaLectura[]): Map<string, ReservaLectura[]> {
  const map = new Map<string, ReservaLectura[]>();
  for (const r of reservas) {
    const arr = map.get(r.sku);
    if (arr) arr.push(r);
    else map.set(r.sku, [r]);
  }
  return map;
}

/**
 * Productos cuyo `resv` no coincide con la Σ de sus `reservas.cantidad`
 * (mismo snapshot). Orden de salida: el mismo orden de `productos` de
 * entrada (el caller ordena/pagina si lo necesita).
 */
export function descuadresDe(
  productos: ProductoLectura[],
  reservasBySku: Map<string, ReservaLectura[]>,
): Descuadre[] {
  const out: Descuadre[] = [];
  for (const p of productos) {
    const sumaReservas = (reservasBySku.get(p.sku) ?? []).reduce((sum, r) => sum + r.cantidad, 0);
    if (p.resv !== sumaReservas) {
      out.push({ sku: p.sku, resv: p.resv, suma_reservas: sumaReservas });
    }
  }
  return out;
}
