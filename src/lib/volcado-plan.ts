// ============================================================
// [INV-B8.2] lib/volcado-plan.ts — qué va a pasar al volcar, en puro.
//
// EL «AND SAY» DEL SUM-AND-SAY. El usuario armó la Selección recorriendo el
// catálogo, sin ver el proyecto: al volcar tiene derecho a saber, ANTES de
// confirmar, cuáles SKUs son nuevos y cuáles ya estaban y van a sumar. Sin esta
// vista previa, «volcar» sería un botón que cambia cifras que nadie enseñó.
//
// LO QUE ESTE MÓDULO CALCULA NO ES LA VERDAD, ES UNA PREVISIÓN. `despues` es lo
// que el cliente ESPERA que quede, calculado sobre las partidas que acaba de
// leer. Quien decide es el servidor, que vuelve a comprobar contra la base
// —puede haber cambiado entre la lectura y el envío— y responde con el antes y
// el después reales. Por eso `cantidadVista` viaja en el envío: es la
// afirmación que el servidor va a verificar (ver `volcarSeleccionSchema`).
//
// Y por eso vive aquí y no dentro del diálogo: es aritmética con reglas, y la
// aritmética con reglas se prueba sin navegador.
// ============================================================
import { normalizarSku, type ItemSeleccion } from './seleccion';

/** Lo mínimo que hace falta de una partida ya existente. Compatible con `PartidaItem`. */
export interface PartidaExistente {
  sku: string;
  cantidad: number;
}

export interface RenglonPlan {
  sku: string;
  /** Piezas que se AGREGAN. Es lo que el usuario tenía en la Selección. */
  cantidad: number;
  /** Lo que hay hoy en el proyecto; `0` si el SKU no está. Viaja al servidor para que lo verifique. */
  cantidadVista: number;
  esNuevo: boolean;
  /** Previsión, no verdad: `cantidadVista + cantidad`. La confirma el servidor. */
  despues: number;
}

export interface ResumenPlan {
  nuevos: number;
  existentes: number;
  /** Piezas que se agregan en total. NO es el total del proyecto después. */
  piezas: number;
}

/**
 * Cruza la Selección con lo que el proyecto ya tiene. El orden de salida es el
 * de la Selección —el orden en que el usuario fue marcando— y no el del
 * proyecto: la lista que va a leer es la suya.
 */
export function planDeVolcado(items: ItemSeleccion[], partidas: PartidaExistente[]): RenglonPlan[] {
  // Se normaliza el SKU de las partidas igual que el de la Selección. Hoy
  // ambos lados guardan `trim + UPPER` (el ETL y `agregarPartidaSchema`), así
  // que es redundante — y precisamente por eso es barato: el día que un origen
  // deje de normalizar, esto no empieza a crear renglones «nuevos» duplicados.
  const enProyecto = new Map<string, number>(partidas.map((p) => [normalizarSku(p.sku), p.cantidad]));

  return items.map((item) => {
    const sku = normalizarSku(item.sku);
    const cantidadVista = enProyecto.get(sku) ?? 0;
    return {
      sku,
      cantidad: item.cantidad,
      cantidadVista,
      esNuevo: cantidadVista === 0,
      despues: cantidadVista + item.cantidad,
    };
  });
}

export function resumenDePlan(plan: RenglonPlan[]): ResumenPlan {
  return {
    nuevos: plan.filter((r) => r.esNuevo).length,
    existentes: plan.filter((r) => !r.esNuevo).length,
    piezas: plan.reduce((suma, r) => suma + r.cantidad, 0),
  };
}

/** El cuerpo que viaja a `POST /api/proyectos/[id]/partidas/volcado`. */
export function cargaDeVolcado(plan: RenglonPlan[]): { sku: string; cantidad: number; cantidadVista: number }[] {
  return plan.map((r) => ({ sku: r.sku, cantidad: r.cantidad, cantidadVista: r.cantidadVista }));
}
