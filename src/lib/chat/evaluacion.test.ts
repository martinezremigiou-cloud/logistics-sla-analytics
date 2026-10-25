// ============================================================
// [INV-B10] La puntuación de O5, probada SIN gastar un token.
//
// Es el punto de separar el conjunto y la puntuación del corredor: si el
// corredor puntuara, habría que gastar dinero para saber si el evaluador
// evalúa bien — y un evaluador que se mide a sí mismo con el mismo instrumento
// que mide el sistema no distingue un fallo suyo de uno del sistema.
// ============================================================
import { describe, it, expect } from 'vitest';
import { CASOS, puntuar, type ResultadoCaso, type CasoEvaluacion, type FormaEntrada } from './evaluacion';
import { IDS_INTENCION } from './intenciones';

const caso = (over: Partial<CasoEvaluacion> = {}): CasoEvaluacion => ({
  pregunta: 'p',
  esperado: 'llegada',
  sku: 'A-1',
  grupo: 'g',
  forma: 'frase_completa',
  ...over,
});

describe('[INV-B10] el conjunto de evaluación', () => {
  it('tiene volumen suficiente para que una tasa signifique algo', () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(30);
  });

  it('todo esperado está en el catálogo, o es `ninguna`', () => {
    const validos = new Set<string>([...IDS_INTENCION, 'ninguna']);
    for (const c of CASOS) expect(validos.has(c.esperado), c.pregunta).toBe(true);
  });

  // ============================================================
  // LAS SEIS INTENCIONES TIENEN QUE ESTAR CUBIERTAS. Un conjunto que no toca
  // una intención da una tasa alta sin haberla probado — y el número saldría
  // igual de bonito.
  // ============================================================
  it('cubre las SEIS intenciones, no solo las fáciles', () => {
    const cubiertas = new Set(CASOS.map((c) => c.esperado));
    for (const id of IDS_INTENCION) expect(cubiertas.has(id), `sin caso para «${id}»`).toBe(true);
  });

  // ============================================================
  // [INV-B11] LAS DOS DOCUMENTALES YA NO ESPERAN LO MISMO.
  //
  // Esta prueba exigía que **las dos** esperaran `ninguna`, y era correcta
  // mientras el corpus no existía: una pregunta de documento enrutada a una
  // consulta devolvería un número con cara de exacto sobre algo que nadie
  // preguntó.
  //
  // Con el corpus dentro, **se separan** — y la separación es la que importa:
  //
  //   1.4  «¿qué especificaciones tiene el SUJ500-F?»  → sobre un PRODUCTO
  //   1.5  «¿cómo funciona el software?»               → sobre el PORTAL
  //
  // El corpus tiene fichas de producto. **De sí mismo no sabe nada.** Mover las
  // dos juntas habría sido lo cómodo y habría metido al conjunto una pregunta
  // sin respuesta posible, que después habría bajado la tasa por una razón que
  // nadie encontraría.
  // ============================================================
  it('las dos documentales se separan: la de producto se contesta, la del portal no', () => {
    const doc = CASOS.filter((c) => c.grupo.includes('PO · documental'));
    expect(doc.length).toBe(2);

    const deProducto = doc.filter((c) => c.esperado === 'documental');
    const delPortal = doc.filter((c) => c.esperado === 'ninguna');
    expect(deProducto, 'la 1.4 dejó de ser contestable').toHaveLength(1);
    expect(delPortal, 'la 1.5 se movió, y el corpus no sabe del portal').toHaveLength(1);

    // Y la de producto tiene que llevar SKU: sin él no hay familia, sin familia
    // no hay puente, y sin puente no hay ficha.
    expect(deProducto[0]!.sku, 'una documental sin SKU no puede llegar a ninguna ficha').not.toBeNull();
  });

  it('un tercio largo del conjunto son preguntas donde hay que rendirse', () => {
    const ningunas = CASOS.filter((c) => c.esperado === 'ninguna');
    expect(ningunas.length).toBeGreaterThanOrEqual(6);
  });

  // ============================================================
  // Esta prueba decía «ningún caso que espera `ninguna` pide extraer un SKU», y
  // **dejó de ser cierta con razón**: un SKU pelado ES `ninguna` CON su SKU —
  // el modelo no puede elegir intención, pero sí identificó de qué se habla, y
  // el portal usa ese SKU para preguntar qué se quiere saber.
  //
  // Lo que sigue en pie es lo de siempre, acotado a su forma: una pregunta
  // FUERA DE DOMINIO no debe extraer nada.
  // ============================================================
  it('una pregunta fuera de dominio no extrae ningún SKU', () => {
    for (const c of CASOS) if (c.forma === 'fuera_de_dominio') expect(c.sku, c.pregunta).toBeNull();
  });

  // ============================================================
  // LA SEGUNDA DIMENSIÓN, y existe por un defecto que se encontró en QA manual y
  // que esta evaluación NO vio pese a dar un porcentaje altísimo: escribir `KL2722` a secas
  // contestaba «no sé contestar eso».
  //
  // La prueba de que se cubren las seis INTENCIONES era buena y no bastaba: las
  // 32 preguntas eran frases bien formadas. **Cubrir intenciones no cubre
  // formas de entrada**, y la forma que faltaba es la más común de todas — la
  // que el marcador de posición del campo pide.
  // ============================================================
  it('cubre las CINCO formas de entrada, no solo las frases bien formadas', () => {
    const TODAS: FormaEntrada[] = ['sku_pelado', 'termino_suelto', 'frase_completa', 'frase_sin_sku', 'fuera_de_dominio'];
    const cubiertas = new Set(CASOS.map((c) => c.forma));
    for (const f of TODAS) expect(cubiertas.has(f), `sin ningún caso de forma «${f}»`).toBe(true);
  });

  it('un SKU pelado espera `ninguna` CON su SKU: el portal preguntará qué saber de él', () => {
    const pelados = CASOS.filter((c) => c.forma === 'sku_pelado');
    expect(pelados.length).toBeGreaterThanOrEqual(3);
    for (const c of pelados) {
      expect(c.esperado, c.pregunta).toBe('ninguna');
      expect(c.sku, c.pregunta).toBeTruthy();
    }
  });

  it('un término suelto espera `buscar_por_nombre`: nombrar algo es pedir que lo busques', () => {
    const sueltos = CASOS.filter((c) => c.forma === 'termino_suelto');
    expect(sueltos.length).toBeGreaterThanOrEqual(3);
    for (const c of sueltos) expect(c.esperado, c.pregunta).toBe('buscar_por_nombre');
  });

  // ============================================================
  // [INV-B11] O6 · LA FORMA QUE TRAJERON LAS CONCEPTUALES.
  //
  // `frase_sin_verbo` existe porque «mis proyectos» NO cabía en
  // `termino_suelto` sin debilitar el invariante de arriba — el mismo que
  // arregló el defecto de `Clips`. Y es la forma de mayor riesgo del prompt: la
  // regla 6 manda todo nombre suelto a `buscar_por_nombre`, así que éstas son
  // las que más fácil se enrutan mal.
  //
  // Lo que esta prueba fija es que la forma **no se use como cajón de sastre**:
  // ninguna espera `buscar_por_nombre`, porque si la esperara sería un
  // `termino_suelto` y estaría mal clasificada.
  // ============================================================
  it('`frase_sin_verbo` NO es un cajón de sastre: ninguna de las suyas espera buscar', () => {
    const sinVerbo = CASOS.filter((c) => c.forma === 'frase_sin_verbo');
    expect(sinVerbo.length, 'la forma se quedó sin casos: la prueba sería vacua').toBeGreaterThanOrEqual(2);
    for (const c of sinVerbo) {
      expect(c.esperado, `«${c.pregunta}» es un término suelto disfrazado`).not.toBe('buscar_por_nombre');
      expect(c.sku, `«${c.pregunta}» no debe extraer ningún SKU`).toBeNull();
    }
  });
});

