// ============================================================
// [CHAT-B1] lib/chat/entrega.ts — LO ÚNICO que puede viajar al modelo.
//
// Este archivo existe para volver un error de `tsc` algo que hasta hoy era una
// disciplina. INV-B10 firmó **«el modelo no ve el dato»** (ver
// `docs/decisions/0009-grounded-assistant-persona-contract.md`), y la razón que
// se nombró —y que es mejor que la mía— es ésta:
//
//   «Lo único que sale del perímetro hacia un tercero es la frase que el KAM
//    escribió. No salen clientes, ni KAMs, ni proveedores, ni facturas, ni
//    órdenes de compra.»
//
// CHAT-B1 revoca esa decisión **de forma acotada**, con lo acordado el
// 21-sep-2026: el modelo pasa a leer documentación de producto para contestar
// desde ella. Lo que NO se revoca es la razón. Y una razón no se sostiene con
// buenas intenciones: se sostiene con un tipo.
//
// ────────────────────────────────────────────────────────────
// LA MARCA NOMINAL, Y POR QUÉ NO ES ADORNO.
//
// `Entrega` lleva una propiedad cuya llave es un `unique symbol` **que este
// módulo no exporta**. Consecuencia: nadie puede escribir un objeto `Entrega` a
// mano. La única forma de obtener uno es `armarEntrega()`, que es el único sitio
// donde se comprueba el perímetro.
//
// Eso convierte «le mandé una cifra de inventario al modelo» de *improbable* en
// *imposible de compilar*: `SkuDetalle`, `SkuReservaItem` y `SkuEmbarqueItem` no
// son convertibles a `Entrega` por ningún camino, ni con un `as`. Es el único
// antídoto que el catálogo reconoce para P25 —volver el caso inexpresable en la
// firma— en vez de una prueba que alguien tiene que acordarse de escribir.
//
// ────────────────────────────────────────────────────────────
// `camino` SE DERIVA. NO ES PARÁMETRO DE NADIE.
//
// El bloque exige declarar si viajó el documento entero o sólo unos trozos
// (gate 2.4). Si `camino` fuera un argumento, declararlo mal sería un descuido
// de una línea — y un descuido que nadie ve, porque el resultado *se ve igual*.
// Aquí lo calcula el constructor comparando lo que entra con `trozosTotales`,
// así que **mentir sobre el camino no es difícil: es inexpresable**.
//
// ────────────────────────────────────────────────────────────
// EL PERÍMETRO VIVE AQUÍ Y NO EN LA CONSULTA, Y ES DELIBERADO.
//
// Medido contra el corpus de producción, el corpus **no es sólo documentación
// de producto**: junto a las fichas conviven carpetas de sistema, de bitácora de
// decisiones y de cuentas —DATOS DE CLIENTE—, y una parte de los trozos
// recuperables no es documentación de producto. Los de cuentas son exactamente
// lo que la razón de arriba dice que no sale.
//
// Ponerlo en la consulta (un `LIKE` dentro de `buscar_corpus`) habría sido más
// eficiente y **peor**: el día que alguien añada una cuarta puerta de
// recuperación, la puerta nueva nace sin filtro y nadie se entera. Aquí el
// filtro está en el **cuello por el que pasa todo lo que va al modelo**, así que
// una puerta nueva lo hereda por construcción. El costo, dicho: se recuperan
// trozos que luego se descartan. Es el precio correcto.
//
// Y se declara como CASO, no como `null`: `fuera_del_perimetro` se cuenta y se
// reporta. Un filtro que no se puede medir es un filtro del que nadie sabe si
// corrió — la forma vacua de P19.
// ============================================================

/**
 * La llave de la marca. **No se exporta, y eso es el mecanismo.**
 *
 * `declare const` + `unique symbol` produce un tipo que nadie fuera de este
 * módulo puede nombrar, así que ningún objeto literal satisface `Entrega`.
 */
declare const marcaDeEntrega: unique symbol;

/** Un trozo tal como viaja. Sin `tieneTabla` ni `bytes`: el modelo no los usa. */
export interface TrozoEntregado {
  readonly orden: number;
  readonly rutaSeccion: string;
  readonly texto: string;
}

/**
 * Lo que el modelo recibe. **Nada más que esto cruza el perímetro.**
 *
 * `ruta` es LA CITA. Viaja dentro de la entrega —y no aparte— porque una cita
 * que se arma en otro sitio puede acabar nombrando un documento distinto del que
 * se leyó, y eso es peor que no citar: es citar mal con aire de rigor.
 */
export interface Entrega {
  readonly [marcaDeEntrega]: true;
  /** La ruta del documento en el vault. Es la cita, y es obligatoria. */
  readonly ruta: string;
  readonly familia: string;
  readonly titulo: string | null;
  readonly fuentePdf: string | null;
  readonly trozos: readonly TrozoEntregado[];
  /** Cuántos trozos tiene el documento COMPLETO. Con `trozos.length` decide `camino`. */
  readonly trozosTotales: number;
  /** DERIVADO por el constructor. Nunca un argumento. */
  readonly camino: 'completo' | 'parcial';
  /** Bytes UTF-8 del texto que viaja. Lo que se paga. */
  readonly bytes: number;
}

/**
 * Las carpetas del vault de las que se puede leer.
 *
 * **Es una lista blanca, no una negra**, y la diferencia es la que importa: una
 * carpeta nueva en el vault nace FUERA del perímetro y hay que meterla a
 * propósito. Con una lista negra nacería dentro y nadie se enteraría.
 *
 * Decidida el 21-sep-2026 sobre el reparto medido de la cabecera.
 */
