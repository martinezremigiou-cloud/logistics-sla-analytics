// ============================================================
// [INV-B11] O1 · lib/corpus/manifiesto.ts — altas, cambios y BAJAS. PURO.
//
// LA BAJA ES LA RAZÓN DE QUE ESTE ARCHIVO EXISTA, y quedó marcada con ★.
//
// Un indexador incremental normal ve altas y cambios porque alguien se los
// nombra. **Las bajas no las nombra nadie**: un archivo que se borra
// simplemente deja de aparecer, y el índice se queda contestando desde un
// documento que ya no existe. Y el corpus de este proyecto **borra información
// vieja todo el tiempo** — no es un caso raro, es el régimen.
//
//     **La ausencia en el manifiesto ES la señal de baja.**
//     Por eso cada corrida manda el manifiesto ENTERO, no solo lo cambiado.
//
// ────────────────────────────────────────────────────────────
// Y DE AHÍ SALE EL PELIGRO QUE ESTE ARCHIVO TIENE QUE CONTENER.
//
// Si «lo que no está, se borra», entonces **un manifiesto truncado borra el
// índice**. Y truncado no es hipotético: una respuesta a medias, un token
// vencido que devuelve un árbol vacío, un `catch` que devuelve `[]`. Los tres
// producen exactamente lo mismo que «alguien borró todo el corpus», y el sistema
// no puede distinguirlos **desde el manifiesto**.
//
// Es el mismo agujero que B10-3 —«corrió sin novedad» ≡ «no corrió»— con las
// consecuencias al revés: allí no pasaba nada y parecía que sí; aquí pasa todo
// y parece normal.
//
// Por eso `diffManifiesto` **no aplica nada**: describe. Y `esBorradoMasivo`
// existe para que el llamador tenga que mirarlo antes de borrar.
// ============================================================

export interface EntradaManifiesto {
  /** Ruta relativa a la raíz del corpus, con `/`. Es la identidad del documento. */
  ruta: string;
  /**
   * Hash del CONTENIDO. Con git es el SHA del blob y sale gratis del árbol;
   * con cualquier otro transporte hay que calcularlo. **Nunca la fecha**: una
   * fecha cambia al copiar el archivo sin tocarlo.
   */
  hash: string;
}

export interface Diff {
  altas: EntradaManifiesto[];
  cambios: { ruta: string; hashViejo: string; hashNuevo: string }[];
  /** Estaban en el índice y **no vienen** en el manifiesto. */
  bajas: EntradaManifiesto[];
  /** Ni alta, ni cambio, ni baja. Se reporta porque es la mayoría y da escala. */
  sinCambio: number;
}

/**
 * Compara el manifiesto COMPLETO contra lo que el índice tiene hoy.
 *
 * **No borra, no escribe y no decide.** Devuelve qué habría que hacer, que es
 * lo que permite probarlo entero sin base y sin red.
 *
 * El orden de salida es estable —alfabético por ruta— para que dos corridas
 * sobre el mismo estado produzcan el mismo reporte y un diff de logs signifique
 * algo.
 */
export function diffManifiesto(
  manifiesto: readonly EntradaManifiesto[],
  indice: readonly EntradaManifiesto[],
): Diff {
  const enIndice = new Map(indice.map((e) => [e.ruta, e.hash]));
  const enManifiesto = new Map(manifiesto.map((e) => [e.ruta, e.hash]));

  const altas: EntradaManifiesto[] = [];
  const cambios: Diff['cambios'] = [];
  let sinCambio = 0;

  // `forEach` y no `for…of` sobre el Map: el `target` de este proyecto no
  // permite iterar un Map sin `downlevelIteration`, y cambiar el target por un
  // bucle sería mover un ajuste global por comodidad local.
  enManifiesto.forEach((hash, ruta) => {
    const viejo = enIndice.get(ruta);
    if (viejo === undefined) altas.push({ ruta, hash });
    else if (viejo !== hash) cambios.push({ ruta, hashViejo: viejo, hashNuevo: hash });
    else sinCambio++;
  });

  const bajas: EntradaManifiesto[] = [];
  enIndice.forEach((hash, ruta) => {
    if (!enManifiesto.has(ruta)) bajas.push({ ruta, hash });
  });

  const porRuta = (a: { ruta: string }, b: { ruta: string }) => a.ruta.localeCompare(b.ruta);
  altas.sort(porRuta);
  cambios.sort(porRuta);
  bajas.sort(porRuta);

  return { altas, cambios, bajas, sinCambio };
}

