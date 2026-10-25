import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { SessionProvider, type SesionUsuario } from "@/components/providers/session-provider";
import { separarFamilias } from "@/lib/familias";
import { FichaAtributos, type FichaAtributosProps } from "./ficha-atributos";

// [FIX-B1 · revisión] Mock de sonner (mismo patrón que
// config-familias.test.tsx/config-usuarios.test.tsx): sin <Toaster/>
// montado, los toasts reales no dejan rastro en el DOM — se espía
// `toast.error` para confirmar el mensaje que de verdad llega al usuario en
// un 409, no solo que el componente "no truena".
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// [FIX-B1 · verificación] Sin esto, las llamadas a `toast.error`/`success`
// se ACUMULAN entre pruebas (el `vi.fn()` del mock vive todo el archivo y el
// config no trae `clearMocks`): un `toHaveBeenCalledWith(...)` podía salir
// verde por el toast de una prueba ANTERIOR, y un `not.toHaveBeenCalled`
// podía salir rojo por lo mismo. `clearAllMocks` sólo borra el historial de
// llamadas; no toca las implementaciones.
afterEach(() => {
  vi.clearAllMocks();
});

/**
 * `familiasEfectivas` se deriva SIEMPRE con la función real `separarFamilias`
 * a partir de `familiaEfectiva` (coherente con el invariante `familiasEfectivas
 * === separarFamilias(familiaEfectiva)`, INV-TAXO F2) — así cada test que solo
 * sobreescribe `familiaEfectiva` no tiene que repetir el cálculo a mano, y un
 * test SÍ puede sobreescribir `familiasEfectivas` explícitamente cuando quiera
 * un caso concreto (p.ej. el real "CLIP 3.0 / CLIP ROTATIVO").
 */
function renderConSesion(props: Partial<FichaAtributosProps> = {}, rol: SesionUsuario["rol"] = "kam") {
  const familiaEfectiva = props.familiaEfectiva === undefined ? "CANDADOS" : props.familiaEfectiva;
  const base: FichaAtributosProps = {
    sku: "A-1",
    marca: "BRAND1",
    familiaEfectiva,
    familiasEfectivas: separarFamilias(familiaEfectiva),
    descrEfectiva: "Descripción",
    original: { familia: "CANDADOS", descr: "Descripción" },
    color: null,
    // (R3-4) Requerido — hoy siempre `false` en runtime real (la migración
    // 0011 que puebla esta señal aún no corre); los tests de la insignia lo
    // sobreescriben explícitamente más abajo.
    decididoEnBandeja: { marca: false },
    ...props,
  };
  return render(
    <SessionProvider sesion={{ id: "actor-1", email: "user@example.com", rol }}>
      <FichaAtributos {...base} />
    </SessionProvider>,
  );
}

describe("[2.0.1-A · D3] la bandera «la fuente cambió» — se ve, se entiende y no culpa a nadie", () => {
  // El caso real: DMY5139-A muestra CLIP 2.0 y el archivo ya dice OBSOLETO.
  const divergente: Partial<FichaAtributosProps> = {
    familiaEfectiva: "CLIP 2.0",
    original: { familia: "OBSOLETO", descr: "Descripción" },
    origenes: { descr: "fuente", familia: "v2", marca: "fuente", clase: "fuente", tecnologia: null },
    divergenciaFamilia: "v2",
  };

  it("un KAM la ve PARTIENDO DEL ESTADO POR OMISIÓN, y sin una palabra de jerga (P24)", () => {
    // Alcanzable sin tocar ninguna preferencia: se abre la ficha y está ahí.
    renderConSesion(divergente, "kam");
    expect(screen.getByText("Según el archivo de inventario: OBSOLETO.")).toBeInTheDocument();
    expect(screen.getByText("la fuente cambió")).toBeInTheDocument();
    // Y NADA de «clasificación v2»: gatear esta señal por rol —el error
    // natural, copiado de la alerta `sin_v2`— la dejaría silenciosa justo para
    // quien enseña la pantalla.
    expect(screen.queryByText(/clasificación v2/i)).not.toBeInTheDocument();
  });

  it("a un admin le añade QUÉ capa gana, en el tooltip, sin cambiar la línea visible", () => {
    renderConSesion(divergente, "admin");
    expect(screen.getByText("Según el archivo de inventario: OBSOLETO.")).toBeInTheDocument();
    expect(screen.getByText("la fuente cambió").getAttribute("title")).toContain(
      "La capa que gana aquí es la clasificación v2.",
    );
  });

  it("sin divergencia NO se pinta nada: la ficha de siempre", () => {
    renderConSesion({}, "kam");
    expect(screen.queryByText("la fuente cambió")).not.toBeInTheDocument();
    expect(screen.queryByText(/Según el archivo de inventario/)).not.toBeInTheDocument();
  });

  it("la divergencia MANUAL no pinta esta insignia: ese caso ya tiene «editado» y su revertir", () => {
    renderConSesion(
      {
        familiaEfectiva: "CLIP 2.0",
        original: { familia: "OBSOLETO", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "manual", marca: "fuente", clase: "fuente", tecnologia: null },
        divergenciaFamilia: "manual",
      },
      "kam",
    );
    expect(screen.queryByText("la fuente cambió")).not.toBeInTheDocument();
    expect(screen.getByText("editado")).toBeInTheDocument();
  });
});

describe("FichaAtributos — rol kam (solo lectura, comportamiento B4 intacto)", () => {
  it("muestra el chip candado de solo lectura, con copy veraz (sin nombrar bloques internos ni implicar que falta iniciar sesión)", () => {
    renderConSesion({}, "kam");
    expect(screen.getByText("Solo lectura · tu rol no permite editar")).toBeInTheDocument();
  });

  it("no renderiza ningún elemento de formulario, ni siquiera deshabilitado", () => {
    renderConSesion({}, "kam");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector("input,select,textarea,button")).toBeNull();
  });

  it("badge 'editado' presente con title 'Original: X' cuando familia_efectiva difiere del original", () => {
    renderConSesion({ familiaEfectiva: "CANDADOS NUEVOS" }, "kam");
    const badge = screen.getByText("editado");
    expect(badge).toHaveAttribute("title", "Original: CANDADOS");
  });

  it("badge 'editado' presente con title 'Original: X' cuando descr_efectiva difiere del original", () => {
    renderConSesion({ descrEfectiva: "Descripción editada", original: { familia: "CANDADOS", descr: "Descripción original" } }, "kam");
    const badge = screen.getByText("editado");
    expect(badge).toHaveAttribute("title", "Original: Descripción original");
  });

  it("badge 'editado' ausente cuando familia y descripción efectivas igualan al original", () => {
    renderConSesion({}, "kam");
    expect(screen.queryByText("editado")).not.toBeInTheDocument();
  });

  it("dos badges 'editado' cuando familia y descripción difieren simultáneamente", () => {
    renderConSesion(
      { familiaEfectiva: "NUEVA", descrEfectiva: "Nueva descripción", original: { familia: "VIEJA", descr: "Vieja descripción" } },
      "kam",
    );
    expect(screen.getAllByText("editado")).toHaveLength(2);
  });

  it("familia null muestra chip 'Sin familia'", () => {
    renderConSesion({ familiaEfectiva: null, original: { familia: null, descr: "Descripción" } }, "kam");
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
  });

  // (v2) B-PARCHE F4: la fila Clase (solo-lectura, siempre presente) también
  // usa "—" cuando `clase` no viene en las props (undefined, fixture
  // retro-compat) — se escopea al <p> de Descripción para no ambigüar con
  // el chip de Clase.
  it("descripción null muestra '—' (v2)", () => {
    renderConSesion({ descrEfectiva: null, original: { familia: "CANDADOS", descr: null } }, "kam");
    expect(screen.getByText("—", { selector: "p" })).toBeInTheDocument();
  });

  // [FIX-B1] Antes decía "SKU bloqueado · ningún campo editable" —
  // decisión de producto: el subtítulo pasa a "Solo consulta" (más corto; el
  // chip candado de abajo ya explica el porqué). El título de la card
  // ("Datos del producto") se comparte con el rol admin.
  it("muestra el título 'Datos del producto' y la caption 'Solo consulta'", () => {
    renderConSesion({}, "kam");
    expect(screen.getByRole("heading", { name: "Datos del producto" })).toBeInTheDocument();
    expect(screen.getByText("Solo consulta")).toBeInTheDocument();
  });
});

