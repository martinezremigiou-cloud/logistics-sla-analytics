// ============================================================
// [INV-B9.1] alcanzabilidad.test.tsx — ¿el usuario LLEGA al control?
//
// ESTE ARCHIVO EXISTE POR UNA CORRECCIÓN AL CIERRE DE INV-B9.1, y nombra
// una propiedad que hasta hoy no se probaba en este repo:
//
//   una prueba unitaria   →  demuestra que la pieza SE COMPORTA
//   evidencia compuesta   →  demuestra que la pantalla SE PINTA
//   ninguna de las dos    →  demuestra que el usuario LLEGA
//
// La alcanzabilidad es una TERCERA propiedad. Un control renderizado con props
// existe; que exista no dice que haya un camino hasta él **desde el estado por
// omisión de un perfil nuevo**.
//
// Es el antídoto de **P24** («la media función, que se ve igual que la
// completa»), y el bloque lo cometió dos veces:
//
//   · `boletin_correo` — columna, guarda, lectura y pruebas, y NINGÚN control
//     para apagarla. Solo se cambiaba por SQL.
//   · `av_correo` — camino completo MÁS el interruptor, pero con
//     `preguntar_por_sku: false` —el default— la ventana donde vive no se abre
//     nunca.
//
// **Con las pruebas de aquí, los dos habrían salido en rojo.** Ese es el
// criterio para saber si esta guarda sirve: no que pase hoy, sino que hubiera
// fallado entonces.
//
// LA REGLA, en una línea:
//   Todo control nuevo lleva una prueba que lo ALCANZA desde el estado por
//   omisión de un perfil nuevo — no una que lo renderiza con props.
//
// ────────────────────────────────────────────────────────────
// LO QUE ESTAS PRUEBAS **NO** SON, y va dicho para que nadie las lea de más:
// no son de extremo a extremo. Montan la composición real de una pantalla y
// parten del estado que devuelve el servidor a un perfil nuevo, pero no
// navegan entre rutas ni pasan por el middleware. Un control alcanzable aquí y
// escondido detrás de un `redirect` seguiría escapándose.
// ============================================================
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ConfigPreferencias } from "./config/config-preferencias";
import { FichaHeader } from "./ficha/ficha-header";
import { BotonSeguir } from "./seguimiento/boton-seguir";
import { BurbujaChat } from "./chat/burbuja-chat";
import { sugerencias } from "@/lib/chat/intenciones";
import { SeguimientoProvider } from "./providers/seguimiento-provider";
import { SeleccionFija } from "./providers/seleccion-provider";
import { SELECCION_VACIA } from "@/lib/seleccion";
import type { PreferenciasAvisos, SeguimientosResponse } from "@/types/avisos";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({ auth: { updateUser: vi.fn() } }),
}));

/**
 * **EL ESTADO DE UN PERFIL NUEVO, no uno inventado para que la prueba pase.**
 *
 * La fila de `preferencias_notificacion` nace perezosa: un perfil que nunca
 * tocó nada no tiene fila, y `leerPreferencias()` devuelve estos valores —los
 * DEFAULT de la 0026 y la 0027—. Si esta constante se tocara para «arreglar»
 * una prueba de aquí, la prueba dejaría de medir lo que dice medir.
 */
const PERFIL_NUEVO: PreferenciasAvisos = {
  av_estatus: false,
  av_disponible: false,
  av_reservado: false,
  av_llegada: true,
  // ⚠️ Éste es el que cerraba el camino. No se toca.
  preguntar_por_sku: false,
  visto_hasta: null,
  boletin_correo: true,
};

