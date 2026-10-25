// ============================================================
// [INV-B11] El troceador, probado contra la regla que lo justifica.
//
// La prueba central de este archivo es una sola y está en su propio `describe`:
// **una tabla no se parte nunca**. Lo demás es andamio alrededor de eso.
//
// Y se prueba de la forma que no se puede falsear por accidente: no «el trozo
// contiene la tabla», sino **la suma de renglones de tabla de todos los trozos
// es igual a la del original, y ningún trozo tiene renglones huérfanos** — o
// sea sin su encabezado y su separador. Un trozo con `| Cwr96 | 22" | Alta |`
// y sin la fila que dice qué columna es cuál está sintácticamente sano y
// semánticamente envenenado.
// ============================================================
import { describe, it, expect } from 'vitest';
import { leerDocumento, trocear, seEmbebe, UMBRAL_BYTES, type Documento } from './trocear';

const FRONTMATTER = [
  '---',
  'name: "Series2"',
  'description: "Plataforma de display seguro de Brand1."',
  'type: reference',
  'tags: [sistema/brand1, tipo/ficha-producto]',
  'fuente_pdf: "Mkt/Brand1/Series_30.pdf"',
  '---',
].join('\n');

const TABLA = [
  '| Modelo | Cable series20 | Nivel seguridad | Analítica |',
  '|--------|---------------|-----------------|-----------|',
  '| Veb08 | 28" | Estándar | No |',
  '| Rxz57 | 28" | Reforzada | Si |',
  '| Cwr96 | 22" | Alta | Si |',
  '| Lhz72 | N/A | Alta (mecánica) | No |',
  '| Lhz72QR | N/A | Alta | Si |',
].join('\n');

/** Párrafo de relleno de tamaño pedido, para forzar el troceo sin trucos. */
const relleno = (n: number) => 'Texto de relleno para forzar el troceo. '.repeat(n);

describe('[INV-B11] leerDocumento', () => {
  it('saca el frontmatter y deja el cuerpo limpio', () => {
    const d = leerDocumento(FRONTMATTER + '\n\n# Series2\n\nCuerpo.');
    expect(d.meta.name).toBe('Series2');
    expect(d.meta.type).toBe('reference');
    expect(d.cuerpo).toContain('# Series2');
    expect(d.cuerpo).not.toContain('fuente_pdf');
  });

  // ============================================================
  // `fuente_pdf` es la cita que O4 exige que viaje hasta la respuesta. Si se
  // pierde aquí, la respuesta queda con una fuente blanda —«según la ficha»—
  // que nadie puede verificar. Tiene su propia prueba por eso.
  // ============================================================
  it('conserva `fuente_pdf`, que es lo que vuelve verificable una cita', () => {
    const d = leerDocumento(FRONTMATTER + '\n\n# Series2\n');
    expect(d.meta.fuente_pdf).toBe('Mkt/Brand1/Series_30.pdf');
  });

  it('sin frontmatter no inventa nada y no pierde cuerpo', () => {
    const d = leerDocumento('# Suelto\n\nSin YAML.');
    expect(d.meta).toEqual({});
    expect(d.cuerpo).toContain('Sin YAML.');
  });

  it('un frontmatter sin cerrar NO se come el documento', () => {
    // P12: un lector tolerante devolvería cuerpo vacío y el archivo
    // desaparecería del índice en silencio.
    const d = leerDocumento('---\nname: roto\n\n# Título\n\nCuerpo que debe sobrevivir.');
    expect(d.cuerpo).toContain('Cuerpo que debe sobrevivir.');
  });
});

describe('[INV-B11] trocear · lo que NO hay que trocear', () => {
  it('un documento que cabe sale en UN trozo: trocear de más también separa un dato de su condición', () => {
    const d = leerDocumento(FRONTMATTER + '\n\n# Series2\n\n## Qué es\n\nCorto.\n\n## Usos\n\nTambién corto.');
    expect(trocear(d)).toHaveLength(1);
  });
});

