import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { paginaDeEvidencia, cssCompilado, type BloqueDeEvidencia } from "./evidencia-visual";
import { ProyectoCard } from "./proyecto-card";
import { REJILLA_LISTA } from "./geometria-lista";
import { AppShell } from "@/components/layout/app-shell";
import { CatalogoTabla } from "@/components/catalogo/catalogo-tabla";
import { FichaHeader } from "@/components/ficha/ficha-header";
import { Paginacion } from "@/components/catalogo/paginacion";
import { PanelSeleccion, ID_PANEL } from "@/components/seleccion/panel-seleccion";
import { reservaDeContenido } from "@/components/layout/carril";
import { VistaPreviaVolcado, ResultadoDelVolcado } from "@/components/seleccion/volcar-dialog";
import { SeleccionFija } from "@/components/providers/seleccion-provider";
import { agregar, SELECCION_VACIA, type Seleccion } from "@/lib/seleccion";
import { planDeVolcado, resumenDePlan } from "@/lib/volcado-plan";
import { DETALLE_PEOR_CASO, DETALLE_TOKENS_LARGOS, SKU_31 } from "@/services/documento/fixture-peor-caso";
import type { CatalogoItem } from "@/types/api";
import type { ProyectoResumen } from "@/types/proyectos";
import type { PartidaItem } from "@/types/proyectos";

