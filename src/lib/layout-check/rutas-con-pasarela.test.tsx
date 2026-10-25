// ============================================================
// [2.0.1-B · S-1] rutas-con-pasarela.test.tsx — EL CONTROL POSITIVO DE LA
// DECLARACIÓN.
//
// ────────────────────────────────────────────────────────────
// QUÉ AFIRMA `RUTAS_CON_PASARELA`, y por qué necesita testigo.
//
// Poner una ruta en esa lista no describe: AFIRMA que esa pantalla monta un
// carril con un control de avance que el arnés puede encontrar y pulsar. Si la
// afirmación es falsa, el arnés saca ese caso SIN MEDIR — que es el
// comportamiento correcto, pero llega tarde: hay que levantar un navegador para
// enterarse.
//
// Este archivo lo adelanta. Por cada ruta declarada renderiza la pantalla de
// verdad y comprueba que el control EXISTE, con el mismo atributo que el arnés
// busca. Es la mitad que se puede cerrar sin navegador, y es justo la mitad que
// se rompe sola: alguien renombra el atributo, o mueve el botón, o declara una
// ruta que todavía no tiene carril.
//
// ────────────────────────────────────────────────────────────
// LO QUE NO PUEDE VER, dicho para que un verde de aquí no se lea de más.
//
// **En jsdom toda geometría vale 0.** El control de la pasarela se habilita
// comparando `scrollLeft + clientWidth` contra `scrollWidth`, y con los tres en
// cero la flecha sale SIEMPRE deshabilitada, haya dos tarjetas o cuarenta. Así
// que la segunda mitad de `decidirPasarela` —«el control existe pero está
// deshabilitado»— **no se puede ejercer aquí**, y fingir que sí sería el P25 de
// manual: verde por la razón equivocada.
//
// Esa mitad la atestigua el navegador, y es exactamente para lo que existe el
// estado `pasarela-avanzada` del `layout-check`. Lo que este archivo garantiza
// es que cuando esa corrida ocurra, no se caiga por la mitad tonta.
// ============================================================
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { soloCodigo } from "@/lib/guardas/codigo-fuente";
import { RUTAS_CON_PASARELA } from "./escenarios";
import { ATRIBUTO_AVANZAR, decidirPasarela } from "./pasarela";
import { ProyectosPasarela } from "@/components/proyectos/proyectos-pasarela";
import type { ProyectoResumen } from "@/types/proyectos";

function proyecto(over: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: null,
    notas: null,
    fecha: "2026-04-30",
    tipo: null,
    intencion: "Cotización",
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: 3,
    piezas: 400,
    ...over,
  };
}

/**
 * Qué montar por cada ruta declarada. Se monta el CARRIL y no la vista entera a
 * propósito: la vista decide la rama con `matchMedia`, y stubearlo aquí metería
 * en esta guarda una segunda cosa que puede fallar por su cuenta. Lo que se
 * afirma es «esta ruta tiene un carril con control»; que la vista lo elija en el
 * ancho correcto es de `proyectos-view.test.tsx`.
 */
const PANTALLA: Record<string, () => ReactElement> = {
  "/proyectos": () => <ProyectosPasarela proyectos={[proyecto(), proyecto({ id: "2", folio: "PRJ-002" })]} />,
};