/**
 * Fracción del índice que este diff borraría. `0` si el índice está vacío —
 * no hay nada que perder, así que no hay riesgo que medir.
 */
export function fraccionBorrada(diff: Diff, tamanoIndice: number): number {
  if (tamanoIndice <= 0) return 0;
  return diff.bajas.length / tamanoIndice;
}

/**
 * El umbral por omisión. **Va como constante visible**, no escondido en una
 * comparación: si un día hay que subirlo, esta línea es lo que se toca y quien
 * lea el código ve con qué se decidió.
 *
 * El argumento: un umbral bajo pararía la sync en cada limpieza rutinaria;
 * borrar un tercio del corpus de una vez no es limpieza, es transporte roto.
 *
 * ────────────────────────────────────────────────────────────
 * **SIN CALIBRAR. Es un argumento, no una medición** — y la distinción es la
 * que este proyecto ya pagó una vez.
 *
 * Hoy no existe **ni una sola limpieza rutinaria medida**: el repo del corpus
 * no tiene historia todavía, así que **nadie sabe cómo se ve un borrado normal
 * aquí**. Exactamente el estado en que nació el umbral `U=5` de la alarma de
 * B9: sonaba razonable y **dispara un día de cada ocho** sobre comportamiento
 * legítimo (ver `B10-4`).
 *
 * **Se calibra cuando el repo tenga historia**: medir la distribución real de
 * bajas por commit y ajustar con el dato — **sin pegarlo al máximo observado**,
 * que garantiza 0 disparos sobre los datos con que se ajustó y es P20.
 *
 * Mientras tanto no muerde donde importa: el caso grave —manifiesto vacío— lo
 * cubre una regla aparte que no depende de este número.
 */
export const UMBRAL_BORRADO_MASIVO = 0.3;

export interface VeredictoBorrado {
  masivo: boolean;
  fraccion: number;
  motivo: string;
}

/**
 * ¿Este diff parece un borrado masivo, o sea probablemente un manifiesto roto?
 *
 * **Un manifiesto VACÍO se trata aparte y siempre para**, aunque el umbral no
 * se alcanzara: cero archivos no es un corpus limpio, es una lectura fallida.
 * Distinguirlo importa porque es **el caso más probable de todos** — es lo que
 * devuelve un token vencido, un `catch` mudo o una respuesta a medias.
 */
export function esBorradoMasivo(
  diff: Diff,
  tamanoIndice: number,
  manifiestoVacio: boolean,
  umbral: number = UMBRAL_BORRADO_MASIVO,
): VeredictoBorrado {
  const fraccion = fraccionBorrada(diff, tamanoIndice);

  if (manifiestoVacio && tamanoIndice > 0) {
    return {
      masivo: true,
      fraccion,
      motivo:
        'El manifiesto llegó VACÍO y el índice tiene ' +
        tamanoIndice +
        ' documentos. Cero archivos no es un corpus limpio: es una lectura fallida.',
    };
  }

  if (fraccion > umbral) {
    return {
      masivo: true,
      fraccion,
      motivo:
        'Borraría ' +
        diff.bajas.length +
        ' de ' +
        tamanoIndice +
        ' documentos (' +
        (fraccion * 100).toFixed(1) +
        ' %), por encima del ' +
        (umbral * 100).toFixed(0) +
        ' % permitido. Se detiene: un manifiesto truncado se ve exactamente así.',
    };
  }

  return { masivo: false, fraccion, motivo: '' };
}

/** Una línea legible del diff, para el registro del intento y para el humano. */
export function resumirDiff(diff: Diff): string {
  return (
    diff.altas.length +
    ' altas · ' +
    diff.cambios.length +
    ' cambios · ' +
    diff.bajas.length +
    ' bajas · ' +
    diff.sinCambio +
    ' sin cambio'
  );
}
