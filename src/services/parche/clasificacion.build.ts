// ============================================================
// B-PARCHE · F2 · clasificacion.build.ts  (100% PURO — cero DB, cero efectos)
// Construye la capa `clasificacion_v2` (tecnologia/marca_v2/familia_v2/
// clase_v2/descr_v2) a partir de 2 hojas crudas (Inventario + WEST),
// contra el estado vivo (contexto), aplicando las reglas EXACTAS
// ratificadas del diagnóstico canónico de B-PARCHE. Reutiliza SOLO
// `normalize.ts`/`grid.ts`/`Cell`·`Grid` de `services/etl` (import,
// nunca modificados) — el resto de esta capa es independiente del
// pipeline de ingesta (stock/aduana): distinta fuente, distintas reglas.
//
// Geometría de origen (libro de 2 hojas; el de muestra lo genera
// `scripts/generar-datos-muestra.mjs` en `muestra/clasificacion-parche.xlsx`):
//   - Inventario: encabezado localizado por CONTENIDO ('ITEM' en la fila);
//     columnas ITEM/CLIENTE/TECNOLOGIA/MARCA/FAMILIA/CLASE/DESCRIPCION/…
//   - INV WEST: mismo criterio de encabezado; columnas ITEM/TECNOLOGIA/
//     MARCA/FAMILIA/CLASE/DESCRIP/FISICO — OJO: "DESCRIP", NO "DESCRIPCION"
//     (alias de columna DISTINTO al de Inventario, no una variante de
//     acentos/caja — por eso cada hoja tiene su propio ColumnSpec).
//
// Normalización DOBLE (aprobada):
//   (a) REPORTE de diffs (aplicables.porCampo.*.difiereDelVivo): trim-only
//       (SIN colapsar espacios internos), case-SENSIBLE en
//       descr/familia/tecnologia; case-INSENSIBLE en marca/clase. Compara
//       el candidato del ARCHIVO (tal cual, incluso si luego se
//       cuarentena/no se emite — ver Cross-ref WEST) contra el valor
//       crudo vivo (`contexto.fuenteActual`).
//   (b) VALOR ALMACENADO/SEMBRADO (filas[].*, catálogos nuevos):
//       `normalizeMarcaNombre` (trim+UPPER+colapso) en
//       familia/marca/tecnologia/clase; `descr` = solo trim (conserva
//       casing: es texto de display, no un catálogo controlado).
//
// Overlap (SKU en ambas hojas): por CAMPO, gana Inventario si aporta
// un valor no-vacío; WEST solo rellena donde Inventario dejó vacío.
// EXCEPCIÓN marca: si Inventario dice literalmente 'WEST' (placeholder
// de almacén, no marca), ver Cross-ref WEST abajo — esa regla manda
// sobre la precedencia genérica para ese campo puntual.
//
// Cross-ref WEST (marca): SKUs cuya MARCA en Inventario = 'WEST': si el
// sku también vive en la hoja WEST, su MARCA real ahí resuelve
// marca_v2 (cross-ref). Si NO vive en WEST, no hay de dónde resolver:
// CUARENTENA (`westNoResueltos`), marca_v2 = null (NUNCA se emite
// 'WEST' ni ningún catch-all inventado). 'WEST' fuera de este cross-ref
// (p.ej. como candidato "de catálogo") tampoco se emite jamás.
//
// Vacío del archivo → el campo no se emite (null) — nunca "borra": el
// valor null en `filas[]` es indistinguible de "sin dato nuevo" y la RPC
// (`aplicar_clasificacion_v2`, 0008) hace COALESCE contra lo ya guardado.
//
// Alias / catálogos nuevos (marca): cada valor de marca (de CUALQUIERA
// de las 2 hojas, para cada sku emitido — no solo el candidato ganador
// de precedencia; ver nota "descubrimiento de catálogo" más abajo) pasa
// primero por `contexto.aliasVivos` (alias YA conocidos, p.ej.
// 'BRAND 6'→BRAND6), luego por `contexto.marcasVivas` (canónico ya
// existente); si ninguno matchea, es marca NUEVA. familia/tecnologia NO
// tienen mapa de alias: solo `normalizeMarcaNombre` + comparación directa
// contra `familiasVivas` (tecnologia no tiene catálogo vivo en este
// contexto — TODA tecnología con valor emitido es "nueva").
//
// Descubrimiento de catálogo de MARCA (deliberado, más amplio que el
// candidato ganador de precedencia): el diagnóstico canónico ratificó que
// una marca que solo aparece en la hoja WEST debe sembrarse como marca nueva
// aunque, para el SKU concreto donde aparece, Inventario gane la
// precedencia con otro valor (p.ej. Inventario='NACIONAL' gana el campo,
// pero WEST='BRAND11' igual siembra el catálogo). Por
// eso el descubrimiento de `marcasNuevas` escanea AMBAS hojas por sku
// emitido, mientras que `familiasNuevas`/`tecnologiasNuevas` SOLO
// consideran el valor que realmente gana (el texto explícito de la spec:
// "SOLO las usadas por filas emitidas" — leído como "el valor que la fila
// realmente usa", no aplicado a marca, cuyo enunciado no repite esa
// coletilla).
//
// Colisión de normalización (familia/tecnologia/marca): si, entre los
// candidatos NUEVOS (no ya vivos) de un mismo sku-scope, dos textos
// DISTINTOS bajo la sensibilidad de `SENSIBILIDAD_REPORTE` DE CADA CAMPO
// (case-insensible en marca: 'Cables'/'CABLES' son la MISMA variante, no
// colisionan; case-sensible en familia/tecnologia, como hoy) canonicalizan
// (regla b) al MISMO valor, no se siembra el catálogo con ninguno de los
// dos arbitrariamente — se cuarentena informativamente
// (`colisionesNormalizacion`). El VALOR ESCRITO en `filas[]` NO se ve
// afectado (sigue siendo 100% determinista vía `normalizeMarcaNombre`);
// solo se posterga la siembra de catálogo (decisión de negocio: el admin
// decide cuál variante es "la" oficial vía `/api/familias` o el catálogo
// de marcas correspondiente).
// ============================================================
import type { Grid } from '@/services/etl/types';
import { detectHeaderRow, resolveColumns, type ColumnSpec } from '@/services/etl/grid';
import { normalizeSku, normalizeMarcaNombre, normalizeAliasKey, cellText } from '@/services/etl/normalize';

