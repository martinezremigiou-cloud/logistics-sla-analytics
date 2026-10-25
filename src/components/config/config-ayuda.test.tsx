// ============================================================
// [INV-B11] O6-adenda · LA SECCIÓN «AYUDA».
//
// Tres cosas se comprueban aquí y las tres son decisiones, no forma:
//
//   1. La línea del remitente NO sale mientras el DNS no esté — **y sale
//      cuando esté**. Sin la segunda mitad la primera es vacua.
//   2. El correo se MUESTRA y no se edita. Es la decisión de seguridad, y una
//      prueba que solo mirara el texto no vería aparecer un `<input>`.
//   3. Las capacidades salen de `INTENCIONES`, no de una lista a mano.
// ============================================================
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionProvider } from "@/components/providers/session-provider";
import { ConfigAyuda, REMITENTE_AVISOS } from "./config-ayuda";
import { CONTACTOS, ORDEN_AYUDA } from "@/lib/contactos";
import { INTENCIONES } from "@/lib/chat/intenciones";

function pintar(props: Parameters<typeof ConfigAyuda>[0] = {}) {
  return render(
    <SessionProvider sesion={{ id: "u1", email: "kam@example.com", rol: "kam" }}>
      <ConfigAyuda {...props} />
    </SessionProvider>,
  );
}

describe("[INV-B11] Ayuda · la línea del remitente", () => {
  it("HOY no se anuncia ningún remitente: el DNS no está", () => {
    expect(REMITENTE_AVISOS, "alguien encendió el remitente sin tocar la prueba").toBeNull();
    pintar();
    expect(screen.queryByText(/Si no te llegan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/correo no deseado/)).not.toBeInTheDocument();
  });

  it("EL CONTROL POSITIVO · con remitente puesto, la línea completa aparece", () => {
    // Sin esto, un `{remitente && …}` que nunca pintara nada —o un componente
    // que se hubiera comido el bloque entero— dejaría la de arriba en verde
    // para siempre, y el día del DNS la línea seguiría sin salir.
    pintar({ remitente: "avisos@example.com" });
    expect(screen.getByText("avisos@example.com")).toBeInTheDocument();
    expect(screen.getByText(/carpeta de correo no deseado y márcalo como seguro/)).toBeInTheDocument();
  });
});

describe("[INV-B11] Ayuda · el correo se muestra, no se edita", () => {
  it("pinta el correo de la sesión", () => {
    pintar();
    expect(screen.getByText("kam@example.com")).toBeInTheDocument();
  });

  it("NO hay campo editable: cambiar el destino de los avisos es decisión de producto, no un formulario", () => {
    // La razón está en el componente: `preferencias_notificacion` no tiene
    // columna de correo, y un campo aquí sería el camino para redirigir los
    // avisos de inventario a una dirección de fuera. Si algún día se decide
    // que sí, esta prueba es la que hay que venir a borrar a propósito.
    const { container } = pintar();
    expect(container.querySelector("input"), "apareció un campo de correo editable").toBeNull();
    expect(container.querySelector("form"), "apareció un formulario en Ayuda").toBeNull();
  });
});

describe("[INV-B11] Ayuda · lo que no se escribe a mano", () => {
  it("los cuatro contactos salen de `CONTACTOS`, con correo y teléfono pulsables", () => {
    const { container } = pintar();
    for (const area of ORDEN_AYUDA) {
      const c = CONTACTOS[area];
      expect(screen.getByText(c.nombre)).toBeInTheDocument();
      expect(container.querySelector(`a[href="mailto:${c.correo}"]`), `${c.nombre}: sin mailto`).not.toBeNull();
    }
    expect(container.querySelectorAll('a[href^="tel:"]').length, "faltan teléfonos pulsables").toBe(ORDEN_AYUDA.length);
  });

  it("las capacidades salen del catálogo de intenciones, no de una lista paralela", () => {
    // P7: una lista a mano se desincroniza y anuncia lo que el sistema ya no
    // hace — y ese día no avisa. Se comprueba que estén TODAS y con SU texto.
    pintar();
    for (const i of INTENCIONES) {
      expect(screen.getByText(i.descripcion), `falta la intención «${i.id}»`).toBeInTheDocument();
    }
    // El anti-vacuidad de la de arriba: con el catálogo vacío, el `for` no
    // habría comprobado nada. No se compara contra un número horneado —eso
    // obliga a tocar esta línea cada vez que entra una intención— sino contra
    // que HAYA catálogo y contra que la pantalla las liste TODAS.
    expect(INTENCIONES.length, "el catálogo de intenciones quedó vacío: el bucle de arriba no probó nada").toBeGreaterThan(
      0,
    );
  });
});

