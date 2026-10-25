// ============================================================
// [INV-B8] documento/resoluciones.ts  (100% PURO — sin BD, sin fs, sin env)
//
// Las TRES cadenas de resolución del documento (D2 imagen · D5 agrupación ·
// D3 firmante). Son el mismo patrón que `resolverClasificacion` ya
// implementa y este repo ya probó: capas en cascada donde **el origen del
// valor viaja con el valor**.
//
// POR QUÉ EL ORIGEN NO ES ADORNO. Un documento que pinta un cuadro gris
// obliga a quien lo recibe a adivinar si el producto no tiene foto, si la
// foto falló, o si el generador está roto. Uno que dice "genérica porque el
// SKU no tiene foto y su marca no tiene banner" cierra la pregunta. Lo mismo
// con la agrupación: el documento declara POR QUÉ eje agrupó, no solo cómo
// quedó. Eso es lo explicable, y explicable es la parte de "enterprise" que
// se puede verificar.
//
// LAS TRES CADENAS ESTÁN CASI VACÍAS EN ESTE REPO, Y ESO ES CORRECTO, NO UN PENDIENTE:
//   · Banners de marca: no se incluye ningún archivo de banner ⟹ la capa 2 de
//     la imagen nunca gana. `rutaBannerMarca` calcula la ruta igual; el día que
//     alguien deje el archivo ahí, la capa se activa sola. Sin tocar código.
//   · Categoría funcional: no existe como columna en ninguna tabla ⟹ la capa 1
//     de la agrupación recibe `null` siempre. Se modela como parámetro opcional
//     (igual que `capaManualV2Fuente` recibe capas que pueden faltar), NO como
//     lectura de una columna inventada.
//   · Nombre de la persona: las cuentas de `auth.users` no guardan nombre en
//     `raw_user_meta_data`, y el sidebar ya pinta correo + rol. La capa 1 del
//     firmante tampoco gana.
//
// La invariante transversal que estas tres comparten: **la última capa
// nunca falla**. Un SKU sin foto, sin clase, sin tecnología y creado hace
// cinco minutos sale en el documento igual de bien que el mejor del
// catálogo.
// ============================================================

// ------------------------------------------------------------
// CADENA 1 · IMAGEN (D2)
//   foto del SKU → banner de la marca → banner genérico
// ------------------------------------------------------------

/** Capa que aportó la imagen que se va a pintar. */
export type CapaImagen = 'sku' | 'marca' | 'generico';

/**
 * Por qué se descartó una capa. `formato_no_empotrable` NO es hipotético:
 * el bucket acepta `png|jpeg|webp`, y **una foto `.webp` es válida**: es un formato que ningún generador de PDF
 * sin navegador empotra. Sin este motivo, ese SKU mostraría el banner
 * genérico y el documento parecería decir "no tiene foto" — cuando sí la
 * tiene y el problema es nuestro.
 */
export type MotivoDegradacion = 'sin_foto_del_sku' | 'formato_no_empotrable' | 'sin_banner_de_marca';

/** La fotografía que el SKU tiene cargada, como HECHO, independiente de quién la consuma. */
export interface FotoDelSku {
  url: string;
  /** Extensión en minúsculas, sin punto. `''` si no se puede determinar. */
  formato: string;
}

export interface ImagenResuelta {
  /** Nunca `null`: la última capa es un archivo del repo, no un dato del catálogo. */
  fuente: string;
  capa: CapaImagen;
  /**
   * Los motivos ACUMULADOS de cada capa que se saltó, en orden. Es una
   * lista y no un solo valor porque las razones se apilan: un SKU con foto
   * `.webp` y sin banner de marca cae al genérico por DOS motivos distintos,
   * y quedarse con uno solo obligaría a elegir cuál mentira contar.
   */
  motivos: MotivoDegradacion[];
  /**
   * EL HECHO CRUDO: la fotografía que el SKU tiene cargada, exista o no la
   * capacidad de pintarla. `null` si el SKU no tiene ninguna.
   *
   * POR QUÉ LA CADENA EXPONE DOS COSAS Y NO UNA. `fuente`/`capa` contestan
   * *"¿qué imagen pinto?"*; esto contesta *"¿este SKU tiene foto?"*. Son
   * preguntas distintas y el bloque B8 las confundió: al XLSX se le pasaba
   * una lista vacía de formatos empotrables —porque no empotra nada—, así que
   * TODA foto degradaba a `generico` y el enlace, condicionado a
   * `capa === 'sku'`, no se emitía jamás. Resultado medido: 0 hipervínculos y
   * una columna «Foto» que decía `—` para SKUs que sí tienen fotografía.
   *
   * El arreglo va en la CADENA y no en el consumidor a propósito. Un caso
   * especial del XLSX (o un flag `esExcel`) habría dejado al siguiente
   * consumidor —un correo, una campana, lo que venga— chocando con lo mismo.
   */
  fotoDelSku: FotoDelSku | null;
}

