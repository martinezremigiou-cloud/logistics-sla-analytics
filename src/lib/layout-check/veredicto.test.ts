// ============================================================
// [2.0.1-A] O0 · veredicto.test.ts — el exit code es EL contrato del
// instrumento, así que cada regla se demuestra en las DOS direcciones
// (P19/P21: una condición que nunca dio ambos resultados está redactada,
// no comprobada). Aquí viven los casos que hacen imposible el verde
// vacuo: control no denunciado, control denunciado por OTRA aserción,
// derivación que perdió rutas, y el «0 violaciones con huecos».
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Medicion, Violacion } from './predicados';
import { veredicto, type OpcionesVeredicto, type PlantadoEsperado, type ResultadoCaso } from './veredicto';

function medicion(overrides: Partial<Medicion> = {}): Medicion {
  return {
    violaciones: [],
    solapesPermitidos: [],
    truncadosLegibles: 0,
    navsMedidos: 1,
    navsVisibles: 1,
    flotantesMedidos: 1,
    controlesRecortados: 0,
    asomanParcialmente: 0,
    recortadosPorCajaCero: 0,
    interactivosMedidosA1c: 3,
    cajasCeroA1a: 0,
    elementosRecorridos: 100,
    ...overrides,
  };
}
function caso(overrides: Partial<ResultadoCaso> = {}): ResultadoCaso {
  return {
    ruta: '/catalogo',
    url: '/catalogo',
    estado: 'base',
    ancho: 1280,
    alto: 720,
    resultado: 'MEDIDO',
    medicion: medicion(),
    ...overrides,
  };
}
function violacion(overrides: Partial<Violacion> = {}): Violacion {
  return { tipo: 'a1_truncado_ilegible', detalle: 'x', plantado: null, ...overrides };
}
/** Control SANO: los tres plantados denunciados por SU aserción + la excepción ejercida. */
function casoControlSano(): ResultadoCaso {
  return caso({
    ruta: '/control-layout',
    url: '/control-layout',
    medicion: medicion({
      violaciones: [
        violacion({ tipo: 'a1_truncado_ilegible', plantado: 'a1' }),
        violacion({ tipo: 'a2_nav_aplastado', plantado: 'a2' }),
        violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3' }),
      ],
      solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'par plantado permitido' }],
    }),
  });
}
// ============================================================
// [C-DASH·13] EL PLANTADO QUE SOLO DEBE DENUNCIARSE EN UN ESTADO.
//
// El eje del sidebar tiene dos regímenes, y el defecto que el gate debe cazar
// —una caja recortada por un ancestro— solo existe en UNO de los dos: el
// control plantado mide 460 px menos el ancho del `<aside>`, así que con el
// sidebar EXPANDIDO recorta su enlace y colapsado no.
//
// Un control que solo se comprobara en la dirección «denunciado» no probaría
// nada sobre el otro régimen: pasaría igual con un predicado que denuncia
// SIEMPRE. Por eso el contrato es de DOS direcciones, y esta es la mitad que
// faltaba en el veredicto.
// ============================================================
describe('[C-DASH·13] plantado acotado: denunciado en todos los estados MENOS uno, donde calla', () => {
  function esperadosConEje(): PlantadoEsperado[] {
    return [
      { marca: 'a1', tipo: 'a1_truncado_ilegible' },
      { marca: 'a2', tipo: 'a2_nav_aplastado' },
      { marca: 'a3', tipo: 'a3_solape_flotantes' },
      { marca: 'a5', tipo: 'a1_recortado_por_ancestro', calladoEnEstado: 'sidebar-colapsado' },
    ];
  }
  /** El control en `base`: los tres de siempre MÁS el del eje, que aquí sí debe caer. */
  function controlEnBase(conA5: boolean): ResultadoCaso {
    const v = [
      violacion({ tipo: 'a1_truncado_ilegible', plantado: 'a1' }),
      violacion({ tipo: 'a2_nav_aplastado', plantado: 'a2' }),
      violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3' }),
    ];
    if (conA5) v.push(violacion({ tipo: 'a1_recortado_por_ancestro', plantado: 'a5' }));
    return caso({
      ruta: '/control-layout',
      url: '/control-layout',
      estado: 'base',
      medicion: medicion({ violaciones: v, solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'par plantado permitido' }] }),
    });
  }
  /** El control en el OTRO régimen: los tres de siempre, y a5 CALLADO. */
  function controlColapsado(conA5: boolean): ResultadoCaso {
    const v = [
      violacion({ tipo: 'a1_truncado_ilegible', plantado: 'a1' }),
      violacion({ tipo: 'a2_nav_aplastado', plantado: 'a2' }),
      violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3' }),
    ];
    if (conA5) v.push(violacion({ tipo: 'a1_recortado_por_ancestro', plantado: 'a5' }));
    return caso({
      ruta: '/control-layout',
      url: '/control-layout',
      estado: 'sidebar-colapsado',
      medicion: medicion({ violaciones: v, solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'par plantado permitido' }] }),
    });
  }

  it('los DOS regímenes correctos → exit 0', () => {
    const v = veredicto([controlEnBase(true), controlColapsado(false)], opts({ plantadosEsperados: esperadosConEje() }));
    expect(v.codigo, v.lineas.join(' | ')).toBe(0);
  });

  it('no denunciado donde SÍ debe → SIN VEREDICTO (el predicado dejó de ver)', () => {
    const v = veredicto([controlEnBase(false), controlColapsado(false)], opts({ plantadosEsperados: esperadosConEje() }));
    expect(v.codigo).toBe(2);
    expect(v.lineas.join(' ')).toContain('a5');
  });

  it('denunciado en el estado donde debe CALLAR → SIN VEREDICTO (el predicado mide de más)', () => {
    // Esta es la mitad que hace al control no-vacuo: sin ella, un predicado que
    // denunciara SIEMPRE pasaría el control con nota.
    const v = veredicto([controlEnBase(true), controlColapsado(true)], opts({ plantadosEsperados: esperadosConEje() }));
    expect(v.codigo).toBe(2);
    expect(v.lineas.join(' ')).toContain('donde debe callar');
  });

  it('ANTI-VACUIDAD · si el control nunca se midió en los DOS estados, el contrato no se ejerció → SIN VEREDICTO', () => {
    // Un plantado acotado cuyo estado «callado» nunca se visitó es una condición
    // que jamás dio los dos resultados: está redactada, no comprobada (P21).
    const v = veredicto([controlEnBase(true)], opts({ plantadosEsperados: esperadosConEje() }));
    expect(v.codigo).toBe(2);
    expect(v.lineas.join(' ')).toContain('nunca se midió');
  });
});