function servidorDePerfilNuevo() {
  const llamadas: { url: string; metodo: string; cuerpo: unknown }[] = [];
  let seguimientos: SeguimientosResponse["items"] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const metodo = init?.method ?? "GET";
      const cuerpo = init?.body ? JSON.parse(String(init.body)) : null;
      llamadas.push({ url, metodo, cuerpo });

      if (url === "/api/seguimientos" && metodo === "GET") {
        return new Response(JSON.stringify({ items: seguimientos }), { status: 200 });
      }
      if (url === "/api/seguimientos" && metodo === "POST") {
        // El servidor aplica las preferencias cuando el cliente no manda
        // `avisos`, que es el camino normal con el default.
        const c = cuerpo as { sku: string; av_correo?: boolean };
        seguimientos = [
          {
            perfil_id: "p1",
            sku: c.sku,
            av_estatus: PERFIL_NUEVO.av_estatus,
            av_disponible: PERFIL_NUEVO.av_disponible,
            av_reservado: PERFIL_NUEVO.av_reservado,
            av_llegada: PERFIL_NUEVO.av_llegada,
            av_correo: c.av_correo ?? false,
          },
        ];
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (url === "/api/preferencias" && metodo === "GET") {
        return new Response(JSON.stringify(PERFIL_NUEVO), { status: 200 });
      }
      if (url === "/api/preferencias") {
        return new Response(JSON.stringify({ ...PERFIL_NUEVO, ...(cuerpo as object) }), { status: 200 });
      }
      throw new Error("URL no manejada: " + url);
    }),
  );
  return llamadas;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ============================================================
// (1) `boletin_correo` — el que llegó como columna sin manera de apagarla.
//
// Se monta `ConfigPreferencias`, que es la COMPOSICIÓN REAL de la pantalla
// (`config-preferencias.tsx:82` monta `ConfigAvisos`), y no `ConfigAvisos`
// suelto. Montar el hijo directamente es exactamente lo que no distingue «el
// control existe» de «se llega al control».
// ============================================================
describe("[INV-B9.1] alcanzabilidad · apagar el boletín", () => {
  it("un perfil NUEVO llega al apagador desde la pantalla de Configuración", async () => {
    servidorDePerfilNuevo();
    render(
      <SeguimientoProvider>
        <ConfigPreferencias />
      </SeguimientoProvider>,
    );

    // Sin tocar ninguna preferencia previa, sin encender nada antes.
    const boletin = await screen.findByRole("switch", { name: "Resumen semanal de la operación" });
    expect(boletin).toBeChecked();
    expect(boletin).toBeEnabled();
  });

  it("y al alcanzarlo, apagarlo llega al servidor", async () => {
    const llamadas = servidorDePerfilNuevo();
    render(
      <SeguimientoProvider>
        <ConfigPreferencias />
      </SeguimientoProvider>,
    );

    fireEvent.click(await screen.findByRole("switch", { name: "Resumen semanal de la operación" }));
    await waitFor(() =>
      expect(llamadas.some((l) => l.url === "/api/preferencias" && l.metodo === "PATCH")).toBe(true),
    );
    expect(llamadas.find((l) => l.metodo === "PATCH")!.cuerpo).toEqual({ boletin_correo: false });
  });
});

