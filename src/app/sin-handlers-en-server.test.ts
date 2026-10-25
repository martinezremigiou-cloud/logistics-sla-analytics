// ============================================================
// [2.0.1-B · S-1] LA CONTRAMEDIDA DEL DEFECTO QUE NUEVE PRUEBAS VERDES NO VIERON.
//
// ────────────────────────────────────────────────────────────
// EL DEFECTO, medido el 31-ago en el navegador.
//
// `/control-estados` colgaba el renderer: `captureScreenshot` a 30 s,
// `executeScript` a 45 s, y el título de la pestaña se quedaba en la URL cruda
// — señal de que **el documento nunca terminaba**. En el log del server, diez
// veces: `Error: Event handlers cannot be passed to Client Component props.`
//
// La causa: el `page.tsx` era Server Component y pasaba `onNuevo={() => {}}` a
// un componente `"use client"`. React no puede serializar una función a través
// de esa frontera. **No es un error de compilación ni un 500 legible: es un
// documento que no cierra.**
//
// ────────────────────────────────────────────────────────────
// POR QUÉ ESTA GUARDA ES DE FUENTE Y NO OTRA PRUEBA DE RENDER.
//
// El gate de esa ruta tenía NUEVE pruebas en verde mientras la ruta no abría.
// No estaban mal escritas: en vitest se llama a `Page()` como una función
// corriente, y **ahí la frontera RSC no existe**. Ninguna prueba de este
// entorno puede reproducir la condición — es la misma forma que la geometría en
// jsdom, donde `getBoundingClientRect` devuelve ceros y cualquier aserción
// pasaría.
//
// Cuando el entorno de prueba no puede reproducir el fallo, la contramedida no
// es otra prueba en ese entorno: es una guarda que lea el FUENTE y niegue la
// forma que lo produce.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTA GUARDA NO VE, declarado sin adornos: caza la función ESCRITA EN
// EL SITIO (`onX={() => …}`, `onX={function …}`). Una función pasada por
// REFERENCIA desde un Server Component —`onX={algo}`— rompería igual y esto no
// la vería, porque desde el texto no se distingue de pasar un dato. La forma
// literal es la que se comete al maquetar, y es la que se cometió aquí.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '@/lib/guardas/codigo-fuente';

const raiz = process.cwd();

function archivos(dir: string, salida: string[] = []): string[] {
  for (const e of readdirSync(join(raiz, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) archivos(rel, salida);
    else if (/\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name)) salida.push(rel);
  }
  return salida;
}

/** Un módulo es Server Component si NO se declara cliente en su primera línea útil. */
export function esServidor(fuente: string): boolean {
  return !/^\s*(["'])use client\1/m.test(fuente.slice(0, 400));
}

/** `onAlgo={() => …}` / `onAlgo={function …}` / `onAlgo={async …}` — la función escrita en el sitio. */
export const MANEJADOR_EN_SITIO = /\bon[A-Z]\w*=\{\s*(\(|async\b|function\b)/;

describe('[2.0.1-B] ningún Server Component pasa un manejador escrito en el sitio', () => {
  const paginas = archivos('src/app');

  it('el escáner encuentra archivos de verdad (si no, lo de abajo es vacuo)', () => {
    expect(paginas.length).toBeGreaterThan(10);
    // Y encuentra las dos clases: si todo saliera «cliente» la guarda no miraría nada.
    const servidores = paginas.filter((p) => esServidor(readFileSync(join(raiz, p), 'utf8')));
    expect(servidores.length).toBeGreaterThan(3);
    expect(servidores.length).toBeLessThan(paginas.length);
  });

  it('ninguno lo hace', () => {
    const culpables = paginas.filter((p) => {
      const fuente = readFileSync(join(raiz, p), 'utf8');
      return esServidor(fuente) && MANEJADOR_EN_SITIO.test(sinComentarios(fuente));
    });
    expect(
      culpables,
      'un Server Component pasa una función a un componente client. React no puede serializarla: ' +
        'el síntoma NO es un 500 — el documento no termina y el renderer se cuelga. Mueve el manejador ' +
        'al lado client (ver `control-estados.tsx`).',
    ).toEqual([]);
  });

  it('control positivo · el detector caza la forma exacta que se cometió, y no confunde a un client', () => {
    // La línea real que colgaba la ruta:
    expect(MANEJADOR_EN_SITIO.test('<ProyectosVacio onNuevo={() => {}} />')).toBe(true);
    expect(MANEJADOR_EN_SITIO.test('<X onReasignar={async () => {}} />')).toBe(true);
    expect(MANEJADOR_EN_SITIO.test('<X onClick={function () {}} />')).toBe(true);
    // Lo que NO debe marcar: pasar una referencia o un dato.
    expect(MANEJADOR_EN_SITIO.test('<X onNuevo={sinEfecto} />')).toBe(false);
    expect(MANEJADOR_EN_SITIO.test('<X titulo={"hola"} />')).toBe(false);
    // Y la PROSA no es codigo: un comentario que cuenta el defecto no es el defecto.
    expect(MANEJADOR_EN_SITIO.test(sinComentarios('// la version vieja pasaba onNuevo={() => {}} desde el server'))).toBe(false);
    expect(MANEJADOR_EN_SITIO.test(sinComentarios('/* onClick={() => {}} */ <X />'))).toBe(false);
    // Y un componente client puede escribirlos: la regla es de la frontera, no del estilo.
    expect(esServidor('"use client";\nexport function X() {}')).toBe(false);
    expect(esServidor('import { notFound } from "next/navigation";')).toBe(true);
  });
});
