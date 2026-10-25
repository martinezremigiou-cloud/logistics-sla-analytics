// ============================================================
// [2.0.1-A · D2] drift-familias.ts — la re-ramificación del espejo, DERIVADA
// (100% PURO: sin supabase, sin react, sin fechas del reloj).
//
// SE DIO EL GO CON UNA CONDICIÓN QUE MANDA SOBRE TODO LO DEMÁS: la ingesta
// no se toca. Así que esto no escribe nada ni pide migración — **el libro del
// drift ya existe**: `cambios` registra cada reasignación de familia con su
// `valor_anterior → valor_nuevo` y su `snapshot_id`. Lo que faltaba era leerlo.
//
// POR QUÉ VIVE AQUÍ Y NO EN EL SCRIPT. Nació en un script prototipo de
// investigación (O3) y se MUEVE entero, no se copia: dos implementaciones de la misma derivación divergen —
// es literalmente lo que pasó con `piezas_en_camino` (cuatro copias, ninguna
// compartida, nada que las compare). El script de investigación la
// importaba por el `ts-loader` en vez de reimplementarla.
//
// LO QUE ESTE MÓDULO NO PUEDE SABER, declarado:
//   · «Vaciada» se evalúa contra el conteo que le pasen, y ese conteo solo
//     puede ser el del snapshot VIGENTE: `productos` es upsert latest-wins y
//     no guarda historia. Exacto para la última corrida, aproximación para las
//     viejas. (Medirlo de verdad exigiría una foto por corrida, que es tocar
//     la ingesta.)
//   · Sin snapshot no hay drift (B10-3): `cambios` solo registra corridas que
//     PERSISTIERON. Aquí no muerde —sin corrida no hubo reasignación— pero se
//     dice para que nadie lea «0 drift» como «la ingesta corrió limpia».
// ============================================================

/** SKUs que deben moverse JUNTOS de A a B para leer la huella como un bloque y no como casos sueltos. */
export const UMBRAL_BLOQUE = 3;

export interface CambioFamilia {
  sku: string;
  valor_anterior: string | null;
  valor_nuevo: string | null;
}

export interface MovimientoFamilia {
  de: string;
  a: string;
  n: number;
}

export interface FamiliaVaciada {
  nombre: string;
  teniaPuente: boolean;
}

export interface PropuestaPuente {
  de: string;
  a: string;
  n: number;
  ficha: string;
}

export interface ReporteCorrida {
  altas: string[];
  vaciadas: FamiliaVaciada[];
  movimientos: MovimientoFamilia[];
  renombresProbables: MovimientoFamilia[];
  propuestasPuente: PropuestaPuente[];
}

export interface EntradaCorrida {
  cambiosFamilia: CambioFamilia[];
  /** Familias dadas de alta en ESA corrida. */
  familiasNuevas: Set<string>;
  /** SKUs vigentes por nombre de familia (ver el límite declarado arriba). */
  conteoVigente: Map<string, number>;
  /** Familia puenteada → ruta de su ficha. */
  puentes: Map<string, string>;
}

/**
 * Interpreta la huella compuesta de UNA corrida.
 *
 * NI «renombre» NI «fusión por Excel» existen como eventos de primera clase en
 * este sistema: los dos dejan la misma marca —vaciado de la vieja + alta de la
 * nueva + movimiento de SKUs— y solo se distinguen interpretándola. Por eso
 * `renombresProbables` se llama PROBABLES y no «renombres».
 */
export function analizarCorrida({ cambiosFamilia, familiasNuevas, conteoVigente, puentes }: EntradaCorrida): ReporteCorrida {
  const movimientos = new Map<string, number>();
  for (const c of cambiosFamilia) {
    if (!c.valor_anterior || !c.valor_nuevo || c.valor_anterior === c.valor_nuevo) continue;
    const clave = `${c.valor_anterior}\u001f${c.valor_nuevo}`;
    movimientos.set(clave, (movimientos.get(clave) ?? 0) + 1);
  }
  const listaMov: MovimientoFamilia[] = Array.from(movimientos.entries())
    .map(([clave, n]) => {
      const [de, a] = clave.split('\u001f');
      return { de, a, n };
    })
    .sort((x, y) => y.n - x.n || (x.de < y.de ? -1 : 1));

  const origenes = new Set(listaMov.map((m) => m.de));
  const vaciadas: FamiliaVaciada[] = Array.from(origenes)
    .filter((nombre) => (conteoVigente.get(nombre) ?? 0) === 0)
    .sort()
    .map((nombre) => ({ nombre, teniaPuente: puentes.has(nombre) }));
  const vaciadasSet = new Set(vaciadas.map((v) => v.nombre));

  const renombresProbables = listaMov.filter(
    (m) => m.n >= UMBRAL_BLOQUE && vaciadasSet.has(m.de) && familiasNuevas.has(m.a),
  );

  // «La ficha sigue a sus SKUs» (opción 4b de O3): un bloque que sale de una
  // familia CON ficha hacia una SIN ella. Es una PROPUESTA para que un humano
  // firme, nunca una escritura — el puente nace `revisado_en = NULL` por
  // diseño (0031) y ese contrato no se rompe desde aquí.
  const propuestasPuente: PropuestaPuente[] = listaMov
    .filter((m) => m.n >= UMBRAL_BLOQUE && puentes.has(m.de) && !puentes.has(m.a))
    .map((m) => ({ de: m.de, a: m.a, n: m.n, ficha: puentes.get(m.de) as string }));

  return { altas: Array.from(familiasNuevas).sort(), vaciadas, movimientos: listaMov, renombresProbables, propuestasPuente };
}

export interface TestigoPuentes {
  /** Filas del puente que ya no tienen NINGÚN SKU en el snapshot vigente. */
  filasSinCamino: number;
  /** Filas del puente en total. */
  filasTotales: number;
  /** DOCUMENTOS distintos que un humano todavía puede alcanzar preguntando por un SKU. */
  documentosAlcanzablesPorSku: number;
  /** Nombres de las familias puenteadas que perdieron el camino, para poder mirarlas. */
  sinCamino: string[];
}

/**
 * El testigo del puente documental, escrito con P27 delante: **una fila en una
 * tabla de puentes no es un puente que alguien pueda cruzar.** Por eso el
 * titular de esta función no es «cuántas filas hay» sino **cuántos DOCUMENTOS
 * quedan alcanzables por el único camino que un usuario recorre** (preguntar
 * por un SKU → su familia → su ficha).
 *
 * Ese número ya se movió una vez sin que nadie lo notara, y volvió a moverse en
 * pocas horas mientras se escribía este bloque.
 */
export function puentesSinCamino({
  puentes,
  familiasConSkuVigente,
}: {
  /** familia → ruta de ficha (solo filas con ficha). */
  puentes: Map<string, string>;
  /** Nombres de familia que SÍ tienen al menos un SKU en el vigente. */
  familiasConSkuVigente: Set<string>;
}): TestigoPuentes {
  const sinCamino: string[] = [];
  const alcanzables = new Set<string>();
  for (const [familia, ruta] of Array.from(puentes.entries())) {
    if (familiasConSkuVigente.has(familia)) alcanzables.add(ruta);
    else sinCamino.push(familia);
  }
  sinCamino.sort();
  return {
    filasSinCamino: sinCamino.length,
    filasTotales: puentes.size,
    documentosAlcanzablesPorSku: alcanzables.size,
    sinCamino,
  };
}
