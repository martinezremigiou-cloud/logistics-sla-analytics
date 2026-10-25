// ============================================================
// [2.0.1-B] El control positivo de la contramedida COMPARTIDA.
//
// Se pidió con su forma exacta: «un archivo que cite el patrón prohibido
// dentro de un comentario no debe dispararla, y uno que lo use de verdad sí».
// Eso es lo que prueba este archivo, con los patrones REALES de las seis
// guardas — no con ejemplos inventados. Si un día una de ellas cambia de
// patrón, aquí se ve.
//
// Y lleva una segunda mitad que no estaba en el encargo pero que salió del
// censo: la SEXTA copia (`scripts/guarda-lista-blanca.mjs`) no puede importar
// el ayudante, así que aquí se EXTRAE y se contrasta su resultado contra el de
// la compartida. Dos copias que no se pueden unir se comparan — el mismo molde
// que `carril.ts` vs `globals.css`.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios, sinCadenas, soloCodigo } from './codigo-fuente';

/** Los patrones que las guardas reales buscan, tal cual los tienen escritos. */
const PATRONES = {
  manejadorEnServidor: /\bon[A-Z]\w*=\{\s*(\(|async\b|function\b)/,
  usoDeLayoutCheck: /process\.env\.LAYOUT_CHECK\b(?!_)/,
  anclajeVertical: /(?<![\w:-])bottom-[\w[\]().%+-]+/,
  creaCuentas: /\bcreateUser\b/,
  rejillaPropia: /minmax\(260px/,
  escrituraDirecta: /(\.storage)?\.from\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/,
} as const;

describe('[2.0.1-B] leer código, no prosa — la contramedida de la clase', () => {
  it('un comentario que CITA el patrón prohibido no dispara ninguna de las seis guardas', () => {
    // Cada una de estas líneas es prosa real o casi real de este repo: los
    // encabezados explican el defecto citándolo, que es exactamente lo que hace
    // morder a una guarda ingenua.
    const prosa = [
      '// la versión vieja pasaba onNuevo={() => {}} desde el server',
      '// el gate lee process.env.LAYOUT_CHECK y por eso vive en el servidor',
      '// antes decía bottom-5, y ese 20 era la resta bottom-20',
      '/* este arnés jamás llama a createUser ni usa la Admin API */',
      '// el literal minmax(260px,1fr) vivía copiado en tres archivos',
      "// llévala a una RPC: nada de .from('perfiles').update(...) desde la sesión",
    ].join('\n');
    const limpio = sinComentarios(prosa);
    for (const [nombre, re] of Object.entries(PATRONES)) {
      expect(re.test(limpio), `${nombre} se disparó sobre un comentario`).toBe(false);
    }
  });

  it('y el mismo patrón USADO DE VERDAD sí las dispara — las seis', () => {
    // La otra mitad. Sin ella, un `sinComentarios` que devolviera cadena vacía
    // pondría verde a la prueba de arriba sin merecerlo.
    expect(PATRONES.manejadorEnServidor.test(sinComentarios('<X onNuevo={() => {}} />'))).toBe(true);
    expect(PATRONES.usoDeLayoutCheck.test(sinComentarios('if (process.env.LAYOUT_CHECK !== "1") notFound();'))).toBe(true);
    expect(PATRONES.anclajeVertical.test(sinComentarios('className="fixed bottom-5 right-5"'))).toBe(true);
    expect(PATRONES.creaCuentas.test(sinComentarios('await admin.auth.admin.createUser({ email });'))).toBe(true);
    expect(PATRONES.rejillaPropia.test(sinComentarios('className="grid-cols-[repeat(auto-fill,minmax(260px,1fr))]"'))).toBe(true);
    expect(PATRONES.escrituraDirecta.test(sinComentarios("await db.from('perfiles').update({ rol });"))).toBe(true);
  });

  it('no mueve un solo carácter: misma longitud y mismos saltos de línea', () => {
    // El contrato que `guarda-lista-blanca.mjs` NECESITA para no mandar a nadie
    // a la línea equivocada: deriva el número de línea del CRUDO usando el
    // `m.index` del texto LIMPIO, y eso sólo vale si las longitudes coinciden.
    const casos = [
      'const a = 1; // esto es prosa\nconst b = 2;',
      '/*\n dos\n líneas\n*/\nconst x = 1;',
      'sin comentarios en absoluto',
    ];
    for (const caso of casos) {
      expect(sinComentarios(caso).length, `cambió la longitud de: ${JSON.stringify(caso)}`).toBe(caso.length);
      expect(sinComentarios(caso).split('\n')).toHaveLength(caso.split('\n').length);
    }
    expect(sinComentarios('/*\n dos\n líneas\n*/\nconst x = 1;').split('\n')[4]).toBe('const x = 1;');
  });

  it('no se come el `//` de una URL — ni lo que comparte línea con ella', () => {
    // La primera mitad es el falso positivo obvio. La SEGUNDA es la que estaba
    // rota en la sexta copia y salió de este mismo censo: sin la guarda del
    // `[^:]`, todo lo que viene después de una URL se blanquea, y una guarda que
    // busca escrituras deja de ver la escritura. Cero ejemplares en `src/` hoy
    // —medido—, pero una guarda de seguridad no falla ABIERTA a la espera del
    // primero (P4).
    expect(sinComentarios('const u = "https://fonts.googleapis.com/css";')).toContain('https://fonts.googleapis.com/css');
    const compartiendoLinea = 'const r = await fetch("https://api/x"); const q = db.from(\'perfiles\').insert(a);';
    expect(PATRONES.escrituraDirecta.test(sinComentarios(compartiendoLinea))).toBe(true);
  });

  it('`sinCadenas` vacía el contenido pero deja las comillas y la longitud', () => {
    const fuente = `const a = "hola"; const b = 'x'; const c = \`y\`;`;
    const limpio = sinCadenas(fuente);
    expect(limpio).not.toContain('hola');
    expect(limpio.length).toBe(fuente.length);
    expect(limpio).toContain('const a = "');
  });

  it('lo de dentro de un `${…}` es CÓDIGO y sobrevive — el falso NEGATIVO que ya ocurrió', () => {
    // Medido en `scripts/layout-check.mjs`: el único uso de `ATRIBUTO_AVANZAR`
    // dentro de la rama de la pasarela vive en una plantilla, y la primera
    // versión de `sinCadenas` lo blanqueaba. Una guarda que exigía verlo salió
    // roja sobre un arnés correcto. Falso positivo grita de más; falso negativo
    // CALLA — y ése es el que se cuela.
    const linea = 'const flecha = page.locator(`[${ATRIBUTO_AVANZAR}]:visible`).first();';
    expect(soloCodigo(linea)).toContain('ATRIBUTO_AVANZAR');
    // Y el texto que rodea a la interpolación sí se vacía: no es código.
    expect(soloCodigo(linea)).not.toContain(':visible');
    expect(soloCodigo(linea).length).toBe(linea.length);
  });

  it('⚠ el límite de ese arreglo, DEMOSTRADO: una interpolación con llaves dentro sí se vacía', () => {
    // Un nivel, no un analizador. Se enseña dónde deja de valer para que nadie
    // le pida más de lo que da — y para que el día que haga falta, se vea que
    // hay que cambiar la función y no confiar en ella.
    const anidado = 'const x = `a${ obj.f({ y: 1 }) }b`;';
    expect(soloCodigo(anidado)).not.toContain('obj.f');
    expect(soloCodigo(anidado).length).toBe(anidado.length);
  });

  it('⚠ y POR ESO `sinCadenas` NO sirve para las guardas que buscan DENTRO de una cadena', () => {
    // Esta prueba existe para que nadie «simplifique» las seis a un solo
    // `soloCodigo`: a `nav-nombres.test.ts` le borraría el dato. El límite se
    // demuestra en vez de advertirse.
    const esqueleto = '<div role="status" aria-label="Cargando proyectos…">';
    expect(/aria-label="(Cargando[^"]*)"/.test(sinComentarios(esqueleto))).toBe(true);
    expect(/aria-label="(Cargando[^"]*)"/.test(soloCodigo(esqueleto))).toBe(false);
  });

  it('`soloCodigo` sí sirve para las que buscan una FORMA de código, incluso citada en una cadena', () => {
    // El caso que `sinComentarios` sola no cubre: el patrón escrito como cadena
    // de ejemplo dentro de una prueba.
    const conEjemplo = `expect(algo).toBe("onClick={() => {}}"); <X onClick={() => {}} />`;
    const limpio = soloCodigo(conEjemplo);
    // Con regex GLOBAL: `.match()` sin `g` devuelve el match MÁS los grupos de
    // captura, así que su `.length` no es un conteo de ocurrencias. Contarlo mal
    // fue mi primer intento y dio «2» donde hay una sola.
    const global = new RegExp(PATRONES.manejadorEnServidor.source, 'g');
    expect(limpio.match(global) ?? []).toHaveLength(1);
    // Y el ejemplo citado dentro de la cadena desapareció.
    expect(limpio).not.toContain('toBe("onClick');
  });
});

// ============================================================
// La SEXTA copia, la que no puede importar: se compara.
// ============================================================
describe('[2.0.1-B] la copia de `guarda-lista-blanca.mjs` no puede divergir', () => {
  const SEXTA = 'scripts/guarda-lista-blanca.mjs';

  /**
   * Se extrae el CUERPO y se ejecuta, en vez de comparar el texto de los dos
   * regex. Comparar el texto sería medir la REPRESENTACIÓN en vez de la COSA
   * (P27): dos escrituras distintas del mismo regex son la misma función, y dos
   * regex idénticos dentro de funciones distintas no lo son.
   */
  function copiaDelScript(): (texto: string) => string {
    const fuente = readFileSync(join(process.cwd(), SEXTA), 'utf8');
    const m = fuente.match(/function sinComentarios\(texto\) \{\r?\n([\s\S]*?)\r?\n\}/);
    if (!m) {
      throw new Error(
        `No encontré \`function sinComentarios(texto)\` en ${SEXTA}. Si la renombraste o la ` +
          'borraste, esta guarda tiene que enterarse: es lo único que impide que las dos copias diverjan.',
      );
    }
    return new Function('texto', m[1]) as (texto: string) => string;
  }

  /** La batería. Cada caso es un modo de fallo que ya ocurrió o que ya se midió. */
  const BATERIA: Array<[string, string]> = [
    ['URL sola', 'const u = "https://fonts.googleapis.com/css";'],
    ['URL compartiendo línea con una escritura', 'await fetch("https://api/x"); db.from(\'perfiles\').insert(a);'],
    ['comentario de línea', 'const a = 1; // cita .from(\'perfiles\').update(x)\nconst b = 2;'],
    ['comentario de bloque multilínea', '/* el INSERT\n   vivía aquí */\ndb.from("familias").insert(f);'],
    ['comentario al inicio del archivo', "// cabecera\ndb.from('proyectos').update(p);"],
    ['tres barras', 'const a = 1; /// nota suelta'],
    ['sin comentarios', "await db.from('reservas').upsert(r);"],
    ['protocolo sin comentario detrás', 'const a = "http://x"; const b = 2;'],
  ];

  it('produce EXACTAMENTE el mismo texto que la compartida, carácter por carácter', () => {
    const copia = copiaDelScript();
    for (const [nombre, entrada] of BATERIA) {
      expect(copia(entrada), `divergieron en «${nombre}»`).toBe(sinComentarios(entrada));
    }
  });

  it('control positivo · la copia extraída SÍ es la función de verdad, no una que devuelve su entrada', () => {
    // Sin esto, un extractor que devolviera la identidad pondría verde a la de
    // arriba en todos los casos donde no hay comentarios… y sólo en ésos, pero
    // la prueba no lo sabría. Se ancla en las dos direcciones.
    const copia = copiaDelScript();
    expect(copia('const a = 1; // fuera')).not.toBe('const a = 1; // fuera');
    // Escrito con `repeat` y no a ojo: la longitud es el contrato, y contar
    // espacios en un literal es justo donde se cuela un off-by-one invisible.
    expect(copia('const a = 1; // fuera')).toBe('const a = 1;' + ' '.repeat(9));
    expect(copia("db.from('perfiles').insert(a);")).toBe("db.from('perfiles').insert(a);");
  });
});