export const CARPETAS_REDACTABLES = ['20_Seguridad'] as const;

/**
 * El techo de lo que viaja, en bytes UTF-8.
 *
 * ⚠️ **NO ES UNA RACIÓN NI UN LÍMITE A LO QUE EL MODELO PUEDE HACER.** Es una
 * cota contra el caso sin fondo: que un documento crezca sin control y se lleve
 * la factura por delante sin que nadie lo note. Medido contra el corpus de
 * producción, **no recorta ni un documento de los que había**.
 *
 * Con 16 000 caben los documentos enteros, el mayor con holgura. O sea que
 * `camino: 'parcial'` no lo produce este techo: lo produce la puerta 3, que por
 * diseño trae como mucho 2 fragmentos de un documento hallado.
 *
 * Y el costo que acota es el de entrada: el documento mayor entero, enviado a la
 * API real, es lo que gobierna el precio por pregunta, no el techo de salida.
 */
export const PRESUPUESTO_ENTREGA_BYTES = 16_000;

export type ResultadoEntrega =
  | { tipo: 'entrega'; entrega: Entrega }
  /** El documento existe y tiene texto, pero está fuera de la lista blanca. */
  | { tipo: 'fuera_del_perimetro'; ruta: string }
  /** No hay ni un trozo con texto. No es un error: es que no hay qué leer. */
  | { tipo: 'sin_texto'; ruta: string };

/** `true` si la ruta cae dentro de una carpeta redactable. */
export function dentroDelPerimetro(ruta: string): boolean {
  const limpia = ruta.replace(/^[/\\]+/, '');
  return CARPETAS_REDACTABLES.some((c) => limpia === c || limpia.startsWith(c + '/'));
}

const bytesDe = (s: string): number => Buffer.byteLength(s, 'utf8');

/**
 * El ÚNICO constructor de `Entrega`.
 *
 * Recorta por presupuesto **respetando el orden del documento** y no por
 * relevancia: los trozos ya vienen elegidos por quien los recuperó, y volver a
 * ordenarlos aquí sería una segunda opinión sobre lo mismo —el defecto que este
 * repo ya tuvo cuatro veces con `piezas_en_camino`.
 *
 * Un trozo que **por sí solo** no cabe en el presupuesto **no se parte**: se
 * omite entero. Partir un trozo produciría una frase cortada a media tabla, y el
 * modelo la leería como un dato completo. Mejor entregar menos y decirlo.
 */
export function armarEntrega(d: {
  ruta: string;
  familia: string;
  titulo: string | null;
  fuentePdf: string | null;
  trozos: readonly { orden: number; rutaSeccion: string; texto: string }[];
  /** Cuántos trozos tiene el documento entero. Si no se sabe, el largo de `trozos`. */
  trozosTotales?: number;
  presupuesto?: number;
}): ResultadoEntrega {
  const ruta = d.ruta.trim();

  if (!dentroDelPerimetro(ruta)) return { tipo: 'fuera_del_perimetro', ruta };

  const conTexto = d.trozos
    .filter((t) => typeof t.texto === 'string' && t.texto.trim() !== '')
    .map((t) => ({ orden: t.orden, rutaSeccion: t.rutaSeccion, texto: t.texto }));

  if (conTexto.length === 0) return { tipo: 'sin_texto', ruta };

  // `trozosTotales` es lo que tiene el DOCUMENTO, no lo que nos pasaron: es la
  // única forma de saber si `parcial` es parcial. Nunca por debajo de lo que
  // entra, porque entonces `camino` mentiría al revés.
  const totales = Math.max(d.trozosTotales ?? conTexto.length, conTexto.length);
  const techo = d.presupuesto ?? PRESUPUESTO_ENTREGA_BYTES;

  const cabidos: TrozoEntregado[] = [];
  let bytes = 0;
  for (const t of conTexto) {
    const b = bytesDe(t.texto);
    if (bytes + b > techo) continue; // se omite ENTERO, no se parte
    cabidos.push(t);
    bytes += b;
  }

  // Ni un trozo cupo: el primero solo ya se pasa del techo. No se entrega un
  // documento vacío con aire de completo.
  if (cabidos.length === 0) return { tipo: 'sin_texto', ruta };

  const entrega = {
    ruta,
    familia: d.familia,
    titulo: d.titulo,
    fuentePdf: d.fuentePdf,
    trozos: cabidos,
    trozosTotales: totales,
    // AQUÍ, y sólo aquí. No hay parámetro que lo contradiga.
    camino: cabidos.length === totales ? 'completo' : 'parcial',
    bytes,
  } as unknown as Entrega;

  return { tipo: 'entrega', entrega };
}

/**
 * El texto que va al prompt, con sus secciones rotuladas.
 *
 * Vive aquí —y no en quien arma el prompt— porque **el verificador tiene que
 * poder recorrer exactamente los mismos rangos**. Si el prompt se armara en otro
 * archivo, los índices `{desde, hasta}` con los que el modelo ancla sus frases
 * apuntarían a un texto distinto del que se comprueba, y la comprobación saldría
 * verde sin comprobar nada: P25 en su forma más cara.
 */
export function textoDeTrozo(t: TrozoEntregado): string {
  return `[${t.orden}] ${t.rutaSeccion}\n${t.texto}`;
}

/** Cuántas secciones del documento NO viajaron. Cero cuando el camino es completo. */
export function seccionesOmitidas(e: Entrega): number {
  return e.trozosTotales - e.trozos.length;
}
