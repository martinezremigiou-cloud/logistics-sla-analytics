// ============================================================
// [2.0.1-A] `construirCasosRag`, probado SIN tocar la base y SIN gastar un
// token — la misma separación que ya justifica `evaluacion.test.ts`: la
// PUNTUACIÓN (y aquí, la CONSTRUCCIÓN del conjunto) se prueba sola, y el
// corredor solo mide y le pasa el resultado.
//
// Lo que este archivo demuestra, con datos sintéticos y no con la base real:
//
//   1. Con una medición COMPLETA, el conjunto se arma entero y nadie sale
//      SIN VEREDICTO — el camino feliz que mide el corredor de evaluación
//      contra el snapshot vigente.
//   2. Cuando una condición DERIVADA (E2/E3/E4) no encuentra sujeto, ESE caso
//      —y SOLO ese— sale SIN VEREDICTO y `derivacionRota` se enciende: es la
//      guarda del control positivo obligatorio (P17 aplicado al propio
//      conjunto), y esta prueba es la demostración de que SÍ puede ponerse
//      ROJA (P19) — no una guarda que solo puede salir verde.
//   3. Cuando el documento de un caso de CONTENIDO deja de estar vivo en el
//      corpus, ESE caso sale SIN VEREDICTO sin tocar `derivacionRota`: es una
//      clase de fallo distinta y el reporte las separa.
//   4. D5 tiene su propia condición (la trampa textual «SERIES 2 48»), y
//      cuando deja de sostenerse, D5 —y solo D5— sale SIN VEREDICTO.
// ============================================================
import { describe, it, expect } from 'vitest';
import { CASOS_RAG_ANCLADOS, construirCasosRag, type MedicionSujetosRag } from './evaluacion-rag';

/**
 * Los fragmentos de `fichaEsperada` que de verdad usan los casos AUTOMÁTICOS
 * de contenido (excluyendo D5, que no tiene `fichaEsperada`). Se leen del
 * propio conjunto para que esta prueba no diverja si algún día cambian.
 */
const FICHAS_DE_CONTENIDO_AUTOMATICO = Array.from(
  new Set(
    CASOS_RAG_ANCLADOS.filter((c) => c.id !== 'D5' && c.puntuacion === 'automatico' && c.fichaEsperada).map((c) => c.fichaEsperada!),
  ),
);

/** Una medición donde TODO existe — el camino feliz. */
function medicionCompleta(): MedicionSujetosRag {
  return {
    familiaConFichaViva: { sku: 'SKU-FICHA-1', familia: 'FAMILIA FICHA', titulo: 'Título Ficha Viva' },
    familiaSinPuenteConHallazgo: { sku: 'SKU-HALLAZGO-1', familia: 'FAMILIA HALLAZGO', tituloHallado: 'Documento Hallado' },
    familiaSinPuenteSinHallazgo: { sku: 'SKU-CALLEJON-1', familia: 'FAMILIA CALLEJÓN' },
    trampaSigueSinFicha: true,
    rutasConTrozos: FICHAS_DE_CONTENIDO_AUTOMATICO,
  };
}

describe('[2.0.1-A] construirCasosRag — camino feliz', () => {
  it('con todo medido, arma los anclados + los 3 derivados, y nadie sale SIN VEREDICTO', () => {
    const { casos, sinVeredicto, derivacionRota } = construirCasosRag(medicionCompleta());
    expect(sinVeredicto).toHaveLength(0);
    expect(derivacionRota).toBe(false);
    expect(casos.length).toBe(CASOS_RAG_ANCLADOS.length + 3); // + E2, E3, E4
    expect(casos.some((c) => c.id === 'E2')).toBe(true);
    expect(casos.some((c) => c.id === 'E3')).toBe(true);
    expect(casos.some((c) => c.id === 'E4')).toBe(true);
    expect(casos.some((c) => c.id === 'D5')).toBe(true);
  });

  it('el caso E2 derivado se arma CON el sujeto medido, no con uno horneado', () => {
    const { casos } = construirCasosRag(medicionCompleta());
    const e2 = casos.find((c) => c.id === 'E2')!;
    expect(e2.pregunta).toContain('SKU-FICHA-1');
    expect(e2.fichaEsperada).toBe('Título Ficha Viva');
    expect(e2.mide).toContain('FAMILIA FICHA');
  });

  it('el caso E4 derivado nace `juicio`: el callejón real no se autopuntúa', () => {
    const { casos } = construirCasosRag(medicionCompleta());
    const e4 = casos.find((c) => c.id === 'E4')!;
    expect(e4.puntuacion).toBe('juicio');
  });
});

