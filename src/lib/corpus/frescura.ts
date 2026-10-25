// ============================================================
// [INV-B11] O7 · EL TESTIGO DE FRESCURA — y por qué son DOS fechas.
//
// El brief lo pidió así: *«Corpus indexado: N documentos · última
// actualización …»*. Una fecha sola no alcanza, y la razón es la deuda que
// este proyecto lleva un bloque entero sin poder cerrar en la ingesta:
//
//     `corpus_documentos` dice cuándo CAMBIÓ algo.
//     NO dice cuándo se MIRÓ.
//
// Con una sola fecha, «última actualización: hace 6 días» deja al lector sin
// saber si la sincronización lleva seis días sin correr o corrió anoche y no
// había nada nuevo. **Son dos situaciones opuestas con la misma evidencia** —
// es la deuda B10-3, literal, que en la ingesta no se puede resolver porque
// `snapshots` registra RESULTADOS y no INTENTOS.
//
// Aquí SÍ se puede, y por una decisión de la `0030`: escribe una fila en
// `corpus_sync_intentos` **al EMPEZAR**, no al terminar. Así el testigo dice la
// verdad completa:
//
//     indexado hace 6 días  ·  revisado hace 2 horas, sin novedad
//
// ────────────────────────────────────────────────────────────
// TODO LO DE AQUÍ ES PURO. La consulta vive en el servicio; esto solo decide
// QUÉ SIGNIFICAN los dos instantes. Y esa decisión es la que hay que poder
// probar sin base: es donde se distinguen los dos silencios.
// ============================================================

/** Lo que se lee de la base. Instantes en ISO, o `null` si no hay. */
export interface DatosFrescura {
  documentos: number;
  trozos: number;
  /** El `commit_sha` del último documento indexado, si lo hay. */
  version: string | null;
  /** Cuándo cambió algo por última vez. `null` = nunca se ha indexado. */
  ultimoCambio: string | null;
  /** Cuándo se MIRÓ por última vez, haya cambiado algo o no. */
  ultimoIntento: string | null;
  /** `ok` | `detenido` | `error` | `corriendo`, del último intento. */
  ultimoResultado: string | null;
  /** Por qué se detuvo, si se detuvo. */
  motivo: string | null;
}

export type EstadoFrescura =
  /** Nunca se ha indexado nada. No es «viejo»: es que no hay. */
  | { tipo: 'vacio' }
  /** Se revisó después del último cambio y no había novedad. */
  | { tipo: 'al_dia_sin_novedad'; documentos: number; ultimoCambio: string; ultimoIntento: string }
  /** El último intento TRAJO algo. */
  | { tipo: 'recien_actualizado'; documentos: number; ultimoCambio: string }
  /** Hay corpus, pero **nadie sabe cuándo se miró**: no hay intentos registrados. */
  | { tipo: 'sin_registro_de_intentos'; documentos: number; ultimoCambio: string }
  /** El último intento se DETUVO. La guarda hizo su trabajo y hay que verlo. */
  | { tipo: 'detenido'; documentos: number; ultimoIntento: string; motivo: string | null }
  /** El último intento reventó. */
  | { tipo: 'error'; documentos: number; ultimoIntento: string; motivo: string | null };

/**
 * Qué significan los dos instantes juntos.
 *
 * **`detenido` va ANTES que todo lo demás**, y no es un detalle de orden: una
 * corrida detenida por la guarda de borrado masivo dejó el corpus como estaba,
 * así que las fechas de cambio se ven perfectamente sanas. Si el estado se
 * decidiera por ellas, **una defensa que se disparó se leería como un sistema
 * al día** — que es la peor manera posible de equivocarse aquí.
 */
export function estadoDe(d: DatosFrescura): EstadoFrescura {
  if (d.ultimoResultado === 'detenido') {
    return { tipo: 'detenido', documentos: d.documentos, ultimoIntento: d.ultimoIntento ?? '', motivo: d.motivo };
  }
  if (d.ultimoResultado === 'error') {
    return { tipo: 'error', documentos: d.documentos, ultimoIntento: d.ultimoIntento ?? '', motivo: d.motivo };
  }

  if (d.documentos === 0 || !d.ultimoCambio) return { tipo: 'vacio' };

  // Sin intentos registrados hay corpus y no hay historia. **No se colapsa con
  // «recién actualizado»**: decir «al día» sin haber mirado nunca es
  // exactamente la afirmación sin medición que la regla #1 prohíbe.
  if (!d.ultimoIntento) {
    return { tipo: 'sin_registro_de_intentos', documentos: d.documentos, ultimoCambio: d.ultimoCambio };
  }

  // La comparación es lo único que distingue los dos silencios: si se miró
  // DESPUÉS del último cambio, el silencio significa «no había nada nuevo».
  const miroDespues = Date.parse(d.ultimoIntento) > Date.parse(d.ultimoCambio);
  return miroDespues
    ? {
        tipo: 'al_dia_sin_novedad',
        documentos: d.documentos,
        ultimoCambio: d.ultimoCambio,
        ultimoIntento: d.ultimoIntento,
      }
    : { tipo: 'recien_actualizado', documentos: d.documentos, ultimoCambio: d.ultimoCambio };
}

/**
 * Cuánto hace, en palabras. **Sin decimales y sin `Intl.RelativeTimeFormat`**:
 * el portal ya formatea fechas en `src/lib/formato.ts` y esto es una frase, no
 * una fecha — meterlo allí lo convertiría en una quinta implementación de algo
 * que no es lo mismo.
 */
export function haceCuanto(iso: string, ahora: Date): string {
  const ms = ahora.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'hace un momento';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hace 1 día' : `hace ${d} días`;
}

/**
 * La frase que ve el usuario.
 *
 * **Cada estado tiene la suya, y ninguna se reutiliza.** Una frase compartida
 * entre «se revisó y no había nada» y «nadie lo ha revisado» sería el colapso
 * que toda esta pieza existe para evitar.
 */
export function textoDe(e: EstadoFrescura, ahora: Date): string {
  switch (e.tipo) {
    case 'vacio':
      return 'Todavía no hay documentación indexada.';
    case 'recien_actualizado':
      return `Corpus indexado: ${e.documentos} documentos · actualizado ${haceCuanto(e.ultimoCambio, ahora)}.`;
    case 'al_dia_sin_novedad':
      return (
        `Corpus indexado: ${e.documentos} documentos · actualizado ${haceCuanto(e.ultimoCambio, ahora)} · ` +
        `revisado ${haceCuanto(e.ultimoIntento, ahora)}, sin novedad.`
      );
    case 'sin_registro_de_intentos':
      return (
        `Corpus indexado: ${e.documentos} documentos · actualizado ${haceCuanto(e.ultimoCambio, ahora)}. ` +
        `No hay registro de cuándo se revisó por última vez.`
      );
    case 'detenido':
      return (
        `La última sincronización se DETUVO ${haceCuanto(e.ultimoIntento, ahora)}` +
        (e.motivo ? `: ${e.motivo}` : '.') +
        ` Los ${e.documentos} documentos que hay siguen siendo los de antes.`
      );
    case 'error':
      return (
        `La última sincronización falló ${haceCuanto(e.ultimoIntento, ahora)}` +
        (e.motivo ? `: ${e.motivo}` : '.') +
        ` Los ${e.documentos} documentos que hay siguen siendo los de antes.`
      );
  }
}

/** Si el estado pide atención de alguien. Gobierna el color, no el texto. */
export function pideAtencion(e: EstadoFrescura): boolean {
  return e.tipo === 'detenido' || e.tipo === 'error' || e.tipo === 'vacio';
}
