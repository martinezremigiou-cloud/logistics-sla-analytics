// ============================================================
// Bloque 3 · API · inventory.service.ts  (READS)
// GET /api/inventory: catálogo paginado con marca/familia/descripción
// efectivas (override latest-active-wins) y badges derivados.
// Pinneado al snapshot 'stock' vigente vía `conVigenteStock`
// (anti-mezcla, ver `vigente.service.ts`).
//
// (INV-TAXO F3) `familia` es multi-valor (ver `src/lib/familias.ts`):
// `familias: string[]` viaja SIEMPRE en cada `CatalogoItem`, el filtro
// `?familia=` usa PERTENENCIA (`perteneceAFamilia` sobre `it.familias`,
// no igualdad exacta) y `?q=` también busca substring sobre cada átomo. Las facetas
// (`CatalogoFacetas`) se calculan EN CASCADA sobre el universo
// completo, antes de filtrar — ver el bloque dedicado dentro de
// `buildCatalogPage`.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/supabase/fetch-all';
import { embedName, embedClave, embedExcluida } from '@/lib/supabase/embed';
import { esNoDisponiblePorMigracion } from '@/lib/supabase/pg-errors';
import { resolverEstatus } from '@/lib/estatus';
import { conVigenteStock, type SnapshotVigente } from './vigente.service';
import {
  derivarSku,
  badgesDe,
  divergenciaFamilia,
  resolverClasificacion,
  contarSinTecnologia,
  type ProductoLectura,
  type StockLectura,
  type OverrideLectura,
  type ClasificacionV2Lectura,
} from './derivaciones';
import { mapearV2, SIN_TECNOLOGIA } from '@/lib/clasificacion';
import { separarFamilias, perteneceAFamilia, sinFamilia, contieneFamilia } from '@/lib/familias';
import { cmpStr } from '@/lib/orden';
import type { CatalogoItem, CatalogoPage, CatalogoFacetas, CatalogoFacetaValor } from '@/types';
import { ALMACENES, type CampoOverride } from '@/types/enums';
import type { InventoryQuery } from '@/schemas/inventory.schema';

/**
 * Arma una `CatalogoFacetaValor[]` ordenada ASC a partir de un conteo, y
 * aplica la REGLA ANTI-TRAMPA (ver `CatalogoFacetas` en types/api.ts):
 * si `seleccionado` no aparece en el conteo (comparación case-insensitive
 * — el valor pudo venir de la query en otra capitalización), se agrega
 * con `conteo: 0` para que el usuario nunca quede sin forma de
 * deseleccionarlo desde la UI.
 *
 * [VERT-B2] `ocultos` ESTRECHA esa regla, y sólo eso: son los valores (en
 * minúsculas) que existen ÚNICAMENTE en la población excluida del catálogo.
 * Ésos no se reinyectan, porque hacerlo repintaba en el árbol la marca que la
 * regla acababa de esconder —«VERTICAL (0)» sobre una rejilla vacía— con una
 * liga guardada `?marca=VERTICAL`.
 *
 * ⚠ ES UN ESTRECHAMIENTO, NO UN APAGADO, y la diferencia es la que sostiene
 * la regla buena: un valor que vive en el universo VISIBLE se sigue
 * reinyectando aunque caiga a 0 por la CASCADA (elegiste una tecnología donde
 * esa marca no tiene nada), y uno que no existe en ninguna parte también —si
 * no, una URL con una errata dejaría un filtro imposible de quitar desde el
 * selector. Las dos mitades están probadas en
 * `vert-b2-regla-exclusion.test.ts`.
 */
function facetaConSeleccion(
  conteo: Map<string, number>,
  seleccionado: string | undefined,
  ocultos?: ReadonlySet<string>,
): CatalogoFacetaValor[] {
  const base: CatalogoFacetaValor[] = Array.from(conteo.entries()).map(([valor, c]) => ({ valor, conteo: c }));
  if (seleccionado && !base.some((f) => f.valor.toLowerCase() === seleccionado.toLowerCase())) {
    if (!ocultos?.has(seleccionado.toLowerCase())) {
      base.push({ valor: seleccionado, conteo: 0 });
    }
  }
  return base.sort((a, b) => cmpStr(a.valor, b.valor));
}

