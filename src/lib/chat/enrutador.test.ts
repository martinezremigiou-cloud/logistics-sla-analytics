// ============================================================
// [INV-B10] El catálogo y el enrutador, probados SIN modelo y SIN base.
//
// Que esto sea posible es el punto del diseño: toda la variabilidad del modelo
// queda confinada a una frontera —el JSON que devuelve— y de ahí hacia dentro
// todo es determinista. Un chat que solo se puede probar hablándole no se
// puede probar.
// ============================================================
import { describe, it, expect } from 'vitest';
import { INTENCIONES, IDS_INTENCION, definicionDe, loQueSabeHacer, sugerencias } from './intenciones';
import { enrutar, salidaModeloSchema, NINGUNA } from './enrutador';

describe('[INV-B10] el catálogo de intenciones', () => {
  it('no está vacío: si lo estuviera, todo lo de abajo pasaría por vacuidad (P17)', () => {
    expect(INTENCIONES.length).toBeGreaterThanOrEqual(6);
    expect(IDS_INTENCION.length).toBe(INTENCIONES.length);
  });

  it('los identificadores no se repiten', () => {
    expect(new Set(IDS_INTENCION).size).toBe(IDS_INTENCION.length);
  });

  // ============================================================
  // LA CONDICIÓN ACORDADA: «si alguien agrega una sugerencia sin intención
  // detrás, que salga rojo». Por construcción no se puede —la sugerencia vive
  // DENTRO de la intención— así que lo que se prueba es la otra mitad: que
  // ninguna intención se quede MUDA en el zero-state. Una intención sin
  // sugerencia existe y nadie la descubre nunca.
  // ============================================================
  it('el zero-state ofrece TODAS menos `capacidades`, que es la respuesta del propio zero-state', () => {
    // [INV-B11] O6 · antes esto exigía que el zero-state ofreciera las SIETE.
    // Con `capacidades` dentro del catálogo eso dejó de ser lo correcto: un chip
    // «¿Qué puedes hacer?» **dentro de la lista de lo que puede hacer** es
    // circular, y le costaría al usuario una pregunta del techo para que le
    // repitan lo que está leyendo.
    //
    // La exclusión se comprueba POR NOMBRE, no por conteo: `toHaveLength(n - 1)`
    // se quedaría verde si mañana se cayera otra distinta y entrara ésta.
    const s = sugerencias();
    const ofrecidas = s.map((x) => x.intencion).sort();
    const esperadas = INTENCIONES.map((i) => i.id).filter((id) => id !== 'capacidades').sort();
    expect(ofrecidas, 'el zero-state dejó de ofrecer una intención, o empezó a ofrecer `capacidades`').toEqual(
      esperadas,
    );
    for (const x of s) expect(x.texto.trim().length, `«${x.intencion}» sin sugerencia`).toBeGreaterThan(0);

    // Y `capacidades` SÍ tiene sugerencia aunque no se ofrezca: es el texto que
    // se pinta como título de su propia tarjeta. Sin esto, alguien podría
    // «arreglar» la exclusión dejándola sin sugerencia y nada se quejaría.
    const cap = INTENCIONES.find((i) => i.id === 'capacidades');
    expect(cap?.sugerencia.texto, '`capacidades` se quedó sin su pregunta').toBe('¿Qué puedes hacer?');
    expect(IDS_INTENCION.length).toBe(INTENCIONES.length);
  });

  // ============================================================
  // EL ATAJO DE LAS SUGERENCIAS (adición al avance 2): un clic en un
  // chip NO llama al modelo, porque su destino ya está escrito en el chip. Para
  // que eso sea posible, la sugerencia tiene que describirse ENTERA: si una
  // intención que exige SKU trajera un texto con un SKU dentro pero no el
  // parámetro, el atajo pediría aclaración sobre su propia sugerencia.
  // ============================================================
  it('toda sugerencia de una intención que exige SKU trae su SKU como PARÁMETRO', () => {
    for (const i of INTENCIONES) {
      if (!i.requiereSku) continue;
      expect(i.sugerencia.sku, `«${i.id}» sugiere un SKU en el texto pero no lo pasa como parámetro`).toBeTruthy();
    }
  });

  it('la sugerencia de buscar trae su término, y sin artículo', () => {
    const buscar = INTENCIONES.find((i) => i.id === 'buscar_por_nombre')!;
    expect(buscar.sugerencia.termino).toBe('CLIPS');
  });

  it('las que no exigen SKU no lo llevan: un parámetro de más es una consulta distinta', () => {
    for (const i of INTENCIONES) {
      if (i.requiereSku) continue;
      expect(i.sugerencia.sku, i.id).toBeNull();
    }
  });

  it('cada intención se explica en palabras de vendedor, sin jerga vacía', () => {
    for (const i of INTENCIONES) {
      expect(i.descripcion.trim().length, i.id).toBeGreaterThan(20);
      expect(i.fuente.trim().length, i.id).toBeGreaterThan(0);
    }
  });

  // Las tres del brief exigen SKU; las tres que salieron de la maqueta, no.
  // ============================================================
  // LA LISTA VA EXPLÍCITA Y NO COMO PROPIEDAD, Y ES DELIBERADO.
  //
  // Se podría escribir «hay al menos una de cada tipo» y nunca volver a
  // tocarla. Pero entonces agregar una intención pasaría en silencio, y el
  // reparto con/sin SKU **no es un detalle**: es lo que arregló el P7 del
  // zero-state en B10 —un catálogo de solo-con-SKU habría anunciado sugerencias
  // que el sistema no sabía contestar—.
  //
  // Escrita a mano, agregar una intención OBLIGA a mirar aquí y decidir de qué
  // lado va. Que esta prueba se ponga roja al crecer el catálogo es la función,
  // no el costo. [INV-B11] la puso roja al llegar `documental`, y así se supo.
  // ============================================================
  it('cuatro exigen SKU y SIETE no — y las cuatro nuevas son sobre el sistema, no sobre un producto', () => {
    // [INV-B11] O6 · el reparto cambió de 4/3 a 4/7, y el lado que creció dice
    // qué faltaba: **las que exigen SKU siguen siendo las mismas cuatro**. Lo
    // que el enrutador no tenía no era otra pregunta sobre un producto — era la
    // categoría entera de preguntas que no van sobre un producto.
    const conSku = INTENCIONES.filter((i) => i.requiereSku).map((i) => i.id);
    const sinSku = INTENCIONES.filter((i) => !i.requiereSku).map((i) => i.id);
    expect(conSku, 'cambió el conjunto de las que necesitan un SKU resuelto').toEqual([
      'llegada',
      'disponibilidad',
      'clasificacion',
      'documental',
    ]);
    expect(sinSku).toEqual([
      'pipeline',
      'sobre_reservados',
      'buscar_por_nombre',
      'capacidades',
      'destacado_hoy',
      'mis_proyectos',
      'snapshots_recientes',
    ]);
  });

  it('`loQueSabeHacer` enumera TODAS: un «no sé» que omite una deja al usuario adivinando', () => {
    expect(loQueSabeHacer()).toHaveLength(INTENCIONES.length);
  });

  it('`definicionDe` devuelve `undefined` fuera del catálogo, no lanza', () => {
    expect(definicionDe('precio')).toBeUndefined();
    expect(definicionDe('llegada')?.id).toBe('llegada');
  });
});

