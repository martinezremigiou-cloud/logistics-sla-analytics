import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { paginaDeEvidencia, cssCompilado, type BloqueDeEvidencia } from "@/components/proyectos/evidencia-visual";
import { PanelCampana, IconoCampana } from "./panel-campana";
import { CuerpoVentanaAvisos } from "@/components/seguimiento/ventana-avisos";
import { BotonSeguir } from "@/components/seguimiento/boton-seguir";
import { BotonSeleccion } from "@/components/catalogo/boton-seleccion";
import { CatalogoTabla } from "@/components/catalogo/catalogo-tabla";
import { FichaHeader } from "@/components/ficha/ficha-header";
import { AppShell } from "@/components/layout/app-shell";
import { SeguimientoFijo, PREFERENCIAS_POR_OMISION } from "@/components/providers/seguimiento-provider";
import { SeleccionFija } from "@/components/providers/seleccion-provider";
import { SELECCION_VACIA } from "@/lib/seleccion";
import { DETALLE_PEOR_CASO } from "@/services/documento/fixture-peor-caso";
import type { AvisosSku, CampanaResponse } from "@/types/avisos";
import type { CatalogoItem } from "@/types/api";
import type { PartidaItem } from "@/types/proyectos";

// ============================================================
// [INV-B9] La evidencia visual del bloque. Reusa el arnés de INV-B8.2 tal cual
// —iframes con viewport real, los dos temas, CSS compilado incrustado— porque
// el brief lo pidió así y porque ya está probado.
//
//   npm run build && EVIDENCIA_VISUAL=1 npx vitest run src/components/campana/evidencia-visual.test.tsx
//
// LO QUE NO SE PUEDE RETRATAR, y va dicho en la propia página: el envoltorio de
// un `Dialog` de radix emite CERO bytes en render estático. Se retrata el
// CUERPO de la ventana de preferencias; el título y los botones del pie hay que
// verlos en el navegador.
// ============================================================
vi.mock("next/navigation", () => ({
  usePathname: () => "/catalogo",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/actions", () => ({ cerrarSesion: () => {} }));

const SESION = { email: "xrnpnnwwidz@example.test", rol: "kam" as const };

const SOLO_LLEGADA: AvisosSku = { av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true };
const TODO: AvisosSku = { av_estatus: true, av_disponible: true, av_reservado: true, av_llegada: true };

/** Las filas salen del fixture de peor caso de INV-B8.1: el SKU más largo, la descripción más larga y un disponible negativo. */
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
const ITEMS: CatalogoItem[] = DETALLE_PEOR_CASO.partidas.map(itemDePartida);

const ULTIMAS = [
  { fuente: "stock", ultima: "2026-08-12T22:53:00.000Z" },
  { fuente: "aduana", ultima: "2026-08-14T16:00:00.000Z" },
];

function campana(over: Partial<CampanaResponse> = {}): CampanaResponse {
  return {
    pulso: { movimientos: [], llegadas: [], enCamino: { skus: 0, piezas: 0, etapasOcupadas: 0 } },
    avisos: [],
    nuevos: 0,
    seguidos: 0,
    preferencias: PREFERENCIAS_POR_OMISION,
    ultimas: ULTIMAS,
    calladas: [],
    correoCallado: null,
    ...over,
  };
}

/** El panel dentro de un marco que imita el desplegable del topbar. */
function enContenedor(nodo: React.ReactNode) {
  return (
    <div className="flex justify-end p-3">
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">{nodo}</div>
    </div>
  );
}

const CON_DATOS = campana({
  seguidos: 30,
  nuevos: 3,
  pulso: {
    movimientos: [
      { sku: "FZ6661N5", de: "Producto Solicitado", a: "En Preparación" },
      { sku: "FG1504P7", de: "En Aduana", a: "En Almacén North" },
    ],
    llegadas: ["NKH922-W", "8075-5498-20"],
    enCamino: { skus: 41, piezas: 9_640, etapasOcupadas: 3 },
  },
  avisos: [
    { perfil_id: "p", tipo: "llegada", sku: "NKH922-W", de: "-2924", a: "576", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
    { perfil_id: "p", tipo: "estatus", sku: "EGZtB: DKmVtE FK1179-W FB4711-W", de: "En Aduana", a: "En Almacén North", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
    { perfil_id: "p", tipo: "reservado", sku: "EGZtB: DKmVtE FK1179-W FB4711-W", de: "41334", a: "40334", detectado_en: "2026-08-14T16:00:00.000Z", snapshot_id: "s" },
  ],
});

function bloques(): BloqueDeEvidencia[] {
  return [
    {
      titulo: "Campana · el icono en el topbar, con y sin novedades",
      nota:
        "El badge usa el MISMO patrón visual que el de Pendientes en el sidebar (rojo, redondo, mono): un usuario no " +
        "tiene por qué aprender dos lenguajes de «hay algo nuevo». A la izquierda sin nada, luego con 3, y al final el tope.",
      html: renderToStaticMarkup(
        <div className="flex items-center gap-6 p-6">
          {[0, 3, 12, 1234].map((n) => (
            <span
              key={n}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line bg-surface text-ink-2"
            >
              <IconoCampana nuevos={n} />
            </span>
          ))}
        </div>,
      ),
      alto: 120,
    },
    {
      titulo: "Campana · abierta SIN seguimientos (zero-state)",
      nota:
        "Lo que ve alguien que nunca siguió nada. Tiene que ver algo útil —el pulso y la frescura del dato— y entender " +
        "CÓMO seguir su primer SKU. Un panel que solo dijera «no hay nada» dejaría la función invisible.",
      html: renderToStaticMarkup(enContenedor(<PanelCampana datos={campana({ pulso: CON_DATOS.pulso })} />)),
      alto: 560,
    },
    {
      titulo: "Campana · abierta CON seguimientos",
      nota:
        "El pulso arriba, lo suscrito abajo — el orden que fijó el brief. Un vendedor ve primero el movimiento general y " +
        "después lo suyo. Los dos avisos del mismo SKU son UN renglón: agrupar es lo que impide que una recarga completa " +
        "de stock pinte 60 renglones (medido).",
      html: renderToStaticMarkup(enContenedor(<PanelCampana datos={CON_DATOS} />)),
      alto: 720,
    },
    {
      titulo: "Campana · la línea de admin (una fuente dejó de cargar)",
      nota:
        "Solo la ve un admin: el servidor devuelve la lista vacía para cualquier otro rol. Es UNA línea, no una sección " +
        "técnica — la única falla que ya se materializó dos veces. El umbral (5 días, con la otra fuente viva) está " +
        "calibrado contra la historia real: 7 días habría PERDIDO el incidente conocido.",
      html: renderToStaticMarkup(
        enContenedor(
          <PanelCampana
            datos={campana({
              seguidos: 4,
              pulso: CON_DATOS.pulso,
              calladas: [{ fuente: "stock", dias: 7, otra: "aduana", diasOtra: 1 }],
            })}
          />,
        ),
      ),
      alto: 620,
    },
    {
      titulo: "Ventana de preferencias · el cuerpo, en sus dos extremos",
      nota:
        "Arriba el DEFAULT del producto —solo «ya llegó», el evento más raro de los cuatro (48 al mes) y por eso el que " +
        "deja a la campana significando algo—. Abajo, con «Todo» encendido. El envoltorio del diálogo no se puede " +
        "renderizar estático: radix emite cero bytes fuera del navegador.",
      html: renderToStaticMarkup(
        <div className="mx-auto flex max-w-[460px] flex-col gap-5 p-4">
          {[SOLO_LLEGADA, TODO].map((avisos, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-5">
              <CuerpoVentanaAvisos avisos={avisos} setAvisos={() => {}} usarSiempre setUsarSiempre={() => {}} />
            </div>
          ))}
        </div>,
      ),
      alto: 900,
    },
    {
      titulo: "El toggle · sus dos estados, junto al de Selección",
      nota:
        "Mismo patrón, significados distintos: la Selección arma un borrador para volcar a un proyecto; la campana pide " +
        "que te avisen. Por eso uno lleva un más y el otro una campana. A la izquierda sin seguir, a la derecha siguiendo.",
      html: renderToStaticMarkup(
        <div className="flex flex-col gap-4 p-6">
          {([{}, { "NKH922-W": SOLO_LLEGADA }] as Record<string, AvisosSku>[]).map((seguidos, i) => (
            <SeguimientoFijo key={i} seguidos={seguidos}>
              <SeleccionFija seleccion={SELECCION_VACIA}>
                <div className="flex items-center gap-2">
                  <BotonSeleccion sku="NKH922-W" />
                  <BotonSeguir sku="NKH922-W" />
                  <BotonSeguir sku="NKH922-W" variante="completo" className="px-3 py-2 text-[12.5px]" />
                </div>
              </SeleccionFija>
            </SeguimientoFijo>
          ))}
        </div>,
      ),
      alto: 200,
    },
    {
      titulo: "El toggle sobre la tabla real del catálogo",
      nota:
        "Con el fixture de peor caso de INV-B8.1: el SKU de 31 caracteres, la descripción de 244 y el disponible en " +
        "−2 924. Lo que hay que mirar es que los dos botones quepan en la columna sin romper la fila, y que en 390 px no " +
        "se atropellen.",
      html: renderToStaticMarkup(
        <SeguimientoFijo seguidos={{ "XV889-mY": SOLO_LLEGADA, "0692D-W": TODO }}>
          <SeleccionFija seleccion={SELECCION_VACIA}>
            <AppShell sesion={SESION}>
              <CatalogoTabla items={ITEMS} ariaBusy={false} />
            </AppShell>
          </SeleccionFija>
        </SeguimientoFijo>,
      ),
      alto: 760,
    },
    {
      titulo: "La ficha · «Avisarme» junto a Selección y a Embarques",
      nota:
        "Tres acciones en la misma columna, que era la que ya existía: el brief pedía el botón, no rediseñar la ficha. " +
        "Arriba sin seguir, abajo siguiendo. En 390 px es donde se ve si se atropellan.",
      html: renderToStaticMarkup(
        <div className="flex flex-col gap-4">
          {([{}, { "XV889-mY": SOLO_LLEGADA }] as Record<string, AvisosSku>[]).map((seguidos, i) => (
            <SeguimientoFijo key={i} seguidos={seguidos}>
              <SeleccionFija seleccion={SELECCION_VACIA}>
                <FichaHeader
                  sku="XV889-mY"
                  marca="NACIONAL"
                  familiaEfectiva={null}
                  descrEfectiva="ZCVHZB EQRBC DEEE"
                  total={4452}
                  disponible={-2924}
                  sobreReservado
                  stock={[]}
                  reservas={[]}
                  snapshotStock={null}
                  color={null}
                  tecnologia={null}
                  marcaExcluida={false}
                />
              </SeleccionFija>
            </SeguimientoFijo>
          ))}
        </div>,
      ),
      alto: 700,
    },
  ];
}

describe("[INV-B9] evidencia visual", () => {
  it("cada escenario renderiza y trae las clases del portal", () => {
    for (const b of bloques()) {
      expect(b.html.length, `el escenario "${b.titulo}" no produjo marcado`).toBeGreaterThan(200);
      expect(b.html, `el escenario "${b.titulo}" salió sin clases`).toMatch(/class="/);
    }
  });

  // ============================================================
  // La trampa de INV-B8.2: un `Dialog` de radix emite CERO bytes en render
  // estático, y un escenario con uno dentro sale en blanco CON SU RÓTULO
  // PUESTO. Estas afirmaciones son lo que impide que vuelva a colarse.
  // ============================================================
  it("los escenarios traen el contenido que sus rótulos prometen", () => {
    const b = bloques();
    const zero = b.find((x) => x.titulo.includes("zero-state"))!.html;
    expect(zero).toContain("Todavía no sigues ningún SKU.");
    expect(zero, "el zero-state no dice cómo seguir el primero").toContain("catálogo");

    const conDatos = b.find((x) => x.titulo.includes("CON seguimientos"))!.html;
    expect(conDatos).toMatch(/De tus 30 SKU/);
    expect(conDatos, "los dos avisos del mismo SKU no se agruparon").toContain(
      "Cambió de etapa · Cambió el reservado",
    );

    const admin = b.find((x) => x.titulo.includes("línea de admin"))!.html;
    expect(admin).toMatch(/lleva 7 días sin traer nada nuevo/);

    const ventana = b.find((x) => x.titulo.includes("Ventana de preferencias"))!.html;
    expect(ventana, "el cuerpo de la ventana salió vacío (¿un portal?)").toContain("Pasó de no haber a haber.");

    const toggle = b.find((x) => x.titulo.startsWith("El toggle ·"))!.html;
    expect(toggle).toContain("Seguir NKH922-W para recibir avisos");
    expect(toggle).toContain("Dejar de seguir NKH922-W");

    const ficha = b.find((x) => x.titulo.startsWith("La ficha"))!.html;
    expect(ficha).toContain("Avisarme");
    expect(ficha, "se perdió la acción que ya existía").toContain("Ver en Embarques");
  });

  it("con EVIDENCIA_VISUAL=1 escribe la página de revisión visual", () => {
    if (process.env.EVIDENCIA_VISUAL !== "1") {
      expect(paginaDeEvidencia("prueba", bloques(), "/* css */")).toContain("<!doctype html>");
      return;
    }

    const salida = join(process.cwd(), ".evidencia", "campana");
    mkdirSync(salida, { recursive: true });
    const css = cssCompilado();
    const pagina = paginaDeEvidencia("La campana", bloques(), css);
    writeFileSync(join(salida, "evidencia-visual.html"), pagina);

    expect(css.length, "el CSS compilado salió vacío: ¿corriste `npm run build`?").toBeGreaterThan(10_000);
    expect(pagina, "el CSS no quedó incrustado").toContain("--mx-bg");
    expect(pagina, "quedó un enlace a un archivo externo").not.toMatch(/<link[^>]+stylesheet/);
  });
});