/** Fila cruda de `productos` (select con embeds many-to-one). */
export interface ProductoRow {
  sku: string;
  resv: number | null;
  descr_origen: string | null;
  cliente: string | null;
  marcas: unknown;
  familias: unknown;
  /**
   * [2.0.1-A] Lo trae el select para que `divergenciaFamilia` aplique su
   * cláusula de REMANENTE con el mismo criterio que la ficha. Aquí es un no-op
   * por construcción —`fetchSnapshot` ya filtra por el vigente— y se pasa
   * igual para que el predicado sea EL MISMO en las tres pantallas, en vez de
   * una variante que confíe en el filtro del llamador.
   */
  snapshot_id?: string | null;
  /**
   * [CAT-B1 · Tramo B] `productos.tecnologia` (migración 0036, columna
   * CRUDA). Con D-1(a) esta es la ÚNICA fuente de `resuelto.tecnologia`
   * (la v2 se congeló, ver `derivaciones.ts`): sin este campo en el select,
   * `CatalogoItem.tecnologia` quedaría `null` SIEMPRE, aunque el archivo sí
   * traiga tecnología — una regresión silenciosa frente al catálogo de hoy.
   * Opcional por el mismo motivo que `snapshot_id`.
   *
   * ⚠ MEDIDO en su momento, y hay que decirlo aquí porque el párrafo de arriba
   * invita a leerlo al revés: el select es NECESARIO pero NO SUFICIENTE.
   * CON este campo puesto, `productos.tecnologia` seguía en `null` en todas
   * las filas del vigente — la columna la llena la ingesta de
   * `stock`, y la cadencia es en racimos (ver `docs/ingestion.md`). No es un
   * defecto de este select: es que todavía no había llegado un archivo con la
   * columna poblada.
   *
   * 🔴 EL PÁRRAFO DE ARRIBA VENCIÓ, y era falso por DOS lados. Re-medido
   * contra el vigente, al cerrar `CAT-ITER-1`:
   *
   *   - El archivo LLEGÓ: una ingesta posterior pobló
   *     `productos.tecnologia` en la mayoría de las filas y la dejó `null`
   *     en una minoría.
   *   - Y el «todas las filas del vigente» mezclaba dos universos: la
   *     tabla entera (filas vigentes + remanentes) y el vigente. Las nulas
   *     son las del vigente; los remanentes son nulos también, pero no son
   *     del vigente.
   *
   * Se salda POR DELANTE y no se borra el párrafo, porque su ADVERTENCIA
   * sigue valiendo —el select es necesario y no suficiente— y lo que
   * caducó es su CIFRA. Una afirmación envejecida tiene la autoridad del
   * documento que la contiene: quien leyera esto y no la corrección
   * buscaría un `null` que ya no está.
   */
  tecnologia?: string | null;
  /**
   * [CAT-B1 · Tramo B/C] `productos.producto` (migración 0036, columna
   * CRUDA). Se trae para que `resolverClasificacion` calcule
   * `resuelto.producto` — desde Tramo C, `CatalogoItem.producto` lo expone
   * y el filtro `?producto=`/faceta `productos` lo consumen (ver
   * `buildCatalogPage`). Sin el select, ese campo de la resolución
   * quedaría `null` SIEMPRE por falta de dato, no por ausencia real en el
   * archivo.
   */
  producto?: string | null;
}

/** Fila cruda de `stock_por_almacen` (select con embed de almacén). */
export interface StockRow {
  sku: string;
  cantidad: number | null;
  almacenes: unknown;
}

/** Fila cruda de `productos_override` (ya filtrada a `activo=true` en la query). */
export interface OverrideRow {
  id: string;
  sku: string;
  /** [FIX-B1] `CampoOverride` (`@/types/enums`) — desde este bloque también puede ser `'tecnologia'`. */
  campo: CampoOverride;
  valor_editado: string;
  editado_en: string;
  activo: boolean;
}

/**
 * Fila cruda de `productos_metadata`. A diferencia de productos/stock/overrides,
 * NO se filtra por snapshot — es 1:1 por sku (color/imagen sobreviven a
 * cualquier snapshot, no son parte de la ingesta versionada).
 */
export interface MetadataRow {
  sku: string;
  color: string | null;
  imagen_url: string | null;
}

/**
 * Construye la página de catálogo: agrupa stock por SKU, deriva
 * totales/efectivas/badges (`derivaciones.ts`), filtra, ordena
 * (sku ASC, comparación de string simple — determinismo, NO
 * localeCompare) y pagina. 100% PURO — exportado para tests.
 */
