// ============================================================
// Bloque 3 · API · api.ts
// DTOs de respuesta de las rutas de LECTURA (`/api/inventory`,
// `/api/sku/[sku]`). Shapes de salida hacia el cliente — no
// confundir con los tipos de tabla (`Sku`, `Embarque`, etc.) de
// `types/sku.ts` / `types/embarque.ts`, que reflejan columnas crudas.
// ============================================================
import type { OrigenClasificacion, ClaveAlmacen, Rol, CampoOverride } from './enums';

/** Orden fijo de evaluación/salida: [sobre_reservado, sin_familia, stock_cero]. */
export type BadgeCatalogo = 'sobre_reservado' | 'sin_familia' | 'stock_cero';

export interface CatalogoItem {
  sku: string;
  marca: string;
  /**
   * Campo CRUDO de display, EFECTIVO (override > v2 > fuente) — pero
   * multi-valor mal modelado como texto: muchas familias distintas
   * pueden convivir en una sola celda separadas por '/' (una parte
   * notable de los SKUs, ver `src/lib/familias.ts`). PROHIBIDO filtrar, agrupar o
   * sumar por este campo — úsalo SOLO para mostrar el string tal cual
   * (p.ej. "CLIP 3.0 / CLIP ROTATIVO"). Para encontrar (buscar/filtrar/
   * navegar) usa SIEMPRE `familias` (abajo); para agregar CANTIDAD usa
   * SIEMPRE una dimensión de valor único (marca, almacén) — ver el GATE
   * de conservación de piezas en `dashboard.service.ts`.
   */
  familia: string | null;
  /**
   * (INV-TAXO F2) `familia` ya separado en sus átomos EFECTIVOS — ver
   * `separarFamilias`, `src/lib/familias.ts`. Invariante testeada:
   * `familias === separarFamilias(familia)`. REQUERIDO (no opcional) a
   * propósito: un opcional habría dejado a algún consumidor navegando
   * por `.familia` sin que el compilador lo detectara — este campo
   * rompe deliberadamente los fixtures de test existentes para que
   * `tsc` enumere cada call-site. Multi-valor: sirve para ENCONTRAR
   * (chips de UI, filtro, búsqueda), NUNCA para sumar piezas.
   */
  familias: string[];
  descripcion: string | null;
  total: number;
  reservado: number;
  disponible: number;
  badges: BadgeCatalogo[];
  /**
   * [2.0.1-A · D3] `'v2'` si la familia que se MUESTRA ya no es la que el
   * archivo de inventario declara; `'manual'` si quien la cambió fue una
   * persona (ese caso ya tiene autor, fecha y botón de revertir en la ficha,
   * así que se cuenta aparte); `null` si no hay dos verdades.
   *
   * Es un ESTADO por SKU: cuenta SKUs y **nunca piezas** — no puede entrar en
   * ninguna agregación de cantidad, como la propia `familia` (ver arriba).
   * Lo deriva `divergenciaFamilia` (`services/derivaciones.ts`), que es la
   * única casa de la regla; no se persiste en ningún lado, así que baja solo
   * conforme la clasificación se re-revisa.
   */
  divergencia_familia?: 'v2' | 'manual' | null;
  /** El crudo de la FUENTE, para poder decir en pantalla qué dice el archivo. `null` si no trae. */
  familia_fuente?: string | null;
  /**
   * Color curado (B5); `null` si el SKU no tiene uno asignado en
   * `productos_metadata`. Opcional (no `color: string | null` a secas)
   * para que los fixtures de UI de P2a/P3 que aún no lo incluyen sigan
   * compilando — el service SIEMPRE lo puebla (nunca queda `undefined`
   * en una respuesta real de `/api/inventory`).
   */
  color?: string | null;
  /** `null` si el SKU no tiene imagen en `productos_metadata`. Opcional por el mismo motivo que `color`. */
  imagen_url?: string | null;
  /**
   * Tecnología EFECTIVA. Hasta B-PARCHE F1: SIEMPRE de `clasificacion_v2`
   * (sin capa fuente para este campo). Desde CAT-B1 · Tramo B / D-1(a)
   * (17-sep): `clasificacion_v2` se congela (pierde la precedencia) y la
   * columna cruda `productos.tecnologia` (migración 0036) pasa a ser la
   * fuente. [FIX-B1] Desde este bloque, si el archivo NO trae el dato,
   * cae al override capturado en el portal (`capaFuenteManual` —
   * `derivaciones.ts`, «el Excel gana»): `null` solo cuando NI el archivo
   * NI el portal traen nada. El catálogo no distingue el origen (no expone
   * un `origenes`/`tecnologia_portal` como la Ficha) — solo muestra la
   * EFECTIVA. Opcional por el mismo motivo que `color`/`imagen_url`.
   */
  tecnologia?: string | null;
  /**
   * [CAT-B1 · Tramo C] `producto` EFECTIVO — SIEMPRE capa `'fuente'`
   * (`productos.producto`, migración 0036): no existe `producto_v2` ni
   * override manual (`productos_override.campo` solo admite
   * `'familia'|'descripcion'`), ver `resolverClasificacion.producto`
   * (derivaciones.ts). Multi-valor por la MISMA barra '/' que `familia` —
   * MEDIDO contra el vigente: muchos valores distintos la traen,
   * p.ej. 'CLIP 3.0 / CLIP ROTATIVO'. Esto REFUERZA la regla, no la
   * debilita: la rama 'CLIP 3.0' tiene muchos más SKU por pertenencia que por
   * igualdad exacta — filtrar por `===` perdería la mayor parte de esa rama. Filtra
   * SIEMPRE con PERTENENCIA vía `contieneFamilia` (`src/lib/familias.ts`),
   * NUNCA con igualdad. Opcional por el mismo motivo que `tecnologia`: no
   * romper los fixtures de UI previos a este campo.
   */
  producto?: string | null;
}

/** Un valor distinto de una faceta con su conteo de SKUs (NUNCA piezas) dentro del alcance de esa faceta. */
export interface CatalogoFacetaValor {
  valor: string;
  conteo: number;
}

/**
 * (INV-TAXO F3) Facetas EN CASCADA del catálogo, calculadas en
 * `buildCatalogPage` (inventory.service.ts): `tecnologias` sobre el
 * UNIVERSO completo · `marcas` sobre universo ∩ tecnología · `familias`
 * y `almacenes` sobre universo ∩ tecnología ∩ marca. `q`/`badge`/
 * `sinV2`/`estatus` ([2.0.1-A]) NUNCA participan de la cascada. Conteos
 * = SKUs, NUNCA piezas. Las opciones del filtro por estatus tampoco
 * viajan aquí: son la taxonomía FIJA de `TAXONOMIA_ESTATUS`
 * (`src/lib/estatus.ts`), no una faceta del dato — el usuario nunca
 * puede quedar atrapado porque las opciones no dependen del universo.
 *
 * Σ `familias[].conteo` puede ser ≥ `CatalogoPage.total`: un SKU con
 * varias familias (multi-valor, ver `src/lib/familias.ts`) cuenta UNA
 * VEZ en cada una de sus familias — no es un error de aritmética, es la
 * naturaleza de la dimensión (misma razón por la que `familia` está
 * prohibido para agregaciones, ver `CatalogoItem.familia`).
 *
 * REGLA ANTI-TRAMPA (obligatoria): el valor actualmente SELECCIONADO
 * (`?tecnologia=`/`?marca=`/`?familia=`) viaja SIEMPRE en su faceta
 * aunque, tras aplicar los filtros de más arriba en la cascada, su
 * conteo sea 0 — sin esto la cascada atrapa al usuario sin forma de
 * quitar el filtro desde la UI. Es una inversión DELIBERADA de la
 * asimetría de `EmbarquesFacetas` (Bloque 7-A): ahí las facetas NUNCA
 * reaccionan a ningún filtro (siempre universo completo) precisamente
 * para no necesitar esta regla; aquí SÍ reaccionan en cascada, así que
 * la regla anti-trampa es indispensable. `almacenes` es la excepción
 * que no la necesita: siempre viaja con las 6 claves fijas de
 * `ClaveAlmacen` (igual criterio que `EmbarquesFacetaEstatus`), así que
 * el valor seleccionado nunca puede faltar.
 */