const bueno = { intencion: 'llegada', sku: 'SUJ500-F', termino: null };

describe('[INV-B10] el enrutador · la salida reconocida', () => {
  it('una intención del catálogo se enruta con sus parámetros intactos', () => {
    const d = enrutar(bueno, '¿cuándo llega el SUJ500-F?');
    expect(d.tipo).toBe('intencion');
    if (d.tipo !== 'intencion') return;
    expect(d.intencion).toBe('llegada');
    expect(d.sku).toBe('SUJ500-F');
    expect(d.termino).toBeNull();
  });

  it('NO resuelve el SKU: solo lo transporta', () => {
    // Un SKU que no existe pasa igual. Resolverlo necesita la base, y esa
    // separación es lo que deja al enrutador probable sin ella.
    const d = enrutar({ ...bueno, sku: 'NO-EXISTE-JAMAS' }, '¿cuándo llega el NO-EXISTE-JAMAS?');
    expect(d.tipo).toBe('intencion');
    if (d.tipo === 'intencion') expect(d.sku).toBe('NO-EXISTE-JAMAS');
  });

  it('`sku` ausente NO es un fallo: la resolución 0/1/N ocurre después', () => {
    const d = enrutar({ intencion: 'pipeline', sku: null, termino: null }, '¿qué hay en aduana?');
    expect(d.tipo).toBe('intencion');
    if (d.tipo === 'intencion') expect(d.sku).toBeNull();
  });

  it('recorta los espacios de lo que el modelo devuelva', () => {
    const d = enrutar({ intencion: 'buscar_por_nombre', sku: null, termino: '  CLIPS  ' }, 'busca los CLIPS');
    if (d.tipo === 'intencion') expect(d.termino).toBe('CLIPS');
  });
});