export function buildCatalogPage(
  productos: ProductoRow[],
  stock: StockRow[],
  overrides: OverrideRow[],
  metadata: MetadataRow[],
  query: InventoryQuery,
  /**
   * Filas de `clasificacion_v2` YA indexadas por sku (B-PARCHE F3, vía
   * `mapearV2`). Parámetro OPCIONAL al final de la firma (default: Map
   * vacío) para no romper posicionalmente los ~20 call-sites de tests
   * previos a F3 — Map vacío ⇒ `resolverClasificacion` cae a
   * manual/fuente exactamente igual que antes de esta fase.
   */
  v2: Map<string, ClasificacionV2Lectura> = new Map(),
  /**
   * [2.0.1-A · D3] El snapshot al que está pinneada la lectura. Último y
   * OPCIONAL por la misma razón que `v2`: ~20 call-sites posicionales en los
   * tests. Sin él, `divergenciaFamilia` no puede descartar remanentes — aquí
   * no cambia nada (el catálogo ya viene filtrado por el vigente), pero el
   * predicado corre igual que en la ficha en vez de depender de esa suerte.
   */
  snapshotVigenteId: string | null = null,
): CatalogoPage {
  const stockBySku = new Map<string, StockLectura[]>();
  for (const s of stock) {
    const sku = String(s.sku);
    const row: StockLectura = { sku, almacen: embedClave(s.almacenes) ?? '', cantidad: Number(s.cantidad ?? 0) };
    const arr = stockBySku.get(sku);
    if (arr) arr.push(row);
    else stockBySku.set(sku, [row]);
  }

  const overridesLectura: OverrideLectura[] = overrides.map((o) => ({
    sku: String(o.sku),
    campo: o.campo,
    valor_editado: String(o.valor_editado),
    editado_en: String(o.editado_en),
    id: String(o.id),
    activo: Boolean(o.activo),
  }));

  // 1:1 por sku, sin filtro de snapshot (ver comentario de `MetadataRow`).
  const metadataBySku = new Map<string, MetadataRow>();
  for (const m of metadata) {
    metadataBySku.set(String(m.sku), m);
  }

  // [VERT-B2] Los SKU cuya MARCA está excluida del catálogo. La regla NO vive
  // aquí: vive en `marcas.excluida_del_catalogo` (migración 0039) y esto sólo la
  // lee, por el mismo embed que este `select` ya traía. Un
  // `if (marca === 'VERTICAL')` habría convertido una decisión de negocio en un
  // despliegue.
  const skusExcluidos = new Set<string>(
    productos.filter((p) => embedExcluida(p.marcas)).map((p) => String(p.sku)),
  );

  const itemsTodos: CatalogoItem[] = productos.map((p) => {
    const sku = String(p.sku);
    const producto: ProductoLectura = {
      sku,
      marca: embedName(p.marcas) ?? '',
      familia: embedName(p.familias),
      descr_origen: p.descr_origen ?? null,
      cliente: p.cliente ?? null,
      resv: Number(p.resv ?? 0),
      snapshot_id: p.snapshot_id ?? null,
      tecnologia: p.tecnologia ?? null,
      producto: p.producto ?? null,
    };
    const stockRows = stockBySku.get(sku) ?? [];
    // reservasRows: [] — O1 no consulta `reservas` (reservado = productos.resv,
    // no Σreservas); `reserva_descuadre` se descarta, no forma parte de CatalogoItem.
    const derivado = derivarSku(producto, stockRows, [], overridesLectura);
    const metadataRow = metadataBySku.get(sku);
    // Resolución de clasificación: marca/familia/descripción/tecnología
    // EFECTIVAS vienen de `resolverClasificacion` (ver derivaciones.ts) —
    // hasta B-PARCHE F3 esa función consideraba `clasificacion_v2` además de
    // manual/fuente; desde D-1(a) (CAT-B1 · Tramo B) la v2 está
    // CONGELADA y la precedencia es manual > fuente, sin capa intermedia.
    // [FIX-B1] EXCEPCIÓN: `tecnologia` va al revés, fuente > manual — gana
    // `productos.tecnologia` (columna cruda del Excel, migración 0036) en
    // cuanto trae texto, y la captura del portal (`productos_override`,
    // campo 'tecnologia') sólo llena el hueco cuando el Excel calla. Ver
    // `capaFuenteManual` en derivaciones.ts. Y NUNCA de v2, pese a lo que
    // decía esta misma línea antes de D-1(a).
    const resuelto = resolverClasificacion(producto, overridesLectura, v2.get(sku) ?? null);

    return {
      sku,
      marca: resuelto.marca.valor ?? '',
      familia: resuelto.familia.valor,
      // (INV-TAXO F3) multi-valor: separarFamilias() nunca uppercasea ni
      // hace substring — ver src/lib/familias.ts. Invariante testeada:
      // familias === separarFamilias(familia).
      familias: separarFamilias(resuelto.familia.valor),
      descripcion: resuelto.descr.valor,
      total: derivado.total,
      reservado: derivado.reservado,
      disponible: derivado.disponible,
      // `badgesDe` solo lee sobre_reservado/familia_efectiva/total de `derivado`:
      // se sobreescribe familia_efectiva con la EFECTIVA de `resolverClasificacion`
      // para que `sin_familia` refleje esa resolución (hasta B-PARCHE F3 incluía
      // v2; desde D-1(a), es manual > fuente — el resto de `derivado`
      // queda intacto). Ese «manual > fuente» es el de FAMILIA, lo único que
      // este badge lee; la tecnología es la excepción desde FIX-B1 (gana el
      // Excel, la captura sólo llena el hueco — `capaFuenteManual`,
      // derivaciones.ts).
      badges: badgesDe({ ...derivado, familia_efectiva: resuelto.familia.valor }),
      // [2.0.1-A · D3] La divergencia se DERIVA aquí, con lo que la lectura ya
      // tiene (cero fetch nuevo): `producto.familia` es el crudo del archivo y
      // `resuelto` la capa que gana en pantalla.
      divergencia_familia: divergenciaFamilia(producto, overridesLectura, v2.get(sku) ?? null, snapshotVigenteId).clase,
      familia_fuente: producto.familia,
      color: metadataRow?.color ?? null,
      imagen_url: metadataRow?.imagen_url ?? null,
      tecnologia: resuelto.tecnologia.valor,
      // [CAT-B1 · Tramo C] Siempre capa 'fuente' (ver resolverClasificacion):
      // `CampoOverride` no tiene un valor 'producto', así que ninguna captura
      // del portal lo toca. [C2 · corrección] Esta línea decía «gemelo de
      // `tecnologia`, mismo criterio», y desde FIX-B1 ya no lo es: `tecnologia`
      // (arriba) sale de la captura cuando el Excel calla (`capaFuenteManual`,
      // derivaciones.ts); `producto` sale sólo del archivo (`capaFuente`).
      producto: resuelto.producto.valor,
    };
  });

  // ------------------------------------------------------------
  // [VERT-B2] LA EXCLUSIÓN — y va EXACTAMENTE AQUÍ, ni antes ni después.
  //
  // DESPUÉS del `map`, para que el ítem exista y se pueda contar y enseñar;
  // ANTES de la cascada, que es lo que arma el árbol. Si entrara después —sobre
  // `filtered`— el árbol seguiría pintando «VERTICAL N», «sin_tecnologia N» y
  // «sin_familia N» mientras la rejilla muestra 0: la contradicción exacta que
  // este bloque existe para impedir.
  //
  // Se CUENTA lo excluido y viaja al contrato: una población oculta EN SILENCIO
  // es el defecto que este arco lleva dos semanas matando. La pantalla tiene que
  // poder decir «N SKU · M excluidos por regla», no sólo «N».
  //
  // ⚠ Y SE RENOMBRA EL CRUDO A PROPÓSITO: `items` pasa a significar «el universo
  // VISIBLE», así que las cinco lecturas de aquí abajo —la cascada, la faceta de
  // tecnología, el filtro por tecnología y `filtered`— heredan la regla sin que
  // nadie tenga que acordarse. Editar cinco sitios a mano es cómo se olvida uno,
  // y el que se olvida no se ve: sale un número, sólo que el equivocado.
  const itemsExcluidos = itemsTodos.filter((it) => skusExcluidos.has(it.sku));
  const items = itemsTodos.filter((it) => !skusExcluidos.has(it.sku));

  // [VERT-B2] LOS VALORES QUE SE FUERON CON LO EXCLUIDO — para que la REGLA
  // ANTI-TRAMPA no los repinte cuando vienen en la URL (ver `facetaConSeleccion`).
  //
  // «Sólo en lo excluido» se DERIVA de las dos poblaciones, nunca se teclea: un
  // valor que también vive en el universo visible NO entra aquí, porque ahí
  // está por derecho propio y su reinyección es la regla buena funcionando.
  const soloEnExcluidos = (deItem: (it: CatalogoItem) => (string | null | undefined)[]): ReadonlySet<string> => {
    const visibles = new Set<string>();
    for (const it of items) {
      for (const v of deItem(it)) if (v) visibles.add(v.toLowerCase());
    }
    const fuera = new Set<string>();
    for (const it of itemsExcluidos) {
      for (const v of deItem(it)) {
        if (v && !visibles.has(v.toLowerCase())) fuera.add(v.toLowerCase());
      }
    }
    return fuera;
  };
  // Las CUATRO dimensiones que usan la anti-trampa, no sólo `marca`. Medido
  // sobre el vigente: hoy sólo `marca` es alcanzable —un censo midió que los SKU
  // VERTICAL no tienen ni tecnología ni familia propias (los conjuntos `A\B` y `A\C` salen vacíos),
  // así que los otros tres conjuntos salen VACÍOS contra el dato de hoy y no
  // cambian nada.
  //
  // Van los cuatro de todas formas, y por dos razones dichas: (1) hacerlo sólo
  // para `marca` exigiría MÁS código —una excepción escrita al lado de la regla—
  // que aplicarlo uniforme; (2) la vacuidad tiene fecha de caducidad medida en
  // ese mismo censo: **casi todos ya tienen tecnología escrita en
  // `clasificacion_v2`**, invisible sólo porque D-1(a) congeló esa capa. El día
  // que se descongele, esto ya está puesto.
  //
  // ⚠ Y no es una guarda vacua (P19): el conjunto está VACÍO hoy por el dato,
  // no INCAPAZ de llenarse por construcción — `vert-b2-regla-exclusion.test.ts`
  // fabrica el caso y lo prueba en rojo para tecnología y familia.
  const ocultosMarca = soloEnExcluidos((it) => [it.marca]);
  const ocultosTecnologia = soloEnExcluidos((it) => [it.tecnologia]);
  const ocultosFamilia = soloEnExcluidos((it) => it.familias);
  const ocultosProducto = soloEnExcluidos((it) => separarFamilias(it.producto ?? null));

  // ------------------------------------------------------------
  // Facetas EN CASCADA (INV-TAXO F3, + producto en CAT-B1 · Tramo C) —
  // sobre el UNIVERSO (`items`), ANTES de aplicar ningún filtro: tecnologias
  // (universo completo) → marcas (∩ tecnología) → familias/almacenes/
  // sin_familia (∩ tecnología ∩ marca) → productos (∩ tecnología ∩ marca ∩
  // familia, el ÚLTIMO nivel). `q`/`badge`/`sinV2`/`almacen`/`estatus`
  // ([2.0.1-A]) NUNCA participan de esta cascada (ver doc-comment de
  // `CatalogoFacetas`, types/api.ts — la casa de esa regla). Conteos =
  // SKUs, NUNCA piezas.
  // ------------------------------------------------------------
  const conteoTecnologias = new Map<string, number>();
  for (const it of items) {
    if (it.tecnologia != null) {
      conteoTecnologias.set(it.tecnologia, (conteoTecnologias.get(it.tecnologia) ?? 0) + 1);
    }
  }
  // (INV-B7B · O2) Complemento de `conteoTecnologias` sobre el MISMO universo
  // completo (`items`, sin filtrar) — SIN regla anti-trampa: Tecnología es
  // la raíz de la cascada (mismo criterio que `almacenes`, ver doc-comment
  // de `CatalogoFacetas`). No cascada con marca/familia/almacén, igual que
  // `conteoTecnologias` de arriba. [FIX-B1 · item 7] `contarSinTecnologia`
  // (derivaciones.ts) — LA MISMA función que `dashboard.service.ts` usa para
  // `kpis.productos_sin_tecnologia`, para que catálogo y tablero nunca
  // diverjan sobre la misma pregunta.
  const sinTecnologiaFaceta = contarSinTecnologia(items);
  // SIN_TECNOLOGIA es un sentinel de FILTRO, no una tecnología real: nunca
  // se inyecta como si fuera un valor legítimo de la faceta (regla anti-trampa).
  const tecnologiaSeleccionCascada =
    query.tecnologia && query.tecnologia !== SIN_TECNOLOGIA ? query.tecnologia : undefined;
  const facetaTecnologias = facetaConSeleccion(conteoTecnologias, tecnologiaSeleccionCascada, ocultosTecnologia);

  const itemsUniversoTec = query.tecnologia
    ? query.tecnologia === SIN_TECNOLOGIA
      ? items.filter((it) => it.tecnologia == null)
      : items.filter((it) => (it.tecnologia ?? '').toLowerCase() === query.tecnologia!.toLowerCase())
    : items;

  const conteoMarcas = new Map<string, number>();
  for (const it of itemsUniversoTec) {
    conteoMarcas.set(it.marca, (conteoMarcas.get(it.marca) ?? 0) + 1);
  }
  const facetaMarcas = facetaConSeleccion(conteoMarcas, query.marca, ocultosMarca);

  const itemsUniversoTecMarca = query.marca
    ? itemsUniversoTec.filter((it) => it.marca.toLowerCase() === query.marca!.toLowerCase())
    : itemsUniversoTec;

  const conteoFamilias = new Map<string, number>();
  let sinFamiliaFaceta = 0;
  for (const it of itemsUniversoTecMarca) {
    // (R2-1) único predicado de "sin familia" — mismo `sinFamilia` que usa
    // el badge `sin_familia` de `derivaciones.ts`, para que ambos coincidan
    // siempre por construcción (antes divergían por definición, aunque
    // coincidieran en los datos de hoy).
    if (sinFamilia(it.familia)) {
      sinFamiliaFaceta++;
      continue;
    }
    for (const fam of it.familias) {
      conteoFamilias.set(fam, (conteoFamilias.get(fam) ?? 0) + 1);
    }
  }
  const facetaFamilias = facetaConSeleccion(conteoFamilias, query.familia, ocultosFamilia);

  // ------------------------------------------------------------
  // (CAT-B1 · Tramo C) `productos` — ÚLTIMO nivel de la cascada: universo ∩
  // tecnología ∩ marca ∩ familia. Mismo mecanismo que `familias` (multi-valor
  // vía `separarFamilias`), pero SIN complemento `sin_producto`: la ausencia
  // de producto en el alcance activo no es un nodo, es la sección entera la
  // que se ausenta (`CatalogoArbol`). Medido contra el vigente: SOLO
  // una tecnología puebla este arreglo — cualquier otra tecnología (o
  // ninguna tecnología) dentro del alcance activo lo deja en `[]`.
  // ------------------------------------------------------------
  const itemsUniversoTecMarcaFamilia = query.familia
    ? itemsUniversoTecMarca.filter((it) => perteneceAFamilia(it.familias, query.familia!))
    : itemsUniversoTecMarca;

  const conteoProductos = new Map<string, number>();
  for (const it of itemsUniversoTecMarcaFamilia) {
    for (const prod of separarFamilias(it.producto ?? null)) {
      conteoProductos.set(prod, (conteoProductos.get(prod) ?? 0) + 1);
    }
  }
  const facetaProductos = facetaConSeleccion(conteoProductos, query.producto, ocultosProducto);

  // `almacenes` SIEMPRE viaja con las 6 claves fijas (mismo criterio que
  // `EmbarquesFacetaEstatus`): el valor seleccionado nunca puede faltar,
  // así que no necesita la regla anti-trampa.
  const facetaAlmacenes: CatalogoFacetaValor[] = ALMACENES.map((almacen) => {
    let conteo = 0;
    for (const it of itemsUniversoTecMarca) {
      const rows = stockBySku.get(it.sku) ?? [];
      if (rows.some((r) => r.almacen === almacen && r.cantidad > 0)) conteo++;
    }
    return { valor: almacen, conteo };
  });

  const facetas: CatalogoFacetas = {
    tecnologias: facetaTecnologias,
    marcas: facetaMarcas,
    familias: facetaFamilias,
    productos: facetaProductos,
    almacenes: facetaAlmacenes,
    sin_familia: sinFamiliaFaceta,
    sin_tecnologia: sinTecnologiaFaceta,
  };

  const q = query.q?.toLowerCase();
  const marca = query.marca?.toLowerCase();
  const familia = query.familia?.toLowerCase();
  const tecnologia = query.tecnologia?.toLowerCase();

  let filtered = items;
  if (q) {
    filtered = filtered.filter(
      (it) =>
        it.sku.toLowerCase().includes(q) ||
        (it.descripcion ?? '').toLowerCase().includes(q) ||
        // (INV-TAXO F3) substring sobre cada átomo de familia — cierra el
        // caso real 'ROTATIVO' (de ninguno a varios SKUs): 'ROTATIVO' vive DENTRO del átomo
        // 'CLIP ROTATIVO' de 'CLIP 3.0 / CLIP ROTATIVO'. Este substring vive
        // SOLO aquí — `perteneceAFamilia` (filtro `?familia=`, abajo) es
        // pertenencia TOKEN-EXACTA, nunca substring.
        it.familias.some((f) => f.toLowerCase().includes(q)),
    );
  }
  if (marca) {
    filtered = filtered.filter((it) => it.marca.toLowerCase() === marca);
  }
  if (familia) {
    // (INV-TAXO F3) de igualdad exacta a PERTENENCIA multi-valor: cierra el
    // caso real 'SERIES 12' (de pocos a más SKUs, ver src/lib/familias.ts). (R2-2)
    // `perteneceAFamilia` sobre `it.familias`, ya calculado — evita volver a
    // ejecutar `separarFamilias` por ítem, y deja de ser la única excepción
    // al contrato de `CatalogoItem.familia` ("prohibido filtrar/agrupar por
    // este campo", ver types/api.ts).
    filtered = filtered.filter((it) => perteneceAFamilia(it.familias, query.familia!));
  }
  if (query.producto) {
    // [CAT-B1 · Tramo C] PERTENENCIA multi-valor, mismo mecanismo que
    // `familia` (contieneFamilia ya separa internamente) — gemelo, no un
    // mecanismo nuevo.
    filtered = filtered.filter((it) => contieneFamilia(it.producto ?? null, query.producto!));
  }
  if (tecnologia) {
    // `SIN_TECNOLOGIA` (valor reservado, ver `lib/clasificacion.ts`): filtra
    // los items cuya tecnología efectiva es `null`, en vez de comparar contra
    // un nombre real de tecnología.
    filtered =
      tecnologia === SIN_TECNOLOGIA
        ? filtered.filter((it) => (it.tecnologia ?? null) === null)
        : filtered.filter((it) => (it.tecnologia ?? '').toLowerCase() === tecnologia);
  }
  if (query.almacen) {
    const almacenFiltro = query.almacen;
    // Reusa `stockBySku` (ya agrupado arriba, con `almacen` resuelto vía
    // `embedClave`) en vez de re-escanear el arreglo crudo `stock`.
    const skusEnAlmacen = new Set<string>();
    stockBySku.forEach((rows, sku) => {
      if (rows.some((r) => r.almacen === almacenFiltro && r.cantidad > 0)) {
        skusEnAlmacen.add(sku);
      }
    });
    filtered = filtered.filter((it) => skusEnAlmacen.has(it.sku));
  }
  // Drill-down ADITIVO (B6 · O1) desde las alertas-enlace del dashboard.
  // `query.badge`/`query.sinV2` son opcionales (ausentes en cualquier
  // llamada previa a B6 y en los fixtures de test que no los incluyen
  // en el objeto literal) — el `if` truthy los deja sin efecto cuando
  // no vienen, preservando el comportamiento pre-B6 al 100%.
  if (query.badge) {
    const badgeFiltro = query.badge;
    filtered = filtered.filter((it) => it.badges.includes(badgeFiltro));
  }
  if (query.sinV2) {
    // Mismo criterio que `sin_v2` del dashboard: SIN fila en `clasificacion_v2`
    // (independiente de si esa fila tiene campos poblados) — reusa el MISMO
    // `v2` Map ya recibido, cero fetch nuevo.
    filtered = filtered.filter((it) => !v2.has(it.sku));
  }
  // [2.0.1-A] Filtro por estatus RESUELTO. La MISMA `resolverEstatus` que
  // pinta la pastilla del renglón (`estatus-pill.tsx`), sobre los MISMOS
  // `badges`/`disponible` del item: el estatus mostrado y el filtrado no
  // pueden divergir porque son una sola llamada, no dos cálculos. NO es el
  // filtro `badge` de arriba: aquél mira presencia sin precedencia (un SKU
  // sobre-reservado con total=0 pasa `?badge=stock_cero`); éste aplica la
  // precedencia de la taxonomía (ese mismo SKU es `sobre_reservado` y
  // `?estatus=sin_stock` NO lo trae). El fixture divergente de
  // `inventory.service.test.ts` fija la diferencia.
  if (query.estatus) {
    const estatusFiltro = query.estatus;
    filtered = filtered.filter((it) => resolverEstatus(it.badges, it.disponible).clave === estatusFiltro);
  }
  // [2.0.1-A · D3] Drill-down desde la alerta del dashboard. Cuenta SOLO la
  // divergencia de la capa v2: la manual ya no es silenciosa (tiene autor,
  // fecha y botón de revertir), y mezclarlas daría un número que no sirve para
  // ninguna de las dos acciones. Va DESPUÉS de las facetas, como el resto de
  // filtros que no participan de la cascada.
  //
  // ⚠ CONTADOR QUE NO PUEDE INCREMENTARSE (P19), desde D-1(a) (CAT-B1 · Tramo
  // B): `it.divergencia_familia` nunca vale `'v2'` — el porqué está
  // en el doc-comment de `divergenciaFamilia` (derivaciones.ts, cláusula 1).
  // Este filtro devuelve SIEMPRE `[]` desde este commit; lo mismo alimenta el
  // KPI `familiaMovida` de `dashboard.service.ts`, que enlaza aquí. Rediseñar
  // esta alerta (D3) es FUERA DE ALCANCE de este Tramo.
  if (query.divergencia) {
    filtered = filtered.filter((it) => it.divergencia_familia === 'v2');
  }

  const ordered = [...filtered].sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));

  const total = ordered.length;
  const totalPages = Math.ceil(total / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = ordered.slice(start, start + query.pageSize);

  // [VERT-B2] Los nombres se ordenan para que la frase de pantalla sea estable
  // entre corridas: un orden que baila hace que dos capturas de la misma
  // pantalla se vean distintas sin que nada haya cambiado.
  const excluidos = {
    total: itemsExcluidos.length,
    marcas: Array.from(new Set(itemsExcluidos.map((it) => it.marca).filter((m) => m !== ''))).sort(),
  };

  return { items: pageItems, page: query.page, pageSize: query.pageSize, total, totalPages, facetas, excluidos };
}