export interface CatalogoFacetas {
  tecnologias: CatalogoFacetaValor[];
  marcas: CatalogoFacetaValor[];
  familias: CatalogoFacetaValor[];
  /**
   * (CAT-B1 · Tramo C) ÚLTIMO nivel de la cascada: tecnología ∩ marca ∩
   * familia — copia EXACTA del mecanismo de `familias` (multi-valor,
   * `separarFamilias`/`contieneFamilia`), pero SIN complemento
   * `sin_producto`: a diferencia de familia/tecnología, la ausencia de
   * producto en el alcance activo NO es un nodo del árbol — es la SECCIÓN
   * entera la que se ausenta (`CatalogoArbol`), nunca un encabezado con
   * cero ramas debajo. Medido contra el vigente: SOLO
   * tecnologia=BRAND1 puebla este arreglo (todos sus SKU, con muchos ÁTOMOS
   * distintos — los valores CRUDOS que `separarFamilias` atomiza, no
   * confundir el crudo con lo que pinta esta faceta); EAS/BRAND2/
   * sin-tecnología quedan SIEMPRE en `[]`. Sin filtro de tecnología esta
   * faceta da lo mismo (SOLO BRAND1 aporta), sobre un universo donde una parte
   * de los SKU no tiene producto en absoluto — decisión deliberada de
   * este Tramo, no un hueco sin probar (ver `inventory.service.test.ts`).
   * Dos ramas propias llevan una barra en su nombre — `ZV680G/K` y
   * `Z1900 / 6693` — porque la compuerta anti-átomo-fantasma de
   * `separarFamilias` las conserva enteras a propósito (ver
   * `esAtomoSospechoso`, `src/lib/familias.ts`); y existe una rama llamada
   * literalmente `OBSOLETO` — calidad del dato de origen, no del
   * código. Regla anti-trampa igual que el resto: `?producto=` seleccionado
   * viaja aunque su conteo caiga a 0.
   */
  productos: CatalogoFacetaValor[];
  /** SIEMPRE las 6 claves de `ClaveAlmacen`, en orden fijo, aunque alguna tenga conteo 0. */
  almacenes: CatalogoFacetaValor[];
  /** SKUs (dentro de universo ∩ tecnología ∩ marca) sin ninguna familia efectiva — complemento de `familias`, que nunca los cuenta. */
  sin_familia: number;
  /**
   * (INV-B7B · O2) SKUs sobre el UNIVERSO COMPLETO (sin acotar por ningún
   * filtro) sin tecnología efectiva — complemento de `tecnologias`, que
   * nunca los cuenta (mismo sentinel `SIN_TECNOLOGIA` de
   * `lib/clasificacion.ts` que filtra por este valor). Mismo criterio que
   * `almacenes` (NO el de `marcas`/`familias`): Tecnología es la RAÍZ de
   * la cascada, sin nivel superior que la acote, así que este conteo NO
   * necesita la regla anti-trampa — no hay forma de que el valor
   * seleccionado quede "atrapado" fuera de aquí.
   */
  sin_tecnologia: number;
}

export interface CatalogoPage {
  items: CatalogoItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  facetas: CatalogoFacetas;
  /**
   * [VERT-B2] Qué se dejó FUERA del universo por la regla de exclusión de
   * marcas (`marcas.excluida_del_catalogo`, migración 0039), y por qué viaja en
   * el contrato en vez de quedarse en el servicio:
   *
   * **`total` ya no es «lo que hay»: es «lo que se muestra».** Sin este campo la
   * pantalla no tendría con qué decirlo, y una población oculta EN SILENCIO es
   * exactamente el defecto que este arco lleva dos semanas matando — el KPI que
   * afirmaba contención sin decir de qué dependía, el vacío que decía «aún no
   * hay datos» con el catálogo lleno.
   *
   * `marcas` trae los NOMBRES de las marcas excluidas que de verdad tenían
   * productos en este universo — no el catálogo entero de marcas excluidas:
   * anunciar una marca excluida que no aportaba nada sería ruido.
   */
  excluidos: {
    total: number;
    marcas: string[];
  };
}

export interface SkuStockItem {
  almacen: string;
  cantidad: number;
}

export interface SkuReservaItem {
  kam: string | null;
  cliente: string;
  cantidad: number;
  motivo: string | null;
  fecha: string;
}

export interface SkuEmbarqueItem {
  id: string;
  oc_po: string | null;
  proveedor: string | null;
  referencia: string | null;
  factura: string | null;
  pais_origen: string | null;
  piezas: number | null;
  fw: string | null;
  tipo_importacion: string | null;
  fecha_recoleccion: string | null;
  etd: string | null;
  eta: string | null;
  fecha_llegada: string | null;
  fecha_disponibilidad: string | null;
  estatus: string;
  estatus_orden: number;
  proyecto: string | null;
  observaciones: string | null;
  is_historial: boolean;
  /** eta !== null && fecha_llegada === null && eta < hoy. */
  retrasado: boolean;
}

export interface SkuSnapshotInfo {
  id: string;
  created_at: string;
  filas: number | null;
  archivo: string | null;
  vigente: boolean;
}

