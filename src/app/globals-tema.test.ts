// ============================================================
// [2.0.1-B · S] globals-tema.test.ts — TODO COLOR GIRA CON EL TEMA.
//
// ────────────────────────────────────────────────────────────
// LA PROPIEDAD, ENUNCIADA BIEN.
//
// La restricción del encargo se escribió como «cero hex crudo», y eso era un
// PROXY, no la propiedad. `tailwind.config.ts` define `sidebar`, `danger`,
// `brand-50` y `navy-*` como hex literales: usarlos no deja un `#` a la vista en
// el JSX y aun así **no giran con el tema** — `bg-brand-50` es crema fija sobre
// un fondo oscuro. La propiedad que de verdad importa es:
//
//   > **Todo color que pinte una superficie de la interfaz tiene que tener un
//   > valor para claro y otro para oscuro.**
//
// Este archivo cierra la mitad que se puede cerrar mecánicamente: que ningún
// token de color de `:root` se quede sin contraparte en `.dark`. La otra mitad
// —no usar los alias de hex fijo en superficies que cambian con el tema— no es
// decidible desde el CSS y vive en la spec de S-1.
//
// ────────────────────────────────────────────────────────────
// POR QUÉ NO BASTABA CON EL GUARDIÁN QUE YA HABÍA.
//
// `src/services/documento/tokens.globals.test.ts` compara los tokens del
// documento **solo contra `:root`, nunca contra `.dark`**, y su alcance es
// CORRECTO: el papel no tiene tema, y comparar contra el bloque oscuro exigiría
// un azul claro sobre papel blanco. No se toca.
//
// Pero de ahí sale un hueco: **un token de color nuevo que alguien olvide en el
// bloque oscuro pasa ese gate en verde**. La interfaz necesita su propia guarda,
// y es ésta.
//
// ────────────────────────────────────────────────────────────
// QUÉ ES «COLOR» AQUÍ, y por qué no hay lista de excepciones.
//
// La distinción se DERIVA del valor, no de una lista a mano que envejezca: un
// token es de color si su valor es un hex (`#RGB`…`#RRGGBBAA`) o una terna RGB
// suelta (`46 120 199`, el molde de `rgb(var(--x) / alpha)`). Todo lo demás
// —`3.5rem`, `calc(...)`, `0.75rem`— es GEOMETRÍA y no necesita par: los
// `--mx-carril-*` son alturas del pie de pantalla, no colores.
//
// Así una familia nueva de tokens geométricos no obliga a tocar este archivo, y
// un color nuevo no puede escaparse por estar en una lista que nadie actualizó.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '@/lib/guardas/codigo-fuente';
// Los lectores de CSS viven en `@/lib/guardas/css-tokens` desde S-1: los usa
// también `apariencia-proyecto.test.ts`, y dos lectores del mismo archivo que
// puedan discrepar es cómo una guarda acaba midiendo otra cosa que la de al lado.
import { bloqueDe, tokensDe, esColor } from '@/lib/guardas/css-tokens';

/**
 * ────────────────────────────────────────────────────────────
 * [2.0.1-B · S-1] LEE CÓDIGO, NO PROSA — y esta guarda lo aprendió mordiendo.
 *
 * `bloqueDe` localiza el bloque por `indexOf(selector)`. Durante S-1 se agregó
 * al comentario de `:root` una explicación que MENCIONA `` `.dark` `` — para
 * decir por qué el token nuevo se escribe con su hex y no con un `var()`. Ese
 * `.dark` de prosa quedó **cincuenta líneas por encima del bloque `.dark` de
 * verdad**, así que el extractor tomó la llave equivocada, `oscuro` salió con un
 * token, y la guarda denunció los 35 colores del archivo como huérfanos.
 *
 * Es el mismo defecto que el ayudante compartido acaba de cerrar en otras cinco
 * guardas, y **ésta era una de las tres que quedaron marcadas como vulnerables
 * en ese commit**. Tardó una hora en pasar.
 *
 * La corrección es leer el código y no el comentario. La otra salida —reescribir
 * el comentario para que la guarda se calle— es exactamente el trueque que esta
 * casa no hace.
 */