// ============================================================
// (2) `av_correo` — el que tenía interruptor y no tenía puerta.
//
// El camino completo, en los clics que de verdad da una persona:
//   perfil nuevo · SKU sin seguir  →  «Avisarme»  →  «Avisos»  →  el interruptor
//
// Y ni un solo paso enciende `preguntar_por_sku`. Ése es el punto: con el
// default puesto, la ventana de preferencias NO se abre al seguir, así que si
// «Avisos» no existiera, esta prueba no tendría por dónde llegar.
// ============================================================
describe("[INV-B9.1] alcanzabilidad · encender el correo de un SKU", () => {
  const ficha = (
    <SeguimientoProvider>
      <SeleccionFija seleccion={SELECCION_VACIA}>
        <FichaHeader
          sku="SUJ500-F"
          marca="Demo"
          familiaEfectiva="Bandas"
          descrEfectiva="Banda de prueba"
          total={10}
          disponible={4}
          sobreReservado={false}
          stock={[]}
          reservas={[]}
          snapshotStock={null}
          marcaExcluida={false}
        />
      </SeleccionFija>
    </SeguimientoProvider>
  );

  it("desde el estado por omisión se llega al interruptor de correo en 2 clics", async () => {
    const llamadas = servidorDePerfilNuevo();
    render(ficha);

    // (a) Seguir el SKU. Con el default esto NO abre ninguna ventana: es un clic.
    const seguir = await screen.findByRole("button", { name: "Seguir SUJ500-F para recibir avisos" });
    fireEvent.click(seguir);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(llamadas.some((l) => l.metodo === "POST")).toBe(true));

    // (b) El acceso a editar aparece justo por haberlo seguido.
    const editar = await screen.findByRole("button", { name: "Editar los avisos de SUJ500-F" });
    fireEvent.click(editar);

    // (c) Y ahí está el interruptor, alcanzado sin tocar `preguntar_por_sku`.
    const dialogo = await screen.findByRole("dialog");
    const correo = within(dialogo).getByLabelText("También por correo");
    expect(correo).toBeInTheDocument();
    expect(correo).not.toBeChecked();

    // El camino no pasó por encender «preguntar por cada SKU» en ningún momento.
    expect(PERFIL_NUEVO.preguntar_por_sku).toBe(false);
    expect(llamadas.filter((l) => l.metodo === "PATCH")).toHaveLength(0);
  });

  it("y encenderlo desde ese camino llega al servidor con `av_correo: true`", async () => {
    const llamadas = servidorDePerfilNuevo();
    render(ficha);

    fireEvent.click(await screen.findByRole("button", { name: "Seguir SUJ500-F para recibir avisos" }));
    fireEvent.click(await screen.findByRole("button", { name: "Editar los avisos de SUJ500-F" }));

    const dialogo = await screen.findByRole("dialog");
    fireEvent.click(within(dialogo).getByLabelText("También por correo"));
    fireEvent.click(within(dialogo).getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      const posts = llamadas.filter((l) => l.url === "/api/seguimientos" && l.metodo === "POST");
      expect(posts.some((p) => (p.cuerpo as { av_correo?: boolean }).av_correo === true)).toBe(true);
    });
  });

  // ============================================================
  // LA PRUEBA DE QUE ESTA GUARDA SIRVE: si el acceso «Avisos» desapareciera
  // —que es el estado en el que este bloque encontró el código— NO habría
  // ningún otro camino desde el default. Se comprueba por el contrapositivo:
  // en la tabla y el grid, donde ese acceso no está, el camino no existe.
  // ============================================================
  it("sin el acceso «Avisos» no hay camino: en la variante compacta el interruptor es inalcanzable", async () => {
    servidorDePerfilNuevo();
    // La variante `compacto` es la que vive en la tabla y el grid: sin el
    // acceso a editar. Es el estado en el que este bloque encontró el código.
    const { container } = render(
      <SeguimientoProvider>
        <BotonSeguir sku="SUJ500-F" />
      </SeguimientoProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Seguir SUJ500-F para recibir avisos" }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveAccessibleName("Dejar de seguir SUJ500-F"));

    // Un solo botón, ninguna ventana, ningún camino al correo.
    expect(within(container).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("También por correo")).not.toBeInTheDocument();
  });
});