export interface SkuDetalle {
  sku: string;
  marca: string;
  /**
   * [VERT-B2] ¿La marca de este SKU está excluida del catálogo
   * (`marcas.excluida_del_catalogo`, migración 0039)?
   *
   * ⚠ ES INFORMATIVO, NO UN FILTRO. La Ficha se sirve SIEMPRE — es `C-3` del
   * censo del bloque: el catálogo puede decir «no existe» mientras la Ficha
   * sirve sus piezas, y la respuesta acordada fue servirla y DECLARARLO, no
   * esconderla. Este campo es lo que permite declararlo.
   *
   * REQUERIDO a propósito, igual que `familias_efectivas`: opcional, un
   * consumidor nuevo se olvidaría de pintarlo y la marca excluida se serviría
   * en silencio, que es el defecto que este bloque existe para impedir. Con el
   * campo obligatorio, `tsc` enumera a cada consumidor.
   *
   * 🔴 Y el hueco de esa promesa, MEDIDO al aplicarla — y resultó más fino de
   * lo que yo había escrito una línea antes. Dos fixtures cierran con
   * `as SkuDetalle`, y `tsc` se comportó DISTINTO con cada uno:
   *
   *   · `evidencia-visual-chat.test.tsx` — objeto literal, sin spread: **SÍ**
   *     se puso rojo (TS2352, «neither type sufficiently overlaps»).
   *   · `lib/chat/tarjeta.test.ts` — el mismo `as`, pero con `...over` dentro:
   *     **NO** se puso rojo. El spread ensancha lo suficiente para que la
   *     comprobación de solapamiento pase.
   *
   * O sea que el hueco no es «las aserciones de tipo», es «las aserciones de
   * tipo SOBRE UN OBJETO CON SPREAD». Es un hueco más estrecho, pero sigue
   * siendo un hueco: ése hubo que visitarlo a mano y lleva su nota puesta.
   */
  marca_excluida: boolean;
  familia_efectiva: string | null;
  /**
   * (INV-TAXO F2) `familia_efectiva` ya separada en sus átomos — ver
   * `separarFamilias`, `src/lib/familias.ts`. Invariante testeada:
   * `familias_efectivas === separarFamilias(familia_efectiva)`.
   *
   * El badge de `origenes.familia` (abajo) describe el CAMPO completo
   * (`familia_efectiva`), NUNCA un chip individual: un override
   * reemplaza el string entero, así que un origen "por chip" es
   * irrepresentable. La UI pinta N chips (uno por elemento de
   * `familias_efectivas`) + 1 solo badge de origen para el campo —
   * NUNCA N badges.
   */
  familias_efectivas: string[];
  /**
   * [2.0.1-A · D3] 'v2' si la familia mostrada ya no es la del archivo de
   * inventario; 'manual' si la fijó una persona; null si no hay dos verdades.
   * NO se agrega `familia_fuente`: ya viaja como `original.familia` —
   * duplicarla sería la segunda verdad que este repo persigue.
   */
  divergencia_familia?: 'v2' | 'manual' | null;
  descr_efectiva: string | null;
  original: { familia: string | null; descr: string | null };
  stock: SkuStockItem[];
  total: number;
  reservado: number;
  disponible: number;
  sobre_reservado: boolean;
  reserva_descuadre: boolean;
  reservas: SkuReservaItem[];
  embarques: SkuEmbarqueItem[];
  /** Σ piezas (null→0) de embarques activos (is_historial=false). */
  piezas_en_camino: number;
  /** Σ piezas (null→0) de embarques históricos (is_historial=true). */
  piezas_historial: number;
  imagen_url: string | null;
  /**
   * Color curado (B5); `null` si el SKU no tiene uno asignado en
   * `productos_metadata`. Opcional (no `color: string | null` a secas)
   * para que los fixtures de UI de P2a/P3 que aún no lo incluyen sigan
   * compilando — el service SIEMPRE lo puebla.
   */
  color?: string | null;
  /**
   * Clase efectiva. Hasta B-PARCHE F1: clasificacion_v2.clase_v2 ??
   * productos.class. Desde D-1(a) (CAT-B1 · Tramo B, 17-sep): SIEMPRE
   * `productos.class` — la v2 se congeló. Opcional (retro-compat de
   * fixtures previos a F1).
   */
  clase?: string | null;
  /**
   * Tecnología EFECTIVA. Hasta B-PARCHE F1: SIEMPRE de `clasificacion_v2`
   * (sin capa fuente). Desde D-1(a): `productos.tecnologia` (migración
   * 0036). [FIX-B1] Desde este bloque `sku.service.ts` SÍ selecciona esa
   * columna (era el DEFECTO ALTO del bloque: la ficha decía «Sin
   * tecnología» para todo SKU) y la resolución es `capaFuenteManual` —
   * EL EXCEL GANA: si `productos.tecnologia` trae valor, ÉSE es el
   * efectivo; si el archivo viene vacío, cae al override capturado en el
   * portal (ver `origenes.tecnologia`/`tecnologia_portal`, abajo).
   */
  tecnologia?: string | null;
  /**
   * [FIX-B1] El valor CAPTURADO en el portal para `tecnologia` (override
   * activo, si existe), INDEPENDIENTE de si está en efecto o no — a
   * diferencia de `tecnologia` (arriba), que ya resolvió quién gana. `null`
   * = nunca se capturó nada en el portal para este SKU. Sirve para la nota
   * «lo capturado en el portal (X) ya no aplica: manda el Excel» cuando el
   * archivo empieza a traer dato DESPUÉS de que alguien ya había
   * capturado uno manualmente (el override queda activo pero sin efecto —
   * `aplicar_override` no lo desactiva solo).
   */
  tecnologia_portal?: string | null;
  /**
   * Capa que aportó cada valor efectivo. Hasta B-PARCHE F1: 'manual'
   * (override) > 'v2' (`clasificacion_v2`) > 'fuente' (`productos`). Desde
   * D-1(a) (17-sep): 'manual' > 'fuente' para descr/familia/marca/clase —
   * `'v2'` ya no se emite nunca (ver `OrigenClasificacion`).
   *
   * [FIX-B1] `tecnologia` es la EXCEPCIÓN con el orden INVERTIDO (fuente >
   * manual, «el Excel gana» — ver `capaFuenteManual` en `derivaciones.ts`):
   * `'fuente'` cuando el archivo trae el dato (o cuando ni el archivo ni el
   * portal traen nada — capa por default), `'manual'` cuando el archivo
   * viene vacío y hay una captura del portal en efecto. Nunca `null`: desde
   * D-1(a) siempre hay una capa fuente que responder, aunque su valor sea
   * `null`.
   */
  origenes?: {
    descr: OrigenClasificacion;
    familia: OrigenClasificacion;
    marca: OrigenClasificacion;
    clase: OrigenClasificacion;
    tecnologia: OrigenClasificacion | null;
  };
  /**
   * Valores CRUDOS de `clasificacion_v2` (B-PARCHE F1), sin resolver contra
   * overrides: la UI los muestra como "la capa inmediata bajo un override
   * manual" activo. `null` = sin fila v2 para este sku.
   */
  v2?: {
    descr: string | null;
    familia: string | null;
    marca: string | null;
    clase: string | null;
    tecnologia: string | null;
  } | null;
  /**
   * Campos de la capa v2 cuyo valor lo decidió una persona en la bandeja
   * (`clasificacion_v2.fuente_version = 'pendiente:<tipo>'`), no el archivo
   * mensual (R2-4, ratificado). Sin esta distinción, la Ficha
   * mostraría la insignia "clasificación v2" como si el Excel lo hubiera
   * dicho, cuando en realidad lo decidió un admin al resolver un pendiente
   * `marca_ambigua`. REQUERIDO (no opcional) a propósito, mismo criterio
   * que `familias_efectivas`: que `tsc` enumere cada consumidor en vez de
   * dejarlo sin esta señal en silencio. Poblado por `sku.service.ts`.
   */
  decidido_en_bandeja: { marca: boolean };
  snapshot: { stock: SkuSnapshotInfo | null; aduana: SkuSnapshotInfo | null };
}

/**
 * Respuesta de PUT /api/override (O5): sku + campo editado + efectivas
 * frescas post-escritura. [FIX-B1] `tecnologia_efectiva` viaja SIEMPRE,
 * igual que `familia_efectiva`/`descr_efectiva`: las tres se recalculan en
 * cada escritura sin importar qué `campo` se tocó (el cliente refresca la
 * ficha entera con esta respuesta).
 */
export interface OverrideResult {
  sku: string;
  campo: CampoOverride;
  valor_efectivo: string | null;
  familia_efectiva: string | null;
  descr_efectiva: string | null;
  tecnologia_efectiva: string | null;
}

