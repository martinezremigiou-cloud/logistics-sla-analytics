// ============================================================
// [INV-B9] lib/avisos.ts — QUÉ hay que avisarle a quién. 100% PURO.
//
// ESTE ARCHIVO ES LA FRONTERA DEL BLOQUE 2 (el correo), y por eso no sabe qué
// es React, qué es Supabase ni qué es un correo. Recibe filas y devuelve
// AVISOS: objetos con tipo, destinatario, SKU, de, a y de qué carga salieron.
// La campana es un consumidor más; el correo será otro. Si «avisar» se
// calculara dentro de un componente, el correo tendría que reimplementarlo.
//
// LO QUE NO PRODUCE, y es deliberado (devolución aceptada): asunto y
// cuerpo. Eso es copy de un canal que todavía no está especificado; escribirlo
// hoy sería la interfaz de algo que nadie definió — P7 con otro traje. La
// frontera se para un escalón antes.
//
// ────────────────────────────────────────────────────────────
// DE DÓNDE SALE UN AVISO: DE `cambios`, LA BITÁCORA QUE EL ETL YA ESCRIBE.
//
// No hay diff nuevo ni derivación nueva. `cambios` guarda, por snapshot, qué
// cambió campo por campo — y guarda el `sku` incluso en las filas de embarque
// (`clave = 'XNG7080707|FZ6661N5'`). Medido contra la base
// real.
//
// LAS CUATRO SEÑALES, y por qué son ÉSAS:
//
//   estatus     embarque | estatus | MODIFICACION   → "En Aduana" → "En Almacén North"
//   reservado   producto | resv    | MODIFICACION   → 10 → 5
//   disponible  cualquier fila de `stock`, MÁS la de resv
//   llegada     disponible pasó de ≤0 a >0
//
// **`reservado` sale de `producto.resv` y NUNCA de la tabla `reservas`**, y no
// es una preferencia: `derivarSku` calcula `reservado = producto.resv`. La capa
// de reservas es la equivocada por tres razones medidas:
//
//   · Produce una avalancha de ALTA/BAJA por diseño — su clave incluye kam·cliente·fecha·
//     motivo, así que resolver el KAM de una fila la reescribe entera.
//   · La mayor parte de ese ruido NO mueve el reservado del SKU (§R4-20).
//   · **BP-9**: las reservas sin fecha se rellenan con `${periodo}-01`, así que
//     en CADA cambio de mes rotan todas de clave a la vez — un lote de cambios de
//     ruido determinista. Una campana anclada ahí dispararía una falsa alarma
//     masiva el día 1 de cada mes, para siempre.
//
// FORMATO DE LOS VALORES, verificado contra la base y no supuesto:
//
//   stock | cantidad | MODIFICACION   ant="10"              nue="5"
//   stock | *        | ALTA           ant=null              nue="{\"cantidad\":1}"
//   stock | *        | BAJA           ant="{\"cantidad\":12}" nue=null
//   producto | resv  | MODIFICACION   ant="10"              nue="5"
//   embarque | estatus | MODIFICACION ant="En Aduana"       nue="En Almacén North"
//
// ────────────────────────────────────────────────────────────
// UN RENGLÓN POR SKU Y POR TIPO — el invariante acordado.
//
// «El aviso es un resumen por carga, no un evento por cambio.» Aquí eso es
// literal: los cambios se AGREGAN por SKU antes de decidir. Un SKU que avanzó
// tres etapas produce UNA línea («de Preparación a Almacén FW»), no tres; y si
// pasaron cinco cargas desde la última vez que miraste, sigue siendo una línea
// con el neto. Medido: quien sigue 30 SKU recibe, en una carga
// mediana, bastante menos de un aviso.
//
// Y `llegada` MANDA SOBRE `disponible`: si un SKU llegó, su disponible también
// cambió, pero son un solo hecho. Emitir los dos sería contar una cosa dos
// veces — la misma falta que este proyecto viene corrigiendo desde B8.2.
// ============================================================

export type TipoAviso = 'estatus' | 'disponible' | 'reservado' | 'llegada';

/** Los cuatro tipos en orden de prioridad de lectura: primero lo que se puede prometer. */
export const TIPOS_AVISO: TipoAviso[] = ['llegada', 'estatus', 'disponible', 'reservado'];

export const ETIQUETA_AVISO: Record<TipoAviso, string> = {
  llegada: 'Ya llegó',
  estatus: 'Cambió de etapa',
  disponible: 'Cambió el disponible',
  reservado: 'Cambió el reservado',
};

/** Fila cruda de `cambios`, tal cual la devuelve PostgREST. */
export interface CambioCrudo {
  entidad: string;
  campo: string;
  tipo: string;
  sku: string | null;
  valor_anterior: string | null;
  valor_nuevo: string | null;
  detectado_en: string;
  snapshot_id: string;
}