// ============================================================
// LA OTRA SALIDA. Aquí es donde vive el «no improvisa, no se acerca».
// ============================================================
describe('[INV-B10] el enrutador · «no sé hacer eso»', () => {
  it('cuando el modelo se rinde, el motivo lo dice y se enumera lo que sí sabe', () => {
    const d = enrutar({ intencion: NINGUNA, sku: null, termino: null }, '¿cuál es la capital de Francia?');
    expect(d.tipo).toBe('no_soportado');
    if (d.tipo !== 'no_soportado') return;
    expect(d.motivo).toBe('fuera_del_catalogo');
    expect(d.sabeHacer).toHaveLength(INTENCIONES.length);
  });

  // ============================================================
  // Un modelo que INVENTA una intención no es lo mismo que uno que se rinde, y
  // los dos motivos se distinguen a propósito: el primero es telemetría de que
  // el modelo se está saliendo del contrato; el segundo es que funcionó.
  // Al usuario le decimos lo mismo; al registro, no.
  // ============================================================
  it('una intención INVENTADA no se aproxima a la más parecida: se rechaza', () => {
    const d = enrutar({ intencion: 'precio', sku: 'SUJ500-F', termino: null }, '¿cuánto cuesta el SUJ500-F?');
    expect(d.tipo).toBe('no_soportado');
    if (d.tipo === 'no_soportado') expect(d.motivo).toBe('respuesta_ilegible');
  });

  // ============================================================
  // NOMBRAR ≠ PREGUNTAR. Las dos entradas producen `{ninguna, sku}` del modelo
  // y **tienen que separarse aquí**, porque el prompt no lo garantiza: medido en
  // la 3ª corrida de O5, con la regla 5 puesta, el modelo mandó el SKU en
  // «¿cuánto cuesta el SUJ500-F?» y «dame de baja el SUJ500-F» las 5 de 5 veces.
  //
  // Si no se separaran, esas dos dejarían de recibir el «no sé» que ENUMERA y
  // recibirían tres botones: **la negativa desaparece** y el usuario nunca se
  // entera de que de precios no sé. Regla #5 por la puerta de atrás.
  // ============================================================
  const soloElNombre = ['KL2722', '  KL2722  ', '¿KL2722?', 'el KL2722', 'los KL2722'];
  for (const pregunta of soloElNombre) {
    it(`«${pregunta}» es NOMBRAR: sale como falta_verbo y lleva el SKU`, () => {
      const d = enrutar({ intencion: NINGUNA, sku: 'KL2722', termino: null }, pregunta);
      expect(d.tipo).toBe('no_soportado');
      if (d.tipo !== 'no_soportado') return;
      expect(d.motivo).toBe('falta_verbo');
      expect(d.sku).toBe('KL2722');
    });
  }

  const conPregunta = [
    '¿cuánto cuesta el KL2722?',
    'dame de baja el KL2722',
    '¿qué especificaciones técnicas tiene el KL2722?',
    'KL2722 cuánto cuesta',
  ];
  for (const pregunta of conPregunta) {
    it(`«${pregunta}» es PREGUNTAR: sigue siendo el «no sé» que enumera`, () => {
      const d = enrutar({ intencion: NINGUNA, sku: 'KL2722', termino: null }, pregunta);
      expect(d.tipo).toBe('no_soportado');
      if (d.tipo !== 'no_soportado') return;
      expect(d.motivo).toBe('fuera_del_catalogo');
      expect(d.sabeHacer).toHaveLength(INTENCIONES.length);
    });
  }

  // El sesgo, escrito como prueba: si el modelo manda un SKU que **no** es lo
  // que el usuario escribió, no se le cree. Perder un `elegir_intencion` cuesta
  // un «no sé» de más; ganarlo de más cuesta una negativa que desaparece.
  it('un SKU que no coincide con lo escrito NO abre los botones', () => {
    const d = enrutar({ intencion: NINGUNA, sku: 'KL2722', termino: null }, 'SUJ500-F');
    expect(d.tipo).toBe('no_soportado');
    if (d.tipo === 'no_soportado') expect(d.motivo).toBe('fuera_del_catalogo');
  });

  const basura: [string, unknown][] = [
    ['null', null],
    ['una cadena', 'llegada'],
    ['un arreglo', ['llegada']],
    ['objeto vacío', {}],
    ['sin `sku`', { intencion: 'llegada', termino: null }],
    ['`sku` numérico', { intencion: 'llegada', sku: 42, termino: null }],
    ['`sku` vacío', { intencion: 'llegada', sku: '', termino: null }],
    ['`sku` larguísimo', { intencion: 'llegada', sku: 'X'.repeat(500), termino: null }],
  ];

  for (const [nombre, entrada] of basura) {
    it(`basura (${nombre}) ⇒ «no sé», nunca una suposición`, () => {
      const d = enrutar(entrada, 'da igual: esto no se lee si el modelo devolvió basura');
      expect(d.tipo).toBe('no_soportado');
      if (d.tipo === 'no_soportado') expect(d.motivo).toBe('respuesta_ilegible');
    });
  }

  // El lector tolerante (P12): un `.catch()` en el schema habría convertido un
  // campo malformado en un default silencioso, y el error habría aparecido tres
  // capas más allá disfrazado de otra cosa.
  it('el schema es ESTRICTO: no rellena un campo malformado con un default', () => {
    expect(salidaModeloSchema.safeParse({ intencion: 'llegada', sku: 42, termino: null }).success).toBe(false);
  });

  it('todo «no sé» viaja con la lista de lo que sí sabe hacer', () => {
    for (const [, entrada] of basura) {
      const d = enrutar(entrada, 'x');
      if (d.tipo === 'no_soportado') expect(d.sabeHacer.length).toBeGreaterThan(0);
    }
  });
});
