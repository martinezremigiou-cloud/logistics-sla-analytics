// ============================================================
// [INV-B11] El subconjunto de markdown, y las tres cosas que importan:
//
//   1. Una TABLA se parsea como tabla — es el invariante de O3 saliendo a la
//      superficie. Media tabla da un número sin su condición; una tabla pintada
//      como párrafo hace lo mismo, un paso más adelante.
//   2. Un WIKILINK no llega crudo al usuario.
//   3. El HTML **no se interpreta**, y no porque se filtre: porque este módulo
//      produce ESTRUCTURA y nunca HTML.
// ============================================================
import { describe, it, expect } from 'vitest';
import { parsear, partirInline, type Bloque } from './markdown';

const soloTexto = (b: Bloque): string => {
  if (b.tipo === 'codigo') return b.texto;
  if (b.tipo === 'lista') return b.items.map((i) => i.map((x) => x.v).join('')).join(' | ');
  if (b.tipo === 'tabla') return [b.encabezados, ...b.filas].map((f) => f.map((c) => c.map((x) => x.v).join('')).join('|')).join(' / ');
  return b.contenido.map((x) => x.v).join('');
};

describe('[INV-B11] la TABLA se parsea como tabla', () => {
  const TABLA = [
    '| Modelo | Cable | Nivel seguridad |',
    '|--------|-------|-----------------|',
    '| Veb08 | 28" | Estándar |',
    '| Cwr96 | 22" | Alta |',
  ].join('\n');

  it('encabezados y filas quedan separados, no aplastados en un párrafo', () => {
    const b = parsear(TABLA);
    expect(b).toHaveLength(1);
    expect(b[0]!.tipo).toBe('tabla');
    if (b[0]!.tipo !== 'tabla') throw new Error('inalcanzable');
    expect(b[0]!.encabezados.map((c) => c.map((x) => x.v).join(''))).toEqual(['Modelo', 'Cable', 'Nivel seguridad']);
    expect(b[0]!.filas).toHaveLength(2);
    expect(b[0]!.filas[1]!.map((c) => c.map((x) => x.v).join(''))).toEqual(['Cwr96', '22"', 'Alta']);
  });

  // ============================================================
  // SIN SEPARADOR NO ES UNA TABLA, y pintarla como si lo fuera le pondría una
  // cabecera que el documento no tiene. Es la misma regla que en `trocear.ts`
  // —renglones de datos sin su encabezado— un nivel más arriba.
  // ============================================================
  it('renglones con `|` pero SIN separador NO se pintan como tabla', () => {
    const b = parsear('| Veb08 | 28" |\n| Cwr96 | 22" |');
    expect(b.every((x) => x.tipo !== 'tabla'), 'se inventó una cabecera que el documento no tiene').toBe(true);
  });

  it('una tabla con negritas dentro conserva el énfasis por celda', () => {
    const b = parsear('| A | B |\n|---|---|\n| **x** | y |');
    if (b[0]!.tipo !== 'tabla') throw new Error('esperaba tabla');
    expect(b[0]!.filas[0]![0]).toEqual([{ t: 'negrita', v: 'x' }]);
  });
});

describe('[INV-B11] los WIKILINKS no llegan crudos', () => {
  // Medido: una parte notable de los documentos embebibles los trae, y hoy salen
  // literales en la respuesta. Se encontró en QA manual.
  it('`[[X]]` se muestra como `X`, sin corchetes', () => {
    expect(soloTexto(parsear('Ver [[Antena-EAS-Series12-UR63]] para detalles.')[0]!)).toBe(
      'Ver Antena-EAS-Series12-UR63 para detalles.',
    );
  });

  it('`[[X|alias]]` muestra el ALIAS, que es lo que el autor quiso que se leyera', () => {
    expect(soloTexto(parsear('Ver [[ruta/larga/Archivo|el manual]].')[0]!)).toBe('Ver el manual.');
  });

  it('una RUTA se muestra por su hoja, no entera', () => {
    expect(soloTexto(parsear('[[20_Seguridad/20.02_Series5/_README]]')[0]!)).toBe('_README');
  });

  // ============================================================
  // EL DEFECTO QUE SOLO APARECIÓ CONTRA EL CORPUS REAL, y ninguna prueba de
  // fixture lo habría encontrado porque yo no habría escrito ese fixture.
  //
  // `[[X|alias]]` usa `|` — **el mismo carácter que separa las celdas de una
  // tabla**. Con los wikilinks quitándose dentro de `partirInline`, el troceo de
  // celdas ya había partido el enlace en dos (`[[X` y `alias]]`) y ninguno
  // casaba. **varios wikilinks llegaban crudos al usuario**, todos en tablas.
  //
  // El arreglo es de ORDEN: se quitan sobre el texto entero, antes de partir
  // nada. Así ningún paso posterior puede confundirse.
  // ============================================================
  it('un wikilink CON ALIAS dentro de una celda de tabla no se parte por el `|`', () => {
    const b = parsear('| Sistema | Nota |\n|---------|------|\n| [[Antena-EAS|Series11]] | activo |');
    expect(b[0]!.tipo).toBe('tabla');
    if (b[0]!.tipo !== 'tabla') throw new Error('inalcanzable');
    // Dos celdas, no tres: el `|` del alias no cuenta como separador.
    expect(b[0]!.filas[0], 'el wikilink partió la fila en una celda de más').toHaveLength(2);
    expect(b[0]!.filas[0]![0]!.map((x) => x.v).join('')).toBe('Series11');
  });

  it('no queda ni un corchete doble en todo el corpus de prueba', () => {
    const texto = 'a [[X]] b [[Y|z]] c [[d/e/F.md]]';
    expect(soloTexto(parsear(texto)[0]!)).not.toContain('[[');
    expect(soloTexto(parsear(texto)[0]!)).not.toContain(']]');
  });
});