// ------------------------------------------------------------
// Contrato de entrada
// ------------------------------------------------------------

/** Fila cruda vigente de `productos` (solo los campos que esta capa compara/hereda). */
export interface FuenteActualProducto {
  marca: string | null;
  familia: string | null;
  clase: string | null;
  descr: string | null;
}

export interface ParcheContexto {
  /** SKUs vigentes en `productos` (universo de "altas/bajas" — filtro de filas emitidas). */
  existingSkus: Set<string>;
  /** Valor crudo vigente por sku (para el reporte de diffs contra vivo). */
  fuenteActual: Map<string, FuenteActualProducto>;
  /** Nombres canónicos (`normalizeMarcaNombre`) de familias ya existentes. */
  familiasVivas: Set<string>;
  /** Nombres canónicos (`normalizeMarcaNombre`) de marcas ya existentes. */
  marcasVivas: Set<string>;
  /** alias (normalizeAliasKey del texto crudo) → marca canónica ya existente. */
  aliasVivos: Map<string, string>;
}

export interface BuildClasificacionInput {
  inventario: Grid;
  west: Grid;
}

// ------------------------------------------------------------
// Contrato de salida
// ------------------------------------------------------------

export interface FilaV2 {
  sku: string;
  tecnologia: string | null;
  marca_v2: string | null;
  familia_v2: string | null;
  clase_v2: string | null;
  descr_v2: string | null;
}

export interface MarcaAliasNuevo {
  alias: string;
  marca: string;
}

export interface CatalogosNuevos {
  tecnologiasNuevas: string[];
  familiasNuevas: string[];
  marcasNuevas: string[];
  marcaAliasNuevos: MarcaAliasNuevo[];
}

export interface CampoAplicableConDiff {
  escribiria: number;
  difiereDelVivo: number;
}

export interface ColisionNormalizacion {
  campo: 'familia' | 'tecnologia' | 'marca';
  canonico: string;
  variantes: string[];
  skus: string[];
}

export interface DuplicadoIntraArchivo {
  sku: string;
  hoja: 'inventario' | 'west';
  /** Total de ocurrencias del sku en esa hoja (incluida la primera, que sí se conserva). */
  ocurrencias: number;
}