describe("[2.0.1-B · S-1] cada ruta de RUTAS_CON_PASARELA cumple lo que declara", () => {
  it("la lista NO está vacía — si lo estuviera, todo lo de abajo sería vacuo", () => {
    // P17 sobre esta misma guarda: con la lista vacía el `for` de abajo no
    // correría ni una vez y el archivo saldría verde sin mirar nada. Mientras
    // estuvo vacía eso era correcto, y por eso la afirmación va explícita.
    expect(RUTAS_CON_PASARELA.length).toBeGreaterThan(0);
    expect(RUTAS_CON_PASARELA).toContain("/proyectos");
  });

  it("toda ruta declarada tiene pantalla que montar aquí — no se puede declarar a ciegas", () => {
    // Sin esto, agregar una ruta a la lista sin agregarla a `PANTALLA` haría que
    // el `for` la saltara en silencio: la guarda seguiría verde y la ruta nueva
    // no tendría testigo. La declaración y su prueba se obligan mutuamente.
    const sinPantalla = RUTAS_CON_PASARELA.filter((r) => !(r in PANTALLA));
    expect(
      sinPantalla,
      `estas rutas declaran pasarela y nadie comprueba que la tengan: ${sinPantalla.join(", ")}`,
    ).toEqual([]);
  });

  for (const ruta of RUTAS_CON_PASARELA) {
    it(`${ruta} expone el control [${ATRIBUTO_AVANZAR}] que el arnés va a buscar`, () => {
      const { container } = render(PANTALLA[ruta]());
      const control = container.querySelector(`[${ATRIBUTO_AVANZAR}]`);
      expect(
        control,
        `${ruta} está en RUTAS_CON_PASARELA pero no monta el control de avance. El arnés sacaría ` +
          "su caso SIN MEDIR, y para enterarse habría que levantar un navegador.",
      ).not.toBeNull();

      // El mismo hecho, pasado por la decisión de verdad: con el control puesto,
      // el motivo YA NO puede ser «no se encontró su control». Esta es la mitad
      // de `decidirPasarela` que la declaración vuelve comprobable, y se ejerce
      // con el DOM real y no con un par de booleanos inventados.
      const conDom = decidirPasarela({ hayControl: control !== null, deshabilitado: false });
      expect(conDom.medir).toBe(true);
      expect(conDom.motivo).toBeNull();
    });
  }

  it("control positivo · la guarda SÍ se cae cuando el control no está", () => {
    // Lo que separa esta guarda de un adorno (P19): se comprueba que el
    // detector distinga. Una pasarela sin proyectos no monta carril alguno, y
    // ahí la decisión vuelve a acusar la DECLARACIÓN, que es lo que tiene que
    // doler.
    const { container } = render(<ProyectosPasarela proyectos={[]} />);
    // El carril vacío sigue trayendo sus flechas, así que el caso de «no hay
    // control» se construye quitándolo del DOM — que es lo que vería el arnés si
    // alguien renombrara el atributo.
    container.querySelector(`[${ATRIBUTO_AVANZAR}]`)?.remove();
    const sinControl = decidirPasarela({ hayControl: container.querySelector(`[${ATRIBUTO_AVANZAR}]`) !== null, deshabilitado: false });
    expect(sinControl.medir).toBe(false);
    expect(sinControl.motivo).toContain("RUTAS_CON_PASARELA");
  });

  it("y el ARNÉS sigue cableando esa decisión — la rama no puede desaparecer en silencio", () => {
    // El `.mjs` es la única capa que ninguno de los tres instrumentos vigila, y
    // ahora que la lista NO está vacía esa rama sí se recorre en cada corrida.
    // Esto es lectura de TEXTO y no ejecución —el límite, dicho, igual que en
    // `arnes-cuentas.test.ts`—: no prueba que el arnés lea bien la página, sino
    // que las tres piezas sigan escritas. Si alguien borra el `decidirPasarela`
    // y vuelve a decidir a mano dentro del `.mjs`, aquí se entera.
    const codigo = soloCodigo(readFileSync(join(process.cwd(), "scripts", "layout-check.mjs"), "utf8"));
    expect(codigo).toContain("decidirPasarela");
    expect(codigo).toContain("ATRIBUTO_AVANZAR");
    expect(codigo, "el arnés dejó de leer si el control está deshabilitado").toMatch(/isDisabled\(\)/);
    // Y ESPERA a que el control aparezca antes de preguntar. Sin esto el arnés
    // mide el ESQUELETO: `/proyectos` lo pinta hasta que resuelve su fetch, y a
    // los 350 ms de `load` el control valía 0 incluso a 1280 — medido. Quitar
    // esta espera devuelve un SIN MEDIR que depende del reloj, no de la pantalla.
    //
    // Se busca la FORMA (`.waitFor({ state:`) y no el texto `'visible'`, y la
    // razón es el límite que `soloCodigo` declara en su propio JSDoc: vacía el
    // contenido de las cadenas. Pedir `'visible'` aquí salió rojo sobre un arnés
    // correcto — la guarda buscando un dato que su propia contramedida borra.
    expect(codigo, "el arnés volvió a preguntar por el control sin esperarlo").toMatch(/\.waitFor\(\{\s*state:/);
  });

  it("y en jsdom el control sale SIEMPRE deshabilitado — por eso esa mitad es del navegador", () => {
    // No es un defecto del componente: es que `scrollWidth`, `clientWidth` y
    // `scrollLeft` valen 0, así que `puedeDer` no puede ser cierto. Se AFIRMA en
    // vez de dejarlo implícito, porque de otro modo alguien escribiría mañana
    // una prueba «la flecha se habilita con dos tarjetas» que pasaría en verde
    // sin medir nada el día que el componente se rompa.
    render(<ProyectosPasarela proyectos={[proyecto(), proyecto({ id: "2", folio: "PRJ-002" })]} />);
    expect(screen.getByRole("button", { name: "Ver más proyectos" })).toBeDisabled();
  });
});