function opts(overrides: Partial<OpcionesVeredicto> = {}): OpcionesVeredicto {
  return {
    archivosPagina: 2,
    rutasDerivadas: 2,
    rutaControl: '/control-layout',
    nombresSolapeConocidos: ['control-permitido'],
    plantadosEsperados: [
      { marca: 'a1', tipo: 'a1_truncado_ilegible' },
      { marca: 'a2', tipo: 'a2_nav_aplastado' },
      { marca: 'a3', tipo: 'a3_solape_flotantes' },
    ],
    solapePermitidoDelControl: 'control-permitido',
    plantadosSilenciosos: ['a3-fantasma'],
    ...overrides,
  };
}

describe('[2.0.1-A] veredicto — exit 0 solo con todo medido y el control denunciado', () => {
  it('VERDE (0): casos limpios + control sano', () => {
    const v = veredicto([caso(), casoControlSano()], opts());
    expect(v.codigo).toBe(0);
    expect(v.lineas.some((l) => l.includes('VEREDICTO: VERDE'))).toBe(true);
  });

  it('ROJO (1): violación real con control sano — y la lista POR CASO la nombra', () => {
    const conViolacion = caso({
      medicion: medicion({ violaciones: [violacion({ detalle: 'sku a 27px en caja de 27px' })] }),
    });
    const v = veredicto([conViolacion, casoControlSano()], opts());
    expect(v.codigo).toBe(1);
    expect(v.lineas.some((l) => l.includes('sku a 27px'))).toBe(true);
  });

  it('SIN VEREDICTO (2): control con un plantado NO denunciado — el verde sería el troceador que no troceaba', () => {
    const controlRoto = casoControlSano();
    controlRoto.medicion = medicion({
      violaciones: [
        violacion({ tipo: 'a1_truncado_ilegible', plantado: 'a1' }),
        violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3' }),
        // falta a2
      ],
      solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'x' }],
    });
    const v = veredicto([caso(), controlRoto], opts());
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('«a2» NO denunciado'))).toBe(true);
  });

  it('SIN VEREDICTO (2): plantado denunciado por OTRA aserción — caer no basta, tiene que caer por SU razón (P25-C)', () => {
    const controlCruzado = casoControlSano();
    controlCruzado.medicion = medicion({
      violaciones: [
        violacion({ tipo: 'a3_solape_flotantes', plantado: 'a1' }), // a1 cazado por a3
        violacion({ tipo: 'a2_nav_aplastado', plantado: 'a2' }),
        violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3' }),
      ],
      solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'x' }],
    });
    const v = veredicto([caso(), controlCruzado], opts());
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('no por SU aserción'))).toBe(true);
  });

  it('SIN VEREDICTO (2): 0 violaciones pero un caso SIN MEDIR — cero y no-medido son valores distintos', () => {
    const hueco = caso({ resultado: 'SIN_MEDIR', motivoSinMedir: 'no se pudo abrir el panel', medicion: undefined });
    const v = veredicto([hueco, casoControlSano()], opts());
    expect(v.codigo).toBe(2);
  });

  it('ROJO (1) domina sobre los huecos cuando el instrumento está sano: violación medida + caso sin medir', () => {
    const conViolacion = caso({ medicion: medicion({ violaciones: [violacion()] }) });
    const hueco = caso({ ruta: '/cruce', resultado: 'SIN_MEDIR', motivoSinMedir: 'timeout', medicion: undefined });
    const v = veredicto([conViolacion, hueco, casoControlSano()], opts());
    expect(v.codigo).toBe(1);
    expect(v.lineas.some((l) => l.includes('rojo es parcial'))).toBe(true);
  });

  it('SIN VEREDICTO (2) DOMINA sobre el rojo si la derivación perdió rutas — un instrumento inválido tampoco acusa', () => {
    const conViolacion = caso({ medicion: medicion({ violaciones: [violacion()] }) });
    const v = veredicto([conViolacion, casoControlSano()], opts({ archivosPagina: 5, rutasDerivadas: 3 }));
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('P17'))).toBe(true);
  });

  it('SIN VEREDICTO (2): 0 casos', () => {
    const v = veredicto([], opts({ archivosPagina: 0, rutasDerivadas: 0 }));
    expect(v.codigo).toBe(2);
  });

  it('SIN VEREDICTO (2): ninguna corrida midió la ruta de control', () => {
    const v = veredicto([caso()], opts());
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('sin su control positivo'))).toBe(true);
  });

  it('SIN VEREDICTO (2): la excepción de solape declarada nunca se ejerció en el control (P25-B: la limitación volvió a hipótesis)', () => {
    const controlSinExcepcion = casoControlSano();
    controlSinExcepcion.medicion = medicion({
      violaciones: controlSinExcepcion.medicion!.violaciones,
      solapesPermitidos: [], // el par permitido no se registró
    });
    const v = veredicto([caso(), controlSinExcepcion], opts());
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('nunca se ejerció'))).toBe(true);
  });

  it('ROJO (1): un data-solape-permitido con nombre NO registrado es hallazgo, no permiso — la lista no crece en silencio', () => {
    const conPermisoPirata = caso({
      medicion: medicion({ solapesPermitidos: [{ nombre: 'invento-nuevo', detalle: 'x' }] }),
    });
    const v = veredicto([conPermisoPirata, casoControlSano()], opts());
    expect(v.codigo).toBe(1);
    expect(v.lineas.some((l) => l.includes('invento-nuevo'))).toBe(true);
  });

  it('SIN VEREDICTO (2): un plantado SILENCIOSO denunciado — el instrumento mide de más y tampoco puede absolver', () => {
    // El caso que este bloque se encontró a sí mismo: A3 denunciando controles
    // scrolleados fuera de vista (rect geométrico, área tocable inexistente).
    const controlQueMideDeMas = casoControlSano();
    controlQueMideDeMas.medicion = medicion({
      violaciones: [
        ...controlQueMideDeMas.medicion!.violaciones,
        violacion({ tipo: 'a3_solape_flotantes', plantado: 'a3-fantasma', detalle: 'par recortado denunciado' }),
      ],
      solapesPermitidos: [{ nombre: 'control-permitido', detalle: 'x' }],
    });
    const v = veredicto([caso(), controlQueMideDeMas], opts());
    expect(v.codigo).toBe(2);
    expect(v.lineas.some((l) => l.includes('SILENCIOSO «a3-fantasma»'))).toBe(true);
  });

  it('VERDE (0) con el plantado silencioso NO denunciado: la ausencia de esa violación es la que se exige', () => {
    // La otra dirección (P21): la regla anterior tiene que poder dar verde, o
    // sería una condición que nunca pasa.
    const v = veredicto([caso(), casoControlSano()], opts());
    expect(v.codigo).toBe(0);
  });

  it('el resumen reporta la LISTA POR CASO además del agregado (casos · medidos · sin medir · violaciones)', () => {
    const v = veredicto([caso(), casoControlSano()], opts());
    expect(v.lineas.some((l) => l.startsWith('casos: 2'))).toBe(true);
    expect(v.lineas.some((l) => l.startsWith('[SIN VIOLACIONES] /catalogo'))).toBe(true);
    expect(v.lineas.some((l) => l.startsWith('[CONTROL OK] /control-layout'))).toBe(true);
  });

  it('el rótulo por caso NO dice «OK»: dice qué se comprobó, no que la pantalla esté bien', () => {
    // Este renglón se imprimió cientos de veces en una corrida cuyo veredicto era
    // SIN VEREDICTO, y así fue como esa corrida se narró —por quien la leyó y por la
    // cadena— como «todos medidos con 0 violaciones». La etiqueta era el
    // mecanismo: «OK» es un juicio sobre el caso, y lo único que este renglón
    // sabe es que ninguna aserción disparó.
    const v = veredicto([caso(), casoControlSano()], opts());
    expect(v.lineas.some((l) => l.startsWith('[OK] '))).toBe(false);
  });

  it('el renglón por caso publica los DOS contadores que distinguen una pantalla de una tarjeta de permiso', () => {
    // `nodos` es el que separa la pantalla real de un `Card` de «sin permiso»
    // (~10 nodos): con rol insuficiente, /proyectos y /carga devuelven eso, y
    // con los tres números de antes —truncados, navs, flotantes, los tres
    // dominados por el shell— eran indistinguibles en el log. una parte de los
    // casos de esa corrida fueron exactamente eso y nadie pudo verlo.
    const v = veredicto(
      [caso({ medicion: medicion({ elementosRecorridos: 11, controlesRecortados: 3, navsMedidos: 1, navsVisibles: 2 }) }), casoControlSano()],
      opts(),
    );
    const linea = v.lineas.find((l) => l.startsWith('[SIN VIOLACIONES] '))!;
    expect(linea).toContain('nodos 11');
    expect(linea).toContain('recortados 3');
    // Y `navs 1/2` dice en voz alta «hay una región de navegación que NO
    // aseveré»: el `navs 1` de antes era indistinguible de «solo hay una».
    expect(linea).toContain('navs 1/2');
  });
});