describe("FichaAtributos — rol admin (edición real)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchRouter(handlers: {
    familias?: unknown;
    // [FIX-B1] Default `{ items: [] }` — como `TecnologiaEditable` siempre
    // hace GET /api/tecnologias en el rol admin, sin este handler CUALQUIER
    // test de este describe (no solo los de tecnología) tronaría con
    // "fetch no manejado".
    tecnologias?: unknown;
    override?: (body: unknown) => unknown;
    color?: (body: unknown) => unknown;
    altaFamilia?: { status: number; body: unknown };
  }) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url.startsWith("/api/familias") && method === "GET") {
        return new Response(JSON.stringify(handlers.familias ?? { items: [] }), { status: 200 });
      }
      if (url === "/api/familias" && method === "POST") {
        const status = handlers.altaFamilia?.status ?? 201;
        return new Response(JSON.stringify(handlers.altaFamilia?.body ?? {}), { status });
      }
      if (url.startsWith("/api/tecnologias") && method === "GET") {
        return new Response(JSON.stringify(handlers.tecnologias ?? { items: [] }), { status: 200 });
      }
      if (url === "/api/override" && method === "PUT") {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(handlers.override?.(body) ?? {}), { status: 200 });
      }
      if (url === "/api/color" && method === "PUT") {
        const body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(handlers.color?.(body) ?? {}), { status: 200 });
      }
      throw new Error(`fetch no manejado en el test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("caption de admin nombra familia/descripción/color y la condición de tecnología; sin chip candado", () => {
    stubFetchRouter({ familias: { items: [] } });
    renderConSesion({}, "admin");
    expect(screen.getByRole("heading", { name: "Datos del producto" })).toBeInTheDocument();
    expect(
      screen.getByText("Puedes editar familia, descripción y color; la tecnología, sólo si el Excel no la trae."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Solo lectura · tu rol no permite editar")).not.toBeInTheDocument();
  });

  it("admin ve DOS comboboxes (Familia + Tecnología, tecnología sin dato → selector), un textarea de descripción y 9 swatches de color (8 + Sin color)", async () => {
    stubFetchRouter({ familias: { items: [{ id: "f1", nombre: "CANDADOS", activo: true }] } });
    renderConSesion({}, "admin");

    expect(screen.getByRole("combobox", { name: "Familia" })).toBeInTheDocument();
    // [FIX-B1] Sin `tecnologia` en las props (undefined → Excel vacío): el
    // admin ve un SEGUNDO combobox, no un chip solo-lectura.
    expect(screen.getByRole("combobox", { name: "Tecnología" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Descripción" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(9));
  });

  it("elegir una familia del select dispara PUT /api/override con el body correcto", async () => {
    const fetchMock = stubFetchRouter({
      familias: {
        items: [
          { id: "f1", nombre: "CANDADOS", activo: true },
          { id: "f2", nombre: "CINTAS", activo: true },
        ],
      },
      override: (body) => {
        const b = body as { valor: string };
        return { sku: "A-1", campo: "familia", valor_efectivo: b.valor, familia_efectiva: b.valor, descr_efectiva: "Descripción" };
      },
    });
    renderConSesion({}, "admin");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Familia" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox", { name: "Familia" }));
    const opcion = await screen.findByRole("option", { name: "CINTAS" });
    fireEvent.click(opcion);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ sku: "A-1", campo: "familia", valor: "CINTAS" }),
        }),
      ),
    );
  });

  it("alta de familia inline: éxito crea, refresca lista y selecciona la nueva (PUT override con el nombre creado)", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [{ id: "f1", nombre: "CANDADOS", activo: true }] },
      altaFamilia: { status: 201, body: { id: "f9", nombre: "NUEVA FAMILIA", activo: true } },
      override: (body) => {
        const b = body as { valor: string };
        return { sku: "A-1", campo: "familia", valor_efectivo: b.valor, familia_efectiva: b.valor, descr_efectiva: "Descripción" };
      },
    });
    renderConSesion({}, "admin");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Familia" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox", { name: "Familia" }));
    const opcionNueva = await screen.findByRole("option", { name: "＋ Agregar nueva familia…" });
    fireEvent.click(opcionNueva);

    const input = await screen.findByLabelText("Nombre de la nueva familia");
    fireEvent.change(input, { target: { value: "NUEVA FAMILIA" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/familias",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ nombre: "NUEVA FAMILIA" }) }),
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "familia", valor: "NUEVA FAMILIA" }) }),
      ),
    );
  });

  it("alta de familia inline: 409 muestra error inline 'Ya existe una familia con ese nombre.'", async () => {
    stubFetchRouter({
      familias: { items: [] },
      altaFamilia: { status: 409, body: { error: "familia_duplicada", message: "La familia ya existe en el catálogo" } },
    });
    renderConSesion({}, "admin");

    await waitFor(() => expect(screen.getByRole("combobox", { name: "Familia" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox", { name: "Familia" }));
    const opcionNueva = await screen.findByRole("option", { name: "＋ Agregar nueva familia…" });
    fireEvent.click(opcionNueva);

    const input = await screen.findByLabelText("Nombre de la nueva familia");
    fireEvent.change(input, { target: { value: "CANDADOS" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una familia con ese nombre.");
  });

  it("descripción: Guardar dispara PUT /api/override con el texto recortado", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [] },
      override: (body) => {
        const b = body as { valor: string };
        return { sku: "A-1", campo: "descripcion", valor_efectivo: b.valor, familia_efectiva: "CANDADOS", descr_efectiva: b.valor };
      },
    });
    renderConSesion({}, "admin");

    const textarea = screen.getByRole("textbox", { name: "Descripción" });
    fireEvent.change(textarea, { target: { value: "  Descripción nueva  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "descripcion", valor: "Descripción nueva" }) }),
      ),
    );
  });

  it("descripción: Cancelar descarta el borrador sin llamar a la API", () => {
    stubFetchRouter({ familias: { items: [] } });
    renderConSesion({}, "admin");

    const textarea = screen.getByRole("textbox", { name: "Descripción" }) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Borrador sin guardar" } });
    expect(screen.getByRole("button", { name: "Cancelar" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(textarea.value).toBe("Descripción");
  });

  it("descripción: badge 'editado' + botón revertir; revertir dispara PUT con valor:null (reversión real, D3 — no re-escribe el original)", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [] },
      override: (body) => {
        const b = body as { valor: string | null };
        const descr_efectiva = b.valor ?? "Descripción original";
        return { sku: "A-1", campo: "descripcion", valor_efectivo: descr_efectiva, familia_efectiva: "CANDADOS", descr_efectiva };
      },
    });
    renderConSesion(
      { descrEfectiva: "Descripción editada", original: { familia: "CANDADOS", descr: "Descripción original" } },
      "admin",
    );

    expect(screen.getByText("editado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /revertir/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "descripcion", valor: null }) }),
      ),
    );
    // El badge "editado" depende de la prop `descrEfectiva` (la refresca el
    // padre vía `onSaved` en la app real, fuera del alcance de este test
    // aislado) — aquí verificamos el eco local del valor efectivo fresco.
    const textarea = screen.getByRole("textbox", { name: "Descripción" }) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("Descripción original"));
  });

  it("descripción: 'revertir' se muestra y funciona aunque el original sea null", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [] },
      override: () => ({ sku: "A-1", campo: "descripcion", valor_efectivo: null, familia_efectiva: "CANDADOS", descr_efectiva: null }),
    });
    renderConSesion({ descrEfectiva: "Descripción agregada", original: { familia: "CANDADOS", descr: null } }, "admin");

    expect(screen.getByRole("button", { name: /revertir/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /revertir/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "descripcion", valor: null }) }),
      ),
    );
  });

  it("familia: badge 'editado' + botón revertir; revertir dispara PUT con valor:null (reversión real, D3 — no re-escribe el original)", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [{ id: "f1", nombre: "CANDADOS", activo: true }] },
      override: (body) => {
        const b = body as { valor: string | null };
        const familia_efectiva = b.valor ?? "CANDADOS";
        return { sku: "A-1", campo: "familia", valor_efectivo: familia_efectiva, familia_efectiva, descr_efectiva: "Descripción" };
      },
    });
    renderConSesion({ familiaEfectiva: "CANDADOS NUEVOS", original: { familia: "CANDADOS", descr: "Descripción" } }, "admin");

    expect(screen.getByText("editado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /revertir/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "familia", valor: null }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("editado")).not.toBeInTheDocument());
  });

  it("familia: 'revertir' se muestra y funciona aunque el original sea null (ya se puede volver a 'Sin familia')", async () => {
    const fetchMock = stubFetchRouter({
      familias: { items: [] },
      override: () => ({ sku: "A-1", campo: "familia", valor_efectivo: null, familia_efectiva: null, descr_efectiva: "Descripción" }),
    });
    renderConSesion({ familiaEfectiva: "CANDADOS", original: { familia: null, descr: "Descripción" } }, "admin");

    expect(screen.getByRole("button", { name: /revertir/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /revertir/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "familia", valor: null }) }),
      ),
    );
  });

  it("color: clic en un swatch dispara PUT /api/color con el slug; 'Sin color' dispara color:null", async () => {
    const fetchMock = stubFetchRouter({ familias: { items: [] }, color: (body) => body });
    renderConSesion({ color: null }, "admin");

    fireEvent.click(screen.getByRole("radio", { name: "Azul" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/color",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", color: "azul" }) }),
      ),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Sin color" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/color",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", color: null }) }),
      ),
    );
  });

  it("color: no lleva badge 'editado' (es metadato directo, no override)", () => {
    stubFetchRouter({ familias: { items: [] } });
    renderConSesion({ color: "azul", familiaEfectiva: "CANDADOS", original: { familia: "CANDADOS", descr: "Descripción" } }, "admin");
    expect(screen.queryByText("editado")).not.toBeInTheDocument();
  });

  it("color: error de red revierte el estado local (el swatch anterior vuelve a marcarse)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/familias")) return new Response(JSON.stringify({ items: [] }), { status: 200 });
      if (url === "/api/color" && init?.method === "PUT") return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
      throw new Error(`fetch no manejado: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderConSesion({ color: null }, "admin");

    fireEvent.click(screen.getByRole("radio", { name: "Verde" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Sin color" })).toHaveAttribute("aria-checked", "true"));
  });

  // [FIX-B1 · revisión] `guardarCampo` SOLO deja pasar el `message` del
  // servidor para los dos códigos de tecnología — el resto de los campos
  // (familia, descripción, color) conserva el mensaje genérico de siempre,
  // aunque el servidor mande un `message` propio. Aquí, la respuesta REAL
  // de `PUT /api/override` (`app/api/override/route.ts`) cuando la familia
  // elegida dejó de existir o se desactivó entre que se cargó la lista y se
  // guardó: 400 `valor_familia_invalido`, con un texto que nombra la ruta de
  // alta (`POST /api/familias`) y no le habla a quien eligió de la lista.
  it("familia: 400 valor_familia_invalido (la respuesta real de la ruta) → toast con el mensaje GENÉRICO, no el del servidor", async () => {
    const mensajeDelServidor =
      'La familia "CANDADOS NUEVOS" no existe o está inactiva; créala primero con POST /api/familias';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/familias") && method === "GET") {
        return new Response(JSON.stringify({ items: [{ id: "f1", nombre: "CANDADOS NUEVOS", activo: true }] }), { status: 200 });
      }
      if (url.startsWith("/api/tecnologias") && method === "GET") {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url === "/api/override" && method === "PUT") {
        return new Response(JSON.stringify({ error: "valor_familia_invalido", message: mensajeDelServidor }), {
          status: 400,
        });
      }
      throw new Error(`fetch no manejado en el test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderConSesion({ familiaEfectiva: "CANDADOS", original: { familia: "CANDADOS", descr: "Descripción" } }, "admin");

    const combo = screen.getByRole("combobox", { name: "Familia" });
    fireEvent.click(combo);
    fireEvent.click(await screen.findByRole("option", { name: "CANDADOS NUEVOS" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la familia."));
    expect(toast.error).not.toHaveBeenCalledWith(mensajeDelServidor);
  });

  // [FIX-B1 · verificación] El mismo defecto que ya se arregló en Tecnología
  // (`?? undefined` → Select NO controlado) vivía también en Familia. Sólo se
  // manifiesta en un SKU SIN familia: con `valorLocal` no-nulo el Select ya
  // nacía controlado. Las dos puertas por las que se ve, una prueba cada una.
  it("familia: SKU sin familia + falla del servidor → el selector vuelve a 'Sin familia' (no se queda mostrando la familia rechazada)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/familias") && method === "GET") {
        return new Response(JSON.stringify({ items: [{ id: "f2", nombre: "CINTAS", activo: true }] }), { status: 200 });
      }
      if (url.startsWith("/api/tecnologias") && method === "GET") {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      if (url === "/api/override" && method === "PUT") {
        return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
      }
      throw new Error(`fetch no manejado en el test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderConSesion({ familiaEfectiva: null, original: { familia: null, descr: "Descripción" } }, "admin");

    const combo = screen.getByRole("combobox", { name: "Familia" });
    expect(combo).toHaveTextContent("Sin familia");
    fireEvent.click(combo);
    fireEvent.click(await screen.findByRole("option", { name: "CINTAS" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No se pudo actualizar la familia."));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Familia" })).toHaveTextContent("Sin familia"));
    expect(screen.getByRole("combobox", { name: "Familia" })).not.toHaveTextContent("CINTAS");
  });

  it("familia: SKU sin familia + elegir «＋ Agregar nueva familia…» → el selector sigue en 'Sin familia' (esa opción abre el alta, no es un valor)", async () => {
    stubFetchRouter({ familias: { items: [{ id: "f2", nombre: "CINTAS", activo: true }] } });
    renderConSesion({ familiaEfectiva: null, original: { familia: null, descr: "Descripción" } }, "admin");

    fireEvent.click(screen.getByRole("combobox", { name: "Familia" }));
    fireEvent.click(await screen.findByRole("option", { name: "＋ Agregar nueva familia…" }));

    // El alta se abrió (la opción SÍ hizo lo suyo)…
    expect(await screen.findByLabelText("Nombre de la nueva familia")).toBeInTheDocument();
    // …pero el disparador no se quedó con el texto de la opción.
    const combo = screen.getByRole("combobox", { name: "Familia" });
    expect(combo).toHaveTextContent("Sin familia");
    expect(combo).not.toHaveTextContent("Agregar nueva familia");
  });

  // [FIX-B1 · verificación] Un valor vigente que NO está en la lista activa
  // de `/api/familias` dejaba el disparador EN BLANCO (Radix sólo pinta el
  // texto de un `SelectItem` cuyo `value` coincide). Mismo remedio que ya
  // tenía Tecnología: el valor entra como opción deshabilitada.
  /** Espera a que `/api/familias` se haya pedido y deja correr un turno para que `useApi` procese la respuesta. */
  async function esperarListaDeFamilias(fetchMock: ReturnType<typeof stubFetchRouter>) {
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/familias", expect.anything()));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("familia compuesta real «CLIP 3.0 / CLIP ROTATIVO» (no es un nombre del catálogo) → el disparador la muestra y la lista la trae DESHABILITADA", async () => {
    const fetchMock = stubFetchRouter({
      familias: {
        items: [
          { id: "f1", nombre: "CLIP 3.0", activo: true },
          { id: "f2", nombre: "CLIP ROTATIVO", activo: true },
        ],
      },
    });
    renderConSesion(
      { familiaEfectiva: "CLIP 3.0 / CLIP ROTATIVO", original: { familia: "CLIP 3.0 / CLIP ROTATIVO", descr: "Descripción" } },
      "admin",
    );
    await esperarListaDeFamilias(fetchMock);

    const combo = screen.getByRole("combobox", { name: "Familia" });
    expect(combo).toHaveTextContent("CLIP 3.0 / CLIP ROTATIVO");
    fireEvent.click(combo);
    // Las dos opciones del catálogo prueban que la lista YA llegó: la
    // compuesta no está en blanco por «todavía carga».
    expect(await screen.findByRole("option", { name: "CLIP ROTATIVO" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "CLIP 3.0" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "CLIP 3.0 / CLIP ROTATIVO" })).toHaveAttribute("aria-disabled", "true");
  });

  // Sin «y elegirla no guarda nada» a propósito: elegir el valor que YA está
  // puesto no dispara `onValueChange` en Radix aunque la opción estuviera
  // habilitada, así que esa aserción saldría verde por la razón equivocada.
  // Lo que sí distingue «no elegible» es `aria-disabled`.
  it("familia INACTIVA (fuera de la lista activa) → el disparador la muestra y la lista la trae DESHABILITADA", async () => {
    const fetchMock = stubFetchRouter({ familias: { items: [{ id: "f1", nombre: "CANDADOS", activo: true }] } });
    renderConSesion({ familiaEfectiva: "OBSOLETA", original: { familia: "OBSOLETA", descr: "Descripción" } }, "admin");
    await esperarListaDeFamilias(fetchMock);

    const combo = screen.getByRole("combobox", { name: "Familia" });
    expect(combo).toHaveTextContent("OBSOLETA");
    fireEvent.click(combo);
    expect(await screen.findByRole("option", { name: "CANDADOS" })).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("option", { name: "OBSOLETA" })).toHaveAttribute("aria-disabled", "true");
  });

  it("familia que SÍ está en la lista → una sola opción, habilitada (el remedio no duplica ni bloquea la vigente)", async () => {
    const fetchMock = stubFetchRouter({
      familias: {
        items: [
          { id: "f1", nombre: "CANDADOS", activo: true },
          { id: "f2", nombre: "CINTAS", activo: true },
        ],
      },
    });
    renderConSesion({}, "admin");
    await esperarListaDeFamilias(fetchMock);

    const combo = screen.getByRole("combobox", { name: "Familia" });
    expect(combo).toHaveTextContent("CANDADOS");
    fireEvent.click(combo);
    await screen.findByRole("option", { name: "CINTAS" });
    const vigentes = screen.getAllByRole("option", { name: "CANDADOS" });
    expect(vigentes).toHaveLength(1);
    expect(vigentes[0]).not.toHaveAttribute("aria-disabled");
  });
});

