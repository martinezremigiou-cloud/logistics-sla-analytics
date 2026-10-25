// ============================================================
// [INV-B9] types/avisos.ts — los DTO que cruzan la red.
//
// Viven aquí y no dentro de un componente por la lección que costó un bug en
// INV-B8.2: `ProyectosResponse` estaba declarada como interface LOCAL dentro
// de `proyectos-view.tsx`, así que el segundo consumidor de la misma ruta no
// tuvo nada que importar y **se inventó la forma** — un arreglo pelón sobre un
// endpoint que envuelve en `{ items }`. `tsc` salió limpio (el genérico de
// `useApi<T>` es una AFIRMACIÓN, no una comprobación) y reventó en el
// navegador. Con la forma en un solo lugar, un tercer consumidor la importa o
// no compila.
// ============================================================
import type { Aviso, Pulso, FuenteCallada, TipoAviso } from '@/lib/avisos';
import type { CanalCallado } from '@/lib/correo';

export type { Aviso, Pulso, FuenteCallada, TipoAviso, CanalCallado };

/** Los cuatro interruptores de un SKU seguido. Espejo del CHECK de la 0026: al menos uno en `true`. */
export interface AvisosSku {
  av_estatus: boolean;
  av_disponible: boolean;
  av_reservado: boolean;
  av_llegada: boolean;
}

export interface SeguimientoItem extends AvisosSku {
  perfil_id: string;
  sku: string;
  /** [INV-B9.1] Si además viaja por correo. Nace apagado. */
  av_correo: boolean;
}

/**
 * Lo que devuelve `GET /api/seguimientos`. **Envuelto**, porque es un endpoint
 * de lista y ésa es la convención de la casa (`/api/proyectos`,
 * `/api/usuarios`, `/api/familias`).
 */
export interface SeguimientosResponse {
  items: SeguimientoItem[];
}

export interface PreferenciasAvisos extends AvisosSku {
  /** `false` = «usar esto para los siguientes», que es lo marcado por omisión. */
  preguntar_por_sku: boolean;
  /** La marca de agua. `null` = nunca ha abierto la campana. */
  visto_hasta: string | null;
  /**
   * [INV-B9.1] El apagador del boletín. Nace ENCENDIDO: el bloque general le
   * llega a todos por decisión de producto (su «opción 3»), y quien lo sienta ruidoso
   * lo apaga. Es por-persona y no una regla global porque el bloque general trae
   * algo casi todas las semanas medidas — apagarlo para todos sería vaciar el correo.
   */
  boletin_correo: boolean;
}

/** Lo que devuelve `GET /api/campana`. Es un OBJETO, no una lista: no va envuelto. */
export interface CampanaResponse {
  pulso: Pulso;
  avisos: Aviso[];
  /** Cuántos avisos son posteriores a la marca de agua. Es el número del badge. */
  nuevos: number;
  seguidos: number;
  preferencias: PreferenciasAvisos;
  ultimas: { fuente: string; ultima: string | null }[];
  /** Solo se puebla para admin. Ventas nunca la ve. */
  calladas: FuenteCallada[];
  /**
   * [INV-B9.1] El canal de correo lleva demasiado tiempo sin un envío
   * confirmado. `null` si está sano, si nunca se ha enviado nada, o si quien
   * mira no es admin. Ventas nunca la ve.
   */
  correoCallado: CanalCallado | null;
}
