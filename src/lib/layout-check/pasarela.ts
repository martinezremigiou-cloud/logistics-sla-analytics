// ============================================================
// [2.0.1-B · S · AB-5] pasarela.ts — la decisión del estado `pasarela-avanzada`,
// sacada del arnés para que se pueda PROBAR.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ NO VIVE EN `layout-check.mjs`. El `.mjs` es la única capa que ninguno
// de los tres instrumentos vigila, y ahí es donde estaba la rama que decide si
// un caso se mide o sale SIN MEDIR. La condición quedó por escrito: el
// commit que declare `RUTAS_CON_PASARELA` trae dentro el control positivo de
// esta rama. Un control positivo exige poder ejercerla, y una rama dentro de un
// `.mjs` orquestador no se ejerce sin navegador.
//
// Así que la DECISIÓN es una función pura de dos hechos —¿hay control?, ¿está
// deshabilitado?— y el arnés se queda con lo único que solo él puede hacer:
// mirar la página y contestar esos dos hechos.
//
// ────────────────────────────────────────────────────────────
// LA REGLA, y su asimetría deliberada:
//
//   · Este estado SOLO nace en rutas que declararon pasarela (`escenarios.ts`).
//     Llegar aquí y no encontrarla NO es «no aplica»: es una declaración falsa,
//     y sale SIN MEDIR. **Declarar una pasarela que no existe tiene que doler.**
//   · Un control deshabilitado tampoco es verde: si no se puede avanzar, no hay
//     estado desplazado que medir. Cero y no-medido son valores distintos, que
//     es la regla de la casa desde 2.0.1-A.
//
// Ninguna de las dos ramas devuelve «medir» por omisión. Eso es a propósito: el
// verde tiene que ganarse con un control que existe y se puede pulsar.
// ============================================================

/** Lo que el arnés puede averiguar mirando la página. */
export interface EstadoDelControl {
  /** ¿Hay un `[data-pasarela-avanzar]` visible en la página? */
  hayControl: boolean;
  /** ¿Está deshabilitado? (extremo del carril, o una sola tarjeta) */
  deshabilitado: boolean;
}

export interface DecisionPasarela {
  /** `true` = pulsar y medir. `false` = SIN MEDIR con el motivo de abajo. */
  medir: boolean;
  /** Por qué no se midió. `null` cuando sí se mide. */
  motivo: string | null;
}

/** El atributo por el que el arnés encuentra el control. Una sola fuente: el componente lo pone, el arnés lo busca. */
export const ATRIBUTO_AVANZAR = 'data-pasarela-avanzar';

export function decidirPasarela({ hayControl, deshabilitado }: EstadoDelControl): DecisionPasarela {
  if (!hayControl) {
    return {
      medir: false,
      motivo: `la ruta declara pasarela (RUTAS_CON_PASARELA) y no se encontró su control [${ATRIBUTO_AVANZAR}] visible`,
    };
  }
  if (deshabilitado) {
    return {
      medir: false,
      motivo: 'la pasarela no se puede avanzar en este ancho (control deshabilitado): no hay estado desplazado que medir',
    };
  }
  return { medir: true, motivo: null };
}