// ============================================================
// Bloque 4 · GET /api/cruce (F1) — pipeline de aduana por etapa.
// Pinneado SIEMPRE a vigente('aduana'); las 11 etapas de
// `estatus_catalogo` viajan completas aunque estén vacías.
// ============================================================

export interface CruceEmbarqueItem {
  id: string;
  sku: string;
  /** descr EFECTIVA del producto (override ?? descr_origen); metadato de display. */
  descripcion: string | null;
  oc_po: string | null;
  proveedor: string | null;
  piezas: number | null;
  tipo_importacion: string | null;
  pais_origen: string | null;
  etd: string | null;
  eta: string | null;
  fecha_llegada: string | null;
  fecha_disponibilidad: string | null;
  proyecto: string | null;
  /** eta !== null && fecha_llegada === null && eta < hoy. */
  retrasado: boolean;
}

/** Σ piezas: los embarques con `piezas` null cuentan 0 en el agregado. */
export interface CruceAgregado {
  embarques: number;
  piezas: number;
}

export interface CruceEtapa {
  orden: number;
  nombre: string;
  /** is_historial=false. */
  activos: CruceAgregado;
  /** is_historial=true — SOLO conteos, sin filas. */
  historial: CruceAgregado;
  /** SOLO activos, ordenados. */
  items: CruceEmbarqueItem[];
}

export interface CruceResumen {
  embarques_activos: number;
  piezas_activas: number;
  embarques_historial: number;
  piezas_historial: number;
}

export interface CruceResponse {
  /** vigente('aduana'); vigente:true cuando existe; null si no hay snapshot. */
  snapshot: SkuSnapshotInfo | null;
  resumen: CruceResumen;
  /** SIEMPRE 11, orden ASC, aunque vacías. */
  etapas: CruceEtapa[];
  /** distinct SKUs con embarque activo, orden ASC. */
  skus_activos: string[];
}

// ============================================================
// Bloque 5 · Admin API (usuarios) — GET/POST /api/usuarios,
// PATCH /api/usuarios/[id] (revisor M2). DTOs compartidos entre
// `usuarios.service.ts` (server) y `config-usuarios.tsx` (cliente) —
// antes duplicados en ambos lados.
// ============================================================

export interface UsuarioItem {
  id: string;
  email: string;
  rol: Rol;
  suspendido: boolean;
}

/**
 * Respuesta de PATCH /api/usuarios/[id]. `password_temporal` solo
 * presente si `accion==='reset_password'`. `usuario` es el
 * `UsuarioItem` fresco post-mutación — EXCEPTO cuando la lectura
 * post-mutación falla justo después de una rotación de contraseña ya
 * irreversible en GoTrue (ronda 3, FIX ALTO-1 de revisor-codigo): ahí
 * `usuario:null`. Antes de este fix el servicio fabricaba un
 * `UsuarioItem` falso (`{email:'', rol:'kam', suspendido:false}`) para
 * cubrir ese hueco — un admin suspendido podía reportarse como KAM
 * activo. El cliente (`config-usuarios.tsx`) solo lee
 * `result?.password_temporal` de esta respuesta (usa el `UsuarioItem`
 * que ya tenía de la lista para pintar la fila), así que `usuario:null`
 * no le afecta.
 */
export type ActualizarUsuarioResult =
  | { usuario: UsuarioItem; password_temporal?: string }
  | { usuario: null; password_temporal: string };

// ============================================================
// Bloque 6 · GET /api/dashboard (F1) — KPIs, heatmap, radar,
// rankings, tendencia y alertas-enlace de la página `/`. Semánticas
// EXACTAS (incl. política de deltas "solo honestos") documentadas en
// `dashboard.service.ts`; este archivo solo declara el shape.
// ============================================================

/** Signo/dirección del delta de un KPI frente a su `periodo_base`. */
export type DireccionDelta = 'sube' | 'baja' | 'igual';

/**
 * Delta de un KPI frente a un periodo base anterior. `pct` es `null`
 * cuando el baseline es 0 (división indefinida — nunca se fabrica un
 * porcentaje de "infinito" o "0→N"). `periodo_base` es el `'YYYY-MM'`
 * contra el que se comparó.
 */
export interface KpiDelta {
  valor: number;
  pct: number | null;
  periodo_base: string;
  direccion: DireccionDelta;
}

/**
 * `delta: null` = "no hay comparación honesta disponible todavía" (política
 * "solo honestos" de B6: en v1 SOLO `kpis.piezas_en_camino` puede traer
 * un delta no-nulo — el resto SIEMPRE viaja `delta: null`, ver
 * `dashboard.service.ts`). No confundir `delta: null` con `valor: 0`.
 */
export interface Kpi {
  valor: number;
  delta: KpiDelta | null;
}

export interface DashboardKpis {
  catalogo_total: Kpi;
  /**
   * (MVP-CIERRE · F5) Piezas que de verdad se pueden prometer: suma de los
   * `disponible` **POSITIVOS**, sin que los sobre-reservados resten.
   *
   * CAMBIO DE DEFINICIÓN, deliberado y ratificado el 2026-07-31.
   * Antes esta cifra era el NETO (los negativos restaban), y convivía con
   * `skus_disponibles`, que siempre contó solo positivos: la tarjeta
   * **contaba una cosa y sumaba otra**. Ambas definiciones son correctas
   * como aritmética; lo que estaba mal era mezclarlas en una frase.
   *
   *   disponible POSITIVO (esta cifra) → capacidad de compromiso.
   *       "¿cuánto puedo prometer?" — la pregunta de un KAM.
   *   NETO (`piezas_disponibles_neto`) → vista contable.
   *       Resta una deuda de un SKU contra la existencia de OTRO, que es
   *       una compensación que no existe en la bodega.
   *
   * Un SKU sobre-reservado aporta CERO disponible, no un disponible
   * negativo. Comparten denominador con `skus_disponibles`, así que los dos
   * números de la tarjeta vuelven a hablar del mismo universo.
   *
   * Las cifras cambian con la definición: la diferencia entre la cifra bruta
   * y la neta son exactamente las piezas de los SKU sobre-reservados. Todo
   * documento anterior a este cambio que diga la cifra neta no está mal: está
   * usando la otra definición.
   */
  piezas_disponibles: Kpi;
  /** (MVP-CIERRE · F5) La vista contable: incluye a los sobre-reservados restando. Ver `piezas_disponibles`. */
  piezas_disponibles_neto: Kpi;
  /** (MVP-CIERRE · F5) Piezas comprometidas de más, como NEGATIVO. `piezas_disponibles + este = neto`. */
  piezas_sobre_reservadas: Kpi;
  skus_disponibles: Kpi;
  sobre_reservados: Kpi;
  piezas_en_camino: Kpi;
  retrasados: Kpi;
  sin_v2: Kpi;
  /**
   * [CAT-ITER-1 · O-2b] YA NO recorre `clasificacion_v2` ni
   * `productos.tecnologia` — CONGELADO por decisión de producto a la BANDEJA de
   * preguntas abiertas: `pendientes_datos` tipo `sku_sin_tecnologia`
   * ABIERTOS (RPC `contar_pendientes()`, 0009). Cuenta TRABAJO POR HACER,
   * no productos sin tecnología efectiva — para eso está
   * `productos_sin_tecnologia` (abajo), que sí es el mismo universo que
   * `CatalogoFacetas.sin_tecnologia`.
   *
   * Sólo `admin` ve un valor real aquí (`MUESTRA_PREGUNTAS_POR_RESOLVER`,
   * `lib/roles.ts` — dato del eje 1, `is_admin()`): para el resto de los
   * roles la RPC responde `0` por RLS, no porque no haya pendientes, así
   * que la UI OCULTA la superficie entera en vez de mostrar ese cero
   * fabricado.
   *
   * (INV-B7B · O2, HISTÓRICO — ya no describe este KPI) Antes de
   * CAT-ITER-1 este campo sí recorría `clasificacion_v2` con el mismo
   * criterio que `sin_v2`; el porqué del cambio (tres candidatos medidos,
   * tres conjuntos DISTINTOS, la bandeja es la intersección exacta) está
   * en el comentario junto a `sinTecnologia` en `buildDashboard`
   * (`dashboard.service.ts`) — no se repite aquí para no divergir.
   */
  sin_tecnologia: Kpi;
  /**
   * [FIX-B1 · item 7] SKUs VISIBLES del vigente cuya tecnología EFECTIVA es
   * `null` — calculado con `contarSinTecnologia` (`derivaciones.ts`), LA
   * MISMA función que `CatalogoFacetas.sin_tecnologia` (`inventory.service.ts`),
   * así que catálogo y tablero SIEMPRE coinciden sobre el mismo universo.
   *
   * NO es el mismo universo que `sin_tecnologia` (arriba): ese KPI quedó
   * CONGELADO por decisión de producto (CAT-ITER-1 · O-2b) a la bandeja de
   * pendientes abiertos — cuenta TRABAJO POR HACER, no productos. Éste
   * cuenta PRODUCTOS sin tecnología efectiva hoy, el mismo número que ve
   * un KAM al filtrar el catálogo por "sin tecnología".
   */
  productos_sin_tecnologia: Kpi;
  pendientes: Kpi;
}