// ------------------------------------------------------------
// B-PARCHE F4: badges de clasificación v2 (BadgeClasificacionV2), filas
// Clase/Tecnología (solo-lectura ambos roles) y pill "Sin clasificación v2".
// ------------------------------------------------------------
function stubFetchFamiliasVacias() {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })));
}

describe("FichaAtributos — badges de clasificación v2 (B-PARCHE F4; [MVP-2] frente E: solo-admin desde aquí)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // [MVP-2] Decisión de producto: KAM/Visitante dejan de ver el vocabulario
  // técnico "clasificación v2" — el badge de origen NO se pinta para
  // no-admin (el badge 'editado' de abajo es un caso aparte: "editado" no
  // es jerga y se queda, solo cambia su tooltip).
  it("kam: badge 'clasificación v2' NO se pinta en Familia aunque origenes.familia === 'v2'", () => {
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS DESDE V2",
        original: { familia: "CANDADOS", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "v2", marca: "fuente", clase: "fuente", tecnologia: null },
      },
      "kam",
    );
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
    expect(screen.queryByText("editado")).not.toBeInTheDocument();
  });

  it("admin: SÍ pinta el badge 'clasificación v2' en Familia cuando origenes.familia === 'v2' (sin badge 'editado')", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS DESDE V2",
        original: { familia: "CANDADOS", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "v2", marca: "fuente", clase: "fuente", tecnologia: null },
      },
      "admin",
    );
    const badge = screen.getByText("clasificación v2");
    expect(badge).toHaveAttribute("title", "Clasificación v2 · original: CANDADOS");
    expect(screen.queryByText("editado")).not.toBeInTheDocument();
  });

  it("kam: badge 'editado' con valor v2 debajo del override → title SIN nombrar 'clasificación v2' (usa igual el valor de esa capa, solo sin la etiqueta técnica)", () => {
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS MANUAL",
        original: { familia: "CANDADOS FUENTE", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "manual", marca: "fuente", clase: "fuente", tecnologia: null },
        v2: { descr: null, familia: "CANDADOS V2", marca: null, clase: null, tecnologia: null },
      },
      "kam",
    );
    const badge = screen.getByText("editado");
    expect(badge).toHaveAttribute("title", "Original: CANDADOS V2");
  });

  it("admin: badge 'editado' con valor v2 debajo del override → title 'Original (clasificación v2): X'", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS MANUAL",
        original: { familia: "CANDADOS FUENTE", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "manual", marca: "fuente", clase: "fuente", tecnologia: null },
        v2: { descr: null, familia: "CANDADOS V2", marca: null, clase: null, tecnologia: null },
      },
      "admin",
    );
    const badge = screen.getByText("editado");
    expect(badge).toHaveAttribute("title", "Original (clasificación v2): CANDADOS V2");
  });

  it("badge 'editado' sin valor v2 debajo del override → title 'Original: X' (igual en kam y admin: no hay capa v2 que nombrar)", () => {
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS MANUAL",
        original: { familia: "CANDADOS FUENTE", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "manual", marca: "fuente", clase: "fuente", tecnologia: null },
        v2: null,
      },
      "kam",
    );
    const badge = screen.getByText("editado");
    expect(badge).toHaveAttribute("title", "Original: CANDADOS FUENTE");
  });

  it("admin: sin botón revertir en el badge v2 de Familia (solo-lectura para ese campo en ambos roles)", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        familiaEfectiva: "CANDADOS DESDE V2",
        original: { familia: "CANDADOS", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "v2", marca: "fuente", clase: "fuente", tecnologia: null },
      },
      "admin",
    );
    expect(screen.getByText("clasificación v2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /revertir/ })).not.toBeInTheDocument();
  });
});

