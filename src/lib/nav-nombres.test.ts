// ============================================================
// [2.0.1-B · R-2] nav-nombres.test.ts — EL GATE DEL RENOMBRE.
//
// El encargo: «derivado, no una lista a mano — un gate cuyo sujeto es una
// enumeración escrita a mano es ciego a lo no enumerado». Aquí eso se cumple en
// el eje que importa: **el SUJETO se deriva del árbol** (todas las rutas bajo
// `src/app/(app)`, todos los `aria-label="Cargando …"` de `src/`), y lo único
// escrito a mano es la EXPECTATIVA — que es exactamente lo que un renombre
// cambia. Una pantalla nueva no puede entrar sin que alguien decida cómo se
// llama: el gate exige que los dos conjuntos coincidan **en las dos
// direcciones**.
//
// POR QUÉ NO ES UNA LISTA NEGRA DE CADENAS VIEJAS. El renombre fue un
// INTERCAMBIO —el pipeline pasó a llamarse «Embarques» justo cuando el histórico
// dejó de llamarse así— de modo que la cadena «Embarques» era a la vez lo que
// había que quitar de un sitio y lo que había que poner en otro. Un barrido por
// cadena no puede distinguirlas. La prueba «la lista negra sería falsa» de abajo
// lo demuestra en vez de argumentarlo.
//
// Y hay una segunda mitad, que la comparación contra el árbol NO da: impide la
// DERIVA, pero no impide DECLARAR un nombre retirado. Para eso está
// `NOMBRES_RETIRADOS`.
//
// LO QUE ESTE GATE NO VE, declarado: lee TEXTO del fuente. No prueba que la
// pantalla PINTE lo que el archivo dice —eso lo mide `layout-check` en el
// navegador— ni cubre copy dentro de componentes hijos (botones, vacíos,
// tooltips), ni el `<h1>` de una ruta que lo delega a un hijo (`/proyectos`).
// Cubre las CINCO superficies donde una pantalla DICE CÓMO SE LLAMA: nav,
// cintillo, `<h1>`, etiqueta corta de la barra móvil y el anuncio de carga.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOMBRES, CARGANDO, NOMBRES_RETIRADOS } from './nav-nombres';
import { sinComentarios } from './guardas/codigo-fuente';
import { NAV_ITEMS } from './nav';

const raiz = process.cwd();
const leer = (rel: string) => readFileSync(join(raiz, rel), 'utf8');

