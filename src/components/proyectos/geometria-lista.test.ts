// ============================================================
// [2.0.1-B · S] geometria-lista.test.ts — que la vista y el esqueleto no se
// puedan volver a separar.
//
// Cierra la deuda ESQUELETO-Y-VISTA-NO-SE-COMPARAN. La guarda es de TEXTO del
// fuente y eso es deliberado: el defecto que persigue —cargar con una geometría
// y resolver con otra— **solo existe durante la transición**, así que ninguna
// prueba de DOM asentado ni el `layout-check` pueden verlo. Lo único que se
// puede vigilar mecánicamente es que las dos piezas beban de la misma fuente.
//
// LO QUE NO VE, dicho: que la rejilla se PINTE bien. Eso lo mide el navegador.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '@/lib/guardas/codigo-fuente';
import { REJILLA_LISTA, ANCHO_MINIMO_TARJETA, HUECO_TARJETAS, DIMENSIONES_TARJETA, ANCLAJE_TARJETA, CARRIL_PASARELA } from './geometria-lista';

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');


/** Los que tienen que consumir la fuente, no escribir su propia geometría. */
const CONSUMIDORES = [
  'src/components/proyectos/proyectos-view.tsx',
  'src/components/proyectos/proyectos-skeleton.tsx',
  'src/components/proyectos/evidencia-visual.test.tsx',
];

describe('[2.0.1-B] la geometría de la lista vive en un solo sitio', () => {
  for (const archivo of CONSUMIDORES) {
    it(`${archivo} consume la fuente y no escribe su propia geometría`, () => {
      const codigo = sinComentarios(leer(archivo));
      // Se exige el IMPORT, no una constante concreta: desde S-1 cada
      // consumidor usa la pieza que le toca —la vista el alto de la lista, el
      // esqueleto las dos formas, la evidencia la rejilla histórica— y anclar
      // la guarda a un nombre suelto la volvería falsa en cuanto uno cambiara
      // de pieza. Lo que no puede cambiar es de DÓNDE la saca.
      expect(codigo, `${archivo} no importa de ./geometria-lista`).toMatch(/from ["']\.\/geometria-lista["']/);
      expect(
        codigo.includes('minmax(260px'),
        `${archivo} volvió a escribir su propia rejilla. Si la vista y el esqueleto se separan, la pantalla ` +
          'carga con una geometría y resuelve con otra — y ese salto solo se ve durante la transición, que es ' +
          'justo donde ninguna prueba mira.',
      ).toBe(false);
    });
  }

  it('las piezas sueltas no divergen del literal que Tailwind escanea', () => {
    // Las piezas existen para poder comprobar esto: el literal va entero porque
    // el extractor de Tailwind lee texto, así que una plantilla no generaría la
    // clase — y una copia que no se compara es lo que este archivo vino a cerrar.
    expect(REJILLA_LISTA).toContain(ANCHO_MINIMO_TARJETA);
    expect(REJILLA_LISTA).toContain(HUECO_TARJETAS);
    expect(REJILLA_LISTA.startsWith('grid ')).toBe(true);
  });

  it('la pasarela y su esqueleto sacan su medida del MISMO token — el salto muere por construcción', () => {
    // El criterio: la diferencia al resolver es 0. No se cumple igualando
    // dos números, se cumple no teniendo dos números que igualar.
    const pasarela = sinComentarios(leer('src/components/proyectos/proyectos-pasarela.tsx'));
    const esqueleto = sinComentarios(leer('src/components/proyectos/proyectos-skeleton.tsx'));
    for (const [nombre, fuente] of [['pasarela', pasarela], ['esqueleto', esqueleto]] as const) {
      expect(fuente, nombre + ' no consume DIMENSIONES_TARJETA').toContain('DIMENSIONES_TARJETA');
      expect(fuente, nombre + ' no consume ANCLAJE_TARJETA').toContain('ANCLAJE_TARJETA');
      expect(fuente, nombre + ' no consume CARRIL_PASARELA').toContain('CARRIL_PASARELA');
      // Ni un alto en píxeles escrito a mano: ése es el defecto entero.
      expect(/h-\[\d/.test(fuente), nombre + ' escribió su propio alto en píxeles').toBe(false);
    }
    expect(DIMENSIONES_TARJETA).toMatch(/^w-\[\d+px\] h-\[\d+px\]$/);
    expect(ANCLAJE_TARJETA).toContain('snap-start');
    expect(CARRIL_PASARELA).toContain('snap-mandatory');
    // reduced-motion apagado por CSS y no por un manejador que se acuerde.
    expect(CARRIL_PASARELA).toContain('motion-reduce:scroll-auto');
  });

  it('control positivo · el detector SÍ ve una rejilla escrita a mano, y la prosa no lo engaña', () => {
    expect(sinComentarios('<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">').includes('minmax(260px')).toBe(true);
    expect(sinComentarios('// antes decía minmax(260px,1fr) y por eso existe este archivo').includes('minmax(260px')).toBe(false);
    expect(sinComentarios('<div className={REJILLA_LISTA}>').includes('minmax(260px')).toBe(false);
  });
});
