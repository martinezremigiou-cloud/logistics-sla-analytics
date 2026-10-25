import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProyectosPasarela, pasoDe, hayTarjetaAntes, hayTarjetaDespues, flechasDe } from "./proyectos-pasarela";
import { ATRIBUTO_AVANZAR } from "@/lib/layout-check/pasarela";
import type { ProyectoResumen } from "@/types/proyectos";

// ============================================================
// [2.0.1-B · S-1] Lo que ESTA prueba puede y no puede afirmar.
//
// PUEDE: el marcado (lista de verdad, no un `div` con `onClick`), los controles
// y su contrato con el arnés, y la regla del huérfano.
//
// NO PUEDE: nada geométrico. En jsdom `getBoundingClientRect` devuelve ceros y
// `scrollBy` es un no-op del setup, así que una aserción sobre el
// desplazamiento pasaría SIEMPRE — el P25 servido en bandeja que la spec de S-1
// nombró. Por eso el cálculo del paso se prueba como función pura, y el
// cableado real solo lo puede atestiguar el estado `pasarela-avanzada` del
// `layout-check`, en navegador.
//
// [S-1] `RUTAS_CON_PASARELA` ya declara `/proyectos`, así que ese caso existe y
// se recorre. Lo que la declaración afirma —que esta pantalla monta el control—
// se comprueba sin navegador en `src/lib/layout-check/rutas-con-pasarela.test.tsx`.
// ============================================================

function proyecto(over: Partial<ProyectoResumen> = {}): ProyectoResumen {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    folio: "PRJ-001",
    titulo: "Rollout Retailer9 Series2 Q2",
    descripcion: "Despliegue en 40 tiendas.",
    notas: null,
    fecha: "2026-04-30",
    tipo: "Rollout",
    intencion: "Cotización",
    responsable: "kam@example.com",
    creado_en: "2026-04-01T12:00:00.000Z",
    skus: 3,
    piezas: 400,
    ...over,
  };
}

