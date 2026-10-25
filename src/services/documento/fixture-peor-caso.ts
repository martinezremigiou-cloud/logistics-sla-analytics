// ============================================================
// fixture-peor-caso.ts — el proyecto contra el que se maqueta.
//
// TODOS LOS VALORES SON DE EJEMPLO. Se inventaron desde una semilla fija y
// conservan la FORMA de los peores casos de un catálogo, no su contenido:
// misma longitud, mismos espacios y signos en las mismas posiciones, y cada
// letra sustituida por OTRA del mismo ancho de Helvetica —nunca la misma en su
// posición; solo la «W» y la «r», que no tienen sustituto de igual ancho, se
// conservan— (por eso el texto «mide» igual que el original, salvo centésimas de
// punto de kerning, y la tabla se maqueta igual). Los números conservan su
// número de dígitos y su separador de miles.
//
//   SKU más largo        31 caracteres  'EGZtB: DKmVtE FK1179-W FB4711-W'
//                        ↑ modela una INSTRUCCIÓN escrita por una persona en la
//                          columna SKU. Hay que maquetar contra esa forma, no
//                          contra el SKU bonito de una maqueta.
//   Descripción          244 caracteres (la forma de la más larga del catálogo)
//   Marca                7   'SERIES5'      · Tecnología  8  'VERTICAL'
//   Total en almacén     771,788 en un SKU (6 dígitos) · Reservado 41,334 (5 dígitos)
//   Disponible mínimo    -2,924 (negativo de 4 dígitos)
//
// Un fixture con cinco SKU cómodos habría dejado pasar exactamente el bug que
// el gate de anchos viene a evitar: la tabla se rompe con datos extremos, no
// con los de ejemplo felices.
//
// TAMBIÉN LLEVA LOS CASOS DE CADENA, para que la huella cubra las tres
// degradaciones: un SKU con foto `.png` (la cadena D2 gana en su capa 1), uno
// con `.webp` (degrada por formato en el PDF, pero SÍ tiene foto que enlazar en
// el XLSX), uno fuera del archivo vigente, y uno sin tecnología.
//
// `AHORA_FIXTURE` es constante A PROPÓSITO: sin inyectar el instante, dos
// corridas producirían huellas distintas y la comparación antes/después no
// significaría nada.
// ============================================================
import type { ProyectoDetalle, PartidaItem } from '@/types/proyectos';

/** Instante fijo de generación. Ver la cabecera. */
export const AHORA_FIXTURE = new Date('2031-08-21T18:00:00.000Z');

export const SESION_FIXTURE = {
  nombre: null,
  correo: 'xrnpnnwwidz@example.test',
  cuenta: '00000000-0000-4000-8000-000000000001',
};

/** Una descripción inventada de 244 caracteres, con la forma de la más larga del catálogo. */
export const DESCRIPCION_244 =
  'UBmKCS tS HGmG mBUfAV  FSDCUQhGOV mZR-379U / 7mK /  R.597+ / 8.4mm / feHmtHSRfQC NRPa  (52-89m fD / 75-96m uCF PpEUHE) /  fX01 / mSZYu-AbBEZfUY / PGnQ SGB /  mfHCGTQUG tHFXOHYNG / mfE 1.5 /  GHEtT / BfRVQ BVZHNHFRUYNQ  fRZNDAtGH - DNNUA UB dtCX';

/** El SKU de 31 caracteres. Modela una instrucción escrita en la columna SKU. */
export const SKU_31 = 'EGZtB: DKmVtE FK1179-W FB4711-W';