export interface EntradaImagen {
  /** `productos_metadata.imagen_url`, o null/undefined si el SKU no tiene. */
  imagenSku?: string | null;
  /** Ruta del banner de la marca si el archivo EXISTE. Lo resuelve el caller (tocar disco es impuro). */
  bannerMarca?: string | null;
  /** Piso garantizado. Un archivo del repo, siempre presente. */
  bannerGenerico: string;
  /**
   * Extensiones que el renderizador destino sabe empotrar, en minúsculas y
   * sin punto. El XLSX no empotra ninguna (enlaza), el PDF empotra
   * `['png','jpg','jpeg']`. Se recibe como parámetro en vez de fijarse aquí
   * porque es una propiedad del RENDERIZADOR, no del dominio.
   */
  formatosEmpotrables: readonly string[];
}

/** Extensión en minúsculas de una URL o ruta, sin punto; `''` si no se puede determinar. Ignora query string y fragmento. */
export function extensionDe(url: string): string {
  const sinQuery = url.split(/[?#]/, 1)[0];
  const ultimoSegmento = sinQuery.slice(sinQuery.lastIndexOf('/') + 1);
  const punto = ultimoSegmento.lastIndexOf('.');
  if (punto <= 0 || punto === ultimoSegmento.length - 1) return '';
  return ultimoSegmento.slice(punto + 1).toLowerCase();
}

/**
 * Ruta DETERMINISTA del banner de una marca, relativa a `public/`.
 *
 * Este es el mecanismo que hace que la capa 2 "se active sola el día que
 * existan los archivos": la ruta se calcula siempre, exista o no el
 * archivo. El caller solo comprueba existencia. Nadie tiene que editar una
 * tabla de rutas ni tocar código — basta con dejar el .png donde esta
 * función dice.
 *
 * El slug normaliza a minúsculas, quita acentos y colapsa todo lo que no
 * sea alfanumérico en un guión, porque los nombres de marca reales traen
 * espacios (`BRAND 6`) y podrían traer acentos.
 */
export function rutaBannerMarca(marca: string): string {
  const slug = marca
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `marca/banners/${slug}.png`;
}

/** Resuelve la imagen de un SKU por la cascada de D2, acumulando el motivo de cada degradación. */
export function resolverImagen(entrada: EntradaImagen): ImagenResuelta {
  const motivos: MotivoDegradacion[] = [];

  // El hecho crudo se establece ANTES de cualquier degradación y viaja en las
  // tres salidas: que este renderizador no pueda pintar la foto no la hace
  // desaparecer del catálogo.
  const fotoDelSku: FotoDelSku | null = entrada.imagenSku
    ? { url: entrada.imagenSku, formato: extensionDe(entrada.imagenSku) }
    : null;

  // Capa 1 — la foto del SKU, si existe Y si el destino sabe empotrarla.
  if (fotoDelSku) {
    if (entrada.formatosEmpotrables.includes(fotoDelSku.formato)) {
      return { fuente: fotoDelSku.url, capa: 'sku', motivos, fotoDelSku };
    }
    motivos.push('formato_no_empotrable');
  } else {
    motivos.push('sin_foto_del_sku');
  }

  // Capa 2 — el banner de la marca. Hoy no gana nunca: no hay archivos de banner.
  if (entrada.bannerMarca) {
    return { fuente: entrada.bannerMarca, capa: 'marca', motivos, fotoDelSku };
  }
  motivos.push('sin_banner_de_marca');

  // Capa 3 — piso garantizado.
  return { fuente: entrada.bannerGenerico, capa: 'generico', motivos, fotoDelSku };
}

// ------------------------------------------------------------
// CADENA 2 · AGRUPACIÓN DE PARTIDAS (D5)
//   categoría → tecnología → sin banda
// ------------------------------------------------------------

export type EjeAgrupacion = 'categoria' | 'tecnologia' | 'sin_banda';

export interface AgrupacionResuelta {
  /** Etiqueta de la banda, o `null` si el item no tiene ninguna. */
  banda: string | null;
  eje: EjeAgrupacion;
}

export interface EntradaAgrupacion {
  /**
   * Capa 1. **Hoy siempre `null`**, y no por descuido: "categoría
   * funcional" no existe como columna en ninguna tabla (la
   * `productos.class` A/B/C es clasificación ABC de rotación, no categoría
   * de producto). Se recibe como parámetro para que el día que exista, la
   * capa gane sin cambiar esta función — y para NO leer una columna
   * inventada mientras tanto.
   */
  categoria?: string | null;
  /**
   * Capa 2: `productos.tecnologia`, vía `resolverClasificacion` (capa fuente).
   * Es la única capa de tecnología que puede ganar. Puede venir `null` (SKU sin
   * tecnología) y entonces la partida degrada a «sin banda».
   */
  tecnologia?: string | null;
}

/**
 * Banda de agrupación de una partida. Ninguna capa puede reventar con un SKU
 * sin clase ni sin tecnología: el vacío degrada, no
 * lanza. Un valor que solo tiene espacios cuenta como ausente — si no, la
 * banda sería una etiqueta en blanco, que es peor que no tener banda.
 */
export function resolverAgrupacion(entrada: EntradaAgrupacion): AgrupacionResuelta {
  const categoria = entrada.categoria?.trim();
  if (categoria) return { banda: categoria, eje: 'categoria' };

  const tecnologia = entrada.tecnologia?.trim();
  if (tecnologia) return { banda: tecnologia, eje: 'tecnologia' };

  return { banda: null, eje: 'sin_banda' };
}

export interface ResumenAgrupacion {
  /** El mejor eje que de verdad produjo alguna banda; `'sin_banda'` si ninguno lo hizo. */
  eje: EjeAgrupacion;
  /** Cuántas partidas quedaron sin banda. El documento lo declara en vez de esconderlo. */
  sinBanda: number;
}

/**
 * Con qué eje agrupó el documento, para que pueda DECIRLO. No basta con
 * agrupar bien: el brief pide que el documento declare por qué eje lo hizo.
 *
 * "El eje" es el mejor que produjo al menos una banda — no el más frecuente.
 * Un documento donde una sola partida se agrupó por categoría y el resto por
 * tecnología está agrupado por categoría con degradaciones, y así se dice.
 */
export function resumenDeAgrupacion(resultados: readonly AgrupacionResuelta[]): ResumenAgrupacion {
  const sinBanda = resultados.filter((r) => r.eje === 'sin_banda').length;
  if (resultados.some((r) => r.eje === 'categoria')) return { eje: 'categoria', sinBanda };
  if (resultados.some((r) => r.eje === 'tecnologia')) return { eje: 'tecnologia', sinBanda };
  return { eje: 'sin_banda', sinBanda };
}

// ------------------------------------------------------------
// CADENA 3 · IDENTIDAD DEL FIRMANTE (D3)
//   nombre de la sesión → correo → cuenta
// ------------------------------------------------------------

export type CapaFirmante = 'nombre' | 'correo' | 'cuenta';

export interface FirmanteResuelto {
  /** Lo que se imprime como "Responsable". NUNCA un nombre inventado. */
  etiqueta: string;
  correo: string | null;
  /** Entorno que generó el documento (producción / vista previa / desarrollo). Lo resuelve el caller desde env. */
  entorno: string;
  capa: CapaFirmante;
}

export interface EntradaFirmante {
  /**
   * Capa 1. **Hoy siempre ausente**: ninguna cuenta tiene nombre
   * en `raw_user_meta_data`, y `perfiles` solo tiene (id, email, rol) — no
   * hay columna de nombre en ninguna parte. Se deja la capa porque el día
   * que alguien capture un nombre, gana sola.
   */
  nombre?: string | null;
  correo?: string | null;
  /** Piso garantizado: `auth.uid()`. No es un nombre inventado — es la identidad verdadera. */
  cuenta: string;
  entorno: string;
}

/**
 * Quién firma el documento. La cadena degrada a algo VERDADERO en cada
 * escalón: si no hay nombre se imprime el correo, y si no hubiera correo se
 * imprime la cuenta. En ningún punto se fabrica un nombre — que es
 * exactamente lo que D3 prohíbe, y la razón por la que `kams` (8 nombres de
 * pila sin correo, sin puente con `perfiles`) no entra en el documento
 * aunque sea la fuente que "se ve más bonita".
 */
export function resolverFirmante(entrada: EntradaFirmante): FirmanteResuelto {
  const correo = entrada.correo?.trim() || null;
  const nombre = entrada.nombre?.trim();

  if (nombre) return { etiqueta: nombre, correo, entorno: entrada.entorno, capa: 'nombre' };
  if (correo) return { etiqueta: correo, correo, entorno: entrada.entorno, capa: 'correo' };
  return { etiqueta: entrada.cuenta, correo: null, entorno: entrada.entorno, capa: 'cuenta' };
}

/**
 * El motivo de degradación, en español y en voz de documento. Vive aquí
 * —junto al tipo— y no dentro de cada renderizador, para que el XLSX y el
 * PDF no puedan explicar la misma degradación con palabras distintas.
 */
export function motivoLegible(motivo: MotivoDegradacion): string {
  switch (motivo) {
    case 'sin_foto_del_sku':
      return 'el SKU no tiene fotografía cargada';
    case 'formato_no_empotrable':
      return 'la fotografía está en un formato que este documento no puede incrustar';
    case 'sin_banner_de_marca':
      return 'su marca no tiene banner';
  }
}