export interface ReporteParche {
  aplicables: {
    porCampo: {
      descr: CampoAplicableConDiff;
      familia: CampoAplicableConDiff;
      clase: CampoAplicableConDiff;
      marca: CampoAplicableConDiff;
      tecnologia: { escribiria: number };
    };
    /** Filas emitidas (sku en archivo ∩ existingSkus). */
    filas: number;
  };
  omitidos: {
    soloViejo: { total: number; skus: string[] };
    soloNuevo: { total: number; skus: string[] };
  };
  cuarentena: {
    westNoResueltos: { total: number; skus: string[] };
    colisionesNormalizacion: ColisionNormalizacion[];
    duplicadosIntraArchivo: DuplicadoIntraArchivo[];
    /** Subconjunto informativo de `omitidos.soloViejo`: SKUs vivos que no parecen códigos reales (contienen espacios). */
    skusBasura: string[];
  };
  catalogos: {
    familiasNuevas: number;
    marcasNuevas: number;
    tecnologiasNuevas: number;
    aliasNuevos: number;
  };
}

export interface BuildClasificacionResult {
  filas: FilaV2[];
  catalogosNuevos: CatalogosNuevos;
  reporte: ReporteParche;
}

// ------------------------------------------------------------
// Parseo de hoja (header por CONTENIDO — token 'item' en la fila)
// ------------------------------------------------------------

type CampoHoja = 'tecnologia' | 'marca' | 'familia' | 'clase' | 'descr';

interface FilaArchivo {
  sku: string;
  tecnologia: string | null;
  marca: string | null;
  familia: string | null;
  clase: string | null;
  descr: string | null;
}

const INVENTARIO_COLS: ColumnSpec = {
  sku: ['item'],
  tecnologia: ['tecnologia'],
  marca: ['marca'],
  familia: ['familia'],
  clase: ['clase'],
  descr: ['descripcion'],
};

/** WEST: "descrip", NO "descripcion" (columna distinta, no variante de acentos). */
const WEST_COLS: ColumnSpec = {
  sku: ['item'],
  tecnologia: ['tecnologia'],
  marca: ['marca'],
  familia: ['familia'],
  clase: ['clase'],
  descr: ['descrip'],
};

interface HojaParseada {
  porSku: Map<string, FilaArchivo>;
  duplicados: DuplicadoIntraArchivo[];
}

/**
 * Fábrica de hoja vacía (grid sin encabezado válido / sin columna sku):
 * SIEMPRE un objeto FRESCO, nunca un singleton de módulo compartido por
 * referencia entre llamadas. En un runtime de vida larga (worker
 * persistente / contenedor serverless reutilizado entre invocaciones) un
 * singleton mutable (`porSku` es un `Map`) filtraría estado entre
 * corridas distintas de `buildClasificacionV2` si algún caller —hoy o en
 * un refactor futuro— llegara a mutar el resultado; un objeto fresco por
 * llamada es trivialmente seguro sin depender de esa disciplina.
 */
function hojaVacia(): HojaParseada {
  return { porSku: new Map(), duplicados: [] };
}

function parseHoja(grid: Grid, cols: ColumnSpec, hoja: 'inventario' | 'west'): HojaParseada {
  const headerRow = detectHeaderRow(grid, ['item']);
  if (headerRow < 0) return hojaVacia();

  const col = resolveColumns(grid[headerRow], cols);
  if (col.sku === undefined) return hojaVacia();

  const porSku = new Map<string, FilaArchivo>();
  const conteoOcurrencias = new Map<string, number>();

  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const sku = normalizeSku(row[col.sku]);
    if (sku === null) continue; // fila basura/vacía: se salta, no cuenta para nada

    const vistas = conteoOcurrencias.get(sku);
    if (vistas !== undefined) {
      conteoOcurrencias.set(sku, vistas + 1);
      continue; // duplicado intra-hoja: se conserva SOLO la primera ocurrencia
    }
    conteoOcurrencias.set(sku, 1);

    const leer = (campo: CampoHoja): string | null =>
      col[campo] !== undefined ? cellText(row[col[campo]]) : null;

    porSku.set(sku, {
      sku,
      tecnologia: leer('tecnologia'),
      marca: leer('marca'),
      familia: leer('familia'),
      clase: leer('clase'),
      descr: leer('descr'),
    });
  }

  const duplicados: DuplicadoIntraArchivo[] = [];
  Array.from(conteoOcurrencias.entries()).forEach(([sku, ocurrencias]) => {
    if (ocurrencias > 1) duplicados.push({ sku, hoja, ocurrencias });
  });

  return { porSku, duplicados };
}

// ------------------------------------------------------------
// Resolución de candidato por campo (Overlap + Cross-ref WEST)
// ------------------------------------------------------------