function archivos(dir: string, filtro: (n: string) => boolean, salida: string[] = []): string[] {
  for (const e of readdirSync(join(raiz, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) archivos(rel, filtro, salida);
    else if (filtro(e.name)) salida.push(rel);
  }
  return salida;
}

/** `src/app/(app)/embarques/page.tsx` → `/embarques`; los grupos `(x)` no cuentan. */
export function rutaDe(archivo: string): string {
  const segs = archivo
    .replace(/\\/g, '/')
    .replace(/^src\/app\//, '')
    .replace(/\/page\.tsx$/, '')
    .split('/')
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')));
  return '/' + segs.join('/');
}

/** El cintillo en versalitas y el `<h1>`, extraídos por su ETIQUETA, no por su clase. */
export function superficieDe(fuente: string): { cintillo?: string; h1?: string } {
  const h1 = fuente.match(/<h1[^>]*>([^<{]+)<\/h1>/);
  const cin = fuente.match(/<span[^>]*text-brand[^>]*>([^<{]+)<\/span>/);
  const out: { cintillo?: string; h1?: string } = {};
  if (cin) out.cintillo = cin[1].trim();
  if (h1) out.h1 = h1[1].trim();
  return out;
}

export function cargandoDe(fuente: string): string[] {
  return Array.from(fuente.matchAll(/aria-label="(Cargando[^"]*)"/g)).map((m) => m[1]);
}

// ---------- el sujeto, DERIVADO ----------
const paginas = archivos('src/app/(app)', (n) => n === 'page.tsx');
const superficieReal: Record<string, { nav?: string; cintillo?: string; h1?: string; movil?: string }> = {};
for (const p of paginas) {
  const s = superficieDe(leer(p));
  if (s.cintillo || s.h1) superficieReal[rutaDe(p)] = s;
}
for (const item of NAV_ITEMS) {
  superficieReal[item.href] = { ...(superficieReal[item.href] ?? {}), nav: item.label };
}
// La quinta superficie entra en el MISMO mapa: así una sola comparación cubre
// las cuatro cosas que una pantalla dice sobre cómo se llama, y no hay una
// superficie con su propia comparación laxa al margen.
for (const [href, label] of Object.entries(slotsMovilesDe(leer('src/components/layout/bottom-nav.tsx')))) {
  superficieReal[href] = { ...(superficieReal[href] ?? {}), movil: label };
}

describe('[2.0.1-B · R-2] el nombre de cada pantalla, en las cuatro superficies', () => {
  it('el extractor encuentra pantallas de verdad (si no, todo lo de abajo es vacuo)', () => {
    // P17 sobre el propio gate: con un extractor roto, `superficieReal` saldría
    // vacío y compararlo contra un objeto vacío sería verde.
    expect(paginas.length).toBeGreaterThan(8);
    expect(Object.keys(superficieReal).length).toBeGreaterThan(6);
    expect(superficieReal['/embarques']).toBeDefined();
    expect(superficieReal['/embarques/historico']).toBeDefined();
  });

  it('cada RUTA lleva exactamente los nombres declarados — en las dos direcciones', () => {
    // La comparación es de OBJETO COMPLETO a propósito: una ruta nueva con
    // título y sin entrada aquí enrojece, y una entrada que ya no corresponde a
    // ninguna ruta, también. Ninguna de las dos puede colarse.
    expect(
      superficieReal,
      'una superficie de nombre cambió, apareció o desapareció. Si es un renombre, actualiza `NOMBRES` ' +
        'en `nav-nombres.ts` EN EL MISMO COMMIT que el código; si es una pantalla nueva, decide cómo se llama.',
    ).toEqual(NOMBRES);
  });

  // ──────────────────────────────────────────────────────────
  // [2.0.1-B · S-4] GATE-DE-CARGA-LEE-PROSA, cerrado.
  //
  // Este barrido leía el fuente CRUDO, y eso tenía dos caras:
  //
  //   · La ruidosa, que ya mordió: un comentario que escribe el patrón literal
  //     —el que EXPLICA por qué un rótulo no empieza con esa palabra— agrega una
  //     entrada fantasma y pone el gate rojo por un rótulo que no existe en el
  //     marcado. Ruidoso, pero seguro.
  //   · La silenciosa, que es la que importaba: si alguien BORRA el rótulo real
  //     de un archivo que además lo menciona en un comentario, el barrido lo
  //     sigue encontrando **en ese mismo archivo** y el gate se queda VERDE con
  //     el anuncio ya muerto. Fail-open.
  //
  // EL ARREGLO NO ES «APLICARLE `soloCodigo`», y por eso este gate quedó fuera
  // de esa contramedida a propósito: su trabajo es extraer DE CADENAS, y
  // `sinCadenas` lo dejaría ciego a todo. Lo que se parte es la ENTRADA, no el
  // gate — dos pasadas sobre un solo sujeto:
  //
  //   · CRUDA, para la EXTRACCIÓN: `cargandoDe` sigue siendo el mismo extractor.
  //   · SIN COMENTARIOS, para la VERIFICACIÓN: lo que se contrasta contra el
  //     registro es solo lo que está en el MARCADO.
  //
  // Y la diferencia entre las dos pasadas no se tira: cuando el gate falla, dice
  // cuáles de las etiquetas que faltan están escritas en prosa de ese archivo.
  // Sin eso, la dirección silenciosa se lee como un renombre que nadie hizo.
  // ──────────────────────────────────────────────────────────

  /** Las etiquetas por archivo, con la pasada que se le pida. */
  function anunciosPorArchivo(transformar: (fuente: string) => string): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const f of archivos('src', (n) => /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n))) {
      const etiquetas = cargandoDe(transformar(leer(f)));
      if (etiquetas.length) out[f] = etiquetas;
    }
    return out;
  }

  it('el anuncio de carga (lo que oye un lector de pantalla) también está atado', () => {
    const enElMarcado = anunciosPorArchivo(sinComentarios);
    const enElFuenteCrudo = anunciosPorArchivo((s) => s);

    // Diagnóstico, no aserción: qué archivos escriben el patrón en un comentario.
    const soloEnProsa = Object.keys(enElFuenteCrudo).filter(
      (f) => (enElFuenteCrudo[f] ?? []).length > (enElMarcado[f] ?? []).length,
    );

    expect(
      enElMarcado,
      'cambió un anuncio de carga en el MARCADO. Es la superficie que nadie mira y la que un renombre a medias deja atrás.' +
        (soloEnProsa.length ? ` Ojo: estos archivos lo escriben además en un comentario, que NO cuenta: ${soloEnProsa.join(', ')}.` : ''),
    ).toEqual(CARGANDO);
  });

  it('CONTROL POSITIVO en la dirección silenciosa: borrar el marcado y dejar el comentario deja el gate en CERO', () => {
    const conMarcado = [
      '// El esqueleto anuncia aria-label="Cargando catálogo…" mientras trabaja.',
      'export function X() {',
      '  return <div role="status" aria-label="Cargando catálogo…" />;',
      '}',
    ].join('\n');
    const sinMarcado = conMarcado.split('\n').filter((l) => !l.includes('role="status"')).join('\n');

    // La pasada CRUDA no distingue las dos situaciones: es la fuga.
    expect(cargandoDe(conMarcado)).toHaveLength(2);
    expect(cargandoDe(sinMarcado)).toHaveLength(1);

    // La pasada de VERIFICACIÓN sí: con el marcado borrado ve CERO, y el gate
    // enrojece en vez de quedarse verde con un anuncio muerto.
    expect(cargandoDe(sinComentarios(conMarcado))).toEqual(['Cargando catálogo…']);
    expect(cargandoDe(sinComentarios(sinMarcado))).toEqual([]);
  });
});

/** Las parejas `{ href, label }` de `BOTTOM_SLOTS`, leídas del fuente de la barra móvil. */
export function slotsMovilesDe(fuente: string): Record<string, string> {
  const bloque = fuente.slice(fuente.indexOf('BOTTOM_SLOTS'), fuente.indexOf('] as const'));
  const out: Record<string, string> = {};
  // `Array.from` y no un `for…of` sobre el iterador: `matchAll` devuelve un
  // `RegExpStringIterator` que este `target` de TS no sabe recorrer (TS2802).
  // vitest lo transpila con esbuild y pasa igual — es la sexta vez en el arco
  // que un verde de vitest convive con un `tsc` rojo.
  for (const m of Array.from(bloque.matchAll(/\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"\s*\}/g))) out[m[1]] = m[2];
  return out;
}

describe('[2.0.1-B · R-2] la barra móvil: la SEGUNDA lista de etiquetas', () => {
  const movil = slotsMovilesDe(leer('src/components/layout/bottom-nav.tsx'));

  /** Las etiquetas cortas, sacadas del campo `movil` de cada ruta. */
  const esperado: Record<string, string> = {};
  for (const [ruta, n] of Object.entries(NOMBRES)) if (n.movil) esperado[ruta] = n.movil;

  it('sus etiquetas están declaradas por RUTA y no cambian solas', () => {
    // `slot.label` se pinta directo y no se compara con nada en runtime:
    // actualizar los `href` y olvidar los `label` dejaría la barra diciendo
    // «Cruce» hacia `/embarques`. Esta línea es lo único que lo impide.
    expect(movil).toEqual(esperado);
  });

  it('CADA href de la barra móvil existe en NAV_ITEMS — el invariante que evita la desaparición silenciosa', () => {
    // `bottom-nav.tsx:35-36` hace `NAV_ITEMS.find(...)` y `return null` si no
    // encuentra el href. Así que mover una ruta en `nav.ts` sin tocar esta lista
    // NO rompe el build ni ninguna prueba: **borra el ítem del nav móvil sin un
    // solo error**. Esta línea es lo único que convierte ese silencio en rojo.
    const conocidos = new Set(NAV_ITEMS.map((i) => i.href));
    const huerfanos = Object.keys(movil).filter((h) => !conocidos.has(h));
    expect(
      huerfanos,
      `la barra móvil apunta a rutas que ya no están en NAV_ITEMS: ${huerfanos.join(', ')}. ` +
        'No es un aviso estético: esos ítems DESAPARECEN de la navegación móvil sin error ninguno.',
    ).toEqual([]);
  });

  it('control positivo · el extractor lee slots de verdad y el invariante puede fallar', () => {
    expect(slotsMovilesDe('BOTTOM_SLOTS = [ { href: "/x", label: "Equis" } ] as const')).toEqual({ '/x': 'Equis' });
    expect(slotsMovilesDe('BOTTOM_SLOTS = [ ] as const')).toEqual({});
    // El sabotaje: una ruta móvil que nadie declara en el nav.
    const conocidos = new Set(NAV_ITEMS.map((i) => i.href));
    expect(conocidos.has('/ruta-que-no-existe')).toBe(false);
  });
});

describe('[2.0.1-B · R-2] ninguna superficie conserva un nombre RETIRADO', () => {
  /** Los infractores de un mapa cualquiera, para poder sabotearlo abajo. */
  function retirados(mapa: typeof NOMBRES): string[] {
    const fuera: string[] = [];
    for (const [ruta, n] of Object.entries(mapa)) {
      for (const [campo, valor] of Object.entries(n)) {
        if ((NOMBRES_RETIRADOS as readonly string[]).includes(String(valor))) fuera.push(`${ruta}.${campo} = «${valor}»`);
      }
    }
    return fuera;
  }

  it('el vocabulario de cara al usuario ya no dice «El Cruce» ni «Cruce»', () => {
    // La comparación con el árbol impide la DERIVA, no impide DECLARAR un nombre
    // retirado: quien actualice el código y la tabla a la vez conservando el
    // nombre viejo queda verde. Esta es la mitad que faltaba.
    expect(
      retirados(NOMBRES),
      'una superficie de cara al usuario conserva un nombre retirado por R-1. ' +
        '«Cruce» sigue vivo como nombre INTERNO (servicio, API, componentes) — ver `src/lib/nav-nombres.ts` — ' +
        'pero no puede volver a aparecer en el nav, el cintillo, el <h1> ni la barra móvil.',
    ).toEqual([]);
  });

  it('control positivo · el detector SÍ caza un nombre retirado, en cualquier superficie', () => {
    expect(retirados({ ...NOMBRES, '/x': { movil: 'Cruce' } })).toEqual(['/x.movil = «Cruce»']);
    expect(retirados({ ...NOMBRES, '/x': { h1: 'El Cruce' } })).toEqual(['/x.h1 = «El Cruce»']);
    // Y no es un barrido de subcadenas: «Histórico de embarques» no contiene un
    // nombre retirado, y «Aduana» tampoco lo es.
    expect(retirados({ ...NOMBRES, '/x': { nav: 'Histórico de embarques', cintillo: 'Aduana' } })).toEqual([]);
  });
});

describe('[2.0.1-B · R-2] controles positivos — el gate PUEDE ponerse rojo', () => {
  it('el extractor ve un cintillo y un h1 de verdad, y no inventa cuando no los hay', () => {
    const conAmbos = '<span className="text-[12px] text-brand">Aduana</span><h1 className="text-ink">Embarques</h1>';
    expect(superficieDe(conAmbos)).toEqual({ cintillo: 'Aduana', h1: 'Embarques' });
    expect(superficieDe('<div>nada que ver</div>')).toEqual({});
    // Un título BINDEADO no es una cadena literal: se excluye a propósito
    // (`[^<{]+` corta en `{`) para no afirmar sobre algo que decide el dato.
    expect(superficieDe('<h1 className="text-ink">{proyecto.titulo}</h1>')).toEqual({});
  });

  it('una cadena vieja PLANTADA se denuncia, con su ruta', () => {
    // El sabotaje que el encargo pide. Se ejerce sobre el extractor + la
    // comparación, que es el mecanismo real del gate.
    const saboteado: typeof superficieReal = {
      ...superficieReal,
      '/embarques': { ...superficieReal['/embarques'], h1: 'El Cruce' },
    };
    expect(saboteado).not.toEqual(NOMBRES);
    // Y cae POR SU razón: la diferencia está en /embarques, no en otra ruta.
    expect(saboteado['/embarques'].h1).not.toBe(NOMBRES['/embarques'].h1);
    expect(saboteado['/embarques/historico']).toEqual(NOMBRES['/embarques/historico']);
  });

  it('una pantalla NUEVA sin nombre decidido también enrojece', () => {
    const conIntrusa: typeof superficieReal = { ...superficieReal, '/pantalla-nueva': { h1: 'Sin decidir' } };
    expect(conIntrusa).not.toEqual(NOMBRES);
  });

  it('el derivador de rutas quita los grupos y el sufijo', () => {
    expect(rutaDe('src/app/(app)/embarques/page.tsx')).toBe('/embarques');
    expect(rutaDe('src/app/(app)/catalogo/[sku]/page.tsx')).toBe('/catalogo/[sku]');
    expect(rutaDe('src/app/(app)/page.tsx')).toBe('/');
  });
});

describe('[2.0.1-B · R-2] por qué NO se vigiló con una lista negra de cadenas', () => {
  it('el renombre FUE un intercambio: «Embarques» sigue viva y ya no es la misma pantalla', () => {
    // No es una curiosidad: es la razón de que el gate mire superficies y no
    // cadenas, y se prueba en vez de argumentarse — el día que alguien proponga
    // «un grep que exija cero “Embarques”», esta prueba es la respuesta.
    //
    // ANTES: /cruce era «El Cruce» y /embarques era «Embarques».
    // AHORA: /embarques es «Embarques» (el pipeline) y el histórico se mudó.
    expect(NOMBRES['/embarques'].nav).toBe('Embarques');
    expect(NOMBRES['/embarques/historico'].nav).toBe('Histórico de embarques');

    // La cadena que un barrido habría llamado «vieja» está VIVA en el árbol, y
    // debe estarlo: un grep de «no queda ninguna Embarques» habría salido rojo
    // sobre el nombre nuevo, y uno de «sigue habiendo Embarques» habría salido
    // verde sin mirar nada. Sólo la SUPERFICIE distingue una de otra.
    const superficiesQueDicenEmbarques = Object.entries(NOMBRES).filter(([, n]) =>
      [n.nav, n.cintillo, n.h1, n.movil].some((s) => s === 'Embarques'),
    );
    expect(superficiesQueDicenEmbarques.map(([r]) => r)).toEqual(['/embarques']);
  });

  it('«En Aduana» es un DATO y no entró en el renombre', () => {
    // Viene de `estatus_catalogo`, no de la interfaz. El cintillo «Aduana» del
    // histórico sí es copy y sí está gobernado aquí; el estatus no. Misma
    // palabra, dos naturalezas — y por eso el gate no puede ser textual.
    expect(NOMBRES['/embarques/historico'].cintillo).toBe('Aduana');
    const cruceTest = leer('src/components/cruce/cruce-view.test.tsx');
    expect(cruceTest, 'el estatus vive en las pruebas del pipeline como dato de la base').toContain('"En Aduana"');
  });
});