/**
 * `clasificacion_v2` puede no existir aún en la DB (0008 pendiente de
 * aplicar — B-PARCHE F2 corre en paralelo). `esNoDisponiblePorMigracion`
 * vive en `@/lib/supabase/pg-errors`, compartida con
 * sku/cruce/clasificacion.service.ts y con `esForbidden` (42501,
 * `override.service.ts`).
 */

async function fetchSnapshot(db: SupabaseClient, S: SnapshotVigente) {
  const [productos, stock, overrides, metadata, clasificacionV2] = await Promise.all([
    fetchAllRows<ProductoRow>((from, to) =>
      db
        .from('productos')
        .select('sku,resv,descr_origen,cliente,snapshot_id,tecnologia,producto, marcas(nombre,excluida_del_catalogo), familias(nombre)')
        .eq('snapshot_id', S.id)
        .range(from, to),
    ),
    fetchAllRows<StockRow>((from, to) =>
      db
        .from('stock_por_almacen')
        .select('sku,cantidad, almacenes(clave)')
        .eq('snapshot_id', S.id)
        .range(from, to),
    ),
    fetchAllRows<OverrideRow>((from, to) =>
      db
        .from('productos_override')
        .select('id,sku,campo,valor_editado,editado_en,activo')
        .eq('activo', true)
        .range(from, to),
    ),
    // Sin `.eq('snapshot_id', ...)`: productos_metadata es 1:1 por sku, no versionada por snapshot.
    fetchAllRows<MetadataRow>((from, to) =>
      db.from('productos_metadata').select('sku,color,imagen_url').range(from, to),
    ),
    // clasificacion_v2 (B-PARCHE F3): 1:1 por sku, SIN filtro de snapshot (metadata,
    // igual que productos_metadata) — tolera "no disponible por migración" devolviendo
    // página vacía ANTES de que `fetchAllRows` vea el error, así el resultado final es
    // `[]` (comportamiento pre-parche idéntico) en vez de lanzar.
    fetchAllRows<ClasificacionV2Lectura>(async (from, to) => {
      const res = await db
        .from('clasificacion_v2')
        .select('sku,tecnologia,marca_v2,familia_v2,clase_v2,descr_v2')
        .range(from, to);
      if (esNoDisponiblePorMigracion(res.error)) return { data: [], error: null };
      return res;
    }),
  ]);

  return { productos, stock, overrides, metadata, clasificacionV2, snapshotId: S.id };
}