// [2.0.1-C · revisión del carril, M1/M2] Exportada: las pruebas de la banda
// de riesgo de F-9 (`documento.presentacion.test.ts`) construyen filas de
// relleno con altura CONOCIDA para barrer la franja de 16 pt del defecto, y
// necesitan el mismo constructor que usa este archivo — no una segunda copia
// que pudiera divergir en un campo por default.
export function partida(over: Partial<PartidaItem>): PartidaItem {
  return {
    partida_id: '00000000-0000-4000-8000-000000000004',
    sku: 'NKH922-W',
    descripcion: 'GDX 36 BLnihq Gblvx Uqjnbzn Ujap Xbsdrlfv Efupn',
    marca: 'BRAND1',
    tecnologia: 'BRAND1',
    color: 'azul',
    imagen_url: null,
    cantidad: 518,
    total: 4923,
    reservado: 518,
    disponible: 4405,
    badges: [],
    en_riesgo: false,
    fuera_del_vigente: false,
    dato_de: null,
    banda: 'BRAND1',
    eje_banda: 'tecnologia',
    ...over,
  };
}

export const DETALLE_PEOR_CASO: ProyectoDetalle = {
  id: '00000000-0000-4000-8000-000000000002',
  folio: 'PRJ-905',
  titulo: 'Caso extremo · pruebas de maquetación',
  descripcion: 'Proyecto de muestra. Cada partida es un caso extremo de forma, con datos inventados.',
  notas: 'Nota inventada del proyecto, para que la sección de notas del documento se ejerza.',
  tipo: 'Apertura',
  intencion: 'Cotización',
  responsable: 'xrnpnnwwidz@example.test',
  fecha: '2031-04-17',
  creado_en: '2031-04-17T18:00:00.000Z',
  skus: 6,
  piezas: 2186,
  partidas: [
    // (1) El SKU más largo del catálogo, con la descripción más larga y las
    //     cifras más grandes. Es la fila que rompe la tabla hoy.
    partida({
      partida_id: 'p1',
      sku: SKU_31,
      descripcion: DESCRIPCION_244,
      marca: 'SERIES5',
      tecnologia: 'VERTICAL',
      banda: 'VERTICAL',
      cantidad: 4,
      total: 771788,
      reservado: 41334,
      disponible: 730454,
    }),
    // (2) Disponible negativo — el extremo inferior del catálogo.
    partida({
      partida_id: 'p2',
      sku: 'XV889-mY',
      descripcion: 'ZCVHZB EQRBC DEEE',
      marca: 'NACIONAL',
      tecnologia: null,
      banda: null,
      eje_banda: 'sin_banda',
      cantidad: 518,
      total: 4452,
      reservado: 7376,
      disponible: -2924,
      badges: ['sobre_reservado'],
      en_riesgo: true,
    }),
    // (3) Fuera del archivo vigente: el documento NO puede decir "Sin stock".
    partida({
      partida_id: 'p3',
      sku: '0692D-W',
      descripcion: 'HPBSFtHQD WfHYhXBY UVBPPFAw',
      marca: 'VERTICAL',
      tecnologia: null,
      banda: null,
      eje_banda: 'sin_banda',
      cantidad: 35,
      total: 0,
      reservado: 0,
      disponible: 0,
      badges: ['stock_cero'],
      en_riesgo: true,
      fuera_del_vigente: true,
    }),
    // (4) Con foto PNG: la cadena D2 gana en su capa 1 en el PDF.
    partida({
      partida_id: 'p4',
      sku: '8075-5498-20',
      descripcion: 'fUAZVep BtF, CNB 09BK, 034',
      marca: 'BRAND5',
      tecnologia: 'EAS',
      banda: 'EAS',
      cantidad: 68,
      imagen_url: 'https://example.test/storage/v1/object/public/producto-imagenes/a576b4cf6f0aa74c59a8e59893c46301.png',
    }),
    // (5) Con foto WEBP: el PDF no la puede incrustar, pero el XLSX SÍ la puede
    //     ENLAZAR. Es exactamente el caso que hoy sale mal.
    partida({
      partida_id: 'p5',
      sku: '1077-4772-87',
      descripcion: 'fUAZVep BtF, CNB 09BK, 034',
      marca: 'BRAND5',
      tecnologia: 'EAS',
      banda: 'EAS',
      cantidad: 887,
      imagen_url: 'https://example.test/storage/v1/object/public/producto-imagenes/11f683211838374f758bb972bb115199.webp',
    }),
    // (6) El SKU pobre: sin descripción, sin marca, sin tecnología, sin foto.
    partida({
      partida_id: 'p6',
      sku: 'NUEVO-1',
      descripcion: null,
      marca: null,
      tecnologia: null,
      color: null,
      banda: null,
      eje_banda: 'sin_banda',
      cantidad: 674,
      total: 0,
      reservado: 0,
      disponible: 0,
      badges: ['stock_cero'],
      en_riesgo: true,
    }),
  ],
  vigencia: { snapshot_id: '00000000-0000-4000-8000-000000000003', tomado_en: '2031-08-13T03:06:00.000Z' },
  agrupacion: { eje: 'tecnologia', sinBanda: 4 },
  facetas: { marcas: ['SERIES5', 'NACIONAL', 'BRAND5', 'VERTICAL'], tecnologias: ['EAS', 'VERTICAL'] },
};