// ============================================================
// Este archivo es a la vez PRUEBA y GENERADOR.
//
// Como prueba: verifica que cada escenario renderiza y produce el marcado que
// se espera — si un componente revienta al montarse sin datos, aquí se ve.
//
// Como generador: con `EVIDENCIA_VISUAL=1` escribe
// `.evidencia/proyectos/evidencia-visual.html` (+ su `evidencia.css`), que
// se abre en un navegador y se mira en los dos anchos y los dos temas.
// Escribir SIEMPRE ensuciaría el árbol en cada corrida de la suite; no escribir
// nunca dejaría el bloque sin su evidencia visual. La bandera separa las dos
// cosas sin duplicar el código.
//
//   npm run build && EVIDENCIA_VISUAL=1 npx vitest run src/components/proyectos/evidencia-visual.test.tsx
//
// LOS MOCKS DE ABAJO NO SON UN ATAJO. `AppShell` monta `Sidebar`/`Topbar`/
// `BottomNav`, que leen la ruta actual y el router de Next: fuera de la app no
// existe ninguno de los dos. Se les da el valor que tendrían en `/catalogo`,
// que es la pantalla que la evidencia retrata. Todo lo demás —clases, tokens,
// estructura— es el componente real.
// ============================================================
vi.mock("next/navigation", () => ({
  usePathname: () => "/catalogo",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/actions", () => ({ cerrarSesion: () => {} }));

const SESION = { email: "xrnpnnwwidz@example.test", rol: "kam" as const };

const proyecto = (over: Partial<ProyectoResumen> = {}): ProyectoResumen => ({
  id: "11111111-1111-1111-1111-111111111111",
  folio: "PRJ-013",
  titulo: "Proyecto de muestra · disponibilidad por proyecto",
  descripcion: "Proyecto de muestra generado para inspeccionar los documentos con datos de ejemplo.",
  notas: null,
  fecha: "2031-04-17",
  tipo: "Rollout",
  intencion: "Cotización",
  responsable: "xrnpnnwwidz@example.test",
  creado_en: "2026-08-12T19:21:00.000Z",
  skus: 4,
  piezas: 400,
  ...over,
});

/**
 * Las filas del catálogo de la evidencia salen del fixture de peor caso de
 * INV-B8.1 — es decir, de MEDIR el catálogo, no de inventar filas
 * cómodas. Ahí están el SKU más largo, la descripción más larga, el
 * disponible negativo y el SKU sin marca ni descripción. Si la columna
 * `Proyecto` se rompe con algo, se rompe con esto.
 */
function itemDePartida(p: PartidaItem): CatalogoItem {
  return {
    sku: p.sku,
    marca: p.marca ?? "",
    familia: p.banda,
    familias: p.banda ? [p.banda] : [],
    descripcion: p.descripcion,
    total: p.total,
    reservado: p.reservado,
    disponible: p.disponible,
    badges: p.badges,
    color: p.color,
    imagen_url: p.imagen_url,
    tecnologia: p.tecnologia,
  };
}

const ITEMS_CATALOGO: CatalogoItem[] = (() => {
  const vistos = new Set<string>();
  return [...DETALLE_PEOR_CASO.partidas, ...DETALLE_TOKENS_LARGOS.partidas]
    .filter((p) => (vistos.has(p.sku) ? false : (vistos.add(p.sku), true)))
    .map(itemDePartida);
})();

/** Tres SKUs marcados, uno de ellos el de 31 caracteres: el panel tiene que truncarlo, no desbordarse. */
const SELECCION_DEMO: Seleccion = agregar(
  agregar(agregar(SELECCION_VACIA, SKU_31, 12), "XV889-mY", 120),
  "8075-5498-20",
  400,
);

/** El mismo Selección contra un proyecto que YA tiene `XV889-mY` con 10: dos nuevos y uno que suma. */
const PLAN_DEMO = planDeVolcado(SELECCION_DEMO.items, [{ sku: "XV889-mY", cantidad: 10 }]);

/** La ficha del SKU sobre-reservado del fixture: cifras de ejemplo, disponible en negativo. */
const FICHA_DEMO = {
  sku: "XV889-mY",
  marca: "NACIONAL",
  familiaEfectiva: null,
  descrEfectiva: "ZCVHZB EQRBC DEEE",
  total: 4452,
  disponible: -2924,
  sobreReservado: true,
  stock: [],
  reservas: [],
  snapshotStock: null,
  color: null,
  tecnologia: null,
  marcaExcluida: false,
};

/** El contenido de `/catalogo`, tal como lo arma `CatalogoView` (encabezado, tabla, paginación). */
function contenidoCatalogo() {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <h1 className="text-[19px] font-semibold text-ink">Catálogo</h1>
        <p className="text-[12.5px] text-ink-muted">120 SKUs · datos del archivo vigente</p>
      </div>
      <CatalogoTabla items={ITEMS_CATALOGO} ariaBusy={false} />
      <Paginacion page={3} totalPages={6} total={120} onPageChange={() => {}} />
    </div>
  );
}

/** El contenido de `/proyectos`: la rejilla de tarjetas. */
function contenidoProyectos() {
  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="text-[19px] font-semibold text-ink">Proyectos</h1>
      <div className={REJILLA_LISTA}>
        <ProyectoCard proyecto={proyecto()} />
        <ProyectoCard proyecto={proyecto({ id: "2", folio: "PRJ-020", responsable: null })} onReasignar={() => {}} />
        <ProyectoCard
          proyecto={proyecto({ id: "3", folio: "PRJ-900", titulo: "Caso extremo · maquetación del documento", skus: 6, piezas: 2186 })}
        />
      </div>
    </div>
  );
}

/**
 * La pantalla COMPLETA: `AppShell` de verdad —sidebar, topbar, barra inferior
 * móvil, el `<main>` con su hueco reservado— con la Selección viva encima.
 * Es el escenario C1 que se pidió: el elemento flotante no se juzga solo,
 * se juzga encima de una página con sus propias acciones al fondo.
 */
function pantalla(seleccion: Seleccion, contenido: React.ReactNode): string {
  return renderToStaticMarkup(
    <SeleccionFija seleccion={seleccion}>
      <AppShell sesion={SESION}>{contenido}</AppShell>
    </SeleccionFija>,
  );
}

/** Los escenarios de la evidencia. Crece conforme avanza el bloque. */
function bloques(): BloqueDeEvidencia[] {
  return [
    {
      titulo: "C1 · Selección contraída sobre el catálogo completo",
      nota:
        "La pantalla entera con la píldora encima. Lo que hay que mirar: que la píldora NO tape la paginación. " +
        "El `<main>` reserva 80 px abajo en escritorio y 128 px en móvil (56 px de la barra inferior + la píldora) " +
        "SOLO cuando la Selección tiene algo — sin ella el hueco no existe. Desplaza dentro del marco hasta el " +
        "final de la tabla: ahí es donde la píldora y «página siguiente» compiten por el mismo rincón.",
      html: pantalla(SELECCION_DEMO, contenidoCatalogo()),
      alto: 760,
    },
    {
      titulo: "C1 · Selección desplegada sobre el catálogo",
      nota:
        "El panel abierto encima de la misma página. Aquí se juzgan tres cosas: el contraste del panel contra la " +
        "tabla en los dos temas, que el SKU de 31 caracteres se trunque en vez de desbordar el renglón, y que en " +
        "móvil el panel quede POR ENCIMA de la barra de navegación, nunca sobre ella.",
      html: renderToStaticMarkup(
        <SeleccionFija seleccion={SELECCION_DEMO} panelAbierto>
          <AppShell sesion={SESION}>{contenidoCatalogo()}</AppShell>
        </SeleccionFija>,
      ),
      alto: 760,
    },
    {
      titulo: "C1 · Selección sobre /proyectos",
      nota:
        "La misma Selección sobre otra pantalla — es la prueba visual del invariante 1: la Selección sobrevive a " +
        "la navegación. Las tarjetas llevan su propio aviso de huérfano al pie, que es la acción que no se puede tapar.",
      html: pantalla(SELECCION_DEMO, contenidoProyectos()),
      alto: 620,
    },
    // ============================================================
    // El diálogo de volcado NO se puede retratar entero: un `Dialog` de radix
    // emite CERO bytes bajo `renderToStaticMarkup` —su portal no existe en el
    // servidor, medido— así que el marco habría salido en blanco con su rótulo
    // puesto. Se retratan sus dos piezas de contenido, dentro de un contenedor
    // que imita el panel del diálogo. El envoltorio (título, botones) queda
    // fuera: eso hay que verlo en el navegador.
    // ============================================================
    {
      titulo: "Ficha · el botón «+ En proyecto» junto a «Ver en Embarques»",
      nota:
        "El brief pedía el botón, no rediseñar la ficha: va en la columna de acciones que ya existía. Es el MISMO " +
        "componente de la tabla y del grid, en su variante larga — a la izquierda sin marcar, a la derecha ya en la " +
        "Selección. Lo que hay que mirar: que en 390 px los dos botones no se atropellen.",
      html: renderToStaticMarkup(
        <div className="flex flex-col gap-4">
          <SeleccionFija seleccion={SELECCION_VACIA}>
            <FichaHeader {...FICHA_DEMO} />
          </SeleccionFija>
          <SeleccionFija seleccion={SELECCION_DEMO}>
            <FichaHeader {...FICHA_DEMO} sku="XV889-mY" />
          </SeleccionFija>
        </div>,
      ),
      alto: 640,
    },
    {
      titulo: "Volcado · la vista previa antes de confirmar",
      nota:
        "El «and say» del sum-and-say. El usuario armó la Selección recorriendo el catálogo, sin ver el proyecto: " +
        "aquí ve cuál SKU es nuevo y cuál ya estaba y va a sumar, con las dos cifras y el resultado. " +
        "Va dentro de un marco que imita el panel del diálogo — el envoltorio real no se puede renderizar estático.",
      html: renderToStaticMarkup(
        <div className="mx-auto max-w-[520px] rounded-2xl border border-line bg-surface p-5">
          <VistaPreviaVolcado plan={PLAN_DEMO} resumen={resumenDePlan(PLAN_DEMO)} />
        </div>,
      ),
      alto: 380,
    },
    {
      titulo: "Volcado · el desglose del servidor, en sus dos estados",
      nota:
        "Arriba, el volcado que entró completo. Abajo, el que dejó renglones fuera: un reintento detectado (no se " +
        "sumó dos veces), un conflicto con lo que hay ahora, y un SKU fuera del catálogo. Aquí se juzga que el " +
        "verde y el ámbar se distingan en los dos temas, que es donde este tipo de aviso se rompe.",
      html: renderToStaticMarkup(
        <div className="mx-auto flex max-w-[520px] flex-col gap-5">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <ResultadoDelVolcado
              resultado={{
                aplicadas: [
                  { sku: SKU_31, antes: 0, despues: 12 },
                  { sku: "XV889-mY", antes: 10, despues: 130 },
                ],
                sinCambio: [],
                conflictos: [],
                desconocidos: [],
              }}
              proyecto={proyecto({ folio: "PRJ-050", titulo: "Rollout Norte" })}
            />
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <ResultadoDelVolcado
              resultado={{
                aplicadas: [{ sku: "8075-5498-20", antes: 0, despues: 400 }],
                sinCambio: [{ sku: SKU_31, cantidad: 12 }],
                conflictos: [
                  { sku: "XV889-mY", cantidadVista: 10, cantidadActual: 25, motivo: "cambio_concurrente" },
                ],
                desconocidos: ["NO-EXISTE-ESTE-SKU"],
              }}
              proyecto={proyecto({ folio: "PRJ-050", titulo: "Rollout Norte" })}
            />
          </div>
        </div>,
      ),
      alto: 900,
    },
    {
      titulo: "Panel · aislado, con el peor caso dentro",
      nota:
        "El panel sin página debajo, para mirar de cerca el paso de cantidad, el truncado del SKU largo y los " +
        "estados de foco. Es el mismo componente del escenario compuesto, con las mismas props.",
      html: renderToStaticMarkup(
        <div className="relative h-[420px]">
          <PanelSeleccion
            items={SELECCION_DEMO.items}
            abierto
            onAlternarAbierto={() => {}}
            onFijarCantidad={() => {}}
            onQuitar={() => {}}
            onVaciar={() => {}}
          />
        </div>,
      ),
      alto: 460,
    },
  ];
}

describe("[INV-B8.2] evidencia visual", () => {
  it("cada escenario renderiza y produce marcado con las clases del portal", () => {
    for (const bloque of bloques()) {
      expect(bloque.html.length, `el escenario "${bloque.titulo}" no produjo marcado`).toBeGreaterThan(200);
      // Si el render saliera sin clases, la evidencia se vería como HTML sin
      // estilo y no se podría juzgar nada: se afirma que las trae.
      expect(bloque.html, `el escenario "${bloque.titulo}" salió sin clases`).toMatch(/class="/);
    }
  });

  it("la tarjeta huérfana explica POR QUÉ no se puede editar, no solo que falta un dato", () => {
    const html = bloques().find((b) => b.titulo.includes("/proyectos"))!.html;
    expect(html).toContain("nadie puede editarlo");
  });

  // ============================================================
  // Estas tres afirman lo que la evidencia DICE que muestra. Sin ellas, un
  // escenario podría salir vacío —el provider fijo mal cableado, el panel
  // devolviendo `null`— y la página se vería plausible: cuatro marcos con una
  // pantalla dentro y ningún panel. La evidencia mentiría en silencio.
  // ============================================================
  it("el escenario compuesto trae de verdad la pantalla Y la Selección encima", () => {
    const html = bloques()[0].html;
    expect(html, "falta la barra de navegación móvil").toContain("Navegación principal (móvil)");
    expect(html, "falta la paginación del catálogo").toContain("Página siguiente");
    // [2.0.1-A] Los DOS puntos de render, cada uno con su id: el shell compuesto
    // los pinta a la vez (uno oculto por CSS) y afirmarlos por separado es lo que
    // impide que uno desaparezca en silencio. Antes ambos decían el mismo id —
    // HTML inválido y `aria-controls` ambiguo (H5).
    expect(html, "falta la píldora del riel").toContain(`aria-controls="${ID_PANEL.sidebar}"`);
    expect(html, "falta la píldora flotante").toContain(`aria-controls="${ID_PANEL.flotante}"`);
    expect(html, "la píldora no muestra el conteo").toMatch(/3 SKU · 532 pz/);
  });

  // ============================================================
  // La trampa que este bloque descubrió midiendo: un `Dialog` de radix emite
  // CERO bytes bajo `renderToStaticMarkup`. Un escenario que lo incluyera
  // saldría en blanco con su rótulo puesto — evidencia plausible y falsa. Estas
  // afirmaciones son lo que impide que vuelva a colarse.
  // ============================================================
  it("los escenarios del volcado traen contenido de verdad, no un portal vacío", () => {
    const previa = bloques().find((b) => b.titulo.includes("vista previa"))!.html;
    expect(previa, "la vista previa no enseña la suma").toMatch(/10 \+ 120 =/);
    expect(previa).toContain("ya estaba");

    const desglose = bloques().find((b) => b.titulo.includes("desglose"))!.html;
    expect(desglose, "falta el estado completo").toContain("Volcado completo.");
    expect(desglose, "falta el estado parcial").toContain("Volcado parcial");
    expect(desglose, "el reintento no se dice").toContain("No se sumó dos veces");
    expect(desglose, "el conflicto no dice qué esperaba y qué hay").toMatch(/esperaba 10, hay 25/);
  });

  it("el panel desplegado ya trae el botón de volcar, y el contraído no promete nada", () => {
    const desplegado = bloques().find((b) => b.titulo.includes("desplegada"))!.html;
    expect(desplegado).toContain("Volcar a proyecto");

    const aislado = bloques().find((b) => b.titulo.includes("aislado"))!.html;
    // Sin `onVolcar` no se pinta el botón: un control que no lleva a ningún
    // lado es el patrón P7, y el panel aislado no tiene diálogo detrás.
    expect(aislado).not.toContain("Volcar a proyecto");
  });

  it("la ficha lleva el botón en sus dos estados, sin rediseñar la columna de acciones", () => {
    const ficha = bloques().find((b) => b.titulo.startsWith("Ficha"))!.html;
    expect(ficha).toContain("+ En proyecto");
    expect(ficha).toContain("Quitar XV889-mY de la Selección");
    expect(ficha, "se perdió la acción que ya existía").toContain("Ver en Embarques");
  });

  it("la columna Proyecto pinta los DOS estados del botón en la misma tabla", () => {
    const html = bloques()[0].html;
    expect(html, "ningún SKU aparece como ya seleccionado").toContain("Quitar XV889-mY de la Selección");
    expect(html, "ningún SKU aparece como agregable").toContain("Agregar 0692D-W a la Selección");
  });

  it("el `<main>` reserva el hueco de la píldora, que es lo que impide que tape la paginación", () => {
    const conSeleccion = bloques()[0].html;
    const sinSeleccion = pantalla(SELECCION_VACIA, contenidoCatalogo());
    // [2.0.1-A] La reserva la DERIVA el carril: con Selección, hasta el techo de
    // la píldora; sin ella, el suelo. Antes eran dos números a ojo que suponían
    // el alto de una barra que medía otra cosa.
    //
    // `pildoraEnEscritorio: false` no es una elección de la prueba, es lo que
    // esta página ES: `renderToStaticMarkup` no corre `useEffect`, así que el
    // sidebar sale EXPANDIDO (su estado por omisión) y ahí la Selección vive en
    // su pie, sin flotar. Escribir `true` aquí describiría otra pantalla.
    expect(conSeleccion).toContain(reservaDeContenido({ pildora: true, pildoraEnEscritorio: false }));
    expect(sinSeleccion, "sin Selección solo se reserva el suelo del carril").toContain(
      reservaDeContenido({ pildora: false, pildoraEnEscritorio: false }),
    );
    expect(sinSeleccion, "sin Selección no debe haber píldora").not.toContain("panel-seleccion");
  });

  it("con EVIDENCIA_VISUAL=1 escribe la página de revisión visual", () => {
    if (process.env.EVIDENCIA_VISUAL !== "1") {
      // Sin la bandera no se escribe nada, pero SÍ se comprueba que la página
      // se puede construir: si `paginaDeEvidencia` se rompiera, el generador
      // fallaría en el momento menos oportuno — cuando alguien lo necesita.
      expect(paginaDeEvidencia("prueba", bloques(), "/* css */")).toContain("<!doctype html>");
      return;
    }

    const salida = join(process.cwd(), ".evidencia", "proyectos");
    mkdirSync(salida, { recursive: true });

    const css = cssCompilado();
    const pagina = paginaDeEvidencia("Selección y navegación", bloques(), css);
    writeFileSync(join(salida, "evidencia-visual.html"), pagina);

    expect(css.length, "el CSS compilado salió vacío: ¿corriste `npm run build`?").toBeGreaterThan(10_000);
    // El archivo tiene que ser AUTOCONTENIDO: si el CSS quedara enlazado en vez
    // de incrustado, la página se abriría sin estilos y parecería que los
    // componentes están rotos. Se afirma lo contrario, no se supone.
    expect(pagina, "el CSS no quedó incrustado en los marcos").toContain("--mx-bg");
    expect(pagina, "quedó un enlace a un archivo externo").not.toMatch(/<link[^>]+stylesheet/);
  });
});
