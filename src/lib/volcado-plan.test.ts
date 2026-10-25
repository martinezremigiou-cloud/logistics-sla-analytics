import { describe, it, expect } from 'vitest';
import { planDeVolcado, resumenDePlan, cargaDeVolcado } from './volcado-plan';
import { agregar, SELECCION_VACIA } from './seleccion';

const seleccion = (...pares: [string, number][]) =>
  pares.reduce((s, [sku, cantidad]) => agregar(s, sku, cantidad), SELECCION_VACIA).items;

describe('[INV-B8.2] planDeVolcado', () => {
  it('un proyecto vacío: todo es nuevo y `cantidadVista` es 0', () => {
    const plan = planDeVolcado(seleccion(['SUJ500-F', 40], ['JE016-YD', 120]), []);
    expect(plan).toEqual([
      { sku: 'SUJ500-F', cantidad: 40, cantidadVista: 0, esNuevo: true, despues: 40 },
      { sku: 'JE016-YD', cantidad: 120, cantidadVista: 0, esNuevo: true, despues: 120 },
    ]);
  });

  it('el SKU que ya está SUMA, y el plan enseña las dos cifras y el resultado', () => {
    const plan = planDeVolcado(seleccion(['SUJ500-F', 40]), [{ sku: 'SUJ500-F', cantidad: 10 }]);
    expect(plan[0]).toEqual({ sku: 'SUJ500-F', cantidad: 40, cantidadVista: 10, esNuevo: false, despues: 50 });
  });

  it('conserva el orden de la SELECCIÓN, no el del proyecto', () => {
    const plan = planDeVolcado(seleccion(['C-3', 1], ['A-1', 1], ['B-2', 1]), [
      { sku: 'A-1', cantidad: 5 },
      { sku: 'B-2', cantidad: 5 },
      { sku: 'C-3', cantidad: 5 },
    ]);
    // La lista que el usuario va a leer es la que él fue armando.
    expect(plan.map((r) => r.sku)).toEqual(['C-3', 'A-1', 'B-2']);
  });

  it('normaliza los dos lados: un SKU en minúsculas en el proyecto NO produce un renglón «nuevo» duplicado', () => {
    const plan = planDeVolcado(seleccion(['SUJ500-F', 40]), [{ sku: 'suj500-f', cantidad: 10 }]);
    expect(plan[0].esNuevo).toBe(false);
    expect(plan[0].despues).toBe(50);
  });

  it('las partidas que NO están en la Selección se quedan fuera del plan: volcar no toca lo que no se seleccionó', () => {
    const plan = planDeVolcado(seleccion(['A-1', 1]), [
      { sku: 'A-1', cantidad: 5 },
      { sku: 'OTRO', cantidad: 999 },
    ]);
    expect(plan).toHaveLength(1);
    expect(plan.map((r) => r.sku)).not.toContain('OTRO');
  });

  it('una Selección vacía da un plan vacío, sin lanzar', () => {
    expect(planDeVolcado([], [{ sku: 'A-1', cantidad: 5 }])).toEqual([]);
  });
});

describe('[INV-B8.2] resumenDePlan', () => {
  it('cuenta nuevos y existentes por separado — es el «and say» del sum-and-say', () => {
    const plan = planDeVolcado(seleccion(['A-1', 40], ['B-2', 120], ['C-3', 7]), [{ sku: 'B-2', cantidad: 10 }]);
    expect(resumenDePlan(plan)).toEqual({ nuevos: 2, existentes: 1, piezas: 167 });
  });

  it('`piezas` son las que se AGREGAN, no el total del proyecto después', () => {
    const plan = planDeVolcado(seleccion(['A-1', 40]), [{ sku: 'A-1', cantidad: 1000 }]);
    // El proyecto quedará en 1 040; lo que este volcado aporta son 40.
    expect(resumenDePlan(plan).piezas).toBe(40);
    expect(plan[0].despues).toBe(1040);
  });
});

describe('[INV-B8.2] cargaDeVolcado', () => {
  // ============================================================
  // Lo que viaja al servidor es lo que se SELECCIONÓ y lo que se VIO — nunca
  // el total calculado en el cliente. Si `despues` se colara en el cuerpo,
  // existiría un camino donde un cliente manipulado escribe la cifra que
  // quiera pasando por «ya la sumé yo».
  // ============================================================
  it('manda `cantidad` y `cantidadVista`, y NO manda el total', () => {
    const plan = planDeVolcado(seleccion(['A-1', 40]), [{ sku: 'A-1', cantidad: 10 }]);
    const carga = cargaDeVolcado(plan);
    expect(carga).toEqual([{ sku: 'A-1', cantidad: 40, cantidadVista: 10 }]);
    expect(Object.keys(carga[0])).not.toContain('despues');
    expect(Object.keys(carga[0])).not.toContain('esNuevo');
  });
});