// ============================================================
// (3) [INV-B10] LA BURBUJA DEL CHAT.
//
// Primera aplicación del antídoto a un control NUEVO, que es para lo que se
// escribió. Y aquí la pregunta muerde de verdad: la burbuja no depende de
// ninguna preferencia, pero **sí depende de que alguien la haya montado en el
// layout**. Un componente perfecto que nadie renderiza es exactamente P24.
//
// Por eso hay dos mitades y ninguna sobra:
//   · el componente, montado como lo monta el layout (sin props, sin gate);
//   · y una lectura del ÁRBOL que comprueba que el layout lo monta de verdad.
//
// La segunda no se puede sustituir por la primera: renderizar el componente en
// una prueba demuestra que funciona, no que esté en la pantalla.
// ============================================================
describe("[INV-B10] alcanzabilidad · el asistente", () => {
  it("el layout de `(app)` monta la burbuja, sin condición de rol ni de preferencia", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/(app)/layout.tsx"), "utf8");
    expect(layout).toContain("BurbujaChat");
    // Montada SIN props: cualquier condición viviría aquí y sería un camino
    // que alguien podría cerrar sin que ninguna prueba de componente lo notara.
    expect(layout).toMatch(/<BurbujaChat\s*\/>/);
  });

  it("un perfil NUEVO ve el botón sin haber configurado nada", () => {
    render(<BurbujaChat />);
    expect(screen.getByRole("button", { name: "Abrir el asistente" })).toBeInTheDocument();
  });

  it("y al abrirlo, el zero-state dice QUÉ puede preguntar", () => {
    render(<BurbujaChat />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));

    // Un chat vacío con un cursor no le dice a nadie qué hacer.
    expect(screen.getByRole("dialog", { name: "Asistente" })).toBeInTheDocument();

    // [INV-B11] O6 · se recorre `sugerencias()` y NO `INTENCIONES`, y el cambio
    // no es cosmético: desde que existe `capacidades`, el catálogo y el
    // zero-state **dejaron de ser el mismo conjunto** a propósito — un chip
    // «¿Qué puedes hacer?» dentro de la lista de lo que puede hacer es circular.
    // `sugerencias()` es exactamente lo que la burbuja pinta, así que ésta es la
    // fuente correcta contra la que compararla.
    const ofrecidas = sugerencias();
    expect(ofrecidas.length, "el zero-state se quedó sin chips: la prueba sería vacua").toBeGreaterThan(0);
    for (const s of ofrecidas) {
      expect(screen.getByText(s.texto), `falta la sugerencia de «${s.intencion}»`).toBeInTheDocument();
    }
    // Y el control del lado que NO se pinta: `capacidades` está en el catálogo
    // y NO puede aparecer aquí. Sin esta línea, un `sugerencias()` que las
    // devolviera todas pasaría el bucle de arriba sin ruido.
    expect(
      screen.queryByText("¿Qué puedes hacer?"),
      "`capacidades` volvió al zero-state, que es su propia respuesta",
    ).not.toBeInTheDocument();
  });

  // ============================================================
  // EL ATAJO, comprobado desde donde el usuario lo toca: un clic en un chip
  // manda `{intencion}` y NO `{pregunta}`. Si mandara texto, pagaría ~3,6 s y
  // una llamada al modelo por una respuesta que ya teníamos.
  // ============================================================
  it("un clic en una sugerencia manda la INTENCIÓN, no el texto", async () => {
    const llamadas: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        llamadas.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ tipo: "no_se", mensaje: "x", sabeHacer: [] }), { status: 200 });
      }),
    );

    render(<BurbujaChat />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
    fireEvent.click(screen.getByText("¿Qué hay en aduana?"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    // [INV-B11] O6 · el `ambiente` viaja desde el filtrado por ambiente. Se
    // compara el objeto ENTERO a propósito: lo que esto protege es que NO
    // viaje la pregunta en texto, y un `toMatchObject` dejaría pasar cualquier
    // campo nuevo sin decir nada.
    expect(llamadas[0]).toEqual({ intencion: "pipeline", ambiente: { ruta: "/" } });
    expect(llamadas[0]).not.toHaveProperty("pregunta");
  });

  it("la sugerencia que necesita SKU lo manda resuelto, no metido en una frase", async () => {
    const llamadas: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
        llamadas.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ tipo: "no_se", mensaje: "x", sabeHacer: [] }), { status: 200 });
      }),
    );

    render(<BurbujaChat />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir el asistente" }));
    fireEvent.click(screen.getByText("¿Cuándo llega el SUJ500-F?"));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toEqual({ intencion: "llegada", sku: "SUJ500-F", ambiente: { ruta: "/" } });
  });
});