/** Celda sparse del heatmap: solo se emiten celdas con `valor > 0` (sin ceros explícitos). */
export interface HeatmapCelda {
  fila: string;
  columna: string;
  valor: number;
}

/**
 * Heatmap marca × almacén (INV-TAXO F4 — antes familia × almacén: la
 * familia es MULTI-VALOR, y agregarla en una suma inflaba el total
 * porque un SKU con N familias contaba su stock N veces —
 * medido contra el vigente, con muchos SKUs afectados). `marca` es de
 * valor ÚNICO: agrupar por ella conserva SIEMPRE el total de piezas del
 * universo recibido, sin importar cuántas marcas existan (ver el test
 * del GATE en `dashboard.service.test.ts`) — `separarFamilias` JAMÁS se
 * invoca en este cálculo (regla de revisión, ver `dashboard.service.ts`:
 * greppear el nombre de esa función seguido de un paréntesis de
 * apertura —invocación real, no mención en texto— debe dar 0 ahí). El
 * grep amplio anterior (ese nombre O el acceso ".familias") no servía
 * como detector: se auto-matcheaba en el propio comentario que enunciaba
 * la regla, y también matchea el accesor crudo del embed Supabase
 * (`productos→familias`, sin relación con el array multi-valor).
 *
 * `filas` = hasta 10 marcas EFECTIVAS (v2>fuente) con mayor Σ piezas de
 * stock, dentro del universo ya acotado por `tecnologia_activa` (si
 * viene); `columnas` = SIEMPRE las 6 claves de almacén, en este orden
 * fijo, aunque alguna quede sin celdas. `celdas` es SPARSE (solo
 * `valor > 0`). `max` = mayor `valor` entre las celdas emitidas (0 si
 * `celdas` está vacío) — para que la UI escale el color.
 */
export interface DashboardHeatmap {
  eje_y: 'marca';
  eje_x: 'almacen';
  filas: string[];
  columnas: ClaveAlmacen[];
  celdas: HeatmapCelda[];
  max: number;
  /**
   * Valor de `?tecnologia` aplicado a ESTE heatmap (verbatim, incluido
   * el sentinel `SIN_TECNOLOGIA` de `lib/clasificacion.ts`); `null` =
   * sin filtro (heatmap sobre el universo completo). Afecta SOLO al
   * heatmap: KPIs, radar, rankings, pipeline, tendencia y alertas son
   * SIEMPRE globales (ver la asimetría documentada en la cabecera de
   * `dashboard.service.ts`) — filtrarlos en silencio daría el mismo
   * número con otro significado.
   */
  tecnologia_activa: string | null;
  /**
   * Distinct tecnologías EFECTIVAS presentes en el catálogo vigente,
   * calculadas sobre el universo GLOBAL (SIN aplicar `tecnologia_activa`
   * — así el selector nunca se queda sin opciones al elegir una), orden
   * ASC. NUNCA incluye el sentinel `SIN_TECNOLOGIA`: es un valor
   * reservado de filtro, no una tecnología real.
   */
  tecnologias: string[];
  /**
   * Total de marcas DISTINTAS con stock > 0 dentro del universo ya
   * acotado por `tecnologia_activa` (si viene) — ANTES del recorte a
   * top-10 de `filas`/`celdas`. Para la leyenda honesta ("Top 10 de N
   * marcas con stock"): sin este campo, la UI no puede distinguir "solo
   * hay 10 marcas" de "hay muchas y se recortaron varias".
   */
  total_marcas: number;
}

export interface RadarEjes {
  disponible: number;
  reservado: number;
  en_aduana: number;
  /** Σ |disponible| de los SKUs de esa marca con disponible < 0 (siempre ≥ 0). */
  en_riesgo: number;
}

/** Una serie por marca EFECTIVA (top-3 dinámico por Σ total de stock). */
export interface RadarSerie {
  marca: string;
  ejes: RadarEjes;
}

/**
 * El radar, CON su denominador. [DASH-E · E-1]
 *
 * `total_marcas` es el universo **antes** del top-3, mismo molde que
 * `DashboardHeatmap.total_marcas`. Sin él, el corte del radar es **mudo**: tres
 * marcas dibujadas y ninguna pista de si detrás había 3 o 300 — el vecino de al
 * lado sí lo confiesa, y esa asimetría era el defecto.
 *
 * **Va DENTRO del objeto y no como campo hermano de `DashboardResponse`, a
 * propósito:** pegado al dato no se puede leer `series` sin tener el denominador
 * delante. Un campo hermano se puede ignorar para siempre, que es exactamente cómo
 * el radar se quedó mudo la primera vez.
 */
export interface DashboardRadar {
  series: RadarSerie[];
  /** Cuántas marcas EFECTIVAS con stock había ANTES del recorte a 3. */
  total_marcas: number;
}

/**
 * Reservas por KAM, CON su denominador. [DASH-E · E-6]
 *
 * Mismo molde que `DashboardRadar` y que `DashboardHeatmap.total_marcas`: el builder
 * recorta a 6 y **declara el universo que había antes del recorte**. Sin esto el corte
 * es MUDO — seis KAM pintados y ninguna pista de si detrás había 6 o 60.
 *
 * **Era el tercer recorte del mismo archivo y el único que no lo declaraba**, y la
 * lección estaba escrita al lado: `buildRadar` emite `total_marcas: porMarca.size` con
 * el comentario «ANTES del recorte: `top3` ya perdió el universo».
 *
 * MEDIDO sobre el snapshot vigente: el `slice(0, 6)` cortaba a un KAM con una
 * fracción mínima de las piezas. Pequeño
 * hoy; `slice(0, 6)` **no tiene ninguna cota** sobre la fracción que recorta.
 */