/** `almacenes` SIEMPRE con las 6 claves fijas, aunque el catálogo esté vacío (mismo criterio que dentro de `buildCatalogPage`). */
function facetasVacias(): CatalogoFacetas {
  return {
    tecnologias: [],
    marcas: [],
    familias: [],
    productos: [],
    almacenes: ALMACENES.map((almacen) => ({ valor: almacen, conteo: 0 })),
    sin_familia: 0,
    sin_tecnologia: 0,
  };
}

/** Catálogo paginado (O1). Sin snapshot 'stock' vigente → página vacía (200, no error). */
export async function listInventory(db: SupabaseClient, query: InventoryQuery): Promise<CatalogoPage> {
  const result = await conVigenteStock(db, (S) => fetchSnapshot(db, S));
  if (!result) {
    // [VERT-B2] `excluidos` en CERO y no ausente: este camino es «no hay
    // snapshot vigente», no «la regla escondió todo». Dejarlo sin poblar
    // obligaría a la pantalla a distinguir `undefined` de `0`, que es
    // justo donde nacen los vacíos que mienten.
    return { items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0, facetas: facetasVacias(), excluidos: { total: 0, marcas: [] } };
  }
  return buildCatalogPage(
    result.productos,
    result.stock,
    result.overrides,
    result.metadata,
    query,
    mapearV2(result.clasificacionV2),
    result.snapshotId,
  );
}