function candidatoCampo(
  campo: Exclude<CampoHoja, 'marca'>,
  inv: FilaArchivo | undefined,
  des: FilaArchivo | undefined,
): string | null {
  const invVal = inv ? inv[campo] : null;
  if (invVal !== null) return invVal;
  const desVal = des ? des[campo] : null;
  return desVal;
}

interface CandidatoMarca {
  /** Candidato reportable (incluso si `westNoResuelto`, para el reporte de diffs contra vivo). */
  valor: string | null;
  westNoResuelto: boolean;
}

/** 'WEST' es ALMACÉN, no marca: placeholder de Inventario que exige cross-ref contra la hoja WEST. */
function esPlaceholderWest(marca: string): boolean {
  return marca.trim().toUpperCase() === 'WEST';
}

function candidatoMarca(inv: FilaArchivo | undefined, des: FilaArchivo | undefined): CandidatoMarca {
  const invMarca = inv ? inv.marca : null;
  const desMarca = des ? des.marca : null;

  if (invMarca !== null && esPlaceholderWest(invMarca)) {
    if (desMarca !== null) return { valor: desMarca, westNoResuelto: false }; // cross-ref resuelto
    return { valor: invMarca, westNoResuelto: true }; // sin hoja WEST que lo resuelva: cuarentena
  }
  if (invMarca !== null) return { valor: invMarca, westNoResuelto: false };
  if (desMarca !== null) return { valor: desMarca, westNoResuelto: false };
  return { valor: null, westNoResuelto: false };
}

// ------------------------------------------------------------
// Canonicalización de marca (alias → canónica viva → nueva)
// ------------------------------------------------------------

interface MarcaResuelta {
  valor: string | null;
  esNueva: boolean;
}

function resolverMarcaCanonica(raw: string, contexto: ParcheContexto): MarcaResuelta {
  const canon = normalizeMarcaNombre(raw);
  if (canon === null) return { valor: null, esNueva: false };
  const aliasHit = contexto.aliasVivos.get(normalizeAliasKey(raw));
  if (aliasHit !== undefined) return { valor: aliasHit, esNueva: false };
  if (contexto.marcasVivas.has(canon)) return { valor: canon, esNueva: false };
  return { valor: canon, esNueva: true };
}

// ------------------------------------------------------------
// Reporte de diffs (rule a): trim-only, sensibilidad por campo
// ------------------------------------------------------------

type CampoReportable = 'descr' | 'familia' | 'clase' | 'marca' | 'tecnologia';

const SENSIBILIDAD_REPORTE: Record<CampoReportable, 'cs' | 'ci'> = {
  descr: 'cs',
  familia: 'cs',
  tecnologia: 'cs',
  marca: 'ci',
  clase: 'ci',
};

function difiereDeVivo(campo: CampoReportable, candidato: string | null, vivo: string | null): boolean {
  const F = candidato === null ? '' : candidato.trim();
  const L = vivo === null ? '' : vivo.trim();
  return SENSIBILIDAD_REPORTE[campo] === 'ci' ? F.toUpperCase() !== L.toUpperCase() : F !== L;
}

// ------------------------------------------------------------
// Descubrimiento de catálogo nuevo (familia/tecnologia/marca) +
// colisión de normalización (dos variantes distintas → mismo canónico).
// ------------------------------------------------------------

interface GrupoCanonico {
  variantes: Set<string>;
  skus: Set<string>;
}

function acumularCandidatoNuevo(
  grupos: Map<string, GrupoCanonico>,
  campo: 'familia' | 'tecnologia' | 'marca',
  canonico: string,
  varianteCruda: string,
  sku: string,
): void {
  // Dedup de variantes FIELD-AWARE (`SENSIBILIDAD_REPORTE`): en marca
  // (case-insensible) dos casings de la MISMA variante ('Cables' vs
  // 'CABLES') cuentan como UNA sola — normalizeMarcaNombre ya uppercasea
  // el VALOR ESCRITO, así que tratarlas como 2 variantes distintas sería
  // una falsa colisión. familia/tecnologia (case-sensibles) conservan el
  // casing crudo tal cual: dos casings SÍ siguen siendo variantes
  // distintas (como hoy). El colapso de espacios internos NO se toca en
  // ningún caso: sigue detectando colisiones de espaciado en los 3 campos.
  const clave = SENSIBILIDAD_REPORTE[campo] === 'ci' ? varianteCruda.toUpperCase() : varianteCruda;
  let grupo = grupos.get(canonico);
  if (grupo === undefined) {
    grupo = { variantes: new Set(), skus: new Set() };
    grupos.set(canonico, grupo);
  }
  grupo.variantes.add(clave);
  grupo.skus.add(sku);
}