describe("FichaAtributos — fila Clase (solo-lectura ambos roles, B-PARCHE F4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("kam: muestra Clase con su valor", () => {
    renderConSesion({ clase: "CANDADO DE CABLE" }, "kam");
    expect(screen.getByText("Clase")).toBeInTheDocument();
    expect(screen.getByText("CANDADO DE CABLE")).toBeInTheDocument();
  });

  it("kam: clase null muestra '—'", () => {
    renderConSesion({ clase: null }, "kam");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("admin: Clase también solo-lectura (mismo valor, sin agregar controles)", async () => {
    stubFetchFamiliasVacias();
    renderConSesion({ clase: "SENSOR" }, "admin");
    expect(screen.getByText("SENSOR")).toBeInTheDocument();
    // Solo agregan los controles ya cubiertos por el combobox/textarea/radios existentes.
    await waitFor(() => expect(screen.getAllByRole("radio")).toHaveLength(9));
    expect(screen.getByRole("combobox", { name: "Familia" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Descripción" })).toBeInTheDocument();
  });

  it("kam: badge 'clasificación v2' NO se pinta en Clase aunque origenes.clase === 'v2'", () => {
    renderConSesion(
      { clase: "SENSOR AM", origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "v2", tecnologia: "fuente" } },
      "kam",
    );
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });

  it("admin: badge 'clasificación v2' SÍ se pinta en Clase cuando origenes.clase === 'v2'", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      { clase: "SENSOR AM", origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "v2", tecnologia: "fuente" } },
      "admin",
    );
    expect(screen.getAllByText("clasificación v2")).toHaveLength(1);
  });

  it("sin origenes.clase ('fuente' o null): sin badge 'clasificación v2'", () => {
    renderConSesion({ clase: "SENSOR AM" }, "kam");
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });
});

