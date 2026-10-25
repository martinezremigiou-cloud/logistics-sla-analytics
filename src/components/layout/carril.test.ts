// ============================================================
// [2.0.1-A] carril.test.ts — las tres guardas del régimen del pie.
//
// `carril.ts` tiene la REGLA; `globals.css` tiene los tokens que el navegador
// entiende. Son dos copias del mismo número por necesidad (el CSS no importa
// TypeScript), así que se comparan — mismo molde que
// `documento/tokens.globals.test.ts`, que ya cerró esta clase de duplicación
// para los colores del documento.
//
// LO QUE ESTAS GUARDAS NO VEN, dicho aquí para que nadie las lea de más: leen
// TEXTO, no layout. Que el token exista y que nadie escriba su propio número no
// prueba que el pie de la pantalla quede bien — eso solo lo puede decir un
// motor de layout, y para eso está `npm run layout-check` (B11-1), que mide el
// EFECTO en los cuatro anchos. Estas corren en segundos y fijan las
// DECLARACIONES; aquél corre a propósito y fija el efecto.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sinComentarios } from '@/lib/guardas/codigo-fuente';
import {
  ALTO_PILDORA,
  ATRIBUTO_SELECCION,
  EXPRESION_DE_TOKEN,
  PISOS,
  RESERVA_CON_PILDORA,
  RESERVA_SUELO,
  RESERVA_SUELO_ESCRITORIO,
  anclaDePiso,
  reservaDeContenido,
} from './carril';

const fuente = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const globals = fuente('src/app/globals.css');

