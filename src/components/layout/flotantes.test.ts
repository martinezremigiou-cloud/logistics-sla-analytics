// ============================================================
// [INV-B11] O6 · LA GUARDA DE LOS ELEMENTOS FLOTANTES.
//
// La guarda se pidió como CLASE y no como caso:
//
//     «En la evidencia visual, por cada ancho: ningún par de elementos
//      flotantes simultáneamente interactivos se solapa.»
//
// Y la razón de que sea clase: sin ella, **el siguiente elemento flotante
// repite el defecto** y lo vuelve a encontrar una persona en un pase, no el arnés.
//
// ────────────────────────────────────────────────────────────
// CÓMO SE COMPRUEBA, Y QUÉ NO PUEDE COMPROBAR.
//
// No se mide geometría: `renderToStaticMarkup` no calcula layout, así que
// «solaparse» no es observable desde aquí. Lo que SÍ es observable —y es lo que
// causó el defecto— es **a qué borde ancla cada uno**. Los dos anclaban a
// `right-6`, y de ahí salió todo.
//
// Así que se comprueba la REGLA, que es más fuerte que el caso:
//
//     > Izquierda es lo tuyo. Derecha es el asistente.
//
// Con la regla puesta, la colisión no se evita: **se vuelve irrepresentable** a
// todo ancho y en todo estado. Y se comprueba leyendo el CÓDIGO FUENTE, con el
// mismo molde que la guarda de tokens de color de B10 — porque las clases de
// anclaje son constantes de texto, no algo que el DOM revele.
//
// LÍMITE DECLARADO: esto no ve el eje vertical ni los tamaños. Un elemento
// nuevo que anclara a la izquierda ENCIMA de la Selección pasaría esta guarda.
// Lo que cubre es el eje que falló y la clase de defecto que lo causó.
//
// [2.0.1-A] ESE LÍMITE YA TIENE INSTRUMENTO: `npm run layout-check` (B11-1)
// mide los rects REALES de los flotantes interactivos en los cuatro anchos
// (aserción A3, `src/lib/layout-check/predicados.ts`) — y en su estreno cazó
// justo la clase que este límite declaraba invisible (la burbuja sobre la
// BottomNav a 390, H1 del doc del bloque). Esta guarda sigue valiendo por lo
// suyo: corre en la suite (segundos) y fija las CLASES de anclaje; el
// instrumento corre a propósito y fija el EFECTO.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANCLAJES } from '@/components/seleccion/panel-seleccion';

const fuente = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Las clases de anclaje horizontal que declara un `className` con `fixed`. */
function bordesDe(texto: string): { izquierda: string[]; derecha: string[] } {
  const izquierda = Array.from(texto.matchAll(/\b(?:sm:|md:|lg:)?left-[\w[\]().%-]+/g)).map((m) => m[0]);
  const derecha = Array.from(texto.matchAll(/\b(?:sm:|md:|lg:)?right-[\w[\]().%-]+/g)).map((m) => m[0]);
  return { izquierda, derecha };
}

describe('[INV-B11] izquierda es lo tuyo, derecha es el asistente', () => {
  // El anclaje del chat vive en dos `className` de su componente (cerrado y
  // abierto). Se lee el archivo entero: si alguien agrega un tercer estado, la
  // guarda lo ve sin que nadie se acuerde de actualizarla.
  const burbuja = fuente('src/components/chat/burbuja-chat.tsx');

  it('la Selección flotante ancla a la IZQUIERDA en escritorio', () => {
    const b = bordesDe(ANCLAJES.flotante);
    expect(b.izquierda, 'la Selección dejó de anclar a la izquierda').toContain('md:left-6');
    expect(
      b.derecha.filter((c) => c.startsWith('md:')),
      'la Selección volvió a reclamar la esquina derecha, que es del asistente',
    ).toEqual([]);
  });

  it('el asistente ancla a la DERECHA, y no reclama la izquierda', () => {
    const b = bordesDe(burbuja);
    expect(b.derecha.some((c) => c.includes('right-')), 'el asistente dejó de anclar a la derecha').toBe(true);
    expect(
      b.izquierda.filter((c) => c.startsWith('md:') || c.startsWith('sm:')),
      'el asistente reclamó el borde izquierdo, que es de la Selección',
    ).toEqual([]);
  });

  // ============================================================
  // EL CONTROL POSITIVO. Sin él, un `bordesDe` roto —que devolviera listas
  // vacías siempre— pondría las dos de arriba en verde y la guarda no miraría
  // nada. Es el troceador que no troceaba, en una guarda de layout.
  // ============================================================
  it('control positivo · el extractor SÍ encuentra clases', () => {
    const b = bordesDe('fixed md:left-6 md:right-6 bottom-5');
    expect(b.izquierda).toEqual(['md:left-6']);
    expect(b.derecha).toEqual(['md:right-6']);
  });
});

describe('[INV-B11] la excepción modal, DECLARADA por nombre', () => {
  // ============================================================
  // A 390 px el chat abierto ocupa el ancho entero y **no hay reparto espacial
  // posible**. Ahí es una superficie MODAL —como el sidebar, que en ese ancho
  // ya es un `Sheet`— y la Selección queda debajo SIN cerrarse.
  //
  // La excepción se nombra en vez de saltarse: una guarda que omite «lo que dé
  // problemas» deja de guardar. Esta prueba existe para que el día que alguien
  // quiera quitar el `inset-x-3` del chat abierto, tenga que leer por qué está.
  // ============================================================
  it('bajo `md` el chat abierto ocupa el ancho entero, y eso es deliberado', () => {
    const burbuja = fuente('src/components/chat/burbuja-chat.tsx');
    expect(burbuja, 'el chat abierto dejó de ser ancho completo en móvil').toContain('inset-x-3');
    // Y en `sm` para arriba vuelve a su esquina: la excepción es SOLO del
    // ancho donde no cabe otra cosa.
    expect(burbuja).toContain('sm:right-6');
  });

  it('la Selección NO se cierra al abrir el chat: no hay tal acoplamiento', () => {
    // Decisión de producto: cerrar el panel toca estado que el usuario construyó a
    // mano, y verlo desaparecer se lee como «se perdió». Tapar es recuperable.
    const burbuja = fuente('src/components/chat/burbuja-chat.tsx');
    expect(burbuja, 'el chat aprendió a cerrar la Selección').not.toContain('setPanelAbierto');
    expect(burbuja).not.toContain('useSeleccion');
  });
});

describe('[INV-B11] la Selección no desaparece cuando no hay sidebar', () => {
  // Requisito literal: «el panel no puede desaparecer con él — ahí es
  // donde hoy vive y donde el usuario lo espera».
  const shell = fuente('src/components/layout/app-shell.tsx');

  it('colapsado, la píldora flota a TODOS los anchos', () => {
    // La condición se parte en dos mitades porque cada una la sabe un sistema
    // distinto: el colapso lo sabe React, el ancho lo sabe el CSS.
    expect(shell).toContain('colapsado ? undefined : "md:hidden"');
  });

  it('el pie del sidebar solo la pinta EXPANDIDO, y el cajón de móvil nunca', () => {
    expect(shell, 'el sidebar colapsado dejaría un panel recortado en el árbol').toContain(
      'mostrarSeleccion={!colapsado}',
    );
    expect(shell, 'el cajón de móvil duplicaría la Selección').toContain('mostrarSeleccion={false}');
  });
});