describe('[INV-B11] el HTML no se interpreta — y no porque se filtre', () => {
  // ============================================================
  // Este módulo produce ESTRUCTURA, no HTML, y el componente crea elementos de
  // React. No hay `dangerouslySetInnerHTML` en ningún punto del camino.
  //
  // La diferencia con «filtrarlo» importa: un filtro es una decisión que
  // alguien puede revertir; esto es que **el mecanismo no existe**.
  // ============================================================
  it('un `<script>` sale como TEXTO, con sus signos', () => {
    const t = soloTexto(parsear('Antes <script>alert(1)</script> después')[0]!);
    expect(t).toContain('<script>');
    expect(t).toContain('alert(1)');
  });

  it('no hay soporte de enlaces: medido, el corpus tiene CERO', () => {
    // Un `[x](y)` sale como texto. No soportarlo quita el vector por
    // construcción en vez de por configuración.
    const t = soloTexto(parsear('Ver [aquí](javascript:alert(1)) ahora')[0]!);
    expect(t).toContain('[aquí]');
    expect(t).toContain('javascript:');
  });
});

describe('[INV-B11] el resto del subconjunto medido', () => {
  it('encabezado con su nivel', () => {
    const b = parsear('## Características principales');
    expect(b[0]).toMatchObject({ tipo: 'encabezado', nivel: 2 });
    expect(soloTexto(b[0]!)).toBe('Características principales');
  });

  it('cita de varias líneas se junta en un bloque', () => {
    const b = parsear('> Alarma de dos piezas\n> unidas por un cable.');
    expect(b[0]!.tipo).toBe('cita');
    expect(soloTexto(b[0]!)).toBe('Alarma de dos piezas unidas por un cable.');
  });

  it('lista con viñeta y lista numerada se distinguen', () => {
    expect(parsear('- uno\n- dos')[0]).toMatchObject({ tipo: 'lista', ordenada: false });
    expect(parsear('1. uno\n2. dos')[0]).toMatchObject({ tipo: 'lista', ordenada: true });
  });

  it('bloque de código conserva sus saltos', () => {
    const b = parsear('```\nlinea 1\nlinea 2\n```');
    expect(b[0]).toMatchObject({ tipo: 'codigo', texto: 'linea 1\nlinea 2' });
  });
});

describe('[INV-B11] partirInline · el orden de los énfasis', () => {
  it('negrita e itálica', () => {
    expect(partirInline('a **b** c *d*')).toEqual([
      { t: 'texto', v: 'a ' },
      { t: 'negrita', v: 'b' },
      { t: 'texto', v: ' c ' },
      { t: 'italica', v: 'd' },
    ]);
  });

  // ============================================================
  // EL CÓDIGO GANA, y el orden no es estilo. Dentro de un backtick el markdown
  // no interpreta nada. Si la negrita se evaluara primero, un fragmento de
  // código con asteriscos se pintaría en negritas Y PERDERÍA LOS ASTERISCOS —
  // o sea que la CITA dejaría de decir lo que el documento dice.
  // ============================================================
  it('dentro de código, los asteriscos son asteriscos', () => {
    expect(partirInline('usa `a**b**c` aquí')).toEqual([
      { t: 'texto', v: 'usa ' },
      { t: 'codigo', v: 'a**b**c' },
      { t: 'texto', v: ' aquí' },
    ]);
  });

  it('texto sin nada devuelve un solo tramo, no una lista vacía', () => {
    expect(partirInline('solo texto')).toEqual([{ t: 'texto', v: 'solo texto' }]);
  });
});

describe('[INV-B11] lo desconocido degrada a texto, no revienta', () => {
  it('sintaxis rara sale como párrafo', () => {
    const b = parsear('~~tachado~~ y ==resaltado== y $$x$$');
    expect(b).toHaveLength(1);
    expect(b[0]!.tipo).toBe('parrafo');
    expect(soloTexto(b[0]!)).toContain('~~tachado~~');
  });

  it('texto vacío no revienta', () => {
    expect(parsear('')).toEqual([]);
    expect(parsear('\n\n\n')).toEqual([]);
  });
});