describe("[INV-B11] Ayuda · Acerca de la app", () => {
  it("dice las tres cosas que un KAM asume mal", () => {
    pintar();
    expect(screen.getByText(/no es tiempo real/)).toBeInTheDocument();
    expect(screen.getByText(/No hay precios, no hay ventas/)).toBeInTheDocument();
    expect(screen.getByText(/vault de fichas/)).toBeInTheDocument();
  });

  it("el responsable sale del mismo mapa que la escalada del chat", () => {
    const { container } = pintar();
    expect(container.querySelector(`a[href="mailto:${CONTACTOS.software.correo}"]`)).not.toBeNull();
  });

  it("sin `NEXT_PUBLIC_DEPLOY_ID` NO se pinta «Versión: undefined»", () => {
    // En local la variable no existe. Un «Versión: undefined» en pantalla dice
    // que el dato está roto, cuando lo que pasa es que no aplica fuera de Vercel.
    pintar();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});

// ============================================================
// [INV-B11] O7 · EL TESTIGO DE FRESCURA, en su sitio y en sus tres estados.
//
// La logica de los dos silencios se prueba en `frescura.test.ts`, sin base.
// Lo que se prueba AQUI es lo que aquella no puede: que el testigo esta
// MONTADO donde el usuario lo va a ver, y que ninguno de sus tres estados de
// carga se calla.
//
// El del FALLO es el que importa: un error de lectura NO puede pintarse como
// «0 documentos». Seria inventar un hecho a partir de un error, que es P12.
// ============================================================
describe("[INV-B11] Ayuda · el testigo de frescura", () => {
  it("esta montado en «Acerca de la app», donde se explica de donde salen los datos", () => {
    pintar();
    // Sin llave de red en la prueba, el componente arranca en «cargando» — y
    // eso ya prueba que esta montado: si no lo estuviera, no habria frase.
    expect(screen.getByText(/estado de la documentación/i)).toBeInTheDocument();
  });

  it("un FALLO de lectura no se pinta como «0 documentos»", async () => {
    const original = global.fetch;
    global.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    try {
      pintar();
      expect(await screen.findByText(/No se pudo consultar el estado/i)).toBeInTheDocument();
      expect(screen.queryByText(/0 documentos/), "un error se leyo como un corpus vacio").not.toBeInTheDocument();
    } finally {
      global.fetch = original;
    }
  });

  it("con datos, pinta la frase que distingue los dos silencios", async () => {
    const original = global.fetch;
    const hace2h = new Date(Date.now() - 2 * 3600_000).toISOString();
    const hace6d = new Date(Date.now() - 144 * 3600_000).toISOString();
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            documentos: 184,
            trozos: 271,
            version: "abc",
            ultimoCambio: hace6d,
            ultimoIntento: hace2h,
            ultimoResultado: "ok",
            motivo: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ) as unknown as typeof fetch;
    try {
      pintar();
      const t = await screen.findByText(/Corpus indexado/);
      expect(t.textContent).toContain("184 documentos");
      expect(t.textContent, "no dijo que se reviso sin novedad").toContain("sin novedad");
    } finally {
      global.fetch = original;
    }
  });
});