function resolverCatalogoNuevo(
  campo: 'familia' | 'tecnologia' | 'marca',
  grupos: Map<string, GrupoCanonico>,
): { nuevas: string[]; colisiones: ColisionNormalizacion[] } {
  const nuevas: string[] = [];
  const colisiones: ColisionNormalizacion[] = [];

  Array.from(grupos.entries()).forEach(([canonico, grupo]) => {
    if (grupo.variantes.size > 1) {
      colisiones.push({
        campo,
        canonico,
        variantes: Array.from(grupo.variantes).sort(),
        skus: Array.from(grupo.skus).sort(),
      });
    } else {
      nuevas.push(canonico);
    }
  });

  return { nuevas: nuevas.sort(), colisiones };
}

// ------------------------------------------------------------
// Builder principal
// ------------------------------------------------------------

export function buildClasificacionV2(
  input: BuildClasificacionInput,
  contexto: ParcheContexto,
): BuildClasificacionResult {
  const inv = parseHoja(input.inventario, INVENTARIO_COLS, 'inventario');
  const des = parseHoja(input.west, WEST_COLS, 'west');

  const duplicadosIntraArchivo = [...inv.duplicados, ...des.duplicados];

  const fileSkus = new Set<string>([
    ...Array.from(inv.porSku.keys()),
    ...Array.from(des.porSku.keys()),
  ]);

  const soloNuevoSkus = Array.from(fileSkus).filter((sku) => !contexto.existingSkus.has(sku));
  const soloViejoSkus = Array.from(contexto.existingSkus).filter((sku) => !fileSkus.has(sku));
  const emitidos = Array.from(fileSkus).filter((sku) => contexto.existingSkus.has(sku));

  // Informativo: SKUs vivos "solo-viejo" que no parecen códigos reales
  // (contienen espacios internos — a diferencia de un SKU legítimo de
  // este catálogo). No afecta ningún conteo, solo visibilidad para QA.
  const skusBasura = soloViejoSkus.filter((sku) => /\s/.test(sku));

  const filas: FilaV2[] = [];
  const westNoResueltosSkus: string[] = [];

  const aplicables = {
    descr: { escribiria: 0, difiereDelVivo: 0 },
    familia: { escribiria: 0, difiereDelVivo: 0 },
    clase: { escribiria: 0, difiereDelVivo: 0 },
    marca: { escribiria: 0, difiereDelVivo: 0 },
    tecnologia: { escribiria: 0 },
  };

  const familiaGrupos = new Map<string, GrupoCanonico>();
  const tecnologiaGrupos = new Map<string, GrupoCanonico>();
  const marcaGrupos = new Map<string, GrupoCanonico>();

  for (const sku of emitidos) {
    const ir = inv.porSku.get(sku);
    const dr = des.porSku.get(sku);
    const vivo = contexto.fuenteActual.get(sku) ?? null;

    // ---- descr ----
    const descrCand = candidatoCampo('descr', ir, dr);
    if (difiereDeVivo('descr', descrCand, vivo?.descr ?? null)) aplicables.descr.difiereDelVivo++;
    const descrEmit = descrCand === null ? null : descrCand.trim();
    if (descrEmit !== null) aplicables.descr.escribiria++;

    // ---- clase ----
    const claseCand = candidatoCampo('clase', ir, dr);
    if (difiereDeVivo('clase', claseCand, vivo?.clase ?? null)) aplicables.clase.difiereDelVivo++;
    const claseEmit = claseCand === null ? null : normalizeMarcaNombre(claseCand);
    if (claseEmit !== null) aplicables.clase.escribiria++;

    // ---- tecnologia (sin fuente cruda / sin catálogo vivo: siempre "nueva") ----
    const tecCand = candidatoCampo('tecnologia', ir, dr);
    const tecEmit = tecCand === null ? null : normalizeMarcaNombre(tecCand);
    if (tecEmit !== null && tecCand !== null) {
      aplicables.tecnologia.escribiria++;
      acumularCandidatoNuevo(tecnologiaGrupos, 'tecnologia', tecEmit, tecCand.trim(), sku);
    }

    // ---- familia ----
    const famCand = candidatoCampo('familia', ir, dr);
    if (difiereDeVivo('familia', famCand, vivo?.familia ?? null)) aplicables.familia.difiereDelVivo++;
    const famEmit = famCand === null ? null : normalizeMarcaNombre(famCand);
    if (famEmit !== null && famCand !== null) {
      aplicables.familia.escribiria++;
      if (!contexto.familiasVivas.has(famEmit)) {
        acumularCandidatoNuevo(familiaGrupos, 'familia', famEmit, famCand.trim(), sku);
      }
    }

    // ---- marca (Cross-ref WEST + alias + descubrimiento de catálogo) ----
    const { valor: marcaCand, westNoResuelto } = candidatoMarca(ir, dr);
    if (westNoResuelto) westNoResueltosSkus.push(sku);
    if (difiereDeVivo('marca', marcaCand, vivo?.marca ?? null)) aplicables.marca.difiereDelVivo++;

    let marcaEmit: string | null = null;
    if (!westNoResuelto && marcaCand !== null) {
      marcaEmit = resolverMarcaCanonica(marcaCand, contexto).valor;
    }
    if (marcaEmit !== null) aplicables.marca.escribiria++;

    // Descubrimiento de marcas nuevas: AMBAS hojas, no solo el candidato
    // ganador de precedencia (ver comentario de cabecera).
    const marcasCrudasDelSku = [ir?.marca ?? null, dr?.marca ?? null];
    for (const raw of marcasCrudasDelSku) {
      if (raw === null) continue;
      if (esPlaceholderWest(raw)) continue; // 'WEST' jamás es marca
      const resuelto = resolverMarcaCanonica(raw, contexto);
      if (resuelto.esNueva && resuelto.valor !== null) {
        acumularCandidatoNuevo(marcaGrupos, 'marca', resuelto.valor, raw.trim(), sku);
      }
    }

    filas.push({
      sku,
      tecnologia: tecEmit,
      marca_v2: marcaEmit,
      familia_v2: famEmit,
      clase_v2: claseEmit,
      descr_v2: descrEmit,
    });
  }

  const { nuevas: familiasNuevas, colisiones: colisionesFamilia } = resolverCatalogoNuevo(
    'familia',
    familiaGrupos,
  );
  const { nuevas: tecnologiasNuevas, colisiones: colisionesTecnologia } = resolverCatalogoNuevo(
    'tecnologia',
    tecnologiaGrupos,
  );
  const { nuevas: marcasNuevas, colisiones: colisionesMarca } = resolverCatalogoNuevo('marca', marcaGrupos);

  const catalogosNuevos: CatalogosNuevos = {
    tecnologiasNuevas,
    familiasNuevas,
    marcasNuevas,
    // Este builder NUNCA propone alias nuevos: solo CONSULTA `aliasVivos`
    // (alias ya conocidos, p.ej. 'BRAND 6'→BRAND6) para canonicalizar;
    // cualquier variante no cubierta por un alias existente ni por
    // `marcasVivas` se siembra como marca CANÓNICA nueva (arriba), nunca
    // como alias inventado automáticamente. Campo del contrato de la RPC
    // (0008) reservado para un mecanismo futuro (fuera de alcance de F2).
    marcaAliasNuevos: [],
  };

  const reporte: ReporteParche = {
    aplicables: {
      porCampo: {
        descr: aplicables.descr,
        familia: aplicables.familia,
        clase: aplicables.clase,
        marca: aplicables.marca,
        tecnologia: { escribiria: aplicables.tecnologia.escribiria },
      },
      filas: filas.length,
    },
    omitidos: {
      soloViejo: { total: soloViejoSkus.length, skus: soloViejoSkus.sort() },
      soloNuevo: { total: soloNuevoSkus.length, skus: soloNuevoSkus.sort() },
    },
    cuarentena: {
      westNoResueltos: {
        total: westNoResueltosSkus.length,
        skus: Array.from(new Set(westNoResueltosSkus)).sort(),
      },
      colisionesNormalizacion: [...colisionesFamilia, ...colisionesTecnologia, ...colisionesMarca],
      duplicadosIntraArchivo,
      skusBasura: skusBasura.sort(),
    },
    catalogos: {
      familiasNuevas: familiasNuevas.length,
      marcasNuevas: marcasNuevas.length,
      tecnologiasNuevas: tecnologiasNuevas.length,
      aliasNuevos: catalogosNuevos.marcaAliasNuevos.length,
    },
  };

  return { filas, catalogosNuevos, reporte };
}
