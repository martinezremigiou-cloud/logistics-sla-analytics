// ============================================================
// [INV-B11] O1/O3 · lib/corpus/fuente.ts — de dónde sale el corpus y quién lo
// embebe. Solo INTERFACES, ninguna implementación.
//
// POR QUÉ HAY UNA INTERFAZ Y NO UNA LLAMADA A GITHUB. Porque O1 está bloqueado
// esperando que exista el repo privado, y **el resto del indexador no tiene por
// qué esperar a eso**. Con la frontera puesta aquí, la fuente local de hoy y la
// de git de mañana entran por el mismo hueco y el servicio no se entera.
//
// Es el mismo molde que `Clasificador` en B10: la interfaz permite probar el
// camino entero sin gastar un token ni depender de una red.
//
// ────────────────────────────────────────────────────────────
// `version()` Y LA TRAMPA QUE LA MIGRACIÓN YA ADVIRTIÓ.
//
// La `0030` dejó escrito, en su propio RAISE NOTICE, lo que no podía comprobar:
//
//     «Que el commit_sha guardado sea el del árbol que de verdad se leyó.
//      Un commit_sha falso produce una procedencia que se ve perfecta.»
//
// La fuente local **no tiene commit**. La tentación es rellenar con algo que
// parezca uno —un hash del contenido, un uuid— y eso sería exactamente el
// fallo advertido: procedencia impecable y falsa.
//
// Por eso el contrato de `version()` es explícito: **si no viene de git, tiene
// que devolver algo que NO se pueda confundir con un sha**. Quien lea
// `local-sin-git` en la base sabe que esa procedencia no se puede verificar, y
// eso es información. Un sha inventado no lo sería.
// ============================================================

/** Un archivo del manifiesto: su identidad y el hash de su CONTENIDO. */
export interface ArchivoCorpus {
  ruta: string;
  hash: string;
}

export interface FuenteCorpus {
  /** Para el registro del intento. `git:duenio/repo` · `local:<ruta>`. */
  readonly nombre: string;

  /**
   * La versión del árbol que se está leyendo.
   *
   * Con git es el `commit_sha`. **Sin git DEBE devolver algo que no parezca un
   * sha** —`local-sin-git`— para que la procedencia no mienta.
   */
  version(): Promise<string>;

  /**
   * El manifiesto **COMPLETO**, no lo que cambió.
   *
   * Completo no es un detalle de eficiencia: **la ausencia en el manifiesto es
   * la señal de baja**. Una fuente que devolviera solo lo cambiado haría que
   * todo lo demás se viera borrado.
   */
  listar(): Promise<ArchivoCorpus[]>;

  /** El contenido crudo de un archivo del manifiesto. */
  leer(ruta: string): Promise<string>;
}

// ------------------------------------------------------------
// EL EMBEBEDOR
// ------------------------------------------------------------

/**
 * Las dimensiones que `corpus_trozos.embedding` declara.
 *
 * **No es una preferencia: sale de reproducir el costo del brief.** El tamaño
 * del corpus, a $0.02/M, da exactamente la cifra declarada para indexar todo.
 * O sea `text-embedding-3-small`, 1536.
 *
 * Cambiarla exige migrar la columna, así que el servicio la comprueba **antes**
 * de embeber nada: descubrir el desajuste en el primer INSERT significaría
 * haber pagado ya por todos los vectores.
 */
export const DIMENSIONES_EMBEDDING = 1536;

export interface ResultadoEmbebido {
  vectores: number[][];
  tokens: number;
}

export interface Embebedor {
  readonly nombre: string;
  readonly dimensiones: number;
  /**
   * Embebe un lote. El orden de salida **corresponde al de entrada** — un
   * embebedor que reordenara pegaría cada vector al trozo equivocado, y el
   * resultado se vería perfectamente sano.
   */
  embeber(textos: readonly string[]): Promise<ResultadoEmbebido>;
}