describe('[INV-B11] trocear · LA TABLA NO SE PARTE', () => {
  /** Renglones de tabla de un texto: los que empiezan por `|`. */
  const renglones = (t: string) => t.split('\n').filter((l) => l.trimStart().startsWith('|'));
  const esSeparador = (l: string) => /^\s*\|[\s:|-]+\|\s*$/.test(l);

  function docConTablaGrande(): Documento {
    return leerDocumento(
      [
        FRONTMATTER,
        '',
        '# Series2',
        '',
        '## Características principales',
        '',
        relleno(90),
        '',
        '### Tabla comparativa de variantes',
        '',
        TABLA,
        '',
        relleno(90),
        '',
        '## Casos de uso',
        '',
        relleno(90),
      ].join('\n'),
    );
  }

  it('el caso está bien construido: SIN esto la prueba sería vacua (P17)', () => {
    const d = docConTablaGrande();
    const trozos = trocear(d);
    expect(trozos.length, 'el documento no se troceó: la prueba no probaría nada').toBeGreaterThan(1);
    expect(trozos.some((t) => t.tieneTabla), 'ningún trozo tiene tabla').toBe(true);
  });

  it('no se pierde ni se duplica un solo renglón de tabla', () => {
    const d = docConTablaGrande();
    const original = renglones(d.cuerpo).length;
    const repartidos = trocear(d).reduce((s, t) => s + renglones(t.texto).length, 0);
    expect(original).toBe(7);
    expect(repartidos).toBe(original);
  });

  // ============================================================
  // LA PRUEBA QUE JUSTIFICA EL ARCHIVO. Un trozo con renglones de datos pero
  // sin su encabezado y su separador entrega **un número sin su condición**:
  // «Alta» sin saber que la columna es «Nivel seguridad» ni que el renglón es
  // `Cwr96`. Sale bien formado y miente.
  // ============================================================
  it('ningún trozo tiene renglones de tabla HUÉRFANOS —sin encabezado y separador—', () => {
    for (const t of trocear(docConTablaGrande())) {
      const r = renglones(t.texto);
      if (r.length === 0) continue;
      expect(r.length, `«${t.rutaSeccion}» tiene un renglón suelto`).toBeGreaterThanOrEqual(3);
      expect(r.some(esSeparador), `«${t.rutaSeccion}» tiene datos sin separador de tabla`).toBe(true);
      expect(esSeparador(r[1]!), `«${t.rutaSeccion}» no empieza por encabezado + separador`).toBe(true);
    }
  });

  it('la tabla queda ENTERA en un solo trozo, no repartida entre dos', () => {
    const conTabla = trocear(docConTablaGrande()).filter((t) => t.tieneTabla);
    expect(conTabla).toHaveLength(1);
    expect(renglones(conTabla[0]!.texto)).toHaveLength(7);
  });

  // ============================================================
  // LA CONCESIÓN, dicha en voz alta y probada. Si una tabla sola pasa del
  // umbral, el trozo pasa del umbral. **No se parte.** Un trozo grande es un
  // problema de costo; media tabla es un problema de verdad.
  // ============================================================
  // ============================================================
  // LA PRUEBA QUE JUSTIFICA `esRenglonTabla`, y existe porque el sabotaje la
  // pidió.
  //
  // Al sabotear la atomicidad de tablas contra el corpus REAL, **no pasó nada**:
  // siguió en 0 huérfanos. La razón es que una tabla markdown no tiene líneas
  // en blanco dentro, así que el corte por PÁRRAFOS ya la mantiene entera —
  // mi código de tablas era un cinturón sobre unos tirantes que ya funcionaban.
  //
  // Y ahí está el punto: **una guarda cuya necesidad no se puede demostrar no
  // está justificada, está supuesta.** Así que se construye el caso donde SÍ
  // hace falta: una tabla PEGADA a un párrafo, sin línea en blanco entre los
  // dos. Ahí el párrafo y la tabla son un solo bloque para el cortador de
  // párrafos, y sin `esRenglonTabla` se parten juntos por la mitad.
  //
  // Esta forma NO existe hoy en el corpus. La guarda la cubre igual, y ahora
  // se sabe exactamente para qué sirve.
  // ============================================================
  it('una tabla PEGADA a un párrafo sin línea en blanco tampoco se parte', () => {
    // Pegados de verdad: sin línea en blanco entre el párrafo y la tabla.
    const pegado = relleno(120) + '\n' + TABLA + '\n' + relleno(120);
    const d = leerDocumento([FRONTMATTER, '', '# Series2', '', '## Pegada', '', pegado].join('\n'));
    const trozos = trocear(d);
    expect(trozos.length, 'no se troceó: la prueba sería vacua').toBeGreaterThan(1);

    const conTabla = trozos.filter((t) => t.tieneTabla);
    expect(conTabla, 'la tabla acabó repartida entre trozos').toHaveLength(1);
    expect(renglones(conTabla[0]!.texto)).toHaveLength(7);
  });

  it('una tabla que sola excede el umbral NO se parte: el trozo excede y lo DECLARA', () => {
    const filas = Array.from({ length: 400 }, (_, i) => `| SKU-${i} | valor ${i} | condición ${i} |`);
    const tablaEnorme = ['| SKU | Valor | Condición |', '|-----|-------|-----------|', ...filas].join('\n');
    const d = leerDocumento([FRONTMATTER, '', '# Series2', '', '## Enorme', '', tablaEnorme].join('\n'));

    const trozos = trocear(d);
    const conTabla = trozos.filter((t) => t.tieneTabla);
    expect(conTabla, 'la tabla se repartió: eso es exactamente lo prohibido').toHaveLength(1);
    expect(conTabla[0]!.bytes).toBeGreaterThan(UMBRAL_BYTES);
    expect(conTabla[0]!.excede, 'excedió el umbral y no lo declaró').toBe(true);
    expect(renglones(conTabla[0]!.texto)).toHaveLength(402);
  });
});

