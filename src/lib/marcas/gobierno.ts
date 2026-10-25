// ============================================================
// [VERT-B2] EL GOBIERNO DE LA REGLA DE EXCLUSIÓN — y por qué hace falta.
//
// La regla «esta marca no se lista en el catálogo» vive en un DATO
// (`marcas.excluida_del_catalogo`, migración 0039). Eso la vuelve reversible
// sin desplegar, que era el punto. Pero deja dos huecos que la propia 0039
// declara en su `RAISE NOTICE` final y no puede cerrar desde donde está:
//
//   1. Nadie ve QUIÉN excluyó qué, ni CUÁNDO, ni POR QUÉ. El dato existe
//      —el CHECK `marcas_exclusion_con_autoria` lo vuelve obligatorio— pero
//      hasta este módulo ninguna superficie del portal lo leía: medido, cero
//      ocurrencias de `excluida_motivo`/`excluida_por`/`excluida_en` en `src/`.
//
//   2. **Una marca nueva entra SOLA.** El ETL la da de alta dentro de
//      `ingest_snapshot` sin encolar nada (deuda `MARCA-NUEVA-ENTRA-EN-SILENCIO`),
//      y `resolver_pendiente` también puede crearla. O sea que el universo del
//      catálogo puede crecer sin que nadie lo haya decidido — y con una regla
//      que se define POR MARCA, eso es exactamente lo que hay que vigilar.
//      El censo del bloque lo puso como condición de la Pregunta 1, la que
//      decidió que la regla fuera por marca: *«la regla por marca necesita su
//      propia alarma, porque una marca nueva entra sola y no hay pantalla para
//      gobernarla»*.
//
// ────────────────────────────────────────────────────────────
// TODO LO DE AQUÍ ES PURO. La consulta vive en `marcas.service.ts`; esto sólo
// decide QUÉ SIGNIFICAN las filas. Mismo reparto que `lib/corpus/frescura.ts`,
// y por la misma razón: lo que decide se prueba sin base.
// ============================================================

/**
 * El instante que la 0039 escribió en las marcas que ya existían cuando se
 * instaló la regla, para que la alarma no sonara con las marcas preexistentes el primer día
 * — *«una alarma que suena siempre es una alarma apagada»*.
 *
 * ⚠ ES UNA SEGUNDA COPIA DE UN VALOR QUE VIVE EN LA MIGRACIÓN, y eso es P33.
 * No se puede evitar: la migración ya corrió y el código tiene que reconocer
 * el centinela que ella escribió. Lo que sí se puede es que las dos copias
 * estén COTEJADAS en vez de sólo coincidir hoy — `gobierno.test.ts` lee el
 * `.sql` y falla si divergen. Cotejar dos copias detecta divergencia, nunca
 * obsolescencia compartida; aquí alcanza, porque el valor de la migración es
 * inmutable por construcción.
 */
export const CENTINELA_PRE_REGLA = '2026-01-01T00:00:00.000Z';

/** Una fila de `marcas`, tal como la lee el servicio. */
export interface MarcaGobierno {
  nombre: string;
  excluida: boolean;
  motivo: string | null;
  por: string | null;
  en: string | null;
  /** `null` sólo si la fila es anterior a la 0039 y no recibió el centinela. */
  creadaEn: string | null;
}

export interface EstadoGobierno {
  /** Las que hoy no se listan en el catálogo, ordenadas como llegaron. */
  excluidas: MarcaGobierno[];
  /**
   * LA ALARMA: nacidas DESPUÉS de la regla y sin ninguna decisión registrada.
   * No son «marcas malas»: son marcas que entraron solas y que nadie ha mirado.
   */
  sinDecidir: MarcaGobierno[];
  /** Cuántas marcas hay en total — el denominador, siempre a la vista. */
  total: number;
}

/**
 * ¿Esta marca nació DESPUÉS de que la regla existiera?
 *
 * `creadaEn` nulo cuenta como ANTERIOR, y es deliberado: la columna es
 * `NOT NULL DEFAULT now()` desde la 0039, así que un nulo sólo puede venir de
 * un camino que no pasó por ella. Tratarlo como «nueva» haría sonar la alarma
 * por una fila vieja y rara — y una alarma que se dispara por el motivo
 * equivocado es cómo se aprende a ignorarla.
 */
export function esPosteriorALaRegla(creadaEn: string | null): boolean {
  if (creadaEn === null) return false;
  const t = Date.parse(creadaEn);
  if (Number.isNaN(t)) return false;
  return t > Date.parse(CENTINELA_PRE_REGLA);
}

/**
 * ¿Alguien decidió algo sobre esta marca?
 *
 * Se pregunta por `en` (la FECHA de la decisión) y no por `excluida`, y la
 * diferencia es el punto entero de la alarma: una marca con
 * `excluida = false` y sin fecha **no es una marca que se decidió dejar
 * dentro** — es una marca que nadie ha mirado. Son dos estados distintos con
 * el mismo booleano, y confundirlos apagaría la alarma para siempre.
 */
export function tieneDecision(m: MarcaGobierno): boolean {
  return m.en !== null;
}

export function estadoDe(marcas: readonly MarcaGobierno[]): EstadoGobierno {
  return {
    excluidas: marcas.filter((m) => m.excluida),
    sinDecidir: marcas.filter((m) => esPosteriorALaRegla(m.creadaEn) && !tieneDecision(m)),
    total: marcas.length,
  };
}

/** Si el estado pide atención de alguien. Gobierna el color, no el texto. */
export function pideAtencion(e: EstadoGobierno): boolean {
  return e.sinDecidir.length > 0;
}

/**
 * Una marca EXCLUIDA sin autoría completa es un SÍNTOMA, no un hueco
 * tolerable: el CHECK `marcas_exclusion_con_autoria` vuelve ese estado
 * inexpresable en la base, así que si aparece en pantalla es que algo escribió
 * saltándose la restricción — o que se está leyendo otra cosa.
 *
 * La pantalla lo dice en vez de pintar un «—» silencioso, que es como un
 * defecto de integridad se confunde con un campo vacío.
 */
export function autoriaIncompleta(m: MarcaGobierno): boolean {
  return m.excluida && (m.motivo === null || m.por === null || m.en === null);
}