export interface DashboardReservasKam {
  items: ReservaKamItem[];
  /** Σ piezas de TODOS los KAM, **antes** del recorte a 6. El bucket nulo incluido. */
  total_piezas: number;
  /** Cuántos KAM había antes del recorte — el bucket nulo cuenta como uno. */
  total_kams: number;
}

/** Fila de "Top SKUs sobre-reservados" (drill-down hacia la ficha del SKU). */
export interface RankingItem {
  sku: string;
  descripcion: string | null;
  marca: string;
  disponible: number;
  reservado: number;
  total: number;
}

/** Bucket de Σ piezas reservadas por KAM; `kam: null` = reservas sin KAM atribuido (la UI decide la etiqueta). */
export interface ReservaKamItem {
  kam: string | null;
  piezas: number;
}

/** Espejo aplanado de `CruceEtapa` para el resumen del dashboard: SIEMPRE 11 filas (orden 1..11), aunque en ceros. */
export interface DashboardPipelineEtapa {
  orden: number;
  nombre: string;
  activos: number;
  piezas: number;
}

/**
 * La gramática del riel, dictada por el equipo de Embarques el 9-sep-2026.
 * `estancia` = el producto ESTÁ en un sitio · `traslado` = el producto SE MUEVE.
 * `sin_clasificar` es para una etapa que el mapa de grupos todavía no conoce:
 * no se le atribuye una gramática que nadie declaró.
 */
export type FormaGrupoPipeline = 'estancia' | 'traslado' | 'sin_clasificar';

/**
 * Un grupo del riel de aduana. [DASH-E · E-1]
 *
 * Referencia sus etapas por `orden` y **no las embebe**: el detalle vive en
 * `pipeline`, así que el agrupamiento no duplica el dato. Una sola verdad sobre
 * qué etapa pertenece a qué grupo, y vive en `GRUPOS_PIPELINE`.
 */
export interface DashboardPipelineGrupo {
  clave: string;
  nombre: string;
  forma: FormaGrupoPipeline;
  /** Las etapas de este grupo, por `orden` — referencia al arreglo `pipeline`, no copia. */
  ordenes: number[];
  activos: number;
  piezas: number;
}

/** Un punto de la serie de tendencia: Σ stock del snapshot vigente de ESE periodo (ver "vigente por periodo" en dashboard.service.ts). */
export interface TendenciaPunto {
  periodo: string;
  piezas: number;
  /**
   * Cuántos snapshots de stock colapsó este periodo. [DASH-D · D-2]
   *
   * OBLIGATORIO a propósito: un punto que resume UN corte y otro que resume
   * NUEVE se dibujan idénticos, y esa diferencia es la confianza del punto —
   * la cadencia de la ingesta es en racimos, no mensual. Dejarlo opcional
   * habría permitido que un consumidor lo omitiera en silencio, que es
   * justamente el hueco que este campo viene a cerrar.
   */
  cortes: number;
}

export type AlertaTipo = 'sobre_reservado' | 'retrasado' | 'sin_v2' | 'descuadre_reservas' | 'pendientes' | 'familia_movida';

/** Alerta-enlace: `conteo` resume la severidad, `href` es a dónde navega la UI al hacer clic. */
export interface Alerta {
  tipo: AlertaTipo;
  conteo: number;
  href: string;
}

export interface DashboardResponse {
  /** Patrón `health`: snapshot vigente por fuente, `null` si aún no hay ninguno. */
  snapshot: { stock: SkuSnapshotInfo | null; aduana: SkuSnapshotInfo | null };
  /** `'YYYY-MM'`; `anterior: null` si solo existe un periodo (o ninguno). */
  periodos: { actual: string | null; anterior: string | null };
  kpis: DashboardKpis;
  heatmap: DashboardHeatmap;
  radar: DashboardRadar;
  top_sobre_reservados: RankingItem[];
  reservas_por_kam: DashboardReservasKam;
  pipeline: DashboardPipelineEtapa[];
  /** El mismo pipeline agrupado para el riel. La Σ de sus grupos es la Σ de `pipeline`. [DASH-E · E-1] */
  pipeline_grupos: DashboardPipelineGrupo[];
  tendencia: TendenciaPunto[];
  alertas: Alerta[];
}

// ============================================================
// Bloque 6 · Bandeja de pendientes de datos (F2) — GET /api/pendientes
// (admin) · POST /api/pendientes/[id] (admin, resolución trazable).
// Espejo tipado de `pendientes_datos` (0009); `payload`/`resolucion`
// son jsonb de forma libre por `tipo` — se exponen como
// `Record<string, unknown>` (el detalle lo interpreta la UI por tipo).
// ============================================================

/**
 * `'marca_ambigua'`/`'familia_atomo_dudoso'` (INV-TAXO F2): encolados
 * por la migración 0011 (fuera de este bloque) para veredicto de producto.
 * `familia_atomo_dudoso` corresponde a la compuerta anti-átomo-fantasma
 * de `separarFamilias` (`src/lib/familias.ts`) — casos de muestra:
 * `ZV680G/K` y `Z1900 / 6693`.
 */
export type TipoPendiente =
  | 'kam_desconocido'
  | 'marca_west'
  | 'colision_familia'
  | 'cuarentena_etl'
  | 'marca_ambigua'
  | 'familia_atomo_dudoso'
  /**
   * (MVP-CIERRE · F2, migración 0013) SKU vigente sin tecnología efectiva.
   * Criterio de ESTADO, no de evento: no depende de cuándo entró el SKU y
   * se auto-cierra cuando deja de aplicar (recibe tecnología por otra vía,
   * o sale del catálogo). Payload: sku, campo, pregunta, poblacion,
   * evidencia, sin_familia, marca_origen, familia_origen, descr_origen.
   */
  | 'sku_sin_tecnologia'
  /**
   * (B, [MVP-2], migración 0019) Familia recién vista en el Excel que el
   * ETL aún no puede emparentar con el catálogo. Encolada UNA fila por
   * familia (no por SKU) por `sincronizar_pendientes_familia`. Payload:
   * `familia` (nombre crudo), `prefijo` (todos los tokens menos el último;
   * `null` si el nombre es de una sola palabra), `hermanas` (familias
   * activas que empiezan por ese prefijo, token-exacto), `skus` (los que
   * trajeron esta familia en la corrida que la encoló).
   */
  | 'familia_nueva';
export type EstadoPendiente = 'abierto' | 'resuelto' | 'descartado';

export interface PendienteDato {
  id: string;
  tipo: TipoPendiente;
  clave_natural: string;
  estado: EstadoPendiente;
  payload: Record<string, unknown>;
  detectado_por: string;
  detectado_en: string;
  snapshot_id: string | null;
  resolucion: Record<string, unknown> | null;
  resuelto_por: string | null;
  resuelto_en: string | null;
}

/** Item del bloque DERIVADO (computado al vuelo, NO persistido): productos vigentes con `resv` descuadrado contra Σ reservas. */
export interface DescuadreItem {
  sku: string;
  resv: number;
  suma_reservas: number;
}