// ============================================================
// [FIX-B1] Fila "Tecnología": la ÚNICA capa donde EL EXCEL GANA — inversa
// de familia/descripción. Roles no-admin: «sólo el valor» (decisión de
// producto, sin insignias de ningún tipo, ni siquiera "clasificación v2" — ese
// vocabulario queda retirado para este campo). Admin: cuatro estados.
// ============================================================
describe("FichaAtributos — fila Tecnología no-admin: sólo el valor (FIX-B1)", () => {
  it("kam: muestra el valor, sin insignias", () => {
    renderConSesion({ tecnologia: "RFID" }, "kam");
    expect(screen.getByText("Tecnología")).toBeInTheDocument();
    expect(screen.getByText("RFID")).toBeInTheDocument();
  });

  it("kam: tecnología null muestra 'Sin tecnología'", () => {
    renderConSesion({ tecnologia: null }, "kam");
    expect(screen.getByText("Sin tecnología")).toBeInTheDocument();
  });

  it("kam: SIN insignia 'Viene del Excel' ni 'Capturada en el portal', pase lo que pase en origenes.tecnologia", () => {
    renderConSesion(
      { tecnologia: "EAS", origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "manual" } },
      "kam",
    );
    expect(screen.getByText("EAS")).toBeInTheDocument();
    expect(screen.queryByText("Viene del Excel")).not.toBeInTheDocument();
    expect(screen.queryByText("Capturada en el portal")).not.toBeInTheDocument();
  });

  it("kam: badge 'clasificación v2' NO se pinta en Tecnología aunque origenes.tecnologia === 'v2' (vocabulario v2 retirado para este campo)", () => {
    renderConSesion(
      { tecnologia: "AM", origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "v2" } },
      "kam",
    );
    expect(screen.getByText("AM")).toBeInTheDocument();
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });
});