const css = sinComentarios(readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8'));

const claro = tokensDe(bloqueDe(css, ':root'));
const oscuro = tokensDe(bloqueDe(css, '.dark'));

describe('[2.0.1-B] todo color de la interfaz gira con el tema', () => {
  it('los extractores leen tokens de verdad (si no, todo lo de abajo es vacuo)', () => {
    // P17 sobre la propia guarda: con un extractor roto los dos mapas saldrían
    // vacíos y «todos los de claro están en oscuro» sería trivialmente cierto.
    expect(Object.keys(claro).length).toBeGreaterThan(25);
    expect(Object.keys(oscuro).length).toBeGreaterThan(25);
    expect(claro['--mx-track']).toBeDefined();
    expect(oscuro['--mx-track']).toBeDefined();
  });

  it('control positivo · un `.dark` CITADO en un comentario no roba el bloque', () => {
    // La regresión, hecha prueba. Sin `sinComentarios`, el `indexOf` de
    // `bloqueDe` se queda con la mención de prosa —que aquí va ANTES, igual que
    // en el archivo real— y devuelve el bloque equivocado. Se comprueba en las
    // dos direcciones: con el ayudante encuentra el de verdad, sin él no.
    //
    // El juguete reproduce la FORMA del archivo real, y esa forma importa: mi
    // primera versión no tenía el `@media` de en medio y **pasaba sin el
    // ayudante**, porque sin ningún `{` entre la prosa y el bloque de verdad el
    // `indexOf('{')` caía igual en el bueno. Un control positivo que no
    // reproduce el defecto no controla nada (P26: el fixture prueba tu
    // COMPRENSIÓN, no tu código). Medido en `globals.css`: el `.dark` de prosa
    // está en la 44, el primer `{` que le sigue es el `@media` de la 80, y el
    // bloque real de la 98 no se llegaba a mirar.
    const juguete = ':root { /* su par en .dark */ --mx-a:#111; @media (min-width:768px) { :root { --mx-z:1rem; } } } .dark { --mx-a:#222; }';
    expect(tokensDe(bloqueDe(sinComentarios(juguete), '.dark'))).toEqual({ '--mx-a': '#222' });
    expect(tokensDe(bloqueDe(juguete, '.dark'))).not.toEqual({ '--mx-a': '#222' });
  });

  it('CADA token de color de `:root` tiene su contraparte en `.dark`', () => {
    const huerfanos = Object.entries(claro)
      .filter(([, v]) => esColor(v))
      .map(([k]) => k)
      .filter((k) => !(k in oscuro));
    expect(
      huerfanos,
      `estos tokens de color no tienen valor para el tema oscuro: ${huerfanos.join(', ')}. ` +
        'Un color sin par se queda congelado en su valor claro y aparece sobre el fondo oscuro tal cual.',
    ).toEqual([]);
  });

  it('y `.dark` no define colores que `:root` no declare', () => {
    // La otra dirección: un token que solo exista en oscuro no tiene valor por
    // omisión y en claro se resolvería a nada.
    const sinBase = Object.keys(oscuro).filter((k) => !(k in claro));
    expect(sinBase, `definidos solo en .dark: ${sinBase.join(', ')}`).toEqual([]);
  });

  it('la geometría queda fuera POR SU VALOR, no por una lista a mano', () => {
    // Los `--mx-carril-*` son alturas del pie de pantalla y no necesitan par.
    // Se comprueba que la exención sea real —existen y no son colores— para que
    // nadie la lea como un agujero.
    const geometria = Object.entries(claro).filter(([, v]) => !esColor(v));
    expect(geometria.length).toBeGreaterThan(0);
    for (const [k, v] of geometria) expect(esColor(v), `${k} = ${v}`).toBe(false);
    expect(geometria.map(([k]) => k).some((k) => k.startsWith('--mx-carril-'))).toBe(true);
  });

  it('control positivo · el detector distingue color de geometría, y caza un huérfano', () => {
    expect(esColor('#E8F1FB')).toBe(true);
    expect(esColor('#fff')).toBe(true);
    expect(esColor('46 120 199')).toBe(true);
    expect(esColor('3.5rem')).toBe(false);
    expect(esColor('calc(var(--a) + var(--b))')).toBe(false);
    // Y el extractor sobre un CSS de juguete: un color sin par se denuncia.
    const juguete = ':root { --mx-a:#111; --mx-alto:2rem; } .dark { --mx-b:#222; }';
    const c = tokensDe(bloqueDe(juguete, ':root'));
    const o = tokensDe(bloqueDe(juguete, '.dark'));
    expect(
      Object.entries(c)
        .filter(([, v]) => esColor(v))
        .map(([k]) => k)
        .filter((k) => !(k in o)),
    ).toEqual(['--mx-a']);
  });
});
