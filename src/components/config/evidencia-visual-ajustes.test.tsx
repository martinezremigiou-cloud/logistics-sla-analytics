// ============================================================
// [INV-B11] O6-adenda · LA EVIDENCIA VISUAL DE AJUSTES.
//
// La DoD la pidió por nombre: **Ajustes en 2 anchos × 2 temas**. El arnés de
// `evidencia-visual.ts` ya hace la matriz solo, así que aquí solo se eligen las
// pantallas — y se eligen las que no se pueden juzgar de otro modo.
//
// POR QUÉ ESTA PÁGINA VALE LA PENA Y NO ES CEREMONIA: el contenido de Ayuda es
// **texto denso en una tarjeta estrecha**. A 390 px una tabla de contactos con
// nombre, puesto, correo y teléfono es exactamente el sitio donde algo no cabe
// — que es el defecto que O6 acababa de tener en el riel, y que **ninguna
// prueba de este repo puede ver** (deuda B11-1: ni jsdom ni
// `renderToStaticMarkup` calculan layout). La evidencia es lo único que lo
// enseña, y por eso los 390 px no son un extra.
//
// LÍMITE, dicho: esto RETRATA, no MIDE. Que se vea que cabe es una persona
// mirando, no una guarda. Lo que sí garantizan las aserciones de abajo es que
// **la página no salga vacía diciendo que retrata algo** — un escenario en
// blanco con su rótulo puesto pasa por bueno de un vistazo.
// ============================================================
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { paginaDeEvidencia, cssCompilado, type BloqueDeEvidencia } from "@/components/proyectos/evidencia-visual";
import { SessionProvider } from "@/components/providers/session-provider";
import { ConfigAyuda } from "./config-ayuda";
import { CONTACTOS, ORDEN_AYUDA } from "@/lib/contactos";
import { INTENCIONES } from "@/lib/chat/intenciones";

/**
 * El marco. `ConfigAyuda` es una isla client dentro de `/config`, así que se
 * pinta con el mismo ancho útil que tiene ahí: el contenido a la derecha de la
 * lista de pestañas.
 */
function marco(hijo: React.ReactNode) {
  return (
    <SessionProvider sesion={{ id: "u1", email: "kam@example.com", rol: "kam" }}>
      <div className="min-h-full bg-surface-app p-4">
        <div className="mx-auto max-w-3xl">{hijo}</div>
      </div>
    </SessionProvider>
  );
}

function bloques(): BloqueDeEvidencia[] {
  return [
    {
      titulo: "Ayuda · lo que ve un KAM que se quedó sin respuesta",
      nota:
        "Las cuatro tarjetas seguidas, que es como se leen de verdad. **Lo que hay que mirar a 390 px:** que el " +
        "renglón de cada contacto no se rompa — nombre, puesto, correo y teléfono en una columna estrecha es " +
        "justo donde algo deja de caber, y este repo no tiene forma de comprobarlo con una prueba (deuda B11-1). " +
        "Los correos y los teléfonos son enlaces: en un teléfono, marcar es un toque.",
      html: renderToStaticMarkup(marco(<ConfigAyuda />)),
      alto: 1180,
    },
    {
      titulo: "Ayuda · con el remitente encendido (así se verá el día del DNS)",
      nota:
        "Esa línea está condicionada al DNS de `example.com`: **hoy no sale**, porque decirle a alguien que " +
        "marque como seguro un remitente que todavía no manda es peor que no decir nada. Este escenario retrata el " +
        "estado futuro pasándole el remitente a mano — **no es lo que se ve hoy en el portal**. Está aquí para que " +
        "el copy se pueda aprobar antes de que el DNS exista, y para que el día que se encienda no haya sorpresa.",
      html: renderToStaticMarkup(marco(<ConfigAyuda remitente="avisos@example.com" />)),
      alto: 1240,
    },
  ];
}

describe("[INV-B11] evidencia visual · Ajustes", () => {
  it("ningún escenario sale vacío, y cada uno contiene lo que dice retratar", () => {
    const b = bloques();
    for (const x of b) {
      expect(x.html.length, `«${x.titulo}» salió vacío`).toBeGreaterThan(300);
    }

    const ayuda = b[0]!.html;
    // Los cuatro contactos, con su correo Y su teléfono pulsables.
    for (const area of ORDEN_AYUDA) {
      const c = CONTACTOS[area];
      expect(ayuda, `falta ${c.nombre}`).toContain(c.nombre);
      expect(ayuda, `${c.nombre}: sin mailto`).toContain(`mailto:${c.correo}`);
    }
    expect((ayuda.match(/href="tel:/g) ?? []).length, "faltan teléfonos pulsables").toBe(ORDEN_AYUDA.length);

    // Las siete capacidades, salidas del catálogo.
    for (const i of INTENCIONES) {
      expect(ayuda, `falta la intención «${i.id}»`).toContain(i.descripcion);
    }

    // Acerca de la app, con las tres cosas que un KAM asume mal.
    expect(ayuda).toContain("no es tiempo real");
    expect(ayuda).toContain("No hay precios, no hay ventas");

    // Y LA LÍNEA CONDICIONADA: hoy NO está en el escenario real, y SÍ en el
    // que retrata el futuro. Sin las dos mitades, «no aparece» no prueba nada.
    expect(ayuda, "el remitente se encendió sin que el DNS esté").not.toContain("avisos@example.com");
    expect(b[1]!.html, "el escenario del futuro no pudo encender el remitente").toContain(
      "avisos@example.com",
    );
  });

  it("con EVIDENCIA_VISUAL=1 escribe la página de revisión visual", () => {
    if (process.env.EVIDENCIA_VISUAL !== "1") {
      expect(paginaDeEvidencia("prueba", bloques(), "/* css */")).toContain("<!doctype html>");
      return;
    }

    const salida = join(process.cwd(), ".evidencia", "ajustes");
    mkdirSync(salida, { recursive: true });
    const css = cssCompilado();
    const pagina = paginaDeEvidencia("Ajustes · Ayuda y Acerca", bloques(), css);
    writeFileSync(join(salida, "evidencia-ajustes.html"), pagina);

    expect(css.length, "el CSS compilado salió vacío: ¿corriste `npm run build`?").toBeGreaterThan(10_000);
    expect(pagina, "el CSS no quedó incrustado").toContain("--mx-bg");
    expect(pagina, "quedó un enlace a un archivo externo").not.toMatch(/<link[^>]+stylesheet/);
  });
});