/**
 * El mismo proyecto con 34 partidas, para forzar el salto de página de la
 * tabla. El bug de páginas huérfanas escala con el número de páginas
 * (N de contenido ⟹ 2N totales), así que un documento de una sola página no lo
 * habría hecho evidente.
 */
export const DETALLE_LARGO: ProyectoDetalle = {
  ...DETALLE_PEOR_CASO,
  folio: 'PRJ-904',
  titulo: 'Caso extremo largo · 34 partidas para forzar el salto de página',
  partidas: [
    ...DETALLE_PEOR_CASO.partidas,
    ...Array.from({ length: 28 }, (_, i) =>
      partida({
        partida_id: `larga-${i}`,
        sku: `UBdaXHG-${String(i).padStart(3, '0')}`,
        descripcion: `Partida de muestra ${i} para forzar el salto de página`,
        cantidad: 10 + i,
      }),
    ),
  ],
  skus: 34,
};

/**
 * [INV-B8.1 · corrección de producto] El documento que prueba la regla de corte:
 * **ningún texto se parte a media palabra, ni encabezado ni celda.**
 *
 * Lleva la FORMA de los TOKENS INDIVISIBLES más largos que el catálogo puede
 * producir (longitudes medidas sobre un catálogo, valores inventados):
 *
 *   SKU          `DRX2263/D-KZ58-28-CCZ`            21 chars · NINGUNO lo supera
 *   Marca        `SERIES5`                        7
 *   Estatus      `Sobre-reservado`                  15
 *   Descripción  `3.2(O3),91.3(O0,3)HEYK,HBOCtNPK`  31
 *
 * Va en un fixture APARTE y no dentro de `DETALLE_PEOR_CASO` a propósito: ése
 * es la línea base de la huella capturada antes del bloque, y tocarlo
 * invalidaría el diff con lista blanca que prueba que el contenido no cambió.
 */
export const DETALLE_TOKENS_LARGOS: ProyectoDetalle = {
  ...DETALLE_PEOR_CASO,
  folio: 'PRJ-903',
  titulo: 'Tokens sin cortes · ninguno se parte a media palabra',
  partidas: [
    partida({
      partida_id: 't1',
      sku: 'DRX2263/D-KZ58-28-CCZ',
      descripcion: 'YSYV 3.2(O3),91.3(O0,3)HEYK,HBOCtNPK YRYBFBUQU',
      marca: 'SERIES5',
      tecnologia: 'VERTICAL',
      banda: 'VERTICAL',
      cantidad: 25,
      total: 935,
      reservado: 3859,
      disponible: -2924,
      badges: ['sobre_reservado'],
      en_riesgo: true,
    }),
    partida({
      partida_id: 't2',
      sku: 'XV889-mY',
      descripcion: 'ZCVHZB EQRBC DEEE',
      marca: 'SERIES5',
      tecnologia: 'VERTICAL',
      banda: 'VERTICAL',
      cantidad: 34,
      total: 34,
      reservado: 0,
      disponible: 34,
    }),
  ],
  skus: 2,
  piezas: 59,
  agrupacion: { eje: 'tecnologia', sinBanda: 0 },
};