/** Fila de `seguimientos`. Los cuatro booleanos son lo que esa persona pidió saber. */
export interface SeguimientoLectura {
  perfil_id: string;
  sku: string;
  av_estatus: boolean;
  av_disponible: boolean;
  av_reservado: boolean;
  av_llegada: boolean;
}

/** Las cifras de HOY, ya derivadas por `derivarSku`. Este módulo no calcula ninguna. */
export interface CifrasAhora {
  disponible: number;
  reservado: number;
}

export interface Aviso {
  perfil_id: string;
  tipo: TipoAviso;
  sku: string;
  /** Valor antes del cambio, en texto. `null` cuando no aplica. */
  de: string | null;
  a: string | null;
  /** El instante MÁS RECIENTE que contribuyó a este aviso. */
  detectado_en: string;
  snapshot_id: string;
}

/**
 * Lee una cantidad de un `valor_anterior`/`valor_nuevo` de `cambios`.
 *
 * Dos formas conviven en la misma columna `text` y hay que aceptar las dos:
 * el número pelado de una MODIFICACIÓN (`"10"`) y el JSON de una ALTA/BAJA
 * (`{"cantidad":1}`). `null` vale 0 — es lo correcto: en una ALTA no había
 * nada antes, y en una BAJA no queda nada después.
 *
 * Nunca lanza. `cambios` la escribe el ETL y este módulo alimenta una campana:
 * una fila rara no puede tumbar el aviso de los otros 29 SKU.
 */