describe('[INV-B10] puntuar', () => {
  it('todo bien en todas las corridas ⇒ tasa 1', () => {
    const r: ResultadoCaso[] = [{ caso: caso(), corridas: [{ intencion: 'llegada', sku: 'A-1' }, { intencion: 'llegada', sku: 'A-1' }] }];
    const p = puntuar(r);
    expect(p.tasaIntencion).toBe(1);
    expect(p.tasaSku).toBe(1);
    expect(p.inestables).toHaveLength(0);
    expect(p.siempreMal).toHaveLength(0);
  });

  // ============================================================
  // LO QUE JUSTIFICA REPETIR: un caso que acierta la mitad de las veces da una
  // tasa del 50 % Y sale en la lista de inestables. Con una sola corrida
  // habría salido 100 % o 0 % — y las dos habrían sido mentira.
  // ============================================================
  it('un caso que alterna sale como INESTABLE, con el reparto de sus salidas', () => {
    const r: ResultadoCaso[] = [
      { caso: caso(), corridas: [{ intencion: 'llegada', sku: 'A-1' }, { intencion: 'disponibilidad', sku: 'A-1' }] },
    ];
    const p = puntuar(r);
    expect(p.tasaIntencion).toBe(0.5);
    expect(p.inestables).toHaveLength(1);
    expect(p.inestables[0]!.salidas).toEqual({ llegada: 1, disponibilidad: 1 });
    // No es «siempre mal»: acierta a veces, y eso se arregla distinto.
    expect(p.siempreMal).toHaveLength(0);
  });

  it('un caso que falla SIEMPRE se separa: es un defecto, no ruido', () => {
    const r: ResultadoCaso[] = [
      { caso: caso(), corridas: [{ intencion: 'disponibilidad', sku: null }, { intencion: 'disponibilidad', sku: null }] },
    ];
    const p = puntuar(r);
    expect(p.inestables).toHaveLength(0);
    expect(p.siempreMal).toHaveLength(1);
    expect(p.siempreMal[0]!.obtenido).toBe('disponibilidad');
  });

  // ============================================================
  // «No debe extraer SKU» NO es «da igual qué extraiga»: inventarse uno es un
  // fallo, y es la mitad del invariante «nunca completes ni corrijas un SKU».
  // ============================================================
  it('inventarse un SKU donde no debía haber ninguno cuenta como fallo', () => {
    const r: ResultadoCaso[] = [
      { caso: caso({ sku: null }), corridas: [{ intencion: 'llegada', sku: 'INVENTADO-1' }] },
    ];
    expect(puntuar(r).tasaSku).toBe(0);
  });

  // ============================================================
  // UNA TASA QUE NO SE PUEDE LOCALIZAR OBLIGA A ADIVINAR.
  //
  // `tasaSku` bajó por debajo de lo esperado en la corrida real y el reporte no decía de qué
  // casos venía: hubo que deducirlo. Y la hipótesis natural —«el modelo extrae
  // mal»— era FALSA; el fallo estaba en el corredor, que tiraba el SKU al
  // proyectar una decisión `no_soportado`. Deducir salió bien por poco.
  // ============================================================
  it('dice QUÉ caso falló el SKU y con qué salió, no solo cuántos', () => {
    const r: ResultadoCaso[] = [
      { caso: caso({ pregunta: 'bien', sku: 'A-1' }), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
      {
        caso: caso({ pregunta: 'mal', sku: 'A-1', grupo: 'g2' }),
        corridas: [
          { intencion: 'llegada', sku: 'B-2' },
          { intencion: 'llegada', sku: null },
          { intencion: 'llegada', sku: 'B-2' },
        ],
      },
    ];
    const p = puntuar(r);
    expect(p.skuMal).toHaveLength(1);
    expect(p.skuMal[0]!.pregunta).toBe('mal');
    expect(p.skuMal[0]!.grupo).toBe('g2');
    expect(p.skuMal[0]!.esperado).toBe('A-1');
    // Se DEDUPLICA: dos corridas con el mismo error son un error, y un renglón
    // repetido tres veces esconde el que sale una sola vez.
    expect(p.skuMal[0]!.obtenido.sort()).toEqual(['(ninguno)', 'B-2']);
  });

  // ============================================================
  // EL CONTROL DE LA GUARDA — la regla acordada sobre limitaciones declaradas.
  //
  // «Una limitación declarada es una HIPÓTESIS, y tiene exactamente una prueba:
  // ¿el defecto que motivó la guarda sigue pasando?»
  //
  // Para poder contestar eso hace falta saber si la guarda **se ejerció**. Un
  // 100 % en `tasaSku` sale igual si la guarda corrigió al modelo que si el
  // modelo no la necesitó — y entonces el 100 % no prueba nada sobre la guarda.
  // ============================================================
  it('cuenta las corridas donde la guarda tuvo que corregir al modelo', () => {
    const r: ResultadoCaso[] = [
      {
        caso: caso({ pregunta: '¿cuánto cuesta el A-1?', esperado: 'ninguna', sku: null, forma: 'fuera_de_dominio' }),
        corridas: [
          { intencion: 'ninguna', sku: null, guardaCorrigio: true },
          { intencion: 'ninguna', sku: null, guardaCorrigio: false },
          { intencion: 'ninguna', sku: null, guardaCorrigio: true },
        ],
      },
      {
        caso: caso({ pregunta: 'hola', esperado: 'ninguna', sku: null, forma: 'fuera_de_dominio' }),
        corridas: [{ intencion: 'ninguna', sku: null, guardaCorrigio: false }],
      },
    ];
    const p = puntuar(r);
    expect(p.guarda.corridas).toBe(2);
    expect(p.guarda.preguntas).toEqual(['¿cuánto cuesta el A-1?']);
  });

  // Y el caso que importa que sea legible: 0 no es «todo bien», es «no medido».
  it('sin ninguna corrección, la guarda queda en 0 — que es «no estuvo bajo prueba»', () => {
    const r: ResultadoCaso[] = [{ caso: caso(), corridas: [{ intencion: 'llegada', sku: 'A-1' }] }];
    const p = puntuar(r);
    expect(p.guarda.corridas).toBe(0);
    expect(p.guarda.preguntas).toEqual([]);
  });

  it('el SKU se compara normalizado, como lo resuelve el servicio', () => {
    const r: ResultadoCaso[] = [{ caso: caso({ sku: 'A-1' }), corridas: [{ intencion: 'llegada', sku: '  a-1 ' }] }];
    expect(puntuar(r).tasaSku).toBe(1);
  });

  // ============================================================
  // `tasaNoSe` se acota a FUERA DE DOMINIO, no a «esperado === ninguna», y esa
  // distinción salió de la QA: un SKU pelado también espera `ninguna` —el
  // modelo no puede elegir intención— pero **eso no es rendirse**, es
  // identificar de qué se habla. Contarlo aquí mezclaría dos cosas y movería la
  // métrica que vigila la regla #5.
  // ============================================================
  it('`tasaNoSe` se calcula SOLO sobre las preguntas fuera de dominio', () => {
    const r: ResultadoCaso[] = [
      { caso: caso({ esperado: 'ninguna', sku: null, forma: 'fuera_de_dominio' }), corridas: [{ intencion: 'ninguna', sku: null }] },
      { caso: caso({ esperado: 'ninguna', sku: null, forma: 'fuera_de_dominio' }), corridas: [{ intencion: 'llegada', sku: null }] },
      // Un SKU pelado NO cuenta aquí, aunque su esperado también sea `ninguna`.
      { caso: caso({ esperado: 'ninguna', sku: 'A-1', forma: 'sku_pelado' }), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
      // Y una frase normal tampoco, aunque acierte.
      { caso: caso(), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
    ];
    expect(puntuar(r).tasaNoSe).toBe(0.5);
  });

  it('agrupa también por FORMA: un 99,4 % global puede esconder una forma entera al 0 %', () => {
    const r: ResultadoCaso[] = [
      { caso: caso({ forma: 'frase_completa' }), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
      { caso: caso({ forma: 'sku_pelado', esperado: 'ninguna' }), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
    ];
    const p = puntuar(r);
    expect(p.porForma.find((f) => f.forma === 'frase_completa')!.tasaIntencion).toBe(1);
    expect(p.porForma.find((f) => f.forma === 'sku_pelado')!.tasaIntencion).toBe(0);
  });

  it('agrupa para que se vea QUÉ familia falla, no solo cuánto', () => {
    const r: ResultadoCaso[] = [
      { caso: caso({ grupo: 'facil' }), corridas: [{ intencion: 'llegada', sku: 'A-1' }] },
      { caso: caso({ grupo: 'dificil' }), corridas: [{ intencion: 'ninguna', sku: null }] },
    ];
    const p = puntuar(r);
    expect(p.porGrupo.find((g) => g.grupo === 'facil')!.tasaIntencion).toBe(1);
    expect(p.porGrupo.find((g) => g.grupo === 'dificil')!.tasaIntencion).toBe(0);
  });

  it('sin resultados no revienta ni inventa una tasa', () => {
    const p = puntuar([]);
    expect(p.casos).toBe(0);
    expect(p.tasaIntencion).toBe(0);
    expect(p.tasaNoSe).toBe(0);
  });
});