describe('[INV-B11] trocear · la procedencia viaja DENTRO del texto', () => {
  it('cada trozo lleva su ruta de sección, porque viaja solo hasta el modelo', () => {
    const d = leerDocumento(
      [FRONTMATTER, '', '# Series2', '', '## Características principales', '', relleno(90), '', '### Tabla comparativa', '', TABLA, '', relleno(90)].join('\n'),
    );
    const trozos = trocear(d);
    expect(trozos.length).toBeGreaterThan(1);
    for (const t of trozos) {
      expect(t.texto.startsWith(t.rutaSeccion), `«${t.rutaSeccion}» no encabeza su propio texto`).toBe(true);
      expect(t.texto, 'falta la descripción del documento').toContain('Plataforma de display seguro');
      expect(t.rutaSeccion.startsWith('Series2'), 'la ruta no arranca en el documento').toBe(true);
    }
  });

  it('el orden es estable y sin huecos', () => {
    const d = leerDocumento([FRONTMATTER, '', '# Series2', '', '## A', '', relleno(90), '', '## B', '', relleno(90)].join('\n'));
    const t = trocear(d);
    expect(t.map((x) => x.orden)).toEqual(t.map((_, i) => i));
  });
});

describe('[INV-B11] seEmbebe · las TRES reglas, cada una por separado', () => {
  const doc = (meta: Record<string, string> = {}): Documento => ({ meta, cuerpo: 'x' });

  it('1 · frontmatter `type: meta` queda fuera', () => {
    expect(seEmbebe('20_Seguridad/Indice.md', doc({ type: 'meta' }))).toBe(false);
  });

  it('2 · `_README.md` queda fuera', () => {
    expect(seEmbebe('20_Seguridad/_README.md', doc({ type: 'reference' }))).toBe(false);
  });

  it('3 · `PT-*` queda fuera', () => {
    expect(seEmbebe('00_Indice/Plantillas/PT-Producto.md', doc({ type: 'reference' }))).toBe(false);
  });

  // El control positivo: sin esto, una `seEmbebe` que devolviera `false`
  // siempre pondría verdes las tres de arriba y vaciaría el índice (P19).
  it('control positivo · una ficha de producto SÍ se embebe', () => {
    expect(seEmbebe('20_Seguridad/20.01_brand1/06_Fichas/Series2.md', doc({ type: 'reference' }))).toBe(true);
  });

  it('`type: meta` en el CUERPO no cuenta — solo en el frontmatter', () => {
    // Es el defecto exacto del «93 MOC»: un `grep` sobre el archivo entero
    // contaba cualquier nota que MENCIONARA el tag.
    const d = leerDocumento('---\nname: Real\ntype: reference\n---\n\n# Real\n\nEsta nota habla de `type: meta` como ejemplo.');
    expect(seEmbebe('20_Seguridad/Real.md', d)).toBe(true);
  });
});
