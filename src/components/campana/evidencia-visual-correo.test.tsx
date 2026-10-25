import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { paginaDeEvidencia, cssCompilado, type BloqueDeEvidencia } from "@/components/proyectos/evidencia-visual";
import { CuerpoVentanaAvisos } from "@/components/seguimiento/ventana-avisos";
import { BotonSeguir } from "@/components/seguimiento/boton-seguir";
import { ConfigAvisos } from "@/components/config/config-avisos";
import { PanelCampana } from "./panel-campana";
import { SeguimientoFijo, PREFERENCIAS_POR_OMISION } from "@/components/providers/seguimiento-provider";
import type { AvisosSku, CampanaResponse, PreferenciasAvisos } from "@/types/avisos";

// ============================================================
// [INV-B9.1] La evidencia visual del correo. Reusa el arnés de INV-B8.2/B9 tal
// cual —iframes con viewport real, los dos anchos, los dos temas, el CSS del
// build incrustado— porque ya está probado y porque un segundo arnés sería un
// segundo sitio donde la evidencia puede mentir distinto.
//
//   npm run build && EVIDENCIA_VISUAL=1 npx vitest run src/components/campana/evidencia-visual-correo.test.tsx
//
// LO QUE ESTA PÁGINA **NO** RETRATA, y va dicho aquí y en la propia página:
//
//   · El envoltorio de un `Dialog` de radix emite CERO bytes en render
//     estático (medido en INV-B8.2). Se retrata el CUERPO de la ventana; el
//     título y los botones del pie hay que verlos en el navegador.
//   · **El correo NO se retrata aquí.** No es un componente de React: es HTML
//     de tablas que hay que mirar en un cliente de correo de verdad, y
//     aquí no hay cómo abrirlo en uno.
// ============================================================
vi.mock("next/navigation", () => ({
  usePathname: () => "/catalogo",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SOLO_LLEGADA: AvisosSku = { av_estatus: false, av_disponible: false, av_reservado: false, av_llegada: true };

const PREFS_BOLETIN_ON: PreferenciasAvisos = { ...PREFERENCIAS_POR_OMISION, boletin_correo: true };
const PREFS_BOLETIN_OFF: PreferenciasAvisos = { ...PREFERENCIAS_POR_OMISION, boletin_correo: false };

function campana(over: Partial<CampanaResponse> = {}): CampanaResponse {
  return {
    pulso: { movimientos: [], llegadas: [], enCamino: { skus: 41, piezas: 9640, etapasOcupadas: 4 } },
    avisos: [],
    nuevos: 0,
    seguidos: 3,
    preferencias: PREFS_BOLETIN_ON,
    ultimas: [
      { fuente: "stock", ultima: "2026-08-16T22:53:00.000Z" },
      { fuente: "aduana", ultima: "2026-08-16T16:00:00.000Z" },
    ],
    calladas: [],
    correoCallado: null,
    ...over,
  };
}

export function bloques(): BloqueDeEvidencia[] {
  return [
    {
      titulo: "El interruptor de correo · apagado y encendido",
      nota:
        "Nace APAGADO y es una decisión, no un descuido: la campana la abre quien quiere, el correo va a buscar a la " +
        "persona. Arriba apagado, abajo encendido. Fíjate en que NO vuelve a preguntar qué avisar — lo que se manda por " +
        "correo es lo de arriba; esto decide si ADEMÁS te busca.",
      html: renderToStaticMarkup(
        <div className="mx-auto flex max-w-[460px] flex-col gap-5 p-4">
          {[false, true].map((correo) => (
            <div key={String(correo)} className="rounded-2xl border border-line bg-surface p-5">
              <CuerpoVentanaAvisos
                avisos={SOLO_LLEGADA}
                setAvisos={() => {}}
                avCorreo={correo}
                setAvCorreo={() => {}}
                usarSiempre
                setUsarSiempre={() => {}}
              />
            </div>
          ))}
        </div>,
      ),
      alto: 1080,
    },
    {
      titulo: "La ventana al EDITAR · sin «usar esto para los siguientes»",
      nota:
        "Al editar un SKU que ya se sigue, ese interruptor NO se pinta, y no es cosmético: el llamador lo ignora a " +
        "propósito —afinar un SKU no declara un default para los que vengan—, así que dejarlo puesto sería un control " +
        "encendido que no hace nada. Es P7 exacto. Compáralo con el bloque de arriba.",
      html: renderToStaticMarkup(
        <div className="mx-auto max-w-[460px] p-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <CuerpoVentanaAvisos
              avisos={SOLO_LLEGADA}
              setAvisos={() => {}}
              avCorreo
              setAvCorreo={() => {}}
              usarSiempre
              setUsarSiempre={() => {}}
              mostrarUsarSiempre={false}
            />
          </div>
        </div>,
      ),
      alto: 480,
    },
    {
      titulo: "El botón · el punto de correo y el acceso a editar",
      nota:
        "Cuatro estados, de arriba abajo: sin seguir · siguiendo sin correo · siguiendo CON correo (el punto) · y la " +
        "variante de ficha, que es la única que ofrece «Avisos» para reabrir la ventana. Ese segundo control no está en " +
        "la tabla ni en el grid a propósito: un botón más por renglón, sobre 50 filas y junto al de Selección, cuesta " +
        "densidad para una acción que casi nadie repite.",
      html: renderToStaticMarkup(
        <div className="flex flex-col items-start gap-4 p-6">
          <SeguimientoFijo seguidos={{}}>
            <BotonSeguir sku="SUJ500-F" />
          </SeguimientoFijo>
          <SeguimientoFijo seguidos={{ "SUJ500-F": SOLO_LLEGADA }}>
            <BotonSeguir sku="SUJ500-F" />
          </SeguimientoFijo>
          <SeguimientoFijo seguidos={{ "SUJ500-F": { ...SOLO_LLEGADA, av_correo: true } }}>
            <BotonSeguir sku="SUJ500-F" />
          </SeguimientoFijo>
          <SeguimientoFijo seguidos={{ "SUJ500-F": { ...SOLO_LLEGADA, av_correo: true } }}>
            <BotonSeguir sku="SUJ500-F" variante="completo" className="px-3 py-2 text-[12.5px]" />
          </SeguimientoFijo>
        </div>,
      ),
      alto: 280,
    },
    {
      titulo: "Configuración · el apagador del boletín",
      nota:
        "La otra mitad de la «opción 3»: el bloque general le llega a todos y quien lo sienta ruidoso lo apaga. Arriba " +
        "encendido, abajo apagado. La línea dice lo que el interruptor NO hace — apagarlo no apaga los avisos de tus " +
        "SKU—, porque si apagara todo sería un segundo control que significa lo mismo que el de arriba.",
      html: renderToStaticMarkup(
        <div className="mx-auto flex max-w-[560px] flex-col gap-5 p-4">
          {[PREFS_BOLETIN_ON, PREFS_BOLETIN_OFF].map((prefs, i) => (
            <SeguimientoFijo key={i} seguidos={{ "SUJ500-F": SOLO_LLEGADA }} preferencias={prefs}>
              <ConfigAvisos />
            </SeguimientoFijo>
          ))}
        </div>,
      ),
      alto: 900,
    },
    {
      titulo: "La campana · la segunda línea de admin, la del canal de correo",
      nota:
        "Solo la ve admin; ventas nunca. Y **no dispara si nunca se ha enviado nada**: «nunca» es indistinguible de " +
        "«todavía no está configurado», y una alarma que nace encendida se aprende a ignorar antes de significar algo. " +
        "Aquí se fuerza el caso de canal parado para poder retratarlo.",
      html: renderToStaticMarkup(
        <div className="mx-auto max-w-[420px] p-4">
          <PanelCampana
            datos={campana({
              correoCallado: { dias: 17, ultimo: "2026-07-31T15:00:00.000Z" },
              calladas: [{ fuente: "stock", dias: 7, otra: "aduana", diasOtra: 1 }],
            })}
          />
        </div>,
      ),
      alto: 640,
    },
  ];
}

describe("[INV-B9.1] evidencia visual del correo", () => {
  // ============================================================
  // ANTI-VACUIDAD (P17). Un `renderToStaticMarkup` que devuelve `""` produce
  // una página con sus rótulos puestos y los marcos en blanco: se ve completa y
  // no muestra nada. Ya pasó en INV-B8.2 con un `Dialog` de radix.
  // ============================================================
  it("ningún escenario sale vacío, y cada uno contiene lo que dice retratar", () => {
    const b = bloques();
    expect(b.length).toBeGreaterThanOrEqual(5);
    for (const x of b) {
      expect(x.html.length, `«${x.titulo}» salió vacío`).toBeGreaterThan(200);
    }

    const interruptor = b.find((x) => x.titulo.startsWith("El interruptor"))!.html;
    expect(interruptor).toContain("También por correo");
    expect(interruptor).toContain("Nunca sin campana");

    // El bloque de edición tiene que NO traer el interruptor que el otro sí trae.
    const edicion = b.find((x) => x.titulo.includes("al EDITAR"))!.html;
    expect(edicion).toContain("También por correo");
    expect(edicion, "el retrato de la edición trae el control que debería ocultar").not.toContain(
      "Usar esto para los siguientes",
    );
    expect(interruptor, "el control de comparación se perdió del otro bloque").toContain(
      "Usar esto para los siguientes",
    );

    const boton = b.find((x) => x.titulo.startsWith("El botón"))!.html;
    expect(boton).toContain("con aviso por correo");
    expect(boton).toContain("Editar los avisos de SUJ500-F");

    const config = b.find((x) => x.titulo.startsWith("Configuración"))!.html;
    expect(config).toContain("Resumen semanal de la operación");

    const panel = b.find((x) => x.titulo.startsWith("La campana"))!.html;
    expect(panel, "la línea del canal callado no se pintó").toMatch(/correo/i);
  });

  it("con EVIDENCIA_VISUAL=1 escribe la página de revisión visual", () => {
    if (process.env.EVIDENCIA_VISUAL !== "1") {
      expect(paginaDeEvidencia("prueba", bloques(), "/* css */")).toContain("<!doctype html>");
      return;
    }

    const salida = join(process.cwd(), ".evidencia", "campana-correo");
    mkdirSync(salida, { recursive: true });
    const css = cssCompilado();
    const pagina = paginaDeEvidencia("El correo semanal", bloques(), css);
    writeFileSync(join(salida, "evidencia-visual.html"), pagina);

    expect(css.length, "el CSS compilado salió vacío: ¿corriste `npm run build`?").toBeGreaterThan(10_000);
    expect(pagina, "el CSS no quedó incrustado").toContain("--mx-bg");
    expect(pagina, "quedó un enlace a un archivo externo").not.toMatch(/<link[^>]+stylesheet/);
  });
});