describe("ProyectosPasarela", () => {
  it("es una LISTA, y se anuncia como tal — sin aria-roledescription", () => {
    render(<ProyectosPasarela proyectos={[proyecto()]} />);
    const lista = screen.getByRole("list", { name: "Proyectos" });
    expect(lista.tagName).toBe("UL");
    // Decisión de producto, por razón y no por omisión: `aria-roledescription`
    // sustituiría la semántica nativa por una cadena en español. La pasarela es
    // un hecho visual; para un lector de pantalla esto sigue siendo una lista.
    expect(lista).not.toHaveAttribute("aria-roledescription");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("expone el control que el layout-check busca, y con objetivo táctil de 44", () => {
    render(<ProyectosPasarela proyectos={[proyecto(), proyecto({ id: "2", folio: "PRJ-002" })]} />);
    const avanzar = screen.getByRole("button", { name: "Ver más proyectos" });
    // El contrato con el arnés: una sola fuente para el atributo, importada de
    // `layout-check/pasarela.ts`. Si alguien lo renombra aquí, el estado
    // `pasarela-avanzada` saldría SIN MEDIR — que es lo correcto, pero esta
    // línea lo convierte en rojo antes de llegar al navegador.
    expect(avanzar).toHaveAttribute(ATRIBUTO_AVANZAR);
    // 44×44 aunque el ícono mida 16: el criterio del encargo, aquí con sujeto.
    expect(avanzar.className).toContain("h-11");
    expect(avanzar.className).toContain("w-11");
  });

  it("las dos flechas arrancan deshabilitadas cuando no hay a dónde ir", () => {
    // [F-1] En jsdom `getBoundingClientRect()` devuelve todo en cero: el
    // borde de la primera/última tarjeta y el borde del carril valen 0, así
    // que `hayTarjetaAntes`/`hayTarjetaDespues` dan `false` para los dos
    // lados. Ya NO es que «scrollWidth === clientWidth» —ese criterio se
    // retiró—: es que sin geometría real no hay borde que comparar, y el
    // arnés lo trata como SIN MEDIR, no como verde.
    render(<ProyectosPasarela proyectos={[proyecto()]} />);
    expect(screen.getByRole("button", { name: "Ver más proyectos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ver proyectos anteriores" })).toBeDisabled();
  });

  it("EL RESCATE SOLO EN LOS HUÉRFANOS — la regla que la mudanza a pasarela casi se lleva", () => {
    // `onReasignar` llega definido cuando quien mira es admin, pero el botón
    // solo debe existir si ADEMÁS el proyecto no tiene responsable. Al mover la
    // lista a pasarela esa segunda mitad se quedó un momento en el camino y el
    // rescate habría salido en las nueve tarjetas. Invariante de la 0025.
    const onReasignar = vi.fn();
    render(
      <ProyectosPasarela
        proyectos={[proyecto({ id: "a", responsable: "kam@example.com" }), proyecto({ id: "b", folio: "PRJ-002", responsable: null })]}
        onReasignar={onReasignar}
      />,
    );
    // Uno solo, no dos: el que no tiene dueño.
    expect(screen.getAllByRole("button", { name: "Reasignar" })).toHaveLength(1);
  });

  it("y sin permiso no hay rescate en ninguna, ni siquiera en la huérfana", () => {
    render(<ProyectosPasarela proyectos={[proyecto({ responsable: null })]} />);
    expect(screen.queryByRole("button", { name: "Reasignar" })).not.toBeInTheDocument();
  });

  it("el paso se calcula sumando ancho y hueco, y se redondea", () => {
    // La única parte del desplazamiento que se puede probar sin navegador.
    expect(pasoDe(320, 14)).toBe(334);
    expect(pasoDe(320.4, 14.2)).toBe(335);
    // Control positivo: con geometría 0 —jsdom— el paso es 0, y por eso ninguna
    // prueba de DOM sobre el scroll significaría nada aquí.
    expect(pasoDe(0, 0)).toBe(0);
  });

  // ============================================================
  // [F-1] CONTROL POSITIVO: el criterio viejo se enciende con el `p-3` del
  // carril contado como «todavía hay a dónde ir»; el nuevo compara bordes.
  //
  // Geometría de referencia: tarjeta de 320 px, `gap-3.5` (14) y `p-3` (12) en
  // un carril de 3 tarjetas → `scrollWidth = 320*3 + 14*2 + 12*2 = 1012`. La
  // 3.ª tarjeta (borde derecho 1000, medido desde el borde izquierdo del
  // carril) ya está ENTERA en pantalla desde `scrollLeft = 300` en adelante —
  // con el criterio viejo (`scrollLeft + clientWidth < scrollWidth - 1`) la
  // flecha derecha seguía encendida con `scrollLeft` entre 300 y 310.
  // ============================================================
  it("hayTarjetaDespues compara BORDES, no relleno del carril", () => {
    // El borde derecho del carril (988) cae ANTES del borde derecho de la
    // última tarjeta (1000): todavía queda tarjeta por ver.
    expect(hayTarjetaDespues(1000, 988)).toBe(true);
    // Los bordes coinciden: la última tarjeta ya está entera a la vista.
    expect(hayTarjetaDespues(1000, 1000)).toBe(false);
    // El borde del carril quedó por delante del de la tarjeta: nada que ver.
    expect(hayTarjetaDespues(999, 1000)).toBe(false);
  });

  it("hayTarjetaAntes es el simétrico a la izquierda", () => {
    expect(hayTarjetaAntes(-12, 0)).toBe(true);
    expect(hayTarjetaAntes(0, 0)).toBe(false);
    expect(hayTarjetaAntes(0.5, 0)).toBe(false);
  });

  // ============================================================
  // [revisor-codigo · MEDIO] LA HOLGURA DE ±1 PX, PINNEADA DE VERDAD.
  //
  // Los seis casos de arriba dan el MISMO resultado con o sin el `- 1`/`+ 1`
  // de tolerancia (el revisor los tabuló): por ejemplo `hayTarjetaAntes(0.5,
  // 0)` da `false` tanto si el criterio es `< bordeIzqCarril` como si es
  // `< bordeIzqCarril - 1`. Estos dos SÍ discriminan: sin la tolerancia,
  // `-0.5 < 0` sería `true` y `1000 > 999.5` sería `true` — con ella, los dos
  // dan `false`. Si alguien borra el `- 1`/`+ 1`, ESTOS se ponen rojos.
  // ============================================================
  it("la holgura de ±1 px SÍ cambia el resultado — sin ella estos dos darían lo contrario", () => {
    expect(hayTarjetaAntes(-0.5, 0)).toBe(false);
    expect(hayTarjetaDespues(1000, 999.5)).toBe(false);
  });

  // ============================================================
  // [revisor-codigo · ALTO] `flechasDe`: EL CABLEADO COMPLETO, PROBADO JUNTO.
  //
  // Escenario real de 3 tarjetas de 320 px, `gap-3.5` (14) y `p-3` (12):
  // contenido [12,332] [346,666] [680,1000], `scrollWidth = 1012`. Con el
  // carril SIN desplazar (`scrollLeft=0`, visible [0,700]): la 1.ª tarjeta
  // empieza en 12 (después del borde izquierdo, nada que retroceder) y la
  // última termina en 1000 (muy después del borde derecho visible 700, sí
  // hay que avanzar). Con el carril desplazado al FINAL (`scrollLeft=300`,
  // visible [300,1000] en coordenadas de contenido, o lo mismo dicho en
  // pantalla: la 1.ª tarjeta quedó en -288 —detrás del borde izquierdo, sí
  // hay que retroceder— y la última en 700 —exactamente el borde derecho,
  // nada que avanzar—.
  //
  // Las dos mitades en un solo call cada una: si alguien invirtiera los
  // parámetros de izquierda/derecha dentro de `flechasDe`, este par de
  // aserciones (`true`/`false` en un caso, `false`/`true` en el otro) lo
  // delata — un caso simétrico (mismo valor en ambos lados) no lo haría.
  // ============================================================
  it("flechasDe compone hayTarjetaAntes/hayTarjetaDespues sin cruzar los lados", () => {
    // Al inicio del carril: nada que retroceder, sí que avanzar.
    expect(flechasDe(12, 1000, 0, 700)).toEqual({ puedeIzq: false, puedeDer: true });
    // Al final del carril: sí que retroceder, nada que avanzar.
    expect(flechasDe(-288, 700, 0, 700)).toEqual({ puedeIzq: true, puedeDer: false });
  });
});