/** [2.0.1-A · D2] Una corrida de ingesta, con su huella de re-ramificación ya interpretada. */
export interface CorridaDriftVista {
  snapshotId: string;
  detectadoEn: string;
  reasignaciones: number;
  altas: string[];
  vaciadas: Array<{ nombre: string; teniaPuente: boolean }>;
  movimientos: Array<{ de: string; a: string; n: number }>;
  renombresProbables: Array<{ de: string; a: string; n: number }>;
  propuestasPuente: Array<{ de: string; a: string; n: number; ficha: string }>;
}

export interface DriftFamiliasVista {
  corridas: CorridaDriftVista[];
  ventanaDias: number;
  totalReasignaciones: number;
}

/**
 * [2.0.1-A · D2] El puente ficha↔familia, medido por el CAMINO y no por la
 * tabla: el titular es cuántos DOCUMENTOS siguen alcanzables preguntando por un
 * SKU (P27 — una fila en una tabla de puentes no es un puente cruzable).
 */
export interface TestigoPuentesVista {
  filasSinCamino: number;
  filasTotales: number;
  documentosAlcanzablesPorSku: number;
  sinCamino: string[];
}

export interface PendientesResponse {
  pendientes: PendienteDato[];
  /**
   * Bloques COMPUTADOS al vuelo, nunca persistidos: se recalculan en cada
   * lectura y se corrigen en la fuente, no aquí. [2.0.1-A · D2] entran el
   * drift de familias y el testigo del puente documental por este mismo
   * carril — cero filas escritas, cero migración, cero contacto con la
   * ingesta. El `| null` es el contrato de «no se pudo derivar», que es
   * DISTINTO de cero: un cero diría que no hay nada roto justo cuando no se
   * pudo mirar.
   */
  derivados: {
    descuadres: DescuadreItem[];
    drift: DriftFamiliasVista | null;
    puentes: TestigoPuentesVista | null;
  };
  /** Mismo shape que la RPC `contar_pendientes()`: `por_tipo` solo trae las claves con al menos 1 abierto. */
  conteos: { abiertos: number; por_tipo: Record<string, number> };
  /**
   * (MVP-CIERRE · F2) Vocabulario DECLARADO de tecnologías (`public.tecnologias`,
   * activas, orden alfabético) — para que la bandeja ofrezca los valores que el
   * negocio ya definió al resolver `sku_sin_tecnologia`, en vez de pedirlos a
   * ciegas.
   *
   * No es una sugerencia cosmética: son decenas de resoluciones seguidas y basta un
   * `Brand1` en vez de `BRAND1` para partir en dos la rama del árbol y que un KAM
   * deje de encontrar sus productos — el mismo problema que ya costó
   * `'Nadia'` vs `'NADIA'` y las colisiones de familia.
   *
   * Verificado al agregarlo: 4 activas (EAS, BRAND2, BRAND1, VERTICAL) y CERO
   * valores en `clasificacion_v2.tecnologia` sin respaldo en el catálogo — la
   * tabla y los datos están en sincronía, así que ofrecerla no introduce
   * vocabulario que el negocio no use.
   */
  tecnologias: string[];
}

export type AccionResolverPendiente = 'confirmar' | 'descartar';

/** Respuesta de POST /api/pendientes/[id] — espejo del jsonb que regresa el RPC `resolver_pendiente`. */
export interface ResolverPendienteResult {
  estado: Extract<EstadoPendiente, 'resuelto' | 'descartado'>;
  actor: string;
  /** Solo presente en `confirmar` de tipo `kam_desconocido`: `{ kam_id }` del KAM dado de alta/reusado. */
  ref?: { kam_id?: string | null };
}

// ============================================================
// Bloque 7-A · GET /api/embarques — "Libro Mayor": TODOS los
// embarques del snapshot 'aduana' vigente (activos + histórico), a
// diferencia de `/api/cruce` (F1) que solo expone los 11 activos
// agrupados por etapa. Con datos reales el histórico es la gran mayoría
// de los embarques del mismo snapshot vigente que consume
// `/cruce` — el histórico es hoy INALCANZABLE desde el resto de la
// app; este endpoint es el único que lo expone.
//
// Asimetría deliberada entre `resumen` y `facetas` (documentada aquí
// porque es la superficie de contrato, no un detalle de
// implementación): `resumen` se calcula sobre el resultado YA
// FILTRADO (refleja lo que el usuario está viendo); `facetas` se
// calcula sobre el UNIVERSO COMPLETO del snapshot, ANTES de aplicar
// ningún filtro — si las facetas reaccionaran al filtro ya aplicado,
// elegir un país haría desaparecer del selector a los demás países y
// el usuario quedaría atrapado sin poder cambiar de filtro.
// `facetas.estatus` viaja SIEMPRE con las 11 etapas del pipeline de
// aduana, aunque alguna tenga conteo 0 (mismo espejo que
// `CruceResponse.etapas`, Bloque 4).
//
// SIN filtro/faceta de `proveedor`: el ETL persiste `proveedor: null`
// literal para todos los embarques de hoy (`parse.embarques.ts:88`) — el
// campo SÍ viaja en cada `EmbarqueItem` (es parte del registro crudo),
// pero no tiene sentido ofrecer un filtro o faceta sobre una columna
// que hoy siempre está vacía.
// ============================================================

/** Fila del Libro Mayor: superset de `SkuEmbarqueItem` (Bloque 3) + el `sku` dueño (ausente en la ficha de un solo SKU) + descripción EFECTIVA de display. */
export interface EmbarqueItem extends SkuEmbarqueItem {
  sku: string;
  /** descr EFECTIVA del producto (3 capas: manual > v2 > fuente), igual criterio que `CruceEmbarqueItem.descripcion`. */
  descripcion: string | null;
}

/** Agregados sobre el resultado FILTRADO (ver nota de asimetría arriba). */
export interface EmbarquesResumen {
  embarques: number;
  /** Σ piezas (null→0) de TODOS los embarques filtrados (activos + histórico). */
  piezas: number;
  /** Conteo con `is_historial=false` dentro del filtrado. */
  activos: number;
  /** Conteo con `is_historial=true` dentro del filtrado. */
  historial: number;
  /** Σ piezas (null→0) SOLO de los activos filtrados. */
  piezas_activas: number;
  /**
   * Conteo con `retrasado=true` dentro del filtrado — en la práctica SOLO
   * cuenta activos: un embarque histórico ya cerró su ciclo y nunca puede
   * estar retrasado (fix [INV-B7A], ver `retrasado` en
   * `buildEmbarquesPage`, embarques.service.ts).
   */
  retrasados: number;
}

/** Una de las 11 etapas del pipeline de aduana, con su conteo en el UNIVERSO del snapshot (sin filtrar). */
export interface EmbarquesFacetaEstatus {
  orden: number;
  nombre: string;
  conteo: number;
}

/** Valor distinto de una columna (hoy solo `pais_origen`) con su conteo en el UNIVERSO del snapshot (sin filtrar). */
export interface EmbarquesFacetaValor {
  valor: string;
  conteo: number;
}