/** Extrae `--token: valor;` del CSS FUENTE (no del compilado), normalizando espacios. */
function valorDeToken(css: string, token: string): string | null {
  const m = css.match(new RegExp(`${token}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

/** Clases de anclaje vertical SIN prefijo de breakpoint (las que mandan en móvil). */
function anclajesVerticales(texto: string): string[] {
  return Array.from(sinComentarios(texto).matchAll(/(?<![\w:-])bottom-[\w[\]().%+-]+/g)).map((m) => m[0]);
}

/**
 * Clases de relleno inferior, **CON prefijo de breakpoint incluido** — al revés
 * que `anclajesVerticales`, y a propósito.
 *
 * La reserva del contenido es lo único del carril que se declara por
 * breakpoint, así que un `md:pb-*` suelto no es «territorio de O6»: es
 * exactamente la forma que tuvo el defecto. `app-shell.tsx` llamaba a
 * `reservaDeContenido(...)` y le pegaba `"md:pb-0"` fuera de la llamada, con lo
 * que la reserva derivada quedaba anulada en escritorio hubiera o no píldora —
 * la derivación intacta y su efecto en cero. Si el extractor ignorara los
 * prefijos, esta guarda sería ciega justo al caso que la motiva.
 */
function reservasInferiores(texto: string): string[] {
  return Array.from(sinComentarios(texto).matchAll(/(?<![\w:-])(?:[a-z][\w-]*:)*pb-[\w[\]().%+-]+/g)).map((m) => m[0]);
}

describe('[2.0.1-A] el carril: los tokens del CSS son los de carril.ts', () => {
  for (const [token, esperado] of Object.entries(EXPRESION_DE_TOKEN)) {
    it(`${token} coincide con globals.css`, () => {
      expect(valorDeToken(globals, token), `${token} divergió entre carril.ts y globals.css`).toBe(esperado);
    });
  }

  it('control positivo · el extractor SÍ lee tokens (y devuelve null para uno inventado)', () => {
    // Sin esto, un `valorDeToken` roto que devolviera siempre `null`... no
    // pondría verde a las de arriba (comparan contra un string), pero un
    // extractor que devolviera SIEMPRE el valor esperado sí. Se comprueba en
    // las dos direcciones: lee uno real y falla en uno que no existe.
    expect(valorDeToken(globals, '--mx-carril-hueco')).toBe('0.75rem');
    expect(valorDeToken(globals, '--mx-carril-inventado')).toBeNull();
  });

  it('cada piso declarado en carril.ts tiene su token en el CSS', () => {
    for (const piso of PISOS) {
      expect(valorDeToken(globals, piso.token), `el piso «${piso.nombre}» no tiene token en globals.css`).not.toBeNull();
    }
  });
});

describe('[2.0.1-A] el carril: nadie escribe su propio piso', () => {
  // La regla 3, hecha guarda. Antes de este bloque, CUATRO archivos escribían
  // su propio offset y «el nav mide 3.5rem» estaba escrito tres veces… en
  // ninguno de los cuales el nav lo declaraba (medía 54 px). De ahí salieron
  // H1 y H4.
  const OCUPANTES: Array<{ archivo: string; permitidos: string[] }> = [
    // El nav ES el suelo: `bottom-0` es su definición, no una suposición.
    { archivo: 'src/components/layout/bottom-nav.tsx', permitidos: ['bottom-0'] },
    { archivo: 'src/components/chat/burbuja-chat.tsx', permitidos: ['bottom-[var(--mx-carril-asistente)]'] },
    { archivo: 'src/components/seleccion/panel-seleccion.tsx', permitidos: ['bottom-[var(--mx-carril-seleccion)]'] },
    // El saludo perdió su anclaje: lo posiciona el contenedor de su zona.
    { archivo: 'src/components/chat/saludo-contextual.tsx', permitidos: [] },
  ];

  for (const ocupante of OCUPANTES) {
    it(`${ocupante.archivo} solo usa anclajes del carril`, () => {
      const hallados = anclajesVerticales(fuente(ocupante.archivo));
      const intrusos = hallados.filter((c) => !ocupante.permitidos.includes(c));
      expect(intrusos, `${ocupante.archivo} volvió a escribir su propio piso: ${intrusos.join(', ')}`).toEqual([]);
    });
  }

  it('control positivo · el extractor SÍ encuentra anclajes escritos a mano', () => {
    // El troceador que no troceaba, en una guarda de layout: si `anclajesVerticales`
    // devolviera siempre [], las cuatro de arriba pasarían sin mirar nada.
    expect(anclajesVerticales('fixed bottom-5 right-5 md:bottom-6')).toEqual(['bottom-5']);
    expect(anclajesVerticales('bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)]')).toEqual([
      'bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)]',
    ]);
    // Los prefijados por breakpoint son territorio de O6 y NO se tocan aquí.
    expect(anclajesVerticales('md:bottom-6 sm:bottom-6')).toEqual([]);
    // Y la prosa no es código: un comentario que CUENTA el anclaje viejo no es
    // un anclaje viejo. Las dos formas de comentario, porque el archivo usa las dos.
    expect(anclajesVerticales('// antes decía bottom-5, y ese 20 era la resta bottom-20')).toEqual([]);
    expect(anclajesVerticales('/* el panel llevaba bottom-[calc(3.5rem+env(x))] */ bottom-3')).toEqual(['bottom-3']);
  });
});

describe('[2.0.1-A] el carril: la reserva de contenido y el atributo de la regla 5', () => {
  const RESERVA = {
    sinPildora: { pildora: false, pildoraEnEscritorio: false },
    soloMovil: { pildora: true, pildoraEnEscritorio: false },
    tambienEscritorio: { pildora: true, pildoraEnEscritorio: true },
  } as const;

  it('sin Selección se reserva el suelo; con ella, el carril hasta el techo de la píldora', () => {
    expect(reservaDeContenido(RESERVA.sinPildora)).toBe('pb-[var(--mx-carril-suelo)]');
    expect(reservaDeContenido(RESERVA.tambienEscritorio)).toContain('var(--mx-carril-seleccion)');
    expect(reservaDeContenido(RESERVA.tambienEscritorio)).not.toBe(reservaDeContenido(RESERVA.sinPildora));
  });

  it('con píldora SÓLO en móvil, la reserva vuelve al SUELO en `md` — y no a cero', () => {
    // La regresión, hecha prueba: el sidebar expandido guarda la Selección en su
    // pie, así que de `md` para arriba no flota nada y la reserva alta sobra.
    // Pero «sobra» es volver al suelo (que en `md` ya vale ~0 más el área
    // segura), no escribir `pb-0`: un `pb-0` afirma que no hay área segura.
    const soloMovil = reservaDeContenido(RESERVA.soloMovil);
    expect(soloMovil).toContain(RESERVA_CON_PILDORA);
    expect(soloMovil).toContain(RESERVA_SUELO_ESCRITORIO);
    expect(soloMovil).not.toContain('pb-0');

    // Y con el sidebar colapsado la píldora SÍ flota en escritorio: ahí la
    // reserva alta manda en todos los anchos y NO puede haber override de `md`.
    expect(reservaDeContenido(RESERVA.tambienEscritorio)).toBe(RESERVA_CON_PILDORA);
    expect(reservaDeContenido(RESERVA.tambienEscritorio)).not.toContain('md:');
  });

  it('las clases literales (que Tailwind escanea como TEXTO) no divergen de las constantes', () => {
    // Las tres copias existen porque el extractor de Tailwind lee el fuente y
    // una plantilla no deja cadena que escanear. Que sean copias no las exime
    // de coincidir: aquí se comparan.
    expect(RESERVA_CON_PILDORA).toContain(ALTO_PILDORA);
    expect(RESERVA_SUELO_ESCRITORIO).toBe(`md:${RESERVA_SUELO}`);
  });

  it('el shell no escribe NINGÚN `pb-` propio: toda la reserva sale del carril', () => {
    // La condición que permitió la regresión, cerrada. Un `md:pb-0` pegado
    // fuera de la llamada dejaba la derivación intacta y su efecto en cero —
    // el resultado correcto por la razón equivocada, con el `md:` de por medio.
    const intrusos = reservasInferiores(fuente('src/components/layout/app-shell.tsx'));
    expect(intrusos, `app-shell.tsx volvió a escribir su propia reserva: ${intrusos.join(', ')}`).toEqual([]);
  });

  it('control positivo · el extractor de reservas SÍ ve las prefijadas por breakpoint', () => {
    // Sin esto, un extractor que ignorara los prefijos —como hace
    // `anclajesVerticales` por diseño— pondría verde a la de arriba sin mirar
    // el único caso que importa.
    expect(reservasInferiores('p-4 md:pb-0 pb-[var(--x)]')).toEqual(['md:pb-0', 'pb-[var(--x)]']);
    expect(reservasInferiores('/* antes decía md:pb-0 */ p-6')).toEqual([]);
    expect(reservasInferiores('reservaDeContenido({ pildora, pildoraEnEscritorio })')).toEqual([]);
  });

  it('el shell publica el atributo y el CSS lo consume — los dos lados existen', () => {
    // Una mitad sin la otra es una regla que no se aplica: el shell poniendo un
    // atributo que nadie lee, o un selector esperando un atributo que nadie
    // pone. Se exige el par.
    expect(fuente('src/components/layout/app-shell.tsx')).toContain('ATRIBUTO_SELECCION');
    expect(globals).toContain(`html[${ATRIBUTO_SELECCION}='1']`);
    expect(globals).toContain("[data-carril-piso='saludo']");
  });

  it('anclaDePiso devuelve la clase del token, y grita ante un piso inventado', () => {
    expect(anclaDePiso('asistente')).toBe('bottom-[var(--mx-carril-asistente)]');
    expect(anclaDePiso('seleccion')).toBe('bottom-[var(--mx-carril-seleccion)]');
    // @ts-expect-error — piso inexistente: el tipo lo impide en compilación y la
    // función lo impide en runtime (un `.find` que no encuentra devolvería
    // `undefined` y el error saldría lejos de aquí).
    expect(() => anclaDePiso('sotano')).toThrow(/piso desconocido/);
  });
});