/**
 * [2.0.1-C · F-9] EL EXTREMO DE «1 SOLA IMAGEN», deliberadamente pequeño.
 *
 * `DETALLE_PEOR_CASO` YA tiene exactamente 1 imagen descargable en el PDF
 * —el `.webp` de la fila (5) degrada a genérico porque `FORMATOS_PDF` no lo
 * incluye—, pero su tabla es tan cargada (descripción de 244, SKU de 31)
 * que casi no deja hueco en la primera página: el anexo podría terminar
 * abriendo página propia por FALTA DE ESPACIO, no por la regla de conteo, y
 * las dos causas quedarían indistinguibles. Este fixture aísla la regla:
 * una tabla mínima, con espacio de sobra, para que si el anexo abre página
 * propia solo pueda ser porque alguien volvió a poner el `addPage()`
 * incondicional.
 */
export const DETALLE_UNA_IMAGEN: ProyectoDetalle = {
  ...DETALLE_PEOR_CASO,
  folio: 'PRJ-902',
  titulo: 'Una única imagen · el anexo no merece página propia',
  descripcion: '',
  notas: '',
  partidas: [
    partida({
      partida_id: 'u1',
      sku: 'HHB-tmO-52',
      descripcion: 'Partida con imagen propia, sola',
      marca: 'BRAND5',
      tecnologia: 'EAS',
      banda: 'EAS',
      cantidad: 1,
      total: 10,
      reservado: 0,
      disponible: 10,
      imagen_url: 'https://example.test/storage/v1/object/public/producto-imagenes/a576b4cf6f0aa74c59a8e59893c46301.png',
    }),
  ],
  skus: 1,
  piezas: 1,
  agrupacion: { eje: 'tecnologia', sinBanda: 0 },
};

/**
 * [2.0.1-C · F-9] EL OTRO LADO DE LA REGLA: MÁS DE UNA IMAGEN.
 *
 * Misma tabla mínima que `DETALLE_UNA_IMAGEN` —de sobra cabría en la página
 * de la tabla— pero con DOS partidas con fotografía, para que la única
 * variable que cambia sea el CONTEO. Reusa la MISMA URL inventada dos veces bajo
 * dos SKU distintos: lo que a `descargarImagenes` le importa es el SKU
 * (`Map<string, Buffer>`), así que dos SKU con la misma imagen producen dos
 * entradas igual que dos fotos distintas — y evita inventar una segunda URL.
 */
export const DETALLE_DOS_IMAGENES: ProyectoDetalle = {
  ...DETALLE_PEOR_CASO,
  folio: 'PRJ-901',
  titulo: 'Dos fotos · el anexo SIEMPRE abre página propia',
  descripcion: '',
  notas: '',
  partidas: [
    partida({
      partida_id: 'd1',
      sku: 'UGK-fmQ-80',
      descripcion: 'Primera partida con imagen propia',
      marca: 'BRAND5',
      tecnologia: 'EAS',
      banda: 'EAS',
      cantidad: 1,
      total: 10,
      reservado: 0,
      disponible: 10,
      imagen_url: 'https://example.test/storage/v1/object/public/producto-imagenes/a576b4cf6f0aa74c59a8e59893c46301.png',
    }),
    partida({
      partida_id: 'd2',
      sku: 'HQX-fmQ-45',
      descripcion: 'Segunda partida con imagen propia',
      marca: 'BRAND5',
      tecnologia: 'EAS',
      banda: 'EAS',
      cantidad: 1,
      total: 10,
      reservado: 0,
      disponible: 10,
      imagen_url: 'https://example.test/storage/v1/object/public/producto-imagenes/a576b4cf6f0aa74c59a8e59893c46301.png',
    }),
  ],
  skus: 2,
  piezas: 2,
  agrupacion: { eje: 'tecnologia', sinBanda: 0 },
};