export interface EmbarquesFacetas {
  /** SIEMPRE las 11, orden ASC, aunque alguna tenga conteo 0. */
  estatus: EmbarquesFacetaEstatus[];
  /** Distinct `pais_origen` no-nulos del universo, orden ASC (comparación de string simple). */
  paises: EmbarquesFacetaValor[];
  /**
   * Conteo por ámbito (activos/histórico) del UNIVERSO del snapshot, ANTES
   * de filtrar — mismo criterio que el resto de `facetas` (ver nota de
   * asimetría en la cabecera): NO reacciona a `ambito` ni a ningún otro
   * filtro. `todos` = activos + historial (el total del snapshot). Fuente
   * única de los 3 conteos de las tabs de `/embarques` (revisor-codigo,
   * ronda 2 de B7-A): antes de este campo, la UI pedía un segundo
   * `/api/embarques?pageSize=1` completo solo para leer estos 3 números —
   * un round-trip entero (con sus propios `resolveVigente`/`fetchAllRows`)
   * por 3 enteros que ya se calculaban aquí mismo.
   */
  ambito: { todos: number; activos: number; historial: number };
}

export interface EmbarquesResponse {
  /** vigente('aduana'); vigente:true cuando existe; null si aún no hay snapshot de aduana. */
  snapshot: SkuSnapshotInfo | null;
  items: EmbarqueItem[];
  page: number;
  pageSize: number;
  /** Total del resultado FILTRADO (antes de paginar) — igual a `resumen.embarques`. */
  total: number;
  totalPages: number;
  resumen: EmbarquesResumen;
  facetas: EmbarquesFacetas;
}

// ============================================================
// Bloque 7-A · GET /api/snapshots y GET /api/snapshots/[id]/cambios
// — "Bitácora": historial de ingestas (snapshots) y su diff de
// trazabilidad (`cambios`).
//
// Hecho verificado que documenta el shape: `snapshots.filas` NO
// cuenta filas del Excel de origen — cuenta REGISTROS PERSISTIDOS en
// esa ingesta (para 'stock': productos + stock_por_almacen + reservas
// + embarques; p. ej. 100 + 80 + 50 =
// 230, EXACTO). No confundir con un conteo de renglones de archivo.
//
// `cambios.detectado_en` es IDÉNTICO en todas las filas de un mismo
// snapshot (es el timestamp de LA TRANSACCIÓN del ETL, no un dato por
// fila) — por eso NUNCA sirve como criterio de orden/paginación de
// `CambioItem[]`, y por eso viaja UNA sola vez, en el encabezado
// (`CambiosPage.snapshot.detectado_en`), en vez de repetirse en cada
// `CambioItem`.
// ============================================================

/** Igual shape en la lista (Bloque 7-A·A, un renglón por snapshot) y en el detalle (Bloque 7-A·B, resumen del snapshot completo, SIN filtros). */
export interface SnapshotResumenCambios {
  total: number;
  altas: number;
  bajas: number;
  modificaciones: number;
}

/** Un renglón de la Bitácora (lista). */
export interface SnapshotBitacoraItem {
  id: string;
  fuente: string;
  periodo: string;
  archivo: string | null;
  filas: number | null;
  created_at: string;
  created_by: string | null;
  /** Primeros 12 caracteres de `snapshots.hash` — identificador corto para mostrar en la tabla. */
  hash_corto: string;
  cambios: SnapshotResumenCambios;
  /** `true` si este id coincide con el vigente de SU fuente (ver `vigentes` abajo, que viaja siempre completo). */
  vigente: boolean;
}

export interface SnapshotsPage {
  items: SnapshotBitacoraItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** SIEMPRE presente completo, aunque el filtro/paginado deje a alguno de los 2 vigentes fuera de `items`. */
  vigentes: { stock: SkuSnapshotInfo | null; aduana: SkuSnapshotInfo | null };
}

/** Un renglón del diff de un snapshot — sin `detectado_en` ni `snapshot_id` (ver nota de cabecera: viajan una sola vez en `CambiosPage.snapshot`). */
export interface CambioItem {
  id: string;
  entidad: 'producto' | 'stock' | 'reserva' | 'embarque';
  clave: string;
  sku: string | null;
  campo: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  tipo: 'ALTA' | 'BAJA' | 'MODIFICACION';
}

export interface CambiosPage {
  snapshot: {
    id: string;
    fuente: string;
    periodo: string;
    archivo: string | null;
    filas: number | null;
    hash: string;
    created_at: string;
    created_by: string | null;
    vigente: boolean;
    /** Timestamp ÚNICO de la transacción del ETL para este snapshot (ver nota de cabecera). */
    detectado_en: string;
  };
  /** Del snapshot COMPLETO, SIN aplicar `entidad`/`tipo`/`campo`/`sku` — para que la UI pueda decir "mostrando 50 de 120" (p. ej.). */
  resumen: SnapshotResumenCambios;
  items: CambioItem[];
  page: number;
  pageSize: number;
  /** Total del resultado FILTRADO (antes de paginar). */
  total: number;
  totalPages: number;
}

// ============================================================
// [MVP-2] C · POST /api/familias/fusionar (admin) — fusión declarativa
// de familias vía alias (0018_mvp2_familia_alias.sql, RPC
// `fusionar_familia`). `FusionFamiliaResultado` es compartido con B: la
// resolución "es la misma que X" de `familia_nueva` (0019) COMPONE la
// misma RPC por dentro — ver `ResolverFamiliaNuevaResult` abajo.
// ============================================================

/** Espejo EXACTO del jsonb que regresa la RPC `fusionar_familia` (0018). */
export interface FusionFamiliaResultado {
  alias: string;
  destino: string;
  absorbida_existia: boolean;
  skus_que_migraran: number;
}

/** Un valor COMPUESTO del catálogo (celda con '/') que el alias NO alcanza — ver `FusionPreviewResponse`. */
export interface FusionPreviewCompuesto {
  nombre: string;
  skus: number;
}

/**
 * Respuesta de GET /api/familias/fusionar?alias=… — el ALCANCE de la
 * fusión declarado ANTES de confirmar (lectura pura, no ejecuta nada):
 * `cubre` es 1 si la celda EXACTA del alias existe hoy como fila propia
 * del catálogo (0 si el alias solo vive en el Excel — ver 0018, la
 * absorbida puede no existir todavía), `skus_directos` son los SKU de
 * esa celda exacta, y `no_cubre` son los valores COMPUESTOS que
 * contienen el átomo del alias y que esta regla NO cubre (la clave del
 * alias es la celda completa, no el átomo — ver cabecera de
 * `0018_mvp2_familia_alias.sql`).
 */
export interface FusionPreviewResponse {
  alias: string;
  cubre: 0 | 1;
  skus_directos: number;
  no_cubre: FusionPreviewCompuesto[];
}

// ============================================================
// [MVP-2] B · POST /api/pendientes/[id]/fusionar (admin) — resolución
// de `familia_nueva` por la rama "es la misma que X" (RPC
// `resolver_familia_nueva`, 0019_mvp2_familia_nueva.sql). La rama "es
// una familia legítima" NO pasa por aquí: reutiliza POST
// /api/pendientes/[id] normal (accion:'confirmar', sin rama nueva —
// confirmar ratifica el statu quo, mismo criterio que
// `familia_atomo_dudoso`).
// ============================================================

/** Espejo del jsonb que regresa `resolver_familia_nueva`: compone `fusionar_familia` por dentro. */
export interface ResolverFamiliaNuevaResult {
  fusion: FusionFamiliaResultado;
}