describe('[2.0.1-A] construirCasosRag — P19: la guarda SÍ se pone roja', () => {
  it('si NINGUNA familia tiene puente con ficha viva, E2 sale SIN VEREDICTO y enciende `derivacionRota`', () => {
    const m = { ...medicionCompleta(), familiaConFichaViva: null };
    const { casos, sinVeredicto, derivacionRota } = construirCasosRag(m);
    expect(casos.some((c) => c.id === 'E2')).toBe(false);
    expect(sinVeredicto.map((s) => s.id)).toContain('E2');
    expect(derivacionRota).toBe(true);
    // Y los OTROS derivados, que SÍ tenían sujeto, se corren igual — un hueco
    // en una condición no debe tapar a las que sí midieron.
    expect(casos.some((c) => c.id === 'E3')).toBe(true);
  });

  it('si ninguna familia sin puente cae a hallazgos, E3 sale SIN VEREDICTO y enciende `derivacionRota`', () => {
    const m = { ...medicionCompleta(), familiaSinPuenteConHallazgo: null };
    const { sinVeredicto, derivacionRota } = construirCasosRag(m);
    expect(sinVeredicto.map((s) => s.id)).toContain('E3');
    expect(derivacionRota).toBe(true);
  });

  it('si ninguna familia sin puente es un callejón real, E4 sale SIN VEREDICTO y enciende `derivacionRota`', () => {
    const m = { ...medicionCompleta(), familiaSinPuenteSinHallazgo: null };
    const { sinVeredicto, derivacionRota } = construirCasosRag(m);
    expect(sinVeredicto.map((s) => s.id)).toContain('E4');
    expect(derivacionRota).toBe(true);
  });

  it('las TRES condiciones rotas a la vez producen TRES entradas en `sinVeredicto`, no una', () => {
    const m: MedicionSujetosRag = {
      ...medicionCompleta(),
      familiaConFichaViva: null,
      familiaSinPuenteConHallazgo: null,
      familiaSinPuenteSinHallazgo: null,
    };
    const { sinVeredicto, derivacionRota } = construirCasosRag(m);
    expect(sinVeredicto.map((s) => s.id).sort()).toEqual(['E2', 'E3', 'E4']);
    expect(derivacionRota).toBe(true);
  });
});

describe('[2.0.1-A] construirCasosRag — el contenido que dejó de estar vivo', () => {
  it('un caso de CONTENIDO cuya ficha ya no está en el corpus sale SIN VEREDICTO, y NO enciende `derivacionRota`', () => {
    const m = { ...medicionCompleta(), rutasConTrozos: FICHAS_DE_CONTENIDO_AUTOMATICO.filter((f) => f !== 'Series12-UR63') };
    const { casos, sinVeredicto, derivacionRota } = construirCasosRag(m);
    // Todos los casos anclados a Series12-UR63 (A1, B1, B2, B4) desaparecen del conjunto...
    const idsSeries12 = CASOS_RAG_ANCLADOS.filter((c) => c.fichaEsperada === 'Series12-UR63').map((c) => c.id);
    expect(idsSeries12.length).toBeGreaterThan(0);
    for (const id of idsSeries12) {
      expect(casos.some((c) => c.id === id)).toBe(false);
      expect(sinVeredicto.map((s) => s.id)).toContain(id);
    }
    // ...pero esto es un hueco de CONTENIDO, no de DERIVACIÓN.
    expect(derivacionRota).toBe(false);
  });

  it('con todo el corpus vivo, ningún caso de contenido automático sale SIN VEREDICTO', () => {
    const { sinVeredicto } = construirCasosRag(medicionCompleta());
    const idsContenido = CASOS_RAG_ANCLADOS.filter((c) => c.id !== 'D5' && c.puntuacion === 'automatico' && c.fichaEsperada).map(
      (c) => c.id,
    );
    for (const id of idsContenido) expect(sinVeredicto.map((s) => s.id)).not.toContain(id);
  });
});

describe('[2.0.1-A] construirCasosRag — D5 y su propia condición', () => {
  it('mientras «SERIES 2 48» siga sin ficha alcanzable, D5 se corre', () => {
    const { casos, sinVeredicto } = construirCasosRag(medicionCompleta());
    expect(casos.some((c) => c.id === 'D5')).toBe(true);
    expect(sinVeredicto.map((s) => s.id)).not.toContain('D5');
  });

  it('si «SERIES 2 48» consigue ficha, D5 sale SIN VEREDICTO y NO enciende `derivacionRota`', () => {
    const m = { ...medicionCompleta(), trampaSigueSinFicha: false };
    const { casos, sinVeredicto, derivacionRota } = construirCasosRag(m);
    expect(casos.some((c) => c.id === 'D5')).toBe(false);
    expect(sinVeredicto.map((s) => s.id)).toContain('D5');
    expect(derivacionRota).toBe(false);
  });
});