export function cantidadDeValor(valor: string | null): number {
  if (valor === null || valor === '') return 0;
  const plano = Number(valor);
  if (Number.isFinite(plano)) return plano;
  try {
    const objeto = JSON.parse(valor) as { cantidad?: unknown };
    const n = Number(objeto?.cantidad);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

interface AgregadoSku {
  deltaTotal: number;
  deltaResv: number;
  resvDe: string | null;
  resvA: string | null;
  etapaDe: string | null;
  etapaA: string | null;
  detectado_en: string;
  snapshot_id: string;
}

/**
 * Agrega los cambios de un SKU. **Aquí ocurre el resumen**: cinco cargas y
 * catorce filas salen como un solo agregado con el neto.
 *
 * Las filas tienen que llegar ordenadas por `detectado_en` ascendente para que
 * `etapaDe` sea la primera etapa y `etapaA` la última — que es lo que hace que
 * tres saltos se lean como un solo movimiento.
 */
function agregarPorSku(cambios: CambioCrudo[]): Map<string, AgregadoSku> {
  const mapa = new Map<string, AgregadoSku>();

  for (const c of cambios) {
    if (!c.sku) continue;
    let a = mapa.get(c.sku);
    if (!a) {
      a = {
        deltaTotal: 0,
        deltaResv: 0,
        resvDe: null,
        resvA: null,
        etapaDe: null,
        etapaA: null,
        detectado_en: c.detectado_en,
        snapshot_id: c.snapshot_id,
      };
      mapa.set(c.sku, a);
    }

    if (c.detectado_en >= a.detectado_en) {
      a.detectado_en = c.detectado_en;
      a.snapshot_id = c.snapshot_id;
    }

    if (c.entidad === 'stock') {
      a.deltaTotal += cantidadDeValor(c.valor_nuevo) - cantidadDeValor(c.valor_anterior);
    } else if (c.entidad === 'producto' && c.campo === 'resv' && c.tipo === 'MODIFICACION') {
      a.deltaResv += cantidadDeValor(c.valor_nuevo) - cantidadDeValor(c.valor_anterior);
      // El PRIMER anterior y el ÚLTIMO nuevo: el neto visible, no cada paso.
      if (a.resvDe === null) a.resvDe = c.valor_anterior;
      a.resvA = c.valor_nuevo;
    } else if (c.entidad === 'embarque' && c.campo === 'estatus' && c.tipo === 'MODIFICACION') {
      if (a.etapaDe === null) a.etapaDe = c.valor_anterior;
      a.etapaA = c.valor_nuevo;
    }
  }

  return mapa;
}

/**
 * Los avisos que le tocan a cada persona.
 *
 * `cifras` trae el disponible y el reservado de HOY, ya calculados por
 * `derivarSku` — este módulo **no deriva ninguna cifra**, solo resta deltas
 * para reconstruir el «antes». Es el invariante O1 del bloque: cero aritmética
 * nueva.
 *
 * El «antes» se reconstruye y no se lee de ningún lado porque no existe: las
 * cifras históricas de un SKU no se guardan en ninguna tabla (`productos` se
 * actualiza en sitio). `cambios` es la única memoria, y de ahí sale el delta.
 *   Δdisponible = Δtotal − Δreservado   (porque disponible = total − reservado)
 */
export function derivarAvisos(
  seguimientos: SeguimientoLectura[],
  cambios: CambioCrudo[],
  cifras: Map<string, CifrasAhora>,
): Aviso[] {
  const porSku = agregarPorSku(cambios);
  const avisos: Aviso[] = [];

  for (const s of seguimientos) {
    const agr = porSku.get(s.sku);
    if (!agr) continue;

    const ahora = cifras.get(s.sku);
    const base = { perfil_id: s.perfil_id, sku: s.sku, detectado_en: agr.detectado_en, snapshot_id: agr.snapshot_id };

    if (s.av_estatus && agr.etapaA !== null) {
      avisos.push({ ...base, tipo: 'estatus', de: agr.etapaDe, a: agr.etapaA });
    }

    if (s.av_reservado && agr.deltaResv !== 0) {
      avisos.push({ ...base, tipo: 'reservado', de: agr.resvDe, a: agr.resvA });
    }

    // Sin cifras de hoy no se puede reconstruir el antes, y un aviso de
    // disponibilidad sin números no le sirve a nadie. Se omite en vez de
    // inventarlo.
    if (!ahora) continue;

    const deltaDisponible = agr.deltaTotal - agr.deltaResv;
    if (deltaDisponible === 0) continue;

    const antes = ahora.disponible - deltaDisponible;
    const llego = antes <= 0 && ahora.disponible > 0;

    // `llegada` MANDA sobre `disponible`: un SKU que llegó cambió su
    // disponible, pero es UN hecho. Dos renglones serían contarlo dos veces.
    if (llego && s.av_llegada) {
      avisos.push({ ...base, tipo: 'llegada', de: String(antes), a: String(ahora.disponible) });
    } else if (s.av_disponible) {
      avisos.push({ ...base, tipo: 'disponible', de: String(antes), a: String(ahora.disponible) });
    }
  }

  return avisos;
}

// ============================================================
// LA CAPA FIJA — el pulso. Le llega a todos y nadie la suscribe.
//
// NO ES UN INVENTARIO POR ETAPA, y esa fue la corrección más grande del
// checkpoint. Medido sobre un snapshot vigente: de las 11 etapas del pipeline,
// **casi todas están vacías** en cualquier momento dado (solo unas pocas
// concentran renglones). Una tabla de 11 etapas mostraría casi puros ceros.
//
// Lo que sí se mueve —y lo que un vendedor quiere ver— es el LOTE avanzando:
// 10 unidades de Aduana a Almacén North, 5 de Preparación a Almacén FW. **El
// pulso es movimiento, no inventario.**
// ============================================================

export interface Pulso {
  /** SKU que cambiaron de etapa, con el salto agregado. Una línea por SKU. */
  movimientos: { sku: string; de: string | null; a: string | null }[];
  /** SKU cuyo disponible pasó de ≤0 a >0. El evento más raro y el más útil. */
  llegadas: string[];
  /** Lo que viene en camino: renglones activos del pipeline. */
  enCamino: { skus: number; piezas: number; etapasOcupadas: number };
}

export interface EmbarqueActivo {
  sku: string;
  piezas: number | null;
  etapa: string | null;
}

export function derivarPulso(
  cambios: CambioCrudo[],
  embarquesActivos: EmbarqueActivo[],
  cifras: Map<string, CifrasAhora>,
): Pulso {
  const porSku = agregarPorSku(cambios);

  const movimientos: Pulso['movimientos'] = [];
  const llegadas: string[] = [];

  // `forEach` y no `for…of` sobre el Map: el `target` de este tsconfig no
  // permite iterar un Map sin `downlevelIteration`, y vitest —que transpila con
  // esbuild— lo deja pasar en VERDE mientras `tsc` falla. Es la misma trampa
  // que ya mordió en INV-B8.2; la caza correr los dos, no un mecanismo.
  porSku.forEach((agr, sku) => {
    if (agr.etapaA !== null) movimientos.push({ sku, de: agr.etapaDe, a: agr.etapaA });

    const ahora = cifras.get(sku);
    if (!ahora) return;
    const deltaDisponible = agr.deltaTotal - agr.deltaResv;
    if (deltaDisponible !== 0 && ahora.disponible - deltaDisponible <= 0 && ahora.disponible > 0) {
      llegadas.push(sku);
    }
  });

  const skus = new Set<string>();
  const etapas = new Set<string>();
  let piezas = 0;
  for (const e of embarquesActivos) {
    skus.add(e.sku);
    piezas += e.piezas ?? 0;
    if (e.etapa) etapas.add(e.etapa);
  }

  return {
    movimientos: movimientos.sort((a, b) => a.sku.localeCompare(b.sku)),
    llegadas: llegadas.sort(),
    enCamino: { skus: skus.size, piezas, etapasOcupadas: etapas.size },
  };
}

// ============================================================
// LA LÍNEA DE ADMIN — una fuente que dejó de cargar.
//
// APROBADA como excepción acotada: **una línea, solo admin**. No es
// una sección técnica; es la única falla que ya se materializó dos veces —la
// ingesta se paró y nadie se enteró— y que las dos veces encontró una persona
// mirando la fecha de un dato.
//
// EL UMBRAL SIMPLE NO SEPARA, y por eso la regla mira DOS fuentes. Medido:
//
//   el incidente conocido (solo stock)          hueco un poco mayor a una semana
//   un hueco LEGÍTIMO      (ambas fuentes)      hueco aún más largo
//
// Cualquier «lleva N días» que cace el primero dispara en el segundo. Lo que
// SÍ los separa es que en julio **callaron las dos fuentes a la vez** (un
// paro planeado), mientras que en agosto **aduana cargó muchas veces** mientras
// stock estaba muerto: un flujo se rompió y el otro siguió.
//
// Reproduciendo la regla día por día sobre el historial disponible:
//
//   U=5 V=2  → pocos días de disparo · cubre el incidente · 0 falsos en el hueco legítimo  ← ésta
//   U=7 V=2  → casi ninguno · NO cubre el incidente (el hueco fue apenas mayor que una semana y llegó antes)
//   U=3 V=2  → más días · también limpio, pero sin margen para un mes lento
//
// `U=7` —«una semana», que es lo que uno pondría a ojo— **pierde el incidente
// que ya ocurrió**. Ése es el argumento de que el número no se elige a ojo.
// ============================================================

/** Días sin cargar a partir de los cuales una fuente se considera callada. */
export const DIAS_CALLADA = 5;
/** Días de antigüedad por debajo de los cuales la OTRA fuente se considera viva. */
export const DIAS_OTRA_VIVA = 2;

const MS_DIA = 86_400_000;

export interface UltimaCarga {
  fuente: string;
  /** ISO del `created_at` del último snapshot de esa fuente. `null` si nunca cargó. */
  ultima: string | null;
}

export interface FuenteCallada {
  fuente: string;
  dias: number;
  /**
   * La fuente que sí siguió trayendo dato.
   *
   * ⚠️ CORREGIDO EL 2026-08-20, y la versión anterior de este comentario decía
   * que era «lo que convierte "no hay datos" en "algo se rompió"». **Eso afirma
   * más de lo que se puede saber.**
   *
   * Medido contra la base: el ETL **no escribe snapshot cuando el hash no
   * cambió** (`runEtl.ts:549` devuelve el snapshot previo sin persistir), y
   * `snapshots` no tiene hashes repetidos en las dos fuentes. Por tanto:
   *
   *     «corrió y no había nada nuevo»   →  no deja fila
   *     «no corrió»                      →  no deja fila
   *
   * **Las dos hipótesis producen evidencia idéntica.** Que la otra fuente sí
   * traiga dato hace el silencio más NOTABLE, no lo vuelve una avería: `stock`
   * cambia con mucha menos frecuencia que `aduana` (huecos promedio de varios días
   * contra cerca de uno) y ya tuvo varios huecos de más de 5 días
   * que fueron legítimos.
   *
   * La señal sigue valiendo: es una asimetría que un admin debería mirar. Lo
   * que no puede es decir de qué es. Ver la deuda B10-3.
   */
  otra: string;
  diasOtra: number;
}

/**
 * Las fuentes que llevan `DIAS_CALLADA` días sin cargar **mientras otra sí
 * cargó**. Devuelve un arreglo vacío cuando todo está normal o cuando el
 * silencio es compartido.
 *
 * `ahora` se inyecta y no se lee del reloj: sin eso, la prueba de esta función
 * dependería del día en que se corra.
 */
export function fuentesCalladas(cargas: UltimaCarga[], ahora: Date): FuenteCallada[] {
  const edades = cargas.map((c) => ({
    fuente: c.fuente,
    dias: c.ultima === null ? Infinity : (ahora.getTime() - new Date(c.ultima).getTime()) / MS_DIA,
  }));

  const salida: FuenteCallada[] = [];
  for (const e of edades) {
    if (!(e.dias >= DIAS_CALLADA)) continue;
    // La más fresca de las demás. Si ninguna está viva, el silencio es
    // compartido y no se avisa: eso es un paro, no una falla.
    const otras = edades.filter((o) => o.fuente !== e.fuente).sort((a, b) => a.dias - b.dias);
    const viva = otras[0];
    if (!viva || !(viva.dias <= DIAS_OTRA_VIVA)) continue;
    salida.push({
      fuente: e.fuente,
      dias: Math.floor(e.dias),
      otra: viva.fuente,
      diasOtra: Math.floor(viva.dias),
    });
  }
  return salida;
}