describe("FichaAtributos — fila Tecnología admin, los cuatro estados (FIX-B1)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchAdmin(handlers: {
    familias?: unknown;
    tecnologias?: unknown;
    /**
     * [FIX-B1 · verificación] Respuestas de `/api/tecnologias` EN ORDEN, una
     * por llamada (la última se repite). Tiene precedencia sobre
     * `tecnologias`. Existe para distinguir un 500 de una lista vacía y
     * para ejercitar «Reintentar» (primera 500, segunda 200).
     */
    tecnologiasRespuestas?: { status: number; body: unknown }[];
    /** [FIX-B1 · verificación] `/api/tecnologias` nunca responde: la lista «aún carga». */
    tecnologiasPendiente?: boolean;
    override?: (body: unknown) => unknown | { status: number; body: unknown };
  }) {
    let llamadasTecnologias = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.startsWith("/api/familias") && method === "GET") {
        return new Response(JSON.stringify(handlers.familias ?? { items: [] }), { status: 200 });
      }
      if (url.startsWith("/api/tecnologias") && method === "GET") {
        if (handlers.tecnologiasPendiente) return new Promise<Response>(() => {});
        const respuestas = handlers.tecnologiasRespuestas;
        if (respuestas && respuestas.length > 0) {
          const r = respuestas[Math.min(llamadasTecnologias, respuestas.length - 1)];
          llamadasTecnologias += 1;
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        return new Response(JSON.stringify(handlers.tecnologias ?? { items: ["EAS", "BRAND2", "BRAND1"] }), { status: 200 });
      }
      if (url === "/api/override" && method === "PUT") {
        const body = JSON.parse(String(init?.body));
        const resultado = handlers.override?.(body) ?? {};
        if (resultado && typeof resultado === "object" && "status" in resultado) {
          const r = resultado as { status: number; body: unknown };
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
        return new Response(JSON.stringify(resultado), { status: 200 });
      }
      throw new Error(`fetch no manejado en el test: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("Estado 1 · Excel trae valor → solo-lectura con insignia 'Viene del Excel', SIN selector", () => {
    stubFetchAdmin({});
    // `marca: "BRAND5"` explícito: el default de `renderConSesion` es
    // "BRAND1" y colisionaría con el valor de tecnología en `getByText`.
    renderConSesion(
      {
        marca: "BRAND5",
        tecnologia: "BRAND1",
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" },
      },
      "admin",
    );
    expect(screen.getByText("BRAND1")).toBeInTheDocument();
    expect(screen.getByText("Viene del Excel")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tecnología" })).not.toBeInTheDocument();
  });

  it("Estado 2 · Excel vacío, sin captura → selector con las opciones de /api/tecnologias, sin insignia", async () => {
    stubFetchAdmin({ tecnologias: { items: ["EAS", "BRAND2", "BRAND1"] } });
    renderConSesion(
      { tecnologia: null, origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" } },
      "admin",
    );
    const combo = screen.getByRole("combobox", { name: "Tecnología" });
    expect(combo).toBeInTheDocument();
    expect(screen.queryByText("Capturada en el portal")).not.toBeInTheDocument();
    fireEvent.click(combo);
    expect(await screen.findByRole("option", { name: "EAS" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BRAND2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "BRAND1" })).toBeInTheDocument();
  });

  it("elegir una tecnología del selector dispara PUT /api/override con campo:'tecnologia'", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologias: { items: ["EAS", "BRAND2", "BRAND1"] },
      override: (body) => {
        const b = body as { valor: string };
        return { sku: "A-1", campo: "tecnologia", valor_efectivo: b.valor, familia_efectiva: "CANDADOS", descr_efectiva: "Descripción", tecnologia_efectiva: b.valor };
      },
    });
    renderConSesion({ tecnologia: null }, "admin");

    const combo = await screen.findByRole("combobox", { name: "Tecnología" });
    fireEvent.click(combo);
    const opcion = await screen.findByRole("option", { name: "EAS" });
    fireEvent.click(opcion);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: "EAS" }) }),
      ),
    );
  });

  it("Estado 3 · Excel vacío + captura EN EFECTO (origen 'manual') → selector + insignia 'Capturada en el portal' + botón 'quitar'", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: () => ({ sku: "A-1", campo: "tecnologia", valor_efectivo: null, familia_efectiva: null, descr_efectiva: null, tecnologia_efectiva: null }),
    });
    renderConSesion(
      {
        tecnologia: "EAS",
        tecnologiaPortal: "EAS",
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "manual" },
      },
      "admin",
    );

    expect(screen.getByRole("combobox", { name: "Tecnología" })).toBeInTheDocument();
    expect(screen.getByText("Capturada en el portal")).toBeInTheDocument();
    const botonQuitar = screen.getByRole("button", { name: /quitar/ });
    fireEvent.click(botonQuitar);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: null }) }),
      ),
    );
  });

  it("Estado 4 · Excel YA manda y quedó una captura del portal SIN efecto → nota 'ya no aplica' + opción de quitarla, superpuesta al estado 1", async () => {
    const fetchMock = stubFetchAdmin({
      override: () => ({ sku: "A-1", campo: "tecnologia", valor_efectivo: "BRAND1", familia_efectiva: null, descr_efectiva: null, tecnologia_efectiva: "BRAND1" }),
    });
    // `marca: "BRAND5"` explícito: mismo motivo que el Estado 1 — evita la
    // colisión con el default "BRAND1" de `renderConSesion`.
    renderConSesion(
      {
        marca: "BRAND5",
        tecnologia: "BRAND1",
        tecnologiaPortal: "EAS",
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" },
      },
      "admin",
    );

    // Sigue en el estado 1 (solo-lectura, "Viene del Excel") — la nota se
    // SUMA, no lo reemplaza.
    expect(screen.getByText("BRAND1")).toBeInTheDocument();
    expect(screen.getByText("Viene del Excel")).toBeInTheDocument();
    expect(screen.getByText("Lo capturado en el portal (EAS) ya no aplica: manda el Excel.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tecnología" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /quitar/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: null }) }),
      ),
    );
  });

  it("Excel poblado + tecnologiaPortal null (sin captura de por medio) → estado 1 SIN nota", () => {
    stubFetchAdmin({});
    renderConSesion(
      {
        tecnologia: "BRAND1",
        tecnologiaPortal: null,
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" },
      },
      "admin",
    );
    expect(screen.getByText("Viene del Excel")).toBeInTheDocument();
    expect(screen.queryByText(/ya no aplica/)).not.toBeInTheDocument();
  });

  it("409 excel_manda (carrera: el Excel se pobló entre que se abrió la ficha y se guardó) → toast con el mensaje llano del servidor Y el selector vuelve a 'Sin tecnología' (no se queda mostrando el valor rechazado)", async () => {
    stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: () => ({
        status: 409,
        body: {
          error: "excel_manda",
          message: "Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.",
        },
      }),
    });
    renderConSesion({ tecnologia: null }, "admin");

    const combo = await screen.findByRole("combobox", { name: "Tecnología" });
    fireEvent.click(combo);
    const opcion = await screen.findByRole("option", { name: "EAS" });
    fireEvent.click(opcion);

    // El componente no lanza ni desmonta — el selector sigue ahí, listo
    // para reintentar — Y el mensaje que de verdad llega al usuario es el
    // curado por el servidor, vía `sonner` (mockeado arriba).
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.",
      ),
    );
    expect(screen.getByRole("combobox", { name: "Tecnología" })).toBeInTheDocument();

    // [FIX-B1 · revisión] EL ROLLBACK ES VISIBLE: con `value={valorLocal ??
    // undefined}` el Select queda NO CONTROLADO desde el montaje (Excel
    // vacío ⇒ `valorLocal` arranca en `null`) y, tras el 409, se queda
    // mostrando "EAS" —el valor RECHAZADO— en vez de volver al placeholder
    // (medido por un revisor: "DESPUÉS DEL 409: EAS"). Con `?? ""` el
    // Select nunca deja de estar controlado y el placeholder aparece en
    // cuanto `valorLocal` vuelve a `null`.
    await waitFor(() => expect(screen.getByText("Sin tecnología")).toBeInTheDocument());
    expect(screen.queryByText("EAS")).not.toBeInTheDocument();
  });

  it("[FIX-B1 · revisión] mismo defecto por la puerta de «quitar»: seleccionar, refrescar con la verdad del servidor y quitar deja el selector en 'Sin tecnología'", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: (body) => {
        const b = body as { valor: string | null };
        if (b.valor === "EAS") {
          return {
            sku: "A-1",
            campo: "tecnologia",
            valor_efectivo: "EAS",
            familia_efectiva: "CANDADOS",
            descr_efectiva: "Descripción",
            tecnologia_efectiva: "EAS",
          };
        }
        return {
          sku: "A-1",
          campo: "tecnologia",
          valor_efectivo: null,
          familia_efectiva: "CANDADOS",
          descr_efectiva: "Descripción",
          tecnologia_efectiva: null,
        };
      },
    });

    const propsBase = { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente" } as const;
    const utils = renderConSesion(
      { tecnologia: null, origenes: { ...propsBase, tecnologia: "fuente" } },
      "admin",
    );

    // 1) Excel vacío: el admin CAPTURA una tecnología desde el selector
    // (arranca no-controlado en el código sin arreglar, ver el test de
    // arriba).
    const combo = await screen.findByRole("combobox", { name: "Tecnología" });
    fireEvent.click(combo);
    fireEvent.click(await screen.findByRole("option", { name: "EAS" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: "EAS" }) }),
      ),
    );

    // 2) `onSaved` dispara un refetch de la ficha (fuera de este
    // componente): el padre vuelve a renderizar con la verdad fresca del
    // servidor — la captura ya está EN EFECTO. [FIX-B1 · verificación] El
    // botón «quitar» y la insignia ya NO esperan a este refetch: miran
    // `portalLocal`, que se movió con la captura optimista. El rerender se
    // queda porque es el camino real (props frescas) y re-siembra
    // `portalLocal` desde `tecnologiaPortal`.
    utils.rerender(
      <SessionProvider sesion={{ id: "actor-1", email: "user@example.com", rol: "admin" }}>
        <FichaAtributos
          sku="A-1"
          marca="BRAND1"
          familiaEfectiva="CANDADOS"
          familiasEfectivas={["CANDADOS"]}
          descrEfectiva="Descripción"
          original={{ familia: "CANDADOS", descr: "Descripción" }}
          color={null}
          decididoEnBandeja={{ marca: false }}
          tecnologia="EAS"
          tecnologiaPortal="EAS"
          origenes={{ ...propsBase, tecnologia: "manual" }}
        />
      </SessionProvider>,
    );
    expect(screen.getByText("Capturada en el portal")).toBeInTheDocument();

    // 3) El admin la QUITA.
    fireEvent.click(screen.getByRole("button", { name: /quitar/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: null }) }),
      ),
    );

    // El selector vuelve al placeholder — no se queda mostrando "EAS".
    await waitFor(() => expect(screen.getByText("Sin tecnología")).toBeInTheDocument());
    expect(screen.queryByText("EAS")).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // [FIX-B1 · verificación] Hallazgos de la verificación en Opus.
  // ----------------------------------------------------------

  /**
   * Espera a que `/api/tecnologias` se haya pedido y deja correr un turno
   * del bucle de eventos para que `useApi` procese la respuesta. Lo usan
   * JUNTAS la prueba del 500 (aviso PRESENTE) y la de `items: []` (aviso
   * AUSENTE): que la del 500 vea el aviso con esta misma espera es lo que
   * prueba que la ausencia en la otra no es vacua (la respuesta sí se
   * procesó, no es que todavía no llegara).
   */
  async function esperarListaDeTecnologias(fetchMock: ReturnType<typeof stubFetchAdmin>) {
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tecnologias", expect.anything()));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  const ORIGENES_EXCEL_VACIO = { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" } as const;
  const ORIGENES_CAPTURA_EN_EFECTO = { ...ORIGENES_EXCEL_VACIO, tecnologia: "manual" } as const;

  it("lista de tecnologías con 500 → selector DESHABILITADO + aviso sin tecnicismos + «Reintentar»; al reintentar con éxito, el aviso se va y el selector vuelve", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologiasRespuestas: [
        { status: 500, body: { error: "internal_error" } },
        { status: 200, body: { items: ["EAS"] } },
      ],
    });
    renderConSesion({ tecnologia: null, origenes: ORIGENES_EXCEL_VACIO }, "admin");
    await esperarListaDeTecnologias(fetchMock);

    expect(screen.getByText("No se pudo cargar la lista de tecnologías.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tecnología" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect(screen.queryByText("No se pudo cargar la lista de tecnologías.")).not.toBeInTheDocument());
    const llamadas = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/tecnologias"));
    expect(llamadas).toHaveLength(2);
    const combo = screen.getByRole("combobox", { name: "Tecnología" });
    await waitFor(() => expect(combo).not.toBeDisabled());
    fireEvent.click(combo);
    expect(await screen.findByRole("option", { name: "EAS" })).toBeInTheDocument();
  });

  it("lista de tecnologías VACÍA legítima (200, items: []) → selector habilitado y SIN aviso: no se confunde con el 500", async () => {
    const fetchMock = stubFetchAdmin({ tecnologiasRespuestas: [{ status: 200, body: { items: [] } }] });
    renderConSesion({ tecnologia: null, origenes: ORIGENES_EXCEL_VACIO }, "admin");
    await esperarListaDeTecnologias(fetchMock);

    expect(screen.queryByText("No se pudo cargar la lista de tecnologías.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tecnología" })).not.toBeDisabled();
  });

  it("lista con 500 y captura VIGENTE → el selector sigue mostrando la captura (no en blanco) y «quitar» sigue disponible", async () => {
    const fetchMock = stubFetchAdmin({ tecnologiasRespuestas: [{ status: 500, body: { error: "internal_error" } }] });
    renderConSesion({ tecnologia: "EAS", tecnologiaPortal: "EAS", origenes: ORIGENES_CAPTURA_EN_EFECTO }, "admin");
    await esperarListaDeTecnologias(fetchMock);

    expect(screen.getByText("No se pudo cargar la lista de tecnologías.")).toBeInTheDocument();
    const combo = screen.getByRole("combobox", { name: "Tecnología" });
    expect(combo).toBeDisabled();
    expect(combo).toHaveTextContent("EAS");
    expect(screen.getByRole("button", { name: /quitar/ })).not.toBeDisabled();
  });

  it("captura vigente que YA NO está en la lista → el selector la muestra como opción deshabilitada, no en blanco", async () => {
    const fetchMock = stubFetchAdmin({ tecnologias: { items: ["BRAND2"] } });
    renderConSesion({ tecnologia: "EAS", tecnologiaPortal: "EAS", origenes: ORIGENES_CAPTURA_EN_EFECTO }, "admin");
    await esperarListaDeTecnologias(fetchMock);

    const combo = screen.getByRole("combobox", { name: "Tecnología" });
    expect(combo).toHaveTextContent("EAS");
    fireEvent.click(combo);
    expect(await screen.findByRole("option", { name: "EAS" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("option", { name: "BRAND2" })).not.toHaveAttribute("aria-disabled");
  });

  it("captura vigente mientras la lista AÚN CARGA → el selector ya la muestra (no en blanco)", () => {
    stubFetchAdmin({ tecnologiasPendiente: true });
    renderConSesion({ tecnologia: "EAS", tecnologiaPortal: "EAS", origenes: ORIGENES_CAPTURA_EN_EFECTO }, "admin");

    expect(screen.getByRole("combobox", { name: "Tecnología" })).toHaveTextContent("EAS");
  });

  it("«quitar» con 200, ANTES del refetch de la ficha → ni insignia «Capturada en el portal» ni botón «quitar» junto a 'Sin tecnología'", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: () => ({
        sku: "A-1",
        campo: "tecnologia",
        valor_efectivo: null,
        familia_efectiva: "CANDADOS",
        descr_efectiva: "Descripción",
        tecnologia_efectiva: null,
      }),
    });
    // Sin `onSaved` y sin rerender: las props se quedan como estaban ANTES
    // del guardado, que es exactamente la ventana entre el 200 y el refetch.
    renderConSesion({ tecnologia: "EAS", tecnologiaPortal: "EAS", origenes: ORIGENES_CAPTURA_EN_EFECTO }, "admin");
    expect(screen.getByText("Capturada en el portal")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /quitar/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: null }) }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Captura de tecnología retirada."));

    expect(screen.getByRole("combobox", { name: "Tecnología" })).toHaveTextContent("Sin tecnología");
    expect(screen.queryByText("Capturada en el portal")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quitar/ })).not.toBeInTheDocument();
  });

  it("409 excel_manda → además del toast, llama a `onSaved` para que la ficha se ponga al día (deja de ofrecer el selector)", async () => {
    const onSaved = vi.fn();
    stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: () => ({
        status: 409,
        body: {
          error: "excel_manda",
          message: "Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.",
        },
      }),
    });
    renderConSesion({ tecnologia: null, origenes: ORIGENES_EXCEL_VACIO, onSaved }, "admin");

    fireEvent.click(await screen.findByRole("combobox", { name: "Tecnología" }));
    fireEvent.click(await screen.findByRole("option", { name: "EAS" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Este producto ya trae tecnología en el archivo de inventario. La ficha ya se actualizó.",
      ),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("409 tecnologia_no_seleccionable → toast con el mensaje del servidor, pero NO llama a `onSaved` (sólo excel_manda dice que la ficha envejeció)", async () => {
    const onSaved = vi.fn();
    stubFetchAdmin({
      tecnologias: { items: ["EAS"] },
      override: () => ({
        status: 409,
        body: {
          error: "tecnologia_no_seleccionable",
          message: '"EAS" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.',
        },
      }),
    });
    renderConSesion({ tecnologia: null, origenes: ORIGENES_EXCEL_VACIO, onSaved }, "admin");

    fireEvent.click(await screen.findByRole("combobox", { name: "Tecnología" }));
    fireEvent.click(await screen.findByRole("option", { name: "EAS" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        '"EAS" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.',
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  // [FIX-B1 · verificación] El toast de arriba AFIRMA «La lista ya se
  // actualizó». Esta prueba es la que lo vuelve verdad: sin el refetch de
  // `onRechazo`, la lista seguía siendo la del montaje y volvía a ofrecer
  // justo la opción que el servidor acababa de rechazar.
  it("409 tecnologia_no_seleccionable → vuelve a pedir /api/tecnologias, y la opción rechazada deja de ofrecerse", async () => {
    const fetchMock = stubFetchAdmin({
      tecnologiasRespuestas: [
        { status: 200, body: { items: ["EAS", "BRAND2"] } },
        { status: 200, body: { items: ["BRAND2"] } },
      ],
      override: () => ({
        status: 409,
        body: {
          error: "tecnologia_no_seleccionable",
          message: '"EAS" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.',
        },
      }),
    });
    const llamadasALaLista = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/tecnologias")).length;
    renderConSesion({ tecnologia: null, origenes: ORIGENES_EXCEL_VACIO }, "admin");
    await esperarListaDeTecnologias(fetchMock);
    expect(llamadasALaLista()).toBe(1);

    fireEvent.click(screen.getByRole("combobox", { name: "Tecnología" }));
    fireEvent.click(await screen.findByRole("option", { name: "EAS" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        '"EAS" ya no está en la lista de tecnologías disponibles. La lista ya se actualizó.',
      ),
    );
    await waitFor(() => expect(llamadasALaLista()).toBe(2));

    // Y lo que el selector ofrece ahora es la lista NUEVA: el rollback lo dejó
    // en el placeholder y «EAS» ya no aparece ni como opción deshabilitada.
    const combo = screen.getByRole("combobox", { name: "Tecnología" });
    await waitFor(() => expect(combo).not.toBeDisabled());
    expect(combo).toHaveTextContent("Sin tecnología");
    fireEvent.click(combo);
    expect(await screen.findByRole("option", { name: "BRAND2" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("option", { name: "EAS" })).not.toBeInTheDocument());
  });

  // [FIX-B1 · verificación] Gemela de «"quitar" con 200, ANTES del refetch»
  // (Estado 3), pero en la rama «el Excel manda». Ahí la nota y el botón
  // también miran `portalLocal`, y es lo único que los apaga en la ventana
  // entre el 200 y el refetch de la ficha: si volvieran a leer la prop
  // `tecnologiaPortal`, la fila seguiría diciendo «Lo capturado en el portal
  // (EAS) ya no aplica» con un «quitar» que ya no tiene nada que quitar.
  it("Estado 4 · «quitar» con 200, ANTES del refetch de la ficha → desaparecen la nota «ya no aplica» y el botón «quitar»; queda el Estado 1", async () => {
    const fetchMock = stubFetchAdmin({
      override: () => ({
        sku: "A-1",
        campo: "tecnologia",
        valor_efectivo: "BRAND1",
        familia_efectiva: "CANDADOS",
        descr_efectiva: "Descripción",
        tecnologia_efectiva: "BRAND1",
      }),
    });
    // Sin `onSaved` y sin rerender: las props siguen diciendo
    // `tecnologiaPortal: "EAS"`, que es exactamente la ventana entre el 200 y
    // el refetch. `marca: "BRAND5"`: mismo motivo que el Estado 1.
    renderConSesion(
      {
        marca: "BRAND5",
        tecnologia: "BRAND1",
        tecnologiaPortal: "EAS",
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: "fuente" },
      },
      "admin",
    );
    expect(screen.getByText("Lo capturado en el portal (EAS) ya no aplica: manda el Excel.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /quitar/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/override",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ sku: "A-1", campo: "tecnologia", valor: null }) }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Captura de tecnología retirada."));

    expect(screen.queryByText(/ya no aplica/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /quitar/ })).not.toBeInTheDocument();
    // El Estado 1 sigue en pie: el Excel manda y lo sigue diciendo.
    expect(screen.getByText("BRAND1")).toBeInTheDocument();
    expect(screen.getByText("Viene del Excel")).toBeInTheDocument();
  });
});

describe("FichaAtributos — pill 'Sin clasificación v2' (nivel SKU, B-PARCHE F4; [MVP-2] frente E: solo-admin desde aquí)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // [MVP-2] Antes la pill era visible en ambos roles; decisión de producto: deja
  // de pintarse para KAM/Visitante (no se traduce, se quita la señal).
  it("kam: pill ausente aunque v2 === null (antes se mostraba; ahora es exclusiva de admin)", () => {
    renderConSesion({ v2: null }, "kam");
    expect(screen.queryByText("Sin clasificación v2")).not.toBeInTheDocument();
  });

  it("kam: pill ausente cuando hay registro v2 (aunque sus campos sean todos null)", () => {
    renderConSesion({ v2: { descr: null, familia: null, marca: null, clase: null, tecnologia: null } }, "kam");
    expect(screen.queryByText("Sin clasificación v2")).not.toBeInTheDocument();
  });

  it("kam: pill ausente cuando v2 es undefined (fixture retro-compat)", () => {
    renderConSesion({}, "kam");
    expect(screen.queryByText("Sin clasificación v2")).not.toBeInTheDocument();
  });

  it("admin: pill SÍ visible cuando v2 === null (a diferencia de kam, que ya no la ve)", () => {
    stubFetchFamiliasVacias();
    renderConSesion({ v2: null }, "admin");
    expect(screen.getByText("Sin clasificación v2")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------
// INV-TAXO F2 · B1: N chips de familia (uno por elemento de
// `familiasEfectivas`) + EXACTAMENTE 1 badge de origen para el CAMPO
// completo (nunca uno por chip: la procedencia es del campo, no del
// átomo). B2: `familiasEfectivas` vacío conserva el chip "Sin familia"
// que ya pintaba `familiaEfectiva === null`. B4: caso real medido (ver
// `src/lib/familias.ts`) "CLIP 3.0 / CLIP ROTATIVO" (2 átomos).
// ------------------------------------------------------------
describe("FichaAtributos — familia multi-valor, kam (INV-TAXO F2, B1/B2/B4)", () => {
  it("familia compuesta real 'CLIP 3.0 / CLIP ROTATIVO' pinta un chip POR átomo", () => {
    renderConSesion({ familiaEfectiva: "CLIP 3.0 / CLIP ROTATIVO", familiasEfectivas: ["CLIP 3.0", "CLIP ROTATIVO"] }, "kam");
    expect(screen.getByText("CLIP 3.0")).toBeInTheDocument();
    expect(screen.getByText("CLIP ROTATIVO")).toBeInTheDocument();
  });

  // [MVP-2] rol admin (no kam): el badge 'clasificación v2' es exclusivo de
  // admin desde este bloque — el conteo "1, nunca por chip" que este test
  // ratifica solo es observable donde el badge sigue siendo visible.
  it("admin: familia compuesta con origen v2 pinta EXACTAMENTE 1 badge 'clasificación v2' (nunca uno por chip)", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        familiaEfectiva: "CLIP 3.0 / CLIP ROTATIVO",
        familiasEfectivas: ["CLIP 3.0", "CLIP ROTATIVO"],
        original: { familia: "CLIP 3.0 / CLIP ROTATIVO", descr: "Descripción" },
        origenes: { descr: "fuente", familia: "v2", marca: "fuente", clase: "fuente", tecnologia: null },
      },
      "admin",
    );
    expect(screen.getAllByText("clasificación v2")).toHaveLength(1);
  });

  it("familia compuesta con override manual pinta EXACTAMENTE 1 badge 'editado' (nunca uno por chip)", () => {
    renderConSesion(
      {
        familiaEfectiva: "CLIP 3.0 / CLIP ROTATIVO",
        familiasEfectivas: ["CLIP 3.0", "CLIP ROTATIVO"],
        original: { familia: "CLIP ORIGINAL", descr: "Descripción" },
      },
      "kam",
    );
    expect(screen.getAllByText("editado")).toHaveLength(1);
  });

  it("el contenedor de los chips usa flex-wrap (para que muchos chips no rompan el layout con scroll horizontal)", () => {
    renderConSesion({ familiaEfectiva: "CLIP 3.0 / CLIP ROTATIVO", familiasEfectivas: ["CLIP 3.0", "CLIP ROTATIVO"] }, "kam");
    const chip = screen.getByText("CLIP 3.0");
    expect(chip.parentElement?.className).toContain("flex-wrap");
  });

  it("familiasEfectivas vacío mantiene el chip 'Sin familia' (B2 — mismo tratamiento que familiaEfectiva null)", () => {
    renderConSesion({ familiaEfectiva: null, familiasEfectivas: [], original: { familia: null, descr: "Descripción" } }, "kam");
    expect(screen.getByText("Sin familia")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------
// R3-4 (ronda de corrección): fila "Marca" (solo-lectura en ambos roles,
// mismo criterio que Clase/Tecnología) + insignia "decidido en bandeja",
// que sustituye a "clasificación v2" cuando `decidido_en_bandeja.marca` es
// `true` — el valor lo eligió un admin al resolver un pendiente
// `marca_ambigua`, no el archivo mensual. Hoy el campo llega `false` en
// TODOS los SKUs reales (la migración 0011 aún no corre): esta cobertura
// es la única forma de ejercitar la rama `true` (spec: "cúbrela con test,
// no con datos simulados en la app").
// ------------------------------------------------------------
describe("FichaAtributos — fila Marca + insignia 'decidido en bandeja' (R3-4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("kam: muestra el valor de marca, sin insignia cuando el origen no es v2", () => {
    renderConSesion({ marca: "BRAND5" }, "kam");
    expect(screen.getByText("Marca")).toBeInTheDocument();
    expect(screen.getByText("BRAND5")).toBeInTheDocument();
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
    expect(screen.queryByText("decidido en bandeja")).not.toBeInTheDocument();
  });

  it("kam: origen v2 + decididoEnBandeja.marca=false → SIN insignia (ni 'clasificación v2' ni 'decidido en bandeja'; vocabulario v2 oculto para no-admin)", () => {
    renderConSesion(
      {
        marca: "SERIES5",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "fuente", tecnologia: null },
        decididoEnBandeja: { marca: false },
      },
      "kam",
    );
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
    expect(screen.queryByText("decidido en bandeja")).not.toBeInTheDocument();
  });

  it("admin: origen v2 + decididoEnBandeja.marca=false → insignia 'clasificación v2' (comportamiento normal, sin distinguir)", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        marca: "SERIES5",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "fuente", tecnologia: null },
        decididoEnBandeja: { marca: false },
      },
      "admin",
    );
    expect(screen.getByText("clasificación v2")).toBeInTheDocument();
    expect(screen.queryByText("decidido en bandeja")).not.toBeInTheDocument();
  });

  it("kam: origen v2 + decididoEnBandeja.marca=true → insignia 'decidido en bandeja' EN LUGAR de 'clasificación v2' (nunca ambas)", () => {
    renderConSesion(
      {
        marca: "VERTICAL",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "fuente", tecnologia: null },
        decididoEnBandeja: { marca: true },
      },
      "kam",
    );
    const badge = screen.getByText("decidido en bandeja");
    expect(badge).toHaveAttribute(
      "title",
      "Decidido en bandeja · un administrador eligió este valor al resolver un pendiente, no proviene del archivo mensual.",
    );
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });

  it("kam: decididoEnBandeja.marca=true pero origen NO es v2 (p.ej. 'fuente') → sin ninguna insignia", () => {
    renderConSesion(
      {
        marca: "BRAND5",
        origenes: { descr: "fuente", familia: "fuente", marca: "fuente", clase: "fuente", tecnologia: null },
        decididoEnBandeja: { marca: true },
      },
      "kam",
    );
    expect(screen.queryByText("decidido en bandeja")).not.toBeInTheDocument();
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });

  it("kam: 'decidido en bandeja' (Marca) se conserva —no es jerga v2— pero Clase NO muestra 'clasificación v2' (vocabulario v2 oculto para no-admin)", () => {
    renderConSesion(
      {
        marca: "VERTICAL",
        clase: "SENSOR",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "v2", tecnologia: null },
        decididoEnBandeja: { marca: true },
      },
      "kam",
    );
    expect(screen.getByText("decidido en bandeja")).toBeInTheDocument();
    expect(screen.queryByText("clasificación v2")).not.toBeInTheDocument();
  });

  it("admin: los demás campos (Clase) conservan su insignia normal 'clasificación v2' aunque decididoEnBandeja.marca sea true", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        marca: "VERTICAL",
        clase: "SENSOR",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "v2", tecnologia: null },
        decididoEnBandeja: { marca: true },
      },
      "admin",
    );
    expect(screen.getByText("decidido en bandeja")).toBeInTheDocument();
    // Clase sigue con su insignia de siempre — la sustitución es EXCLUSIVA de Marca.
    expect(screen.getByText("clasificación v2")).toBeInTheDocument();
  });

  it("admin: mismo comportamiento — fila Marca solo-lectura (sin controles) con la insignia 'decidido en bandeja'", () => {
    stubFetchFamiliasVacias();
    renderConSesion(
      {
        marca: "VERTICAL",
        origenes: { descr: "fuente", familia: "fuente", marca: "v2", clase: "fuente", tecnologia: null },
        decididoEnBandeja: { marca: true },
      },
      "admin",
    );
    expect(screen.getByText("Marca")).toBeInTheDocument();
    expect(screen.getByText("VERTICAL")).toBeInTheDocument();
    expect(screen.getByText("decidido en bandeja")).toBeInTheDocument();
  });
});
